/** True in a browser with a DOM. Never touch DOM globals at module evaluation time. */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function prefersReducedMotion(): boolean {
  if (!isBrowser() || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

let volumeProbe: boolean | null = null;
/**
 * Feature test (not UA sniffing): some platforms (notably iOS) ignore writes to
 * `HTMLMediaElement.volume`. Detected by writing to a detached element.
 */
export function canSetVolume(): boolean {
  if (volumeProbe !== null) return volumeProbe;
  if (!isBrowser()) return true;
  try {
    const probe = document.createElement('video');
    probe.volume = 0.5;
    volumeProbe = Math.abs(probe.volume - 0.5) < 0.01;
  } catch {
    volumeProbe = false;
  }
  return volumeProbe;
}

export function isSecureContextLike(): boolean {
  return isBrowser() && (window.isSecureContext ?? location.protocol === 'https:');
}
