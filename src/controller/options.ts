import { isAllowedResourceUrl, pathnameOf } from '../security/url.js';
import type {
  AbrConfig,
  ContextMenuAction,
  Fit,
  FullscreenMode,
  HotkeyAction,
  RetryPolicy,
  StreamingConfig,
  SubtitleStyle,
} from '../types/config.js';
import type { PlayerOptions } from '../types/options.js';
import type { SubtitleTrack } from '../types/tracks.js';
import { clamp, isFiniteNumber } from '../utils/equal.js';

export const DEFAULT_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const DEFAULT_VOLUME = 0.7;
export const DEFAULT_SUBTITLE_STYLE: Required<Omit<SubtitleStyle, 'fontFamily'>> & { fontFamily: string | null } = {
  fontSize: '20px',
  bottom: '40px',
  color: '#fff',
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  fontFamily: null,
};
const FITS: Fit[] = ['contain', 'cover', 'fill', 'none', 'scale-down'];
const ALL_CONTEXT_ACTIONS: ContextMenuAction[] = ['playbackRate', 'fullscreen', 'captions', 'loop', 'copyDiagnostics'];

export const DEFAULT_HOTKEYS: Record<string, HotkeyAction> = {
  ' ': 'togglePlay',
  k: 'togglePlay',
  K: 'togglePlay',
  ArrowLeft: 'seekBackward',
  j: 'seekBackward',
  J: 'seekBackward',
  ArrowRight: 'seekForward',
  l: 'seekForward',
  L: 'seekForward',
  ArrowUp: 'volumeUp',
  ArrowDown: 'volumeDown',
  Home: 'seekToStart',
  End: 'seekToEnd',
  f: 'toggleFullscreen',
  F: 'toggleFullscreen',
  m: 'toggleMute',
  M: 'toggleMute',
  c: 'toggleCaptions',
  C: 'toggleCaptions',
  '>': 'nextRate',
  '<': 'previousRate',
  Escape: 'exitWebFullscreen',
  '0': 'seekToPercent',
  '1': 'seekToPercent',
  '2': 'seekToPercent',
  '3': 'seekToPercent',
  '4': 'seekToPercent',
  '5': 'seekToPercent',
  '6': 'seekToPercent',
  '7': 'seekToPercent',
  '8': 'seekToPercent',
  '9': 'seekToPercent',
};

export interface ResolvedOptions {
  layout: 'standard' | 'reel';
  poster: string | null;
  title: string | null;
  defaultVolume: number;
  volume: number | undefined;
  defaultMuted: boolean;
  muted: boolean | undefined;
  defaultPlaybackRate: number;
  playbackRate: number | undefined;
  playbackRates: number[];
  autoplay: { enabled: boolean; mutedFallback: boolean };
  loop: boolean;
  preload: 'none' | 'metadata' | 'auto';
  playsInline: boolean;
  fit: Fit;
  objectPosition: string;
  aspectRatio: string;
  seekStep: number;
  progressInterval: number;
  contextMenu: { enabled: boolean; actions: ContextMenuAction[] };
  subtitles: SubtitleTrack[];
  /** `undefined` = uncontrolled. */
  subtitleTrack: string | null | undefined;
  defaultSubtitleTrack: string | null | undefined;
  defaultSubtitleLanguage: string | null;
  subtitleStyle: typeof DEFAULT_SUBTITLE_STYLE;
  quality: string | undefined;
  defaultQuality: string | undefined;
  audioTrack: string | undefined;
  defaultAudioLanguage: string | null;
  streaming: StreamingConfig;
  abr: AbrConfig;
  network: NonNullable<PlayerOptions['network']>;
  drm: PlayerOptions['drm'];
  advanced: NonNullable<PlayerOptions['advanced']>;
  liveEdgeTolerance: number;
  ads: PlayerOptions['ads'];
  clickThroughSchemes: string[];
  hotkeys: { enabled: boolean; seekSeconds: number; volumeStep: number; fullscreenMode: FullscreenMode; bindings: Record<string, HotkeyAction> };
  fullscreen: { mode: FullscreenMode; fallbackToWeb: boolean };
  motion: { enabled: boolean; durationMs: number; easing: string; reducedMotion: 'system' | 'always' | 'never' };
  locale: 'en' | 'mn';
  translations: PlayerOptions['translations'];
  mediaSession: NonNullable<PlayerOptions['mediaSession']>;
  cast: NonNullable<PlayerOptions['cast']>;
  airplay: boolean;
  pictureInPicture: boolean;
  watermark: PlayerOptions['watermark'];
  pauseWhenHidden: boolean;
  preventClickToggle: boolean;
  nonce: string | null;
}

