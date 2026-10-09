import { expect, test } from '@playwright/test';
import { BASE, events, openHarness, resetLog, serverLog, state, waitForEvent, waitForReady, waitForTime } from './helpers';

// ClearKey is a development/testing key system only. These tests verify the
// DRM integration contract (license URL, token callback, binary-safe request
// and response transforms, error mapping) — not production Widevine/PlayReady/
// FairPlay, which need authorized fixtures and real CDMs (see release checklist).
const SRC = `${BASE}/fixtures/dash-clearkey/manifest.mpd`;

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog();
  const supported = await page.evaluate(async () => {
    try {
      await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{ initDataTypes: ['keyids', 'cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="vp09.00.21.08"' }] }]);
      return true;
    } catch {
      return false;
    }
  });
  test.skip(!supported, 'ClearKey EME unavailable in this browser build');
});

test('license server flow: token header, binary request/response transforms, playback and protected capture refusal', async ({ page }) => {
  await page.evaluate(
    ({ src, base }) => {
      const calls: unknown[] = ((window as unknown as { __drmCalls: unknown[] }).__drmCalls = []);
      window.__h.mount({
        source: { id: 'protected', src, type: 'dash' },
        drm: {
          keySystems: { 'org.w3.clearkey': { licenseUrl: `${base}/license/clearkey?requireAuth=1`, headers: { 'X-Test-Header': 'license' } } },
          getLicenseToken: ({ keySystem }: { keySystem: string }) => {
            calls.push(['token', keySystem]);
            return 'test-license-token';
          },
          transformLicenseRequest: (req: { body: Uint8Array; keySystem: string }) => {
            calls.push(['request', req.keySystem, req.body instanceof Uint8Array, JSON.parse(new TextDecoder().decode(req.body)).kids]);
            return req;
          },
          transformLicenseResponse: (res: { data: Uint8Array }) => {
            calls.push(['response', res.data instanceof Uint8Array, JSON.parse(new TextDecoder().decode(res.data)).keys.length]);
            return res;
          },
        },
      });
    },
    { src: SRC, base: BASE },
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1.5);
  const calls = await page.evaluate(() => (window as unknown as { __drmCalls: unknown[] }).__drmCalls);
  expect(calls).toContainEqual(['token', 'org.w3.clearkey']);
  expect(calls).toContainEqual(['request', 'org.w3.clearkey', true, ['nrQFDeRLSAKTLifXUIPiZg']]);
  expect(calls).toContainEqual(['response', true, 1]);
  const license = (await serverLog()).filter((r) => r.path === '/license/clearkey');
  expect(license.length).toBeGreaterThan(0);
  expect(license.every((r) => r.hasAuthorization && r.testHeader === 'license')).toBe(true);
  // Segment requests never receive the license token.
  expect((await serverLog()).filter((r) => r.path.includes('/dash-clearkey/') && r.hasAuthorization)).toEqual([]);
  const capture = await page.evaluate(() =>
    window.__h
      .ref()
      .captureFrame()
      .then(() => 'resolved')
      .catch((e: { code: string }) => e.code),
  );
  expect(capture).toBe('capture-protected');
  expect((await state(page)).engine).toBe('shaka');
});

test('a rejected license request becomes a fatal, readable DRM error without leaking the URL', async ({ page }) => {
  await page.evaluate(
    ({ src, base }) =>
      window.__h.mount({
        source: { id: 'protected-denied', src, type: 'dash' },
        drm: { keySystems: { 'org.w3.clearkey': { licenseUrl: `${base}/license/clearkey?requireAuth=1&secret=SECRET123` } } },
        network: { retry: { license: { maxAttempts: 1 } } },
      }),
    { src: SRC, base: BASE },
  );
  await page.evaluate(() => window.__h.ref().play().catch(() => undefined));
  const err = await waitForEvent(page, 'statusChange', 20_000).then(async () => {
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error', null, { timeout: 20_000 });
    return (await events(page, 'error')).find((e) => e.payload.fatal)!;
  });
  expect(err.payload.category).toBe('drm');
  expect(err.payload.code).toBe('drm-license-error');
  expect(err.payload.details.httpStatus).toBe(401);
  expect(JSON.stringify(err.payload)).not.toContain('SECRET123');
  await expect(page.locator('.rsp-error')).toBeVisible();
  await expect(page.locator('.rsp-error')).not.toContainText('http');
});

test('inline ClearKey keys (development only) play without a license server', async ({ page }) => {
  await page.evaluate(
    (src) =>
      window.__h.mount({
        source: { id: 'protected-inline', src, type: 'dash' },
        drm: { keySystems: {}, clearKeys: { '9eb4050de44b4802932e27d75083e266': '166634c675823c235a4a9446fad52e4d' } },
      }),
    SRC,
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
});

test('DRM configuration with a progressive MP4 is rejected explicitly', async ({ page }) => {
  await page.evaluate(
    (base) =>
      window.__h.mount({
        source: { src: `${base}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' },
        drm: { keySystems: { 'com.widevine.alpha': { licenseUrl: 'https://license.example.com/wv' } } },
      }),
    BASE,
  );
  await page.waitForFunction(() => window.__h.ref().getState().status === 'error');
  expect((await state(page)).error.code).toBe('drm-progressive-unsupported');
});
