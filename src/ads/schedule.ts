import type { CueTimeBase, DirectAd } from '../types/ads.js';
import { isAllowedResourceUrl } from '../security/url.js';
import { isFiniteNumber } from '../utils/equal.js';

export type MediaKind = 'vod' | 'live';

export interface RejectedAd {
  id: string;
  reason: string;
}

/** Validates direct ads. Called ONLY when the direct pipeline is active (never when VAST is configured). */
export function validateDirectAds(items: DirectAd[] | undefined): { valid: DirectAd[]; rejected: RejectedAd[] } {
  const valid: DirectAd[] = [];
  const rejected: RejectedAd[] = [];
  const ids = new Set<string>();
  for (const [index, ad] of (items ?? []).entries()) {
    const id = typeof ad?.id === 'string' && ad.id ? ad.id : `#${index}`;
    const reject = (reason: string) => rejected.push({ id, reason });
    if (!ad || typeof ad.id !== 'string' || !ad.id) {
      reject('missing id');
      continue;
    }
    if (ids.has(ad.id)) {
      reject('duplicate id');
      continue;
    }
    const timing = ad.timing as { placement?: string; at?: unknown; timeBase?: unknown } | undefined;
    if (!timing || !['preroll', 'midroll', 'postroll', 'overlay'].includes(timing.placement ?? '')) {
      reject('invalid timing.placement');
      continue;
    }
    if ((timing.placement === 'midroll' || timing.placement === 'overlay') && (!isFiniteNumber(timing.at) || timing.at < 0)) {
      reject('timing.at must be a number of seconds ≥ 0');
      continue;
    }
    if (timing.timeBase !== undefined && timing.timeBase !== 'media' && timing.timeBase !== 'session') {
      reject('timing.timeBase must be "media" or "session"');
      continue;
    }
    if (ad.skipAfter !== undefined && (!isFiniteNumber(ad.skipAfter) || ad.skipAfter < 0)) {
      reject('skipAfter must be seconds ≥ 0');
      continue;
    }
    if (ad.type === 'text') {
      if (typeof ad.text !== 'string' || !ad.text) {
        reject('text ads need a plain-text `text`');
        continue;
      }
      if (!isFiniteNumber(ad.duration) || ad.duration <= 0) {
        reject('duration must be seconds > 0');
        continue;
      }
    } else if (ad.type === 'image') {
      const srcOk = typeof ad.src === 'string' ? isAllowedResourceUrl(ad.src) : typeof Blob !== 'undefined' && ad.src instanceof Blob;
      if (!srcOk) {
        reject('image src must be an http(s)/relative/blob: URL or a Blob');
        continue;
      }
      if (typeof ad.alt !== 'string') {
        reject('image ads need `alt` text');
        continue;
      }
      if (!isFiniteNumber(ad.duration) || ad.duration <= 0) {
        reject('duration must be seconds > 0');
        continue;
      }
    } else if (ad.type === 'video') {
      if (!ad.source || typeof ad.source !== 'object') {
        reject('video ads need a `source`');
        continue;
      }
      if (timing.placement === 'overlay') {
        reject('video ads must be linear (preroll/midroll/postroll)');
        continue;
      }
    } else {
      reject('unknown ad type');
      continue;
    }
    ids.add(ad.id);
    valid.push(ad);
  }
  return { valid, rejected };
}

/** Live rules (v1): numeric cues must use `timeBase: "session"`; postrolls are unsupported. */
export function applyLiveRules(items: DirectAd[], kind: MediaKind): { valid: DirectAd[]; rejected: RejectedAd[] } {
  if (kind === 'vod') return { valid: items, rejected: [] };
  const valid: DirectAd[] = [];
  const rejected: RejectedAd[] = [];
  for (const ad of items) {
    const t = ad.timing;
    if (t.placement === 'postroll') {
      rejected.push({ id: ad.id, reason: 'postroll is not supported for live content in v1' });
    } else if ((t.placement === 'midroll' || t.placement === 'overlay') && t.timeBase !== 'session') {
      rejected.push({ id: ad.id, reason: 'live numeric cues must set timeBase: "session" in v1 (media/wall-clock time is not supported)' });
    } else {
      valid.push(ad);
    }
  }
  return { valid, rejected };
}

