/* UI views of the recorder: setup HUD, control bar, region overlay, countdown, cursor halo. */
(function () {
  'use strict';
  const view = new URLSearchParams(location.search).get('view');
  if (!view || view === 'worker') return;
  const api = window.recorderApi;
  const $ = (id) => document.getElementById(id);
  document.body.classList.add('view-' + view);

  const views = {
    setup() {
      $('setup').hidden = false;
      const s = { mode: 'screen', fps: 15, audio: true, mic: false, countdown: true, highlightCursor: false, optimize: true, displayId: null, windowId: null };
      let displays = [];

      function render() {
        document.querySelectorAll('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
        document.querySelectorAll('#fps-seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.fps) === s.fps));
        $('display-row').hidden = !(s.mode === 'screen' && displays.length > 1);
        $('window-row').hidden = s.mode !== 'window';
        $('halo-row').hidden = s.mode === 'window';
        $('opt-audio').checked = s.audio;
        $('opt-mic').checked = s.mic;
        $('opt-countdown').checked = s.countdown;
        $('opt-halo').checked = s.highlightCursor;
        $('opt-optimize').checked = s.optimize;
      }

      async function loadWindows() {
        const list = $('window-list');
        list.textContent = 'Loading windows…';
        let wins = [];
        try { wins = await api.invoke('recorder:list-windows'); } catch (e) { /* ignore */ }
        list.textContent = '';
        if (!wins.length) { list.textContent = 'No windows found.'; return; }
        if (!wins.some((w) => w.id === s.windowId)) s.windowId = null;
        for (const w of wins) {
          const el = document.createElement('button');
          el.className = 'win' + (w.id === s.windowId ? ' on' : '');
          const img = document.createElement('img');
          img.src = w.thumb;
          const name = document.createElement('div');
          name.textContent = w.name;
          name.title = w.name;
          el.append(img, name);
          el.onclick = () => {
            s.windowId = w.id;
            list.querySelectorAll('.win').forEach((x) => x.classList.remove('on'));
            el.classList.add('on');
          };
          list.appendChild(el);
        }
      }

      document.querySelectorAll('#mode-seg button').forEach((b) => {
        b.onclick = () => { s.mode = b.dataset.mode; render(); if (s.mode === 'window') loadWindows(); };
      });
      document.querySelectorAll('#fps-seg button').forEach((b) => {
        b.onclick = () => { s.fps = Number(b.dataset.fps); render(); };
      });
      $('opt-audio').onchange = (e) => { s.audio = e.target.checked; };
      $('opt-mic').onchange = (e) => { s.mic = e.target.checked; };
      $('opt-countdown').onchange = (e) => { s.countdown = e.target.checked; };
      $('opt-halo').onchange = (e) => { s.highlightCursor = e.target.checked; };
      $('opt-optimize').onchange = (e) => { s.optimize = e.target.checked; };
      $('display-sel').onchange = (e) => { s.displayId = Number(e.target.value); };
      $('window-refresh').onclick = loadWindows;

      const cancel = () => api.invoke('recorder:setup-cancel');
      $('setup-close').onclick = cancel;
      $('setup-cancel').onclick = cancel;
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });

      async function submit() {
        const err = $('setup-error');
        err.hidden = true;
        if (s.mode === 'window' && !s.windowId) {
          err.textContent = 'Select a window to record.';
          err.hidden = false;
          return;
        }
        const res = await api.invoke('recorder:setup-submit', s);
        if (res && res.ok === false) {
          err.textContent = res.error || 'Cannot start recording.';
          err.hidden = false;
        }
      }
      $('setup-start').onclick = submit;
      window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') submit(); });

      api.invoke('recorder:setup-init').then((init) => {
        Object.assign(s, init.opts || {});
        displays = init.displays || [];
        if (!displays.some((d) => d.id === s.displayId)) s.displayId = init.defaultDisplayId;
        const sel = $('display-sel');
        for (const d of displays) {
          const o = document.createElement('option');
          o.value = d.id;
          o.textContent = d.label;
          sel.appendChild(o);
        }
        sel.value = s.displayId;
        render();
        if (s.mode === 'window') loadWindows();
      });
      render();
    },

    bar() {
      $('bar').hidden = false;
      let base = 0, at = 0, running = false;
      const fmt = (ms) => {
        const t = Math.floor(ms / 1000);
        const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
        const p = (n) => String(n).padStart(2, '0');
        return (h ? h + ':' : '') + p(m) + ':' + p(sec);
      };
      const tick = () => { $('bar-time').textContent = fmt(base + (running ? performance.now() - at : 0)); };
      setInterval(tick, 200);
      function apply(st) {
        if (!st) return;
        base = st.elapsedMs || 0;
        at = performance.now();
        running = st.status === 'recording';
        const paused = st.status === 'paused';
        show(paused);
        $('bar-mic').classList.toggle('on', !!st.micActive);
        $('bar-mic').title = st.micActive ? 'Microphone on' : 'Microphone off';
        $('bar-mic').hidden = !st.micRequested;
        tick();
      }
      let isPaused = false;
      function show(paused) {
        isPaused = paused;
        $('bar').classList.toggle('paused', paused);
        $('bar-pause').classList.toggle('resume', paused);
        $('bar-pause').title = paused ? 'Resume' : 'Pause';
      }
      api.on('recorder:state', apply);
      api.invoke('recorder:state').then(apply);
      $('bar-pause').onclick = () => {
        // Update the button and timer at once; the main process confirms with a state message.
        const paused = !isPaused;
        base += running ? performance.now() - at : 0;
        at = performance.now();
        running = !paused;
        show(paused);
        tick();
        api.invoke('recorder:bar-action', { action: 'pause', paused }).catch(() => {});
      };
      $('bar-stop').onclick = () => api.invoke('recorder:bar-action', { action: 'stop' });
      $('bar-discard').onclick = () => api.invoke('recorder:bar-action', { action: 'discard' });
    },

    region() {
      $('region').hidden = false;
      const q = new URLSearchParams(location.search);
      const displayId = Number(q.get('did'));
      const box = $('region-box');
      let start = null, rect = null;
      const done = (r) => api.invoke('recorder:region-result', { displayId, rect: r });

      function update(x, y) {
        rect = {
          x: Math.round(Math.min(start.x, x)), y: Math.round(Math.min(start.y, y)),
          w: Math.round(Math.abs(x - start.x)), h: Math.round(Math.abs(y - start.y)),
        };
        Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
        $('region-size').textContent = rect.w + ' × ' + rect.h;
      }
      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0) { done(null); return; }
        start = { x: e.clientX, y: e.clientY };
        $('region-hint').hidden = true;
        box.hidden = false;
        update(e.clientX, e.clientY);
      });
      window.addEventListener('mousemove', (e) => { if (start) update(e.clientX, e.clientY); });
      window.addEventListener('mouseup', () => {
        if (!start) return;
        start = null;
        if (rect && rect.w >= 16 && rect.h >= 16) done(rect);
        else { box.hidden = true; $('region-hint').hidden = false; rect = null; }
      });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
      window.addEventListener('contextmenu', (e) => { e.preventDefault(); done(null); });
    },

    countdown() {
      $('countdown').hidden = false;
      $('countdown').onclick = () => api.invoke('recorder:cancel');
      api.on('recorder:count', (n) => {
        const old = $('count-num');
        const el = old.cloneNode(false);
        el.textContent = String(n);
        old.replaceWith(el); // restarts the CSS animation
      });
    },

    halo() {
      $('halo').hidden = false;
    },
  };

  if (views[view]) views[view]();
})();
