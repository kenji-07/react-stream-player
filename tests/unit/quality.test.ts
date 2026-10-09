import { describe, expect, it } from 'vitest';
import type { NormalizedVariant } from '../../src/controller/source.js';
import {
  initialVariantId,
  ProgressiveQualityState,
  progressiveQualities,
  qualityMenuSection,
  qualityRequestError,
  selectionFor,
} from '../../src/quality/quality-manager.js';
import type { PlayerState } from '../../src/types/state.js';
import { en } from '../../src/ui/i18n.js';

const variant = (id: string, height: number | null): NormalizedVariant => ({ id, input: `/${id}.mp4`, label: id, height, width: null, bitrate: null, mimeType: null });
const V = [variant('360p', 360), variant('720p', 720), variant('1080p', 1080)];

describe('progressive qualities', () => {
  it('lists variants as progressive qualities; a single variant offers no choice', () => {
    expect(progressiveQualities(V).map((q) => [q.id, q.kind])).toEqual([
      ['360p', 'progressive'],
      ['720p', 'progressive'],
      ['1080p', 'progressive'],
    ]);
    expect(progressiveQualities([variant('only', 720)])).toEqual([]);
  });

  it('initial variant: requested id, else the largest fitting the rendered height, else the smallest', () => {
    expect(initialVariantId(V, '1080p', 100)).toBe('1080p');
    expect(initialVariantId(V, 'missing', 800)).toBe('720p');
    expect(initialVariantId(V, undefined, 2000)).toBe('1080p');
    expect(initialVariantId(V, undefined, 100)).toBe('360p');
    expect(initialVariantId(V, 'auto', 800)).toBe('720p');
    // Without heights on every variant: the first one.
    expect(initialVariantId([variant('a', null), variant('b', 720)], undefined, 2000)).toBe('a');
  });
});

describe('requests and selections', () => {
  const available = progressiveQualities(V);
  it('rejects Auto for progressive sources and unknown ids', () => {
    expect(qualityRequestError('auto', available, false)).toMatch(/adaptive/);
    expect(qualityRequestError('4k', available, false)).toBe('Unknown quality id.');
    expect(qualityRequestError('720p', available, false)).toBeNull();
    expect(qualityRequestError('auto', available, true)).toBeNull();
  });

  it('builds selections', () => {
    expect(selectionFor('auto', available)).toEqual({ id: 'auto', track: null });
    expect(selectionFor('720p', available).track?.label).toBe('720p');
  });
});

describe('quality menu', () => {
  const base = (patch: Partial<PlayerState['quality']>): PlayerState['quality'] => ({ selected: null, effective: null, available: [], autoAvailable: false, ...patch });
  const available = progressiveQualities(V);

  it('is hidden when there is nothing to choose', () => {
    expect(qualityMenuSection(base({}), en)).toBeNull();
  });

  it('progressive: variants only, the selected one checked', () => {
    const menu = qualityMenuSection(base({ available, selected: '720p' }), en)!;
    expect(menu.items.map((i) => [i.value, i.checked])).toEqual([
      ['360p', false],
      ['720p', true],
      ['1080p', false],
    ]);
    expect(menu.current).toBe('720p');
  });

  it('adaptive: Auto first, showing the effective rendition', () => {
    const menu = qualityMenuSection(base({ available, autoAvailable: true, selected: 'auto', effective: available[1]! }), en)!;
    expect(menu.items[0]).toEqual({ value: 'auto', label: 'Auto', checked: true });
    expect(menu.current).toBe('Auto (720p)');
  });
});

describe('ProgressiveQualityState (switch sequencing)', () => {
  it('last selection wins; overlapping switches restore the first captured position', () => {
    const state = new ProgressiveQualityState();
    state.reset('360p');
    const first = state.begin('720p', 12.5);
    expect(first).toMatchObject({ previous: '360p', position: 12.5 });
    // A second switch while the first is loading: the element time is meaningless (0).
    const second = state.begin('1080p', 0);
    expect(second).toMatchObject({ previous: '720p', position: 12.5 });
    expect(state.isLatest(first)).toBe(false);
    expect(state.isLatest(second)).toBe(true);
    state.settle(first); // stale: ignored
    expect(state.inFlightPosition).toBe(12.5);
    state.settle(second);
    expect(state.inFlightPosition).toBeNull();
    expect(state.current).toBe('1080p');
  });

  it('a new content session invalidates pending switches', () => {
    const state = new ProgressiveQualityState();
    state.reset('a');
    const pending = state.begin('b', 3);
    state.reset('c');
    expect(state.isLatest(pending)).toBe(false);
    expect(state.inFlightPosition).toBeNull();
    expect(state.current).toBe('c');
  });
});
