import type { PlayerErrorImpl } from '../errors.js';
import type { ResolvedSourceType } from '../types/source.js';
import type { TimeRange } from '../types/state.js';
import type { AudioTrack, QualityTrack, SubtitleKind } from '../types/tracks.js';

export interface EngineEventMap {
  /** Quality, audio or text track lists changed. */
  tracksChanged: undefined;
  /** The rendition actually playing changed. */
  effectiveQualityChanged: undefined;
  textChanged: undefined;
  /** Engine-reported buffering state (Shaka); native buffering comes from media events. */
  buffering: boolean;
  /** Errors reported asynchronously by the engine during playback. */
  error: PlayerErrorImpl;
  /** Live/seekable window metadata changed (manifest update). */
  timelineChanged: undefined;
}

export interface EngineLoadRequest {
  loadId: number;
  url: string;
  mimeType: string | null;
  type: ResolvedSourceType;
  /** `null` = engine default (VOD start / live startup position). */
  startTime: number | null;
  /** Preferred audio language for the initial variant. */
  preferredAudioLanguage: string | null;
}

export interface EngineTextTrack {
  /** Engine-scoped stable ID. */
  id: string;
  label: string | null;
  language: string;
  kind: SubtitleKind;
  forced: boolean;
  active: boolean;
  /** ID given to `addExternalText`, when this track came from the host. */
  externalId: string | null;
}

export interface EngineCapabilities {
  adaptiveQuality: boolean;
  audioTrackSelection: boolean;
  requestInterception: boolean;
  streamingConfig: boolean;
  drm: boolean;
  /** Reason when quality selection is unavailable (e.g. native HLS in src= mode). */
  qualityUnavailableReason: string | null;
}

export interface EngineStats {
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
}

/**
 * Engine contract. Engines are framework-independent, own no UI, and never
 * create a second content media element. `destroy()` is idempotent.
 */
export interface MediaEngine {
  readonly kind: 'native' | 'shaka';
  on<K extends keyof EngineEventMap>(event: K, listener: (payload: EngineEventMap[K]) => void): () => void;
  capabilities(): EngineCapabilities;
  /** Resolves once metadata is available. Rejects with a `PlayerError`; `operation-aborted` when superseded. */
  load(request: EngineLoadRequest, signal: AbortSignal): Promise<void>;
  unload(): Promise<void>;
  destroy(): Promise<void>;

  getQualities(): QualityTrack[];
  getEffectiveQuality(): QualityTrack | null;
  /** `"auto"` enables ABR (subject to `abr.enabled`); an ID disables ABR and selects that rendition. */
  setQuality(id: 'auto' | string): boolean;
  getAudioTracks(): AudioTrack[];
  setAudioTrack(id: string): boolean;
  getTextTracks(): EngineTextTrack[];
  setTextTrack(id: string | null): boolean;
  addExternalText(track: { externalId: string; url: string; language: string; label: string; kind: SubtitleKind }): Promise<void>;

  isLive(): boolean;
  seekRange(): TimeRange | null;
  seekToLive(): void;
  liveLatency(): number | null;
  targetLatency(): number | null;
  getStats(): EngineStats;
  isProtected(): boolean;
}
