import { AdsManager } from '../ads/ads-manager.js';
import { CastManager } from '../cast/cast-manager.js';
import type { EngineLoadRequest, MediaEngine } from '../engines/engine.js';
import { NativeVideoEngine } from '../engines/native-engine.js';
import { buildShakaConfig } from '../engines/shaka-config.js';
import { ShakaEngine } from '../engines/shaka-engine.js';
import { isPlayerError, playerError, PlayerErrorImpl } from '../errors.js';
import { FullscreenManager } from '../fullscreen/fullscreen-manager.js';
import { HotkeyManager } from '../hotkeys/hotkey-manager.js';
import { MediaSessionManager, mediaSessionSupported } from '../media-session/media-session-manager.js';
import { BlobRegistry } from '../resources/blob-registry.js';
import { captureVideoFrame } from '../resources/capture-frame.js';
import { normalizeCredentialRules, type NormalizedCredentialRule } from '../security/credentials.js';
import { redactValue } from '../security/redact.js';
import { SubtitleManager } from '../subtitles/subtitle-manager.js';
import type { AdBreakEndInfo, AdBreakInfo, AdInfo } from '../types/ads.js';
import type { FullscreenMode, HotkeyAction } from '../types/config.js';
import type { EventContext, PlayerEventCallbacks, PlayerEventListener, PlayerEventMap, PlayerEventName } from '../types/events.js';
import type { PlayerOptions } from '../types/options.js';
import type { FullscreenController, PlayerRef } from '../types/ref.js';
import type { CapabilityStatus, LiveState, PlayerCapabilities, PlayerState, PlayerStats, PlayerStatus, TimeRange } from '../types/state.js';
import type { AudioTrack, QualitySelection, QualityTrack, SubtitleTrackInfo } from '../types/tracks.js';
import { ArtplayerAdapter } from '../ui/artplayer-adapter.js';
import { format, languageName, resolveTranslations, type Translations } from '../ui/i18n.js';
import { PlayerLayers } from '../ui/layers.js';
import { NativeUiAdapter } from '../ui/native-ui.js';
import type { MenuModel, UiActions, UiAdapter, UiConfig } from '../ui/ui-adapter.js';
import { TypedEmitter, reportListenerError } from '../utils/emitter.js';
import { canSetVolume, now, prefersReducedMotion } from '../utils/env.js';
import { clamp, hashString, semanticEqual } from '../utils/equal.js';
import { resolveOptions, type OptionIssue, type ResolvedOptions } from './options.js';
import { SessionClock } from './session-clock.js';
import { engineMimeType, normalizeSource, type NormalizedSource, type NormalizedVariant } from './source.js';

const NATIVE_PLAY = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype.play : undefined;
const NATIVE_PAUSE = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype.pause : undefined;

interface ContentSession {
  id: string;
  contentKey: string;
  transportKey: string;
  source: NormalizedSource;
  clock: SessionClock;
  /** First content play intent handled (preroll decided). */
  contentStarted: boolean;
  kind: 'vod' | 'live' | null;
  /** Content reached its end; `ended` was emitted (after postrolls). */
  ended: boolean;
  endingInProgress: boolean;
  /** Content blob currently attached (released after replacement). */
  attachedBlob: Blob | null;
  autoRetries: number;
}

interface BreakSnapshot {
  info: AdBreakInfo;
  sessionId: string;
  wasAtLiveEdge: boolean;
  position: number;
}

type PlayOrigin = 'api' | 'element' | 'ui' | 'hotkey' | 'media-session' | 'autoplay' | 'restore';

function capability(supported: boolean, reason: string): CapabilityStatus {
  return supported ? { supported: true } : { supported: false, reason };
}

