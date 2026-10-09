# Next.js App Router example

Every required usage example from the package docs, as typed Client Components
rendered from a Server Component page (`app/page.tsx`). The package is imported
normally, with no `dynamic(..., { ssr: false })`. A second page, `/samples`,
lets you browse a list of public test streams and open any of them in the
player.

```bash
# in the package root
npm install && npm run build
# here
npm install
npm run dev        # http://localhost:3000 and http://localhost:3000/samples
```

## Media

By default the examples use **public sample streams** from
[`components/samples/samples.json`](components/samples/samples.json), so
nothing has to be generated first:

| Example | Default public media |
| --- | --- |
| MP4 qualities | "Screens" representations: 360p VP9 WebM, 480p and 1080p H.264. One 128 s video-only timeline in three sizes. WebVTT English and Japanese |
| Progressive examples (controlled state, fullscreen, events, …) | `android-screens-25s.mp4` (H.264 + AAC) |
| HLS / audio tracks / typed events | Apple "bipbop" advanced fMP4 multivariant playlist |
| DASH | Tears of Steel, clear H.264 |
| DRM | Tears of Steel, Widevine `cenc`, public Widevine UAT test license proxy |
| Direct ads | Image `london.jpg`; video `android-screens-10s.mp4` |
| VAST | Google IMA "single skippable inline" sample tag |
| Reel, live | No suitable public clip in the list. Set `NEXT_PUBLIC_RSP_PORTRAIT_URL` / `NEXT_PUBLIC_RSP_LIVE_*_URL`, or use local fixtures |

`NEXT_PUBLIC_RSP_MEDIA=local` switches every example to the package's
synthetic fixtures. They work offline and are what CI uses. To set them up:

```bash
npm run fixtures   # in the package root (needs ffmpeg)
npm run media      # here: copies them into public/media
NEXT_PUBLIC_RSP_MEDIA=local npm run dev
```

The browser has to decode each stream. Most public samples use H.264/AAC,
which plays in Chrome, Edge, Safari and Firefox but **not in open-source
Chromium builds** (for example Playwright's bundled Chromium). VP9, AV1 and
Opus samples play there.

## Public sample streams (`/samples`)

[`components/samples/samples.json`](components/samples/samples.json) is the
sample list used verbatim (18 categories, 128 samples, in the AndroidX Media3
/ ExoPlayer demo-list format).
[`catalog.ts`](components/samples/catalog.ts) maps each sample to `<Player>`
props (`source`, `drm`, `ads.vast`, `subtitles`) and gives it a status with a
plain-text explanation:

| Status | Count | Meaning |
| --- | --- | --- |
| Playable | 29 | Expected to play in current mainstream browsers |
| Codec-dependent | 34 | Plays only where the browser decodes the codec or container (HEVC, AV1, Matroska, Ogg, IAMF, MPEG-H) |
| Needs Widevine | 23 | Widevine DASH with the public UAT test license proxy; needs a browser with the Widevine CDM |
| Shows an error path | 11 | Loads to demonstrate a documented error: TTML/SSA subtitles (`subtitle-format-unsupported`), L1-only and expiring licenses, raw MPEG-TS, a broken ad redirect without fallback |
| Not supported | 31 | No player is created; the reason is shown |

The 31 unsupported samples:

- playlists (out of scope: one video per content session);
- IMA DAI `ssai://` streams (only client-side VAST/VMAP is supported);
- Smooth Streaming;
- still images and motion photos;
- encrypted progressive files (DRM needs DASH or HLS).

ExoPlayer-only flags (`drm_session_for_clear_content`,
`drm_force_default_license_uri`, clipping) have no equivalent here; the
affected samples say so.

**Same-origin rewrite.** The `storage.googleapis.com/exoplayer-test-media-0`
and `-1` buckets send no CORS headers. Browsers need CORS for cross-origin
WebVTT tracks and `captureFrame()`. `next.config.mjs` therefore rewrites
`/sample-media/<bucket>/…` to exactly those two buckets. It has fixed
destinations and is not an open proxy. Rewrites need `next dev` or
`next start`. For a static export, set `NEXT_PUBLIC_RSP_SAMPLE_PROXY=off`;
the original URLs are then used, and cross-origin subtitles fail with
`subtitle-load-error`.

**Ownership.** The streams belong to their owners (Google, Apple, Bitmovin,
Microsoft and others). They are streamed from the owners' hosts and not
redistributed. Availability can change at any time. That is why the
package's own tests use local fixtures, and why the sample probe is opt-in:

```bash
# in the package root: plays every loadable sample in Chromium and records the outcome
RSP_PUBLIC_SAMPLES=1 npx playwright test tests/e2e/public-samples.spec.ts
# → test-results/public-samples.json (environment, codec support, outcome per sample)
```

The latest recorded run is in
[`docs/evidence/public-samples.json`](../../docs/evidence/public-samples.json).

## Environment variables

Only names are committed: never tokens, secrets or long-lived signed URLs.

| Variable | Used by |
| --- | --- |
| `NEXT_PUBLIC_RSP_MEDIA` | `local` = generated fixtures; anything else = public samples |
| `NEXT_PUBLIC_RSP_MEDIA_BASE` | Base URL of the local fixture copy (default `/media`) |
| `NEXT_PUBLIC_RSP_SAMPLE_PROXY` | `off` disables the same-origin rewrite paths |
| `NEXT_PUBLIC_RSP_HLS_URL`, `NEXT_PUBLIC_RSP_DASH_URL` | Adaptive VOD examples |
| `NEXT_PUBLIC_RSP_PORTRAIT_URL` | Reel example |
| `NEXT_PUBLIC_RSP_LIVE_HLS_URL`, `NEXT_PUBLIC_RSP_LIVE_DASH_URL` | Live examples |
| `NEXT_PUBLIC_RSP_VAST_TAG_URL` | VAST example |
| `NEXT_PUBLIC_RSP_DRM_DASH_URL`, `NEXT_PUBLIC_RSP_DRM_HLS_URL` | DRM example content |
| `NEXT_PUBLIC_RSP_WIDEVINE_LICENSE_URL`, `NEXT_PUBLIC_RSP_PLAYREADY_LICENSE_URL`, `NEXT_PUBLIC_RSP_FAIRPLAY_LICENSE_URL`, `NEXT_PUBLIC_RSP_FAIRPLAY_CERTIFICATE_URL` | DRM example |

`app/api/license-token/route.ts` is a placeholder for your own short-lived
license-token endpoint.

`scripts/consumer-smoke.mjs` in the package root builds this app against the
packed tarball (`npm pack`) with `NEXT_PUBLIC_RSP_MEDIA=local`, and checks
the `/samples` page.
