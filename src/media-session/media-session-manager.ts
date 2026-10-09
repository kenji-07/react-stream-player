import type { MediaSessionConfig } from '../types/config.js';

export interface MediaSessionActions {
  play(): void;
  pause(): void;
  seekBy(delta: number): void;
  seekTo(time: number): void;
  /** Whether seeking is currently allowed (false during linear ads). */
  canSeek(): boolean;
  seekStep(): number;
}

export interface MediaSessionSnapshot {
  playing: boolean;
  /** Content time, seconds. */
  position: number;
  /** Seconds; `null` for unknown/unbounded (live) — position state is not set then. */
  duration: number | null;
  playbackRate: number;
}

type Handled = 'play' | 'pause' | 'seekbackward' | 'seekforward' | 'seekto';
const ACTIONS: Handled[] = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'];

/** Page-level owner registry: one player owns `navigator.mediaSession` at a time. */
let owner: MediaSessionManager | null = null;

export function mediaSessionSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof (globalThis as { MediaMetadata?: unknown }).MediaMetadata === 'function';
}

/**
 * Integrates with the Media Session API when explicitly enabled. Ownership is
 * claimed when the player starts playing; releasing (destroy, disable or
 * another player claiming) clears only the handlers and metadata this
 * instance set, so another owner or host integration is never clobbered.
 * Next/previous track actions are intentionally not registered.
 */
export class MediaSessionManager {
  private metadata: MediaMetadata | null = null;
  private registered = new Set<Handled>();
  private config: MediaSessionConfig = {};

  constructor(private readonly actions: MediaSessionActions) {}

  static getOwner(): MediaSessionManager | null {
    return owner;
  }

  configure(config: MediaSessionConfig): void {
    const wasEnabled = this.config.enabled === true;
    this.config = config;
    if (!config.enabled) {
      if (wasEnabled) this.release();
      return;
    }
    if (owner === this) this.applyMetadata();
  }

  isOwner(): boolean {
    return owner === this;
  }

  /** Called when this player starts playing content. */
  claim(snapshot: MediaSessionSnapshot): void {
    if (!this.config.enabled || !mediaSessionSupported()) return;
    if (owner && owner !== this) owner.release();
    owner = this;
    this.applyMetadata();
    this.registerHandlers();
    this.update(snapshot);
  }

  private applyMetadata(): void {
    if (!mediaSessionSupported()) return;
    const c = this.config;
    try {
      this.metadata = new MediaMetadata({
        title: c.title ?? '',
        artist: c.artist ?? '',
        album: c.album ?? '',
        artwork: (c.artwork ?? []).filter((a) => typeof a?.src === 'string').map((a) => ({ src: a.src, sizes: a.sizes, type: a.type })),
      });
      navigator.mediaSession.metadata = this.metadata;
    } catch {
      this.metadata = null;
    }
  }

  private registerHandlers(): void {
    const session = navigator.mediaSession;
    const handlers: Record<Handled, MediaSessionActionHandler> = {
      play: () => this.actions.play(),
      pause: () => this.actions.pause(),
      seekbackward: (details) => {
        if (this.actions.canSeek()) this.actions.seekBy(-(details.seekOffset ?? this.actions.seekStep()));
      },
      seekforward: (details) => {
        if (this.actions.canSeek()) this.actions.seekBy(details.seekOffset ?? this.actions.seekStep());
      },
      seekto: (details) => {
        if (this.actions.canSeek() && typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) this.actions.seekTo(details.seekTime);
      },
    };
    for (const action of ACTIONS) {
      try {
        session.setActionHandler(action, handlers[action]);
        this.registered.add(action);
      } catch {
        // Unsupported action on this browser: skip honestly.
      }
    }
  }

  /** Supported actions after registration (for capabilities/tests). */
  registeredActions(): string[] {
    return [...this.registered];
  }

  update(snapshot: MediaSessionSnapshot): void {
    if (owner !== this || !mediaSessionSupported()) return;
    const session = navigator.mediaSession;
    try {
      session.playbackState = snapshot.playing ? 'playing' : 'paused';
    } catch {
      /* ignore */
    }
    if (typeof session.setPositionState !== 'function') return;
    const { duration, position, playbackRate } = snapshot;
    try {
      if (duration !== null && Number.isFinite(duration) && duration > 0 && Number.isFinite(position) && playbackRate > 0) {
        session.setPositionState({ duration, position: Math.min(Math.max(0, position), duration), playbackRate });
      } else {
        // Live/unknown duration: clear position state rather than submit Infinity/NaN.
        session.setPositionState();
      }
    } catch {
      /* some browsers throw for edge values; position state is best-effort */
    }
  }

  release(): void {
    if (owner !== this) return;
    owner = null;
    if (!mediaSessionSupported()) return;
    const session = navigator.mediaSession;
    for (const action of this.registered) {
      try {
        session.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
    this.registered.clear();
    if (session.metadata === this.metadata && this.metadata !== null) session.metadata = null;
    this.metadata = null;
    try {
      session.playbackState = 'none';
      if (typeof session.setPositionState === 'function') session.setPositionState();
    } catch {
      /* ignore */
    }
  }

  destroy(): void {
    this.release();
  }
}
