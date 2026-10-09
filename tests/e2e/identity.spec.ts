import { expect, test } from '@playwright/test';
import { BASE, events, mount, mp4Variants, openHarness, resetLog, serverLog, state, SUBS, videoInfo, waitForEvent, waitForReady, waitForTime } from './helpers';

const future = () => Date.now() + 10 * 60_000;
const preroll = { enabled: true, items: [{ id: 'pre', type: 'text', text: 'Preroll', duration: 1, timing: { placement: 'preroll' } }] };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog();
});

test('repeated rerenders with new inline objects and new callbacks cause no reloads, refetches or duplicate ads', async ({ page }) => {
  await mount(page, {
    source: { id: 'movie', type: 'mp4', variants: mp4Variants() },
    subtitles: SUBS(),
    defaultSubtitleLanguage: 'en',
    network: { crossOrigin: 'anonymous' },
    ads: preroll,
    streaming: { bufferingGoal: 20 },
    subtitleStyle: { fontSize: '22px' },
  });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adComplete');
  await waitForTime(page, 1);
  const logBefore = (await serverLog()).length;
  const loadsBefore = (await events(page, 'loadStart')).length;
  await page.evaluate(() => window.__h.rerender(40));
  await page.waitForTimeout(1000);
  expect((await events(page, 'loadStart')).length).toBe(loadsBefore);
  expect((await events(page, 'adStart')).length).toBe(1);
  expect((await events(page, 'adBreakStart')).length).toBe(1);
  const newRequests = (await serverLog()).slice(logBefore).filter((r) => r.path.endsWith('.vtt') || r.path.endsWith('.mp4') && !r.range);
  expect(newRequests).toEqual([]);
  expect((await videoInfo(page)).paused).toBe(false);
});

test('same id + revision with a re-signed URL refreshes the transport but keeps the session, position and completed ads', async ({ page }) => {
  const src = (exp: number, sig: string) => `${BASE}/signed/mp4/vod-360p.mp4?exp=${exp}&sig=${sig}`;
  await mount(page, { source: { id: 'signed', revision: 1, src: src(future(), 'a'), type: 'mp4' }, ads: preroll });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adComplete');
  await waitForTime(page, 3);
  const sessionBefore = (await state(page)).contentSessionId;
  const before = await videoInfo(page);
  await page.evaluate((url) => window.__h.update({ source: { id: 'signed', revision: 1, src: url, type: 'mp4' } }), src(future(), 'b'));
  const refresh = await waitForEvent(page, 'loadStart', 10_000, 2);
  expect(refresh.payload.reason).toBe('refresh');
  await page.waitForFunction(() => (document.querySelector('#app video') as HTMLVideoElement).currentSrc.includes('sig=b'));
  await page.waitForFunction(() => !(document.querySelector('#app video') as HTMLVideoElement).paused);
  const after = await videoInfo(page);
  expect(after.time).toBeGreaterThanOrEqual(before.time - 0.3);
  expect((await state(page)).contentSessionId).toBe(sessionBefore);
  expect((await events(page, 'adStart')).length).toBe(1);
  expect((await events(page, 'ready')).length).toBe(1);
});

test('a changed revision or id starts a new content session from the beginning and re-arms prerolls', async ({ page }) => {
  await mount(page, { source: { id: 'a', revision: 1, src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, ads: preroll });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adComplete');
  await waitForTime(page, 2);
  const s1 = (await state(page)).contentSessionId;
  await page.evaluate((base) => window.__h.update({ source: { id: 'a', revision: 2, src: `${base}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' } }), BASE);
  await waitForEvent(page, 'ready', 10_000, 2);
  const s2 = await state(page);
  expect(s2.contentSessionId).not.toBe(s1);
  expect(s2.currentTime).toBeLessThan(0.5);
  expect((await events(page, 'loadStart')).at(-1)!.payload.reason).toBe('initial');
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart', 10_000, 2);
});

test('without an id, a genuinely changed URL is new content', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' } });
  await waitForReady(page);
  const s1 = (await state(page)).contentSessionId;
  await page.evaluate((base) => window.__h.update({ source: { src: `${base}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } }), BASE);
  await waitForEvent(page, 'ready', 10_000, 2);
  expect((await state(page)).contentSessionId).not.toBe(s1);
});

test('React Strict Mode: one video, one Artplayer, one Shaka engine, one ready event', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/hls/master.m3u8` } }, { strict: true });
  await waitForReady(page);
  await page.waitForTimeout(500);
  const counts = await page.evaluate(() => ({
    videos: document.querySelectorAll('#app video').length,
    players: document.querySelectorAll('#app .art-video-player').length,
    textLayers: document.querySelectorAll('#app .rsp-text-layer').length,
  }));
  expect(counts).toEqual({ videos: 1, players: 1, textLayers: 1 });
  expect((await events(page, 'ready')).length).toBe(1);
  expect((await events(page, 'loadStart')).filter((e) => e.payload.reason === 'initial').length).toBe(1);
  const manifests = (await serverLog()).filter((r) => r.path.endsWith('master.m3u8'));
  expect(manifests.length).toBe(1);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
});

test('rapid source replacement: only the last source plays; stale loads do not emit ready', async ({ page }) => {
  await mount(page, { source: { id: 'one', src: `${BASE}/fixtures/hls/master.m3u8` } });
  await page.evaluate((base) => {
    window.__h.update({ source: { id: 'two', src: `${base}/fixtures/dash/manifest.mpd` } });
    window.__h.update({ source: { id: 'three', src: `${base}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } });
  }, BASE);
  await waitForReady(page);
  await page.waitForTimeout(1500);
  const ready = await events(page, 'ready');
  expect(ready).toHaveLength(1);
  expect(ready[0]!.payload.engine).toBe('native');
  const s = await state(page);
  expect(ready[0]!.ctx.contentSessionId).toBe(s.contentSessionId);
  expect((await videoInfo(page)).src).toContain('vod-216p.mp4');
  expect((await videoInfo(page)).count).toBe(1);
});

