'use client';

import { useState } from 'react';
import { Player } from 'react-stream-player';
import { media } from '../media';

// Controlled volume, mute and rate: the player reports viewer changes through
// the callbacks and renders whatever the props say. Omitting a callback (or
// ignoring it) keeps the controlled value.
export function ControlledState() {
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  return (
    <>
      <Player
        source={{ src: media.mp4.p360, type: 'mp4' }}
        volume={volume}
        onVolumeChange={setVolume}
        muted={muted}
        onMutedChange={setMuted}
        playbackRate={rate}
        onPlaybackRateChange={setRate}
      />
      <div className="example-controls">
        <label>
          Volume {Math.round(volume * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
        </label>
        <button type="button" onClick={() => setMuted((m) => !m)}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback rate">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
