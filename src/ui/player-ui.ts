import type { FullscreenMode } from '../types/config.js';
import { el, formatTime, iconButton, listen, setHidden, setLabel, setPressed } from './dom.js';
import { format } from './i18n.js';
import { icons } from './icons.js';
import { ContextMenu, SettingsMenu, type ContextMenuItem, type SettingsEntry, type SettingsKey } from './menus.js';
import { Slider } from './slider.js';
import type { LiveUiState, MenuModel, UiActions, UiAdapter, UiConfig } from './ui-adapter.js';

/** Controls hide after this much inactivity while content plays. */
const HIDE_DELAY_MS = 3000;
const DOUBLE_TAP_MS = 300;
const SPINNER_DELAY_MS = 300;
const NOTICE_MS = 1600;

interface FullscreenSupportVideo extends HTMLVideoElement {
  webkitSupportsFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitShowPlaybackTargetPicker?: () => void;
}

/**
 * The package's own player controls, built around the controller-owned
 * <video>: progress/DVR slider with buffered ranges, play/pause, volume, time
 * and live indicators, captions toggle, a settings menu (quality, audio,
 * subtitles, speed), picture-in-picture, AirPlay, Cast, fullscreen, a big
 * play button, a loading spinner, notices and a context menu.
 *
 * It renders state and forwards requests to the controller (UiActions); it
 * never assigns a source or changes playback directly. Text is set with
 * textContent/attributes only. Controls auto-hide while content plays, show on
 * pointer movement, touch, focus and keyboard use, and stay visible while
 * paused or while a menu is open. During linear ads they are removed from view
 * and from the accessibility tree; the ad layer has its own controls.
 */
export class PlayerUi implements UiAdapter {
  readonly fullscreenTarget: HTMLElement;
  readonly layerHost: HTMLElement;

  private config: UiConfig;
  private readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly bigPlay: HTMLButtonElement;
  private readonly spinner: HTMLElement;
  private readonly noticeBox: HTMLElement;
  private readonly progress: Slider;
  private readonly volume: Slider;
  private readonly playButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly time: HTMLElement;
  private readonly liveButton: HTMLButtonElement;
  private readonly captionsButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly pipButton: HTMLButtonElement;
  private readonly airplayButton: HTMLButtonElement;
  private readonly castButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly settings: SettingsMenu;
  private readonly contextMenu: ContextMenu;

