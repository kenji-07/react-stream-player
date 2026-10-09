import { playerError, type PlayerErrorImpl } from '../errors.js';
import type { AdInfo, AdPlacement, VastConfig } from '../types/ads.js';
import type { ImaAd, ImaAdError, ImaAdsLoader, ImaAdsManager, ImaAdDisplayContainer, ImaNamespace } from './ima-types.js';
import { loadImaSdk } from './ima-loader.js';

export interface ImaHost {
  /** Element inside the player's ad layer that IMA renders into. */
  readonly container: HTMLElement;
  /** Content element: read by IMA for ad-rule timing only (no custom playback). */
  readonly contentVideo: HTMLVideoElement;
  nonce(): string | null;
  adWillAutoPlay(): boolean;
  adWillPlayMuted(): boolean;
  audio(): { volume: number; muted: boolean };
  beginBreak(placement: AdPlacement): void;
  endBreak(reason: 'completed' | 'skipped' | 'error' | 'cancelled'): void;
  start(info: AdInfo): void;
  progress(info: AdInfo, currentTime: number, duration: number | null, skippableIn: number | null): void;
  skip(info: AdInfo): void;
  complete(info: AdInfo): void;
  click(info: AdInfo): void;
  error(error: PlayerErrorImpl): void;
}

const NO_FILL = new Set([1009, 303]);
const MALFORMED = new Set([100, 101, 102, 1010]);
const TIMEOUT = new Set([301, 402]);

export function mapImaError(error: ImaAdError | null | undefined): PlayerErrorImpl {
  const code = error?.getErrorCode?.() ?? 900;
  const details = { imaErrorCode: code, imaErrorType: error?.getType?.() ?? 'unknown' };
  if (NO_FILL.has(code)) return playerError('ad-no-fill', 'ads', { details });
  if (TIMEOUT.has(code)) return playerError('ad-load-timeout', 'ads', { details });
  if (MALFORMED.has(code)) return playerError('ad-vast-error', 'ads', { details, message: 'The VAST response was malformed.' });
  if (code === 1013 || code === 1022 || code === 1101) return playerError('ad-invalid-config', 'ads', { details });
  if (code >= 400 && code < 500) return playerError('ad-media-error', 'ads', { details });
  return playerError('ad-vast-error', 'ads', { details });
}

function placementFor(ad: ImaAd | null): AdPlacement {
  if (!ad) return 'preroll';
  if (!ad.isLinear()) return 'overlay';
  const offset = ad.getAdPodInfo?.().getTimeOffset?.() ?? 0;
  if (offset === 0) return 'preroll';
  if (offset < 0) return 'postroll';
  return 'midroll';
}

function infoFor(ad: ImaAd | null): AdInfo {
  const duration = ad?.getDuration?.();
  return {
    id: ad?.getAdId?.() || 'ima-ad',
    pipeline: 'vast',
    type: 'vast',
    placement: placementFor(ad),
    linear: ad ? ad.isLinear() : true,
    duration: typeof duration === 'number' && duration >= 0 ? duration : null,
    label: ad?.getTitle?.() || null,
    imaContentType: ad?.getContentType?.() ?? null,
  };
}

/**
 * Google IMA client-side pipeline. IMA owns VAST/VMAP scheduling, ad
 * duration, click handling, skip eligibility and tracking; this class only
 * bridges lifecycle events to the controller. Failures never fall back to
 * direct ads.
 */
