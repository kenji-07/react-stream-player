// Type-level conformance: the local IMA typings (src/ads/ima-types.ts) must be
// satisfied by the official SDK typings (@types/google_interactive_media_ads_types),
// so every member the pipeline calls exists with a compatible signature.
// Checked by `npm run typecheck` (tests/tsconfig.json); there is no runtime part.
import type { ImaAd, ImaAdError, ImaAdsManager, ImaNamespace } from '../../src/ads/ima-types.js';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

// Objects returned by the SDK.
export type AdConforms = Assert<Extends<google.ima.Ad, ImaAd>>;
export type AdErrorConforms = Assert<Extends<google.ima.AdError, ImaAdError>>;
// addEventListener is declared with per-event overloads in the SDK typings; the
// pipeline registers one listener per documented event type (checked below).
export type AdsManagerConforms = Assert<Extends<Omit<google.ima.AdsManager, 'addEventListener'>, Omit<ImaAdsManager, 'addEventListener'>>>;

// Constructors and settings objects the pipeline creates.
export type AdsRequestConforms = Assert<Extends<google.ima.AdsRequest, InstanceType<ImaNamespace['AdsRequest']>>>;
export type RenderingSettingsConforms = Assert<Extends<google.ima.AdsRenderingSettings, InstanceType<ImaNamespace['AdsRenderingSettings']>>>;
export type DisplayContainerConforms = Assert<Extends<google.ima.AdDisplayContainer, InstanceType<ImaNamespace['AdDisplayContainer']>>>;
export type DisplayContainerArgs = Assert<Extends<ConstructorParameters<ImaNamespace['AdDisplayContainer']>, ConstructorParameters<typeof google.ima.AdDisplayContainer>>>;

// Every event type name the pipeline listens for exists in the SDK enums.
type LocalAdEventTypes = keyof ImaNamespace['AdEvent']['Type'];
export type AdEventTypesExist = Assert<Extends<LocalAdEventTypes, keyof typeof google.ima.AdEvent.Type>>;
export type AdErrorEventTypeExists = Assert<Extends<keyof ImaNamespace['AdErrorEvent']['Type'], keyof typeof google.ima.AdErrorEvent.Type>>;
export type ManagerLoadedTypeExists = Assert<Extends<keyof ImaNamespace['AdsManagerLoadedEvent']['Type'], keyof typeof google.ima.AdsManagerLoadedEvent.Type>>;
