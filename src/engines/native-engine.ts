import { fromMediaError, playerError } from '../errors.js';
import type { AudioTrack, QualityTrack } from '../types/tracks.js';
import type { TimeRange } from '../types/state.js';
import { TypedEmitter } from '../utils/emitter.js';
import type { EngineCapabilities, EngineEventMap, EngineLoadRequest, EngineStats, EngineTextTrack, MediaEngine } from './engine.js';

/**
 * Lightweight engine for unprotected progressive media (MP4/WebM) using the
 * element's own `src`. No adaptive SDK is loaded on this path. Quality
 * variants are separate files switched by the controller via `load()`.
 */
export class NativeVideoEngine implements MediaEngine {
  readonly kind = 'native' as const;
  private readonly emitter = new TypedEmitter<EngineEventMap, undefined>();
  private destroyed = false;
  private loading: { reject: (e: unknown) => void } | null = null;
  private unloading = false;
  private readonly onError = () => {
    if (this.unloading || this.loading || !this.video.getAttribute('src')) return;
    this.emitter.emit('error', fromMediaError(this.video.error), undefined);
  };

  constructor(private readonly video: HTMLVideoElement) {
    video.addEventListener('error', this.onError);
  }

  on<K extends keyof EngineEventMap>(event: K, listener: (payload: EngineEventMap[K]) => void): () => void {
    return this.emitter.on(event, listener as (p: EngineEventMap[K], c: undefined) => void);
  }

  capabilities(): EngineCapabilities {
    return {
      adaptiveQuality: false,
      audioTrackSelection: false,
      requestInterception: false,
      streamingConfig: false,
      drm: false,
      qualityUnavailableReason: null,
    };
  }

  load(request: EngineLoadRequest, signal: AbortSignal): Promise<void> {
    if (this.destroyed) return Promise.reject(playerError('player-destroyed', 'state'));
    this.loading?.reject(playerError('operation-aborted', 'state'));
    const video = this.video;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onErr);
        signal.removeEventListener('abort', onAbort);
        if (this.loading === handle) this.loading = null;
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const handle = { reject: (e: unknown) => finish(() => reject(e)) };
      const onMeta = () =>
        finish(() => {
          if (request.startTime !== null && request.startTime > 0) {
            const duration = video.duration;
            const max = Number.isFinite(duration) ? Math.max(0, duration - 0.1) : request.startTime;
            try {
              video.currentTime = Math.min(request.startTime, max);
            } catch {
              /* some platforms reject early seeks; position stays at 0 */
            }
          }
          resolve();
        });
      const onErr = () => finish(() => reject(fromMediaError(video.error)));
      const onAbort = () => finish(() => reject(playerError('operation-aborted', 'state')));
      if (signal.aborted) return onAbort();
      this.loading = handle;
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('error', onErr);
      signal.addEventListener('abort', onAbort);
      video.src = request.url;
      video.load();
    });
  }

  async unload(): Promise<void> {
    this.loading?.reject(playerError('operation-aborted', 'state'));
    this.unloading = true;
    try {
      if (this.video.getAttribute('src') !== null) {
        this.video.removeAttribute('src');
        this.video.load();
      }
    } finally {
      // The empty-src error (if any) is dispatched asynchronously.
      setTimeout(() => (this.unloading = false), 0);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    await this.unload();
    this.destroyed = true;
    this.video.removeEventListener('error', this.onError);
    this.emitter.dispose();
  }

  getQualities(): QualityTrack[] {
    return [];
  }
  getEffectiveQuality(): QualityTrack | null {
    return null;
  }
  setQuality(): boolean {
    return false;
  }
  getAudioTracks(): AudioTrack[] {
    return [];
  }
  setAudioTrack(): boolean {
    return false;
  }
  getTextTracks(): EngineTextTrack[] {
    return [];
  }
  setTextTrack(): boolean {
    return false;
  }
  async addExternalText(): Promise<void> {
    /* external text on the native path is managed by the SubtitleManager via <track> */
  }
  isLive(): boolean {
    return this.video.duration === Infinity;
  }
  seekRange(): TimeRange | null {
    const s = this.video.seekable;
    if (!s || s.length === 0) return null;
    return { start: s.start(0), end: s.end(s.length - 1) };
  }
  seekToLive(): void {
    const range = this.seekRange();
    if (range) this.video.currentTime = range.end;
  }
  liveLatency(): number | null {
    return null;
  }
  targetLatency(): number | null {
    return null;
  }
  getStats(): EngineStats {
    const q = typeof this.video.getVideoPlaybackQuality === 'function' ? this.video.getVideoPlaybackQuality() : null;
    return {
      estimatedBandwidth: null,
      streamBandwidth: null,
      width: this.video.videoWidth || null,
      height: this.video.videoHeight || null,
      droppedFrames: q?.droppedVideoFrames ?? null,
      decodedFrames: q?.totalVideoFrames ?? null,
      stallsDetected: null,
      gapsJumped: null,
      bufferingTime: null,
      loadLatency: null,
      liveLatency: null,
    };
  }
  isProtected(): boolean {
    return false;
  }
}
