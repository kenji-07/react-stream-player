import { playerError, type PlayerErrorImpl } from '../errors.js';
import type { CastConfig } from '../types/config.js';
import type { CastStatus } from '../types/state.js';

/** Google Cast Web Sender SDK (CAF) URL documented by Google. */
export const CAST_SENDER_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';

// Minimal typings for the CAF sender subset used (externally unverified on devices).
interface CastFramework {
  CastContext: { getInstance(): CastContext };
  CastContextEventType: { SESSION_STATE_CHANGED: string; CAST_STATE_CHANGED: string };
  SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string; SESSION_STARTING: string };
  CastState: { NO_DEVICES_AVAILABLE: string; NOT_CONNECTED: string; CONNECTING: string; CONNECTED: string };
  RemotePlayer: new () => RemotePlayer;
  RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
  RemotePlayerEventType: { IS_CONNECTED_CHANGED: string; CURRENT_TIME_CHANGED: string; IS_PAUSED_CHANGED: string };
}
interface CastContext {
  setOptions(options: Record<string, unknown>): void;
  getCastState(): string;
  getCurrentSession(): CastSession | null;
  requestSession(): Promise<unknown>;
  addEventListener(type: string, listener: (event: { sessionState?: string; castState?: string }) => void): void;
  removeEventListener(type: string, listener: (event: { sessionState?: string; castState?: string }) => void): void;
}
interface CastSession {
  loadMedia(request: unknown): Promise<unknown>;
  getCastDevice(): { friendlyName?: string } | null;
  endSession(stopCasting: boolean): void;
}
interface RemotePlayer {
  isConnected: boolean;
  currentTime: number;
  isPaused: boolean;
}
interface RemotePlayerController {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  playOrPause(): void;
  seek(): void;
}
interface ChromeCast {
  media: {
    MediaInfo: new (contentId: string, contentType: string) => Record<string, unknown>;
    LoadRequest: new (mediaInfo: unknown) => Record<string, unknown>;
  };
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
}

let loader: Promise<{ framework: CastFramework; chrome: ChromeCast }> | null = null;

function loadCastSdk(nonce: string | null, timeoutMs = 10_000): Promise<{ framework: CastFramework; chrome: ChromeCast }> {
  const g = globalThis as { cast?: { framework?: CastFramework }; chrome?: { cast?: ChromeCast }; __onGCastApiAvailable?: (ok: boolean) => void };
  if (g.cast?.framework && g.chrome?.cast) return Promise.resolve({ framework: g.cast.framework, chrome: g.chrome.cast });
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const previous = g.__onGCastApiAvailable;
    const timer = setTimeout(() => fail(new Error('Cast SDK load timed out')), timeoutMs);
    const fail = (error: Error) => {
      clearTimeout(timer);
      loader = null;
      reject(error);
    };
    // The SDK reports readiness through this page-global callback; chain any existing handler.
    g.__onGCastApiAvailable = (available: boolean) => {
      previous?.(available);
      clearTimeout(timer);
      if (available && g.cast?.framework && g.chrome?.cast) resolve({ framework: g.cast.framework, chrome: g.chrome.cast });
      else fail(new Error('Cast API unavailable'));
    };
    const script = document.createElement('script');
    script.src = CAST_SENDER_URL;
    script.async = true;
    if (nonce) script.nonce = nonce;
    script.onerror = () => fail(new Error('Cast SDK failed to load'));
    document.head.appendChild(script);
  });
  return loader;
}

export interface CastMediaRequest {
  url: string;
  contentType: string;
  currentTime: number;
  autoplay: boolean;
}

export interface CastHost {
  nonce(): string | null;
  /** Media to cast, or a capability reason why casting must be rejected now. */
  media(): CastMediaRequest | { rejected: string };
  /** Remote playback took over: pause local content (intent preserved). */
  onRemoteStart(): void;
  /** Remote session ended at `time`; resume locally when configured. */
  onRemoteEnd(time: number, wasPlaying: boolean): void;
  onStatus(status: CastStatus, deviceName: string | null): void;
  onError(error: PlayerErrorImpl): void;
}

/**
 * Google Cast sender integration, lazily initialised only when `cast.enabled`.
 * CastContext options are page-global by design of the SDK; the first player
 * to initialise sets them (documented limitation).
 */
export class CastManager {
  private framework: CastFramework | null = null;
  private chrome: ChromeCast | null = null;
  private context: CastContext | null = null;
  private remote: RemotePlayer | null = null;
  private controller: RemotePlayerController | null = null;
  private status: CastStatus = 'unavailable';
  private destroyed = false;
  private config: CastConfig = {};
  private lastRemoteTime = 0;
  private lastRemotePlaying = false;
  private ownsSession = false;
  private readonly onCastState = () => this.updateStatus();
  private readonly onSessionState = (event: { sessionState?: string }) => void this.handleSession(event.sessionState);
  private readonly onRemoteTime = () => {
    if (this.remote) this.lastRemoteTime = this.remote.currentTime;
  };
  private readonly onRemotePaused = () => {
    if (this.remote) this.lastRemotePlaying = !this.remote.isPaused;
  };
  private static optionsSet = false;

