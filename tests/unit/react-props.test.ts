import { describe, expect, it } from 'vitest';
import { createRef } from '../../src/controller/controller.js';
import { extractCallbacks, extractOptions } from '../../src/react/props.js';
import type { PlayerProps } from '../../src/react/props.js';
import type { EventContext, PlayerEventMap } from '../../src/types/events.js';
import { TypedEmitter } from '../../src/utils/emitter.js';

describe('React prop splitting', () => {
  const onReady = () => undefined;
  const props: PlayerProps = {
    source: { src: '/a.mp4' },
    className: 'x',
    id: 'p',
    style: { width: 100 },
    volume: 0.5,
    onReady,
    onVolumeChange: () => undefined,
  };

  it('options exclude callbacks and React-only props', () => {
    expect(extractOptions(props)).toEqual({ source: { src: '/a.mp4' }, volume: 0.5 });
  });

  it('callbacks include only on* functions', () => {
    const callbacks = extractCallbacks(props);
    expect(Object.keys(callbacks).sort()).toEqual(['onReady', 'onVolumeChange']);
    expect(callbacks.onReady).toBe(onReady);
  });
});

describe('imperative ref facade before the player exists', () => {
  const ref = createRef(() => null, new TypedEmitter<PlayerEventMap, EventContext>());

  it('async methods reject with player-not-ready instead of hanging', async () => {
    await expect(ref.play()).rejects.toMatchObject({ name: 'PlayerError', code: 'player-not-ready' });
    await expect(ref.seekTo(1)).rejects.toMatchObject({ code: 'player-not-ready' });
    await expect(ref.setQuality('auto')).rejects.toMatchObject({ code: 'player-not-ready' });
    await expect(ref.fullscreen.request('web')).rejects.toMatchObject({ code: 'player-not-ready' });
    await expect(ref.captureFrame()).rejects.toMatchObject({ code: 'player-not-ready' });
  });

  it('sync getters return safe empty values', () => {
    expect(ref.getQualities()).toEqual([]);
    expect(ref.getAudioTracks()).toEqual([]);
    expect(ref.getSubtitleTracks()).toEqual([]);
    expect(() => ref.pause()).not.toThrow();
    expect(() => ref.setVolume(0.5)).not.toThrow();
  });

  it('listeners can be registered before the player exists (and removed)', () => {
    const fn = () => undefined;
    const off = ref.on('ready', fn);
    expect(typeof off).toBe('function');
    off();
    ref.once('error', fn);
    ref.off('error', fn);
  });

  it('destroy is idempotent', async () => {
    await expect(ref.destroy()).resolves.toBeUndefined();
    await expect(ref.destroy()).resolves.toBeUndefined();
  });
});
