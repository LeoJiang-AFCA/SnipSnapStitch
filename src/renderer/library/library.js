'use strict';
(() => {
  const api = window.libraryApi;
  const $ = (s) => document.querySelector(s);
  const grid = $('#grid');

  const state = {
    items: [],          // all items from main
    view: [],           // filtered+sorted
    selected: new Set(),
    anchor: null,       // last clicked id for shift-select
    filter: localStorage.getItem('lib.filter') || 'all',
    sort: localStorage.getItem('lib.sort') || 'newest',
    search: '',
    cardW: parseInt(localStorage.getItem('lib.cardW'), 10) || 220,
    optimizing: new Map(), // id -> progress (0..1) of videos being re-encoded smaller
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  const DATE_OPTS = { dateStyle: 'medium', timeStyle: 'short' };
  let dateFmt = new Intl.DateTimeFormat([], DATE_OPTS);
  const fmtDate = (t) => dateFmt.format(new Date(t));
  const typeLabel = (it) => (it.type === 'image' ? '' : it.type === 'gif' ? 'GIF' : 'VIDEO');

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  async function guard(fn) {
    try { return await fn(); } catch (e) { console.error(e); toast(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  }

  // ---------- data ----------
  async function reload() {
    state.items = await api.list({});
    const ids = new Set(state.items.map((i) => i.id));
    for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
    applyView();
  }

  function applyView() {
    const q = state.search.trim().toLowerCase();
    let v = state.items.filter((it) => {
      if (state.filter === 'images' && it.type !== 'image') return false;
      if (state.filter === 'videos' && it.type === 'image') return false;
      if (state.filter === 'favorites' && !it.favorite) return false;
      if (q && ![it.name, it.source, ...(it.tags || [])].some((s) => String(s).toLowerCase().includes(q))) return false;
      return true;
    });
    const by = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      nameDesc: (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
      size: (a, b) => b.sizeBytes - a.sizeBytes,
    }[state.sort] || ((a, b) => b.createdAt - a.createdAt);
    state.view = v.sort(by);
    render();
  }

  // ---------- rendering ----------
  const pendingThumbs = [];
  let thumbBusy = false;

  function render() {
    const scroll = grid.scrollTop;
    grid.replaceChildren(...state.view.map(card));
    grid.scrollTop = scroll;
    const empty = state.view.length === 0;
    $('#empty').hidden = !empty;
    if (empty) {
      const filtered = state.items.length > 0;
      $('#emptyTitle').textContent = filtered ? 'No matching items' : 'Your library is empty';
      $('#emptyText').textContent = filtered
        ? 'Try a different search or filter.'
        : 'Take a capture with the buttons above, or drag & drop images and videos here.';
    }
    updateSelInfo();
  }

  // Overlay on a card while its video is being re-encoded to a smaller file.
  function optOverlay(id) {
    const p = state.optimizing.get(id) || 0;
    return h('div', { class: 'opt', title: 'Optimizing to a smaller video size…' },
      h('div', { class: 'opt-text' }, p > 0 ? `Optimizing… ${Math.round(p * 100)}%` : 'Optimizing…'),
      h('div', { class: 'opt-bar' }, h('i', { style: `width:${Math.round(p * 100)}%` })));
  }
  function updateOptimizeCard(id) {
    const el = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const old = el.querySelector('.opt');
    if (!state.optimizing.has(id)) { if (old) old.remove(); return; }
    const fresh = optOverlay(id);
    if (old) old.replaceWith(fresh); else el.querySelector('.thumb').after(fresh);
  }

  function card(it) {
    const thumb = h('div', { class: 'thumb' });
    if (it.thumbUrl) thumb.append(thumbImg(it));
    else {
      thumb.append(h('span', { class: 'ph' }, it.type === 'image' ? '🖼' : '🎬'));
      if (it.type !== 'image') queueThumb(it);
    }
    const meta = [it.width && it.height ? `${it.width}×${it.height}` : null, fmtSize(it.sizeBytes), fmtDate(it.createdAt)].filter(Boolean).join(' · ');
    const el = h('div', {
      class: 'card' + (state.selected.has(it.id) ? ' selected' : '') + (it.favorite ? ' is-fav' : ''),
      'data-id': it.id, draggable: 'true', title: it.name,
    },
    thumb,
    typeLabel(it) ? h('span', { class: 'badge' }, typeLabel(it)) : null,
    it.type !== 'image' ? h('span', { class: 'play' }, '▶') : null,
    state.optimizing.has(it.id) ? optOverlay(it.id) : null,
    h('span', { class: 'fav', title: 'Toggle favorite', onclick: (e) => { e.stopPropagation(); guard(() => api.setFavorite(it.id, !it.favorite)); } }, it.favorite ? '★' : '☆'),
    h('div', { class: 'info' },
      h('div', { class: 'name' }, it.name),
      h('div', { class: 'meta' }, meta),
      it.tags && it.tags.length ? h('div', { class: 'tags' }, it.tags.map((t) => h('span', { class: 'tag' }, t))) : null));
    return el;
  }

  // Thumbnail with fallbacks: sss:// -> file:// -> data URL -> placeholder.
  function thumbImg(it) {
    const img = h('img', { src: it.thumbUrl, loading: 'lazy', draggable: 'false' });
    let stage = 0;
    img.addEventListener('error', async () => {
      stage++;
      if (stage === 1 && it.thumbFileUrl) img.src = it.thumbFileUrl;
      else if (stage <= 2) {
        const d = await api.thumbDataUrl(it.id).catch(() => null);
        if (d) img.src = d; else img.replaceWith(h('span', { class: 'ph' }, '🖼'));
      } else img.replaceWith(h('span', { class: 'ph' }, '🖼'));
    });
    return img;
  }

  // Videos/GIFs without a stored thumbnail: grab a frame in the renderer and send it to main.
  const thumbTried = new Set();
  function queueThumb(it) {
    if (thumbTried.has(it.id)) return;
    thumbTried.add(it.id);
    pendingThumbs.push(it);
    pumpThumbs();
  }
  async function pumpThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    while (pendingThumbs.length) {
      const it = pendingThumbs.shift();
      try {
        const r = await grabFrame(it);
        if (r) await api.setThumb(it.id, r.dataUrl, { width: r.width, height: r.height });
      } catch (e) { console.warn('thumb failed', it.id, e); }
    }
    thumbBusy = false;
  }
  function grabFrame(it) {
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done(null), 8000);
      const draw = (src, w, h2) => {
        if (!w || !h2) return done(null);
        const s = Math.min(1, 320 / Math.max(w, h2));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h2 * s));
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        done({ dataUrl: c.toDataURL('image/jpeg', 0.8), width: w, height: h2 });
      };
      if (it.type === 'gif') {
        const img = new Image();
        img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
        img.onerror = () => done(null);
        img.src = it.fileUrl;
        return;
      }
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto';
      v.onerror = () => { if (!v.dataset.fb) { v.dataset.fb = '1'; v.src = it.fileFileUrl; } else done(null); };
      v.onloadeddata = () => {
        // MediaRecorder webm often reports Infinity duration; a small seek is enough to get a frame.
        v.onseeked = () => draw(v, v.videoWidth, v.videoHeight);
        try { v.currentTime = Math.min(0.1, isFinite(v.duration) ? v.duration / 2 : 0.1); } catch (_) { draw(v, v.videoWidth, v.videoHeight); }
      };
      v.src = it.fileUrl;
    });
  }

  // ---------- selection ----------
  function updateSelInfo() {
    const n = state.selected.size;
    $('#selInfo').textContent = n ? `${n} selected` : `${state.view.length} item${state.view.length === 1 ? '' : 's'}`;
  }
  function refreshSelectionClasses() {
    for (const el of grid.children) el.classList.toggle('selected', state.selected.has(el.dataset.id));
    updateSelInfo();
  }
  function select(id, e) {
    if (e && e.shiftKey && state.anchor) {
      const a = state.view.findIndex((i) => i.id === state.anchor);
      const b = state.view.findIndex((i) => i.id === id);
      if (a >= 0 && b >= 0) {
        if (!(e.ctrlKey || e.metaKey)) state.selected.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) state.selected.add(state.view[i].id);
      }
    } else if (e && (e.ctrlKey || e.metaKey)) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      state.anchor = id;
    } else {
      state.selected = new Set([id]);
      state.anchor = id;
    }
    refreshSelectionClasses();
  }
  const itemById = (id) => state.items.find((i) => i.id === id);
  const selectedItems = () => state.view.filter((i) => state.selected.has(i.id));

  // ---------- actions ----------
  function openItem(it) {
    if (!it) return;
    if (it.type === 'image') guard(() => api.openEditor(it.id));
    else playVideo(it);
  }

  function closeModal() { const m = $('#modal'); m.hidden = true; m.replaceChildren(); m.onkeydown = null; }
  function showModal(content) {
    const m = $('#modal');
    m.replaceChildren(content);
    m.hidden = false;
    m.onmousedown = (e) => { if (e.target === m) closeModal(); };
  }

  function playVideo(it) {
    const v = h('video', { controls: true, autoplay: true, src: it.fileUrl });
    v.addEventListener('error', () => { if (!v.dataset.fb) { v.dataset.fb = '1'; v.src = it.fileFileUrl; } });
    if (it.type === 'gif') {
      showModal(h('div', { class: 'dialog player' }, h('img', { src: it.fileUrl, style: 'max-width:88vw;max-height:78vh;display:block' }),
        h('div', { class: 'bar' }, h('span', {}, it.name), h('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    } else {
      showModal(h('div', { class: 'dialog player' }, v,
        h('div', { class: 'bar' }, h('span', {}, it.name), h('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    }
  }

  function promptDialog({ title, value, hint, okLabel = 'OK' }) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'field', type: 'text', value: value || '', spellcheck: 'false' });
      const finish = (v) => { closeModal(); resolve(v); };
      const ok = () => finish(input.value);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ok();
        else if (e.key === 'Escape') finish(null);
        e.stopPropagation();
      });
      showModal(h('div', { class: 'dialog' }, h('h3', {}, title), input, hint ? h('div', { class: 'hint' }, hint) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: ok }, okLabel))));
      $('#modal').onmousedown = (e) => { if (e.target === $('#modal')) finish(null); };
      input.focus(); input.select();
    });
  }

  function confirmDialog(title, text, okLabel) {
    return new Promise((resolve) => {
      const finish = (v) => { closeModal(); resolve(v); };
      showModal(h('div', { class: 'dialog' }, h('h3', {}, title), h('div', { class: 'muted' }, text),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), h('button', { class: 'btn danger', id: 'confirmOk', onclick: () => finish(true) }, okLabel))));
      $('#modal').onmousedown = (e) => { if (e.target === $('#modal')) finish(false); };
      $('#confirmOk').focus();
    });
  }

  async function doRename(it) {
    const v = await promptDialog({ title: 'Rename', value: it.name, okLabel: 'Rename' });
    if (v && v.trim() && v.trim() !== it.name) guard(() => api.rename(it.id, v.trim()));
  }
  async function doTags(items) {
    const common = items.length === 1 ? items[0].tags.join(', ') : '';
    const v = await promptDialog({ title: items.length > 1 ? `Set tags for ${items.length} items` : 'Edit tags', value: common, hint: 'Comma-separated, e.g. bug, design, release', okLabel: 'Save' });
    if (v !== null) guard(() => api.setTags(items.map((i) => i.id), v.split(',').map((s) => s.trim()).filter(Boolean)));
  }
  async function doDelete(items) {
    if (!items.length) return;
    const ok = await confirmDialog('Delete', items.length === 1 ? `Delete "${items[0].name}"? This can't be undone.` : `Delete ${items.length} items? This can't be undone.`, 'Delete');
    if (ok) guard(async () => { await api.remove(items.map((i) => i.id)); toast(`Deleted ${items.length} item${items.length > 1 ? 's' : ''}`); });
  }
  async function doOptimize(items) {
    const vids = items.filter((i) => i.type === 'video' && !state.optimizing.has(i.id));
    if (!vids.length) return;
    const choice = await new Promise((resolve) => {
      const finish = (v) => { closeModal(); resolve(v); };
      const opt = (preset, title, text) => h('button', { class: 'choice', onclick: () => finish(preset) }, h('b', {}, title), h('span', {}, text));
      showModal(h('div', { class: 'dialog' },
        h('h3', {}, vids.length > 1 ? `Make ${vids.length} videos smaller` : 'Make video smaller'),
        h('div', { class: 'muted' }, 'Re-encodes the video in the background. This takes a little while (roughly a third of the video length) and replaces the original file.'),
        h('div', { class: 'choices' },
          opt('balanced', 'Smaller, same look', 'Usually 5–10× smaller; text stays sharp.'),
          opt('smallest', 'Smallest', 'Even smaller; limited to 1280 px and slightly softer.')),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'))));
      $('#modal').onmousedown = (e) => { if (e.target === $('#modal')) finish(null); };
    });
    if (!choice) return;
    const n = await guard(() => api.optimize(vids.map((i) => i.id), choice));
    if (n) toast(`Optimizing ${n} video${n > 1 ? 's' : ''} in the background…`);
  }

  async function doExport(items, format) {
    const r = await guard(() => api.exportItems(items.map((i) => i.id), format));
    if (r && r.length) toast(`Exported ${r.length} item${r.length > 1 ? 's' : ''}`);
  }
  async function doCopy(it) {
    const ok = await guard(() => api.copy(it.id));
    if (ok) toast(it.type === 'image' ? 'Image copied to clipboard' : 'File path copied');
  }
  async function doImport(promise) {
    const r = await guard(() => promise);
    if (r && r.length) toast(`Imported ${r.length} file${r.length > 1 ? 's' : ''}`);
    else if (r) toast('Nothing imported (unsupported files?)', true);
  }

  // ---------- context menu ----------
  function showMenu(x, y, entries) {
    const m = $('#menu');
    m.replaceChildren(...entries.map((e) => (e === '-' ? h('div', { class: 'sep' })
      : h('div', { class: 'mi' + (e.danger ? ' danger' : ''), onclick: () => { hideMenu(); e.run(); } }, h('span', {}, e.label), h('span', { class: 'k' }, e.key || '')))));
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  }
  function hideMenu() { $('#menu').hidden = true; }

  grid.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('.card');
    if (!el) return hideMenu();
    const id = el.dataset.id;
    if (!state.selected.has(id)) select(id);
    const sel = selectedItems();
    const one = sel.length === 1 ? sel[0] : null;
    const allImages = sel.every((i) => i.type === 'image');
    const entries = [];
    if (one) entries.push({ label: one.type === 'image' ? 'Open in editor' : 'Play', key: 'Enter', run: () => openItem(one) });
    if (one) entries.push({ label: one.type === 'image' ? 'Copy image' : 'Copy file path', key: one.type === 'image' ? 'Ctrl+C' : '', run: () => doCopy(one) });
    if (one) entries.push({ label: 'Show in folder', run: () => api.reveal(one.id) });
    entries.push('-');
    if (one) entries.push({ label: 'Rename…', key: 'F2', run: () => doRename(one) });
    const allFav = sel.every((i) => i.favorite);
    entries.push({ label: allFav ? 'Remove from favorites' : 'Add to favorites', run: () => guard(() => api.setFavorite(sel.map((i) => i.id), !allFav)) });
    entries.push({ label: 'Edit tags…', run: () => doTags(sel) });
    const videos = sel.filter((i) => i.type === 'video');
    if (videos.some((i) => !state.optimizing.has(i.id))) entries.push({ label: videos.length > 1 ? `Make ${videos.length} videos smaller…` : 'Make video smaller…', run: () => doOptimize(videos) });
    if (videos.some((i) => state.optimizing.has(i.id))) entries.push({ label: 'Cancel optimizing', run: () => videos.forEach((i) => api.optimizeCancel(i.id)) });
    entries.push('-');
    if (allImages) {
      for (const f of ['png', 'jpg', 'webp', 'pdf']) entries.push({ label: `Export as ${f.toUpperCase()}…`, run: () => doExport(sel, f) });
    } else entries.push({ label: 'Export…', run: () => doExport(sel) });
    entries.push('-');
    entries.push({ label: sel.length > 1 ? `Delete ${sel.length} items` : 'Delete', key: 'Del', danger: true, run: () => doDelete(sel) });
    showMenu(e.clientX, e.clientY, entries);
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
  window.addEventListener('blur', hideMenu);
  grid.addEventListener('scroll', hideMenu);

  // ---------- grid interaction ----------
  grid.addEventListener('click', (e) => {
    const el = e.target.closest('.card');
    if (!el) { state.selected.clear(); refreshSelectionClasses(); return; }
    select(el.dataset.id, e);
  });
  grid.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.card');
    if (el) openItem(itemById(el.dataset.id));
  });
  // Drag items out to other apps (native file drag handled by main).
  grid.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.card');
    if (!el) return;
    e.preventDefault();
    if (!state.selected.has(el.dataset.id)) select(el.dataset.id);
    api.startDrag([...state.selected]);
  });

  document.addEventListener('keydown', (e) => {
    if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const sel = selectedItems();
    if (e.key === 'Escape') { hideMenu(); state.selected.clear(); refreshSelectionClasses(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); state.selected = new Set(state.view.map((i) => i.id)); refreshSelectionClasses(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && sel.length === 1) { e.preventDefault(); doCopy(sel[0]); }
    else if (e.key === 'Delete') doDelete(sel);
    else if (e.key === 'F2' && sel.length === 1) doRename(sel[0]);
    else if (e.key === 'Enter' && sel.length === 1) openItem(sel[0]);
    else if (e.key.startsWith('Arrow') && state.view.length) {
      e.preventDefault();
      const cols = Math.max(1, Math.round(grid.clientWidth / (grid.children[0] ? grid.children[0].getBoundingClientRect().width + 14 : 1)));
      let i = state.view.findIndex((x) => x.id === state.anchor);
      if (i < 0) i = 0;
      else i += { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
      i = Math.max(0, Math.min(state.view.length - 1, i));
      select(state.view[i].id, e.shiftKey ? e : null);
      state.anchor = e.shiftKey ? state.anchor : state.view[i].id;
      const node = grid.children[i];
      if (node) node.scrollIntoView({ block: 'nearest' });
    }
  });

  // ---------- drag & drop import ----------
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; $('#dropOverlay').hidden = false; } });
  document.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; $('#dropOverlay').hidden = true;
    const paths = [...e.dataTransfer.files].map((f) => api.getPathForFile(f)).filter(Boolean);
    if (paths.length) doImport(api.importPaths(paths));
  });

  // ---------- toolbar ----------
  document.querySelectorAll('[data-capture]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.capture;
    guard(() => (k === 'record' ? api.startRecording() : api.capture(k)));
  }));
  $('#importBtn').addEventListener('click', () => doImport(api.importDialog()));
  $('#settingsBtn').addEventListener('click', () => guard(() => api.openSettings()));

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; applyView(); }, 120);
  });
  function setFilter(f) {
    state.filter = f;
    localStorage.setItem('lib.filter', f);
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.filter === f));
    applyView();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setFilter(t.dataset.filter)));
  $('#sort').value = state.sort;
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; localStorage.setItem('lib.sort', state.sort); applyView(); });
  function setCardW(w) { state.cardW = w; document.documentElement.style.setProperty('--card-w', w + 'px'); }
  $('#zoom').value = state.cardW;
  setCardW(state.cardW);
  $('#zoom').addEventListener('input', (e) => { setCardW(+e.target.value); localStorage.setItem('lib.cardW', e.target.value); });

  // ---------- live refresh ----------
  let reloadTimer;
  api.onChanged(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => guard(reload), 60); });
  window.addEventListener('focus', () => guard(reload));

  // Progress of videos being re-encoded smaller (started from the recorder or the context menu).
  const sz = (b) => fmtSize(b || 0);
  api.onOptimize((ev) => {
    if (ev.type === 'progress') {
      state.optimizing.set(ev.id, ev.progress || 0);
      updateOptimizeCard(ev.id);
      return;
    }
    state.optimizing.delete(ev.id);
    updateOptimizeCard(ev.id);
    if (ev.cancelled) toast('Optimizing cancelled');
    else if (ev.error) toast('Could not optimize the video: ' + ev.error, true);
    else if (ev.replaced) toast(`Video optimized: ${sz(ev.before)} → ${sz(ev.after)}`);
    else toast('The video is already small, so it was left as is');
  });
  api.optimizing().then((list) => {
    for (const j of list || []) state.optimizing.set(j.id, j.progress || 0);
    if (list && list.length) render();
  }).catch(() => {});

  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.filter === state.filter));
  guard(async () => {
    try { dateFmt = new Intl.DateTimeFormat((await api.locale()) || [], DATE_OPTS); } catch (_) { /* keep the default */ }
    await reload();
  });
})();
