import { expect, test } from '@playwright/test';
import { BASE, events, mount, mp4Variants, openHarness, resetLog, selectInSettings, serverLog, state, SUBS, videoInfo, waitForEvent, waitForReady, waitForTime } from './helpers';

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog();
});

test('single progressive MP4 plays with the native engine and does not load Shaka', async ({ page }) => {
  const shakaRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('shaka-player')) shakaRequests.push(r.url());
  });
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' } });
  await waitForReady(page);
  const s = await state(page);
  expect(s.engine).toBe('native');
  expect(s.sourceType).toBe('mp4');
  expect(s.duration).toBeGreaterThan(19);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
  expect(shakaRequests).toEqual([]);
});

test('defaults: volume 0.7, exact rate list, metadata preload, playsinline, contain fit', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' } });
  await waitForReady(page);
  const s = await state(page);
  expect(s.volume).toBe(0.7);
  expect(s.muted).toBe(false);
  expect(s.playbackRate).toBe(1);
  expect(s.playbackRates).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  const attrs = await page.evaluate(() => {
    const v = document.querySelector('#app video') as HTMLVideoElement;
    return { preload: v.preload, playsInline: v.playsInline, fit: getComputedStyle(v).objectFit, pos: getComputedStyle(v).objectPosition, volume: v.volume };
  });
  expect(attrs).toEqual({ preload: 'metadata', playsInline: true, fit: 'contain', pos: '50% 50%', volume: 0.7 });
  // Speed menu lists exactly the configured rates with exact labels (not Artplayer's toFixed(1)).
  await page.locator('.art-control-setting').first().click();
  await page.locator('.art-setting-panel.art-current .art-setting-item-left-text').getByText('Speed', { exact: true }).click();
  const labels = await page.locator('.art-setting-panel.art-current .art-setting-item:not(.art-setting-item-back) .art-setting-item-left-text').allTextContents();
  expect(labels).toEqual(['0.5×', '0.75×', 'Normal', '1.25×', '1.5×', '2×']);
});

test('vendor volume persistence is disabled: a cached Artplayer volume never overrides the default', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('artplayer_settings', JSON.stringify({ volume: 0.11, times: { x: 99 } })));
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' } });
  await waitForReady(page);
  expect((await videoInfo(page)).volume).toBe(0.7);
  await page.evaluate(() => window.__h.ref().setVolume(0.33));
  // Use Artplayer's own volume API too: it must not write storage.
  await page.evaluate(() => {
    localStorage.removeItem('artplayer_settings');
  });
  await page.locator('.art-control-volume').first().hover();
  await page.evaluate(() => window.__h.ref().setVolume(0.44));
  expect(await page.evaluate(() => localStorage.getItem('artplayer_settings'))).toBeNull();
});

