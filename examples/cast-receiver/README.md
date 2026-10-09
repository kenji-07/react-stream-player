# Cast custom receiver (example)

> **Externally unverified.** This receiver follows the documented Google Cast
> Web Receiver (CAF v3) API, but it has not been run on a physical Cast device
> for this release. The release checklist keeps Cast rows
> `externally-unverified` until it has been.

The player's Cast integration is a **sender**. It is enabled with
`cast={{ enabled: true }}` and lazily loads the Cast sender SDK. With the
Default Media Receiver (`CC1AD845`), it casts only plain, unauthenticated
HLS/DASH/MP4 URLs.

The sender refuses to cast, with a `cast-rejected` error and one of these
reasons, when the content needs more:

| Reason | When | What the receiver must do |
| --- | --- | --- |
| `drm-requires-custom-receiver` | `drm` is configured | Obtain licenses itself (this example: `licenseUrl` + short-lived token from `customData`) |
| `auth-requires-custom-receiver` | `network.credentials` rules exist | Add credentials to manifest/segment requests for the allowed origins only |
| `ads-not-supported-remotely` | VAST or pending direct ads | Implement ads on the receiver (CAF breaks or IMA for receivers) and set `cast.receiverHandlesAds` — **not implemented in this example** |
| `blob-not-castable` | Blob / `blob:` sources | Not possible: a receiver cannot read the sender page's memory |
| `ad-break-active` | A linear ad is playing | Retry after the break |

## Using it

1. Host `index.html` and `receiver.js` over HTTPS.
2. Register a **Custom Receiver** application in the Google Cast SDK Developer
   Console with that URL, and register your test devices.
3. Configure the sender:

   ```tsx
   <Player
     source={{ id: 'movie-1', src: dashUrl, type: 'dash' }}
     drm={drmConfig}
     cast={{
       enabled: true,
       receiverApplicationId: process.env.NEXT_PUBLIC_RSP_CAST_RECEIVER_APP_ID,
       customReceiver: true,
       // Scoped, short-lived values only. Sent once per load and never logged by the player.
       getCustomData: async () => ({
         drm: { protectionSystem: 'WIDEVINE', licenseUrl: drmLicenseUrl, token: await fetchShortLivedToken() },
       }),
     }}
   />
   ```

4. When the session ends, the sender resumes local playback at the remote
   position (`cast.resumeLocalOnDisconnect`, default `true`).

## Requirements and limits

- Cast devices support Widevine and PlayReady, but not FairPlay.
- Tokens in `customData` reach the receiver over the Cast channel. Use
  short-lived, content-scoped tokens. Never send long-lived secrets.
- `CastContext` options are page-global (an SDK constraint). The first
  player that enables Cast sets the receiver application ID for the page.
