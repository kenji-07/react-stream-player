import { redactText, redactValue } from './security/redact.js';
import type { PlayerError, PlayerErrorCategory, PlayerErrorCode } from './types/errors.js';

const MESSAGES: Record<PlayerErrorCode, string> = {
  'network-error': 'A network error interrupted playback.',
  'network-timeout': 'A network request timed out.',
  'http-error': 'The media server returned an error.',
  'source-not-found': 'The media could not be found.',
  'source-type-unknown': 'The source type could not be determined. Set `type` or `mimeType`.',
  'source-invalid': 'The source configuration is invalid.',
  'source-unsupported': 'This source is not supported in this browser.',
  'credential-redirect-blocked': 'A credentialed request was redirected to an origin outside the allowlist.',
  'manifest-error': 'The streaming manifest could not be loaded or parsed.',
  'media-decode-error': 'The media could not be decoded.',
  'media-unsupported-codec': 'The media format or codec is not supported by this browser.',
  'media-aborted': 'Media loading was aborted.',
  'media-error': 'A media error occurred.',
  'drm-unsupported': 'Protected playback is not supported by this browser or configuration.',
  'drm-license-error': 'The license request failed.',
  'drm-certificate-error': 'The DRM server certificate could not be loaded.',
  'drm-no-license-server': 'No license server is configured for the required key system.',
  'drm-output-restricted': 'Playback is restricted by output protection.',
  'drm-error': 'A protected-playback error occurred.',
  'drm-progressive-unsupported': 'Protected progressive MP4 is not supported; use HLS or DASH.',
  'subtitle-format-unsupported': 'Only WebVTT is supported for external subtitle files.',
  'subtitle-load-error': 'A subtitle track could not be loaded.',
  'ad-load-timeout': 'The advertisement timed out.',
  'ad-load-error': 'The advertisement could not be loaded.',
  'ad-media-error': 'The advertisement could not be played.',
  'ad-invalid-config': 'The advertisement configuration is invalid.',
  'ad-sdk-load-failed': 'The ad SDK could not be loaded.',
  'ad-no-fill': 'No advertisement was returned.',
  'ad-vast-error': 'The VAST ad request failed.',
  'ad-unsupported': 'This advertisement is not supported.',
  'cast-unavailable': 'Casting is not available.',
  'cast-rejected': 'Casting is not allowed for this content.',
  'cast-error': 'A casting error occurred.',
  'fullscreen-unsupported': 'Fullscreen is not supported.',
  'fullscreen-rejected': 'The fullscreen request was rejected.',
  'pip-unsupported': 'Picture-in-Picture is not supported.',
  'pip-rejected': 'The Picture-in-Picture request was rejected.',
  'capture-protected': 'Frames of protected content cannot be captured.',
  'capture-tainted': 'Frames of cross-origin media without CORS cannot be captured.',
  'capture-unsupported': 'Frame capture is not supported.',
  'invalid-config': 'The player configuration is invalid.',
  'unsupported-operation': 'This operation is not supported for the current source.',
  'player-not-ready': 'The player is not ready yet.',
  'player-destroyed': 'The player has been destroyed.',
  'operation-aborted': 'The operation was superseded or cancelled.',
  'autoplay-blocked': 'The browser blocked autoplay.',
  'unexpected-error': 'An unexpected error occurred.',
};

export class PlayerErrorImpl extends Error implements PlayerError {
  override readonly name = 'PlayerError' as const;
  readonly category: PlayerErrorCategory;
  readonly code: PlayerErrorCode;
  readonly fatal: boolean;
  readonly recoverable: boolean;
  readonly contentSessionId: string | null;
  readonly loadId: number | null;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  override readonly cause?: unknown;

  constructor(init: {
    category: PlayerErrorCategory;
    code: PlayerErrorCode;
    message?: string;
    fatal?: boolean;
    recoverable?: boolean;
    contentSessionId?: string | null;
    loadId?: number | null;
    details?: Record<string, string | number | boolean | null>;
    cause?: unknown;
  }) {
    super(redactText(init.message ?? MESSAGES[init.code]));
    this.category = init.category;
    this.code = init.code;
    this.fatal = init.fatal ?? false;
    this.recoverable = init.recoverable ?? !this.fatal;
    this.contentSessionId = init.contentSessionId ?? null;
    this.loadId = init.loadId ?? null;
    const details: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(init.details ?? {})) {
      details[k] = typeof v === 'string' ? redactText(v) : v;
    }
    this.details = Object.freeze(details);
    if (init.cause !== undefined) {
      // Never expose raw vendor data (URLs with signed queries, headers, license
      // payloads): keep a redacted, plain-object copy for debugging only.
      this.cause = sanitizeCause(init.cause);
    }
  }

  withContext(contentSessionId: string | null, loadId: number | null): PlayerErrorImpl {
    return new PlayerErrorImpl({
      category: this.category,
      code: this.code,
      message: this.message,
      fatal: this.fatal,
      recoverable: this.recoverable,
      contentSessionId,
      loadId,
      details: { ...this.details },
      cause: this.cause,
    });
  }
}

function sanitizeCause(cause: unknown): unknown {
  if (cause instanceof PlayerErrorImpl) return cause;
  if (cause instanceof Error) {
    const vendor = cause as Error & { category?: unknown; code?: unknown; severity?: unknown; data?: unknown };
    return redactValue({
      name: cause.name,
      message: cause.message,
      category: vendor.category,
      code: vendor.code,
      severity: vendor.severity,
      data: vendor.data,
      stack: cause.stack,
    });
  }
  return redactValue(cause);
}

