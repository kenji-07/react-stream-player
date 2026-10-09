import { el, listen } from './dom.js';
import { icons } from './icons.js';
import type { MenuSection } from './ui-adapter.js';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * Shared menu behaviour (WAI-ARIA menu pattern): items are buttons with
 * menu roles and tabindex -1; Arrow keys, Home and End move focus; Escape and
 * Tab close; a pointer press outside closes.
 */
abstract class MenuBase {
  readonly element: HTMLElement;
  protected readonly cleanups: Array<() => void> = [];
  private outsideCleanup: (() => void) | null = null;
  protected onClosed: ((reason: 'escape' | 'tab' | 'outside' | 'select' | 'api') => void) | null = null;

  constructor(className: string, label: string) {
    this.element = el('div', `rsp-menu ${className}`);
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', label);
    this.element.hidden = true;
    this.cleanups.push(listen(this.element, 'keydown', (e) => this.onKeyDown(e)));
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  setLabel(label: string): void {
    this.element.setAttribute('aria-label', label);
  }

  protected items(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter((item) => !item.closest('[hidden]'));
  }

  protected focusItem(index: number): void {
    const items = this.items();
    if (!items.length) return;
    items[(index + items.length) % items.length]!.focus({ preventScroll: true });
  }

  protected show(): void {
    this.element.hidden = false;
    // Defer so the opening click does not count as "outside".
    setTimeout(() => {
      if (this.element.hidden || this.outsideCleanup) return;
      const doc = this.element.ownerDocument;
      const off = listen(
        doc,
        'pointerdown',
        (event) => {
          if (!this.element.contains(event.target as Node) && !this.isTrigger(event.target as Node)) this.close('outside');
        },
        { capture: true },
      );
      this.outsideCleanup = off;
    }, 0);
  }

  /** Elements that toggle this menu themselves (their clicks are not "outside"). */
  protected isTrigger(_node: Node): boolean {
    return false;
  }

  close(reason: 'escape' | 'tab' | 'outside' | 'select' | 'api' = 'api'): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.outsideCleanup?.();
    this.outsideCleanup = null;
    this.onClosed?.(reason);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const items = this.items();
    const index = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        this.focusItem(index + 1);
        break;
      case 'ArrowUp':
        this.focusItem(index < 0 ? -1 : index - 1);
        break;
      case 'Home':
        this.focusItem(0);
        break;
      case 'End':
        this.focusItem(-1);
        break;
      case 'Escape':
        this.close('escape');
        break;
      case 'Tab':
        this.close('tab');
        return; // let focus move naturally
      default:
        return;
    }
    event.preventDefault();
    // Menu keys never reach the player's hotkeys.
    event.stopPropagation();
  }

  destroy(): void {
    this.outsideCleanup?.();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.element.remove();
  }
}

export type SettingsKey = 'quality' | 'audio' | 'subtitles' | 'speed';

export interface SettingsEntry {
  key: SettingsKey;
  title: string;
  section: MenuSection;
}

function menuButton(role: string, className: string): HTMLButtonElement {
  const button = el('button', `rsp-menu-item ${className}`);
  button.type = 'button';
  button.setAttribute('role', role);
  button.tabIndex = -1;
  return button;
}

/**
 * Settings popover: a root list (Quality, Audio, Subtitles, Speed with their
 * current values) and one radio submenu per entry. Selecting an option closes
 * the menu and returns focus to the settings button.
 */
export class SettingsMenu extends MenuBase {
  private entries: SettingsEntry[] = [];
  private view: SettingsKey | null = null;
  private backLabel = 'Back';

  constructor(
    label: string,
    private readonly trigger: HTMLElement,
    private readonly onSelect: (key: SettingsKey, value: string) => void,
  ) {
    super('rsp-settings-menu', label);
    this.onClosed = (reason) => {
      this.view = null;
      this.trigger.setAttribute('aria-expanded', 'false');
      if (reason !== 'outside' && reason !== 'tab') this.trigger.focus({ preventScroll: true });
    };
  }

  setBackLabel(label: string): void {
    this.backLabel = label;
  }

  protected override isTrigger(node: Node): boolean {
    return this.trigger.contains(node);
  }

  get hasEntries(): boolean {
    return this.entries.length > 0;
  }

