import type { ContextMenuAction, FullscreenMode } from '../types/config.js';
import type { Translations } from './i18n.js';

export interface MenuItem {
  value: string;
  label: string;
  checked: boolean;
}

export interface MenuSection {
  items: MenuItem[];
  /** Plain text shown next to the menu entry (current value). */
  current: string;
}

export interface MenuModel {
  quality: MenuSection | null;
  audio: MenuSection | null;
  subtitles: MenuSection | null;
  speed: MenuSection | null;
}

export interface UiActions {
  togglePlay(source: 'video-click' | 'control' | 'keyboard'): void;
  selectQuality(id: string): void;
  selectAudio(id: string): void;
  selectSubtitle(id: string | null): void;
  selectRate(rate: number): void;
  toggleFullscreen(): void;
  seekBy(delta: number): void;
  seekToLive(): void;
  toggleLoop(): void;
  toggleCaptions(): void;
  copyDiagnostics(): void;
  /** Start casting, or stop when connected. */
  toggleCast(): void;
  /** Synchronous hook for any user activation inside the player (IMA initialize). */
  userGesture(): void;
}

export interface UiConfig {
  translations: Translations;
  locale: string;
  poster: string | null;
  contextMenu: { enabled: boolean; actions: ContextMenuAction[] };
  playbackRates: number[];
  fullscreenMode: FullscreenMode;
  pictureInPicture: boolean;
  airplay: boolean;
  preventClickToggle: boolean;
  loop: boolean;
  seekStep: number;
}

export interface LiveUiState {
  isLive: boolean;
  atLiveEdge: boolean;
  behindLiveEdge: number | null;
  seekable: boolean;
}

/** The prebuilt UI layer. It never owns playback or creates media elements. */
export interface UiAdapter {
  readonly kind: 'artplayer' | 'native';
  /** Element used for browser fullscreen; contains the video, controls, captions and ad layers. */
  readonly fullscreenTarget: HTMLElement;
  /** Where the package mounts its minimal layers (captions, ads, status, watermark). */
  readonly layerHost: HTMLElement;
  configure(config: UiConfig): void;
  setMenus(model: MenuModel): void;
  setLive(live: LiveUiState): void;
  setLoading(show: boolean): void;
  setFullscreen(state: { active: boolean; mode: FullscreenMode | null }): void;
  setAdActive(active: boolean): void;
  /** Cast control: shown only while devices are available (`cast.enabled`). */
  setCast(state: { available: boolean; connected: boolean }): void;
  setDuration(duration: number | null): void;
  notice(text: string): void;
  destroy(): void;
}
