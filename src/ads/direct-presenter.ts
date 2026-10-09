import { normalizeSource, type NormalizedSource } from '../controller/source.js';
import type { MediaEngine } from '../engines/engine.js';
import { playerError, type PlayerErrorImpl } from '../errors.js';
import type { BlobRegistry } from '../resources/blob-registry.js';
import { validateClickThroughUrl, type ClickThroughPolicy } from '../security/url.js';
import type { AdInfo, AdPlacement, DirectAd } from '../types/ads.js';
import { format, type Translations } from '../ui/i18n.js';
import { now } from '../utils/env.js';

export type AdOutcome = 'completed' | 'skipped' | 'error' | 'cancelled';

export interface PresenterHost {
  readonly layer: HTMLElement;
  readonly blobs: BlobRegistry;
  t(): Translations;
  clickPolicy(): ClickThroughPolicy;
  loadTimeoutMs(): number;
  /** Seconds of active content playback (overlay clock). */
  sessionSeconds(): number;
  contentAudio(): { volume: number; muted: boolean };
  createEngine(video: HTMLVideoElement, source: NormalizedSource): MediaEngine;
  start(info: AdInfo): void;
  progress(info: AdInfo, currentTime: number, duration: number | null, skippableIn: number | null): void;
  skip(info: AdInfo): void;
  complete(info: AdInfo): void;
  click(info: AdInfo): void;
  error(info: AdInfo, error: PlayerErrorImpl): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function adInfo(ad: DirectAd, placement: AdPlacement, duration: number | null): AdInfo {
  return {
    id: ad.id,
    pipeline: 'direct',
    type: ad.type,
    placement,
    linear: placement !== 'overlay',
    duration,
    label: ad.label ?? null,
  };
}

interface ActiveLinear {
  info: AdInfo;
  paused: boolean;
  setPaused(paused: boolean): void;
  skip(): void;
}

/**
 * Presents first-party text/image/video creatives. Linear creatives pause
 * content (handled by the AdsManager); overlays run alongside content. Clocks
 * never depend on CSS animations. All text is inserted with `textContent`.
 */
export class DirectAdPresenter {
  private activeLinear: ActiveLinear | null = null;

  constructor(private readonly host: PresenterHost) {}

  get linearActive(): AdInfo | null {
    return this.activeLinear?.info ?? null;
  }

  get linearPaused(): boolean {
    return this.activeLinear?.paused ?? false;
  }

  setLinearPaused(paused: boolean): void {
    this.activeLinear?.setPaused(paused);
  }

  skipLinear(): void {
    this.activeLinear?.skip();
  }

  /** Shared chrome: badge/countdown, pause toggle, learn-more link, skip/close. */
  private buildChrome(ad: DirectAd, info: AdInfo, opts: { linear: boolean; pausable: boolean }) {
    const t = this.host.t();
    const bar = el('div', 'rsp-ad-bar');
    const badge = el('span', 'rsp-ad-badge', ad.label ? `${t.advertisement}: ${ad.label}` : t.advertisement);
    bar.appendChild(badge);
    let toggle: HTMLButtonElement | null = null;
    if (opts.pausable) {
      toggle = el('button', 'rsp-ad-button rsp-ad-toggle', t.pauseAd);
      toggle.type = 'button';
      bar.appendChild(toggle);
    }
    const href = validateClickThroughUrl(ad.clickThroughUrl, this.host.clickPolicy());
    let link: HTMLAnchorElement | null = null;
    if (href) {
      link = el('a', 'rsp-ad-button rsp-ad-link', t.learnMore);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer sponsored';
      link.addEventListener('click', () => this.host.click(info));
      bar.appendChild(link);
    }
    let skip: HTMLButtonElement | null = null;
    if (ad.skipAfter !== undefined) {
      skip = el('button', 'rsp-ad-button rsp-ad-skip', '');
      skip.type = 'button';
      skip.disabled = true;
      bar.appendChild(skip);
    }
    const live = el('div', 'rsp-visually-hidden');
    live.setAttribute('aria-live', 'polite');
    const setSkip = (remaining: number | null) => {
      if (!skip) return;
      if (remaining === null || remaining > 0) {
        skip.disabled = true;
        skip.textContent = format(t.skipAdIn, { seconds: Math.ceil(remaining ?? 0) });
      } else {
        if (skip.disabled) live.textContent = opts.linear ? t.skipAd : t.closeAd;
        skip.disabled = false;
        skip.textContent = opts.linear ? t.skipAd : t.closeAd;
      }
    };
    const setCountdown = (remaining: number | null) => {
      if (opts.linear && remaining !== null) badge.textContent = format(t.adCountdown, { seconds: Math.max(0, Math.ceil(remaining)) });
    };
    const setPausedLabel = (paused: boolean) => {
      if (toggle) {
        toggle.textContent = paused ? t.resumeAd : t.pauseAd;
        toggle.setAttribute('aria-pressed', String(paused));
      }
    };
    return { bar, toggle, skip, live, link, setSkip, setCountdown, setPausedLabel };
  }

