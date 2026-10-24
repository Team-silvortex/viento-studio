import { createScenePhysics2DCreationDraft } from '../../engine/scene-physics2d-create-plan.mjs';
import { captureScenePhysics2DCreationContext, createScenePhysics2DCreationRequest, validateScenePhysics2DCreationResult, confirmScenePhysics2DCreation } from '../../engine/scene-physics2d-creation-contract.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This controller owns one reviewed initial physics body. Scene validation, atomic
// writes, source navigation and later body editing remain separate host ports.
export function setupScenePhysics2DCreate({ getContext = () => ({}), setBusy = () => {}, inspect = async () => null,
  command = async () => null, applied = async () => {}, openSource = async () => false } = {}) {
  if (!document.getElementById('scenePhysics2DCreateStyle')) {
    const style = document.createElement('link'); style.id = 'scenePhysics2DCreateStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-physics2d-create.css';
    (document.head || document.body).append(style);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'scenePhysics2DCreateDialog'; dialog.className = 'scene-physics2d-create-dialog';
  dialog.setAttribute('aria-labelledby', 'scenePhysics2DCreateTitle'); dialog.setAttribute('data-viento-close-guard', 'true');
  dialog.innerHTML = `<header class="scene-physics2d-create-header"><h2 id="scenePhysics2DCreateTitle" data-i18n="场景二维物理"></h2><button id="scenePhysics2DCreateClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回构建"></button></header>
    <div class="scene-physics2d-create-body"><p data-i18n="为已保存的二维场景创建第一个物理体。选择场景实例和形状，审阅完整原文与关系后保存。保存后可继续使用二维物理字段编辑器。"></p>
    <p id="scenePhysics2DCreateScene" class="scene-physics2d-create-note"></p><button id="scenePhysics2DCreateRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <section id="scenePhysics2DCreateExisting" hidden><h3 data-i18n="场景已有关联二维物理"></h3><p id="scenePhysics2DCreateManifest"></p><p data-i18n="已有二维物理文档不会重复创建。打开原文后，可使用独立物理字段编辑器。"></p></section>
    <p id="scenePhysics2DCreateEmpty" data-i18n="场景暂无可绑定物理体的实例。请先保存场景实例，再重新读取工程。" hidden></p>
    <fieldset id="scenePhysics2DCreateFields" hidden><legend data-i18n="新二维物理文档"></legend><div class="scene-physics2d-create-grid">
      <label><span data-i18n="文档类型"></span><select id="scenePhysics2DCreateType"></select></label>
      <label><span data-i18n="原文路径"></span><input id="scenePhysics2DCreatePath" type="text" maxlength="1024" spellcheck="false" /></label>
      <label class="scene-physics2d-create-wide"><span data-i18n="按场景实例名称选择"></span><select id="scenePhysics2DCreateInstance"></select></label>
      <p id="scenePhysics2DCreateTargetIdentity" class="scene-physics2d-create-wide scene-physics2d-create-note"></p>
      <label><span data-i18n="物理体类型"></span><select id="scenePhysics2DCreateKind"></select></label>
      <label><span data-i18n="碰撞形状"></span><select id="scenePhysics2DCreateShape"></select></label>
      <label id="scenePhysics2DCreateWidthField"><span data-i18n="矩形宽度"></span><input id="scenePhysics2DCreateWidth" type="text" inputmode="decimal" maxlength="32" /></label>
      <label id="scenePhysics2DCreateHeightField"><span data-i18n="矩形高度"></span><input id="scenePhysics2DCreateHeight" type="text" inputmode="decimal" maxlength="32" /></label>
      <label id="scenePhysics2DCreateRadiusField"><span data-i18n="圆形半径"></span><input id="scenePhysics2DCreateRadius" type="text" inputmode="decimal" maxlength="32" /></label>
      <label><span data-i18n="碰撞偏移 X"></span><input id="scenePhysics2DCreateOffsetX" type="text" inputmode="decimal" maxlength="32" /></label>
      <label><span data-i18n="碰撞偏移 Y"></span><input id="scenePhysics2DCreateOffsetY" type="text" inputmode="decimal" maxlength="32" /></label>
      <label><span data-i18n="碰撞层位掩码"></span><input id="scenePhysics2DCreateLayer" type="text" inputmode="numeric" maxlength="32" /></label>
      <label><span data-i18n="碰撞检测位掩码"></span><input id="scenePhysics2DCreateMask" type="text" inputmode="numeric" maxlength="32" /></label></div>
      <p class="scene-physics2d-create-note" data-i18n="矩形宽高 1–8192，圆形半径 0.5–4096，偏移 ±8192，层与检测掩码为 0–65535 的整数。目录来自已保存场景，不包含草稿。"></p>
      <p class="scene-physics2d-create-note" data-i18n="静态体和传感器要求场景实例的有效控制为 none、速度为 0；工程构建预检会验证运动条件。此处不会修改场景运动设置。"></p>
      <p id="scenePhysics2DCreateIdentity" class="scene-physics2d-create-note"></p></fieldset>
    <section id="scenePhysics2DCreateReview" hidden><h3 data-i18n="新二维物理文档审阅"></h3><p data-i18n="保存会新建二维物理正文和登记，并更新场景的 physics2d 关系；场景正文和素材字节保持。"></p>
      <h4 data-i18n="将登记的双向关系"></h4><ul id="scenePhysics2DCreateRelations"></ul><h4 data-i18n="将创建的完整原文"></h4><pre id="scenePhysics2DCreateSourceText" tabindex="0"></pre></section></div>
    <div class="scene-physics2d-create-feedback"><p id="scenePhysics2DCreateStatus" role="status" aria-live="polite"></p><p id="scenePhysics2DCreateDetails" class="scene-physics2d-create-note"></p></div>
    <footer class="scene-physics2d-create-footer"><button id="scenePhysics2DCreateCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅二维物理"></button><button id="scenePhysics2DCreateSave" type="button" class="doc-btn" data-i18n="保存物理与关系"></button><button id="scenePhysics2DCreateOpen" type="button" class="doc-btn" data-i18n="打开二维物理原文" hidden></button><button id="scenePhysics2DCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#scenePhysics2DCreate' + suffix), copy = value => JSON.parse(JSON.stringify(value));
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const digest = async value => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
  const fail = key => { throw Object.assign(new Error(t(key)), { uiKey: key }); };
  let enabled = false, disposed = false, epoch = 0, owner = null, catalog = null, draft = null, baseline = '', preview = null;
  let phase = '', pendingWrite = null, needsRefresh = false, busyOwned = false, message = '', details = '', opener = null;
  const fields = ['Type', 'Path', 'Instance', 'Kind', 'Shape', 'Width', 'Height', 'Radius', 'OffsetX', 'OffsetY', 'Layer', 'Mask'];
  const kindLabels = { character: '角色物理体', static: '静态物理体', sensor: '传感器物理体' };
  const circle = () => el('Shape').value === 'circle';
  const raw = () => Object.fromEntries(fields.map(name => [name, el(name).value]));
  const signature = () => JSON.stringify(raw());
  const eligible = () => { const c = getContext(); return Boolean(!disposed && enabled && c.editable && !c.dirty && !c.creating && !c.busy && c.visible === true && uuid(c.sceneId) && typeof c.session === 'string'); };
  const owns = (generation = epoch, acceptToken = false) => { const c = getContext(); return Boolean(generation === epoch && dialog.open && owner && !owner.invalidated && eligible()
    && c.sceneId === owner.sceneId && c.session === owner.session && (acceptToken || c.sourceToken === owner.sourceToken)); };
  const canEdit = () => Boolean(!phase && !pendingWrite && !needsRefresh && catalog?.status === 'empty' && draft && owns());
  const approval = () => preview && preview.catalog === catalog && preview.signature === signature();
  const dirty = () => Boolean(pendingWrite || preview || draft && catalog?.status !== 'ready' && signature() !== baseline);
  const hostBusy = value => { if (busyOwned !== value) { busyOwned = value; setBusy(value); } };
  function capture() { if (draft) Object.assign(draft, raw()); }
  function invalidate() { preview = null; message = '二维物理尚未保存，请先审阅原文和双向关系。'; details = ''; }
  function options(select, values, value) {
    select.replaceChildren();
    if (!values.some(([id]) => id === value)) { const placeholder = document.createElement('option'); placeholder.value = value || ''; placeholder.textContent = value ? t('已不可用：{0}', value) : t('请选择'); select.append(placeholder); }
    for (const [id, label] of values) { const option = document.createElement('option'); option.value = id; option.textContent = label; select.append(option); }
    select.value = value;
  }
  function renderFields() {
    if (!draft || catalog?.status !== 'empty') return;
    options(el('Type'), catalog.documentTypes.map(item => [item.id, item.label]), draft.Type);
    options(el('Instance'), catalog.targets.map(target => [target.instanceId, t('{0} · 实例 {1}', target.name, target.instanceId)]), draft.Instance);
    options(el('Kind'), Object.entries(kindLabels).map(([id, label]) => [id, t(label)]), draft.Kind);
    options(el('Shape'), [['box', t('矩形')], ['circle', t('圆形')]], draft.Shape);
    for (const name of ['Path', 'Width', 'Height', 'Radius', 'OffsetX', 'OffsetY', 'Layer', 'Mask']) if (el(name).value !== draft[name]) el(name).value = draft[name];
  }
  function update() {
    if (disposed) return;
    translatePage(dialog); dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    const existing = catalog?.status === 'ready';
    el('Fields').hidden = catalog?.status !== 'empty' || !draft; el('Fields').disabled = !canEdit();
    fields.forEach(name => { el(name).disabled = !canEdit(); });
    el('WidthField').hidden = circle(); el('HeightField').hidden = circle(); el('RadiusField').hidden = !circle();
    el('Width').disabled = !canEdit() || circle(); el('Height').disabled = !canEdit() || circle(); el('Radius').disabled = !canEdit() || !circle();
    el('TargetIdentity').textContent = draft ? t('场景实例：{0}', draft.Instance) : '';
    el('Existing').hidden = !existing; el('Manifest').textContent = existing ? `${catalog.manifest.sourcePath} · ${catalog.manifest.objectId}` : '';
    el('Empty').hidden = catalog?.status !== 'empty' || catalog.targets.length > 0;
    el('Scene').textContent = catalog ? t('场景：{0} · {1}', catalog.scene.sourcePath, catalog.scene.objectId) : '';
    el('Identity').textContent = draft ? t('新文档身份：{0} · 物理体身份：{1}', draft.objectId, draft.bodyId) : '';
    el('Check').hidden = existing; el('Save').hidden = existing; el('Check').disabled = !canEdit() || !catalog.targets.length; el('Save').disabled = !canEdit() || !approval();
    el('Open').hidden = !existing; el('Open').disabled = Boolean(phase || pendingWrite || needsRefresh) || !existing || !owns();
    el('Refresh').disabled = Boolean(phase) || !owns(); el('Close').disabled = phase === 'apply'; el('Cancel').disabled = phase === 'apply';
    el('Review').hidden = !approval(); el('SourceText').textContent = approval() ? preview.request.content : ''; el('Relations').replaceChildren();
    if (approval()) {
      const request = preview.request;
      const values = [`${catalog.scene.objectId} → references [physics2d] → ${request.objectId}`, `${request.objectId} → references → ${catalog.scene.objectId}`];
      for (const value of values) { const item = document.createElement('li'); item.textContent = value; el('Relations').append(item); }
    }
    el('Status').textContent = t(message); el('Details').textContent = details;
  }
  function stale() { preview = null; needsRefresh = true; message = '来源或会话已变化，请返回构建后重新打开二维物理设置。'; }
  async function readContext(generation) {
    const value = await inspect({ sceneObjectId: owner.sceneId });
    return owns(generation) ? captureScenePhysics2DCreationContext(value, owner.sceneId) : null;
  }
  async function notifySaved(generation, next) {
    try { await applied(pendingWrite.result, pendingWrite.result ? undefined : { reconciled: true, catalog: next }); }
    finally { if (owns(generation, true)) owner.sourceToken = getContext().sourceToken; }
    if (!owns(generation)) return false;
    pendingWrite.notified = true; return true;
  }
  async function reload(generation) {
    if (pendingWrite?.result && !pendingWrite.notified && !await notifySaved(generation)) return;
    let next = await readContext(generation); if (!next) return;
    const observed = value => pendingWrite && confirmScenePhysics2DCreation(value, pendingWrite.request, pendingWrite.sourceRevision);
    if (pendingWrite && observed(next) && !pendingWrite.notified) {
      if (!await notifySaved(generation, next)) return;
      next = await readContext(generation); if (!next) return;
    }
    catalog = next; preview = null; needsRefresh = false;
    if (pendingWrite && observed(next) && pendingWrite.notified) { pendingWrite = null; draft = null; message = '二维物理与关系已确认保存。可打开原文继续编辑。'; }
    else if (pendingWrite) message = '二维物理保存结果尚未确认，请重新读取工程核对，勿重复创建。';
    else if (next.status === 'ready') { draft = null; message = '此场景已有二维物理文档，可打开原文继续编辑。'; }
    else {
      if (!draft) {
        const objectId = crypto.randomUUID(), bodyId = crypto.randomUUID(), used = new Set([next.scene.objectId, ...next.targets.flatMap(target => [target.instanceId, target.objectId])]);
        if (!uuid(objectId) || !uuid(bodyId) || objectId === bodyId || used.has(objectId) || used.has(bodyId)) throw Error('Invalid stable physics body identity.');
        const type = next.documentTypes.find(item => item.id === 'physics2d') || next.documentTypes.find(item => item.id === 'physics') || next.documentTypes.find(item => item.id === 'document') || next.documentTypes[0];
        draft = { objectId, bodyId, Type: type.id, Path: `${next.documentRoot}/physics/new-physics2d.json`,
          Instance: next.targets[0]?.instanceId || '', Kind: 'character', Shape: 'box', Width: '32', Height: '32', Radius: '16', OffsetX: '0', OffsetY: '0', Layer: '1', Mask: '1' };
        renderFields(); baseline = signature();
      } else renderFields();
      message = '选择场景实例与物理体设置，审阅后保存二维物理文档。';
    }
  }
  async function read() {
    if (phase || !owns()) return; capture(); const generation = epoch; preview = null; phase = 'read'; hostBusy(true); message = '正在读取场景二维物理目录…'; details = ''; update();
    try { await reload(generation); }
    catch (error) { if (owns(generation)) { preview = null; needsRefresh = true; message = '无法读取二维物理目录。设置已保留，请检查关系并重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  function number(value) {
    if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) fail('请输入完整的数字。');
    return Number(value);
  }
  function request() {
    capture();
    if (!catalog.documentTypes.some(type => type.id === draft.Type) || !catalog.targets.some(target => target.instanceId === draft.Instance)) fail('请选择当前工程中的文档类型和场景实例。');
    if (!draft.Path.startsWith(catalog.documentRoot + '/') || !/\.json$/.test(draft.Path) || getCreatePathError(draft.Path)) fail('请使用正文目录内可迁移的 JSON 文件路径。');
    if (!['character', 'static', 'sensor'].includes(draft.Kind) || !['box', 'circle'].includes(draft.Shape)) fail('请选择有效的物理体类型和碰撞形状。');
    const planned = createScenePhysics2DCreationDraft({ sceneObjectId: catalog.scene.objectId, bodyId: draft.bodyId, instanceId: draft.Instance,
      kind: draft.Kind, shape: circle() ? { kind: 'circle', radius: number(draft.Radius) } : { kind: 'box', size: [number(draft.Width), number(draft.Height)] },
      offset: [number(draft.OffsetX), number(draft.OffsetY)], layer: number(draft.Layer), mask: number(draft.Mask) });
    if (!planned.ok) fail('物理设置无效，请检查形状尺寸、偏移、层和检测掩码。');
    return createScenePhysics2DCreationRequest(catalog, { objectId: draft.objectId, documentType: draft.Type, sourcePath: draft.Path, content: planned.content });
  }
  async function run(mode) {
    if (!canEdit() || mode === 'apply' && !approval()) { if (!phase && preview && !approval()) { invalidate(); update(); } return; }
    let requested; try { requested = mode === 'apply' ? { ...copy(preview.request), mode } : request(); }
    catch (error) { preview = null; message = error.uiKey || '物理设置无效，请检查形状尺寸、偏移、层和检测掩码。'; details = error.message || ''; update(); return; }
    const generation = epoch, inputSignature = signature(), snapshot = catalog; phase = mode; hostBusy(true); details = ''; message = mode === 'apply' ? '正在保存二维物理文档与关系…' : '正在审阅二维物理文档与关系…'; update();
    try {
      const sourceRevision = await digest(requested.content); if (!owns(generation) || signature() !== inputSignature || catalog !== snapshot) return;
      if (mode === 'apply') pendingWrite = { request: copy(requested), sourceRevision, result: null, notified: false };
      const result = await command(requested); if (!owns(generation) || signature() !== inputSignature || catalog !== snapshot) return;
      const valid = validateScenePhysics2DCreationResult(result, requested, snapshot, sourceRevision);
      if (mode === 'preview') { preview = { request: copy(requested), signature: inputSignature, catalog: snapshot }; message = '二维物理创建已审阅，请确认完整原文和双向关系后保存。'; }
      else { pendingWrite.result = valid; preview = null; await reload(generation); }
    } catch (error) {
      if (generation !== epoch || disposed) return;
      preview = null; const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
      const rejected = ['world_write_busy', 'world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_physics2d_invalid', 'world_physics2d_target_missing', 'world_create_path_invalid', 'world_create_path_conflict'];
      if (pendingWrite && !pendingWrite.result && rejected.includes(code)) pendingWrite = null;
      needsRefresh = !pendingWrite;
      message = pendingWrite ? '二维物理保存结果尚未确认，请重新读取工程核对，勿重复创建。' : error.uiKey || '二维物理请求未完成。设置已保留，请重新读取并审阅。'; details = error.message || '';
    } finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  function close(restoreFocus = true) {
    if (phase === 'apply') return false;
    if (dirty() && !window.confirm(t('丢弃本次二维物理创建设置？已保存的物理与关系会保留。'))) return false;
    epoch++; phase = ''; hostBusy(false); owner = null; catalog = null; draft = null; pendingWrite = null; preview = null; dialog.dataset.dirty = 'false'; dialog.close(); if (restoreFocus) opener?.focus(); return true;
  }
  async function navigate() {
    if (phase || pendingWrite || needsRefresh || catalog?.status !== 'ready' || !owns()) return;
    const generation = epoch, previous = catalog; phase = 'open'; hostBusy(true); message = '正在核对二维物理原文…'; details = ''; update();
    try {
      const next = await readContext(generation); if (!next) return; catalog = next;
      if (next.status !== 'ready' || next.worldId !== previous.worldId || next.manifest.objectId !== previous.manifest.objectId || next.manifest.sourceRevision !== previous.manifest.sourceRevision) {
        message = '二维物理文档或关系已变化，请确认目录后重新打开原文。'; return;
      }
      hostBusy(false);
      const isCurrent = () => { const c = getContext(); return Boolean(generation === epoch && dialog.open && !disposed && enabled && owner && !owner.invalidated
        && c.sceneId === owner.sceneId && c.session === owner.session && c.editable && !c.dirty && !c.creating); };
      if (!owns(generation)) return;
      const result = await openSource(next.manifest.sourcePath, { sourceRevision: next.manifest.sourceRevision, isCurrent });
      if (generation !== epoch || disposed) return;
      if (result !== false && isCurrent()) { phase = ''; close(false); result?.focus?.(); }
      else message = '二维物理原文未打开，请重新读取工程后重试。';
    } catch (error) { if (generation === epoch && !disposed) { message = '二维物理原文未打开，请重新读取工程后重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (dialog.open && !owns()) stale(); update(); } }
  }
  fields.forEach(name => { for (const event of ['input', 'change']) el(name).addEventListener(event, () => {
    if (!canEdit()) return;
    capture();
    invalidate(); update();
  }); });
  el('Check').addEventListener('click', () => void run('preview')); el('Save').addEventListener('click', () => void run('apply')); el('Refresh').addEventListener('click', () => void read()); el('Open').addEventListener('click', () => void navigate());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  const unsubscribe = onLanguageChange(() => { if (dialog.open && !disposed) { capture(); renderFields(); update(); } });
  return Object.freeze({
    open(sceneId) {
      if (dialog.open || !eligible() || getContext().sceneId !== sceneId) return false;
      epoch++; const context = getContext(); owner = { session: context.session, sceneId, sourceToken: context.sourceToken }; opener = document.activeElement;
      catalog = null; draft = null; baseline = ''; preview = null; pendingWrite = null; needsRefresh = false; message = ''; details = ''; phase = '';
      dialog.showModal(); update(); void read(); return true;
    },
    setAvailable(value, commands = []) { enabled = value === true && Array.isArray(commands) && commands.includes('physics2d.create'); if (dialog.open) { if (!enabled && owner) owner.invalidated = true; update(); } },
    dispose() { if (disposed) return; disposed = true; epoch++; hostBusy(false); phase = ''; owner = null; if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); },
  });
}
