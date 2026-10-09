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
        variants: media.variants,
      }}
      poster={media.poster}
      title="Multi-quality MP4"
      defaultQuality={media.defaultQuality}
      defaultVolume={0.7}
      playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 2]}
      fit="contain"
      contextMenu={{ enabled: true }}
      subtitles={media.subtitles}
      defaultSubtitleLanguage={media.defaultSubtitleLanguage}
      subtitleStyle={{ fontSize: '20px', bottom: '40px', color: '#fff' }}
      onError={(error) => console.error(error.code, error.message)}
    />
  );
}
