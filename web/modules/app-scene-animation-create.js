import { createSceneAnimationCreationDraft } from '../../engine/scene-animation-create-plan.mjs';
import { captureSceneAnimationCreationContext, createSceneAnimationCreationRequest, validateSceneAnimationCreationResult, confirmSceneAnimationCreation } from '../../engine/scene-animation-creation-contract.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This controller owns one reviewed initial animation. Scene validation, atomic
// writes, source navigation and later keyframe editing remain separate host ports.
export function setupSceneAnimationCreate({ getContext = () => ({}), setBusy = () => {}, inspect = async () => null,
  command = async () => null, applied = async () => {}, openSource = async () => false } = {}) {
  if (!document.getElementById('sceneAnimationCreateStyle')) {
    const style = document.createElement('link'); style.id = 'sceneAnimationCreateStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-animation-create.css';
    (document.head || document.body).append(style);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneAnimationCreateDialog'; dialog.className = 'scene-animation-create-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneAnimationCreateTitle'); dialog.setAttribute('data-viento-close-guard', 'true');
  dialog.innerHTML = `<header class="scene-animation-create-header"><h2 id="sceneAnimationCreateTitle" data-i18n="场景动画"></h2><button id="sceneAnimationCreateClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回构建"></button></header>
    <div class="scene-animation-create-body"><p data-i18n="为已保存的二维场景创建第一条动画轨道。起始帧使用原始偏移、旋转、缩放或不透明度；末帧使用下方设置，采用线性插值。保存后可继续编辑轨道和关键帧。"></p>
    <p id="sceneAnimationCreateScene" class="scene-animation-create-note"></p><button id="sceneAnimationCreateRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <section id="sceneAnimationCreateExisting" hidden><h3 data-i18n="场景已有关联动画"></h3><p id="sceneAnimationCreateManifest"></p><p data-i18n="已有动画文档不会重复创建。打开原文后，可使用独立动画字段编辑器。"></p></section>
    <p id="sceneAnimationCreateEmpty" data-i18n="场景暂无可动画化的实例。请先保存场景实例，再重新读取工程。" hidden></p>
    <fieldset id="sceneAnimationCreateFields" hidden><legend data-i18n="新动画文档"></legend><div class="scene-animation-create-grid">
      <label><span data-i18n="文档类型"></span><select id="sceneAnimationCreateType"></select></label>
      <label><span data-i18n="原文路径"></span><input id="sceneAnimationCreatePath" type="text" maxlength="1024" spellcheck="false" /></label>
      <label class="scene-animation-create-wide"><span data-i18n="按场景实例名称选择"></span><select id="sceneAnimationCreateInstance"></select></label>
      <p id="sceneAnimationCreateTargetIdentity" class="scene-animation-create-wide scene-animation-create-note"></p>
      <label><span data-i18n="动画属性"></span><select id="sceneAnimationCreateProperty"></select></label>
      <label><span data-i18n="动画时长（秒）"></span><input id="sceneAnimationCreateDuration" type="text" inputmode="decimal" maxlength="32" /></label>
      <label><span data-i18n="循环播放"></span><select id="sceneAnimationCreateLoop"></select></label>
      <label><span id="sceneAnimationCreateEndXLabel"></span><input id="sceneAnimationCreateEndX" type="text" inputmode="decimal" maxlength="32" /></label>
      <label id="sceneAnimationCreateEndYField"><span data-i18n="末帧 Y 值"></span><input id="sceneAnimationCreateEndY" type="text" inputmode="decimal" maxlength="32" /></label></div>
      <p class="scene-animation-create-note" data-i18n="时长大于 0 且不超过 60 秒。偏移 ±10000、旋转 ±36000 度、缩放 0.01–100、不透明度 0–1。场景目录来自已保存正文，不包含场景草稿。"></p><p id="sceneAnimationCreateIdentity" class="scene-animation-create-note"></p></fieldset>
    <section id="sceneAnimationCreateReview" hidden><h3 data-i18n="新动画文档审阅"></h3><p data-i18n="保存会新建动画正文和登记，并更新场景的动画关系；场景正文和素材字节保持。"></p>
      <h4 data-i18n="将登记的双向关系"></h4><ul id="sceneAnimationCreateRelations"></ul><h4 data-i18n="将创建的完整原文"></h4><pre id="sceneAnimationCreateSourceText" tabindex="0"></pre></section></div>
    <div class="scene-animation-create-feedback"><p id="sceneAnimationCreateStatus" role="status" aria-live="polite"></p><p id="sceneAnimationCreateDetails" class="scene-animation-create-note"></p></div>
    <footer class="scene-animation-create-footer"><button id="sceneAnimationCreateCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅新动画"></button><button id="sceneAnimationCreateSave" type="button" class="doc-btn" data-i18n="保存动画与关系"></button><button id="sceneAnimationCreateOpen" type="button" class="doc-btn" data-i18n="打开动画原文" hidden></button><button id="sceneAnimationCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneAnimationCreate' + suffix), copy = value => JSON.parse(JSON.stringify(value));
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const digest = async value => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
  const fail = key => { throw Object.assign(new Error(t(key)), { uiKey: key }); };
  let enabled = false, disposed = false, epoch = 0, owner = null, catalog = null, draft = null, baseline = '', preview = null;
  let phase = '', pendingWrite = null, needsRefresh = false, busyOwned = false, message = '', details = '', opener = null;
  const fields = ['Type', 'Path', 'Instance', 'Property', 'Duration', 'Loop', 'EndX', 'EndY'];
  const propertyLabels = { offset2d: '二维偏移', rotation2d: '二维旋转（度）', scale2d: '二维缩放', opacity: '不透明度' };
  const vector = () => ['offset2d', 'scale2d'].includes(el('Property').value);
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
  function invalidate() { preview = null; message = '动画尚未保存，请先审阅原文和双向关系。'; details = ''; }
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
    options(el('Property'), Object.entries(propertyLabels).map(([id, label]) => [id, t(label)]), draft.Property);
    options(el('Loop'), [['false', t('否')], ['true', t('是')]], draft.Loop);
    for (const name of ['Path', 'Duration', 'EndX', 'EndY']) if (el(name).value !== draft[name]) el(name).value = draft[name];
  }
  function update() {
    if (disposed) return;
    translatePage(dialog); dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    const existing = catalog?.status === 'ready';
    el('Fields').hidden = catalog?.status !== 'empty' || !draft; el('Fields').disabled = !canEdit();
    fields.forEach(name => { el(name).disabled = !canEdit(); });
    el('EndYField').hidden = !vector(); el('EndY').disabled = !canEdit() || !vector();
    el('EndXLabel').textContent = t(vector() ? '末帧 X 值' : '末帧数值');
    el('TargetIdentity').textContent = draft ? t('场景实例：{0}', draft.Instance) : '';
    el('Existing').hidden = !existing; el('Manifest').textContent = existing ? `${catalog.manifest.sourcePath} · ${catalog.manifest.objectId}` : '';
    el('Empty').hidden = catalog?.status !== 'empty' || catalog.targets.length > 0;
    el('Scene').textContent = catalog ? t('场景：{0} · {1}', catalog.scene.sourcePath, catalog.scene.objectId) : '';
    el('Identity').textContent = draft ? t('新文档身份：{0} · 轨道身份：{1}', draft.objectId, draft.trackId) : '';
    el('Check').hidden = existing; el('Save').hidden = existing; el('Check').disabled = !canEdit() || !catalog.targets.length; el('Save').disabled = !canEdit() || !approval();
    el('Open').hidden = !existing; el('Open').disabled = Boolean(phase || pendingWrite || needsRefresh) || !existing || !owns();
    el('Refresh').disabled = Boolean(phase) || !owns(); el('Close').disabled = phase === 'apply'; el('Cancel').disabled = phase === 'apply';
    el('Review').hidden = !approval(); el('SourceText').textContent = approval() ? preview.request.content : ''; el('Relations').replaceChildren();
    if (approval()) {
      const request = preview.request;
      const values = [`${catalog.scene.objectId} → animation → ${request.objectId}`, `${request.objectId} → references → ${catalog.scene.objectId}`];
      for (const value of values) { const item = document.createElement('li'); item.textContent = value; el('Relations').append(item); }
    }
    el('Status').textContent = t(message); el('Details').textContent = details;
  }
  function stale() { preview = null; needsRefresh = true; message = '来源或会话已变化，请返回构建后重新打开动画设置。'; }
  async function readContext(generation) {
    const value = await inspect({ sceneObjectId: owner.sceneId });
    return owns(generation) ? captureSceneAnimationCreationContext(value, owner.sceneId) : null;
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
    const observed = value => pendingWrite && confirmSceneAnimationCreation(value, pendingWrite.request, pendingWrite.sourceRevision);
    if (pendingWrite && observed(next) && !pendingWrite.notified) {
      if (!await notifySaved(generation, next)) return;
      next = await readContext(generation); if (!next) return;
    }
    catalog = next; preview = null; needsRefresh = false;
    if (pendingWrite && observed(next) && pendingWrite.notified) { pendingWrite = null; draft = null; message = '动画与关系已确认保存。可打开原文继续编辑。'; }
    else if (pendingWrite) message = '动画保存结果尚未确认，请重新读取工程核对，勿重复创建。';
    else if (next.status === 'ready') { draft = null; message = '此场景已有动画文档，可打开原文继续编辑。'; }
    else {
      if (!draft) {
        const objectId = crypto.randomUUID(), trackId = crypto.randomUUID(), used = new Set([next.scene.objectId, ...next.targets.flatMap(target => [target.instanceId, target.objectId])]);
        if (!uuid(objectId) || !uuid(trackId) || objectId === trackId || used.has(objectId) || used.has(trackId)) throw Error('Invalid stable animation identity.');
        const type = next.documentTypes.find(item => item.id === 'animation') || next.documentTypes.find(item => item.id === 'document') || next.documentTypes[0];
        draft = { objectId, trackId, Type: type.id, Path: `${next.documentRoot}/animations/new-animation.json`,
          Instance: next.targets[0]?.instanceId || '', Property: 'offset2d', Duration: '2', Loop: 'false', EndX: '100', EndY: '0' };
        renderFields(); baseline = signature();
      } else renderFields();
      message = '选择场景实例与末帧设置，审阅后保存动画文档。';
    }
  }
  async function read() {
    if (phase || !owns()) return; capture(); const generation = epoch; preview = null; phase = 'read'; hostBusy(true); message = '正在读取场景动画目录…'; details = ''; update();
    try { await reload(generation); }
    catch (error) { if (owns(generation)) { preview = null; needsRefresh = true; message = '无法读取动画目录。设置已保留，请检查关系并重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  function number(value) {
    if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) fail('请输入完整的数字。');
    return Number(value);
  }
  function request() {
    capture();
    if (!catalog.documentTypes.some(type => type.id === draft.Type) || !catalog.targets.some(target => target.instanceId === draft.Instance)) fail('请选择当前工程中的文档类型和场景实例。');
    if (!draft.Path.startsWith(catalog.documentRoot + '/') || !/\.json$/i.test(draft.Path) || getCreatePathError(draft.Path)) fail('请使用正文目录内可迁移的 JSON 文件路径。');
    if (!['true', 'false'].includes(draft.Loop)) fail('请选择有效的循环设置。');
    const planned = createSceneAnimationCreationDraft({ sceneObjectId: catalog.scene.objectId, trackId: draft.trackId, instanceId: draft.Instance,
      property: draft.Property, durationSeconds: number(draft.Duration), loop: draft.Loop === 'true', endValue: vector() ? [number(draft.EndX), number(draft.EndY)] : number(draft.EndX) });
    if (!planned.ok) fail('动画设置无效，请检查时长、末帧数值和轨道身份。');
    return createSceneAnimationCreationRequest(catalog, { objectId: draft.objectId, documentType: draft.Type, sourcePath: draft.Path, content: planned.content });
  }
  async function run(mode) {
    if (!canEdit() || mode === 'apply' && !approval()) { if (!phase && preview && !approval()) { invalidate(); update(); } return; }
    let requested; try { requested = mode === 'apply' ? { ...copy(preview.request), mode } : request(); }
    catch (error) { preview = null; message = error.uiKey || '动画设置无效，请检查时长、末帧数值和轨道身份。'; details = error.message || ''; update(); return; }
    const generation = epoch, inputSignature = signature(), snapshot = catalog; phase = mode; hostBusy(true); details = ''; message = mode === 'apply' ? '正在保存动画文档与关系…' : '正在审阅动画文档与关系…'; update();
    try {
      const sourceRevision = await digest(requested.content); if (!owns(generation) || signature() !== inputSignature || catalog !== snapshot) return;
      if (mode === 'apply') pendingWrite = { request: copy(requested), sourceRevision, result: null, notified: false };
      const result = await command(requested); if (!owns(generation) || signature() !== inputSignature || catalog !== snapshot) return;
      const valid = validateSceneAnimationCreationResult(result, requested, snapshot, sourceRevision);
      if (mode === 'preview') { preview = { request: copy(requested), signature: inputSignature, catalog: snapshot }; message = '动画创建已审阅，请确认完整原文和双向关系后保存。'; }
      else { pendingWrite.result = valid; preview = null; await reload(generation); }
    } catch (error) {
      if (generation !== epoch || disposed) return;
      preview = null; const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
      const rejected = ['world_write_busy', 'world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_animation_invalid', 'world_animation_target_missing', 'world_create_path_invalid', 'world_create_path_conflict'];
      if (pendingWrite && !pendingWrite.result && rejected.includes(code)) pendingWrite = null;
      needsRefresh = !pendingWrite;
      message = pendingWrite ? '动画保存结果尚未确认，请重新读取工程核对，勿重复创建。' : error.uiKey || '动画请求未完成。设置已保留，请重新读取并审阅。'; details = error.message || '';
    } finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  function close(restoreFocus = true) {
    if (phase === 'apply') return false;
    if (dirty() && !window.confirm(t('丢弃本次动画创建设置？已保存的动画与关系会保留。'))) return false;
    epoch++; phase = ''; hostBusy(false); owner = null; catalog = null; draft = null; pendingWrite = null; preview = null; dialog.dataset.dirty = 'false'; dialog.close(); if (restoreFocus) opener?.focus(); return true;
  }
  async function navigate() {
    if (phase || pendingWrite || needsRefresh || catalog?.status !== 'ready' || !owns()) return;
    const generation = epoch, previous = catalog; phase = 'open'; hostBusy(true); message = '正在核对动画原文…'; details = ''; update();
    try {
      const next = await readContext(generation); if (!next) return; catalog = next;
      if (next.status !== 'ready' || next.worldId !== previous.worldId || next.manifest.objectId !== previous.manifest.objectId || next.manifest.sourceRevision !== previous.manifest.sourceRevision) {
        message = '动画文档或关系已变化，请确认目录后重新打开原文。'; return;
      }
      hostBusy(false);
      const isCurrent = () => { const c = getContext(); return Boolean(generation === epoch && dialog.open && !disposed && enabled && owner && !owner.invalidated
        && c.sceneId === owner.sceneId && c.session === owner.session && c.editable && !c.dirty && !c.creating); };
      if (!owns(generation)) return;
      const result = await openSource(next.manifest.sourcePath, { sourceRevision: next.manifest.sourceRevision, isCurrent });
      if (generation !== epoch || disposed) return;
      if (result !== false && isCurrent()) { phase = ''; close(false); result?.focus?.(); }
      else message = '动画原文未打开，请重新读取工程后重试。';
    } catch (error) { if (generation === epoch && !disposed) { message = '动画原文未打开，请重新读取工程后重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (dialog.open && !owns()) stale(); update(); } }
  }
  fields.forEach(name => { for (const event of ['input', 'change']) el(name).addEventListener(event, () => {
    if (!canEdit()) return;
    const previous = draft.Property; capture();
    if (name === 'Property' && previous !== draft.Property) {
      const defaults = { offset2d: ['100', '0'], rotation2d: ['90', '0'], scale2d: ['2', '2'], opacity: ['0', '0'] }[draft.Property];
      if (defaults) { [draft.EndX, draft.EndY] = defaults; renderFields(); }
    }
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
    setAvailable(value, commands = []) { enabled = value === true && Array.isArray(commands) && commands.includes('animation.create'); if (dialog.open) { if (!enabled && owner) owner.invalidated = true; update(); } },
    dispose() { if (disposed) return; disposed = true; epoch++; hostBusy(false); phase = ''; owner = null; if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); },
  });
}
