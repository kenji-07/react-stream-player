# Security

This document covers what the player does to protect credentials, viewers and
host pages, and what stays the host's responsibility. The player never
invents a backend. Entitlement checks, short-lived signed URLs or tokens,
license authorization and CDN access rules belong to your servers.

## Credentials and network requests

### What can be intercepted

| Request | Who fetches it | Headers / transforms possible? |
| --- | --- | --- |
| HLS/DASH manifests and segments | Shaka networking engine | **Yes**: `network.credentials`, `network.onRequest` / `onResponse` |
| Manifest subtitles; external WebVTT on the Shaka engine | Shaka | **Yes** (request type `subtitle`) |
| DRM licenses and server certificates | Shaka | **Yes**: `drm.getLicenseToken`, `drm.transformLicenseRequest` / `transformLicenseResponse`, key-system `headers` |
| Progressive MP4 (`<video src>`) | The browser | **No.** Only cookies, via `network.crossOrigin: "use-credentials"`. Use signed URLs or cookies for MP4 |
| External WebVTT on the native engine (`<track>`) | The browser | **No** (cookies only, same `crossOrigin` setting) |
| Poster, ad images, direct video ads | The browser | **No** |
| IMA SDK, VAST tags, IMA ad media, Cast SDK | Google SDKs | **No**; never receive your credential headers |

`getCapabilities().requestInterception` reports whether the current source
goes through Shaka.

### Credential rules

```tsx
network={{
  credentials: [
    {
      origins: ['https://cdn.example.com'],     // exact origins only
      requestTypes: ['manifest', 'segment'],     // default: all except 'license'
      headers: async ({ type, url }) => ({ Authorization: `Bearer ${await getShortLivedToken()}` }),
      withCredentials: false,                    // cookies (allowCrossSiteCredentials)
    },
  ],
}}
```

- Origins must be bare `http(s)://host[:port]` values. The player rejects
  wildcards, paths, queries and embedded user/password with an
  `invalid-config` error. A rule left without valid origins is dropped.
- Headers are added only when **both** the request URL's exact origin and the
  request type match a rule. Ad, analytics, SDK and unrelated CDN origins
  never receive them.
- The callback form is evaluated per request, so tokens can stay short-lived.
  The player never caches tokens beyond the request.
- **Redirects.** The browser follows a redirect before the player sees the
  response. With `credentialedRedirect: "error"` (the default), a
  credentialed response whose final URL is outside the allowlist fails
  closed (`credential-redirect-blocked`), and its data is not used.
  - Browsers implementing the current Fetch standard drop `Authorization` on
    cross-origin redirects (verified in Chromium 141 by
    `tests/e2e/security.spec.ts`).
  - Fetch does **not** drop other custom headers (for example
    `X-Api-Key`), and the player cannot stop the browser from forwarding them
    while it follows the redirect.
  - Recommendation: put secrets only in `Authorization`, or make sure
    credentialed origins never redirect across origins.
  - `credentialedRedirect: "allow"` turns the fail-closed check off.

### Retries and refresh

Retries are bounded by `network.retry.{manifest,segment,license}`. Shaka
semantics apply: `maxAttempts` includes the first attempt. Automatic reloads
after fatal network or source errors are bounded by `network.fatalRetryLimit`
(default 1, maximum 5). To refresh a signed URL, pass a new `src` with the
same `source.id`: the player does a transport refresh and keeps the session
state.

## DRM

- Uses EME through Shaka Player only. There is no decryption bypass; keys
  never leave the CDM, and the player never sees or exposes decoded keys.
- Supported key systems: Widevine (`com.widevine.alpha`), PlayReady
  (`com.microsoft.playready`) and FairPlay (`com.apple.fps`), each only on
  platforms whose CDM supports it (see [browser-support.md](browser-support.md)).
- **ClearKey** (`org.w3.clearkey`, `drm.clearKeys`) is for development and
  testing only. The keys are visible to anyone who can read the page.
- Per key system you can set `licenseUrl`, `serverCertificate` or
  `serverCertificateUrl`, static `headers`, robustness, persistent state and
  session type. Shared settings: `getLicenseToken` (sent as
  `Authorization: Bearer …` to the license request only), binary-safe
  `transformLicenseRequest` / `transformLicenseResponse` (`Uint8Array`
  bodies, never strings), and `initDataTransform` for FairPlay content IDs.
- FairPlay needs a server certificate and Safari's native HLS. The player
  follows Shaka's `useNativeHlsForFairPlay` default (`true`). SPC/CKC
  wrapping depends on the provider, so implement it in the transform hooks.
- Protected progressive MP4 is rejected (`drm-progressive-unsupported`). Use
  HLS or DASH.
- `captureFrame()` refuses protected content (`capture-protected`).
- EME requires a secure context (HTTPS or `localhost`).
- Never put production DRM secrets in tests, fixtures or client code. The
  repository's ClearKey fixture uses a public test key.

## Redaction and storage

- Error messages, `details`, `cause`, `getStats()`, `copyDiagnostics` output
  and the error UI go through redaction:
  - URL query strings and fragments become `?[redacted]`;
  - `blob:` URLs become `blob:[redacted]`;
  - `Bearer`/`Basic` credentials are replaced;
  - object keys that look sensitive (`token`, `secret`, `signature`, `key`,
    `auth`, `license`, `session`, `policy`, `cookie`, `password`) are
    replaced entirely;
  - binary payloads become a byte count.
