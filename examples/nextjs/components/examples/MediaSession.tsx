'use client';

import { Player } from 'react-stream-player';
import { media } from '../media';

// Media Session (lock screen / hardware keys) is opt-in. The player that is
// playing owns navigator.mediaSession; on unmount it clears only what it set.
// Seek actions are ignored during linear ads. Next/previous track actions are
// not registered (there are no playlists).
export function MediaSession() {
  return (
    <Player
      source={{ src: media.mp4.p360, type: 'mp4' }}
      mediaSession={{
        enabled: true,
        title: 'Example video',
        artist: 'Example publisher',
        artwork: [{ src: media.poster, sizes: '640x360', type: 'image/png' }],
      }}
    />
  );
}