  constructor(private readonly host: CastHost) {}

  async configure(config: CastConfig): Promise<void> {
    this.config = config;
    if (!config.enabled || this.context || this.destroyed) return;
    try {
      const { framework, chrome } = await loadCastSdk(this.host.nonce());
      if (this.destroyed) return;
      this.framework = framework;
      this.chrome = chrome;
      const context = framework.CastContext.getInstance();
      if (!CastManager.optionsSet) {
        context.setOptions({
          receiverApplicationId: config.receiverApplicationId ?? DEFAULT_MEDIA_RECEIVER,
          autoJoinPolicy: chrome.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        CastManager.optionsSet = true;
      }
      this.context = context;
      context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, this.onCastState);
      context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, this.onSessionState);
      this.remote = new framework.RemotePlayer();
      this.controller = new framework.RemotePlayerController(this.remote);
      this.controller.addEventListener(framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, this.onRemoteTime);
      this.controller.addEventListener(framework.RemotePlayerEventType.IS_PAUSED_CHANGED, this.onRemotePaused);
      this.updateStatus();
    } catch (error) {
      this.setStatus('unavailable', null);
      this.host.onError(playerError('cast-unavailable', 'cast', { cause: error }));
    }
  }

  /** Replaces the configuration (latest callbacks) without re-initialising the SDK. */
  setConfig(config: CastConfig): void {
    this.config = config;
  }

  get available(): boolean {
    return this.status !== 'unavailable';
  }

  private updateStatus(): void {
    if (!this.context || !this.framework) return;
    const state = this.context.getCastState();
    const S = this.framework.CastState;
    const device = this.context.getCurrentSession()?.getCastDevice()?.friendlyName ?? null;
    if (state === S.CONNECTED) this.setStatus('connected', device);
    else if (state === S.CONNECTING) this.setStatus('connecting', device);
    else if (state === S.NOT_CONNECTED) this.setStatus('available', null);
    else this.setStatus('unavailable', null);
  }

  private setStatus(status: CastStatus, deviceName: string | null): void {
    if (this.status === status) return;
    this.status = status;
    this.host.onStatus(status, deviceName);
  }

  /** Opens the device picker. Rejects with `cast-rejected` (and a capability reason) when not allowed. */
  async start(): Promise<void> {
    if (!this.context) throw playerError('cast-unavailable', 'cast');
    const media = this.host.media();
    if ('rejected' in media) throw playerError('cast-rejected', 'cast', { details: { reason: media.rejected } });
    try {
      await this.context.requestSession();
    } catch (error) {
      throw playerError('cast-error', 'cast', { cause: error });
    }
  }

  /** Ends the remote session this player started (local playback resumes per `resumeLocalOnDisconnect`). */
  stop(): void {
    if (!this.ownsSession) return;
    this.context?.getCurrentSession()?.endSession(true);
  }

  get connected(): boolean {
    return this.status === 'connected';
  }

  private async handleSession(state: string | undefined): Promise<void> {
    if (!this.framework || !this.context || !this.chrome) return;
    const S = this.framework.SessionState;
    if (state === S.SESSION_STARTED || state === S.SESSION_RESUMED) {
      const session = this.context.getCurrentSession();
      const media = this.host.media();
      if (!session) return;
      if ('rejected' in media) {
        session.endSession(true);
        this.host.onError(playerError('cast-rejected', 'cast', { details: { reason: media.rejected } }));
        return;
      }
      try {
        const info = new this.chrome.media.MediaInfo(media.url, media.contentType);
        const request = new this.chrome.media.LoadRequest(info);
        request.currentTime = media.currentTime;
        request.autoplay = media.autoplay;
        if (this.config.getCustomData) request.customData = await this.config.getCustomData();
        this.host.onRemoteStart();
        this.ownsSession = true;
        this.lastRemoteTime = media.currentTime;
        this.lastRemotePlaying = media.autoplay;
        await session.loadMedia(request);
      } catch (error) {
        this.host.onError(playerError('cast-error', 'cast', { cause: error }));
      }
    } else if (state === S.SESSION_ENDED && this.ownsSession) {
      this.ownsSession = false;
      if (this.config.resumeLocalOnDisconnect !== false) this.host.onRemoteEnd(this.lastRemoteTime, this.lastRemotePlaying);
    }
    this.updateStatus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.context && this.framework) {
      this.context.removeEventListener(this.framework.CastContextEventType.CAST_STATE_CHANGED, this.onCastState);
      this.context.removeEventListener(this.framework.CastContextEventType.SESSION_STATE_CHANGED, this.onSessionState);
    }
    if (this.controller && this.framework) {
      this.controller.removeEventListener(this.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, this.onRemoteTime);
      this.controller.removeEventListener(this.framework.RemotePlayerEventType.IS_PAUSED_CHANGED, this.onRemotePaused);
    }
  }
}