export interface OptionIssue {
  path: string;
  message: string;
  /** Specific error code; defaults to `invalid-config`. */
  code?: 'subtitle-format-unsupported';
}

function num(value: unknown, path: string, issues: OptionIssue[], check: (n: number) => boolean, rule: string): number | undefined {
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || !check(value)) {
    issues.push({ path, message: `${path} must be ${rule}` });
    return undefined;
  }
  return value;
}

const nonNegative = (n: number) => n >= 0;

function normalizeAspectRatio(value: string | number | undefined, layout: 'standard' | 'reel', issues: OptionIssue[]): string {
  const fallback = layout === 'reel' ? '9 / 16' : '16 / 9';
  if (value === undefined) return fallback;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) return String(value);
    issues.push({ path: 'aspectRatio', message: 'aspectRatio must be a positive number' });
    return fallback;
  }
  const trimmed = value.trim();
  const m = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/.exec(trimmed);
  if (m && Number(m[1]) > 0 && (m[2] === undefined || Number(m[2]) > 0)) return m[2] ? `${m[1]} / ${m[2]}` : m[1]!;
  issues.push({ path: 'aspectRatio', message: 'aspectRatio must be a CSS ratio such as "16 / 9" or a number' });
  return fallback;
}

export function validateRetryPolicy(policy: RetryPolicy | undefined, path: string, issues: OptionIssue[]): RetryPolicy | undefined {
  if (!policy) return undefined;
  const out: RetryPolicy = {};
  const maxAttempts = num(policy.maxAttempts, `${path}.maxAttempts`, issues, (n) => Number.isInteger(n) && n >= 1, 'an integer ≥ 1');
  if (maxAttempts !== undefined) out.maxAttempts = maxAttempts;
  const fields: [keyof RetryPolicy, (n: number) => boolean, string][] = [
    ['baseDelayMs', nonNegative, '≥ 0'],
    ['backoffFactor', (n) => n >= 1, '≥ 1'],
    ['jitter', (n) => n >= 0 && n <= 1, 'between 0 and 1'],
    ['timeoutMs', nonNegative, '≥ 0'],
    ['connectionTimeoutMs', nonNegative, '≥ 0'],
    ['stallTimeoutMs', nonNegative, '≥ 0'],
  ];
  for (const [key, check, rule] of fields) {
    const v = num(policy[key], `${path}.${key}`, issues, check, rule);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Shaka 5.2.12 default bufferingGoal, used to validate rebufferingGoal when bufferingGoal is omitted. */
const SHAKA_DEFAULT_BUFFERING_GOAL = 10;

export function validateStreaming(streaming: StreamingConfig | undefined, issues: OptionIssue[]): StreamingConfig {
  if (!streaming) return {};
  const out: StreamingConfig = {};
  const secondsKeys = [
    'bufferingGoal',
    'rebufferingGoal',
    'bufferBehind',
    'gapDetectionThreshold',
    'gapJumpTimerTime',
    'stallThreshold',
    'stallSkip',
    'loadTimeout',
  ] as const;
  for (const key of secondsKeys) {
    const v = num(streaming[key], `streaming.${key}`, issues, nonNegative, 'a number ≥ 0 (seconds)');
    if (v !== undefined) out[key] = v;
  }
  const prefetch = num(streaming.segmentPrefetchLimit, 'streaming.segmentPrefetchLimit', issues, (n) => Number.isInteger(n) && n >= 0, 'an integer ≥ 0');
  if (prefetch !== undefined) out.segmentPrefetchLimit = prefetch;
  for (const key of ['lowLatencyMode', 'stallEnabled', 'preferNativeHls', 'useNativeHlsForFairPlay'] as const) {
    if (streaming[key] !== undefined) {
      if (typeof streaming[key] === 'boolean') out[key] = streaming[key];
      else issues.push({ path: `streaming.${key}`, message: `streaming.${key} must be a boolean` });
    }
  }
  const goal = out.bufferingGoal ?? SHAKA_DEFAULT_BUFFERING_GOAL;
  if (out.rebufferingGoal !== undefined && out.rebufferingGoal > goal) {
    issues.push({ path: 'streaming.rebufferingGoal', message: `streaming.rebufferingGoal (${out.rebufferingGoal}) must not exceed bufferingGoal (${goal})` });
    delete out.rebufferingGoal;
  }
  if (streaming.liveSync) {
    const ls = streaming.liveSync;
    const liveSync: NonNullable<StreamingConfig['liveSync']> = {};
    if (ls.enabled !== undefined) liveSync.enabled = Boolean(ls.enabled);
    const t = num(ls.targetLatency, 'streaming.liveSync.targetLatency', issues, nonNegative, '≥ 0 (seconds)');
    if (t !== undefined) liveSync.targetLatency = t;
    const tol = num(ls.targetLatencyTolerance, 'streaming.liveSync.targetLatencyTolerance', issues, nonNegative, '≥ 0 (seconds)');
    if (tol !== undefined) liveSync.targetLatencyTolerance = tol;
    const min = num(ls.minPlaybackRate, 'streaming.liveSync.minPlaybackRate', issues, (n) => n > 0 && n <= 1, 'in (0, 1]');
    if (min !== undefined) liveSync.minPlaybackRate = min;
    const max = num(ls.maxPlaybackRate, 'streaming.liveSync.maxPlaybackRate', issues, (n) => n >= 1, '≥ 1');
    if (max !== undefined) liveSync.maxPlaybackRate = max;
    out.liveSync = liveSync;
  }
  return out;
}

export function validateAbr(abr: AbrConfig | undefined, issues: OptionIssue[]): AbrConfig {
  if (!abr) return {};
  const out: AbrConfig = {};
  if (abr.enabled !== undefined) out.enabled = Boolean(abr.enabled);
  const bw = num(abr.defaultBandwidthEstimate, 'abr.defaultBandwidthEstimate', issues, (n) => n > 0, '> 0 (bits per second)');
  if (bw !== undefined) out.defaultBandwidthEstimate = bw;
  const si = num(abr.switchInterval, 'abr.switchInterval', issues, nonNegative, '≥ 0 (seconds)');
  if (si !== undefined) out.switchInterval = si;
  if (abr.restrictToElementSize !== undefined) out.restrictToElementSize = Boolean(abr.restrictToElementSize);
  if (abr.restrictToScreenSize !== undefined) out.restrictToScreenSize = Boolean(abr.restrictToScreenSize);
  if (abr.restrictions) {
    const r = abr.restrictions;
    const restrictions: NonNullable<AbrConfig['restrictions']> = {};
    for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'minBandwidth', 'maxBandwidth', 'maxFrameRate'] as const) {
      const v = num(r[key], `abr.restrictions.${key}`, issues, nonNegative, '≥ 0');
      if (v !== undefined) restrictions[key] = v;
    }
    if (restrictions.minHeight !== undefined && restrictions.maxHeight !== undefined && restrictions.minHeight > restrictions.maxHeight) {
      issues.push({ path: 'abr.restrictions', message: 'minHeight must not exceed maxHeight' });
    }
    out.restrictions = restrictions;
  }
  return out;
}

