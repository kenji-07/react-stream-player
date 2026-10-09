# Browser and device support

**Verified** means exercised by this repository's automated tests on the
listed engine. **Expected** means the platform's documented APIs, Shaka 5.2
and Artplayer 5.4 support it, but this release has not tested it. Expected
rows must not be advertised as production-supported until they are verified
(see [release-checklist.md](release-checklist.md)).

## Test environment used for this release

| Item | Version |
| --- | --- |
| Browser | Chromium 141.0.7390.37 (open-source build, headless), Playwright 1.56.1, Linux x64 |
| Node.js | 22.22.0 |
| React | 19.3.0 (unit/e2e), 19.0.0 (packed-artifact Vite consumer) |
| Next.js | 16.4.0 (packed-artifact consumer) |
| Vite | 8.3.4 |
| TypeScript | 6.0.x |
| Fixtures | VP9 + Opus (open-source Chromium has no H.264/AAC decoder) |

## Requirements

- React and React DOM **19.0.0 or newer**.
- An ES2022 browser. Shaka Player 5.2 requires MediaSource Extensions for
  HLS/DASH, or native HLS (Safari).
- Next.js App Router: 16 verified (`next build` + `next start` from the packed
  tarball). Pages Router and older versions are not tested.
- SSR: the package can be imported on the server with no DOM globals (Node
  ≥ 18.18), and renders an empty sized shell.

## Playback matrix

| Capability | Chromium/Chrome (desktop) | Edge | Firefox | Safari macOS | iOS/iPadOS Safari | Android Chrome |
| --- | --- | --- | --- | --- | --- | --- |
| Progressive MP4 (native `<video>`) | **Verified** (VP9/Opus) | Expected | Expected | Expected | Expected; gate 7 **externally unverified** | Expected |
| MP4 quality variants | **Verified** | Expected | Expected | Expected | Expected | Expected |
| HLS VOD (Shaka/MSE) | **Verified** (fMP4) | Expected | Expected | Expected (Shaka may prefer MSE; `streaming.preferNativeHls`) | Expected; iOS ≥ 17.1 has ManagedMediaSource, older versions use native HLS with reduced control | Expected |
| DASH VOD | **Verified** | Expected | Expected | Expected (MSE) | Expected on iOS ≥ 17.1 (ManagedMediaSource); otherwise unsupported | Expected |
| HLS / DASH live with DVR | **Verified** (regular latency) | Expected | Expected | Expected | Expected | Expected |
| LL-HLS / LL-DASH | Config mapping verified; real low latency **externally unverified** | Same | Same | Same | Same | Same |
| Audio track selection | **Verified** (HLS, DASH) | Expected | Expected | Expected | Native-HLS fallback: depends on Safari | Expected |
| Manifest + external WebVTT | **Verified** | Expected | Expected | Expected | Expected; video-only fullscreen uses native captions | Expected |

Codecs come from the browser, not this package. H.264/AAC needs a
proprietary-codec build (Chrome, Edge and Safari have one; open-source
Chromium does not). HEVC and AV1 support varies. Check
`getCapabilities()`, and `onError` (`media-unsupported-codec`).

## DRM matrix (v1 selection)

| Key system | Source | Browsers where the CDM exists | Status in this release |
| --- | --- | --- | --- |
| ClearKey (`org.w3.clearkey`), dev/test only | DASH (CENC) | Chromium, Firefox, Edge | **Verified** in Chromium: license URL, token header, request/response transforms, license retry, 401 mapping, inline keys |
| Widevine (`com.widevine.alpha`) | DASH (CENC), HLS (CMAF/CENC) | Chrome, Edge, Firefox, Android | **Externally unverified**: needs an authorized provider fixture and a browser with the Widevine CDM |
| PlayReady (`com.microsoft.playready`) | DASH (CENC) | Edge on Windows | **Externally unverified** |
| FairPlay (`com.apple.fps`) | HLS (CBCS), native HLS | Safari macOS/iOS | **Externally unverified**: needs a FairPlay deployment package, certificate and real hardware |

Protected progressive MP4 is not supported (`drm-progressive-unsupported`).
DRM needs a secure context (HTTPS).

## Platform features

| Feature | API | Status / notes |
| --- | --- | --- |
| Browser fullscreen | Fullscreen API on the player element. WebKit prefix next. Then `webkitEnterFullscreen()` on the video (iPhone) | **Verified** in Chromium, including rejection and Escape. In iPhone video-only fullscreen, DOM captions, ads and watermark are hidden; `videoOnly: true` is reported. iPhone is **externally unverified** |
| Web fullscreen | CSS inside the page | **Verified**: scroll lock, focus and scroll restoration, single page-level holder, Escape |
| Picture-in-Picture | Standard `requestPictureInPicture` (enabled only when `document.pictureInPictureEnabled`) | Feature-detected. DOM captions, ads and watermark are not shown in the PiP window. **Externally unverified** beyond feature detection (headless Chromium cannot open PiP) |
| AirPlay | Artplayer's AirPlay control (`webkitShowPlaybackTargetPicker`) and WebKit availability events | Feature-detected; button only when available. **Externally unverified** (needs Safari and an AirPlay receiver) |
| Chromecast | Cast Web Sender SDK (lazy) | Sender logic and rejection reasons implemented. **Externally unverified** (SDK host blocked here; no device). See [examples/cast-receiver](../examples/cast-receiver) |
| Media Session | `navigator.mediaSession` | **Verified** in Chromium: metadata, play/pause/seek actions, finite position state, owner hand-off, seek ignored during ads, cleanup. Lock-screen and notification UI on mobile is **externally unverified** |
| Volume control | `video.volume` | iOS ignores programmatic volume; `getCapabilities().volumeControl` reports this |
| Autoplay | Browser policy | Muted fallback verified using an emulated "user activation required" policy (headless Chromium does not enforce the real one) |
| Keyboard / screen readers | DOM focus, ARIA | Keyboard paths verified in Chromium. Screen-reader output is not automatically tested |
| `prefers-reduced-motion` | Media query | **Verified** |

## Known limitations

- **One video per player.** Feeds, playlists and adjacent-video preloading
  are out of scope.
- **`CastContext` options are page-global.** The first player that enables
  Cast sets the receiver app ID.
- **Artplayer's stylesheet** is injected inline. A strict `style-src` CSP
  must allow it (see [security.md](security.md)).
- **Native-UI mode** (`ui="native"`) uses the browser's controls and
  captions. The package's context menu, quality menu and request
  interception (for MP4) are not available; capabilities report this.
