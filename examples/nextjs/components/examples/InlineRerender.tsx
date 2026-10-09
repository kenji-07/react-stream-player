'use client';

import { useEffect, useState } from 'react';
import { Player } from 'react-stream-player';
import { media } from '../media';

// Unchanged inline props: the parent re-renders every second and passes new
// object/array literals with the same values. The player compares values,
// not references, so nothing reloads (loadStart fires once).
export function InlineRerender() {
  const [tick, setTick] = useState(0);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <Player
        source={{ id: 'movie-1', src: media.progressive, type: 'mp4' }}
        subtitles={[media.subtitles[0]!]}
        subtitleStyle={{ fontSize: '20px' }}
        streaming={{ bufferingGoal: 30 }}
        onLoadStart={() => setLoads((n) => n + 1)}
        onProgress={() => undefined /* a new function each render is fine too */}
      />
      <p className="example-note">
        Parent renders: {tick} — engine loads: {loads}
      </p>
    </>
  );
}
