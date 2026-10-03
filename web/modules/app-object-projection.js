import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { requestWorldCommand } from './app-doc-service.js';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { getProjectionTemplates, lockProjectionTemplate, deriveProjectionTemplate } from '../../engine/object-projection-template.mjs';

const objectProjectionErrors = {
  world_revision_conflict: '工程已变化。投影草稿保留，请重新读取工程并预览。',
  world_read_conflict: '工程已变化。投影草稿保留，请重新读取工程并预览。',
  world_create_path_conflict: '保存位置已被使用，请修改路径后重新预览。',
  world_create_path_invalid: '请使用正文目录内可迁移的 JSON 文件路径。',
  world_identity_conflict: '此身份已经登记，请先核对已保存内容。',
  world_type_unknown: '文档类型已变化，请重新读取工程并选择类型。',
  world_projection_invalid: '投影配置无效，请检查标出的位置。',
  world_object_not_found: '投影已不存在。草稿保留，请返回对象核对。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
  world_recovery_conflict: '工程存在未完成的提交，请先在世界与对象中恢复。',
  world_journal_invalid: '工程存在未完成的提交，请先在世界与对象中恢复。',
};
const objectProjectionCopy = value => JSON.parse(JSON.stringify(value));
const objectProjectionDigest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export function setupObjectProjection({ getContext = () => ({}), setBusy = () => {}, applied = async () => {}, closed = () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'objectProjectionDialog'; dialog.className = 'project-build scene-create object-projection';
  dialog.setAttribute('aria-labelledby', 'objectProjectionTitle');
  dialog.innerHTML = `<header class="build-heading"><div><h2 id="objectProjectionTitle" data-i18n="创建投影"></h2><p data-i18n="同一份 OC 可拥有多个独立配置。来源正文保留在原对象中。"></p></div>
    <button id="objectProjectionClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回对象"></button></header>
    <p id="objectProjectionSource" class="build-note"></p><p id="objectProjectionMessage" role="status" aria-live="polite"></p>
    <button id="objectProjectionRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <form id="objectProjectionForm" novalidate><fieldset id="objectProjectionFields"><legend data-i18n="投影设置"></legend><div id="objectProjectionSettings" class="scene-settings"></div>
      <p id="objectProjectionReuseHint" class="build-hint" data-i18n="复用现有投影时，将当前配置展开为独立子模板快照；后续修改互不覆盖。图片需重新选择。"></p>
      <p id="objectProjectionImmutable" class="build-hint" hidden data-i18n="编辑时锁定来源对象、身份、子模板、文档类型与路径；只修改标题和配置。"></p>
      <p id="objectProjectionRetention" class="build-hint" hidden data-i18n="更换或移除图片会保留旧资源绑定，以免已有场景的显式图片覆盖失效。素材原文件不会删除。"></p>
      <h3 data-i18n="投影配置"></h3><div id="objectProjectionConfiguration" class="scene-settings"></div></fieldset>
      <ul id="objectProjectionDiagnostics" class="scene-diagnostics"></ul>
      <section id="objectProjectionPreview" class="build-summary" hidden><h3 id="objectProjectionPreviewTitle" data-i18n="将创建的投影"></h3><p id="objectProjectionSummary"></p><pre id="objectProjectionContent" tabindex="0"></pre></section>
      <details><summary data-i18n="原始细节与日志"></summary><pre id="objectProjectionDetails" tabindex="0"></pre></details>
      <footer class="build-actions scene-create-actions"><button id="objectProjectionCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="预览投影"></button>
        <button id="objectProjectionSave" type="submit" class="doc-btn" data-i18n="保存投影"></button>
        <button id="objectProjectionCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer></form>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  const node = (tag, text = '', className = '') => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; };
  let enabled = false, createSupported = true, updateSupported = false, editing = false, targetId = '', pendingApply = null, world = null, sourceId = '', draft = null, preview = null, saved = false, uncertain = false;
  let busy = false, dirty = false, needsRefresh = false, message = '', details = '', diagnostics = [], opener = null, epoch = 0;
  const canWrite = () => { const current = getContext(); return enabled && (editing ? updateSupported : createSupported) && current.editable && !current.dirty && !current.creating && !current.busy; };
  const source = () => world?.objects.find(object => object.id === sourceId);
  const validSource = () => { const value = source(); return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sourceId) && value?.provenance?.identity === 'registered' && !Object.hasOwn(value.provenance, 'authoredProjection')
    && value.documentRefs?.[0]?.sourceRevision && !world.diagnostics.some(item => item.objectId === sourceId && item.severity === 'error'); };
  const target = () => world?.objects.find(object => object.id === targetId);
  const validTarget = object => object?.provenance?.authoredProjection && object.documentRefs?.[0]?.sourceRevision
    && object.revision && !world.diagnostics.some(item => item.objectId === object.id && item.severity === 'error');
  const declarationOf = object => ({ format: 'viento-object-projection', schemaVersion: 1, title: object.name, ...objectProjectionCopy(object.provenance.authoredProjection) });
  const typedConfiguration = () => Object.fromEntries(draft.snapshot.fields.map(field => [field.id, field.type === 'number' ? Number(draft.configuration[field.id]) : draft.configuration[field.id]]));
  const fixedFieldsMatch = object => object.provenance.authoredProjection.sourceObjectId === sourceId
    && canonicalJson(object.provenance.authoredProjection.template) === canonicalJson(draft.template)
    && object.documentRefs[0].sourcePath === draft.sourcePath && object.provenance.documentType === draft.documentType;
  const types = () => (world?.types || []).filter(type => type.definition?.id);
  const root = () => world?.world.sourceWorkspaceVersion === 3 ? 'documents' : 'design-data';
  const images = fieldId => (world?.resources || []).filter(resource => resource.descriptor?.kind === 'image' && resource.availability === 'present-unverified'
    && (draft?.snapshot.runtime?.image !== fieldId || /\.(png|jpe?g|webp|svg)$/i.test(resource.descriptor.location?.path || '')
      && /^[a-f0-9]{64}$/.test(resource.descriptor.content?.sha256 || '') && Number.isSafeInteger(resource.descriptor.content?.size)
      && resource.descriptor.content.size > 0 && resource.descriptor.content.size <= 32 * 1024 * 1024));
  function templates() {
    const list = getProjectionTemplates().map(snapshot => ({ key: `builtin:${snapshot.id}`, snapshot, label: `${t(snapshot.family === 'game' ? '游戏' : snapshot.family === 'literature' ? '文学' : snapshot.family === 'drama' ? '戏剧' : snapshot.family)} · ${t(snapshot.label)}` }));
    for (const object of world?.objects || []) {
      const authored = object.provenance?.authoredProjection;
      if (!authored || world.diagnostics.some(item => item.objectId === object.id && item.severity === 'error')) continue;
      try {
        const snapshot = deriveProjectionTemplate(authored.template.snapshot, authored.configuration, { id: `local.derived.p${object.id.replaceAll('-', '')}`, label: object.name });
        list.push({ key: `object:${object.id}`, snapshot, label: t('复用投影：{0}', object.name) });
      } catch { /* Invalid snapshots are never offered as templates. */ }
    }
    return list;
  }
  function values(snapshot, configuration = null) { return Object.fromEntries(snapshot.fields.map(field => { const value = configuration ? configuration[field.id] : field.default; return [field.id, field.type === 'number' ? String(value) : value]; })); }
  function change() { dirty = true; preview = null; diagnostics = []; details = ''; message = ''; update(); }
  function field(parent, { id, label, value, options, kind = 'string', min, max, maxLength, pointer, multiline = false, readOnly = false, changed = () => {} }) {
    const labelElement = node('label', '', `scene-field${kind === 'boolean' ? ' projection-checkbox' : ''}`); labelElement.htmlFor = id;
    labelElement.append(node('span', t(label)));
    const input = document.createElement(options ? 'select' : multiline ? 'textarea' : 'input'); input.id = id; if (pointer) input.dataset.pointer = pointer;
    if (options) {
      for (const [key, title] of options) { const option = node('option', title); option.value = key; input.append(option); }
      if (value && !options.some(([key]) => key === value)) { const missing = node('option', t('已不可用：{0}', value)); missing.value = value; input.append(missing); }
    } else {
      if (multiline) input.rows = 3; else input.type = kind === 'boolean' ? 'checkbox' : kind === 'number' ? 'number' : 'text';
      if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (maxLength !== undefined) input.maxLength = maxLength;
      if (kind === 'number') input.step = 'any';
    }
    if (readOnly) { if (options) input.disabled = true; else input.readOnly = true; input.setAttribute('aria-readonly', 'true'); }
    if (kind === 'boolean') input.checked = value === true; else input.value = value;
    input.addEventListener(options || kind === 'boolean' ? 'change' : 'input', () => { if (readOnly || busy || saved || uncertain) return; changed(kind === 'boolean' ? input.checked : input.value); change(); });
    labelElement.append(input); parent.append(labelElement); return input;
  }
  function renderFields() {
    const focused = document.activeElement, focusedId = focused?.id, start = focused?.selectionStart, end = focused?.selectionEnd;
    el('objectProjectionSettings').replaceChildren(); el('objectProjectionConfiguration').replaceChildren(); if (!draft) return;
    const settings = el('objectProjectionSettings');
    if (editing) {
      field(settings, { id: 'objectProjectionIdentity', label: '对象身份', value: draft.objectId, readOnly: true });
      field(settings, { id: 'objectProjectionTemplate', label: '子模板', value: `${t(draft.snapshot.label)} · ${draft.template.version}`, readOnly: true });
    } else field(settings, { id: 'objectProjectionTemplate', label: '子模板', value: draft.templateKey, options: templates().map(item => [item.key, item.label]), changed: value => {
      const item = templates().find(item => item.key === value); if (!item) return;
      draft.templateKey = value; draft.snapshot = objectProjectionCopy(item.snapshot); draft.configuration = values(item.snapshot); renderFields();
    } });
    field(settings, { id: 'objectProjectionName', label: '投影名称', value: draft.title, maxLength: 160, pointer: '/title', changed: value => { draft.title = value; } });
    field(settings, { id: 'objectProjectionType', label: '文档类型', value: draft.documentType, options: editing ? undefined : types().map(type => [type.definition.id, type.label]), readOnly: editing, changed: value => { draft.documentType = value; } });
    field(settings, { id: 'objectProjectionPath', label: '原文路径', value: draft.sourcePath, maxLength: 1024, readOnly: editing, changed: value => { draft.sourcePath = value; } });
    for (const item of draft.snapshot.fields) {
      const options = item.type === 'enum' ? item.options.map(value => [value, item.id === draft.snapshot.runtime?.controls ? t(value === 'arrows' ? '方向键' : '不接受输入') : value]) : item.type === 'image'
        ? [['', t('不使用图片')], ...images(item.id).map(resource => [resource.id, `${resource.descriptor.name} · ${resource.descriptor.location.path}`])] : undefined;
      field(el('objectProjectionConfiguration'), { id: `objectProjectionField-${item.id}`, label: item.label, value: draft.configuration[item.id], options, kind: item.type,
        multiline: item.type === 'string' && item.id !== draft.snapshot.runtime?.color && (item.limits?.maxLength ?? 4096) > 160, min: item.limits?.min, max: item.limits?.max, maxLength: item.limits?.maxLength, pointer: `/configuration/${item.id}`, changed: value => { draft.configuration[item.id] = value; } });
    }
    if (focusedId) { const replacement = el(focusedId); replacement?.focus(); if ((replacement?.type === 'text' || replacement?.tagName === 'TEXTAREA') && Number.isInteger(start)) { replacement.selectionStart = start; replacement.selectionEnd = end; } }
  }
  function validate() {
    const issues = [], issue = propertyPath => issues.push({ code: 'world_projection_invalid', propertyPath });
    if (!validSource()) issue('/sourceObjectId');
    if (!draft?.title.trim() || draft.title.length > 160 || /[\x00-\x1f]/.test(draft.title)) issue('/title');
    if (editing && (!validTarget(target()) || !fixedFieldsMatch(target()))) issue('/template');
    if (!editing && !types().some(type => type.definition.id === draft.documentType)) issues.push({ code: 'world_type_unknown' });
    if (!editing && (draft.sourcePath.length > 1024 || getCreatePathError(draft.sourcePath) || !draft.sourcePath.startsWith(`${root()}/`) || !draft.sourcePath.toLowerCase().endsWith('.json'))) issues.push({ code: 'world_create_path_invalid' });
    for (const item of draft.snapshot.fields) {
      const value = draft.configuration[item.id], at = `/configuration/${item.id}`;
      if (item.type === 'number' && (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value)) || item.limits?.min !== undefined && Number(value) < item.limits.min || item.limits?.max !== undefined && Number(value) > item.limits.max)) issue(at);
      if (item.type === 'string' && (typeof value !== 'string' || value.length > (item.limits?.maxLength ?? 4096))) issue(at);
      if (item.type === 'boolean' && typeof value !== 'boolean') issue(at);
      if (item.type === 'enum' && !item.options.includes(value)) issue(at);
      if (item.type === 'image' && value && !images(item.id).some(image => image.id === value)) issue(at);
    }
    return issues;
  }
  async function command(mode) {
    const template = editing ? objectProjectionCopy(draft.template) : await lockProjectionTemplate(draft.snapshot, { digest: objectProjectionDigest });
    const content = `${JSON.stringify({ format: 'viento-object-projection', schemaVersion: 1, title: draft.title, sourceObjectId: sourceId, template, configuration: typedConfiguration() }, null, 2)}\n`;
    const shared = { mode, worldId: world.world.id, baseRevision: world.world.revision, actorRef: { kind: 'user', id: 'local-ui' }, objectId: draft.objectId, content };
    return editing ? { command: 'projection.update', ...shared, objectRevision: draft.objectRevision, sourceRevision: draft.sourceRevision }
      : { command: 'projection.create', ...shared, documentType: draft.documentType, sourcePath: draft.sourcePath };
  }
  async function complete(result, reconciled = false) {
    saved = true; dirty = false; preview = null; uncertain = false; pendingApply = null;
    message = editing ? reconciled ? '已核对，当前保存的投影配置与提交内容一致。' : '投影配置已保存。返回对象查看，重新构建后生效。'
      : '投影已创建，可返回对象查看或在兼容场景中选用。';
    try { await applied(result); } catch (error) { message = editing ? '投影配置已保存，但目录刷新失败。请刷新核对，勿重复提交。'
      : '投影已创建，但目录刷新失败。请刷新核对，勿重复创建。'; details = error.message || ''; }
  }
  function update() {
    el('objectProjectionTitle').dataset.i18n = editing ? '编辑投影配置' : '创建投影';
    el('objectProjectionPreviewTitle').dataset.i18n = editing ? '将保存的投影' : '将创建的投影';
    el('objectProjectionCancel').dataset.i18n = editing ? '取消修改' : '取消创建';
    el('objectProjectionCheck').dataset.i18n = editing ? '预览修改' : '预览投影';
    el('objectProjectionSave').dataset.i18n = editing ? '保存修改' : '保存投影';
    el('objectProjectionReuseHint').hidden = editing; el('objectProjectionImmutable').hidden = !editing; el('objectProjectionRetention').hidden = !editing;
    translatePage(dialog); dialog.dataset.dirty = String(dirty && !saved); dialog.setAttribute('aria-busy', String(busy));
    el('objectProjectionSource').textContent = source() ? t('来源对象：{0}', source().name) : t('来源对象已不可用，请重新读取工程。');
    el('objectProjectionFields').disabled = busy || saved || uncertain;
    el('objectProjectionRefresh').disabled = busy || saved; el('objectProjectionClose').disabled = busy; el('objectProjectionCancel').disabled = busy;
    el('objectProjectionCheck').disabled = busy || saved || uncertain || needsRefresh || !canWrite() || !draft || !validSource();
    el('objectProjectionSave').disabled = busy || saved || uncertain || needsRefresh || !canWrite() || !preview;
    el('objectProjectionMessage').textContent = t(message); el('objectProjectionDetails').textContent = details;
    el('objectProjectionPreview').hidden = !preview; el('objectProjectionContent').textContent = preview?.result.changes?.[0]?.afterText || preview?.request.content || '';
    el('objectProjectionSummary').textContent = preview ? `${draft.title} · ${draft.sourcePath}` : '';
    el('objectProjectionDiagnostics').replaceChildren();
    for (const item of diagnostics) {
      const text = t(objectProjectionErrors[item.code] || '投影配置无效，请检查标出的位置。'), row = node('li');
      const target = [...dialog.querySelectorAll('[data-pointer]')].find(input => input.dataset.pointer === item.propertyPath);
      if (target) { const button = node('button', `${text} ${item.propertyPath}`, 'doc-btn doc-btn-ghost'); button.type = 'button'; button.addEventListener('click', () => target.focus()); row.append(button); }
      else row.textContent = `${text}${item.propertyPath ? ` ${item.propertyPath}` : ''}`;
      el('objectProjectionDiagnostics').append(row);
    }
  }
  async function read() {
    if (busy || saved || !canWrite()) return;
    const generation = ++epoch; preview = null; needsRefresh = true; busy = true; setBusy(true); message = '正在读取投影子模板与来源对象…'; update();
    try {
      const { payload } = await fetchJsonApiRequest(WORLD_API_PATH, { cache: 'no-store' }, 45000, t('读取世界'));
      if (generation !== epoch) return; world = payload;
      if (![2, 3].includes(world.world?.sourceWorkspaceVersion)) throw new Error('Unsupported workspace');
      needsRefresh = false; diagnostics = []; details = '';
      if (editing) {
        const object = target();
        if (!validTarget(object)) throw Object.assign(new Error('The projection is missing or invalid'), { payload: { errorCode: object ? 'world_projection_invalid' : 'world_object_not_found' } });
        const authored = object.provenance.authoredProjection;
        if (!draft) {
          sourceId = authored.sourceObjectId;
          draft = { objectId: object.id, documentType: object.provenance.documentType, sourcePath: object.documentRefs[0].sourcePath,
            objectRevision: object.revision, sourceRevision: object.documentRefs[0].sourceRevision, title: object.name,
            template: objectProjectionCopy(authored.template), snapshot: objectProjectionCopy(authored.template.snapshot), configuration: values(authored.template.snapshot, authored.configuration) };
        } else if (!fixedFieldsMatch(object)) {
          needsRefresh = true; message = '投影的来源、模板或位置已变化。草稿保留，请返回对象重新打开。'; renderFields(); return;
        }
        if (uncertain && pendingApply && canonicalJson(declarationOf(object)) === canonicalJson(JSON.parse(pendingApply.content))) {
          renderFields(); await complete({ status: 'applied', revision: world.world.revision, object,
            changes: [{ kind: 'projection.update', sourcePath: draft.sourcePath }] }, true); return;
        }
        const wasUncertain = uncertain;
        draft.objectRevision = object.revision; draft.sourceRevision = object.documentRefs[0].sourceRevision;
        uncertain = false; pendingApply = null;
        message = wasUncertain ? '当前保存内容与上次提交不同。草稿保留，请核对后重新预览。' : '修改标题或配置后预览，确认原文与图片绑定再保存。';
        renderFields(); return;
      }
      if (!draft) {
        const first = templates()[0], type = types().find(type => type.definition.id === 'document') || types()[0];
        if (!first) throw new Error('No projection templates');
        const base = `${root()}/projections/new-projection`; let sourcePath = `${base}.json`, suffix = 2;
        while (world.objects.some(object => object.documentRefs?.[0]?.sourcePath === sourcePath)) sourcePath = `${base}-${suffix++}.json`;
        draft = { objectId: crypto.randomUUID(), documentType: type?.definition.id || '', sourcePath,
          title: t('{0}的投影', source()?.name || ''), templateKey: first.key, snapshot: objectProjectionCopy(first.snapshot), configuration: values(first.snapshot) };
      }
      uncertain = world.objects.some(object => object.id === draft.objectId);
      message = uncertain ? '此身份已经登记，请先核对已保存内容。' : '配置投影后预览，确认来源与子模板再保存。'; renderFields();
    } catch (error) { needsRefresh = true; message = objectProjectionErrors[error.payload?.errorCode] || '无法读取工程，投影草稿保留，请重试。'; details = error.message || ''; }
    finally { if (generation === epoch) { busy = false; setBusy(false); update(); } }
  }
  async function run(mode) {
    if (busy || saved || uncertain || needsRefresh || !draft || !canWrite() || mode === 'apply' && !preview) return;
    diagnostics = validate(); if (diagnostics.length) { preview = null; message = '投影配置无效，请检查标出的位置。'; update(); return; }
    busy = true; setBusy(true); message = mode === 'preview' ? '正在预览投影…' : editing ? '正在保存投影配置与图片绑定…' : '正在保存投影与来源关系…'; details = ''; update();
    try {
      const request = mode === 'apply' ? { ...objectProjectionCopy(preview.request), mode } : await command(mode);
      if (mode === 'apply') pendingApply = objectProjectionCopy(request);
      const result = await requestWorldCommand(request);
      if (mode === 'preview') { preview = { request: objectProjectionCopy(request), result }; message = '投影预览已就绪。确认后保存投影。'; }
      else await complete(result);
    } catch (error) {
      preview = null; const payload = error.payload?.data || error.payload || {}, code = payload.errorCode || error.payload?.errorCode || error.errorCode;
      diagnostics = payload.diagnostics || error.payload?.diagnostics || []; details = [error.message, ...diagnostics.map(item => JSON.stringify(item))].filter(Boolean).join('\n');
      message = objectProjectionErrors[code] || '投影请求未完成。草稿保留，请重新读取工程核对保存结果。';
      needsRefresh = ['world_revision_conflict', 'world_read_conflict', 'world_type_unknown'].includes(code);
      if (mode === 'apply') {
        uncertain = !['world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_projection_invalid', 'world_object_not_found', 'world_create_path_invalid', 'world_create_path_conflict'].includes(code);
        if (!uncertain) pendingApply = null;
      }
      if (code === 'world_object_not_found') needsRefresh = true;
    } finally { busy = false; setBusy(false); update(); el(preview ? 'objectProjectionSave' : saved ? 'objectProjectionClose' : 'objectProjectionCheck').focus(); }
  }
  function close() {
    if (busy || dirty && !saved && !window.confirm(t('有未保存的投影设置，确定丢弃？'))) return;
    draft = null; preview = null; pendingApply = null; dirty = false; diagnostics = []; update(); dialog.close();
  }
  el('objectProjectionClose').addEventListener('click', close); el('objectProjectionCancel').addEventListener('click', close);
  el('objectProjectionRefresh').addEventListener('click', () => void read()); el('objectProjectionCheck').addEventListener('click', () => void run('preview'));
  el('objectProjectionForm').addEventListener('submit', event => { event.preventDefault(); void run('apply'); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.addEventListener('close', () => { if (!dialog.open) { opener?.focus(); closed(); } });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  onLanguageChange(() => { if (dialog.open) { renderFields(); update(); } });
  return { setAvailable(value, commands = ['projection.create']) {
    enabled = value === true; createSupported = commands.includes('projection.create'); updateSupported = commands.includes('projection.update'); if (dialog.open) update();
  }, open(objectId, options = {}) {
    if (dialog.open) return false;
    editing = options.mode === 'edit'; if (!canWrite()) return false;
    targetId = editing ? objectId : ''; sourceId = editing ? '' : objectId; pendingApply = null;
    opener = document.activeElement; world = null; draft = null; preview = null; saved = false; uncertain = false; dirty = false; needsRefresh = false;
    message = ''; details = ''; diagnostics = []; renderFields(); update(); dialog.showModal(); void read(); return true;
  } };
}
