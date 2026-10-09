import { expect, test } from '@playwright/test';
import { mount, openHarness, state, waitForReady, waitForTime } from './helpers';

// Authorized external fixtures (tests/fixtures/README.md). Each test runs a
// real playback check when its variables are set and otherwise SKIPS WITH A
// REASON. A skip never satisfies a release gate (docs/release-checklist.md).
const env = (name: string): string | undefined => process.env[name] || undefined;

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

const drm = [
  { name: 'Widevine DASH', keySystem: 'com.widevine.alpha', type: 'dash', src: 'RSP_FIXTURE_WIDEVINE_DASH_URL', license: 'RSP_FIXTURE_WIDEVINE_LICENSE_URL' },
  { name: 'PlayReady DASH', keySystem: 'com.microsoft.playready', type: 'dash', src: 'RSP_FIXTURE_PLAYREADY_DASH_URL', license: 'RSP_FIXTURE_PLAYREADY_LICENSE_URL' },
  { name: 'FairPlay HLS', keySystem: 'com.apple.fps', type: 'hls', src: 'RSP_FIXTURE_FAIRPLAY_HLS_URL', license: 'RSP_FIXTURE_FAIRPLAY_LICENSE_URL', certificate: 'RSP_FIXTURE_FAIRPLAY_CERTIFICATE_URL' },
] as const;

for (const fixture of drm) {
  test(`external DRM: ${fixture.name}`, async ({ page }) => {
    const src = env(fixture.src);
    const licenseUrl = env(fixture.license);
    test.skip(!src || !licenseUrl, `${fixture.src}/${fixture.license} not set — ${fixture.name} stays externally-unverified`);
    const supported = await page.evaluate(async (keySystem) => {
      try {
        await navigator.requestMediaKeySystemAccess(keySystem, [{ initDataTypes: ['cenc', 'sinf', 'skd'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]);
        return true;
      } catch {
        return false;
      }
    }, fixture.keySystem);
    test.skip(!supported, `${fixture.keySystem} is not available in this browser build`);
    const token = env('RSP_FIXTURE_LICENSE_TOKEN');
    const certificate = 'certificate' in fixture ? env(fixture.certificate) : undefined;
    await page.evaluate(
      ({ src, type, keySystem, licenseUrl, certificate, token }) => {
        window.__h.mount({
          source: { src, type },
          drm: {
            keySystems: { [keySystem]: { licenseUrl, ...(certificate ? { serverCertificateUrl: certificate } : {}) } },
            ...(token ? { getLicenseToken: () => token } : {}),
          },
        });
      },
      { src: src!, type: fixture.type, keySystem: fixture.keySystem, licenseUrl: licenseUrl!, certificate, token },
    );
    await waitForReady(page, 30_000);
    await page.evaluate(() => window.__h.ref().play());
    await waitForTime(page, 3, 30_000);
    expect((await state(page)).error).toBeNull();
  });
}

test('external: real IMA VAST tag plays an ad then content', async ({ page }) => {
  const adTagUrl = env('RSP_FIXTURE_IMA_VAST_URL');
  test.skip(!adTagUrl, 'RSP_FIXTURE_IMA_VAST_URL not set — real IMA playback stays externally-unverified');
  await mount(page, { source: { src: '/fixtures/mp4/vod-360p.mp4', type: 'mp4' }, ads: { vast: { adTagUrl } } });
  await waitForReady(page);
  await page.locator('#app .rsp-big-play').click();
  await page.waitForFunction(() => window.__h.events.some((e: { name: string }) => e.name === 'adStart' || e.name === 'adError'), null, { timeout: 30_000 });
  const adError = await page.evaluate(() => window.__h.events.find((e: { name: string }) => e.name === 'adError')?.payload ?? null);
  test.skip(adError !== null, `IMA reported ${JSON.stringify(adError)} (network/ad-server availability) — not counted as evidence`);
  await waitForTime(page, 1, 60_000);
});

for (const [name, variable, type] of [
  ['LL-HLS', 'RSP_FIXTURE_LL_HLS_URL', 'hls'],
  ['LL-DASH', 'RSP_FIXTURE_LL_DASH_URL', 'dash'],
] as const) {
  test(`external: ${name} low-latency playback near the live edge`, async ({ page }) => {
    const src = env(variable);
    test.skip(!src, `${variable} not set — ${name} stays externally-unverified`);
    await mount(page, { source: { src, type }, streaming: { lowLatencyMode: true } });
    await waitForReady(page, 30_000);
    await page.evaluate(() => window.__h.ref().play());
    await page.waitForTimeout(10_000);
    const live = (await state(page)).live;
    expect(live.isLive).toBe(true);
    expect(live.atLiveEdge).toBe(true);
  });
}
