import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullscreenManager } from '../../src/fullscreen/fullscreen-manager.js';
import { HotkeyManager } from '../../src/hotkeys/hotkey-manager.js';
import { MediaSessionManager } from '../../src/media-session/media-session-manager.js';
import { blobIdentity, BlobRegistry } from '../../src/resources/blob-registry.js';
import type { HotkeyAction } from '../../src/types/config.js';

describe('BlobRegistry', () => {
  let created = 0;
  const revoked: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    created = 0;
    revoked.length = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++created}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => void revoked.push(url));
  });
  afterEach(() => vi.useRealTimers());

  it('creates one URL per Blob and revokes it (deferred) after the last consumer releases', () => {
    const registry = new BlobRegistry();
    const blob = new Blob(['x']);
    const a = registry.acquire(blob, 'video');
    const b = registry.acquire(blob, 'track:1');
    expect(a).toBe(b);
    expect(created).toBe(1);
    registry.release(blob, 'video');
    vi.runAllTimers();
    expect(revoked).toEqual([]);
    registry.release(blob, 'track:1');
    expect(revoked).toEqual([]); // deferred: never synchronously while a consumer may still be detaching
    vi.runAllTimers();
    expect(revoked).toEqual([a]);
    expect(registry.counters).toEqual({ created: 1, revoked: 1 });
    expect(registry.size).toBe(0);
  });

  it('releaseConsumer releases every Blob held by that consumer', () => {
    const registry = new BlobRegistry();
    const b1 = new Blob(['1']);
    const b2 = new Blob(['2']);
    registry.acquire(b1, 'variant');
    registry.acquire(b2, 'variant');
    registry.acquire(b2, 'poster');
    registry.releaseConsumer('variant');
    vi.runAllTimers();
    expect(revoked).toEqual(['blob:test/1']);
    expect(registry.isOwnedUrl('blob:test/2')).toBe(true);
  });

  it('destroy revokes everything once and is idempotent', () => {
    const registry = new BlobRegistry();
    registry.acquire(new Blob(['1']), 'a');
    registry.acquire(new Blob(['2']), 'b');
    registry.destroy();
    registry.destroy();
    vi.runAllTimers();
    expect(revoked).toHaveLength(2);
    expect(() => registry.acquire(new Blob(['3']), 'c')).toThrow();
  });

  it('never revokes caller-provided blob: URLs (they are never registered)', () => {
    const registry = new BlobRegistry();
    expect(registry.isOwnedUrl('blob:caller/1')).toBe(false);
    registry.destroy();
    vi.runAllTimers();
    expect(revoked).toEqual([]);
  });

  it('blobIdentity is stable per instance', () => {
    const blob = new Blob(['x']);
    expect(blobIdentity(blob)).toBe(blobIdentity(blob));
    expect(blobIdentity(blob)).not.toBe(blobIdentity(new Blob(['x'])));
  });
});

describe('MediaSessionManager', () => {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const positions: (MediaPositionState | undefined)[] = [];
  let session: { metadata: unknown; playbackState: string; setActionHandler: (a: string, h: MediaSessionActionHandler | null) => void; setPositionState: (s?: MediaPositionState) => void };

  beforeEach(() => {
    handlers.clear();
    positions.length = 0;
    session = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: (a, h) => void handlers.set(a, h),
      setPositionState: (s) => void positions.push(s),
    };
    vi.stubGlobal('MediaMetadata', class {
      title: string;
      constructor(init: { title: string }) {
        this.title = init.title;
      }
    });
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const m of managers.splice(0)) m.destroy();
  });

  const managers: MediaSessionManager[] = [];
  function make(canSeek = () => true) {
    const actions = { play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn(), canSeek, seekStep: () => 10 };
    const m = new MediaSessionManager(actions);
    managers.push(m);
    return { m, actions };
  }
  const snap = { playing: true, position: 5, duration: 60, playbackRate: 1 };

  it('does nothing unless enabled', () => {
    const { m } = make();
    m.configure({});
    m.claim(snap);
    expect(session.metadata).toBeNull();
    expect(handlers.size).toBe(0);
  });

  it('claims metadata, handlers and finite position state', () => {
    const { m, actions } = make();
    m.configure({ enabled: true, title: 'T' });
    m.claim(snap);
    expect((session.metadata as { title: string }).title).toBe('T');
    expect(session.playbackState).toBe('playing');
    expect(positions.at(-1)).toEqual({ duration: 60, position: 5, playbackRate: 1 });
    expect([...handlers.keys()].sort()).toEqual(['pause', 'play', 'seekbackward', 'seekforward', 'seekto']);
    expect(handlers.has('nexttrack')).toBe(false);
    handlers.get('seekforward')!({ action: 'seekforward' });
    expect(actions.seekBy).toHaveBeenCalledWith(10);
  });

  it('clears position state for live/unknown duration instead of sending Infinity', () => {
    const { m } = make();
    m.configure({ enabled: true });
    m.claim({ ...snap, duration: null });
    expect(positions.at(-1)).toBeUndefined();
    m.update({ ...snap, duration: Number.POSITIVE_INFINITY });
    expect(positions.at(-1)).toBeUndefined();
  });

  it('seek actions are ignored while seeking is not allowed (linear ads)', () => {
    let allowed = false;
    const { m, actions } = make(() => allowed);
    m.configure({ enabled: true });
    m.claim(snap);
    handlers.get('seekto')!({ action: 'seekto', seekTime: 30 });
    expect(actions.seekTo).not.toHaveBeenCalled();
    allowed = true;
    handlers.get('seekto')!({ action: 'seekto', seekTime: 30 });
    expect(actions.seekTo).toHaveBeenCalledWith(30);
  });

  it('a second player takes over; releasing the old owner does not clobber the new one', () => {
    const first = make().m;
    const second = make().m;
    first.configure({ enabled: true, title: 'First' });
    second.configure({ enabled: true, title: 'Second' });
    first.claim(snap);
    second.claim(snap);
    expect(MediaSessionManager.getOwner()).toBe(second);
    first.destroy();
    expect((session.metadata as { title: string }).title).toBe('Second');
    second.destroy();
    expect(session.metadata).toBeNull();
    expect(handlers.get('play')).toBeNull();
  });

  it('never clears host-owned metadata', () => {
    const { m } = make();
    m.configure({ enabled: true });
    m.claim(snap);
    const host = { title: 'host' };
    session.metadata = host;
    m.destroy();
    expect(session.metadata).toBe(host);
  });
});

