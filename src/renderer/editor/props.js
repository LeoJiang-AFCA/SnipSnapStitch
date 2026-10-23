/* Properties panel builder (browser only). Pure DOM; the editor supplies specs and callbacks. */
(function (root) {
  'use strict';
  const RS = root.RS;
  const SWATCHES = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#4f8cff', '#af52de', '#ff2d92', '#ffffff', '#8e8e93', '#3a3a3c', '#000000'];
  const GLYPHS = ['\u2705', '\u274C', '\u26A0\uFE0F', '\u2753', '\u2757', '\u2B50', '\uD83D\uDC4D', '\uD83D\uDC4E', '\u2764\uFE0F', '\uD83D\uDD25', '\uD83D\uDCA1', '\uD83C\uDFAF',
    '\uD83D\uDCCC', '\uD83D\uDCCE', '\uD83D\uDD12', '\uD83D\uDD11', '\uD83D\uDE00', '\uD83D\uDE0E', '\uD83E\uDD14', '\uD83D\uDE21', '\uD83D\uDE31', '\uD83C\uDF89', '\uD83D\uDE80', '\u2714\uFE0F',
    '\u2716\uFE0F', '\u27A1\uFE0F', '\u2B05\uFE0F', '\u2B06\uFE0F', '\u2B07\uFE0F', '\uD83D\uDC1E', '\uD83D\uDED1', '\u26D4', '\uD83D\uDD0D', '\uD83D\uDCAC', '\uD83D\uDCF7', '\uD83D\uDDB1\uFE0F',
    '\u2328\uFE0F', '\uD83D\uDCDD', '\u23F0', '\u2728', '\uD83D\uDC40', '\uD83D\uDE4C', '\u270F\uFE0F', '\uD83E\uDDE9', '\u267B\uFE0F', '\uD83D\uDCA5', '\uD83C\uDFC1', '\u2139\uFE0F'];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function hexOr(v, fallback) {
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  }

  function colorField(f) {
    const wrap = el('div', 'field');
    const row = el('div', 'color-row');
    row.appendChild(el('label', '', esc(f.label)));
    const none = f.value === 'transparent' || f.value === 'none';
    const input = el('input');
    input.type = 'color';
    input.value = hexOr(none ? (f.memory || '#ffffff') : f.value, '#ff3b30');
    input.className = none ? 'is-none' : '';
    input.addEventListener('input', () => { input.className = ''; noneBtn && noneBtn.classList.remove('active'); f.onChange(input.value, false); });
    input.addEventListener('change', () => f.onChange(input.value, true));
    row.appendChild(input);
    let noneBtn = null;
    if (f.none) {
      noneBtn = el('button', 'mini' + (none ? ' active' : ''), 'None');
      noneBtn.title = 'No ' + f.label.toLowerCase();
      noneBtn.addEventListener('click', () => { f.onChange('transparent', true); f.refresh && f.refresh(); });
      row.appendChild(noneBtn);
    }
    if (f.pick) {
      const pick = el('button', 'mini icon', RS.icons.drop);
      pick.title = 'Pick colour from the image';
      pick.addEventListener('click', () => f.pick());
      row.appendChild(pick);
    }
    wrap.appendChild(row);
    const sw = el('div', 'swatches');
    SWATCHES.forEach(c => {
      const b = el('button', 'swatch');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => { f.onChange(c, true); f.refresh && f.refresh(); });
      sw.appendChild(b);
    });
    wrap.appendChild(sw);
    return wrap;
  }

  function rangeField(f) {
    const wrap = el('div', 'field');
    const row = el('div', 'range-row');
    const scale = f.scale || 1;
    const fmt = f.fmt || (v => String(Math.round(v * 100) / 100));
    row.appendChild(el('label', '', esc(f.label)));
    const val = el('span', 'val', esc(fmt(f.value)));
    const input = el('input');
    input.type = 'range';
    input.min = f.min * scale; input.max = f.max * scale; input.step = (f.step || 1) * scale;
    input.value = f.value * scale;
    input.addEventListener('input', () => { const v = +input.value / scale; val.textContent = fmt(v); f.onChange(v, false); });
    input.addEventListener('change', () => f.onChange(+input.value / scale, true));
    row.appendChild(val);
    wrap.appendChild(row);
    wrap.appendChild(input);
    return wrap;
  }

  function selectField(f) {
    const wrap = el('div', 'field row');
    wrap.appendChild(el('label', '', esc(f.label)));
    const sel = el('select');
    f.options.forEach(o => {
      const opt = el('option', '', esc(o.l));
      opt.value = o.v;
      if (String(o.v) === String(f.value)) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      const raw = sel.value;
      f.onChange(f.numeric ? +raw : raw, true);
      sel.blur();
    });
    wrap.appendChild(sel);
    return wrap;
  }

  function segField(f) {
    const wrap = el('div', 'field');
    wrap.appendChild(el('label', '', esc(f.label)));
    const seg = el('div', 'seg');
    f.options.forEach(o => {
      const b = el('button', String(o.v) === String(f.value) ? 'active' : '', o.icon || esc(o.l));
      b.title = o.title || o.l || '';
      b.addEventListener('click', () => { f.onChange(o.v, true); f.refresh && f.refresh(); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    return wrap;
  }

  function toggleField(f) {
    const b = el('button', 'chip' + (f.value ? ' active' : ''), f.html || esc(f.label));
    b.title = f.title || f.label;
    b.addEventListener('click', () => { f.onChange(!f.value, true); f.refresh && f.refresh(); });
    return b;
  }

  function numberField(f) {
    const wrap = el('label', 'num');
    wrap.appendChild(el('span', '', esc(f.label)));
    const input = el('input');
    input.type = 'number';
    input.min = f.min; input.max = f.max; input.step = f.step || 1;
    input.value = Math.round(f.value * 100) / 100;
    if (f.key) input.dataset.key = f.key;
    input.addEventListener('change', () => { f.onChange(+input.value, true); });
    wrap.appendChild(input);
    return wrap;
  }

  function glyphField(f) {
    const wrap = el('div', 'field');
    wrap.appendChild(el('label', '', esc(f.label)));
    const grid = el('div', 'glyphs');
    GLYPHS.forEach(g => {
      const b = el('button', 'glyph' + (g === f.value ? ' active' : ''), esc(g));
      b.addEventListener('click', () => { f.onChange(g, true); f.refresh && f.refresh(); });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  const BUILDERS = { color: colorField, range: rangeField, select: selectField, seg: segField, number: numberField, glyphs: glyphField, toggle: toggleField };

  function buttons(list, cls) {
    const row = el('div', cls || 'btn-row');
    list.forEach(b => {
      const btn = el('button', (b.primary ? 'primary ' : '') + (b.icon && !b.label ? 'icon-btn' : 'btn'), (b.icon || '') + (b.label ? '<span>' + esc(b.label) + '</span>' : ''));
      if (b.title) btn.title = b.title;
      if (b.disabled) btn.disabled = true;
      btn.addEventListener('click', b.onClick);
      row.appendChild(btn);
    });
    return row;
  }

  // blocks: [{kind:'field'|'fields-row'|'actions'|'buttons'|'note'|'section'|'custom', ...}]
  function render(container, spec) {
    container.innerHTML = '';
    container.appendChild(el('h2', '', esc(spec.title)));
    if (spec.subtitle) container.appendChild(el('div', 'subtitle', esc(spec.subtitle)));
    for (const b of spec.blocks) {
      if (b.kind === 'field') container.appendChild(BUILDERS[b.field.type](b.field));
      else if (b.kind === 'inline') {
        const row = el('div', 'inline-row');
        b.fields.forEach(f => row.appendChild(BUILDERS[f.type](f)));
        container.appendChild(row);
      } else if (b.kind === 'actions') container.appendChild(buttons(b.buttons, 'icon-row'));
      else if (b.kind === 'buttons') container.appendChild(buttons(b.buttons));
      else if (b.kind === 'note') container.appendChild(el('div', 'note', b.html));
      else if (b.kind === 'section') container.appendChild(el('h3', '', esc(b.text)));
      else if (b.kind === 'custom') container.appendChild(b.node);
    }
  }

  RS.props = { render, SWATCHES, GLYPHS };
})(window);
