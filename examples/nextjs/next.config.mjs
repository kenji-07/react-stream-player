/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Same-origin access to the two public sample buckets that send no CORS
  // headers (needed for cross-origin WebVTT and captureFrame). Fixed
  // destinations only: this is not an open proxy. See components/samples/proxy.ts.
  async rewrites() {
    return ['exoplayer-test-media-0', 'exoplayer-test-media-1'].map((bucket) => ({
      source: `/sample-media/${bucket}/:path*`,
      destination: `https://storage.googleapis.com/${bucket}/:path*`,
    }));
  },
};

export default nextConfig;
