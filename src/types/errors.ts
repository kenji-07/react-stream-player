export type PlayerErrorCategory =
  | 'network'
  | 'source'
  | 'manifest'
  | 'media'
  | 'drm'
  | 'subtitle'
  | 'ads'
  | 'cast'
  | 'fullscreen'
  | 'pip'
  | 'capture'
  | 'unsupported'
  | 'config'
  | 'state'
  | 'unexpected';

/** Stable error codes. Messages are safe for display; they never contain URLs or tokens. */
export type PlayerErrorCode =
  // network / source
  | 'network-error'
  | 'network-timeout'
  | 'http-error'
  | 'source-not-found'
  | 'source-type-unknown'
  | 'source-invalid'
  | 'source-unsupported'
  | 'credential-redirect-blocked'
  // manifest
  | 'manifest-error'
  // media
  | 'media-decode-error'
  | 'media-unsupported-codec'
  | 'media-aborted'
  | 'media-error'
  // drm
  | 'drm-unsupported'
  | 'drm-license-error'
  | 'drm-certificate-error'
  | 'drm-no-license-server'
  | 'drm-output-restricted'
  | 'drm-error'
  | 'drm-progressive-unsupported'
  // subtitles
  | 'subtitle-format-unsupported'
  | 'subtitle-load-error'
  // ads
  | 'ad-load-timeout'
  | 'ad-load-error'
  | 'ad-media-error'
  | 'ad-invalid-config'
  | 'ad-sdk-load-failed'
  | 'ad-no-fill'
  | 'ad-vast-error'
  | 'ad-unsupported'
  // cast / remote
  | 'cast-unavailable'
  | 'cast-rejected'
  | 'cast-error'
  // fullscreen / pip / capture
  | 'fullscreen-unsupported'
  | 'fullscreen-rejected'
  | 'pip-unsupported'
  | 'pip-rejected'
  | 'capture-protected'
  | 'capture-tainted'
  | 'capture-unsupported'
  // configuration / state
  | 'invalid-config'
  | 'unsupported-operation'
  | 'player-not-ready'
  | 'player-destroyed'
  | 'operation-aborted'
  | 'autoplay-blocked'
  | 'unexpected-error';

export interface PlayerError {
  readonly name: 'PlayerError';
  readonly category: PlayerErrorCategory;
  readonly code: PlayerErrorCode;
  /** Safe, non-localized English message. Localized text is shown in the UI. */
  readonly message: string;
  /** The content session cannot continue without a retry or a new source. */
  readonly fatal: boolean;
  /** `retry()` (or a new source) may succeed. */
  readonly recoverable: boolean;
  readonly contentSessionId: string | null;
  readonly loadId: number | null;
  /** Redacted, non-secret details (e.g. vendor error codes). */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  /** Internal cause for debugging. Not rendered. URLs inside are redacted when possible. */
  readonly cause?: unknown;
}
