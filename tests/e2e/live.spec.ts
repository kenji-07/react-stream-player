import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { BASE, events, mount, openHarness, state, videoInfo, waitForEvent, waitForReady } from './helpers';

// Real-time ffmpeg live streams (moving live edge, 16 s DVR window).
const here = path.dirname(fileURLToPath(import.meta.url));
const { startLive } = (await import(path.join(here, '../../scripts/live-fixtures.mjs'))) as {
  startLive(o: { protocol: 'hls' | 'dash'; windowSegments?: number }): Promise<{ stop(): Promise<void> }>;
};

let streams: Array<{ stop(): Promise<void> }> = [];

test.beforeAll(async () => {
  test.setTimeout(120_000);
  streams = await Promise.all([startLive({ protocol: 'hls', windowSegments: 8 }), startLive({ protocol: 'dash', windowSegments: 8 })]);
  // Let the DVR window fill so seek-back tests have room.
  await new Promise((r) => setTimeout(r, 14_000));
});

test.afterAll(async () => {
  await Promise.all(streams.map((s) => s.stop()));
});

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

const LIVE = {
  hls: { id: 'live-hls', src: `${BASE}/live/hls/master.m3u8`, type: 'hls' },
  dash: { id: 'live-dash', src: `${BASE}/live/dash/manifest.mpd`, type: 'dash' },
};

for (const protocol of ['hls', 'dash'] as const) {
  test(`${protocol.toUpperCase()} live: live state from metadata, DVR window, clamped seeks and seekToLive`, async ({ page }) => {
    await mount(page, { source: LIVE[protocol] });
    await waitForReady(page, 30_000);
    await page.evaluate(() => window.__h.ref().play());
    await page.waitForFunction(() => !(document.querySelector('#app video') as HTMLVideoElement).paused && window.__h.ref().getState().live.isLive, null, { timeout: 20_000 });
    await page.waitForTimeout(1500);
    let s = await state(page);
    expect(s.live.isLive).toBe(true);
    expect(s.duration).toBeNull();
    expect(s.live.seekableRange.end - s.live.seekableRange.start).toBeGreaterThan(6);
    expect(s.live.atLiveEdge).toBe(true);
    expect((await events(page, 'liveStateChange')).length).toBeGreaterThan(0);
    // Player UI: LIVE indicator (inactive at the edge), a DVR slider over the
    // seekable window, and no VOD time readout.
    const liveButton = page.locator('#app .rsp-live-button');
    const progress = page.locator('#app .rsp-progress');
    await expect(liveButton).toBeVisible();
    await expect(liveButton).toBeDisabled();
    await expect(page.locator('#app .rsp-time')).toBeHidden();
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuetext', 'LIVE');
    // Seek back inside the DVR window.
    await page.evaluate(() => {
      const r = window.__h.ref().getState().live.seekableRange;
      return window.__h.ref().seekTo(r.start + 1);
    });
    await page.waitForTimeout(800);
    s = await state(page);
    expect(s.live.atLiveEdge).toBe(false);
    expect(s.live.behindLiveEdge).toBeGreaterThan(3);
    await expect(liveButton).toBeEnabled();
    await expect(liveButton).toHaveAttribute('aria-label', /^Go to live/);
    await expect(progress).toHaveAttribute('aria-valuetext', /behind live$/);
    // Seeks before the window are clamped into it.
    await page.evaluate(() => window.__h.ref().seekTo(0));
    const clamped = await page.evaluate(() => ({ t: (document.querySelector('#app video') as HTMLVideoElement).currentTime, r: window.__h.ref().getState().live.seekableRange }));
    expect(clamped.t).toBeGreaterThanOrEqual(clamped.r.start - 0.5);
    // The LIVE control returns to the edge.
    await liveButton.click();
    await page.waitForFunction(() => window.__h.ref().getState().live.atLiveEdge, null, { timeout: 10_000 });
    await expect(liveButton).toBeDisabled();
    // percent hotkeys use the seekable window, not Infinity.
    await page.locator('#app .rsp-root').focus();
    await page.keyboard.press('0');
    await page.waitForTimeout(500);
    expect((await state(page)).live.atLiveEdge).toBe(false);
    await page.keyboard.press('End');
    await page.waitForFunction(() => window.__h.ref().getState().live.atLiveEdge, null, { timeout: 10_000 });
    expect((await events(page, 'ended')).length).toBe(0);
  });
}

