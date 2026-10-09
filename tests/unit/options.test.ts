import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTKEYS, DEFAULT_PLAYBACK_RATES, DEFAULT_SUBTITLE_STYLE, DEFAULT_VOLUME, resolveOptions } from '../../src/controller/options.js';
import type { PlayerOptions } from '../../src/types/options.js';

const SOURCE = { src: '/a.mp4' } as const;

function resolve(options: Partial<PlayerOptions> = {}) {
  return resolveOptions({ source: SOURCE, ...options } as PlayerOptions);
}

describe('defaults (spec defaults table)', () => {
  const { resolved, issues } = resolve();
  it('has no issues for a minimal configuration', () => expect(issues).toEqual([]));
  it.each([
    ['defaultVolume', resolved.defaultVolume, 0.7],
    ['playbackRates', resolved.playbackRates, [0.5, 0.75, 1, 1.25, 1.5, 2]],
    ['defaultPlaybackRate', resolved.defaultPlaybackRate, 1],
    ['preload', resolved.preload, 'metadata'],
    ['fit', resolved.fit, 'contain'],
    ['objectPosition', resolved.objectPosition, '50% 50%'],
    ['aspectRatio', resolved.aspectRatio, '16 / 9'],
    ['seekStep', resolved.seekStep, 10],
    ['progressInterval', resolved.progressInterval, 1000],
    ['autoplay', resolved.autoplay, { enabled: false, mutedFallback: true }],
    ['loop', resolved.loop, false],
    ['playsInline', resolved.playsInline, true],
    ['layout', resolved.layout, 'standard'],
    ['locale', resolved.locale, 'en'],
    ['motion', resolved.motion, { enabled: true, durationMs: 200, easing: 'ease', reducedMotion: 'system' }],
    ['fullscreen', resolved.fullscreen, { mode: 'browser', fallbackToWeb: false }],
    ['contextMenu.enabled', resolved.contextMenu.enabled, true],
    ['hotkeys.enabled', resolved.hotkeys.enabled, true],
    ['hotkeys.volumeStep', resolved.hotkeys.volumeStep, 0.05],
    ['liveEdgeTolerance', resolved.liveEdgeTolerance, 3],
    ['pauseWhenHidden', resolved.pauseWhenHidden, false],
    ['airplay', resolved.airplay, true],
    ['pictureInPicture', resolved.pictureInPicture, true],
    ['mediaSession', resolved.mediaSession, {}],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toEqual(expected);
  });

  it('subtitle style defaults', () => {
    expect(resolved.subtitleStyle).toEqual({ fontSize: '20px', bottom: '40px', color: '#fff', backgroundColor: 'rgba(0, 0, 0, 0.6)', fontFamily: null });
    expect(DEFAULT_SUBTITLE_STYLE.fontSize).toBe('20px');
  });

  it('exports the same constants publicly', () => {
    expect(DEFAULT_VOLUME).toBe(0.7);
    expect([...DEFAULT_PLAYBACK_RATES]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it('controlled values stay undefined unless provided', () => {
    expect(resolved.volume).toBeUndefined();
    expect(resolved.muted).toBeUndefined();
    expect(resolved.playbackRate).toBeUndefined();
    expect(resolved.subtitleTrack).toBeUndefined();
    expect(resolved.quality).toBeUndefined();
  });
});

describe('layout-dependent defaults', () => {
  it('Reel defaults to 9:16', () => expect(resolve({ layout: 'reel' }).resolved.aspectRatio).toBe('9 / 16'));
  it('accepts numeric and CSS ratios', () => {
    expect(resolve({ aspectRatio: 1.5 }).resolved.aspectRatio).toBe('1.5');
    expect(resolve({ aspectRatio: '4/3' }).resolved.aspectRatio).toBe('4 / 3');
  });
  it('rejects invalid ratios with an issue', () => {
    const { resolved, issues } = resolve({ aspectRatio: 'wide' });
    expect(resolved.aspectRatio).toBe('16 / 9');
    expect(issues.map((i) => i.path)).toContain('aspectRatio');
  });
});

describe('validation', () => {
  it('rejects out-of-range volume and rates without throwing', () => {
    const { resolved, issues } = resolve({ defaultVolume: 2, playbackRate: -1, playbackRates: [] });
    expect(resolved.defaultVolume).toBe(0.7);
    expect(resolved.playbackRate).toBeUndefined();
    expect(resolved.playbackRates).toEqual([...DEFAULT_PLAYBACK_RATES]);
    expect(issues.map((i) => i.path).sort()).toEqual(['defaultVolume', 'playbackRate', 'playbackRates']);
  });

  it('deduplicates and sorts playback rates', () => {
    expect(resolve({ playbackRates: [2, 1, 1, 0.5] }).resolved.playbackRates).toEqual([0.5, 1, 2]);
  });

  it('clamps progressInterval to [100, 60000] ms', () => {
    expect(resolve({ progressInterval: 10 }).resolved.progressInterval).toBe(100);
    expect(resolve({ progressInterval: 120_000 }).resolved.progressInterval).toBe(60_000);
  });

  it('rejects CSS injection in subtitle styles, objectPosition and easing', () => {
    const { resolved, issues } = resolve({
      subtitleStyle: { color: 'red; background: url(https://x)', fontSize: '24px' },
      objectPosition: '0 0; display:none',
      motion: { easing: 'ease}body{display:none' },
    });
    expect(resolved.subtitleStyle.color).toBe('#fff');
    expect(resolved.subtitleStyle.fontSize).toBe('24px');
    expect(resolved.objectPosition).toBe('50% 50%');
    expect(resolved.motion.easing).toBe('ease');
    expect(issues.map((i) => i.path)).toContain('subtitleStyle.color');
  });

  it('rejects unsafe poster URLs', () => {
    expect(resolve({ poster: 'javascript:alert(1)' }).resolved.poster).toBeNull();
    expect(resolve({ poster: '/poster.jpg' }).resolved.poster).toBe('/poster.jpg');
  });

  it('autoplay object form keeps the muted fallback unless disabled', () => {
    expect(resolve({ autoplay: { enabled: true } }).resolved.autoplay).toEqual({ enabled: true, mutedFallback: true });
    expect(resolve({ autoplay: { enabled: true, mutedFallback: false } }).resolved.autoplay).toEqual({ enabled: true, mutedFallback: false });
  });

  it('caps fatalRetryLimit at 5', () => {
    expect(resolve({ network: { fatalRetryLimit: 50 } }).resolved.network.fatalRetryLimit).toBe(5);
  });
});

describe('subtitles', () => {
  it('accepts WebVTT only and reports other formats', () => {
    const { resolved, issues } = resolve({
      subtitles: [
        { id: 'en', src: '/en.vtt', label: 'English', language: 'en' },
        { id: 'srt', src: '/en.srt', label: 'SRT', language: 'en' },
        { id: 'ttml', src: '/en.vtt', label: 'TTML', language: 'en', format: 'ttml' as 'webvtt' },
        { id: 'en', src: '/dup.vtt', label: 'Dup', language: 'en' },
        { id: 'js', src: 'javascript:alert(1)', label: 'JS', language: 'en' },
      ],
    });
    expect(resolved.subtitles.map((s) => s.id)).toEqual(['en']);
    expect(issues).toHaveLength(4);
    expect(issues.filter((i) => i.code === 'subtitle-format-unsupported').map((i) => i.path)).toEqual(['subtitles[1]', 'subtitles[2]']);
  });
});

describe('streaming / abr / retry validation', () => {
  it('rebufferingGoal may not exceed bufferingGoal (Shaka default 10 s when omitted)', () => {
    const a = resolve({ streaming: { rebufferingGoal: 12 } });
    expect(a.resolved.streaming.rebufferingGoal).toBeUndefined();
    expect(a.issues[0]!.path).toBe('streaming.rebufferingGoal');
    const b = resolve({ streaming: { bufferingGoal: 30, rebufferingGoal: 12 } });
    expect(b.resolved.streaming).toEqual({ bufferingGoal: 30, rebufferingGoal: 12 });
  });

  it('validates retry policies (maxAttempts includes the first attempt, ≥ 1)', () => {
    const { resolved, issues } = resolve({ network: { retry: { segment: { maxAttempts: 0, baseDelayMs: 500, jitter: 2 } } } });
    expect(resolved.network.retry?.segment).toEqual({ baseDelayMs: 500 });
    expect(issues.map((i) => i.path).sort()).toEqual(['network.retry.segment.jitter', 'network.retry.segment.maxAttempts']);
  });

  it('validates liveSync rates and ABR restrictions', () => {
    const { resolved, issues } = resolve({
      streaming: { liveSync: { enabled: true, minPlaybackRate: 2, maxPlaybackRate: 1.1 } },
      abr: { restrictions: { minHeight: 720, maxHeight: 360 } },
    });
    expect(resolved.streaming.liveSync).toEqual({ enabled: true, maxPlaybackRate: 1.1 });
    expect(issues.map((i) => i.path).sort()).toEqual(['abr.restrictions', 'streaming.liveSync.minPlaybackRate']);
  });
});

describe('hotkeys', () => {
  it('ships the documented default bindings', () => {
    expect(DEFAULT_HOTKEYS[' ']).toBe('togglePlay');
    expect(DEFAULT_HOTKEYS.ArrowLeft).toBe('seekBackward');
    expect(DEFAULT_HOTKEYS.f).toBe('toggleFullscreen');
    expect(DEFAULT_HOTKEYS.m).toBe('toggleMute');
    expect(DEFAULT_HOTKEYS.c).toBe('toggleCaptions');
    expect(DEFAULT_HOTKEYS['5']).toBe('seekToPercent');
  });

  it('bindings can be overridden or removed with null', () => {
    const { resolved } = resolve({ hotkeys: { bindings: { f: null, x: 'toggleMute' } } });
    expect(resolved.hotkeys.bindings.f).toBeUndefined();
    expect(resolved.hotkeys.bindings.x).toBe('toggleMute');
    expect(resolved.hotkeys.bindings.m).toBe('toggleMute');
  });

  it('hotkeys: false disables the manager; seekSeconds follows seekStep', () => {
    expect(resolve({ hotkeys: false }).resolved.hotkeys.enabled).toBe(false);
    expect(resolve({ seekStep: 5 }).resolved.hotkeys.seekSeconds).toBe(5);
  });
});
