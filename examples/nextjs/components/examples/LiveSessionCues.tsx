'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// Live ads must use explicit session-time cues in v1: `at` counts seconds of
// ACTIVE content playback in this content session (paused, buffering and ad
// time do not count; seeking/DVR movement does not change it). Media-time
// cues and postrolls are rejected for live content. After a live midroll the
// player returns to the live edge, or to the DVR position if it still exists.
export function LiveSessionCues() {
  if (!media.liveHls) return <p className="example-note">Set NEXT_PUBLIC_RSP_LIVE_HLS_URL to a live HLS playlist with a DVR window.</p>;
  return (
    <Player
      source={{ id: 'channel-1', src: media.liveHls, type: 'hls' }}
      live={{ edgeTolerance: 3 }}
      ads={{
        items: [
          { id: 'live-pre', type: 'text', text: 'Live preroll', duration: 5, timing: { placement: 'preroll' } },
          { id: 'live-10min', type: 'video', source: { src: media.adVideo, type: 'mp4' }, timing: { placement: 'midroll', at: 600, timeBase: 'session' } },
          { id: 'live-banner', type: 'image', src: media.adImage, alt: 'Sponsor', duration: 10, timing: { placement: 'overlay', at: 120, timeBase: 'session' } },
        ],
      }}
      onLiveRestore={(info) => console.info('restored after ad:', info.reason)}
      onLiveStateChange={(live) => console.info('at live edge:', live.atLiveEdge)}
    />
  );
}
