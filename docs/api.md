# API reference

```ts
import {
  Player, PlayerErrorBoundary, isPlayerError,
  DEFAULT_PLAYBACK_RATES, DEFAULT_VOLUME, DEFAULT_SUBTITLE_STYLE,
  type PlayerProps, type PlayerRef, type PlayerSource, /* …all public types */
} from 'react-stream-player';
import 'react-stream-player/styles.css';

// Framework-independent (same controller, no React):
import { createPlayer, type PlayerHandle } from 'react-stream-player/core';
```

| Entry | Contents | Server import |
| --- | --- | --- |
| `react-stream-player` | `<Player>`, `<PlayerErrorBoundary>`, `isPlayerError`, defaults, all types (`"use client"`) | Safe; renders an empty shell |
| `react-stream-player/core` | `createPlayer(root, options, callbacks?)`, `isPlayerError`, defaults, all types | Importing is safe; `createPlayer` throws on the server |
| `react-stream-player/styles.css` | Required styles (layers, captions, ad UI, Reel, web fullscreen) | — |

## Contents

- [`<Player>` props](#player-props)
  - [Source](#source)
  - [Presentation](#presentation)
  - [Audio, rate and playback](#audio-rate-and-playback)
  - [Quality, audio tracks and subtitles](#quality-audio-tracks-and-subtitles)
  - [Adaptive streaming (Shaka)](#adaptive-streaming-shaka)
  - [Network](#network)
  - [DRM](#drm)
  - [Ads](#ads)
  - [Interaction and platform](#interaction-and-platform)
- [Prop updates: when changes apply](#prop-updates-when-changes-apply)
- [Events](#events)
- [`PlayerRef` (imperative API)](#playerref-imperative-api)
- [State, capabilities and stats](#state-capabilities-and-stats)
- [Errors](#errors)
- [`createPlayer` (core)](#createplayer-core)

## `<Player>` props

`PlayerProps` = `PlayerOptions` + event callbacks (`on…`) + `ref`, `id`,
`className` and `style` (applied to the root `div`). Units are given for every
numeric option. **"Live"** means the change applies without reloading.
**"Reload"** means a controlled reload of the same content session, which
keeps position, selections and ad history.

### Source

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `source` | `PlayerSource \| null` | — (required) | `null` unloads. See below |

```ts
type PlayerSource =
  | { id?: string; revision?: string | number; src: string; type?: 'auto' | 'hls' | 'dash' | 'mp4'; mimeType?: string }
  | { id?: string; revision?: string | number; src: Blob; type: 'mp4'; mimeType?: string }
  | { id?: string; revision?: string | number; type: 'mp4'; variants: ProgressiveVariant[] };

interface ProgressiveVariant {
  id: string;            // unique; 'auto' is reserved
  src: string | Blob;
  label: string;         // plain text
  height?: number; width?: number;
  bitrate?: number;      // bits per second
  mimeType?: string;
}
```

**Type detection.** An explicit `type` wins. Otherwise the MIME hint is used
(`application/x-mpegurl`, `application/vnd.apple.mpegurl`,
`application/dash+xml`, `video/*`). Otherwise the URL path extension is used,
ignoring query and fragment (`.m3u8`, `.mpd`, `.mp4`/`.m4v`/`.webm`/`.mov`).
Unknown URLs fail with `source-type-unknown`; the player never guesses MP4
and never probes the network. URLs must be http(s), relative or `blob:`.

**Identity.**

- `id` + `revision` identify the content.
- A changed URL with the same `id`/`revision` is a *transport refresh*: the
  session state (position, play intent, selections, ad history) is kept.
- Changing `id` or `revision` starts a new content session.
- Without `id`, the transport (URLs or Blob instances, type and MIME) is the
  identity.
- Never reuse an `id`/`revision` for different content.

**Variants** are qualities of **one** video on a shared timeline. Only the
selected variant is loaded. Initial choice: `quality` / `defaultQuality`.
Otherwise, when every variant has a `height`, the player picks the largest
not exceeding the rendered height × `devicePixelRatio`. Otherwise it picks
the first variant. Progressive sources have no Auto.

### Presentation

| Prop | Type | Default | Changes |
| --- | --- | --- | --- |
| `ui` | `'artplayer' \| 'native'` | `'artplayer'` | Live: rebuilds the UI layer only (same `<video>`, no reload) |
| `layout` | `'standard' \| 'reel'` | `'standard'` | Live. `reel` = one portrait video, 9:16 box, max width 420 px on desktop, larger touch targets |
| `aspectRatio` | `string \| number` | `'16 / 9'`; `'9 / 16'` for reel | Live. CSS ratio (`'4 / 3'`) or positive number |
| `fit` | `'contain' \| 'cover' \| 'fill' \| 'none' \| 'scale-down'` | `'contain'` | Live. CSS `object-fit` on the `<video>` (never the container) |
| `objectPosition` | `string` | `'50% 50%'` | Live. CSS `object-position` on the `<video>` |
| `poster` | `string` | — | Live. http(s)/relative/`blob:` only |
| `title` | `string` | — | Live. Accessible name of the player region (plain text) |
| `locale` | `'en' \| 'mn'` | `'en'` | Live |
| `translations` | `Partial<Translations>` | — | Live. Override any UI string, including `errors.<category>` |
| `motion` | `{ enabled?, durationMs?, easing?, reducedMotion? }` | `true`, `200` ms, `'ease'`, `'system'` | Live. `'system'` follows `prefers-reduced-motion`; `'always'` / `'never'` override it |
| `subtitleStyle` | `{ fontSize?, bottom?, color?, backgroundColor?, fontFamily? }` | `20px`, `40px`, `#fff`, `rgba(0, 0, 0, 0.6)`, inherit | Live. Plain CSS values; values with `;`, `{}`, `<>`, `url(` are rejected |
| `watermark` | `{ text?, image?, opacity? (0–1), position?, moveIntervalMs? (ms, ≥ 1000; smaller values disable movement) }` | none; opacity `0.3`; `top-right` | Live. Plain text; non-interactive. Deterrent only, not DRM |
| `contextMenu` | `boolean \| { enabled?, actions? }` | enabled, all actions | Live. Actions: `playbackRate`, `fullscreen`, `captions`, `loop`, `copyDiagnostics`. `false` restores the browser menu |

### Audio, rate and playback

| Prop | Type | Default | Changes |
| --- | --- | --- | --- |
| `defaultVolume` | `number` (0–1) | `0.7` | Initial only (uncontrolled). Never persisted |
| `volume` | `number` (0–1) | — | Controlled; pair with `onVolumeChange` |
| `defaultMuted` / `muted` | `boolean` | `false` / — | Same pattern |
| `defaultPlaybackRate` / `playbackRate` | `number` (0 < r ≤ 16) | `1` / — | Same pattern; clamped to `playbackRates` bounds |
| `playbackRates` | `number[]` | `[0.5, 0.75, 1, 1.25, 1.5, 2]` | Live. Sorted, de-duplicated |
| `autoplay` | `boolean \| { enabled: boolean; mutedFallback?: boolean }` | `false` | Applies at content start. `true` = try unmuted, then muted (`mutedFallback` default `true`). A blocked autoplay does not use up the preroll |
| `loop` | `boolean` | `false` | Live. A viewer toggle (context menu) lasts until this prop changes |
| `preload` | `'none' \| 'metadata' \| 'auto'` | `'metadata'` | Live (affects the next load) |
| `playsInline` | `boolean` | `true` | Live |
| `seekStep` | `number` (s) | `10` | Live. Seek buttons, ←/→, Media Session |
| `progressInterval` | `number` (ms, 100–60000) | `1000` | Live. Cadence of `onProgress` |
| `live` | `{ edgeTolerance?: number }` (s) | `3` | Live. "At live edge" threshold |
| `pauseWhenHidden` | `boolean` | `false` | Live. Pause while the page is hidden; resume if the viewer intended to play |
| `preventClickToggle` | `boolean` | `false` | Live. Clicking the video does not toggle play |

**Controlled props** (`volume`, `muted`, `playbackRate`, `quality`,
`audioTrack`, `subtitleTrack`): the player renders the prop value. Viewer
actions and ref setters only *request* a change through the matching
`on…Change` callback. If the host does not update the prop, the value springs
back. There are no feedback loops: an update to the same value emits nothing.

### Quality, audio tracks and subtitles

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `defaultQuality` | `'auto' \| string` | `'auto'` (adaptive); see variants above | Applies at content start |
| `quality` | `'auto' \| string` | — | Controlled; `onQualityChange`. Manual selection disables ABR until `'auto'` |
| `defaultAudioLanguage` | BCP-47 `string` | manifest default | Applies at content start |
| `audioTrack` | `string` (track id) | — | Controlled; `onAudioTrackChange` |
| `subtitles` | `SubtitleTrack[]` | `[]` | Live (diffed; the current selection is kept if the track still exists). External **WebVTT** only: `{ id, src: string \| Blob, label, language, kind?, default? }`. Other formats → `subtitle-format-unsupported` |
| `subtitleTrack` | `string \| null` | — | Controlled; `null` = off; `onSubtitleChange` |
| `defaultSubtitleTrack` | `string \| null` | — | Applies at content start |
| `defaultSubtitleLanguage` | BCP-47 `string` | — | Applies at content start |

**Subtitle priority** at content start: `subtitleTrack` (controlled), then
`defaultSubtitleTrack`, then `defaultSubtitleLanguage` (external tracks before
manifest tracks with that language), then a track marked `default`, then off.
"Off" chosen by the viewer survives quality switches, refreshes and retries.
Manifest (HLS/DASH) and external tracks appear in one list
(`origin: 'manifest' | 'external'`). Captions render inside the player DOM (Shaka
`UITextDisplayer` or the package renderer), so they show in browser
fullscreen and follow `subtitleStyle`. They are not shown in iPhone
video-only fullscreen or PiP windows.

### Adaptive streaming (Shaka)

Names and units follow Shaka Player 5.2.12 (`streaming.*`, `abr.*`). The
native MP4 path ignores these options and reports `streamingConfig`
unsupported in `getCapabilities()`. Changes cause a **reload**. Measured Shaka
defaults are in [shaka-5.2.12-defaults.json](shaka-5.2.12-defaults.json).

| Prop | Fields (unit) |
| --- | --- |
| `streaming` | `bufferingGoal` (s, default 10, a target, not a RAM cap), `rebufferingGoal` (s, default 0, must be ≤ `bufferingGoal`), `bufferBehind` (s, 30), `lowLatencyMode` (Shaka 5.2.12 default `true`), `gapDetectionThreshold` (s), `gapJumpTimerTime` (s), `stallEnabled`, `stallThreshold` (s), `stallSkip` (s), `segmentPrefetchLimit` (count), `loadTimeout` (s), `liveSync { enabled, targetLatency (s), targetLatencyTolerance (s), minPlaybackRate (0–1], maxPlaybackRate (≥ 1) }`, `preferNativeHls`, `useNativeHlsForFairPlay` |
| `abr` | `enabled`, `defaultBandwidthEstimate` (bit/s), `switchInterval` (s), `restrictToElementSize`, `restrictToScreenSize`, `restrictions { minWidth, maxWidth, minHeight, maxHeight, minBandwidth, maxBandwidth (bit/s), maxFrameRate }` |
| `advanced` | `{ shaka?: Record<string, unknown> }`: an escape hatch merged **before** the high-level options (which win on conflicts). These keys are removed: `textDisplayFactory`, `abrFactory`, `adaptationSetCriteriaFactory`, `streaming.failureCallback`, `drm.servers`, `drm.advanced`, `drm.clearKeys`, `drm.initDataTransform`, `drm.failureCallback`, `queue`, `offline`. Version-specific: re-check on Shaka upgrades |

Invalid values are reported once as non-fatal `invalid-config` errors, and the
offending field is ignored. Playback continues.

### Network

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `network.retry.{manifest,segment,license}` | `RetryPolicy` | Shaka defaults (2 attempts, 1000 ms, ×2, 0.5, 30000/10000/5000 ms) | `maxAttempts` (**includes the first attempt**, ≥ 1), `baseDelayMs`, `backoffFactor` (≥ 1), `jitter` (0–1), `timeoutMs`, `connectionTimeoutMs`, `stallTimeoutMs`. Reload |
| `network.fatalRetryLimit` | integer | `1` (max 5) | Automatic reloads after a fatal network/source error; reported as non-fatal with `details.autoRetry` |
| `network.credentials` | `CredentialRule[]` | — | Exact origins + request types; static or callback headers; `withCredentials`. Live (next request). See [security.md](security.md) |
| `network.credentialedRedirect` | `'error' \| 'allow'` | `'error'` | Fail closed when a credentialed response ends outside the allowlist |
| `network.onRequest` / `onResponse` | `(req) => void \| Promise<void>` | — | Shaka requests only (manifest, segment, subtitle, license, certificate, …). Not called for native MP4 |
| `network.crossOrigin` | `'anonymous' \| 'use-credentials' \| null` | not set | `crossorigin` on the `<video>` (native MP4, `<track>`). Set `'anonymous'` when the origin sends CORS headers; required for cross-origin `<track>` files and `captureFrame` |

Function-valued options (`onRequest`, header callbacks, `getLicenseToken`,
transforms, `cast.getCustomData`) may change identity on every render. The
latest function is always used, and identity changes never cause a reload.

### DRM

```ts
drm={{
  keySystems: {
    'com.widevine.alpha': { licenseUrl, headers?, videoRobustness?, audioRobustness?, serverCertificate?, serverCertificateUrl? },
    'com.microsoft.playready': { licenseUrl },
    'com.apple.fps': { licenseUrl, serverCertificateUrl /* or serverCertificate */ },
  },
  preferredKeySystems?: KeySystem[],
  getLicenseToken?: ({ keySystem }) => Promise<string | null> | string | null, // → Authorization: Bearer …
  transformLicenseRequest?: (req: LicenseRequest) => LicenseRequest | void,   // body: Uint8Array
  transformLicenseResponse?: (res: LicenseResponse) => LicenseResponse | void, // data: Uint8Array
  initDataTransform?: (initData, initDataType, { keySystem, serverCertificate }) => Uint8Array, // FairPlay content id
  clearKeys?: Record<string, string>,  // DEVELOPMENT/TESTING ONLY
}}
```

HLS/DASH only; protected progressive MP4 fails with
`drm-progressive-unsupported`. Changes cause a reload. Errors:
`drm-unsupported`, `drm-license-error` (with `details.httpStatus`),
`drm-certificate-error`, `drm-no-license-server`, `drm-output-restricted`,
`drm-error`. Platform matrix: [browser-support.md](browser-support.md#drm-matrix-v1-selection).

### Ads

`ads={{ enabled?, vast?, items?, loadTimeoutMs?, replayOnLoop? }}` and
`clickThroughSchemes`. VAST has unconditional precedence over direct items.
Full rules: [ads.md](ads.md).

| Field | Type | Default |
| --- | --- | --- |
| `ads.enabled` | `boolean` | `true` |
| `ads.vast` | `{ adTagUrl, requestTimeoutMs? (ms, IMA 5000), loadVideoTimeoutMs? (ms, IMA 8000), mimeTypes?, sdkLoadTimeoutMs? (ms, 10000), debugSdk? }` | — |
| `ads.items` | `DirectAd[]` (text / image / video) | `[]` |
| `ads.loadTimeoutMs` | `number` (ms) | `8000` |
| `ads.replayOnLoop` | `boolean` | `false` |
| `clickThroughSchemes` | `string[]` (e.g. `['myapp']`) | `[]` (http(s)/relative only) |
| `nonce` | `string` | — (CSP nonce for injected IMA/Cast scripts) |

### Interaction and platform

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `hotkeys` | `boolean \| { enabled?, seekSeconds? (s), volumeStep? (0–1, 0.05), fullscreenMode?, bindings? }` | enabled | Live. `bindings` maps `KeyboardEvent.key` → action (`null` unbinds). Actions: `togglePlay`, `seekBackward`, `seekForward`, `volumeUp`, `volumeDown`, `seekToPercent`, `seekToStart`, `seekToEnd`, `toggleFullscreen`, `toggleMute`, `toggleCaptions`, `nextRate`, `previousRate`, `exitWebFullscreen` |
| `fullscreen` | `{ mode?: 'browser' \| 'web'; fallbackToWeb?: boolean }` | `'browser'`, `false` | Live (next toggle) |
| `pictureInPicture` | `boolean` | `true` | Live. Offered only where supported |
| `airplay` | `boolean` | `true` | Live. Offered only where the WebKit API exists |
| `cast` | `{ enabled?, receiverApplicationId?, customReceiver?, receiverHandlesAds?, resumeLocalOnDisconnect?, getCustomData? }` | disabled; Default Media Receiver; resume `true` | Enabling loads the Cast sender SDK lazily. See [examples/cast-receiver](../examples/cast-receiver) |
| `mediaSession` | `{ enabled?, title?, artist?, album?, artwork? }` | disabled | Live. Metadata changes never reload |

## Prop updates: when changes apply

Every render passes the latest props to the controller, which compares them
**semantically**:

- Equal values in new objects or arrays → no work.
- New function identities → adopted silently.
- Only real changes are applied.

| Change | Effect |
| --- | --- |
| `source` (same identity) | None |
| `source` URL, same `id`/`revision` | Transport refresh: same session, position/play/selections/ad history kept, no preroll replay |
| `source.id` / `revision` / identity | New content session (new `contentSessionId`) |
| `streaming`, `abr`, `drm`, `advanced`, `network.retry` | Controlled reload of the same session (adaptive sources) |
| `quality` (MP4) | Variant switch: last selection wins; time, play state, rate, volume and captions kept; falls back to the previous variant on failure |
| `quality` (HLS/DASH), `audioTrack`, `subtitleTrack`, `subtitles` | Applied in place |
| `ui` | UI layer rebuilt around the same `<video>`; no reload |
| Everything else | Applied in place (see the tables) |

## Events

React: `on` + capitalized name (`onReady`, `onQualityChange`, …). Ref:
`ref.on(name, listener)` returns an unsubscribe function; `once` and `off`
are also available. Adding the same listener twice registers it once; `once`
listeners are removed before they run; a throwing listener never breaks the
player (the error is reported via `reportError`). Every listener receives
`(payload, context)`. `context` is
`{ contentSessionId, loadId, timestamp }`; use it to ignore stale events.

| Event | Payload |
| --- | --- |
| `ready` | `{ sourceType, engine: 'native' \| 'shaka', duration: number \| null, isLive }` (once per content session) |
| `loadStart` | `{ reason: 'initial' \| 'quality' \| 'refresh' \| 'retry' \| 'cast-return', sourceType }` |
| `statusChange` | `'idle' \| 'loading' \| 'ready' \| 'error' \| 'destroyed'` |
| `play`, `pause`, `playing`, `ended` | `{ currentTime }` (content only; ads never emit content `ended`) |
| `progress` | `{ currentTime, duration, buffered, sessionTime }` every `progressInterval` ms |
| `seeking`, `seeked` | `{ currentTime }` |
| `buffering` | `boolean` (300 ms debounce) |
| `durationChange` | `number \| null` |
| `qualityChange` / `effectiveQualityChange` / `availableQualitiesChange` | `QualitySelection` / `QualityTrack \| null` / `QualityTrack[]` |
| `audioTrackChange` / `availableAudioTracksChange` | `AudioTrack \| null` / `AudioTrack[]` |
| `subtitleChange` / `availableSubtitlesChange` | `SubtitleTrackInfo \| null` / `SubtitleTrackInfo[]` |
| `volumeChange`, `mutedChange`, `playbackRateChange` | `number`, `boolean`, `number` |
| `fullscreenChange` | `{ active, mode, videoOnly }` |
| `pictureInPictureChange` | `boolean` |
| `liveStateChange` | `LiveState` (`isLive`, `atLiveEdge`, `seekableRange`, `behindLiveEdge`, `latency`, `targetLatency`) |
| `liveRestore` | `{ reason: 'live-edge' \| 'dvr-position' \| 'dvr-window-expired', position }` |
| `autoplayBlocked` | `{ mutedFallback: 'succeeded' \| 'failed' \| 'disabled' }` |
| `error` | `PlayerError` (fatal and non-fatal) |
| `adBreakStart` / `adBreakEnd` | `{ breakId, pipeline, placement }` / `+ reason` |
| `adStart`, `adSkip`, `adComplete`, `adClick` | `AdInfo` |
| `adProgress` | `{ ad, currentTime, duration, skippableIn }` (ad timeline) |
| `adError` | `PlayerError` (content continues) |
| `castStateChange` | `{ status: 'unavailable' \| 'available' \| 'connecting' \| 'connected', deviceName }` |
| `airplayChange` | `{ available, active }` |
| `destroy` | `{ reason: 'destroy' \| 'unmount' }` |

## `PlayerRef` (imperative API)

```ts
const ref = useRef<PlayerRef>(null);
<Player ref={ref} … />
```

Async methods reject with a `PlayerError` instead of hanging:
`player-not-ready` before a source is ready, `player-destroyed` after
destroy, `unsupported-operation` when the action does not apply. With
controlled props, setters only request the change (see above).

| Method | Notes |
| --- | --- |
| `play(): Promise<void>` | Resolves when playback starts (content, or a preroll break). Rejects `autoplay-blocked` without a user gesture |
| `pause()` | Pauses content (or the active ad) |
| `seekTo(s)`, `seekBy(Δs)` | Clamped to the duration (VOD) or the seekable window (live). Rejected during linear ads |
| `seekToLive()` | Live only |
| `setVolume(0–1)`, `setMuted(b)`, `setPlaybackRate(r)` | |
| `getQualities()`, `setQuality('auto' \| id)` | `'auto'` only for HLS/DASH |
| `getAudioTracks()`, `setAudioTrack(id)` | |
| `getSubtitleTracks()`, `setSubtitleTrack(id \| null)` | |
| `fullscreen.request(mode)`, `.cancel(mode)`, `.toggle(mode)` | `mode`: `'browser'` \| `'web'`; reject `fullscreen-rejected` / `fullscreen-unsupported` |
| `enterPictureInPicture()`, `exitPictureInPicture()` | Reject `pip-unsupported` / `pip-rejected` |
| `startCasting()`, `stopCasting()` | Require `cast.enabled`; reject `cast-unavailable` or `cast-rejected` with `details.reason` |
| `captureFrame(): Promise<Blob \| null>` | PNG Blob owned by the caller (no object URL is created). Rejects `capture-protected` (DRM) and `capture-tainted` (cross-origin without CORS) |
| `getState()`, `getStats()`, `getCapabilities()` | Snapshots (see below) |
| `retry()` | Reloads the failed or current load, keeping session state and ad history |
| `destroy()` | Idempotent; the component also destroys on unmount |
| `on` / `once` / `off` | See [Events](#events) |

## State, capabilities and stats

- **`getState(): PlayerState`** contains:
  - session: `status`, `contentSessionId`, `loadId`, `sourceType`, `engine`;
  - presentation: `ui`, `layout`, `fit`;
  - playback: `intendedPlaying`, `paused`, `ended`, `buffering`, `seeking`,
    `currentTime`, `duration`, `buffered`, `seekable`;
  - audio and rate: `volume`, `muted`, `playbackRate`, `playbackRates`;
  - tracks: `quality { selected, effective, available, autoAvailable }`,
    `audio`, `subtitles`;
  - platform: `live`, `fullscreen`, `pictureInPicture`, `cast`, `airplay`;
  - ads: `ad { active, pipeline, ad, currentTime, duration, skippableIn }`;
  - `error`.

  Times are in seconds; `duration` is `null` when unknown or unbounded (live).
- **`getCapabilities(): PlayerCapabilities`** gives
  `{ supported: true } | { supported: false, reason }` for each of:
  `adaptiveQuality`, `manualQuality`, `audioTrackSelection`,
  `subtitleSelection`, `playbackRate`, `volumeControl`, `browserFullscreen`,
  `webFullscreen`, `pictureInPicture`, `airplay`, `cast`, `mediaSession`,
  `captureFrame`, `drm`, `streamingConfig`, `requestInterception`,
  `contextMenu` and `liveSeek`. It also reports `engine`.
- **`getStats(): PlayerStats`** has three groups:
  - `content`: session playback time, bandwidth estimate, resolution,
    dropped/decoded frames, stalls, gaps, buffering time, load latency, live
    latency and load attempts (adaptive engines fill more fields);
  - `advertising`: pipeline, started/completed/skipped/errors;
  - `remote`: Cast and AirPlay state.

  Values are redacted and contain no URLs or tokens.

## Errors

Every error is a `PlayerError`:

```ts
interface PlayerError extends Error {
  name: 'PlayerError';
  category: 'network' | 'source' | 'manifest' | 'media' | 'drm' | 'subtitle' | 'ads' | 'cast'
          | 'fullscreen' | 'pip' | 'capture' | 'unsupported' | 'config' | 'state' | 'unexpected';
  code: PlayerErrorCode;      // stable
  fatal: boolean;             // playback stopped
  recoverable: boolean;       // retry() may help
  contentSessionId: string | null;
  loadId: number | null;
  details: Readonly<Record<string, string | number | boolean | null>>; // e.g. httpStatus, shakaCode, imaErrorCode, reason
  cause?: unknown;            // redacted copy of the vendor error
}
```

Use `isPlayerError(value)` to narrow. Messages are safe to display. They
never contain URLs or tokens, and are localized in the error UI through
`translations.errors[category]`. A fatal error shows the in-player error panel
with a Retry button when `recoverable`.

| Category | Codes |
| --- | --- |
| network / source | `network-error`, `network-timeout`, `http-error`, `source-not-found`, `source-type-unknown`, `source-invalid`, `source-unsupported`, `credential-redirect-blocked` |
| manifest | `manifest-error` |
| media | `media-decode-error`, `media-unsupported-codec`, `media-aborted`, `media-error` |
| drm | `drm-unsupported`, `drm-license-error`, `drm-certificate-error`, `drm-no-license-server`, `drm-output-restricted`, `drm-error`, `drm-progressive-unsupported` |
| subtitle | `subtitle-format-unsupported`, `subtitle-load-error` (never fatal) |
| ads | `ad-load-timeout`, `ad-load-error`, `ad-media-error`, `ad-invalid-config`, `ad-sdk-load-failed`, `ad-no-fill`, `ad-vast-error`, `ad-unsupported` (never fatal; emitted as `adError`) |
| cast | `cast-unavailable`, `cast-rejected`, `cast-error` |
| fullscreen / pip / capture | `fullscreen-unsupported`, `fullscreen-rejected`, `pip-unsupported`, `pip-rejected`, `capture-protected`, `capture-tainted`, `capture-unsupported` |
| config / state | `invalid-config`, `unsupported-operation`, `player-not-ready`, `player-destroyed`, `operation-aborted`, `autoplay-blocked`, `unexpected-error` |

`<PlayerErrorBoundary fallback? onRenderError?>` catches failures of the React
wrapper itself. `<Player>` already includes one. Media errors never reach it.

## `createPlayer` (core)

```ts
import { createPlayer } from 'react-stream-player/core';
import 'react-stream-player/styles.css';

const player = createPlayer(document.getElementById('player')!, { source: { src: '/movie.mp4' } }, {
  onReady: (info) => console.log(info.engine),
});
player.update({ source: { src: '/movie.mp4' }, fit: 'cover' });   // same diff semantics as props
player.update({ source: { src: '/movie.mp4' } }, { onError: console.error }); // replace callbacks
await player.destroy();
```

`PlayerHandle` = `PlayerRef` + `update(options, callbacks?)`. Give the root
element a size, for example `aspect-ratio: 16 / 9`.
