import type { PlayerError } from '../types/errors.js';
import type { WatermarkConfig } from '../types/config.js';
import { isAllowedResourceUrl } from '../security/url.js';
import type { Translations } from './i18n.js';

/**
 * Minimal package-owned layers mounted inside the UI's fullscreen subtree:
 * captions, ads, status (fatal error) and watermark. They never replace the
 * prebuilt content controls.
 */
export class PlayerLayers {
  readonly text: HTMLElement;
  readonly ads: HTMLElement;
  readonly status: HTMLElement;
  readonly watermark: HTMLElement;
  private errorPanel: HTMLElement | null = null;
  private watermarkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(host: HTMLElement) {
    const make = (className: string) => {
      const el = document.createElement('div');
      el.className = className;
      host.appendChild(el);
      return el;
    };
    this.text = make('rsp-text-layer');
    this.watermark = make('rsp-watermark-layer');
    this.watermark.setAttribute('aria-hidden', 'true');
    this.ads = make('rsp-ad-layer');
    this.status = make('rsp-status-layer');
  }

  showError(error: PlayerError, t: Translations, onRetry: (() => void) | null): void {
    this.clearError();
    const panel = document.createElement('div');
    panel.className = 'rsp-error';
    panel.setAttribute('role', 'alert');
    const title = document.createElement('p');
    title.className = 'rsp-error-title';
    title.textContent = t.errorTitle;
    const body = document.createElement('p');
    body.className = 'rsp-error-message';
    body.textContent = t.errors[error.category] ?? t.errors.unexpected;
    const code = document.createElement('p');
    code.className = 'rsp-error-code';
    code.textContent = error.code;
    panel.append(title, body, code);
    if (onRetry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rsp-error-retry';
      button.textContent = t.retry;
      button.addEventListener('click', onRetry);
      panel.appendChild(button);
    }
    this.status.appendChild(panel);
    this.errorPanel = panel;
    requestAnimationFrame(() => panel.classList.add('rsp-visible'));
  }

  clearError(): void {
    this.errorPanel?.remove();
    this.errorPanel = null;
  }

  setWatermark(config: WatermarkConfig | undefined): void {
    if (this.watermarkTimer) clearInterval(this.watermarkTimer);
    this.watermarkTimer = null;
    this.watermark.replaceChildren();
    if (!config || (!config.text && !config.image)) return;
    const mark = document.createElement('div');
    mark.className = 'rsp-watermark';
    mark.style.opacity = String(Math.min(1, Math.max(0, config.opacity ?? 0.3)));
    if (config.image && isAllowedResourceUrl(config.image)) {
      const img = document.createElement('img');
      img.src = config.image;
      img.alt = '';
      mark.appendChild(img);
    }
    if (config.text) {
      const span = document.createElement('span');
      span.textContent = config.text;
      mark.appendChild(span);
    }
    const positions = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
    let index = Math.max(0, positions.indexOf((config.position ?? 'top-right') as (typeof positions)[number]));
    mark.dataset.position = config.position ?? 'top-right';
    this.watermark.appendChild(mark);
    if (config.moveIntervalMs && config.moveIntervalMs >= 1000) {
      this.watermarkTimer = setInterval(() => {
        index = (index + 1) % positions.length;
        mark.dataset.position = positions[index]!;
      }, config.moveIntervalMs);
    }
  }

  destroy(): void {
    if (this.watermarkTimer) clearInterval(this.watermarkTimer);
    this.text.remove();
    this.ads.remove();
    this.status.remove();
    this.watermark.remove();
  }
}