function rangesOf(ranges: TimeRanges | null | undefined): TimeRange[] {
  const out: TimeRange[] = [];
  if (!ranges) return out;
  for (let i = 0; i < ranges.length; i++) out.push({ start: ranges.start(i), end: ranges.end(i) });
  return out;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Framework-independent player controller: one normalized state store, one
 * typed event stream, and ownership of every engine, UI adapter, manager,
 * listener, timer and object URL it creates.
 */
export class PlayerController {
  readonly video: HTMLVideoElement;
  private readonly stage: HTMLElement;
  private readonly emitter = new TypedEmitter<PlayerEventMap, EventContext>();
  private readonly blobs = new BlobRegistry();
  private opts: ResolvedOptions;
  private rawOptions: PlayerOptions;
  private t: Translations;
  private credentialRules: NormalizedCredentialRule[] = [];
  private state: PlayerState;

  private ui: UiAdapter | null = null;
  private uiPromise: Promise<void> | null = null;
  private layers: PlayerLayers | null = null;
  private subtitles: SubtitleManager | null = null;
  private fullscreen: FullscreenManager | null = null;
  private hotkeys: HotkeyManager;
  private mediaSession: MediaSessionManager;
  private ads: AdsManager | null = null;
  private cast: CastManager | null = null;

  private engine: MediaEngine | null = null;
  private engineUnsubs: Array<() => void> = [];
  private session: ContentSession | null = null;
  private sessionSeq = 0;
  private loadId = 0;
  private loadAbort: AbortController | null = null;
  private currentVariantId: string | null = null;
  private qualitySwitchGen = 0;
  /** Position a transport switch is restoring to; reused by overlapping switches (last wins). */
  private inFlightPosition: number | null = null;
  private breakSnapshot: BreakSnapshot | null = null;
  /** Non-initial transport load in progress: element play/pause/seek events it causes are not re-emitted. */
  private transportSwitching = false;

  private lastKnownVolume: number;
  private lastKnownMuted: boolean;
  private lastKnownRate: number;
  private lastNonZeroVolume: number;
  private reconcileFrame: number | null = null;
  private seekingFlag = false;
  private engineBuffering = false;
  private elementWaiting = false;
  private bufferingTimer: ReturnType<typeof setTimeout> | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private cueTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLiveEmit: LiveState | null = null;
  private lastMediaTime = 0;
  private pausedForHidden = false;
  private destroyPromise: Promise<void> | null = null;
  private destroyed = false;
  private readonly elementListeners: Array<[EventTarget, string, EventListener]> = [];
  private readonly reducedMotionQuery: MediaQueryList | null;

  constructor(
    private readonly root: HTMLElement,
    options: PlayerOptions,
    private readonly callbacks: () => PlayerEventCallbacks = () => ({}),
    /** Optional external emitter (e.g. the React ref facade) that also receives every event. */
    private readonly sink: TypedEmitter<PlayerEventMap, EventContext> | null = null,
  ) {
    this.rawOptions = options;
    const { resolved, issues } = resolveOptions(options);
    this.opts = resolved;
    this.t = resolveTranslations(resolved.locale, resolved.translations);
    this.credentialRules = this.computeCredentialRules();

    root.classList.add('rsp-root');
    if (!root.hasAttribute('tabindex')) root.tabIndex = 0;
    root.setAttribute('role', 'region');
    this.stage = document.createElement('div');
    this.stage.className = 'rsp-stage';
    root.appendChild(this.stage);

    const video = document.createElement('video');
    video.className = 'rsp-video';
    video.playsInline = resolved.playsInline;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = resolved.preload;
    this.video = video;
    this.applyCrossOrigin();
    // Initial audio state: controlled value, else the documented default (0.7) —
    // never a vendor-cached value.
    const volume = resolved.volume ?? resolved.defaultVolume;
    const muted = resolved.muted ?? resolved.defaultMuted;
    const rate = this.clampRate(resolved.playbackRate ?? resolved.defaultPlaybackRate);
    video.volume = volume;
    video.muted = muted;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    this.lastKnownVolume = volume;
    this.lastKnownMuted = muted;
    this.lastKnownRate = rate;
    this.lastNonZeroVolume = volume > 0 ? volume : 0.7;
    this.installIntentRouting();

    this.state = this.initialState();
    this.reducedMotionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.applyRootPresentation();
    this.applyVideoPresentation();

    this.hotkeys = new HotkeyManager(root, () => ({ enabled: this.opts.hotkeys.enabled, bindings: this.opts.hotkeys.bindings }), (action, event) => this.onHotkey(action, event));
    this.mediaSession = new MediaSessionManager({
      play: () => void this.requestPlay('media-session').catch(() => undefined),
      pause: () => this.requestPause('media-session'),
      seekBy: (d) => void this.seekBy(d).catch(() => undefined),
      seekTo: (t) => void this.seekTo(t).catch(() => undefined),
      canSeek: () => !this.linearAdActive() && this.state.status === 'ready',
      seekStep: () => this.opts.seekStep,
    });
    this.mediaSession.configure(this.opts.mediaSession);
    this.installVideoListeners();
    this.installPageListeners();
    this.reportIssues(issues);
    this.uiPromise = this.buildUi().catch((error) => {
      if (!this.destroyed) this.fail(playerError('unexpected-error', 'unexpected', { fatal: true, cause: error, message: 'The player UI could not be initialised.' }));
    });
  }

  // ------------------------------------------------------------------ setup

  private initialState(): PlayerState {
    const o = this.opts;
    return {
      status: 'idle',
      contentSessionId: null,
      loadId: null,
      sourceType: null,
      engine: null,
      ui: o.ui,
      layout: o.layout,
      fit: o.fit,
      intendedPlaying: false,
      paused: true,
      ended: false,
      buffering: false,
      seeking: false,
      currentTime: 0,
      duration: null,
      buffered: [],
      seekable: [],
      volume: this.video.volume,
      muted: this.video.muted,
      playbackRate: this.video.playbackRate,
      playbackRates: [...o.playbackRates],
      quality: { selected: null, effective: null, available: [], autoAvailable: false },
      audio: { selected: null, available: [] },
      subtitles: { selected: null, available: [] },
      live: { isLive: false, atLiveEdge: false, seekableRange: null, behindLiveEdge: null, latency: null, targetLatency: null },
      fullscreen: { active: false, mode: null, videoOnly: false },
      pictureInPicture: false,
      ad: { active: false, pipeline: null, ad: null, currentTime: 0, duration: null, skippableIn: null },
      cast: { status: 'unavailable', deviceName: null },
      airplay: { available: false, active: false },
      error: null,
    };
  }

  private computeCredentialRules(): NormalizedCredentialRule[] {
    const { rules, errors } = normalizeCredentialRules(this.opts.network.credentials);
    for (const message of errors) this.reportIssues([{ path: 'network.credentials', message }]);
    return rules;
  }

  private applyCrossOrigin(): void {
    const mode = this.opts.network.crossOrigin;
    if (mode === undefined || mode === null) this.video.removeAttribute('crossorigin');
    else this.video.crossOrigin = mode;
  }

  private applyRootPresentation(): void {
    const root = this.root;
    const o = this.opts;
    root.dataset.layout = o.layout;
    root.dataset.ui = o.ui;
    root.setAttribute('aria-label', o.title ?? this.t.player);
    const style = root.style;
    style.setProperty('--rsp-aspect-ratio', o.aspectRatio);
    style.setProperty('--rsp-subtitle-font-size', o.subtitleStyle.fontSize);
    style.setProperty('--rsp-subtitle-bottom', o.subtitleStyle.bottom);
    style.setProperty('--rsp-subtitle-color', o.subtitleStyle.color);
    style.setProperty('--rsp-subtitle-background', o.subtitleStyle.backgroundColor);
    if (o.subtitleStyle.fontFamily) style.setProperty('--rsp-subtitle-font-family', o.subtitleStyle.fontFamily);
    else style.removeProperty('--rsp-subtitle-font-family');
    const reduced = !o.motion.enabled || o.motion.reducedMotion === 'always' || (o.motion.reducedMotion === 'system' && (this.reducedMotionQuery?.matches ?? prefersReducedMotion()));
    root.dataset.rspMotion = reduced ? 'reduced' : 'full';
    style.setProperty('--rsp-motion-duration', `${reduced ? 0 : o.motion.durationMs}ms`);
    style.setProperty('--rsp-motion-easing', o.motion.easing);
  }

  /** `fit`/`objectPosition` apply to the actual <video>, never the container; no reload. */
  private applyVideoPresentation(): void {
    this.video.style.objectFit = this.opts.fit;
    this.video.style.objectPosition = this.opts.objectPosition;
    this.video.loop = this.opts.loop;
    this.video.preload = this.opts.preload;
    this.video.playsInline = this.opts.playsInline;
    this.video.disablePictureInPicture = !this.opts.pictureInPicture;
  }

  private uiConfig(): UiConfig {
    const o = this.opts;
    return {
      translations: this.t,
      locale: o.locale,
      poster: o.poster,
      contextMenu: o.contextMenu,
      playbackRates: o.playbackRates,
      fullscreenMode: o.fullscreen.mode,
      pictureInPicture: o.pictureInPicture,
      airplay: o.airplay,
      preventClickToggle: o.preventClickToggle,
      loop: o.loop,
      seekStep: o.seekStep,
    };
  }

  private uiActions(): UiActions {
    return {
      togglePlay: () => this.togglePlay('ui'),
      selectQuality: (id) => void this.requestQuality(id).catch(() => undefined),
      selectAudio: (id) => void this.requestAudio(id).catch(() => undefined),
      selectSubtitle: (id) => void this.requestSubtitle(id).catch(() => undefined),
      selectRate: (rate) => this.setPlaybackRate(rate),
      toggleFullscreen: () => void this.fullscreenApi.toggle(this.opts.fullscreen.mode).catch((e) => this.reportNonFatal(e)),
      seekBy: (d) => void this.seekBy(d).catch(() => undefined),
      seekToLive: () => void this.seekToLive().catch(() => undefined),
      toggleLoop: () => {
        this.opts = { ...this.opts, loop: !this.opts.loop };
        this.applyVideoPresentation();
        this.ui?.configure(this.uiConfig());
      },
      toggleCaptions: () => this.toggleCaptions(),
      copyDiagnostics: () => void this.copyDiagnostics(),
      userGesture: () => this.ads?.onUserGesture(),
    };
  }

  private async buildUi(): Promise<void> {
    const kind = this.opts.ui;
    let ui: UiAdapter;
    if (kind === 'artplayer') {
      ui = await ArtplayerAdapter.create({ container: this.stage, video: this.video, config: this.uiConfig(), actions: this.uiActions(), preload: this.opts.preload });
    } else {
      ui = new NativeUiAdapter(this.stage, this.video, this.uiConfig());
    }
    if (this.destroyed) {
      ui.destroy();
      return;
    }
    // A `ui` change while the previous adapter was being built: rebuild.
    if (kind !== this.opts.ui) {
      ui.destroy();
      return this.buildUi();
    }
    this.ui = ui;
    if (this.layers) {
      // UI rebuild: move the existing layers (captions, ads, status) unchanged.
      ui.layerHost.append(this.layers.text, this.layers.watermark, this.layers.ads, this.layers.status);
    } else {
      this.layers = new PlayerLayers(ui.layerHost);
    }
    this.layers.setWatermark(this.opts.watermark);
    this.fullscreen?.destroy();
    this.fullscreen = new FullscreenManager(() => this.ui?.fullscreenTarget ?? this.root, this.root, this.video, (state) => this.onFullscreenChange(state));
    if (!this.subtitles) {
      this.subtitles = new SubtitleManager({
        video: this.video,
        blobs: this.blobs,
        cueLayer: this.layers.text,
        engine: () => this.engine,
        nativeUi: () => this.opts.ui === 'native',
        fallbackLabel: (lang) => languageName(lang, this.opts.locale, this.t.unknownLanguage),
        changed: () => this.refreshTracks(),
        error: (e) => this.reportNonFatal(e),
      });
      this.subtitles.setExternal(this.opts.subtitles);
    }
    if (!this.ads) {
      const layers = this.layers;
      this.ads = new AdsManager({
        layer: layers.ads,
        contentVideo: this.video,
        blobs: this.blobs,
        t: () => this.t,
        clickPolicy: () => ({ allowedSchemes: this.opts.clickThroughSchemes }),
        nonce: () => this.opts.nonce,
        sessionSeconds: () => this.session?.clock.seconds() ?? 0,
        contentAudio: () => ({ volume: this.video.volume, muted: this.video.muted }),
        autoplayIntended: () => this.opts.autoplay.enabled,
        createEngine: (video, source) => this.createAdEngine(video, source),
        beginLinearBreak: (info) => this.beginLinearBreak(info),
        endLinearBreak: (info) => this.endLinearBreak(info),
        emit: (event, payload) => this.emit(event, payload as never),
        adProgressState: (info, currentTime, duration, skippableIn) => this.setAdProgressState(info, currentTime, duration, skippableIn),
      });
      this.ads.configure(this.opts.ads);
    }
    if (this.opts.cast.enabled) this.ensureCast();
    this.ui.setFullscreen(this.state.fullscreen);
    this.ui.setAdActive(this.linearAdActive());
    this.ui.setDuration(this.state.duration);
    this.refreshTracks();
    this.updateLiveState(true);
    if (!this.root.isConnected) return;
    // Apply the source last so every manager is wired before loading.
    if (!this.session) this.applySource(this.rawOptions.source, true);
    if (this.state.intendedPlaying && this.video.paused && this.session?.contentStarted && !this.linearAdActive()) {
      void this.playElement('restore');
    }
  }

  private reportIssues(issues: OptionIssue[]): void {
    for (const issue of issues) {
      const error = playerError('invalid-config', 'config', { message: `Invalid option ${issue.path}: ${issue.message}`, details: { path: issue.path } });
      this.emit('error', error);
    }
  }

  // ------------------------------------------------------------ option updates

  /**
   * Applies new options. Semantically unchanged values (including recreated
   * inline objects and new callback identities) are no-ops. See docs/api.md
   * for which options apply immediately vs. require a controlled reload.
   */
  update(options: PlayerOptions): void {
    if (this.destroyed) return;
    const prevRaw = this.rawOptions;
    this.rawOptions = options;
    const prev = this.opts;
    const { resolved, issues } = resolveOptions(options);
    if (semanticEqual(prev, resolved) && semanticEqual(prevRaw.source, options.source)) return;
    this.opts = resolved;
    // Only report validation issues that are new.
    if (issues.length) {
      const prevIssues = resolveOptions(prevRaw).issues;
      this.reportIssues(issues.filter((i) => !prevIssues.some((p) => p.path === i.path && p.message === i.message)));
    }
    if (!semanticEqual(prev.locale, resolved.locale) || !semanticEqual(prev.translations, resolved.translations)) {
      this.t = resolveTranslations(resolved.locale, resolved.translations);
    }
    if (!semanticEqual(prev.network.credentials, resolved.network.credentials)) this.credentialRules = this.computeCredentialRules();
    if (prev.network.crossOrigin !== resolved.network.crossOrigin) this.applyCrossOrigin();
    this.applyRootPresentation();
    this.applyVideoPresentation();
    this.state.layout = resolved.layout;
    this.state.fit = resolved.fit;
    this.state.playbackRates = [...resolved.playbackRates];

    // Controlled audio/rate values: apply when the host changes them.
    if (resolved.volume !== undefined && resolved.volume !== prev.volume) this.applyVolume(resolved.volume);
    if (resolved.muted !== undefined && resolved.muted !== prev.muted) this.applyMuted(resolved.muted);
    if (resolved.playbackRate !== undefined && resolved.playbackRate !== prev.playbackRate) this.applyRate(this.clampRate(resolved.playbackRate));
    if (!semanticEqual(prev.playbackRates, resolved.playbackRates) && resolved.playbackRate === undefined) {
      const clamped = this.clampRate(this.video.playbackRate);
      if (clamped !== this.video.playbackRate) this.setPlaybackRate(clamped);
    }

    if (this.ui && prev.ui !== resolved.ui) {
      void this.rebuildUi();
    } else if (this.ui) {
      this.ui.configure(this.uiConfig());
    }
    if (!semanticEqual(prev.watermark, resolved.watermark)) this.layers?.setWatermark(resolved.watermark);
    this.mediaSession.configure(resolved.mediaSession);
    if (resolved.cast.enabled && !prev.cast.enabled) this.ensureCast();

    if (!semanticEqual(prev.subtitles, resolved.subtitles)) this.subtitles?.setExternal(resolved.subtitles);
    if (resolved.subtitleTrack !== undefined && resolved.subtitleTrack !== prev.subtitleTrack) this.applySubtitle(resolved.subtitleTrack);
    if (resolved.quality !== undefined && resolved.quality !== prev.quality) void this.applyQuality(resolved.quality).catch((e) => this.reportNonFatal(e));
    if (resolved.audioTrack !== undefined && resolved.audioTrack !== prev.audioTrack) this.applyAudio(resolved.audioTrack);

    const reloadKeys = ['streaming', 'abr', 'drm', 'advanced'] as const;
    const engineConfigChanged = reloadKeys.some((k) => !semanticEqual(prev[k], resolved[k])) || !semanticEqual(prev.network.retry, resolved.network.retry);
    if (engineConfigChanged && this.session && this.engine?.kind === 'shaka') {
      // Streaming/DRM/retry configuration requires a controlled reload of the
      // same content session (position, selections and ad history preserved).
      void this.reloadTransport('refresh');
    }
    if (!semanticEqual(prev.ads, resolved.ads)) this.ads?.configure(resolved.ads);
    if (!semanticEqual(prevRaw.source, options.source)) this.applySource(options.source, false);
    this.refreshTracks();
  }

  private async rebuildUi(): Promise<void> {
    const old = this.ui;
    this.ui = null;
    const wasPlaying = this.state.intendedPlaying && !this.video.paused;
    if (old) {
      if (this.layers) this.root.append(this.layers.text, this.layers.watermark, this.layers.ads, this.layers.status);
      old.destroy();
    }
    await this.buildUi();
    if (wasPlaying && this.video.paused && !this.linearAdActive()) void this.playElement('restore');
  }

  // ------------------------------------------------------------ source/session

  private applySource(source: PlayerSource | null, initial: boolean): void {
    if (!this.ui && !initial) return; // buildUi() applies the latest source when ready
    if (source === null || source === undefined) {
      void this.endSession();
      return;
    }
    const normalized = normalizeSource(source);
    if (!normalized.ok) {
      void this.endSession().then(() => this.fail(normalized.error));
      return;
    }
    const next = normalized.source;
    const current = this.session;
    if (current && current.contentKey === next.contentKey) {
      if (current.transportKey === next.transportKey) return; // semantically identical
      current.source = next;
      current.transportKey = next.transportKey;
      void this.reloadTransport('refresh');
      return;
    }
    void this.startSession(next);
  }

  private async endSession(): Promise<void> {
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.session = null;
    this.breakSnapshot = null;
    this.ads?.newSession();
    if (this.engine) await this.detachEngine();
    this.setStatus('idle');
    this.state.contentSessionId = null;
    this.state.sourceType = null;
    this.state.duration = null;
    this.state.intendedPlaying = false;
    this.layers?.clearError();
    this.state.error = null;
    this.refreshTracks();
  }

  private async startSession(source: NormalizedSource): Promise<void> {
    this.loadAbort?.abort();
    const previous = this.session;
    const seq = ++this.sessionSeq;
    const session: ContentSession = {
      id: `cs-${hashString(source.contentKey)}-${seq}`,
      contentKey: source.contentKey,
      transportKey: source.transportKey,
      source,
      clock: new SessionClock(),
      contentStarted: false,
      kind: null,
      ended: false,
      endingInProgress: false,
      attachedBlob: null,
      autoRetries: 0,
    };
    this.session = session;
    this.breakSnapshot = null;
    if (previous?.attachedBlob) {
      // Released after the engine detaches it (below).
      session.attachedBlob = null;
    }
    this.state.contentSessionId = session.id;
    this.state.sourceType = source.type;
    this.state.error = null;
    this.state.ended = false;
    this.state.duration = null;
    this.state.currentTime = 0;
    this.layers?.clearError();
    this.lastLiveEmit = null;
    this.state.live = { isLive: false, atLiveEdge: false, seekableRange: null, behindLiveEdge: null, latency: null, targetLatency: null };
    this.state.intendedPlaying = this.opts.autoplay.enabled;
    this.currentVariantId = source.type === 'mp4' ? this.initialVariantId(source.variants) : null;
    this.state.quality.selected = source.type === 'mp4' ? this.currentVariantId : null;
    this.subtitles?.resetSelection();
    this.ads?.newSession();
    if (source.type === 'mp4' && this.opts.drm) {
      this.fail(playerError('drm-progressive-unsupported', 'unsupported', { fatal: true, recoverable: false }));
      return;
    }
    const kind = source.type === 'mp4' ? 'native' : 'shaka';
    if (this.engine && this.engine.kind !== kind) await this.detachEngine();
    else if (this.engine) {
      await this.engine.unload();
      this.subtitles?.onEngineUnloaded();
    }
    if (previous?.attachedBlob) this.blobs.release(previous.attachedBlob, 'content');
    if (this.session !== session || this.destroyed) return;
    if (!this.engine) this.attachEngine(kind);
    await this.loadTransport(session, 'initial', null);
  }

  private initialVariantId(variants: NormalizedVariant[]): string {
    const requested = this.opts.quality ?? this.opts.defaultQuality;
    if (requested && requested !== 'auto' && variants.some((v) => v.id === requested)) return requested;
    // Without a preference: the largest variant not exceeding the rendered
    // height × devicePixelRatio, else the smallest (no runtime switching).
    const withHeight = variants.filter((v) => v.height !== null);
    if (withHeight.length === variants.length && variants.length > 1) {
      const target = Math.max(1, this.root.clientHeight || 360) * (window.devicePixelRatio || 1);
      const sorted = [...withHeight].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
      const fit = sorted.filter((v) => (v.height ?? 0) <= target).pop() ?? sorted[0]!;
      return fit.id;
    }
    return variants[0]!.id;
  }

  private attachEngine(kind: 'native' | 'shaka'): void {
    const engine: MediaEngine =
      kind === 'native'
        ? new NativeVideoEngine(this.video)
        : new ShakaEngine(this.video, this.opts.ui === 'artplayer' ? this.layers?.text ?? null : null, {
            credentialRules: () => this.credentialRules,
            credentialedRedirect: () => this.opts.network.credentialedRedirect ?? 'error',
            onRequest: () => this.opts.network.onRequest,
            onResponse: () => this.opts.network.onResponse,
            drm: () => this.opts.drm,
            buildConfig: (request: EngineLoadRequest) => {
              const { config, removedAdvancedKeys } = buildShakaConfig({
                streaming: this.opts.streaming,
                abr: this.opts.abr,
                retry: this.opts.network.retry,
                drm: this.opts.drm,
                advanced: this.opts.advanced,
                preferredAudioLanguage: request.preferredAudioLanguage,
              });
              if (removedAdvancedKeys.length) {
                this.reportIssues([{ path: 'advanced.shaka', message: `ignored keys that would bypass package ownership: ${removedAdvancedKeys.join(', ')}` }]);
              }
              return config;
            },
            liveConfig: () => ({}),
          });
    this.engine = engine;
    this.state.engine = kind;
    this.engineUnsubs = [
      engine.on('error', (error) => this.onEngineError(error)),
      engine.on('tracksChanged', () => {
        this.subtitles?.refresh();
        this.refreshTracks();
      }),
      engine.on('effectiveQualityChanged', () => this.refreshTracks()),
      engine.on('textChanged', () => this.refreshTracks()),
      engine.on('buffering', (buffering) => {
        this.engineBuffering = buffering;
        this.updateBuffering();
      }),
      engine.on('timelineChanged', () => this.updateLiveState(false)),
    ];
  }

  private async detachEngine(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    this.engine = null;
    this.state.engine = null;
    for (const unsub of this.engineUnsubs.splice(0)) unsub();
    this.subtitles?.onEngineUnloaded();
    await engine.destroy();
  }

  private createAdEngine(video: HTMLVideoElement, source: NormalizedSource): MediaEngine {
    if (source.type === 'mp4') return new NativeVideoEngine(video);
    return new ShakaEngine(video, null, {
      credentialRules: () => [],
      credentialedRedirect: () => 'error',
      onRequest: () => undefined,
      onResponse: () => undefined,
      drm: () => undefined,
      buildConfig: () => ({}),
      liveConfig: () => ({}),
    });
  }

  /** Resolves the URL for the current transport (selected variant for MP4). */
  private transportInput(session: ContentSession): string | Blob | null {
    const source = session.source;
    if (source.type === 'mp4') {
      const variant = source.variants.find((v) => v.id === this.currentVariantId) ?? source.variants[0];
      return variant?.input ?? null;
    }
    return source.input;
  }

  private async loadTransport(session: ContentSession, reason: 'initial' | 'quality' | 'refresh' | 'retry' | 'cast-return', startTime: number | null): Promise<boolean> {
    const engine = this.engine;
    if (!engine || this.destroyed) return false;
    this.loadAbort?.abort();
    const ctrl = new AbortController();
    this.loadAbort = ctrl;
    const loadId = ++this.loadId;
    this.state.loadId = loadId;
    const input = this.transportInput(session);
    if (input === null) {
      this.fail(playerError('source-invalid', 'source', { fatal: true, recoverable: false }));
      return false;
    }
    if (reason === 'initial' || reason === 'retry') this.setStatus('loading');
    this.transportSwitching = reason !== 'initial';
    this.ui?.setLoading(true);
    this.emit('loadStart', { reason, sourceType: session.source.type });
    const previousBlob = session.attachedBlob;
    const url = typeof input === 'string' ? input : this.blobs.acquire(input, 'content');
    const variant = session.source.type === 'mp4' ? session.source.variants.find((v) => v.id === this.currentVariantId) : undefined;
    const audioPref = this.opts.audioTrack ? null : this.opts.defaultAudioLanguage;
    try {
      await engine.load(
        {
          loadId,
          url,
          mimeType: variant?.mimeType ?? engineMimeType(session.source),
          type: session.source.type,
          startTime,
          preferredAudioLanguage: audioPref,
        },
        ctrl.signal,
      );
    } catch (error) {
      if (typeof input !== 'string' && input !== previousBlob) this.blobs.release(input, 'content');
      if (ctrl.signal.aborted || loadId !== this.loadId || this.session !== session) return false;
      this.transportSwitching = false;
      const e = isPlayerError(error) ? (error as PlayerErrorImpl) : playerError('unexpected-error', 'unexpected', { fatal: true, cause: error });
      if (e.code === 'operation-aborted') return false;
      this.onLoadFailure(session, e, reason);
      return false;
    }
    if (ctrl.signal.aborted || loadId !== this.loadId || this.session !== session) return false;
    // The previous Blob is detached now (src replaced) — release its object URL.
    if (previousBlob && previousBlob !== input) this.blobs.release(previousBlob, 'content');
    session.attachedBlob = typeof input === 'string' ? null : input;
    this.loadAbort = null;
    await this.onTransportReady(session, reason);
    return true;
  }

  private onLoadFailure(session: ContentSession, error: PlayerErrorImpl, reason: string): void {
    const fatal = new PlayerErrorImpl({
      category: error.category,
      code: error.code,
      message: error.message,
      fatal: true,
      recoverable: error.recoverable,
      contentSessionId: session.id,
      loadId: this.loadId,
      details: { ...error.details, loadReason: reason },
      cause: error.cause,
    });
    this.fail(fatal);
  }

  private async onTransportReady(session: ContentSession, reason: string): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const isLive = engine.isLive();
    const kind = isLive ? 'live' : 'vod';
    session.kind = kind;
    this.ads?.setMediaKind(kind);
    await this.subtitles?.onEngineReady(engine.kind);
    if (this.session !== session) return;
    this.applyTrackPreferences(reason === 'initial');
    this.state.duration = this.contentDuration();
    this.ui?.setDuration(this.state.duration);
    this.state.error = null;
    this.layers?.clearError();
    this.setStatus('ready');
    this.ui?.setLoading(false);
    this.updateLiveState(true);
    this.refreshTracks();
    this.applyRateToElement(this.lastKnownRate);
    if (reason === 'initial') {
      this.emit('ready', { sourceType: session.source.type, engine: engine.kind, duration: this.state.duration, isLive });
    }
    if (this.state.intendedPlaying && !this.linearAdActive()) {
      await this.startContentPlayback(reason === 'initial' && this.opts.autoplay.enabled && !session.contentStarted ? 'autoplay' : 'restore');
    }
    if (this.state.loadId === this.loadId) this.transportSwitching = false;
  }

  private async reloadTransport(reason: 'refresh' | 'retry' | 'cast-return', explicitTime?: number): Promise<void> {
    const session = this.session;
    if (!session || !this.engine) return;
    const live = session.kind === 'live';
    const wasAtEdge = this.state.live.atLiveEdge;
    const snapshotTime = this.inFlightPosition ?? (this.breakSnapshot ? this.breakSnapshot.position : this.video.currentTime);
    let startTime: number | null = explicitTime ?? null;
    if (explicitTime === undefined) {
      if (!live) startTime = session.contentStarted || snapshotTime > 0 ? snapshotTime : null;
      else startTime = wasAtEdge || !session.contentStarted ? null : snapshotTime;
    }
    if (session.source.type === 'mp4' && !session.source.variants.some((v) => v.id === this.currentVariantId)) {
      this.currentVariantId = this.initialVariantId(session.source.variants);
      this.state.quality.selected = this.currentVariantId;
    }
    if (this.engine.kind !== (session.source.type === 'mp4' ? 'native' : 'shaka')) {
      await this.detachEngine();
      this.attachEngine(session.source.type === 'mp4' ? 'native' : 'shaka');
    }
    await this.loadTransport(session, reason, startTime);
  }

  // ------------------------------------------------------------ track prefs

  private applyTrackPreferences(initial: boolean): void {
    const engine = this.engine;
    const session = this.session;
    if (!engine || !session) return;
    // Quality.
    if (session.source.type !== 'mp4') {
      const target = this.opts.quality ?? (initial ? this.opts.defaultQuality ?? 'auto' : this.state.quality.selected ?? 'auto');
      const available = engine.getQualities();
      const id = target === 'auto' || !available.some((q) => q.id === target) ? 'auto' : target;
      (engine as ShakaEngine).setQuality(id, this.opts.abr.enabled ?? true);
      this.state.quality.selected = id;
    }
    // Audio.
    const audioTarget = this.opts.audioTrack ?? (initial ? null : this.state.audio.selected);
    if (audioTarget) engine.setAudioTrack(audioTarget);
    // Subtitles: priority controlled > defaultSubtitleTrack > defaultSubtitleLanguage > declared default > off.
    this.subtitles?.applyInitial({
      controlled: this.opts.subtitleTrack,
      defaultTrack: this.opts.defaultSubtitleTrack,
      defaultLanguage: this.opts.defaultSubtitleLanguage,
    });
  }

  // ------------------------------------------------------------ play/pause intent

  /**
   * The controller is the single owner of play/pause intent. All vendor UI
   * paths call `video.play()`/`video.pause()` on our element (verified in
   * Artplayer 5.4.0), so those instance methods route through the controller
   * (prerolls, ad breaks and autoplay policy cannot be bypassed).
   */
  private installIntentRouting(): void {
    const video = this.video as HTMLVideoElement & { play: () => Promise<void>; pause: () => void };
    video.play = () => this.requestPlay('element').catch(() => undefined);
    video.pause = () => this.requestPause('element');
  }

  private realPlay(): Promise<void> {
    return NATIVE_PLAY ? (NATIVE_PLAY.call(this.video) as Promise<void>) : Promise.resolve();
  }

  private realPause(): void {
    NATIVE_PAUSE?.call(this.video);
  }

  private linearAdActive(): boolean {
    return this.breakSnapshot !== null || Boolean(this.ads?.linearActive);
  }

  async requestPlay(origin: PlayOrigin): Promise<void> {
    if (this.destroyed) throw playerError('player-destroyed', 'state');
    if (this.linearAdActive()) {
      this.setIntended(true);
      this.ads?.setLinearPaused(false);
      return;
    }
    const session = this.session;
    if (!session) {
      if (origin === 'api') throw playerError('player-not-ready', 'state');
      return;
    }
    if (this.state.status === 'error') {
      if (origin === 'api') throw this.state.error ?? playerError('player-not-ready', 'state');
      return;
    }
    this.setIntended(true);
    if (this.state.status !== 'ready') return; // continues in onTransportReady
    await this.startContentPlayback(origin);
  }

  requestPause(_origin: PlayOrigin): void {
    if (this.destroyed) return;
    this.setIntended(false);
    if (this.linearAdActive()) {
      // A pause during an ad break pauses the ad and is respected on restore.
      this.ads?.setLinearPaused(true);
      return;
    }
    this.realPause();
  }

  private togglePlay(origin: PlayOrigin): void {
    if (this.linearAdActive()) {
      this.ads?.toggleLinearPause();
      return;
    }
    if (this.state.intendedPlaying && !this.video.paused) this.requestPause(origin);
    else void this.requestPlay(origin).catch(() => undefined);
  }

  private setIntended(value: boolean): void {
    this.state.intendedPlaying = value;
    if (!value) this.pausedForHidden = false;
  }

  private async startContentPlayback(origin: PlayOrigin): Promise<void> {
    const session = this.session;
    if (!session || this.state.status !== 'ready') return;
    if (!session.contentStarted) {
      session.contentStarted = true;
      if (origin === 'autoplay') {
        // Probe autoplay before any preroll so a blocked autoplay never
        // consumes the preroll: it runs on the viewer's first play instead.
        const allowed = await this.probeAutoplay();
        if (this.session !== session) return;
        if (!allowed) {
          session.contentStarted = false;
          this.setIntended(false);
          return;
        }
      }
      await this.ads?.beforeContentPlay();
      if (this.session !== session || this.destroyed) return;
      if (!this.state.intendedPlaying) return;
      if (session.kind === 'live') this.engine?.seekToLive();
    }
    if (session.ended && session.kind === 'vod') {
      session.ended = false;
      this.state.ended = false;
      this.video.currentTime = 0;
    }
    await this.playElement(origin);
  }

  private async probeAutoplay(): Promise<boolean> {
    try {
      await this.realPlay();
      this.realPause();
      return true;
    } catch (error) {
      if ((error as { name?: string })?.name !== 'NotAllowedError') return true;
    }
    if (this.opts.autoplay.mutedFallback && this.opts.muted === undefined && !this.video.muted) {
      this.applyMuted(true);
      this.emit('mutedChange', true);
      try {
        await this.realPlay();
        this.realPause();
        this.emit('autoplayBlocked', { mutedFallback: 'succeeded' });
        return true;
      } catch {
        this.emit('autoplayBlocked', { mutedFallback: 'failed' });
        return false;
      }
    }
    this.emit('autoplayBlocked', { mutedFallback: this.opts.autoplay.mutedFallback ? 'failed' : 'disabled' });
    return false;
  }

  private async playElement(origin: PlayOrigin): Promise<void> {
    try {
      await this.realPlay();
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'AbortError') return; // superseded by a newer load/pause
      if (name === 'NotAllowedError') {
        this.setIntended(false);
        if (origin === 'api') throw playerError('autoplay-blocked', 'state', { cause: error });
        return;
      }
      if (origin === 'api') throw playerError('media-error', 'media', { cause: error });
    }
  }

  // ------------------------------------------------------------ ad breaks

  private beginLinearBreak(info: AdBreakInfo): void {
    const session = this.session;
    this.breakSnapshot = {
      info,
      sessionId: session?.id ?? '',
      wasAtLiveEdge: this.state.live.atLiveEdge,
      position: this.video.currentTime,
    };
    this.realPause();
    this.state.ad = { ...this.state.ad, active: true, pipeline: info.pipeline };
    this.ui?.setAdActive(true);
    this.root.dataset.rspAdActive = '';
    this.updateClock();
    this.emit('adBreakStart', info);
  }

  /** Restores content exactly once per break (guarded by the snapshot). */
  private endLinearBreak(info: AdBreakEndInfo): void {
    const snapshot = this.breakSnapshot;
    if (!snapshot || snapshot.info.breakId !== info.breakId) return;
    this.breakSnapshot = null;
    this.state.ad = { active: false, pipeline: this.ads?.activePipeline ?? null, ad: null, currentTime: 0, duration: null, skippableIn: null };
    this.ui?.setAdActive(false);
    delete this.root.dataset.rspAdActive;
    this.emit('adBreakEnd', info);
    const session = this.session;
    if (!session || session.id !== snapshot.sessionId || this.destroyed || info.reason === 'cancelled' && this.state.status !== 'ready') {
      this.updateClock();
      return;
    }
    if (session.kind === 'live' && info.placement !== 'preroll') {
      const engine = this.engine;
      const range = engine?.seekRange() ?? null;
      if (snapshot.wasAtLiveEdge) {
        engine?.seekToLive();
        this.emit('liveRestore', { reason: 'live-edge', position: range?.end ?? this.video.currentTime });
      } else if (range && snapshot.position >= range.start && snapshot.position <= range.end) {
        if (Math.abs(this.video.currentTime - snapshot.position) > 0.5) this.video.currentTime = snapshot.position;
        this.emit('liveRestore', { reason: 'dvr-position', position: snapshot.position });
      } else {
        engine?.seekToLive();
        this.emit('liveRestore', { reason: 'dvr-window-expired', position: range?.end ?? this.video.currentTime });
      }
    }
    this.updateClock();
    if (info.placement === 'postroll') return; // ended is finalised by onContentEnded
    if (this.state.intendedPlaying && session.contentStarted) void this.playElement('restore');
  }

  private setAdProgressState(info: AdInfo | null, currentTime: number, duration: number | null, skippableIn: number | null): void {
    this.state.ad = { ...this.state.ad, ad: info, currentTime, duration, skippableIn, pipeline: this.ads?.activePipeline ?? null };
  }

  // ------------------------------------------------------------ media events

  private listen(target: EventTarget, type: string, handler: EventListener): void {
    target.addEventListener(type, handler);
    this.elementListeners.push([target, type, handler]);
  }

  private installVideoListeners(): void {
    const v = this.video;
    this.listen(v, 'play', () => {
      if (this.linearAdActive()) {
        // Something played content during an ad: keep content paused.
        this.realPause();
        return;
      }
      this.state.paused = false;
      if (!this.transportSwitching) this.emit('play', { currentTime: v.currentTime });
      this.mediaSession.claim(this.mediaSnapshot());
    });
    this.listen(v, 'playing', () => {
      this.elementWaiting = false;
      this.updateBuffering();
      this.updateClock();
      if (!this.transportSwitching) this.emit('playing', { currentTime: v.currentTime });
      this.mediaSession.update(this.mediaSnapshot());
    });
    this.listen(v, 'pause', () => {
      this.state.paused = true;
      this.updateClock();
      this.state.currentTime = v.currentTime;
      if (!this.linearAdActive() && !this.transportSwitching) this.emit('pause', { currentTime: v.currentTime });
      this.mediaSession.update(this.mediaSnapshot());
    });
    this.listen(v, 'waiting', () => {
      this.elementWaiting = true;
      this.updateBuffering();
      this.updateClock();
    });
    this.listen(v, 'canplay', () => {
      this.elementWaiting = false;
      this.updateBuffering();
    });
    this.listen(v, 'seeking', () => {
      // `loop` restart: the element jumps from the end back to 0.
      if (v.loop && this.lastMediaTime > 0 && v.currentTime < 0.5 && Number.isFinite(v.duration) && this.lastMediaTime > v.duration - 1.5) {
        this.ads?.onLoopRestart();
      }
      this.seekingFlag = true;
      this.state.seeking = true;
      this.ads?.onSeek(null);
      this.updateClock();
      if (!this.transportSwitching) this.emit('seeking', { currentTime: v.currentTime });
    });
    this.listen(v, 'seeked', () => {
      this.seekingFlag = false;
      this.state.seeking = false;
      this.state.currentTime = v.currentTime;
      this.lastMediaTime = v.currentTime;
      this.ads?.onSeek(v.currentTime);
      this.updateClock();
      if (!this.transportSwitching) this.emit('seeked', { currentTime: v.currentTime });
      this.mediaSession.update(this.mediaSnapshot());
      this.updateLiveState(false);
    });
    this.listen(v, 'ended', () => void this.onContentEnded());
    this.listen(v, 'durationchange', () => {
      const d = this.contentDuration();
      if (d !== this.state.duration) {
        this.state.duration = d;
        this.ui?.setDuration(d);
        this.emit('durationChange', d);
      }
    });
    this.listen(v, 'volumechange', () => this.onElementVolumeChange());
    this.listen(v, 'ratechange', () => this.onElementRateChange());
    this.listen(v, 'loadedmetadata', () => this.refreshTracks());
    this.listen(v, 'enterpictureinpicture', () => {
      this.state.pictureInPicture = true;
      this.subtitles?.setVideoOnlyPresentation(true);
      this.emit('pictureInPictureChange', true);
    });
    this.listen(v, 'leavepictureinpicture', () => {
      this.state.pictureInPicture = false;
      this.subtitles?.setVideoOnlyPresentation(this.state.fullscreen.videoOnly);
      this.emit('pictureInPictureChange', false);
    });
    this.listen(v, 'webkitplaybacktargetavailabilitychanged', (event) => {
      const available = (event as Event & { availability?: string }).availability === 'available';
      this.state.airplay = { ...this.state.airplay, available };
      this.emit('airplayChange', { ...this.state.airplay });
    });
    this.listen(v, 'webkitcurrentplaybacktargetiswirelesschanged', () => {
      const active = Boolean((v as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean }).webkitCurrentPlaybackTargetIsWireless);
      this.state.airplay = { ...this.state.airplay, active };
      this.emit('airplayChange', { ...this.state.airplay });
    });
  }

  private installPageListeners(): void {
    this.listen(document, 'visibilitychange', () => {
      if (!this.opts.pauseWhenHidden) return;
      if (document.hidden && this.state.intendedPlaying && !this.video.paused) {
        this.realPause();
        this.pausedForHidden = true;
      } else if (!document.hidden && this.pausedForHidden && this.state.intendedPlaying) {
        this.pausedForHidden = false;
        void this.playElement('restore');
      }
    });
    if (this.reducedMotionQuery) {
      const handler = () => this.applyRootPresentation();
      this.listen(this.reducedMotionQuery, 'change', handler);
    }
    this.progressTimer = setInterval(() => this.onProgressTick(), this.opts.progressInterval);
    this.cueTimer = setInterval(() => this.onCueTick(), 250);
  }

  private onProgressTick(): void {
    if (this.destroyed || !this.session || this.state.status !== 'ready') return;
    const v = this.video;
    this.state.currentTime = v.currentTime;
    this.state.buffered = rangesOf(v.buffered);
    this.state.seekable = rangesOf(v.seekable);
    this.updateLiveState(false);
    if (!v.paused && !this.linearAdActive()) {
      this.emit('progress', {
        currentTime: v.currentTime,
        duration: this.state.duration,
        buffered: this.state.buffered,
        sessionTime: this.session.clock.seconds(),
      });
      this.mediaSession.update(this.mediaSnapshot());
    }
  }

  private onCueTick(): void {
    const session = this.session;
    if (this.destroyed || !session || this.state.status !== 'ready' || this.linearAdActive()) return;
    const t = this.video.currentTime;
    if (!this.video.paused) {
      this.ads?.tick({ mediaTime: t, sessionTime: session.clock.seconds(), discontinuity: this.seekingFlag });
    }
    this.lastMediaTime = t;
  }

  private async onContentEnded(): Promise<void> {
    const session = this.session;
    if (!session || session.ended || session.endingInProgress || this.linearAdActive()) return;
    if (session.kind === 'live') {
      // A live stream that genuinely ends; never synthesised.
      session.ended = true;
      this.state.ended = true;
      this.updateClock();
      this.emit('ended', { currentTime: this.video.currentTime });
      return;
    }
    session.endingInProgress = true;
    this.updateClock();
    try {
      await this.ads?.onContentEnded();
    } finally {
      session.endingInProgress = false;
    }
    if (this.session !== session || this.destroyed) return;
    session.ended = true;
    this.state.ended = true;
    this.setIntended(false);
    this.emit('ended', { currentTime: this.video.currentTime });
    this.mediaSession.update(this.mediaSnapshot());
  }

  private updateBuffering(): void {
    const buffering = (this.engine?.kind === 'shaka' ? this.engineBuffering : this.elementWaiting) && !this.video.paused;
    if (buffering === this.state.buffering) return;
    if (this.bufferingTimer) clearTimeout(this.bufferingTimer);
    this.bufferingTimer = null;
    this.state.buffering = buffering;
    this.updateClock();
    this.emit('buffering', buffering);
    if (buffering) {
      // Debounced spinner: short stalls do not flash a loading indicator.
      this.bufferingTimer = setTimeout(() => {
        if (this.state.buffering) this.ui?.setLoading(true);
      }, 300);
    } else {
      this.ui?.setLoading(false);
    }
  }

  /** Session clock runs only during active content playback. */
  private updateClock(): void {
    const v = this.video;
    const running = Boolean(this.session) && !v.paused && !v.ended && !this.state.buffering && !this.seekingFlag && !this.linearAdActive() && v.readyState >= 2;
    this.session?.clock.setRunning(running);
  }

  private contentDuration(): number | null {
    if (this.engine?.isLive()) return null;
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  private updateLiveState(force: boolean): void {
    const engine = this.engine;
    const isLive = Boolean(engine?.isLive());
    const range = isLive ? engine!.seekRange() : null;
    const behind = range ? Math.max(0, range.end - this.video.currentTime) : null;
    const live: LiveState = {
      isLive,
      atLiveEdge: isLive && behind !== null && behind <= this.opts.liveEdgeTolerance,
      seekableRange: range,
      behindLiveEdge: behind,
      latency: isLive ? engine!.liveLatency() : null,
      targetLatency: isLive ? engine!.targetLatency() : null,
    };
    this.state.live = live;
    this.ui?.setLive({ isLive, atLiveEdge: live.atLiveEdge, behindLiveEdge: behind, seekable: Boolean(range && range.end - range.start > 1) });
    const prev = this.lastLiveEmit;
    const significant =
      force ||
      !prev ||
      prev.isLive !== live.isLive ||
      prev.atLiveEdge !== live.atLiveEdge ||
      Math.abs((prev.behindLiveEdge ?? 0) - (live.behindLiveEdge ?? 0)) >= 1 ||
      Math.abs((prev.seekableRange?.start ?? 0) - (live.seekableRange?.start ?? 0)) >= 1;
    if (significant && (live.isLive || prev?.isLive)) {
      this.lastLiveEmit = live;
      this.emit('liveStateChange', { ...live });
    }
  }

  private onEngineError(error: PlayerErrorImpl): void {
    if (!error.fatal) {
      this.reportNonFatal(error);
      return;
    }
    this.fail(error.withContext(this.session?.id ?? null, this.loadId));
  }

  // ------------------------------------------------------------ errors / retry

  private fail(error: PlayerErrorImpl): void {
    if (this.destroyed) return;
    const session = this.session;
    const contextual = error.contentSessionId ? error : error.withContext(session?.id ?? null, this.loadId);
    this.ui?.setLoading(false);
    // Bounded automatic retry for recoverable network/media/manifest failures.
    const limit = this.opts.network.fatalRetryLimit ?? 1;
    const autoRetryable = contextual.recoverable && ['network', 'media', 'manifest'].includes(contextual.category);
    if (session && autoRetryable && session.autoRetries < limit) {
      session.autoRetries++;
      const delay = Math.min(8000, 1000 * 2 ** (session.autoRetries - 1));
      this.emit('error', contextual);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.session === session && !this.destroyed) void this.reloadTransport('retry');
      }, delay);
      return;
    }
    this.state.error = contextual;
    this.setStatus('error');
    this.layers?.showError(contextual, this.t, contextual.recoverable && session ? () => void this.retry().catch(() => undefined) : null);
    this.emit('error', contextual);
  }

  private reportNonFatal(error: unknown): void {
    const e = isPlayerError(error) ? (error as PlayerErrorImpl) : playerError('unexpected-error', 'unexpected', { cause: error });
    if (e.code === 'operation-aborted') return;
    this.emit('error', e.contentSessionId ? e : e.withContext(this.session?.id ?? null, this.loadId));
  }

  async retry(): Promise<void> {
    if (this.destroyed) throw playerError('player-destroyed', 'state');
    const session = this.session;
    if (!session) throw playerError('player-not-ready', 'state');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    session.autoRetries = 0;
    this.layers?.clearError();
    this.state.error = null;
    if (!this.engine) this.attachEngine(session.source.type === 'mp4' ? 'native' : 'shaka');
    await this.reloadTransport('retry');
    const error = this.state.error as PlayerError | null;
    if (this.state.status === 'error' && error) throw error;
  }

  private setStatus(status: PlayerStatus): void {
    if (this.state.status === status) return;
    this.state.status = status;
    this.emit('statusChange', status);
  }

  // ------------------------------------------------------------ audio / rate

  private clampRate(rate: number): number {
    const rates = this.opts.playbackRates;
    return clamp(rate, rates[0] ?? 0.25, rates[rates.length - 1] ?? 4);
  }

  private applyVolume(volume: number): void {
    const v = clamp(volume, 0, 1);
    this.lastKnownVolume = v;
    if (v > 0) this.lastNonZeroVolume = v;
    this.video.volume = v;
    this.state.volume = v;
    this.ads?.setAudio(v, this.video.muted);
  }

  private applyMuted(muted: boolean): void {
    this.lastKnownMuted = muted;
    this.video.muted = muted;
    this.state.muted = muted;
    this.ads?.setAudio(this.video.volume, muted);
  }

  private applyRateToElement(rate: number): void {
    this.lastKnownRate = rate;
    this.video.defaultPlaybackRate = rate;
    if (this.video.playbackRate !== rate) this.video.playbackRate = rate;
    this.state.playbackRate = rate;
  }

  private applyRate(rate: number): void {
    this.applyRateToElement(rate);
    this.refreshTracks();
    this.mediaSession.update(this.mediaSnapshot());
  }

  /** Vendor UI or the platform changed volume/mute directly on the element. */
  private onElementVolumeChange(): void {
    const v = this.video;
    if (Math.abs(v.volume - this.lastKnownVolume) > 1e-6) {
      const requested = v.volume;
      this.lastKnownVolume = requested;
      if (requested > 0) this.lastNonZeroVolume = requested;
      this.state.volume = requested;
      this.emit('volumeChange', requested);
      if (this.opts.volume !== undefined) this.scheduleReconcile();
    }
    if (v.muted !== this.lastKnownMuted) {
      const requested = v.muted;
      this.lastKnownMuted = requested;
      this.state.muted = requested;
      this.emit('mutedChange', requested);
      if (this.opts.muted !== undefined) this.scheduleReconcile();
    }
    this.ads?.setAudio(v.volume, v.muted);
  }

  private onElementRateChange(): void {
    const v = this.video;
    if (Math.abs(v.playbackRate - this.lastKnownRate) < 1e-6) return;
    if (this.engine?.kind === 'shaka' && this.state.live.isLive) {
      // Live catch-up (liveSync) adjusts the rate internally; not a user change.
      this.lastKnownRate = v.playbackRate;
      return;
    }
    const requested = v.playbackRate;
    this.lastKnownRate = requested;
    this.state.playbackRate = requested;
    this.emit('playbackRateChange', requested);
    if (this.opts.playbackRate !== undefined) this.scheduleReconcile();
    this.refreshTracks();
  }

  /** Controlled props: the host decides. Revert to the controlled value if it did not change it. */
  private scheduleReconcile(): void {
    if (this.reconcileFrame !== null) return;
    const run = () => {
      this.reconcileFrame = null;
      if (this.destroyed) return;
      const o = this.opts;
      if (o.volume !== undefined && Math.abs(this.video.volume - o.volume) > 1e-6) this.applyVolume(o.volume);
      if (o.muted !== undefined && this.video.muted !== o.muted) this.applyMuted(o.muted);
      if (o.playbackRate !== undefined) {
        const rate = this.clampRate(o.playbackRate);
        if (Math.abs(this.video.playbackRate - rate) > 1e-6) this.applyRate(rate);
      }
    };
    this.reconcileFrame = requestAnimationFrame(() => {
      this.reconcileFrame = requestAnimationFrame(run);
    });
  }

  setVolume(value: number): void {
    if (this.destroyed || !Number.isFinite(value)) return;
    const v = clamp(value, 0, 1);
    if (this.opts.volume !== undefined) {
      this.emit('volumeChange', v);
      this.scheduleReconcile();
      return;
    }
    if (Math.abs(v - this.video.volume) < 1e-6) return;
    this.applyVolume(v);
    this.emit('volumeChange', v);
  }

  setMuted(value: boolean): void {
    if (this.destroyed) return;
    if (this.opts.muted !== undefined) {
      this.emit('mutedChange', value);
      this.scheduleReconcile();
      return;
    }
    if (value === this.video.muted) return;
    this.applyMuted(value);
    this.emit('mutedChange', value);
  }

  setPlaybackRate(value: number): void {
    if (this.destroyed || !Number.isFinite(value) || value <= 0) return;
    if (this.linearAdActive()) return; // content rate cannot change during linear ads
    const rate = this.clampRate(value);
    if (this.opts.playbackRate !== undefined) {
      this.emit('playbackRateChange', rate);
      this.scheduleReconcile();
      return;
    }
    if (Math.abs(rate - this.video.playbackRate) < 1e-6) return;
    this.applyRate(rate);
    this.emit('playbackRateChange', rate);
  }

  // ------------------------------------------------------------ tracks

  private qualityList(): QualityTrack[] {
    const session = this.session;
    if (!session) return [];
    if (session.source.type === 'mp4') {
      if (session.source.variants.length < 2) return [];
      return session.source.variants.map((v) => ({
        id: v.id,
        label: v.label,
        width: v.width,
        height: v.height,
        bitrate: v.bitrate,
        codecs: null,
        frameRate: null,
        kind: 'progressive' as const,
      }));
    }
    return this.engine?.getQualities() ?? [];
  }

  private effectiveQuality(): QualityTrack | null {
    const session = this.session;
    if (!session || this.state.status !== 'ready') return null;
    if (session.source.type === 'mp4') {
      const list = this.qualityList();
      return list.find((q) => q.id === this.currentVariantId) ?? null;
    }
    return this.engine?.getEffectiveQuality() ?? null;
  }

  private audioList(): AudioTrack[] {
    return this.engine?.getAudioTracks() ?? [];
  }

  /** Recomputes track lists, emits change events and updates the prebuilt menus. */
  private refreshTracks(): void {
    if (this.destroyed) return;
    const qualities = this.qualityList();
    const adaptive = this.session !== null && this.session.source.type !== 'mp4' && qualities.length > 0;
    const effective = this.effectiveQuality();
    const audio = this.audioList();
    const audioSelected = audio.find((a) => a.active)?.id ?? null;
    const subtitles: SubtitleTrackInfo[] = this.subtitles?.list() ?? [];
    const subSelected = this.subtitles?.selected() ?? null;
    const s = this.state;
    if (!semanticEqual(s.quality.available, qualities)) {
      s.quality.available = qualities;
      this.emit('availableQualitiesChange', qualities);
    }
    s.quality.autoAvailable = adaptive;
    if (!semanticEqual(s.quality.effective, effective)) {
      s.quality.effective = effective;
      this.emit('effectiveQualityChange', effective);
    }
    if (!semanticEqual(s.audio.available, audio)) {
      s.audio.available = audio;
      this.emit('availableAudioTracksChange', audio);
    }
    if (s.audio.selected !== audioSelected) {
      s.audio.selected = audioSelected;
      this.emit('audioTrackChange', audio.find((a) => a.id === audioSelected) ?? null);
    }
    const prevSubs = s.subtitles.available;
    if (!semanticEqual(prevSubs.map(({ active: _a, ...rest }) => rest), subtitles.map(({ active: _a, ...rest }) => rest))) {
      this.emit('availableSubtitlesChange', subtitles);
    }
    s.subtitles.available = subtitles;
    if (s.subtitles.selected !== subSelected) {
      s.subtitles.selected = subSelected;
      this.emit('subtitleChange', subtitles.find((t) => t.id === subSelected) ?? null);
    }
    this.ui?.setMenus(this.menuModel());
  }

  private menuModel(): MenuModel {
    const t = this.t;
    const s = this.state;
    const quality = s.quality;
    let qualitySection: MenuModel['quality'] = null;
    if (quality.available.length > 1 || (quality.autoAvailable && quality.available.length > 0)) {
      const items = quality.available.map((q) => ({ value: q.id, label: q.label, checked: quality.selected === q.id }));
      if (quality.autoAvailable) items.unshift({ value: 'auto', label: t.auto, checked: quality.selected === 'auto' });
      const current =
        quality.selected === 'auto'
          ? quality.effective
            ? format(t.autoWithEffective, { quality: quality.effective.label })
            : t.auto
          : quality.available.find((q) => q.id === quality.selected)?.label ?? '';
      qualitySection = { items, current };
    }
    const audio = s.audio.available.length > 1
      ? {
          items: s.audio.available.map((a) => ({ value: a.id, label: a.label || languageName(a.language, this.opts.locale, t.unknownLanguage), checked: a.active })),
          current: (() => {
            const a = s.audio.available.find((x) => x.active);
            return a ? a.label || languageName(a.language, this.opts.locale, t.unknownLanguage) : '';
          })(),
        }
      : null;
    const subs = s.subtitles.available.length > 0
      ? {
          items: [{ value: '__off__', label: t.subtitlesOff, checked: s.subtitles.selected === null }, ...s.subtitles.available.map((x) => ({ value: x.id, label: x.label, checked: x.id === s.subtitles.selected }))],
          current: s.subtitles.available.find((x) => x.id === s.subtitles.selected)?.label ?? t.subtitlesOff,
        }
      : null;
    const rate = this.video.playbackRate;
    const rateLabel = (r: number) => (r === 1 ? t.normalSpeed : `${r}×`);
    const speed = {
      items: this.opts.playbackRates.map((r) => ({ value: String(r), label: rateLabel(r), checked: Math.abs(r - rate) < 1e-6 })),
      current: rateLabel(rate),
    };
    return { quality: qualitySection, audio, subtitles: subs, speed };
  }

  async requestQuality(id: 'auto' | string): Promise<void> {
    this.assertUsable();
    const available = this.qualityList();
    const adaptive = this.state.quality.autoAvailable;
    if (id === 'auto' ? !adaptive : !available.some((q) => q.id === id)) {
      throw playerError('unsupported-operation', 'unsupported', { message: id === 'auto' ? 'Auto quality is only available for adaptive (HLS/DASH) sources.' : 'Unknown quality id.' });
    }
    if (this.opts.quality !== undefined) {
      // Controlled: request only; the host applies it by updating `quality`.
      this.emit('qualityChange', this.selectionFor(id));
      this.refreshTracks();
      return;
    }
    await this.applyQuality(id);
  }

  private selectionFor(id: string): QualitySelection {
    return { id, track: id === 'auto' ? null : this.qualityList().find((q) => q.id === id) ?? null };
  }

  private async applyQuality(id: string): Promise<void> {
    const session = this.session;
    if (!session || this.state.status !== 'ready') {
      // Applied when the source becomes ready (initial preference).
      return;
    }
    if (session.source.type !== 'mp4') {
      const engine = this.engine as ShakaEngine | null;
      if (!engine) return;
      if (this.state.quality.selected === id) return;
      if (!engine.setQuality(id, this.opts.abr.enabled ?? true)) throw playerError('unsupported-operation', 'unsupported', { message: 'Quality selection is unavailable for this stream.' });
      this.state.quality.selected = id;
      this.emit('qualityChange', this.selectionFor(id));
      this.refreshTracks();
      return;
    }
    if (id === this.currentVariantId) return;
    await this.switchProgressiveVariant(session, id);
  }

  /**
   * Switches between quality URLs of the same progressive video, preserving
   * time, intended play state, rate, volume/mute and caption selection. Last
   * selection wins; on failure the previous variant is restored.
   */
  private async switchProgressiveVariant(session: ContentSession, id: string): Promise<void> {
    const gen = ++this.qualitySwitchGen;
    const previous = this.currentVariantId;
    // While an earlier switch is still loading, the element's currentTime is not
    // meaningful; keep restoring to the position captured by the first switch.
    const time = this.inFlightPosition ?? (this.breakSnapshot ? this.breakSnapshot.position : this.video.currentTime);
    this.inFlightPosition = time;
    const wasPlaying = this.state.intendedPlaying && !this.linearAdActive();
    this.currentVariantId = id;
    this.state.quality.selected = id;
    this.emit('qualityChange', this.selectionFor(id));
    const ok = await this.loadTransportForQuality(session, time);
    if (gen !== this.qualitySwitchGen || this.session !== session) return;
    this.inFlightPosition = null;
    if (!ok && this.state.status === 'error' && previous && previous !== id) {
      // Keep a usable source: return to the previous variant at the same time.
      const failure = this.state.error;
      this.currentVariantId = previous;
      this.state.quality.selected = previous;
      this.state.error = null;
      this.layers?.clearError();
      this.setStatus('ready');
      const restored = await this.loadTransportForQuality(session, time);
      if (gen !== this.qualitySwitchGen) return;
      this.emit('qualityChange', this.selectionFor(previous));
      if (failure) this.reportNonFatal(new PlayerErrorImpl({ ...failure, fatal: false, details: { ...failure.details, qualityFallback: previous } } as ConstructorParameters<typeof PlayerErrorImpl>[0]));
      if (restored && wasPlaying && this.state.intendedPlaying) void this.playElement('restore');
      return;
    }
    this.refreshTracks();
  }

  private loadTransportForQuality(session: ContentSession, time: number): Promise<boolean> {
    return this.loadTransport(session, 'quality', time);
  }

  async requestAudio(id: string): Promise<void> {
    this.assertUsable();
    if (!this.audioList().some((a) => a.id === id)) throw playerError('unsupported-operation', 'unsupported', { message: 'Unknown audio track id.' });
    if (this.opts.audioTrack !== undefined) {
      this.emit('audioTrackChange', this.audioList().find((a) => a.id === id) ?? null);
      this.refreshTracks();
      return;
    }
    this.applyAudio(id);
  }

  private applyAudio(id: string): void {
    if (this.engine?.setAudioTrack(id)) {
      this.state.audio.selected = null; // force change detection
      this.refreshTracks();
    }
  }

  async requestSubtitle(id: string | null): Promise<void> {
    this.assertUsable();
    if (id !== null && !(this.subtitles?.list() ?? []).some((t) => t.id === id)) {
      throw playerError('unsupported-operation', 'unsupported', { message: 'Unknown subtitle track id.' });
    }
    if (this.opts.subtitleTrack !== undefined) {
      this.emit('subtitleChange', id === null ? null : this.subtitles?.list().find((t) => t.id === id) ?? null);
      this.refreshTracks();
      return;
    }
    this.applySubtitle(id);
  }

  private applySubtitle(id: string | null): void {
    if (this.subtitles?.select(id)) this.refreshTracks();
  }

  private toggleCaptions(): void {
    const target = this.subtitles?.toggleTarget();
    if (target === undefined) return;
    void this.requestSubtitle(target).catch(() => undefined);
  }

  // ------------------------------------------------------------ seeking

  private assertUsable(): void {
    if (this.destroyed) throw playerError('player-destroyed', 'state');
  }

  async seekTo(seconds: number): Promise<void> {
    this.assertUsable();
    if (!Number.isFinite(seconds)) throw playerError('invalid-config', 'config', { message: 'seekTo requires a finite number of seconds.' });
    if (!this.session || this.state.status !== 'ready') throw playerError('player-not-ready', 'state');
    if (this.linearAdActive()) throw playerError('unsupported-operation', 'unsupported', { message: 'Content cannot be seeked during a linear ad.' });
    let target = seconds;
    const live = this.state.live;
    if (live.isLive) {
      const range = this.engine?.seekRange();
      if (!range) throw playerError('unsupported-operation', 'unsupported', { message: 'This live stream has no seekable window.' });
      target = clamp(seconds, range.start, range.end);
    } else {
      const d = this.contentDuration();
      target = clamp(seconds, 0, d ?? Math.max(0, seconds));
    }
    await this.seekElement(target);
  }

  private seekElement(target: number): Promise<void> {
    const v = this.video;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 10_000);
      v.addEventListener('seeked', finish);
      v.currentTime = target;
      if (!v.seeking) finish();
    });
  }

  async seekBy(delta: number): Promise<void> {
    this.assertUsable();
    return this.seekTo(this.video.currentTime + delta);
  }

  async seekToLive(): Promise<void> {
    this.assertUsable();
    if (!this.state.live.isLive || !this.engine) throw playerError('unsupported-operation', 'unsupported', { message: 'seekToLive() requires a live source.' });
    if (this.linearAdActive()) throw playerError('unsupported-operation', 'unsupported', { message: 'Content cannot be seeked during a linear ad.' });
    this.engine.seekToLive();
    this.updateLiveState(true);
  }

  // ------------------------------------------------------------ hotkeys

  private onHotkey(action: HotkeyAction, event: KeyboardEvent): boolean {
    if (this.state.status !== 'ready' && action !== 'exitWebFullscreen' && action !== 'toggleFullscreen') return false;
    const ad = this.linearAdActive();
    const step = this.opts.hotkeys.seekSeconds;
    const live = this.state.live;
    const duration = this.contentDuration();
    switch (action) {
      case 'togglePlay':
        this.togglePlay('hotkey');
        return true;
      case 'seekBackward':
      case 'seekForward':
        if (ad) return true;
        void this.seekBy(action === 'seekBackward' ? -step : step).catch(() => undefined);
        return true;
      case 'volumeUp':
      case 'volumeDown': {
        const delta = action === 'volumeUp' ? this.opts.hotkeys.volumeStep : -this.opts.hotkeys.volumeStep;
        const base = this.video.muted && action === 'volumeUp' ? 0 : this.video.volume;
        if (this.video.muted && action === 'volumeUp') this.setMuted(false);
        this.setVolume(clamp(base + delta, 0, 1));
        return true;
      }
      case 'seekToPercent': {
        if (ad) return true;
        const digit = Number(event.key);
        if (!Number.isInteger(digit)) return false;
        if (live.isLive) {
          const range = live.seekableRange;
          if (!range || range.end - range.start < 1) return false; // no DVR window: unsupported honestly
          void this.seekTo(range.start + ((range.end - range.start) * digit) / 10).catch(() => undefined);
          return true;
        }
        if (duration === null) return false;
        void this.seekTo((duration * digit) / 10).catch(() => undefined);
        return true;
      }
      case 'seekToStart':
        if (ad) return true;
        if (live.isLive) {
          if (!live.seekableRange) return false;
          void this.seekTo(live.seekableRange.start).catch(() => undefined);
        } else void this.seekTo(0).catch(() => undefined);
        return true;
      case 'seekToEnd':
        if (ad) return true;
        if (live.isLive) void this.seekToLive().catch(() => undefined);
        else if (duration !== null) void this.seekTo(duration).catch(() => undefined);
        return true;
      case 'toggleFullscreen':
        void this.fullscreenApi.toggle(this.opts.hotkeys.fullscreenMode).catch((e) => this.reportNonFatal(e));
        return true;
      case 'toggleMute':
        if (this.video.muted) {
          this.setMuted(false);
          if (this.video.volume === 0) this.setVolume(this.lastNonZeroVolume);
        } else this.setMuted(true);
        return true;
      case 'toggleCaptions':
        this.toggleCaptions();
        return true;
      case 'nextRate':
      case 'previousRate': {
        if (ad) return true;
        const rates = this.opts.playbackRates;
        const current = this.video.playbackRate;
        const next = action === 'nextRate' ? rates.find((r) => r > current + 1e-6) : [...rates].reverse().find((r) => r < current - 1e-6);
        if (next !== undefined) this.setPlaybackRate(next);
        return true;
      }
      case 'exitWebFullscreen':
        if (this.state.fullscreen.mode === 'web') {
          void this.fullscreenApi.cancel('web');
          return true;
        }
        return false;
    }
    return false;
  }

  // ------------------------------------------------------------ fullscreen / PiP

  readonly fullscreenApi: FullscreenController = {
    request: async (mode: FullscreenMode) => {
      this.assertUsable();
      if (!this.fullscreen) throw playerError('player-not-ready', 'state');
      await this.fullscreen.request(mode, { fallbackToWeb: this.opts.fullscreen.fallbackToWeb });
    },
    cancel: async (mode: FullscreenMode) => {
      this.assertUsable();
      await this.fullscreen?.cancel(mode);
    },
    toggle: async (mode: FullscreenMode) => {
      this.assertUsable();
      if (!this.fullscreen) throw playerError('player-not-ready', 'state');
      await this.fullscreen.toggle(mode, { fallbackToWeb: this.opts.fullscreen.fallbackToWeb });
    },
  };

  private onFullscreenChange(state: { active: boolean; mode: FullscreenMode | null; videoOnly: boolean }): void {
    this.state.fullscreen = { ...state };
    this.ui?.setFullscreen(state);
    this.subtitles?.setVideoOnlyPresentation(state.videoOnly || this.state.pictureInPicture);
    this.emit('fullscreenChange', { ...state });
  }

  async enterPictureInPicture(): Promise<void> {
    this.assertUsable();
    if (!document.pictureInPictureEnabled || this.video.disablePictureInPicture || typeof this.video.requestPictureInPicture !== 'function') {
      throw playerError('pip-unsupported', 'pip');
    }
    try {
      await this.video.requestPictureInPicture();
    } catch (error) {
      throw playerError('pip-rejected', 'pip', { cause: error });
    }
  }

  async exitPictureInPicture(): Promise<void> {
    this.assertUsable();
    if (document.pictureInPictureElement !== this.video) return;
    try {
      await document.exitPictureInPicture();
    } catch (error) {
      throw playerError('pip-rejected', 'pip', { cause: error });
    }
  }

  // ------------------------------------------------------------ cast

  private ensureCast(): void {
    if (this.cast) return;
    this.cast = new CastManager({
      nonce: () => this.opts.nonce,
      media: () => this.castMedia(),
      onRemoteStart: () => {
        this.realPause();
      },
      onRemoteEnd: (time, wasPlaying) => {
        if (!this.session || this.session.kind === 'live') return;
        void this.seekTo(time)
          .catch(() => undefined)
          .then(() => {
            if (wasPlaying && this.state.intendedPlaying) void this.playElement('restore');
          });
      },
      onStatus: (status, deviceName) => {
        this.state.cast = { status, deviceName };
        this.emit('castStateChange', { status, deviceName });
      },
      onError: (error) => this.reportNonFatal(error),
    });
    void this.cast.configure(this.opts.cast);
  }

  private castMedia(): { url: string; contentType: string; currentTime: number; autoplay: boolean } | { rejected: string } {
    const session = this.session;
    if (!session) return { rejected: 'no-source' };
    if (this.linearAdActive()) return { rejected: 'ad-break-active' };
    const input = this.transportInput(session);
    if (typeof input !== 'string' || /^blob:/i.test(input)) return { rejected: 'blob-not-castable' };
    const castCfg = this.opts.cast;
    if (this.opts.drm && !castCfg.customReceiver) return { rejected: 'drm-requires-custom-receiver' };
    if (this.credentialRules.length && !castCfg.customReceiver) return { rejected: 'auth-requires-custom-receiver' };
    const adsPending = this.ads?.activePipeline === 'vast' || this.ads?.hasPendingDirectAds();
    if (adsPending && !castCfg.receiverHandlesAds) return { rejected: 'ads-not-supported-remotely' };
    let url = input;
    try {
      url = new URL(input, location.href).href;
    } catch {
      return { rejected: 'invalid-url' };
    }
    const contentType = engineMimeType(session.source) ?? 'video/mp4';
    return { url, contentType, currentTime: this.video.currentTime, autoplay: this.state.intendedPlaying };
  }

  // ------------------------------------------------------------ misc API

  async captureFrame(): Promise<Blob | null> {
    this.assertUsable();
    return captureVideoFrame(this.video, { protected: Boolean(this.engine?.isProtected()) });
  }

  private mediaSnapshot() {
    return {
      playing: !this.video.paused,
      position: this.video.currentTime,
      duration: this.contentDuration(),
      playbackRate: this.video.playbackRate || 1,
    };
  }

  getState(): PlayerState {
    const s = this.state;
    if (s.status === 'ready' || s.status === 'loading') {
      s.currentTime = this.video.currentTime;
      s.paused = this.video.paused;
    }
    const { error, ...rest } = s;
    return { ...(structuredClone(rest) as Omit<PlayerState, 'error'>), error };
  }

  getStats(): PlayerStats {
    const e = this.engine?.getStats();
    const ads = this.ads?.stats ?? { started: 0, completed: 0, skipped: 0, errors: 0 };
    return {
      content: {
        sessionPlaybackTime: this.session?.clock.seconds() ?? 0,
        estimatedBandwidth: e?.estimatedBandwidth ?? null,
        streamBandwidth: e?.streamBandwidth ?? null,
        width: e?.width ?? (this.video.videoWidth || null),
        height: e?.height ?? (this.video.videoHeight || null),
        droppedFrames: e?.droppedFrames ?? null,
        decodedFrames: e?.decodedFrames ?? null,
        stallsDetected: e?.stallsDetected ?? null,
        gapsJumped: e?.gapsJumped ?? null,
        bufferingTime: e?.bufferingTime ?? null,
        loadLatency: e?.loadLatency ?? null,
        liveLatency: e?.liveLatency ?? null,
        loadAttempts: this.loadId,
      },
      advertising: { pipeline: this.ads?.activePipeline ?? null, ...ads },
      remote: { castStatus: this.state.cast.status, airplayActive: this.state.airplay.active },
    };
  }

  getCapabilities(): PlayerCapabilities {
    const engine = this.engine;
    const caps = engine?.capabilities();
    const session = this.session;
    const isMp4 = session?.source.type === 'mp4';
    const variants = isMp4 ? session!.source.variants.length : 0;
    const pip = typeof document !== 'undefined' && document.pictureInPictureEnabled === true && this.opts.pictureInPicture;
    const airplay = typeof (window as { WebKitPlaybackTargetAvailabilityEvent?: unknown }).WebKitPlaybackTargetAvailabilityEvent !== 'undefined';
    const nativeUi = this.opts.ui === 'native';
    return {
      engine: engine?.kind ?? null,
      adaptiveQuality: capability(Boolean(caps?.adaptiveQuality) && !isMp4, isMp4 ? 'progressive-mp4-variants-are-manual-only' : caps?.qualityUnavailableReason ?? 'no-adaptive-source'),
      manualQuality: capability(isMp4 ? variants > 1 : Boolean(caps?.adaptiveQuality), isMp4 ? 'single-progressive-file' : caps?.qualityUnavailableReason ?? 'no-source'),
      audioTrackSelection: capability(Boolean(caps?.audioTrackSelection) && this.audioList().length > 1, caps?.audioTrackSelection ? 'single-audio-track' : 'native-progressive-audio-tracks-not-exposed'),
      subtitleSelection: capability((this.subtitles?.list().length ?? 0) > 0, 'no-subtitle-tracks'),
      playbackRate: capability(true, ''),
      volumeControl: capability(canSetVolume(), 'platform-ignores-programmatic-volume'),
      browserFullscreen: capability(FullscreenManager.browserSupported(this.video), 'fullscreen-api-unavailable'),
      webFullscreen: capability(true, ''),
      pictureInPicture: capability(pip, this.opts.pictureInPicture ? 'pip-api-unavailable' : 'disabled-by-option'),
      airplay: capability(airplay && this.opts.airplay, airplay ? 'disabled-by-option' : 'webkit-airplay-api-unavailable'),
      cast: capability(Boolean(this.cast?.available), this.opts.cast.enabled ? 'cast-sdk-or-devices-unavailable' : 'disabled-by-option'),
      mediaSession: capability(mediaSessionSupported() && this.opts.mediaSession.enabled === true, mediaSessionSupported() ? 'disabled-by-option' : 'media-session-api-unavailable'),
      captureFrame: capability(!engine?.isProtected() && typeof HTMLCanvasElement !== 'undefined', engine?.isProtected() ? 'protected-content' : 'canvas-unavailable'),
      drm: capability(Boolean(caps?.drm) && !isMp4, isMp4 ? 'progressive-mp4-is-unprotected-only' : 'eme-unavailable'),
      streamingConfig: capability(Boolean(caps?.streamingConfig), 'native-progressive-path'),
      requestInterception: capability(Boolean(caps?.requestInterception), 'native-element-requests-cannot-be-intercepted'),
      contextMenu: capability(!nativeUi && this.opts.contextMenu.enabled, nativeUi ? 'browser-owned-in-native-ui' : 'disabled-by-option'),
      liveSeek: capability(Boolean(this.state.live.seekableRange && this.state.live.seekableRange.end - this.state.live.seekableRange.start > 1), this.state.live.isLive ? 'no-dvr-window' : 'not-live'),
    };
  }

  private async copyDiagnostics(): Promise<void> {
    const diagnostics = redactValue({
      state: { ...this.getState(), error: this.state.error ? { code: this.state.error.code, category: this.state.error.category } : null },
      stats: this.getStats(),
      capabilities: this.getCapabilities(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      this.ui?.notice(this.t.diagnosticsCopied);
    } catch {
      /* clipboard unavailable: ignore */
    }
  }

  // ------------------------------------------------------------ events

  private context(): EventContext {
    return { contentSessionId: this.session?.id ?? null, loadId: this.state.loadId, timestamp: now() };
  }

  emit<K extends PlayerEventName>(event: K, payload: PlayerEventMap[K]): void {
    if (this.destroyed && event !== 'destroy') return;
    const ctx = this.context();
    this.emitter.emit(event, payload, ctx);
    this.sink?.emit(event, payload, ctx);
    const callback = this.callbacks()[`on${capitalize(event)}` as keyof PlayerEventCallbacks] as PlayerEventListener<K> | undefined;
    if (typeof callback === 'function') {
      try {
        callback(payload, ctx);
      } catch (error) {
        reportListenerError(error);
      }
    }
  }

  on<K extends PlayerEventName>(event: K, listener: PlayerEventListener<K>): () => void {
    return this.emitter.on(event, listener);
  }

  once<K extends PlayerEventName>(event: K, listener: PlayerEventListener<K>): () => void {
    return this.emitter.once(event, listener);
  }

  off<K extends PlayerEventName>(event: K, listener: PlayerEventListener<K>): void {
    this.emitter.off(event, listener);
  }

  // ------------------------------------------------------------ teardown

  /** Idempotent; safe during loading and under React Strict Mode. */
  destroy(reason: 'destroy' | 'unmount' = 'destroy'): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyPromise = (async () => {
      this.emit('destroy', { reason });
      this.destroyed = true;
      this.state.status = 'destroyed';
      this.loadAbort?.abort();
      if (this.progressTimer) clearInterval(this.progressTimer);
      if (this.cueTimer) clearInterval(this.cueTimer);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      if (this.bufferingTimer) clearTimeout(this.bufferingTimer);
      if (this.reconcileFrame !== null) cancelAnimationFrame(this.reconcileFrame);
      for (const [target, type, handler] of this.elementListeners.splice(0)) target.removeEventListener(type, handler);
      this.session?.clock.setRunning(false);
      this.ads?.destroy();
      this.cast?.destroy();
      this.mediaSession.destroy();
      this.hotkeys.destroy();
      this.fullscreen?.destroy();
      // Detach consumers before revoking package-owned object URLs.
      this.subtitles?.destroy();
      const engine = this.engine;
      this.engine = null;
      for (const unsub of this.engineUnsubs.splice(0)) unsub();
      this.realPause();
      if (engine) await engine.destroy().catch(() => undefined);
      await this.uiPromise?.catch(() => undefined);
      this.ui?.destroy();
      this.ui = null;
      this.layers?.destroy();
      this.video.removeAttribute('src');
      try {
        this.video.load();
      } catch {
        /* ignore */
      }
      this.video.remove();
      this.stage.remove();
      if (this.session?.attachedBlob) this.blobs.release(this.session.attachedBlob, 'content');
      this.blobs.destroy();
      this.session = null;
      this.emitter.dispose();
      delete this.root.dataset.rspAdActive;
      delete this.root.dataset.rspWebFullscreen;
    })();
    return this.destroyPromise;
  }

  /** Imperative facade matching {@link PlayerRef}. */
  toRef(): PlayerRef {
    return createRef(() => this, null);
  }
}

