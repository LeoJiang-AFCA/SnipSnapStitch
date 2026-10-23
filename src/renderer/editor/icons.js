/* Inline SVG icon set (24x24, stroke based). */
(function (root) {
  'use strict';
  const S = (body, fill) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="' + (fill || 'none') +
    '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';

  const icons = {
    select: S('<path d="M5 3l0 16 4.2-4 3 6.5 2.6-1.2-3-6.3L18 13.5z"/>'),
    pan: S('<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 3.4-2.82L7 15"/>'),
    arrow: S('<path d="M5 19L19 5M10 5h9v9"/>'),
    line: S('<path d="M5 19L19 5"/>'),
    rect: S('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
    ellipse: S('<ellipse cx="12" cy="12" rx="8.5" ry="6"/>'),
    text: S('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
    callout: S('<path d="M5 5h14a1 1 0 011 1v8a1 1 0 01-1 1h-7l-4 4v-4H5a1 1 0 01-1-1V6a1 1 0 011-1z"/>'),
    step: S('<circle cx="12" cy="12" r="8.5"/><path d="M10.2 10.2L12.4 8.5V16"/>'),
    highlight: S('<path d="M14.5 4.5l5 5-8.5 8.5H6v-5z"/><path d="M4 21h16" stroke-width="2.6" opacity=".5"/>'),
    pen: S('<path d="M4 20l1-4.5L16.5 4a1.5 1.5 0 012 0l1.5 1.5a1.5 1.5 0 010 2L8.5 19z"/><path d="M14 7l3 3"/>'),
    blur: S('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16M8 4v16M16 4v16" opacity=".45"/>'),
    spotlight: S('<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" fill-opacity=".25"/><circle cx="12" cy="12" r="4.5" fill="var(--panel,#222)"/>'),
    magnify: S('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>'),
    stamp: S('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 14s1.4 2.2 3.8 2.2 3.8-2.2 3.8-2.2"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/>'),
    eyedropper: S('<path d="M19.5 4.5a2.5 2.5 0 00-3.5 0l-2.5 2.5-1-1-1.8 1.8 1 1L4 16.5V20h3.5l7.9-7.9 1 1 1.8-1.8-1-1 2.3-2.3a2.5 2.5 0 000-3.5z"/>'),
    crop: S('<path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/>'),
    canvas: S('<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="2.5 2.5"/><path d="M8 16l8-8M11 8h5v5"/>'),
    undo: S('<path d="M9 8L4.5 12.5 9 17M5 12.5h9.5a5 5 0 010 10"/>').replace('width="20" height="20"', 'width="18" height="18"'),
    redo: S('<path d="M15 8l4.5 4.5L15 17M19 12.5H9.5a5 5 0 000 10"/>').replace('width="20" height="20"', 'width="18" height="18"'),
    copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 016.5 4H15"/>'),
    save: S('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-7h8v7"/>'),
    saveas: S('<path d="M12 4v10m0 0l-4-4m4 4l4-4M5 18v2h14v-2"/>'),
    library: S('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
    trash: S('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13M10 11v6M14 11v6"/>'),
    duplicate: S('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 012-2h10"/>'),
    front: S('<rect x="4" y="9" width="11" height="11" rx="1" opacity=".5"/><rect x="9" y="4" width="11" height="11" rx="1" fill="currentColor" fill-opacity=".25"/>'),
    back: S('<rect x="9" y="4" width="11" height="11" rx="1" opacity=".5"/><rect x="4" y="9" width="11" height="11" rx="1" fill="currentColor" fill-opacity=".25"/>'),
    forward: S('<path d="M12 19V6M6 11l6-6 6 6"/>'),
    backward: S('<path d="M12 5v13M6 13l6 6 6-6"/>'),
    zoomin: S('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>').replace('width="20" height="20"', 'width="16" height="16"'),
    zoomout: S('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>').replace('width="20" height="20"', 'width="16" height="16"'),
    fit: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>').replace('width="20" height="20"', 'width="16" height="16"'),
    link: S('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0010 18.7l1-1"/>').replace('width="20" height="20"', 'width="16" height="16"'),
    drop: S('<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>').replace('width="20" height="20"', 'width="16" height="16"')
  };

  root.RS = root.RS || {};
  root.RS.icons = icons;
})(window);