describe('HotkeyManager', () => {
  let root: HTMLElement;
  let dispatched: HotkeyAction[];
  let manager: HotkeyManager;
  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.tabIndex = 0;
    root.innerHTML = '<button id="btn">b</button><input id="input"><div role="slider" id="slider" tabindex="0"></div><span id="plain"></span>';
    document.body.append(root);
    dispatched = [];
    manager = new HotkeyManager(root, () => ({ enabled: true, bindings: { ' ': 'togglePlay', k: 'togglePlay', ArrowRight: 'seekForward', m: 'toggleMute' } }), (action) => {
      dispatched.push(action);
      return true;
    });
  });
  afterEach(() => manager.destroy());

  function press(target: Element, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('runs bound shortcuts for focus inside the player and prevents the default', () => {
    const event = press(root.querySelector('#plain')!, 'm');
    expect(dispatched).toEqual(['toggleMute']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores editable/interactive targets, modifiers, IME and handled events', () => {
    press(root.querySelector('#input')!, 'm');
    press(root.querySelector('#slider')!, 'ArrowRight');
    press(root, 'm', { ctrlKey: true });
    press(root, 'm', { metaKey: true });
    press(root, 'm', { isComposing: true });
    const handled = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true });
    handled.preventDefault();
    root.dispatchEvent(handled);
    expect(dispatched).toEqual([]);
  });

  it('Space/Enter keep their native meaning on buttons; other keys still work there', () => {
    press(root.querySelector('#btn')!, ' ');
    expect(dispatched).toEqual([]);
    press(root.querySelector('#btn')!, 'k');
    expect(dispatched).toEqual(['togglePlay']);
  });

  it('ignores events from outside the player and unbound keys', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    press(outside, 'm');
    press(root, 'q');
    expect(dispatched).toEqual([]);
  });

  it('stops listening after destroy', () => {
    manager.destroy();
    press(root, 'm');
    expect(dispatched).toEqual([]);
  });
});

describe('FullscreenManager (web mode)', () => {
  it('locks page scroll, focuses the player, restores everything on exit, and has one page-level holder', async () => {
    document.body.innerHTML = '<button id="outside">x</button>';
    const outside = document.getElementById('outside')!;
    outside.focus();
    document.body.style.overflow = 'auto';
    const makePlayer = () => {
      const root = document.createElement('div');
      root.tabIndex = -1;
      const video = document.createElement('video');
      root.append(video);
      document.body.append(root);
      const changes: unknown[] = [];
      const fm = new FullscreenManager(() => root, root, video, (s) => changes.push(s));
      return { root, fm, changes };
    };
    const a = makePlayer();
    const b = makePlayer();
    await a.fm.request('web');
    expect(a.root.dataset.rspWebFullscreen).toBe('');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(a.root);
    expect(a.fm.getState()).toEqual({ active: true, mode: 'web', videoOnly: false });

    await b.fm.request('web');
    expect('rspWebFullscreen' in a.root.dataset).toBe(false);
    expect(a.fm.getState().active).toBe(false);
    expect(b.fm.getState().mode).toBe('web');

    // Escape exits web fullscreen.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(b.fm.getState().active).toBe(false);
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(outside);

    // Destroy restores and is idempotent.
    await a.fm.request('web');
    a.fm.destroy();
    a.fm.destroy();
    expect(document.body.style.overflow).toBe('auto');
    await expect(a.fm.request('web')).rejects.toMatchObject({ code: 'player-destroyed' });
    b.fm.destroy();
  });

  it('reports unsupported browser fullscreen, or falls back to web when asked', async () => {
    const root = document.createElement('div');
    const video = document.createElement('video');
    root.append(video);
    document.body.append(root);
    const fm = new FullscreenManager(() => root, root, video, () => undefined);
    Object.defineProperty(root, 'requestFullscreen', { value: undefined, configurable: true });
    await expect(fm.request('browser')).rejects.toMatchObject({ code: 'fullscreen-unsupported' });
    await fm.request('browser', { fallbackToWeb: true });
    expect(fm.getState().mode).toBe('web');
    fm.destroy();
  });
});