test('per-instance isolation: two players keep independent volume/rate/quality', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, defaultVolume: 0.2, defaultPlaybackRate: 1.5 });
  await page.evaluate((base) => window.__h.mount({ source: { src: `${base}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } }, { key: 'b' }), BASE);
  await page.waitForFunction(() => window.__h.events.filter((e: { name: string }) => e.name === 'ready').length >= 2);
  await page.evaluate(() => window.__h.ref('b').setVolume(0.9));
  const volumes = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => [v.volume, v.playbackRate]));
  expect(volumes).toEqual([
    [0.2, 1.5],
    [0.9, 1],
  ]);
  expect((await page.evaluate(() => window.__h.ref('b').getState().playbackRates))).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  await page.evaluate(() => window.__h.unmount('b'));
  expect(await page.evaluate(() => document.querySelectorAll('video').length)).toBe(1);
});

test('MP4 quality variants: only the selected file loads; switching via the Artplayer menu keeps time, playing state, rate, volume and captions', async ({ page }) => {
  await mount(page, {
    source: { id: 'movie-1', type: 'mp4', variants: mp4Variants() },
    defaultQuality: '360p',
    subtitles: SUBS(),
    defaultSubtitleLanguage: 'en',
    network: { crossOrigin: 'anonymous' },
  });
  await waitForReady(page);
  await page.evaluate(() => {
    window.__h.ref().setPlaybackRate(1.5);
    window.__h.ref().setVolume(0.4);
    return window.__h.ref().play();
  });
  await waitForTime(page, 3);
  const before = await videoInfo(page);
  await selectInSettings(page, 'Quality', '540p');
  await page.waitForFunction(() => (document.querySelector('#app video') as HTMLVideoElement).currentSrc.includes('540p'));
  await page.waitForFunction(() => !(document.querySelector('#app video') as HTMLVideoElement).paused);
  const after = await videoInfo(page);
  expect(after.time).toBeGreaterThanOrEqual(before.time - 0.25);
  expect(after.time - before.time).toBeLessThan(2);
  expect(after.rate).toBe(1.5);
  expect(after.volume).toBeCloseTo(0.4);
  expect(after.count).toBe(1);
  const s = await state(page);
  expect(s.quality.selected).toBe('540p');
  expect(s.quality.autoAvailable).toBe(false);
  expect(s.subtitles.selected).toBe('en');
  // No Auto entry for progressive variants.
  expect(s.quality.available.map((q: { id: string }) => q.id)).toEqual(['216p', '360p', '540p']);
  const requested = new Set((await serverLog()).filter((r) => r.path.endsWith('.mp4')).map((r) => r.path));
  expect([...requested].sort()).toEqual(['/fixtures/mp4/vod-360p.mp4', '/fixtures/mp4/vod-540p.mp4']);
  // Exactly one loadStart for the quality change and no duplicate play events.
  const loads = (await events(page, 'loadStart')).map((e) => e.payload.reason);
  expect(loads).toEqual(['initial', 'quality']);
  expect((await events(page, 'play')).length).toBe(1);
});

test('paused MP4 quality switch stays paused at the same position; rapid selections: last wins', async ({ page }) => {
  await mount(page, { source: { id: 'movie-2', type: 'mp4', variants: mp4Variants() }, defaultQuality: '216p' });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().seekTo(7.5));
  const before = await videoInfo(page);
  await page.evaluate(() => {
    const ref = window.__h.ref();
    void ref.setQuality('360p');
    void ref.setQuality('540p');
    return ref.setQuality('360p');
  });
  await page.waitForFunction(() => (document.querySelector('#app video') as HTMLVideoElement).currentSrc.includes('360p') && (document.querySelector('#app video') as HTMLVideoElement).readyState >= 1);
  await page.waitForTimeout(300);
  const after = await videoInfo(page);
  expect(after.paused).toBe(true);
  expect(Math.abs(after.time - before.time)).toBeLessThan(0.15);
  expect((await state(page)).quality.selected).toBe('360p');
});

test('failed variant switch falls back to the previous variant at the same position', async ({ page }) => {
  const variants = [...mp4Variants(['216p', '360p']), { id: 'broken', label: 'Broken', height: 720, src: `${BASE}/fixtures/broken/not-a-video.mp4` }];
  await mount(page, { source: { id: 'movie-3', type: 'mp4', variants }, defaultQuality: '360p', network: { fatalRetryLimit: 0 } });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().seekTo(4));
  await page.evaluate(() => window.__h.ref().setQuality('broken'));
  await page.waitForFunction(() => window.__h.ref().getState().quality.selected === '360p' && (document.querySelector('#app video') as HTMLVideoElement).readyState >= 1, null, { timeout: 15000 });
  const s = await state(page);
  expect(s.status).toBe('ready');
  expect(Math.abs((await videoInfo(page)).time - 4)).toBeLessThan(0.3);
  const errs = await events(page, 'error');
  expect(errs.some((e) => e.payload.details?.qualityFallback === '360p')).toBe(true);
});

for (const [protocol, path] of [
  ['HLS', '/fixtures/hls/master.m3u8'],
  ['DASH', '/fixtures/dash/manifest.mpd'],
] as const) {
  test(`${protocol} VOD through Shaka: manifest qualities, Auto/manual via UI, audio + subtitles`, async ({ page }) => {
    await mount(page, { source: { src: `${BASE}${path}` } });
    await waitForReady(page);
    const s = await state(page);
    expect(s.engine).toBe('shaka');
    expect(s.quality.autoAvailable).toBe(true);
    expect(s.quality.available.map((q: { label: string }) => q.label)).toEqual(['540p', '360p', '216p']);
    expect(s.audio.available.map((a: { label: string }) => a.label)).toEqual(['English', 'Mongolian']);
    expect(s.subtitles.available.map((t: { label: string; origin: string }) => `${t.label}:${t.origin}`)).toEqual(['English:manifest', 'Mongolian:manifest']);
    expect(s.subtitles.selected).toBeNull();
    await page.evaluate(() => window.__h.ref().play());
    await waitForTime(page, 1);
    await selectInSettings(page, 'Quality', '216p');
    await page.waitForFunction(() => window.__h.ref().getState().quality.effective?.height === 216, null, { timeout: 15000 });
    expect((await state(page)).quality.selected).toMatch(/^v384x216/);
    await selectInSettings(page, 'Quality', 'Auto');
    expect((await state(page)).quality.selected).toBe('auto');
    await selectInSettings(page, 'Audio', 'Mongolian');
    await page.waitForFunction(() => window.__h.ref().getState().audio.available.find((a: { active: boolean }) => a.active)?.label === 'Mongolian');
    await selectInSettings(page, 'Subtitles', 'English');
    await expect(page.locator('.rsp-text-layer .shaka-text-container')).toContainText('EN cue', { timeout: 10000 });
    // Selecting a video rendition keeps the chosen audio language.
    await page.evaluate(() => {
      const q = window.__h.ref().getQualities().find((x: { height: number }) => x.height === 360);
      return window.__h.ref().setQuality(q.id);
    });
    await page.waitForTimeout(1000);
    const after = await state(page);
    expect(after.audio.available.find((a: { active: boolean }) => a.active).label).toBe('Mongolian');
    expect(after.subtitles.selected).not.toBeNull();
    // Off stays off across a quality change and is not rendered twice natively.
    await selectInSettings(page, 'Subtitles', 'Off');
    await page.evaluate(() => window.__h.ref().setQuality('auto'));
    await page.waitForTimeout(1500);
    const off = await page.evaluate(() => ({
      selected: window.__h.ref().getState().subtitles.selected,
      shown: document.querySelector('.rsp-text-layer .shaka-text-container')?.textContent ?? '',
      native: [...(document.querySelector('#app video') as HTMLVideoElement).textTracks].filter((t) => t.mode === 'showing').length,
    }));
    expect(off).toEqual({ selected: null, shown: '', native: 0 });
  });
}

test('controlled volume: user change emits the callback and reverts unless the host updates the prop', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, volume: 0.5 });
  await waitForReady(page);
  await page.evaluate(() => window.__h.clearEvents());
  // Simulate the vendor UI changing the element directly.
  await page.evaluate(() => {
    (document.querySelector('#app video') as HTMLVideoElement).volume = 0.9;
  });
  const ev = await waitForEvent(page, 'volumeChange');
  expect(ev.payload).toBeCloseTo(0.9);
  await page.waitForFunction(() => Math.abs((document.querySelector('#app video') as HTMLVideoElement).volume - 0.5) < 1e-6);
  // Imperative setter is a request in controlled mode.
  await page.evaluate(() => window.__h.ref().setVolume(0.3));
  expect((await events(page, 'volumeChange')).at(-1)!.payload).toBeCloseTo(0.3);
  await page.waitForTimeout(100);
  expect((await videoInfo(page)).volume).toBeCloseTo(0.5);
  // Host accepts by updating the prop.
  await page.evaluate(() => window.__h.update({ volume: 0.3 }));
  expect((await videoInfo(page)).volume).toBeCloseTo(0.3);
  const count = (await events(page, 'volumeChange')).length;
  await page.evaluate(() => window.__h.rerender(5));
  expect((await events(page, 'volumeChange')).length).toBe(count);
});

test('controlled playbackRate and clamping to the configured rate range', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, playbackRates: [0.5, 1, 1.5] });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().setPlaybackRate(3));
  expect((await videoInfo(page)).rate).toBe(1.5);
  await page.evaluate(() => window.__h.update({ playbackRate: 1 }));
  expect((await videoInfo(page)).rate).toBe(1);
  await page.evaluate(() => window.__h.ref().setPlaybackRate(0.5));
  expect((await events(page, 'playbackRateChange')).at(-1)!.payload).toBe(0.5);
  await page.waitForTimeout(100);
  expect((await videoInfo(page)).rate).toBe(1);
});
