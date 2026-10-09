import type { NormalizedSource } from '../controller/source.js';
import type { MediaEngine } from '../engines/engine.js';
import { playerError, type PlayerErrorImpl } from '../errors.js';
import type { BlobRegistry } from '../resources/blob-registry.js';
import { blobIdentity } from '../resources/blob-registry.js';
import type { ClickThroughPolicy } from '../security/url.js';
import type { AdBreakEndInfo, AdBreakInfo, AdInfo, AdPipeline, AdPlacement, AdProgress, AdsConfig, DirectAd, VastConfig } from '../types/ads.js';
import type { PlayerSource } from '../types/source.js';
import type { Translations } from '../ui/i18n.js';
import { DirectAdPresenter, type AdOutcome } from './direct-presenter.js';
import { ImaPipeline } from './ima-pipeline.js';
import { applyLiveRules, CueSchedule, validateDirectAds, type CueTick, type MediaKind } from './schedule.js';

export interface AdsEvents {
  adStart: AdInfo;
  adProgress: AdProgress;
  adSkip: AdInfo;
  adComplete: AdInfo;
  adClick: AdInfo;
  adError: PlayerErrorImpl;
}

export interface AdsManagerHost {
  readonly layer: HTMLElement;
  readonly contentVideo: HTMLVideoElement;
  readonly blobs: BlobRegistry;
  t(): Translations;
  clickPolicy(): ClickThroughPolicy;
  nonce(): string | null;
  sessionSeconds(): number;
  contentAudio(): { volume: number; muted: boolean };
  autoplayIntended(): boolean;
  createEngine(video: HTMLVideoElement, source: NormalizedSource): MediaEngine;
  /** Pause content and enter the ad state (linear breaks only). */
  beginLinearBreak(info: AdBreakInfo): void;
  /** Leave the ad state and restore content exactly once. */
  endLinearBreak(info: AdBreakEndInfo): void;
  emit<K extends keyof AdsEvents>(event: K, payload: AdsEvents[K]): void;
  /** Ad presentation progress for state (ad timeline, not content). */
  adProgressState(info: AdInfo | null, currentTime: number, duration: number | null, skippableIn: number | null): void;
}

export type ActivePipeline = 'none' | 'direct' | 'vast';

function itemsKey(items: DirectAd[] | undefined): string {
  return JSON.stringify(
    (items ?? []).map((ad) => {
      const copy: Record<string, unknown> = { ...ad };
      if (ad.type === 'image' && typeof ad.src !== 'string') copy.src = blobIdentity(ad.src);
      if (ad.type === 'video') copy.source = sourceKey(ad.source);
      return copy;
    }),
  );
}

function sourceKey(source: PlayerSource): unknown {
  const ident = (v: string | Blob) => (typeof v === 'string' ? v : blobIdentity(v));
  if ('variants' in source) return { ...source, variants: source.variants.map((v) => ({ ...v, src: ident(v.src) })) };
  return { ...source, src: ident(source.src) };
}

function vastKey(vast: VastConfig): string {
  return JSON.stringify([vast.adTagUrl, vast.requestTimeoutMs ?? null, vast.loadVideoTimeoutMs ?? null, vast.mimeTypes ?? null, vast.sdkLoadTimeoutMs ?? null, Boolean(vast.debugSdk)]);
}

/**
 * Selects exactly one ad pipeline per content session and runs it.
 *
 * VAST precedence (mandatory):
 *  1. `enabled: false` disables everything.
 *  2. If `vast` is configured, IMA is selected BEFORE direct items are
 *     validated, fetched, converted to object URLs or scheduled.
 *  3. All direct items are suppressed for that content session.
 *  4. VAST failures (SDK blocked, no-fill, timeout, malformed) never fall back
 *     to direct items; content continues.
 *  5. IMA-delivered creatives of any type are allowed.
 *  6. VAST introduced mid-session cancels any direct break/overlay first
 *     (content restored at most once). Removing VAST later in the same session
 *     does not start the suppressed direct ads; a new session re-evaluates.
 */
