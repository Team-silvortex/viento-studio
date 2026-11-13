import { inspectSceneCamera2DDocument } from '../../engine/scene-camera2d.mjs';
import { editSceneCamera2DSource } from '../../engine/scene-camera2d-edit.mjs';
import { setupSceneCamera2DComposer } from './app-scene-camera2d-composer.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This view owns a form and an explicit save ticket. Membership, revisions,
// transaction recovery and engine realization remain independent host ports.
export function setupSceneCamera2D({ getContext = () => ({}), inspect = async () => null,
  request = async () => null, command = async () => null, applied = async () => {}, setBusy = () => {} } = {}) {
  if (!document.getElementById('sceneCamera2DStyle')) {
    const style = document.createElement('link'); style.id = 'sceneCamera2DStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-camera2d.css';
    (document.head || document.body).append(style);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCamera2DDialog'; dialog.className = 'scene-camera2d';
  dialog.setAttribute('aria-labelledby', 'sceneCamera2DTitle'); dialog.setAttribute('data-viento-close-guard', 'true');
  dialog.innerHTML = `<header><h2 id="sceneCamera2DTitle" data-i18n="运行主相机"></h2><button id="sceneCamera2DClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回构建"></button></header>
    <main><p data-i18n="相机只改变运行取景，不移动场景对象，也不使用编辑画布的缩放和平移。当前支持 Godot 项目组装。"></p>
    <p id="sceneCamera2DSource"></p><button id="sceneCamera2DRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <fieldset id="sceneCamera2DFields" disabled><legend data-i18n="运行主相机"></legend>
      <section id="sceneCamera2DLocation"><label><span data-i18n="文档类型"></span><select id="sceneCamera2DType"></select></label>
      <label><span data-i18n="原文路径"></span><input id="sceneCamera2DPath" spellcheck="false" maxlength="1024"></label></section>
      <label><span data-i18n="取景方式"></span><select id="sceneCamera2DMode"><option value="fixed" data-i18n="固定中心"></option><option value="follow" data-i18n="跟随实例"></option></select></label>
      <label id="sceneCamera2DTargetField"><span data-i18n="跟随目标实例"></span><select id="sceneCamera2DTarget"></select></label>
      <p id="sceneCamera2DPositionLabel"></p><section class="camera-grid">
        <label><span>X</span><input id="sceneCamera2DX" inputmode="decimal" maxlength="32"></label>
        <label><span>Y</span><input id="sceneCamera2DY" inputmode="decimal" maxlength="32"></label></section>
      <label><span data-i18n="运行相机缩放"></span><input id="sceneCamera2DZoom" inputmode="decimal" maxlength="32"></label>
      <p data-i18n="中心或偏移范围 ±100000；缩放 0.125–8，数值越大看到的世界范围越小。跟随使用实例逻辑位置，不包含动画视觉偏移。"></p>
      <label class="camera-limits-toggle"><input id="sceneCamera2DLimits" type="checkbox"><span data-i18n="启用世界边界"></span></label>
      <section id="sceneCamera2DLimitsFields" class="camera-grid" hidden>
        <label><span data-i18n="左边界"></span><input id="sceneCamera2DLimitLeft" inputmode="decimal" maxlength="32"></label>
        <label><span data-i18n="上边界"></span><input id="sceneCamera2DLimitTop" inputmode="decimal" maxlength="32"></label>
        <label><span data-i18n="右边界"></span><input id="sceneCamera2DLimitRight" inputmode="decimal" maxlength="32"></label>
        <label><span data-i18n="下边界"></span><input id="sceneCamera2DLimitBottom" inputmode="decimal" maxlength="32"></label>
        <p class="camera-limits-help" data-i18n="世界边界限制可见画面，不移动场景对象。可见区域大于边界时按该轴居中。"></p>
      </section>
    </fieldset>
    <section id="sceneCamera2DCompose" class="camera-composer"></section>
    <section id="sceneCamera2DReview" hidden><h3 data-i18n="相机修改审阅"></h3><p id="sceneCamera2DRelation"></p><pre id="sceneCamera2DText" tabindex="0"></pre></section></main>
    <p id="sceneCamera2DStatus" role="status" aria-live="polite"></p>
    <footer><button id="sceneCamera2DCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅相机设置"></button>
      <button id="sceneCamera2DSave" type="button" class="doc-btn" data-i18n="保存相机设置"></button>
      <button id="sceneCamera2DCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneCamera2D' + suffix);
  const fields = ['Type', 'Path', 'Mode', 'Target', 'X', 'Y', 'Zoom', 'Limits', 'LimitLeft', 'LimitTop', 'LimitRight', 'LimitBottom'];
  let enabled = false, owner = null, epoch = 0, catalog = null, ticket = null, phase = '', blocked = false, disposed = false;
  let baseline = '', message = '', pending = null, objectId = '', hostBusy = false, recoverDraft = false;
  let composer = { setData() {}, cancel() {}, dispose() {} };
  const values = () => fields.map(name => name === 'Limits' ? el(name).checked : el(name).value);
  const signature = () => JSON.stringify(fields.map(name => name === 'Limits' ? el(name).checked
    : name.startsWith('Limit') && !el('Limits').checked ? '' : el(name).value));
  const eligible = () => { const c = getContext(); return enabled && !disposed && c.visible && c.editable && !c.busy && !c.dirty && !c.creating && typeof c.session === 'string' && c.sceneId; };
  const owns = () => { const c = getContext(); return dialog.open && eligible() && owner && owner.sceneId === c.sceneId && owner.session === c.session && owner.token === c.sourceToken; };
  const dirty = () => Boolean(pending || catalog && signature() !== baseline);
  const busy = value => { if (hostBusy !== value) { hostBusy = value; setBusy(value); } };
  const approved = () => ticket && ticket.signature === signature() && ticket.catalog === catalog;
  function render() {
    translatePage(dialog); dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    const locked = !owns() || !catalog || Boolean(phase) || blocked;
    el('Fields').disabled = locked; fields.forEach(name => { el(name).disabled = locked; });
    el('Location').hidden = Boolean(catalog?.manifest); el('TargetField').hidden = el('Mode').value !== 'follow';
    el('LimitsFields').hidden = !el('Limits').checked; for (const name of ['LimitLeft', 'LimitTop', 'LimitRight', 'LimitBottom']) el(name).disabled = locked || !el('Limits').checked;
    el('PositionLabel').textContent = t(el('Mode').value === 'follow' ? '跟随偏移（世界单位）' : '画面中心（世界坐标）');
    el('Check').disabled = locked; el('Save').disabled = locked || !approved(); el('Refresh').disabled = !owns() || Boolean(phase);
    el('Close').disabled = phase === 'save'; el('Cancel').disabled = phase === 'save';
    el('Review').hidden = !approved(); el('Text').textContent = approved() ? ticket.content : '';
    el('Relation').textContent = approved() && !catalog.manifest ? t('保存会新建相机正文和登记，并建立与场景的双向引用。场景正文保持原样。') : '';
    if (catalog) for (const option of el('Target').children) {
      const target = catalog.targets.find(row => row.instanceId === option.value);
      if (target) option.textContent = t('{0} · 实例 {1}', target.name, target.instanceId);
    }
    el('Source').textContent = catalog ? `${catalog.scene.sourcePath} · ${catalog.manifest?.sourcePath || objectId}` : '';
    el('Status').textContent = t(message);
    let camera = null; try { if (catalog) camera = formCamera(); } catch { /* Incomplete fields hide only the frame. */ }
    composer.setData(catalog, camera, Boolean(catalog && owns() && phase !== 'read' && phase !== 'save'));
  }
  function options(select, items) {
    select.replaceChildren(); for (const [value, label] of items) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
  }
  function populate(next) {
    if (next?.format !== 'viento-camera2d-author-context' || next.schemaVersion !== 1 || next.scene?.objectId !== owner.sceneId
      || !Array.isArray(next.targets) || !Array.isArray(next.documentTypes) || !next.documentTypes.length) throw Error('Invalid camera context.');
    catalog = next; objectId = next.manifest?.objectId || objectId || crypto.randomUUID();
    options(el('Type'), next.documentTypes.map(row => [row.id, row.label]));
    el('Type').value = (next.documentTypes.find(row => row.id === 'camera2d') || next.documentTypes.find(row => row.id === 'camera')
      || next.documentTypes.find(row => row.id === 'document') || next.documentTypes[0]).id;
    options(el('Target'), next.targets.map(row => [row.instanceId, t('{0} · 实例 {1}', row.name, row.instanceId)]));
    el('Path').value = `${next.documentRoot}/cameras/${objectId}.json`;
    const camera = next.manifest ? inspectSceneCamera2DDocument(next.manifest.content).value?.camera
      : { mode: 'fixed', center: next.scene.viewport.map(value => value / 2), zoom: 1 };
    if (!camera) throw Error('Invalid selected camera.');
    el('Mode').value = camera.mode; if (camera.mode === 'follow') el('Target').value = camera.targetInstanceId;
    [el('X').value, el('Y').value] = (camera.center || camera.offset).map(String); el('Zoom').value = String(camera.zoom);
    el('Limits').checked = Boolean(camera.limits);
    const limits = camera.limits || { left: 0, top: 0, right: next.scene.viewport[0], bottom: next.scene.viewport[1] };
    for (const [name, key] of [['LimitLeft', 'left'], ['LimitTop', 'top'], ['LimitRight', 'right'], ['LimitBottom', 'bottom']]) el(name).value = String(limits[key]);
    baseline = signature(); ticket = null;
  }
  async function reload() {
    if (!owns() || phase) return false;
    const generation = epoch, retained = recoverDraft ? values() : null, selectedId = catalog?.manifest?.objectId || null;
    phase = 'read'; ticket = null; render();
    try {
      const next = await inspect(owner.sceneId); if (generation !== epoch || !owns()) return false;
      if (pending) {
        const found = next.manifest;
        if (!found || found.objectId !== pending.id || found.content !== pending.content) { blocked = true; message = '保存结果尚未确认。请重新读取工程核对，勿重复提交。'; return false; }
        await applied(pending.result || { status: 'observed', changes: [] });
        owner.token = getContext().sourceToken;
        if (generation !== epoch || !owns()) return false;
        pending = null;
      }
      if (retained && selectedId !== (next.manifest?.objectId || null)) throw Error('Camera selection changed.');
      populate(next);
      if (retained) fields.forEach((name, index) => { if (name === 'Limits') el(name).checked = retained[index]; else el(name).value = retained[index]; });
      recoverDraft = false; blocked = false; message = '相机设置已读取。修改后请审阅并显式保存。'; return true;
    } catch { if (generation === epoch) { blocked = true; message = '相机设置读取失败。原表单保留，请重新读取工程。'; } return false; }
    finally { if (generation === epoch) { phase = ''; render(); } }
  }
  function formCamera() {
    const pair = [el('X').value, el('Y').value], zoomText = el('Zoom').value;
    if ([...pair, zoomText].some(value => !value.trim())) throw Error('Empty numeric camera setting.');
    const xy = pair.map(Number), zoom = Number(zoomText), camera = el('Mode').value === 'fixed'
      ? { mode: 'fixed', center: xy, zoom } : { mode: 'follow', targetInstanceId: el('Target').value, offset: xy, zoom };
    if (el('Limits').checked) {
      const keys = [['LimitLeft', 'left'], ['LimitTop', 'top'], ['LimitRight', 'right'], ['LimitBottom', 'bottom']];
      if (keys.some(([name]) => !el(name).value.trim())) throw Error('Empty camera limit.');
      camera.limits = Object.fromEntries(keys.map(([name, key]) => [key, Number(el(name).value)]));
    }
    return camera;
  }
  function content() {
    const camera = formCamera();
    const text = catalog.manifest ? editSceneCamera2DSource(catalog.manifest.content, camera)
      : JSON.stringify({ format: 'viento-scene-camera2d', schemaVersion: camera.limits ? 2 : 1, sceneObjectId: owner.sceneId, camera }, null, 2) + '\n';
    if (!inspectSceneCamera2DDocument(text).ok || camera.mode === 'follow' && !catalog.targets.some(row => row.instanceId === camera.targetInstanceId)) throw Error('Invalid camera setting.');
    return text;
  }
  async function check() {
    if (!owns() || !catalog || phase || blocked) return;
    const generation = epoch, form = signature(); ticket = null; phase = 'check'; render();
    try {
      const text = content();
      if (catalog.manifest && text === catalog.manifest.content) { message = '相机设置没有变化。'; return; }
      const payload = catalog.manifest ? { action: 'camera2d-save', sceneId: owner.sceneId, sceneVersion: catalog.scene.sourceRevision,
        documentId: catalog.manifest.objectId, expectedVersion: catalog.manifest.sourceRevision, content: text }
        : { command: 'camera2d.create', mode: 'preview', worldId: catalog.worldId, baseRevision: catalog.baseRevision,
          actorRef: { kind: 'user', id: 'studio-camera2d' }, objectId, documentType: el('Type').value, sourcePath: el('Path').value, content: text,
          sceneObjectId: owner.sceneId, sceneObjectRevision: catalog.scene.objectRevision, sceneSourceRevision: catalog.scene.sourceRevision };
      if (!catalog.manifest) {
        const preview = await command(payload);
        if (preview?.status !== 'preview' || preview.worldId !== catalog.worldId || preview.baseRevision !== catalog.baseRevision) throw Error('Invalid preview.');
      }
      if (generation === epoch && owns() && form === signature()) { ticket = { signature: form, content: text, payload, catalog }; message = '请核对完整相机原文；保存后用于下一次构建。'; }
    } catch { if (generation === epoch) message = '相机设置无效或来源已变化，请检查数值、目标与路径后重新读取。'; }
    finally { if (generation === epoch) { phase = ''; render(); } }
  }
  async function save() {
    if (!owns() || phase || blocked || !approved()) { render(); return; }
    const generation = epoch, selected = ticket; phase = 'save'; blocked = true;
    pending = { id: catalog.manifest?.objectId || objectId, content: selected.content, result: null }; busy(true); render();
    try {
      pending.result = catalog.manifest ? await request(selected.payload) : await command({ ...selected.payload, mode: 'apply' });
      message = '保存响应已收到，正在重新读取工程核对。';
    } catch (error) {
      const rejected = ['world_revision_conflict', 'world_create_path_conflict', 'world_write_busy', 'world_command_invalid', 'world_camera2d_invalid',
        'scene_camera2d_document_conflict', 'scene_camera2d_scene_conflict', 'scene_camera2d_selection_conflict'].includes(error?.code || error?.errorCode);
      if (rejected) { pending = null; recoverDraft = true; message = '保存因冲突或无效配置被拒绝。重新读取后保留表单，需重新审阅。'; }
      else message = '保存结果尚未确认。请重新读取工程核对，勿重复提交。';
    }
    finally { if (generation === epoch) { phase = ''; busy(false); ticket = null; render(); if (owns()) await reload(); } }
  }
  function close(event) {
    event?.preventDefault(); if (phase === 'save') return;
    if (dirty() && !window.confirm(t('放弃未保存的相机修改？'))) return;
    composer.cancel(); composer.setData(null, null, false);
    epoch++; ticket = null; catalog = null; owner = null; pending = null; dialog.close();
  }
  for (const name of fields) for (const event of ['input', 'change']) el(name).addEventListener(event, () => { ticket = null; render(); });
  el('Mode').addEventListener('change', () => { el('X').value = '0'; el('Y').value = '0'; render(); });
  el('Check').addEventListener('click', () => void check()); el('Save').addEventListener('click', () => void save());
  el('Refresh').addEventListener('click', () => { if (!dirty() || pending || window.confirm(t('放弃未保存的相机修改？'))) void reload(); });
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close); dialog.addEventListener('cancel', close);
  composer = typeof setupSceneCamera2DComposer === 'function' ? setupSceneCamera2DComposer({
    container: el('Compose'), canEdit: () => Boolean(catalog && owns() && !phase && !blocked),
    onCandidate(camera, detail) {
      if (!catalog || !owns() || phase || blocked) return;
      let current; try { current = formCamera(); } catch { return; }
      if (!detail || JSON.stringify(current) !== JSON.stringify(detail.initialCamera)
        || camera.mode !== current.mode || camera.zoom !== current.zoom || camera.targetInstanceId !== current.targetInstanceId
        || JSON.stringify(camera.limits) !== JSON.stringify(current.limits)) return;
      const content = JSON.stringify({ format: 'viento-scene-camera2d', schemaVersion: camera.limits ? 2 : 1, sceneObjectId: owner.sceneId, camera });
      if (!inspectSceneCamera2DDocument(content).ok || JSON.stringify(camera) === JSON.stringify(current)) return;
      [el('X').value, el('Y').value] = (camera.center || camera.offset).map(String);
      ticket = null; message = '构图已更新表单，尚未保存；请重新审阅相机设置。'; render();
    },
  }) : composer;
  const unsubscribe = onLanguageChange(render);
  return { async open(sceneId) {
    if (!eligible() || getContext().sceneId !== sceneId || dialog.open) return false;
    const context = getContext(); epoch++; owner = { sceneId, session: context.session, token: context.sourceToken };
    catalog = null; pending = null; recoverDraft = false; objectId = ''; baseline = ''; blocked = false; phase = ''; message = '';
    dialog.showModal(); render(); return reload();
  }, setAvailable(value, commands = []) { enabled = value === true && commands.includes('camera2d.create'); if (dialog.open) render(); },
  dispose() { disposed = true; epoch++; busy(false); composer.dispose(); unsubscribe?.(); dialog.close(); dialog.remove(); } };
}
