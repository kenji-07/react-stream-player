'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// One portrait video; no feed and no other video preloads.
export function Reel() {
  return (
    <Player
      source={{ src: media.mp4.portrait, type: 'mp4' }}
      layout="reel"
      aspectRatio="9 / 16"
      fit="contain"
      defaultVolume={0.7}
      motion={{ enabled: true, reducedMotion: 'system' }}
    />
  );
}
