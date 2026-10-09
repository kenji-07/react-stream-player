'use client';

import { useEffect, useRef } from 'react';
import { createPlayer, type PlayerHandle } from 'react-stream-player/core';
import { media } from '../media';

// The framework-independent entry: the same controller without React. Create
// it in the browser only and destroy it when done (destroy is idempotent).
export function CoreApi() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    const player: PlayerHandle = createPlayer(root.current, { source: { src: media.progressive, type: 'mp4' } }, { onReady: (info) => console.info('ready', info) });
    const timer = setTimeout(() => player.update({ source: { src: media.progressive, type: 'mp4' }, fit: 'cover' }), 3000);
    return () => {
      clearTimeout(timer);
      void player.destroy();
    };
  }, []);

  return <div ref={root} className="rsp-root" style={{ aspectRatio: '16 / 9' }} />;
}
