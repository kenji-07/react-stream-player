import { fromShakaError, playerError, PlayerErrorImpl } from '../errors.js';
import { isOriginAllowed, matchCredentialRules, resolveRuleHeaders, type NormalizedCredentialRule } from '../security/credentials.js';
import type { DrmConfig, LicenseRequest, LicenseResponse, NetworkConfig, RequestType } from '../types/config.js';
import type { TimeRange } from '../types/state.js';
import type { AudioTrack, QualityTrack, SubtitleKind } from '../types/tracks.js';
import { TypedEmitter } from '../utils/emitter.js';
import { hashString } from '../utils/equal.js';
import type { EngineCapabilities, EngineEventMap, EngineLoadRequest, EngineStats, EngineTextTrack, MediaEngine } from './engine.js';
import { loadShaka, type Shaka } from './shaka-loader.js';
import type { ShakaConfig } from './shaka-config.js';

type ShakaPlayer = InstanceType<Shaka['Player']>;

/** Hooks are read on every request so option changes apply without a reload. */
export interface ShakaHooks {
  credentialRules(): NormalizedCredentialRule[];
  credentialedRedirect(): 'error' | 'allow';
  onRequest(): NetworkConfig['onRequest'];
  onResponse(): NetworkConfig['onResponse'];
  drm(): DrmConfig | undefined;
  /** Full Shaka configuration for the next load. */
  buildConfig(request: EngineLoadRequest): ShakaConfig;
  /** Shaka config fields that may be re-applied immediately without a reload. */
  liveConfig(): ShakaConfig;
}

// shaka.net.NetworkingEngine.RequestType (verified, shaka-player 5.2.12)
const RT = { MANIFEST: 0, SEGMENT: 1, LICENSE: 2, APP: 3, TIMING: 4, SERVER_CERTIFICATE: 5, KEY: 6 } as const;

function mapRequestType(type: number, context: { stream?: { type?: string } } | undefined): RequestType {
  switch (type) {
    case RT.MANIFEST:
      return 'manifest';
    case RT.SEGMENT: {
      const streamType = context?.stream?.type;
      if (streamType === 'text') return 'subtitle';
      if (streamType === 'image') return 'image';
      return 'segment';
    }
    case RT.LICENSE:
      return 'license';
    case RT.SERVER_CERTIFICATE:
      return 'certificate';
    case RT.KEY:
      return 'key';
    default:
      return 'other';
  }
}

