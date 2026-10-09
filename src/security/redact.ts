// Redaction for anything that may leave the player: errors, diagnostics,
// stats, logs. Query strings and fragments are removed from URLs because they
// commonly carry signatures and tokens.

const URL_PATTERN = /\b(?:https?|blob|wss?):\/\/[^\s"'<>]+/gi;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const SENSITIVE_KEY = /token|secret|signature|sig|auth|key|credential|password|cookie|session|policy|license/i;

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'blob:') return 'blob:[redacted]';
    return `${parsed.origin}${parsed.pathname}${parsed.search || parsed.hash ? '?[redacted]' : ''}`;
  } catch {
    return url.replace(/[?#].*$/, '?[redacted]');
  }
}

export function redactText(text: string): string {
  return text.replace(URL_PATTERN, (match) => redactUrl(match)).replace(BEARER_PATTERN, '$1 [redacted]');
}

/** Deep-redacts a value for diagnostics. Sensitive keys are replaced entirely. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `[binary ${(value as ArrayBuffer).byteLength} bytes]`;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `[blob ${value.size} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) && typeof v !== 'boolean' && typeof v !== 'number' ? '[redacted]' : redactValue(v, depth + 1);
  }
  return out;
}
