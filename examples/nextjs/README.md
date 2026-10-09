# Next.js App Router example

Every required usage example from the package docs, as typed Client Components
rendered from a Server Component page (`app/page.tsx`). The package is imported
normally — no `dynamic(..., { ssr: false })`.

```bash
# in the package root
npm install && npm run build && npm run fixtures
# here
npm install
npm run media      # copies the generated fixtures into public/media
npm run dev
```

Live, DRM and VAST examples need authorized endpoints. Provide them through
environment variables (names only are committed — never tokens, secrets or
long-lived signed URLs):

| Variable | Used by |
| --- | --- |
| `NEXT_PUBLIC_RSP_MEDIA_BASE` | Base URL of the fixture copy (default `/media`) |
| `NEXT_PUBLIC_RSP_HLS_URL`, `NEXT_PUBLIC_RSP_DASH_URL` | Adaptive VOD examples |
| `NEXT_PUBLIC_RSP_LIVE_HLS_URL`, `NEXT_PUBLIC_RSP_LIVE_DASH_URL` | Live examples |
| `NEXT_PUBLIC_RSP_VAST_TAG_URL` | VAST example |
| `NEXT_PUBLIC_RSP_DRM_DASH_URL`, `NEXT_PUBLIC_RSP_DRM_HLS_URL` | DRM example content |
| `NEXT_PUBLIC_RSP_WIDEVINE_LICENSE_URL`, `NEXT_PUBLIC_RSP_PLAYREADY_LICENSE_URL`, `NEXT_PUBLIC_RSP_FAIRPLAY_LICENSE_URL`, `NEXT_PUBLIC_RSP_FAIRPLAY_CERTIFICATE_URL` | DRM example |

`app/api/license-token/route.ts` is a placeholder for your own short-lived
license-token endpoint.

`scripts/consumer-smoke.mjs` in the package root builds this app against the
packed tarball (`npm pack`) rather than the workspace link.
