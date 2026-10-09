'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// One portrait video; no feed and no other video preloads.
export function Reel() {
  if (!media.portrait) {
    return (
      <p className="example-note">
        The public sample set has no portrait clip. Set NEXT_PUBLIC_RSP_PORTRAIT_URL to a 9:16 video, or use the local fixtures (NEXT_PUBLIC_RSP_MEDIA=local).
      </p>
    );
  }
  return (
    <Player
      source={{ src: media.portrait, type: 'mp4' }}
      layout="reel"
      aspectRatio="9 / 16"
      fit="contain"
      defaultVolume={0.7}
      motion={{ enabled: true, reducedMotion: 'system' }}
    />
  );
}
