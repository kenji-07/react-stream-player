import { describe, expect, it } from 'vitest';
import { detectSourceType, engineMimeType, normalizeSource } from '../../src/controller/source.js';
import type { PlayerSource } from '../../src/types/source.js';

function ok(source: PlayerSource) {
  const result = normalizeSource(source);
  if (!result.ok) throw new Error(`expected a valid source: ${result.error.message}`);
  return result.source;
}

describe('detectSourceType', () => {
  it('prefers an explicit type over MIME and extension', () => {
    expect(detectSourceType('https://cdn.example.com/a.mp4', 'hls', 'video/mp4')).toBe('hls');
    expect(detectSourceType('https://cdn.example.com/a', 'dash', undefined)).toBe('dash');
  });

  it('uses the MIME hint before the URL extension', () => {
    expect(detectSourceType('https://cdn.example.com/a.mp4', undefined, 'application/vnd.apple.mpegurl')).toBe('hls');
    expect(detectSourceType('https://cdn.example.com/a', 'auto', 'application/dash+xml; profiles=x')).toBe('dash');
    expect(detectSourceType('https://cdn.example.com/a', undefined, 'video/webm')).toBe('mp4');
  });

  it('detects the extension from the path only (queries and fragments ignored)', () => {
    expect(detectSourceType('https://cdn.example.com/live/master.m3u8?token=abc.mp4', undefined, undefined)).toBe('hls');
    expect(detectSourceType('https://cdn.example.com/manifest.mpd#t=10', undefined, undefined)).toBe('dash');
    expect(detectSourceType('/videos/clip.MP4?sig=1', undefined, undefined)).toBe('mp4');
  });

  it('never guesses for unknown URLs, blob: URLs or unknown types', () => {
    expect(detectSourceType('https://cdn.example.com/watch?v=1', undefined, undefined)).toBeNull();
    expect(detectSourceType('blob:https://example.com/1234', undefined, undefined)).toBeNull();
    expect(detectSourceType('https://cdn.example.com/a.mp4', 'flv', undefined)).toBeNull();
  });

  it('reads the MIME type of a Blob', () => {
    expect(detectSourceType(new Blob([], { type: 'video/mp4' }), undefined, undefined)).toBe('mp4');
    expect(detectSourceType(new Blob([]), undefined, undefined)).toBeNull();
  });
});

describe('normalizeSource: content identity', () => {
  it('an explicit id+revision is the content identity; URL changes keep it', () => {
    const a = ok({ id: 'movie', src: 'https://cdn.example.com/a.m3u8?sig=1' });
    const b = ok({ id: 'movie', src: 'https://cdn.example.com/a.m3u8?sig=2' });
    expect(a.contentKey).toBe(b.contentKey);
    expect(a.transportKey).not.toBe(b.transportKey);
    const c = ok({ id: 'movie', revision: 2, src: 'https://cdn.example.com/a.m3u8?sig=2' });
    expect(c.contentKey).not.toBe(b.contentKey);
  });

  it('without an id the transport is the identity', () => {
    const a = ok({ src: 'https://cdn.example.com/a.mp4' });
    const b = ok({ src: 'https://cdn.example.com/a.mp4' });
    const c = ok({ src: 'https://cdn.example.com/b.mp4' });
    expect(a.explicitId).toBe(false);
    expect(a.contentKey).toBe(b.contentKey);
    expect(a.contentKey).not.toBe(c.contentKey);
  });

  it('inline objects with equal values produce equal keys (no reload on rerender)', () => {
    const make = (): PlayerSource => ({ id: 'x', type: 'mp4', variants: [{ id: 'hd', label: 'HD', height: 720, src: '/hd.mp4' }] });
    expect(ok(make()).transportKey).toBe(ok(make()).transportKey);
  });

  it('Blob identity is per instance, not per content', () => {
    const blob1 = new Blob(['a'], { type: 'video/mp4' });
    const blob2 = new Blob(['a'], { type: 'video/mp4' });
    const a = ok({ src: blob1, type: 'mp4' });
    expect(ok({ src: blob1, type: 'mp4' }).transportKey).toBe(a.transportKey);
    expect(ok({ src: blob2, type: 'mp4' }).transportKey).not.toBe(a.transportKey);
  });

  it('a single MP4 becomes one implicit variant; adaptive sources have none', () => {
    expect(ok({ src: '/a.mp4' }).variants).toHaveLength(1);
    expect(ok({ src: '/a.m3u8' }).variants).toHaveLength(0);
  });
});

describe('normalizeSource: validation', () => {
  const invalid: [string, unknown][] = [
    ['javascript: URL', { src: 'javascript:alert(1)', type: 'mp4' }],
    ['data: URL', { src: 'data:video/mp4;base64,AAAA', type: 'mp4' }],
    ['empty id', { id: '', src: '/a.mp4' }],
    ['variants without type mp4', { type: 'hls', variants: [{ id: 'a', label: 'A', src: '/a.mp4' }] }],
    ['empty variants', { type: 'mp4', variants: [] }],
    ['reserved variant id', { type: 'mp4', variants: [{ id: 'auto', label: 'A', src: '/a.mp4' }] }],
    ['duplicate variant ids', { type: 'mp4', variants: [{ id: 'a', label: 'A', src: '/a.mp4' }, { id: 'a', label: 'B', src: '/b.mp4' }] }],
    ['Blob without type mp4', { src: new Blob([]) }],
  ];
  for (const [name, source] of invalid) {
    it(`rejects ${name}`, () => {
      const result = normalizeSource(source as PlayerSource);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('source-invalid');
        expect(result.error.fatal).toBe(true);
      }
    });
  }

  it('reports an unknown type instead of guessing MP4', () => {
    const result = normalizeSource({ src: 'https://cdn.example.com/stream' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('source-type-unknown');
  });
});

describe('engineMimeType', () => {
  it('maps protocols to the MIME type handed to the adaptive engine', () => {
    expect(engineMimeType(ok({ src: '/a.m3u8' }))).toBe('application/x-mpegurl');
    expect(engineMimeType(ok({ src: '/a.mpd' }))).toBe('application/dash+xml');
    expect(engineMimeType(ok({ src: '/a', mimeType: 'application/vnd.apple.mpegurl' }))).toBe('application/vnd.apple.mpegurl');
  });
});
