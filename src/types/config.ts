// Public configuration types. Adaptive-streaming options use Shaka Player's
// documented names and units (verified against shaka-player 5.2.12); they are
// ignored by the native progressive-MP4 path, which reports them as
// unsupported in `getCapabilities()`.

/** Seconds-based buffering/streaming options mapped 1:1 to Shaka `streaming.*`. */
export interface StreamingConfig {
  /** Seconds of media the engine tries to keep buffered ahead (a target, not a RAM cap). Shaka default 10. */
  bufferingGoal?: number;
  /** Seconds that must be buffered to start or resume after a stall. Must not exceed `bufferingGoal`. Shaka default 0. */
  rebufferingGoal?: number;
  /** Seconds kept behind the playhead (minimum; segment boundaries may keep more). Shaka default 30. */
  bufferBehind?: number;
  /** Enables Shaka's low-latency behaviour for streams that signal LL-HLS/LL-DASH. Shaka 5.2.12 default `true`. */
  lowLatencyMode?: boolean;
  /** Seconds; gaps smaller than this are jumped. Shaka default 0.5. */
  gapDetectionThreshold?: number;
  /** Seconds between gap checks. Shaka default 0.25. */
  gapJumpTimerTime?: number;
  /** Enables stall detection/recovery. Shaka default `true`. */
  stallEnabled?: boolean;
  /** Seconds without progress before a stall is declared. Shaka default 1. */
  stallThreshold?: number;
  /** Seconds to skip forward to recover from a stall (0 = re-seek in place). Shaka default 0.1. */
  stallSkip?: number;
  /** Number of segments to prefetch per stream. Shaka default 1. */
  segmentPrefetchLimit?: number;
  /** Seconds before a load attempt times out. Shaka default 30. */
  loadTimeout?: number;
  /** Live-edge synchronisation (catch-up playback rate). Maps to `streaming.liveSync`. */
  liveSync?: {
    enabled?: boolean;
    /** Seconds. */
    targetLatency?: number;
    /** Seconds. */
    targetLatencyTolerance?: number;
    minPlaybackRate?: number;
    maxPlaybackRate?: number;
  };
  /** Prefer the browser's native HLS over MSE (Shaka `streaming.preferNativeHls`). Default `false`. */
  preferNativeHls?: boolean;
  /** Use native HLS for FairPlay (Shaka `streaming.useNativeHlsForFairPlay`). Default `true`. */
  useNativeHlsForFairPlay?: boolean;
}

export interface QualityRestrictions {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Bits per second. */
  minBandwidth?: number;
  /** Bits per second. */
  maxBandwidth?: number;
  maxFrameRate?: number;
}

/** Adaptive bitrate options (Shaka `abr.*`). Manual quality selection disables ABR until "auto" is selected again. */
export interface AbrConfig {
  /** Whether Auto may switch renditions. `quality` selections still take precedence. */
  enabled?: boolean;
  /** Initial bandwidth estimate in bits per second. Shaka default 1e6. */
  defaultBandwidthEstimate?: number;
  restrictions?: QualityRestrictions;
  /** Restrict ABR to renditions no larger than the video element. Shaka default `false`. */
  restrictToElementSize?: boolean;
  /** Restrict ABR to the screen size. Shaka default `false`. */
  restrictToScreenSize?: boolean;
  /** Minimum seconds between ABR upgrades. Shaka default 8. */
  switchInterval?: number;
}

/**
 * Standardised retry policy. Mapped to Shaka `retryParameters`:
 * maxAttempts→maxAttempts (includes the first attempt), baseDelayMs→baseDelay,
 * backoffFactor→backoffFactor, jitter→fuzzFactor, timeoutMs→timeout,
 * connectionTimeoutMs→connectionTimeout, stallTimeoutMs→stallTimeout.
 * Shaka 5.2.12 defaults: 2 attempts, 1000 ms, ×2, 0.5, 30000 ms, 10000 ms, 5000 ms.
 */
export interface RetryPolicy {
  /** Total attempts including the first one. Integer ≥ 1. */
  maxAttempts?: number;
  baseDelayMs?: number;
  backoffFactor?: number;
  /** 0–1: random ± fraction applied to each delay. */
  jitter?: number;
  /** 0 disables the timeout. */
  timeoutMs?: number;
  connectionTimeoutMs?: number;
  stallTimeoutMs?: number;
}

/** Request categories as distinguished by the adaptive engine's networking layer. */
export type RequestType =
  | 'manifest'
  | 'segment'
  | 'license'
  | 'certificate'
  | 'subtitle'
  | 'image'
  | 'key'
  | 'other';

