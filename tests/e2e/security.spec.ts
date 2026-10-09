import { expect, test } from '@playwright/test';
import { BASE, events, mount, OTHER, openHarness, resetLog, selectInSettings, serverLog, state, videoInfo, waitForReady, waitForTime } from './helpers';

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog(BASE);
  await resetLog(OTHER);
});

test('credentials are attached only to allow-listed origins and request types', async ({ page }) => {
  await page.evaluate(
    ({ base, other }) =>
      window.__h.mount({
        source: { src: `${base}/fixtures/hls/master.m3u8`, type: 'hls' },
        subtitles: [{ id: 'ext', src: `${other}/fixtures/subs/en.vtt`, label: 'External', language: 'en' }],
        defaultSubtitleTrack: 'ext',
        network: {
          credentials: [
            {
              origins: [base],
              requestTypes: ['manifest', 'segment'],
              headers: ({ type }: { type: string }) => ({ Authorization: `Bearer short-lived-${type}` }),
            },
          ],
        },
      }),
    { base: BASE, other: OTHER },
  );
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
  const baseLog = (await serverLog(BASE)).filter((r) => r.path.startsWith('/fixtures/hls/'));
  expect(baseLog.length).toBeGreaterThan(3);
  expect(baseLog.every((r) => r.hasAuthorization)).toBe(true);
  const otherLog = (await serverLog(OTHER)).filter((r) => r.path.startsWith('/fixtures/'));
  expect(otherLog.length).toBeGreaterThan(0);
  expect(otherLog.some((r) => r.hasAuthorization)).toBe(false);
});

test('a credentialed request redirected outside the allowlist is blocked; credentials never reach the other origin', async ({ page }) => {
  await mount(page, {
    source: { src: `${BASE}/redirect?to=${encodeURIComponent(`${OTHER}/fixtures/hls/master.m3u8`)}`, type: 'hls' },
    network: { credentials: [{ origins: [BASE], headers: { Authorization: 'Bearer secret-token' } }], fatalRetryLimit: 0 },
  });
  await page.waitForFunction(() => window.__h.ref().getState().status === 'error', null, { timeout: 15_000 });
  expect((await state(page)).error.code).toBe('credential-redirect-blocked');
  expect((await serverLog(OTHER)).some((r) => r.hasAuthorization)).toBe(false);
  expect(JSON.stringify(await events(page, 'error'))).not.toContain('secret-token');
});

test('redirects can be explicitly allowed; the browser still strips Authorization cross-origin', async ({ page }) => {
  await mount(page, {
    source: { src: `${BASE}/redirect?to=${encodeURIComponent(`${OTHER}/fixtures/hls/master.m3u8`)}`, type: 'hls' },
    network: { credentials: [{ origins: [BASE], headers: { Authorization: 'Bearer secret-token' } }], credentialedRedirect: 'allow' },
  });
  await waitForReady(page);
  expect((await serverLog(OTHER)).some((r) => r.hasAuthorization)).toBe(false);
});

test('wildcard or path origins in credential rules are rejected with a config error', async ({ page }) => {
  await mount(page, {
    source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' },
    network: { credentials: [{ origins: ['https://*.example.com', 'https://cdn.example.com/path'], headers: { Authorization: 'x' } }] },
  });
  await waitForReady(page);
  const configErrors = (await events(page, 'error')).filter((e) => e.payload.category === 'config').map((e) => e.payload.message);
  expect(configErrors.length).toBe(2);
});