- Vendor error objects are never exposed raw. `PlayerError.cause` is a
  redacted plain object.
- The player writes **nothing** to `localStorage`, `sessionStorage`,
  IndexedDB or cookies. That covers no tokens, license payloads, playback
  positions or volume. Artplayer's own volume persistence is replaced by
  per-instance memory. Both are enforced by tests: a static source check and
  an e2e test that inspects storage after playback.
- The player has no telemetry, analytics or direct-ad tracking.

## Rendering untrusted text

Titles, quality, audio and subtitle labels, context-menu text, ad text, alt
text and error messages are all treated as untrusted:

- They are set with `textContent` or attributes, never parsed as HTML.
  Artplayer's `html`/`tooltip` fields accept markup, so the adapter passes
  them DOM elements built with `textContent`, never label strings.
- The source contains no `dangerouslySetInnerHTML`, `eval`, `new Function`,
  `innerHTML`/`outerHTML` assignment, `insertAdjacentHTML` or
  `document.write`. `tests/unit/static-safety.test.ts` enforces this.
- WebVTT cues render as inert text. The native renderer uses
  `getCueAsHTML()` (a browser-built inert fragment) and copies only text
  nodes and `b`/`i`/`u`/`span`/`ruby`/`rt`/`br` elements, without
  attributes. Shaka's `UITextDisplayer` builds DOM nodes
  from parsed cues.
  - `tests/e2e/security.spec.ts` covers hostile cues (`<script>`,
    `<img onerror>`) on both engines and hostile menu labels.
- CSS values from options (`subtitleStyle`, `objectPosition`, motion easing)
  are rejected if they contain `;`, braces, `<`/`>`, `url(` or
  `expression(`.
- Ad text `style` values are assigned one property at a time through CSSOM,
  so they cannot inject other declarations. The browser ignores invalid
  values.

## Navigation

- Ad click-through accepts relative and `http(s)` URLs only.
- `javascript:`, `data:`, `file:`, `vbscript:`, `blob:` and `about:` are
  always rejected, even when listed in `clickThroughSchemes`.
- Custom app deep-link schemes need an explicit `clickThroughSchemes` entry.
- Links open only on viewer activation, in a new tab with
  `noopener,noreferrer`. Showing an ad never navigates.

## Script loading and CSP

| Script | Loaded when | URL |
| --- | --- | --- |
| Google IMA SDK | `ads.vast` is set | `https://imasdk.googleapis.com/js/sdkloader/ima3.js` (or `ima3_debug.js`) |
| Google Cast sender | `cast.enabled` | `https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1` |

No other script URL is ever injected; a static test asserts the allowlist.
Injected `<script>` elements get the `nonce` prop. Shaka and Artplayer are
bundled by your build through dynamic `import()`, so they are not injected.

CSP directives to allow, depending on the features you use:

- `script-src`: your bundle, plus `imasdk.googleapis.com` (VAST) and
  `www.gstatic.com` (Cast), or a nonce.
- `media-src`: media origins, plus `blob:`. Shaka attaches MediaSource via
  `blob:` URLs; Blob inputs use `blob:`.
- `connect-src`: manifest, segment, subtitle, license and certificate
  origins (Shaka uses `fetch`/XHR), plus IMA ad servers.
- `img-src`: poster, ad image and artwork origins, plus `blob:` and `data:`.
  Artplayer's icons are inline SVG; `captureFrame` uses canvas.
- `frame-src`: IMA may use iframes for some creatives.
- `style-src`: **Artplayer injects its stylesheet as an inline `<style>`
  element without a nonce**, so `style-src` must allow it (`'unsafe-inline'`).
  The package's own styles are in `styles.css`; the player sets dynamic
  values through CSSOM (`element.style`), which CSP allows.
- `worker-src`: not needed by the pinned Shaka build for the tested paths.

The player has **not** been tested under a strict CSP. Treat this list as
guidance, not a guarantee of dependency internals.

## Watermarks and "protection"

`watermark` draws host-supplied text or an image as a non-interactive
overlay, optionally moving. It is a deterrent only. Watermarks, `blob:` URLs,
hidden download buttons, disabled context menus and disabled shortcuts are
**not** DRM. They cannot stop downloads, developer tools or screen recording.
Use DRM, and output protection where available, for protected content.

## Dependency audit

| Package | Version | License | `npm audit` (2026-10-09) |
| --- | --- | --- | --- |
| shaka-player | 5.2.12 (range `~5.2.12`) | Apache-2.0 | no known vulnerabilities |
| artplayer | 5.4.0 (exact; the adapter relies on verified internals) | MIT | no known vulnerabilities |
| option-validator (via artplayer) | 2.0.6 | MIT | no known vulnerabilities |

`npm audit` over all dependencies, dev included, also reported 0. Re-run
`npm audit --omit=dev` before every release. Licenses are listed in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Reporting

Report suspected vulnerabilities privately to the maintainers through the
repository's security advisory feature rather than a public issue.