/** Mutable view of an outgoing request passed to `network.onRequest`. */
export interface NetworkRequest {
  readonly type: RequestType;
  /** Request URLs (Shaka may try several). Replace to re-sign. */
  uris: string[];
  method: string;
  headers: Record<string, string>;
  /** Send cookies/credentials cross-origin. */
  withCredentials: boolean;
}

export interface NetworkResponse {
  readonly type: RequestType;
  /** Final URL after redirects. */
  readonly uri: string;
  readonly originalUri: string;
  readonly status: number | undefined;
  readonly headers: Record<string, string>;
  /** Response body. Replace to transform. */
  data: ArrayBuffer;
}

/**
 * Attach credentials only to explicitly allowed origins and request types.
 * Headers are never added to any other origin (including ad and analytics
 * origins). See docs/security.md for redirect behaviour.
 */
export interface CredentialRule {
  /** Exact origins, e.g. `https://cdn.example.com`. No wildcards. */
  origins: string[];
  /** Request types this rule applies to. Default: all except `license` (use `drm` for licenses). */
  requestTypes?: RequestType[];
  /** Static headers or a callback returning headers (e.g. a short-lived token). */
  headers?: Record<string, string> | ((context: { type: RequestType; url: string }) => Record<string, string> | Promise<Record<string, string>>);
  /** Send cookies (`allowCrossSiteCredentials`). Default `false`. */
  withCredentials?: boolean;
}

export interface NetworkConfig {
  retry?: {
    manifest?: RetryPolicy;
    segment?: RetryPolicy;
    license?: RetryPolicy;
  };
  credentials?: CredentialRule[];
  /** Called for every adaptive-engine request after credential rules. Not called for native MP4 playback. */
  onRequest?: (request: NetworkRequest) => void | Promise<void>;
  /** Called for every adaptive-engine response. */
  onResponse?: (response: NetworkResponse) => void | Promise<void>;
  /**
   * What to do when a credentialed request ends on an origin outside the
   * allowlist after redirects. `"error"` (default) fails the request.
   */
  credentialedRedirect?: 'error' | 'allow';
  /** CORS mode for the native `<video>` element. Default `"anonymous"` when credentials are not needed. */
  crossOrigin?: 'anonymous' | 'use-credentials' | null;
  /** Automatic reload attempts after a fatal network/source error. Default 1, maximum 5. */
  fatalRetryLimit?: number;
}

export type KeySystem = 'com.widevine.alpha' | 'com.microsoft.playready' | 'com.apple.fps' | 'org.w3.clearkey';

export interface KeySystemConfig {
  licenseUrl: string;
  /** Raw server certificate (FairPlay requires one; Widevine optional). */
  serverCertificate?: Uint8Array | ArrayBuffer;
  /** URL Shaka fetches the certificate from (request type `certificate`). */
  serverCertificateUrl?: string;
  /** Static headers sent with license requests for this key system. */
  headers?: Record<string, string>;
  videoRobustness?: string[];
  audioRobustness?: string[];
  persistentStateRequired?: boolean;
  distinctiveIdentifierRequired?: boolean;
  sessionType?: string;
}

/** Binary-safe license request passed to `drm.transformLicenseRequest`. */
export interface LicenseRequest {
  readonly keySystem: string;
  uris: string[];
  headers: Record<string, string>;
  /** Raw challenge (e.g. SPC for FairPlay). Replace to wrap. */
  body: Uint8Array;
  /** e.g. `"license-request"`, `"license-renewal"`, `"individualization-request"`. */
  readonly messageType: string | null;
  readonly initDataType: string | null;
  readonly initData: Uint8Array | null;
}

/** Binary-safe license response passed to `drm.transformLicenseResponse`. */
export interface LicenseResponse {
  readonly keySystem: string;
  readonly uri: string;
  readonly headers: Record<string, string>;
  /** Raw license (e.g. CKC for FairPlay). Replace to unwrap. */
  data: Uint8Array;
}

export interface DrmConfig {
  keySystems: Partial<Record<KeySystem, KeySystemConfig>>;
  preferredKeySystems?: KeySystem[];
  /**
   * ClearKey key map (hex key id → hex key). DEVELOPMENT/TESTING ONLY — the
   * keys are visible to anyone who can read the page.
   */
  clearKeys?: Record<string, string>;
  /** Supplies a short-lived license token, sent as `Authorization: Bearer <token>`. */
  getLicenseToken?: (context: { keySystem: string }) => Promise<string | null> | string | null;
  transformLicenseRequest?: (request: LicenseRequest) => LicenseRequest | void | Promise<LicenseRequest | void>;
  transformLicenseResponse?: (response: LicenseResponse) => LicenseResponse | void | Promise<LicenseResponse | void>;
  /**
   * FairPlay content-ID/init-data handling (maps to Shaka `drm.initDataTransform`).
   * Return the init data to use.
   */
  initDataTransform?: (initData: Uint8Array, initDataType: string, info: { keySystem: string; serverCertificate: Uint8Array | null }) => Uint8Array;
}

