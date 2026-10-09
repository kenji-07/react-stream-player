// The README's code samples, verbatim, type-checked against the package entry
// points (`npm run typecheck`). The runnable versions live in
// examples/nextjs/components/examples and are type-checked the same way and
// built against the packed tarball by scripts/consumer-smoke.mjs.
'use client';

import { useRef } from 'react';
import { Player, type PlayerRef } from 'react-stream-player';
import 'react-stream-player/styles.css';

export function VideoExample() {
  const ref = useRef<PlayerRef>(null);

  return (
    <Player
      ref={ref}
      source={{
        id: 'movie-1',
        type: 'mp4',
        variants: [
          { id: '480p', src: '/movie-480.mp4', label: '480p', height: 480 },
          { id: '720p', src: '/movie-720.mp4', label: '720p', height: 720 },
          { id: '1080p', src: '/movie-1080.mp4', label: '1080p', height: 1080 },
        ],
      }}
      defaultQuality="720p"
      defaultVolume={0.7}
      playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 2]}
      fit="contain"
      contextMenu={{ enabled: true }}
      subtitles={[
        { id: 'en', src: '/subs/en.vtt', label: 'English', language: 'en' },
        { id: 'mn', src: '/subs/mn.vtt', label: 'Монгол', language: 'mn' },
      ]}
      defaultSubtitleLanguage="mn"
      subtitleStyle={{ fontSize: '20px', bottom: '40px', color: '#fff' }}
      onError={(error) => console.error(error.code, error.message)}
    />
  );
}

export const reel = (
  // One portrait video; no feed and no other video preloads.
  <Player
    source={{ src: '/portrait.mp4', type: 'mp4' }}
    layout="reel"
    aspectRatio="9 / 16"
    fit="contain"
    defaultVolume={0.7}
    motion={{ enabled: true, reducedMotion: 'system' }}
  />
);

export const adaptive = (
  <>
    <Player source={{ src: 'https://cdn.example.com/master.m3u8', type: 'hls' }} streaming={{ bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 30 }} />

    <Player source={{ src: 'https://cdn.example.com/live.mpd', type: 'dash' }} streaming={{ lowLatencyMode: true }} />
  </>
);

export const directAds = (
  // Direct creative types use distinct standard fields.
  <Player
    source={{ src: '/movie.mp4', type: 'mp4' }}
    ads={{
      enabled: true,
      items: [
        {
          id: 'intro-image',
          type: 'image',
          src: '/ads/banner.png',
          alt: 'Intro promotion',
          timing: { placement: 'preroll' },
          duration: 10,
          skipAfter: 5,
          clickThroughUrl: 'https://example.com/offer',
        },
        {
          id: 'mid-video',
          type: 'video',
          source: { src: '/ads/video.mp4', type: 'mp4' },
          timing: { placement: 'midroll', at: 120 },
          skipAfter: 10,
        },
        {
          id: 'text-offer',
          type: 'text',
          text: 'Special offer — click to learn more',
          timing: { placement: 'overlay', at: 300 },
          duration: 15,
          skipAfter: 5,
          style: { color: '#fff', backgroundColor: '#ff0000' },
          clickThroughUrl: 'https://example.com/offer',
        },
      ],
    }}
  />
);

export const vast = (
  // VAST has priority. Every direct item is ignored, even if VAST fails.
  <Player
    source={{ src: '/movie.mp4', type: 'mp4' }}
    ads={{
      enabled: true,
      vast: { adTagUrl: 'https://ads.example.com/vast', requestTimeoutMs: 10000 },
      items: [
        {
          id: 'suppressed-image',
          type: 'image',
          src: '/ads/must-not-load.png',
          alt: 'Suppressed direct creative',
          timing: { placement: 'overlay', at: 0 },
          duration: 10,
        },
      ],
    }}
  />
);

// Negative checks: invalid usage must not compile.
export const negative = (
  <>
    {/* @ts-expect-error variants require type "mp4" */}
    <Player source={{ type: 'hls', variants: [{ id: 'a', src: '/a.mp4', label: 'A' }] }} />
    {/* @ts-expect-error a Blob source must declare type "mp4" */}
    <Player source={{ src: new Blob() }} />
    {/* @ts-expect-error video ads cannot be overlays */}
    <Player source={{ src: '/a.mp4' }} ads={{ items: [{ id: 'v', type: 'video', source: { src: '/ad.mp4' }, timing: { placement: 'overlay', at: 1 } }] }} />
    {/* @ts-expect-error image ads need alt text */}
    <Player source={{ src: '/a.mp4' }} ads={{ items: [{ id: 'i', type: 'image', src: '/a.png', duration: 5, timing: { placement: 'preroll' } }] }} />
    {/* @ts-expect-error unknown fit value */}
    <Player source={{ src: '/a.mp4' }} fit="stretch" />
    {/* @ts-expect-error event payloads are typed */}
    <Player source={{ src: '/a.mp4' }} onVolumeChange={(volume: string) => volume} />
  </>
);
