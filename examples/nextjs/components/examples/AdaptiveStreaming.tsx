'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// HLS and DASH use Shaka Player (loaded on demand). Option names and units
// follow Shaka's documented configuration (seconds).
export function HlsVod() {
  return <Player source={{ src: media.hls, type: 'hls' }} streaming={{ bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 30 }} />;
}

export function DashVod() {
  return (
    <Player
      source={{ src: media.dash, type: 'dash' }}
      abr={{ restrictions: { maxHeight: 540 } }}
      network={{ retry: { segment: { maxAttempts: 4, baseDelayMs: 500 } } }}
    />
  );
}

export function LowLatencyLiveDash() {
  if (!media.liveDash) return <p className="example-note">Set NEXT_PUBLIC_RSP_LIVE_DASH_URL to a live DASH manifest.</p>;
  return <Player source={{ src: media.liveDash, type: 'dash' }} streaming={{ lowLatencyMode: true }} />;
}
