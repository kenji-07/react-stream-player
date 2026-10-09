// Endpoints come from environment variable NAMES only. Never commit tokens,
// license secrets or long-lived signed URLs. Defaults point at the package's
// generated local fixtures copied into public/media.
const base = process.env.NEXT_PUBLIC_RSP_MEDIA_BASE ?? '/media';

export const media = {
  mp4: {
    p216: `${base}/mp4/vod-216p.mp4`,
    p360: `${base}/mp4/vod-360p.mp4`,
    p540: `${base}/mp4/vod-540p.mp4`,
    portrait: `${base}/mp4/portrait.mp4`,
  },
  hls: process.env.NEXT_PUBLIC_RSP_HLS_URL ?? `${base}/hls/master.m3u8`,
  dash: process.env.NEXT_PUBLIC_RSP_DASH_URL ?? `${base}/dash/manifest.mpd`,
  /** No default: live needs a running live origin (see tests/fixtures/README.md). */
  liveHls: process.env.NEXT_PUBLIC_RSP_LIVE_HLS_URL ?? null,
  liveDash: process.env.NEXT_PUBLIC_RSP_LIVE_DASH_URL ?? null,
  subs: { en: `${base}/subs/en.vtt`, mn: `${base}/subs/mn.vtt` },
  poster: `${base}/images/poster.png`,
  adImage: `${base}/ads/banner.png`,
  adVideo: `${base}/ads/ad-video.mp4`,
  vastTag: process.env.NEXT_PUBLIC_RSP_VAST_TAG_URL ?? null,
  drm: {
    dash: process.env.NEXT_PUBLIC_RSP_DRM_DASH_URL ?? null,
    hls: process.env.NEXT_PUBLIC_RSP_DRM_HLS_URL ?? null,
    widevineLicense: process.env.NEXT_PUBLIC_RSP_WIDEVINE_LICENSE_URL ?? null,
    playreadyLicense: process.env.NEXT_PUBLIC_RSP_PLAYREADY_LICENSE_URL ?? null,
    fairplayLicense: process.env.NEXT_PUBLIC_RSP_FAIRPLAY_LICENSE_URL ?? null,
    fairplayCertificate: process.env.NEXT_PUBLIC_RSP_FAIRPLAY_CERTIFICATE_URL ?? null,
  },
} as const;
