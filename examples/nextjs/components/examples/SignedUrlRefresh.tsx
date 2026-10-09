'use client';

import { useEffect, useState } from 'react';
import { Player } from 'react-stream-player';
import { media } from '../media';

// Same-content signed URL refresh. The `id` (and `revision`) identify the
// content, so a new URL for the same id is a transport refresh: position,
// play state, selections and ad history are kept and the preroll does not
// replay. In a real app the URL comes from your backend; this demo appends a
// fake expiry parameter (it is not a signature).
function signedUrl(path: string): string {
  return `${path}?expires=${Math.floor(Date.now() / 1000) + 300}`;
}

export function SignedUrlRefresh() {
  const [src, setSrc] = useState(() => signedUrl(media.progressive));
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    // Refresh well before expiry.
    const timer = setInterval(() => {
      setSrc(signedUrl(media.progressive));
      setRefreshes((n) => n + 1);
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <Player
        source={{ id: 'movie-1', revision: 1, src, type: 'mp4' }}
        ads={{ items: [{ id: 'pre', type: 'text', text: 'Preroll (shown once per content session)', duration: 3, timing: { placement: 'preroll' } }] }}
      />
      <p className="example-note">URL refreshes: {refreshes}</p>
    </>
  );
}
