import { createScene3DPlayback } from './scene3d-playback.js';

// Coordinates local playback controls. All sampling/rendering authority is injected.
export function createScene3DParticlePreview(container, { document, t, onSample,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = ticket => globalThis.cancelAnimationFrame(ticket) }) {
  container.innerHTML = `<p id="scene3dParticleNote" class="scene3d-note"></p><div class="scene3d-particle-controls">
    <button id="scene3dParticlePlay" type="button" class="doc-btn doc-btn-ghost"></button>
    <label><span id="scene3dParticleTimeLabel"></span><input id="scene3dParticleTime" type="number" min="0" max="3600" step="any" value="0"></label>
    <button id="scene3dParticleSeek" type="button" class="doc-btn doc-btn-ghost"></button>
    <button id="scene3dParticleReset" type="button" class="doc-btn doc-btn-ghost"></button></div>
    <p id="scene3dParticleError" class="scene3d-diagnostics" role="status" hidden></p>`;
  const el = suffix => container.querySelector('#scene3dParticle' + suffix);
  let available = false, field = null, disposed = false, error = false;
  function refresh() {
    if (disposed) return;
    const state = clock.snapshot(); container.hidden = !field;
    el('Note').textContent = t(field?.count === 0 ? '粒子数量为0，当前场景已关闭粒子。' : '粒子预览仅改变查看时刻，不修改场景。时刻范围为0到3600秒。');
    el('Play').textContent = t(state.playing ? '暂停粒子' : '播放粒子');
    el('TimeLabel').textContent = t('预览时刻（秒）'); el('Time').setAttribute('aria-label', t('预览时刻（秒）'));
    el('Seek').textContent = t('查看时刻'); el('Reset').textContent = t('回到起点');
    for (const id of ['Play', 'Time', 'Seek', 'Reset']) el(id).disabled = !available || !field?.count;
    if (state.timeSeconds >= 3600) el('Play').disabled = true;
    el('Error').hidden = !error; el('Error').textContent = t('无法预览此时刻，请输入0到3600之间的秒数并确认当前草稿已刷新。');
  }
  const clock = createScene3DPlayback({ requestFrame, cancelFrame,
    onSample: seconds => {
      if (disposed || !available || !field?.count || document.hidden) return false;
      const result = onSample(seconds) === true; if (!result) error = true; return result;
    },
    onChange: state => { if (disposed) return; if (document.activeElement !== el('Time')) el('Time').value = String(Math.round(state.timeSeconds * 1000) / 1000); refresh(); },
  });
  function seek(seconds) {
    if (!available || disposed || !field?.count) return false;
    error = !clock.seek(seconds); if (!error) el('Time').value = String(seconds); refresh(); return !error;
  }
  el('Play').addEventListener('click', () => { if (disposed || !available || !field?.count) return; error = false;
    if (clock.snapshot().playing) clock.pause(); else if (!clock.play()) error = true; refresh(); });
  el('Time').addEventListener('input', () => { const raw = el('Time').value; clock.pause(); el('Time').value = raw; error = false; refresh(); });
  el('Seek').addEventListener('click', () => seek(el('Time').value.trim() ? Number(el('Time').value) : NaN));
  el('Time').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); seek(el('Time').value.trim() ? Number(el('Time').value) : NaN); } });
  el('Reset').addEventListener('click', () => seek(0));
  const visibility = () => { if (document.hidden) clock.pause(); };
  document.addEventListener('visibilitychange', visibility); refresh();
  return Object.freeze({
    setField(value) { field = value; available = false; error = false; clock.reset(); el('Time').value = '0'; refresh(); },
    setAvailable(value) { available = Boolean(value); if (!available && clock.snapshot().playing) clock.pause(); refresh(); },
    refresh,
    dispose() { if (disposed) return; disposed = true; clock.dispose(); document.removeEventListener('visibilitychange', visibility); container.replaceChildren(); },
  });
}