export interface CueTick {
  /** Content media time. */
  mediaTime: number;
  /** Seconds of active playback in the session. */
  sessionTime: number;
  /** True while a seek is in progress or the tick follows a discontinuity. */
  discontinuity: boolean;
}

function timeBaseOf(ad: DirectAd): CueTimeBase {
  const t = ad.timing as { timeBase?: CueTimeBase };
  return t.timeBase ?? 'media';
}

/**
 * Decides which cues are due. Each cue runs at most once per content session
 * (`history` survives quality switches, retries, refreshes and rerenders).
 *
 * VOD media-time cues fire when continuous playback crosses `at`. A seek that
 * jumps over a cue skips it for that seek (no burst of missed ads); the cue
 * stays eligible if normal playback crosses it later. Backward seeks never
 * replay a cue that already ran. Session-time cues fire once the session
 * clock reaches `at` and are unaffected by seeks/DVR movement.
 */
export class CueSchedule {
  private lastMediaTime: number | null = null;

  constructor(
    private readonly items: DirectAd[],
    private readonly history: Set<string>,
  ) {}

  private pending(): DirectAd[] {
    return this.items.filter((ad) => !this.history.has(ad.id));
  }

  prerolls(): DirectAd[] {
    return this.pending().filter((ad) => ad.timing.placement === 'preroll');
  }

  postrolls(): DirectAd[] {
    return this.pending().filter((ad) => ad.timing.placement === 'postroll');
  }

  hasPending(): boolean {
    return this.pending().length > 0;
  }

  /** Call on seeking/seeked so crossing a cue by seeking does not fire it. */
  markDiscontinuity(mediaTime: number | null): void {
    this.lastMediaTime = mediaTime;
  }

  /** Returns due midrolls (linear) and overlays, oldest cue first. */
  due(tick: CueTick): { linear: DirectAd[]; overlays: DirectAd[] } {
    const prev = this.lastMediaTime;
    this.lastMediaTime = tick.mediaTime;
    const linear: DirectAd[] = [];
    const overlays: DirectAd[] = [];
    if (tick.discontinuity) return { linear, overlays };
    for (const ad of this.pending()) {
      const t = ad.timing;
      if (t.placement !== 'midroll' && t.placement !== 'overlay') continue;
      let fire = false;
      if (timeBaseOf(ad) === 'session') {
        fire = tick.sessionTime >= t.at;
      } else if (prev !== null) {
        // Continuous playback window (forward, at most ~2 s per tick).
        const delta = tick.mediaTime - prev;
        const crossed = prev < t.at || (t.at === 0 && prev === 0);
        fire = delta >= 0 && delta <= 2 && crossed && t.at <= tick.mediaTime;
      }
      if (fire) (t.placement === 'midroll' ? linear : overlays).push(ad);
    }
    const byAt = (a: DirectAd, b: DirectAd) => ((a.timing as { at: number }).at ?? 0) - ((b.timing as { at: number }).at ?? 0);
    return { linear: linear.sort(byAt), overlays: overlays.sort(byAt) };
  }

  /** Records that a cue started (it will never run again in this session). */
  markRun(id: string): void {
    this.history.add(id);
  }

  /** `ads.replayOnLoop`: re-arms midroll/overlay cues when looping restarts VOD content. */
  rearmForLoop(): void {
    for (const ad of this.items) {
      if (ad.timing.placement === 'midroll' || ad.timing.placement === 'overlay') this.history.delete(ad.id);
    }
    this.lastMediaTime = 0;
  }
}
