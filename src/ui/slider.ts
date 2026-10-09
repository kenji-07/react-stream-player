import { clampNumber, el, listen } from './dom.js';

export interface SliderOptions {
  className: string;
  label: string;
  /** Arrow-key step, in value units. */
  step: () => number;
  /** PageUp/PageDown step, in value units. */
  pageStep: () => number;
  /** Spoken value (`aria-valuetext`). */
  valueText: (value: number) => string;
  /** Tooltip text while hovering/dragging; `null` disables the tooltip. */
  tooltipText?: ((value: number) => string) | null;
  /** Continuous preview while dragging (optional). */
  onInput?: (value: number) => void;
  /** Final value: pointer release, keyboard. */
  onCommit: (value: number) => void;
  /** A pointer interaction started (user activation). */
  onInteract?: () => void;
}

/**
 * A horizontal slider following the WAI-ARIA slider pattern: focusable
 * `role="slider"` with min/max/now/valuetext, Arrow/Page/Home/End keys, and
 * pointer drag with capture. While dragging, external `setValue()` calls do
 * not move the thumb (the viewer's position wins until release).
 */
export class Slider {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly bufferedLayer: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly tooltip: HTMLElement | null;
  private min = 0;
  private max = 0;
  private value = 0;
  private dragging = false;
  private disabled = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly options: SliderOptions) {
    const root = el('div', `rsp-slider ${options.className}`);
    root.setAttribute('role', 'slider');
    root.tabIndex = 0;
    root.setAttribute('aria-label', options.label);
    root.setAttribute('aria-orientation', 'horizontal');
    const track = el('div', 'rsp-slider-track');
    this.bufferedLayer = el('div', 'rsp-slider-buffered');
    this.fill = el('div', 'rsp-slider-fill');
    this.thumb = el('div', 'rsp-slider-thumb');
    track.append(this.bufferedLayer, this.fill);
    root.append(track, this.thumb);
    this.tooltip = options.tooltipText ? el('div', 'rsp-slider-tooltip') : null;
    if (this.tooltip) {
      this.tooltip.setAttribute('aria-hidden', 'true');
      this.tooltip.hidden = true;
      root.appendChild(this.tooltip);
    }
    this.element = root;
    this.cleanups.push(
      listen(root, 'pointerdown', (e) => this.onPointerDown(e)),
      listen(root, 'pointermove', (e) => this.onPointerMove(e)),
      listen(root, 'pointerup', (e) => this.onPointerUp(e)),
      listen(root, 'pointercancel', () => this.endDrag(false)),
      listen(root, 'lostpointercapture', () => this.endDrag(false)),
      listen(root, 'pointerleave', () => {
        if (!this.dragging && this.tooltip) this.tooltip.hidden = true;
      }),
      listen(root, 'keydown', (e) => this.onKeyDown(e)),
    );
    this.render();
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  setLabel(label: string): void {
    this.element.setAttribute('aria-label', label);
  }

  setRange(min: number, max: number): void {
    const valid = Number.isFinite(min) && Number.isFinite(max) && max > min;
    this.min = valid ? min : 0;
    this.max = valid ? max : 0;
    this.setDisabled(!valid);
    this.render();
  }

  setValue(value: number): void {
    if (this.dragging) return;
    this.value = Number.isFinite(value) ? value : 0;
    this.render();
  }

  /** Buffered ranges in value units (e.g. seconds), drawn behind the fill. */
  setBuffered(ranges: Array<{ start: number; end: number }>): void {
    const span = this.max - this.min;
    const segments = span > 0 ? ranges.filter((r) => r.end > this.min && r.start < this.max) : [];
    while (this.bufferedLayer.children.length > segments.length) this.bufferedLayer.lastElementChild?.remove();
    segments.forEach((range, index) => {
      let segment = this.bufferedLayer.children[index] as HTMLElement | undefined;
      if (!segment) {
        segment = el('div', 'rsp-slider-buffered-range');
        this.bufferedLayer.appendChild(segment);
      }
      const start = (clampNumber(range.start, this.min, this.max) - this.min) / span;
      const end = (clampNumber(range.end, this.min, this.max) - this.min) / span;
      segment.style.left = `${start * 100}%`;
      segment.style.width = `${Math.max(0, end - start) * 100}%`;
    });
  }

  private setDisabled(disabled: boolean): void {
    if (this.disabled === disabled) return;
    this.disabled = disabled;
    if (disabled) {
      this.element.setAttribute('aria-disabled', 'true');
      this.element.tabIndex = -1;
    } else {
      this.element.removeAttribute('aria-disabled');
      this.element.tabIndex = 0;
    }
  }

  private fraction(value: number): number {
    const span = this.max - this.min;
    return span > 0 ? clampNumber((value - this.min) / span, 0, 1) : 0;
  }

  private render(): void {
    const fraction = this.fraction(this.value);
    this.fill.style.width = `${fraction * 100}%`;
    this.thumb.style.left = `${fraction * 100}%`;
    const root = this.element;
    root.setAttribute('aria-valuemin', String(Math.floor(this.min * 100) / 100));
    root.setAttribute('aria-valuemax', String(Math.floor(this.max * 100) / 100));
    root.setAttribute('aria-valuenow', String(Math.floor(clampNumber(this.value, this.min, this.max) * 100) / 100));
    root.setAttribute('aria-valuetext', this.options.valueText(this.value));
  }

  private valueAt(clientX: number): number {
    const rect = this.element.getBoundingClientRect();
    const fraction = rect.width > 0 ? clampNumber((clientX - rect.left) / rect.width, 0, 1) : 0;
    return this.min + fraction * (this.max - this.min);
  }

  private showTooltip(clientX: number, value: number): void {
    if (!this.tooltip || !this.options.tooltipText) return;
    this.tooltip.textContent = this.options.tooltipText(value);
    this.tooltip.hidden = false;
    const rect = this.element.getBoundingClientRect();
    const half = this.tooltip.offsetWidth / 2;
    const x = clampNumber(clientX - rect.left, half, Math.max(half, rect.width - half));
    this.tooltip.style.left = `${x}px`;
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.disabled || event.button !== 0) return;
    this.options.onInteract?.();
    event.preventDefault();
    this.element.focus({ preventScroll: true });
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    this.dragging = true;
    this.element.dataset.dragging = '';
    this.preview(event.clientX);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.disabled) return;
    if (this.dragging) this.preview(event.clientX);
    else if (event.pointerType === 'mouse') this.showTooltip(event.clientX, this.valueAt(event.clientX));
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragging) return;
    this.value = this.valueAt(event.clientX);
    this.endDrag(true);
  }

  private preview(clientX: number): void {
    this.value = this.valueAt(clientX);
    this.render();
    this.showTooltip(clientX, this.value);
    this.options.onInput?.(this.value);
  }

  private endDrag(commit: boolean): void {
    if (!this.dragging) return;
    this.dragging = false;
    delete this.element.dataset.dragging;
    if (this.tooltip) this.tooltip.hidden = true;
    this.render();
    if (commit) this.options.onCommit(this.value);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.disabled || event.ctrlKey || event.altKey || event.metaKey) return;
    const step = this.options.step();
    const page = this.options.pageStep();
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = this.value - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = this.value + step;
        break;
      case 'PageDown':
        next = this.value - page;
        break;
      case 'PageUp':
        next = this.value + page;
        break;
      case 'Home':
        next = this.min;
        break;
      case 'End':
        next = this.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    // Handled here: the player's hotkeys must not also act on this key.
    event.stopPropagation();
    this.value = clampNumber(next, this.min, this.max);
    this.render();
    this.options.onCommit(this.value);
  }

  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}
