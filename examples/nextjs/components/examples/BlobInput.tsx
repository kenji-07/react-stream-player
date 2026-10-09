'use client';

import { useState } from 'react';
import { Player } from 'react-stream-player';

// Safe Blob inputs: pass the File/Blob itself. The package creates the object
// URL, keeps it alive while the video/track uses it and revokes it after
// detaching. (A `blob:` string you created yourself stays yours to revoke.)
export function BlobInput() {
  const [video, setVideo] = useState<File | null>(null);
  const [subtitle, setSubtitle] = useState<File | null>(null);

  return (
    <>
      <div className="example-controls">
        <label>
          Video (MP4/WebM){' '}
          <input type="file" accept="video/mp4,video/webm" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          WebVTT{' '}
          <input type="file" accept=".vtt,text/vtt" onChange={(e) => setSubtitle(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {video ? (
        <Player
          source={{ src: video, type: 'mp4' }}
          title={video.name}
          subtitles={subtitle ? [{ id: 'local', src: subtitle, label: subtitle.name, language: 'und' }] : []}
          defaultSubtitleTrack={subtitle ? 'local' : null}
        />
      ) : (
        <p className="example-note">Choose a local video file.</p>
      )}
    </>
  );
}
