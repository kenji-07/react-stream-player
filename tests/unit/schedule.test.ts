import { describe, expect, it } from 'vitest';
import { applyLiveRules, CueSchedule, validateDirectAds } from '../../src/ads/schedule.js';
import type { DirectAd } from '../../src/types/ads.js';

const text = (id: string, timing: DirectAd['timing'], extra: Partial<DirectAd> = {}): DirectAd =>
  ({ id, type: 'text', text: 'Ad', duration: 5, timing, ...extra }) as DirectAd;

describe('validateDirectAds', () => {
  it('accepts valid text, image and video ads', () => {
    const { valid, rejected } = validateDirectAds([
      text('pre', { placement: 'preroll' }),
      { id: 'img', type: 'image', src: '/ad.png', alt: 'Sponsor', duration: 5, timing: { placement: 'overlay', at: 3 } },
      { id: 'vid', type: 'video', source: { src: '/ad.mp4' }, timing: { placement: 'midroll', at: 10 } },
    ]);
    expect(valid.map((a) => a.id)).toEqual(['pre', 'img', 'vid']);
    expect(rejected).toEqual([]);
  });

  it.each([
    ['missing id', { type: 'text', text: 'x', duration: 1, timing: { placement: 'preroll' } }, 'missing id'],
    ['bad placement', { id: 'a', type: 'text', text: 'x', duration: 1, timing: { placement: 'sometime' } }, 'invalid timing.placement'],
    ['negative at', { id: 'a', type: 'text', text: 'x', duration: 1, timing: { placement: 'midroll', at: -1 } }, 'timing.at must be a number of seconds ≥ 0'],
    ['bad timeBase', { id: 'a', type: 'text', text: 'x', duration: 1, timing: { placement: 'midroll', at: 1, timeBase: 'wallclock' } }, 'timing.timeBase must be "media" or "session"'],
    ['empty text', { id: 'a', type: 'text', text: '', duration: 1, timing: { placement: 'preroll' } }, 'text ads need a plain-text `text`'],
    ['zero duration', { id: 'a', type: 'text', text: 'x', duration: 0, timing: { placement: 'preroll' } }, 'duration must be seconds > 0'],
    ['javascript image', { id: 'a', type: 'image', src: 'javascript:alert(1)', alt: '', duration: 1, timing: { placement: 'preroll' } }, 'image src must be an http(s)/relative/blob: URL or a Blob'],
    ['image without alt', { id: 'a', type: 'image', src: '/a.png', duration: 1, timing: { placement: 'preroll' } }, 'image ads need `alt` text'],
    ['overlay video', { id: 'a', type: 'video', source: { src: '/a.mp4' }, timing: { placement: 'overlay', at: 1 } }, 'video ads must be linear (preroll/midroll/postroll)'],
    ['html ad type', { id: 'a', type: 'html', html: '<script>', timing: { placement: 'preroll' } }, 'unknown ad type'],
  ])('rejects %s', (_name, ad, reason) => {
    const { valid, rejected } = validateDirectAds([ad as unknown as DirectAd]);
    expect(valid).toEqual([]);
    expect(rejected[0]!.reason).toBe(reason);
  });

  it('rejects duplicate ids, keeping the first', () => {
    const { valid, rejected } = validateDirectAds([text('a', { placement: 'preroll' }), text('a', { placement: 'postroll' })]);
    expect(valid).toHaveLength(1);
    expect(rejected).toEqual([{ id: 'a', reason: 'duplicate id' }]);
  });
});

describe('applyLiveRules', () => {
  const items = [
    text('pre', { placement: 'preroll' }),
    text('post', { placement: 'postroll' }),
    text('media', { placement: 'midroll', at: 30 }),
    text('session', { placement: 'midroll', at: 30, timeBase: 'session' }),
    text('overlay', { placement: 'overlay', at: 5, timeBase: 'session' }),
  ];

  it('VOD: everything passes', () => {
    expect(applyLiveRules(items, 'vod').valid).toHaveLength(5);
  });

  it('live: postrolls and media-time cues are rejected; session-time cues pass', () => {
    const { valid, rejected } = applyLiveRules(items, 'live');
    expect(valid.map((a) => a.id)).toEqual(['pre', 'session', 'overlay']);
    expect(rejected.map((r) => r.id)).toEqual(['post', 'media']);
  });
});