export class AdsManager {
  private pipeline: ActivePipeline = 'none';
  private vastSeenThisSession = false;
  private history = new Set<string>();
  private kind: MediaKind | null = null;
  private config: AdsConfig | undefined;
  private directKey: string | null = null;
  private currentVastKey: string | null = null;
  private validItems: DirectAd[] = [];
  private schedule: CueSchedule | null = null;
  private presenter: DirectAdPresenter;
  private ima: ImaPipeline | null = null;
  private imaContainer: HTMLElement | null = null;
  private breakAbort: AbortController | null = null;
  private breakInfo: AdBreakInfo | null = null;
  private imaBreak: AdBreakInfo | null = null;
  private overlayAbort: AbortController | null = null;
  private overlayQueue: DirectAd[] = [];
  private prerollHandled = false;
  private playStarted = false;
  private breakSeq = 0;
  private destroyed = false;
  readonly stats = { started: 0, completed: 0, skipped: 0, errors: 0 };

  constructor(private readonly host: AdsManagerHost) {
    this.presenter = new DirectAdPresenter({
      layer: host.layer,
      blobs: host.blobs,
      t: () => host.t(),
      clickPolicy: () => host.clickPolicy(),
      loadTimeoutMs: () => this.config?.loadTimeoutMs ?? 8000,
      sessionSeconds: () => host.sessionSeconds(),
      contentAudio: () => host.contentAudio(),
      createEngine: (video, source) => host.createEngine(video, source),
      start: (info) => this.onStart(info),
      progress: (info, t, d, s) => this.onProgress(info, t, d, s),
      skip: (info) => this.onSkip(info),
      complete: (info) => this.onComplete(info),
      click: (info) => host.emit('adClick', info),
      error: (_info, error) => this.onError(error),
    });
  }

  get activePipeline(): AdPipeline | null {
    return this.pipeline === 'none' ? null : this.pipeline;
  }

  get linearActive(): boolean {
    return this.breakInfo !== null || Boolean(this.ima?.breakActive);
  }

  /** Direct ads that could still run in this session (Cast handoff check). */
  hasPendingDirectAds(): boolean {
    return this.pipeline === 'direct' && Boolean(this.schedule?.hasPending());
  }

  /** Starts a new content session: clears cue history and re-evaluates precedence. */
  newSession(): void {
    this.cancelAll();
    this.history = new Set();
    this.vastSeenThisSession = false;
    this.kind = null;
    this.schedule = null;
    this.prerollHandled = false;
    this.playStarted = false;
    this.directKey = null;
    this.currentVastKey = null;
    this.pipeline = 'none';
    this.configure(this.config);
  }

  configure(config: AdsConfig | undefined): void {
    if (this.destroyed) return;
    this.config = config;
    if (!config || config.enabled === false) {
      this.switchTo('none');
      return;
    }
    if (config.vast) {
      // Precedence: VAST wins before any direct item is touched.
      this.vastSeenThisSession = true;
      const key = vastKey(config.vast);
      if (this.pipeline !== 'vast' || key !== this.currentVastKey) {
        this.switchTo('vast');
        this.currentVastKey = key;
        this.startIma(config.vast);
      }
      return;
    }
    if (this.vastSeenThisSession) {
      // VAST removed mid-session: suppressed direct ads stay suppressed until a new session.
      this.switchTo('none');
      return;
    }
    const key = itemsKey(config.items);
    if (this.pipeline === 'direct' && key === this.directKey) return; // semantically unchanged
    if (this.pipeline !== 'direct') this.switchTo('direct');
    this.directKey = key;
    const { valid, rejected } = validateDirectAds(config.items);
    for (const r of rejected) this.onError(playerError('ad-invalid-config', 'ads', { message: `Ad "${r.id}" rejected: ${r.reason}`, details: { adId: r.id } }));
    this.validItems = valid;
    this.rebuildSchedule();
  }

  private switchTo(next: ActivePipeline): void {
    if (this.pipeline === next) return;
    if (this.pipeline === 'direct') {
      // Terminate active direct creatives, timers and callbacks; restore content at most once.
      this.overlayQueue = [];
      this.overlayAbort?.abort();
      this.overlayAbort = null;
      const active = this.breakInfo;
      this.breakAbort?.abort();
      this.breakAbort = null;
      if (active?.pipeline === 'direct') this.endBreak(active, 'cancelled');
      this.schedule = null;
      this.validItems = [];
      this.directKey = null;
    }
    if (this.pipeline === 'vast') this.stopIma();
    this.pipeline = next;
  }

