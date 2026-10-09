import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, type RawCategory, type SampleEntry } from '../../examples/nextjs/components/samples/catalog';
import { SAMPLE_PROXY_PREFIX, sameOrigin } from '../../examples/nextjs/components/samples/proxy';
import { openHarness } from './helpers';

// OPT-IN probe of the public sample streams (examples/nextjs/components/samples).
// Third-party availability must never gate CI, so this only runs with
// RSP_PUBLIC_SAMPLES=1. It mounts every loadable sample in the player and
// records what happened (played / error code / timeout) together with the
// browser's codec and DRM support, into RSP_PUBLIC_SAMPLES_OUT
// (default test-results/public-samples.json).
//
// It asserts only what must hold for ANY stream: the player never throws an
// uncaught exception, and it never stays silently stuck (it either plays,
// reports an error, or is recorded as a timeout for the report).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'examples/nextjs/components/samples/samples.json'), 'utf8')) as RawCategory[];
// Same configuration as the Next.js example, including its same-origin
// rewrite for the CORS-less buckets (emulated below with page.route).
const catalog = buildCatalog(raw, { corsUrl: sameOrigin });
const loadable = catalog.filter((entry) => entry.config);
const only = process.env.RSP_PUBLIC_SAMPLES_ONLY ? new RegExp(process.env.RSP_PUBLIC_SAMPLES_ONLY, 'i') : null;
const outFile = process.env.RSP_PUBLIC_SAMPLES_OUT ?? path.join(root, 'test-results/public-samples.json');
const WAIT_MS = Number(process.env.RSP_PUBLIC_SAMPLES_WAIT_MS ?? 25_000);

interface ProbeResult {
  id: string;
  category: string;
  name: string;
  expected: SampleEntry['status'];
  outcome: 'played' | 'error' | 'ready-not-playing' | 'timeout';
  playedSeconds: number;
  engine: string | null;
  errors: string[];
  adErrors: string[];
  adStarts: number;
  qualities: number;
  audioTracks: number;
  subtitles: number;
  video: { width: number; height: number } | null;
  pageErrors: string[];
}

const results: ProbeResult[] = [];
let environment: Record<string, unknown> = {};

