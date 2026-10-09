import type { Locale } from '../types/config.js';
import type { PlayerErrorCategory } from '../types/errors.js';

/** Plain-text UI strings. Values are always inserted as text, never HTML. */
export interface Translations {
  player: string;
  play: string;
  pause: string;
  quality: string;
  auto: string;
  autoWithEffective: string; // "{quality}" placeholder
  audio: string;
  subtitles: string;
  subtitlesOff: string;
  speed: string;
  normalSpeed: string;
  fullscreen: string;
  exitFullscreen: string;
  webFullscreen: string;
  exitWebFullscreen: string;
  pictureInPicture: string;
  live: string;
  goToLive: string;
  behindLive: string; // "{seconds}" placeholder
  loading: string;
  retry: string;
  dismiss: string;
  advertisement: string;
  adCountdown: string; // "{seconds}" placeholder
  skipAd: string;
  skipAdIn: string; // "{seconds}" placeholder
  closeAd: string;
  learnMore: string;
  pauseAd: string;
  resumeAd: string;
  loop: string;
  copyDiagnostics: string;
  diagnosticsCopied: string;
  cast: string;
  airplay: string;
  errorTitle: string;
  errors: Record<PlayerErrorCategory, string>;
  unknownLanguage: string;
}

export const en: Translations = {
  player: 'Video player',
  play: 'Play',
  pause: 'Pause',
  quality: 'Quality',
  auto: 'Auto',
  autoWithEffective: 'Auto ({quality})',
  audio: 'Audio',
  subtitles: 'Subtitles',
  subtitlesOff: 'Off',
  speed: 'Speed',
  normalSpeed: 'Normal',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  webFullscreen: 'Expand player',
  exitWebFullscreen: 'Exit expanded player',
  pictureInPicture: 'Picture-in-picture',
  live: 'LIVE',
  goToLive: 'Go to live',
  behindLive: '{seconds}s behind live',
  loading: 'Loading',
  retry: 'Retry',
  dismiss: 'Dismiss',
  advertisement: 'Advertisement',
  adCountdown: 'Ad · {seconds}',
  skipAd: 'Skip ad',
  skipAdIn: 'Skip in {seconds}',
  closeAd: 'Close ad',
  learnMore: 'Learn more',
  pauseAd: 'Pause ad',
  resumeAd: 'Resume ad',
  loop: 'Loop',
  copyDiagnostics: 'Copy diagnostics',
  diagnosticsCopied: 'Diagnostics copied',
  cast: 'Cast',
  airplay: 'AirPlay',
  errorTitle: 'Playback error',
  errors: {
    network: 'A network problem interrupted playback. Check your connection and try again.',
    source: 'This video could not be loaded.',
    manifest: 'The video stream could not be loaded.',
    media: 'This video format is not supported or could not be decoded.',
    drm: 'This protected video cannot be played on this device or browser.',
    subtitle: 'Subtitles could not be loaded.',
    ads: 'The advertisement could not be played.',
    cast: 'Casting failed.',
    fullscreen: 'Fullscreen is not available.',
    pip: 'Picture-in-picture is not available.',
    capture: 'The frame could not be captured.',
    unsupported: 'This feature is not supported here.',
    config: 'The player is not configured correctly.',
    state: 'The player is not ready.',
    unexpected: 'Something went wrong during playback.',
  },
  unknownLanguage: 'Unknown',
};

export const mn: Translations = {
  player: 'Видео тоглуулагч',
  play: 'Тоглуулах',
  pause: 'Түр зогсоох',
  quality: 'Чанар',
  auto: 'Автомат',
  autoWithEffective: 'Автомат ({quality})',
  audio: 'Дуу',
  subtitles: 'Хадмал',
  subtitlesOff: 'Унтраах',
  speed: 'Хурд',
  normalSpeed: 'Хэвийн',
  fullscreen: 'Бүтэн дэлгэц',
  exitFullscreen: 'Бүтэн дэлгэцээс гарах',
  webFullscreen: 'Тоглуулагчийг томруулах',
  exitWebFullscreen: 'Томруулсан горимоос гарах',
  pictureInPicture: 'Зураг доторх зураг',
  live: 'ШУУД',
  goToLive: 'Шууд дамжуулалт руу',
  behindLive: 'Шууд дамжуулалтаас {seconds}с хоцорсон',
  loading: 'Ачаалж байна',
  retry: 'Дахин оролдох',
  dismiss: 'Хаах',
  advertisement: 'Сурталчилгаа',
  adCountdown: 'Сурталчилгаа · {seconds}',
  skipAd: 'Алгасах',
  skipAdIn: '{seconds} секундын дараа алгасна',
  closeAd: 'Сурталчилгааг хаах',
  learnMore: 'Дэлгэрэнгүй',
  pauseAd: 'Сурталчилгааг зогсоох',
  resumeAd: 'Сурталчилгааг үргэлжлүүлэх',
  loop: 'Давтах',
  copyDiagnostics: 'Оношилгоог хуулах',
  diagnosticsCopied: 'Оношилгоог хууллаа',
  cast: 'Дамжуулах',
  airplay: 'AirPlay',
  errorTitle: 'Тоглуулахад алдаа гарлаа',
  errors: {
    network: 'Сүлжээний асуудлаас болж тоглуулалт тасарлаа. Холболтоо шалгаад дахин оролдоно уу.',
    source: 'Энэ видеог ачаалж чадсангүй.',
    manifest: 'Видео урсгалыг ачаалж чадсангүй.',
    media: 'Энэ видеоны формат дэмжигдээгүй эсвэл задлах боломжгүй байна.',
    drm: 'Хамгаалагдсан энэ видеог энэ төхөөрөмж эсвэл хөтөч дээр тоглуулах боломжгүй.',
    subtitle: 'Хадмалыг ачаалж чадсангүй.',
    ads: 'Сурталчилгааг тоглуулж чадсангүй.',
    cast: 'Дамжуулалт амжилтгүй боллоо.',
    fullscreen: 'Бүтэн дэлгэц боломжгүй байна.',
    pip: 'Зураг доторх зураг боломжгүй байна.',
    capture: 'Кадрыг авч чадсангүй.',
    unsupported: 'Энэ боломж энд дэмжигдээгүй.',
    config: 'Тоглуулагчийн тохиргоо буруу байна.',
    state: 'Тоглуулагч бэлэн болоогүй байна.',
    unexpected: 'Тоглуулах явцад алдаа гарлаа.',
  },
  unknownLanguage: 'Тодорхойгүй',
};

export const LOCALES: Record<Locale, Translations> = { en, mn };

export type TranslationOverrides = Partial<Omit<Translations, 'errors'>> & { errors?: Partial<Translations['errors']> };

export function resolveTranslations(locale: Locale | undefined, overrides: TranslationOverrides | undefined): Translations {
  const base = LOCALES[locale ?? 'en'] ?? en;
  if (!overrides) return base;
  const out: Translations = { ...base, errors: { ...base.errors } };
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'errors') continue;
    if (typeof value === 'string') (out as unknown as Record<string, string>)[key] = value;
  }
  for (const [key, value] of Object.entries(overrides.errors ?? {})) {
    if (typeof value === 'string') out.errors[key as PlayerErrorCategory] = value;
  }
  return out;
}

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** Human-readable language name for a BCP-47 tag (used when a manifest omits labels). */
export function languageName(code: string | null | undefined, locale: Locale, unknown: string): string {
  if (!code || code === 'und') return unknown;
  try {
    const display = new Intl.DisplayNames([locale], { type: 'language' });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}
