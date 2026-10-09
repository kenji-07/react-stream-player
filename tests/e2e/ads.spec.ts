import { expect, test } from '@playwright/test';
import { BASE, events, mount, openHarness, resetLog, serverLog, state, videoInfo, waitForEvent, waitForReady, waitForTime } from './helpers';

const content = (extra: Record<string, unknown> = {}) => ({ source: { id: 'content', src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, ...extra });

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog();
});

test('image preroll: content waits, skip becomes available after skipAfter, content starts at 0 exactly once', async ({ page }) => {
  await mount(
    page,
    content({
      ads: {
        items: [
          {
            id: 'intro-image',
            type: 'image',
            src: `${BASE}/fixtures/ads/banner.png`,
            alt: 'Intro promotion',
            timing: { placement: 'preroll' },
            duration: 10,
            skipAfter: 1,
            clickThroughUrl: 'https://example.com/offer',
          },
        ],
      },
    }),
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart');
  const v = await videoInfo(page);
  expect(v.paused).toBe(true);
  expect(v.time).toBe(0);
  const skip = page.locator('.rsp-ad-skip');
  await expect(skip).toBeDisabled();
  await expect(page.locator('.rsp-ad-image')).toHaveAttribute('alt', 'Intro promotion');
  await expect(page.locator('.rsp-ad-link')).toHaveAttribute('href', 'https://example.com/offer');
  await expect(page.locator('.rsp-ad-link')).toHaveAttribute('rel', /noopener/);
  expect((await state(page)).ad.active).toBe(true);
  // Content controls are not operable during the linear ad.
  await expect(page.locator('#app .rsp-controls')).toBeHidden();
  await expect(page.locator('#app .rsp-controls')).toHaveAttribute('inert', '');
  // A right click during the ad gets the browser's own menu, not the player's.
  await page.locator('#app .rsp-ad-linear').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('#app .rsp-context-menu')).toBeHidden();
  await expect(skip).toBeEnabled({ timeout: 4000 });
  await skip.click();
  await waitForEvent(page, 'adSkip');
  await waitForEvent(page, 'adBreakEnd');
  await waitForTime(page, 0.5);
  expect((await events(page, 'play')).length).toBe(1);
  expect((await events(page, 'adBreakEnd'))[0]!.payload).toMatchObject({ placement: 'preroll', pipeline: 'direct', reason: 'skipped' });
  expect((await serverLog()).filter((r) => r.path.endsWith('banner.png')).length).toBe(1);
  expect((await state(page)).ad.active).toBe(false);
});

