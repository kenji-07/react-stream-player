import type { AdBreakEndInfo, AdBreakInfo, AdInfo, AdProgress, LiveRestoreInfo } from './ads.js';
import type { FullscreenMode } from './config.js';
import type { PlayerError } from './errors.js';
import type { CastStatus, LiveState, PlayerStatus, TimeRange } from './state.js';
import type { ResolvedSourceType } from './source.js';
import type { AudioTrack, QualitySelection, QualityTrack, SubtitleTrackInfo } from './tracks.js';

export interface PlaybackEventInfo {
  /** Content media time, seconds. */
  currentTime: number;
}

export interface LoadStartInfo {
  /** Why the engine is loading. Only `"initial"` starts a new content session. */
  reason: 'initial' | 'quality' | 'refresh' | 'retry' | 'cast-return';
  sourceType: ResolvedSourceType;
}

export interface ReadyInfo {
  sourceType: ResolvedSourceType;
  engine: 'native' | 'shaka';
  /** Seconds, `null` for unknown/unbounded. */
  duration: number | null;
  isLive: boolean;
}

export interface ProgressInfo {
  currentTime: number;
  duration: number | null;
  buffered: TimeRange[];
  /** Seconds of active playback in this content session. */
  sessionTime: number;
}

export interface SeekInfo {
  /** Target (seeking) or reached (seeked) position, seconds. */
  currentTime: number;
}

export interface FullscreenChangeInfo {
  active: boolean;
  mode: FullscreenMode | null;
  videoOnly: boolean;
}

export interface AutoplayBlockedInfo {
  mutedFallback: 'succeeded' | 'failed' | 'disabled';
}

/**
 * Every public event and its payload. React callbacks are derived from this
 * map (`ready` → `onReady`), as are `on`/`once`/`off` on the PlayerRef.
 * Listeners also receive an {@link EventContext} as their second argument.
 */
export interface PlayerEventMap {
  ready: ReadyInfo;
  loadStart: LoadStartInfo;
  statusChange: PlayerStatus;
  play: PlaybackEventInfo;
  pause: PlaybackEventInfo;
  playing: PlaybackEventInfo;
  ended: PlaybackEventInfo;
  progress: ProgressInfo;
  seeking: SeekInfo;
  seeked: SeekInfo;
  buffering: boolean;
  durationChange: number | null;
  qualityChange: QualitySelection;
  effectiveQualityChange: QualityTrack | null;
  availableQualitiesChange: QualityTrack[];
  audioTrackChange: AudioTrack | null;
  availableAudioTracksChange: AudioTrack[];
  /** `null` = subtitles off. */
  subtitleChange: SubtitleTrackInfo | null;
  availableSubtitlesChange: SubtitleTrackInfo[];
  volumeChange: number;
  mutedChange: boolean;
  playbackRateChange: number;
  fullscreenChange: FullscreenChangeInfo;
  pictureInPictureChange: boolean;
  liveStateChange: LiveState;
  autoplayBlocked: AutoplayBlockedInfo;
  error: PlayerError;
  adBreakStart: AdBreakInfo;
  adBreakEnd: AdBreakEndInfo;
  adStart: AdInfo;
  adProgress: AdProgress;
  adSkip: AdInfo;
  adComplete: AdInfo;
  adClick: AdInfo;
  /** Non-fatal for content: content continues after an ad error. */
  adError: PlayerError;
  liveRestore: LiveRestoreInfo;
  castStateChange: { status: CastStatus; deviceName: string | null };
  airplayChange: { available: boolean; active: boolean };
  destroy: { reason: 'destroy' | 'unmount' };
}

export type PlayerEventName = keyof PlayerEventMap;

/** Identifies which content session / load produced an event, so stale events can be ignored. */
export interface EventContext {
  contentSessionId: string | null;
  loadId: number | null;
  /** `performance.now()` when emitted. */
  timestamp: number;
}

export type PlayerEventListener<K extends PlayerEventName> = (payload: PlayerEventMap[K], context: EventContext) => void;

/** React callback props derived from {@link PlayerEventMap}: `onReady`, `onQualityChange`, … */
export type PlayerEventCallbacks = {
  [K in PlayerEventName as `on${Capitalize<K>}`]?: PlayerEventListener<K>;
};
