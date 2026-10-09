import type { FullscreenMode } from '../types/config.js';
import type { LiveUiState, MenuModel, UiAdapter, UiConfig } from './ui-adapter.js';

/**
 * `ui="native"`: the browser's own controls. Menus, context menu and settings
 * are browser-owned and cannot be configured; quality/audio selection is
 * available through the API only. Captions are rendered natively so they
 * appear in the browser's caption menu.
 */
export class NativeUiAdapter implements UiAdapter {
  readonly kind = 'native' as const;
  readonly fullscreenTarget: HTMLElement;
  readonly layerHost: HTMLElement;
  private readonly spinner: HTMLElement;
  private destroyed = false;
  private loading = false;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly video: HTMLVideoElement,
    private config: UiConfig,
  ) {
    const frame = document.createElement('div');
    frame.className = 'rsp-native-frame';
    video.controls = true;
    video.classList.add('rsp-video');
    frame.appendChild(video);
    const layers = document.createElement('div');
    layers.className = 'rsp-layers';
    frame.appendChild(layers);
    this.spinner = document.createElement('div');
    this.spinner.className = 'rsp-spinner';
    this.spinner.setAttribute('role', 'status');
    this.spinner.hidden = true;
    const label = document.createElement('span');
    label.className = 'rsp-visually-hidden';
    label.textContent = config.translations.loading;
    this.spinner.appendChild(label);
    layers.appendChild(this.spinner);
    container.appendChild(frame);
    this.fullscreenTarget = frame;
    this.layerHost = layers;
    this.applyPoster();
  }

  private applyPoster(): void {
    if (this.config.poster) this.video.poster = this.config.poster;
    else this.video.removeAttribute('poster');
  }

  configure(config: UiConfig): void {
    const posterChanged = config.poster !== this.config.poster;
    this.config = config;
    if (posterChanged) this.applyPoster();
    const label = this.spinner.querySelector('.rsp-visually-hidden');
    if (label) label.textContent = config.translations.loading;
  }

  setMenus(_model: MenuModel): void {
    /* browser-owned menus */
  }

  setLive(_live: LiveUiState): void {
    /* browsers show their own live indication */
  }

  setLoading(show: boolean): void {
    this.loading = show;
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    // Debounced so short buffering transitions do not flash a spinner.
    this.loadingTimer = setTimeout(() => {
      if (!this.destroyed) this.spinner.hidden = !this.loading;
    }, show ? 300 : 0);
  }

  setFullscreen(_state: { active: boolean; mode: FullscreenMode | null }): void {
    /* no package-owned fullscreen button in native mode */
  }

  setAdActive(active: boolean): void {
    // Hide native controls during linear ads so content cannot be operated.
    this.video.controls = !active;
  }

  setDuration(): void {
    /* not needed */
  }

  notice(): void {
    /* no notice area in native mode */
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    this.video.controls = false;
    this.video.remove();
    this.fullscreenTarget.remove();
    void this.container;
  }
}
