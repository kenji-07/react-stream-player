/**
 * Ownership of object URLs created by the package for Blob inputs.
 *
 * - One object URL per Blob per registry, reference counted by consumer key.
 * - `release` never revokes immediately: callers release only after the
 *   consumer (video element, <track>, <img>, engine) has been detached, and
 *   revocation is deferred to a macrotask so in-flight work can settle.
 * - Caller-provided `blob:` strings are never created here and therefore never
 *   revoked by the package.
 */
let blobIdCounter = 0;
const blobIds = new WeakMap<Blob, number>();

/** Stable identity for a Blob instance (used for content identity comparisons). */
export function blobIdentity(blob: Blob): string {
  let id = blobIds.get(blob);
  if (id === undefined) {
    id = ++blobIdCounter;
    blobIds.set(blob, id);
  }
  return `blob#${id}`;
}

interface Entry {
  url: string;
  consumers: Set<string>;
}

export class BlobRegistry {
  private entries = new Map<Blob, Entry>();
  private pendingRevokes = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;
  /** Total object URLs created/revoked (diagnostics and leak tests). */
  readonly counters = { created: 0, revoked: 0 };

  acquire(blob: Blob, consumer: string): string {
    if (this.destroyed) throw new Error('BlobRegistry destroyed');
    let entry = this.entries.get(blob);
    if (!entry) {
      entry = { url: URL.createObjectURL(blob), consumers: new Set() };
      this.counters.created++;
      this.entries.set(blob, entry);
    }
    entry.consumers.add(consumer);
    return entry.url;
  }

  /** Releases a consumer. The URL is revoked (deferred) once no consumer remains. */
  release(blob: Blob, consumer: string): void {
    const entry = this.entries.get(blob);
    if (!entry) return;
    entry.consumers.delete(consumer);
    if (entry.consumers.size > 0) return;
    this.entries.delete(blob);
    this.scheduleRevoke(entry.url);
  }

  /** Releases every Blob held by a consumer. */
  releaseConsumer(consumer: string): void {
    for (const [blob, entry] of [...this.entries]) {
      if (entry.consumers.has(consumer)) this.release(blob, consumer);
    }
  }

  isOwnedUrl(url: string): boolean {
    for (const entry of this.entries.values()) if (entry.url === url) return true;
    return false;
  }

  get size(): number {
    return this.entries.size;
  }

  private scheduleRevoke(url: string): void {
    const timer = setTimeout(() => {
      this.pendingRevokes.delete(timer);
      URL.revokeObjectURL(url);
      this.counters.revoked++;
    }, 0);
    this.pendingRevokes.add(timer);
  }

  /** Revokes everything. Call only after all consumers are detached. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entry of this.entries.values()) this.scheduleRevoke(entry.url);
    this.entries.clear();
  }
}
