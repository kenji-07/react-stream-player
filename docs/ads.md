# Ads

The player has two ad pipelines and runs **exactly one per content session**:

- **Direct ads** are first-party text, image and video creatives that you
  configure in `ads.items`.
- **VAST/VMAP** is delivered through the Google IMA HTML5 SDK when
  `ads.vast` is set.

No ad HTML is parsed or executed. The player does not reimplement IMA's ad
rules and adds no tracking or analytics of its own.

Units: cue `at`, creative `duration` and `skipAfter` are **seconds**; SDK and
request timeouts are **milliseconds**.

## VAST precedence (mandatory)

1. `ads.enabled === false` disables every ad pipeline.
2. If `ads.vast` is configured for the current content, IMA is selected
   **before** any direct item is validated, fetched, converted to an object
   URL or scheduled.
3. Every direct item is suppressed for that content session, whatever its
   placement or time.
4. VAST failures never fall back to direct items. This covers an invalid tag,
   SDK blocked or failed, no fill, timeout and malformed responses. The player
   emits `onAdError` (`ad-sdk-load-failed`, `ad-no-fill`, `ad-load-timeout`,
   `ad-vast-error`, …) and plays content.
5. IMA-delivered creatives of any kind (linear, nonlinear, companion) are
   allowed. Suppression applies only to the separately configured direct items.
6. Adding `vast` during playback cancels the direct schedule immediately:
   - an active direct video ad stops, and visible text/image creatives are
     removed;
   - their timers, requests and callbacks are cancelled;
   - interrupted content is restored at most once before IMA starts.

   Removing `vast` later in the same session does **not** start the
   suppressed direct ads. A new content session (new `source.id`/`revision`
   or URL identity) evaluates the configuration again.

Test evidence (`tests/e2e/vast.spec.ts`, deterministic fake IMA SDK) covers:

- success, invalid tag, no fill, malformed response, timeout and SDK blocked;
- adding and removing VAST mid-session.

In all of these, the fixture server log proves that suppressed direct assets
were **never requested** and never rendered. Real IMA ad playback is
**externally unverified** in this environment: the SDK loads, but ad-media
hosts are blocked (see the release checklist).

```tsx
<Player
  source={{ src: '/movie.mp4', type: 'mp4' }}
  ads={{
    vast: {
      adTagUrl: 'https://ads.example.com/vast',
      requestTimeoutMs: 10000,   // IMA vastLoadTimeout per wrapper
      loadVideoTimeoutMs: 8000,  // IMA AdsRenderingSettings.loadVideoTimeout
      sdkLoadTimeoutMs: 10000,   // waiting for ima3.js
      // mimeTypes: ['video/mp4'], debugSdk: false
    },
  }}
/>
```

### IMA integration details

- The SDK is injected only when `ads.vast` is set, from
  `https://imasdk.googleapis.com/js/sdkloader/ima3.js` (or `ima3_debug.js`).
  It carries the `nonce` prop for CSP and is shared by every player on the
  page. One player unmounting never removes it, and a failed load is not
  cached.
- The `AdDisplayContainer` is initialised on the viewer's first play
  gesture, as mobile browsers require. A blocked autoplay never uses up the
  preroll.
- IMA owns scheduling, duration, click handling, skip eligibility and
  tracking. The player maps `CONTENT_PAUSE_REQUESTED` and
  `CONTENT_RESUME_REQUESTED` to an ad break and restores content exactly
  once. It calls `contentComplete()` when content ends, so post-rolls play.
- Ad errors are emitted as `onAdError` with a `PlayerError`. The IMA error
  code is in `details.imaErrorCode`. Content always continues.

## Direct ads

```ts
type LinearAdTiming =
  | { placement: 'preroll' }
  | { placement: 'midroll'; at: number; timeBase?: 'media' | 'session' }
  | { placement: 'postroll' };
type AdTiming = LinearAdTiming | { placement: 'overlay'; at: number; timeBase?: 'media' | 'session' };
```

