// Icons for the package-owned controls: simple original drawings on a 24×24
// grid, built with DOM APIs (no markup strings, no icon fonts, no third-party
// icon sets). They inherit `currentColor` and are hidden from assistive
// technology — every control carries its own accessible name.

const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape = { d: string; fill?: boolean };

function svg(shapes: Shape[], className?: string): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', '0 0 24 24');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  root.setAttribute('class', className ? `rsp-icon ${className}` : 'rsp-icon');
  for (const shape of shapes) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shape.d);
    if (shape.fill) {
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('stroke', 'none');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    root.appendChild(path);
  }
  return root;
}

export const icons = {
  play: () => svg([{ d: 'M8 5.5v13a.5.5 0 0 0 .77.42l10.2-6.5a.5.5 0 0 0 0-.84L8.77 5.08A.5.5 0 0 0 8 5.5z', fill: true }], 'rsp-icon-play'),
  pause: () =>
    svg(
      [
        { d: 'M7 5h3v14H7z', fill: true },
        { d: 'M14 5h3v14h-3z', fill: true },
      ],
      'rsp-icon-pause',
    ),
  replay: () => svg([{ d: 'M4 12a8 8 0 1 0 2.34-5.66' }, { d: 'M4 4v4h4' }], 'rsp-icon-replay'),
  volumeHigh: () =>
    svg([{ d: 'M4 9.5v5h3.5L12 18V6L7.5 9.5H4z', fill: true }, { d: 'M15.5 9a4 4 0 0 1 0 6' }, { d: 'M18 6.5a7.5 7.5 0 0 1 0 11' }], 'rsp-icon-volume'),
  volumeLow: () => svg([{ d: 'M4 9.5v5h3.5L12 18V6L7.5 9.5H4z', fill: true }, { d: 'M15.5 9a4 4 0 0 1 0 6' }], 'rsp-icon-volume-low'),
  volumeMuted: () => svg([{ d: 'M4 9.5v5h3.5L12 18V6L7.5 9.5H4z', fill: true }, { d: 'M16 9.5l5 5' }, { d: 'M21 9.5l-5 5' }], 'rsp-icon-muted'),
  captions: () => svg([{ d: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' }, { d: 'M7 13.5h4' }, { d: 'M13 13.5h4' }, { d: 'M7 10.5h2' }], 'rsp-icon-captions'),
  settings: () =>
    svg(
      [
        { d: 'M4 7h8' },
        { d: 'M18 7h2' },
        { d: 'M4 17h3' },
        { d: 'M13 17h7' },
        { d: 'M15 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z' },
        { d: 'M10 14.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z' },
      ],
      'rsp-icon-settings',
    ),
  pip: () => svg([{ d: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z' }, { d: 'M12.5 12h6v4.5h-6z', fill: true }], 'rsp-icon-pip'),
  airplay: () => svg([{ d: 'M6 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1' }, { d: 'M12 14.5l4.5 5.5h-9z', fill: true }], 'rsp-icon-airplay'),
  cast: () => svg([{ d: 'M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6' }, { d: 'M3 13a6 6 0 0 1 6 6' }, { d: 'M3 17a2 2 0 0 1 2 2' }], 'rsp-icon-cast'),
  fullscreen: () => svg([{ d: 'M4 9V4h5' }, { d: 'M20 9V4h-5' }, { d: 'M4 15v5h5' }, { d: 'M20 15v5h-5' }], 'rsp-icon-fullscreen'),
  exitFullscreen: () => svg([{ d: 'M9 4v5H4' }, { d: 'M15 4v5h5' }, { d: 'M9 20v-5H4' }, { d: 'M15 20v-5h5' }], 'rsp-icon-exit-fullscreen'),
  chevronRight: () => svg([{ d: 'M9.5 6l6 6-6 6' }], 'rsp-icon-chevron'),
  back: () => svg([{ d: 'M14.5 6l-6 6 6 6' }], 'rsp-icon-back'),
  check: () => svg([{ d: 'M5 12.5l4.5 4.5L19 7.5' }], 'rsp-icon-check'),
};

export type IconName = keyof typeof icons;