const UNSUPPORTED_SUBTITLE_EXT = /\.(srt|ass|ssa|ttml|dfxp|xml|sbv|sub|smi)$/i;

export function validateSubtitles(subtitles: SubtitleTrack[] | undefined, issues: OptionIssue[]): SubtitleTrack[] {
  if (!subtitles) return [];
  if (!Array.isArray(subtitles)) {
    issues.push({ path: 'subtitles', message: 'subtitles must be an array' });
    return [];
  }
  const seen = new Set<string>();
  const out: SubtitleTrack[] = [];
  subtitles.forEach((track, index) => {
    const path = `subtitles[${index}]`;
    if (!track || typeof track.id !== 'string' || !track.id) {
      issues.push({ path, message: `${path}.id must be a non-empty string` });
      return;
    }
    if (seen.has(track.id)) {
      issues.push({ path, message: `${path}.id "${track.id}" is duplicated` });
      return;
    }
    if (track.format !== undefined && track.format !== 'webvtt') {
      issues.push({ path, message: `${path}: only WebVTT external subtitles are supported`, code: 'subtitle-format-unsupported' });
      return;
    }
    if (typeof track.src === 'string') {
      if (!isAllowedResourceUrl(track.src)) {
        issues.push({ path, message: `${path}.src must be an http(s), relative or blob: URL` });
        return;
      }
      if (UNSUPPORTED_SUBTITLE_EXT.test(pathnameOf(track.src))) {
        issues.push({ path, message: `${path}: only WebVTT external subtitles are supported`, code: 'subtitle-format-unsupported' });
        return;
      }
    } else if (!(typeof Blob !== 'undefined' && track.src instanceof Blob)) {
      issues.push({ path, message: `${path}.src must be a URL or a Blob` });
      return;
    }
    if (typeof track.label !== 'string' || typeof track.language !== 'string') {
      issues.push({ path, message: `${path} needs string label and language` });
      return;
    }
    seen.add(track.id);
    out.push(track);
  });
  return out;
}

