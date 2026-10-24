import { setupScenePreviewInstanceAnimation } from './app-scene-preview-instance-animation.js';
import { captureSceneAnimationPreview } from '../../engine/scene-animation-preview.mjs';
import { createSceneAnimationPlayer } from './scene-animation-player.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// Owns playback controls and a readonly visual layer. The scene host owns
// frozen images, source provenance, author navigation and all write authority.
export function setupScenePreviewAnimation({ container, setSample = () => {}, setInstanceSamples = () => {}, onActiveChange = () => {} } = {}) {
  container.classList.add('scene-preview-animation'); container.hidden = true;
  container.innerHTML = `<h3 data-i18n="已保存场景动画"></h3><p id="scenePreviewAnimationSource" class="build-hint"></p>
    <p id="scenePreviewAnimationStatus" role="status" aria-live="polite"></p>
    <label id="scenePreviewAnimationModeSelection"><span data-i18n="动画预览范围"></span><select id="scenePreviewAnimationMode"><option value="scene" data-i18n="整场景"></option><option value="instance" data-i18n="按实例预览"></option></select></label>
    <section id="scenePreviewAnimationInstances" hidden></section>
    <div id="scenePreviewAnimationControls"><label id="scenePreviewAnimationClipSelection"><span data-i18n="预览动画片段"></span><select id="scenePreviewAnimationClip"></select></label><p id="scenePreviewAnimationClipRange" class="build-hint"></p><div class="scene-preview-toolbar">
      <button id="scenePreviewAnimationPlay" type="button" class="doc-btn" data-i18n="播放动画"></button>
      <button id="scenePreviewAnimationPause" type="button" class="doc-btn doc-btn-ghost" data-i18n="暂停动画"></button>
      <button id="scenePreviewAnimationStop" type="button" class="doc-btn doc-btn-ghost" data-i18n="停止并恢复静态场景"></button></div>
      <label class="scene-preview-animation-time"><span data-i18n="动画时间"></span><input id="scenePreviewAnimationPosition" type="range" min="0" max="1" step="0.01" value="0"><output id="scenePreviewAnimationTime" for="scenePreviewAnimationPosition"></output></label>
      <p class="build-hint" data-i18n="仅播放本次快照中的图形动画，不运行行为、物理或声音。标签、对象列表和属性仍对应已保存的逻辑位置。动画开启时不能编辑布局；停止后恢复。"></p></div>
    <p id="scenePreviewAnimationDiagnostic" class="build-hint"></p>`;
  const el = name => container.querySelector('#scenePreviewAnimation' + name);
  let available = false, visible = false, disposed = false, catalog = null, source = null, active = false, state = 'stopped', latest = null, invalid = false, selectedClip = null, mode = 'scene';
  const current = () => !disposed && available && visible && catalog?.status === 'ready';
  function overlay(value) { if (active === value) return; active = value; onActiveChange(active); }
  function paint(sample) { latest = sample; if (active && mode === 'scene' && current()) setSample(sample); }
  const player = createSceneAnimationPlayer({ isCurrent: () => current() && mode === 'scene', onSample: paint, onState: next => {
    state = next.state;
    if (state === 'error') { setSample(null); overlay(false); }
    render();
  } });
  const instances = setupScenePreviewInstanceAnimation({ container: el('Instances'),
    getContext: () => ({ current: current() && mode === 'instance' }),
    setFrames: frames => { if (frames === null || current() && mode === 'instance') setInstanceSamples(frames); },
    onActiveChange: value => { if (mode === 'instance') overlay(value); },
  });
  function showInstances() {
    instances.setAvailable(available); instances.setVisible(visible && mode === 'instance');
    if (mode === 'instance' && current()) instances.setPreview(catalog, source.actors);
  }
  const text = (name, value) => { const node = el(name); if (node.textContent !== value) node.textContent = value; };
  translatePage(container);
  function render() {
    if (disposed) return;
    container.hidden = !available || !visible || !source;
    const ready = current(); el('Controls').hidden = catalog?.status !== 'ready' || mode !== 'scene';
    el('ModeSelection').hidden = catalog?.status !== 'ready'; el('Mode').value = mode; el('Mode').disabled = !ready;
    el('Play').disabled = !ready || state === 'playing'; el('Pause').disabled = !ready || state !== 'playing';
    el('Stop').disabled = !ready || !active; el('Position').disabled = !ready;
    text('Source', catalog?.manifest?.sourcePath || '');
    const choices = catalog?.document?.clips || [], selector = el('Clip'), choiceKey = JSON.stringify([choices.map(clip => [clip.id, clip.name]), t('完整动画')]);
    el('ClipSelection').hidden = !choices.length;
    if (selector.dataset.choices !== choiceKey) {
      selector.dataset.choices = choiceKey; selector.replaceChildren();
      for (const [id, label] of [['', t('完整动画')], ...choices.map(clip => [clip.id, `${clip.name} · ${clip.id}`])]) { const option = container.ownerDocument.createElement('option'); option.value = id; option.textContent = label; selector.append(option); }
    }
    selector.value = selectedClip || ''; selector.disabled = !ready;
    const clip = choices.find(clip => clip.id === selectedClip);
    text('ClipRange', clip ? t('原时间轴 {0}–{1} 秒 · 片段时间从 0 开始', clip.startSeconds, clip.endSeconds) : '');
    const position = latest?.localTimeSeconds || 0, duration = clip ? clip.endSeconds - clip.startSeconds : catalog?.document?.durationSeconds || 1;
    el('Position').max = String(duration); el('Position').value = String(position);
    text('Time', `${position.toFixed(2)} / ${duration.toFixed(2)} s`);
    el('Status').hidden = mode === 'instance' && ready;
    text('Status', t(invalid || catalog?.status === 'invalid' ? '已保存动画无效；场景仍以静态显示。请修正动画原文后刷新。'
      : catalog?.status === 'none' ? '此场景未关联动画。'
      : state === 'error' ? '动画采样失败；已恢复静态场景。'
      : state === 'playing' ? '正在播放已保存场景动画。'
      : active ? '场景动画已暂停；停止可恢复静态场景。'
      : '当前为静态场景。播放或拖动时间可查看已保存动画。'));
    text('Diagnostic', invalid ? 'scene_animation_preview_invalid' : (catalog?.diagnostics || []).map(item => `${item.code} · ${item.sourcePath || ''}${item.propertyPath || ''}`).join('\n'));
  }
  function clear() { overlay(false); setSample(null); instances.reset(); player.clear(); latest = null; state = 'stopped'; }
  function stop() {
    if (disposed) return;
    overlay(false); setSample(null); instances.stop(); player.stop(); latest = null; state = 'stopped'; render();
  }
  function reset() { mode = 'scene'; selectedClip = null; clear(); instances.setVisible(false); catalog = null; source = null; invalid = false; render(); }
  el('Mode').addEventListener('change', () => {
    if (!current() || !['scene', 'instance'].includes(el('Mode').value)) { render(); return; }
    const next = el('Mode').value; if (next === mode) return;
    stop(); mode = next; showInstances(); render();
  });
  el('Play').addEventListener('click', () => {
    if (!current() || mode !== 'scene' || state === 'playing') return;
    try { overlay(true); if (latest) setSample(latest); if (!player.play()) stop(); }
    catch { setSample(null); overlay(false); state = 'error'; render(); }
  });
  el('Pause').addEventListener('click', () => { if (current() && mode === 'scene') player.pause(); });
  el('Stop').addEventListener('click', stop);
  el('Clip').addEventListener('change', () => {
    if (!current() || mode !== 'scene') return;
    const selection = el('Clip').value || null;
    if (selection !== null && !catalog.document.clips?.some(clip => clip.id === selection)) { render(); return; }
    selectedClip = selection;
    try { overlay(true); if (!player.selectClip(selectedClip)) stop(); }
    catch { setSample(null); overlay(false); state = 'error'; render(); }
  });
  el('Position').addEventListener('input', () => {
    if (!current() || mode !== 'scene') return;
    const seconds = Number(el('Position').value); if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number(el('Position').max)) return;
    try { overlay(true); if (!player.seek(seconds)) stop(); }
    catch { setSample(null); overlay(false); state = 'error'; render(); }
  });
  const pauseHidden = () => { if (document.hidden || document.visibilityState === 'hidden') player.pause(); }, pagehide = () => player.pause();
  document.addEventListener('visibilitychange', pauseHidden); globalThis.window?.addEventListener('pagehide', pagehide);
  const unsubscribe = onLanguageChange(() => { if (!disposed) { translatePage(container); render(); } });
  return Object.freeze({
    setAvailable(value) { const next = value === true; if (available === next) return; available = next; if (!next) reset(); render(); },
    setVisible(value) { const next = value === true; if (visible === next) return; visible = next; if (!next) reset(); render(); },
    setPreview(value) {
      if (disposed || value === source) return; reset();
      if (!available || !visible || !value || !Object.hasOwn(value, 'animationPreview') || value.draft || value.composition) return;
      source = value;
      try { catalog = captureSceneAnimationPreview(value); if (catalog.status === 'ready') player.load(catalog.document); showInstances(); }
      catch { catalog = null; invalid = true; }
      render();
    },
    reset, stop, isActive: () => active,
    destroy() { if (disposed) return; reset(); player.dispose(); instances.destroy(); disposed = true; unsubscribe?.(); document.removeEventListener('visibilitychange', pauseHidden); globalThis.window?.removeEventListener('pagehide', pagehide); container.replaceChildren(); container.hidden = true; },
  });
}
