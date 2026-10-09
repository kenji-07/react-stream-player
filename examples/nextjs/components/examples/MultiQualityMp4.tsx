'use client';

import { useRef } from 'react';
import { Player, type PlayerRef } from 'react-stream-player';
import { media } from '../media';

// Several qualities of ONE progressive video (same content and timeline).
// Only the selected variant is loaded; switching keeps position, play state,
// volume, rate and subtitles.
export function MultiQualityMp4() {
  const ref = useRef<PlayerRef>(null);

  return (
    <Player
      ref={ref}
      source={{
        id: 'movie-1',
        type: 'mp4',
        variants: [
          { id: '216p', src: media.mp4.p216, label: '216p', height: 216 },
          { id: '360p', src: media.mp4.p360, label: '360p', height: 360 },
          { id: '540p', src: media.mp4.p540, label: '540p', height: 540 },
        ],
      }}
      poster={media.poster}
      title="Multi-quality MP4"
      defaultQuality="360p"
      defaultVolume={0.7}
      playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 2]}
      fit="contain"
      contextMenu={{ enabled: true }}
      subtitles={[
        { id: 'en', src: media.subs.en, label: 'English', language: 'en' },
        { id: 'mn', src: media.subs.mn, label: 'Монгол', language: 'mn' },
      ]}
      defaultSubtitleLanguage="mn"
      subtitleStyle={{ fontSize: '20px', bottom: '40px', color: '#fff' }}
      onError={(error) => console.error(error.code, error.message)}
    />
  );
}
