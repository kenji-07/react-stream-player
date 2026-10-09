import { playerError } from '../errors.js';
import type { FullscreenMode } from '../types/config.js';

export interface FullscreenState {
  active: boolean;
  mode: FullscreenMode | null;
  /** Browser fullscreen of the bare video element (iOS) — DOM overlays are not shown. */
  videoOnly: boolean;
}

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}
interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface WebkitVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
}

/** Only one player holds web fullscreen at a time (page-level). */
let webHolder: FullscreenManager | null = null;

interface SavedPageState {
  htmlOverflow: string;
  bodyOverflow: string;
  scrollX: number;
  scrollY: number;
  focus: HTMLElement | null;
}

/**
 * Browser fullscreen uses the Fullscreen API on the player element (with the
 * WebKit-prefixed API, then `webkitEnterFullscreen` on the video as a
 * video-only fallback). Web fullscreen expands the player with CSS inside the
 * page, locks page scroll, moves focus into the player and restores
 * everything on exit/unmount. State always reflects real browser events, so a
 * user's Escape or a rejected request is reported correctly.
 */
export class FullscreenManager {
  private state: FullscreenState = { active: false, mode: null, videoOnly: false };
  private saved: SavedPageState | null = null;
  private destroyed = false;
  private readonly onDocChange = () => this.syncFromDocument();
  private readonly onVideoBegin = () => this.update({ active: true, mode: 'browser', videoOnly: true });
  private readonly onVideoEnd = () => {
    if (this.state.videoOnly) this.update({ active: false, mode: null, videoOnly: false });
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.state.mode === 'web' && !event.defaultPrevented) {
      event.preventDefault();
      void this.cancel('web');
    }
  };

  constructor(
    /** Element made fullscreen (contains video, UI, captions and ad layers). */
    private readonly target: () => HTMLElement,
    /** Root that receives the web-fullscreen class. */
    private readonly root: HTMLElement,
    private readonly video: HTMLVideoElement,
    private readonly onChange: (state: FullscreenState) => void,
  ) {
    document.addEventListener('fullscreenchange', this.onDocChange);
    document.addEventListener('webkitfullscreenchange', this.onDocChange);
    video.addEventListener('webkitbeginfullscreen', this.onVideoBegin);
    video.addEventListener('webkitendfullscreen', this.onVideoEnd);
  }

  getState(): FullscreenState {
    return { ...this.state };
  }

  static browserSupported(video?: HTMLVideoElement): boolean {
    if (typeof document === 'undefined') return false;
    const doc = document as WebkitDocument;
    if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) return true;
    return Boolean((video as WebkitVideo | undefined)?.webkitSupportsFullscreen || typeof (video as WebkitVideo | undefined)?.webkitEnterFullscreen === 'function');
  }

  private fullscreenElement(): Element | null {
    const doc = document as WebkitDocument;
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  }

  private syncFromDocument(): void {
    const el = this.fullscreenElement();
    const ours = el !== null && (el === this.root || this.root.contains(el));
    if (ours && !(this.state.active && this.state.mode === 'browser')) {
      if (this.state.mode === 'web') this.exitWeb();
      this.update({ active: true, mode: 'browser', videoOnly: el === this.video });
    } else if (!ours && this.state.mode === 'browser' && !this.state.videoOnly) {
      this.update({ active: false, mode: null, videoOnly: false });
    }
  }

  private update(next: FullscreenState): void {
    const prev = this.state;
    if (prev.active === next.active && prev.mode === next.mode && prev.videoOnly === next.videoOnly) return;
    this.state = next;
    this.onChange({ ...next });
  }

  async request(mode: FullscreenMode, options: { fallbackToWeb?: boolean } = {}): Promise<void> {
    if (this.destroyed) throw playerError('player-destroyed', 'state');
    if (mode === 'web') return this.enterWeb();
    if (this.state.mode === 'browser' && this.state.active) return;
    const target = this.target() as WebkitElement;
    const video = this.video as WebkitVideo;
    try {
      if (typeof target.requestFullscreen === 'function' && (document as WebkitDocument).fullscreenEnabled !== false) {
        if (this.state.mode === 'web') this.exitWeb();
        await target.requestFullscreen();
      } else if (typeof target.webkitRequestFullscreen === 'function') {
        if (this.state.mode === 'web') this.exitWeb();
        await target.webkitRequestFullscreen();
      } else if (typeof video.webkitEnterFullscreen === 'function' && video.webkitSupportsFullscreen !== false) {
        // iPhone Safari: only the video element can go fullscreen.
        video.webkitEnterFullscreen();
      } else {
        throw playerError('fullscreen-unsupported', 'fullscreen');
      }
    } catch (error) {
      if (options.fallbackToWeb) return this.enterWeb();
      if ((error as { name?: string })?.name === 'PlayerError') throw error;
      throw playerError('fullscreen-rejected', 'fullscreen', { cause: error });
    }
    // Some engines resolve before the change event; state is driven by events.
    this.syncFromDocument();
  }

  async cancel(mode: FullscreenMode): Promise<void> {
    if (mode === 'web') {
      if (this.state.mode === 'web') this.exitWeb();
      return;
    }
    if (this.state.mode !== 'browser') return;
    const doc = document as WebkitDocument;
    const video = this.video as WebkitVideo;
    try {
      if (this.state.videoOnly && typeof video.webkitExitFullscreen === 'function') video.webkitExitFullscreen();
      else if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
      else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') await doc.webkitExitFullscreen();
    } catch (error) {
      throw playerError('fullscreen-rejected', 'fullscreen', { cause: error });
    }
  }

  async toggle(mode: FullscreenMode, options: { fallbackToWeb?: boolean } = {}): Promise<void> {
    if (this.state.active && this.state.mode === mode) return this.cancel(mode);
    if (this.state.active && this.state.mode !== mode) await this.cancel(this.state.mode!);
    return this.request(mode, options);
  }

  private enterWeb(): void {
    if (this.state.mode === 'web') return;
    if (this.state.mode === 'browser') throw playerError('fullscreen-rejected', 'fullscreen', { message: 'Exit browser fullscreen before entering web fullscreen.' });
    if (webHolder && webHolder !== this) webHolder.exitWeb();
    webHolder = this;
    const html = document.documentElement;
    this.saved = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: document.body.style.overflow,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    // Data attribute (not a class): React may own the root's className.
    this.root.dataset.rspWebFullscreen = '';
    document.addEventListener('keydown', this.onKeyDown, true);
    if (!this.root.contains(document.activeElement)) this.root.focus({ preventScroll: true });
    this.update({ active: true, mode: 'web', videoOnly: false });
  }

  private exitWeb(): void {
    if (this.state.mode !== 'web' && !('rspWebFullscreen' in this.root.dataset)) return;
    delete this.root.dataset.rspWebFullscreen;
    document.removeEventListener('keydown', this.onKeyDown, true);
    const saved = this.saved;
    this.saved = null;
    if (saved) {
      document.documentElement.style.overflow = saved.htmlOverflow;
      document.body.style.overflow = saved.bodyOverflow;
      window.scrollTo(saved.scrollX, saved.scrollY);
      if (saved.focus && saved.focus.isConnected) saved.focus.focus({ preventScroll: true });
    }
    if (webHolder === this) webHolder = null;
    this.update({ active: false, mode: null, videoOnly: false });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.exitWeb();
    if (this.state.mode === 'browser') void this.cancel('browser').catch(() => undefined);
    document.removeEventListener('fullscreenchange', this.onDocChange);
    document.removeEventListener('webkitfullscreenchange', this.onDocChange);
    this.video.removeEventListener('webkitbeginfullscreen', this.onVideoBegin);
    this.video.removeEventListener('webkitendfullscreen', this.onVideoEnd);
    this.destroyed = true;
  }
}
