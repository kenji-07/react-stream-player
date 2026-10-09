/** A selectable video quality. For HLS/DASH it is derived from the manifest. */
export interface QualityTrack {
  /** Stable selection ID (not guaranteed to be human readable). */
  id: string;
  /** Plain-text label, e.g. "720p" or the host-supplied variant label. */
  label: string;
  width: number | null;
  height: number | null;
  /** Bits per second, when known. */
  bitrate: number | null;
  codecs: string | null;
  frameRate: number | null;
  /** `"adaptive"` for manifest renditions, `"progressive"` for MP4 variants. */
  kind: 'adaptive' | 'progressive';
}

/** The requested quality. `"auto"` exists only for adaptive (HLS/DASH) sources. */
export interface QualitySelection {
  id: 'auto' | string;
  /** The requested track, or `null` for Auto. */
  track: QualityTrack | null;
}

export interface AudioTrack {
  id: string;
  label: string;
  /** BCP-47 language tag as signalled by the manifest ("und" when unknown). */
  language: string;
  roles: string[];
  channels: number | null;
  codecs: string | null;
  active: boolean;
}

export type SubtitleKind = 'subtitles' | 'captions' | 'forced';

/** An external subtitle file supplied by the host. */
export interface SubtitleTrack {
  /** Unique, stable ID (languages may repeat). */
  id: string;
  src: string | Blob;
  /** Plain-text menu label. */
  label: string;
  /** BCP-47 language tag. */
  language: string;
  /** Only WebVTT is accepted for external files. Default `"webvtt"`. */
  format?: 'webvtt';
  kind?: SubtitleKind;
  /** Marks the track as a declared default (lowest selection priority). */
  default?: boolean;
}

/** A subtitle track available for selection (manifest or external). */
export interface SubtitleTrackInfo {
  id: string;
  label: string;
  language: string;
  kind: SubtitleKind;
  forced: boolean;
  /** `"manifest"` for HLS/DASH tracks, `"external"` for `subtitles` prop entries. */
  origin: 'manifest' | 'external';
  active: boolean;
}
