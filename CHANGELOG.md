# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — development build (not published)

First implementation. This is a **development build**: required-v1 behaviour
is implemented and tested in headless Chromium, but several platform
combinations remain externally unverified (see `docs/release-checklist.md`).
It has not been published to npm.

### Added

- `<Player>` React 19 component (`"use client"`, `ref` as a prop) and the
  framework-independent `createPlayer()` from `react-stream-player/core`.
- Playback engines: native `<video>` for progressive MP4 (including multiple
  quality variants of one video) and Shaka Player 5.2 for HLS/DASH VOD and
  live with DVR. Shaka and Artplayer are loaded with dynamic `import()` only
  when needed.
- Artplayer 5.4 as the prebuilt UI (proxy mode — it never runs a second
  engine) or the browser's native controls (`ui="native"`).
- Manual quality selection (MP4 variants), Auto + manual (HLS/DASH), audio
  tracks, multiple subtitles (manifest + external WebVTT) with priority
  rules and styling.
- Content identity via `source.id`/`revision`: semantically equal inline props
  never reload; a new signed URL for the same content is a transport refresh.
- Shaka-named `streaming`, `abr`, `network.retry`, `drm` options and a
  guarded `advanced.shaka` escape hatch.
- Ads: direct text/image/video ads (preroll, midroll, postroll, overlay) and
  Google IMA VAST with unconditional VAST precedence; explicit live ad time
  bases (`timeBase: "session"`).
- Browser and web fullscreen, hotkeys, context menu, en/mn localization,
  reduced motion, loading/error UI with retry, Blob/object-URL ownership,
  `captureFrame()`, Picture-in-Picture, AirPlay and Cast sender hooks, opt-in
  Media Session.
- Credential rules scoped to exact origins and request types, redirect
  blocking, license token/transform hooks, redaction of URLs and secrets in
  errors and diagnostics.
- Unit, type-level, browser (Playwright) and packed-artifact consumer tests;
  reproducible fixture inventory; integration prototype gate.
