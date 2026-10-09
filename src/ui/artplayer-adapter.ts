import type { FullscreenMode } from '../types/config.js';
import { format, type Translations } from './i18n.js';
import type { LiveUiState, MenuModel, MenuSection, UiActions, UiAdapter, UiConfig } from './ui-adapter.js';

// Artplayer ships a CommonJS-typed d.ts with `export default class`; under
// NodeNext the class is the module's `default` member.
type ArtplayerModule = typeof import('artplayer');
type ArtplayerClass = ArtplayerModule['default'];
type Art = InstanceType<ArtplayerClass>;

/** Sentinel source type: Artplayer must never assign `video.src` itself. */
const SENTINEL_TYPE = 'react-stream-player';
const MENU_NAMES = { quality: 'rsp-quality', audio: 'rsp-audio', subtitles: 'rsp-subtitles', speed: 'rsp-speed' } as const;

let artplayerPromise: Promise<ArtplayerClass> | null = null;
function loadArtplayer(): Promise<ArtplayerClass> {
  if (!artplayerPromise) {
    artplayerPromise = import('artplayer')
      .then((mod) => {
        const candidate = mod as unknown as { default?: ArtplayerClass };
        return (candidate.default ?? (mod as unknown as ArtplayerClass)) as ArtplayerClass;
      })
      .catch((error: unknown) => {
        artplayerPromise = null;
        throw error;
      });
  }
  return artplayerPromise;
}

