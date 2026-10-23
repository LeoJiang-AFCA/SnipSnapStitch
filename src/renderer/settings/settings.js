(async () => {
  const $ = (s) => document.querySelector(s);
  const status = $('#status');
  let saveTimer;

  function flash(msg) {
    status.textContent = msg;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => (status.textContent = ''), 1500);
  }

  async function save(obj) {
    await window.settingsApi.setMany(obj);
    flash('Saved');
  }

  const s = await window.settingsApi.getAll();
  $('#afterCapture').value = s.afterCapture;
  $('#launchAtLogin').checked = !!s.launchAtLogin;
  $('#replacePrintScreen').checked = !!s.replacePrintScreen;
  $('#copyToClipboard').checked = !!s.copyToClipboard;
  $('#captureCursor').checked = !!s.captureCursor;
  $('#delaySeconds').value = s.delaySeconds;
  $('#saveFolder').value = s.saveFolder || '';

  $('#afterCapture').onchange = (e) => save({ afterCapture: e.target.value });
  $('#launchAtLogin').onchange = (e) => save({ launchAtLogin: e.target.checked });
  $('#replacePrintScreen').onchange = (e) => save({ replacePrintScreen: e.target.checked });
  $('#copyToClipboard').onchange = (e) => save({ copyToClipboard: e.target.checked });
  $('#captureCursor').onchange = (e) => save({ captureCursor: e.target.checked });
  $('#delaySeconds').onchange = (e) => {
    const n = Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0));
    e.target.value = n;
    save({ delaySeconds: n });
  };
  $('#browse').onclick = async () => {
    const dir = await window.settingsApi.chooseFolder();
    if (dir) {
      $('#saveFolder').value = dir;
      save({ saveFolder: dir });
    }
  };
  $('#clearFolder').onclick = () => {
    $('#saveFolder').value = '';
    save({ saveFolder: null });
  };
  $('#close').onclick = () => window.settingsApi.close();

  const MODS = ['Control', 'Shift', 'Alt', 'Meta'];
  function keyName(e) {
    if (e.key === ' ') return 'Space';
    if (e.key.length === 1) return e.key.toUpperCase();
    const map = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };
    return map[e.key] || e.key;
  }
  document.querySelectorAll('.hotkey').forEach((input) => {
    input.value = s[input.dataset.key] || '';
    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (MODS.includes(e.key)) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        input.value = '';
        return save({ [input.dataset.key]: '' });
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d+$/.test(e.key)) {
        return flash('Use at least Ctrl/Alt/Win or an F-key');
      }
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');
      parts.push(keyName(e));
      const accel = parts.join('+');
      input.value = accel;
      save({ [input.dataset.key]: accel });
    });
  });
})();
