// Media used by the examples. By default they use the public sample streams
// from components/samples/samples.json, so the app works without generating
// anything. NEXT_PUBLIC_RSP_MEDIA=local switches to the package's synthetic
// fixtures (npm run fixtures in the package, then npm run media here), which
// also work offline and in CI.
//
// Every endpoint can be overridden through an environment variable NAME. Never
// commit tokens, license secrets or long-lived signed URLs. The public sample
// endpoints below are Google/Apple test content and a public Widevine TEST
// license proxy.
import type { ProgressiveVariant, SubtitleTrack } from 'react-stream-player';
import { sameOrigin } from './samples/proxy';

export const mediaMode: 'public' | 'local' = process.env.NEXT_PUBLIC_RSP_MEDIA === 'local' ? 'local' : 'public';

interface MediaSet {
  /** Qualities of ONE video on one timeline. */
  variants: ProgressiveVariant[];
  defaultQuality: string;
  /** A short progressive video with audio. */
  progressive: string;
  /** The same video served same-origin (needed for captureFrame without CORS). */
  progressiveSameOrigin: string;
  /** Portrait clip for the Reel layout (`null` when the media set has none). */
  portrait: string | null;
  hls: string;
  dash: string;
  subtitles: SubtitleTrack[];
  defaultSubtitleLanguage: string;
  poster: string;
  posterType: string;
  adImage: string;
  adVideo: string;
  vastTag: string | null;
  drm: { dash: string | null; widevineLicense: string | null };
}

const GCS = 'https://storage.googleapis.com';
const SCREENS = `${GCS}/exoplayer-test-media-1/gen-3/screens/dash-vod-single-segment`;
const ANDROID_25S = `${GCS}/exoplayer-test-media-1/mp4/android-screens-25s.mp4`;

const publicMedia: MediaSet = {
  // The "Screens" representations: the same 128 s video-only timeline in three sizes.
  variants: [
    { id: '360p', label: '360p (VP9)', height: 360, width: 640, src: `${SCREENS}/video-vp9-360.webm` },
    { id: '480p', label: '480p', height: 480, width: 720, src: `${SCREENS}/video-avc-baseline-480.mp4` },
    { id: '1080p', label: '1080p', height: 1080, width: 1920, src: `${SCREENS}/video-137.mp4` },
  ],
  defaultQuality: '480p',
  progressive: ANDROID_25S,
  progressiveSameOrigin: sameOrigin(ANDROID_25S),
  portrait: null,
  hls: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  dash: `${GCS}/wvmedia/clear/h264/tears/tears.mpd`,
  subtitles: [
    { id: 'en', src: sameOrigin(`${GCS}/exoplayer-test-media-1/webvtt/numeric-lines.vtt`), label: 'English', language: 'en' },
    { id: 'ja', src: sameOrigin(`${GCS}/exoplayer-test-media-1/webvtt/japanese.vtt`), label: '日本語', language: 'ja' },
  ],
  defaultSubtitleLanguage: 'ja',
  poster: `${GCS}/exoplayer-test-media-1/jpg/london.jpg`,
  posterType: 'image/jpeg',
  adImage: `${GCS}/exoplayer-test-media-1/jpg/london.jpg`,
  adVideo: `${GCS}/exoplayer-test-media-1/mp4/android-screens-10s.mp4`,
  vastTag:
    'https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ct%3Dskippablelinear&correlator=',
  drm: {
    dash: `${GCS}/wvmedia/cenc/h264/tears/tears.mpd`,
    widevineLicense: 'https://proxy.uat.widevine.com/proxy?video_id=2015_tears&provider=widevine_test',
  },
};

const base = process.env.NEXT_PUBLIC_RSP_MEDIA_BASE ?? '/media';
const localMedia: MediaSet = {
  variants: [
    { id: '216p', label: '216p', height: 216, src: `${base}/mp4/vod-216p.mp4` },
    { id: '360p', label: '360p', height: 360, src: `${base}/mp4/vod-360p.mp4` },
    { id: '540p', label: '540p', height: 540, src: `${base}/mp4/vod-540p.mp4` },
  ],
  defaultQuality: '360p',
  progressive: `${base}/mp4/vod-360p.mp4`,
  progressiveSameOrigin: `${base}/mp4/vod-360p.mp4`,
  portrait: `${base}/mp4/portrait.mp4`,
  hls: `${base}/hls/master.m3u8`,
  dash: `${base}/dash/manifest.mpd`,
  subtitles: [
    { id: 'en', src: `${base}/subs/en.vtt`, label: 'English', language: 'en' },
    { id: 'mn', src: `${base}/subs/mn.vtt`, label: 'Монгол', language: 'mn' },
  ],
  defaultSubtitleLanguage: 'mn',
  poster: `${base}/images/poster.png`,
  posterType: 'image/png',
  adImage: `${base}/ads/banner.png`,
  adVideo: `${base}/ads/ad-video.mp4`,
  vastTag: null,
  drm: { dash: null, widevineLicense: null },
};

const selected = mediaMode === 'local' ? localMedia : publicMedia;
const env = (value: string | undefined) => (value ? value : undefined);

export const media = {
  ...selected,
  portrait: env(process.env.NEXT_PUBLIC_RSP_PORTRAIT_URL) ?? selected.portrait,
  hls: env(process.env.NEXT_PUBLIC_RSP_HLS_URL) ?? selected.hls,
  dash: env(process.env.NEXT_PUBLIC_RSP_DASH_URL) ?? selected.dash,
  vastTag: env(process.env.NEXT_PUBLIC_RSP_VAST_TAG_URL) ?? selected.vastTag,
  /** No default in either set: live needs a running live origin. */
  liveHls: env(process.env.NEXT_PUBLIC_RSP_LIVE_HLS_URL) ?? null,
  liveDash: env(process.env.NEXT_PUBLIC_RSP_LIVE_DASH_URL) ?? null,
  drm: {
    dash: env(process.env.NEXT_PUBLIC_RSP_DRM_DASH_URL) ?? selected.drm.dash,
    hls: env(process.env.NEXT_PUBLIC_RSP_DRM_HLS_URL) ?? null,
    widevineLicense: env(process.env.NEXT_PUBLIC_RSP_WIDEVINE_LICENSE_URL) ?? selected.drm.widevineLicense,
    playreadyLicense: env(process.env.NEXT_PUBLIC_RSP_PLAYREADY_LICENSE_URL) ?? null,
    fairplayLicense: env(process.env.NEXT_PUBLIC_RSP_FAIRPLAY_LICENSE_URL) ?? null,
    fairplayCertificate: env(process.env.NEXT_PUBLIC_RSP_FAIRPLAY_CERTIFICATE_URL) ?? null,
  },
};
