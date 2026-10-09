// Maps the public sample list (samples.json, in the AndroidX Media3 / ExoPlayer
// demo-list format) to <Player> props, with an honest status per sample.
//
// Pure module: no React, no Next.js, no JSON import. Callers pass the raw data
// (Next.js imports samples.json; the opt-in Playwright probe reads it from
// disk), so the same classification is used by the app, unit tests and probes.
import type { DrmConfig, PlayerProps, PlayerSource, SubtitleTrack } from 'react-stream-player';

export interface RawPlaylistItem {
  uri: string;
  ad_tag_uri?: string;
  drm_scheme?: string;
  drm_license_uri?: string;
  clip_start_position_ms?: number;
  clip_end_position_ms?: number;
  image_duration_ms?: number;
}

export interface RawSample {
  name: string;
  uri?: string;
  drm_scheme?: string;
  drm_license_uri?: string;
  drm_session_for_clear_content?: boolean;
  drm_force_default_license_uri?: boolean;
  ad_tag_uri?: string;
  playlist?: RawPlaylistItem[];
  subtitle_uri?: string;
  subtitle_mime_type?: string;
  subtitle_language?: string;
  image_duration_ms?: number;
}

export interface RawCategory {
  name: string;
  samples: RawSample[];
}

/**
 * - `playable`: expected to play in current mainstream browsers.
 * - `codec-dependent`: plays only where the browser decodes the codec or container.
 * - `drm`: needs a Widevine CDM (Chrome, Edge, Firefox, Android; not open-source Chromium builds).
 * - `expected-error`: loads to demonstrate a documented error path.
 * - `unsupported`: this package cannot load it (the reason says why); no player is created.
 */
export type SampleStatus = 'playable' | 'codec-dependent' | 'drm' | 'expected-error' | 'unsupported';

export type SampleConfig = Pick<PlayerProps, 'source' | 'drm' | 'ads' | 'subtitles' | 'defaultSubtitleTrack'>;

export interface SampleEntry {
  /** Stable, unique: `<category-slug>/<sample-slug>`. Also used as `source.id`. */
  id: string;
  category: string;
  name: string;
  status: SampleStatus;
  /** Plain-text explanations shown next to the sample. */
  notes: string[];
  /** `<Player>` props for loadable samples; `null` when `status === 'unsupported'`. */
  config: SampleConfig | null;
  raw: RawSample;
}

export interface CatalogOptions {
  /**
   * Rewrites a URL the browser must fetch with CORS (external WebVTT). The
   * Next.js example maps the `exoplayer-test-media-*` buckets, which send no
   * `Access-Control-Allow-Origin`, to a same-origin rewrite. Default: identity.
   */
  corsUrl?: (url: string) => string;
}

const STATUS_RANK: Record<SampleStatus, number> = { playable: 0, 'codec-dependent': 1, drm: 2, 'expected-error': 3, unsupported: 4 };

const LANGUAGE_LABELS: Record<string, string> = { en: 'English', ja: '日本語', mn: 'Монгол' };

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extension(uri: string): string {
  try {
    const path = new URL(uri).pathname.toLowerCase();
    if (/\.ism\/manifest$/.test(path)) return 'ism';
    const match = /\.([a-z0-9]+)$/.exec(path);
    return match ? match[1]! : '';
  } catch {
    return '';
  }
}