describe('CueSchedule', () => {
  const tick = (mediaTime: number, sessionTime = mediaTime, discontinuity = false) => ({ mediaTime, sessionTime, discontinuity });

  it('fires a media-time midroll when continuous playback crosses it, once', () => {
    const history = new Set<string>();
    const s = new CueSchedule([text('m', { placement: 'midroll', at: 5 })], history);
    s.markDiscontinuity(0);
    expect(s.due(tick(4)).linear).toEqual([]);
    const due = s.due(tick(5.2)).linear;
    expect(due.map((a) => a.id)).toEqual(['m']);
    s.markRun('m');
    expect(s.due(tick(5.4)).linear).toEqual([]);
    // Seeking back and crossing again never replays it.
    s.markDiscontinuity(1);
    expect(s.due(tick(1.2)).linear).toEqual([]);
    expect(s.due(tick(5.5)).linear).toEqual([]);
  });

  it('fires a cue at 0 from the content start baseline', () => {
    const s = new CueSchedule([text('o', { placement: 'overlay', at: 0 })], new Set());
    s.markDiscontinuity(0);
    expect(s.due(tick(0.25)).overlays.map((a) => a.id)).toEqual(['o']);
  });

  it('a seek over a cue skips it for that seek but it stays eligible', () => {
    const s = new CueSchedule([text('m', { placement: 'midroll', at: 5 })], new Set());
    s.markDiscontinuity(0);
    s.markDiscontinuity(8); // seek from 0 to 8
    expect(s.due(tick(8.2)).linear).toEqual([]);
    s.markDiscontinuity(4); // seek back before the cue
    expect(s.due(tick(4.5)).linear).toEqual([]);
    expect(s.due(tick(5.1)).linear.map((a) => a.id)).toEqual(['m']);
  });

  it('ignores large jumps and discontinuity ticks', () => {
    const s = new CueSchedule([text('m', { placement: 'midroll', at: 5 })], new Set());
    s.markDiscontinuity(0);
    expect(s.due(tick(9)).linear).toEqual([]); // > 2 s jump
    s.markDiscontinuity(4.5);
    expect(s.due(tick(5.1, 5.1, true)).linear).toEqual([]);
  });

  it('session-time cues use the session clock and ignore seeks', () => {
    const s = new CueSchedule([text('s', { placement: 'midroll', at: 30, timeBase: 'session' })], new Set());
    s.markDiscontinuity(100);
    expect(s.due(tick(100, 29)).linear).toEqual([]);
    s.markDiscontinuity(10); // DVR seek back
    expect(s.due(tick(10.2, 30)).linear.map((a) => a.id)).toEqual(['s']);
  });

  it('returns due cues ordered by cue time and keeps history across schedules', () => {
    const history = new Set<string>();
    const items = [text('b', { placement: 'midroll', at: 2 }), text('a', { placement: 'midroll', at: 1 })];
    const s = new CueSchedule(items, history);
    s.markDiscontinuity(0.5);
    expect(s.due(tick(2.1)).linear.map((a) => a.id)).toEqual(['a', 'b']);
    s.markRun('a');
    // A new schedule for the same session (quality switch, refresh) shares history.
    const again = new CueSchedule(items, history);
    expect(again.hasPending()).toBe(true);
    again.markDiscontinuity(0.5);
    expect(again.due(tick(2.1)).linear.map((x) => x.id)).toEqual(['b']);
  });

  it('prerolls/postrolls exclude ads already run; replayOnLoop re-arms only midroll/overlay', () => {
    const history = new Set<string>();
    const s = new CueSchedule([text('pre', { placement: 'preroll' }), text('m', { placement: 'midroll', at: 1 }), text('post', { placement: 'postroll' })], history);
    s.markRun('pre');
    s.markRun('m');
    expect(s.prerolls()).toEqual([]);
    expect(s.postrolls().map((a) => a.id)).toEqual(['post']);
    s.rearmForLoop();
    expect([...history]).toEqual(['pre']);
  });
});
