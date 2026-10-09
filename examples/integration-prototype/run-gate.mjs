// Runs the integration-prototype gate in Chromium and writes results.json.
// Usage: node examples/integration-prototype/run-gate.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureServer } from '../../scripts/fixture-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const srv = createFixtureServer();
const port = await srv.listen(0);
const base = `http://127.0.0.1:${port}`;
const results = [];
const record = (gate, name, pass, details = {}) => {
  results.push({ gate, name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'} [gate ${gate}] ${name}`, JSON.stringify(details));
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

async function open() {
  await page.goto(`${base}/examples/integration-prototype/index.html`);
  await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
}
const resetLog = () => fetch(`${base}/__log/reset`);
const getLog = async () => (await fetch(`${base}/__log`)).json();

/** Clicks through Artplayer's existing settings panel: gear -> menu -> option. */
async function selectInUi(menuText, optionText) {
  // Artplayer keeps the panel open (back at the root list) after a selection.
  const open = await page.evaluate(() => document.querySelector('.art-video-player').classList.contains('art-setting-show'));
  if (!open) await page.locator('.art-control-setting').first().click();
  await page.locator('.art-setting-panel.art-current .art-setting-item-left-text').getByText(menuText, { exact: true }).first().click();
  await page
    .locator('.art-setting-panel.art-current .art-setting-item:not(.art-setting-item-back) .art-setting-item-left-text')
    .getByText(optionText, { exact: true })
    .first()
    .click();
}
const videoState = () =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    return {
      time: v.currentTime,
      paused: v.paused,
      rate: v.playbackRate,
      volume: v.volume,
      muted: v.muted,
      src: v.currentSrc,
      showing: [...v.textTracks].filter((t) => t.mode === 'showing').map((t) => t.label),
      videos: document.querySelectorAll('video').length,
    };
  });

const variants = ['216p', '360p', '540p'].map((id) => ({
  id,
  label: id,
  height: Number(id.slice(0, -1)),
  src: `${base}/fixtures/mp4/vod-${id}.mp4`,
}));
const subs = [
  { id: 'en', src: `${base}/fixtures/subs/en.vtt`, label: 'English', language: 'en' },
  { id: 'mn', src: `${base}/fixtures/subs/mn.vtt`, label: 'Монгол', language: 'mn' },
];

try {
  // ---------------------------------------------------------------- Gate 1
  await open();
  await resetLog();
  await page.evaluate(
    (a) => window.__proto.mount({ source: { kind: 'mp4', variants: a.variants, defaultId: '360p' }, subtitles: a.subs }),
    { variants, subs },
  );
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.playbackRate = 1.5;
    v.volume = 0.4;
    return v.play();
  });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 3);
  await selectInUi('Subtitles', 'English');
  await page.waitForTimeout(300);
  const before = await videoState();
  await selectInUi('Quality', '540p');
  await page.waitForFunction(() => document.querySelector('video').currentSrc.includes('540p') && document.querySelector('video').readyState >= 1);
  await page.waitForFunction(() => !document.querySelector('video').paused);
  const after = await videoState();
  const log = await getLog();
  record(1, 'MP4 quality switch through Artplayer settings preserves time/playing/rate/volume/captions',
    after.src.includes('vod-540p.mp4') && Math.abs(after.time - before.time) < 1.5 && !after.paused &&
      after.rate === 1.5 && Math.abs(after.volume - 0.4) < 1e-6 && after.showing.includes('English') && after.videos === 1,
    { before, after },
  );
  record(1, 'Only the selected MP4 variant is requested (no preloading of others)',
    !log.some((r) => r.path.includes('vod-216p.mp4')),
    { requested: [...new Set(log.filter((r) => r.path.endsWith('.mp4')).map((r) => r.path))] },
  );
  await page.evaluate(() => document.querySelector('video').pause());
  const pausedBefore = await videoState();
  await selectInUi('Quality', '216p');
  await page.waitForFunction(() => document.querySelector('video').currentSrc.includes('216p') && document.querySelector('video').readyState >= 1);
  await page.waitForTimeout(400);
  const pausedAfter = await videoState();
  record(1, 'Paused MP4 quality switch stays paused at the same position',
    pausedAfter.paused && Math.abs(pausedAfter.time - pausedBefore.time) < 0.1,
    { pausedBefore, pausedAfter },
  );
  await page.evaluate(() => { window.__proto.player.art.volume = 0.3; });
  const stored = await page.evaluate(() => localStorage.getItem('artplayer_settings'));
  record(1, 'Artplayer volume persistence is disabled (no localStorage writes)', stored === null, { stored });
  const ctxItems = await page.evaluate(() =>
    [...document.querySelectorAll('.art-contextmenu')].map((e) => e.className),
  );
  record(1, 'Context menu: version link and src info panel removed',
    !ctxItems.some((c) => c.includes('version') || c.includes('-info')), { ctxItems });

  // ---------------------------------------------------------- Gates 2 & 3
  for (const [proto, src, mime] of [
    ['HLS', `${base}/fixtures/hls/master.m3u8`, 'application/x-mpegurl'],
    ['DASH', `${base}/fixtures/dash/manifest.mpd`, 'application/dash+xml'],
  ]) {
    await open();
    await page.evaluate((a) => window.__proto.mount({ source: { kind: 'shaka', src: a.src, mimeType: a.mime } }), { src, mime });
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForFunction(() => document.querySelector('video').currentTime > 1, null, { timeout: 15000 });
    const qualities = await page.evaluate(() => window.__proto.player.qualities().map((q) => q.label));
    record(2, `${proto}: Shaka engine plays through the same Artplayer UI; manifest qualities listed`,
      JSON.stringify(qualities) === JSON.stringify(['Auto', '216p', '360p', '540p']), { qualities });

    await selectInUi('Quality', '216p');
    await page.waitForFunction(() => window.__proto.player.effectiveHeight() === 216, null, { timeout: 15000 });
    const abrOff = await page.evaluate(() => window.__proto.player.qualities().find((q) => q.id === 'auto').active === false);
    record(3, `${proto}: manual quality via UI disables ABR and switches effective rendition`, abrOff, {});
    await selectInUi('Quality', 'Auto');
    const abrOn = await page.evaluate(() => window.__proto.player.qualities().find((q) => q.id === 'auto').active);
    record(3, `${proto}: Auto via UI re-enables ABR`, abrOn, {});

    await selectInUi('Audio', 'Mongolian');
    await page.waitForTimeout(500);
    const audio = await page.evaluate(() => window.__proto.player.audioTracks().find((t) => t.active)?.label);
    record(3, `${proto}: audio track selection via UI`, audio === 'Mongolian', { audio });
    const heightAfterAudio = await page.evaluate(() => window.__proto.player.effectiveHeight());

    await selectInUi('Subtitles', 'English');
    await page.waitForFunction(
      () => (document.querySelector('.proto-text-container')?.textContent ?? '').includes('EN cue'),
      null,
      { timeout: 10000 },
    );
    record(3, `${proto}: manifest subtitle selection renders via Shaka UITextDisplayer inside the player DOM`, true, {});
    await selectInUi('Subtitles', 'Mongolian');
    await page.waitForFunction(
      () => (document.querySelector('.proto-text-container')?.textContent ?? '').includes('MN'),
      null,
      { timeout: 10000 },
    );
    record(3, `${proto}: switching between multiple subtitle tracks`, true, {});
    await selectInUi('Subtitles', 'Off');
    await page.waitForTimeout(2500);
    const textOff = await page.evaluate(() => ({
      active: window.__proto.player.textTracks().some((t) => t.active),
      shown: document.querySelector('.proto-text-container')?.textContent ?? '',
      nativeShowing: [...document.querySelector('video').textTracks].filter((t) => t.mode === 'showing').length,
    }));
    record(3, `${proto}: subtitles Off; no duplicate native rendering`, !textOff.active && textOff.shown.trim() === '' && textOff.nativeShowing === 0, { textOff, heightAfterAudio });
  }

  // ---------------------------------------------------------------- Gate 4
  await open();
  for (const fit of ['contain', 'cover']) {
    await page.evaluate(
      (a) => window.__proto.mount({ layout: 'reel', fit: a.fit, source: { kind: 'mp4', defaultId: 'p', variants: [{ id: 'p', label: 'p', height: 640, src: a.src }] } }),
      { fit, src: `${base}/fixtures/mp4/portrait.mp4` },
    );
    const layout = await page.evaluate(() => {
      const host = document.querySelector('.proto-host');
      const v = document.querySelector('video');
      const r = host.getBoundingClientRect();
      return { ratio: r.width / r.height, objectFit: getComputedStyle(v).objectFit, videoW: v.videoWidth, videoH: v.videoHeight, hostObjectFit: getComputedStyle(host).objectFit };
    });
    record(4, `Reel 9:16 layout with fit=${fit} on the video element`,
      Math.abs(layout.ratio - 9 / 16) < 0.01 && layout.objectFit === fit && layout.videoH > layout.videoW, layout);
  }

  // ---------------------------------------------------------- Gates 5 & 6
  await open();
  const before5 = await page.evaluate(() => ({ ...window.__proto.counters }));
  await page.evaluate((src) => window.__proto.mountReact({ kind: 'shaka', src, mimeType: 'application/x-mpegurl' }), `${base}/fixtures/hls/master.m3u8`);
  await page.waitForTimeout(3000);
  const mid = await page.evaluate(() => ({
    counters: { ...window.__proto.counters },
    react: { ...window.__proto.reactStats },
    videos: document.querySelectorAll('video').length,
    artPlayers: document.querySelectorAll('.art-video-player').length,
    events: window.__protoEvents ?? [],
  }));
  const liveShaka = mid.counters.shakaCreated - mid.counters.shakaDestroyed;
  record(5, 'StrictMode + ~60 rerenders with new inline objects/callbacks: no reload, one preroll',
    mid.react.renders > 40 && mid.counters.loads - before5.loads === 2 && mid.react.adStarts === 1,
    { ...mid, note: 'loads=2 is the Strict Mode development double-mount; rerenders add none' });
  record(6, 'Strict Mode cleanup leaves exactly one video, one Artplayer and one live Shaka engine',
    mid.videos === 1 && mid.artPlayers === 1 && liveShaka === 1, { liveShaka });
  await page.evaluate((v) => window.__protoReactSetSource({ kind: 'mp4', variants: v, defaultId: '360p' }), variants);
  await page.waitForTimeout(1500);
  const replaced = await page.evaluate(() => ({
    counters: { ...window.__proto.counters },
    videos: document.querySelectorAll('video').length,
    src: document.querySelector('video')?.currentSrc,
    react: { ...window.__proto.reactStats },
  }));
  record(6, 'Source replacement destroys the Shaka engine and keeps a single content video',
    replaced.videos === 1 && replaced.counters.shakaCreated === replaced.counters.shakaDestroyed && replaced.src.includes('vod-360p.mp4') && replaced.react.adStarts === 2,
    replaced);
  await page.evaluate(() => window.__proto.unmountReact());
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => ({
    counters: { ...window.__proto.counters },
    videos: document.querySelectorAll('video').length,
    artInstances: (window.Artplayer?.instances ?? []).length,
  }));
  record(6, 'Unmount tears everything down (no video, engines/UI destroyed == created)',
    end.videos === 0 && end.counters.artCreated === end.counters.artDestroyed && end.counters.shakaCreated === end.counters.shakaDestroyed,
    end);
} catch (err) {
  record(0, 'runner error', false, { error: String(err?.stack ?? err) });
} finally {
  const relevantErrors = consoleErrors.filter((e) => !e.includes('favicon'));
  const out = {
    date: new Date().toISOString(),
    browser: `Chromium ${browser.version()} (headless, Playwright ${(await import('@playwright/test/package.json', { with: { type: 'json' } })).default.version})`,
    platform: `${process.platform} ${process.arch}`,
    versions: {
      'shaka-player': JSON.parse(fs.readFileSync(path.join(here, '../../node_modules/shaka-player/package.json'), 'utf8')).version,
      artplayer: JSON.parse(fs.readFileSync(path.join(here, '../../node_modules/artplayer/package.json'), 'utf8')).version,
      react: JSON.parse(fs.readFileSync(path.join(here, '../../node_modules/react/package.json'), 'utf8')).version,
    },
    fixtures: JSON.parse(fs.readFileSync(path.join(here, '../../tests/fixtures/media/generated.json'), 'utf8')),
    results,
    consoleErrors: relevantErrors,
    gate7: 'externally unverified: no physical iPhone/iPad Safari device was available in this environment',
  };
  fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(out, null, 2));
  await browser.close();
  await srv.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; console errors: ${relevantErrors.length}`);
  process.exit(failed ? 1 : 0);
}
