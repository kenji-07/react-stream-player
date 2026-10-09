# Release checklist — v0.1.0

**Verdict: development build. It is not release-ready and not published.**

Every required-v1 feature is implemented and tested in desktop Chromium.
These things are still open:

- **Gate 6/7.** Real-device and authorized-resource evidence is missing for
  iPhone/Safari, Widevine, PlayReady, FairPlay, real IMA ad serving, Cast
  receivers, AirPlay, Picture-in-Picture windows and true low-latency
  streams.
- **Publishing.** The npm name `react-stream-player` is owned by an
  unrelated package (v0.2.3, another maintainer). Do not publish until
  publishing rights are confirmed. Do not rename the package silently.

Status values:

- **tested**: implemented, with passing automated tests (evidence given);
- **externally-unverified**: implemented, but not exercised on the real
  platform, device or service;
- **unsupported**: deliberately not available, with a documented reason;
- **implemented**: built, without a dedicated automated test.

Test environment: Chromium 141.0.7390.37 (headless, Playwright 1.56.1, Linux
x64), Node 22.22.0, React 19.3.0 (and 19.0.0 in the Vite consumer), Next.js
16.4.0, Vite 8.3.4, TypeScript 6.0. Spec files are under `tests/e2e/` unless
noted.

## Package, SSR and types

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| ESM build, `.d.ts`, source maps with embedded sources, `styles.css` export, `sideEffects` for CSS | required-v1 | tested | `npm run build`; `scripts/consumer-smoke.mjs` (tarball contents) |
| `"use client"` boundary on the React entry only; no `ssr:false` needed in Next.js | required-v1 | tested | `scripts/build.mjs` assertions; `tests/unit/static-safety.test.ts`; Next.js 16 consumer |
| Safe server import and `renderToString` (no DOM globals, no globals defined) | required-v1 | tested | `tests/unit/ssr.test.tsx`; consumer server step (React 19.0.0) |
| Strict TypeScript types; README samples type-checked incl. negative cases | required-v1 | tested | `tests/types/readme-examples.test-d.tsx`; strict consumer `tsc` with `exactOptionalPropertyTypes` and `skipLibCheck: false` on our declarations |
| Lazy Shaka/Artplayer/IMA/Cast; native MP4 never loads Shaka | required-v1 | tested | `playback.spec.ts` "does not load Shaka"; Vite and Next consumers measure chunks and network (entry 103 KiB gz; Shaka 261 KiB gz lazy; Artplayer 36 KiB gz lazy) |
| Packed artifact in clean React (Vite) and Next.js consumers | required-v1 | tested | `npm run consumers` → `docs/evidence/consumer-smoke.json` |
| Framework-independent `createPlayer` | optional-v1 | tested (types, SSR guard); browser use via the example only | `tests/unit/ssr.test.tsx`; `examples/nextjs/components/examples/CoreApi.tsx` |

## Playback and sources

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Progressive MP4 (native `<video>`) | required-v1 | tested | `playback.spec.ts` |
| MP4 quality variants: only the selected one loads; switch keeps time/play/rate/volume/captions; paused stays paused; last wins; failure falls back | required-v1 | tested | `playback.spec.ts`; `tests/unit/quality.test.ts`; prototype gate 1 |
| Source type detection (explicit → MIME → path), no guessing | required-v1 | tested | `tests/unit/source.test.ts`; `errors-blob.spec.ts` |
| HLS VOD and DASH VOD via Shaka in the same UI | required-v1 | tested | `playback.spec.ts`; prototype gate 2 |
| Auto + manual quality (HLS/DASH) | required-v1 | tested | `playback.spec.ts`; prototype gate 3 |
| Multiple audio tracks | required-v1 | tested | `playback.spec.ts` (HLS and DASH) |
| HLS Live / DASH Live with DVR, `seekToLive`, live state | required-v1 | tested | `live.spec.ts` (real-time ffmpeg streams, expiring window) |
| Low-latency (LL-HLS/LL-DASH) behaviour | required-v1 (as config) / production claim needs evidence | config mapping tested; real latency externally-unverified | `live.spec.ts` "lowLatencyMode and liveSync"; `external.spec.ts` (skips without `RSP_FIXTURE_LL_*`) |
| Shaka-named `streaming`/`abr`/`network.retry`/`drm`/`advanced` mapping and validation | required-v1 | tested | `tests/unit/shaka-config.test.ts`, `options.test.ts`; `errors-blob.spec.ts` (maxAttempts includes the first request) |
| Defaults (volume 0.7, rate list, preload, fit, aspect, seek step, progress interval, subtitle style, reduced motion) and per-instance isolation | required-v1 | tested | `tests/unit/options.test.ts`; `playback.spec.ts` "defaults", "per-instance isolation" |
| Controlled vs default props without feedback loops | required-v1 | tested | `playback.spec.ts` "controlled volume", "controlled playbackRate" |
| Content identity: inline-prop rerenders, `id`/`revision`, signed-URL refresh without repeated prerolls, Strict Mode, rapid replacement, unmount during load, stale callbacks | required-v1 | tested | `identity.spec.ts` (12 tests); prototype gates 5–6 |

