// Custom Web Receiver for react-stream-player senders that need what the
// Default Media Receiver cannot do: DRM licenses with short-lived tokens and
// authenticated manifest/segment requests.
//
// STATUS: externally unverified — written against the documented CAF v3
// receiver API but not yet exercised on a physical Cast device.
//
// The sender passes `cast.getCustomData()` as LoadRequest.customData. This
// receiver expects (all fields optional):
//   {
//     drm?: { protectionSystem: 'WIDEVINE' | 'PLAYREADY', licenseUrl: string, token?: string },
//     credentials?: { origins: string[], authorization: string }
//   }
// Tokens are used only in request headers. Never log customData.
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

/** Per-load state; replaced on every LOAD so tokens never outlive their content. */
let current = { drm: null, credentials: null };

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function authorize(requestInfo) {
  const creds = current.credentials;
  if (!creds || !Array.isArray(creds.origins)) return;
  const origin = originOf(requestInfo.url);
  // Exact origin match only, mirroring the sender's credential rules.
  if (origin && creds.origins.includes(origin)) {
    requestInfo.headers = { ...(requestInfo.headers ?? {}), Authorization: creds.authorization };
  }
}

playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, (request) => {
  const data = request.customData ?? {};
  current = {
    drm: data.drm && typeof data.drm.licenseUrl === 'string' ? data.drm : null,
    credentials: data.credentials && typeof data.credentials.authorization === 'string' ? data.credentials : null,
  };
  // Do not echo customData back to senders in media status.
  delete request.customData;
  return request;
});

playerManager.setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
  const drm = current.drm;
  if (drm) {
    playbackConfig.licenseUrl = drm.licenseUrl;
    playbackConfig.protectionSystem =
      drm.protectionSystem === 'PLAYREADY' ? cast.framework.ContentProtection.PLAYREADY : cast.framework.ContentProtection.WIDEVINE;
    playbackConfig.licenseRequestHandler = (requestInfo) => {
      if (drm.token) requestInfo.headers = { ...(requestInfo.headers ?? {}), Authorization: `Bearer ${drm.token}` };
    };
  }
  playbackConfig.manifestRequestHandler = authorize;
  playbackConfig.segmentRequestHandler = authorize;
  return playbackConfig;
});

context.start();
