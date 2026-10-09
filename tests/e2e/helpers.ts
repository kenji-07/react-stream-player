import { expect, type Page } from '@playwright/test';

export const PORT = Number(process.env.RSP_TEST_PORT ?? 4173);
export const BASE = `http://127.0.0.1:${PORT}`;
/** Second origin (same server code, different port) for cross-origin tests. */
export const OTHER = `http://127.0.0.1:${PORT + 1}`;

export interface RecordedEvent {
  name: string;
  payload: any;
  ctx: { contentSessionId: string | null; loadId: number | null; timestamp: number };
  t: number;
}

declare global {
  interface Window {
    __h: any;
  }
}

export async function openHarness(page: Page): Promise<void> {
  page.on('pageerror', (error) => {
    // Surface page errors in the test output.
    console.error('[pageerror]', error.message);
  });
  await page.goto(`${BASE}/tests/e2e/harness/index.html`);
  await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
}

export async function mount(page: Page, props: Record<string, unknown>, options: { strict?: boolean } = {}): Promise<void> {
  await page.evaluate(({ props, options }) => window.__h.mount(props, options), { props, options });
}

export async function events(page: Page, name?: string): Promise<RecordedEvent[]> {
  const all: RecordedEvent[] = await page.evaluate(() => window.__h.events);
  return name ? all.filter((e) => e.name === name) : all;
}

export async function waitForEvent(page: Page, name: string, timeout = 20_000, minCount = 1): Promise<RecordedEvent> {
  await page.waitForFunction(
    ({ name, minCount }) => window.__h.events.filter((e: { name: string }) => e.name === name).length >= minCount,
    { name, minCount },
    { timeout },
  );
  const list = await events(page, name);
  return list[list.length - 1]!;
}

export async function waitForReady(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(() => window.__h.events.some((e: { name: string; payload?: unknown }) => e.name === 'ready' || (e.name === 'statusChange' && e.payload === 'error')), null, { timeout });
  const errors = (await events(page, 'error')).filter((e) => e.payload?.fatal);
  expect(errors, `fatal errors before ready: ${JSON.stringify(errors.map((e) => e.payload?.code))}`).toHaveLength(0);
}

export async function state(page: Page): Promise<any> {
  return page.evaluate(() => {
    const s = window.__h.ref().getState();
    return JSON.parse(JSON.stringify(s));
  });
}

export async function videoInfo(page: Page): Promise<{ time: number; paused: boolean; src: string; volume: number; muted: boolean; rate: number; count: number }> {
  return page.evaluate(() => {
    const v = document.querySelector('#app video') as HTMLVideoElement | null;
    return {
      time: v?.currentTime ?? -1,
      paused: v?.paused ?? true,
      src: v?.currentSrc ?? '',
      volume: v?.volume ?? -1,
      muted: v?.muted ?? false,
      rate: v?.playbackRate ?? -1,
      count: document.querySelectorAll('#app video.rsp-video, #app video.art-video').length,
    };
  });
}

export async function waitForTime(page: Page, seconds: number, timeout = 20_000): Promise<void> {
  await page.waitForFunction((s) => ((document.querySelector('#app video') as HTMLVideoElement | null)?.currentTime ?? 0) > s, seconds, { timeout });
}

export interface LogEntry {
  method: string;
  path: string;
  query: string;
  hasAuthorization: boolean;
  testHeader?: string;
  cookie: boolean;
  range?: string;
}

export async function resetLog(origin = BASE): Promise<void> {
  await fetch(`${origin}/__log/reset`);
}

export async function serverLog(origin = BASE): Promise<LogEntry[]> {
  return (await fetch(`${origin}/__log`)).json() as Promise<LogEntry[]>;
}

export function mp4Variants(ids = ['216p', '360p', '540p'], origin = BASE) {
  return ids.map((id) => ({ id, label: id, height: Number(id.replace('p', '')), src: `${origin}/fixtures/mp4/vod-${id}.mp4` }));
}

export const SUBS = (origin = BASE) => [
  { id: 'en', src: `${origin}/fixtures/subs/en.vtt`, label: 'English', language: 'en' },
  { id: 'mn', src: `${origin}/fixtures/subs/mn.vtt`, label: 'Монгол', language: 'mn' },
];

/** Opens Artplayer's existing settings panel and chooses an option (proves the UI path). */
export async function selectInSettings(page: Page, menu: string, option: string): Promise<void> {
  const open = await page.evaluate(() => document.querySelector('.art-video-player')?.classList.contains('art-setting-show'));
  if (!open) await page.locator('.art-control-setting').first().click();
  await page.locator('.art-setting-panel.art-current .art-setting-item-left-text').getByText(menu, { exact: true }).first().click();
  await page
    .locator('.art-setting-panel.art-current .art-setting-item:not(.art-setting-item-back) .art-setting-item-left-text')
    .getByText(option, { exact: true })
    .first()
    .click();
}
