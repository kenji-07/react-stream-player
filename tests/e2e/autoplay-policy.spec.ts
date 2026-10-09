import { expect, test } from '@playwright/test';
import { BASE, events, mount, openHarness, videoInfo, waitForEvent, waitForReady, waitForTime } from './helpers';

// Headless Chromium does not enforce the autoplay policy here: Playwright's
// page.evaluate() runs with a user gesture, so navigator.userActivation is
// already sticky-active and unmuted play() is always allowed. Chrome's
// documented "document user activation required" rule is therefore emulated
// before any page script runs: unmuted play() rejects with NotAllowedError
// until the page has received trusted pointer/keyboard input; muted play()
// is always allowed.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let activated = false;
    const activate = (event: Event) => {
      if (event.isTrusted) activated = true;
    };
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchend']) window.addEventListener(type, activate, true);
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!this.muted && !activated) {
        return Promise.reject(new DOMException('play() failed because the user did not interact with the document first.', 'NotAllowedError'));
      }
      return original.call(this);
    };
  });
  await openHarness(page);
});

test('autoplay falls back to muted playback when allowed', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' }, autoplay: true });
  await waitForReady(page);
  await waitForTime(page, 0.5);
  const v = await videoInfo(page);
  expect(v.muted).toBe(true);
  expect((await events(page, 'autoplayBlocked'))[0]!.payload).toEqual({ mutedFallback: 'succeeded' });
  expect((await events(page, 'mutedChange')).at(-1)!.payload).toBe(true);
});

test('blocked autoplay without muted fallback waits for the viewer and does not consume the preroll', async ({ page }) => {
  await mount(page, {
    source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' },
    autoplay: { enabled: true, mutedFallback: false },
    ads: { items: [{ id: 'pre', type: 'text', text: 'Preroll', duration: 1, timing: { placement: 'preroll' } }] },
  });
  await waitForReady(page);
  await page.waitForTimeout(1500);
  expect((await events(page, 'autoplayBlocked'))[0]!.payload).toEqual({ mutedFallback: 'disabled' });
  expect((await events(page, 'adStart')).length).toBe(0);
  expect((await videoInfo(page)).paused).toBe(true);
  // The viewer presses play (real user activation): the preroll runs first.
  await page.locator('#app .art-video-player .art-state').click();
  await waitForEvent(page, 'adStart');
  await waitForEvent(page, 'adBreakEnd');
  await waitForTime(page, 0.3);
  expect((await videoInfo(page)).muted).toBe(false);
});

test('Reel autoplay is opt-in and uses the same muted fallback', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/portrait.mp4`, type: 'mp4' }, layout: 'reel' });
  await waitForReady(page);
  await page.waitForTimeout(800);
  expect((await videoInfo(page)).paused).toBe(true);
  await page.evaluate(() => window.__h.update({ source: { id: 'reel-2', src: window.__h.props().source.src, type: 'mp4' }, autoplay: true }));
  await waitForTime(page, 0.3);
  expect((await videoInfo(page)).muted).toBe(true);
});
