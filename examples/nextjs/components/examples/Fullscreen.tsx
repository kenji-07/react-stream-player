'use client';

import { useRef, useState } from 'react';
import { isPlayerError, Player, type FullscreenChangeInfo, type PlayerRef } from 'react-stream-player';
import { media } from '../media';

// Browser fullscreen uses the Fullscreen API (video-only on iPhone); web
// fullscreen fills the page with CSS. Requests reject with a PlayerError when
// the browser refuses; state always follows real browser events.
export function Fullscreen() {
  const ref = useRef<PlayerRef>(null);
  const [state, setState] = useState<FullscreenChangeInfo>({ active: false, mode: null, videoOnly: false });
  const [message, setMessage] = useState<string | null>(null);

  const request = (mode: 'browser' | 'web') => {
    setMessage(null);
    ref.current?.fullscreen.request(mode).catch((error: unknown) => {
      setMessage(isPlayerError(error) ? error.code : 'fullscreen failed');
    });
  };

  return (
    <>
      <Player ref={ref} source={{ src: media.progressive, type: 'mp4' }} fullscreen={{ mode: 'web', fallbackToWeb: true }} onFullscreenChange={setState} />
      <div className="example-controls">
        <button type="button" onClick={() => request('browser')}>
          Browser fullscreen
        </button>
        <button type="button" onClick={() => request('web')}>
          Web fullscreen
        </button>
        <span className="example-note">
          {state.active ? `active: ${state.mode}${state.videoOnly ? ' (video only)' : ''}` : 'inline'}
          {message ? ` — ${message}` : ''}
        </span>
      </div>
    </>
  );
}
