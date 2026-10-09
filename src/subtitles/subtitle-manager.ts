import type { EngineTextTrack, MediaEngine } from '../engines/engine.js';
import { playerError, type PlayerErrorImpl } from '../errors.js';
import type { BlobRegistry } from '../resources/blob-registry.js';
import { blobIdentity } from '../resources/blob-registry.js';
import type { SubtitleKind, SubtitleTrack, SubtitleTrackInfo } from '../types/tracks.js';
import { NativeCueRenderer } from './native-cue-renderer.js';

export interface SubtitleHost {
  readonly video: HTMLVideoElement;
  readonly blobs: BlobRegistry;
  /** Layer for DOM-rendered cues on the native engine (artplayer UI only). */
  readonly cueLayer: HTMLElement;
  engine(): MediaEngine | null;
  /** `true` when the browser's own controls are used (native rendering + menu). */
  nativeUi(): boolean;
  /** Display label for a track without a label. */
  fallbackLabel(language: string): string;
  changed(): void;
  error(error: PlayerErrorImpl): void;
}

export interface SelectionPreferences {
  controlled: string | null | undefined;
  defaultTrack: string | null | undefined;
  defaultLanguage: string | null;
}

interface ExternalEntry {
  track: SubtitleTrack;
  key: string;
  element: HTMLTrackElement | null;
  url: string | null;
  /** Added to the current Shaka load. */
  inEngine: boolean;
}

function kindOf(track: SubtitleTrack): SubtitleKind {
  return track.kind ?? 'subtitles';
}

function externalKey(track: SubtitleTrack): string {
  return JSON.stringify([track.id, typeof track.src === 'string' ? track.src : blobIdentity(track.src), track.label, track.language, track.kind ?? null, Boolean(track.default)]);
}

function languageMatches(candidate: string, wanted: string): boolean {
  const a = candidate.toLowerCase();
  const b = wanted.toLowerCase();
  return a === b || a.split('-')[0] === b.split('-')[0];
}

/**
 * Merges manifest and external subtitle tracks into one list with stable IDs,
 * owns selection (including "off") and keeps it across quality switches,
 * transport refreshes and reloads.
 */
export class SubtitleManager {
  private external = new Map<string, ExternalEntry>();
  /** `undefined` = not decided yet; `null` = explicitly off. */
  private selectedId: string | null | undefined = undefined;
  private lastOnId: string | null = null;
  private renderer: NativeCueRenderer | null = null;
  private videoOnlyPresentation = false;
  private destroyed = false;
  private engineKind: 'native' | 'shaka' | null = null;
  private readonly onTrackError = (event: Event) => {
    const el = event.target as HTMLTrackElement;
    this.host.error(playerError('subtitle-load-error', 'subtitle', { details: { trackId: el.dataset.rspId ?? '' } }));
  };

  constructor(private readonly host: SubtitleHost) {}

  /** Applies the host's `subtitles` list. Unchanged entries are kept (no refetch). */
  setExternal(tracks: SubtitleTrack[]): void {
    const next = new Map<string, SubtitleTrack>(tracks.map((t) => [t.id, t]));
    let changed = false;
    for (const [id, entry] of [...this.external]) {
      const replacement = next.get(id);
      if (!replacement || externalKey(replacement) !== entry.key) {
        this.removeExternal(id);
        changed = true;
      }
    }
    for (const track of tracks) {
      if (this.external.has(track.id)) continue;
      this.external.set(track.id, { track, key: externalKey(track), element: null, url: null, inEngine: false });
      changed = true;
    }
    if (!changed) return;
    void this.syncEngine();
  }

  private removeExternal(id: string): void {
    const entry = this.external.get(id);
    if (!entry) return;
    this.external.delete(id);
    if (entry.element) {
      entry.element.removeEventListener('error', this.onTrackError);
      if (this.renderer?.currentTrack === entry.element.track) this.renderer.attach(null);
      entry.element.remove();
    }
    // Revoke only after the consumer element is gone (deferred by the registry).
    if (typeof entry.track.src !== 'string') this.host.blobs.release(entry.track.src, `subtitle:${id}`);
    if (this.selectedId === id) this.selectedId = null;
  }