type PlayerError = import('../types/errors.js').PlayerError;
type PlayerSource = import('../types/source.js').PlayerSource;

/**
 * Builds a stable PlayerRef that delegates to the current controller (which
 * may be replaced, e.g. under React Strict Mode). Calls before the controller
 * exists reject with `player-not-ready`; after destruction, `player-destroyed`.
 */
export function createRef(get: () => PlayerController | null, events: TypedEmitter<PlayerEventMap, EventContext> | null): PlayerRef {
  const notReady = () => playerError('player-not-ready', 'state');
  const withController = <T>(fn: (c: PlayerController) => Promise<T>): Promise<T> => {
    const c = get();
    return c ? fn(c) : Promise.reject(notReady());
  };
  const ref: PlayerRef = {
    play: () => withController((c) => c.requestPlay('api')),
    pause: () => get()?.requestPause('api'),
    seekTo: (s) => withController((c) => c.seekTo(s)),
    seekBy: (d) => withController((c) => c.seekBy(d)),
    seekToLive: () => withController((c) => c.seekToLive()),
    setVolume: (v) => get()?.setVolume(v),
    setMuted: (m) => get()?.setMuted(m),
    setPlaybackRate: (r) => get()?.setPlaybackRate(r),
    getQualities: () => get()?.getState().quality.available ?? [],
    setQuality: (id) => withController((c) => c.requestQuality(id)),
    getAudioTracks: () => get()?.getState().audio.available ?? [],
    setAudioTrack: (id) => withController((c) => c.requestAudio(id)),
    getSubtitleTracks: () => get()?.getState().subtitles.available ?? [],
    setSubtitleTrack: (id) => withController((c) => c.requestSubtitle(id)),
    fullscreen: {
      request: (mode) => withController((c) => c.fullscreenApi.request(mode)),
      cancel: (mode) => withController((c) => c.fullscreenApi.cancel(mode)),
      toggle: (mode) => withController((c) => c.fullscreenApi.toggle(mode)),
    },
    enterPictureInPicture: () => withController((c) => c.enterPictureInPicture()),
    exitPictureInPicture: () => withController((c) => c.exitPictureInPicture()),
    captureFrame: () => withController((c) => c.captureFrame()),
    getState: () => {
      const c = get();
      if (!c) throw notReady();
      return c.getState();
    },
    getStats: () => {
      const c = get();
      if (!c) throw notReady();
      return c.getStats();
    },
    getCapabilities: () => {
      const c = get();
      if (!c) throw notReady();
      return c.getCapabilities();
    },
    retry: () => withController((c) => c.retry()),
    destroy: () => get()?.destroy('destroy') ?? Promise.resolve(),
    // With a facade emitter, subscriptions work before the controller exists
    // and survive controller re-creation (React Strict Mode).
    on: (event, listener) => {
      if (events) return events.on(event, listener);
      const c = get();
      return c ? c.on(event, listener) : () => undefined;
    },
    once: (event, listener) => {
      if (events) return events.once(event, listener);
      const c = get();
      return c ? c.once(event, listener) : () => undefined;
    },
    off: (event, listener) => {
      if (events) events.off(event, listener);
      else get()?.off(event, listener);
    },
  };
  return ref;
}