## Subtitles, layout and UI

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Multiple subtitles (manifest + external WebVTT), priority rules, Off preserved | required-v1 | tested | `playback.spec.ts`; prototype gate 3 |
| Subtitle styling; captions above the control bar; no duplicate native rendering | required-v1 | tested | `layout-session.spec.ts` |
| Non-WebVTT external files rejected | required-v1 | tested | `errors-blob.spec.ts` (SRT); `options.test.ts` |
| Fit (all five values) on the `<video>` | required-v1 | tested | `layout-session.spec.ts` "every fit value" |
| Single-video 9:16 Reel layout | required-v1 | tested | `layout-session.spec.ts`; prototype gate 4 |
| Prebuilt Artplayer controls and settings menus (no second engine) | required-v1 | tested | `playback.spec.ts`; prototype gates 1–3 |
| Context menu (package actions; vendor version/info removed; disable → browser menu) | required-v1 | tested | `security.spec.ts` |
| Localization en/mn with overrides | required-v1 | tested | `tests/unit/i18n.test.ts`; `layout-session.spec.ts` (mn menus) |
| Native UI mode with capability differences | optional-v1 | tested | `layout-session.spec.ts` |
| Keyboard shortcuts (single owner; ignored in inputs, with modifiers or IME) | required-v1 | tested | `fullscreen-hotkeys.spec.ts`; `tests/unit/managers.test.ts` |
| Keyboard-operable menus, ARIA labels | required-v1 | tested (keyboard paths); screen-reader output not automated | `fullscreen-hotkeys.spec.ts` "menuitemradio" |
| Loading / error UI, manual retry, bounded auto-retry | required-v1 | tested | `errors-blob.spec.ts` |
| Motion and `prefers-reduced-motion` | required-v1 | tested | `layout-session.spec.ts` |
| Watermark overlay (deterrent, not DRM) | optional-v1 | tested | `layout-session.spec.ts` "watermark" |
| Thumbnails / markers / chapters | optional-v1 | not implemented (documented as unavailable) | — |

## Fullscreen, Blob and resources

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Browser fullscreen (rejection reported, Escape tracked) | required-v1 | tested (Chromium) | `fullscreen-hotkeys.spec.ts` |
| Web fullscreen (scroll/focus restore, one page-level holder) | required-v1 | tested | `fullscreen-hotkeys.spec.ts`; `tests/unit/managers.test.ts` |
| iPhone video-only fullscreen (`webkitEnterFullscreen`) | required-v1 for iOS claim | externally-unverified | Code path only; no device |
| Blob media, subtitle and ad inputs; deferred revocation; caller URLs never revoked | required-v1 | tested | `errors-blob.spec.ts`; `tests/unit/managers.test.ts` |
| `captureFrame()` (caller-owned PNG; refuses DRM and tainted media) | required-v1 | tested | `errors-blob.spec.ts`; `drm.spec.ts` |
| Idempotent destroy; no leaked engines, UIs or videos | required-v1 | tested | `identity.spec.ts`; prototype gate 6 |

## Ads

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Direct text/image overlays and interstitials, video pre/mid/post-roll, skip, clocks, exactly-once restoration | required-v1 | tested | `ads.spec.ts` |
| Cue rules (seek-past skip, no backward replay, once per session) | required-v1 | tested | `ads.spec.ts`; `tests/unit/schedule.test.ts` |
| Ad errors and timeouts continue content | required-v1 | tested | `ads.spec.ts` |
| Hostile ad text; unsafe click-through rejected | required-v1 | tested | `ads.spec.ts`; `tests/unit/security.test.ts` |
| IMA VAST bridge: success, no-fill, malformed, timeout, SDK blocked, midroll/postroll, manager errors | required-v1 | tested against a deterministic fake IMA SDK | `vast.spec.ts` |
| Unconditional VAST precedence (nothing requested or rendered; mid-session add/remove) | required-v1 | tested | `ads.spec.ts`, `vast.spec.ts` (server request log) |
| Real IMA ad playback (desktop) | required when advertised | externally-unverified | The SDK loads here, but ad media hosts are blocked (IMA error 1005). `external.spec.ts` skips without `RSP_FIXTURE_IMA_VAST_URL` |
| IMA mobile (user-gesture initialisation) and live IMA | required when advertised | externally-unverified | No device or live ad server |
| Live ad policy (session time base, no postroll, edge/DVR restore, expiry) | required-v1 | tested | `live.spec.ts` |

## Security, network and DRM contracts

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Credential scoping by exact origin and request type | required-v1 | tested | `security.spec.ts`; `tests/unit/security.test.ts` |
| Redirect outside the allowlist blocked; explicit allow | required-v1 | tested | `security.spec.ts` |
| Redaction of errors, details, causes and diagnostics | required-v1 | tested | `tests/unit/security.test.ts`; `drm.spec.ts`; `security.spec.ts` |
| No browser storage writes | required-v1 | tested | `security.spec.ts`; `static-safety.test.ts` |
| No HTML sinks / eval; hostile VTT and labels inert | required-v1 | tested | `static-safety.test.ts`; `security.spec.ts` |
| DRM contract: license URL, Bearer token, binary request/response transforms, license retry, 401 mapping with status, protected capture refusal, progressive DRM rejection | required-v1 | tested (ClearKey) | `drm.spec.ts` |
| Dependency licenses and audit | required-v1 | done | `THIRD_PARTY_NOTICES.md`; `npm audit`: 0 vulnerabilities (2026-10-09) |
| Strict-CSP compatibility | optional-v1 | not tested; Artplayer injects inline styles | [security.md](security.md) |

