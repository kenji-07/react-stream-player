import type { HotkeyAction } from '../types/config.js';

export interface HotkeyConfig {
  enabled: boolean;
  bindings: Record<string, HotkeyAction>;
}

const INTERACTIVE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
/** Keys that activate a focused button; they must keep their native meaning there. */
const BUTTON_KEYS = new Set([' ', 'Enter']);

/**
 * The single keyboard owner for one player. Vendor hotkeys are disabled.
 * Shortcuts only run while focus is inside the player, never in editable or
 * interactive controls, during IME composition, for already-handled events or
 * with Ctrl/Alt/Meta modifiers.
 */
export class HotkeyManager {
  private readonly onKeyDown = (event: KeyboardEvent) => this.handle(event);

  constructor(
    private readonly root: HTMLElement,
    private config: () => HotkeyConfig,
    private readonly dispatch: (action: HotkeyAction, event: KeyboardEvent) => boolean,
  ) {
    root.addEventListener('keydown', this.onKeyDown);
  }

  handle(event: KeyboardEvent): void {
    const config = this.config();
    if (!config.enabled || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as Element | null;
    if (!target || !this.root.contains(target)) return;
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    const isButton = target.closest('button, a[href], [role="button"]') !== null;
    if (isButton && BUTTON_KEYS.has(event.key)) return;
    const action = config.bindings[event.key];
    if (!action) return;
    if (this.dispatch(action, event)) event.preventDefault();
  }

  destroy(): void {
    this.root.removeEventListener('keydown', this.onKeyDown);
  }
}
