import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { BASE, events, mount, openHarness, resetLog, serverLog, state, videoInfo, waitForEvent, waitForReady, waitForTime } from './helpers';

// The real IMA SDK cannot complete an ad request in this CI environment (its
// runtime dependencies on s0.2mdn.net / googlesyndication are not reachable),
// so the documented SDK URL is fulfilled with a deterministic fake that
// implements the IMA API surface the package uses. Real-SDK playback is
// tracked as externally unverified in docs/release-checklist.md.
const FAKE_IMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-ima.js'), 'utf8');

async function useFakeIma(page: Page): Promise<string[]> {
  const scriptUrls: string[] = [];
  await page.route('https://imasdk.googleapis.com/js/sdkloader/**', (route) => {
    scriptUrls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_IMA });
  });
  return scriptUrls;
}

const directItems = [
  { id: 'suppressed-image', type: 'image', src: `${BASE}/fixtures/ads/banner.png`, alt: 'Suppressed direct creative', timing: { placement: 'overlay', at: 0 }, duration: 10 },
  { id: 'suppressed-pre', type: 'text', text: 'must not show', duration: 3, timing: { placement: 'preroll' } },
];

function content(vast: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { source: { id: 'content', src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, ads: { enabled: true, vast, items: directItems }, nonce: 'test-nonce', ...extra };
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog();
});

test('VAST preroll through IMA: content waits, events are bridged, content starts once at 0; direct items untouched', async ({ page }) => {
  const scripts = await useFakeIma(page);
  await mount(page, content({ adTagUrl: `${BASE}/vast/inline.xml?scenario=success&cues=0&adDuration=1.5`, requestTimeoutMs: 4000 }));
  await waitForReady(page);
  await page.locator('#app .rsp-root').click({ position: { x: 20, y: 20 } });
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart');
  expect((await videoInfo(page)).paused).toBe(true);
  await expect(page.locator('.fake-ima-ad')).toHaveText('FAKE IMA AD 0');
  const start = (await events(page, 'adStart'))[0]!.payload;
  expect(start).toMatchObject({ pipeline: 'vast', type: 'vast', placement: 'preroll', linear: true, duration: 1.5, label: 'Fake <b>ad</b>' });
  await waitForEvent(page, 'adBreakEnd');
  await waitForTime(page, 0.3);
  const names = (await events(page)).map((e) => e.name).filter((n) => n.startsWith('ad') && n !== 'adProgress');
  expect(names).toEqual(['adBreakStart', 'adStart', 'adComplete', 'adBreakEnd']);
  expect((await events(page, 'play')).length).toBe(1);
  // Script from the documented URL with the CSP nonce.
  expect(scripts).toEqual(['https://imasdk.googleapis.com/js/sdkloader/ima3.js']);
  expect(await page.evaluate(() => (document.querySelector('script[src*="imasdk"]') as HTMLScriptElement).nonce)).toBe('test-nonce');
  const calls = await page.evaluate(() => (window as unknown as { __imaCalls: unknown[][] }).__imaCalls);
  expect(calls.find((c) => c[0] === 'AdDisplayContainer')).toEqual(['AdDisplayContainer', true, false]); // no custom playback element
  expect(calls.some((c) => c[0] === 'initialize')).toBe(true);
  expect(calls.find((c) => c[0] === 'requestAds')?.[2]).toBe(4000);
  // Precedence: direct items were neither requested nor rendered.
  expect((await serverLog()).filter((r) => r.path.includes('/fixtures/ads/'))).toEqual([]);
  expect(await page.locator('.rsp-ad').count()).toBe(0);
});

