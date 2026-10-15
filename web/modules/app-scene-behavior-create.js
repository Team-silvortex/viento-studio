import { canonicalJson } from '../../engine/canonical-json.mjs';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const behaviorProfiles = Object.freeze([
  Object.freeze({ id: 'godot-gdscript', label: 'Godot 4 / GDScript', backendId: 'org.viento.godot4', language: 'gdscript' }),
  Object.freeze({ id: 'bevy-rust', label: 'Bevy / Rust', backendId: 'org.viento.bevy-rust', language: 'rust' }),
]);

// Creation owns a local declaration and a single reviewed transaction. Source
// navigation, world authority and author-file writes belong to injected ports.
export function setupSceneBehaviorCreate({ getContext = () => ({}), setBusy = () => {}, inspect = async () => null,
  command = async () => null, applied = async () => {}, openSource = async () => false } = {}) {
  if (!document.getElementById('sceneBehaviorCreateStyle')) {
    const link = document.createElement('link'); link.id = 'sceneBehaviorCreateStyle'; link.rel = 'stylesheet'; link.href = '/web/scene-behavior-create.css';
    (document.head || document.body).append(link);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneBehaviorCreateDialog'; dialog.className = 'scene-behavior-create-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneBehaviorCreateTitle');
  dialog.innerHTML = `<header class="scene-behavior-create-header"><h2 id="sceneBehaviorCreateTitle" data-i18n="为场景添加行为"></h2><button id="sceneBehaviorCreateClose" class="doc-btn doc-btn-ghost" type="button" data-i18n="返回构建"></button></header>
    <div class="scene-behavior-create-body"><p data-i18n="为已保存场景创建多条实例与脚本绑定，并一起登记行为文档和关联关系。此操作不运行脚本。"></p>
    <p id="sceneBehaviorCreateScene" class="scene-behavior-create-note"></p><p data-i18n="整份行为文档使用所选后端与语言。请选择与脚本内容一致的选项；创建无需安装对应工具链，参数与信号可在保存后设置。"></p>
    <button id="sceneBehaviorCreateRefresh" class="doc-btn doc-btn-ghost" type="button" data-i18n="重新读取工程"></button>
    <p id="sceneBehaviorCreateEmpty" data-i18n="没有可用的已登记 TXT 脚本。请返回主编辑器，新建并保存 TXT 文档后再添加行为。" hidden></p>
    <fieldset id="sceneBehaviorCreateFields" hidden><legend data-i18n="行为文档设置"></legend><div class="scene-behavior-create-grid">
      <label class="scene-behavior-create-profile"><span data-i18n="行为后端与脚本语言"></span><select id="sceneBehaviorCreateProfile"></select></label>
      <label><span data-i18n="文档类型"></span><select id="sceneBehaviorCreateType"></select></label>
      <label><span data-i18n="原文路径"></span><input id="sceneBehaviorCreatePath" type="text" maxlength="1024" spellcheck="false" /></label>
      </div><h3 data-i18n="行为绑定清单"></h3><p id="sceneBehaviorCreateBindingCount" class="scene-behavior-create-note"></p>
      <div class="scene-behavior-create-bindings"><div class="scene-behavior-create-binding-list">
        <label><span data-i18n="选择要编辑的绑定"></span><select id="sceneBehaviorCreateBindingList" size="5"></select></label>
        <div class="scene-behavior-create-binding-actions"><button id="sceneBehaviorCreateAddBinding" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加行为绑定"></button><button id="sceneBehaviorCreateRemoveBinding" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除选中绑定"></button></div>
      </div><div class="scene-behavior-create-grid">
      <label><span data-i18n="场景实例"></span><select id="sceneBehaviorCreateInstance"></select></label>
      <label><span data-i18n="已登记脚本"></span><select id="sceneBehaviorCreateSource"></select></label></div>
      </div><p class="scene-behavior-create-note" data-i18n="每条绑定拥有独立身份；可复用同一脚本，也可为同一实例添加多个行为。新增时优先选择尚未分配的实例。"></p>
      <p id="sceneBehaviorCreateIdentity" class="scene-behavior-create-note"></p></fieldset>
    <section id="sceneBehaviorCreateReview" hidden><h3 data-i18n="创建行为审阅"></h3><p data-i18n="保存会新建下列完整原文和文档登记，并更新场景登记中的行为关系；场景正文与脚本正文保持原样。"></p>
      <h4 data-i18n="将登记的关系"></h4><ul id="sceneBehaviorCreateRelations"></ul><h4 data-i18n="将创建的完整原文"></h4><pre id="sceneBehaviorCreateSourceText" tabindex="0"></pre></section></div>
    <div class="scene-behavior-create-feedback"><p id="sceneBehaviorCreateStatus" role="status" aria-live="polite"></p><p id="sceneBehaviorCreateDetails" class="scene-behavior-create-note"></p></div>
    <footer class="scene-behavior-create-footer"><button id="sceneBehaviorCreateCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅新行为"></button><button id="sceneBehaviorCreateSave" type="button" class="doc-btn" data-i18n="保存行为与关系"></button><button id="sceneBehaviorCreateOpen" type="button" class="doc-btn" data-i18n="打开行为原文" hidden></button><button id="sceneBehaviorCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneBehaviorCreate' + suffix);
  const clone = value => JSON.parse(JSON.stringify(value));
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const text = (value, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => { const d = Object.getOwnPropertyDescriptor(value, key); return d?.enumerable && Object.hasOwn(d, 'value'); });
  const digest = async value => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
  const fail = key => { throw Object.assign(new Error(t(key)), { uiKey: key }); };
  let enabled = false, supported = false, disposed = false, epoch = 0, owner = null, catalog = null, draft = null, baseline = '', preview = null;
  let phase = '', dirty = false, saved = null, refreshed = false, uncertain = false, needsRefresh = false, opener = null, message = '', details = '';
  let selectedBindingId = '';
  const fields = ['Profile', 'Type', 'Path', 'Instance', 'Source'];
  const selectedBinding = () => draft?.bindings.find(binding => binding.bindingId === selectedBindingId);
  const bindingFields = () => ({ instanceId: el('Instance').value, sourceObjectId: el('Source').value });
  const raw = () => ({ Profile: el('Profile').value, Type: el('Type').value, Path: el('Path').value,
    bindings: (draft?.bindings || []).map(binding => ({ ...binding, ...(binding.bindingId === selectedBindingId ? bindingFields() : {}) })) });
  const signature = () => JSON.stringify(raw());
  const eligible = () => { const c = getContext(); return Boolean(!disposed && enabled && supported && c.editable && !c.dirty && !c.creating && !c.busy && c.visible === true && uuid(c.sceneId) && typeof c.session === 'string'); };
  const owns = (generation = epoch, afterSave = Boolean(saved)) => {
    const c = getContext(); return generation === epoch && dialog.open && owner && !owner.invalidated && eligible() && c.session === owner.session && c.sceneId === owner.sceneId
      && (afterSave || c.sourceToken === owner.sourceToken);
  };
  const canChange = () => !phase && !saved && !uncertain && !needsRefresh && catalog && draft && owns();
  const approval = () => preview && signature() === preview.signature;
  function invalidate() { preview = null; dirty = Boolean(draft && signature() !== baseline); message = '行为尚未保存，请先审阅原文与关系。'; details = ''; }
  function capture() { if (draft) Object.assign(draft, raw()); }
  function options(select, values, value) {
    select.replaceChildren();
    if (!values.some(([id]) => id === value)) { const placeholder = document.createElement('option'); placeholder.value = value || ''; placeholder.textContent = value ? t('已不可用：{0}', value) : t('请选择'); select.append(placeholder); }
    for (const [id, label] of values) { const item = document.createElement('option'); item.value = id; item.textContent = label; select.append(item); }
    select.value = value;
  }
  function renderBindingList() {
    if (!draft || !catalog) return;
    options(el('BindingList'), draft.bindings.map((binding, index) => {
      const instance = catalog.scene.instances.find(item => item.instanceId === binding.instanceId);
      const source = catalog.sources.find(item => item.objectId === binding.sourceObjectId);
      return [binding.bindingId, `${index + 1}. ${instance?.name || t('已不可用：{0}', binding.instanceId)} · ${source?.name || (binding.sourceObjectId ? t('已不可用：{0}', binding.sourceObjectId) : t('请选择'))}`];
    }), selectedBindingId);
  }
  function renderFields() {
    if (!draft || !catalog) return;
    options(el('Profile'), behaviorProfiles.map(item => [item.id, item.label]), draft.Profile);
    options(el('Type'), catalog.documentTypes.map(item => [item.id, item.label]), draft.Type); el('Path').value = draft.Path;
    const binding = selectedBinding();
    options(el('Instance'), catalog.scene.instances.map(item => [item.instanceId, `${item.name} · ${item.instanceId}`]), binding?.instanceId || '');
    options(el('Source'), catalog.sources.map(item => [item.objectId, `${item.name} · ${item.sourcePath}`]), binding?.sourceObjectId || '');
    renderBindingList();
  }
  function selectBinding() {
    if (!canChange()) { el('BindingList').value = selectedBindingId; return; }
    const next = draft.bindings.find(binding => binding.bindingId === el('BindingList').value); if (!next) return;
    capture(); selectedBindingId = next.bindingId; renderFields(); update();
  }
  function addBinding() {
    if (!canChange() || !catalog.sources.length || draft.bindings.length >= SCENE_BEHAVIOR_LIMITS.bindings) return;
    capture(); const previous = selectedBinding(), used = new Set(draft.bindings.map(binding => binding.instanceId));
    let bindingId; try { bindingId = crypto.randomUUID(); } catch { return; }
    if (!uuid(bindingId) || bindingId === draft.objectId || draft.bindings.some(binding => binding.bindingId === bindingId)) return;
    const instance = catalog.scene.instances.find(item => !used.has(item.instanceId))
      || catalog.scene.instances.find(item => item.instanceId === previous?.instanceId) || catalog.scene.instances[0];
    draft.bindings.push({ bindingId, instanceId: instance.instanceId, sourceObjectId: previous?.sourceObjectId || catalog.sources[0].objectId });
    selectedBindingId = bindingId; renderFields(); invalidate(); update(); el('Instance').focus();
  }
  function removeBinding() {
    if (!canChange() || draft.bindings.length <= 1) return;
    capture(); const index = draft.bindings.findIndex(binding => binding.bindingId === selectedBindingId); if (index < 0) return;
    draft.bindings.splice(index, 1); selectedBindingId = draft.bindings[Math.min(index, draft.bindings.length - 1)].bindingId;
    renderFields(); invalidate(); update(); el('BindingList').focus();
  }
  const referenceIds = requested => [...new Set([requested.sceneObjectId,
    ...JSON.parse(requested.content).bindings.map(binding => binding.implementation.sourceObjectId)])].sort();
  function update() {
    if (disposed) return;
    translatePage(dialog); dialog.dataset.dirty = String(!saved && (dirty || draft && signature() !== baseline)); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    el('Fields').hidden = !catalog; el('Fields').disabled = !canChange();
    for (const name of fields) el(name).disabled = !canChange();
    el('BindingList').disabled = !canChange();
    el('AddBinding').disabled = !canChange() || !catalog.sources.length || draft.bindings.length >= SCENE_BEHAVIOR_LIMITS.bindings;
    el('RemoveBinding').disabled = !canChange() || draft.bindings.length <= 1;
    el('BindingCount').textContent = draft ? t('绑定 {0}/{1} · 脚本 {2}/{3}；至少保留一条绑定。', draft.bindings.length, SCENE_BEHAVIOR_LIMITS.bindings, new Set(raw().bindings.map(binding => binding.sourceObjectId).filter(Boolean)).size, SCENE_BEHAVIOR_LIMITS.sources) : '';
    el('Empty').hidden = !catalog || catalog.sources.length > 0;
    el('Scene').textContent = catalog ? t('场景：{0} · {1}', catalog.scene.sourcePath, catalog.scene.objectId) : '';
    el('Identity').textContent = draft ? t('新文档身份：{0} · 绑定身份：{1}', draft.objectId, selectedBindingId) : '';
    el('Check').disabled = !canChange() || !catalog.sources.length;
    el('Save').disabled = !canChange() || !approval();
    el('Open').hidden = !saved; el('Open').disabled = Boolean(phase) || !saved || !refreshed || !owns();
    el('Check').hidden = Boolean(saved); el('Save').hidden = Boolean(saved);
    el('Refresh').disabled = Boolean(phase) || !owns();
    el('Close').disabled = Boolean(phase); el('Cancel').disabled = Boolean(phase);
    el('Review').hidden = !preview; el('SourceText').textContent = preview?.request.content || '';
    el('Relations').replaceChildren();
    if (preview) for (const [from, kind, to] of [[catalog.scene.objectId, 'behavior', draft.objectId], ...referenceIds(preview.request).map(targetId => [draft.objectId, 'references', targetId])]) {
      const item = document.createElement('li'); item.textContent = `${from} → ${kind} → ${to}`; el('Relations').append(item);
    }
    el('Status').textContent = t(message); el('Details').textContent = details;
  }
  function validateCatalog(value) {
    if (!exact(value, ['format', 'schemaVersion', 'worldId', 'baseRevision', 'documentRoot', 'documentTypes', 'scene', 'sources'])
      || value.format !== 'viento-behavior-creation-context' || value.schemaVersion !== 1 || !text(value.worldId, 200) || !revision(value.baseRevision)
      || !text(value.documentRoot, 900) || getCreatePathError(`${value.documentRoot}/manifest.json`)
      || !Array.isArray(value.documentTypes) || !value.documentTypes.length || value.documentTypes.length > 256
      || !exact(value.scene, ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision', 'instances']) || value.scene.objectId !== owner.sceneId
      || !revision(value.scene.objectRevision) || !revision(value.scene.sourceRevision) || !text(value.scene.sourcePath, 1024)
      || !Array.isArray(value.scene.instances) || !value.scene.instances.length || value.scene.instances.length > 128
      || !Array.isArray(value.sources) || value.sources.length > 256) fail('无法核对行为创建目录，请返回工程检查。');
    if (value.documentTypes.some(item => !exact(item, ['id', 'label']) || !/^[a-z][a-z0-9_-]{0,63}$/.test(item.id) || !text(item.label))
      || new Set(value.documentTypes.map(item => item.id)).size !== value.documentTypes.length
      || value.scene.instances.some(item => !exact(item, ['instanceId', 'objectId', 'name']) || !uuid(item.instanceId) || !uuid(item.objectId) || !text(item.name))
      || new Set(value.scene.instances.map(item => item.instanceId)).size !== value.scene.instances.length
      || value.sources.some(item => !exact(item, ['objectId', 'sourcePath', 'sourceRevision', 'name']) || !uuid(item.objectId) || !text(item.name) || !revision(item.sourceRevision)
        || !text(item.sourcePath, 1024) || !/\.txt$/i.test(item.sourcePath) || !item.sourcePath.startsWith(value.documentRoot + '/') || getCreatePathError(item.sourcePath))
      || new Set(value.sources.map(item => item.objectId)).size !== value.sources.length || new Set(value.sources.map(item => item.sourcePath)).size !== value.sources.length) fail('无法核对行为创建目录，请返回工程检查。');
    return clone(value);
  }
  function request() {
    capture();
    if (!catalog.documentTypes.some(item => item.id === draft.Type) || draft.bindings.some(binding => !catalog.scene.instances.some(item => item.instanceId === binding.instanceId)
      || !catalog.sources.some(item => item.objectId === binding.sourceObjectId))) fail('请选择当前工程中的文档类型、实例和脚本。');
    if (!text(draft.Path, 1024) || !draft.Path.startsWith(catalog.documentRoot + '/') || !/\.json$/i.test(draft.Path) || getCreatePathError(draft.Path)) fail('请使用正文目录内可迁移的 JSON 文件路径。');
    const profile = behaviorProfiles.find(item => item.id === draft.Profile);
    if (!profile) fail('请选择已支持的行为后端与脚本语言。');
    const planned = createSceneBehaviorCreationDraft({ sceneObjectId: catalog.scene.objectId, backendId: profile.backendId, language: profile.language, bindings: draft.bindings });
    if (!planned.ok) fail('行为绑定设置无效，请检查独立绑定身份，以及最多 32 条绑定和 8 份脚本的限制。');
    const content = planned.content;
    return { command: 'behavior.create', mode: 'preview', worldId: catalog.worldId, baseRevision: catalog.baseRevision, actorRef: { kind: 'user', id: 'studio-behavior-create' },
      objectId: draft.objectId, documentType: draft.Type, sourcePath: draft.Path, content, sceneObjectId: catalog.scene.objectId,
      sceneObjectRevision: catalog.scene.objectRevision, sceneSourceRevision: catalog.scene.sourceRevision };
  }
  function validateResult(result, requested, sourceRevision) {
    const first = result?.changes?.[0], relation = result?.changes?.[1], reference = result?.object?.documentRefs?.[0];
    const input = { ...requested }; delete input.mode;
    const expectedRelations = referenceIds(requested)
      .map(targetId => ({ kind: 'references', targetId, slot: '' }));
    if (result?.status !== (requested.mode === 'apply' ? 'applied' : 'preview') || result.worldId !== requested.worldId || result.baseRevision !== requested.baseRevision || !revision(result.revision)
      || !Array.isArray(result.changes) || result.changes.length !== 2 || first?.kind !== 'behavior.create' || first.objectId !== requested.objectId || first.sourcePath !== requested.sourcePath
      || first.beforeText !== null || first.beforeSourceRevision !== null || first.afterText !== requested.content || first.afterSourceRevision !== sourceRevision
      || first.recordPath !== `metadata/documents/${requested.objectId}.json` || first.record?.id !== requested.objectId || first.record.sourcePath !== requested.sourcePath
      || first.record.documentType !== requested.documentType || canonicalJson(first.record.relations) !== canonicalJson(expectedRelations)
      || result.object?.id !== requested.objectId || reference?.sourcePath !== requested.sourcePath || reference.sourceRevision !== sourceRevision
      || relation?.kind !== 'relation.add' || relation.objectId !== requested.sceneObjectId || relation.sourcePath !== catalog.scene.sourcePath
      || relation.targetObjectId !== requested.objectId || relation.targetSourcePath !== requested.sourcePath
      || canonicalJson(relation.relation) !== canonicalJson({ kind: 'behavior', targetId: requested.objectId, slot: '' })
      || result.proposal?.commands?.[0]?.id !== 'behavior.create' || canonicalJson(result.proposal.commands[0].input) !== canonicalJson(input)) fail('行为保存回执不匹配，请重新核对工程，勿重复创建。');
    return clone(result);
  }
  async function synchronize(generation) {
    try { await applied(saved.result); if (!owns(generation, true)) return; refreshed = true; message = '行为与关系已保存。打开原文后可继续编辑参数和信号。'; }
    catch (error) { if (owns(generation, true)) { message = '行为已保存，但目录刷新失败。请重新读取工程，勿重复创建。'; details = error.message || ''; } }
  }
  async function read() {
    if (phase || !owns()) return; capture(); const generation = epoch; phase = 'read'; setBusy(true); message = '正在读取行为创建目录…'; details = ''; update();
    try {
      if (saved) await synchronize(generation);
      else {
        const result = await inspect({ sceneObjectId: owner.sceneId }); if (!owns(generation)) return;
        const next = validateCatalog(result); catalog = next; preview = null; needsRefresh = false;
        if (!draft) {
          draft = { objectId: crypto.randomUUID(), Profile: behaviorProfiles[0].id, Type: next.documentTypes[0].id,
            Path: `${next.documentRoot}/behaviors/new-behavior.json`, bindings: [{ bindingId: crypto.randomUUID(), instanceId: next.scene.instances[0].instanceId, sourceObjectId: next.sources[0]?.objectId || '' }] };
          selectedBindingId = draft.bindings[0].bindingId;
          renderFields(); baseline = signature();
        } else renderFields();
        message = uncertain ? '保存结果尚未确认，请核对工程中的行为文档与关系，勿重复创建。' : '选择实例和脚本后，审阅新文档与关联关系。';
      }
    } catch (error) { if (owns(generation)) { needsRefresh = true; preview = null; message = error.uiKey || '无法读取工程，行为设置已保留，请重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; setBusy(false); update(); } }
  }
  async function run(mode) {
    if (!canChange() || mode === 'apply' && !approval()) { if (!phase && preview && !approval()) { invalidate(); update(); } return; }
    let requested; try { requested = mode === 'apply' ? { ...clone(preview.request), mode } : request(); } catch (error) { preview = null; message = error.uiKey; update(); return; }
    const generation = epoch, inputSignature = signature(); phase = mode; setBusy(true); details = ''; message = mode === 'apply' ? '正在保存行为文档与关系…' : '正在审阅行为文档与关系…'; update();
    let submitted = false;
    try {
      const sourceRevision = await digest(requested.content); if (!owns(generation) || signature() !== inputSignature) return;
      submitted = true; const result = await command(requested); if (!owns(generation) || signature() !== inputSignature) { if (mode === 'apply') uncertain = true; return; }
      const valid = validateResult(result, requested, sourceRevision);
      if (mode === 'preview') { preview = { request: clone(requested), signature: inputSignature }; message = '行为创建已审阅，请确认完整原文与全部关联关系后保存。'; }
      else { saved = { result: valid, sourcePath: requested.sourcePath, sourceRevision }; dirty = false; uncertain = false; preview = null; await synchronize(generation); }
    } catch (error) {
      if (generation !== epoch || disposed) return;
      preview = null; const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
      const known = ['world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_behavior_invalid', 'world_create_path_invalid', 'world_create_path_conflict'];
      needsRefresh = ['world_revision_conflict', 'world_read_conflict', 'world_type_unknown'].includes(code);
      if (mode === 'apply' && submitted && !known.includes(code)) uncertain = true;
      message = uncertain ? '保存结果尚未确认，请核对工程中的行为文档与关系，勿重复创建。'
        : needsRefresh ? '工程已变化。行为设置已保留，请重新读取工程并审阅。' : error.uiKey || '行为请求未完成。设置已保留，请检查后重试。'; details = error.message || '';
    } finally {
      if (generation === epoch && !disposed) {
        phase = ''; setBusy(false);
        if (!owns() && !saved) { preview = null; needsRefresh = true; message = '来源或会话已变化，请返回构建后重新打开行为创建。'; }
        else if (!saved && signature() !== inputSignature) { preview = null; message = uncertain ? '保存结果尚未确认，请核对工程中的行为文档与关系，勿重复创建。' : '行为尚未保存，请先审阅原文与关系。'; }
        update();
      }
    }
  }
  function close() {
    if (phase) return false;
    if (!saved && draft && (dirty || signature() !== baseline) && !window.confirm(t('丢弃本次行为创建设置？尚未提交的内容不会写入工程。'))) return false;
    epoch++; owner = null; catalog = null; draft = null; preview = null; dirty = false; dialog.dataset.dirty = 'false'; dialog.close(); return true;
  }
  async function navigate() {
    if (phase || !saved || !refreshed || !owns()) return;
    const generation = epoch; phase = 'open'; update();
    try {
      const result = await openSource(saved.sourcePath, { sourceRevision: saved.sourceRevision });
      if (generation !== epoch || disposed) return;
      if (result !== false) { phase = ''; close(); result?.focus?.(); }
      else { message = '行为已保存，但原文未打开。请返回编辑器按路径查找。'; }
    } catch (error) { if (generation === epoch && !disposed) { message = '行为已保存，但原文未打开。请返回编辑器按路径查找。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; update(); } }
  }
  for (const key of fields) for (const event of ['input', 'change']) el(key).addEventListener(event, () => { if (canChange()) { capture(); renderBindingList(); invalidate(); update(); } });
  el('BindingList').addEventListener('change', selectBinding); el('AddBinding').addEventListener('click', addBinding); el('RemoveBinding').addEventListener('click', removeBinding);
  el('Check').addEventListener('click', () => void run('preview')); el('Save').addEventListener('click', () => void run('apply'));
  el('Refresh').addEventListener('click', () => void read()); el('Open').addEventListener('click', () => void navigate());
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && !disposed) opener?.focus(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  const unsubscribe = onLanguageChange(() => { if (dialog.open && !disposed) { capture(); renderFields(); update(); } });
  return Object.freeze({
    open(sceneId) {
      if (dialog.open || !eligible() || getContext().sceneId !== sceneId) return false;
      epoch++; const context = getContext(); owner = { session: context.session, sceneId, sourceToken: context.sourceToken }; opener = document.activeElement;
      catalog = null; draft = null; selectedBindingId = ''; preview = null; saved = null; refreshed = false; uncertain = false; needsRefresh = false; dirty = false; baseline = ''; phase = ''; message = ''; details = '';
      dialog.showModal(); update(); void read(); return true;
    },
    setAvailable(value, commands = []) { enabled = value === true; supported = Array.isArray(commands) && commands.includes('behavior.create'); if (dialog.open) { if (!enabled || !supported) { preview = null; if (owner) owner.invalidated = true; } update(); } },
    dispose() { if (disposed) return; disposed = true; epoch++; if (phase && phase !== 'open') setBusy(false); phase = ''; owner = null; if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); },
  });
}
