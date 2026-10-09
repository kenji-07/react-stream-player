# react-stream-player

A React 19 video player for **progressive MP4, HLS and DASH** (VOD and live with
DVR). It uses [Shaka Player](https://github.com/shaka-project/shaka-player) as
the single adaptive/DRM engine and [Artplayer](https://github.com/zhw2590582/ArtPlayer)
as the prebuilt UI. Artplayer runs in proxy mode and never starts a second
engine.

Features:

- multiple MP4 qualities;
- Auto and manual quality, audio tracks and multiple subtitles;
- direct text, image and video ads, and Google IMA VAST with strict precedence;
- fullscreen, hotkeys and Media Session;
- a single portrait video "Reel" layout;
- safe server import for Next.js App Router.

> **Status: development build `0.1.0` — not published.** Required-v1 features
> are implemented and tested in headless Chromium. Real-device and DRM, Cast
> and real-IMA combinations are still **externally unverified**; see
> [docs/release-checklist.md](docs/release-checklist.md).
>
> The npm name `react-stream-player` currently belongs to a different,
> unrelated package (v0.2.3, another maintainer). Publishing requires
> publishing rights to that name. Until then, install from a packed tarball
> (`npm pack`) or from git.

## Install

```bash
npm install react-stream-player   # once published; until then: npm install ./react-stream-player-0.1.0.tgz
```

You only need to install `react` and `react-dom` (≥ 19) yourself, as peers.
`shaka-player` and `artplayer` are regular dependencies. They are loaded with
dynamic `import()` only when a source or UI needs them, so a page that plays
native MP4 with `ui="native"` loads neither.

```tsx
import { Player } from 'react-stream-player';
import 'react-stream-player/styles.css';
```

## Quick start

```tsx
"use client";

import { useRef } from "react";
import { Player, type PlayerRef } from "react-stream-player";
import "react-stream-player/styles.css";

export function VideoExample() {
  const ref = useRef<PlayerRef>(null);

  return (
    <Player
      ref={ref}
      source={{
        id: "movie-1",
        type: "mp4",
        variants: [
          { id: "480p", src: "/movie-480.mp4", label: "480p", height: 480 },
          { id: "720p", src: "/movie-720.mp4", label: "720p", height: 720 },
          { id: "1080p", src: "/movie-1080.mp4", label: "1080p", height: 1080 },
        ],
      }}
      defaultQuality="720p"
      defaultVolume={0.7}
      playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 2]}
      fit="contain"
      contextMenu={{ enabled: true }}
      subtitles={[
        { id: "en", src: "/subs/en.vtt", label: "English", language: "en" },
        { id: "mn", src: "/subs/mn.vtt", label: "Монгол", language: "mn" },
      ]}
      defaultSubtitleLanguage="mn"
      subtitleStyle={{ fontSize: "20px", bottom: "40px", color: "#fff" }}
      onError={(error) => console.error(error.code, error.message)}
    />
  );
}
```

All variants of an MP4 source must be the **same video on the same
timeline**. Only the selected variant is loaded. Switching keeps the position,
play state, volume, rate and subtitles. If a switch fails, the player falls
back to the previous variant.

### Next.js App Router

Import `Player` from a Client Component, or render it directly from a Server
Component: the entry carries `"use client"`. You do not need
`dynamic(..., { ssr: false })`. On the server, only an empty sized container is
rendered; the player is created after hydration. See
[examples/nextjs](examples/nextjs).

## More examples

Every snippet in this README is type-checked against the package
(`tests/types/readme-examples.test-d.tsx`). Runnable versions of all required
examples are in [examples/nextjs/components/examples](examples/nextjs/components/examples).

```tsx
// One portrait video; no feed and no other video preloads.
<Player
  source={{ src: "/portrait.mp4", type: "mp4" }}
  layout="reel"
  aspectRatio="9 / 16"
  fit="contain"
  defaultVolume={0.7}
  motion={{ enabled: true, reducedMotion: "system" }}
/>
```

```tsx
<Player
  source={{ src: "https://cdn.example.com/master.m3u8", type: "hls" }}
  streaming={{ bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 30 }}
/>

<Player
  source={{ src: "https://cdn.example.com/live.mpd", type: "dash" }}
  streaming={{ lowLatencyMode: true }}
/>
```

```tsx
// Direct creative types use distinct standard fields.
<Player
  source={{ src: "/movie.mp4", type: "mp4" }}
  ads={{
    enabled: true,
    items: [
      {
        id: "intro-image",
        type: "image",
        src: "/ads/banner.png",
        alt: "Intro promotion",
        timing: { placement: "preroll" },
        duration: 10,
        skipAfter: 5,
        clickThroughUrl: "https://example.com/offer",
      },
      {
        id: "mid-video",
        type: "video",
        source: { src: "/ads/video.mp4", type: "mp4" },
        timing: { placement: "midroll", at: 120 },
        skipAfter: 10,
      },
      {
        id: "text-offer",
        type: "text",
        text: "Special offer — click to learn more",
        timing: { placement: "overlay", at: 300 },
        duration: 15,
        skipAfter: 5,
        style: { color: "#fff", backgroundColor: "#ff0000" },
        clickThroughUrl: "https://example.com/offer",
      },
    ],
  }}
/>
```

```tsx
// VAST has priority. Every direct item is ignored, even if VAST fails.
<Player
  source={{ src: "/movie.mp4", type: "mp4" }}
  ads={{
    enabled: true,
    vast: { adTagUrl: "https://ads.example.com/vast", requestTimeoutMs: 10000 },
    items: [
      {
        id: "suppressed-image",
        type: "image",
        src: "/ads/must-not-load.png",
        alt: "Suppressed direct creative",
        timing: { placement: "overlay", at: 0 },
        duration: 10,
      },
    ],
  }}
/>
```

| Topic | Example |
| --- | --- |
| Controlled volume / mute / rate | [ControlledState.tsx](examples/nextjs/components/examples/ControlledState.tsx) |
| Typed event subscriptions with cleanup | [TypedEvents.tsx](examples/nextjs/components/examples/TypedEvents.tsx) |
| Browser and web fullscreen | [Fullscreen.tsx](examples/nextjs/components/examples/Fullscreen.tsx) |
| Multiple audio tracks | [AudioTracks.tsx](examples/nextjs/components/examples/AudioTracks.tsx) |
| DRM provider configuration | [Drm.tsx](examples/nextjs/components/examples/Drm.tsx) |
| Safe Blob inputs | [BlobInput.tsx](examples/nextjs/components/examples/BlobInput.tsx) |
| Screenshot ownership (`captureFrame`) | [CaptureFrame.tsx](examples/nextjs/components/examples/CaptureFrame.tsx) |
| Native mode capability differences | [NativeMode.tsx](examples/nextjs/components/examples/NativeMode.tsx) |
| Unchanged inline-prop rerenders | [InlineRerender.tsx](examples/nextjs/components/examples/InlineRerender.tsx) |
| Same-content signed URL refresh | [SignedUrlRefresh.tsx](examples/nextjs/components/examples/SignedUrlRefresh.tsx) |
| Live session-time ad cues | [LiveSessionCues.tsx](examples/nextjs/components/examples/LiveSessionCues.tsx) |
| Media Session | [MediaSession.tsx](examples/nextjs/components/examples/MediaSession.tsx) |
| Framework-independent `createPlayer` | [CoreApi.tsx](examples/nextjs/components/examples/CoreApi.tsx) |
| Cast custom receiver | [examples/cast-receiver](examples/cast-receiver) |

## Defaults

| Option | Default |
| --- | --- |
| `defaultVolume` | `0.7` (per instance; never persisted) |
| `playbackRates` | `[0.5, 0.75, 1, 1.25, 1.5, 2]` |
| `defaultPlaybackRate` | `1` |
| `preload` | `"metadata"` |
| `fit` / `objectPosition` | `"contain"` / `"50% 50%"` (applied to the `<video>` element) |
| `aspectRatio` | `"16 / 9"`; `"9 / 16"` with `layout="reel"` |
| `seekStep` | `10` seconds |
| `progressInterval` | `1000` ms |
| `subtitleStyle` | `20px`, `40px` from the bottom, `#fff` on `rgba(0, 0, 0, 0.6)` |
| `motion` | enabled, `200` ms, `"ease"`, `reducedMotion: "system"` |
| `autoplay` | `false`; `true` means "try unmuted, fall back to muted" |
| `ui` / `layout` / `locale` | `"artplayer"` / `"standard"` / `"en"` (`"mn"` built in) |
| `mediaSession` | disabled (opt-in) |
| `fullscreen.mode` | `"browser"` (`"web"` = CSS fullscreen inside the page) |

The full list of options is in [docs/api.md](docs/api.md), with each option's
type, unit, constraints and whether a change applies immediately or reloads.

## Prop updates and content identity

- Props are compared by **value**, not reference. New inline objects with
  the same values, and new callback functions, never reload the media.
- `source.id` (and optional `revision`) identifies the content. If the URL
  changes but `id` and `revision` stay the same, the player treats it as a
  **transport refresh**, for example a re-signed URL. Position, play state,
  selections and ad history are kept, and the preroll does not run again.
  A new `id` or `revision` starts a new content session.
- Without an `id`, the URLs themselves are the identity.
- `volume`, `muted`, `playbackRate`, `quality`, `audioTrack` and
  `subtitleTrack` can be **controlled**: pair each with its `on…Change`
  callback. The `default…` variants are uncontrolled.

## Keyboard shortcuts

Shortcuts work while focus is inside the player. They are ignored in text
fields, sliders and menus, during IME composition, and with Ctrl/Alt/Meta.

| Key | Action |
| --- | --- |
| Space, K | Play / pause (Space keeps its button meaning on focused buttons) |
| ← / J, → / L | Seek −/+ `seekStep` |
| ↑ / ↓ | Volume ± 5 % |
| Home / End | Start / end (VOD) or live edge |
| 0–9 | Seek to 0–90 % |
| F | Toggle fullscreen (`fullscreen.mode`) |
| M | Mute |
| C | Toggle captions |
| `>` / `<` | Next / previous playback rate |
| Escape | Exit web fullscreen |

Override with `hotkeys={{ bindings: { f: null, x: 'toggleMute' } }}` or turn
them off with `hotkeys={false}`.

## Troubleshooting

- **"media-unsupported-codec" / black video.** Browsers decode different
  codecs. For example, Chromium builds without proprietary codecs cannot play
  H.264/AAC, and Safari needs H.264/HEVC for HLS. Check
  `ref.getCapabilities()` and provide a compatible rendition. See
  [docs/browser-support.md](docs/browser-support.md).
- **CORS.** HLS/DASH segments, external subtitles and `captureFrame()` need
  CORS headers (`Access-Control-Allow-Origin`). Credentialed requests need
  `Access-Control-Allow-Credentials` and an exact origin. A frame from
  cross-origin media without CORS cannot be captured (`capture-tainted`).
- **Autoplay.** Browsers block unmuted autoplay without a user gesture. With
  `autoplay: true`, the player retries muted and reports `onAutoplayBlocked`.
  With `mutedFallback: false`, it waits for the viewer, and the preroll is not
  used up.
- **DRM certificates and licenses.** FairPlay needs a server certificate
  (`serverCertificate` or `serverCertificateUrl`). License failures surface as
  `drm-license-error` with the HTTP status. Protected playback needs HTTPS and
  a browser CDM: Widevine in Chrome, Edge and Firefox (not in open-source
  Chromium), PlayReady in Edge on Windows, FairPlay in Safari.
- **Ads.** Ad blockers commonly block the IMA SDK. The player then reports
  `ad-sdk-load-failed` and plays content without ads. While `ads.vast` is set,
  direct `items` are **never** used, not even as a fallback. For live content,
  numeric cues need `timeBase: "session"`, and postrolls are rejected.
- **Blob lifetimes.** Pass the `Blob`/`File` itself: the player creates and
  revokes the object URL. A `blob:` URL string you created yourself is never
  revoked by the player; revoke it after the player stops using it.
- **Native fullscreen on iPhone.** iOS Safari only lets the `<video>`
  element itself go fullscreen. Captions use native rendering there, and the
  player's overlays (ads, watermark) are not visible.
  `onFullscreenChange` reports `videoOnly: true`. Use `fullscreen.mode: "web"`
  to keep overlays inside the page.

## Documentation

- [docs/api.md](docs/api.md) — every option, event and method
- [docs/architecture.md](docs/architecture.md) — controller, store, engines, managers, vendor decisions
- [docs/browser-support.md](docs/browser-support.md) — browser and device matrix
- [docs/security.md](docs/security.md) — credentials, DRM, redaction, rendering safety
- [docs/ads.md](docs/ads.md) — direct ads, VAST precedence, live ad policy
- [docs/integration-prototype.md](docs/integration-prototype.md) — the integration gate
- [docs/release-checklist.md](docs/release-checklist.md) — scope, status and evidence per feature
- [tests/fixtures/README.md](tests/fixtures/README.md) — test media inventory

## Development

```bash
npm install
npm run fixtures        # synthetic test media (ffmpeg)
npm run typecheck       # package + tests + examples + README snippets
npm test                # unit tests (Vitest)
npm run build           # dist/ (ESM, .d.ts, source maps, styles.css)
npm run test:e2e        # browser tests (Playwright, Chromium)
npm run prototype:gate  # integration prototype gate
npm run consumers       # packed tarball in Node SSR, Vite and Next.js 16 apps
npm pack
```

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
