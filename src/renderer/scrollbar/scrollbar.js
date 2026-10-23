const $ = (id) => document.getElementById(id);
for (const id of ['auto', 'done', 'cancel']) $(id).onclick = () => window.scrollBar.action(id);
window.scrollBar.onStatus((s) => {
  $('stat').textContent = s.height ? `${s.height} px \u00b7 ${s.frames} frame${s.frames === 1 ? '' : 's'}` : '';
  $('msg').textContent = s.msg || '';
  $('msg').className = 'msg' + (s.level === 'warn' ? ' warn' : '');
  $('auto').innerHTML = s.mode === 'auto' ? '&#10074;&#10074; Pause auto' : '&#9654; Auto-scroll';
  $('auto').disabled = !s.canAuto;
});