export function playerError(
  code: PlayerErrorCode,
  category: PlayerErrorCategory,
  extra: Partial<Omit<ConstructorParameters<typeof PlayerErrorImpl>[0], 'code' | 'category'>> = {},
): PlayerErrorImpl {
  return new PlayerErrorImpl({ code, category, ...extra });
}

export function isPlayerError(value: unknown): value is PlayerError {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'PlayerError' && 'code' in value;
}

/** Maps `HTMLMediaElement.error` to a normalized error. */
export function fromMediaError(error: MediaError | null): PlayerErrorImpl {
  switch (error?.code) {
    case 1:
      return playerError('media-aborted', 'media', { fatal: true, recoverable: true, details: { mediaErrorCode: 1 } });
    case 2:
      return playerError('network-error', 'network', { fatal: true, recoverable: true, details: { mediaErrorCode: 2 } });
    case 3:
      return playerError('media-decode-error', 'media', { fatal: true, recoverable: true, details: { mediaErrorCode: 3 } });
    case 4:
      return playerError('media-unsupported-codec', 'source', { fatal: true, recoverable: false, details: { mediaErrorCode: 4 } });
    default:
      return playerError('media-error', 'media', { fatal: true, recoverable: true });
  }
}

/**
 * Maps a `shaka.util.Error` (category/code/severity numbers documented in
 * shaka.util.Error) to a normalized error. Vendor data is redacted.
 */
export function fromShakaError(error: unknown, fatalHint?: boolean): PlayerErrorImpl {
  const e = error as { category?: number; code?: number; severity?: number; data?: unknown[] } | null;
  const category = e?.category ?? 0;
  const code = e?.code ?? 0;
  const critical = fatalHint ?? e?.severity === 2;
  const details = { shakaCategory: category, shakaCode: code, shakaSeverity: e?.severity ?? null };
  const httpStatus = code === 1001 && typeof e?.data?.[1] === 'number' ? (e.data[1] as number) : null;
  const base = { fatal: critical, details: { ...details, httpStatus }, cause: error };
  switch (category) {
    case 1: // NETWORK
      if (code === 1003) return playerError('network-timeout', 'network', { ...base, recoverable: true });
      if (code === 1001 && httpStatus === 404) return playerError('source-not-found', 'network', { ...base, recoverable: false });
      if (code === 1001) return playerError('http-error', 'network', { ...base, recoverable: true });
      return playerError('network-error', 'network', { ...base, recoverable: true });
    case 2: // TEXT
      return playerError('subtitle-load-error', 'subtitle', { ...base, fatal: false, recoverable: true });
    case 3: // MEDIA
      if (code === 3016 || code === 3014 || code === 3015) return playerError('media-decode-error', 'media', { ...base, recoverable: true });
      return playerError('media-error', 'media', { ...base, recoverable: true });
    case 4: // MANIFEST
      // CONTENT_UNSUPPORTED_BY_BROWSER, RESTRICTIONS_CANNOT_BE_MET, NO_VARIANTS, HLS_COULD_NOT_GUESS_CODECS
      if (code === 4032 || code === 4012 || code === 4036 || code === 4025) {
        return playerError('media-unsupported-codec', 'source', { ...base, recoverable: false });
      }
      // DASH_NO_COMMON_KEY_SYSTEM, HLS_KEYFORMATS_NOT_SUPPORTED, encrypted-TS/legacy-Apple-keys under MSE
      if (code === 4008 || code === 4026 || code === 4040 || code === 4041 || code === 4054) {
        return playerError('drm-unsupported', 'drm', { ...base, recoverable: false });
      }
      return playerError('manifest-error', 'manifest', { ...base, recoverable: true });
    case 5: // STREAMING
      return playerError('media-error', 'media', { ...base, recoverable: true });
    case 6: // DRM
      // Codes verified against shaka.util.Error.Code in shaka-player 5.2.12.
      if (code === 6001 || code === 6002 || code === 6003 || code === 6010) {
        return playerError('drm-unsupported', 'drm', { ...base, recoverable: false });
      }
      if (code === 6007 || code === 6008 || code === 6014) return playerError('drm-license-error', 'drm', { ...base, recoverable: true });
      if (code === 6012) return playerError('drm-no-license-server', 'drm', { ...base, recoverable: false });
      if (code === 6004 || code === 6015 || code === 6017) return playerError('drm-certificate-error', 'drm', { ...base, recoverable: true });
      if (code === 6018) return playerError('drm-output-restricted', 'drm', { ...base, recoverable: false });
      return playerError('drm-error', 'drm', { ...base, recoverable: true });
    case 7: // PLAYER
      // LOAD_INTERRUPTED (7000), OPERATION_ABORTED (7001) and OBJECT_DESTROYED (7003) are cancellations.
      if (code === 7000 || code === 7001 || code === 7003) return playerError('operation-aborted', 'state', { ...base, fatal: false, recoverable: true });
      return playerError('unexpected-error', 'unexpected', { ...base, recoverable: true });
    case 8: // CAST
      return playerError('cast-error', 'cast', { ...base, fatal: false });
    case 10: // ADS
      return playerError('ad-load-error', 'ads', { ...base, fatal: false });
    default:
      return playerError('unexpected-error', 'unexpected', { ...base, recoverable: true });
  }
}