test('text overlay runs alongside content; its clock pauses while content is paused', async ({ page }) => {
  await mount(
    page,
    content({
      ads: {
        items: [
          {
            id: 'text-offer',
            type: 'text',
            text: 'Special offer — click to learn more',
            timing: { placement: 'overlay', at: 1 },
            duration: 2,
            skipAfter: 5,
            style: { color: '#fff', backgroundColor: '#ff0000' },
            clickThroughUrl: '/offer',
          },
        ],
      },
    }),
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart');
  await expect(page.locator('.rsp-ad-overlay .rsp-ad-text')).toHaveText('Special offer — click to learn more');
  expect(await page.locator('.rsp-ad-overlay .rsp-ad-text').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)');
  expect((await videoInfo(page)).paused).toBe(false);
  await page.evaluate(() => window.__h.ref().pause());
  const p1 = (await events(page, 'adProgress')).at(-1)!.payload.currentTime;
  await page.waitForTimeout(1200);
  const p2 = (await events(page, 'adProgress')).at(-1)!.payload.currentTime;
  expect(p2 - p1).toBeLessThan(0.3);
  await page.locator('.rsp-ad-overlay').waitFor({ state: 'visible' });
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adComplete');
  await expect(page.locator('.rsp-ad-overlay')).toHaveCount(0);
  expect((await events(page, 'adBreakStart')).length).toBe(0);
});

test('video midroll pauses content, plays in a separate element and restores content exactly once', async ({ page }) => {
  await mount(
    page,
    content({
      ads: { items: [{ id: 'mid-video', type: 'video', source: { src: `${BASE}/fixtures/ads/ad-video.mp4`, type: 'mp4' }, timing: { placement: 'midroll', at: 2 }, skipAfter: 1 }] },
    }),
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart', 15_000);
  const during = await page.evaluate(() => ({
    contentPaused: (document.querySelector('#app video.rsp-video') as HTMLVideoElement).paused,
    contentTime: (document.querySelector('#app video.rsp-video') as HTMLVideoElement).currentTime,
    adVideos: document.querySelectorAll('.rsp-ad-media-video').length,
  }));
  expect(during.contentPaused).toBe(true);
  expect(during.contentTime).toBeGreaterThanOrEqual(2);
  expect(during.contentTime).toBeLessThan(2.8);
  expect(during.adVideos).toBe(1);
  await page.locator('.rsp-ad-skip').click({ timeout: 5000 });
  await waitForEvent(page, 'adBreakEnd');
  await page.waitForFunction(() => !(document.querySelector('#app video.rsp-video') as HTMLVideoElement).paused);
  const after = await videoInfo(page);
  expect(Math.abs(after.time - during.contentTime)).toBeLessThan(0.6);
  expect(await page.locator('.rsp-ad-media-video').count()).toBe(0);
  expect((await events(page, 'adBreakEnd')).length).toBe(1);
  expect((await events(page, 'ended')).length).toBe(0);
  // Content `pause`/`play` events are not emitted for the ad break itself.
  expect((await events(page, 'pause')).length).toBe(0);
});

test('seeking past a media-time cue skips it; playing through it later runs it once; backward seeks never replay', async ({ page }) => {
  await mount(page, content({ ads: { items: [{ id: 'mid', type: 'text', text: 'Mid', duration: 1, timing: { placement: 'midroll', at: 6 } }] } }));
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 0.5);
  await page.evaluate(() => window.__h.ref().seekTo(9));
  await page.waitForTimeout(1200);
  expect((await events(page, 'adStart')).length).toBe(0);
  await page.evaluate(() => window.__h.ref().seekTo(5));
  await waitForEvent(page, 'adComplete', 10_000);
  expect((await events(page, 'adStart')).length).toBe(1);
  await page.evaluate(() => window.__h.ref().seekTo(5));
  await page.waitForFunction(() => (document.querySelector('#app video') as HTMLVideoElement).currentTime > 7, null, { timeout: 10_000 });
  expect((await events(page, 'adStart')).length).toBe(1);
});

test('postroll runs after content end and `ended` is emitted once, after the postroll', async ({ page }) => {
  await mount(page, content({ ads: { items: [{ id: 'post', type: 'text', text: 'Thanks', duration: 1, timing: { placement: 'postroll' } }] } }));
  await waitForReady(page);
  await page.evaluate(async () => {
    await window.__h.ref().play();
    await window.__h.ref().seekTo(18.5);
  });
  await waitForEvent(page, 'ended', 15_000);
  const names = (await events(page)).map((e) => e.name).filter((n) => ['adBreakStart', 'adStart', 'adComplete', 'adBreakEnd', 'ended'].includes(n));
  expect(names).toEqual(['adBreakStart', 'adStart', 'adComplete', 'adBreakEnd', 'ended']);
  await page.waitForTimeout(500);
  expect((await events(page, 'ended')).length).toBe(1);
});

test('ad load failure and timeout emit adError and content continues', async ({ page }) => {
  await mount(
    page,
    content({
      ads: {
        loadTimeoutMs: 600,
        items: [
          { id: 'missing', type: 'image', src: `${BASE}/fixtures/ads/does-not-exist.png`, alt: 'x', duration: 3, timing: { placement: 'preroll' } },
          { id: 'slow', type: 'image', src: `${BASE}/slow/3000/ads/banner.png`, alt: 'y', duration: 3, timing: { placement: 'preroll' } },
        ],
      },
    }),
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 0.5, 10_000);
  const codes = (await events(page, 'adError')).map((e) => e.payload.code);
  expect(codes).toEqual(['ad-load-error', 'ad-load-timeout']);
  expect((await events(page, 'adBreakEnd'))[0]!.payload.reason).toBe('error');
  expect(await page.locator('.rsp-ad').count()).toBe(0);
});

test('hostile ad text renders as text and unsafe click-through URLs are rejected', async ({ page }) => {
  await mount(
    page,
    content({
      ads: {
        items: [
          { id: 'x', type: 'text', text: '<img src=x onerror="window.__xss=1">Hi', duration: 2, timing: { placement: 'overlay', at: 0 }, clickThroughUrl: 'javascript:window.__xss=1' },
          { id: 'y', label: '<b>bold</b>', type: 'text', text: 'Data', duration: 1, timing: { placement: 'overlay', at: 0.2 }, clickThroughUrl: 'data:text/html,<script>window.__xss=1</script>' },
        ],
      },
    }),
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart');
  await expect(page.locator('.rsp-ad-text').first()).toHaveText('<img src=x onerror="window.__xss=1">Hi');
  expect(await page.locator('.rsp-ad img').count()).toBe(0);
  expect(await page.locator('.rsp-ad-link').count()).toBe(0);
  await waitForEvent(page, 'adStart', 10_000, 2);
  await expect(page.locator('.rsp-ad-badge').first()).toContainText('<b>bold</b>');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('VAST precedence: direct items are never validated, requested or rendered — even when the IMA SDK is blocked', async ({ page }) => {
  await page.route('**/imasdk.googleapis.com/**', (route) => route.abort());
  await mount(
    page,
    content({
      ads: {
        enabled: true,
        vast: { adTagUrl: `${BASE}/vast/inline.xml`, requestTimeoutMs: 2000, sdkLoadTimeoutMs: 3000 },
        items: [
          { id: 'suppressed-image', type: 'image', src: `${BASE}/fixtures/ads/banner.png`, alt: 'Suppressed direct creative', timing: { placement: 'overlay', at: 0 }, duration: 10 },
          { id: 'suppressed-pre', type: 'video', source: { src: `${BASE}/fixtures/ads/ad-video.mp4`, type: 'mp4' }, timing: { placement: 'preroll' } },
          { id: 'invalid', type: 'text', text: '', duration: -1, timing: { placement: 'overlay', at: -5 } },
        ],
      },
    }),
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adError', 10_000);
  await waitForTime(page, 1.5, 15_000);
  const errors = (await events(page, 'adError')).map((e) => e.payload.code);
  expect(errors).toEqual(['ad-sdk-load-failed']); // no ad-invalid-config: direct items were never validated
  const requested = (await serverLog()).map((r) => r.path);
  expect(requested.filter((p) => p.includes('/fixtures/ads/'))).toEqual([]);
  expect(await page.locator('.rsp-ad').count()).toBe(0);
  expect((await events(page, 'adStart')).length).toBe(0);
  expect((await state(page)).ad.pipeline).toBe('vast');
});

test('VAST introduced mid-session cancels visible direct creatives; removing it does not start suppressed direct ads', async ({ page }) => {
  await page.route('**/imasdk.googleapis.com/**', (route) => route.abort());
  const items = [{ id: 'banner', type: 'text', text: 'Direct overlay', duration: 30, timing: { placement: 'overlay', at: 0.5 } }];
  await mount(page, content({ ads: { items } }));
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForEvent(page, 'adStart');
  await expect(page.locator('.rsp-ad-overlay')).toHaveCount(1);
  await page.evaluate((base) => window.__h.update({ ads: { items: window.__h.props().ads.items, vast: { adTagUrl: `${base}/vast/inline.xml`, sdkLoadTimeoutMs: 2000 } } }), BASE);
  await expect(page.locator('.rsp-ad-overlay')).toHaveCount(0);
  await waitForEvent(page, 'adError');
  await page.evaluate(() => window.__h.update({ ads: { items: window.__h.props().ads.items } }));
  await page.evaluate(() => window.__h.ref().seekTo(0));
  await page.waitForTimeout(1500);
  expect(await page.locator('.rsp-ad').count()).toBe(0);
  expect((await events(page, 'adStart')).length).toBe(1);
  expect((await videoInfo(page)).paused).toBe(false);
});

test('ads.enabled=false disables every pipeline', async ({ page }) => {
  await mount(page, content({ ads: { enabled: false, vast: { adTagUrl: `${BASE}/vast/inline.xml` }, items: [{ id: 'p', type: 'text', text: 'x', duration: 1, timing: { placement: 'preroll' } }] } }));
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
  expect((await events(page, 'adStart')).length).toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('script[src*="imasdk"]').length)).toBe(0);
});