function text(tag: 'span' | 'div', value: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

/** Maps package translations onto Artplayer's built-in string keys. */
function artI18n(t: Translations): Record<string, string> {
  return {
    Play: t.play,
    Pause: t.pause,
    Volume: t.audio,
    Mute: t.audio,
    'Show Setting': t.quality,
    'Hide Setting': t.quality,
    Fullscreen: t.fullscreen,
    'Exit Fullscreen': t.exitFullscreen,
    'Web Fullscreen': t.webFullscreen,
    'Exit Web Fullscreen': t.exitWebFullscreen,
    'PIP Mode': t.pictureInPicture,
    'Exit PIP Mode': t.pictureInPicture,
    'Play Speed': t.speed,
    Normal: t.normalSpeed,
    Close: t.dismiss,
    AirPlay: t.airplay,
  };
}

const CONTROL_LABEL_KEYS: Record<string, keyof Translations> = {
  setting: 'quality',
  pip: 'pictureInPicture',
  airplay: 'airplay',
};

/**
 * Artplayer 5.4.0 used purely as the presentation layer around the
 * controller-owned <video> (via the documented `proxy` option). Verified
 * vendor behaviours this adapter compensates for (see docs/architecture.md):
 *  - `url` setter without a customType assigns `video.src` and revokes the
 *    previous URL → a sentinel `type`/`customType` routes any such call away.
 *  - volume is persisted in localStorage → per-instance storage is replaced.
 *  - context-menu "version" links to artplayer.org with the page URL and the
 *    info panel shows `currentSrc` → both removed.
 *  - static globals (PLAYBACK_RATE, CONTEXTMENU, …) are never modified.
 */
export class ArtplayerAdapter implements UiAdapter {
  readonly kind = 'artplayer' as const;
  readonly fullscreenTarget: HTMLElement;
  readonly layerHost: HTMLElement;
  private config: UiConfig;
  private lastMenus: Record<string, string> = {};
  private lastCurrent: Record<string, string> = {};
  private destroyed = false;
  private clicks: number[] = [];
  private pointerType = 'mouse';
  private observer: MutationObserver | null = null;
  private liveControl: HTMLElement | null = null;
  private fullscreenControl: HTMLElement | null = null;
  private fullscreenState: { active: boolean; mode: FullscreenMode | null } = { active: false, mode: null };
  private duration: number | null = null;
  private adActive = false;
  private readonly cleanups: Array<() => void> = [];

  static async create(params: { container: HTMLElement; video: HTMLVideoElement; config: UiConfig; actions: UiActions; preload: string }): Promise<ArtplayerAdapter> {
    const Artplayer = await loadArtplayer();
    return new ArtplayerAdapter(Artplayer, params);
  }

  private readonly art: Art;
  private readonly actions: UiActions;
  private readonly video: HTMLVideoElement;
  private readonly container: HTMLElement;

  private constructor(Artplayer: ArtplayerClass, params: { container: HTMLElement; video: HTMLVideoElement; config: UiConfig; actions: UiActions; preload: string }) {
    const { container, video, config, actions } = params;
    this.config = config;
    this.actions = actions;
    this.video = video;
    this.container = container;
    const volume = video.volume;
    const muted = video.muted;
    const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
    const airplaySupported = typeof (window as { WebKitPlaybackTargetAvailabilityEvent?: unknown }).WebKitPlaybackTargetAvailabilityEvent !== 'undefined';
    this.art = new Artplayer({
      container: container as HTMLDivElement,
      url: '',
      type: SENTINEL_TYPE,
      customType: {
        // Never load: sources are owned by the controller's engines.
        [SENTINEL_TYPE]: () => undefined,
      },
      proxy: () => video,
      poster: config.poster ?? '',
      volume: volume || 0.0001,
      muted,
      autoplay: false,
      loop: false,
      setting: true,
      playbackRate: false,
      aspectRatio: false,
      flip: false,
      screenshot: false,
      hotkey: false,
      mutex: false,
      autoPlayback: false,
      autoMini: false,
      autoSize: false,
      fullscreen: false,
      fullscreenWeb: false,
      pip: config.pictureInPicture && pipSupported,
      airplay: config.airplay && airplaySupported,
      miniProgressBar: false,
      playsInline: true,
      lock: false,
      fastForward: false,
      autoOrientation: false,
      backdrop: true,
      lang: 'rsp',
      i18n: { rsp: artI18n(config.translations) },
      moreVideoAttr: { controls: false, preload: params.preload as 'metadata' },
    });
    const art = this.art;
    // Per-instance, in-memory storage: nothing is read from or written to
    // localStorage after construction (volume/position persistence disabled).
    const memory: Record<string, unknown> = {};
    const storage = (art as unknown as { storage: Record<string, unknown> }).storage;
    storage.get = (key?: string) => (key ? memory[key] : memory);
    storage.set = (key: string, value: unknown) => {
      memory[key] = value;
    };
    storage.del = (key: string) => {
      delete memory[key];
    };
    storage.clear = () => undefined;
    // Undo any vendor-cached volume read during construction.
    video.volume = volume;
    video.muted = muted;

    // Artplayer 5.4.0 reacts to `video:error` by re-assigning `option.url`
    // ('' here, so nothing reloads) and showing "Reconnect: N" notices — a
    // misleading duplicate of the package's own error/retry handling. Drop
    // that single internal listener on this instance's emitter.
    const emitterStore = (art as unknown as { e?: Record<string, unknown[]> }).e;
    if (emitterStore && Array.isArray(emitterStore['video:error'])) emitterStore['video:error'] = [];

    for (const name of ['version', 'info']) {
      try {
        art.contextmenu.remove(name);
      } catch {
        /* mobile: context menu is not initialised */
      }
    }
    const tpl = art.template as unknown as Record<string, HTMLElement>;
    tpl.$infoPanel?.querySelectorAll('[data-video="currentSrc"]').forEach((node) => node.parentElement?.remove());

    const player = tpl.$player as HTMLElement;
    this.fullscreenTarget = player;
    player.classList.add('rsp-art');
    const layerHost = document.createElement('div');
    layerHost.className = 'rsp-layers';
    player.appendChild(layerHost);
    this.layerHost = layerHost;

    // Artplayer adds `art-fullscreen` to EVERY instance on any fullscreen change;
    // correct it per instance after its handler ran.
    art.on('fullscreen', () => queueMicrotask(() => this.syncFullscreenClass()));

    this.installControls();
    this.installInputRouting();
    this.installAccessibility();
    this.applyContextMenu();
  }

  private syncFullscreenClass(): void {
    const el = document.fullscreenElement ?? (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
    this.fullscreenTarget.classList.toggle('art-fullscreen', el === this.fullscreenTarget);
  }

  private installControls(): void {
    const art = this.art;
    const t = this.config.translations;
    const icons = art.icons as unknown as Record<string, HTMLElement>;
    const live = text('span', t.live, 'rsp-live-label');
    // Control.add() does not return the element in 5.4.0; Component stores it as `controls[name]`.
    const controls = art.controls as unknown as { add(option: Record<string, unknown>): void } & Record<string, HTMLElement | undefined>;
    controls.add({
      name: 'rsp-live',
      position: 'left',
      index: 25,
      html: live,
      tooltip: t.goToLive,
      click: () => this.actions.seekToLive(),
    });
    this.liveControl = controls['rsp-live'] ?? null;
    if (this.liveControl) this.liveControl.style.display = 'none';
    if (this.fullscreenSupported()) {
      const wrap = document.createElement('span');
      wrap.className = 'rsp-fullscreen-icons';
      const on = icons.fullscreenOn?.cloneNode(true) ?? text('span', '⛶');
      const off = icons.fullscreenOff?.cloneNode(true) ?? text('span', '⛶');
      (on as HTMLElement).classList?.add('rsp-fs-on');
      (off as HTMLElement).classList?.add('rsp-fs-off');
      wrap.append(on, off);
      controls.add({
        name: 'rsp-fullscreen',
        position: 'right',
        index: 70,
        html: wrap,
        tooltip: this.config.fullscreenMode === 'web' ? t.webFullscreen : t.fullscreen,
        click: () => this.actions.toggleFullscreen(),
      });
      this.fullscreenControl = controls['rsp-fullscreen'] ?? null;
    }
  }

  private fullscreenSupported(): boolean {
    if (this.config.fullscreenMode === 'web') return true;
    const doc = document as { fullscreenEnabled?: boolean; webkitFullscreenEnabled?: boolean };
    const v = this.video as { webkitSupportsFullscreen?: boolean; webkitEnterFullscreen?: unknown };
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled || v.webkitSupportsFullscreen || typeof v.webkitEnterFullscreen === 'function');
  }

  /**
   * Single owner of video-area pointer input: single click toggles playback
   * (unless `preventClickToggle`), double click toggles the configured
   * fullscreen mode. Artplayer's own handler (which would call its internal
   * fullscreen) is bypassed for clicks on the video; control clicks are untouched.
   */
  private installInputRouting(): void {
    const root = this.container;
    const onPointerDown = (event: PointerEvent) => {
      this.pointerType = event.pointerType || 'mouse';
      this.actions.userGesture();
    };
    const onKeyDown = () => this.actions.userGesture();
    const onClick = (event: MouseEvent) => {
      this.actions.userGesture();
      if (event.target !== this.video) return;
      event.stopPropagation();
      const art = this.art as unknown as { emit(name: string, ...args: unknown[]): void; isFocus: boolean };
      art.isFocus = true;
      art.emit('focus', event);
      art.emit('click', event);
      const now = performance.now();
      this.clicks = this.clicks.filter((t) => now - t <= 300);
      this.clicks.push(now);
      const touch = this.pointerType === 'touch';
      if (this.clicks.length === 1) {
        if (!touch && !this.config.preventClickToggle) this.actions.togglePlay('video-click');
      } else {
        this.clicks = [];
        if (touch) {
          if (!this.config.preventClickToggle) this.actions.togglePlay('video-click');
        } else {
          this.actions.toggleFullscreen();
        }
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      // Disabled (or during a linear ad): let the browser's own menu appear.
      if (!this.config.contextMenu.enabled || this.adActive) event.stopPropagation();
    };
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('click', onClick, true);
    root.addEventListener('contextmenu', onContextMenu, true);
    this.cleanups.push(() => {
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('keydown', onKeyDown, true);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('contextmenu', onContextMenu, true);
    });
  }

  /** Accessibility pass over Artplayer's div-based controls and menus. */
  private installAccessibility(): void {
    const player = this.fullscreenTarget;
    const apply = () => {
      if (this.destroyed) return;
      const t = this.config.translations;
      player.querySelectorAll<HTMLElement>('.art-controls .art-control').forEach((el) => {
        if (el.dataset.rspA11y) return;
        el.dataset.rspA11y = '1';
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        const name = [...el.classList].find((c) => c.startsWith('art-control-'))?.slice('art-control-'.length) ?? '';
        if (!el.getAttribute('aria-label')) {
          const key = CONTROL_LABEL_KEYS[name];
          if (name === 'playAndPause') el.setAttribute('aria-label', `${t.play} / ${t.pause}`);
          else if (name === 'volume') el.setAttribute('aria-label', t.audio);
          else if (key) el.setAttribute('aria-label', String(t[key]));
        }
      });
      player.querySelectorAll<HTMLElement>('.art-setting-panel').forEach((panel) => panel.setAttribute('role', 'menu'));
      player.querySelectorAll<HTMLElement>('.art-setting-item').forEach((item) => {
        item.tabIndex = item.closest('.art-current') ? 0 : -1;
        const isOption = item.querySelector('.art-icon-check') !== null;
        item.setAttribute('role', isOption ? 'menuitemradio' : 'menuitem');
        if (isOption) item.setAttribute('aria-checked', String(item.classList.contains('art-current')));
        if (item.classList.contains('art-setting-item-back')) item.setAttribute('aria-label', t.dismiss);
      });
      const progress = player.querySelector<HTMLElement>('.art-control-progress');
      if (progress && !progress.dataset.rspA11y) {
        progress.dataset.rspA11y = '1';
        progress.setAttribute('role', 'slider');
        progress.tabIndex = 0;
        progress.setAttribute('aria-label', t.player);
        progress.setAttribute('aria-valuemin', '0');
      }
    };
    apply();
    this.observer = new MutationObserver(() => apply());
    this.observer.observe(player, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (target.classList.contains('art-control-progress')) {
        const step = this.config.seekStep;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          this.actions.seekBy(event.key === 'ArrowLeft' ? -step : step);
        }
        return;
      }
      if (target.classList.contains('art-setting-item')) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          target.click();
          queueMicrotask(() => this.focusCurrentMenu());
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const items = [...(target.parentElement?.querySelectorAll<HTMLElement>('.art-setting-item') ?? [])];
          const index = items.indexOf(target);
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.art.setting.show = false;
          player.querySelector<HTMLElement>('.art-control-setting')?.focus();
        }
        return;
      }
      if (target.getAttribute('role') === 'button' && target.classList.contains('art-control') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (target.classList.contains('art-control-playAndPause')) this.actions.togglePlay('control');
        else if (target.classList.contains('art-control-volume')) this.video.muted = !this.video.muted;
        else {
          target.click();
          if (target.classList.contains('art-control-setting')) queueMicrotask(() => this.focusCurrentMenu());
        }
      }
    };
    player.addEventListener('keydown', onKeyDown);
    const onTime = () => this.updateProgressAria();
    this.video.addEventListener('timeupdate', onTime);
    this.cleanups.push(() => {
      player.removeEventListener('keydown', onKeyDown);
      this.video.removeEventListener('timeupdate', onTime);
    });
  }

  private focusCurrentMenu(): void {
    const panel = this.fullscreenTarget.querySelector<HTMLElement>('.art-setting-panel.art-current');
    const first = panel?.querySelector<HTMLElement>('.art-setting-item:not(.art-setting-item-back)') ?? panel?.querySelector<HTMLElement>('.art-setting-item');
    first?.focus();
  }

  private updateProgressAria(): void {
    const progress = this.fullscreenTarget.querySelector<HTMLElement>('.art-control-progress');
    if (!progress) return;
    const current = this.video.currentTime;
    progress.setAttribute('aria-valuenow', String(Math.floor(current)));
    if (this.duration !== null) {
      progress.setAttribute('aria-valuemax', String(Math.floor(this.duration)));
      progress.setAttribute('aria-valuetext', `${formatTime(current)} / ${formatTime(this.duration)}`);
    } else {
      progress.removeAttribute('aria-valuemax');
      progress.setAttribute('aria-valuetext', formatTime(current));
    }
  }

  configure(config: UiConfig): void {
    const prev = this.config;
    this.config = config;
    if (prev.translations !== config.translations) {
      const i18n = (this.art as unknown as { i18n: { update(v: unknown): void } }).i18n;
      i18n.update({ rsp: artI18n(config.translations) });
      this.lastMenus = {};
      this.lastCurrent = {};
      const label = this.liveControl?.querySelector('.rsp-live-label');
      if (label) label.textContent = config.translations.live;
    }
    if (prev.poster !== config.poster) {
      (this.art as unknown as { poster: string }).poster = config.poster ?? '';
    }
    if (JSON.stringify(prev.contextMenu) !== JSON.stringify(config.contextMenu) || prev.loop !== config.loop || prev.translations !== config.translations || JSON.stringify(prev.playbackRates) !== JSON.stringify(config.playbackRates)) {
      this.applyContextMenu();
    }
    if (prev.fullscreenMode !== config.fullscreenMode) this.setFullscreen(this.fullscreenState);
  }

  private contextItems: string[] = [];

  private applyContextMenu(): void {
    const art = this.art;
    const contextmenu = art.contextmenu as unknown as { add(o: unknown): unknown; remove(name: string): void; show: boolean; cache?: Map<string, unknown> };
    for (const name of this.contextItems) {
      try {
        contextmenu.remove(name);
      } catch {
        /* not present */
      }
    }
    this.contextItems = [];
    if (!contextmenu.cache) return; // mobile: Artplayer has no context menu
    const { enabled, actions } = this.config.contextMenu;
    if (!enabled) return;
    const t = this.config.translations;
    const add = (name: string, html: HTMLElement, click: (event: Event) => void) => {
      contextmenu.add({ name, index: 1 + this.contextItems.length, html, click: (_menu: unknown, event: Event) => click(event) });
      this.contextItems.push(name);
    };
    if (actions.includes('playbackRate')) {
      const row = document.createElement('span');
      row.className = 'rsp-context-rates';
      row.appendChild(text('span', `${t.speed}:`));
      for (const rate of this.config.playbackRates) {
        const option = text('span', rate === 1 ? t.normalSpeed : `${rate}×`, 'rsp-context-rate');
        option.dataset.rate = String(rate);
        row.appendChild(option);
      }
      add('rsp-rate', row, (event) => {
        const rate = (event.target as HTMLElement).closest<HTMLElement>('[data-rate]')?.dataset.rate;
        if (rate) {
          this.actions.selectRate(Number(rate));
          contextmenu.show = false;
        }
      });
    }
    if (actions.includes('captions')) {
      add('rsp-captions', text('span', t.subtitles), () => {
        this.actions.toggleCaptions();
        contextmenu.show = false;
      });
    }
    if (actions.includes('fullscreen')) {
      add('rsp-fullscreen', text('span', t.fullscreen), () => {
        this.actions.toggleFullscreen();
        contextmenu.show = false;
      });
    }
    if (actions.includes('loop')) {
      add('rsp-loop', text('span', `${t.loop}${this.config.loop ? ' ✓' : ''}`), () => {
        this.actions.toggleLoop();
        contextmenu.show = false;
      });
    }
    if (actions.includes('copyDiagnostics')) {
      add('rsp-diagnostics', text('span', t.copyDiagnostics), () => {
        this.actions.copyDiagnostics();
        contextmenu.show = false;
      });
    }
  }

  setMenus(model: MenuModel): void {
    if (this.destroyed) return;
    const t = this.config.translations;
    this.applyMenu(MENU_NAMES.speed, t.speed, model.speed);
    this.applyMenu(MENU_NAMES.subtitles, t.subtitles, model.subtitles);
    this.applyMenu(MENU_NAMES.audio, t.audio, model.audio);
    this.applyMenu(MENU_NAMES.quality, t.quality, model.quality);
  }

  private applyMenu(name: string, title: string, section: MenuSection | null): void {
    const setting = this.art.setting as unknown as {
      find(name: string): (Record<string, unknown> & { selector?: Array<Record<string, unknown> & { $item?: HTMLElement }>; tooltip?: unknown }) | null;
      update(option: Record<string, unknown>): unknown;
      remove(name: string): void;
    };
    const existing = setting.find(name);
    if (!section || section.items.length < 2) {
      if (existing) setting.remove(name);
      delete this.lastMenus[name];
      delete this.lastCurrent[name];
      return;
    }
    const listKey = JSON.stringify(section.items.map((i) => [i.value, i.label]));
    if (existing && this.lastMenus[name] === listKey) {
      // Same options: update checkmarks and the current-value label in place
      // (re-rendering would close a submenu the viewer is browsing).
      section.items.forEach((item, index) => {
        const entry = existing.selector?.[index];
        if (!entry) return;
        entry.default = item.checked;
        entry.$item?.classList.toggle('art-current', item.checked);
        entry.$item?.setAttribute('aria-checked', String(item.checked));
      });
      if (this.lastCurrent[name] !== section.current) {
        existing.tooltip = text('span', section.current);
        this.lastCurrent[name] = section.current;
      }
      return;
    }
    this.lastMenus[name] = listKey;
    this.lastCurrent[name] = section.current;
    setting.update({
      name,
      html: text('span', title),
      tooltip: text('span', section.current),
      width: 260,
      selector: section.items.map((item, index) => ({
        name: `${name}-${index}`,
        html: text('span', item.label),
        default: item.checked,
        value: item.value,
      })),
      onSelect: (item: { value: string }) => {
        this.onMenuSelect(name, item.value);
        return text('span', section.current);
      },
    });
  }

  private onMenuSelect(name: string, value: string): void {
    switch (name) {
      case MENU_NAMES.quality:
        this.actions.selectQuality(value);
        break;
      case MENU_NAMES.audio:
        this.actions.selectAudio(value);
        break;
      case MENU_NAMES.subtitles:
        this.actions.selectSubtitle(value === '__off__' ? null : value);
        break;
      case MENU_NAMES.speed:
        this.actions.selectRate(Number(value));
        break;
    }
  }

  setLive(live: LiveUiState): void {
    const player = this.fullscreenTarget;
    player.classList.toggle('rsp-live', live.isLive);
    player.classList.toggle('rsp-live-behind', live.isLive && !live.atLiveEdge);
    if (this.liveControl) {
      this.liveControl.style.display = live.isLive ? '' : 'none';
      const t = this.config.translations;
      const label = live.isLive && !live.atLiveEdge && live.behindLiveEdge !== null ? format(t.behindLive, { seconds: Math.round(live.behindLiveEdge) }) : t.goToLive;
      this.liveControl.setAttribute('aria-label', label);
    }
  }

  setLoading(show: boolean): void {
    if (!this.destroyed) this.art.loading.show = show;
  }

  setDuration(duration: number | null): void {
    this.duration = duration;
    this.updateProgressAria();
  }

  setFullscreen(state: { active: boolean; mode: FullscreenMode | null }): void {
    this.fullscreenState = state;
    const control = this.fullscreenControl;
    if (!control) return;
    const t = this.config.translations;
    const active = state.active;
    control.classList.toggle('rsp-fs-active', active);
    control.setAttribute(
      'aria-label',
      active ? (state.mode === 'web' ? t.exitWebFullscreen : t.exitFullscreen) : this.config.fullscreenMode === 'web' ? t.webFullscreen : t.fullscreen,
    );
    control.setAttribute('aria-pressed', String(active));
    this.syncFullscreenClass();
    (this.art as unknown as { emit(name: string): void }).emit('resize');
  }

  setAdActive(active: boolean): void {
    this.adActive = active;
    if (active) {
      this.art.setting.show = false;
      (this.art.contextmenu as unknown as { show: boolean }).show = false;
    }
  }

  notice(message: string): void {
    if (!this.destroyed) (this.art.notice as unknown as { show: string }).show = message;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.layerHost.remove();
    // Artplayer.destroy() resets `template.$video` (REMOVE_SRC_WHEN_DESTROY is
    // a page-global static we must not change). Detach our element first and
    // point the template at a throwaway element so the reset cannot touch the
    // controller-owned video.
    const tpl = this.art.template as unknown as Record<string, unknown>;
    this.video.remove();
    tpl.$video = document.createElement('video');
    this.art.destroy(true);
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