for (const engine of ['native', 'shaka'] as const) {
  test(`hostile WebVTT is rendered as inert text (${engine} engine)`, async ({ page }) => {
    const source = engine === 'native' ? { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } : { src: `${BASE}/fixtures/hls/master.m3u8`, type: 'hls' };
    await mount(page, {
      source,
      subtitles: [{ id: 'hostile', src: `${BASE}/fixtures/subs/hostile.vtt`, label: 'Hostile', language: 'en' }],
      defaultSubtitleTrack: 'hostile',
      network: { crossOrigin: 'anonymous' },
    });
    await waitForReady(page);
    await page.evaluate(() => window.__h.ref().play());
    // Parsers differ in how much of an unknown tag's text they keep (the
    // browser keeps "safe text", Shaka keeps the <script> body as text), but
    // the cue is always inert text: no elements, no execution.
    await page.waitForFunction(() => (document.querySelector('.rsp-text-layer')?.textContent ?? '').trim().length > 0, null, { timeout: 10_000 });
    expect(await page.locator('.rsp-text-layer img, .rsp-text-layer script').count()).toBe(0);
    if (engine === 'native') await expect(page.locator('.rsp-text-layer')).toContainText('safe text');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
}

test('hostile quality/subtitle labels stay plain text in the prebuilt menus', async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">';
  await mount(page, {
    source: {
      id: 'labels',
      type: 'mp4',
      variants: [
        { id: 'a', label: `${evil}A`, height: 216, src: `${BASE}/fixtures/mp4/vod-216p.mp4` },
        { id: 'b', label: 'B', height: 360, src: `${BASE}/fixtures/mp4/vod-360p.mp4` },
      ],
    },
    subtitles: [{ id: 's', src: `${BASE}/fixtures/subs/en.vtt`, label: `${evil}Sub`, language: 'en' }],
    title: `${evil}Title`,
  });
  await waitForReady(page);
  await page.locator('#app .rsp-settings-button').click();
  await page.locator('#app .rsp-settings-menu .rsp-menu-entry .rsp-menu-label').getByText('Quality', { exact: true }).click();
  await expect(page.locator('#app .rsp-settings-menu').getByText(`${evil}A`)).toBeVisible();
  await page.locator('#app .rsp-settings-menu .rsp-menu-back').click();
  await selectInSettings(page, 'Subtitles', `${evil}Sub`);
  // The label is now the root entry's current value too: still plain text.
  await page.locator('#app .rsp-settings-button').click();
  await expect(page.locator('#app .rsp-settings-menu .rsp-menu-value').getByText(`${evil}Sub`)).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.locator('#app .rsp-ui img').count()).toBe(0);
  expect(await page.evaluate(() => document.querySelector('#app .rsp-root')!.getAttribute('aria-label'))).toBe(`${evil}Title`);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('context menu: package actions only (no links, no source info); keyboard operable; disabled menu falls back to the browser menu', async ({ page }) => {
  await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4?sig=SIGNED`, type: 'mp4' }, subtitles: [{ id: 's', src: `${BASE}/fixtures/subs/en.vtt`, label: 'English', language: 'en' }] });
  await waitForReady(page);
  expect(await page.locator('#app a').count()).toBe(0);
  expect(await page.evaluate(() => document.querySelector('#app .rsp-root')!.textContent ?? '')).not.toContain('SIGNED');
  const box = (await page.locator('#app .rsp-root').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3, { button: 'right' });
  const menu = page.locator('#app .rsp-context-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('role', 'menu');
  expect(await menu.locator('[role="group"]').getAttribute('aria-label')).toBe('Speed');
  const items = await menu.locator('.rsp-context-item').allTextContents();
  expect(items).toEqual(['0.5×', '0.75×', 'Normal', '1.25×', '1.5×', '2×', 'Subtitles', 'Fullscreen', 'Loop', 'Copy diagnostics']);
  expect(await menu.locator('a, img').count()).toBe(0);
  // Focus starts on the first item; arrows move; Enter activates; focus is not lost.
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('0.5×');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  expect((await videoInfo(page)).rate).toBe(0.75);
  // Keyboard opening (Shift+F10) from the focused player; Escape closes and restores focus.
  await page.locator('#app .rsp-root').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.rsp-context-item[aria-checked="true"]', { hasText: '0.75×' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#app .rsp-root')).toBeFocused();
  // A click outside closes it.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();
  await page.evaluate(() => window.__h.update({ contextMenu: false }));
  const prevented = await page.evaluate(() => {
    const video = document.querySelector('#app video')!;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    video.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
});

test('nothing is written to browser storage (no tokens, positions or vendor settings)', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await mount(page, {
    source: { id: 's', type: 'mp4', variants: [{ id: 'a', label: '216p', height: 216, src: `${BASE}/fixtures/mp4/vod-216p.mp4?token=abc` }, { id: 'b', label: '360p', height: 360, src: `${BASE}/fixtures/mp4/vod-360p.mp4?token=abc` }] },
    network: { credentials: [{ origins: [BASE], headers: { Authorization: 'Bearer secret-token' } }] },
  });
  await waitForReady(page);
  await page.evaluate(() => window.__h.ref().play());
  await waitForTime(page, 1);
  await page.evaluate(async () => {
    const ref = window.__h.ref();
    ref.setVolume(0.3);
    ref.setMuted(true);
    ref.setPlaybackRate(1.5);
    await ref.seekTo(5);
    await ref.setQuality('b');
  });
  await page.locator('#app .rsp-settings-button').click();
  await page.mouse.click(5, 5);
  await page.locator('#app .rsp-volume').focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(500);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  expect(storage).toEqual({ local: 0, session: 0, cookie: '' });
});