test.describe('public sample streams (opt-in, real network)', () => {
  test.skip(!process.env.RSP_PUBLIC_SAMPLES, 'Set RSP_PUBLIC_SAMPLES=1 to probe third-party sample streams');
  test.describe.configure({ timeout: WAIT_MS + 30_000 });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('about:blank');
    environment = await page.evaluate(async () => {
      const types: Record<string, string> = {
        h264: 'video/mp4; codecs="avc1.42E01E"',
        aac: 'audio/mp4; codecs="mp4a.40.2"',
        hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
        vp9: 'video/webm; codecs="vp9"',
        av1: 'video/mp4; codecs="av01.0.05M.08"',
        opus: 'audio/webm; codecs="opus"',
        flac: 'audio/mp4; codecs="flac"',
        iamf: 'audio/mp4; codecs="iamf.000.000.Opus"',
      };
      const mse: Record<string, boolean> = {};
      for (const [k, t] of Object.entries(types)) mse[k] = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(t);
      const v = document.createElement('video');
      const progressive: Record<string, string> = {};
      for (const [k, t] of Object.entries({ mkv: 'video/x-matroska', mp3: 'audio/mpeg', ogg: 'audio/ogg; codecs="vorbis"', mp2t: 'video/mp2t', aacAdts: 'audio/aac' })) progressive[k] = v.canPlayType(t);
      let widevine = false;
      try {
        await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: types.vp9! }] }]);
        widevine = true;
      } catch {
        widevine = false;
      }
      return { userAgent: navigator.userAgent, mse, progressive, widevine };
    });
    await page.close();
  });

  test.afterAll(() => {
    const summary: Record<string, Record<string, number>> = {};
    for (const r of results) {
      summary[r.expected] ??= {};
      summary[r.expected]![r.outcome] = (summary[r.expected]![r.outcome] ?? 0) + 1;
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify({ generatedBy: 'tests/e2e/public-samples.spec.ts', environment, summary, results }, null, 2)}\n`);
  });

  for (const entry of loadable.filter((e) => !only || only.test(`${e.category} ${e.name}`))) {
    test(`${entry.category} / ${entry.name}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      // The example's next.config.mjs rewrite: /sample-media/<bucket>/… → storage.googleapis.com.
      await page.route(`**${SAMPLE_PROXY_PREFIX}/**`, async (route) => {
        const url = new URL(route.request().url());
        const target = `https://storage.googleapis.com/${url.pathname.slice(SAMPLE_PROXY_PREFIX.length + 1)}${url.search}`;
        await route.fulfill({ response: await route.fetch({ url: target }) });
      });
      await openHarness(page);
      await page.evaluate(
        ({ config, prefix }) => {
          // The example's network.onRequest: absolute bucket URLs inside proxied manifests.
          const map = (uri: string) => {
            const m = /^https:\/\/storage\.googleapis\.com\/(exoplayer-test-media-[01]\/.*)$/.exec(uri);
            return m ? `${prefix}/${m[1]}` : uri;
          };
          window.__h.mount({
            ...config,
            network: { onRequest: (request: { uris: string[] }) => void (request.uris = request.uris.map(map)) },
            autoplay: { enabled: true, mutedFallback: true },
          });
        },
        { config: entry.config as Record<string, unknown>, prefix: SAMPLE_PROXY_PREFIX },
      );
      const deadline = Date.now() + WAIT_MS;
      let outcome: ProbeResult['outcome'] = 'timeout';
      let maxTime = 0;
      while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
          const v = document.querySelector('#app video') as HTMLVideoElement | null;
          const st = window.__h.ref()?.getState();
          return { time: v?.currentTime ?? 0, paused: v?.paused ?? true, status: st?.status ?? 'idle', adActive: Boolean(st?.ad?.active) };
        });
        maxTime = Math.max(maxTime, s.time);
        if (s.time > 2 && !s.paused) {
          outcome = 'played';
          break;
        }
        if (s.status === 'error') {
          outcome = 'error';
          break;
        }
        await page.waitForTimeout(500);
      }
      if (outcome === 'timeout') {
        const status = await page.evaluate(() => window.__h.ref()?.getState().status);
        if (status === 'ready') outcome = 'ready-not-playing';
      }
      const data = await page.evaluate(() => {
        const events = window.__h.events as { name: string; payload: Record<string, unknown> & unknown[] }[];
        const last = (name: string) => [...events].reverse().find((e) => e.name === name)?.payload;
        const v = document.querySelector('#app video') as HTMLVideoElement | null;
        return {
          engine: (events.find((e) => e.name === 'ready')?.payload as { engine?: string } | undefined)?.engine ?? null,
          errors: events.filter((e) => e.name === 'error').map((e) => `${e.payload.code}${e.payload.fatal ? '!' : ''}`),
          adErrors: events.filter((e) => e.name === 'adError').map((e) => String(e.payload.code)),
          adStarts: events.filter((e) => e.name === 'adStart').length,
          qualities: (last('availableQualitiesChange') as unknown[] | undefined)?.length ?? 0,
          audioTracks: (last('availableAudioTracksChange') as unknown[] | undefined)?.length ?? 0,
          subtitles: (last('availableSubtitlesChange') as unknown[] | undefined)?.length ?? 0,
          video: v && v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null,
        };
      });
      results.push({ id: entry.id, category: entry.category, name: entry.name, expected: entry.status, outcome, playedSeconds: Math.round(maxTime * 10) / 10, ...data, pageErrors });
      expect(pageErrors, 'uncaught page errors').toEqual([]);
    });
  }
});