test('live session-time midroll: clock excludes pauses; after the break content returns to the live edge', async ({ page }) => {
  await mount(page, { source: LIVE.hls, ads: { items: [{ id: 'live-mid', type: 'text', text: 'Live break', duration: 2, timing: { placement: 'midroll', at: 3, timeBase: 'session' } }] } });
  await waitForReady(page, 30_000);
  await page.evaluate(() => window.__h.ref().play());
  await page.waitForFunction(() => window.__h.ref().getStats().content.sessionPlaybackTime > 1, null, { timeout: 20_000 });
  await page.evaluate(() => window.__h.ref().pause());
  const frozen = await page.evaluate(() => window.__h.ref().getStats().content.sessionPlaybackTime);
  await page.waitForTimeout(2500);
  const stillFrozen = await page.evaluate(() => window.__h.ref().getStats().content.sessionPlaybackTime);
  expect(stillFrozen - frozen).toBeLessThan(0.05);
  expect((await events(page, 'adStart')).length).toBe(0);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adBreakEnd', 20_000);
  const restore = await waitForEvent(page, 'liveRestore');
  expect(restore.payload.reason).toBe('live-edge');
  await page.waitForFunction(() => window.__h.ref().getState().live.atLiveEdge && !(document.querySelector('#app video') as HTMLVideoElement).paused, null, { timeout: 10_000 });
});

test('live midroll while behind the edge restores the DVR position; a pause during the break is respected', async ({ page }) => {
  await mount(page, { source: LIVE.dash, ads: { items: [{ id: 'mid', type: 'text', text: 'Break', duration: 20, skipAfter: 0, timing: { placement: 'midroll', at: 2, timeBase: 'session' } }] } });
  await waitForReady(page, 30_000);
  await page.evaluate(() => window.__h.ref().play());
  await page.waitForFunction(() => window.__h.ref().getState().live.isLive && !(document.querySelector('#app video') as HTMLVideoElement).paused, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const r = window.__h.ref().getState().live.seekableRange;
    return window.__h.ref().seekTo(r.end - 8);
  });
  await waitForEvent(page, 'adBreakStart', 20_000);
  const position = (await videoInfo(page)).time;
  // Pausing during a time-based ad pauses the ad; skipping then ends the
  // break while the viewer's pause intent stands.
  await page.evaluate(() => window.__h.ref().pause());
  await page.locator('.rsp-ad-skip').click();
  await waitForEvent(page, 'adBreakEnd', 15_000);
  const restore = await waitForEvent(page, 'liveRestore');
  expect(restore.payload.reason).toBe('dvr-position');
  await page.waitForTimeout(500);
  const v = await videoInfo(page);
  expect(v.paused).toBe(true);
  expect(Math.abs(v.time - position)).toBeLessThan(1);
});

test('DVR window expiry during a live break jumps to live and reports dvr-window-expired', async ({ page }) => {
  test.setTimeout(90_000);
  await mount(page, { source: LIVE.hls, ads: { items: [{ id: 'long', type: 'text', text: 'Long break', duration: 19, timing: { placement: 'midroll', at: 1, timeBase: 'session' } }] } });
  await waitForReady(page, 30_000);
  await page.evaluate(() => window.__h.ref().play());
  await page.waitForFunction(() => window.__h.ref().getState().live.isLive && !(document.querySelector('#app video') as HTMLVideoElement).paused, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const r = window.__h.ref().getState().live.seekableRange;
    return window.__h.ref().seekTo(r.start + 0.5);
  });
  await waitForEvent(page, 'adBreakEnd', 40_000);
  const restore = await waitForEvent(page, 'liveRestore');
  expect(restore.payload.reason).toBe('dvr-window-expired');
  await page.waitForFunction(() => window.__h.ref().getState().live.atLiveEdge, null, { timeout: 10_000 });
});

test('live rejects postrolls and media-time numeric cues with explicit ad-unsupported errors', async ({ page }) => {
  await mount(page, {
    source: LIVE.dash,
    ads: {
      items: [
        { id: 'post', type: 'text', text: 'x', duration: 1, timing: { placement: 'postroll' } },
        { id: 'media', type: 'text', text: 'y', duration: 1, timing: { placement: 'overlay', at: 1 } },
        { id: 'pre', type: 'text', text: 'Live preroll', duration: 1, timing: { placement: 'preroll' } },
      ],
    },
  });
  await waitForReady(page, 30_000);
  const errors = (await events(page, 'adError')).map((e) => [e.payload.code, e.payload.details.adId]);
  expect(errors).toEqual([
    ['ad-unsupported', 'post'],
    ['ad-unsupported', 'media'],
  ]);
  // Live preroll completes before content starts, then content starts at the live edge.
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adBreakEnd', 15_000);
  await page.waitForFunction(() => window.__h.ref().getState().live.atLiveEdge && !(document.querySelector('#app video') as HTMLVideoElement).paused, null, { timeout: 15_000 });
});

test('lowLatencyMode and liveSync configuration are passed to the engine for live streams', async ({ page }) => {
  await mount(page, { source: LIVE.hls, streaming: { lowLatencyMode: true, liveSync: { enabled: true, targetLatency: 6 } } });
  await waitForReady(page, 30_000);
  await page.evaluate(() => window.__h.ref().play());
  await page.waitForFunction(() => !(document.querySelector('#app video') as HTMLVideoElement).paused, null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const s = await state(page);
  expect(s.live.targetLatency).toBe(6);
  expect(s.live.isLive).toBe(true);
});
