'use client';

import { useState } from 'react';
import { Player, type AudioTrack } from 'react-stream-player';
import { media } from '../media';

// Multiple audio tracks from an HLS/DASH manifest. `defaultAudioLanguage`
// picks the initial track; `audioTrack` + `onAudioTrackChange` control it.
export function AudioTracks() {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  return (
    <>
      <Player
        source={{ src: media.hls, type: 'hls' }}
        defaultAudioLanguage="mn"
        audioTrack={selected}
        onAvailableAudioTracksChange={setTracks}
        onAudioTrackChange={(track) => track && setSelected(track.id)}
      />
      <div className="example-controls" role="group" aria-label="Audio language">
        {tracks.map((track) => (
          <button key={track.id} type="button" aria-pressed={track.id === selected} onClick={() => setSelected(track.id)}>
            {track.label} ({track.language})
          </button>
        ))}
      </div>
    </>
  );
}
