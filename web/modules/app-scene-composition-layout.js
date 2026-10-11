import { createSceneCompositionLayoutDraft } from '../../engine/scene-composition-layout.mjs';
import { getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { createScenePreviewCanvas } from './app-scene-preview-canvas.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value));

// A fixed instance's geometry stays local until the editor accepts the reviewed
// recipe source. The host owns dependency I/O and the eventual ordinary save.
export function setupSceneCompositionLayout({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionLayoutDialog'; dialog.className = 'project-build scene-layout scene-composition-layout';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionLayoutTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionLayoutTitle" data-i18n="调整此实例布局"></h2>
    <button id="sceneCompositionLayoutClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="只调整此实例的位置；整个场景用于参照。检查后应用到配方原文草稿，仍需在编辑器保存。"></p>
    <p id="sceneCompositionLayoutIdentity" class="build-hint"></p><p id="sceneCompositionLayoutMessage" role="status" aria-live="polite"></p>
    <div class="scene-preview-toolbar"><button id="sceneCompositionLayoutMove" type="button" class="doc-btn" data-i18n="移动对象"></button>
      <button id="sceneCompositionLayoutPan" type="button" class="doc-btn doc-btn-ghost" data-i18n="平移视图"></button>
      <label class="scene-preview-grid"><input id="sceneCompositionLayoutSnap" type="checkbox"><span data-i18n="吸附到 32 像素网格"></span></label>
      <label class="scene-preview-grid"><input id="sceneCompositionLayoutGrid" type="checkbox" checked><span data-i18n="显示网格"></span></label>
      <button id="sceneCompositionLayoutUndo" type="button" class="doc-btn doc-btn-ghost" data-i18n="撤销布局修改"></button>
      <button id="sceneCompositionLayoutRedo" type="button" class="doc-btn doc-btn-ghost" data-i18n="重做布局修改"></button></div>
    <div class="scene-preview-toolbar"><button id="sceneCompositionLayoutFit" type="button" class="doc-btn doc-btn-ghost" data-i18n="适应画布"></button>
      <button id="sceneCompositionLayoutZoomOut" type="button" class="doc-btn doc-btn-ghost" data-i18n="缩小"></button><output id="sceneCompositionLayoutZoom"></output>
      <button id="sceneCompositionLayoutZoomIn" type="button" class="doc-btn doc-btn-ghost" data-i18n="放大"></button></div>
    <p id="sceneCompositionLayoutHelp" class="build-hint" data-i18n="拖动高亮实例或用方向键微调；Shift 加方向键移动 10 像素。拖动空白区域、中键或按住空格可平移视图。"></p>
    <div class="scene-preview-layout"><canvas id="sceneCompositionLayoutCanvas" tabindex="0" aria-describedby="sceneCompositionLayoutHelp" data-i18n-aria-label="当前实例的位置草稿"></canvas>
      <aside><h3 data-i18n="画布位置"></h3><p id="sceneCompositionLayoutSelection"></p><div class="scene-settings">
        <label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneCompositionLayoutX" type="number" min="-100000" max="100000" step="any"></label>
        <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneCompositionLayoutY" type="number" min="-100000" max="100000" step="any"></label></div>
        <p id="sceneCompositionLayoutLocal" class="build-hint"></p><p id="sceneCompositionLayoutOffset" class="build-hint"></p>
        <p class="build-hint" data-i18n="其他实例、放置偏移、共用片段和其他属性保持原样。要恢复位置继承，请使用实例覆盖中的恢复继承。"></p></aside></div>
    <details id="sceneCompositionLayoutReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionLayoutSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionLayoutDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionLayoutError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionLayoutDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionLayoutCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查布局修改"></button>
      <button id="sceneCompositionLayoutApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionLayoutCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionLayout${suffix}`);
  let session = null, openEpoch = 0, formEpoch = 0, disposed = false, opener = null, focusEpoch = 0;
  let pending = false, moving = true, inputPending = false, proposal = null, approved = null, approvedSignature = '';
  let message = '', details = '', diagnostics = [], images = new Map();
  const current = () => {
    const c = getContext();
    return Boolean(session && !disposed && getStudioCoreMetadata().ready && c.compositionSourceWritable === true
      && c.canEditCompositionLayout === true && c.editable && !c.creating && !c.busy
      && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent());
  };
  const signature = () => JSON.stringify([el('X').value, el('Y').value]);
  const unfinishedInput = () => {
    if (!session) return false;
    const position = session.draft.currentPosition(session.actorId);
    return inputPending || ['X', 'Y'].some((suffix, axis) => !el(suffix).value.trim() || Number(el(suffix).value) !== position[axis]);
  };
  const dirty = () => Boolean(session && (unfinishedInput() || session.draft.state().dirty));
  const view = createScenePreviewCanvas({ canvas: el('Canvas'), onSelect() { if (session) view.select(session.actorId); },
    onMove(id, position) {
      if (!session || id !== session.actorId || pending || !current() || unfinishedInput()) return;
      try { if (session.draft.setPosition(id, position)) changed(); else updateView(); }
      catch (error) { report(error, '布局修改未执行。请检查所选对象的位置是否超出范围。'); updateView(); }
      refresh();
    }, onViewChange(value) { el('Zoom').textContent = `${Math.round(value.scale * 100)}%`; } });
  view.setMultiSelect(false); view.setMovableIds([]);
  function syncCoordinates() {
    if (!session) return;
    const position = session.draft.currentPosition(session.actorId);
    el('X').value = String(position[0]); el('Y').value = String(position[1]);
  }
  function updateView() {
    if (!session) { view.setScene(null); return; }
    view.setScene({ ...session.model, actors: session.draft.actors() }); view.select(session.actorId);
    if (!inputPending) syncCoordinates();
  }
  function changed() {
    formEpoch++; approved = null; proposal = null; details = ''; diagnostics = [];
    message = '实例布局尚未应用到原文草稿。'; updateView();
  }
  function refresh() {
    translatePage(dialog);
    const valid = current(), state = session?.draft.state() || {}, unfinished = unfinishedInput();
    if (approved && approvedSignature !== signature()) approved = null;
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化。布局修改保留，请重新预览后调整此实例。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty());
    for (const suffix of ['X', 'Y', 'Move', 'Snap']) el(suffix).disabled = pending || !valid;
    el('Move').setAttribute('aria-pressed', String(moving)); el('Pan').setAttribute('aria-pressed', String(!moving));
    el('Undo').disabled = pending || !valid || !state.canUndo && !unfinished;
    el('Redo').disabled = pending || !valid || unfinished || !state.canRedo;
    el('Check').disabled = pending || !valid || unfinished || !state.dirty;
    el('Apply').disabled = pending || !valid || unfinished || !approved;
    el('Close').disabled = pending; el('Cancel').disabled = pending;
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details;
    const list = el('Diagnostics'); list.replaceChildren();
    for (const issue of diagnostics) { const row = document.createElement('li'); row.textContent = `${issue.code || ''} ${issue.propertyPath || ''}`; list.append(row); }
    if (session) {
      const { placementId, actorKey, actorId } = session.draft;
      el('Identity').textContent = `${t('放置')} · ${placementId} · ${t('局部标识')} · ${actorKey} · ${t('实例')} · ${actorId}`;
      el('Selection').textContent = t('已选择：{0}', session.model.actors.find(actor => actor.instanceId === session.actorId).name);
      el('Local').textContent = t('将写入的局部位置（偏移前）：{0}, {1}', ...session.draft.localPosition());
      el('Offset').textContent = t('画布位置 = 局部位置 + 放置偏移（{0}, {1}）。', ...session.draft.offset);
    }
    view.setEditing(moving && valid && !pending && !unfinished);
  }
  function releaseImages() { for (const image of images.values()) { image.width = 0; image.height = 0; } images = new Map(); view.setImages(images); }
  function reset() {
    openEpoch++; formEpoch++;
    const old = session; session = null; pending = false; inputPending = false; proposal = null; approved = null; details = ''; diagnostics = [];
    try { old?.draft.dispose(); } catch { /* Local teardown still completes after a core failure. */ }
    view.setEditing(false); view.setMovableIds([]); view.setVisible(false); view.setScene(null); releaseImages();
    dialog.setAttribute('aria-busy', 'false'); dialog.dataset.dirty = 'false';
  }
  function close() {
    if (pending || dirty() && !window.confirm(t('丢弃本次实例布局修改？原文草稿不会改变。'))) return false;
    reset(); dialog.close(); return true;
  }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_override_conflict' ? '原文或预览已变化。布局修改保留，请重新预览后调整此实例。'
      : code === 'scene_composition_override_unchanged' ? '没有需要应用的布局修改。'
        : code === 'scene_composition_override_content_limit' ? '修改后的配方超过 128 KiB；布局修改保留，请缩减原文后重试。'
          : code === 'studio_core_unavailable' ? '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || unfinishedInput() || !session.draft.state().dirty) { refresh(); return; }
    approved = null; proposal = null; diagnostics = []; details = '';
    const owner = session, epoch = formEpoch, formSignature = signature();
    try { proposal = owner.draft.propose(); }
    catch (error) { report(error, '布局修改有误，请检查位置后重试。'); refresh(); return; }
    const candidate = proposal, owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === formSignature && proposal === candidate;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try {
      const result = await validateDraft(copy(candidate), { isCurrent: unchanged });
      if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('Recipe validation was not confirmed.'), { payload: result });
      approved = candidate; approvedSignature = formSignature; message = '实例布局已检查，请确认完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。布局修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || unfinishedInput() || !approved || approved !== proposal || approvedSignature !== signature()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, formSignature = signature();
    const owns = () => session === owner && dialog.open && !disposed;
    const isCurrent = () => owns() && current() && approved === candidate && formEpoch === epoch && signature() === formSignature;
    pending = true; message = '正在应用实例布局到原文草稿…'; refresh();
    try {
      const result = await applySourceDraft(copy(candidate), { isCurrent });
      if (!owns()) return;
      if (result?.applied !== true) throw new Error('The editor did not confirm applying the recipe layout.');
      // The accepted host update advances the source token; this exact operation
      // may finish after that change, with no second attempt to write the source.
      focusEpoch++; opener = null; reset(); dialog.close();
      await sourceApplied(result, candidate);
    } catch (error) { if (owns()) { approved = null; report(error, '实例布局未应用。修改保留，请检查后重试。'); } }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  function history(action) {
    if (!session || pending || !current()) return;
    try {
      if (unfinishedInput()) { if (action === 'undo') { inputPending = false; changed(); } }
      else if (session.draft[action]()) changed();
    } catch (error) { report(error, '布局修改未执行。请检查所选对象的位置是否超出范围。'); }
    refresh();
  }
  for (const suffix of ['X', 'Y']) {
    el(suffix).addEventListener('input', () => {
      if (pending || !current()) return;
      inputPending = true; formEpoch++; approved = null; proposal = null; message = '实例布局尚未应用到原文草稿。'; refresh();
    });
    el(suffix).addEventListener('change', () => {
      if (pending || !current()) return;
      const raw = [el('X').value.trim(), el('Y').value.trim()], position = raw.map(Number);
      if (raw.some(value => !value) || position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) {
        inputPending = true; approved = null; message = '请输入 -100000 到 100000 之间的有效坐标。'; refresh(); return;
      }
      try {
        const mutated = session.draft.setPosition(session.actorId, position); inputPending = false;
        if (mutated) changed(); else { approved = null; proposal = null; syncCoordinates(); }
      } catch (error) { inputPending = true; report(error, '布局修改未执行。请检查所选对象的位置是否超出范围。'); }
      refresh();
    });
  }
  el('Move').addEventListener('click', () => { if (!pending && current()) { moving = true; refresh(); } });
  el('Pan').addEventListener('click', () => { moving = false; refresh(); });
  el('Snap').addEventListener('change', () => { if (!pending && current()) view.setSnap(el('Snap').checked ? 32 : 0); });
  el('Grid').addEventListener('change', () => view.setGrid(el('Grid').checked));
  el('Fit').addEventListener('click', () => view.fit()); el('ZoomIn').addEventListener('click', () => view.zoom(1.25)); el('ZoomOut').addEventListener('click', () => view.zoom(.8));
  el('Undo').addEventListener('click', () => history('undo')); el('Redo').addEventListener('click', () => history('redo'));
  el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const focus = opener, epoch = focusEpoch; opener = null;
    if (session) reset();
    queueMicrotask(() => { if (!dialog.open && !disposed && epoch === focusEpoch) focus?.focus?.(); });
  });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); if (!pending) void (approved ? apply() : check()); }
    else if (key === 'z' || key === 'y') { event.preventDefault(); history(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
  });
  const unsubscribe = onLanguageChange(refresh);
  function destroy() { if (disposed) return; disposed = true; focusEpoch++; reset(); dialog.close(); view.destroy(); unsubscribe?.(); dialog.remove(); }
  return {
    refresh, close, destroy, dispose: destroy,
    async open({ model, source, images: sourceImages = new Map(), actorId, isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => {
        const c = getContext();
        return epoch === openEpoch && !disposed && !dialog.open && getStudioCoreMetadata().ready
          && c.compositionSourceWritable === true && c.canEditCompositionLayout === true && c.editable && !c.creating && !c.busy
          && c.sceneDraftToken === token && c.sceneDraftPath === source?.sourcePath && isCurrent();
      };
      if (!eligible()) return false;
      let candidate;
      try {
        const sourceModel = copy(model);
        candidate = await createSceneCompositionLayoutDraft(sourceModel, source, actorId, { digest });
        if (!eligible()) { candidate.dispose(); return false; }
        session = { draft: candidate, model: sourceModel, sourcePath: source.sourcePath, token, actorId, isCurrent };
        releaseImages();
        for (const [id, image] of sourceImages) {
          const cloned = document.createElement('canvas'); cloned.width = image.width; cloned.height = image.height;
          try { cloned.getContext('2d').drawImage(image, 0, 0); images.set(id, cloned); }
          catch { cloned.width = 0; cloned.height = 0; }
        }
        moving = true; inputPending = false; pending = false; proposal = null; approved = null; details = ''; diagnostics = []; formEpoch++;
        el('Snap').checked = false; el('Grid').checked = true; view.setSnap(0); view.setGrid(true); view.setMovableIds([actorId]);
        updateView(); view.setImages(images); message = '实例布局尚未应用到原文草稿。'; refresh();
        if (!eligible()) { reset(); return false; }
        opener = document.activeElement; focusEpoch++; dialog.showModal(); view.setVisible(true); view.fit(); el('Canvas').focus(); return true;
      } catch (error) {
        try { if (candidate !== session?.draft) candidate?.dispose(); } catch {}
        if (session?.draft === candidate) reset();
        if (epoch !== openEpoch || disposed || !isCurrent()) return false;
        report(error, '实例布局编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false;
      }
    },
  };
}
