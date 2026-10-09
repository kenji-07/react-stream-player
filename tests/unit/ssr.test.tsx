// @vitest-environment node
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('server rendering', () => {
  it('runs without DOM globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('importing every entry point on the server does not touch browser APIs', async () => {
    const index = await import('../../src/index.js');
    const core = await import('../../src/core.js');
    expect(typeof index.Player).toBe('function');
    expect(index.DEFAULT_VOLUME).toBe(0.7);
    expect(typeof core.createPlayer).toBe('function');
  });

  it('renders the player shell (no media element, no vendor UI) with layout data', async () => {
    const { Player } = await import('../../src/index.js');
    const html = renderToString(
      createElement(Player, {
        source: { src: '/movie.mp4', type: 'mp4' },
        layout: 'reel',
        poster: '/poster.jpg',
        id: 'p1',
        className: 'host',
        title: 'Movie',
      }),
    );
    expect(html).toContain('class="rsp-root host"');
    expect(html).toContain('id="p1"');
    expect(html).toContain('aspect-ratio:9 / 16');
    expect(html).toContain('data-layout="reel"');
    expect(html).toContain('--rsp-poster:url(&quot;/poster.jpg&quot;)');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('art-video-player');
  });

  it('never renders an unsafe poster URL into styles', async () => {
    const { Player } = await import('../../src/index.js');
    const html = renderToString(createElement(Player, { source: { src: '/m.mp4' }, poster: 'javascript:alert(1)' }));
    expect(html).not.toContain('javascript:');
    const quoted = renderToString(createElement(Player, { source: { src: '/m.mp4' }, poster: '/a").b{color:red}' }));
    expect(quoted).not.toContain('")');
  });

  it('createPlayer refuses to run on the server', async () => {
    const { createPlayer } = await import('../../src/core.js');
    expect(() => createPlayer({} as HTMLElement, { source: null })).toThrow(/browser/);
  });
});