function licenseVideoId(licenseUri: string | undefined): string | null {
  if (!licenseUri) return null;
  try {
    return new URL(licenseUri).searchParams.get('video_id');
  } catch {
    return null;
  }
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif']);
const AUDIO_EXT = new Set(['mp3', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'wav']);

function classify(category: string, sample: RawSample, options: Required<CatalogOptions>): Omit<SampleEntry, 'id' | 'category' | 'name' | 'raw'> {
  const notes: string[] = [];
  let status: SampleStatus = 'playable';
  const raise = (next: SampleStatus) => {
    if (STATUS_RANK[next] > STATUS_RANK[status]) status = next;
  };
  const unsupported = (reason: string) => ({ status: 'unsupported' as const, notes: [reason, ...notes], config: null });

  if (sample.playlist) {
    return unsupported('Playlists are out of scope: <Player> plays one video per content session. To play a sequence, change `source` yourself when one item ends.');
  }
  const uri = sample.uri;
  if (!uri) return unsupported('The sample has no URI.');
  if (uri.startsWith('ssai://')) {
    return unsupported('IMA DAI (server-side ad insertion) streams are not supported. Client-side VAST/VMAP through `ads.vast` is.');
  }
  const ext = extension(uri);
  if (ext === 'ism') {
    if (sample.drm_scheme === 'playready') notes.push('PlayReady itself is configurable for DASH (`drm.keySystems["com.microsoft.playready"]`, Edge on Windows).');
    return unsupported('Microsoft Smooth Streaming is not a supported protocol: HLS, DASH and progressive files only.');
  }
  if (IMAGE_EXT.has(ext) || sample.image_duration_ms !== undefined) {
    return unsupported(
      ext === 'heic' || ext === 'heif' || /motion photo/i.test(sample.name)
        ? 'Still images and motion photos are not video sources (the video inside a motion photo is not playable by a <video> element).'
        : 'Still images are not video sources.',
    );
  }

  const protocol: 'hls' | 'dash' | 'progressive' = ext === 'mpd' ? 'dash' : ext === 'm3u8' ? 'hls' : 'progressive';
  const text = `${category} ${sample.name} ${uri}`;

  // DRM (only Widevine samples remain at this point; PlayReady ones were MSS).
  let drm: DrmConfig | undefined;
  if (sample.drm_scheme) {
    if (sample.drm_scheme !== 'widevine' || !sample.drm_license_uri) {
      return unsupported(`DRM scheme "${sample.drm_scheme}" without a usable license URL.`);
    }
    if (protocol === 'progressive') {
      return unsupported('Encrypted progressive files are not supported: protected content must be DASH or HLS (the player reports `drm-progressive-unsupported`).');
    }
    drm = { keySystems: { 'com.widevine.alpha': { licenseUrl: sample.drm_license_uri } } };
    raise('drm');
    notes.push('Widevine via the public Widevine UAT test license proxy (test content only). Needs a browser with the Widevine CDM.');
    if (sample.drm_session_for_clear_content) {
      notes.push('ExoPlayer\'s `drm_session_for_clear_content` flag has no equivalent here: Shaka handles clear periods between encrypted ones on its own.');
    }
    const policy = licenseVideoId(sample.drm_license_uri) ?? '';
    if (/^GTS_HW_SECURE/.test(policy)) {
      raise('expected-error');
      notes.push('Policy requires hardware-backed Widevine (L1). Desktop browsers usually only have L3, so the license is refused or the keys stay unusable (`drm-license-error` / `drm-output-restricted`).');
    } else if (policy === 'GTS_CAN_RENEW') {
      notes.push('20 s license with renewal: Shaka renews it (`license-renewal` requests pass through `drm.transformLicenseRequest`).');
    } else if (policy === 'GTS_CAN_RENEW_FALSE_LICENSE_30S_PLAYBACK_30S') {
      raise('expected-error');
      notes.push('The license expires after 30 s and cannot be renewed: playback stops with a DRM error (`drm-license-error`, Shaka EXPIRED).');
    } else if (/HDCP_V/.test(policy)) {
      notes.push('Plays only where the output link meets the required HDCP level; otherwise the keys report output-restricted (`drm-output-restricted`). Software CDMs often cannot attest HDCP.');
    } else if (/HDCP_NO_DIGITAL_OUTPUT/.test(policy)) {
      notes.push('Requires no digital output (e.g. a built-in display only); with an external display the keys report output-restricted (`drm-output-restricted`).');
    }
  }

  // Codecs and containers.
  if (/h265|hevc/i.test(text)) {
    raise('codec-dependent');
    notes.push('HEVC/H.265: Safari, Edge with HEVC support, and Chrome on devices with hardware HEVC decoding.');
  }
  if (/\bav1\b|av1\//i.test(text) || /_av1_|-av1-/i.test(uri)) {
    raise('codec-dependent');
    notes.push('AV1: Chrome, Edge and Firefox; Safari only on devices with AV1 hardware decoding.');
  }
  if (/\buhd\b|2160|\b4k\b/i.test(sample.name)) notes.push('2160p renditions need a fast decoder and bandwidth; Auto quality picks what the device can sustain.');

  // Progressive files: the player's progressive type is called "mp4" but means
  // "a file the <video> element plays directly". Only .mp4/.m4v/.webm/.mov/.ogv
  // are detected automatically; everything else gets an explicit type.
  // `source.id` is assigned by buildCatalog().
  let source: PlayerSource;
  if (protocol === 'progressive') {
    const autoDetected = ['mp4', 'm4v', 'webm', 'mov', 'ogv'].includes(ext);
    source = autoDetected ? { src: uri } : { src: uri, type: 'mp4' };
    if (ext === 'mkv') {
      raise('codec-dependent');
      notes.push('Matroska (.mkv) is not a standard web container: Chromium-based browsers play common MKV files; other browsers may not.');
    } else if (ext === 'ts') {
      raise('expected-error');
      notes.push('A raw MPEG-TS segment is not a file browsers play directly (expect `media-unsupported-codec`). The same media plays through its HLS playlist, where Shaka transmuxes TS.');
    } else if (AUDIO_EXT.has(ext) || /audio/i.test(sample.name)) {
      notes.push('Audio only: this is a video player, so the picture area stays empty (or shows embedded cover art where the browser renders it).');
      if (ext === 'ogg' || ext === 'oga') {
        raise('codec-dependent');
        notes.push('Ogg Vorbis: Chrome, Edge and Firefox; Safari only in recent versions.');
      }
    }
    if (/iamf/i.test(text)) {
      raise('codec-dependent');
      notes.push('IAMF (Immersive Audio Model and Formats) audio is decoded by few browsers; elsewhere expect `media-unsupported-codec`.');
    }
    if (/mpeg-?h/i.test(text)) {
      raise('codec-dependent');
      notes.push('MPEG-H 3D Audio is not decoded by browsers; expect an error or video without sound (and HEVC video support is needed too).');
    }
    if (/hagc|t35/i.test(text)) {
      notes.push('The ST 2094-50 (T.35) gain metadata track is ignored by browsers; the base video plays where its codec is decoded.');
    }
    if (/tx3g|timed text|subrip|ssa muxed/i.test(text) && !sample.subtitle_uri) {
      notes.push('In-band captions (MPEG-4 Timed Text, SubRip or SSA inside the file) are not exposed by browsers as text tracks: the video plays without them. Provide WebVTT through `subtitles` instead.');
    }
  } else {
    source = { src: uri, type: protocol };
    if (/\(aac\)|\baudio\b/i.test(sample.name)) {
      notes.push('Audio only: this is a video player, so the picture area stays empty.');
    }
    if (protocol === 'hls' && /\(ts\)|\.ts\b|_ts\//i.test(text)) {
      notes.push('MPEG-TS segments are transmuxed to fMP4 by Shaka Player in the browser.');
    }
    if (/multiple base urls/i.test(sample.name)) {
      notes.push(/fail ?over/i.test(sample.name) ? 'The first BaseURL fails; Shaka retries the next one (watch `network.retry.segment`).' : 'Several BaseURLs per representation; Shaka uses them in order.');
    }
  }
  if (/h264|avc/i.test(text) && !/hevc|h265/i.test(text)) {
    notes.push('H.264/AAC plays in all mainstream browsers, but not in open-source Chromium builds (e.g. Playwright\'s bundled Chromium).');
  }

  // Subtitles.
  let subtitles: SubtitleTrack[] | undefined;
  let defaultSubtitleTrack: string | undefined;
  if (sample.subtitle_uri) {
    const language = sample.subtitle_language ?? 'und';
    const label = `${LANGUAGE_LABELS[language] ?? language} (${sample.name})`;
    if (sample.subtitle_mime_type === 'text/vtt') {
      subtitles = [{ id: 'sample', src: options.corsUrl(sample.subtitle_uri), label, language }];
      defaultSubtitleTrack = 'sample';
      notes.push('External WebVTT. The bucket sends no CORS headers, so the Next.js example serves it through a same-origin rewrite (see next.config.mjs).');
    } else {
      // Passed as-is so the player shows its documented rejection.
      subtitles = [{ id: 'sample', src: sample.subtitle_uri, label, language }];
      raise('expected-error');
      notes.push(`Only WebVTT is accepted for external subtitles: this ${sample.subtitle_mime_type ?? 'file'} track is rejected with \`subtitle-format-unsupported\` and the video plays without it.`);
    }
  }

  // Ads (client-side VAST/VMAP through the Google IMA SDK).
  let ads: SampleConfig['ads'];
  if (sample.ad_tag_uri) {
    ads = { vast: { adTagUrl: sample.ad_tag_uri } };
    notes.push('Ads through the Google IMA SDK (VAST precedence: any direct ad items would be ignored). Ad blockers stop the SDK; content then plays without ads (`ad-sdk-load-failed`).');
    if (/output=vmap|vmap/i.test(`${sample.name} ${sample.ad_tag_uri}`)) notes.push('VMAP: IMA schedules the pre-, mid- and post-roll breaks.');
    if (/nofb=1/.test(sample.ad_tag_uri)) {
      raise('expected-error');
      notes.push('The wrapper redirect fails and fallback is disabled: IMA reports an ad error (`onAdError`) and content plays without ads.');
    } else if (/redirecterror/.test(sample.ad_tag_uri)) {
      notes.push('The first wrapper redirect is broken; IMA falls back to another ad.');
    }
    if (/empty/i.test(sample.name)) notes.push('Empty ad breaks are skipped by IMA; content continues.');
  }

  const config: SampleConfig = { source };
  if (drm) config.drm = drm;
  if (ads) config.ads = ads;
  if (subtitles) config.subtitles = subtitles;
  if (defaultSubtitleTrack) config.defaultSubtitleTrack = defaultSubtitleTrack;
  return { status, notes, config };
}

/** Classifies every sample. Order and grouping follow the input. */
export function buildCatalog(data: RawCategory[], options: CatalogOptions = {}): SampleEntry[] {
  const resolved: Required<CatalogOptions> = { corsUrl: options.corsUrl ?? ((url) => url) };
  const entries: SampleEntry[] = [];
  const seen = new Set<string>();
  for (const category of data) {
    for (const sample of category.samples) {
      let id = `${slug(category.name)}/${slug(sample.name)}`;
      for (let n = 2; seen.has(id); n++) id = `${slug(category.name)}/${slug(sample.name)}-${n}`;
      seen.add(id);
      const result = classify(category.name, sample, resolved);
      if (result.config) result.config.source = { ...result.config.source, id } as PlayerSource;
      entries.push({ id, category: category.name, name: sample.name, raw: sample, ...result });
    }
  }
  return entries;
}

export function statusCounts(entries: SampleEntry[]): Record<SampleStatus, number> {
  const counts: Record<SampleStatus, number> = { playable: 0, 'codec-dependent': 0, drm: 0, 'expected-error': 0, unsupported: 0 };
  for (const entry of entries) counts[entry.status]++;
  return counts;
}

export const STATUS_LABELS: Record<SampleStatus, string> = {
  playable: 'Playable',
  'codec-dependent': 'Codec-dependent',
  drm: 'Needs Widevine',
  'expected-error': 'Shows an error path',
  unsupported: 'Not supported',
};
