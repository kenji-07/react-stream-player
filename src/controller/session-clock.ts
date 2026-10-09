import { now } from '../utils/env.js';

/**
 * Monotonic clock of ACTIVE content playback in the current content session.
 * It advances only while content is actually playing (not paused, buffering,
 * seeking, ended or in a linear ad break). Playback rate does not scale it.
 * Seeks, DVR-window movement, rerenders, transport refreshes and quality
 * switches neither advance nor reset it. It lives in memory only.
 */
export class SessionClock {
  private accumulated = 0;
  private startedAt: number | null = null;

  constructor(private readonly clock: () => number = now) {}

  setRunning(running: boolean): void {
    if (running && this.startedAt === null) {
      this.startedAt = this.clock();
    } else if (!running && this.startedAt !== null) {
      this.accumulated += Math.max(0, this.clock() - this.startedAt);
      this.startedAt = null;
    }
  }

  get running(): boolean {
    return this.startedAt !== null;
  }

  /** Seconds of active playback. */
  seconds(): number {
    const live = this.startedAt === null ? 0 : Math.max(0, this.clock() - this.startedAt);
    return (this.accumulated + live) / 1000;
  }

  reset(): void {
    this.accumulated = 0;
    this.startedAt = null;
  }
}
