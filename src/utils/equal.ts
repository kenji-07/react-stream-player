/**
 * Structural equality for plain configuration values (objects, arrays,
 * primitives). Functions are compared by presence only — callback identity
 * changes must never trigger engine work. Blobs and other class instances are
 * compared by reference.
 */
export function semanticEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!semanticEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const protoA = Object.getPrototypeOf(a);
  const protoB = Object.getPrototypeOf(b);
  const plainA = protoA === Object.prototype || protoA === null;
  const plainB = protoB === Object.prototype || protoB === null;
  if (!plainA || !plainB) {
    if (a instanceof Uint8Array && b instanceof Uint8Array) return bytesEqual(a, b);
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) return bytesEqual(new Uint8Array(a), new Uint8Array(b));
    return false;
  }
  const keysA = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const keysB = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!semanticEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Small stable string hash (FNV-1a, 32-bit) for building opaque IDs. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
