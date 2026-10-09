#!/usr/bin/env node
// Consumer smoke tests against the PACKED artifact (npm pack), never the
// workspace sources:
//   1. tarball contents (exports, types, CSS, maps, notices; no src/tests)
//   2. server import + renderToString in plain Node (React 19.0.0, the minimum peer)
//   3. Vite + React 19.0.0 app: strict tsc against the installed types, build,
//      measured chunks (Shaka/Artplayer must be lazy), browser playback, and a
//      check that native MP4 never loads the Shaka chunk
//   4. Next.js 16 App Router app (examples/nextjs): next build, next start,
//      SSR HTML, hydration without errors, playback, Shaka loaded only for HLS
//
// Usage: node scripts/consumer-smoke.mjs [--only=pack,server,vite,next] [--keep]
// Requires network access to the npm registry and generated fixtures
// (npm run fixtures). Results: docs/evidence/consumer-smoke.json
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.tmp/consumers');
const fixtures = path.join(root, 'tests/fixtures/media');
const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'pack,server,vite,next').split(',');
const keep = process.argv.includes('--keep');
const results = { date: new Date().toISOString(), node: process.version, steps: {} };
// Strings that occur only in the vendor libraries (never in this package's
// own dist, which references e.g. `shaka.Player` in its engine adapter):
// Shaka's HLS parser tag and Artplayer's storage key. Minifiers keep both.
const SHAKA_SIGNATURE = /EXT-X-STREAM-INF/;
const ARTPLAYER_SIGNATURE = /artplayer_settings/;

function log(...args) {
  console.log('[consumers]', ...args);
}

function run(cmd, args, cwd, extra = {}) {
  log(`$ ${cmd} ${args.join(' ')}  (${path.relative(root, cwd) || '.'})`);
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...extra });
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file)).length;
}

function copyFixtures(to) {
  assert(fs.existsSync(path.join(fixtures, 'generated.json')), 'fixtures missing: run `npm run fixtures`');
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(fixtures, to, { recursive: true });
}

