import { expect, test } from '@playwright/test';
import { BASE, events, mount, openHarness, resetLog, serverLog, state, waitForEvent, waitForReady, waitForTime } from './helpers';

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await resetLog();
});

test.describe('errors and retry', () => {
  test('missing MP4: fatal, localized, readable error UI without URLs; no endless spinner', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/missing.mp4?token=SECRET123`, type: 'mp4' }, network: { fatalRetryLimit: 0 }, locale: 'mn' });
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error', null, { timeout: 15_000 });
    const panel = page.locator('.rsp-error');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'alert');
    await expect(panel.locator('.rsp-error-title')).toHaveText('Тоглуулахад алдаа гарлаа');
    const text = (await panel.textContent()) ?? '';
    expect(text).not.toContain('http');
    expect(text).not.toContain('SECRET123');
    expect(await page.evaluate(() => document.querySelector('.art-video-player')!.classList.contains('art-loading-show'))).toBe(false);
    const err = (await events(page, 'error')).find((e) => e.payload.fatal)!;
    expect(JSON.stringify(err)).not.toContain('SECRET123');
    expect(err.payload.contentSessionId).toBeTruthy();
    expect(err.payload.loadId).toBe(1);
  });

  test('unknown source types fail fast without network requests', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/broken/unknown-extension.bin` } });
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error');
    expect((await state(page)).error.code).toBe('source-type-unknown');
    expect((await serverLog()).filter((r) => r.path.includes('unknown-extension'))).toEqual([]);
  });

  test('manifest retry mapping: maxAttempts includes the first request', async ({ page }) => {
    await mount(page, {
      source: { src: `${BASE}/fixtures/hls/master.m3u8?flaky=2&key=a`, type: 'hls' },
      network: { retry: { manifest: { maxAttempts: 3, baseDelayMs: 50, jitter: 0 } } },
    });
    await waitForReady(page);
    const master = (await serverLog()).filter((r) => r.path === '/fixtures/hls/master.m3u8');
    expect(master.length).toBe(3);
  });

  test('exhausted retries produce a recoverable error; manual retry() recovers in the same session', async ({ page }) => {
    await mount(page, {
      source: { id: 'flaky', src: `${BASE}/fixtures/hls/master.m3u8?flaky=2&key=b`, type: 'hls' },
      network: { retry: { manifest: { maxAttempts: 1 } }, fatalRetryLimit: 0 },
    });
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error', null, { timeout: 15_000 });
    const s1 = await state(page);
    expect(s1.error.recoverable).toBe(true);
    await expect(page.locator('.rsp-error-retry')).toBeVisible();
    await page.locator('.rsp-error-retry').click();
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error' || window.__h.ref().getState().status === 'ready', null, { timeout: 15_000 });
    // The flaky route fails twice, so a second manual retry succeeds.
    if ((await state(page)).status === 'error') await page.evaluate(() => window.__h.ref().retry().catch(() => undefined));
    await page.waitForFunction(() => window.__h.ref().getState().status === 'ready', null, { timeout: 15_000 });
    const s2 = await state(page);
    expect(s2.contentSessionId).toBe(s1.contentSessionId);
    expect((await events(page, 'loadStart')).map((e) => e.payload.reason)).toContain('retry');
    await expect(page.locator('.rsp-error')).toHaveCount(0);
  });

  test('bounded automatic retry with backoff for recoverable failures', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/hls/master.m3u8?flaky=1&key=c`, type: 'hls' }, network: { retry: { manifest: { maxAttempts: 1 } }, fatalRetryLimit: 1 } });
    await waitForEvent(page, 'error');
    expect((await events(page, 'error'))[0]!.payload).toMatchObject({ fatal: false, details: { autoRetry: 1 } });
    await waitForReady(page, 20_000);
    expect((await events(page, 'loadStart')).map((e) => e.payload.reason)).toEqual(['initial', 'retry']);
  });

  test('error UI is visible in the Reel layout', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/broken/malformed.mpd`, type: 'dash' }, layout: 'reel', network: { fatalRetryLimit: 0 } });
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error', null, { timeout: 15_000 });
    const box = await page.locator('.rsp-error').boundingBox();
    const root = await page.locator('#app .rsp-root').boundingBox();
    expect(box && root && box.x >= root.x && box.x + box.width <= root.x + root.width + 1).toBe(true);
    expect((await state(page)).error.category).toBe('manifest');
  });

  test('imperative API before a source / after destroy rejects instead of hanging', async ({ page }) => {
    await mount(page, { source: null });
    const before = await page.evaluate(() => window.__h.ref().seekTo(5).then(() => 'ok', (e: { code: string }) => e.code));
    expect(before).toBe('player-not-ready');
    await page.evaluate(() => window.__h.ref().destroy());
    const after = await page.evaluate(() => window.__h.ref().play().then(() => 'ok', (e: { code: string }) => e.code));
    expect(after).toBe('player-destroyed');
    await page.evaluate(() => window.__h.ref().destroy()); // idempotent
  });
});

