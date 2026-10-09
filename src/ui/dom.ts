// DOM helpers for the package-owned controls. Every visible string goes through
// textContent or an attribute; nothing is ever parsed as HTML.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A real <button> (native keyboard and screen-reader semantics) with an accessible name. */
export function iconButton(className: string, label: string, icon: SVGSVGElement): HTMLButtonElement {
  const button = el('button', `rsp-button ${className}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.appendChild(icon);
  return button;
}

export function setLabel(node: HTMLElement, label: string): void {
  if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function setPressed(node: HTMLElement, pressed: boolean): void {
  const value = String(pressed);
  if (node.getAttribute('aria-pressed') !== value) node.setAttribute('aria-pressed', value);
}

/** `1:05`, `12:03`, `1:02:03`. Negative/invalid values render as `0:00`. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Adds an event listener and returns its removal. */
export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void;
export function listen(target: EventTarget, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): () => void;
export function listen(target: EventTarget, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): () => void {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}