  private rebuildSchedule(): void {
    if (this.pipeline !== 'direct' || this.kind === null) {
      this.schedule = null;
      return;
    }
    const { valid, rejected } = applyLiveRules(this.validItems, this.kind);
    for (const r of rejected) this.onError(playerError('ad-unsupported', 'ads', { message: `Ad "${r.id}" rejected: ${r.reason}`, details: { adId: r.id } }));
    this.schedule = new CueSchedule(valid, this.history);
  }

  /** Content classification is known (never schedule numeric cues before this). */
  setMediaKind(kind: MediaKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.rebuildSchedule();
  }

  private startIma(vast: VastConfig): void {
    this.stopIma();
    const container = document.createElement('div');
    container.className = 'rsp-ima-container';
    this.host.layer.appendChild(container);
    this.imaContainer = container;
    const ima = new ImaPipeline(
      {
        container,
        contentVideo: this.host.contentVideo,
        nonce: () => this.host.nonce(),
        adWillAutoPlay: () => this.host.autoplayIntended(),
        adWillPlayMuted: () => this.host.contentAudio().muted,
        audio: () => this.host.contentAudio(),
        beginBreak: (placement) => {
          this.imaBreak = this.beginBreak('vast', placement);
        },
        endBreak: (reason) => {
          const info = this.imaBreak;
          this.imaBreak = null;
          this.endBreak(info, reason);
        },
        start: (info) => this.onStart(info),
        progress: (info, t, d, s) => this.onProgress(info, t, d, s),
        skip: (info) => this.onSkip(info),
        complete: (info) => this.onComplete(info),
        click: (info) => this.host.emit('adClick', info),
        error: (error) => this.onError(error),
      },
      vast,
    );
    this.ima = ima;
    void ima.prepare();
    // VAST introduced after content already started: let IMA start now.
    if (this.playStarted) void ima.onPlayIntent();
  }

  private stopIma(): void {
    if (this.imaBreak) {
      const info = this.imaBreak;
      this.imaBreak = null;
      this.endBreak(info, 'cancelled');
    }
    this.ima?.destroy();
    this.ima = null;
    this.imaContainer?.remove();
    this.imaContainer = null;
  }

  /** Synchronous hook for user gestures (IMA requires initialize() inside one). */
  onUserGesture(): void {
    this.ima?.initializeContainer();
  }

  /**
   * First content play intent of the session. Resolves when content may start
   * (after any preroll). Must be called once classification is known.
   */
  async beforeContentPlay(): Promise<void> {
    if (this.destroyed) return;
    this.playStarted = true;
    if (this.prerollHandled) return;
    this.prerollHandled = true;
    if (this.pipeline === 'vast' && this.ima) {
      await this.ima.onPlayIntent();
      return;
    }
    if (this.pipeline === 'direct' && this.schedule) {
      const prerolls = this.schedule.prerolls();
      if (prerolls.length) await this.runLinearBreak('preroll', prerolls);
    }
  }

  /** Periodic tick while content plays (direct pipeline cue evaluation). */
  tick(tick: CueTick): void {
    if (this.pipeline !== 'direct' || !this.schedule || this.breakInfo) return;
    const { linear, overlays } = this.schedule.due(tick);
    for (const ad of overlays) {
      this.schedule.markRun(ad.id);
      this.overlayQueue.push(ad);
    }
    this.pumpOverlays();
    if (linear.length) void this.runLinearBreak('midroll', linear);
  }

  onSeek(mediaTime: number | null): void {
    this.schedule?.markDiscontinuity(mediaTime);
  }

  onLoopRestart(): void {
    if (this.config?.replayOnLoop && this.pipeline === 'direct') this.schedule?.rearmForLoop();
    else this.schedule?.markDiscontinuity(0);
  }

  /** VOD content reached its end: runs postrolls; resolves when content may report `ended`. */
  async onContentEnded(): Promise<void> {
    if (this.destroyed || this.kind === 'live') return;
    if (this.pipeline === 'vast' && this.ima) {
      await this.ima.onContentEnded();
      return;
    }
    if (this.pipeline === 'direct' && this.schedule) {
      const postrolls = this.schedule.postrolls();
      if (postrolls.length) await this.runLinearBreak('postroll', postrolls);
    }
  }

