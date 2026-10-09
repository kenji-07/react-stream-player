import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, events, mount, openHarness, state, videoInfo, waitForReady, waitForTime } from './helpers';

// Cast sender logic against a deterministic fake CAF SDK (tests/e2e/fake-cast.js)
// served in place of cast_sender.js. Real devices and receivers stay
// externally unverified (docs/release-checklist.md).
const FAKE_CAST = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-cast.js'), 'utf8');

async function useFakeCast(page: Page): Promise<string[]> {
  const urls: string[] = [];
  await page.route('https://www.gstatic.com/cv/js/sender/**', (route) => {
    urls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_CAST });
  });
  return urls;
}

const castLog = (page: Page) => page.evaluate(() => (window as unknown as { __castLog: { options: Record<string, unknown> | null; loads: Record<string, unknown>[]; ended: number } }).__castLog);

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test('cast disabled: no SDK request, no control, startCasting rejects', async ({ page }) => {
  const urls = await useFakeCast(page);
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } });
  await waitForReady(page);
  expect(await page.evaluate(() => window.__h.ref().startCasting().then(() => 'ok', (e: { code: string }) => e.code))).toBe('cast-unavailable');
  await expect(page.locator('#app .rsp-cast')).toBeHidden();
  expect(urls).toEqual([]);
  expect((await page.evaluate(() => window.__h.ref().getCapabilities())).cast).toEqual({ supported: false, reason: 'disabled-by-option' });
});

test('casting hands the current position to the receiver, pauses locally and resumes at the remote position', async ({ page }) => {
  const urls = await useFakeCast(page);
  await mount(page, {
    source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' },
    cast: { enabled: true, receiverApplicationId: 'ABCDEF12' },
    nonce: 'cast-nonce',
  });
  await waitForReady(page);
  expect(urls).toHaveLength(1);
  expect(await page.evaluate(() => document.querySelector('script[src*="cast_sender"]')?.getAttribute('nonce') ?? (document.querySelector('script[src*="cast_sender"]') as HTMLScriptElement | null)?.nonce)).toBe('cast-nonce');
  await expect(page.locator('#app .rsp-cast')).toBeVisible();
  expect((await castLog(page)).options).toMatchObject({ receiverApplicationId: 'ABCDEF12' });

  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1.5);
  await page.locator('#app .rsp-cast').click();
  await page.waitForFunction(() => window.__h.ref().getState().cast.status === 'connected');
  const load = (await castLog(page)).loads[0]!;
  expect(load.contentId).toBe(`${BASE}/fixtures/mp4/vod-360p.mp4`);
  expect(load.contentType).toBe('video/mp4');
  expect(load.currentTime as number).toBeGreaterThan(1);
  expect(load.autoplay).toBe(true);
  expect(load.hasCustomData).toBe(false);
  expect((await videoInfo(page)).paused).toBe(true);
  expect(await page.locator('#app .rsp-cast').getAttribute('aria-pressed')).toBe('true');
  expect((await events(page, 'castStateChange')).at(-1)!.payload).toEqual({ status: 'connected', deviceName: 'Fake TV' });

  // The receiver plays on to 7 s; stopping resumes locally from there.
  await page.evaluate(() => (window as unknown as { __castRemote(t: number, paused: boolean): void }).__castRemote(7, false));
  await page.evaluate(() => window.__h.ref().stopCasting());
  await page.waitForFunction(() => window.__h.ref().getState().cast.status === 'available');
  await waitForTime(page, 7.2);
  expect((await videoInfo(page)).paused).toBe(false);
  expect((await castLog(page)).ended).toBe(1);
  expect((await events(page, 'loadStart')).length).toBe(1);
});

const rejections: [string, Record<string, unknown>, string][] = [
  ['DRM without a custom receiver', { source: { src: `${BASE}/fixtures/dash-clearkey/manifest.mpd`, type: 'dash' }, drm: { keySystems: { 'org.w3.clearkey': { licenseUrl: `${BASE}/license/clearkey` } } } }, 'drm-requires-custom-receiver'],
  ['credential rules without a custom receiver', { source: { src: `${BASE}/fixtures/hls/master.m3u8`, type: 'hls' }, network: { credentials: [{ origins: [BASE], headers: { Authorization: 'Bearer x' } }] } }, 'auth-requires-custom-receiver'],
  ['pending direct ads', { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' }, ads: { items: [{ id: 'mid', type: 'text', text: 'Ad', duration: 2, timing: { placement: 'midroll', at: 15 } }] } }, 'ads-not-supported-remotely'],
];
for (const [name, props, reason] of rejections) {
  test(`casting is rejected with a capability reason: ${name}`, async ({ page }) => {
    await useFakeCast(page);
    await mount(page, { ...props, cast: { enabled: true } });
    await waitForReady(page);
    await page.waitForFunction(() => window.__h.ref().getState().cast.status === 'available');
    const result = await page.evaluate(() => window.__h.ref().startCasting().then(() => null, (e: { code: string; details: Record<string, unknown> }) => ({ code: e.code, reason: e.details.reason })));
    expect(result).toEqual({ code: 'cast-rejected', reason });
    expect((await castLog(page)).loads).toEqual([]);
    expect((await state(page)).cast.status).toBe('available');
  });
}

test('a Blob source is never cast', async ({ page }) => {
  await useFakeCast(page);
  await page.evaluate(async (base) => {
    const blob = await window.__h.fetchBlob(`${base}/fixtures/mp4/vod-216p.mp4`);
    window.__h.mount({ source: { src: blob, type: 'mp4' }, cast: { enabled: true } });
  }, BASE);
  await waitForReady(page);
  await page.waitForFunction(() => window.__h.ref().getState().cast.status === 'available');
  const result = await page.evaluate(() => window.__h.ref().startCasting().then(() => null, (e: { code: string; details: Record<string, unknown> }) => ({ code: e.code, reason: e.details.reason })));
  expect(result).toEqual({ code: 'cast-rejected', reason: 'blob-not-castable' });
});
