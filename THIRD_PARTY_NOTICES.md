# Third-party notices

`react-stream-player` does not copy or bundle third-party code into `dist/`.
The packages below are installed as npm dependencies and end up in your
application bundle (the adaptive engine and the UI are loaded with dynamic
`import()` only when needed). Their licenses apply to that code.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| [shaka-player](https://github.com/shaka-project/shaka-player) | ~5.2.12 | Apache-2.0 | Copyright 2016 Google LLC |
| [artplayer](https://github.com/zhw2590582/ArtPlayer) | 5.4.0 | MIT | (c) 2017-2026 Harvey Zhao |
| [option-validator](https://github.com/zhw2590582/option-validator) (dependency of artplayer) | ^2.0.6 | MIT | Harvey Zhao |

Code embedded in the `shaka-player` compiled build, as declared by its
`@license` banners:

| Component | License | Copyright |
| --- | --- | --- |
| Closure Library | Apache-2.0 | The Closure Library Authors |
| tXml | MIT | Copyright 2015 Tobias Nickel |
| CMCD/CMSD support | Apache-2.0 | Copyright 2024 Streaming Video Technology Alliance |

Full license texts: `node_modules/shaka-player/LICENSE` (Apache License 2.0)
and the MIT license headers in `node_modules/artplayer/dist/artplayer.js`.

## Runtime SDKs (not npm dependencies)

Only when the corresponding feature is enabled, the player injects scripts
from Google at runtime. They are not part of this package or its dependencies
and are governed by Google's terms:

- Google IMA HTML5 SDK — `https://imasdk.googleapis.com/js/sdkloader/ima3.js`
  (or `ima3_debug.js`), when `ads.vast` is configured.
- Google Cast Web Sender SDK —
  `https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1`,
  when `cast.enabled` is `true`.

## Trademarks

Product names (Widevine, PlayReady, FairPlay, AirPlay, Chromecast, Google IMA)
are used only to identify compatibility. This project is not affiliated with
or endorsed by their owners and uses none of their branding.
