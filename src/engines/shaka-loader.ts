// shaka-player ships a CommonJS build whose d.ts uses `export default shaka`;
// under NodeNext resolution the namespace is the module's `default` member.
type ShakaModule = typeof import('shaka-player');
export type Shaka = ShakaModule['default'];

let shakaPromise: Promise<Shaka> | null = null;

/**
 * Lazily loads Shaka Player (only for HLS/DASH/DRM paths) and installs its
 * polyfills exactly once. Shaka 5.2.12 relies on polyfilled built-ins (for
 * example `Map.prototype.getOrInsertComputed`) that are missing in some
 * evergreen browsers, so `polyfill.installAll()` is required before creating a
 * player. This is a page-global, idempotent installation performed by Shaka
 * itself — not per-player configuration.
 *
 * A failed import is not cached, so a later attempt can retry.
 */
export function loadShaka(): Promise<Shaka> {
  if (!shakaPromise) {
    shakaPromise = import('shaka-player')
      .then((mod) => {
        // Bundlers expose the CommonJS exports either as `default` or as the
        // module namespace itself; accept both shapes.
        const candidate = mod as unknown as { default?: Shaka };
        const shaka = (candidate.default && candidate.default.Player ? candidate.default : candidate) as Shaka;
        shaka.polyfill.installAll();
        return shaka;
      })
      .catch((error: unknown) => {
        shakaPromise = null;
        throw error;
      });
  }
  return shakaPromise;
}

export function isShakaLoaded(): boolean {
  return shakaPromise !== null;
}