function staticServer(dir, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.m3u8': 'application/x-mpegurl', '.mpd': 'application/dash+xml', '.m4s': 'video/iso.segment', '.vtt': 'text/vtt', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return void res.writeHead(404).end();
    const data = fs.readFileSync(file);
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    const type = types[path.extname(file)] ?? 'application/octet-stream';
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return void res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': data.length });
    res.end(data);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function launchBrowser() {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
}

/** Opens a page that records every script response body and console error. */
async function instrumentedPage(browser) {
  const page = await browser.newPage();
  const scripts = new Map();
  const errors = [];
  page.on('response', async (response) => {
    const type = response.request().resourceType();
    if (type !== 'script') return;
    try {
      scripts.set(response.url(), await response.text());
    } catch {
      /* navigation raced the body */
    }
  });
  page.on('console', (msg) => {
    // The test apps ship no favicon; every other failed request counts.
    if (msg.type() === 'error' && !/favicon\.ico$/.test(msg.location().url ?? '')) errors.push(`${msg.text()} ${msg.location().url ?? ''}`.trim());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return { page, scripts, errors };
}

const loaded = (scripts, signature) => [...scripts.values()].some((text) => signature.test(text));

async function waitForPlayback(page, seconds, selector = 'video') {
  await page.waitForFunction(
    ({ selector, seconds }) => {
      const v = document.querySelector(selector);
      return v instanceof HTMLVideoElement && v.currentTime > seconds && !v.paused;
    },
    { selector, seconds },
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------- 1. pack
function pack() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  // Build explicitly, then pack without lifecycle scripts so stdout is pure JSON.
  run('npm', ['run', 'build', '--silent'], root);
  const out = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], root));
  const info = out[0];
  const tarball = path.join(work, info.filename);
  const files = info.files.map((f) => f.path);
  const required = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/index.js', 'dist/index.d.ts', 'dist/index.js.map', 'dist/core.js', 'dist/core.d.ts', 'dist/styles.css'];
  for (const file of required) assert(files.includes(file), `tarball is missing ${file}`);
  const forbidden = files.filter((f) => /^(src|tests|examples|scripts|docs)\//.test(f) || /\.tgz$|\.env/.test(f));
  assert(forbidden.length === 0, `tarball contains unexpected files: ${forbidden.join(', ')}`);
  results.steps.pack = { ok: true, tarball: info.filename, packedSize: info.size, unpackedSize: info.unpackedSize, fileCount: info.entryCount };
  log(`packed ${info.filename}: ${info.entryCount} files, ${(info.size / 1024).toFixed(1)} KiB`);
  return tarball;
}

// ---------------------------------------------------------------- 2. server import
function serverImport(tarball) {
  const dir = path.join(work, 'server');
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), { name: 'rsp-server-consumer', private: true, type: 'module' });
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', tarball, 'react@19.0.0', 'react-dom@19.0.0'], dir);
  fs.writeFileSync(
    path.join(dir, 'check.mjs'),
    `import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const before = Object.keys(globalThis).sort().join(',');
const pkg = await import('react-stream-player');
const core = await import('react-stream-player/core');
const after = Object.keys(globalThis).sort().join(',');
if (before !== after) throw new Error('importing the package defined globals');
if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('DOM globals appeared');
const css = import.meta.resolve('react-stream-player/styles.css');
const manifest = (await import('react-stream-player/package.json', { with: { type: 'json' } })).default;
const html = renderToString(createElement(pkg.Player, { source: { src: '/a.mp4' }, layout: 'reel' }));
if (!html.includes('rsp-root') || html.includes('<video')) throw new Error('unexpected SSR output: ' + html);
let threw = false;
try { core.createPlayer({}, { source: null }); } catch { threw = true; }
if (!threw) throw new Error('createPlayer must refuse to run on the server');
console.log(JSON.stringify({ exports: Object.keys(pkg).sort(), coreExports: Object.keys(core).sort(), css: css.endsWith('/dist/styles.css'), version: manifest.version, html }));
`,
  );
  const output = JSON.parse(run(process.execPath, ['check.mjs'], dir).trim().split('\n').at(-1));
  assert(output.css, 'styles.css export does not resolve to dist/styles.css');

  // Static import graph of the entry: no static path to Shaka/Artplayer/IMA.
  const distDir = path.join(dir, 'node_modules/react-stream-player/dist');
  const seen = new Set();
  const bare = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec));
      else bare.add(spec);
    }
  };
  visit(path.join(distDir, 'index.js'));
  const staticVendors = [...bare].filter((s) => /shaka|artplayer/.test(s));
  assert(staticVendors.length === 0, `entry statically imports ${staticVendors.join(', ')}`);
  results.steps.server = { ok: true, react: '19.0.0', exports: output.exports, coreExports: output.coreExports, staticBareImports: [...bare].sort(), ssrHtml: output.html };
  log('server import OK; static bare imports:', [...bare].join(', '));
}

// ---------------------------------------------------------------- 3. Vite
async function vite(tarball) {
  const dir = path.join(work, 'vite');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    name: 'rsp-vite-consumer',
    private: true,
    type: 'module',
    scripts: { build: 'vite build' },
  });
  writeJson(path.join(dir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      noEmit: true,
      // Our declarations are checked with skipLibCheck off in a separate pass below.
      skipLibCheck: true,
      types: [],
    },
    include: ['src'],
  });
  fs.writeFileSync(path.join(dir, 'vite.config.js'), `import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [react()], build: { sourcemap: false } });\n`);
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>rsp vite</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`);
  fs.writeFileSync(path.join(dir, 'src/css.d.ts'), `declare module '*.css';\n`);
  fs.writeFileSync(
    path.join(dir, 'src/main.tsx'),
    `import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, type PlayerRef, type PlayerSource } from 'react-stream-player';
import 'react-stream-player/styles.css';

const example = new URLSearchParams(location.search).get('example') ?? 'mp4';
const sources: Record<string, PlayerSource> = {
  mp4: { id: 'mp4', type: 'mp4', variants: [{ id: '216p', label: '216p', height: 216, src: '/media/mp4/vod-216p.mp4' }, { id: '360p', label: '360p', height: 360, src: '/media/mp4/vod-360p.mp4' }] },
  hls: { src: '/media/hls/master.m3u8', type: 'hls' },
  native: { src: '/media/mp4/vod-216p.mp4', type: 'mp4' },
};