/**
 * Version-specific escape hatch merged into the Shaka configuration BEFORE the
 * package's own high-level settings, which therefore win on conflicts. Keys
 * that would bypass ownership (`textDisplayFactory`, `abrFactory`,
 * `streaming.failureCallback`, `drm.servers`, `drm.advanced`) are rejected.
 */
export interface AdvancedConfig {
  shaka?: Record<string, unknown>;
}

export interface SubtitleStyle {
  /** CSS length. Default `"20px"`. */
  fontSize?: string;
  /** CSS length from the bottom of the video area. Default `"40px"`. */
  bottom?: string;
  /** CSS color. Default `"#fff"`. */
  color?: string;
  /** CSS color. Default `"rgba(0, 0, 0, 0.6)"`. Overrides cue-defined backgrounds. */
  backgroundColor?: string;
  fontFamily?: string;
}

export interface MotionConfig {
  enabled?: boolean;
  /** Milliseconds. Default 200. */
  durationMs?: number;
  /** CSS easing. Default `"ease"`. */
  easing?: string;
  /** `"system"` follows `prefers-reduced-motion`. Default `"system"`. */
  reducedMotion?: 'system' | 'always' | 'never';
}

/** IDs of actions the package registers in the prebuilt context menu. */
export type ContextMenuAction = 'playbackRate' | 'fullscreen' | 'captions' | 'loop' | 'copyDiagnostics';

export interface ContextMenuConfig {
  enabled?: boolean;
  /** Default: all supported actions. */
  actions?: ContextMenuAction[];
}

export type FullscreenMode = 'browser' | 'web';

export interface FullscreenConfig {
  /** Mode used by the UI button and the F hotkey. Default `"browser"`. */
  mode?: FullscreenMode;
  /** When browser fullscreen is unavailable or rejected, fall back to web fullscreen. Default `false`. */
  fallbackToWeb?: boolean;
}

export type HotkeyAction =
  | 'togglePlay'
  | 'seekBackward'
  | 'seekForward'
  | 'volumeUp'
  | 'volumeDown'
  | 'seekToPercent'
  | 'seekToStart'
  | 'seekToEnd'
  | 'toggleFullscreen'
  | 'toggleMute'
  | 'toggleCaptions'
  | 'nextRate'
  | 'previousRate'
  | 'exitWebFullscreen';

export interface HotkeysConfig {
  enabled?: boolean;
  /** Seconds. Default: the `seekStep` prop (10). */
  seekSeconds?: number;
  /** 0–1. Default 0.05. */
  volumeStep?: number;
  /** Fullscreen mode for the F key. Default: `fullscreen.mode`. */
  fullscreenMode?: FullscreenMode;
  /** Override key → action bindings (`KeyboardEvent.key` values). `null` unbinds. */
  bindings?: Partial<Record<string, HotkeyAction | null>>;
}

export interface AutoplayConfig {
  enabled: boolean;
  /** If unmuted autoplay is rejected, retry muted. Default `true`. */
  mutedFallback?: boolean;
}

export interface MediaSessionArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

export interface MediaSessionConfig {
  /** Runtime usage must be explicitly enabled. Default `false`. */
  enabled?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: MediaSessionArtwork[];
}

export interface CastConfig {
  enabled?: boolean;
  /** Cast receiver application ID. Default: Google's Default Media Receiver (`CC1AD845`). */
  receiverApplicationId?: string;
  /** Required for DRM, authenticated or ad-enabled remote playback. */
  customReceiver?: boolean;
  /** Receiver implements the ad pipeline (required to cast while VAST/direct ads are configured). */
  receiverHandlesAds?: boolean;
  /** Restore local playback at the remote position after disconnect. Default `true`. */
  resumeLocalOnDisconnect?: boolean;
  /** Scoped, short-lived context sent as `customData` (e.g. a license token). Never logged. */
  getCustomData?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface WatermarkConfig {
  text?: string;
  /** Image URL (http(s), relative or blob:). */
  image?: string;
  /** 0–1. Default 0.3. */
  opacity?: number;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  /** Move between corners every N ms (deterrent only). 0 disables. */
  moveIntervalMs?: number;
}

export interface LiveConfig {
  /** Seconds behind the live edge still considered "live". Default 3. */
  edgeTolerance?: number;
}

export type Fit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type Layout = 'standard' | 'reel';
export type UiMode = 'artplayer' | 'native';
export type Locale = 'en' | 'mn';
