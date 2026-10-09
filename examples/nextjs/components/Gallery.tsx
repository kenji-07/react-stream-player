'use client';

import { useState, type ComponentType } from 'react';
import { PlayerErrorBoundary } from 'react-stream-player';
import { DashVod, HlsVod, LowLatencyLiveDash } from './examples/AdaptiveStreaming';
import { AudioTracks } from './examples/AudioTracks';
import { BlobInput } from './examples/BlobInput';
import { CaptureFrame } from './examples/CaptureFrame';
import { ControlledState } from './examples/ControlledState';
import { CoreApi } from './examples/CoreApi';
import { DirectAds } from './examples/DirectAds';
import { Drm } from './examples/Drm';
import { Fullscreen } from './examples/Fullscreen';
import { InlineRerender } from './examples/InlineRerender';
import { LiveSessionCues } from './examples/LiveSessionCues';
import { MediaSession } from './examples/MediaSession';
import { MultiQualityMp4 } from './examples/MultiQualityMp4';
import { NativeMode } from './examples/NativeMode';
import { Reel } from './examples/Reel';
import { SignedUrlRefresh } from './examples/SignedUrlRefresh';
import { TypedEvents } from './examples/TypedEvents';
import { VastPrecedence } from './examples/VastPrecedence';

const EXAMPLES: [string, ComponentType][] = [
  ['MP4 qualities + subtitles', MultiQualityMp4],
  ['Reel (9:16)', Reel],
  ['HLS VOD', HlsVod],
  ['DASH VOD', DashVod],
  ['Live DASH (low latency)', LowLatencyLiveDash],
  ['Direct ads', DirectAds],
  ['VAST precedence', VastPrecedence],
  ['Controlled volume/rate', ControlledState],
  ['Typed events', TypedEvents],
  ['Fullscreen', Fullscreen],
  ['Audio tracks', AudioTracks],
  ['DRM', Drm],
  ['Blob input', BlobInput],
  ['Capture frame', CaptureFrame],
  ['Native UI', NativeMode],
  ['Inline rerenders', InlineRerender],
  ['Signed URL refresh', SignedUrlRefresh],
  ['Live session-time ads', LiveSessionCues],
  ['Media Session', MediaSession],
  ['Core (no React wrapper)', CoreApi],
];

export function Gallery() {
  const [index, setIndex] = useState(0);
  const [name, Example] = EXAMPLES[index]!;
  return (
    <>
      <nav aria-label="Examples">
        {EXAMPLES.map(([label], i) => (
          <button key={label} type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
            {label}
          </button>
        ))}
      </nav>
      <h2>{name}</h2>
      {/* Only one example — one video — is mounted at a time. */}
      <PlayerErrorBoundary key={name}>
        <Example />
      </PlayerErrorBoundary>
    </>
  );
}
