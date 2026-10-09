import type { CSSProperties, Ref } from 'react';
import type { PlayerEventCallbacks } from '../types/events.js';
import type { PlayerOptions } from '../types/options.js';
import type { PlayerRef } from '../types/ref.js';

export interface PlayerProps extends PlayerOptions, PlayerEventCallbacks {
  /** React 19 ref prop: receives the imperative {@link PlayerRef}. */
  ref?: Ref<PlayerRef>;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

const REACT_ONLY = new Set(['ref', 'id', 'className', 'style', 'children', 'key']);

/** Splits props into controller options (no callbacks, no React-only props). */
export function extractOptions(props: PlayerProps): PlayerOptions {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (REACT_ONLY.has(key)) continue;
    if (/^on[A-Z]/.test(key) && typeof value === 'function') continue;
    out[key] = value;
  }
  return out as unknown as PlayerOptions;
}

/** Event callbacks from props (read lazily so updated callbacks never re-initialise playback). */
export function extractCallbacks(props: PlayerProps): PlayerEventCallbacks {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (/^on[A-Z]/.test(key) && typeof value === 'function') out[key] = value;
  }
  return out as PlayerEventCallbacks;
}
