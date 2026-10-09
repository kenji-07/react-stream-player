'use client';

import { useRef, useState } from 'react';
import { Player, type PlayerCapabilities, type PlayerRef } from 'react-stream-player';
import { media } from '../media';

// Native mode uses the browser's own controls and caption rendering instead of
// the prebuilt UI. Capabilities report what differs (e.g. no package context
// menu, no request interception for progressive MP4).
export function NativeMode() {
  const ref = useRef<PlayerRef>(null);
  const [caps, setCaps] = useState<PlayerCapabilities | null>(null);

  return (
    <>
      <Player
        ref={ref}
        ui="native"
        source={{ src: media.mp4.p360, type: 'mp4' }}
        subtitles={[{ id: 'en', src: media.subs.en, label: 'English', language: 'en' }]}
        onReady={() => setCaps(ref.current?.getCapabilities() ?? null)}
      />
      {caps ? (
        <table className="example-note">
          <tbody>
            {Object.entries(caps)
              .filter(([key]) => key !== 'engine')
              .map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{key}</th>
                  <td>{typeof value === 'object' && value !== null ? (value.supported ? 'yes' : `no — ${value.reason}`) : String(value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