export class ImaPipeline {
  private ima: ImaNamespace | null = null;
  private adc: ImaAdDisplayContainer | null = null;
  private loader: ImaAdsLoader | null = null;
  private manager: ImaAdsManager | null = null;
  private managerReady: Promise<ImaAdsManager | null>;
  private resolveManager!: (m: ImaAdsManager | null) => void;
  private initialized = false;
  private started = false;
  private destroyed = false;
  private inBreak = false;
  private currentAd: AdInfo | null = null;
  private allDone = false;
  private waiters = new Set<() => void>();
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly host: ImaHost,
    private readonly config: VastConfig,
  ) {
    this.managerReady = new Promise((resolve) => (this.resolveManager = resolve));
  }

  /** Loads the SDK and requests ads. Never throws; failures are reported via `host.error`. */
  async prepare(): Promise<void> {
    try {
      this.ima = await loadImaSdk({ debug: this.config.debugSdk, nonce: this.host.nonce(), timeoutMs: this.config.sdkLoadTimeoutMs ?? 10_000 });
    } catch (error) {
      if (this.destroyed) return;
      this.fail(playerError('ad-sdk-load-failed', 'ads', { cause: error }));
      return;
    }
    if (this.destroyed) return;
    const ima = this.ima;
    try {
      this.adc = new ima.AdDisplayContainer(this.host.container);
      this.loader = new ima.AdsLoader(this.adc);
      this.loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => this.onManagerLoaded(event), false);
      this.loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (event) => this.fail(mapImaError(event.getError())), false);
      const request = new ima.AdsRequest();
      request.adTagUrl = this.config.adTagUrl;
      const { width, height } = this.size();
      request.linearAdSlotWidth = width;
      request.linearAdSlotHeight = height;
      request.nonLinearAdSlotWidth = width;
      request.nonLinearAdSlotHeight = Math.round(height / 3);
      if (this.config.requestTimeoutMs !== undefined) request.vastLoadTimeout = this.config.requestTimeoutMs;
      request.setAdWillAutoPlay(this.host.adWillAutoPlay());
      request.setAdWillPlayMuted(this.host.adWillPlayMuted());
      this.loader.requestAds(request);
    } catch (error) {
      this.fail(playerError('ad-vast-error', 'ads', { cause: error }));
    }
  }

  private size(): { width: number; height: number } {
    const rect = this.host.container.getBoundingClientRect();
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  private onManagerLoaded(event: { getAdsManager(contentPlayback: object, settings?: object): ImaAdsManager }): void {
    if (this.destroyed || !this.ima) return;
    const ima = this.ima;
    const settings = new ima.AdsRenderingSettings();
    settings.restoreCustomPlaybackStateOnAdBreakComplete = false;
    if (this.config.loadVideoTimeoutMs !== undefined) settings.loadVideoTimeout = this.config.loadVideoTimeoutMs;
    if (this.config.mimeTypes) settings.mimeTypes = [...this.config.mimeTypes];
    let manager: ImaAdsManager;
    try {
      manager = event.getAdsManager(this.host.contentVideo, settings);
    } catch (error) {
      this.fail(playerError('ad-vast-error', 'ads', { cause: error }));
      return;
    }
    this.manager = manager;
    const T = ima.AdEvent.Type;
    manager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (e) => {
      this.host.error(mapImaError(e.getError()));
      if (this.inBreak) this.finishBreak('error');
      this.notify();
    });
    manager.addEventListener(T.CONTENT_PAUSE_REQUESTED, (e) => {
      this.inBreak = true;
      this.host.beginBreak(placementFor(e.getAd()));
      this.notify();
    });
    manager.addEventListener(T.CONTENT_RESUME_REQUESTED, () => this.finishBreak('completed'));
    manager.addEventListener(T.ALL_ADS_COMPLETED, () => {
      this.allDone = true;
      if (this.inBreak) this.finishBreak('completed');
      this.notify();
    });
    manager.addEventListener(T.STARTED, (e) => {
      this.currentAd = infoFor(e.getAd());
      const audio = this.host.audio();
      manager.setVolume(audio.muted ? 0 : audio.volume);
      this.host.start(this.currentAd);
      this.notify();
    });
    manager.addEventListener(T.AD_PROGRESS, (e) => {
      const data = e.getAdData() as { currentTime?: number; duration?: number } | null;
      const ad = this.currentAd ?? infoFor(e.getAd());
      const skipOffset = e.getAd()?.getSkipTimeOffset?.() ?? -1;
      const current = data?.currentTime ?? 0;
      this.host.progress(ad, current, data?.duration ?? ad.duration, skipOffset < 0 ? null : Math.max(0, skipOffset - current));
    });
    manager.addEventListener(T.COMPLETE, (e) => this.host.complete(this.currentAd ?? infoFor(e.getAd())));
    manager.addEventListener(T.SKIPPED, (e) => this.host.skip(this.currentAd ?? infoFor(e.getAd())));
    manager.addEventListener(T.CLICK, (e) => this.host.click(this.currentAd ?? infoFor(e.getAd())));
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        const { width, height } = this.size();
        try {
          this.manager?.resize(width, height);
        } catch {
          /* resize before init is ignored */
        }
      });
      this.resizeObserver.observe(this.host.container);
    }
    this.resolveManager(manager);
  }

  private fail(error: PlayerErrorImpl): void {
    this.host.error(error);
    this.allDone = true;
    this.resolveManager(null);
    if (this.inBreak) this.finishBreak('error');
    this.notify();
  }

  private finishBreak(reason: 'completed' | 'skipped' | 'error' | 'cancelled'): void {
    if (!this.inBreak) return;
    this.inBreak = false;
    this.currentAd = null;
    this.host.endBreak(reason);
    this.notify();
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }

  private waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (predicate() || this.destroyed) done();
      };
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(check);
    });
  }

  /** Must run synchronously inside a user gesture on mobile (IMA requirement). Idempotent. */
  initializeContainer(): void {
    if (this.initialized || !this.adc) return;
    this.initialized = true;
    try {
      this.adc.initialize();
    } catch {
      /* initialize() is best-effort; playback still proceeds */
    }
  }

  get breakActive(): boolean {
    return this.inBreak;
  }

  /**
   * Called on the first content play intent. Resolves once IMA has either
   * started a preroll break (content stays paused until it ends) or decided
   * there is none. Never hangs: bounded by the request/load timeouts.
   */
  async onPlayIntent(): Promise<void> {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.initializeContainer();
    const managerTimeout = (this.config.requestTimeoutMs ?? 5000) + (this.config.sdkLoadTimeoutMs ?? 10_000);
    const manager = await Promise.race([this.managerReady, new Promise<null>((r) => setTimeout(() => r(null), managerTimeout))]);
    if (!manager || this.destroyed) return;
    const { width, height } = this.size();
    try {
      manager.init(width, height);
      manager.start();
    } catch (error) {
      this.fail(playerError('ad-vast-error', 'ads', { cause: error }));
      return;
    }
    const cues = safeCuePoints(manager);
    const prerollExpected = cues.length === 0 || cues.includes(0);
    if (!prerollExpected) return;
    // Wait for the preroll break to begin (content stays paused) or for IMA to finish/fail.
    await this.waitFor(() => this.inBreak || this.allDone || this.currentAd !== null, (this.config.loadVideoTimeoutMs ?? 8000) + 2000);
    if (this.inBreak) await this.waitFor(() => !this.inBreak, 10 * 60 * 1000);
  }

  /** VOD content ended: lets IMA play a postroll; resolves when done. */
  async onContentEnded(): Promise<void> {
    if (!this.loader || this.destroyed) return;
    try {
      this.loader.contentComplete();
    } catch {
      return;
    }
    const manager = this.manager;
    if (!manager || !safeCuePoints(manager).includes(-1)) return;
    await this.waitFor(() => this.inBreak || this.allDone, 3000);
    if (this.inBreak) await this.waitFor(() => !this.inBreak, 10 * 60 * 1000);
  }

  setAudio(volume: number, muted: boolean): void {
    try {
      this.manager?.setVolume(muted ? 0 : volume);
    } catch {
      /* ignore */
    }
  }

  pauseAd(): void {
    this.manager?.pause();
  }

  resumeAd(): void {
    this.manager?.resume();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.inBreak = false;
    try {
      this.manager?.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.loader?.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.adc?.destroy();
    } catch {
      /* ignore */
    }
    this.manager = null;
    this.loader = null;
    this.adc = null;
    this.resolveManager(null);
    this.notify();
    this.waiters.clear();
  }
}

function safeCuePoints(manager: ImaAdsManager): number[] {
  try {
    return manager.getCuePoints() ?? [];
  } catch {
    return [];
  }
}