  private resolveUrl(entry: ExternalEntry): string {
    if (entry.url) return entry.url;
    entry.url = typeof entry.track.src === 'string' ? entry.track.src : this.host.blobs.acquire(entry.track.src, `subtitle:${entry.track.id}`);
    return entry.url;
  }

  /** Called when an engine is (re)attached or a load completed. */
  async onEngineReady(kind: 'native' | 'shaka'): Promise<void> {
    if (this.engineKind !== kind) {
      if (kind === 'shaka') this.removeTrackElements();
      for (const entry of this.external.values()) entry.inEngine = false;
    }
    this.engineKind = kind;
    if (kind === 'shaka') for (const entry of this.external.values()) entry.inEngine = false;
    await this.syncEngine();
  }

  /** Called before an engine unload that drops engine-side text tracks. */
  onEngineUnloaded(): void {
    for (const entry of this.external.values()) entry.inEngine = false;
  }

  private removeTrackElements(): void {
    for (const entry of this.external.values()) {
      if (entry.element) {
        entry.element.removeEventListener('error', this.onTrackError);
        entry.element.remove();
        entry.element = null;
      }
    }
    this.renderer?.attach(null);
  }

  private async syncEngine(): Promise<void> {
    if (this.destroyed) return;
    const engine = this.host.engine();
    if (this.engineKind === 'native') {
      for (const entry of this.external.values()) {
        if (entry.element) continue;
        const el = document.createElement('track');
        el.kind = kindOf(entry.track) === 'captions' ? 'captions' : 'subtitles';
        el.label = entry.track.label;
        el.srclang = entry.track.language;
        el.dataset.rspId = entry.track.id;
        el.addEventListener('error', this.onTrackError);
        el.src = this.resolveUrl(entry);
        this.host.video.appendChild(el);
        el.track.mode = 'disabled';
        entry.element = el;
      }
    } else if (this.engineKind === 'shaka' && engine) {
      for (const entry of this.external.values()) {
        if (entry.inEngine) continue;
        entry.inEngine = true;
        try {
          await engine.addExternalText({
            externalId: entry.track.id,
            url: this.resolveUrl(entry),
            language: entry.track.language,
            label: entry.track.label,
            kind: kindOf(entry.track),
          });
        } catch (error) {
          entry.inEngine = false;
          this.host.error(playerError('subtitle-load-error', 'subtitle', { cause: error, details: { trackId: entry.track.id } }));
        }
      }
    }
    this.apply();
    this.host.changed();
  }

  private engineTracks(): EngineTextTrack[] {
    if (this.engineKind !== 'shaka') return [];
    return this.host.engine()?.getTextTracks() ?? [];
  }

  /** Merged, de-duplicated list (external tracks keep the host's IDs). */
  list(): SubtitleTrackInfo[] {
    const out: SubtitleTrackInfo[] = [];
    const seen = new Set<string>();
    const engineTracks = this.engineTracks();
    for (const entry of this.external.values()) {
      const t = entry.track;
      seen.add(t.id);
      const kind = kindOf(t);
      out.push({
        id: t.id,
        label: t.label || this.host.fallbackLabel(t.language),
        language: t.language,
        kind,
        forced: kind === 'forced',
        origin: 'external',
        active: this.selectedId === t.id,
      });
    }
    for (const t of engineTracks) {
      if (t.externalId) continue; // represented by the external entry above
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({
        id: t.id,
        label: t.label || this.host.fallbackLabel(t.language),
        language: t.language,
        kind: t.kind,
        forced: t.forced,
        origin: 'manifest',
        active: this.selectedId === t.id,
      });
    }
    return out;
  }

  selected(): string | null {
    return this.selectedId ?? null;
  }

