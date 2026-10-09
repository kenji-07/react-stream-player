#!/usr/bin/env node
// Real-time synthetic live streams for tests (HLS and DASH, sliding DVR window).
// ffmpeg encodes lavfi test sources in real time, so the streams have a real,
// moving live edge and an expiring DVR window — unlike a looped VOD playlist.
//
// Low-latency note: a static file server cannot serve LL-HLS partial segments
// with blocking playlist reload or LL-DASH chunked transfer, so these fixtures
// are regular-latency live streams. `streaming.lowLatencyMode` is exercised for
// configuration mapping only; real LL streams must be verified externally.
//
// Usage (CLI): node scripts/live-fixtures.mjs [hls|dash|both] [--window 8]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const FONT = process.env.FIXTURE_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';

function codecArgs(codec) {
  if (codec === 'h264') {
    return {
      v: ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p'],
      a: ['-c:a', 'aac', '-b:a', '64k'],
      vStr: 'avc1.42c01e',
      aStr: 'mp4a.40.2',
    };
  }
  return {
    v: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p'],
    a: ['-c:a', 'libopus', '-b:a', '48k'],
    vStr: 'vp09.00.21.08',
    aStr: 'opus',
  };
}

function commonInputs(label) {
  return [
    '-re',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-filter_complex',
    `[0:v]drawtext=fontfile=${FONT}:text='${label} %{localtime\\:%H\\\\\\:%M\\\\\\:%S}':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6,split=2[a][b];[a]scale=384:216[v0];[b]null[v1]`,
    '-map', '[v0]', '-map', '[v1]', '-map', '1:a',
  ];
}

function encodeArgs(c) {
  return [
    ...c.v,
    '-b:v:0', '200k', '-b:v:1', '450k',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    ...c.a,
    '-metadata:s:a:0', 'language=en',
  ];
}

async function waitFor(check, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Starts one live stream.
 * @param {{protocol: 'hls'|'dash', dir?: string, windowSegments?: number, codec?: 'vp9'|'h264'}} options
 */
export async function startLive({ protocol, dir, windowSegments = 8, codec = process.env.FIXTURE_CODEC ?? 'vp9' }) {
  const out = dir ?? path.join(repoRoot, '.tmp/live', protocol);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const c = codecArgs(codec);
  let args;
  if (protocol === 'hls') {
    for (const v of ['stream_0', 'stream_1', 'stream_2']) fs.mkdirSync(path.join(out, v), { recursive: true });
    args = [
      '-hide_banner', '-loglevel', 'error',
      ...commonInputs('LIVE HLS'),
      ...encodeArgs(c),
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', String(windowSegments),
      '-hls_flags', 'delete_segments+independent_segments+program_date_time',
      '-hls_delete_threshold', '2',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-var_stream_map', 'v:0,agroup:aud v:1,agroup:aud a:0,agroup:aud,language:en,name:English',
      '-hls_segment_filename', path.join(out, 'stream_%v/seg_%05d.m4s'),
      path.join(out, 'stream_%v/index.m3u8'),
    ];
    fs.writeFileSync(
      path.join(out, 'master.m3u8'),
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="stream_2/index.m3u8"',
        `#EXT-X-STREAM-INF:BANDWIDTH=280000,RESOLUTION=384x216,FRAME-RATE=24.000,CODECS="${c.vStr},${c.aStr}",AUDIO="aud"`,
        'stream_0/index.m3u8',
        `#EXT-X-STREAM-INF:BANDWIDTH=550000,RESOLUTION=640x360,FRAME-RATE=24.000,CODECS="${c.vStr},${c.aStr}",AUDIO="aud"`,
        'stream_1/index.m3u8',
        '',
      ].join('\n'),
    );
  } else {
    args = [
      '-hide_banner', '-loglevel', 'error',
      ...commonInputs('LIVE DASH'),
      ...encodeArgs(c),
      '-f', 'dash', '-dash_segment_type', 'mp4', '-seg_duration', '2',
      '-window_size', String(windowSegments), '-extra_window_size', '2',
      '-use_template', '1', '-use_timeline', '1',
      '-adaptation_sets', 'id=0,streams=v id=1,streams=a',
      '-init_seg_name', 'init-$RepresentationID$.m4s',
      '-media_seg_name', 'chunk-$RepresentationID$-$Number%05d$.m4s',
      path.join(out, 'manifest.mpd'),
    ];
  }
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  let exited = false;
  proc.on('exit', () => (exited = true));

  const manifest = protocol === 'hls' ? path.join(out, 'stream_1/index.m3u8') : path.join(out, 'manifest.mpd');
  await waitFor(
    () => {
      if (exited) throw new Error(`ffmpeg exited early: ${stderr}`);
      if (!fs.existsSync(manifest)) return false;
      const text = fs.readFileSync(manifest, 'utf8');
      return protocol === 'hls' ? (text.match(/#EXTINF/g) ?? []).length >= 3 : /<S [^>]*r="[2-9]|<S[^>]*\/>\s*<S[^>]*\/>\s*<S/.test(text);
    },
    60_000,
    `${protocol} live manifest`,
  );
  return {
    protocol,
    dir: out,
    manifestPath: protocol === 'hls' ? 'master.m3u8' : 'manifest.mpd',
    stop() {
      return new Promise((resolve) => {
        if (exited) return resolve();
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 3000).unref();
      });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const which = process.argv[2] ?? 'both';
  const wIdx = process.argv.indexOf('--window');
  const windowSegments = wIdx > 0 ? Number(process.argv[wIdx + 1]) : 8;
  const protocols = which === 'both' ? ['hls', 'dash'] : [which];
  const streams = await Promise.all(protocols.map((protocol) => startLive({ protocol, windowSegments })));
  for (const s of streams) console.log(`[live] ${s.protocol} -> ${path.join(s.dir, s.manifestPath)}`);
  const stop = async () => {
    await Promise.all(streams.map((s) => s.stop()));
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