export function resolveOptions(options: PlayerOptions): { resolved: ResolvedOptions; issues: OptionIssue[] } {
  const issues: OptionIssue[] = [];
  const layout = options.layout === 'reel' ? 'reel' : 'standard';
  if (options.layout !== undefined && options.layout !== 'reel' && options.layout !== 'standard') {
    issues.push({ path: 'layout', message: 'layout must be "standard" or "reel"' });
  }
  const unit = (n: number) => n >= 0 && n <= 1;
  const defaultVolume = num(options.defaultVolume, 'defaultVolume', issues, unit, 'between 0 and 1') ?? DEFAULT_VOLUME;
  const volume = num(options.volume, 'volume', issues, unit, 'between 0 and 1');

  let playbackRates: number[] = [...DEFAULT_PLAYBACK_RATES];
  if (options.playbackRates !== undefined) {
    const valid = Array.isArray(options.playbackRates) && options.playbackRates.length > 0 && options.playbackRates.every((r) => isFiniteNumber(r) && r > 0 && r <= 16);
    if (valid) playbackRates = [...new Set(options.playbackRates)].sort((a, b) => a - b);
    else issues.push({ path: 'playbackRates', message: 'playbackRates must be a non-empty array of positive numbers ≤ 16' });
  }
  const rateCheck = (n: number) => n > 0 && n <= 16;
  const defaultPlaybackRate = num(options.defaultPlaybackRate, 'defaultPlaybackRate', issues, rateCheck, 'a positive number') ?? 1;
  const playbackRate = num(options.playbackRate, 'playbackRate', issues, rateCheck, 'a positive number');

  const autoplay =
    typeof options.autoplay === 'object' && options.autoplay !== null
      ? { enabled: Boolean(options.autoplay.enabled), mutedFallback: options.autoplay.mutedFallback !== false }
      : { enabled: options.autoplay === true, mutedFallback: true };

  let fit: Fit = 'contain';
  if (options.fit !== undefined) {
    if (FITS.includes(options.fit)) fit = options.fit;
    else issues.push({ path: 'fit', message: `fit must be one of ${FITS.join(', ')}` });
  }
  const preload = options.preload === 'none' || options.preload === 'auto' ? options.preload : 'metadata';

  const contextMenu =
    options.contextMenu === false
      ? { enabled: false, actions: [] as ContextMenuAction[] }
      : typeof options.contextMenu === 'object' && options.contextMenu !== null
        ? {
            enabled: options.contextMenu.enabled !== false,
            actions: (options.contextMenu.actions ?? ALL_CONTEXT_ACTIONS).filter((a) => ALL_CONTEXT_ACTIONS.includes(a)),
          }
        : { enabled: true, actions: ALL_CONTEXT_ACTIONS };

  const hotkeyInput = typeof options.hotkeys === 'object' && options.hotkeys !== null ? options.hotkeys : {};
  const fullscreenMode: FullscreenMode = options.fullscreen?.mode === 'web' ? 'web' : 'browser';
  const bindings: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEYS };
  for (const [key, action] of Object.entries(hotkeyInput.bindings ?? {})) {
    if (action === null) delete bindings[key];
    else if (typeof action === 'string') bindings[key] = action;
  }
  const seekStep = num(options.seekStep, 'seekStep', issues, (n) => n > 0, 'a positive number of seconds') ?? 10;

  const motionInput = options.motion ?? {};
  const durationMs = num(motionInput.durationMs, 'motion.durationMs', issues, nonNegative, '≥ 0') ?? 200;

  const subtitleStyle = { ...DEFAULT_SUBTITLE_STYLE };
  for (const key of ['fontSize', 'bottom', 'color', 'backgroundColor', 'fontFamily'] as const) {
    const v = options.subtitleStyle?.[key];
    if (v === undefined) continue;
    if (typeof v === 'string' && v.length < 200 && !/[;{}<>]|url\s*\(|expression\s*\(/i.test(v)) subtitleStyle[key] = v;
    else issues.push({ path: `subtitleStyle.${key}`, message: `subtitleStyle.${key} must be a plain CSS value` });
  }

  const network = { ...(options.network ?? {}) };
  if (network.retry) {
    network.retry = {
      manifest: validateRetryPolicy(network.retry.manifest, 'network.retry.manifest', issues),
      segment: validateRetryPolicy(network.retry.segment, 'network.retry.segment', issues),
      license: validateRetryPolicy(network.retry.license, 'network.retry.license', issues),
    };
  }
  if (network.fatalRetryLimit !== undefined) {
    const limit = num(network.fatalRetryLimit, 'network.fatalRetryLimit', issues, (n) => Number.isInteger(n) && n >= 0, 'an integer ≥ 0');
    network.fatalRetryLimit = limit === undefined ? undefined : Math.min(limit, 5);
  }

  const resolved: ResolvedOptions = {
    layout,
    poster: typeof options.poster === 'string' && isAllowedResourceUrl(options.poster) ? options.poster : null,
    title: typeof options.title === 'string' ? options.title : null,
    defaultVolume,
    volume,
    defaultMuted: options.defaultMuted === true,
    muted: typeof options.muted === 'boolean' ? options.muted : undefined,
    defaultPlaybackRate,
    playbackRate,
    playbackRates,
    autoplay,
    loop: options.loop === true,
    preload,
    playsInline: options.playsInline !== false,
    fit,
    objectPosition: typeof options.objectPosition === 'string' && !/[;{}<>]/.test(options.objectPosition) ? options.objectPosition : '50% 50%',
    aspectRatio: normalizeAspectRatio(options.aspectRatio, layout, issues),
    seekStep,
    progressInterval: clamp(num(options.progressInterval, 'progressInterval', issues, (n) => n > 0, 'a positive number of milliseconds') ?? 1000, 100, 60_000),
    contextMenu,
    subtitles: validateSubtitles(options.subtitles, issues),
    subtitleTrack: options.subtitleTrack,
    defaultSubtitleTrack: options.defaultSubtitleTrack,
    defaultSubtitleLanguage: typeof options.defaultSubtitleLanguage === 'string' ? options.defaultSubtitleLanguage : null,
    subtitleStyle,
    quality: options.quality,
    defaultQuality: options.defaultQuality,
    audioTrack: options.audioTrack,
    defaultAudioLanguage: typeof options.defaultAudioLanguage === 'string' ? options.defaultAudioLanguage : null,
    streaming: validateStreaming(options.streaming, issues),
    abr: validateAbr(options.abr, issues),
    network,
    drm: options.drm,
    advanced: options.advanced ?? {},
    liveEdgeTolerance: num(options.live?.edgeTolerance, 'live.edgeTolerance', issues, nonNegative, '≥ 0 (seconds)') ?? 3,
    ads: options.ads,
    clickThroughSchemes: Array.isArray(options.clickThroughSchemes) ? options.clickThroughSchemes.filter((s) => typeof s === 'string') : [],
    hotkeys: {
      enabled: options.hotkeys !== false && hotkeyInput.enabled !== false,
      seekSeconds: num(hotkeyInput.seekSeconds, 'hotkeys.seekSeconds', issues, (n) => n > 0, 'positive') ?? seekStep,
      volumeStep: num(hotkeyInput.volumeStep, 'hotkeys.volumeStep', issues, (n) => n > 0 && n <= 1, 'in (0, 1]') ?? 0.05,
      fullscreenMode: hotkeyInput.fullscreenMode === 'web' || hotkeyInput.fullscreenMode === 'browser' ? hotkeyInput.fullscreenMode : fullscreenMode,
      bindings,
    },
    fullscreen: { mode: fullscreenMode, fallbackToWeb: options.fullscreen?.fallbackToWeb === true },
    motion: {
      enabled: motionInput.enabled !== false,
      durationMs,
      easing: typeof motionInput.easing === 'string' && !/[;{}<>]/.test(motionInput.easing) ? motionInput.easing : 'ease',
      reducedMotion: motionInput.reducedMotion === 'always' || motionInput.reducedMotion === 'never' ? motionInput.reducedMotion : 'system',
    },
    locale: options.locale === 'mn' ? 'mn' : 'en',
    translations: options.translations,
    mediaSession: options.mediaSession ?? {},
    cast: options.cast ?? {},
    airplay: options.airplay !== false,
    pictureInPicture: options.pictureInPicture !== false,
    watermark: options.watermark,
    pauseWhenHidden: options.pauseWhenHidden === true,
    preventClickToggle: options.preventClickToggle === true,
    nonce: typeof options.nonce === 'string' ? options.nonce : null,
  };
  return { resolved, issues };
}
