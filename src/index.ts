'use client';

// React entry point. Importing this module on the server is safe: no browser
// globals are touched at module evaluation; players are created client-side.
export { Player } from './react/Player.js';
export { PlayerErrorBoundary, type PlayerErrorBoundaryProps } from './react/PlayerErrorBoundary.js';
export type { PlayerProps } from './react/props.js';
export { isPlayerError } from './errors.js';
export { DEFAULT_PLAYBACK_RATES, DEFAULT_VOLUME, DEFAULT_SUBTITLE_STYLE } from './controller/options.js';
export type * from './types/public.js';
