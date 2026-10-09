/**
 * Renders the active cues of ONE native TextTrack (mode "hidden") into a DOM
 * layer so that `subtitleStyle` applies and captions stay inside the
 * container-fullscreen subtree. The same cues are never rendered natively at
 * the same time (the track stays "hidden"; it only switches to "showing" while
 * the platform displays the video element itself in fullscreen/PiP, during
 * which this renderer is suspended).
 *
 * Cue content comes from the browser's WebVTT parser (`getCueAsHTML`), which
 * only produces inert formatting nodes; nothing is parsed as HTML here.
 */
export class NativeCueRenderer {
  private track: TextTrack | null = null;
  private suspended = false;
  private readonly box: HTMLDivElement;
  private readonly onCueChange = () => this.render();

  constructor(layer: HTMLElement) {
    this.box = document.createElement('div');
    this.box.className = 'rsp-cues';
    this.box.setAttribute('aria-live', 'off');
    layer.appendChild(this.box);
  }

  get currentTrack(): TextTrack | null {
    return this.track;
  }

  attach(track: TextTrack | null): void {
    if (this.track === track) return;
    this.track?.removeEventListener('cuechange', this.onCueChange);
    this.track = track;
    track?.addEventListener('cuechange', this.onCueChange);
    this.render();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.render();
  }

  render(): void {
    this.box.replaceChildren();
    const track = this.track;
    if (!track || this.suspended || track.mode === 'disabled') return;
    const cues = track.activeCues;
    if (!cues || cues.length === 0) return;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i] as VTTCue | undefined;
      if (!cue) continue;
      const line = document.createElement('div');
      line.className = 'rsp-cue';
      const span = document.createElement('span');
      span.className = 'rsp-cue-text';
      if (typeof cue.getCueAsHTML === 'function') {
        span.appendChild(sanitizeFragment(cue.getCueAsHTML()));
      } else {
        span.textContent = stripCueTags(cue.text ?? '');
      }
      line.appendChild(span);
      this.box.appendChild(line);
    }
  }

  destroy(): void {
    this.attach(null);
    this.box.remove();
  }
}

const ALLOWED_TAGS = new Set(['B', 'I', 'U', 'SPAN', 'RUBY', 'RT', 'BR']);

/** Defence in depth: keep only inert WebVTT formatting elements and text. */
function sanitizeFragment(fragment: DocumentFragment): DocumentFragment {
  const out = document.createDocumentFragment();
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const target: Node = ALLOWED_TAGS.has(el.tagName) ? parent.appendChild(document.createElement(el.tagName.toLowerCase())) : parent;
    for (const child of Array.from(el.childNodes)) copy(child, target);
  };
  for (const child of Array.from(fragment.childNodes)) copy(child, out);
  return out;
}

export function stripCueTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}
