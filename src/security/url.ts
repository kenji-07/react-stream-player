// URL handling. Untrusted strings are never interpreted as HTML or script.

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'filesystem:']);

export interface ClickThroughPolicy {
  /** Additional custom app deep-link schemes (e.g. `["myapp:"]`). Empty by default. */
  allowedSchemes?: string[];
}

/**
 * Validates an ad click-through URL. Relative and http(s) URLs are allowed by
 * default; javascript:, data:, file: and similar schemes are always rejected.
 * Returns the resolved absolute URL or `null` when the URL is not allowed.
 */
export function validateClickThroughUrl(raw: string | undefined, policy: ClickThroughPolicy = {}, base?: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed, base ?? (typeof location !== 'undefined' ? location.href : 'https://invalid.invalid/'));
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme === 'http:' || scheme === 'https:') return url.href;
  if (BLOCKED_SCHEMES.has(scheme)) return null;
  const allowed = (policy.allowedSchemes ?? []).map((s) => (s.endsWith(':') ? s : `${s}:`).toLowerCase());
  return allowed.includes(scheme) ? url.href : null;
}

/** Media/subtitle/image URL check: http(s), relative, or blob:. Rejects script-capable schemes. */
export function isAllowedResourceUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!match) return true; // relative URL
  const scheme = `${match[1]!.toLowerCase()}:`;
  return scheme === 'http:' || scheme === 'https:' || scheme === 'blob:';
}

export function originOf(url: string, base?: string): string | null {
  try {
    return new URL(url, base ?? (typeof location !== 'undefined' ? location.href : undefined)).origin;
  } catch {
    return null;
  }
}

/** Path-only view of a URL (no query/fragment) for extension detection. */
export function pathnameOf(url: string): string {
  try {
    return new URL(url, 'https://relative.invalid/').pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? url;
  }
}

/** Opens a validated URL in a new browsing context without giving it a reference to this page. */
export function openExternal(url: string): void {
  if (typeof window === 'undefined') return;
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
}
