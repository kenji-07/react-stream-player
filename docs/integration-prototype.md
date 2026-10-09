# Integration prototype gate

Before the full package was built, a small prototype tested the chosen stack
end to end:

- native `<video>` for MP4;
- Shaka Player for HLS/DASH;
- Artplayer as the existing UI, in proxy mode around the same `<video>`.

The prototype used only documented or verified vendor APIs. It created no
bespoke control layer.

- Code: [`examples/integration-prototype/`](../examples/integration-prototype)
  (`src/proto-player.ts`, `src/main.tsx`)
- Runner: `npm run prototype:gate` (builds the prototype and runs
  `run-gate.mjs` in Chromium)
- Recorded results: [`examples/integration-prototype/results.json`](../examples/integration-prototype/results.json)
- Fixtures: the synthetic media in [`tests/fixtures/media.json`](../tests/fixtures/media.json)
  (VP9/Opus, 20 s, identical timelines across MP4 variants)

## Versions

| Component | Version |
| --- | --- |
| shaka-player | 5.2.12 |
| artplayer | 5.4.0 |
| react / react-dom | 19.3.0 |
| Browser | Chromium 141.0.7390.37, headless (Playwright 1.56.1), Linux x64 |
| Fixtures | ffmpeg 6.1.1, `vp09.00.30.08` + Opus |

## Results

| # | Gate | Result | Evidence (assertions in `run-gate.mjs`) |
| --- | --- | --- | --- |
| 1 | Native MP4 playback and quality switching between URLs of the same video, preserving in-session state | **Pass** | Switching through the Artplayer settings panel kept time (±0.5 s), playing state, rate 1.5, volume 0.4 and the English captions, with one `<video>`. Only the selected variant was requested. A paused switch stayed paused at the same position. Artplayer's volume persistence was disabled (no `localStorage` writes). The context-menu version link and source info panel were removed |
| 2 | Shaka-backed HLS and DASH through the same UI | **Pass** | Both protocols played through the same Artplayer instance; manifest qualities were listed in its settings |
| 3 | Manual/Auto quality, audio track and multiple-subtitle selection through documented UI/engine methods | **Pass** (HLS and DASH) | Manual quality disabled ABR and changed the effective rendition; Auto re-enabled ABR; audio track switching; manifest subtitles rendered by Shaka's `UITextDisplayer` inside the player DOM; switching between two subtitle tracks; Off with no duplicate native rendering |
| 4 | Standard and single-video 9:16 layout, portrait sizing and fit | **Pass** | Reel box at 9:16; `object-fit` `contain` and `cover` applied to the `<video>` element, not the container |
| 5 | Rerenders with semantically unchanged inline objects: no reloads or duplicate ads | **Pass** | About 60 Strict Mode rerenders with new inline objects and callbacks caused no source reload and played exactly one preroll |
| 6 | Source replacement, teardown and Strict Mode cleanup | **Pass** | One video, one Artplayer instance and one live Shaka engine after Strict Mode double-mount. Replacing the source destroyed the old Shaka engine. Unmount tore everything down (engines and UIs destroyed = created) |
| 7 | Actual playback on a desktop browser **and a real iPhone/Safari** | **Desktop Chromium: pass. iPhone/Safari: externally unverified** | No physical iPhone or iPad was available in this environment. WebKit automation would not count as evidence. Nothing in this repository claims iOS is production-verified |

The only console error recorded during the run was a 404 for a missing
favicon (the prototype page ships none).

## Vendor findings that shaped the design

Each finding was verified against the pinned versions (source reading plus the
prototype). Details are in [architecture.md](architecture.md#vendor-decisions).

- **Artplayer's `proxy` option** lets the controller create and own the
  `<video>` element. Artplayer renders controls around it and never assigns a
  source of its own.
- Artplayer's `url` setter assigns `video.src` and revokes the previous URL
  unless a `customType` handles it. The adapter registers a sentinel type,
  so any such call is routed away from the controller-owned element.
- Artplayer persists volume (`artplayer_settings` in `localStorage`). The
  adapter replaces the instance's storage with an in-memory object. An e2e
  test asserts that nothing reaches `localStorage`, `sessionStorage` or
  cookies.
- Artplayer's default context menu links to artplayer.org with the page URL,
  and its info panel shows `currentSrc`, which may be a signed URL. Both are
  removed.
- Shaka renders text into a container only when `setVideoContainer()` is
  called **before** `attach()`. Otherwise it falls back to native text tracks.
- Shaka needs `polyfill.installAll()` once per page before
  `Player.isBrowserSupported()`.

## Re-running

```bash
npm run fixtures
npm run prototype:gate   # rewrites examples/integration-prototype/results.json
```

Gate 7 must be re-run by hand on a real iPhone (Safari, H.264 fixtures:
`npm run fixtures:h264`) before iOS can be claimed. Record the device model,
iOS version and results here.
