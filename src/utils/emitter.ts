/**
 * Small typed event emitter.
 * - Adding the same listener twice for an event registers it once.
 * - `once` listeners are removed before they are invoked.
 * - A throwing listener never breaks emission to other listeners or the
 *   caller; the error is reported asynchronously via `reportError`.
 */
export type Listener<P, C> = (payload: P, context: C) => void;

type AnyListener<C> = Listener<unknown, C>;

export class TypedEmitter<M extends object, C> {
  private listeners = new Map<keyof M, Set<AnyListener<C>>>();
  /** event → original listener → once-wrapper */
  private onceWrappers = new Map<keyof M, Map<AnyListener<C>, AnyListener<C>>>();
  private disposed = false;

  on<K extends keyof M>(event: K, listener: Listener<M[K], C>): () => void {
    if (this.disposed) return () => undefined;
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as AnyListener<C>);
    return () => this.off(event, listener);
  }

  once<K extends keyof M>(event: K, listener: Listener<M[K], C>): () => void {
    if (this.disposed) return () => undefined;
    const original = listener as AnyListener<C>;
    let wrappers = this.onceWrappers.get(event);
    if (!wrappers) {
      wrappers = new Map();
      this.onceWrappers.set(event, wrappers);
    }
    if (!wrappers.has(original) && !this.listeners.get(event)?.has(original)) {
      const wrapper: AnyListener<C> = (payload, context) => {
        this.off(event, listener);
        original(payload, context);
      };
      wrappers.set(original, wrapper);
      let set = this.listeners.get(event);
      if (!set) {
        set = new Set();
        this.listeners.set(event, set);
      }
      set.add(wrapper);
    }
    return () => this.off(event, listener);
  }

  off<K extends keyof M>(event: K, listener: Listener<M[K], C>): void {
    const original = listener as AnyListener<C>;
    const set = this.listeners.get(event);
    const wrappers = this.onceWrappers.get(event);
    const wrapper = wrappers?.get(original);
    if (wrapper) {
      set?.delete(wrapper);
      wrappers!.delete(original);
    }
    set?.delete(original);
  }

  emit<K extends keyof M>(event: K, payload: M[K], context: C): void {
    if (this.disposed) return;
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      // A listener removed by an earlier listener during this emit is skipped.
      if (!set.has(listener)) continue;
      try {
        listener(payload, context);
      } catch (error) {
        reportListenerError(error);
      }
    }
  }

  listenerCount(event: keyof M): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
    this.onceWrappers.clear();
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }
}

export function reportListenerError(error: unknown): void {
  // Surface the host bug without letting it interrupt player internals.
  const report = (globalThis as { reportError?: (e: unknown) => void }).reportError;
  if (typeof report === 'function') {
    try {
      report(error);
      return;
    } catch {
      /* fall through */
    }
  }
  setTimeout(() => {
    throw error;
  }, 0);
}
