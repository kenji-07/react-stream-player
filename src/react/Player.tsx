'use client';

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { createRef, PlayerController } from '../controller/controller.js';
import { isAllowedResourceUrl } from '../security/url.js';
import type { EventContext, PlayerEventMap } from '../types/events.js';
import { TypedEmitter } from '../utils/emitter.js';
import { PlayerErrorBoundary } from './PlayerErrorBoundary.js';
import { extractCallbacks, extractOptions, type PlayerProps } from './props.js';

function aspectRatioFor(props: PlayerProps): string {
  const value = props.aspectRatio;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*(\/\s*\d+(\.\d+)?\s*)?$/.test(value)) return value.trim();
  return props.layout === 'reel' ? '9 / 16' : '16 / 9';
}

function posterBackground(poster: string | undefined): string | undefined {
  if (!poster || !isAllowedResourceUrl(poster)) return undefined;
  return `url("${poster.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

function PlayerInner(props: PlayerProps) {
  const { ref, id, className, style } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PlayerController | null>(null);
  // Latest props are read through a ref: new callback identities and
  // semantically equal inline objects never re-initialise playback.
  const propsRef = useRef(props);
  propsRef.current = props;
  const [events] = useState(() => new TypedEmitter<PlayerEventMap, EventContext>());
  const [facade] = useState(() => {
    const ref = createRef(() => controllerRef.current, events);
    const destroy = ref.destroy;
    ref.destroy = async () => {
      await destroy();
      events.clear();
    };
    return ref;
  });
  useImperativeHandle(ref, () => facade, [facade]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Browser-only construction (never during SSR). Under Strict Mode the
    // first instance is destroyed synchronously before any async load completes.
    const controller = new PlayerController(root, extractOptions(propsRef.current), () => extractCallbacks(propsRef.current), events);
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.destroy('unmount');
      events.clear();
    };
  }, [events]);

  useEffect(() => {
    // Runs after every render; the controller diffs semantically and applies
    // only real changes (see docs/api.md "Prop updates").
    controllerRef.current?.update(extractOptions(props));
  });

  const rootStyle: CSSProperties = {
    aspectRatio: aspectRatioFor(props),
    ...(posterBackground(props.poster) ? ({ '--rsp-poster': posterBackground(props.poster) } as CSSProperties) : {}),
    ...style,
  };
  return (
    <div
      ref={rootRef}
      id={id}
      className={className ? `rsp-root ${className}` : 'rsp-root'}
      style={rootStyle}
      data-layout={props.layout === 'reel' ? 'reel' : 'standard'}
    />
  );
}

/**
 * Plays one video (progressive MP4 variants, HLS or DASH) with the package's
 * own controls. Client component; safe to import on the server. See
 * docs/api.md for every prop.
 */
export function Player(props: PlayerProps) {
  return (
    <PlayerErrorBoundary>
      <PlayerInner {...props} />
    </PlayerErrorBoundary>
  );
}
