'use client';

import { useEffect, useRef, useState } from 'react';
import { Player, type EventContext, type PlayerRef, type ProgressInfo, type QualitySelection } from 'react-stream-player';
import { media } from '../media';

// Typed event subscriptions with cleanup. Payload types come from the event
// name; the context identifies the content session/load that produced it.
export function TypedEvents() {
  const ref = useRef<PlayerRef>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onProgress = (info: ProgressInfo, context: EventContext) => {
      setLog((l) => [`progress ${info.currentTime.toFixed(1)}s (session ${context.contentSessionId})`, ...l].slice(0, 5));
    };
    const offProgress = player.on('progress', onProgress);
    const offQuality = player.on('qualityChange', (selection: QualitySelection) => {
      setLog((l) => [`quality → ${selection.id}`, ...l].slice(0, 5));
    });
    // `once` listeners are removed before they run.
    player.once('ready', (info) => setLog((l) => [`ready (${info.engine}, ${info.sourceType})`, ...l]));
    return () => {
      offProgress();
      offQuality();
    };
  }, []);

  return (
    <>
      <Player ref={ref} source={{ src: media.hls, type: 'hls' }} progressInterval={500} />
      <ol className="example-note">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </>
  );
}
