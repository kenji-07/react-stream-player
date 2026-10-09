# Architecture

## Selected versions

| Component | Version | Why this pin |
| --- | --- | --- |
| shaka-player | `~5.2.12` | Single engine for HLS/DASH, live/DVR, ABR, DRM (EME) and networking filters. Patch updates allowed; option names and defaults are verified against 5.2.12 ([measured defaults](shaka-5.2.12-defaults.json)) |
| artplayer | `5.4.0` (exact) | Existing prebuilt UI. The adapter relies on verified internals (proxy option, control registry, storage, context menu), so upgrades must be re-verified |
| Google IMA HTML5 SDK | loaded at runtime (`ima3.js`) | VAST/VMAP. Local typings conform to `@types/google_interactive_media_ads_types` 3.697 (type test) |
| Google Cast Web Sender (CAF) | loaded at runtime | Casting (sender only) |
| React / React DOM | peers `>= 19.0.0` | Tested with 19.0.0 and 19.3.0 |

## Layers

```
<Player> (React, "use client")      createPlayer() (core, no React)
        │  props → update(), callbacks read lazily      │
        └──────────────────────┬───────────────────────┘
                     PlayerController
   one normalized state store · one typed event stream · content sessions
   ┌──────────┬───────────┬───────────┬──────────┬──────────┬─────────────┐
 Engines   UI adapter   Managers                                     Resources
 native    Artplayer    subtitles · quality · ads (direct + IMA)     BlobRegistry
 shaka     native UI    fullscreen · hotkeys · cast · media session  captureFrame
                        layers (captions, ads, status, watermark)    security (URL,
                                                                     credentials, redaction)
```

- **`PlayerController`** (`src/controller/controller.ts`) owns:
  - the one `<video>` element for content;
  - the engines, the UI adapter, managers, timers, listeners, object URLs and
    SDK subscriptions;
  - the single normalized `PlayerState`.

  Every input goes through the controller: UI controls, hotkeys, the ref API,
  Media Session actions and Cast. Every output is one typed event. React,
  the UI and the managers never talk to each other directly.
- **Engines** (`src/engines`) implement one `MediaEngine` interface:
  - `NativeVideoEngine` sets `video.src` for progressive MP4;
  - `ShakaEngine` wraps a `shaka.Player` attached to the same `<video>`.

  Only one engine is attached at a time.
- **UI adapters** (`src/ui`) present controls and menus but never own
  playback. `ArtplayerAdapter` wraps Artplayer around the controller's
  `<video>`. `NativeUiAdapter` enables the browser's controls.
- **Managers** each own one concern, with explicit `destroy()`:

  | Manager | Owns |
  | --- | --- |
  | `SubtitleManager` | external + manifest tracks, priority rules, rendering target |
  | `quality-manager` | quality list, initial variant, menu, last-wins switch sequencing |
  | `AdsManager` | pipeline selection, cue schedule, direct presenter or IMA pipeline |
  | `FullscreenManager` | browser and web fullscreen |
  | `HotkeyManager` | keyboard shortcuts |
  | `CastManager` | Cast sender |
  | `MediaSessionManager` | `navigator.mediaSession` |

## Content sessions and identity

`normalizeSource()` turns a `PlayerSource` into two keys:

- **`contentKey`**: `id` + `revision` when an id is given, otherwise the
  transport.
- **`transportKey`**: the URLs or Blob identities (per instance, via a
  `WeakMap`), type, MIME and variant metadata.

Then, on each update:

- **Same `contentKey` and `transportKey`** → nothing happens. Rerenders with
  new inline objects are no-ops.
- **Same `contentKey`, new `transportKey`** → *transport refresh*, used for
  re-signed URLs:
  - the session continues (position, play intent, selections, cue history,
    session clock);
  - `loadStart({ reason: 'refresh' })` is emitted, but no new `ready`, no
    preroll and no duplicate `play`/`seek` events.
