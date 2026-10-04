import { sceneStructureActors } from '../../engine/scene-structure.mjs';
import { createSceneOutline } from './app-scene-outline.js';
import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import { getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { requestWorldCommand, readDocSource } from './app-doc-service.js';
import { fetchJsonApiRequest } from './app-services.js';
import { API_PATHS } from '../../scripts/lib/doc-api-contract.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { createSceneSourceLayoutDraft } from '../../engine/scene-source-layout.mjs';
import { createSceneLayoutDraft } from '../../engine/scene-layout.mjs';
import { createScenePreviewCanvas } from './app-scene-preview-canvas.js';

const alignments = ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom'];
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const sourceRevision = async value => `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;

export function setupSceneLayout({ getContext = () => ({}), setBusy = () => {}, applied = async () => {}, reload = () => {}, applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneLayoutDialog'; dialog.className = 'project-build scene-layout';
  dialog.setAttribute('aria-labelledby', 'sceneLayoutTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneLayoutTitle" data-i18n="编辑场景布局"></h2>
    <button id="sceneLayoutClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p id="sceneLayoutNote" class="build-note" data-i18n="拖动对象或输入中心坐标调整布局。修改先保留为草稿，预览确认后才保存到场景。"></p>
    <p id="sceneLayoutMessage" role="status" aria-live="polite"></p>
    <div class="scene-preview-toolbar"><button id="sceneLayoutMove" type="button" class="doc-btn" data-i18n="移动对象"></button>
      <button id="sceneLayoutPan" type="button" class="doc-btn doc-btn-ghost" data-i18n="平移视图"></button>
      <label class="scene-preview-grid"><input id="sceneLayoutSnap" type="checkbox"><span data-i18n="吸附到 32 像素网格"></span></label>
      <label class="scene-preview-grid"><input id="sceneLayoutGrid" type="checkbox" checked><span data-i18n="显示网格"></span></label>
      <button id="sceneLayoutUndo" type="button" class="doc-btn doc-btn-ghost" data-i18n="撤销布局修改"></button>
      <button id="sceneLayoutRedo" type="button" class="doc-btn doc-btn-ghost" data-i18n="重做布局修改"></button></div>
    <div class="scene-preview-toolbar"><button id="sceneLayoutFit" type="button" class="doc-btn doc-btn-ghost" data-i18n="适应画布"></button>
      <button id="sceneLayoutZoomOut" type="button" class="doc-btn doc-btn-ghost" data-i18n="缩小"></button><output id="sceneLayoutZoom"></output>
      <button id="sceneLayoutZoomIn" type="button" class="doc-btn doc-btn-ghost" data-i18n="放大"></button></div>
    <p id="sceneLayoutHelp" class="build-hint" data-i18n="拖动空白处或按住空格平移。选中对象后，方向键微调 1 像素，Shift + 方向键微调 10 像素。Esc 取消当前拖动。"></p>
    <p class="build-hint" data-i18n="按住 Shift 或 Ctrl / ⌘ 点击对象可多选，也可以勾选列表。拖动已选对象可整体移动；吸附以拖动的对象为基准，保持间距。"></p>
    <div class="scene-preview-layout"><canvas id="sceneLayoutCanvas" tabindex="0" aria-describedby="sceneLayoutHelp" data-i18n-aria-label="场景布局编辑画布"></canvas>
      <aside><h3 data-i18n="场景对象"></h3><div class="scene-layout-selection-actions">
          <button id="sceneLayoutSelectAll" type="button" class="doc-btn doc-btn-ghost" data-i18n="全选对象"></button>
          <button id="sceneLayoutClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清除选择"></button></div><label class="scene-field"><span data-i18n="搜索场景对象与分组"></span><input id="sceneLayoutSearch" type="search"></label><ol id="sceneLayoutObjects"></ol><p id="sceneLayoutSelection" role="status"></p>
        <div id="sceneLayoutCoordinates" class="scene-settings"><label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneLayoutX" type="number" min="-100000" max="100000" step="any"></label>
          <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneLayoutY" type="number" min="-100000" max="100000" step="any"></label></div>
        <fieldset class="scene-layout-align"><legend data-i18n="对齐所选对象"></legend>
          <button id="sceneLayoutAlignLeft" type="button" class="doc-btn doc-btn-ghost" data-i18n="左侧对齐"></button>
          <button id="sceneLayoutAlignCenter" type="button" class="doc-btn doc-btn-ghost" data-i18n="水平居中"></button>
          <button id="sceneLayoutAlignRight" type="button" class="doc-btn doc-btn-ghost" data-i18n="右侧对齐"></button>
          <button id="sceneLayoutAlignTop" type="button" class="doc-btn doc-btn-ghost" data-i18n="顶部对齐"></button>
          <button id="sceneLayoutAlignMiddle" type="button" class="doc-btn doc-btn-ghost" data-i18n="垂直居中"></button>
          <button id="sceneLayoutAlignBottom" type="button" class="doc-btn doc-btn-ghost" data-i18n="底部对齐"></button>
          <p class="build-hint" data-i18n="对齐以所选对象的整体边界为参照，按实际尺寸计算。整组操作可一步撤销。"></p></fieldset>
        <p class="build-hint" data-i18n="这里只修改场景中的位置；尺寸、图片、投影继承和其他属性保持原样。"></p></aside></div>
    <details id="sceneLayoutReview" hidden><summary id="sceneLayoutReviewTitle" data-i18n="将保存的场景"></summary><pre id="sceneLayoutSource" tabindex="0"></pre></details>
    <ul id="sceneLayoutDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneLayoutError" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneLayoutDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneLayoutCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="预览布局修改"></button>
      <button id="sceneLayoutSave" type="button" class="doc-btn" data-i18n="保存布局"></button>
      <button id="sceneLayoutVerify" type="button" class="doc-btn doc-btn-ghost" hidden data-i18n="核对保存结果"></button>
      <button id="sceneLayoutReload" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取已保存场景"></button>
      <button id="sceneLayoutCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`), copy = value => JSON.parse(JSON.stringify(value));
  let enabled = false, draft = null, model = null, selection = [], approved = null, operation = null;
  let inputPending = false, message = '', details = '', issues = [], opener = null, moving = true;
  let images = new Map(), sourceEnabled = false, sourceSession = null, sourceStatus = null, openEpoch = 0;
  const sourceCurrent = () => {
    const c = getContext();
    return Boolean(sourceSession && c.sceneDraftPath === sourceSession.sourcePath && c.sceneDraftToken === sourceSession.token && sourceSession.isCurrent());
  };
  const canWrite = () => {
    const c = getContext();
    return c.editable && !c.creating && !c.busy && (sourceSession
      ? sourceEnabled && c.sceneDraftWritable === true && sourceCurrent()
      : enabled && !c.dirty && c.canEditScene !== false);
  };
  const saveState = () => sourceSession ? { editable: !sourceStatus.pending && !sourceStatus.applied && !sourceStatus.conflict,
    reviewed: Boolean(approved), busy: sourceStatus.pending, saved: sourceStatus.applied } : draft?.saveState() || {};
  // Rust owns save phases. This owner only tracks host I/O so an unavailable
  // core cannot trap a finished operation behind a permanently busy dialog.
  const busy = () => Boolean(operation && saveState().busy);
  const locked = () => !saveState().editable || !canWrite() || !getStudioCoreMetadata().ready;
  const dirty = () => Boolean(!saveState().saved && (draft?.state().dirty || inputPending));
  const owns = owner => operation === owner && draft === owner.draft && dialog.open;
  const errorInfo = error => {
    const payload = error?.payload?.data || error?.payload || {}, value = payload.errorCode || error?.payload?.errorCode || error?.errorCode;
    return { payload, code: typeof value === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(value) ? value : null };
  };
  const view = createScenePreviewCanvas({ canvas: el('sceneLayoutCanvas'), onSelect(id, options) {
    selectObjects(options?.ids || (id ? [id] : []));
  }, onMove(id, position) {
    if (!draft || locked() || inputPending) return;
    selection = [id]; applyPositions([{ objectId: id, position }]);
  }, onMoveMany(changes) {
    if (!draft || locked() || inputPending) return;
    applyPositions(changes);
  }, onViewChange(value) { el('sceneLayoutZoom').textContent = `${Math.round(value.scale * 100)}%`; } });
  view.setMultiSelect(true);
  const outline = createSceneOutline({ root: el('sceneLayoutObjects'), search: el('sceneLayoutSearch'), multi: true,
    onActorSelect(id, event) {
      selectObjects(event.toggle || event.shiftKey || event.ctrlKey || event.metaKey
        ? selection.includes(id) ? selection.filter(value => value !== id) : [...selection, id] : [id]);
    },
    onGroupSelect(ids, event) {
      const toggle = event.toggle || event.shiftKey || event.ctrlKey || event.metaKey;
      selectObjects(toggle ? ids.every(id => selection.includes(id)) ? selection.filter(id => !ids.includes(id)) : [...selection, ...ids] : ids);
    },
  });
  function selectObjects(ids) {
    if (inputPending || busy()) {
      view.selectMany(selection);
      if (inputPending) message = '请输入 -100000 到 100000 之间的有效坐标。';
      update(); return;
    }
    const known = new Set(draft?.actors().map(sceneActorIdentity));
    selection = [...new Set(ids)].filter(id => known.has(id));
    view.selectMany(selection); syncCoordinates(); update();
  }
  function syncCoordinates() {
    const actor = selection.length === 1 && draft?.actors().find(item => sceneActorIdentity(item) === selection[0]);
    el('sceneLayoutX').value = actor ? String(actor.position[0]) : '';
    el('sceneLayoutY').value = actor ? String(actor.position[1]) : '';
  }
  function updateView() {
    if (!draft) { view.setScene(null); return; }
    view.setScene({ ...model, actors: draft.actors() }); view.selectMany(selection); syncCoordinates();
  }
  function applyPositions(changes) {
    try { if (draft.setPositions(changes)) changed(); else { updateView(); update(); } }
    catch (error) { positionError(error); }
  }
  function positionError(error) {
    message = error.errorCode === 'studio_core_unavailable'
      ? '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。'
      : '布局修改未执行。请检查所选对象的位置是否超出范围。';
    details = error.message || '';
    if (!inputPending) updateView();
    update();
  }
  function changed() {
    approved = null; message = sourceSession ? '布局修改尚未应用到文本草稿。' : '布局草稿已修改，尚未保存。'; details = ''; issues = [];
    updateView(); update();
  }
  function update() {
    if (sourceSession && !sourceStatus.pending && !sourceStatus.applied && !sourceCurrent()) {
      sourceStatus.conflict = true; approved = null;
      message = '文本草稿或场景已变化。布局修改保留，请核对后重新预览当前草稿。';
    }
    for (const [id, key] of [['sceneLayoutTitle', sourceSession ? '调整草稿布局' : '编辑场景布局'],
      ['sceneLayoutNote', sourceSession ? '布局修改将应用到当前文本草稿；确认后仍需在编辑器中保存。取消只丢弃本次布局调整。' : '拖动对象或输入中心坐标调整布局。修改先保留为草稿，预览确认后才保存到场景。'],
      ['sceneLayoutSave', sourceSession ? '应用到文本草稿' : '保存布局'],
      ['sceneLayoutReviewTitle', sourceSession ? '将应用到文本草稿的完整内容' : '将保存的场景']]) el(id).setAttribute('data-i18n', key);
    translatePage(dialog);
    const state = draft?.state() || {}, save = saveState(), isBusy = busy(), isLocked = locked();
    dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(isBusy));
    el('sceneLayoutMessage').textContent = t(message);
    el('sceneLayoutClose').disabled = isBusy; el('sceneLayoutCancel').disabled = isBusy;
    el('sceneLayoutCheck').disabled = isLocked || inputPending || !state.dirty;
    el('sceneLayoutSave').disabled = isLocked || inputPending || !save.reviewed || !approved;
    el('sceneLayoutVerify').hidden = !save.uncertain; el('sceneLayoutVerify').disabled = isBusy || !getStudioCoreMetadata().ready;
    el('sceneLayoutReload').hidden = Boolean(sourceSession); el('sceneLayoutReload').disabled = isBusy;
    el('sceneLayoutUndo').disabled = isLocked || !state.canUndo && !inputPending;
    el('sceneLayoutRedo').disabled = isLocked || !state.canRedo || inputPending;
    el('sceneLayoutCoordinates').hidden = selection.length !== 1;
    for (const id of ['sceneLayoutX', 'sceneLayoutY']) el(id).disabled = isLocked || selection.length !== 1;
    el('sceneLayoutMove').disabled = isLocked; el('sceneLayoutMove').setAttribute('aria-pressed', String(moving));
    el('sceneLayoutPan').setAttribute('aria-pressed', String(!moving)); el('sceneLayoutSnap').disabled = isLocked;
    view.setEditing(moving && !isLocked && !inputPending);
    const actor = selection.length === 1 && draft?.actors().find(item => sceneActorIdentity(item) === selection[0]);
    el('sceneLayoutSelection').textContent = selection.length > 1 ? t('已选择 {0} 个对象；拖动或对齐可同时调整。', selection.length)
      : actor ? t('已选择：{0}', actor.name) : t('从画布或对象列表选择角色。');
    for (const name of alignments) el(`sceneLayoutAlign${name}`).disabled = isLocked || inputPending || selection.length < 2;
    el('sceneLayoutSelectAll').disabled = isBusy || inputPending || !draft;
    el('sceneLayoutClearSelection').disabled = isBusy || inputPending || !selection.length;
    outline.setSelection(selection, { disabled: isBusy || inputPending });
    el('sceneLayoutReview').hidden = !approved;
    el('sceneLayoutSource').textContent = approved?.proposal?.afterContent || approved?.result?.changes?.[0]?.afterText || approved?.request?.content || '';
    el('sceneLayoutError').hidden = !details; el('sceneLayoutDetails').textContent = details;
    const list = el('sceneLayoutDiagnostics'); list.replaceChildren();
    for (const issue of issues) { const row = document.createElement('li'); row.textContent = `${issue.code || ''} ${issue.propertyPath || ''}`; list.append(row); }
  }
  function releaseImages() { for (const image of images.values()) { image.width = 0; image.height = 0; } images = new Map(); view.setImages(images); }
  function releaseDraft() {
    const previous = draft; draft = null;
    const abandoned = operation; operation = null;
    if (abandoned?.draft === previous && !sourceSession) setBusy(false);
    // A failed runtime cannot retain accessible drafts. Local teardown must
    // still finish so the user can return to the saved scene after a failure.
    try { previous?.dispose(); } catch {}
    outline.reset(); model = null; approved = null; sourceSession = null; sourceStatus = null; inputPending = false; selection = [];
    view.setVisible(false); view.setScene(null); releaseImages();
  }
  function close() {
    if (busy() || dirty() && !window.confirm(t(sourceSession ? '有尚未应用的布局修改，确定丢弃这些布局修改？文本草稿不会改变。' : '有未保存的布局修改，确定丢弃？'))) return false;
    releaseDraft(); update(); dialog.close(); return true;
  }
  function finishOperation(owner) {
    if (!owns(owner)) return;
    operation = null; setBusy(false); update();
    el(approved && saveState().reviewed ? 'sceneLayoutSave' : saveState().saved ? 'sceneLayoutClose' : 'sceneLayoutCheck').focus();
  }
  function beginOperation(action) {
    const current = draft, state = current.beginSave(action, { editable: canWrite(), inputPending });
    const owner = { draft: current, requestId: state.requestId };
    operation = owner; setBusy(true); return owner;
  }
  function saveFailure(error, owner, verifying = false) {
    if (!owns(owner)) return;
    approved = null;
    const { payload, code } = errorInfo(error);
    issues = Array.isArray(payload.diagnostics) ? payload.diagnostics : []; details = error.message || '';
    let state;
    try { state = owner.draft.resolveSave(owner.requestId, 'error', code); }
    catch (coreError) {
      message = '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。';
      details += `\n${coreError.message || ''}`; return;
    }
    message = state.conflict ? '场景或工程已变化。布局草稿保留，请核对后重新读取，避免覆盖外部修改。'
      : verifying ? '无法核对保存结果。请稍后重试，草稿继续保留。'
        : state.uncertain ? '保存结果尚未确认。草稿保留，请先核对保存结果，勿重复提交。' : '布局检查未完成。草稿保留，请查看诊断后重试。';
  }
  async function complete(owner, result) {
    approved = null; inputPending = false; message = '场景布局已保存，预览已更新。'; update();
    let failure;
    try { await applied(result); } catch (error) { failure = error; }
    if (!owns(owner)) return;
    try { owner.draft.finishSaveRefresh(owner.requestId); } catch (error) { failure ||= error; }
    if (failure) { message = '布局已保存，但预览刷新失败。请返回后刷新，勿重复保存。'; details = failure.message || ''; }
  }
  async function checkResult(result, request, mode, owner, reviewed) {
    const current = owner.draft;
    const invalid = () => { throw Object.assign(new Error('The scene update response does not match the reviewed layout.'), { errorCode: 'scene_layout_response_invalid' }); };
    const change = result?.changes?.[0], object = result?.object, ref = object?.documentRefs?.[0];
    if (!result || !Array.isArray(result.changes) || result.changes.length !== 1
      || !(mode === 'preview' ? result.status === 'preview' : ['applied', 'unchanged'].includes(result.status))
      || result.worldId !== request.worldId || result.baseRevision !== request.baseRevision || !revision(result.revision)
      || object?.id !== request.objectId || object.worldId !== request.worldId || !revision(object.revision)
      || change?.kind !== 'scene.update' || change.objectId !== request.objectId || change.sourcePath !== current.base.sourcePath
      || change.beforeSourceRevision !== request.sourceRevision || !revision(change.afterSourceRevision)
      || typeof change.afterText !== 'string' || !current.matches(change.afterText)
      || ref?.sourcePath !== change.sourcePath || ref.sourceRevision !== change.afterSourceRevision) invalid();
    const digest = await sourceRevision(change.afterText);
    if (!owns(owner)) return false;
    if (digest !== change.afterSourceRevision) invalid();
    if (mode === 'apply' && (!reviewed || result.revision !== reviewed.result.revision
      || object.revision !== reviewed.result.object.revision || change.afterText !== reviewed.result.changes[0].afterText)) invalid();
    return true;
  }
  async function runSource(mode) {
    if (!draft || !sourceSession || busy()) return;
    if (!sourceCurrent()) { sourceStatus.conflict = true; approved = null; message = '文本草稿或场景已变化。布局修改保留，请核对后重新预览当前草稿。'; update(); return; }
    if (locked() || inputPending || !draft.state().dirty || mode === 'apply' && !approved) return;
    const owner = { draft }; operation = owner; sourceStatus.pending = true;
    message = mode === 'apply' ? '正在应用布局到文本草稿…' : '正在检查布局修改…'; details = ''; issues = []; update();
    try {
      if (mode === 'preview') {
        const proposal = await owner.draft.propose();
        if (!owns(owner)) return;
        if (!sourceCurrent()) throw Object.assign(new Error('The source draft changed during layout review.'), { errorCode: 'scene_source_layout_conflict' });
        approved = { proposal }; message = '布局修改已检查，请确认完整内容后应用到文本草稿。'; el('sceneLayoutReview').open = true;
      } else {
        // The host rechecks source identity and bytes immediately before its
        // synchronous editor update. No world command or disk write is used.
        const result = await applySourceDraft(copy(approved.proposal), { isCurrent: () => owns(owner) && sourceCurrent() });
        if (!owns(owner)) return;
        if (result?.applied !== true) throw Object.assign(new Error('The source draft did not accept the layout.'), { errorCode: 'scene_source_layout_conflict' });
        sourceStatus.applied = true; sourceStatus.pending = false; operation = null;
        releaseDraft(); update(); dialog.close();
        try { await sourceApplied(); }
        catch { window.alert(t('布局已应用到文本草稿，但预览刷新失败。请重新预览当前草稿。')); }
        return;
      }
    } catch (error) {
      if (!owns(owner)) return;
      approved = null; details = error.message || '';
      const conflict = error.errorCode === 'scene_source_layout_conflict' || !sourceCurrent();
      sourceStatus.conflict = conflict;
      message = conflict ? '文本草稿或场景已变化。布局修改保留，请核对后重新预览当前草稿。'
        : error.errorCode === 'scene_source_layout_content_limit' ? '调整后的文本草稿超过 128 KiB。布局修改保留，请缩减原文后重试。'
        : '布局未应用到文本草稿。修改保留，请检查后重试。';
    } finally {
      if (owns(owner)) {
        sourceStatus.pending = false; operation = null; update(); el(approved ? 'sceneLayoutSave' : 'sceneLayoutCheck').focus();
      }
    }
  }
  async function run(mode) {
    if (sourceSession) return runSource(mode);
    if (!draft || locked() || inputPending || !draft.state().dirty || mode === 'apply' && !approved) return;
    let request, owner;
    const reviewed = approved;
    try {
      request = mode === 'apply' ? { ...copy(reviewed.request), mode } : draft.command('preview');
      owner = beginOperation(mode);
    } catch (error) {
      message = error.errorCode === 'studio_core_unavailable' ? '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。'
        : '布局检查未完成。草稿保留，请查看诊断后重试。'; details = error.message || ''; update(); return;
    }
    message = mode === 'apply' ? '正在保存场景布局…' : '正在检查布局修改…'; details = ''; issues = []; update();
    try {
      const result = await requestWorldCommand(request);
      if (!owns(owner)) return;
      const accepted = await checkResult(result, request, mode, owner, reviewed);
      if (!owns(owner) || !accepted) return;
      owner.draft.resolveSave(owner.requestId, 'accepted');
      if (mode === 'preview') { approved = { request, result }; message = '布局修改已检查，请确认后保存。'; }
      else await complete(owner, result);
    } catch (error) { saveFailure(error, owner); }
    finally { finishOperation(owner); }
  }
  async function verify() {
    if (!draft || busy() || !saveState().uncertain || !getStudioCoreMetadata().ready) return;
    let owner;
    try { owner = beginOperation('verify'); }
    catch (error) { message = '无法核对保存结果。请稍后重试，草稿继续保留。'; details = error.message || ''; update(); return; }
    message = '正在核对已保存场景…'; update();
    try {
      const base = owner.draft.base;
      const readCurrent = async () => {
        const { payload } = await fetchJsonApiRequest(WORLD_API_PATH, { cache: 'no-store' }, 45000, t('读取世界'));
        if (!owns(owner)) return null;
        const object = payload?.objects?.find(item => item.id === base.sceneId), ref = object?.documentRefs?.[0];
        if (payload?.world?.id !== base.worldId || !revision(payload.world.revision) || !object || object.worldId !== base.worldId || !revision(object.revision)
          || ref?.sourcePath !== base.sourcePath || !revision(ref.sourceRevision)) {
          throw Object.assign(new Error('The scene identity or registered source path has changed.'), { errorCode: 'world_revision_conflict' });
        }
        return { object, ref, world: payload.world };
      };
      const observed = await readCurrent();
      if (!owns(owner) || !observed) return;
      const result = await readDocSource({ docApiUrl: API_PATHS.DOC, pathValue: base.sourcePath, requestTimeoutMs: 45000, requestLabel: t('读取场景原文') });
      if (!owns(owner)) return;
      const digest = typeof result?.content === 'string' ? await sourceRevision(result.content) : null;
      if (!owns(owner)) return;
      if (digest !== observed.ref.sourceRevision) {
        throw Object.assign(new Error('Scene source changed while verifying the saved layout.'), { errorCode: 'world_read_conflict' });
      }
      // Recheck registration after the source read so a moved/replaced scene
      // cannot be acknowledged through bytes left at its previous location.
      const after = await readCurrent();
      if (!owns(owner) || !after) return;
      if (after.object.revision !== observed.object.revision || after.ref.sourceRevision !== observed.ref.sourceRevision) {
        throw Object.assign(new Error('Scene registration changed while verifying the saved layout.'), { errorCode: 'world_read_conflict' });
      }
      const accepted = owner.draft.matches(result.content);
      owner.draft.resolveSave(owner.requestId, accepted ? 'accepted' : 'different');
      if (accepted) await complete(owner, { status: 'applied', worldId: after.world.id, revision: after.world.revision,
        object: after.object, changes: [{ kind: 'scene.update', objectId: base.sceneId, sourcePath: base.sourcePath }] });
      else message = '当前保存内容与布局草稿不同。请核对后重新读取，草稿不会自动覆盖原文。';
    } catch (error) { saveFailure(error, owner, true); }
    finally { finishOperation(owner); }
  }
  function history(action) {
    if (!draft || locked()) return;
    if (inputPending) { if (action === 'undo') { inputPending = false; changed(); } return; }
    try { if (draft[action]()) changed(); }
    catch (error) { positionError(error); }
  }
  for (const id of ['sceneLayoutX', 'sceneLayoutY']) {
    el(id).addEventListener('input', () => {
      if (locked() || selection.length !== 1) return;
      inputPending = true; approved = null;
      try { if (!sourceSession) draft.invalidateSave(); update(); } catch (error) { positionError(error); }
    });
    el(id).addEventListener('change', () => {
      if (locked() || !draft || selection.length !== 1) return;
      const values = [el('sceneLayoutX').value, el('sceneLayoutY').value];
      if (values.some(value => !value.trim() || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 100000)) {
        inputPending = true; message = '请输入 -100000 到 100000 之间的有效坐标。'; approved = null; update(); return;
      }
      inputPending = false;
      try { if (draft.setPosition(selection[0], values.map(Number))) changed(); else { syncCoordinates(); update(); } }
      catch (error) { inputPending = true; positionError(error); }
    });
  }
  el('sceneLayoutSelectAll').addEventListener('click', () => selectObjects(draft?.actors().map(sceneActorIdentity) || []));
  el('sceneLayoutClearSelection').addEventListener('click', () => selectObjects([]));
  for (const name of alignments) el(`sceneLayoutAlign${name}`).addEventListener('click', () => {
    if (!draft || locked() || inputPending || selection.length < 2) return;
    try { if (draft.align(selection, name.toLowerCase())) changed(); }
    catch (error) { positionError(error); }
  });
  el('sceneLayoutMove').addEventListener('click', () => { moving = true; update(); });
  el('sceneLayoutPan').addEventListener('click', () => { moving = false; update(); });
  el('sceneLayoutSnap').addEventListener('change', () => view.setSnap(el('sceneLayoutSnap').checked ? 32 : 0));
  el('sceneLayoutGrid').addEventListener('change', () => view.setGrid(el('sceneLayoutGrid').checked));
  el('sceneLayoutUndo').addEventListener('click', () => history('undo')); el('sceneLayoutRedo').addEventListener('click', () => history('redo'));
  el('sceneLayoutFit').addEventListener('click', () => view.fit()); el('sceneLayoutZoomIn').addEventListener('click', () => view.zoom(1.25)); el('sceneLayoutZoomOut').addEventListener('click', () => view.zoom(.8));
  el('sceneLayoutCheck').addEventListener('click', () => void run('preview')); el('sceneLayoutSave').addEventListener('click', () => void run('apply'));
  el('sceneLayoutVerify').addEventListener('click', () => void verify());
  el('sceneLayoutClose').addEventListener('click', close); el('sceneLayoutCancel').addEventListener('click', close);
  el('sceneLayoutReload').addEventListener('click', () => { if (!sourceSession && close()) reload(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) { releaseDraft(); update(); opener?.focus(); } });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); void run(approved && saveState().reviewed ? 'apply' : 'preview'); }
    else if (key === 'z' || key === 'y') { event.preventDefault(); history(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
  });
  onLanguageChange(() => { if (dialog.open) { update(); outline.refresh(); } });
  function present(candidate, source, sourceImages) {
    opener = document.activeElement; draft = candidate; model = copy(source); selection = [sceneActorIdentity(draft.actors()[0])].filter(Boolean);
    approved = null; inputPending = false; details = ''; issues = []; moving = true;
    message = sourceSession ? '正在调整文本草稿的布局；应用前不会修改文本草稿。' : '正在编辑布局草稿，保存前不会修改场景。'; releaseImages();
    for (const [id, image] of sourceImages) {
      const cloned = document.createElement('canvas'); cloned.width = image.width; cloned.height = image.height;
      try { cloned.getContext('2d').drawImage(image, 0, 0); images.set(id, cloned); }
      catch { cloned.width = 0; cloned.height = 0; }
    }
    outline.setModel({ groups: model.sceneStructure?.groups || [], actors: sceneStructureActors(model.sceneStructure, draft.actors()) });
    el('sceneLayoutSnap').checked = false; el('sceneLayoutGrid').checked = true; view.setSnap(0); view.setGrid(true);
    updateView(); view.setImages(images); update();
  }
  function openFailure(error) {
    releaseDraft(); if (dialog.open) dialog.close();
    message = '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。';
    details = error.message || ''; update(); window.alert(t(message)); return false;
  }
  return {
    setAvailable(value) { enabled = value === true; if (dialog.open) update(); },
    setSourceAvailable(value) { sourceEnabled = value === true; if (dialog.open) update(); },
    open({ model: source, images: sourceImages = new Map() }) {
      if (dialog.open) return false;
      openEpoch++;
      if (draft) releaseDraft();
      if (!canWrite()) return false;
      if (!getStudioCoreMetadata().ready) {
        window.alert(t('布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。'));
        return false;
      }
      try {
        const candidate = createSceneLayoutDraft(source); if (!candidate) return false;
        present(candidate, source, sourceImages); dialog.showModal(); view.setVisible(true); view.fit(); return true;
      } catch (error) { return openFailure(error); }
    },
    async openSource({ model: sourceModel, images: sourceImages = new Map(), source, isCurrent = () => false }) {
      if (dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const current = () => {
        const c = getContext();
        return epoch === openEpoch && !dialog.open && sourceEnabled && c.editable && c.sceneDraftWritable === true
          && !c.creating && !c.busy && c.sceneDraftPath === source?.sourcePath && c.sceneDraftToken === token && isCurrent();
      };
      if (!current()) return false;
      if (draft) releaseDraft();
      let candidate;
      try {
        candidate = await createSceneSourceLayoutDraft(sourceModel, source, { digest: async content => (await sourceRevision(content)).slice(7) });
        if (!current()) { candidate.dispose(); return false; }
        sourceSession = { sourcePath: source.sourcePath, token, isCurrent }; sourceStatus = { pending: false, applied: false, conflict: false };
        present(candidate, sourceModel, sourceImages);
        if (!current()) { releaseDraft(); return false; }
        dialog.showModal(); view.setVisible(true); view.fit(); return true;
      } catch (error) {
        try { if (candidate !== draft) candidate?.dispose(); } catch {}
        if (!current()) { if (candidate === draft) releaseDraft(); return false; }
        if (error.errorCode?.startsWith('scene_source_layout_')) {
          releaseDraft(); window.alert(t('当前文本草稿与预览不一致，请重新预览当前草稿后调整布局。')); return false;
        }
        return openFailure(error);
      }
    },
  };
}
