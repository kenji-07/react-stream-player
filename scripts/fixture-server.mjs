#!/usr/bin/env node
// Local HTTP server for deterministic tests, the integration prototype and the
// examples. It serves generated fixtures with HTTP Range support and exposes a
// few test-only routes:
//
//   /fixtures/*                 tests/fixtures/media (static, Range, CORS)
//   /live/<protocol>/*          output of scripts/live-fixtures.mjs
//   /signed/<path>?exp=&sig=    serves /fixtures/<path> only while exp (ms epoch) is in the future
//   /flaky/<n>/<path>           fails the first <n> requests for <path> with 503
//   /slow/<ms>/<path>           delays the response by <ms>
//   /vast/inline.xml            VAST fixture with __ORIGIN__ replaced
//   /license/clearkey           ClearKey JSON license server (development/testing only)
//   /redirect?to=<url>          302 redirect (credential-scoping tests)
//   /__log  /__log/reset        request log (method, path, auth-present flag)
//   /<anything else>            files from --root (default: repo root), e.g. harness pages
//
// Usage: node scripts/fixture-server.mjs [--port 4173] [--root <dir>]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mpd': 'application/dash+xml',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
};

// ClearKey test key (development/testing only; never a production secret).
export const CLEARKEY = {
  kid: 'nrQFDeRLSAKTLifXUIPiZg',
  key: 'FmY0xnWCPCNaSpRG-tUuTQ',
};

export function createFixtureServer({ root = repoRoot, liveDir, fixturesDir } = {}) {
  const fixtures = fixturesDir ?? path.join(repoRoot, 'tests/fixtures/media');
  const live = liveDir ?? path.join(repoRoot, '.tmp/live');
  const log = [];
  const flakyCounts = new Map();

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, X-Test-Header');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  }

  function sendFile(req, res, file, { transform } = {}) {
    let stat;
    try {
      stat = fs.statSync(file);
      if (stat.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = fs.statSync(file);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Cache-Control', 'no-store');
    if (transform) {
      const body = Buffer.from(transform(fs.readFileSync(file, 'utf8')));
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] ? Number(m[1]) : undefined;
        let end = m[2] ? Number(m[2]) : undefined;
        if (start === undefined) {
          start = stat.size - (end ?? 0);
          end = stat.size - 1;
        }
        end = Math.min(end ?? stat.size - 1, stat.size - 1);
        if (start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
        });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  function safeJoin(base, rel) {
    const target = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (!target.startsWith(path.resolve(base))) return null;
    return target;
  }

  const handler = (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === '/__log') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(log));
      return;
    }
    if (pathname === '/__log/reset') {
      log.length = 0;
      flakyCounts.clear();
      res.writeHead(204);
      res.end();
      return;
    }
    log.push({
      method: req.method,
      path: pathname,
      query: url.search,
      hasAuthorization: Boolean(req.headers.authorization),
      authorization: req.headers.authorization ? '[present]' : undefined,
      testHeader: req.headers['x-test-header'],
      cookie: Boolean(req.headers.cookie),
      range: req.headers.range,
      time: Date.now(),
    });

    let m;
    if ((m = /^\/fixtures\/(.*)$/.exec(pathname))) {
      const file = safeJoin(fixtures, m[1]);
      if (!file) return res.writeHead(400).end();
      return sendFile(req, res, file);
    }
    if ((m = /^\/live\/(.*)$/.exec(pathname))) {
      const file = safeJoin(live, m[1]);
      if (!file) return res.writeHead(400).end();
      return sendFile(req, res, file);
    }
    if ((m = /^\/signed\/(.*)$/.exec(pathname))) {
      const exp = Number(url.searchParams.get('exp'));
      if (!url.searchParams.get('sig') || !Number.isFinite(exp) || exp < Date.now()) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('expired or unsigned');
        return;
      }
      const file = safeJoin(fixtures, m[1]);
      if (!file) return res.writeHead(400).end();
      return sendFile(req, res, file);
    }
    if ((m = /^\/flaky\/(\d+)\/(.*)$/.exec(pathname))) {
      const failures = Number(m[1]);
      const key = m[2];
      const count = (flakyCounts.get(key) ?? 0) + 1;
      flakyCounts.set(key, count);
      if (count <= failures) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('flaky');
        return;
      }
      const file = safeJoin(fixtures, key);
      if (!file) return res.writeHead(400).end();
      return sendFile(req, res, file);
    }
    if ((m = /^\/slow\/(\d+)\/(.*)$/.exec(pathname))) {
      const ms = Number(m[1]);
      const file = safeJoin(fixtures, m[2]);
      const origin = `http://${req.headers.host}`;
      setTimeout(() => {
        if (res.destroyed) return;
        if (file?.endsWith('.xml')) sendFile(req, res, file, { transform: (s) => s.replaceAll('__ORIGIN__', origin) });
        else if (file) sendFile(req, res, file);
        else res.writeHead(400).end();
      }, ms);
      return;
    }
    if ((m = /^\/vast\/(.*)$/.exec(pathname))) {
      const name = m[1] === 'inline.xml' ? 'inline-linear.xml' : m[1];
      const file = safeJoin(path.join(fixtures, 'vast'), name);
      if (!file) return res.writeHead(400).end();
      const origin = `http://${req.headers.host}`;
      return sendFile(req, res, file, { transform: (s) => s.replaceAll('__ORIGIN__', origin) });
    }
    if (pathname === '/license/clearkey') {
      if (url.searchParams.get('requireAuth') && req.headers.authorization !== 'Bearer test-license-token') {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let kids = [CLEARKEY.kid];
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed.kids) && parsed.kids.length) kids = parsed.kids;
        } catch {
          /* fall back to the fixture key id */
        }
        const keys = kids.filter((kid) => kid === CLEARKEY.kid).map((kid) => ({ kty: 'oct', kid, k: CLEARKEY.key }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys, type: 'temporary' }));
      });
      return;
    }
    if (pathname === '/redirect') {
      const to = url.searchParams.get('to');
      if (!to) return res.writeHead(400).end();
      res.writeHead(302, { Location: to });
      res.end();
      return;
    }
    const file = safeJoin(root, pathname);
    if (!file) return res.writeHead(400).end();
    return sendFile(req, res, file);
  };

  const server = http.createServer(handler);
  return {
    server,
    log,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const port = Number(get('--port', process.env.PORT ?? 4173));
  const root = path.resolve(get('--root', repoRoot));
  const srv = createFixtureServer({ root });
  srv.listen(port, get('--host', '127.0.0.1')).then((p) => {
    console.log(`[fixture-server] http://127.0.0.1:${p} (root: ${root})`);
  });
}