- **New `contentKey`** → *new content session*: new `contentSessionId`,
  state reset, ads re-evaluated, the previous session's async work aborted.

Each engine load gets a monotonically increasing `loadId` and an
`AbortController`. Stale completions, from rapid source or quality changes or
an unmount during load, are ignored. Events carry
`{ contentSessionId, loadId }` so hosts can do the same.

Option updates are diffed with `semanticEqual`:

- plain values are compared structurally;
- functions compare by presence, while the latest reference is always adopted;
- Blobs compare by reference and byte arrays by content.

React passes props on every render. Callbacks are read lazily from the
latest props, so new callback identities never re-initialise anything.

## Play intent, ads and restoration

The controller separates **intent** (`intendedPlaying`) from element state:

- `video.play`/`pause` are wrapped on the instance, so third-party code
  (Artplayer's own controls) goes through the controller.
- The first play intent of a session:
  1. probes autoplay when needed (muted fallback);
  2. sets the media-time cue baseline;
  3. asks the ads manager for a preroll.

  `play()` resolves as soon as playback starts, whether that is the preroll
  break or the content.
- A *preroll gate* stops content from starting while the IMA decision or the
  preroll is pending, even if more play intents arrive.
- Linear breaks:
  - `beginLinearBreak` snapshots position and live-edge state and pauses
    content;
  - `endLinearBreak` restores **exactly once** per break, whatever the
    outcome (complete, skip, error, cancel or teardown).
  - Live restoration picks the edge, the DVR position, or the window start if
    that position expired.
- `SessionClock` measures active content playback (monotonic,
  `performance.now()`), pausing for pause, buffering, seeking and ads. It
  drives `timeBase: "session"` cues and `sessionTime`, and lives only in
  memory.

## Vendor decisions

Each item was verified against the pinned versions, by source reading plus
the integration prototype and e2e tests.

**Artplayer 5.4.0**

- `proxy: () => video` makes Artplayer adopt the controller's `<video>`.
  `url: ''` with a sentinel `type`/`customType` whose handler does nothing:
  Artplayer's `url` setter otherwise assigns `video.src` and revokes the
  previous object URL.
- `art.storage` is replaced by per-instance memory, because Artplayer
  persists volume in `localStorage`.
- The context menu's version entry, which links to artplayer.org with the
  page URL, and the info panel, which shows `currentSrc` (possibly a signed
  URL), are removed. The package adds its own items: rates, captions,
  fullscreen, loop, copy diagnostics.
- Static globals (`Artplayer.PLAYBACK_RATE`, `CONTEXTMENU`, …) are never
  modified, so several players and other Artplayer users on a page do not
  interfere.
- `controls.add()` returns `undefined` in 5.4.0, so the element is read from
  `controls[name]`.
- Settings menus are rebuilt only when their items change; checkmarks update
  in place. Labels are passed as DOM nodes built with `textContent`.
- Input routing: the adapter owns video-area clicks (play/pause unless
  `preventClickToggle`) and double clicks (configured fullscreen mode).
  Artplayer's hotkeys are disabled; `HotkeyManager` is the single keyboard
  owner.
- An accessibility pass labels controls, sets roles and makes menus
  keyboard-operable. A `MutationObserver` re-applies it when Artplayer
  re-renders.

**Shaka Player 5.2.12**

- `polyfill.installAll()` runs once per page before `isBrowserSupported()`.
- `setVideoContainer()` must be called **before** `attach()`, or Shaka uses
  native text tracks instead of `UITextDisplayer`. Captions therefore render
  in the player DOM and follow `subtitleStyle`.
- External WebVTT is added with `addTextTrackAsync` using kind
  `subtitles`/`captions`.
- Track IDs are derived and stable, so selections survive manifest updates:
  - video: size, bandwidth, frame rate, plus a hash of codecs/HDR;
  - audio: a hash of language, label, channels, codecs and roles.
- Request and response filters implement credential rules, license token
  and transforms, `onRequest`/`onResponse`, and the fail-closed redirect
  check. Non-Shaka exceptions from `load()` (for example a malformed MPD
  surfacing as a DOM error) map to `manifest-error`.
- High-level options are mapped by name (`buildShakaConfig`). The `advanced`
  escape hatch is merged first, minus keys that would bypass ownership.

**Google IMA**

- The SDK is loaded once per page from the documented URL, with an optional
  nonce. Failures are not cached.
- The `AdDisplayContainer` is initialised synchronously inside the first user
  gesture.
- `CONTENT_PAUSE_REQUESTED` and `CONTENT_RESUME_REQUESTED` map to linear
  breaks. `contentComplete()` is called at content end.
- No VAST parsing or ad rules are reimplemented.

**Google Cast**

- The sender SDK is loaded only when `cast.enabled`.
- The controller decides castability and returns explicit rejection reasons
  (DRM/auth need a custom receiver; ads need receiver support; Blobs are
  never cast).
- Remote position is tracked from `RemotePlayer` events, and local playback
  resumes from it on disconnect.

## Lazy loading, bundles and SSR

- The output is unbundled ESM (`tsc`), so consumer bundlers can split the
  code. The `"use client"` directive is kept on the React entry and its
  component modules, and `core.js` stays directive-free.
- Shaka, Artplayer, IMA and Cast are loaded with dynamic `import()` or
  script injection only when needed.
- Measured in a Vite 8 consumer (`npm run consumers`, gzip):
  - entry (React + package): 104 KiB;
  - Shaka chunk: 261 KiB, loaded only for HLS/DASH;
  - Artplayer chunk: 36 KiB, loaded only for `ui="artplayer"`.
- In the browser, native MP4 never requested the Shaka chunk. The Next.js 16
  consumer confirmed the same.
- No browser global is touched at module evaluation. On the server
  `<Player>` renders an empty, sized root `div` (aspect ratio and poster as
  CSS variables), and the controller is created in an effect after hydration.

## Cleanup

`destroy()` is idempotent and safe during loading and React Strict Mode's
double mount. It aborts the in-flight load, then destroys:

- the engine;
- the UI adapter;
- every manager;
- every timer, listener and observer;
- the session's object URLs (deferred revocation after detach);
- Media Session ownership;
- web-fullscreen page locks;
- IMA ads managers.

Shared SDK loaders (IMA, Cast) survive one player unmounting. The e2e suite
checks that after Strict Mode, source replacement and unmount there is
exactly one (or zero) `<video>`, Artplayer instance and Shaka engine.

## Tests

| Layer | Tooling | Location |
| --- | --- | --- |
| Unit (pure logic, managers in jsdom, SSR in Node, static safety) | Vitest 5 | `tests/unit` |
| Types (README samples incl. negative cases, IMA typing conformance, examples) | `tsc` | `tests/types`, `examples/nextjs/components` |
| Browser integration (real media, fake IMA/Cast SDKs, fixture server with failure routes, live encoder) | Playwright 1.56 + Chromium 141 | `tests/e2e` |
| Integration prototype gate | Playwright | `examples/integration-prototype` |
| Packed artifact in Node, Vite and Next.js 16 consumers | Custom script | `scripts/consumer-smoke.mjs` |

Fixtures are synthetic and reproducible: `tests/fixtures/media.json` and
`tests/fixtures/README.md`.

## Links

- Shaka Player: https://shaka-player-demo.appspot.com/docs/api/index.html (configuration, `shaka.util.Error` codes, networking filters)
- Artplayer: https://artplayer.org/document/ (options, controls, settings, `proxy`)
- Google IMA HTML5 SDK: https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side
- Google Cast Web Sender: https://developers.google.com/cast/docs/web_sender
- Media Session API: https://developer.mozilla.org/docs/Web/API/Media_Session_API
- Fullscreen API: https://developer.mozilla.org/docs/Web/API/Fullscreen_API
