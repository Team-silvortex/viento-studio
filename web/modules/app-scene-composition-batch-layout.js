import { createSceneCompositionBatchLayoutDraft } from '../../engine/scene-composition-batch-layout.mjs';
import { getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { sceneStructureActors } from '../../engine/scene-structure.mjs';
import { createScenePreviewCanvas } from './app-scene-preview-canvas.js';
import { createSceneOutline } from './app-scene-outline.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value));
const alignments = ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom'];

// Selection belongs to this view. Rust owns atomic position history and the
// reviewed recipe patch; the parent owns source-session guards and normal save.
export function setupSceneCompositionBatchLayout({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionBatchLayoutDialog'; dialog.className = 'project-build scene-layout scene-composition-batch-layout';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionBatchLayoutTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionBatchLayoutTitle" data-i18n="调整配方布局"></h2>
    <button id="sceneCompositionBatchLayoutClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="多选配方实例，整体移动或对齐。检查后整批应用到原文草稿，仍需在编辑器保存。"></p>
    <p id="sceneCompositionBatchLayoutMessage" role="status" aria-live="polite"></p>
    <div class="scene-preview-toolbar"><button id="sceneCompositionBatchLayoutMove" type="button" class="doc-btn" data-i18n="移动对象"></button>
      <button id="sceneCompositionBatchLayoutPan" type="button" class="doc-btn doc-btn-ghost" data-i18n="平移视图"></button>
      <label class="scene-preview-grid"><input id="sceneCompositionBatchLayoutSnap" type="checkbox"><span data-i18n="吸附到 32 像素网格"></span></label>
      <label class="scene-preview-grid"><input id="sceneCompositionBatchLayoutGrid" type="checkbox" checked><span data-i18n="显示网格"></span></label>
      <button id="sceneCompositionBatchLayoutUndo" type="button" class="doc-btn doc-btn-ghost" data-i18n="撤销布局修改"></button>
      <button id="sceneCompositionBatchLayoutRedo" type="button" class="doc-btn doc-btn-ghost" data-i18n="重做布局修改"></button></div>
    <div class="scene-preview-toolbar"><button id="sceneCompositionBatchLayoutFit" type="button" class="doc-btn doc-btn-ghost" data-i18n="适应画布"></button>
      <button id="sceneCompositionBatchLayoutZoomOut" type="button" class="doc-btn doc-btn-ghost" data-i18n="缩小"></button><output id="sceneCompositionBatchLayoutZoom"></output>
      <button id="sceneCompositionBatchLayoutZoomIn" type="button" class="doc-btn doc-btn-ghost" data-i18n="放大"></button></div>
    <p id="sceneCompositionBatchLayoutHelp" class="build-hint" data-i18n="按住 Shift 或 Ctrl / ⌘ 点击对象可多选，也可以勾选列表。拖动已选对象可整体移动；吸附以拖动的对象为基准，保持间距。"></p>
    <p class="build-hint" data-i18n="拖动空白处或按住空格平移。选中对象后，方向键微调 1 像素，Shift + 方向键微调 10 像素。Esc 取消当前拖动。"></p>
    <div class="scene-preview-layout"><canvas id="sceneCompositionBatchLayoutCanvas" tabindex="0" aria-describedby="sceneCompositionBatchLayoutHelp" data-i18n-aria-label="配方实例的批次位置草稿"></canvas>
      <aside><h3 data-i18n="场景对象"></h3><div class="scene-layout-selection-actions">
        <button id="sceneCompositionBatchLayoutSelectAll" type="button" class="doc-btn doc-btn-ghost" data-i18n="全选对象"></button>
        <button id="sceneCompositionBatchLayoutClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清除选择"></button></div>
        <label class="scene-field"><span data-i18n="搜索场景对象与分组"></span><input id="sceneCompositionBatchLayoutSearch" type="search"></label>
        <ol id="sceneCompositionBatchLayoutObjects"></ol><p id="sceneCompositionBatchLayoutSelection" role="status"></p>
        <div id="sceneCompositionBatchLayoutCoordinates" class="scene-settings"><label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneCompositionBatchLayoutX" type="number" min="-100000" max="100000" step="any"></label>
          <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneCompositionBatchLayoutY" type="number" min="-100000" max="100000" step="any"></label></div>
        <fieldset class="scene-layout-align"><legend data-i18n="对齐所选对象"></legend>
          <button id="sceneCompositionBatchLayoutAlignLeft" type="button" class="doc-btn doc-btn-ghost" data-i18n="左侧对齐"></button>
          <button id="sceneCompositionBatchLayoutAlignCenter" type="button" class="doc-btn doc-btn-ghost" data-i18n="水平居中"></button>
          <button id="sceneCompositionBatchLayoutAlignRight" type="button" class="doc-btn doc-btn-ghost" data-i18n="右侧对齐"></button>
          <button id="sceneCompositionBatchLayoutAlignTop" type="button" class="doc-btn doc-btn-ghost" data-i18n="顶部对齐"></button>
          <button id="sceneCompositionBatchLayoutAlignMiddle" type="button" class="doc-btn doc-btn-ghost" data-i18n="垂直居中"></button>
          <button id="sceneCompositionBatchLayoutAlignBottom" type="button" class="doc-btn doc-btn-ghost" data-i18n="底部对齐"></button>
          <p class="build-hint" data-i18n="对齐以所选对象的整体边界为参照，按实际尺寸计算。整组操作可一步撤销。"></p></fieldset>
        <p class="build-hint" data-i18n="画布坐标会按各自的放置偏移换算为局部位置覆盖。任一实例越界时，整批修改都不会执行。"></p></aside></div>
    <details id="sceneCompositionBatchLayoutReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary>
      <h3 data-i18n="本次位置修改"></h3><ul id="sceneCompositionBatchLayoutTargets" class="scene-composition-batch-targets"></ul><pre id="sceneCompositionBatchLayoutSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionBatchLayoutDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionBatchLayoutError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionBatchLayoutDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionBatchLayoutCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查布局修改"></button>
      <button id="sceneCompositionBatchLayoutApply" type="button" class="doc-btn" data-i18n="整批应用到原文草稿"></button>
      <button id="sceneCompositionBatchLayoutCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionBatchLayout${suffix}`);
  let session = null, selection = [], openEpoch = 0, formEpoch = 0, disposed = false, opener = null, focusEpoch = 0;
  let pending = false, moving = true, inputPending = false, proposal = null, approved = null, approvedSignature = '';
  let message = '', details = '', diagnostics = [], images = new Map();
  const current = () => {
    const c = getContext();
    return Boolean(session && !disposed && getStudioCoreMetadata().ready && c.compositionSourceWritable === true
      && c.canEditCompositionBatchLayout === true && c.editable && !c.creating && !c.busy
      && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent());
  };
  const signature = () => JSON.stringify([selection, el('X').value, el('Y').value]);
  const unfinishedInput = () => {
    if (!session || selection.length !== 1) return inputPending;
    const position = session.draft.currentPosition(selection[0]);
    return inputPending || ['X', 'Y'].some((suffix, axis) => !el(suffix).value.trim() || Number(el(suffix).value) !== position[axis]);
  };
  const dirty = () => Boolean(session && (unfinishedInput() || session.draft.state().dirty));
  const view = createScenePreviewCanvas({ canvas: el('Canvas'), onSelect(id, options) { selectObjects(options?.ids || (id ? [id] : [])); },
    onMove(id, position) { if (selection.length === 1 && selection[0] === id) applyPositions([{ objectId: id, position }]); },
    onMoveMany(changes) {
      if (!Array.isArray(changes) || selection.length < 2 || changes.length !== selection.length
        || new Set(changes.map(change => change.objectId)).size !== selection.length || changes.some(change => !selection.includes(change.objectId))) return;
      applyPositions(changes);
    }, onViewChange(value) { el('Zoom').textContent = `${Math.round(value.scale * 100)}%`; } });
  view.setMultiSelect(true); view.setMovableIds([]);
  const outline = createSceneOutline({ root: el('Objects'), search: el('Search'), multi: true,
    onActorSelect(id, event) {
      selectObjects(event.toggle || event.shiftKey || event.ctrlKey || event.metaKey
        ? selection.includes(id) ? selection.filter(value => value !== id) : [...selection, id] : [id]);
    },
    onGroupSelect(ids, event) {
      selectObjects(event.toggle || event.shiftKey || event.ctrlKey || event.metaKey
        ? ids.every(id => selection.includes(id)) ? selection.filter(id => !ids.includes(id)) : [...selection, ...ids] : ids);
    },
  });
  function syncCoordinates() {
    const position = selection.length === 1 && session?.draft.currentPosition(selection[0]);
    el('X').value = position ? String(position[0]) : ''; el('Y').value = position ? String(position[1]) : '';
  }
  function selectObjects(ids) {
    if (!session || pending || !current() || unfinishedInput()) { view.selectMany(selection); refresh(); return; }
    const known = new Set(session.model.actors.map(actor => actor.instanceId));
    selection = [...new Set(ids)].filter(id => known.has(id));
    view.selectMany(selection); syncCoordinates();
    // A deliberate selection change is view state only. Keep the reviewed
    // geometry, while refreshing the signature for the newly displayed fields.
    if (approved) approvedSignature = signature();
    refresh();
  }
  function updateView() {
    if (!session) { view.setScene(null); return; }
    const actors = session.draft.actors();
    view.setScene({ ...session.model, actors }); view.selectMany(selection);
    outline.setModel({ groups: session.model.sceneStructure?.groups || [], actors: sceneStructureActors(session.model.sceneStructure, actors) });
    if (!inputPending) syncCoordinates();
  }
  function changed() {
    formEpoch++; approved = null; proposal = null; details = ''; diagnostics = [];
    message = '配方布局尚未应用到原文草稿。'; updateView();
  }
  function applyPositions(changes) {
    if (!session || pending || !current() || unfinishedInput()) return;
    try { if (session.draft.setPositions(changes)) changed(); else updateView(); }
    catch (error) { report(error, '整批布局修改未执行。请检查所选实例的局部位置和画布位置是否超出范围。'); updateView(); }
    refresh();
  }
  function refresh() {
    translatePage(dialog);
    const valid = current(), state = session?.draft.state() || {}, unfinished = unfinishedInput();
    if (approved && approvedSignature !== signature()) approved = null;
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化。批次布局修改保留，请重新预览当前配方。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty());
    for (const suffix of ['X', 'Y']) el(suffix).disabled = pending || !valid || selection.length !== 1;
    for (const suffix of ['Move', 'Snap']) el(suffix).disabled = pending || !valid;
    el('Move').setAttribute('aria-pressed', String(moving)); el('Pan').setAttribute('aria-pressed', String(!moving));
    el('Undo').disabled = pending || !valid || !state.canUndo && !unfinished;
    el('Redo').disabled = pending || !valid || unfinished || !state.canRedo;
    el('Check').disabled = pending || !valid || unfinished || !state.dirty;
    el('Apply').disabled = pending || !valid || unfinished || !approved;
    el('Close').disabled = pending; el('Cancel').disabled = pending;
    el('Search').disabled = pending;
    el('SelectAll').disabled = pending || !valid || unfinished;
    el('ClearSelection').disabled = pending || !valid || unfinished || !selection.length;
    for (const suffix of alignments) el(`Align${suffix}`).disabled = pending || !valid || unfinished || selection.length < 2;
    el('Coordinates').hidden = selection.length !== 1;
    const actor = selection.length === 1 && session?.model.actors.find(item => item.instanceId === selection[0]);
    el('Selection').textContent = selection.length > 1 ? t('已选择 {0} 个对象；拖动或对齐可同时调整。', selection.length)
      : actor ? t('已选择：{0}', actor.name) : t('从画布或对象列表选择角色。');
    outline.setSelection(selection, { disabled: pending || !valid || unfinished });
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Targets').replaceChildren();
    for (const change of proposal?.changes || []) {
      const row = document.createElement('li'), name = session?.model.actors.find(item => item.instanceId === change.instanceId)?.name || change.instanceId;
      row.textContent = t('{0} · 实例 {1} · 放置 {2} / {3} · 局部位置 {4}, {5}', name, change.instanceId, change.placementId, change.actorKey, ...change.position);
      row.dataset.instanceId = change.instanceId; el('Targets').append(row);
    }
    el('Error').hidden = !details; el('Details').textContent = details;
    el('Diagnostics').replaceChildren();
    for (const issue of diagnostics) { const row = document.createElement('li'); row.textContent = `${issue.code || ''} ${issue.propertyPath || ''}`; el('Diagnostics').append(row); }
    view.setEditing(moving && valid && !pending && !unfinished);
  }
  function releaseImages() { for (const image of images.values()) { image.width = 0; image.height = 0; } images = new Map(); view.setImages(images); }
  function reset() {
    openEpoch++; formEpoch++;
    const old = session; session = null; selection = []; pending = false; inputPending = false; proposal = null; approved = null; details = ''; diagnostics = [];
    try { old?.draft.dispose(); } catch { /* Local teardown still completes after a core failure. */ }
    view.setEditing(false); view.setMovableIds([]); view.setVisible(false); view.setScene(null); releaseImages(); outline.reset(); syncCoordinates();
    dialog.setAttribute('aria-busy', 'false'); dialog.dataset.dirty = 'false';
  }
  function close() {
    if (pending || dirty() && !window.confirm(t('丢弃本次配方布局修改？原文草稿不会改变。'))) return false;
    reset(); dialog.close(); return true;
  }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_override_conflict' ? '原文或预览已变化。批次布局修改保留，请重新预览当前配方。'
      : code === 'scene_composition_override_unchanged' ? '没有需要应用的布局修改。'
        : code === 'scene_composition_override_content_limit' ? '修改后的配方超过 128 KiB；批次布局修改保留，请缩减原文后重试。'
          : code === 'studio_core_unavailable' ? '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || unfinishedInput() || !session.draft.state().dirty) { refresh(); return; }
    approved = null; proposal = null; diagnostics = []; details = '';
    const owner = session, epoch = formEpoch, formSignature = signature();
    try { proposal = owner.draft.propose(); }
    catch (error) { report(error, '整批布局修改有误，请检查位置后重试。'); refresh(); return; }
    const candidate = proposal, owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === formSignature && proposal === candidate;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try {
      const result = await validateDraft(copy(candidate), { isCurrent: unchanged });
      if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('Recipe batch validation was not confirmed.'), { payload: result });
      approved = candidate; approvedSignature = formSignature; message = '配方布局已检查，请确认修改目标与完整原文后整批应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。批次布局修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || unfinishedInput() || !approved || approved !== proposal || approvedSignature !== signature()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, formSignature = signature();
    const owns = () => session === owner && dialog.open && !disposed;
    const isCurrent = () => owns() && current() && approved === candidate && formEpoch === epoch && signature() === formSignature;
    pending = true; message = '正在整批应用配方布局到原文草稿…'; refresh();
    try {
      const result = await applySourceDraft(copy(candidate), { isCurrent });
      if (!owns()) return;
      if (result?.applied !== true) throw new Error('The editor did not confirm applying the recipe batch layout.');
      // An accepted parent write advances the source token. Finish only this
      // operation, without reusing the old source guard for another write.
      focusEpoch++; opener = null; reset(); dialog.close();
      await sourceApplied(result, candidate);
    } catch (error) { if (owns()) { approved = null; report(error, '配方布局未应用。批次修改保留，请检查后重试。'); } }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  function history(action) {
    if (!session || pending || !current()) return;
    try {
      if (unfinishedInput()) { if (action === 'undo') { inputPending = false; changed(); } }
      else if (session.draft[action]()) changed();
    } catch (error) { report(error, '整批布局修改未执行。请检查所选实例的局部位置和画布位置是否超出范围。'); }
    refresh();
  }
  for (const suffix of ['X', 'Y']) {
    el(suffix).addEventListener('input', () => {
      if (pending || !current() || selection.length !== 1) return;
      inputPending = true; formEpoch++; approved = null; proposal = null; message = '配方布局尚未应用到原文草稿。'; refresh();
    });
    el(suffix).addEventListener('change', () => {
      if (pending || !current() || selection.length !== 1) return;
      const raw = [el('X').value.trim(), el('Y').value.trim()], position = raw.map(Number);
      if (raw.some(value => !value) || position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) {
        inputPending = true; approved = null; message = '请输入 -100000 到 100000 之间的有效坐标。'; refresh(); return;
      }
      try {
        const mutated = session.draft.setPosition(selection[0], position); inputPending = false;
        if (mutated) changed(); else { approved = null; proposal = null; syncCoordinates(); }
      } catch (error) { inputPending = true; report(error, '整批布局修改未执行。请检查所选实例的局部位置和画布位置是否超出范围。'); }
      refresh();
    });
  }
  el('SelectAll').addEventListener('click', () => selectObjects(session?.model.actors.map(actor => actor.instanceId) || []));
  el('ClearSelection').addEventListener('click', () => selectObjects([]));
  for (const suffix of alignments) el(`Align${suffix}`).addEventListener('click', () => {
    if (!session || pending || !current() || unfinishedInput() || selection.length < 2) return;
    try { if (session.draft.align([...selection], suffix.toLowerCase())) changed(); else updateView(); }
    catch (error) { report(error, '整批布局修改未执行。请检查所选实例的局部位置和画布位置是否超出范围。'); updateView(); }
    refresh();
  });
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
  const unsubscribe = onLanguageChange(() => { refresh(); outline.refresh(); });
  function destroy() { if (disposed) return; disposed = true; focusEpoch++; reset(); dialog.close(); view.destroy(); unsubscribe?.(); dialog.remove(); }
  return {
    refresh, close, destroy, dispose: destroy,
    async open({ model, source, images: sourceImages = new Map(), actorId, isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => {
        const c = getContext();
        return epoch === openEpoch && !disposed && !dialog.open && getStudioCoreMetadata().ready
          && c.compositionSourceWritable === true && c.canEditCompositionBatchLayout === true && c.editable && !c.creating && !c.busy
          && c.sceneDraftToken === token && c.sceneDraftPath === source?.sourcePath && isCurrent();
      };
      if (!eligible()) return false;
      let candidate;
      try {
        const sourceModel = copy(model);
        candidate = await createSceneCompositionBatchLayoutDraft(sourceModel, source, { digest });
        if (!eligible()) { candidate.dispose(); return false; }
        session = { draft: candidate, model: sourceModel, sourcePath: source.sourcePath, token, isCurrent };
        selection = [sourceModel.actors.find(actor => actor.instanceId === actorId)?.instanceId || sourceModel.actors[0].instanceId];
        releaseImages();
        for (const [id, image] of sourceImages) {
          const cloned = document.createElement('canvas'); cloned.width = image.width; cloned.height = image.height;
          try { cloned.getContext('2d').drawImage(image, 0, 0); images.set(id, cloned); }
          catch { cloned.width = 0; cloned.height = 0; }
        }
        moving = true; inputPending = false; pending = false; proposal = null; approved = null; details = ''; diagnostics = []; formEpoch++;
        outline.reset(); el('Snap').checked = false; el('Grid').checked = true; view.setSnap(0); view.setGrid(true);
        view.setMovableIds(sourceModel.actors.map(actor => actor.instanceId));
        updateView(); view.setImages(images); message = '配方布局尚未应用到原文草稿。'; refresh();
        if (!eligible()) { reset(); return false; }
        opener = document.activeElement; focusEpoch++; dialog.showModal(); view.setVisible(true); view.fit(); el('Canvas').focus(); return true;
      } catch (error) {
        if (candidate && session?.draft !== candidate) { try { candidate.dispose(); } catch { /* Preserve the original open error. */ } }
        if (session?.draft === candidate) reset();
        if (epoch !== openEpoch || disposed || !isCurrent()) return false;
        report(error, '配方批次布局编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false;
      }
    },
  };
}
