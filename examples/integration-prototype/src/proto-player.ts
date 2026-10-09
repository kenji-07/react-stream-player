// Integration prototype: proves that Artplayer 5.4.0 can be used purely as the
// presentation layer around a controller-owned <video> element, while playback
// is owned by either a native progressive-MP4 path or a Shaka Player 5.2.12
// engine. This file intentionally exercises vendor APIs directly; the package
// re-implements the same approach with full lifecycle handling.
import Artplayer from 'artplayer';

export type ProtoSource =
  | { kind: 'mp4'; variants: { id: string; src: string; label: string; height: number }[]; defaultId: string }
  | { kind: 'shaka'; src: string; mimeType: string };

export interface ProtoOptions {
  container: HTMLElement;
  source: ProtoSource;
  layout?: 'standard' | 'reel';
  fit?: string;
  subtitles?: { id: string; src: string; label: string; language: string }[];
}

interface Track {
  id: string;
  label: string;
  active: boolean;
}

export const counters = {
  engineCreated: 0,
  engineDestroyed: 0,
  shakaCreated: 0,
  shakaDestroyed: 0,
  loads: 0,
  artCreated: 0,
  artDestroyed: 0,
};

function textEl(text: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

export class ProtoPlayer {
  readonly video: HTMLVideoElement;
  readonly art: Artplayer;
  private shaka: any = null;
  private destroyed = false;
  private mp4Current: string | null = null;
  private switchGen = 0;
  private extTracks = new Map<string, HTMLTrackElement>();

  constructor(private readonly opts: ProtoOptions) {
    counters.engineCreated++;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'metadata';
    this.video.crossOrigin = 'anonymous';
    // Fit applies to the actual video element, not the container.
    this.video.style.objectFit = opts.fit ?? 'contain';
    this.video.style.objectPosition = '50% 50%';

    const root = opts.container;
    root.classList.toggle('proto-reel', opts.layout === 'reel');

    this.art = new Artplayer({
      container: root as HTMLDivElement,
      url: '',
      // Route any vendor-initiated URL change to the controller instead of
      // letting Artplayer assign video.src (and revoke object URLs).
      type: 'rsp',
      customType: {
        rsp: () => {
          throw new Error('Artplayer must not load sources in this integration');
        },
      },
      proxy: () => this.video,
      setting: true,
      playbackRate: false,
      aspectRatio: false,
      hotkey: false,
      mutex: false,
      autoPlayback: false,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      volume: 0.7,
      settings: [],
    });
    counters.artCreated++;
    // Artplayer persists volume in localStorage; replace the per-instance
    // storage so nothing is read or written after construction.
    const memory: Record<string, unknown> = {};
    const storage = (this.art as any).storage;
    storage.get = (key?: string) => (key ? memory[key] : memory);
    storage.set = (key: string, value: unknown) => {
      memory[key] = value;
    };
    storage.del = (key: string) => {
      delete memory[key];
    };
    storage.clear = () => undefined;
    this.video.volume = 0.7;
    // Remove the context-menu entries that would link to artplayer.org with
    // the page URL and display video.currentSrc (may contain signed tokens).
    for (const name of ['version', 'info']) {
      try {
        this.art.contextmenu.remove(name);
      } catch {
        /* mobile: contextmenu not initialised */
      }
    }
  }

  async load(): Promise<void> {
    counters.loads++;
    const { source } = this.opts;
    if (source.kind === 'mp4') {
      const v = source.variants.find((x) => x.id === source.defaultId) ?? source.variants[0];
      this.mp4Current = v.id;
      this.video.src = v.src;
      await new Promise<void>((resolve, reject) => {
        this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        this.video.addEventListener('error', () => reject(new Error('mp4 error')), { once: true });
      });
    } else {
      const mod: any = await import('shaka-player');
      const shaka = mod.default ?? mod;
      if (this.destroyed) return;
      shaka.polyfill.installAll();
      const player = new shaka.Player();
      counters.shakaCreated++;
      this.shaka = player;
      // UITextDisplayer renders inside the Artplayer DOM so captions stay in
      // the container-fullscreen subtree. Shaka's default textDisplayFactory
      // only picks UITextDisplayer if the container is set before attach().
      const textContainer = document.createElement('div');
      textContainer.className = 'proto-text-container';
      this.art.template.$player.appendChild(textContainer);
      player.setVideoContainer(textContainer);
      await player.attach(this.video);
      player.addEventListener('trackschanged', () => this.refreshMenus());
      player.addEventListener('variantchanged', () => this.refreshMenus());
      player.addEventListener('adaptation', () => this.refreshMenus());
      player.addEventListener('textchanged', () => this.refreshMenus());
      await player.load(source.src, null, source.mimeType);
    }
    for (const sub of this.opts.subtitles ?? []) await this.addExternalSubtitle(sub);
    this.refreshMenus();
  }

  private async addExternalSubtitle(sub: { id: string; src: string; label: string; language: string }) {
    if (this.shaka) {
      await this.shaka.addTextTrackAsync(sub.src, sub.language, 'subtitles', 'text/vtt', undefined, sub.label);
    } else {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.label;
      track.srclang = sub.language;
      track.src = sub.src;
      track.dataset.rspId = sub.id;
      this.video.appendChild(track);
      track.track.mode = 'disabled';
      this.extTracks.set(sub.id, track);
    }
  }

  qualities(): Track[] {
    const source = this.opts.source;
    if (source.kind === 'mp4') {
      return source.variants.map((v) => ({ id: v.id, label: v.label, active: v.id === this.mp4Current }));
    }
    if (!this.shaka) return [];
    const abr = this.shaka.getConfiguration().abr.enabled;
    const tracks = this.shaka.getVideoTracks() as any[];
    const out: Track[] = [{ id: 'auto', label: 'Auto', active: abr }];
    for (const t of tracks) {
      out.push({ id: videoId(t), label: `${t.height}p`, active: !abr && t.active });
    }
    return out;
  }

  effectiveHeight(): number | null {
    if (this.shaka) return (this.shaka.getVideoTracks() as any[]).find((t) => t.active)?.height ?? null;
    return this.video.videoHeight || null;
  }

  async setQuality(id: string): Promise<void> {
    const source = this.opts.source;
    if (source.kind === 'mp4') {
      const v = source.variants.find((x) => x.id === id);
      if (!v || v.id === this.mp4Current) return;
      const gen = ++this.switchGen;
      const video = this.video;
      const state = {
        time: video.currentTime,
        paused: video.paused,
        rate: video.playbackRate,
        volume: video.volume,
        muted: video.muted,
      };
      // Preserve caption selection: textTracks keep their mode across src
      // changes because <track> children are untouched.
      video.src = v.src;
      this.mp4Current = v.id;
      await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
      if (gen !== this.switchGen || this.destroyed) return; // last selection wins
      video.currentTime = Math.min(state.time, Math.max(0, video.duration - 0.1));
      video.playbackRate = state.rate;
      video.volume = state.volume;
      video.muted = state.muted;
      if (!state.paused) await video.play().catch(() => undefined);
      this.refreshMenus();
      return;
    }
    if (!this.shaka) return;
    if (id === 'auto') {
      this.shaka.configure({ abr: { enabled: true } });
    } else {
      const track = (this.shaka.getVideoTracks() as any[]).find((t) => videoId(t) === id);
      if (!track) return;
      this.shaka.configure({ abr: { enabled: false } });
      this.shaka.selectVideoTrack(track, /* clearBuffer= */ true);
    }
    this.refreshMenus();
  }

  audioTracks(): Track[] {
    if (!this.shaka) return [];
    return (this.shaka.getAudioTracks() as any[]).map((t) => ({
      id: `${t.language}|${t.label ?? ''}|${t.channelsCount ?? ''}`,
      label: t.label || languageName(t.language),
      active: t.active,
    }));
  }

  setAudio(id: string): void {
    const t = (this.shaka?.getAudioTracks() as any[] | undefined)?.find(
      (x) => `${x.language}|${x.label ?? ''}|${x.channelsCount ?? ''}` === id,
    );
    if (t) this.shaka.selectAudioTrack(t);
    this.refreshMenus();
  }

  textTracks(): Track[] {
    if (this.shaka) {
      return (this.shaka.getTextTracks() as any[]).map((t) => ({
        id: `shaka-${t.id}`,
        label: t.label || languageName(t.language),
        active: t.active,
      }));
    }
    return [...this.extTracks.entries()].map(([id, el]) => ({ id, label: el.label, active: el.track.mode === 'showing' }));
  }

  setText(id: string | null): void {
    if (this.shaka) {
      if (id === null) this.shaka.selectTextTrack(null);
      else {
        const t = (this.shaka.getTextTracks() as any[]).find((x) => `shaka-${x.id}` === id);
        if (t) this.shaka.selectTextTrack(t);
      }
    } else {
      for (const [tid, el] of this.extTracks) el.track.mode = tid === id ? 'showing' : 'disabled';
    }
    this.refreshMenus();
  }

  /** Registers/updates plain-text selectors in Artplayer's existing settings panel. */
  refreshMenus(): void {
    if (this.destroyed) return;
    const q = this.qualities();
    const qActive = q.find((x) => x.active);
    const effective = this.effectiveHeight();
    this.art.setting.update({
      name: 'proto-quality',
      html: textEl('Quality'),
      tooltip: textEl(qActive?.id === 'auto' && effective ? `Auto (${effective}p)` : (qActive?.label ?? '')),
      selector: q.map((t) => ({ html: textEl(t.label), default: t.active, value: t.id })),
      onSelect: (item: any) => {
        void this.setQuality(item.value);
        return item.html;
      },
    });
    const a = this.audioTracks();
    if (a.length > 1) {
      this.art.setting.update({
        name: 'proto-audio',
        html: textEl('Audio'),
        tooltip: textEl(a.find((x) => x.active)?.label ?? ''),
        selector: a.map((t) => ({ html: textEl(t.label), default: t.active, value: t.id })),
        onSelect: (item: any) => {
          this.setAudio(item.value);
          return item.html;
        },
      });
    }
    const s = this.textTracks();
    if (s.length) {
      const off = { html: textEl('Off'), default: !s.some((x) => x.active), value: '__off__' };
      this.art.setting.update({
        name: 'proto-subtitles',
        html: textEl('Subtitles'),
        tooltip: textEl(s.find((x) => x.active)?.label ?? 'Off'),
        selector: [off, ...s.map((t) => ({ html: textEl(t.label), default: t.active, value: t.id }))],
        onSelect: (item: any) => {
          this.setText(item.value === '__off__' ? null : item.value);
          return item.html;
        },
      });
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.switchGen++;
    if (this.shaka) {
      const p = this.shaka;
      this.shaka = null;
      await p.destroy();
      counters.shakaDestroyed++;
    }
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    for (const el of this.extTracks.values()) el.remove();
    this.art.destroy(true);
    counters.artDestroyed++;
    counters.engineDestroyed++;
  }
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function videoId(t: any): string {
  // VideoTrack has no id field in Shaka 5; derive a stable identity from
  // properties that distinguish renditions (height alone is not unique).
  return ['v', t.width, t.height, t.bandwidth, t.frameRate ?? '', t.codecs ?? ''].join('-');
}