  private menus: MenuModel = { quality: null, audio: null, subtitles: null, speed: null };
  private live: LiveUiState = { isLive: false, atLiveEdge: false, behindLiveEdge: null, seekableRange: null };
  private duration: number | null = null;
  private fullscreen: { active: boolean; mode: FullscreenMode | null } = { active: false, mode: null };
  private cast = { available: false, connected: false };
  private airplay = { available: false, active: false };
  private adActive = false;
  private errorActive = false;
  private loading = false;
  private controlsVisible = true;
  private pointerOverControls = false;
  private lastPointerType = 'mouse';
  private lastTap = 0;
  private lastClick = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private spinnerTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(params: {
    container: HTMLElement;
    /** The focusable player region (keyboard use there shows the controls). */
    keyboardRoot: HTMLElement;
    video: HTMLVideoElement;
    config: UiConfig;
    actions: UiActions;
  }) {
    const { container, video, config } = params;
    this.keyboardRoot = params.keyboardRoot;
    this.config = config;
    this.video = video as FullscreenSupportVideo;
    this.actions = params.actions;
    const t = config.translations;

    this.root = el('div', 'rsp-ui');
    this.root.dataset.layout = config.layout;
    this.root.dataset.controls = 'visible';
    this.fullscreenTarget = this.root;
    video.controls = false;
    video.classList.add('rsp-video');
    this.root.appendChild(video);
    this.layerHost = el('div', 'rsp-layers');
    this.root.appendChild(this.layerHost);

    this.bigPlay = iconButton('rsp-big-play', t.play, icons.play());
    this.spinner = el('div', 'rsp-spinner');
    this.spinner.setAttribute('role', 'status');
    this.spinner.appendChild(el('span', 'rsp-visually-hidden', t.loading));
    this.spinner.hidden = true;
    this.noticeBox = el('div', 'rsp-notice');
    this.noticeBox.setAttribute('role', 'status');
    this.noticeBox.setAttribute('aria-live', 'polite');
    this.noticeBox.hidden = true;

    // Bottom bar.
    this.controls = el('div', 'rsp-controls');
    this.controls.setAttribute('role', 'group');
    this.controls.setAttribute('aria-label', t.controls);
    this.progress = new Slider({
      className: 'rsp-progress',
      label: t.seek,
      step: () => this.config.seekStep,
      pageStep: () => Math.max(this.config.seekStep, this.progressSpan() / 10),
      valueText: (value) => this.progressText(value),
      tooltipText: (value) => this.progressTooltip(value),
      onInput: (value) => this.renderTime(value),
      onCommit: (value) => {
        this.actions.seekTo(value);
        // Show where playback actually is (the seek may be clamped or refused).
        this.renderProgress();
      },
      onInteract: () => this.actions.userGesture(),
    });
    this.playButton = iconButton('rsp-play', t.play, icons.play());
    this.muteButton = iconButton('rsp-mute', t.mute, icons.volumeHigh());
    this.volume = new Slider({
      className: 'rsp-volume',
      label: t.volume,
      step: () => 0.05,
      pageStep: () => 0.2,
      valueText: (value) => `${Math.round(value * 100)}%`,
      tooltipText: null,
      onInput: (value) => this.applyVolume(value),
      onCommit: (value) => this.applyVolume(value),
      onInteract: () => this.actions.userGesture(),
    });
    this.volume.setRange(0, 1);
    this.time = el('span', 'rsp-time');
    this.time.setAttribute('aria-hidden', 'true');
    this.liveButton = el('button', 'rsp-button rsp-live-button');
    this.liveButton.type = 'button';
    this.liveButton.appendChild(el('span', 'rsp-live-dot'));
    this.liveButton.appendChild(el('span', 'rsp-live-label', t.live));
    this.liveButton.hidden = true;
    this.captionsButton = iconButton('rsp-captions', t.subtitles, icons.captions());
    this.settingsButton = iconButton('rsp-settings-button', t.settings, icons.settings());
    this.settingsButton.setAttribute('aria-haspopup', 'menu');
    this.settingsButton.setAttribute('aria-expanded', 'false');
    this.pipButton = iconButton('rsp-pip', t.pictureInPicture, icons.pip());
    this.airplayButton = iconButton('rsp-airplay', t.airplay, icons.airplay());
    this.castButton = iconButton('rsp-cast', t.cast, icons.cast());
    this.fullscreenButton = iconButton('rsp-fullscreen-button', t.fullscreen, icons.fullscreen());

    const volumeGroup = el('div', 'rsp-volume-group');
    volumeGroup.append(this.muteButton, this.volume.element);
    const left = el('div', 'rsp-control-group rsp-control-left');
    left.append(this.playButton, volumeGroup, this.time, this.liveButton);
    const right = el('div', 'rsp-control-group rsp-control-right');
    right.append(this.captionsButton, this.settingsButton, this.pipButton, this.airplayButton, this.castButton, this.fullscreenButton);
    const row = el('div', 'rsp-control-row');
    row.append(left, right);
    this.controls.append(this.progress.element, row);

    this.settings = new SettingsMenu(t.settings, this.settingsButton, (key, value) => this.onSettingsSelect(key, value));
    this.settings.setBackLabel(t.back);
    this.contextMenu = new ContextMenu(t.menu);

    this.root.append(this.bigPlay, this.spinner, this.noticeBox, this.controls, this.settings.element, this.contextMenu.element);
    container.appendChild(this.root);

    this.installListeners();
    this.applyStaticVisibility();
    this.applyPoster();
    this.renderAll();
    this.showControls();
  }

  private readonly video: FullscreenSupportVideo;
  private readonly actions: UiActions;
  private readonly keyboardRoot: HTMLElement;

  // ------------------------------------------------------------------ wiring

