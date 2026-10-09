'use client';

import { useEffect, useRef, useState } from 'react';
import { isPlayerError, Player, type PlayerRef } from 'react-stream-player';
import { media } from '../media';

// Screenshot ownership: captureFrame() resolves a PNG Blob that belongs to the
// caller. The package creates no object URL for it, so the URL created here is
// revoked here (on replacement and on unmount). Protected (DRM) and
// cross-origin media without CORS reject instead of returning a frame.
export function CaptureFrame() {
  const ref = useRef<PlayerRef>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const capture = async () => {
    setError(null);
    try {
      const blob = await ref.current?.captureFrame();
      if (blob) setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(isPlayerError(e) ? e.code : 'capture failed');
    }
  };

  return (
    <>
      <Player ref={ref} source={{ src: media.mp4.p360, type: 'mp4' }} network={{ crossOrigin: 'anonymous' }} />
      <div className="example-controls">
        <button type="button" onClick={() => void capture()}>
          Capture frame
        </button>
        {error ? <span className="example-note">{error}</span> : null}
      </div>
      {url ? <img src={url} alt="Captured video frame" width={320} /> : null}
    </>
  );
}
