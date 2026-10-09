import { expect, test } from '@playwright/test';
import { BASE, events, mount, openHarness, state, SUBS, waitForReady, waitForTime } from './helpers';

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe('layout, fit, motion and accessibility', () => {
  test('single-video Reel: 9:16 box, desktop max width, portrait media, fit on the <video> only', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/portrait.mp4`, type: 'mp4' }, layout: 'reel', fit: 'cover', objectPosition: '50% 30%' });
    await waitForReady(page);
    const m = await page.evaluate(() => {
      const root = document.querySelector('#app .rsp-root') as HTMLElement;
      const v = document.querySelector('#app video') as HTMLVideoElement;
      const r = root.getBoundingClientRect();
      return {
        ratio: r.width / r.height,
        width: r.width,
        rootFit: getComputedStyle(root).objectFit,
        fit: getComputedStyle(v).objectFit,
        pos: getComputedStyle(v).objectPosition,
        videos: document.querySelectorAll('#app video').length,
        portrait: v.videoHeight > v.videoWidth,
      };
    });
    expect(m.ratio).toBeCloseTo(9 / 16, 2);
    expect(m.width).toBeLessThanOrEqual(420);
    expect(m.fit).toBe('cover');
    expect(m.pos).toBe('50% 30%');
    expect(m.rootFit).toBe('fill'); // not applied to the container
    expect(m.videos).toBe(1);
    expect(m.portrait).toBe(true);
    // Touch targets in Reel.
    const control = await page.locator('.art-control-setting').boundingBox();
    expect(control!.height).toBeGreaterThanOrEqual(44);
  });

  test('every fit value applies to the <video> element in standard and Reel layouts without reloading', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } });
    await waitForReady(page);
    for (const layout of ['standard', 'reel']) {
      for (const fit of ['contain', 'cover', 'fill', 'none', 'scale-down']) {
        await page.evaluate(({ layout, fit }) => window.__h.update({ layout, fit }), { layout, fit });
        const m = await page.evaluate(() => {
          const root = document.querySelector('#app .rsp-root') as HTMLElement;
          const r = root.getBoundingClientRect();
          return { fit: getComputedStyle(document.querySelector('#app video')!).objectFit, ratio: r.width / r.height };
        });
        expect(m.fit).toBe(fit);
        expect(m.ratio).toBeCloseTo(layout === 'reel' ? 9 / 16 : 16 / 9, 2);
      }
    }
    expect((await events(page, 'loadStart')).length).toBe(1);
  });

  test('watermark: inert host text, non-interactive, optional movement, live updates without reload', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' }, watermark: { text: '<b>viewer-42</b>', opacity: 0.5, position: 'bottom-left', moveIntervalMs: 1000 } });
    await waitForReady(page);
    const mark = page.locator('#app .rsp-watermark');
    await expect(mark).toHaveText('<b>viewer-42</b>');
    expect(await page.locator('#app .rsp-watermark b').count()).toBe(0);
    const style = await mark.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, events: getComputedStyle(el.parentElement!).pointerEvents, position: (el as HTMLElement).dataset.position }));
    expect(style).toEqual({ opacity: '0.5', events: 'none', position: 'bottom-left' });
    await expect.poll(() => mark.evaluate((el) => (el as HTMLElement).dataset.position), { timeout: 3000 }).not.toBe('bottom-left');
    await page.evaluate(() => window.__h.update({ watermark: undefined }));
    expect(await page.locator('#app .rsp-watermark').count()).toBe(0);
    expect((await events(page, 'loadStart')).length).toBe(1);
  });

  test('captions follow subtitleStyle and stay above the control bar', async ({ page }) => {
    await mount(page, {
      source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' },
      subtitles: SUBS(),
      defaultSubtitleLanguage: 'mn',
      subtitleStyle: { fontSize: '30px', bottom: '60px', color: '#ff0', backgroundColor: 'rgba(0, 0, 255, 0.5)' },
      network: { crossOrigin: 'anonymous' },
    });
    await waitForReady(page);
    await page.evaluate(() => window.__h.ref().play());
    await expect(page.locator('.rsp-cues')).toContainText('MN хадмал', { timeout: 10_000 });
    const style = await page.evaluate(() => {
      const box = document.querySelector('.rsp-cues') as HTMLElement;
      const text = document.querySelector('.rsp-cue-text') as HTMLElement;
      return { size: getComputedStyle(box).fontSize, color: getComputedStyle(box).color, bg: getComputedStyle(text).backgroundColor };
    });
    expect(style).toEqual({ size: '30px', color: 'rgb(255, 255, 0)', bg: 'rgba(0, 0, 255, 0.5)' });
    const cue = (await page.locator('.rsp-cue-text').boundingBox())!;
    const bar = (await page.locator('.art-bottom').boundingBox())!;
    expect(cue.y + cue.height).toBeLessThanOrEqual(bar.y + bar.height);
    // No duplicate native rendering.
    expect(await page.evaluate(() => [...(document.querySelector('#app video') as HTMLVideoElement).textTracks].filter((t) => t.mode === 'showing').length)).toBe(0);
  });

  test('reduced motion follows the system preference unless overridden', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } });
    await waitForReady(page);
    expect(await page.evaluate(() => (document.querySelector('#app .rsp-root') as HTMLElement).dataset.rspMotion)).toBe('reduced');
    await page.evaluate(() => window.__h.update({ motion: { reducedMotion: 'never', durationMs: 120 } }));
    const m = await page.evaluate(() => {
      const root = document.querySelector('#app .rsp-root') as HTMLElement;
      return { mode: root.dataset.rspMotion, duration: root.style.getPropertyValue('--rsp-motion-duration') };
    });
    expect(m).toEqual({ mode: 'full', duration: '120ms' });
    expect((await events(page, 'loadStart')).length).toBe(1);
  });

  test('Mongolian locale labels the prebuilt menus and the region', async ({ page }) => {
    await mount(page, { source: { id: 'm', type: 'mp4', variants: [{ id: 'a', label: '216p', height: 216, src: `${BASE}/fixtures/mp4/vod-216p.mp4` }, { id: 'b', label: '360p', height: 360, src: `${BASE}/fixtures/mp4/vod-360p.mp4` }] }, subtitles: SUBS(), locale: 'mn' });
    await waitForReady(page);
    await page.locator('.art-control-setting').click();
    const menus = await page.locator('.art-setting-panel.art-current .art-setting-item-left-text').allTextContents();
    expect(menus).toEqual(['Хурд', 'Хадмал', 'Чанар']);
    expect(await page.locator('#app .rsp-root').getAttribute('aria-label')).toBe('Видео тоглуулагч');
  });

  test('native UI mode uses browser controls and native captions; capabilities report the differences', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' }, ui: 'native', subtitles: SUBS(), defaultSubtitleTrack: 'en', network: { crossOrigin: 'anonymous' } });
    await waitForReady(page);
    const m = await page.evaluate(() => {
      const v = document.querySelector('#app video') as HTMLVideoElement;
      return { controls: v.controls, artplayer: document.querySelectorAll('.art-video-player').length, showing: [...v.textTracks].filter((t) => t.mode === 'showing').map((t) => t.label) };
    });
    expect(m).toEqual({ controls: true, artplayer: 0, showing: ['English'] });
    const caps = await page.evaluate(() => window.__h.ref().getCapabilities());
    expect(caps.contextMenu).toEqual({ supported: false, reason: 'browser-owned-in-native-ui' });
    expect(caps.adaptiveQuality.supported).toBe(false);
    expect(caps.requestInterception.supported).toBe(false);
    // Switching UI at runtime keeps the same video element and position.
    await page.evaluate(() => window.__h.ref().seekTo(4));
    await page.evaluate(() => window.__h.update({ ui: 'artplayer' }));
    await page.waitForSelector('#app .art-video-player');
    expect(await page.evaluate(() => document.querySelectorAll('#app video').length)).toBe(1);
    expect(Math.round((await state(page)).currentTime)).toBe(4);
    expect((await events(page, 'loadStart')).length).toBe(1);
  });
});

test.describe('Media Session', () => {
  test('metadata, actions and position state when enabled; release on unmount', async ({ page }) => {
    await page.evaluate(() => {
      const calls: unknown[] = ((window as any).__ms = []);
      const orig = navigator.mediaSession.setPositionState.bind(navigator.mediaSession);
      navigator.mediaSession.setPositionState = (s?: MediaPositionState) => {
        calls.push(s ?? null);
        orig(s);
      };
    });
    await mount(page, {
      source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' },
      mediaSession: { enabled: true, title: 'Video title', artist: 'Publisher', artwork: [{ src: `${BASE}/fixtures/images/poster.png`, sizes: '640x360', type: 'image/png' }] },
    });
    await waitForReady(page);
    await page.evaluate(() => window.__h.ref().play());
    await waitForTime(page, 1);
    const meta = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, state: navigator.mediaSession.playbackState }));
    expect(meta).toEqual({ title: 'Video title', artist: 'Publisher', state: 'playing' });
    const pos = await page.evaluate(() => (window as any).__ms.filter(Boolean).at(-1));
    expect(pos.duration).toBeGreaterThan(19);
    expect(Number.isFinite(pos.position)).toBe(true);
    // Metadata change does not reload the source.
    await page.evaluate(() => window.__h.update({ mediaSession: { enabled: true, title: 'Renamed' } }));
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Renamed');
    expect((await events(page, 'loadStart')).length).toBe(1);
    await page.evaluate(() => window.__h.unmount());
    expect(await page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();
  });

  test('ownership: a second player takes over; the first player unmounting does not clear the owner', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' }, mediaSession: { enabled: true, title: 'First' } });
    await page.evaluate((base) => window.__h.mount({ source: { src: `${base}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' }, mediaSession: { enabled: true, title: 'Second' } }, { key: 'b' }), BASE);
    await page.waitForFunction(() => window.__h.events.filter((e: { name: string }) => e.name === 'ready').length >= 2);
    await page.evaluate(() => window.__h.ref('a').play());
    await page.waitForFunction(() => navigator.mediaSession.metadata?.title === 'First');
    await page.evaluate(() => window.__h.ref('b').play());
    await page.waitForFunction(() => navigator.mediaSession.metadata?.title === 'Second');
    await page.evaluate(() => window.__h.unmount('a'));
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Second');
  });

  test('disabled by default: host-owned metadata is never touched', async ({ page }) => {
    await page.evaluate(() => {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'Host owned' });
    });
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } });
    await waitForReady(page);
    await page.evaluate(() => window.__h.ref().play());
    await waitForTime(page, 0.5);
    await page.evaluate(() => window.__h.unmount());
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Host owned');
  });

  test('ad-time commands: Media Session seek actions are ignored during a linear ad', async ({ page }) => {
    await page.evaluate(() => {
      const handlers: Record<string, MediaSessionActionHandler | null> = ((window as any).__msHandlers = {});
      const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        handlers[action] = handler;
        orig(action, handler);
      };
    });
    await mount(page, {
      source: { src: `${BASE}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' },
      mediaSession: { enabled: true, title: 'Ads' },
      ads: { items: [{ id: 'mid', type: 'text', text: 'Ad', duration: 3, timing: { placement: 'midroll', at: 1 } }] },
    });
    await waitForReady(page);
    // Content playback claims the session; the midroll then starts.
    await page.evaluate(() => window.__h.ref().play());
    await page.waitForFunction(() => window.__h.ref().getState().ad.active);
    const before = (await state(page)).currentTime;
    // Invoke the registered handler the way the platform would.
    const invoked = await page.evaluate(() => {
      const h = (window as any).__msHandlers as Record<string, ((d: MediaSessionActionDetails) => void) | null>;
      if (!h.seekto) return false;
      h.seekto({ action: 'seekto', seekTime: 12 });
      return true;
    });
    expect(invoked).toBe(true);
    await page.waitForTimeout(200);
    expect(Math.abs((await state(page)).currentTime - before)).toBeLessThan(0.1);
    expect((await events(page, 'seeking')).length).toBe(0);
    expect(await page.evaluate(() => window.__h.ref().seekTo(10).then(() => 'ok', (e: { code: string }) => e.code))).toBe('unsupported-operation');
  });
});
