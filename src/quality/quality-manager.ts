import type { NormalizedVariant } from '../controller/source.js';
import type { PlayerState } from '../types/state.js';
import type { QualitySelection, QualityTrack } from '../types/tracks.js';
import { format, type Translations } from '../ui/i18n.js';
import type { MenuSection } from '../ui/ui-adapter.js';

/**
 * Quality model shared by both engines.
 *
 * - Progressive MP4: each variant is one quality of the same video; there is
 *   no Auto (switching means loading another URL), and a single variant
 *   offers nothing to choose.
 * - HLS/DASH: qualities come from the manifest through the Shaka engine;
 *   `"auto"` re-enables ABR.
 *
 * The controller stays the single owner of engine loads; this module decides
 * WHAT to load and sequences progressive switches.
 */

/** Selectable qualities of a progressive source (empty for a single variant). */
export function progressiveQualities(variants: NormalizedVariant[]): QualityTrack[] {
  if (variants.length < 2) return [];
  return variants.map((v) => ({
    id: v.id,
    label: v.label,
    width: v.width,
    height: v.height,
    bitrate: v.bitrate,
    codecs: null,
    frameRate: null,
    kind: 'progressive' as const,
  }));
}

/**
 * Initial progressive variant: the requested `quality`/`defaultQuality` when
 * it exists; otherwise, when every variant declares a height, the largest one
 * not exceeding `targetHeight` (rendered height × devicePixelRatio), else the
 * smallest; otherwise the first variant. Never switches at runtime by itself.
 */
export function initialVariantId(variants: NormalizedVariant[], requested: string | undefined, targetHeight: number): string {
  if (requested && requested !== 'auto' && variants.some((v) => v.id === requested)) return requested;
  const withHeight = variants.filter((v) => v.height !== null);
  if (withHeight.length === variants.length && variants.length > 1) {
    const sorted = [...withHeight].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
    return (sorted.filter((v) => (v.height ?? 0) <= targetHeight).pop() ?? sorted[0]!).id;
  }
  return variants[0]!.id;
}

export function selectionFor(id: 'auto' | string, available: QualityTrack[]): QualitySelection {
  return { id, track: id === 'auto' ? null : (available.find((q) => q.id === id) ?? null) };
}

/** Returns why a quality request is invalid, or `null` when it can be applied. */
export function qualityRequestError(id: 'auto' | string, available: QualityTrack[], autoAvailable: boolean): string | null {
  if (id === 'auto') return autoAvailable ? null : 'Auto quality is only available for adaptive (HLS/DASH) sources.';
  return available.some((q) => q.id === id) ? null : 'Unknown quality id.';
}

/** The prebuilt UI's quality menu, or `null` when there is nothing to choose. */
export function qualityMenuSection(quality: PlayerState['quality'], t: Translations): MenuSection | null {
  if (!(quality.available.length > 1 || (quality.autoAvailable && quality.available.length > 0))) return null;
  const items = quality.available.map((q) => ({ value: q.id, label: q.label, checked: quality.selected === q.id }));
  if (quality.autoAvailable) items.unshift({ value: 'auto', label: t.auto, checked: quality.selected === 'auto' });
  const current =
    quality.selected === 'auto'
      ? quality.effective
        ? format(t.autoWithEffective, { quality: quality.effective.label })
        : t.auto
      : (quality.available.find((q) => q.id === quality.selected)?.label ?? '');
  return { items, current };
}

export interface ProgressiveSwitch {
  /** Generation of this switch; only the latest one may finish. */
  readonly gen: number;
  /** Variant selected before this switch (fallback target on failure). */
  readonly previous: string | null;
  /** Content position to restore after loading. */
  readonly position: number;
}

/**
 * Tracks the selected progressive variant and sequences switches: the last
 * selection wins, and while an earlier switch is still loading (the element's
 * `currentTime` is meaningless then) every later switch restores the position
 * captured by the first one.
 */
export class ProgressiveQualityState {
  private selected: string | null = null;
  private gen = 0;
  private inFlight: number | null = null;

  get current(): string | null {
    return this.selected;
  }

  /** Position captured by a switch that is still loading, if any. */
  get inFlightPosition(): number | null {
    return this.inFlight;
  }

  /** New content session (or non-progressive source): pending switches become stale. */
  reset(selected: string | null): void {
    this.selected = selected;
    this.inFlight = null;
    this.gen++;
  }

  /** Re-selects without starting a switch (e.g. the variant list changed on refresh). */
  set(selected: string): void {
    this.selected = selected;
  }

  begin(id: string, currentPosition: number): ProgressiveSwitch {
    const position = this.inFlight ?? currentPosition;
    const started: ProgressiveSwitch = { gen: ++this.gen, previous: this.selected, position };
    this.inFlight = position;
    this.selected = id;
    return started;
  }

  isLatest(change: ProgressiveSwitch): boolean {
    return change.gen === this.gen;
  }

  /** The latest switch finished loading (successfully or not). */
  settle(change: ProgressiveSwitch): void {
    if (this.isLatest(change)) this.inFlight = null;
  }
}
