import type { ImaNamespace } from './ima-types.js';

/** The only script URLs the package will inject for IMA (documented Google IMA HTML5 SDK URLs). */
export const IMA_SDK_URLS = {
  release: 'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
  debug: 'https://imasdk.googleapis.com/js/sdkloader/ima3_debug.js',
} as const;

let pending: Promise<ImaNamespace> | null = null;

function existing(): ImaNamespace | null {
  const g = (globalThis as { google?: { ima?: ImaNamespace } }).google;
  return g?.ima?.AdDisplayContainer ? g.ima : null;
}

/**
 * Loads the IMA SDK once per page and shares it between players. A failed or
 * timed-out load is not cached (a later content session may retry). One
 * player unmounting never removes the shared SDK.
 */
export function loadImaSdk(options: { debug?: boolean; nonce?: string | null; timeoutMs: number }): Promise<ImaNamespace> {
  const ready = existing();
  if (ready) return Promise.resolve(ready);
  if (pending) return pending;
  pending = new Promise<ImaNamespace>((resolve, reject) => {
    const src = options.debug ? IMA_SDK_URLS.debug : IMA_SDK_URLS.release;
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    if (options.nonce) script.nonce = options.nonce;
    const timer = setTimeout(() => fail(new Error('IMA SDK load timed out')), options.timeoutMs);
    const fail = (error: Error) => {
      clearTimeout(timer);
      script.remove();
      pending = null;
      reject(error);
    };
    script.onload = () => {
      clearTimeout(timer);
      const ima = existing();
      if (ima) resolve(ima);
      else fail(new Error('IMA SDK loaded but google.ima is unavailable'));
    };
    script.onerror = () => fail(new Error('IMA SDK failed to load (blocked or offline)'));
    document.head.appendChild(script);
  });
  return pending;
}
