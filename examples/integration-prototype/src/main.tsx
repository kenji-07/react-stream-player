import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { counters, ProtoPlayer, type ProtoOptions, type ProtoSource } from './proto-player';

// ---- Vanilla API used by the gate runner ------------------------------------
let current: ProtoPlayer | null = null;
const stage = () => document.getElementById('stage') as HTMLElement;

async function mount(opts: Omit<ProtoOptions, 'container'>) {
  if (current) await current.destroy();
  const host = document.createElement('div');
  host.className = 'proto-host';
  stage().replaceChildren(host);
  current = new ProtoPlayer({ ...opts, container: host });
  await current.load();
  return true;
}

// ---- React harness: inline objects + changing callbacks + Strict Mode --------
const adHistory = new Map<string, Set<string>>(); // contentSessionKey -> completed/started ad ids
export const reactStats = { adStarts: 0, renders: 0 };

function semanticKey(source: ProtoSource): string {
  if (source.kind === 'mp4') return JSON.stringify(['mp4', source.variants.map((v) => [v.id, v.src])]);
  return JSON.stringify(['shaka', source.src, source.mimeType]);
}

function ProtoReact(props: {
  source: ProtoSource;
  ads: { items: { id: string; placement: 'preroll' }[] };
  onEvent: (name: string) => void;
}) {
  reactStats.renders++;
  const ref = useRef<HTMLDivElement>(null);
  const onEventRef = useRef(props.onEvent);
  onEventRef.current = props.onEvent; // callbacks read through refs; never re-init
  const key = semanticKey(props.source);
  const sourceRef = useRef(props.source);
  sourceRef.current = props.source;
  const adsKey = JSON.stringify(props.ads.items.map((a) => [a.id, a.placement]));
  const adsRef = useRef(props.ads);
  adsRef.current = props.ads;

  useEffect(() => {
    const host = document.createElement('div');
    ref.current!.appendChild(host);
    const player = new ProtoPlayer({ container: host, source: sourceRef.current });
    let cancelled = false;
    void player.load().then(() => {
      if (cancelled) return;
      const history = adHistory.get(key) ?? new Set<string>();
      adHistory.set(key, history);
      for (const ad of adsRef.current.items) {
        if (ad.placement === 'preroll' && !history.has(ad.id)) {
          history.add(ad.id);
          reactStats.adStarts++;
          onEventRef.current(`adstart:${ad.id}`);
        }
      }
    });
    return () => {
      cancelled = true;
      void player.destroy();
      host.remove();
    };
  }, [key, adsKey]);

  return <div ref={ref} className="proto-react-host" />;
}

function Harness({ initial }: { initial: ProtoSource }) {
  const [tick, setTick] = useState(0);
  const [source, setSource] = useState(initial);
  (window as any).__protoReactSetSource = setSource;
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, []);
  // Every render passes NEW but semantically identical inline objects.
  const inlineSource: ProtoSource =
    source.kind === 'mp4' ? { ...source, variants: source.variants.map((v) => ({ ...v })) } : { ...source };
  return (
    <ProtoReact
      source={inlineSource}
      ads={{ items: [{ id: 'pre-1', placement: 'preroll' }] }}
      onEvent={(name) => ((window as any).__protoEvents ??= []).push(`${name}@${tick}`)}
    />
  );
}

let reactRoot: Root | null = null;

Object.assign(window, {
  __proto: {
    counters,
    reactStats,
    mount,
    get player() {
      return current;
    },
    destroy: async () => {
      await current?.destroy();
      current = null;
    },
    mountReact(initial: ProtoSource) {
      const el = document.createElement('div');
      stage().replaceChildren(el);
      reactRoot = createRoot(el);
      reactRoot.render(
        <StrictMode>
          <Harness initial={initial} />
        </StrictMode>,
      );
    },
    unmountReact() {
      reactRoot?.unmount();
      reactRoot = null;
    },
  },
});
document.body.dataset.ready = '1';
