import type { FullscreenMode } from './config.js';
import type { PlayerEventListener, PlayerEventName } from './events.js';
import type { PlayerCapabilities, PlayerState, PlayerStats } from './state.js';
import type { AudioTrack, QualityTrack, SubtitleTrackInfo } from './tracks.js';

export interface FullscreenController {
  /** Rejects with a `PlayerError` (`fullscreen-rejected`/`fullscreen-unsupported`) if the request fails. */
  request(mode: FullscreenMode): Promise<void>;
  cancel(mode: FullscreenMode): Promise<void>;
  toggle(mode: FullscreenMode): Promise<void>;
}

/**
 * Imperative API. Async methods reject with a `PlayerError` (`player-not-ready`,
 * `player-destroyed`, `unsupported-operation`, …) instead of hanging.
 *
 * Controlled props: when `volume`, `muted`, `playbackRate`, `quality`,
 * `audioTrack` or `subtitleTrack` is controlled, the matching setter is treated
 * like a user action — it emits the change callback and the host decides by
 * updating the prop.
 */
export interface PlayerRef {
  play(): Promise<void>;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  seekBy(deltaSeconds: number): Promise<void>;
  seekToLive(): Promise<void>;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  setPlaybackRate(value: number): void;
  getQualities(): QualityTrack[];
  setQuality(id: 'auto' | string): Promise<void>;
  getAudioTracks(): AudioTrack[];
  setAudioTrack(id: string): Promise<void>;
  getSubtitleTracks(): SubtitleTrackInfo[];
  /** `null` turns subtitles off. */
  setSubtitleTrack(id: string | null): Promise<void>;
  readonly fullscreen: FullscreenController;
  enterPictureInPicture(): Promise<void>;
  exitPictureInPicture(): Promise<void>;
  /**
   * Captures the current content frame as a PNG Blob owned by the caller
   * (no object URL is created). Resolves `null` when no frame is available.
   * Rejects for protected (DRM) or cross-origin-tainted media.
   */
  captureFrame(): Promise<Blob | null>;
  getState(): PlayerState;
  getStats(): PlayerStats;
  getCapabilities(): PlayerCapabilities;
  /** Retries the failed (or current) load, keeping in-session state and ad history. */
  retry(): Promise<void>;
  /** Idempotent. The React component also destroys the player on unmount. */
  destroy(): Promise<void>;
  /** Adding the same listener twice registers it once. Returns an unsubscribe function. */
  on<K extends PlayerEventName>(event: K, listener: PlayerEventListener<K>): () => void;
  /** The listener is removed before it is invoked. */
  once<K extends PlayerEventName>(event: K, listener: PlayerEventListener<K>): () => void;
  off<K extends PlayerEventName>(event: K, listener: PlayerEventListener<K>): void;
}