test('unmount during load leaves nothing behind and raises no errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mount(page, { source: { src: `${BASE}/slow/1500/hls/master.m3u8`, type: 'hls' } });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__h.unmount());
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => document.querySelectorAll('video').length)).toBe(0);
  expect(pageErrors).toEqual([]);
  const fatal = (await events(page, 'error')).filter((e) => e.payload.fatal);
  expect(fatal).toEqual([]);
  // The destroy event was delivered before listeners were removed.
  expect((await events(page, 'destroy')).length).toBe(1);
});

test('equivalent subtitle and variant arrays are not reloaded; a real subtitle change adds only the new track', async ({ page }) => {
  await mount(page, { source: { id: 'm', type: 'mp4', variants: mp4Variants() }, subtitles: SUBS(), defaultSubtitleTrack: 'en', network: { crossOrigin: 'anonymous' } });
  await waitForReady(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__h.rerender(10));
  await page.waitForTimeout(500);
  const vtt = (await serverLog()).filter((r) => r.path.endsWith('.vtt'));
  expect(vtt.map((r) => r.path)).toEqual(['/fixtures/subs/en.vtt']);
  await page.evaluate((base) => window.__h.update({ subtitles: [...window.__h.props().subtitles, { id: 'hostile', src: `${base}/fixtures/subs/hostile.vtt`, label: 'Hostile', language: 'en' }] }), BASE);
  await page.waitForTimeout(300);
  const tracks = await page.evaluate(() => [...document.querySelectorAll('#app video track')].map((t) => (t as HTMLTrackElement).dataset.rspId));
  expect(tracks).toEqual(['en', 'mn', 'hostile']);
  expect((await state(page)).subtitles.selected).toBe('en');
  // Removing a track removes its element; selection by stable id is kept.
  await page.evaluate(() => window.__h.update({ subtitles: window.__h.props().subtitles.filter((t: { id: string }) => t.id !== 'mn') }));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => [...document.querySelectorAll('#app video track')].map((t) => (t as HTMLTrackElement).dataset.rspId));
  expect(after).toEqual(['en', 'hostile']);
});

test('fit and layout changes do not reload or reset playback', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/portrait.mp4`, type: 'mp4' }, layout: 'reel' });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
  for (const fit of ['cover', 'fill', 'none', 'scale-down', 'contain']) {
    await page.evaluate((fit) => window.__h.update({ fit, objectPosition: '50% 20%' }), fit);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#app video')!).objectFit)).toBe(fit);
  }
  await page.evaluate(() => window.__h.update({ aspectRatio: '3 / 4' }));
  expect((await events(page, 'loadStart')).length).toBe(1);
  expect((await videoInfo(page)).paused).toBe(false);
});

test('progressInterval changes apply at runtime without a reload', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, progressInterval: 1000 });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 0.5);
  await page.evaluate(() => window.__h.update({ progressInterval: 200 }));
  const before = (await events(page, 'progress')).length;
  await page.waitForTimeout(1300);
  const during = (await events(page, 'progress')).length - before;
  expect(during).toBeGreaterThanOrEqual(5);
  expect((await events(page, 'loadStart')).length).toBe(1);
});

test('new callback identities with equal values are adopted (no stale closures) without a reload', async ({ page }) => {
  await resetLog();
  await page.evaluate((base) => {
    const make = (tag: string) => ({
      source: { id: 'hooks', src: `${base}/fixtures/hls/master.m3u8`, type: 'hls' },
      network: { onRequest: (r: { headers: Record<string, string> }) => void (r.headers['X-Test-Header'] = tag) },
    });
    (window as unknown as { __make: typeof make }).__make = make;
    window.__h.mount(make('one'));
  }, BASE);
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
  await page.evaluate(() => window.__h.update((window as unknown as { __make(tag: string): Record<string, unknown> }).__make('two')));
  await resetLog();
  await waitForTime(page, 5);
  const tags = new Set((await serverLog()).filter((r) => r.path.includes('/fixtures/hls/')).map((r) => r.testHeader));
  expect([...tags]).toEqual(['two']);
  expect((await events(page, 'loadStart')).length).toBe(1);
});

test('a viewer loop toggle survives unrelated rerenders and yields to a loop prop change', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' }, loop: false });
  await waitForReady(page);
  const box = (await page.locator('#app .rsp-root').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3, { button: 'right' });
  await page.locator('.art-contextmenu', { hasText: 'Loop' }).click();
  expect(await page.evaluate(() => (document.querySelector('#app video') as HTMLVideoElement).loop)).toBe(true);
  await page.evaluate(() => window.__h.rerender());
  await page.evaluate(() => window.__h.update({ title: 'Unrelated change' }));
  expect(await page.evaluate(() => (document.querySelector('#app video') as HTMLVideoElement).loop)).toBe(true);
  await page.evaluate(() => window.__h.update({ loop: true }));
  await page.evaluate(() => window.__h.update({ loop: false }));
  expect(await page.evaluate(() => (document.querySelector('#app video') as HTMLVideoElement).loop)).toBe(false);
});