| Type | Required fields | Placements | Clock |
| --- | --- | --- | --- |
| `text` | `text` (plain text, never HTML), `duration` (s) | all | Overlay: active **content** playback time. Interstitial: an active ad presentation clock |
| `image` | `src` (http(s), relative, `blob:` or `Blob`), `alt`, `duration` (s) | all | Same as text |
| `video` | `source` (any `PlayerSource`) | preroll, midroll, postroll | The ad media's own time; duration comes from the media |

Invalid items are rejected individually with `onAdError` (`ad-invalid-config`)
and never block content. This includes a missing id or alt, `javascript:`
sources, video overlays and unknown types.

### Playback rules

- **Overlays** (text/image with `placement: 'overlay'`) are shown while
  content keeps playing. Their `duration` counts content playback, so it
  pauses when content pauses.
- **Interstitials** (text/image as preroll, midroll or postroll) pause
  content. Their duration counts active presentation time. That time pauses
  when the viewer pauses the ad or the page is hidden, and never depends on
  CSS animation timing.
- **Video ads** pause content and play in a separate `<video>` element.
  Content position, play intent, volume, rate, quality and subtitles are kept.
  Content is restored **exactly once** on completion, skip, error or
  teardown. An ad ending never emits content `ended`.
- **Queueing:** ads run one at a time from a sequential queue, never stacked
  over each other. Overlays sit above captions but leave the control bar
  usable.
- **`skipAfter`** is the number of seconds of eligible presentation before
  "Skip" (linear) or "Close" (overlay) appears. Leave it out to show no skip
  button. The player does not claim secure unskippability: a direct video
  ad's timeline is an ordinary media element.
- **Click-through:** the URL opens in a new tab with `noopener,noreferrer`,
  only when the viewer activates it. Relative and http(s) URLs are allowed.
  Custom app schemes must be listed in `clickThroughSchemes`.
  `javascript:`, `data:`, `file:` and `blob:` are always rejected.
- **Errors:** a load failure or `ads.loadTimeoutMs` timeout (default 8000 ms)
  emits `onAdError`, removes the creative and continues content.

### Cue rules

- Each cue runs **at most once per content session**. History survives
  quality switches, retries, signed-URL refreshes and rerenders.
- VOD media-time cues fire when continuous playback crosses `at`. Seeking
  **past** a cue skips it for that seek, so missed ads never play in a burst.
  The cue stays eligible if normal playback crosses it later. Seeking
  backwards never replays a completed cue. A cue at `0` fires when content
  starts.
- **Preroll** runs on the first play intent. If autoplay is blocked
  (`mutedFallback: false`), the preroll waits for the viewer and is not used
  up.
- **Postrolls** run in configuration order after VOD content reaches its
  end. Content `ended` is emitted afterwards. With `loop: true`, content
  never ends, so postrolls do not run.
- **Loop:** midroll and overlay cues do not replay on loop restarts unless
  `ads.replayOnLoop: true`.
- A source change or unmount invalidates every pending schedule, timer and
  callback of the old session.

## Live content (v1 policy)

| Rule | Behaviour |
| --- | --- |
| Numeric cues | Must use `timeBase: "session"`, which counts seconds of **active content playback** in this content session. Paused, buffering and ad time do not count, and seeking or DVR movement does not change it. Media-time cues are rejected for live with `ad-unsupported` |
| Postroll | Rejected for live (`ad-unsupported`) |
| Preroll | Allowed; content then starts at the live edge |
| After a live midroll | Returns to the live edge if the viewer was at the edge (`liveRestore.reason: "live-edge"`). Otherwise returns to the DVR position if it is still in the window (`"dvr-position"`), else to the window start (`"dvr-window-expired"`) |
| Pause intent | Pausing during an ad pauses the ad; content resumes only if the viewer intended to play |
| VAST on live | Uses IMA's own live/VMAP handling. Live IMA behaviour is externally unverified |

## Events

`onAdBreakStart` → (`onAdStart` → `onAdProgress`* → `onAdComplete` |
`onAdSkip` | `onAdError`)+ → `onAdBreakEnd({ reason })`; `onAdClick` on
click-through. `getState().ad` exposes the active ad and the ad timeline,
which is separate from content time. `getStats().advertising` counts
started, completed, skipped and errored ads.