function toBytes(data: ArrayBuffer | ArrayBufferView | null | undefined): Uint8Array {
  if (!data) return new Uint8Array(0);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function videoTrackId(t: { width: number | null; height: number | null; bandwidth: number; frameRate: number | null; codecs: string | null; hdr?: string | null }): string {
  // Shaka's VideoTrack has no id; height alone is not unique (bitrate, codec,
  // frame-rate and HDR ladders can share a height).
  return `v${t.width ?? 0}x${t.height ?? 0}-${t.bandwidth}-${t.frameRate ?? 0}-${hashString(`${t.codecs ?? ''}|${t.hdr ?? ''}`)}`;
}

function audioTrackKey(t: { language: string; label: string | null; channelsCount: number | null; codecs: string | null; roles: string[] }): string {
  return `a-${hashString([t.language, t.label ?? '', t.channelsCount ?? '', t.codecs ?? '', [...t.roles].sort().join(',')].join('|'))}`;
}

export class ShakaEngine implements MediaEngine {
  readonly kind = 'shaka' as const;
  private readonly emitter = new TypedEmitter<EngineEventMap, undefined>();
  private player: ShakaPlayer | null = null;
  private shaka: Shaka | null = null;
  private initPromise: Promise<void> | null = null;
  private destroyed = false;
  private readonly externalIds = new Map<number, string>();
  private readonly credentialed = new WeakSet<object>();
  private redirectBlocked = false;
  private loadSeq = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    /** DOM container for Shaka's UITextDisplayer; `null` uses native text rendering. */
    private readonly textContainer: HTMLElement | null,
    private readonly hooks: ShakaHooks,
  ) {}

  on<K extends keyof EngineEventMap>(event: K, listener: (payload: EngineEventMap[K]) => void): () => void {
    return this.emitter.on(event, listener as (p: EngineEventMap[K], c: undefined) => void);
  }

  private init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const shaka = await loadShaka();
        if (this.destroyed) throw playerError('operation-aborted', 'state');
        if (!shaka.Player.isBrowserSupported()) {
          throw playerError('source-unsupported', 'unsupported', { fatal: true, recoverable: false, message: 'This browser cannot play adaptive streams (no MediaSource/EME support).' });
        }
        this.shaka = shaka;
        const player = new shaka.Player();
        this.player = player;
        // Shaka's default text displayer factory only chooses UITextDisplayer
        // when a container is set before attach() (verified in 5.2.12).
        if (this.textContainer) player.setVideoContainer(this.textContainer);
        await player.attach(this.video);
        if (this.destroyed) {
          await player.destroy();
          throw playerError('operation-aborted', 'state');
        }
        this.installListeners(player);
        this.installNetworkFilters(player);
      })();
      this.initPromise.catch(() => undefined);
    }
    return this.initPromise;
  }

  private installListeners(player: ShakaPlayer): void {
    const add = (name: string, fn: (event: Event & Record<string, unknown>) => void) =>
      player.addEventListener(name, fn as unknown as EventListener);
    add('error', (event) => {
      const detail = (event as unknown as { detail: unknown }).detail;
      const error = this.redirectBlocked
        ? playerError('credential-redirect-blocked', 'network', { fatal: true, recoverable: false, cause: detail })
        : fromShakaError(detail);
      this.redirectBlocked = false;
      if (error.code === 'operation-aborted') return;
      this.emitter.emit('error', error, undefined);
    });
    add('buffering', (event) => this.emitter.emit('buffering', Boolean(event.buffering), undefined));
    for (const name of ['trackschanged', 'audiotrackschanged']) add(name, () => this.emitter.emit('tracksChanged', undefined, undefined));
    for (const name of ['adaptation', 'variantchanged']) add(name, () => this.emitter.emit('effectiveQualityChanged', undefined, undefined));
    add('textchanged', () => this.emitter.emit('textChanged', undefined, undefined));
    add('manifestupdated', () => this.emitter.emit('timelineChanged', undefined, undefined));
  }

  private installNetworkFilters(player: ShakaPlayer): void {
    const net = player.getNetworkingEngine();
    if (!net) return;
    net.registerRequestFilter(async (type, request, context) => {
      const requestType = mapRequestType(type as number, context as { stream?: { type?: string } } | undefined);
      const url = request.uris[0] ?? '';
      const rules = matchCredentialRules(this.hooks.credentialRules(), url, requestType);
      for (const rule of rules) {
        Object.assign(request.headers, await resolveRuleHeaders(rule, { type: requestType, url }));
        if (rule.withCredentials) request.allowCrossSiteCredentials = true;
        this.credentialed.add(request);
      }
      const drm = this.hooks.drm();
      if (requestType === 'license' && drm) {
        const keySystem = request.drmInfo?.keySystem ?? '';
        if (drm.getLicenseToken) {
          const token = await drm.getLicenseToken({ keySystem });
          if (token) request.headers['Authorization'] = `Bearer ${token}`;
        }
        if (drm.transformLicenseRequest) {
          const view: LicenseRequest = {
            keySystem,
            uris: [...request.uris],
            headers: { ...request.headers },
            body: toBytes(request.body),
            messageType: request.licenseRequestType ?? null,
            initDataType: request.initDataType ?? null,
            initData: request.initData ? new Uint8Array(request.initData) : null,
          };
          const result = (await drm.transformLicenseRequest(view)) ?? view;
          request.uris = [...result.uris];
          request.headers = { ...result.headers };
          request.body = toArrayBuffer(result.body);
        }
      }
      const onRequest = this.hooks.onRequest();
      if (onRequest) {
        const view = {
          type: requestType,
          uris: [...request.uris],
          method: request.method,
          headers: { ...request.headers },
          withCredentials: request.allowCrossSiteCredentials,
        };
        await onRequest(view);
        request.uris = [...view.uris];
        request.method = view.method;
        request.headers = { ...view.headers };
        request.allowCrossSiteCredentials = view.withCredentials;
      }
    });
    net.registerResponseFilter(async (type, response, context) => {
      const requestType = mapRequestType(type as number, context as { stream?: { type?: string } } | undefined);
      const original = response.originalRequest as object | undefined;
      if (original && this.credentialed.has(original) && this.hooks.credentialedRedirect() === 'error') {
        // Fail closed: data that arrived from an origin outside the allowlist
        // after a redirect is not used. Modern browsers strip Authorization on
        // cross-origin redirects; this guards platforms that do not.
        if (!isOriginAllowed(this.hooks.credentialRules(), response.uri)) {
          this.redirectBlocked = true;
          throw new Error('credential-redirect-blocked');
        }
      }
      const drm = this.hooks.drm();
      if (requestType === 'license' && drm?.transformLicenseResponse) {
        const view: LicenseResponse = {
          keySystem: response.originalRequest?.drmInfo?.keySystem ?? '',
          uri: response.uri,
          headers: { ...response.headers },
          data: toBytes(response.data),
        };
        const result = (await drm.transformLicenseResponse(view)) ?? view;
        response.data = toArrayBuffer(result.data);
      }
      const onResponse = this.hooks.onResponse();
      if (onResponse) {
        const view = {
          type: requestType,
          uri: response.uri,
          originalUri: response.originalUri,
          status: response.status,
          headers: { ...response.headers },
          data: toArrayBuffer(toBytes(response.data)),
        };
        await onResponse(view);
        response.data = view.data;
      }
    });
  }

  capabilities(): EngineCapabilities {
    const srcEquals = this.isSrcEquals();
    return {
      adaptiveQuality: !srcEquals,
      audioTrackSelection: true,
      requestInterception: !srcEquals,
      streamingConfig: !srcEquals,
      drm: typeof navigator !== 'undefined' && typeof navigator.requestMediaKeySystemAccess === 'function',
      qualityUnavailableReason: srcEquals ? 'native-hls-playback: the browser plays this stream natively and does not expose renditions' : null,
    };
  }

  private isSrcEquals(): boolean {
    if (!this.player || !this.shaka) return false;
    return this.player.getLoadMode() === this.shaka.Player.LoadMode.SRC_EQUALS;
  }

  async load(request: EngineLoadRequest, signal: AbortSignal): Promise<void> {
    if (this.destroyed) throw playerError('player-destroyed', 'state');
    const seq = ++this.loadSeq;
    await this.init();
    const player = this.player!;
    if (signal.aborted || seq !== this.loadSeq) throw playerError('operation-aborted', 'state');
    const onAbort = () => {
      void player.unload().catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      player.resetConfiguration();
      player.configure(this.hooks.buildConfig(request));
      this.externalIds.clear();
      this.redirectBlocked = false;
      await player.load(request.url, request.startTime, request.mimeType ?? undefined);
      if (signal.aborted || seq !== this.loadSeq) throw playerError('operation-aborted', 'state');
    } catch (error) {
      if (signal.aborted || seq !== this.loadSeq || this.destroyed) throw playerError('operation-aborted', 'state', { cause: error });
      if (error instanceof PlayerErrorImpl) throw error;
      if (this.redirectBlocked) {
        this.redirectBlocked = false;
        throw playerError('credential-redirect-blocked', 'network', { fatal: true, recoverable: false, cause: error });
      }
      const isShakaError = typeof (error as { category?: unknown } | null)?.category === 'number';
      if (!isShakaError) {
        // Plain exceptions from load() come from manifest/playlist parsing
        // (e.g. Shaka 5.2.12's XML parser rejecting a truncated MPD).
        throw playerError('manifest-error', 'manifest', { fatal: true, recoverable: false, cause: error });
      }
      const mapped = fromShakaError(error, true);
      throw mapped.code === 'operation-aborted' ? mapped : new PlayerErrorImpl({ ...mapped, fatal: true, details: { ...mapped.details }, category: mapped.category, code: mapped.code });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Re-applies configuration that Shaka accepts while playing (no reload). */
  applyLiveConfig(): void {
    if (!this.player) return;
    this.player.configure(this.hooks.liveConfig());
  }

  async unload(): Promise<void> {
    this.loadSeq++;
    if (!this.player) return;
    try {
      await this.player.unload();
    } catch {
      /* unload interrupts pending loads; errors are irrelevant here */
    }
    this.externalIds.clear();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadSeq++;
    const player = this.player;
    this.player = null;
    if (player) {
      try {
        await player.destroy();
      } catch {
        /* ignore */
      }
    } else if (this.initPromise) {
      // init() destroys the player itself when it observes `destroyed`.
      await this.initPromise.catch(() => undefined);
    }
    this.emitter.dispose();
  }

  getQualities(): QualityTrack[] {
    if (!this.player || this.isSrcEquals()) return [];
    const seen = new Set<string>();
    const out: QualityTrack[] = [];
    for (const t of this.player.getVideoTracks()) {
      const id = videoTrackId(t);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: t.height ? `${t.height}p` : t.label ?? `${Math.round(t.bandwidth / 1000)} kbps`,
        width: t.width,
        height: t.height,
        bitrate: t.bandwidth || null,
        codecs: t.codecs,
        frameRate: t.frameRate,
        kind: 'adaptive',
      });
    }
    // Disambiguate identical labels (same height, different bitrate/codec/fps).
    const counts = new Map<string, number>();
    for (const q of out) counts.set(q.label, (counts.get(q.label) ?? 0) + 1);
    for (const q of out) {
      if ((counts.get(q.label) ?? 0) > 1) {
        const extra = [q.frameRate && q.frameRate > 30 ? `${Math.round(q.frameRate)}fps` : null, q.bitrate ? `${Math.round(q.bitrate / 1000)} kbps` : null]
          .filter(Boolean)
          .join(', ');
        if (extra) q.label = `${q.label} (${extra})`;
      }
    }
    return out.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  }

  getEffectiveQuality(): QualityTrack | null {
    if (!this.player) return null;
    const active = this.player.getVideoTracks().find((t) => t.active);
    if (!active) return null;
    const id = videoTrackId(active);
    return this.getQualities().find((q) => q.id === id) ?? null;
  }

  isAbrEnabled(): boolean {
    return Boolean(this.player?.getConfiguration().abr.enabled);
  }

  setQuality(id: 'auto' | string, abrEnabledForAuto = true): boolean {
    const player = this.player;
    if (!player || this.isSrcEquals()) return false;
    if (id === 'auto') {
      player.configure({ abr: { enabled: abrEnabledForAuto } });
      return true;
    }
    const track = player.getVideoTracks().find((t) => videoTrackId(t) === id);
    if (!track) return false;
    // Shaka warns that ABR may override manual selections; disable it first.
    player.configure({ abr: { enabled: false } });
    player.selectVideoTrack(track, /* clearBuffer= */ true, /* safeMargin= */ 1);
    return true;
  }

  getAudioTracks(): AudioTrack[] {
    if (!this.player) return [];
    const seen = new Set<string>();
    const out: AudioTrack[] = [];
    for (const t of this.player.getAudioTracks()) {
      const id = audioTrackKey(t);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: t.label ?? '',
        language: t.language || 'und',
        roles: [...t.roles],
        channels: t.channelsCount,
        codecs: t.codecs,
        active: t.active,
      });
    }
    return out;
  }

  setAudioTrack(id: string): boolean {
    const track = this.player?.getAudioTracks().find((t) => audioTrackKey(t) === id);
    if (!track || !this.player) return false;
    this.player.selectAudioTrack(track);
    return true;
  }

  getTextTracks(): EngineTextTrack[] {
    if (!this.player) return [];
    const used = new Map<string, number>();
    return this.player.getTextTracks().map((t) => {
      const externalId = this.externalIds.get(t.id) ?? null;
      let id: string;
      if (externalId) id = `x:${externalId}`;
      else {
        const base = `m:${hashString([t.originalTextId ?? '', t.language, t.label ?? '', t.kind ?? '', t.forced, [...t.roles].sort().join(',')].join('|'))}`;
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        id = n ? `${base}-${n}` : base;
      }
      const kind: SubtitleKind = t.forced ? 'forced' : t.kind === 'caption' || t.kind === 'captions' ? 'captions' : 'subtitles';
      return { id, label: t.label, language: t.language || 'und', kind, forced: t.forced, active: t.active, externalId };
    });
  }

  setTextTrack(id: string | null): boolean {
    const player = this.player;
    if (!player) return false;
    if (id === null) {
      player.selectTextTrack(null);
      return true;
    }
    const ours = this.getTextTracks();
    const index = ours.findIndex((t) => t.id === id);
    if (index < 0) return false;
    const target = player.getTextTracks()[index];
    if (!target) return false;
    player.selectTextTrack(target);
    return true;
  }

  async addExternalText(track: { externalId: string; url: string; language: string; label: string; kind: SubtitleKind }): Promise<void> {
    const player = this.player;
    if (!player) throw playerError('player-not-ready', 'state');
    // Shaka 5.2.12 expects the HTML track kinds here ("subtitles"/"captions").
    const kind = track.kind === 'captions' ? 'captions' : 'subtitles';
    const added = await player.addTextTrackAsync(track.url, track.language, kind, 'text/vtt', undefined, track.label, track.kind === 'forced');
    this.externalIds.set(added.id, track.externalId);
    this.emitter.emit('tracksChanged', undefined, undefined);
  }

  isLive(): boolean {
    return Boolean(this.player?.isLive());
  }

  seekRange(): TimeRange | null {
    if (!this.player) return null;
    const r = this.player.seekRange();
    return Number.isFinite(r.start) && Number.isFinite(r.end) ? { start: r.start, end: r.end } : null;
  }

  seekToLive(): void {
    this.player?.goToLive();
  }

  liveLatency(): number | null {
    if (!this.player?.isLive()) return null;
    const latency = this.player.getStats().liveLatency;
    return Number.isFinite(latency) ? latency : null;
  }

  targetLatency(): number | null {
    const liveSync = this.player?.getConfiguration().streaming.liveSync;
    return liveSync?.enabled ? liveSync.targetLatency : null;
  }

  getStats(): EngineStats {
    const s = this.player?.getStats();
    const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      estimatedBandwidth: n(s?.estimatedBandwidth),
      streamBandwidth: n(s?.streamBandwidth),
      width: n(s?.width),
      height: n(s?.height),
      droppedFrames: n(s?.droppedFrames),
      decodedFrames: n(s?.decodedFrames),
      stallsDetected: n(s?.stallsDetected),
      gapsJumped: n(s?.gapsJumped),
      bufferingTime: n(s?.bufferingTime),
      loadLatency: n(s?.loadLatency),
      liveLatency: n(s?.liveLatency),
    };
  }

  isProtected(): boolean {
    return Boolean(this.player?.drmInfo()) || Boolean(this.player?.keySystem());
  }
}
