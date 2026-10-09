import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/ui/i18n.js';
import { ContextMenu, SettingsMenu } from '../../src/ui/menus.js';
import { PlayerUi } from '../../src/ui/player-ui.js';
import { Slider } from '../../src/ui/slider.js';
import type { MenuModel, UiActions, UiConfig } from '../../src/ui/ui-adapter.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function key(target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('Slider (WAI-ARIA slider)', () => {
  function make() {
    const commits: number[] = [];
    const slider = new Slider({ className: 'x', label: 'Seek', step: () => 5, pageStep: () => 20, valueText: (v) => `${v}s`, onCommit: (v) => commits.push(v) });
    document.body.appendChild(slider.element);
    return { slider, commits, el: slider.element };
  }

  it('exposes role, name, range and value text', () => {
    const { slider, el } = make();
    slider.setRange(0, 100);
    slider.setValue(30);
    expect(el.getAttribute('role')).toBe('slider');
    expect(el.getAttribute('aria-label')).toBe('Seek');
    expect([el.getAttribute('aria-valuemin'), el.getAttribute('aria-valuemax'), el.getAttribute('aria-valuenow')]).toEqual(['0', '100', '30']);
    expect(el.getAttribute('aria-valuetext')).toBe('30s');
    expect(el.tabIndex).toBe(0);
  });

  it('is disabled (and not focusable) without a valid range', () => {
    const { slider, el, commits } = make();
    slider.setRange(0, Number.NaN);
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.tabIndex).toBe(-1);
    key(el, 'ArrowRight');
    expect(commits).toEqual([]);
    slider.setRange(0, 10);
    expect(el.hasAttribute('aria-disabled')).toBe(false);
  });

  it('arrow, page, Home and End keys commit clamped values and do not reach outer handlers', () => {
    const { slider, el, commits } = make();
    slider.setRange(0, 100);
    slider.setValue(50);
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      const event = key(el, k);
      expect(event.defaultPrevented, k).toBe(true);
    }
    expect(commits).toEqual([55, 50, 55, 50, 70, 50, 0, 100]);
    expect(outer).not.toHaveBeenCalled();
    key(el, 'End');
    expect(commits.at(-1)).toBe(100);
    // Modified keys are left alone (browser/page shortcuts).
    const modified = key(el, 'ArrowLeft', { ctrlKey: true });
    expect(modified.defaultPrevented).toBe(false);
    document.body.removeEventListener('keydown', outer);
  });

  it('draws buffered ranges inside the track', () => {
    const { slider, el } = make();
    slider.setRange(0, 100);
    slider.setBuffered([
      { start: 0, end: 25 },
      { start: 50, end: 150 },
    ]);
    const segments = [...el.querySelectorAll<HTMLElement>('.rsp-slider-buffered-range')];
    expect(segments.map((s) => [s.style.left, s.style.width])).toEqual([
      ['0%', '25%'],
      ['50%', '50%'],
    ]);
    slider.setBuffered([]);
    expect(el.querySelectorAll('.rsp-slider-buffered-range')).toHaveLength(0);
  });
});

const section = (values: string[], checked: string) => ({ items: values.map((v) => ({ value: v, label: v.toUpperCase(), checked: v === checked })), current: checked.toUpperCase() });

