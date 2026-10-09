import { describe, expect, it } from 'vitest';
import { buildCatalog, statusCounts, type RawCategory } from '../../examples/nextjs/components/samples/catalog.js';
import { sameOrigin } from '../../examples/nextjs/components/samples/proxy.js';
import data from '../../examples/nextjs/components/samples/samples.json';
import { resolveOptions } from '../../src/controller/options.js';
import { normalizeSource } from '../../src/controller/source.js';
import type { PlayerOptions } from '../../src/types/options.js';

const raw = data as RawCategory[];
const catalog = buildCatalog(raw, { corsUrl: sameOrigin });
const byName = (category: string, name: string) => {
  const entry = catalog.find((e) => e.category === category && e.name === name);
  if (!entry) throw new Error(`missing ${category} / ${name}`);
  return entry;
};

describe('public sample catalog', () => {
  it('accounts for every sample exactly once, in input order, with unique ids', () => {
    const total = raw.reduce((n, c) => n + c.samples.length, 0);
    expect(total).toBe(128);
    expect(catalog).toHaveLength(total);
    expect(new Set(catalog.map((e) => e.id)).size).toBe(total);
    expect(catalog.map((e) => `${e.category}/${e.name}`)).toEqual(raw.flatMap((c) => c.samples.map((s) => `${c.name}/${s.name}`)));
  });

  it('every unsupported sample has no player config and a reason; every other one has a config', () => {
    for (const entry of catalog) {
      if (entry.status === 'unsupported') {
        expect(entry.config, entry.id).toBeNull();
        expect(entry.notes[0], entry.id).toBeTruthy();
      } else {
        expect(entry.config, entry.id).not.toBeNull();
      }
    }
  });

  it('every loadable config is a valid player source and produces only the documented option issues', () => {
    for (const entry of catalog.filter((e) => e.config)) {
      const config = entry.config!;
      const normalized = normalizeSource(config.source!);
      expect(normalized.ok, `${entry.id}: ${normalized.ok ? '' : normalized.error.message}`).toBe(true);
      expect(config.source && 'id' in config.source ? config.source.id : null).toBe(entry.id);
      const { issues } = resolveOptions(config as PlayerOptions);
      const nonVtt = entry.raw.subtitle_uri && entry.raw.subtitle_mime_type !== 'text/vtt';
      if (nonVtt) {
        expect(issues.map((i) => i.code), entry.id).toEqual(['subtitle-format-unsupported']);
        expect(entry.status).toBe('expected-error');
      } else {
        expect(issues, entry.id).toEqual([]);
      }
    }
  });

  it('classifies what the package cannot load, with the reason', () => {
    const unsupported = catalog.filter((e) => e.status === 'unsupported');
    // 5 Playlists + 1 IMA playlist + 13 DAI (incl. playlists) + 2 MSS + 8 images + 2 encrypted progressive AV1.
    expect(unsupported).toHaveLength(31);
    for (const e of unsupported.filter((x) => x.raw.playlist)) expect(e.notes[0]).toMatch(/Playlists are out of scope/);
    expect(byName('IMA DAI streams', 'HLS Live: Big Buck Bunny (mid), 3 ads [10/10/10s]').notes[0]).toMatch(/IMA DAI/);
    expect(byName('SmoothStreaming', 'Super speed (MP4, H264, PlayReady)').notes[0]).toMatch(/Smooth Streaming/);
    expect(byName('Images', 'HEIC motion photo (motion)').notes[0]).toMatch(/motion photos/);
    expect(byName('AV1', 'SD (WebM, Widevine cenc, L3)').notes[0]).toMatch(/drm-progressive-unsupported/);
  });

  it('maps DRM samples to Widevine with the given license URL', () => {
    const e = byName('Widevine DASH (MP4, H264)', 'HD (cenc)');
    expect(e.status).toBe('drm');
    expect(e.config!.source).toMatchObject({ src: 'https://storage.googleapis.com/wvmedia/cenc/h264/tears/tears.mpd', type: 'dash' });
    expect(e.config!.drm).toEqual({ keySystems: { 'com.widevine.alpha': { licenseUrl: 'https://proxy.uat.widevine.com/proxy?video_id=2015_tears&provider=widevine_test' } } });
    expect(byName('Widevine DASH (policy tests)', 'HW secure all (L1)').status).toBe('expected-error');
    expect(byName('Widevine DASH (policy tests)', '30s license (fails at ~30s)').status).toBe('expected-error');
    expect(byName('Widevine DASH (policy tests)', 'SW secure decode').status).toBe('drm');
    expect(byName('Widevine DASH (MP4, H265)', 'HD (cenc)').status).toBe('drm');
    expect(byName('Widevine DASH (MP4, H265)', 'HD (cenc)').notes.join(' ')).toMatch(/HEVC/);
  });

  it('maps ad samples to the IMA pipeline and progressive containers to the native engine', () => {
    const e = byName('IMA sample ad tags', 'Single inline linear');
    expect(e.config!.ads).toEqual({ vast: { adTagUrl: e.raw.ad_tag_uri } });
    expect(e.config!.source).toMatchObject({ type: 'mp4' }); // .mkv needs an explicit progressive type
    expect(e.status).toBe('codec-dependent');
    expect(byName('IMA sample ad tags', 'Single redirect error').status).toBe('expected-error');
    expect(byName('IMA sample ad tags', 'VMAP midroll at 1765 s').config!.source).not.toHaveProperty('type');
    expect(byName('Progressive', 'Apple 10s (TS)').status).toBe('expected-error');
    expect(byName('Progressive', 'Google Play (MP3)').config!.source).toMatchObject({ type: 'mp4' });
    expect(byName('Progressive', 'Screens 360p (WebM, VP9)').status).toBe('playable');
    expect(byName('HLS', 'Apple multivariant playlist advanced (FMP4)').config!.source).toMatchObject({ type: 'hls' });
  });

  it('routes only WebVTT subtitle URLs through the CORS rewrite; other formats are rejected by the player', () => {
    const vtt = byName('Subtitles', 'WebVTT Japanese features');
    expect(vtt.config!.subtitles).toEqual([
      { id: 'sample', src: '/sample-media/exoplayer-test-media-1/webvtt/japanese.vtt', label: '日本語 (WebVTT Japanese features)', language: 'ja' },
    ]);
    expect(vtt.config!.defaultSubtitleTrack).toBe('sample');
    expect(vtt.status).toBe('playable');
    const ttml = byName('Subtitles', 'TTML positioning');
    expect(ttml.config!.subtitles![0]!.src).toBe(ttml.raw.subtitle_uri);
    for (const e of catalog.filter((x) => x.config)) {
      // Media URLs stay direct; only CORS-dependent subtitle files are rewritten.
      expect(String((e.config!.source as { src?: unknown }).src ?? '')).toMatch(/^https:\/\//);
    }
  });

  it('status counts (update deliberately when the classification changes)', () => {
    expect(statusCounts(catalog)).toEqual({ playable: 29, 'codec-dependent': 34, drm: 23, 'expected-error': 11, unsupported: 31 });
  });
});

describe('same-origin rewrite for CORS-less buckets', () => {
  it('maps only the two exoplayer-test-media buckets', () => {
    expect(sameOrigin('https://storage.googleapis.com/exoplayer-test-media-1/webvtt/japanese.vtt')).toBe('/sample-media/exoplayer-test-media-1/webvtt/japanese.vtt');
    expect(sameOrigin('https://storage.googleapis.com/exoplayer-test-media-0/play.mp3')).toBe('/sample-media/exoplayer-test-media-0/play.mp3');
    expect(sameOrigin('https://storage.googleapis.com/wvmedia/clear/h264/tears/tears.mpd')).toBe('https://storage.googleapis.com/wvmedia/clear/h264/tears/tears.mpd');
    expect(sameOrigin('https://storage.googleapis.com/exoplayer-test-media-10/x')).toBe('https://storage.googleapis.com/exoplayer-test-media-10/x');
    expect(sameOrigin('https://evil.example/exoplayer-test-media-1/x')).toBe('https://evil.example/exoplayer-test-media-1/x');
  });
});