  private loadImage(ad: Extract<DirectAd, { type: 'image' }>, signal: AbortSignal): Promise<HTMLImageElement> {
    const img = el('img', 'rsp-ad-image');
    img.alt = ad.alt;
    img.decoding = 'async';
    img.referrerPolicy = 'strict-origin-when-cross-origin';
    const src = typeof ad.src === 'string' ? ad.src : this.host.blobs.acquire(ad.src, `ad:${ad.id}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(() => reject(playerError('ad-load-timeout', 'ads'))), this.host.loadTimeoutMs());
      const onAbort = () => done(() => reject(playerError('operation-aborted', 'state')));
      const done = (fn: () => void) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        img.onload = null;
        img.onerror = null;
        fn();
      };
      img.onload = () => done(() => resolve(img));
      img.onerror = () => done(() => reject(playerError('ad-load-error', 'ads')));
      signal.addEventListener('abort', onAbort);
      img.src = src;
    });
  }

  private releaseAssets(ad: DirectAd): void {
    if (ad.type === 'image' && typeof ad.src !== 'string') this.host.blobs.release(ad.src, `ad:${ad.id}`);
  }

  /** Linear creative (content is paused by the caller). */
  async presentLinear(ad: DirectAd, placement: AdPlacement, signal: AbortSignal): Promise<AdOutcome> {
    if (ad.type === 'video') return this.presentVideo(ad, placement, signal);
    return this.presentTimed(ad, placement, signal, true);
  }

  /** Overlay creative shown over playing content; its clock is the content session clock. */
  presentOverlay(ad: DirectAd, signal: AbortSignal): Promise<AdOutcome> {
    return this.presentTimed(ad, 'overlay', signal, false);
  }

  private async presentTimed(ad: DirectAd, placement: AdPlacement, signal: AbortSignal, linear: boolean): Promise<AdOutcome> {
    if (ad.type === 'video') return 'error';
    const duration = ad.duration;
    const info = adInfo(ad, placement, duration);
    const container = el('div', `rsp-ad ${linear ? 'rsp-ad-linear' : 'rsp-ad-overlay'} rsp-ad-${ad.type}`);
    container.setAttribute('role', linear ? 'region' : 'complementary');
    container.setAttribute('aria-label', this.host.t().advertisement);
    const media = el('div', 'rsp-ad-media');
    try {
      if (ad.type === 'image') {
        media.appendChild(await this.loadImage(ad, signal));
      } else {
        const text = el('div', 'rsp-ad-text', ad.text);
        if (ad.style?.color) text.style.color = ad.style.color;
        if (ad.style?.backgroundColor) text.style.backgroundColor = ad.style.backgroundColor;
        if (ad.style?.fontSize) text.style.fontSize = ad.style.fontSize;
        media.appendChild(text);
      }
    } catch (error) {
      this.releaseAssets(ad);
      if (signal.aborted) return 'cancelled';
      this.host.error(info, error as PlayerErrorImpl);
      return 'error';
    }
    if (signal.aborted) {
      this.releaseAssets(ad);
      return 'cancelled';
    }
    const chrome = this.buildChrome(ad, info, { linear, pausable: linear });
    container.append(media, chrome.bar, chrome.live);
    this.host.layer.appendChild(container);
    requestAnimationFrame(() => container.classList.add('rsp-ad-visible'));
    chrome.live.textContent = this.host.t().advertisement;
    this.host.start(info);

    return new Promise<AdOutcome>((resolve) => {
      let elapsed = 0;
      let paused = false;
      let last = now();
      const sessionStart = this.host.sessionSeconds();
      let finished = false;
      const tick = () => {
        const current = now();
        if (linear) {
          // Active presentation clock: pauses when the viewer pauses the ad or the page is hidden.
          if (!paused && !document.hidden) elapsed += (current - last) / 1000;
        } else {
          elapsed = this.host.sessionSeconds() - sessionStart;
        }
        last = current;
        const remaining = Math.max(0, duration - elapsed);
        const skippableIn = ad.skipAfter === undefined ? null : Math.max(0, ad.skipAfter - elapsed);
        chrome.setCountdown(remaining);
        chrome.setSkip(skippableIn);
        this.host.progress(info, Math.min(elapsed, duration), duration, skippableIn);
        if (elapsed >= duration) finish('completed');
      };
      const timer = setInterval(tick, 250);
      const finish = (outcome: AdOutcome) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        signal.removeEventListener('abort', onAbort);
        if (linear && this.activeLinear?.info === info) this.activeLinear = null;
        container.remove();
        this.releaseAssets(ad);
        if (outcome === 'completed') this.host.complete(info);
        else if (outcome === 'skipped') this.host.skip(info);
        resolve(outcome);
      };
      const onAbort = () => finish('cancelled');
      signal.addEventListener('abort', onAbort);
      const setPaused = (value: boolean) => {
        paused = value;
        chrome.setPausedLabel(value);
      };
      chrome.toggle?.addEventListener('click', () => setPaused(!paused));
      chrome.skip?.addEventListener('click', () => {
        if (chrome.skip && !chrome.skip.disabled) finish('skipped');
      });
      if (linear) {
        this.activeLinear = {
          info,
          get paused() {
            return paused;
          },
          setPaused,
          skip: () => {
            if (chrome.skip && !chrome.skip.disabled) finish('skipped');
          },
        };
      }
      tick();
    });
  }

  private async presentVideo(ad: Extract<DirectAd, { type: 'video' }>, placement: AdPlacement, signal: AbortSignal): Promise<AdOutcome> {
    const info = adInfo(ad, placement, null);
    const normalized = normalizeSource(ad.source);
    if (!normalized.ok) {
      this.host.error(info, playerError('ad-invalid-config', 'ads', { cause: normalized.error }));
      return 'error';
    }
    const source = normalized.source;
    const input = source.type === 'mp4' ? source.variants[0]?.input : source.input;
    if (input === undefined || input === null) {
      this.host.error(info, playerError('ad-invalid-config', 'ads'));
      return 'error';
    }
    const container = el('div', 'rsp-ad rsp-ad-linear rsp-ad-video');
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', this.host.t().advertisement);
    const video = el('video', 'rsp-ad-media-video');
    video.playsInline = true;
    video.preload = 'auto';
    const audio = this.host.contentAudio();
    video.volume = audio.volume;
    video.muted = audio.muted;
    const chrome = this.buildChrome(ad, info, { linear: true, pausable: true });
    container.append(video, chrome.bar, chrome.live);
    this.host.layer.appendChild(container);
    const engine = this.host.createEngine(video, source);
    const consumer = `ad:${ad.id}`;
    const url = typeof input === 'string' ? input : this.host.blobs.acquire(input, consumer);
    const loadController = new AbortController();
    const abortLoad = () => loadController.abort();
    signal.addEventListener('abort', abortLoad);
    const teardown = async () => {
      signal.removeEventListener('abort', abortLoad);
      if (this.activeLinear?.info === info) this.activeLinear = null;
      // Stop and hide synchronously so no direct creative outlives its break.
      video.pause();
      container.remove();
      await engine.destroy().catch(() => undefined);
      // Release the Blob only after the consumer element is detached.
      if (typeof input !== 'string') this.host.blobs.release(input, consumer);
    };
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        engine.load({ loadId: 0, url, mimeType: source.mimeType, type: source.type, startTime: null, preferredAudioLanguage: null }, loadController.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            loadController.abort();
            reject(playerError('ad-load-timeout', 'ads'));
          }, this.host.loadTimeoutMs());
        }),
      ]).finally(() => clearTimeout(timeout));
    } catch (error) {
      await teardown();
      if (signal.aborted) return 'cancelled';
      const e = error as PlayerErrorImpl;
      this.host.error(info, e.code === 'ad-load-timeout' ? e : playerError('ad-load-error', 'ads', { cause: error }));
      return 'error';
    }
    if (signal.aborted) {
      await teardown();
      return 'cancelled';
    }
    const durationNow = () => (Number.isFinite(video.duration) ? video.duration : null);
    info.duration = durationNow();
    requestAnimationFrame(() => container.classList.add('rsp-ad-visible'));
    chrome.live.textContent = this.host.t().advertisement;

    return new Promise<AdOutcome>((resolve) => {
      let finished = false;
      let started = false;
      const finish = async (outcome: AdOutcome, error?: PlayerErrorImpl) => {
        if (finished) return;
        finished = true;
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('pause', onPauseState);
        signal.removeEventListener('abort', onAbort);
        await teardown();
        if (outcome === 'completed') this.host.complete(info);
        else if (outcome === 'skipped') this.host.skip(info);
        else if (outcome === 'error' && error) this.host.error(info, error);
        resolve(outcome);
      };
      const update = () => {
        const duration = durationNow();
        info.duration = duration;
        const t = video.currentTime;
        const skippableIn = ad.skipAfter === undefined ? null : Math.max(0, ad.skipAfter - t);
        chrome.setCountdown(duration === null ? null : duration - t);
        chrome.setSkip(skippableIn);
        this.host.progress(info, t, duration, skippableIn);
      };
      const onTime = () => update();
      const onEnded = () => void finish('completed');
      const onError = () => void finish('error', playerError('ad-media-error', 'ads'));
      const onPlaying = () => {
        if (!started) {
          started = true;
          this.host.start(info);
        }
        chrome.setPausedLabel(false);
      };
      const onPauseState = () => chrome.setPausedLabel(true);
      const onAbort = () => void finish('cancelled');
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('pause', onPauseState);
      signal.addEventListener('abort', onAbort);
      const setPaused = (paused: boolean) => {
        if (paused) video.pause();
        else void video.play().catch(() => chrome.setPausedLabel(true));
      };
      chrome.toggle?.addEventListener('click', () => setPaused(!video.paused));
      chrome.skip?.addEventListener('click', () => {
        if (chrome.skip && !chrome.skip.disabled) void finish('skipped');
      });
      chrome.link?.addEventListener('click', () => video.pause());
      this.activeLinear = {
        info,
        get paused() {
          return video.paused;
        },
        setPaused,
        skip: () => {
          if (chrome.skip && !chrome.skip.disabled) void finish('skipped');
        },
      };
      update();
      // Autoplay policy: retry muted, otherwise wait for the viewer to press "Resume ad".
      video.play().catch(() => {
        if (finished) return;
        video.muted = true;
        video.play().catch(() => chrome.setPausedLabel(true));
      });
    });
  }

  destroy(): void {
    this.activeLinear = null;
  }
}