describe('SettingsMenu (WAI-ARIA menu)', () => {
  function make() {
    const trigger = document.createElement('button');
    const selected: Array<[string, string]> = [];
    const menu = new SettingsMenu('Settings', trigger, (k, v) => selected.push([k, v]));
    document.body.append(trigger, menu.element);
    menu.setEntries([
      { key: 'quality', title: 'Quality', section: section(['auto', '720'], 'auto') },
      { key: 'speed', title: 'Speed', section: section(['1', '2'], '2') },
    ]);
    return { trigger, menu, selected };
  }

  it('opens on the first entry with aria-expanded, and arrows wrap', () => {
    const { trigger, menu } = make();
    menu.open();
    expect(menu.element.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const entries = [...menu.element.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(entries.map((e) => e.getAttribute('aria-label'))).toEqual(['Quality: AUTO', 'Speed: 2']);
    expect(entries.every((e) => e.tabIndex === -1 && e.getAttribute('aria-haspopup') === 'menu')).toBe(true);
    expect(document.activeElement).toBe(entries[0]);
    key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement).toBe(entries[1]);
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(entries[0]);
  });

  it('submenu: focus on the checked radio, ArrowLeft returns to its entry, selection closes and refocuses the trigger', () => {
    const { trigger, menu, selected } = make();
    menu.open();
    key(document.activeElement!, 'ArrowDown');
    key(document.activeElement!, 'ArrowRight');
    expect(menu.element.dataset.view).toBe('speed');
    const options = [...menu.element.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(document.activeElement).toBe(options[1]);
    key(document.activeElement!, 'ArrowLeft');
    expect(menu.element.dataset.view).toBe('root');
    expect((document.activeElement as HTMLElement).dataset.key).toBe('speed');
    (document.activeElement as HTMLElement).click();
    (menu.element.querySelector('[data-value="1"]') as HTMLElement).click();
    expect(selected).toEqual([['speed', '1']]);
    expect(menu.element.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape leaves a submenu first, then closes; Tab closes without stealing focus', () => {
    const { trigger, menu } = make();
    menu.open();
    key(document.activeElement!, 'Enter');
    (document.activeElement as HTMLElement).click();
    expect(menu.element.dataset.view).toBe('quality');
    key(document.activeElement!, 'Escape');
    expect(menu.element.dataset.view).toBe('root');
    key(document.activeElement!, 'Escape');
    expect(menu.element.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    menu.open();
    const tab = key(document.activeElement!, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(menu.element.hidden).toBe(true);
  });

  it('closes when its entries disappear', () => {
    const { menu } = make();
    menu.open();
    menu.setEntries([]);
    expect(menu.element.hidden).toBe(true);
    expect(menu.element.children).toHaveLength(0);
  });
});

describe('ContextMenu', () => {
  it('groups radio items, marks checkboxes, and returns focus on Escape', () => {
    const host = document.createElement('div');
    const before = document.createElement('button');
    document.body.append(before, host);
    const menu = new ContextMenu('Player menu');
    host.appendChild(menu.element);
    const onLoop = vi.fn();
    menu.setItems([
      { id: 'r1', label: '1×', role: 'menuitemradio', checked: true, group: 'Speed', onSelect: () => undefined },
      { id: 'r2', label: '2×', role: 'menuitemradio', checked: false, group: 'Speed', onSelect: () => undefined },
      { id: 'loop', label: 'Loop', role: 'menuitemcheckbox', checked: false, onSelect: onLoop },
      { id: 'diag', label: 'Copy diagnostics', role: 'menuitem', onSelect: () => undefined },
    ]);
    menu.openAt(host, 10, 10, before);
    const group = menu.element.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Speed');
    expect(group.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    expect(menu.element.querySelector('[data-id="loop"]')!.getAttribute('aria-checked')).toBe('false');
    expect(menu.element.querySelector('[data-id="diag"]')!.hasAttribute('aria-checked')).toBe(false);
    expect((document.activeElement as HTMLElement).dataset.id).toBe('r1');
    key(document.activeElement!, 'End');
    expect((document.activeElement as HTMLElement).dataset.id).toBe('diag');
    key(document.activeElement!, 'Escape');
    expect(menu.isOpen).toBe(false);
    expect(document.activeElement).toBe(before);
    menu.openAt(host, 0, 0, null);
    (menu.element.querySelector('[data-id="loop"]') as HTMLElement).click();
    expect(onLoop).toHaveBeenCalledOnce();
    expect(menu.isOpen).toBe(false);
  });
});

describe('PlayerUi', () => {
  const config = (overrides: Partial<UiConfig> = {}): UiConfig => ({
    translations: en,
    locale: 'en',
    layout: 'standard',
    poster: null,
    contextMenu: { enabled: true, actions: ['playbackRate', 'captions', 'fullscreen', 'loop', 'copyDiagnostics'] },
    playbackRates: [0.5, 1, 2],
    fullscreenMode: 'web',
    pictureInPicture: true,
    airplay: true,
    volumeControl: true,
    preventClickToggle: false,
    loop: false,
    seekStep: 10,
    liveEdgeTolerance: 3,
    ...overrides,
  });

  function make(overrides: Partial<UiConfig> = {}) {
    const root = document.createElement('div');
    root.tabIndex = 0;
    const stage = document.createElement('div');
    root.appendChild(stage);
    document.body.appendChild(root);
    const video = document.createElement('video');
    const calls: string[] = [];
    const actions = new Proxy({} as UiActions, {
      // userGesture fires on every pointerdown/keydown; the tests look at the requests.
      get: (_t, name: string) => (...args: unknown[]) => {
        if (name !== 'userGesture') calls.push(args.length ? `${name}(${args.map((a) => JSON.stringify(a)).join(',')})` : name);
      },
    });
    const ui = new PlayerUi({ container: stage, keyboardRoot: root, video, config: config(overrides), actions });
    const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    return { ui, root, stage, video, calls, $ };
  }

  const menus = (model: Partial<MenuModel>): MenuModel => ({ quality: null, audio: null, subtitles: null, speed: null, ...model });

  it('mounts video, layers and controls; every control is a labelled native button', () => {
    const { ui, video, $ } = make();
    expect(ui.fullscreenTarget.classList.contains('rsp-ui')).toBe(true);
    expect(video.parentElement).toBe(ui.fullscreenTarget);
    expect(video.controls).toBe(false);
    expect(ui.layerHost.parentElement).toBe(ui.fullscreenTarget);
    expect($('.rsp-controls').getAttribute('role')).toBe('group');
    expect($('.rsp-controls').getAttribute('aria-label')).toBe('Player controls');
    for (const button of ui.fullscreenTarget.querySelectorAll('button')) {
      expect(button.type).toBe('button');
      expect(button.getAttribute('aria-label') || button.textContent, button.className).toBeTruthy();
    }
    expect($('.rsp-play').getAttribute('aria-label')).toBe('Play');
    // No browser support in jsdom: PiP hidden; Cast/AirPlay hidden until available.
    expect($('.rsp-pip').hidden).toBe(true);
    expect($('.rsp-cast').hidden).toBe(true);
    expect($('.rsp-airplay').hidden).toBe(true);
    expect($('.rsp-fullscreen-button').hidden).toBe(false);
  });

  it('settings and captions controls follow the menu model; labels stay plain text', () => {
    const { ui, $ } = make();
    expect($('.rsp-settings-button').hidden).toBe(true);
    expect($('.rsp-captions').hidden).toBe(true);
    const evil = '<img src=x onerror="window.__xss=1">';
    ui.setMenus(
      menus({
        subtitles: { items: [{ value: '__off__', label: 'Off', checked: false }, { value: 'en', label: evil, checked: true }], current: evil },
        speed: { items: [{ value: '1', label: 'Normal', checked: true }], current: 'Normal' },
      }),
    );
    expect($('.rsp-settings-button').hidden).toBe(false);
    expect($('.rsp-captions').hidden).toBe(false);
    expect($('.rsp-captions').getAttribute('aria-pressed')).toBe('true');
    $('.rsp-settings-button').click();
    const entries = [...ui.fullscreenTarget.querySelectorAll('.rsp-menu-entry')];
    // Speed has a single option: no entry.
    expect(entries.map((e) => (e as HTMLElement).dataset.key)).toEqual(['subtitles']);
    expect(entries[0]!.querySelector('.rsp-menu-value')!.textContent).toBe(evil);
    expect(ui.fullscreenTarget.querySelector('img')).toBeNull();
  });

  it('settings selections and buttons call the controller actions', () => {
    const { ui, calls, $ } = make();
    ui.setMenus(menus({ subtitles: { items: [{ value: '__off__', label: 'Off', checked: false }, { value: 'en', label: 'English', checked: true }], current: 'English' } }));
    $('.rsp-settings-button').click();
    ($('.rsp-menu-entry') as HTMLElement).click();
    ($('[data-value="__off__"]') as HTMLElement).click();
    $('.rsp-play').click();
    $('.rsp-big-play').click();
    $('.rsp-captions').click();
    $('.rsp-fullscreen-button').click();
    $('.rsp-mute').click();
    expect(calls).toEqual(['selectSubtitle(null)', 'togglePlay("control")', 'togglePlay("control")', 'toggleCaptions', 'toggleFullscreen', 'setMuted(true)']);
  });

  it('live: indicator, DVR slider and value text', () => {
    const { ui, calls, $ } = make();
    ui.setLive({ isLive: true, atLiveEdge: true, behindLiveEdge: 1, seekableRange: { start: 100, end: 130 } });
    const live = $('.rsp-live-button');
    expect(live.hidden).toBe(false);
    expect(live.getAttribute('aria-disabled')).toBe('true');
    expect(live.getAttribute('aria-label')).toBe('LIVE');
    expect($('.rsp-time').hidden).toBe(true);
    const progress = $('.rsp-progress');
    expect(progress.hidden).toBe(false);
    expect([progress.getAttribute('aria-valuemin'), progress.getAttribute('aria-valuemax')]).toEqual(['100', '130']);
    live.click();
    expect(calls).toEqual([]);
    ui.setLive({ isLive: true, atLiveEdge: false, behindLiveEdge: 12.4, seekableRange: { start: 100, end: 130 } });
    expect(live.getAttribute('aria-disabled')).toBe('false');
    expect(live.getAttribute('aria-label')).toBe('Go to live (12s behind live)');
    live.click();
    expect(calls).toEqual(['seekToLive']);
    // No DVR window: no slider.
    ui.setLive({ isLive: true, atLiveEdge: true, behindLiveEdge: 0, seekableRange: { start: 0, end: 0.5 } });
    expect(progress.hidden).toBe(true);
  });

  it('VOD progress uses the duration; keyboard seeks go through seekTo', () => {
    const { ui, calls, $ } = make();
    ui.setDuration(125);
    const progress = $('.rsp-progress');
    expect(progress.getAttribute('aria-valuemax')).toBe('125');
    expect(progress.getAttribute('aria-valuetext')).toBe('0:00 of 2:05');
    expect($('.rsp-time').textContent).toBe('0:00 / 2:05');
    key(progress, 'ArrowRight');
    key(progress, 'End');
    expect(calls).toEqual(['seekTo(10)', 'seekTo(125)']);
  });

  it('linear ads take the content controls out of view and of the accessibility tree', () => {
    const { ui, $ } = make();
    ui.setMenus(menus({ speed: section(['1', '2'], '1') }));
    $('.rsp-settings-button').click();
    ui.setAdActive(true);
    expect(ui.fullscreenTarget.hasAttribute('data-ad-active')).toBe(true);
    expect($('.rsp-controls').hasAttribute('inert')).toBe(true);
    expect($('.rsp-controls').getAttribute('aria-hidden')).toBe('true');
    expect($('.rsp-settings-menu').hidden).toBe(true);
    expect($('.rsp-big-play').hidden).toBe(true);
    // Right click during the ad: the browser's menu (not prevented).
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    ui.fullscreenTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    ui.setAdActive(false);
    expect($('.rsp-controls').hasAttribute('inert')).toBe(false);
    expect($('.rsp-controls').getAttribute('aria-hidden')).toBe('false');
  });

  it('context menu: right click and Shift+F10 open it; disabled → browser menu', () => {
    const { ui, root, calls } = make();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    ui.fullscreenTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const menu = root.querySelector<HTMLElement>('.rsp-context-menu')!;
    expect(menu.hidden).toBe(false);
    expect([...menu.querySelectorAll('.rsp-context-item')].map((i) => i.textContent)).toEqual(['0.5×', 'Normal', '2×', 'Expand player', 'Loop', 'Copy diagnostics']);
    (menu.querySelector('[data-id="loop"]') as HTMLElement).click();
    expect(calls).toContain('toggleLoop');
    root.focus();
    key(root, 'F10', { shiftKey: true });
    expect(menu.hidden).toBe(false);
    key(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(root);
    ui.configure(config({ contextMenu: { enabled: false, actions: [] } }));
    const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    ui.fullscreenTarget.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });

  it('cast and AirPlay buttons appear only while available and reflect the connection', () => {
    const { ui, calls, $ } = make();
    ui.setCast({ available: true, connected: false });
    expect($('.rsp-cast').hidden).toBe(false);
    expect($('.rsp-cast').getAttribute('aria-pressed')).toBe('false');
    ui.setCast({ available: true, connected: true });
    expect($('.rsp-cast').getAttribute('aria-label')).toBe('Stop casting');
    $('.rsp-cast').click();
    ui.setAirplay({ available: true, active: false });
    expect($('.rsp-airplay').hidden).toBe(false);
    $('.rsp-airplay').click();
    expect(calls).toEqual(['toggleCast', 'showAirplayPicker']);
    ui.configure(config({ airplay: false }));
    expect($('.rsp-airplay').hidden).toBe(true);
  });

  it('clicks on the picture toggle play; a double click toggles fullscreen; preventClickToggle is respected', () => {
    const { video, calls, ui } = make();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    now += 100;
    video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toEqual(['togglePlay("video-click")', 'toggleFullscreen']);
    ui.configure(config({ preventClickToggle: true }));
    now += 1000;
    video.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.filter((c) => c.startsWith('togglePlay'))).toHaveLength(1);
  });

  it('spinner appears only after a short delay; notices are polite status messages', () => {
    vi.useFakeTimers();
    const { ui, $ } = make();
    ui.setLoading(true);
    expect($('.rsp-spinner').hidden).toBe(true);
    vi.advanceTimersByTime(350);
    expect($('.rsp-spinner').hidden).toBe(false);
    ui.setError(true);
    expect($('.rsp-spinner').hidden).toBe(true);
    ui.notice('Diagnostics copied');
    expect($('.rsp-notice').getAttribute('aria-live')).toBe('polite');
    expect($('.rsp-notice').textContent).toBe('Diagnostics copied');
    vi.advanceTimersByTime(2000);
    expect($('.rsp-notice').hidden).toBe(true);
  });

  it('locale changes relabel the controls in place', () => {
    const { ui, $ } = make();
    const play = $('.rsp-play');
    ui.configure(config({ translations: { ...en, play: 'Тоглуулах', seek: 'Байрлал', settings: 'Тохиргоо', controls: 'Удирдлага' } }));
    expect($('.rsp-play')).toBe(play);
    expect(play.getAttribute('aria-label')).toBe('Тоглуулах');
    expect($('.rsp-progress').getAttribute('aria-label')).toBe('Байрлал');
    expect($('.rsp-settings-button').getAttribute('aria-label')).toBe('Тохиргоо');
    expect($('.rsp-controls').getAttribute('aria-label')).toBe('Удирдлага');
  });

  it('destroy removes the controls and detaches (but does not destroy) the video', () => {
    const { ui, stage, video } = make();
    ui.destroy();
    expect(stage.children).toHaveLength(0);
    expect(video.isConnected).toBe(false);
    ui.destroy();
    ui.setLoading(true);
  });
});