  private installListeners(): void {
    const v = this.video;
    const add = (off: () => void) => this.cleanups.push(off);
    for (const type of ['play', 'pause', 'playing', 'ended', 'emptied', 'loadedmetadata']) add(listen(v, type, () => this.renderPlayState()));
    add(listen(v, 'timeupdate', () => this.renderProgress()));
    add(listen(v, 'progress', () => this.renderBuffered()));
    add(listen(v, 'durationchange', () => this.renderProgress()));
    add(listen(v, 'volumechange', () => this.renderVolume()));
    add(listen(v, 'enterpictureinpicture', () => this.renderPip()));
    add(listen(v, 'leavepictureinpicture', () => this.renderPip()));

    add(listen(this.bigPlay, 'click', () => this.actions.togglePlay('control')));
    add(listen(this.playButton, 'click', () => this.actions.togglePlay('control')));
    // Muted or at volume 0 → audible again (the controller restores the last level).
    add(listen(this.muteButton, 'click', () => this.actions.setMuted(!(this.video.muted || this.video.volume === 0))));
    add(listen(this.liveButton, 'click', () => {
      if (!this.live.atLiveEdge) this.actions.seekToLive();
    }));
    add(listen(this.captionsButton, 'click', () => this.actions.toggleCaptions()));
    add(listen(this.settingsButton, 'click', () => this.settings.toggle()));
    add(listen(this.pipButton, 'click', () => this.actions.togglePictureInPicture()));
    add(listen(this.airplayButton, 'click', () => this.actions.showAirplayPicker()));
    add(listen(this.castButton, 'click', () => this.actions.toggleCast()));
    add(listen(this.fullscreenButton, 'click', () => this.actions.toggleFullscreen()));

    const root = this.root;
    // Any activation inside the player (IMA must initialise inside a user gesture).
    add(listen(root, 'pointerdown', (e) => this.onPointerDown(e), { capture: true }));
    add(listen(this.keyboardRoot, 'keydown', (e) => this.onKeyDown(e), { capture: true }));
    add(listen(root, 'click', (e) => this.onSurfaceClick(e)));
    add(listen(root, 'contextmenu', (e) => this.onContextMenu(e)));
    add(listen(root, 'pointermove', (e) => {
      if (e.pointerType === 'mouse') this.showControls();
    }));
    add(listen(root, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.scheduleHide(600);
    }));
    add(listen(this.controls, 'pointerenter', () => {
      this.pointerOverControls = true;
      this.showControls();
    }));
    add(listen(this.controls, 'pointerleave', () => {
      this.pointerOverControls = false;
      this.scheduleHide();
    }));
    add(listen(root, 'focusin', () => this.showControls()));
    add(listen(root, 'focusout', () => this.scheduleHide()));
  }

  private onPointerDown(event: PointerEvent): void {
    this.lastPointerType = event.pointerType || 'mouse';
    this.actions.userGesture();
  }

  private onKeyDown(event: KeyboardEvent): void {
    this.actions.userGesture();
    if (this.adActive) return;
    this.showControls();
    const contextKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (contextKey && this.config.contextMenu.enabled && !this.contextMenu.isOpen) {
      event.preventDefault();
      event.stopPropagation();
      const box = this.root.getBoundingClientRect();
      this.openContextMenu(box.width / 2, box.height / 2);
    }
  }

  /** Clicks on the picture (not on controls): play/pause, double click → fullscreen, touch tap → show/hide controls. */
  private onSurfaceClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const onSurface =
      target === this.video ||
      target === this.root ||
      (this.layerHost.contains(target) && !target.closest('button, a, [role="button"], .rsp-ad, .rsp-error'));
    if (!onSurface || this.adActive || this.errorActive) return;
    if (this.settings.isOpen || this.contextMenu.isOpen) return;
    const now = performance.now();
    if (this.lastPointerType === 'touch' || this.lastPointerType === 'pen') {
      if (now - this.lastTap <= DOUBLE_TAP_MS) {
        this.lastTap = 0;
        if (!this.config.preventClickToggle) this.actions.togglePlay('video-click');
        return;
      }
      this.lastTap = now;
      if (this.controlsVisible && !this.video.paused) this.hideControls();
      else this.showControls();
      return;
    }
    if (now - this.lastClick <= DOUBLE_TAP_MS) {
      this.lastClick = 0;
      this.actions.toggleFullscreen();
      return;
    }
    this.lastClick = now;
    if (!this.config.preventClickToggle) this.actions.togglePlay('video-click');
  }

  private onContextMenu(event: MouseEvent): void {
    // Disabled, or during a linear ad: the browser's own menu appears.
    if (!this.config.contextMenu.enabled || this.adActive || !this.config.contextMenu.actions.length) return;
    event.preventDefault();
    const box = this.root.getBoundingClientRect();
    this.openContextMenu(event.clientX - box.left, event.clientY - box.top);
  }

  private openContextMenu(x: number, y: number): void {
    // Focus returns where it was inside the player (the region itself after a right click).
    const active = document.activeElement;
    const returnFocus = active instanceof HTMLElement && this.keyboardRoot.contains(active) ? active : this.keyboardRoot;
    this.settings.close('api');
    this.contextMenu.setItems(this.contextItems());
    this.contextMenu.openAt(this.root, x, y, returnFocus);
    this.showControls();
  }

  private contextItems(): ContextMenuItem[] {
    const t = this.config.translations;
    const actions = this.config.contextMenu.actions;
    const items: ContextMenuItem[] = [];
    if (actions.includes('playbackRate')) {
      const current = this.video.playbackRate;
      for (const rate of this.config.playbackRates) {
        items.push({
          id: `rate-${rate}`,
          label: rate === 1 ? t.normalSpeed : `${rate}×`,
          role: 'menuitemradio',
          checked: Math.abs(rate - current) < 1e-6,
          group: t.speed,
          onSelect: () => this.actions.selectRate(rate),
        });
      }
    }
    if (actions.includes('captions') && this.menus.subtitles) {
      items.push({ id: 'captions', label: t.subtitles, role: 'menuitemcheckbox', checked: this.captionsOn(), onSelect: () => this.actions.toggleCaptions() });
    }
    if (actions.includes('fullscreen') && this.fullscreenSupported()) {
      items.push({ id: 'fullscreen', label: this.fullscreenLabel(), role: 'menuitem', onSelect: () => this.actions.toggleFullscreen() });
    }
    if (actions.includes('loop')) {
      items.push({ id: 'loop', label: t.loop, role: 'menuitemcheckbox', checked: this.config.loop, onSelect: () => this.actions.toggleLoop() });
    }
    if (actions.includes('copyDiagnostics')) {
      items.push({ id: 'diagnostics', label: t.copyDiagnostics, role: 'menuitem', onSelect: () => this.actions.copyDiagnostics() });
    }
    return items;
  }

  private onSettingsSelect(key: SettingsKey, value: string): void {
    switch (key) {
      case 'quality':
        this.actions.selectQuality(value);
        break;
      case 'audio':
        this.actions.selectAudio(value);
        break;
      case 'subtitles':
        this.actions.selectSubtitle(value === '__off__' ? null : value);
        break;
      case 'speed':
        this.actions.selectRate(Number(value));
        break;
    }
  }

  private applyVolume(value: number): void {
    this.actions.setVolume(value);
    if (value > 0 && this.video.muted) this.actions.setMuted(false);
    // Controlled volume may keep the element where it is: show the real level.
    this.renderVolume();
  }

  // ------------------------------------------------------------- visibility

  private showControls(): void {
    if (this.destroyed) return;
    if (!this.controlsVisible) {
      this.controlsVisible = true;
      this.root.dataset.controls = 'visible';
    }
    this.scheduleHide();
  }

  private hideControls(): void {
    if (this.destroyed || !this.canAutoHide()) return;
    this.controlsVisible = false;
    this.root.dataset.controls = 'hidden';
  }

  private canAutoHide(): boolean {
    if (this.video.paused || this.video.ended || this.settings.isOpen || this.contextMenu.isOpen || this.pointerOverControls || this.progress.isDragging || this.volume.isDragging) return false;
    // Keep visible while a control has keyboard focus.
    const active = document.activeElement;
    return !(active && this.controls.contains(active) && active.matches(':focus-visible'));
  }

  private scheduleHide(delay = HIDE_DELAY_MS): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.canAutoHide()) this.hideControls();
      else if (!this.video.paused) this.scheduleHide();
    }, delay);
  }

  // ---------------------------------------------------------------- render

  private renderAll(): void {
    this.renderPlayState();
    this.renderProgress();
    this.renderBuffered();
    this.renderVolume();
    this.renderPip();
    this.renderMenus();
    this.renderLive();
    this.renderFullscreen();
    this.renderRemote();
  }

  private renderPlayState(): void {
    const t = this.config.translations;
    const v = this.video;
    const ended = v.ended;
    const paused = v.paused;
    const label = ended ? t.replay : paused ? t.play : t.pause;
    setLabel(this.playButton, label);
    this.playButton.replaceChildren(ended ? icons.replay() : paused ? icons.play() : icons.pause());
    setLabel(this.bigPlay, ended ? t.replay : t.play);
    this.bigPlay.replaceChildren(ended ? icons.replay() : icons.play());
    this.root.dataset.state = ended ? 'ended' : paused ? 'paused' : 'playing';
    this.updateBigPlay();
    if (paused) this.showControls();
    else this.scheduleHide();
  }

  private updateBigPlay(): void {
    const hidden = !this.video.paused || this.adActive || this.errorActive || (this.loading && !this.video.paused);
    setHidden(this.bigPlay, hidden);
  }

  private progressSpan(): number {
    const range = this.progressRange();
    return range ? range.end - range.start : 0;
  }

  private progressRange(): { start: number; end: number } | null {
    if (this.live.isLive) return this.live.seekableRange && this.live.seekableRange.end - this.live.seekableRange.start > 1 ? this.live.seekableRange : null;
    const duration = this.duration ?? (Number.isFinite(this.video.duration) ? this.video.duration : null);
    return duration && duration > 0 ? { start: 0, end: duration } : null;
  }

  private progressText(value: number): string {
    const t = this.config.translations;
    if (this.live.isLive) {
      const behind = this.live.seekableRange ? Math.max(0, this.live.seekableRange.end - value) : 0;
      return behind <= this.config.liveEdgeTolerance ? t.live : format(t.behindLive, { seconds: Math.round(behind) });
    }
    const range = this.progressRange();
    return format(t.timeOf, { current: formatTime(value), duration: formatTime(range?.end ?? 0) });
  }

  private progressTooltip(value: number): string {
    if (this.live.isLive && this.live.seekableRange) {
      const behind = Math.max(0, this.live.seekableRange.end - value);
      return behind <= this.config.liveEdgeTolerance ? this.config.translations.live : `−${formatTime(behind)}`;
    }
    return formatTime(value);
  }

  private renderProgress(): void {
    const range = this.progressRange();
    setHidden(this.progress.element, !range);
    if (range) {
      this.progress.setRange(range.start, range.end);
      this.progress.setValue(this.video.currentTime);
    }
    if (!this.progress.isDragging) this.renderTime(this.video.currentTime);
  }

  private renderTime(current: number): void {
    if (this.live.isLive) {
      setHidden(this.time, true);
      return;
    }
    const range = this.progressRange();
    setHidden(this.time, false);
    const text = range ? `${formatTime(current)} / ${formatTime(range.end)}` : formatTime(current);
    if (this.time.textContent !== text) this.time.textContent = text;
  }

  private renderBuffered(): void {
    const ranges: Array<{ start: number; end: number }> = [];
    const buffered = this.video.buffered;
    for (let i = 0; i < buffered.length; i++) ranges.push({ start: buffered.start(i), end: buffered.end(i) });
    this.progress.setBuffered(ranges);
  }

  private renderVolume(): void {
    const t = this.config.translations;
    const v = this.video;
    const silent = v.muted || v.volume === 0;
    this.muteButton.replaceChildren(silent ? icons.volumeMuted() : v.volume < 0.5 ? icons.volumeLow() : icons.volumeHigh());
    setLabel(this.muteButton, silent ? t.unmute : t.mute);
    setPressed(this.muteButton, v.muted);
    this.volume.setValue(v.muted ? 0 : v.volume);
  }

  private renderPip(): void {
    const t = this.config.translations;
    const active = typeof document !== 'undefined' && document.pictureInPictureElement === this.video;
    setLabel(this.pipButton, active ? t.exitPictureInPicture : t.pictureInPicture);
    setPressed(this.pipButton, active);
  }

  private captionsOn(): boolean {
    const subs = this.menus.subtitles;
    return Boolean(subs && subs.items.some((item) => item.checked && item.value !== '__off__'));
  }

  private renderMenus(): void {
    const t = this.config.translations;
    const entries: SettingsEntry[] = [];
    const add = (key: SettingsKey, title: string, section: MenuModel[SettingsKey]) => {
      if (section && section.items.length >= 2) entries.push({ key, title, section });
    };
    add('quality', t.quality, this.menus.quality);
    add('audio', t.audio, this.menus.audio);
    add('subtitles', t.subtitles, this.menus.subtitles);
    add('speed', t.speed, this.menus.speed);
    this.settings.setEntries(entries);
    setHidden(this.settingsButton, entries.length === 0);
    const hasSubtitles = Boolean(this.menus.subtitles && this.menus.subtitles.items.length >= 2);
    setHidden(this.captionsButton, !hasSubtitles);
    setPressed(this.captionsButton, this.captionsOn());
  }

  private renderLive(): void {
    const t = this.config.translations;
    const live = this.live;
    setHidden(this.liveButton, !live.isLive);
    this.root.toggleAttribute('data-live', live.isLive);
    this.liveButton.classList.toggle('rsp-live-behind', live.isLive && !live.atLiveEdge);
    const label = live.isLive && !live.atLiveEdge && live.behindLiveEdge !== null ? `${t.goToLive} (${format(t.behindLive, { seconds: Math.round(live.behindLiveEdge) })})` : t.live;
    setLabel(this.liveButton, label);
    // aria-disabled (not disabled): the indicator stays focusable and announced.
    this.liveButton.setAttribute('aria-disabled', String(live.isLive && live.atLiveEdge));
    this.renderProgress();
  }

  private fullscreenSupported(): boolean {
    if (this.config.fullscreenMode === 'web') return true;
    const doc = document as { fullscreenEnabled?: boolean; webkitFullscreenEnabled?: boolean };
    const v = this.video;
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled || v.webkitSupportsFullscreen || typeof v.webkitEnterFullscreen === 'function');
  }

  private fullscreenLabel(): string {
    const t = this.config.translations;
    if (this.fullscreen.active) return this.fullscreen.mode === 'web' ? t.exitWebFullscreen : t.exitFullscreen;
    return this.config.fullscreenMode === 'web' ? t.webFullscreen : t.fullscreen;
  }

  private renderFullscreen(): void {
    setHidden(this.fullscreenButton, !this.fullscreenSupported());
    setLabel(this.fullscreenButton, this.fullscreenLabel());
    setPressed(this.fullscreenButton, this.fullscreen.active);
    this.fullscreenButton.replaceChildren(this.fullscreen.active ? icons.exitFullscreen() : icons.fullscreen());
    this.root.toggleAttribute('data-fullscreen', this.fullscreen.active);
  }

  private renderRemote(): void {
    const t = this.config.translations;
    setHidden(this.castButton, !this.cast.available);
    setPressed(this.castButton, this.cast.connected);
    setLabel(this.castButton, this.cast.connected ? t.stopCasting : t.cast);
    this.castButton.classList.toggle('rsp-active', this.cast.connected);
    setHidden(this.airplayButton, !(this.config.airplay && this.airplay.available));
    setPressed(this.airplayButton, this.airplay.active);
    this.airplayButton.classList.toggle('rsp-active', this.airplay.active);
  }

  private applyStaticVisibility(): void {
    const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled === true && typeof this.video.requestPictureInPicture === 'function';
    setHidden(this.pipButton, !(this.config.pictureInPicture && pipSupported));
    setHidden(this.volume.element, !this.config.volumeControl);
    this.root.dataset.layout = this.config.layout;
  }

  private applyPoster(): void {
    if (this.config.poster) this.video.poster = this.config.poster;
    else this.video.removeAttribute('poster');
  }

  private relabel(): void {
    const t = this.config.translations;
    setLabel(this.controls, t.controls);
    this.progress.setLabel(t.seek);
    this.volume.setLabel(t.volume);
    setLabel(this.captionsButton, t.subtitles);
    setLabel(this.settingsButton, t.settings);
    setLabel(this.airplayButton, t.airplay);
    this.settings.setLabel(t.settings);
    this.settings.setBackLabel(t.back);
    this.contextMenu.setLabel(t.menu);
    const spinnerLabel = this.spinner.querySelector('.rsp-visually-hidden');
    if (spinnerLabel) spinnerLabel.textContent = t.loading;
    const liveLabel = this.liveButton.querySelector('.rsp-live-label');
    if (liveLabel) liveLabel.textContent = t.live;
  }

  // ------------------------------------------------------------ UiAdapter

  configure(config: UiConfig): void {
    if (this.destroyed) return;
    const prev = this.config;
    this.config = config;
    if (prev.translations !== config.translations) this.relabel();
    if (prev.poster !== config.poster) this.applyPoster();
    this.applyStaticVisibility();
    if (this.contextMenu.isOpen) this.contextMenu.close('api');
    this.renderAll();
  }

  setMenus(model: MenuModel): void {
    if (this.destroyed) return;
    this.menus = model;
    this.renderMenus();
  }

  setLive(live: LiveUiState): void {
    if (this.destroyed) return;
    const prev = this.live;
    this.live = live;
    if (
      prev.isLive !== live.isLive ||
      prev.atLiveEdge !== live.atLiveEdge ||
      Math.round(prev.behindLiveEdge ?? -1) !== Math.round(live.behindLiveEdge ?? -1) ||
      prev.seekableRange?.start !== live.seekableRange?.start ||
      prev.seekableRange?.end !== live.seekableRange?.end
    ) {
      this.renderLive();
    }
  }

  setLoading(show: boolean): void {
    if (this.destroyed) return;
    this.loading = show;
    if (this.spinnerTimer) clearTimeout(this.spinnerTimer);
    // Debounced so short buffering transitions do not flash a spinner.
    this.spinnerTimer = setTimeout(() => {
      this.spinnerTimer = null;
      if (!this.destroyed) setHidden(this.spinner, !this.loading || this.adActive || this.errorActive);
    }, show ? SPINNER_DELAY_MS : 0);
    this.updateBigPlay();
  }

  setError(active: boolean): void {
    if (this.destroyed) return;
    this.errorActive = active;
    this.root.toggleAttribute('data-error', active);
    if (active) setHidden(this.spinner, true);
    this.updateBigPlay();
  }

  setFullscreen(state: { active: boolean; mode: FullscreenMode | null }): void {
    if (this.destroyed) return;
    this.fullscreen = { active: state.active, mode: state.mode };
    this.renderFullscreen();
  }

  setAdActive(active: boolean): void {
    if (this.destroyed) return;
    this.adActive = active;
    this.root.toggleAttribute('data-ad-active', active);
    // Content controls leave the accessibility tree during linear ads.
    this.controls.toggleAttribute('inert', active);
    this.controls.setAttribute('aria-hidden', String(active));
    if (active) {
      this.settings.close('api');
      this.contextMenu.close('api');
      setHidden(this.spinner, true);
    }
    this.updateBigPlay();
  }

  setCast(state: { available: boolean; connected: boolean }): void {
    if (this.destroyed) return;
    this.cast = { ...state };
    this.renderRemote();
  }

  setAirplay(state: { available: boolean; active: boolean }): void {
    if (this.destroyed) return;
    this.airplay = { ...state };
    this.renderRemote();
  }

  setDuration(duration: number | null): void {
    if (this.destroyed) return;
    this.duration = duration;
    this.renderProgress();
  }

  notice(text: string): void {
    if (this.destroyed) return;
    this.noticeBox.textContent = text;
    this.noticeBox.hidden = false;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.noticeBox.hidden = true;
    }, NOTICE_MS);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const timer of [this.hideTimer, this.spinnerTimer, this.noticeTimer]) if (timer) clearTimeout(timer);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.progress.destroy();
    this.volume.destroy();
    this.settings.destroy();
    this.contextMenu.destroy();
    // The controller owns the <video>: detach it before removing the UI.
    this.video.remove();
    this.root.remove();
  }
}