### DRM matrix (v1 selection)

| Key system | Source | Browser / platform | Status |
| --- | --- | --- | --- |
| ClearKey (dev/test only) | DASH CENC | Chromium 141 | tested |
| Widevine | DASH CENC | Chrome / Edge / Firefox desktop | externally-unverified (needs CDM build + provider: `RSP_FIXTURE_WIDEVINE_*`) |
| Widevine | DASH CENC | Android Chrome | externally-unverified |
| PlayReady | DASH CENC | Edge on Windows | externally-unverified (`RSP_FIXTURE_PLAYREADY_*`) |
| FairPlay | HLS CBCS (native HLS) | Safari macOS / iOS | externally-unverified (`RSP_FIXTURE_FAIRPLAY_*`) |
| Any | Progressive MP4 | all | unsupported (`drm-progressive-unsupported`) |

## Platform integrations

| Feature | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Media Session (opt-in; metadata, actions, finite position state, owner hand-off, ad-time commands, cleanup) | required-v1 | tested (Chromium) | `layout-session.spec.ts`; `tests/unit/managers.test.ts` |
| Media Session lock-screen / notification UI on mobile | required when advertised | externally-unverified | — |
| Autoplay with muted fallback; blocked autoplay keeps the preroll | required-v1 | tested (emulated policy) | `autoplay-policy.spec.ts` |
| Picture-in-Picture | required when advertised | implemented, feature-detected; externally-unverified | Headless Chromium cannot open PiP windows |
| AirPlay | required when advertised | implemented via Artplayer control + WebKit events; externally-unverified | Needs Safari and a receiver |
| Cast sender (position hand-off, local pause/resume, rejection reasons, nonce) | required when advertised | tested against a deterministic fake CAF SDK | `cast.spec.ts` |
| Cast with Default Media Receiver on a device | required when advertised | externally-unverified | No device; sender SDK host unreachable here |
| Cast custom receiver (DRM/auth) | required when advertised | externally-unverified | `examples/cast-receiver` (not run on a device) |

### Browser / device matrix

| Platform | Status |
| --- | --- |
| Chromium/Chrome desktop (Linux) | tested (Chromium 141, VP9/Opus) |
| Chrome/Edge/Firefox desktop (Windows/macOS) | externally-unverified |
| Safari macOS | externally-unverified |
| **iPhone/iPad Safari (prototype gate 7)** | **externally-unverified: no device was available** |
| Android Chrome | externally-unverified |

## Out of scope (v1)

These are not implemented and not planned for v1: persistent Continue
Watching, content history, Reel feeds, playlists, next-episode loading,
adjacent-video preload, and a custom content control layer. No API or
example references them.

## Release gates

| # | Gate | Status |
| --- | --- | --- |
| 1 | Integration prototype gate passes for the claimed platforms | Desktop Chromium: **pass** (25/25). iPhone/Safari: **open** (externally unverified) |
| 2 | All required-v1 functionality implemented with required tests passing | **Pass** for the tested environment. Unavailable external fixtures keep their gates open |
| 3 | Packed artifact works in clean React and Next.js consumers; safe server import; CSS and type exports | **Pass** (`docs/evidence/consumer-smoke.json`) |
| 4 | Required playback, quality, audio, subtitle, layout, direct/VAST and live-ad cases pass on the declared matrix | **Pass on Chromium desktop only**; the rest of the matrix is open |
| 5 | No unresolved issue causing unusable playback, ad leakage, credential exposure or cleanup failure | **Pass** (no known issues) |
| 6 | Every advertised external integration has real fixture or device evidence | **Open**: DRM (Widevine/PlayReady/FairPlay), real IMA, Cast, AirPlay, PiP, iOS, LL streams |
| 7 | Exact versions, fixture inventory, results, support matrix and limitations delivered | **Pass**: this file, [browser-support.md](browser-support.md), [tests/fixtures/media.json](../tests/fixtures/media.json), `docs/evidence/` |

## Commands (all must pass)

```bash
npm install
npm run typecheck
npm test               # Vitest unit suites
npm run build
npm pack
npm run fixtures && npm run test:e2e   # Playwright (external.spec.ts skips without RSP_FIXTURE_* variables)
npm run prototype:gate
npm run consumers
```

## Before publishing

1. Confirm publishing rights to the `react-stream-player` npm name, or choose
   a scoped name *with the owner's agreement*. Never rename silently.
2. Close gate 6 for every integration you plan to advertise, or remove it from
   the support claims.
3. Run `npm audit --omit=dev`, then every command above.
4. `npm publish` (with provenance; `publishConfig` is set) only with explicit
   authorization.
