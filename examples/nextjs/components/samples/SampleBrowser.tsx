'use client';

import { useRef, useState } from 'react';
import { Player, type PlayerCapabilities, type PlayerRef } from 'react-stream-player';
import { buildCatalog, STATUS_LABELS, statusCounts, type RawCategory, type SampleEntry, type SampleStatus } from './catalog';
import { sameOrigin } from './proxy';
import data from './samples.json';

// Classified once per page load; entries (and their configs) are stable
// objects, so re-rendering the browser never reloads the player.
const CATALOG = buildCatalog(data as RawCategory[], { corsUrl: sameOrigin });
const CATEGORIES = [...new Set(CATALOG.map((entry) => entry.category))];
const TOTALS = statusCounts(CATALOG);
const STATUSES = Object.keys(STATUS_LABELS) as SampleStatus[];

export function SampleBrowser() {
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideUnsupported, setHideUnsupported] = useState(false);
  const entries = CATALOG.filter((entry) => entry.category === category && !(hideUnsupported && entry.status === 'unsupported'));
  const selected = CATALOG.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="samples">
      <p className="example-note">
        {CATALOG.length} samples in {CATEGORIES.length} categories:{' '}
        {STATUSES.map((status) => `${TOTALS[status]} ${STATUS_LABELS[status].toLowerCase()}`).join(' · ')}.
      </p>
      <label className="example-note">
        <input type="checkbox" checked={hideUnsupported} onChange={(e) => setHideUnsupported(e.target.checked)} /> Hide samples this package cannot load
      </label>
      <nav aria-label="Sample categories">
        {CATEGORIES.map((name) => (
          <button key={name} type="button" aria-pressed={name === category} onClick={() => setCategory(name)}>
            {name} ({CATALOG.filter((entry) => entry.category === name).length})
          </button>
        ))}
      </nav>
      <ul className="sample-list" aria-label={`${category} samples`}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button type="button" aria-pressed={entry.id === selectedId} onClick={() => setSelectedId(entry.id)}>
              {entry.name}
            </button>{' '}
            <span className={`sample-badge sample-badge-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
          </li>
        ))}
      </ul>
      {/* Keyed by sample: exactly one player (one video) exists at a time. */}
      {selected ? <SampleDetails key={selected.id} entry={selected} /> : <p className="example-note">Choose a sample to see how it maps to the player.</p>}
    </div>
  );
}

function SampleDetails({ entry }: { entry: SampleEntry }) {
  const ref = useRef<PlayerRef>(null);
  const [log, setLog] = useState<string[]>([]);
  const [caps, setCaps] = useState<PlayerCapabilities | null>(null);
  const push = (line: string) => setLog((lines) => [line, ...lines].slice(0, 12));
  const titleId = `sample-${entry.id.replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section className="sample-details" aria-labelledby={titleId}>
      <h2 id={titleId}>{entry.name}</h2>
      <p className="example-note">
        {entry.category} · <span className={`sample-badge sample-badge-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
      </p>
      <ul className="example-note">
        {entry.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <p className="sample-uri">
        <code>{entry.raw.uri ?? `${entry.raw.playlist?.length ?? 0} playlist items`}</code>
      </p>
      {entry.config ? (
        <>
          <Player
            ref={ref}
            title={entry.name}
            {...entry.config}
            autoplay={{ enabled: true, mutedFallback: true }}
            onReady={(info) => {
              push(`ready: ${info.engine} engine, ${info.sourceType}${info.isLive ? ', live' : ''}${info.duration ? `, ${Math.round(info.duration)} s` : ''}`);
              setCaps(ref.current?.getCapabilities() ?? null);
            }}
            onError={(error) => push(`error: ${error.code}${error.fatal ? ' (fatal)' : ''} — ${error.message}`)}
            onAdError={(error) => push(`ad error: ${error.code} — ${error.message}`)}
            onAdStart={(ad) => push(`ad started: ${ad.type}${ad.duration ? `, ${Math.round(ad.duration)} s` : ''}`)}
            onAvailableQualitiesChange={(qualities) => qualities.length && push(`qualities: ${qualities.map((q) => q.label).join(', ')}`)}
            onAvailableAudioTracksChange={(tracks) => tracks.length > 1 && push(`audio tracks: ${tracks.map((t) => t.label || t.language).join(', ')}`)}
            onAvailableSubtitlesChange={(tracks) => tracks.length && push(`subtitles: ${tracks.map((t) => t.label).join(', ')}`)}
          />
          <h3>Events</h3>
          <ol className="example-note" aria-live="polite">
            {log.map((line, i) => (
              <li key={`${log.length - i}`}>{line}</li>
            ))}
          </ol>
          {caps ? (
            <p className="example-note">
              Engine: {caps.engine ?? 'none'} · adaptive quality: {caps.adaptiveQuality.supported ? 'yes' : 'no'} · DRM: {caps.drm.supported ? 'yes' : `no (${caps.drm.reason})`} · request interception:{' '}
              {caps.requestInterception.supported ? 'yes' : 'no'}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