  /** Decides the initial selection once tracks are known (priority documented in docs/api.md). */
  applyInitial(prefs: SelectionPreferences): void {
    if (this.selectedId !== undefined) return this.apply();
    const available = this.list();
    let choice: string | null | undefined;
    if (prefs.controlled !== undefined) choice = prefs.controlled;
    else if (prefs.defaultTrack !== undefined) choice = prefs.defaultTrack;
    else if (prefs.defaultLanguage) {
      choice = available.find((t) => t.origin === 'external' && languageMatches(t.language, prefs.defaultLanguage!))?.id ??
        available.find((t) => languageMatches(t.language, prefs.defaultLanguage!))?.id;
    }
    if (choice === undefined) {
      const declared = [...this.external.values()].find((e) => e.track.default);
      choice = declared ? declared.track.id : null;
    }
    // A preferred track that is not (yet) available keeps "undecided" for string IDs.
    if (typeof choice === 'string' && !available.some((t) => t.id === choice)) {
      if (prefs.controlled !== undefined || prefs.defaultTrack !== undefined) this.pendingId = choice;
      choice = null;
    }
    this.selectedId = choice ?? null;
    if (this.selectedId) this.lastOnId = this.selectedId;
    this.apply();
  }

  /** A preferred ID that was not yet available when the initial selection ran. */
  private pendingId: string | null = null;

  /** Tracks changed (manifest update / external added): resolve pending selection. */
  refresh(): void {
    if (this.pendingId && this.list().some((t) => t.id === this.pendingId)) {
      this.selectedId = this.pendingId;
      this.lastOnId = this.pendingId;
      this.pendingId = null;
    }
    if (this.selectedId && !this.list().some((t) => t.id === this.selectedId)) {
      // Selected track disappeared (e.g. removed by the host): keep the
      // preference pending so it is restored if the track comes back.
      this.pendingId = this.selectedId;
      this.selectedId = null;
    }
    this.apply();
  }

  /** Explicit selection (user, host or API). `null` = off and stays off. */
  select(id: string | null): boolean {
    if (id !== null && !this.list().some((t) => t.id === id)) return false;
    this.pendingId = null;
    this.selectedId = id;
    if (id) this.lastOnId = id;
    this.apply();
    return true;
  }

  /** New content session: selection is decided again from preferences. */
  resetSelection(): void {
    this.selectedId = undefined;
    this.pendingId = null;
    this.lastOnId = null;
  }

  /** C hotkey: off ↔ last selected track. */
  toggleTarget(): string | null {
    if (this.selectedId) return null;
    const available = this.list();
    if (this.lastOnId && available.some((t) => t.id === this.lastOnId)) return this.lastOnId;
    return available[0]?.id ?? null;
  }

  /** Video-only presentation (iOS native fullscreen / PiP) needs native rendering. */
  setVideoOnlyPresentation(active: boolean): void {
    this.videoOnlyPresentation = active;
    this.apply();
  }

  private apply(): void {
    if (this.destroyed) return;
    const selected = this.selectedId ?? null;
    if (this.engineKind === 'shaka') {
      const engine = this.host.engine();
      if (!engine) return;
      const tracks = engine.getTextTracks();
      const target = selected === null ? null : (tracks.find((t) => t.externalId === selected) ?? tracks.find((t) => t.id === selected) ?? null);
      const active = tracks.find((t) => t.active) ?? null;
      if (target?.id !== active?.id || (target === null && active !== null)) engine.setTextTrack(target ? target.id : null);
      return;
    }
    if (this.engineKind === 'native') {
      const showNative = this.host.nativeUi() || this.videoOnlyPresentation;
      let activeTrack: TextTrack | null = null;
      for (const entry of this.external.values()) {
        const el = entry.element;
        if (!el) continue;
        const isSelected = entry.track.id === selected;
        const mode: TextTrackMode = isSelected ? (showNative ? 'showing' : 'hidden') : 'disabled';
        if (el.track.mode !== mode) el.track.mode = mode;
        if (isSelected) activeTrack = el.track;
      }
      if (!this.host.nativeUi()) {
        if (!this.renderer) this.renderer = new NativeCueRenderer(this.host.cueLayer);
        this.renderer.attach(activeTrack);
        this.renderer.setSuspended(showNative);
      } else {
        this.renderer?.attach(null);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.removeTrackElements();
    this.renderer?.destroy();
    this.renderer = null;
    for (const entry of this.external.values()) {
      if (typeof entry.track.src !== 'string') this.host.blobs.release(entry.track.src, `subtitle:${entry.track.id}`);
    }
    this.external.clear();
    this.destroyed = true;
  }
}
