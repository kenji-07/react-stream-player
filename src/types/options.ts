import type { TranslationOverrides } from '../ui/i18n.js';
import type { AdsConfig } from './ads.js';
import type {
  AbrConfig,
  AdvancedConfig,
  AutoplayConfig,
  CastConfig,
  ContextMenuConfig,
  DrmConfig,
  Fit,
  FullscreenConfig,
  HotkeysConfig,
  Layout,
  LiveConfig,
  Locale,
  MediaSessionConfig,
  MotionConfig,
  NetworkConfig,
  StreamingConfig,
  SubtitleStyle,
  UiMode,
  WatermarkConfig,
} from './config.js';
import type { PlayerSource } from './source.js';
import type { SubtitleTrack } from './tracks.js';

/**
 * Framework-independent player options. The React `<Player>` accepts these as
 * props (plus event callbacks). Every option documents whether a change
 * applies immediately or requires a controlled engine reload (docs/api.md).
 */
export interface PlayerOptions {
  /** The video to play. `null` unloads. */
  source: PlayerSource | null;
  /** Default `"artplayer"`. Changing it rebuilds the UI layer (not the engine). */
  ui?: UiMode;
  /** Default `"standard"`. `"reel"` is a single portrait video (no feed). */
  layout?: Layout;
  poster?: string;
  /** Accessible name of the player region. */
  title?: string;

  /** Uncontrolled initial volume, 0–1. Default 0.7. */
  defaultVolume?: number;
  /** Controlled volume, 0–1. Use with `onVolumeChange`. */
  volume?: number;
  /** Default `false`. */
  defaultMuted?: boolean;
  muted?: boolean;
  /** Default 1. */
  defaultPlaybackRate?: number;
  playbackRate?: number;
  /** Rates offered in the prebuilt menu and by `>`/`<`. Default `[0.5, 0.75, 1, 1.25, 1.5, 2]`. */
  playbackRates?: number[];

  /** Default `false`. `true` = `{ enabled: true, mutedFallback: true }`. */
  autoplay?: boolean | AutoplayConfig;
  /** Default `false`. */
  loop?: boolean;
  /** Default `"metadata"`. */
  preload?: 'none' | 'metadata' | 'auto';
  /** Default `true`. */
  playsInline?: boolean;
  /** CSS object-fit on the video element. Default `"contain"`. */
  fit?: Fit;
  /** CSS object-position on the video element. Default `"50% 50%"`. */
  objectPosition?: string;
  /** CSS aspect-ratio of the player box. Default `"16 / 9"` (standard) or `"9 / 16"` (reel). */
  aspectRatio?: string | number;
  /** Seconds for seek actions. Default 10. */
  seekStep?: number;
  /** Milliseconds between `progress` events. Default 1000. */
  progressInterval?: number;
  /** Default enabled. */
  contextMenu?: boolean | ContextMenuConfig;

  subtitles?: SubtitleTrack[];
  /** Controlled subtitle selection; `null` = off. */
  subtitleTrack?: string | null;
  defaultSubtitleTrack?: string | null;
  defaultSubtitleLanguage?: string;
  subtitleStyle?: SubtitleStyle;

  /** Controlled quality selection (`"auto"` or a quality ID). */
  quality?: 'auto' | string;
  defaultQuality?: 'auto' | string;
  /** Controlled audio track ID. */
  audioTrack?: string;
  defaultAudioLanguage?: string;

  streaming?: StreamingConfig;
  abr?: AbrConfig;
  network?: NetworkConfig;
  drm?: DrmConfig;
  advanced?: AdvancedConfig;
  live?: LiveConfig;
  ads?: AdsConfig;
  /** Allowed custom deep-link schemes for ad click-through (http(s)/relative are always allowed). */
  clickThroughSchemes?: string[];

  /** Default enabled. */
  hotkeys?: boolean | HotkeysConfig;
  fullscreen?: FullscreenConfig;
  motion?: MotionConfig;
  locale?: Locale;
  translations?: TranslationOverrides;
  mediaSession?: MediaSessionConfig;
  cast?: CastConfig;
  /** Offer AirPlay where the WebKit target-picker API exists. Default `true`. */
  airplay?: boolean;
  /** Offer picture-in-picture where supported. Default `true`. */
  pictureInPicture?: boolean;
  watermark?: WatermarkConfig;
  /** Pause when the page becomes hidden. Default `false`. */
  pauseWhenHidden?: boolean;
  /** Clicking the video area does not toggle playback (controls still work). Default `false`. */
  preventClickToggle?: boolean;
  /** CSP nonce applied to `<script>` elements the package injects (IMA, Cast). */
  nonce?: string;
}
