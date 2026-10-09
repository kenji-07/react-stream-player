// Framework-independent entry point (`react-stream-player/core`). The React
// component is a thin wrapper around the same controller.
import { createRef, PlayerController } from './controller/controller.js';
import type { PlayerEventCallbacks } from './types/events.js';
import type { PlayerOptions } from './types/options.js';
import type { PlayerRef } from './types/ref.js';

export interface PlayerHandle extends PlayerRef {
  /**
   * Applies new options (semantic diff; unchanged values are no-ops). Pass
   * `callbacks` to replace the event callbacks; omit it to keep the current ones.
   */
  update(options: PlayerOptions, callbacks?: PlayerEventCallbacks): void;
}

/**
 * Creates a player inside `root` (browser only). Call `destroy()` when done.
 */
export function createPlayer(root: HTMLElement, options: PlayerOptions, callbacks: PlayerEventCallbacks = {}): PlayerHandle {
  if (typeof document === 'undefined') throw new Error('createPlayer() must run in a browser');
  let current = callbacks;
  const controller = new PlayerController(root, options, () => current);
  const ref = createRef(() => controller, null);
  return Object.assign(ref, {
    update(next: PlayerOptions, callbacks?: PlayerEventCallbacks) {
      if (callbacks) current = callbacks;
      controller.update(next);
    },
  });
}

export { isPlayerError } from './errors.js';
export { DEFAULT_PLAYBACK_RATES, DEFAULT_VOLUME, DEFAULT_SUBTITLE_STYLE } from './controller/options.js';
export type * from './types/public.js';
