// Minimal local typings for the subset of the Google IMA HTML5 SDK used here.
// Verified against @types/google_interactive_media_ads_types 3.697.1 (see
// tests/unit/ima-types.test-d.ts). Kept local so the package's public type
// declarations do not depend on IMA types.

export interface ImaAd {
  getAdId(): string;
  getTitle(): string;
  getDuration(): number;
  getContentType(): string;
  isLinear(): boolean;
  getSkipTimeOffset(): number;
  getAdPodInfo(): { getTimeOffset(): number; getAdPosition(): number; getTotalAds(): number };
}

export interface ImaAdError {
  getErrorCode(): number;
  getMessage(): string;
  getType(): string;
}

export interface ImaAdErrorEvent {
  getError(): ImaAdError | null;
}

export interface ImaAdEvent {
  type: string;
  getAd(): ImaAd | null;
  getAdData(): Record<string, unknown> | null;
}

export interface ImaAdsManager {
  init(width: number, height: number, viewMode?: unknown): void;
  start(): void;
  pause(): void;
  resume(): void;
  skip(): void;
  resize(width: number, height: number, viewMode?: unknown): void;
  destroy(): void;
  setVolume(volume: number): void;
  getCuePoints(): number[];
  getAdSkippableState(): boolean;
  getRemainingTime(): number;
  addEventListener(type: string, listener: (event: ImaAdEvent & ImaAdErrorEvent) => void, useCapture?: boolean): void;
}

export interface ImaAdsManagerLoadedEvent {
  getAdsManager(contentPlayback: object, settings?: object): ImaAdsManager;
}

export interface ImaAdsLoader {
  addEventListener(type: string, listener: (event: ImaAdsManagerLoadedEvent & ImaAdErrorEvent) => void, useCapture?: boolean): void;
  requestAds(request: object, userRequestContext?: object): void;
  contentComplete(): void;
  destroy(): void;
}

export interface ImaAdDisplayContainer {
  initialize(): void;
  destroy(): void;
}

export interface ImaNamespace {
  AdDisplayContainer: new (container: Element, videoElement?: HTMLVideoElement, clickTrackingElement?: Element) => ImaAdDisplayContainer;
  AdsLoader: new (container: ImaAdDisplayContainer) => ImaAdsLoader;
  AdsRequest: new () => {
    adTagUrl: string;
    linearAdSlotWidth: number;
    linearAdSlotHeight: number;
    nonLinearAdSlotWidth: number;
    nonLinearAdSlotHeight: number;
    vastLoadTimeout: number;
    setAdWillAutoPlay(autoPlay: boolean): void;
    setAdWillPlayMuted(muted: boolean): void;
  };
  AdsRenderingSettings: new () => {
    loadVideoTimeout: number;
    mimeTypes: string[] | null;
    restoreCustomPlaybackStateOnAdBreakComplete: boolean;
  };
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: string } };
  AdErrorEvent: { Type: { AD_ERROR: string } };
  AdEvent: {
    Type: {
      CONTENT_PAUSE_REQUESTED: string;
      CONTENT_RESUME_REQUESTED: string;
      ALL_ADS_COMPLETED: string;
      STARTED: string;
      COMPLETE: string;
      SKIPPED: string;
      CLICK: string;
      AD_PROGRESS: string;
      PAUSED: string;
      RESUMED: string;
      LOADED: string;
    };
  };
  ViewMode?: { NORMAL: unknown };
}
