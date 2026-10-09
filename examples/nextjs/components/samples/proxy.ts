// Same-origin paths for the public sample buckets that send no CORS headers
// (`Access-Control-Allow-Origin` is missing on storage.googleapis.com/
// exoplayer-test-media-0 and -1). Browsers need CORS for cross-origin WebVTT
// tracks and for captureFrame(), so next.config.mjs rewrites these paths to
// the buckets. The rewrite targets only those two fixed public buckets: it is
// not an open proxy. Set NEXT_PUBLIC_RSP_SAMPLE_PROXY=off to use the
// original URLs (e.g. for a static export, where rewrites do not exist).
export const SAMPLE_PROXY_PREFIX = '/sample-media';

const PROXIED_BUCKETS = ['exoplayer-test-media-0', 'exoplayer-test-media-1'] as const;
const GCS = 'https://storage.googleapis.com/';
const enabled = process.env.NEXT_PUBLIC_RSP_SAMPLE_PROXY !== 'off';

/** Returns a same-origin path for URLs on the proxied buckets; other URLs are returned unchanged. */
export function sameOrigin(url: string): string {
  if (!enabled || !url.startsWith(GCS)) return url;
  const rest = url.slice(GCS.length);
  const bucket = PROXIED_BUCKETS.find((b) => rest.startsWith(`${b}/`));
  return bucket ? `${SAMPLE_PROXY_PREFIX}/${rest}` : url;
}