  private pumpOverlays(): void {
    if (this.overlayAbort || this.overlayQueue.length === 0 || this.destroyed) return;
    const ad = this.overlayQueue.shift()!;
    const ctrl = new AbortController();
    this.overlayAbort = ctrl;
    void this.presenter.presentOverlay(ad, ctrl.signal).then((outcome) => {
      this.countOutcome(outcome);
      if (this.overlayAbort === ctrl) this.overlayAbort = null;
      this.pumpOverlays();
    });
  }

  private beginBreak(pipeline: AdPipeline, placement: AdPlacement): AdBreakInfo {
    const info: AdBreakInfo = { breakId: `${pipeline}-${placement}-${++this.breakSeq}`, pipeline, placement };
    this.breakInfo = info;
    this.host.layer.classList.add('rsp-ad-layer-linear');
    this.host.beginLinearBreak(info);
    return info;
  }

  private endBreak(info: AdBreakInfo | null, reason: AdBreakEndInfo['reason']): void {
    if (!info || this.breakInfo !== info) return; // exactly-once restoration per break
    this.breakInfo = null;
    this.host.layer.classList.remove('rsp-ad-layer-linear');
    this.host.adProgressState(null, 0, null, null);
    this.host.endLinearBreak({ ...info, reason });
  }

  private async runLinearBreak(placement: AdPlacement, ads: DirectAd[]): Promise<void> {
    if (this.breakAbort || this.destroyed) return;
    // Mark first: a cue runs at most once per session even if it errors.
    for (const ad of ads) this.schedule?.markRun(ad.id);
    const ctrl = new AbortController();
    this.breakAbort = ctrl;
    const info = this.beginBreak('direct', placement);
    let reason: AdBreakEndInfo['reason'] = 'completed';
    for (const ad of ads) {
      if (ctrl.signal.aborted) break;
      const outcome = await this.presenter.presentLinear(ad, placement, ctrl.signal);
      this.countOutcome(outcome);
      if (outcome === 'skipped') reason = 'skipped';
      else if (outcome === 'error' && reason === 'completed') reason = 'error';
    }
    if (this.breakAbort === ctrl) this.breakAbort = null;
    this.endBreak(info, ctrl.signal.aborted ? 'cancelled' : reason);
  }

  private countOutcome(outcome: AdOutcome): void {
    if (outcome === 'completed') this.stats.completed++;
    else if (outcome === 'skipped') this.stats.skipped++;
  }

  toggleLinearPause(): void {
    if (this.ima?.breakActive) {
      // IMA exposes no paused getter; track via events would be overkill — toggle by intent.
      this.imaPaused = !this.imaPaused;
      if (this.imaPaused) this.ima.pauseAd();
      else this.ima.resumeAd();
      return;
    }
    this.presenter.setLinearPaused(!this.presenter.linearPaused);
  }
  private imaPaused = false;

  setLinearPaused(paused: boolean): void {
    if (this.ima?.breakActive) {
      this.imaPaused = paused;
      if (paused) this.ima.pauseAd();
      else this.ima.resumeAd();
      return;
    }
    this.presenter.setLinearPaused(paused);
  }

  skipLinear(): void {
    this.presenter.skipLinear();
  }

  setAudio(volume: number, muted: boolean): void {
    this.ima?.setAudio(volume, muted);
    for (const v of Array.from(this.host.layer.querySelectorAll('video'))) {
      v.volume = volume;
      v.muted = muted;
    }
  }

  private onStart(info: AdInfo): void {
    this.stats.started++;
    this.imaPaused = false;
    this.host.emit('adStart', info);
  }

  private onProgress(info: AdInfo, currentTime: number, duration: number | null, skippableIn: number | null): void {
    if (info.linear) this.host.adProgressState(info, currentTime, duration, skippableIn);
    this.host.emit('adProgress', { ad: info, currentTime, duration, skippableIn });
  }

  private onSkip(info: AdInfo): void {
    this.host.emit('adSkip', info);
  }

  private onComplete(info: AdInfo): void {
    this.host.emit('adComplete', info);
  }

  private onError(error: PlayerErrorImpl): void {
    this.stats.errors++;
    this.host.emit('adError', error);
  }

  private cancelAll(): void {
    this.overlayQueue = [];
    this.overlayAbort?.abort();
    this.overlayAbort = null;
    const active = this.breakInfo;
    this.breakAbort?.abort();
    this.breakAbort = null;
    this.stopIma();
    if (active) this.endBreak(active, 'cancelled');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelAll();
    this.presenter.destroy();
    this.destroyed = true;
  }
}
