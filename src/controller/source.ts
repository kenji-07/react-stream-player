import { playerError, type PlayerErrorImpl } from '../errors.js';
import { blobIdentity } from '../resources/blob-registry.js';
import { isAllowedResourceUrl, pathnameOf } from '../security/url.js';
import type { PlayerSource, ProgressiveVariant, ResolvedSourceType } from '../types/source.js';

export interface NormalizedVariant {
  id: string;
  input: string | Blob;
  label: string;
  height: number | null;
  width: number | null;
  bitrate: number | null;
  mimeType: string | null;
}

export interface NormalizedSource {
  type: ResolvedSourceType;
  mimeType: string | null;
  /** Single input (HLS/DASH/single MP4). `null` for variant lists. */
  input: string | Blob | null;
  /** Progressive variants (single MP4 sources become one implicit variant). */
  variants: NormalizedVariant[];
  /** Identity of the logical content (id+revision, or the transport when no id). */
  contentKey: string;
  /** Identity of the concrete transport (URLs/Blob identities, type, MIME). */
  transportKey: string;
  explicitId: boolean;
}

const HLS_MIME = new Set(['application/x-mpegurl', 'application/vnd.apple.mpegurl', 'audio/mpegurl', 'audio/x-mpegurl']);
const DASH_MIME = new Set(['application/dash+xml']);
const PROGRESSIVE_MIME = /^(video|audio)\/(mp4|webm|ogg|quicktime|x-m4v)$/;

function baseMime(mime: string | undefined | null): string | null {
  if (!mime) return null;
  return mime.split(';', 1)[0]!.trim().toLowerCase() || null;
}

/**
 * Resolves the protocol. Precedence: explicit `type` → MIME hint → URL path
 * extension (query strings ignored). Never guesses MP4 for unknown URLs and
 * never issues network requests.
 */
export function detectSourceType(input: string | Blob, type: string | undefined, mimeType: string | undefined): ResolvedSourceType | null {
  if (type && type !== 'auto') {
    if (type === 'hls' || type === 'dash' || type === 'mp4') return type;
    return null;
  }
  const mime = baseMime(mimeType) ?? (typeof input !== 'string' ? baseMime(input.type) : null);
  if (mime) {
    if (HLS_MIME.has(mime)) return 'hls';
    if (DASH_MIME.has(mime)) return 'dash';
    if (PROGRESSIVE_MIME.test(mime)) return 'mp4';
  }
  if (typeof input !== 'string') return null;
  if (/^blob:/i.test(input.trim())) return null; // blob: URLs carry no extension
  const path = pathnameOf(input).toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.mpd')) return 'dash';
  if (/\.(mp4|m4v|webm|mov|ogv)$/.test(path)) return 'mp4';
  return null;
}

function inputKey(input: string | Blob): string {
  return typeof input === 'string' ? `u:${input}` : blobIdentity(input);
}

function invalid(message: string): PlayerErrorImpl {
  return playerError('source-invalid', 'source', { fatal: true, recoverable: false, message });
}

export function normalizeSource(source: PlayerSource): { ok: true; source: NormalizedSource } | { ok: false; error: PlayerErrorImpl } {
  if (!source || typeof source !== 'object') return { ok: false, error: invalid('source must be an object') };
  const id = source.id;
  const revision = source.revision;
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) return { ok: false, error: invalid('source.id must be a non-empty string') };

  let normalized: Omit<NormalizedSource, 'contentKey' | 'transportKey' | 'explicitId'>;
  if ('variants' in source) {
    if (source.type !== 'mp4') return { ok: false, error: invalid('variants require type "mp4"') };
    if (!Array.isArray(source.variants) || source.variants.length === 0) return { ok: false, error: invalid('variants must be a non-empty array') };
    const seen = new Set<string>();
    const variants: NormalizedVariant[] = [];
    for (const v of source.variants as ProgressiveVariant[]) {
      if (!v || typeof v.id !== 'string' || !v.id) return { ok: false, error: invalid('each variant needs a non-empty id') };
      if (v.id === 'auto') return { ok: false, error: invalid('"auto" is reserved and cannot be a variant id') };
      if (seen.has(v.id)) return { ok: false, error: invalid('variant ids must be unique') };
      seen.add(v.id);
      if (typeof v.label !== 'string') return { ok: false, error: invalid('each variant needs a plain-text label') };
      if (!(typeof v.src === 'string' ? isAllowedResourceUrl(v.src) : isBlob(v.src))) return { ok: false, error: invalid('variant src must be an http(s), relative or blob: URL, or a Blob') };
      variants.push({
        id: v.id,
        input: v.src,
        label: v.label,
        height: finiteOrNull(v.height),
        width: finiteOrNull(v.width),
        bitrate: finiteOrNull(v.bitrate),
        mimeType: baseMime(v.mimeType),
      });
    }
    normalized = { type: 'mp4', mimeType: null, input: null, variants };
  } else {
    const input = source.src;
    if (typeof input === 'string') {
      if (!isAllowedResourceUrl(input)) return { ok: false, error: invalid('src must be an http(s), relative or blob: URL') };
    } else if (!isBlob(input)) {
      return { ok: false, error: invalid('src must be a URL string or a Blob') };
    } else if (source.type !== 'mp4') {
      return { ok: false, error: invalid('Blob sources must declare type "mp4"') };
    }
    const type = detectSourceType(input, source.type, source.mimeType);
    if (!type) {
      return {
        ok: false,
        error: playerError('source-type-unknown', 'source', { fatal: true, recoverable: false }),
      };
    }
    const mimeType = baseMime(source.mimeType) ?? (typeof input !== 'string' ? baseMime(input.type) : null);
    normalized = {
      type,
      mimeType,
      input,
      variants:
        type === 'mp4'
          ? [{ id: 'default', input, label: '', height: null, width: null, bitrate: null, mimeType }]
          : [],
    };
  }

  const transportKey = JSON.stringify([
    normalized.type,
    normalized.mimeType,
    normalized.input === null ? null : inputKey(normalized.input),
    normalized.variants.map((v) => [v.id, inputKey(v.input), v.label, v.height, v.width, v.bitrate, v.mimeType]),
  ]);
  const explicitId = id !== undefined;
  const contentKey = explicitId ? JSON.stringify(['id', id, revision ?? null]) : JSON.stringify(['t', transportKey]);
  return { ok: true, source: { ...normalized, contentKey, transportKey, explicitId } };
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

/** MIME type to hand to the adaptive engine. */
export function engineMimeType(source: NormalizedSource): string | null {
  if (source.mimeType) return source.mimeType;
  if (source.type === 'hls') return 'application/x-mpegurl';
  if (source.type === 'dash') return 'application/dash+xml';
  return null;
}