for (const [scenario, code] of [
  ['nofill', 'ad-no-fill'],
  ['malformed', 'ad-vast-error'],
  ['timeout', 'ad-load-timeout'],
] as const) {
  test(`VAST ${scenario}: emits ${code}, content plays, and direct items never fall back`, async ({ page }) => {
    await useFakeIma(page);
    await mount(page, content({ adTagUrl: `${BASE}/vast/inline.xml?scenario=${scenario}`, requestTimeoutMs: 800 }));
    await waitForReady(page);
    await page.evaluate(() => window.__h.ref().play());
    await waitForEvent(page, 'adError');
    await waitForTime(page, 1);
    expect((await events(page, 'adError')).map((e) => e.payload.code)).toEqual([code]);
    expect((await events(page, 'adStart')).length).toBe(0);
    expect(await page.locator('.rsp-ad').count()).toBe(0);
    expect((await serverLog()).filter((r) => r.path.includes('/fixtures/ads/'))).toEqual([]);
    expect((await events(page, 'adError'))[0]!.ctx.contentSessionId).toBe((await state(page)).contentSessionId);
  });
}

test('IMA midroll: content pauses at the cue and is restored exactly once; manager error mid-break restores once', async ({ page }) => {
  await useFakeIma(page);
  await mount(page, content({ adTagUrl: `${BASE}/vast/inline.xml?scenario=success&cues=2,5&adDuration=1` }));
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adBreakStart', 10_000);
  const during = await videoInfo(page);
  expect(during.paused).toBe(true);
  await waitForEvent(page, 'adBreakEnd', 10_000);
  await page.waitForFunction(() => !(document.querySelector('#app video.rsp-video') as HTMLVideoElement).paused);
  expect(Math.abs((await videoInfo(page)).time - during.time)).toBeLessThan(0.6);
  await waitForEvent(page, 'adBreakEnd', 15_000, 2);
  expect((await events(page, 'adBreakStart')).map((e) => e.payload.placement)).toEqual(['midroll', 'midroll']);
  expect((await events(page, 'pause')).length).toBe(0);
});

test('IMA ad error during a break restores content once and never falls back to direct ads', async ({ page }) => {
  await useFakeIma(page);
  await mount(page, content({ adTagUrl: `${BASE}/vast/inline.xml?scenario=managererror&cues=0` }));
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adError', 10_000);
  await waitForTime(page, 0.5);
  expect((await events(page, 'adBreakEnd')).map((e) => e.payload.reason)).toEqual(['error']);
  expect((await events(page, 'adError'))[0]!.payload.code).toBe('ad-media-error');
  expect(await page.locator('.rsp-ad').count()).toBe(0);
});

test('IMA postroll: ended is emitted once after the postroll', async ({ page }) => {
  await useFakeIma(page);
  await mount(page, content({ adTagUrl: `${BASE}/vast/inline.xml?scenario=success&cues=-1&adDuration=1` }));
  await waitForReady(page);
  await page.evaluate(async () => {
    await window.__h.ref().play();
    await window.__h.ref().seekTo(18.8);
  });
  await waitForEvent(page, 'ended', 15_000);
  const names = (await events(page)).map((e) => e.name).filter((n) => ['adBreakStart', 'adBreakEnd', 'ended'].includes(n));
  expect(names).toEqual(['adBreakStart', 'adBreakEnd', 'ended']);
});

test('unchanged inline VAST config does not re-request ads; a changed tag starts a new IMA request', async ({ page }) => {
  await useFakeIma(page);
  await mount(page, content({ adTagUrl: `${BASE}/vast/inline.xml?scenario=success&cues=9` }));
  await waitForReady(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__h.rerender(10));
  await page.waitForTimeout(300);
  const requests = () => page.evaluate(() => (window as unknown as { __imaCalls: unknown[][] }).__imaCalls.filter((c) => c[0] === 'requestAds').length);
  expect(await requests()).toBe(1);
  await page.evaluate((base) => window.__h.update({ ads: { ...window.__h.props().ads, vast: { adTagUrl: `${base}/vast/inline.xml?scenario=success&cues=12` } } }), BASE);
  await page.waitForTimeout(500);
  expect(await requests()).toBe(2);
});
