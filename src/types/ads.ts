import type { PlayerSource } from './source.js';

/**
 * Cue time base.
 * - `"media"`: content media time in seconds (VOD only; the default for VOD).
 * - `"session"`: seconds of active content playback in the current content
 *   session, measured with a monotonic clock that pauses during pause,
 *   buffering and linear ad breaks (required for Live in v1).
 */
export type CueTimeBase = 'media' | 'session';

export type LinearAdTiming =
  | { placement: 'preroll' }
  | { placement: 'midroll'; at: number; timeBase?: CueTimeBase }
  | { placement: 'postroll' };

export type AdTiming = LinearAdTiming | { placement: 'overlay'; at: number; timeBase?: CueTimeBase };

export interface DirectAdBase {
  /** Unique within the ads config. A completed ID never replays in the same content session. */
  id: string;
  /** Plain-text label for screen readers and the ad badge. */
  label?: string;
  /** Relative or http(s) URL opened in a new tab only when the viewer activates it. */
  clickThroughUrl?: string;
  /** Seconds of eligible active ad presentation before skip/close is offered. Omit for no skip. */
  skipAfter?: number;
}

export interface DirectTextAd extends DirectAdBase {
  type: 'text';
  /** Plain text. Never interpreted as HTML. */
  text: string;
  /** Seconds. */
  duration: number;
  timing: AdTiming;
  style?: {
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
  };
}

export interface DirectImageAd extends DirectAdBase {
  type: 'image';
  src: string | Blob;
  /** Required alternative text. */
  alt: string;
  /** Seconds. */
  duration: number;
  timing: AdTiming;
}

export interface DirectVideoAd extends DirectAdBase {
  type: 'video';
  /** Ad media. Duration comes from the media itself. */
  source: PlayerSource;
  timing: LinearAdTiming;
}

export type DirectAd = DirectTextAd | DirectImageAd | DirectVideoAd;

export interface VastConfig {
  /** VAST/VMAP ad tag URL requested by the Google IMA SDK. */
  adTagUrl: string;
  /** VAST load timeout per wrapper, milliseconds (IMA `vastLoadTimeout`, IMA default 5000). */
  requestTimeoutMs?: number;
  /** Ad media load timeout, milliseconds (IMA `loadVideoTimeout`, IMA default 8000). */
  loadVideoTimeoutMs?: number;
  /** Restrict linear media MIME types (IMA `AdsRenderingSettings.mimeTypes`). */
  mimeTypes?: string[];
  /** Milliseconds to wait for the IMA SDK script. Default 10000. */
  sdkLoadTimeoutMs?: number;
  /** Use `ima3_debug.js` instead of `ima3.js` (both on imasdk.googleapis.com). */
  debugSdk?: boolean;
}

export interface AdsConfig {
  /** `false` disables every ad pipeline. Default `true`. */
  enabled?: boolean;
  /**
   * When present for the current content, the IMA/VAST pipeline is used and
   * ALL direct `items` are ignored — they are never validated, fetched,
   * rendered or scheduled, even if VAST fails.
   */
  vast?: VastConfig;
  items?: DirectAd[];
  /** Milliseconds to wait for a direct creative to load. Default 8000. */
  loadTimeoutMs?: number;
  /** Re-arm midroll/overlay cues when `loop` restarts VOD content. Default `false`. */
  replayOnLoop?: boolean;
}

export type AdPipeline = 'direct' | 'vast';
export type AdPlacement = 'preroll' | 'midroll' | 'postroll' | 'overlay';

export interface AdInfo {
  id: string;
  pipeline: AdPipeline;
  /** Creative type; `"vast"` for IMA-delivered creatives (`imaContentType` has the MIME type). */
  type: 'text' | 'image' | 'video' | 'vast';
  placement: AdPlacement;
  linear: boolean;
  /** Seconds, when known. */
  duration: number | null;
  label: string | null;
  imaContentType?: string | null;
}

export interface AdProgress {
  ad: AdInfo;
  /** Seconds of ad presentation (ad timeline, not content time). */
  currentTime: number;
  duration: number | null;
  /** Seconds until skip/close is offered, `0` when available, `null` when not skippable. */
  skippableIn: number | null;
}

export interface AdBreakInfo {
  breakId: string;
  pipeline: AdPipeline;
  placement: AdPlacement;
}

export interface AdBreakEndInfo extends AdBreakInfo {
  reason: 'completed' | 'skipped' | 'error' | 'cancelled';
}

export interface LiveRestoreInfo {
  /** How content was restored after a live midroll. */
  reason: 'live-edge' | 'dvr-position' | 'dvr-window-expired';
  position: number;
}
