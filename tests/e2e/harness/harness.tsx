import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Player, type PlayerProps, type PlayerRef } from '../../../src/index.js';
import '../../../src/styles.css';

type Recorded = { name: string; payload: unknown; ctx: unknown; t: number; key: string };
const events: Recorded[] = [];
const EVENT_NAMES = [
  'ready', 'loadStart', 'statusChange', 'play', 'pause', 'playing', 'ended', 'progress', 'seeking', 'seeked', 'buffering',
  'durationChange', 'qualityChange', 'effectiveQualityChange', 'availableQualitiesChange', 'audioTrackChange',
  'availableAudioTracksChange', 'subtitleChange', 'availableSubtitlesChange', 'volumeChange', 'mutedChange',
  'playbackRateChange', 'fullscreenChange', 'pictureInPictureChange', 'liveStateChange', 'autoplayBlocked', 'error',
  'adBreakStart', 'adBreakEnd', 'adStart', 'adProgress', 'adSkip', 'adComplete', 'adClick', 'adError', 'liveRestore',
  'castStateChange', 'airplayChange', 'destroy',
] as const;

function serialize(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (k, v) => {
        if (v instanceof Blob) return `[blob ${v.size}]`;
        if (k === 'cause' && v instanceof Error) return { message: v.message, stack: v.stack };
        return v;
      }),
    );
  } catch {
    return String(value);
  }
}

function callbacks(generation: number, key: string): Partial<PlayerProps> {
  const out: Record<string, unknown> = {};
  for (const name of EVENT_NAMES) {
    if (name === 'progress' || name === 'adProgress') {
      out[`on${name[0]!.toUpperCase()}${name.slice(1)}`] = (payload: unknown, ctx: unknown) =>
        events.push({ name, payload: serialize(payload), ctx: serialize(ctx), t: performance.now(), key } as Recorded);
      continue;
    }
    // A NEW function identity on every render (callback changes must not reload).
    out[`on${name[0]!.toUpperCase()}${name.slice(1)}`] = (payload: unknown, ctx: unknown) => {
      events.push({ name, payload: serialize(payload), ctx: serialize(ctx), t: performance.now(), key } as Recorded);
      (window as any).__lastGeneration = generation;
    };
  }
  return out as Partial<PlayerProps>;
}

interface Instance {
  root: Root;
  props: PlayerProps;
  strict: boolean;
  ref: PlayerRef | null;
  generation: number;
}
const instances = new Map<string, Instance>();

/** Clones props so every render passes new-but-semantically-equal inline objects. */
function cloneProps(p: PlayerProps): PlayerProps {
  return cloneDeepKeepBlobs(p);
}

function cloneDeepKeepBlobs<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Blob || value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return value.map((v) => cloneDeepKeepBlobs(v)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = typeof v === 'function' ? v : cloneDeepKeepBlobs(v);
  return out as T;
}

function container(key: string): HTMLElement {
  if (key === 'a') return document.getElementById('app')!;
  let el = document.getElementById(`app-${key}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `app-${key}`;
    el.style.cssText = 'width:480px;margin:20px auto';
    document.getElementById('app')!.after(el);
  }
  return el;
}

function render(key: string): void {
  const inst = instances.get(key);
  if (!inst) return;
  inst.generation++;
  const props = { ...cloneProps(inst.props), ...callbacks(inst.generation, key) } as PlayerProps;
  const el = (
    <Player
      ref={(r) => {
        inst.ref = r;
      }}
      {...props}
    />
  );
  flushSync(() => inst.root.render(inst.strict ? <StrictMode>{el}</StrictMode> : el));
}

const api = {
  events,
  clearEvents() {
    events.length = 0;
  },
  mount(props: PlayerProps, options: { strict?: boolean; key?: string } = {}) {
    const key = options.key ?? 'a';
    let inst = instances.get(key);
    if (!inst) {
      inst = { root: createRoot(container(key)), props, strict: Boolean(options.strict), ref: null, generation: 0 };
      instances.set(key, inst);
    }
    inst.props = props;
    inst.strict = Boolean(options.strict);
    render(key);
  },
  update(patch: Partial<PlayerProps>, key = 'a') {
    const inst = instances.get(key);
    if (!inst) return;
    inst.props = { ...inst.props, ...patch };
    render(key);
  },
  /** Replaces props entirely (no merge). */
  replace(props: PlayerProps, key = 'a') {
    const inst = instances.get(key);
    if (!inst) return;
    inst.props = props;
    render(key);
  },
  rerender(times = 1, key = 'a') {
    for (let i = 0; i < times; i++) render(key);
  },
  unmount(key = 'a') {
    const inst = instances.get(key);
    inst?.root.unmount();
    instances.delete(key);
  },
  ref(key = 'a'): PlayerRef {
    const r = instances.get(key)?.ref;
    if (!r) throw new Error('no ref');
    return r;
  },
  props(key = 'a') {
    return instances.get(key)?.props;
  },
  makeBlob(parts: BlobPart[], type: string) {
    return new Blob(parts, { type });
  },
  async fetchBlob(url: string, type?: string) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return new Blob([buf], { type: type ?? res.headers.get('content-type') ?? '' });
  },
};
(window as any).__h = api;
document.body.dataset.ready = '1';
