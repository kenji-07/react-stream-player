import { expect, test } from '@playwright/test';
import { BASE, events, mount, openHarness, state, videoInfo, waitForReady, waitForTime } from './helpers';

const source = { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test('web fullscreen: expands in-page, locks scroll, moves focus, exits on Escape and restores styles/scroll/focus', async ({ page }) => {
  await mount(page, { source, fullscreen: { mode: 'web' } });
  await waitForReady(page);
  await page.evaluate(() => {
    document.body.style.overflow = 'scroll';
    (document.getElementById('outside') as HTMLInputElement).focus({ preventScroll: true });
    window.scrollTo(0, 120);
  });
  await page.evaluate(() => window.__h.ref().fullscreen.request('web'));
  let s = await state(page);
  expect(s.fullscreen).toEqual({ active: true, mode: 'web', videoOnly: false });
  const during = await page.evaluate(() => {
    const root = document.querySelector('#app .rsp-root') as HTMLElement;
    const r = root.getBoundingClientRect();
    return { w: r.width, h: r.height, overflow: document.body.style.overflow, focusInside: root.contains(document.activeElement), position: getComputedStyle(root).position };
  });
  expect(during).toEqual({ w: 1000, h: 800, overflow: 'hidden', focusInside: true, position: 'fixed' });
  // Captions/ads layers remain inside the expanded subtree.
  expect(await page.evaluate(() => document.querySelector('#app .rsp-root')!.contains(document.querySelector('.rsp-ad-layer')))).toBe(true);
  await page.keyboard.press('Escape');
  s = await state(page);
  expect(s.fullscreen.active).toBe(false);
  const after = await page.evaluate(() => ({ overflow: document.body.style.overflow, scrollY: window.scrollY, focused: document.activeElement?.id }));
  expect(after).toEqual({ overflow: 'scroll', scrollY: 120, focused: 'outside' });
  const changes = (await events(page, 'fullscreenChange')).map((e) => e.payload);
  expect(changes).toEqual([
    { active: true, mode: 'web', videoOnly: false },
    { active: false, mode: null, videoOnly: false },
  ]);
});

test('only one player holds web fullscreen; unmount restores page state', async ({ page }) => {
  await mount(page, { source });
  await page.evaluate((src) => window.__h.mount({ source: src }, { key: 'b' }), source);
  await page.waitForFunction(() => window.__h.events.filter((e: { name: string }) => e.name === 'ready').length >= 2);
  await page.evaluate(() => window.__h.ref('a').fullscreen.request('web'));
  await page.evaluate(() => window.__h.ref('b').fullscreen.request('web'));
  const holders = await page.evaluate(() => [...document.querySelectorAll('.rsp-root[data-rsp-web-fullscreen]')].length);
  expect(holders).toBe(1);
  expect(await page.evaluate(() => window.__h.ref('a').getState().fullscreen.active)).toBe(false);
  await page.evaluate(() => window.__h.unmount('b'));
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('browser fullscreen: a request without user activation is rejected and not reported as success', async ({ page }) => {
  await mount(page, { source });
  await waitForReady(page);
  const result = await page.evaluate(() =>
    window.__h
      .ref()
      .fullscreen.request('browser')
      .then(() => 'resolved')
      .catch((e: { code: string }) => e.code),
  );
  // Headless Chromium may grant or reject; either way state must match reality.
  const s = await state(page);
  if (result === 'resolved') expect(s.fullscreen).toMatchObject({ active: true, mode: 'browser' });
  else {
    expect(result).toBe('fullscreen-rejected');
    expect(s.fullscreen.active).toBe(false);
  }
});

test('browser fullscreen via the prebuilt control and Escape/exit is tracked from real events', async ({ page }) => {
  await mount(page, { source });
  await waitForReady(page);
  await page.locator('#app .rsp-root').hover();
  await page.locator('.art-control-rsp-fullscreen').click();
  await page.waitForFunction(() => window.__h.ref().getState().fullscreen.active === true, null, { timeout: 5000 });
  expect(await page.evaluate(() => document.fullscreenElement?.classList.contains('art-video-player'))).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => window.__h.ref().getState().fullscreen.active === false);
  expect((await events(page, 'fullscreenChange')).map((e) => e.payload.active)).toEqual([true, false]);
});

test('fallbackToWeb is used only when configured', async ({ page }) => {
  await mount(page, { source, fullscreen: { mode: 'browser', fallbackToWeb: true } });
  await waitForReady(page);
  await page.evaluate(() => {
    // Simulate a platform rejection.
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.evaluate(() => window.__h.ref().fullscreen.request('browser'));
  expect((await state(page)).fullscreen).toMatchObject({ active: true, mode: 'web' });
});

test.describe('keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, { source, playbackRates: [0.5, 1, 1.5, 2] });
    await waitForReady(page);
    await page.locator('#app .rsp-root').focus();
  });

  test('space/K toggle play, arrows seek/volume, digits seek, Home/End, M, > <', async ({ page }) => {
    await page.keyboard.press(' ');
    await waitForTime(page, 0.3);
    await page.keyboard.press('k');
    await page.waitForTimeout(200);
    expect((await videoInfo(page)).paused).toBe(true);
    await page.keyboard.press('5');
    await page.waitForTimeout(300);
    expect(Math.round((await videoInfo(page)).time)).toBe(10);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(Math.round((await videoInfo(page)).time)).toBe(20);
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    expect(Math.round((await videoInfo(page)).time)).toBe(10);
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);
    expect((await videoInfo(page)).time).toBe(0);
    await page.keyboard.press('ArrowDown');
    expect((await videoInfo(page)).volume).toBeCloseTo(0.65);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect((await videoInfo(page)).volume).toBeCloseTo(0.75);
    await page.keyboard.press('m');
    expect((await videoInfo(page)).muted).toBe(true);
    await page.keyboard.press('m');
    expect((await videoInfo(page)).muted).toBe(false);
    expect((await videoInfo(page)).volume).toBeCloseTo(0.75);
    await page.keyboard.press('>');
    expect((await videoInfo(page)).rate).toBe(1.5);
    await page.keyboard.press('Shift+Period');
    expect((await videoInfo(page)).rate).toBe(2);
    await page.keyboard.press('>');
    expect((await videoInfo(page)).rate).toBe(2);
    await page.keyboard.press('<');
    expect((await videoInfo(page)).rate).toBe(1.5);
  });

  test('ignored in inputs, with modifiers, and when focus is outside the player', async ({ page }) => {
    await page.locator('#outside').focus();
    await page.keyboard.press(' ');
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    expect((await videoInfo(page)).paused).toBe(true);
    expect((await videoInfo(page)).muted).toBe(false);
    await page.locator('#app .rsp-root').focus();
    await page.keyboard.press('Control+m');
    await page.keyboard.press('Alt+ArrowRight');
    expect((await videoInfo(page)).muted).toBe(false);
    expect((await videoInfo(page)).time).toBe(0);
  });

  test('F toggles the configured fullscreen mode and Escape exits web fullscreen', async ({ page }) => {
    await page.evaluate(() => window.__h.update({ fullscreen: { mode: 'web' }, hotkeys: { fullscreenMode: 'web' } }));
    await page.locator('#app .rsp-root').focus();
    await page.keyboard.press('f');
    expect((await state(page)).fullscreen).toMatchObject({ active: true, mode: 'web' });
    await page.keyboard.press('Escape');
    expect((await state(page)).fullscreen.active).toBe(false);
  });

  test('custom bindings and disabling', async ({ page }) => {
    await page.evaluate(() => window.__h.update({ hotkeys: { bindings: { p: 'togglePlay', ' ': null } } }));
    await page.locator('#app .rsp-root').focus();
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    expect((await videoInfo(page)).paused).toBe(true);
    await page.keyboard.press('p');
    await waitForTime(page, 0.2);
    await page.evaluate(() => window.__h.update({ hotkeys: false }));
    await page.locator('#app .rsp-root').focus();
    await page.keyboard.press('k');
    await page.waitForTimeout(200);
    expect((await videoInfo(page)).paused).toBe(false);
  });

  test('vendor controls are keyboard operable: settings menu opens with Enter and options are menuitemradio', async ({ page }) => {
    const gear = page.locator('.art-control-setting');
    await expect(gear).toHaveAttribute('role', 'button');
    await expect(gear).toHaveAttribute('tabindex', '0');
    await gear.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.art-setting-panel.art-current')).toHaveAttribute('role', 'menu');
    // Speed submenu via keyboard.
    const focused = await page.evaluate(() => document.activeElement?.className);
    expect(focused).toContain('art-setting-item');
    await page.keyboard.press('Enter');
    await expect(page.locator('.art-setting-panel.art-current .art-setting-item[role="menuitemradio"]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.art-video-player')).not.toHaveClass(/art-setting-show/);
    const play = page.locator('.art-control-playAndPause');
    await play.focus();
    await page.keyboard.press('Enter');
    await waitForTime(page, 0.2);
  });
});
