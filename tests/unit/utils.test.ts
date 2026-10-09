import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionClock } from '../../src/controller/session-clock.js';
import { clamp, hashString, semanticEqual } from '../../src/utils/equal.js';
import { TypedEmitter } from '../../src/utils/emitter.js';

interface Events {
  a: number;
  b: string;
}

describe('TypedEmitter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers the same listener once per event', () => {
    const e = new TypedEmitter<Events, null>();
    const fn = vi.fn();
    e.on('a', fn);
    e.on('a', fn);
    e.emit('a', 1, null);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(e.listenerCount('a')).toBe(1);
  });

  it('removes once listeners before invoking them (re-entrant emit does not re-fire)', () => {
    const e = new TypedEmitter<Events, null>();
    const calls: number[] = [];
    const fn = (n: number) => {
      calls.push(n);
      if (n === 1) e.emit('a', 2, null);
    };
    e.once('a', fn);
    e.emit('a', 1, null);
    expect(calls).toEqual([1]);
    expect(e.listenerCount('a')).toBe(0);
  });

  it('off removes a once listener by its original reference', () => {
    const e = new TypedEmitter<Events, null>();
    const fn = vi.fn();
    e.once('a', fn);
    e.off('a', fn);
    e.emit('a', 1, null);
    expect(fn).not.toHaveBeenCalled();
  });

  it('the returned unsubscribe works for on and once', () => {
    const e = new TypedEmitter<Events, null>();
    const a = vi.fn();
    const b = vi.fn();
    e.on('a', a)();
    e.once('a', b)();
    e.emit('a', 1, null);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('a throwing listener does not break other listeners or the caller', () => {
    const reported: unknown[] = [];
    vi.stubGlobal('reportError', (error: unknown) => reported.push(error));
    const e = new TypedEmitter<Events, null>();
    const after = vi.fn();
    e.on('b', () => {
      throw new Error('host bug');
    });
    e.on('b', after);
    expect(() => e.emit('b', 'x', null)).not.toThrow();
    expect(after).toHaveBeenCalledWith('x', null);
    expect(reported).toHaveLength(1);
  });

  it('a listener removed during emit is skipped', () => {
    const e = new TypedEmitter<Events, null>();
    const second = vi.fn();
    e.on('a', () => e.off('a', second));
    e.on('a', second);
    e.emit('a', 1, null);
    expect(second).not.toHaveBeenCalled();
  });

  it('passes the context and stops after dispose', () => {
    const e = new TypedEmitter<Events, { id: string }>();
    const fn = vi.fn();
    e.on('a', fn);
    e.emit('a', 1, { id: 's1' });
    expect(fn).toHaveBeenCalledWith(1, { id: 's1' });
    e.dispose();
    e.on('a', fn);
    e.emit('a', 2, { id: 's1' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('semanticEqual', () => {
  it('compares plain values structurally', () => {
    expect(semanticEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(semanticEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(semanticEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(semanticEqual([], {})).toBe(false);
    expect(semanticEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('treats undefined properties as absent', () => {
    expect(semanticEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it('compares functions by presence only (callback identity never triggers work)', () => {
    expect(semanticEqual({ cb: () => 1 }, { cb: () => 2 })).toBe(true);
    expect(semanticEqual({ cb: () => 1 }, {})).toBe(false);
  });

  it('compares Blobs and class instances by reference, bytes by content', () => {
    const blob = new Blob(['x']);
    expect(semanticEqual({ src: blob }, { src: blob })).toBe(true);
    expect(semanticEqual({ src: blob }, { src: new Blob(['x']) })).toBe(false);
    expect(semanticEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(semanticEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(semanticEqual(new Uint8Array([1]).buffer, new Uint8Array([1]).buffer)).toBe(true);
  });
});

describe('clamp / hashString', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('SessionClock', () => {
  it('advances only while running and is unaffected by repeated state calls', () => {
    let t = 0;
    const clock = new SessionClock(() => t);
    expect(clock.seconds()).toBe(0);
    clock.setRunning(true);
    t = 1500;
    clock.setRunning(true); // no double start
    expect(clock.seconds()).toBe(1.5);
    clock.setRunning(false);
    t = 10_000; // paused time does not count
    expect(clock.seconds()).toBe(1.5);
    clock.setRunning(true);
    t = 10_500;
    expect(clock.seconds()).toBe(2);
    expect(clock.running).toBe(true);
    clock.reset();
    expect(clock.seconds()).toBe(0);
    expect(clock.running).toBe(false);
  });

  it('never goes backwards if the time source does', () => {
    let t = 1000;
    const clock = new SessionClock(() => t);
    clock.setRunning(true);
    t = 500;
    expect(clock.seconds()).toBe(0);
  });
});