  setEntries(entries: SettingsEntry[]): void {
    const focused = document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement) ? document.activeElement.dataset.value ?? document.activeElement.dataset.key ?? null : null;
    this.entries = entries;
    if (this.view && !entries.some((e) => e.key === this.view)) this.view = null;
    if (!entries.length) {
      this.close('api');
      this.element.replaceChildren();
      return;
    }
    if (this.isOpen) {
      this.render();
      if (focused) {
        const target = this.items().find((item) => item.dataset.value === focused || item.dataset.key === focused);
        target?.focus({ preventScroll: true });
      }
    }
  }

  open(): void {
    if (!this.entries.length) return;
    this.view = null;
    this.render();
    this.show();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.focusItem(0);
  }

  toggle(): void {
    if (this.isOpen) this.close('api');
    else this.open();
  }

  private render(): void {
    const entry = this.view ? this.entries.find((e) => e.key === this.view) : undefined;
    this.element.dataset.view = entry ? entry.key : 'root';
    if (!entry) {
      this.element.replaceChildren(
        ...this.entries.map((e) => {
          const item = menuButton('menuitem', 'rsp-menu-entry');
          item.dataset.key = e.key;
          item.setAttribute('aria-haspopup', 'menu');
          const label = el('span', 'rsp-menu-label', e.title);
          const value = el('span', 'rsp-menu-value', e.section.current);
          item.setAttribute('aria-label', `${e.title}: ${e.section.current}`);
          item.append(label, value, icons.chevronRight());
          item.addEventListener('click', () => this.openSubmenu(e.key));
          return item;
        }),
      );
      return;
    }
    const back = menuButton('menuitem', 'rsp-menu-back');
    back.setAttribute('aria-label', `${this.backLabel}: ${entry.title}`);
    back.append(icons.back(), el('span', 'rsp-menu-label', entry.title));
    back.addEventListener('click', () => this.showRoot(entry.key));
    const options = entry.section.items.map((option) => {
      const item = menuButton('menuitemradio', 'rsp-menu-option');
      item.dataset.value = option.value;
      item.setAttribute('aria-checked', String(option.checked));
      const check = icons.check();
      check.classList.add('rsp-menu-check');
      item.append(check, el('span', 'rsp-menu-label', option.label));
      item.addEventListener('click', () => {
        this.close('select');
        this.onSelect(entry.key, option.value);
      });
      return item;
    });
    const list = el('div', 'rsp-menu-options');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', entry.title);
    list.append(...options);
    this.element.replaceChildren(back, list);
  }

  private openSubmenu(key: SettingsKey): void {
    this.view = key;
    this.render();
    const items = this.items();
    const checked = items.findIndex((item) => item.getAttribute('aria-checked') === 'true');
    this.focusItem(checked >= 0 ? checked : 1);
  }

  private showRoot(fromKey: SettingsKey | null): void {
    this.view = null;
    this.render();
    const index = fromKey ? this.entries.findIndex((e) => e.key === fromKey) : 0;
    this.focusItem(Math.max(0, index));
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (this.view && (event.key === 'ArrowLeft' || event.key === 'Escape')) {
      event.preventDefault();
      event.stopPropagation();
      this.showRoot(this.view);
      return;
    }
    if (!this.view && event.key === 'ArrowRight' && target.dataset.key) {
      event.preventDefault();
      event.stopPropagation();
      this.openSubmenu(target.dataset.key as SettingsKey);
      return;
    }
    super.onKeyDown(event);
  }
}

export interface ContextMenuItem {
  id: string;
  label: string;
  role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  checked?: boolean;
  /** Items sharing a group are laid out together under the group label. */
  group?: string;
  onSelect: () => void;
}

/** Right-click menu with the package's actions only (no vendor links, no source info). */
export class ContextMenu extends MenuBase {
  private returnFocus: HTMLElement | null = null;

  constructor(label: string) {
    super('rsp-context-menu', label);
    this.onClosed = (reason) => {
      if (reason === 'escape' || reason === 'select') this.returnFocus?.focus({ preventScroll: true });
      this.returnFocus = null;
    };
  }

  setItems(items: ContextMenuItem[]): void {
    const nodes: HTMLElement[] = [];
    const groups = new Map<string, HTMLElement>();
    for (const item of items) {
      const button = menuButton(item.role, 'rsp-context-item');
      button.dataset.id = item.id;
      if (item.role !== 'menuitem') button.setAttribute('aria-checked', String(Boolean(item.checked)));
      button.appendChild(el('span', 'rsp-menu-label', item.label));
      button.addEventListener('click', () => {
        this.close('select');
        item.onSelect();
      });
      if (item.group) {
        let group = groups.get(item.group);
        if (!group) {
          group = el('div', 'rsp-context-group');
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', item.group);
          group.appendChild(el('span', 'rsp-context-group-label', item.group)).setAttribute('aria-hidden', 'true');
          groups.set(item.group, group);
          nodes.push(group);
        }
        group.appendChild(button);
      } else {
        nodes.push(button);
      }
    }
    this.element.replaceChildren(...nodes);
  }

  /** Opens at a point relative to `container`, kept inside it. */
  openAt(container: HTMLElement, x: number, y: number, returnFocus: HTMLElement | null): void {
    if (!this.element.children.length) return;
    this.returnFocus = returnFocus;
    this.element.style.left = '0px';
    this.element.style.top = '0px';
    this.show();
    const box = container.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    this.element.style.left = `${Math.max(4, Math.min(x, box.width - width - 4))}px`;
    this.element.style.top = `${Math.max(4, Math.min(y, box.height - height - 4))}px`;
    this.focusItem(0);
  }
}
