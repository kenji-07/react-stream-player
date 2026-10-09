import type { AdInfo, AdPipeline } from './ads.js';
import type { Fit, FullscreenMode, Layout, UiMode } from './config.js';
import type { PlayerError } from './errors.js';
import type { ResolvedSourceType } from './source.js';
import type { AudioTrack, QualityTrack, SubtitleTrackInfo } from './tracks.js';

export interface TimeRange {
  start: number;
  end: number;
}

export interface LiveState {
  isLive: boolean;
  /** Within `live.edgeTolerance` of the live edge. */
  atLiveEdge: boolean;
  /** Current seekable (DVR) window in media time, or `null` when unknown. */
  seekableRange: TimeRange | null;
  /** Seconds between the playhead and the live edge, or `null`. */
  behindLiveEdge: number | null;
  /** Measured latency in seconds reported by the engine, or `null` when unavailable. */
  latency: number | null;
  /** Configured target latency in seconds, or `null`. */
  targetLatency: number | null;
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'error' | 'destroyed';

export interface AdState {
  active: boolean;
  /** Pipeline selected for the current content session. */
  pipeline: AdPipeline | null;
  ad: AdInfo | null;
  /** Ad timeline (seconds), independent of content time. */
  currentTime: number;
  duration: number | null;
  skippableIn: number | null;
}

export type CastStatus = 'unavailable' | 'available' | 'connecting' | 'connected';

export interface PlayerState {
  status: PlayerStatus;
  /** Stable ID of the current content session (changes with source id/revision or URL). */
  contentSessionId: string | null;
  /** ID of the latest engine load attempt (quality switch, refresh and retry create new ones). */
  loadId: number | null;
  sourceType: ResolvedSourceType | null;
  engine: 'native' | 'shaka' | null;
  ui: UiMode;
  layout: Layout;
  fit: Fit;
  /** Whether the viewer/host wants playback to run (survives ad breaks and buffering). */
  intendedPlaying: boolean;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  seeking: boolean;
  /** Content media time, seconds. */
  currentTime: number;
  /** Seconds; `null` for unknown or unbounded (live) durations. */
  duration: number | null;
  buffered: TimeRange[];
  seekable: TimeRange[];
  volume: number;
  muted: boolean;
  playbackRate: number;
  playbackRates: number[];
  quality: {
    selected: 'auto' | string | null;
    effective: QualityTrack | null;
    available: QualityTrack[];
    /** `"auto"` is only offered for adaptive sources. */
    autoAvailable: boolean;
  };
  audio: {
    selected: string | null;
    available: AudioTrack[];
  };
  subtitles: {
    /** `null` = off. */
    selected: string | null;
    available: SubtitleTrackInfo[];
  };
  live: LiveState;
  fullscreen: {
    active: boolean;
    mode: FullscreenMode | null;
    /** Browser fullscreen of the video element only (iOS) — DOM overlays are not visible. */
    videoOnly: boolean;
  };
  pictureInPicture: boolean;
  ad: AdState;
  cast: { status: CastStatus; deviceName: string | null };
  airplay: { available: boolean; active: boolean };
  error: PlayerError | null;
}

export type CapabilityStatus = { supported: true } | { supported: false; reason: string };

export interface PlayerCapabilities {
  engine: 'native' | 'shaka' | null;
  adaptiveQuality: CapabilityStatus;
  manualQuality: CapabilityStatus;
  audioTrackSelection: CapabilityStatus;
  subtitleSelection: CapabilityStatus;
  playbackRate: CapabilityStatus;
  /** Setting `volume` has no effect on some platforms (e.g. iOS). */
  volumeControl: CapabilityStatus;
  browserFullscreen: CapabilityStatus;
  webFullscreen: CapabilityStatus;
  pictureInPicture: CapabilityStatus;
  airplay: CapabilityStatus;
  cast: CapabilityStatus;
  mediaSession: CapabilityStatus;
  captureFrame: CapabilityStatus;
  drm: CapabilityStatus;
  streamingConfig: CapabilityStatus;
  requestInterception: CapabilityStatus;
  contextMenu: CapabilityStatus;
  liveSeek: CapabilityStatus;
}

export interface PlayerStats {
  content: {
    /** Seconds of active content playback in this content session. */
    sessionPlaybackTime: number;
    /** Bits per second, adaptive engines only. */
    estimatedBandwidth: number | null;
    streamBandwidth: number | null;
    width: number | null;
    height: number | null;
    droppedFrames: number | null;
    decodedFrames: number | null;
    stallsDetected: number | null;
    gapsJumped: number | null;
    bufferingTime: number | null;
    loadLatency: number | null;
    liveLatency: number | null;
    loadAttempts: number;
  };
  advertising: {
    pipeline: AdPipeline | null;
    started: number;
    completed: number;
    skipped: number;
    errors: number;
  };
  remote: {
    castStatus: CastStatus;
    airplayActive: boolean;
  };
}
