import { createSceneAnimationInstancePlayback } from '../../engine/scene-animation-instance-playback.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This view owns a disposable preview clock, never author state or runtime ports.
// The frozen session delegates all transport and sampling rules to the core.
export function setupScenePreviewInstanceAnimation({ container, setFrames = () => {}, onActiveChange = () => {},
  getContext = () => ({ current: true }), now = () => performance.now(),
  schedule = callback => requestAnimationFrame(callback), cancel = handle => cancelAnimationFrame(handle) } = {}) {
  const document = container.ownerDocument;
  container.classList.add('scene-preview-instance-animation'); container.hidden = true;
  container.innerHTML = `<h3 id="scenePreviewInstanceAnimationTitle" data-i18n="按实例预览已保存动画"></h3>
    <p class="build-hint" data-i18n="每个实例可独立选择片段和播放时间；仅预览已保存图形，不运行状态脚本、行为、物理或声音，也不修改工程。"></p>
    <div id="scenePreviewInstanceAnimationControls">
      <div class="scene-preview-instance-animation-selectors">
        <label><span data-i18n="预览场景实例"></span><select id="scenePreviewInstanceAnimationInstance"></select></label>
        <label><span data-i18n="实例动画片段"></span><select id="scenePreviewInstanceAnimationClip"></select></label>
      </div><p id="scenePreviewInstanceAnimationClipRange" class="build-hint"></p>
      <div class="scene-preview-toolbar">
        <button id="scenePreviewInstanceAnimationPlay" type="button" class="doc-btn" data-i18n="播放选中实例"></button>
        <button id="scenePreviewInstanceAnimationPause" type="button" class="doc-btn doc-btn-ghost" data-i18n="暂停选中实例"></button>
        <button id="scenePreviewInstanceAnimationStop" type="button" class="doc-btn doc-btn-ghost" data-i18n="停止选中实例"></button>
        <button id="scenePreviewInstanceAnimationStopAll" type="button" class="doc-btn doc-btn-ghost" data-i18n="全部恢复静态"></button>
      </div><label class="scene-preview-animation-time"><span data-i18n="实例动画时间"></span>
        <input id="scenePreviewInstanceAnimationPosition" type="range" min="0" max="1" step="0.01" value="0">
        <output id="scenePreviewInstanceAnimationTime" for="scenePreviewInstanceAnimationPosition"></output></label>
    </div><p id="scenePreviewInstanceAnimationStatus" role="status" aria-live="polite"></p>
    <p id="scenePreviewInstanceAnimationSummary"></p><ul id="scenePreviewInstanceAnimationOverview"></ul>`;
  const el = suffix => container.querySelector('#scenePreviewInstanceAnimation' + suffix);
  const text = (suffix, value) => { if (el(suffix).textContent !== value) el(suffix).textContent = value; };
  const phaseKeys = { stopped: '静态', playing: '播放中', paused: '已暂停', finished: '已到末尾' };
  let disposed = false, available = true, visible = false, catalog = null, session = null, snapshot = null;
  let owner = null, generation = 0, handle = null, clockOrigin = 0, selected = '', active = false, message = '';
  const names = new Map(), overview = new Map();
  function cancelFrame() { generation++; if (handle !== null) cancel(handle); handle = null; }
  function activeState(value) { if (active === value) return; active = value; onActiveChange(value); }
  function restoreStatic() {
    // A host that rejects a visual frame still receives an explicit clear.
    try { setFrames(null); } finally { activeState(false); }
  }
  function clear(messageKey = '') {
    cancelFrame(); owner = null; catalog = null; session = null; snapshot = null; selected = ''; message = messageKey;
    names.clear(); overview.clear(); el('Instance').replaceChildren(); el('Clip').replaceChildren(); el('Overview').replaceChildren();
    el('Clip').dataset.choices = ''; restoreStatic();
  }
  function contextMatches(token) {
    try { const context = getContext(); return context?.current === true && context.generation === token.contextGeneration; }
    catch { return false; }
  }
  function current(token = owner) {
    if (disposed || !available || !visible || !session || !token || owner !== token) return false;
    if (contextMatches(token)) return true;
    clear('实例动画预览已失效，请刷新已保存场景。'); render(); return false;
  }
  const selectedRow = () => snapshot?.instances.find(row => row.instanceId === selected);
  const duration = row => { const clip = catalog?.document.clips?.find(item => item.id === row?.clipId); return clip ? clip.endSeconds - clip.startSeconds : catalog?.document.durationSeconds || 1; };
  const actorName = id => names.get(id) || id;
  const clipName = id => id === null ? t('完整动画') : catalog?.document.clips?.find(clip => clip.id === id)?.name || id;
  function render() {
    if (disposed) return;
    container.hidden = !available || !visible || !session && !message;
    const ready = Boolean(session && owner && available && visible && contextMatches(owner)), row = selectedRow();
    el('Controls').hidden = !session;
    for (const suffix of ['Instance', 'Clip', 'Position']) el(suffix).disabled = !ready || !row;
    el('Play').disabled = !ready || !row || row.phase === 'playing';
    el('Pause').disabled = !ready || row?.phase !== 'playing';
    el('Stop').disabled = !ready || !row?.active;
    el('StopAll').disabled = !ready || !snapshot?.instances.some(item => item.active);
    const choices = [['', t('完整动画')], ...(catalog?.document.clips || []).map(clip => [clip.id, `${clip.name} · ${clip.id}`])];
    const choicesKey = JSON.stringify(choices);
    if (el('Clip').dataset.choices !== choicesKey) {
      el('Clip').replaceChildren();
      for (const [value, label] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = label; el('Clip').append(option); }
      el('Clip').dataset.choices = choicesKey;
    }
    el('Instance').value = selected; el('Clip').value = row?.clipId || '';
    const clip = catalog?.document.clips?.find(item => item.id === row?.clipId);
    text('ClipRange', clip ? t('原时间轴 {0}–{1} 秒 · 片段时间从 0 开始', clip.startSeconds, clip.endSeconds) : '');
    const position = row?.positionSeconds || 0, end = duration(row);
    el('Position').max = String(end); el('Position').value = String(position);
    text('Time', `${position.toFixed(2)} / ${end.toFixed(2)} s`);
    text('Status', message ? t(message) : row ? t('选中实例：{0} · {1}', actorName(row.instanceId), t(phaseKeys[row.phase])) : '');
    el('Status').dataset.phase = row?.phase || (message ? 'error' : 'unavailable');
    const instances = snapshot?.instances || [], playing = instances.filter(item => item.phase === 'playing').length, displayed = instances.filter(item => item.active).length;
    text('Summary', session ? t('共 {0} 个动画实例 · {1} 个播放中 · {2} 个保留预览画面', instances.length, playing, displayed) : '');
    for (const entry of instances) {
      const node = overview.get(entry.instanceId);
      if (!node) continue;
      node.dataset.phase = entry.phase; node.dataset.active = String(entry.active);
      const label = t('实例 {0} · {1} · {2} · {3} 秒', actorName(entry.instanceId), clipName(entry.clipId), t(phaseKeys[entry.phase]), entry.positionSeconds.toFixed(2));
      if (node.textContent !== label) node.textContent = label;
    }
  }
  function fail() { clear('实例动画采样失败；已全部恢复静态。'); render(); }
  function paint(value, token) {
    if (!current(token)) return false;
    snapshot = value;
    const frames = value.instances.filter(row => row.active).map(({ instanceId, sample }) => ({ instanceId, sample }));
    setFrames(frames.length ? frames : null);
    if (!current(token)) return false;
    activeState(frames.length > 0);
    if (!current(token)) return false;
    render(); return true;
  }
  const seconds = () => (now() - clockOrigin) / 1000;
  function enqueue(token) {
    if (handle !== null || !current(token) || document.hidden || document.visibilityState === 'hidden' || !snapshot.instances.some(row => row.phase === 'playing')) return;
    const ticket = generation;
    handle = schedule(() => {
      if (ticket !== generation || !current(token)) return;
      handle = null;
      if (document.hidden || document.visibilityState === 'hidden') { pauseBackground(); return; }
      try { if (paint(session.advance(seconds()), token) && ticket === generation) enqueue(token); }
      catch { if (owner === token) fail(); }
    });
  }
  function execute(command, all = false) {
    const token = owner;
    if (!current(token) || !selected || document.hidden || document.visibilityState === 'hidden') return;
    cancelFrame(); message = '';
    try {
      const value = all ? session.commandAll(command, seconds()) : session.command(selected, command, seconds());
      if (paint(value, token)) enqueue(token);
    } catch { if (owner === token) fail(); }
  }
  function stop() {
    const token = owner;
    if (!current(token)) return;
    cancelFrame(); message = '';
    try { paint(session.commandAll({ action: 'stop' }, snapshot.timeSeconds), token); }
    catch { if (owner === token) fail(); }
  }
  function pauseBackground() {
    const token = owner;
    if (!current(token) || !snapshot.instances.some(row => row.phase === 'playing')) return;
    cancelFrame();
    // Pause at the last painted clock, retaining the exact visible frame.
    try { paint(session.commandAll({ action: 'pause' }, snapshot.timeSeconds), token); }
    catch { if (owner === token) fail(); }
  }
  el('Instance').addEventListener('change', () => {
    if (!current()) return;
    if (snapshot.instances.some(row => row.instanceId === el('Instance').value)) selected = el('Instance').value;
    render();
  });
  el('Clip').addEventListener('change', () => {
    if (!current()) return;
    const clipId = el('Clip').value || null;
    if (clipId !== null && !catalog.document.clips?.some(clip => clip.id === clipId)) { render(); return; }
    if (selectedRow()?.clipId !== clipId) execute({ action: 'select', clipId });
  });
  el('Play').addEventListener('click', () => execute({ action: 'play' }));
  el('Pause').addEventListener('click', () => execute({ action: 'pause' }));
  el('Stop').addEventListener('click', () => execute({ action: 'stop' }));
  el('StopAll').addEventListener('click', stop);
  el('Position').addEventListener('input', () => {
    if (!current()) return;
    const position = Number(el('Position').value);
    if (!Number.isFinite(position) || position < 0 || position > duration(selectedRow())) { render(); return; }
    execute({ action: 'seek', positionSeconds: position });
  });
  const background = () => { if (document.hidden || document.visibilityState === 'hidden') pauseBackground(); };
  document.addEventListener('visibilitychange', background); globalThis.window?.addEventListener('pagehide', pauseBackground);
  const unsubscribe = onLanguageChange(() => { if (!disposed) { translatePage(container); refresh(); } });
  function refresh() { if (disposed) return; if (session && !current()) return; render(); }
  function reset() { if (disposed) return; clear(); render(); }
  translatePage(container); render();
  return Object.freeze({
    setAvailable(value) { if (disposed) return; const next = value === true; if (next === available) return; available = next; if (!next) clear(); render(); },
    setVisible(value) { if (disposed) return; const next = value === true; if (next === visible) return; visible = next; if (!next) clear(); render(); },
    setPreview(value, actors = []) {
      if (disposed || !available || !visible) return;
      if (value === catalog && current()) { render(); return; }
      clear();
      try {
        const context = getContext();
        if (context?.current !== true) { render(); return; }
        const next = createSceneAnimationInstancePlayback(value), initial = next.snapshot();
        if (!Array.isArray(actors) || actors.length > 128) throw Error('Invalid actor labels.');
        for (const actor of actors) {
          const id = actor && Object.getOwnPropertyDescriptor(actor, 'instanceId')?.value;
          const name = actor && Object.getOwnPropertyDescriptor(actor, 'name')?.value;
          if (typeof id !== 'string' || names.has(id)) throw Error('Invalid actor identity.');
          names.set(id, typeof name === 'string' && name.trim() ? `${name} · ${id}` : id);
        }
        catalog = value; session = next; snapshot = initial; clockOrigin = now(); owner = { contextGeneration: context.generation };
        selected = initial.instances[0]?.instanceId || '';
        for (const entry of initial.instances) {
          const option = document.createElement('option'); option.value = entry.instanceId; option.textContent = actorName(entry.instanceId); el('Instance').append(option);
          const row = document.createElement('li'); row.dataset.instanceId = entry.instanceId; el('Overview').append(row); overview.set(entry.instanceId, row);
        }
        render();
      } catch { fail(); }
    },
    refresh, reset, stop, isActive: () => active,
    destroy() {
      if (disposed) return; reset(); disposed = true; unsubscribe?.(); document.removeEventListener('visibilitychange', background);
      globalThis.window?.removeEventListener('pagehide', pauseBackground); container.replaceChildren(); container.hidden = true;
    },
  });
}
