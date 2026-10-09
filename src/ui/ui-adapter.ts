import type { ContextMenuAction, FullscreenMode, Layout } from '../types/config.js';
import type { TimeRange } from '../types/state.js';
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

/**
 * Everything the controls can ask for. The UI never changes the media element
 * itself: every request goes through the controller, which applies controlled
 * props, ad rules and live limits.
 */
export interface UiActions {
  togglePlay(source: 'video-click' | 'control' | 'keyboard'): void;
  seekTo(seconds: number): void;
  seekBy(delta: number): void;
  seekToLive(): void;
  setVolume(value: number): void;
  setMuted(muted: boolean): void;
  selectQuality(id: string): void;
  selectAudio(id: string): void;
  selectSubtitle(id: string | null): void;
  selectRate(rate: number): void;
  toggleFullscreen(): void;
  togglePictureInPicture(): void;
  showAirplayPicker(): void;
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
  layout: Layout;
  poster: string | null;
  contextMenu: { enabled: boolean; actions: ContextMenuAction[] };
  playbackRates: number[];
  fullscreenMode: FullscreenMode;
  pictureInPicture: boolean;
  airplay: boolean;
  /** `false` where the platform ignores programmatic volume (iOS): the slider is hidden. */
  volumeControl: boolean;
  preventClickToggle: boolean;
  loop: boolean;
  seekStep: number;
  /** Seconds behind the live edge still shown as "live". */
  liveEdgeTolerance: number;
}

export interface LiveUiState {
  isLive: boolean;
  atLiveEdge: boolean;
  behindLiveEdge: number | null;
  /** DVR window in media time; `null` when the stream has no seekable window. */
  seekableRange: TimeRange | null;
}

/** The package-owned controls. They never own playback or create media elements. */
export interface UiAdapter {
  /** Element used for browser fullscreen; contains the video, controls, captions and ad layers. */
  readonly fullscreenTarget: HTMLElement;
  /** Where the package mounts its layers (captions, ads, status, watermark). */
  readonly layerHost: HTMLElement;
  configure(config: UiConfig): void;
  setMenus(model: MenuModel): void;
  setLive(live: LiveUiState): void;
  setLoading(show: boolean): void;
  /** A fatal error panel is shown (content controls step aside). */
  setError(active: boolean): void;
  setFullscreen(state: { active: boolean; mode: FullscreenMode | null }): void;
  setAdActive(active: boolean): void;
  /** Cast control: shown only while devices are available (`cast.enabled`). */
  setCast(state: { available: boolean; connected: boolean }): void;
  /** AirPlay control: shown only while a target is available. */
  setAirplay(state: { available: boolean; active: boolean }): void;
  setDuration(duration: number | null): void;
  notice(text: string): void;
  destroy(): void;
}
