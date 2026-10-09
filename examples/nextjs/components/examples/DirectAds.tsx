'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// Direct creative types use distinct standard fields. Text is plain text, image
// ads need alt text, click-through opens only on viewer activation.
export function DirectAds() {
  return (
    <Player
      source={{ src: media.mp4.p360, type: 'mp4' }}
      ads={{
        enabled: true,
        items: [
          {
            id: 'intro-image',
            type: 'image',
            src: media.adImage,
            alt: 'Intro promotion',
            timing: { placement: 'preroll' },
            duration: 10,
            skipAfter: 5,
            clickThroughUrl: 'https://example.com/offer',
          },
          {
            id: 'mid-video',
            type: 'video',
            source: { src: media.adVideo, type: 'mp4' },
            timing: { placement: 'midroll', at: 8 },
            skipAfter: 3,
          },
          {
            id: 'text-offer',
            type: 'text',
            text: 'Special offer — click to learn more',
            timing: { placement: 'overlay', at: 14 },
            duration: 5,
            skipAfter: 2,
            style: { color: '#fff', backgroundColor: '#ff0000' },
            clickThroughUrl: 'https://example.com/offer',
          },
        ],
      }}
      onAdStart={(ad) => console.info('ad start', ad.id)}
      onAdBreakEnd={(info) => console.info('ad break end', info.reason)}
    />
  );
}