test.describe('Blob inputs and object URL ownership', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      const created: string[] = ((window as unknown as { __created: string[] }).__created = []);
      const revoked: string[] = ((window as unknown as { __revoked: string[] }).__revoked = []);
      const c = URL.createObjectURL.bind(URL);
      const r = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource) => {
        const u = c(o);
        if (o instanceof Blob) created.push(u);
        return u;
      };
      URL.revokeObjectURL = (u: string) => {
        revoked.push(u);
        r(u);
      };
    });
  });

  test('Blob MP4 + Blob WebVTT + Blob ad image play; package URLs are revoked only after unmount', async ({ page }) => {
    await page.evaluate(async (base) => {
      const video = await window.__h.fetchBlob(`${base}/fixtures/mp4/vod-216p.mp4`, 'video/mp4');
      const vtt = await window.__h.fetchBlob(`${base}/fixtures/subs/en.vtt`, 'text/vtt');
      const banner = await window.__h.fetchBlob(`${base}/fixtures/ads/banner.png`, 'image/png');
      window.__h.mount({
        source: { id: 'local', src: video, type: 'mp4' },
        subtitles: [{ id: 'en', src: vtt, label: 'English', language: 'en' }],
        defaultSubtitleTrack: 'en',
        ads: { items: [{ id: 'blob-ad', type: 'image', src: banner, alt: 'Local banner', duration: 1, timing: { placement: 'preroll' } }] },
      });
    }, BASE);
    await waitForReady(page);
    expect(await page.evaluate(() => (document.querySelector('#app video') as HTMLVideoElement).currentSrc.startsWith('blob:'))).toBe(true);
    await page.evaluate(() => window.__h.ref().play());
    await waitForEvent(page, 'adComplete');
    await waitForTime(page, 0.5);
    await expect(page.locator('.rsp-cues')).toContainText('EN cue', { timeout: 10_000 });
    const mid = await page.evaluate(() => ({ created: (window as any).__created.length, revoked: (window as any).__revoked.slice() }));
    expect(mid.created).toBe(3);
    // Only the finished ad image may be revoked so far (after its <img> was removed).
    expect(mid.revoked.length).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.__h.unmount());
    await page.waitForTimeout(100);
    const end = await page.evaluate(() => ({ created: (window as any).__created as string[], revoked: (window as any).__revoked as string[] }));
    expect([...end.created].sort()).toEqual([...new Set(end.revoked)].sort());
  });

  test('caller-provided blob: URLs are never revoked and require an explicit type', async ({ page }) => {
    const url = await page.evaluate(async (base) => {
      const blob = await window.__h.fetchBlob(`${base}/fixtures/mp4/vod-216p.mp4`, 'video/mp4');
      return URL.createObjectURL(blob);
    }, BASE);
    await page.evaluate((url) => window.__h.mount({ source: { src: url } }), url);
    await page.waitForFunction(() => window.__h.ref().getState().status === 'error');
    expect((await state(page)).error.code).toBe('source-type-unknown');
    await page.evaluate(() => window.__h.clearEvents());
    await page.evaluate((url) => window.__h.update({ source: { src: url, type: 'mp4' } }), url);
    await waitForReady(page);
    await page.evaluate(() => window.__h.unmount());
    await page.waitForTimeout(100);
    expect(await page.evaluate((url) => (window as any).__revoked.includes(url), url)).toBe(false);
  });

  test('replacing a Blob source revokes its URL after the new source is attached', async ({ page }) => {
    await page.evaluate(async (base) => {
      const a = await window.__h.fetchBlob(`${base}/fixtures/mp4/vod-216p.mp4`, 'video/mp4');
      (window as any).__blobA = a;
      window.__h.mount({ source: { src: a, type: 'mp4' } });
    }, BASE);
    await waitForReady(page);
    const first = await page.evaluate(() => (document.querySelector('#app video') as HTMLVideoElement).currentSrc);
    await page.evaluate((base) => window.__h.update({ source: { src: `${base}/fixtures/mp4/vod-360p.mp4`, type: 'mp4' } }), BASE);
    await waitForEvent(page, 'ready', 10_000, 2);
    await page.waitForTimeout(100);
    expect(await page.evaluate((u) => (window as any).__revoked.includes(u), first)).toBe(true);
  });

  test('captureFrame returns a caller-owned PNG Blob without creating object URLs', async ({ page }) => {
    await mount(page, { source: { src: `${BASE}/fixtures/mp4/vod-216p.mp4`, type: 'mp4' } });
    await waitForReady(page);
    await page.evaluate(() => window.__h.ref().seekTo(2));
    const result = await page.evaluate(async () => {
      const before = (window as any).__created.length;
      const blob: Blob | null = await window.__h.ref().captureFrame();
      return { type: blob?.type, size: blob?.size ?? 0, created: (window as any).__created.length - before };
    });
    expect(result.type).toBe('image/png');
    expect(result.size).toBeGreaterThan(1000);
    expect(result.created).toBe(0);
  });
});
