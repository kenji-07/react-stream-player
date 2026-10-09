# Test fixtures

`media.json` is the versioned inventory: every fixture's ID, protocol, VOD/live
status, codecs, expected qualities/audio/subtitles, duration or DVR window,
expected capability results, purpose, the specs that assert on it, access
requirements and owner/license.

## Local fixtures (no access needed)

Generated deterministically from ffmpeg `lavfi` test sources — synthetic
pictures and tones with burned-in rendition labels and media time. There is no
third-party content, so they can be reused without restriction.

```bash
npm run fixtures         # VP9 + Opus (open-source Chromium, Firefox)
npm run fixtures:h264    # H.264 + AAC (Safari / iOS manual testing)
```

Requirements: ffmpeg ≥ 6 with libvpx-vp9/libopus (or libx264/aac) and the
DejaVu Sans Mono font (`FIXTURE_FONT` overrides the path). Output goes to
`tests/fixtures/media/` (gitignored). `generated.json` records the codec and
ffmpeg version actually used.

**Refreshing:** regenerate after changing `scripts/generate-fixtures.sh`, bump
`inventoryVersion` in `media.json`, and update the expected values there. The
e2e suite (`npm run test:e2e`) regenerates nothing by itself; it fails fast if
the media directory is missing.

**Live fixtures** are produced in real time by `scripts/live-fixtures.mjs`
(started by `tests/e2e/live.spec.ts`): 2 s segments, an 8-segment (16 s) DVR
window that really expires. A static server cannot serve LL-HLS/LL-DASH, so
low-latency streams are external fixtures.

**ClearKey DRM fixture:** `dash-clearkey/` is encrypted with a public TEST key
(also in `scripts/fixture-server.mjs`). It exists only to exercise the DRM
integration contract; it is not a production secret and must never be
replaced with one.

**Serving:** `npm run serve:fixtures` starts `scripts/fixture-server.mjs`
(port 4173). Besides static files it provides deterministic failure routes
(`/flaky/<n>/…`, `?flaky=<n>&key=…`, `/slow/<ms>/…`), re-signed URLs
(`/signed/…`), redirects (`/redirect?to=…`), a ClearKey license endpoint and a
request log that records only *whether* an `Authorization` header was
present — never its value.

## External (authorized) fixtures

DRM systems, real IMA ad serving, Cast receivers and true low-latency streams
need resources that cannot be committed. They are referenced by environment
variable **names** only:

| Fixture | Variables |
| --- | --- |
| Widevine DASH | `RSP_FIXTURE_WIDEVINE_DASH_URL`, `RSP_FIXTURE_WIDEVINE_LICENSE_URL`, `RSP_FIXTURE_LICENSE_TOKEN` |
| PlayReady DASH | `RSP_FIXTURE_PLAYREADY_DASH_URL`, `RSP_FIXTURE_PLAYREADY_LICENSE_URL`, `RSP_FIXTURE_LICENSE_TOKEN` |
| FairPlay HLS | `RSP_FIXTURE_FAIRPLAY_HLS_URL`, `RSP_FIXTURE_FAIRPLAY_LICENSE_URL`, `RSP_FIXTURE_FAIRPLAY_CERTIFICATE_URL`, `RSP_FIXTURE_LICENSE_TOKEN` |
| Real IMA VAST | `RSP_FIXTURE_IMA_VAST_URL` |
| LL-HLS / LL-DASH | `RSP_FIXTURE_LL_HLS_URL`, `RSP_FIXTURE_LL_DASH_URL` |
| Cast receiver | `RSP_FIXTURE_CAST_RECEIVER_APP_ID` (device needed; manual) |

`tests/e2e/external.spec.ts` runs a real playback check for each one that is
configured and **explicitly skips with a reason** otherwise. A skip never
satisfies a release gate: `docs/release-checklist.md` keeps those rows
`externally-unverified`.

Rules: use short-lived tokens from a test account, never production DRM
secrets; never commit tokens, keys or long-lived signed URLs; the player
redacts query strings and credentials from errors, diagnostics and logs, but
CI logs of your own scripts are your responsibility.

## Deterministic fallback

Public test URLs expire. Every required-v1 behaviour is covered by the local
fixtures above (including VAST success/no-fill/malformed/timeout/SDK-blocked
via local XML and a deterministic fake IMA SDK), so the suite never depends on
third-party availability. External fixtures add evidence for real platforms;
they do not replace the local suite.
