'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// VAST has priority. Every direct item is ignored, even if VAST fails
// (invalid tag, no fill, timeout or a blocked SDK): content then plays
// without ads.
export function VastPrecedence() {
  const adTagUrl = media.vastTag ?? 'https://ads.example.com/vast';
  return (
    <Player
      source={{ src: media.progressive, type: 'mp4' }}
      ads={{
        enabled: true,
        vast: { adTagUrl, requestTimeoutMs: 10000 },
        items: [
          {
            id: 'suppressed-image',
            type: 'image',
            src: '/ads/must-not-load.png',
            alt: 'Suppressed direct creative',
            timing: { placement: 'overlay', at: 0 },
            duration: 10,
          },
        ],
      }}
      onAdError={(error) => console.warn('VAST failed; content continues without direct ads:', error.code)}
    />
  );
}