function App() {
  const ref = useRef<PlayerRef>(null);
  return (
    <Player
      ref={ref}
      source={sources[example] ?? null}
      ui={example === 'native' ? 'native' : 'artplayer'}
      autoplay={{ enabled: true, mutedFallback: true }}
      subtitles={[{ id: 'en', src: '/media/subs/en.vtt', label: 'English', language: 'en' }]}
      onReady={(info) => { (window as unknown as { __ready: unknown }).__ready = info; }}
      onError={(error) => console.error('player error', error.code)}
    />
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`,
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', tarball, 'react@19.0.0', 'react-dom@19.0.0', '@types/react@~19.0.0', '@types/react-dom@~19.0.0', 'vite@8.3.4', '@vitejs/plugin-react@6.1.2', 'typescript@~6.0.3'], dir);

  // Consumer typecheck (strict, exactOptionalPropertyTypes) against installed types.
  run(process.execPath, [path.join(dir, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], dir);
  // Our own declarations must also pass with skipLibCheck off.
  fs.writeFileSync(path.join(dir, 'src/types-only.ts'), `export type { PlayerProps, PlayerRef, PlayerOptions } from 'react-stream-player';\nexport type { PlayerHandle } from 'react-stream-player/core';\n`);
  writeJson(path.join(dir, 'tsconfig.lib.json'), {
    extends: './tsconfig.json',
    compilerOptions: { skipLibCheck: false, types: [] },
    include: ['src/types-only.ts'],
  });
  run(process.execPath, [path.join(dir, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.lib.json'], dir);

  run('npm', ['run', 'build', '--silent'], dir);
  const assets = path.join(dir, 'dist/assets');
  const chunks = fs.readdirSync(assets).filter((f) => f.endsWith('.js'));
  const html = fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8');
  const entry = chunks.find((c) => html.includes(c));
  assert(entry, 'entry chunk not found');
  const describe = (c) => {
    const text = fs.readFileSync(path.join(assets, c), 'utf8');
    return { file: c, bytes: Buffer.byteLength(text), gzip: gzipSize(path.join(assets, c)), shaka: SHAKA_SIGNATURE.test(text), artplayer: ARTPLAYER_SIGNATURE.test(text), entry: c === entry };
  };
  const measured = chunks.map(describe).sort((a, b) => b.bytes - a.bytes);
  const entryInfo = measured.find((c) => c.entry);
  assert(!entryInfo.shaka, 'Shaka is in the entry chunk');
  assert(!entryInfo.artplayer, 'Artplayer is in the entry chunk');
  assert(measured.some((c) => c.shaka && !c.entry), 'no lazy Shaka chunk');
  assert(measured.some((c) => c.artplayer && !c.entry), 'no lazy Artplayer chunk');

  copyFixtures(path.join(dir, 'dist/media'));
  const port = 4190;
  const server = await staticServer(path.join(dir, 'dist'), port);
  const browser = await launchBrowser();
  const runtime = {};
  try {
    for (const example of ['native', 'mp4', 'hls']) {
      const { page, scripts, errors } = await instrumentedPage(browser);
      await page.goto(`http://127.0.0.1:${port}/?example=${example}`);
      await page.waitForFunction(() => (window).__ready, null, { timeout: 30_000 });
      await waitForPlayback(page, 0.5);
      const shaka = loaded(scripts, SHAKA_SIGNATURE);
      const artplayer = loaded(scripts, ARTPLAYER_SIGNATURE);
      const videos = await page.evaluate(() => document.querySelectorAll('video').length);
      runtime[example] = { shakaLoaded: shaka, artplayerLoaded: artplayer, scripts: scripts.size, videos, consoleErrors: errors };
      assert(errors.length === 0, `${example}: console errors ${JSON.stringify(errors)}`);
      assert(videos === 1, `${example}: expected one <video> under StrictMode, found ${videos}`);
      if (example === 'hls') assert(shaka, 'HLS did not load Shaka');
      else assert(!shaka, `${example}: native MP4 loaded the Shaka chunk`);
      if (example === 'native') assert(!artplayer, 'native UI loaded Artplayer');
      else assert(artplayer, `${example}: Artplayer UI not loaded`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  results.steps.vite = { ok: true, versions: { react: '19.0.0', vite: '8.3.4', '@vitejs/plugin-react': '6.1.2', typescript: '~6.0.3' }, chunks: measured, runtime };
  log('vite OK:', measured.map((c) => `${c.file} ${(c.gzip / 1024).toFixed(1)} KiB gz${c.entry ? ' [entry]' : ''}${c.shaka ? ' [shaka]' : ''}${c.artplayer ? ' [artplayer]' : ''}`).join(' | '));
}

// ---------------------------------------------------------------- 4. Next.js
async function next(tarball) {
  const dir = path.join(work, 'next');
  const src = path.join(root, 'examples/nextjs');
  fs.cpSync(src, dir, { recursive: true, filter: (f) => !/node_modules|\.next|public[\\/]media/.test(path.relative(src, f)) });
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.dependencies['react-stream-player'] = `file:${tarball}`;
  writeJson(path.join(dir, 'package.json'), pkg);
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  copyFixtures(path.join(dir, 'public/media'));
  const buildLog = run(process.execPath, [path.join(dir, 'node_modules/next/dist/bin/next'), 'build'], dir, { env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  const port = 4191;
  // Own process group: `next start` forks next-server, which must not outlive the check.
  const server = spawn(process.execPath, [path.join(dir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: dir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const stopServer = () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  let serverOutput = '';
  server.stdout.on('data', (d) => (serverOutput += d));
  server.stderr.on('data', (d) => (serverOutput += d));
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(base);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 60_000) {
      stopServer();
      throw new Error(`next start did not come up:\n${serverOutput}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  let browser;
  try {
    const ssrHtml = await (await fetch(base)).text();
    assert(ssrHtml.includes('rsp-root'), 'server-rendered HTML lacks the player shell');
    assert(!ssrHtml.includes('<video'), 'server-rendered HTML contains a video element');
    browser = await launchBrowser();
  } catch (error) {
    stopServer();
    throw error;
  }
  const runtime = {};
  try {
    const { page, scripts, errors } = await instrumentedPage(browser);
    await page.goto(base);
    // Default example: MP4 qualities (Artplayer UI, native engine).
    await page.waitForSelector('.art-video-player', { timeout: 30_000 });
    await page.locator('.art-video-player .art-state').click();
    await waitForPlayback(page, 0.5);
    runtime.mp4 = { shakaLoaded: loaded(scripts, SHAKA_SIGNATURE), artplayerLoaded: loaded(scripts, ARTPLAYER_SIGNATURE), videos: await page.evaluate(() => document.querySelectorAll('video').length) };
    assert(!runtime.mp4.shakaLoaded, 'Next: native MP4 example loaded Shaka');
    assert(runtime.mp4.artplayerLoaded, 'Next: Artplayer UI not loaded');
    assert(runtime.mp4.videos === 1, `Next: expected one <video> under reactStrictMode, found ${runtime.mp4.videos}`);
    // Switch to HLS: Shaka is loaded on demand; the previous player is destroyed.
    await page.getByRole('button', { name: 'HLS VOD' }).click();
    await page.waitForFunction(() => document.querySelector('h2')?.textContent === 'HLS VOD');
    await page.waitForSelector('.art-video-player', { timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.locator('.art-video-player .art-state').click();
    await waitForPlayback(page, 0.5);
    runtime.hls = { shakaLoaded: loaded(scripts, SHAKA_SIGNATURE), videos: await page.evaluate(() => document.querySelectorAll('video').length) };
    assert(runtime.hls.shakaLoaded, 'Next: HLS example did not load Shaka');
    assert(runtime.hls.videos === 1, 'Next: previous player not cleaned up');
    const hydration = errors.filter((e) => /hydrat|did not match/i.test(e));
    runtime.consoleErrors = errors;
    assert(hydration.length === 0, `Next: hydration errors ${JSON.stringify(hydration)}`);
    assert(errors.length === 0, `Next: console errors ${JSON.stringify(errors)}`);
  } finally {
    await browser.close();
    stopServer();
  }
  const routeTable = buildLog.split('\n').filter((l) => /^[┌├└│○ƒ●]|First Load|Route/.test(l.trim()));
  const nextVersion = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/next/package.json'), 'utf8')).version;
  const reactVersion = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/react/package.json'), 'utf8')).version;
  results.steps.next = { ok: true, versions: { next: nextVersion, react: reactVersion }, routeTable, runtime };
  log(`next ${nextVersion} OK`);
}

try {
  const tarball = pack();
  if (only.includes('server')) serverImport(tarball);
  if (only.includes('vite')) await vite(tarball);
  if (only.includes('next')) await next(tarball);
  results.ok = true;
} catch (error) {
  results.ok = false;
  results.error = String(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
} finally {
  writeJson(path.join(root, 'docs/evidence/consumer-smoke.json'), results);
  if (!keep && results.ok) fs.rmSync(work, { recursive: true, force: true });
  log(results.ok ? 'ALL CONSUMER CHECKS PASSED' : 'CONSUMER CHECKS FAILED', '→ docs/evidence/consumer-smoke.json');
}
