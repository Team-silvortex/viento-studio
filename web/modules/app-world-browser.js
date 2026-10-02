import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { WORLD_API_PATH, queryWorldProjection } from '../../engine/world-query.mjs';
import { canSetObjectProperty, canRelateObject, MAX_CHANGESET_COMMANDS } from '../../engine/world-command-contract.mjs';
import { requestWorldCommand } from './app-doc-service.js';

const diagnosticLabels = {
  'unregistered-document': '尚未登记身份；改名后身份会变化',
  'unknown-document-type': '未知类型，按通用文档展示',
  'source-unavailable': '原文缺失或无法读取',
  'unparsed-document': '无法解析字段，请检查原文',
  'unmapped-fields': '部分字段保留在原文中',
  'relation-target-missing': '关系目标缺失',
  'resource-target-missing': '素材登记缺失',
  'resource-unavailable': '素材缺失或需要检查',
};

export function setupWorldBrowser({ getContext = () => ({}), setBusy = () => {}, applied = async () => {} } = {}) {
  const button = document.getElementById('worldBrowserBtn');
  if (!button) return { setAvailable() {} };
  const dialog = document.createElement('dialog');
  dialog.className = 'world-browser'; dialog.id = 'worldBrowserDialog';
  dialog.setAttribute('aria-labelledby', 'worldBrowserTitle');
  dialog.innerHTML = `<header class="world-heading"><div><p class="world-eyebrow">WORLD</p><h2 id="worldBrowserTitle" data-i18n="世界与对象"></h2><p id="worldName"></p></div>
    <div class="world-actions"><button type="button" id="worldRefresh" class="doc-btn doc-btn-ghost" data-i18n="刷新"></button><button type="button" id="worldClose" class="doc-btn" data-i18n="返回编辑器"></button></div></header>
    <p class="world-note" data-i18n="只显示已保存内容。编辑模式下可创建对象、修改属性、添加关系或绑定资源。"></p>
    <p id="worldStatus" role="status" aria-live="polite"></p>
    <p id="worldCommandStatus" role="status" aria-live="polite"></p>
    <button type="button" id="worldRecover" class="doc-btn" data-i18n="恢复未完成的提交" hidden></button>
    <section id="worldBatch" class="world-batch" aria-labelledby="worldBatchTitle" hidden></section>
    <div class="world-layout"><section class="world-object-browser" aria-labelledby="worldObjectsTitle"><h3 id="worldObjectsTitle" data-i18n="对象"></h3>
      <button type="button" id="worldCreate" class="doc-btn" data-i18n="创建对象" hidden></button>
      <label for="worldSearch" data-i18n="搜索对象"></label><input id="worldSearch" type="search" data-i18n-placeholder="名称、身份或原文路径" autocomplete="off" />
      <div id="worldObjects" class="world-object-list"></div></section>
      <section id="worldInspector" class="world-inspector" aria-labelledby="worldObjectName"></section></div>
    <details class="world-diagnostics"><summary id="worldDiagnosticSummary"></summary><ul id="worldDiagnostics"></ul></details>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  let projection = null, selectedId = '', generation = 0, busy = false, failed = false, writable = false, draft = null, notice = '';
  let batchSupported = false, recoverySupported = false, recoveryNeeded = false, queued = [], batchPreview = null;
  let createSupported = false, creation = null;
  let relationSupported = false, relationDraft = null;
  let resourceSupported = false, resourceDraft = null;
  const dirty = () => Boolean(creation || relationDraft || resourceDraft || draft && draft.value !== draft.original);
  const canDiscard = (all = false) => !(dirty() || all && queued.length) || window.confirm(t('有未保存的对象修改，确定丢弃？'));
  const canWrite = () => {
    const context = getContext();
    return context.editable && !context.dirty && !context.creating && !context.busy;
  };
  const canEdit = () => writable && canWrite();
  const createTypes = () => (projection?.types || []).filter(type => type.definition.id);
  const canCreate = () => createSupported && canWrite() && projection && [2, 3].includes(projection.world.sourceWorkspaceVersion)
    && createTypes().length > 0 && !queued.length;
  const relationTargets = id => (projection?.objects || []).filter(object => object.id !== id && canRelateObject(object));
  const canAddRelation = object => relationSupported && canWrite() && canRelateObject(object) && !queued.length && relationTargets(object.id).length > 0;
  const canBindResource = object => resourceSupported && canWrite() && canRelateObject(object) && !queued.length && projection?.resources.length > 0;
  function node(tag, text, className = '') {
    const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
  }
  function renderInspector() {
    const inspector = el('worldInspector'); inspector.replaceChildren();
    if (creation) { renderCreation(inspector); return; }
    if (!projection || !selectedId) { inspector.append(node('p', t('请选择对象查看属性与来源。'))); return; }
    const { object } = queryWorldProjection(projection, { command: 'object.inspect', objectId: selectedId });
    const title = node('h3', object.name); title.id = 'worldObjectName'; inspector.append(title);
    inspector.append(node('p', `${projection.types.find(type => type.id === object.typeRef)?.label || object.typeRef} · ${object.documentRefs[0].sourcePath}`, 'world-source'));
    const facts = node('dl', '', 'world-facts');
    for (const [label, value] of [[t('对象身份'), object.id], [t('来源版本'), object.documentRefs[0].sourceRevision || '—']]) {
      facts.append(node('dt', label), node('dd', value));
    }
    inspector.append(facts);
    if (relationDraft) { renderRelationEditor(inspector); return; }
    if (resourceDraft) { renderResourceEditor(inspector); return; }
    const fields = Object.entries(object.properties);
    const editable = canEdit() && canSetObjectProperty(projection, object);
    if (writable && !busy && !editable) inspector.append(node('p', t('仅支持已登记对象；请在编辑模式下保存或结束文档草稿后修改属性。'), 'world-source'));
    if (!fields.length) inspector.append(node('p', t('没有可映射字段；原文与叙事内容保持原样。')));
    else {
      const table = node('table', '', 'world-properties'), head = document.createElement('thead'), row = document.createElement('tr');
      for (const label of [t('属性'), t('值'), t('原文位置')]) { const th = node('th', label); th.scope = 'col'; row.append(th); }
      head.append(row); table.append(head);
      const body = document.createElement('tbody');
      for (const [key, field] of fields) {
        const tr = document.createElement('tr');
        const binding = object.propertyBindings.find(item => item.propertyPath === `/properties/${key}`);
        tr.append(node('td', [field.group, field.label].filter(Boolean).join(' / ')), node('td', field.value),
          node('td', `${binding.authorityRef.range.start}–${binding.authorityRef.range.end} (UTF-16)`));
        if (editable) {
          const edit = node('button', t('修改属性'), 'doc-btn doc-btn-ghost'); edit.type = 'button'; edit.disabled = busy;
          edit.setAttribute('aria-label', t('修改属性：{0}', field.label));
          edit.addEventListener('click', () => {
            if (busy || !canEdit() || !canDiscard()) return;
            draft = { original: field.value, value: field.value, label: field.label, preview: null, message: '',
              request: { command: 'property.set', mode: 'preview', worldId: projection.world.id, baseRevision: projection.world.revision,
                objectId: object.id, objectRevision: object.revision, sourceRevision: binding.sourceRevision,
                propertyPath: binding.propertyPath, value: field.value, actorRef: { kind: 'user', id: 'local-ui' } } };
            notice = ''; el('worldCommandStatus').textContent = ''; renderInspector(); updateDraftActions(); el('worldPropertyValue').focus();
          });
          tr.lastElementChild.append(edit);
        }
        body.append(tr);
      }
      table.append(body); inspector.append(table);
    }
    if (draft) renderPropertyEditor(inspector);
    inspector.append(node('h4', t('关系与素材')));
    if (relationSupported) {
      const add = node('button', t('添加关系'), 'doc-btn doc-btn-ghost'); add.type = 'button'; add.id = 'worldRelationAdd';
      add.disabled = busy || !canAddRelation(object);
      add.addEventListener('click', () => {
        if (busy || !canAddRelation(object) || !canDiscard()) return;
        const target = relationTargets(object.id)[0]; draft = null; notice = '';
        relationDraft = { preview: null, message: '', request: { command: 'relation.add', mode: 'preview',
          worldId: projection.world.id, baseRevision: projection.world.revision, objectId: object.id, objectRevision: object.revision,
          targetObjectId: target.id, targetRevision: target.revision, kind: 'references', slot: '', actorRef: { kind: 'user', id: 'local-ui' } } };
        render(); el('worldRelationTarget').focus();
      });
      inspector.append(add);
    }
    if (resourceSupported) {
      const add = node('button', t('绑定资源'), 'doc-btn doc-btn-ghost'); add.type = 'button'; add.id = 'worldResourceAdd';
      add.disabled = busy || !canBindResource(object);
      add.addEventListener('click', () => {
        if (busy || !canBindResource(object) || !canDiscard()) return;
        const resource = projection.resources[0]; draft = null; notice = '';
        resourceDraft = { preview: null, message: '', request: { command: 'resource.bind', mode: 'preview',
          worldId: projection.world.id, baseRevision: projection.world.revision, objectId: object.id, objectRevision: object.revision,
          resourceId: resource.id, resourceRevision: resource.revision, slot: 'attachment', actorRef: { kind: 'user', id: 'local-ui' } } };
        render(); el('worldResourceTarget').focus();
      }); inspector.append(add);
      if (!projection.resources.length) inspector.append(node('p', t('暂无已登记资源，请先在素材管理中导入。'), 'world-source'));
    }
    const links = node('ul', '', 'world-links');
    for (const relation of projection.relations.filter(item => item.sourceObjectId === object.id)) {
      const target = projection.objects.find(item => item.id === relation.targetObjectId);
      links.append(node('li', `${relation.properties.kind}${relation.properties.slot ? ` · ${relation.properties.slot}` : ''} → ${target?.name || relation.targetObjectId}`));
    }
    for (const binding of projection.resourceBindings.filter(item => item.objectId === object.id)) {
      const resource = projection.resources.find(item => item.id === binding.resourceId);
      links.append(node('li', `${binding.slot} → ${resource?.descriptor.name || binding.resourceId} · ${t(resource?.availability === 'present-unverified' ? '文件存在，内容尚未校验' : '素材缺失或需要检查')}`));
    }
    if (!links.children.length) links.append(node('li', t('暂无关系或素材绑定。')));
    inspector.append(links);
  }
  function renderList() {
    const list = el('worldObjects'); list.replaceChildren();
    if (!projection) return;
    const { objects } = queryWorldProjection(projection, { command: 'object.list', search: el('worldSearch').value.slice(0, 200) });
    for (const object of objects) {
      const item = node('button', '', 'world-object'); item.type = 'button';
      item.setAttribute('aria-pressed', String(object.id === selectedId));
      item.disabled = busy;
      item.append(node('strong', object.name), node('span', object.documentRefs[0].sourcePath));
      item.addEventListener('click', () => {
        if (busy || (creation || object.id !== selectedId) && !canDiscard()) return;
        if (creation || object.id !== selectedId) { draft = null; creation = null; relationDraft = null; resourceDraft = null; }
        selectedId = object.id; renderList(); renderInspector();
        updateDraftActions();
        list.querySelector('[aria-pressed="true"]')?.focus();
      }); list.append(item);
    }
    if (!objects.length) list.append(node('p', t('没有匹配的对象。')));
  }
  function updateDraftActions() {
    dialog.dataset.dirty = String(dirty() || queued.length > 0);
    el('worldCreate').disabled = busy || Boolean(creation) || !canCreate();
    if (el('worldCreatePreview')) el('worldCreatePreview').disabled = busy || !canCreate() || !creation.request.sourcePath;
    if (el('worldCreateApply')) el('worldCreateApply').disabled = busy || !canCreate() || !creation?.preview;
    if (el('worldCreateDiff')) el('worldCreateDiff').hidden = !creation?.preview;
    if (el('worldRelationPreview')) el('worldRelationPreview').disabled = busy || !canAddRelation(projection?.objects.find(item => item.id === relationDraft.request.objectId))
      || !relationTargets(relationDraft.request.objectId).some(item => item.id === relationDraft.request.targetObjectId);
    if (el('worldRelationApply')) el('worldRelationApply').disabled = el('worldRelationPreview').disabled || !relationDraft?.preview;
    if (el('worldRelationDiff')) el('worldRelationDiff').hidden = !relationDraft?.preview;
    if (el('worldResourcePreview')) el('worldResourcePreview').disabled = busy || !canBindResource(projection?.objects.find(item => item.id === resourceDraft.request.objectId))
      || !resourceDraft.request.slot.trim() || !projection.resources.some(item => item.id === resourceDraft.request.resourceId);
    if (el('worldResourceApply')) el('worldResourceApply').disabled = el('worldResourcePreview').disabled || !resourceDraft?.preview;
    if (el('worldResourceDiff')) el('worldResourceDiff').hidden = !resourceDraft?.preview;
    if (el('worldPropertyPreview')) el('worldPropertyPreview').disabled = busy || !dirty();
    if (el('worldPropertyApply')) el('worldPropertyApply').disabled = busy || !draft?.preview || !dirty() || queued.length > 0;
    if (el('worldPropertyStage')) el('worldPropertyStage').disabled = busy || !draft?.preview || !dirty()
      || queued.length >= MAX_CHANGESET_COMMANDS || queued.some(item => item.request.objectId === draft.request.objectId);
    if (el('worldBatchPreview')) el('worldBatchPreview').disabled = busy || dirty() || !canEdit();
    if (el('worldBatchApply')) el('worldBatchApply').disabled = busy || dirty() || !canEdit() || !batchPreview;
    if (el('worldPropertyDiff')) el('worldPropertyDiff').hidden = !draft?.preview;
  }
  function renderResourceEditor(inspector) {
    const section = node('section', '', 'world-property-editor');
    section.append(node('h4', t('绑定资源')), node('p', t('选择已登记资源并填写用途；离线资源也可绑定，文件内容尚未校验。')));
    const invalidate = () => { resourceDraft.preview = null; resourceDraft.message = ''; updateDraftActions(); el('worldResourceMessage').textContent = ''; };
    const caption = node('label', t('目标资源')); caption.htmlFor = 'worldResourceTarget';
    const select = document.createElement('select'); select.id = 'worldResourceTarget'; select.disabled = busy;
    for (const resource of projection.resources) {
      const option = node('option', `${resource.descriptor.name} · ${resource.descriptor.location.path} · ${t(resource.availability === 'present-unverified' ? '文件存在，内容尚未校验' : '素材缺失或需要检查')}`);
      option.value = resource.id; select.append(option);
    }
    select.value = resourceDraft.request.resourceId;
    select.addEventListener('change', () => {
      resourceDraft.request.resourceId = select.value;
      resourceDraft.request.resourceRevision = projection.resources.find(resource => resource.id === select.value)?.revision || '';
      invalidate();
    });
    const slotLabel = node('label', t('资源用途（如 portrait、voice、attachment）')); slotLabel.htmlFor = 'worldResourceSlot';
    const slot = document.createElement('input'); slot.type = 'text'; slot.id = 'worldResourceSlot'; slot.maxLength = 200; slot.disabled = busy;
    slot.value = resourceDraft.request.slot;
    slot.addEventListener('input', () => { resourceDraft.request.slot = slot.value; invalidate(); });
    const message = node('p', t(resourceDraft.message)); message.id = 'worldResourceMessage'; message.setAttribute('role', 'status');
    const actions = node('div', '', 'world-actions');
    for (const [id, label, action] of [['worldResourcePreview', '预览绑定', () => void runResource('preview')],
      ['worldResourceApply', '保存绑定', () => void runResource('apply')],
      ['worldResourceCancel', '取消修改', () => { if (!busy && canDiscard()) { resourceDraft = null; render(); el('worldResourceAdd')?.focus(); } }]]) {
      const button = node('button', t(label), 'doc-btn'); button.type = 'button'; button.id = id; button.disabled = busy;
      button.addEventListener('click', action); actions.append(button);
    }
    const preview = node('div', '', 'world-property-diff'); preview.id = 'worldResourceDiff';
    if (resourceDraft.preview) {
      const binding = resourceDraft.preview.binding, resource = projection.resources.find(item => item.id === binding.resourceId);
      preview.append(node('h4', t('将添加的资源绑定')), node('p', `${binding.slot} → ${resource?.descriptor.name || binding.resourceId}`));
    }
    section.append(caption, select, slotLabel, slot, message, actions, preview); inspector.append(section);
  }
  async function runResource(mode) {
    if (busy || !resourceDraft || !canBindResource(projection?.objects.find(item => item.id === resourceDraft.request.objectId))
      || !resourceDraft.request.slot.trim() || mode === 'apply' && !resourceDraft.preview) return;
    busy = true; setBusy(true); resourceDraft.message = mode === 'preview' ? '正在预览资源绑定…' : '正在保存资源绑定…'; render();
    try {
      const result = await requestWorldCommand({ ...resourceDraft.request, mode });
      if (mode === 'preview') { resourceDraft.preview = result; resourceDraft.message = '预览已就绪；应用时会再次检查版本。'; }
      else {
        resourceDraft = null; notice = '资源绑定已保存。';
        try { await applied(result); } catch { notice = '资源绑定已保存，但文档预览更新失败，请重新构建。'; }
        try { await readProjection(); } catch { failed = true; projection = null; notice = '资源绑定已保存，请刷新核对内容。'; }
      }
    } catch (error) {
      resourceDraft.preview = null;
      const code = error.payload?.errorCode || error.payload?.data?.errorCode;
      recoveryNeeded = ['world_recovery_required', 'world_recovery_conflict', 'world_journal_invalid'].includes(code);
      resourceDraft.message = ['world_revision_conflict', 'world_read_conflict'].includes(code)
        ? '工程版本已变化。资源绑定草稿仍保留，请记下选择后刷新，再重新预览。'
        : code === 'world_resource_binding_exists' ? '此资源已绑定到该用途，请选择其他资源或用途。'
        : ['world_resource_target_missing', 'world_resource_read_only'].includes(code) ? '请选择已登记资源和原文可用的对象。'
        : code === 'world_record_invalid' ? '登记信息无法安全编辑，请检查重复键或无效格式。'
        : '资源绑定请求未完成。草稿仍保留，请核对保存结果后重新预览。';
    } finally { busy = false; setBusy(false); render(); el(resourceDraft?.preview ? 'worldResourceApply' : resourceDraft ? 'worldResourceTarget' : 'worldResourceAdd')?.focus(); }
  }
  function renderRelationEditor(inspector) {
    const section = node('section', '', 'world-property-editor');
    section.append(node('h4', t('添加关系')), node('p', t('引用用于关联设定；归属会将当前对象放入目标对象的附属内容。')));
    const invalidate = () => { relationDraft.preview = null; relationDraft.message = ''; updateDraftActions(); el('worldRelationMessage').textContent = ''; };
    for (const [id, key, label, options] of [
      ['worldRelationKind', 'kind', '关系类型', [['references', t('引用')], ['part-of', t('归属')]]],
      ['worldRelationTarget', 'targetObjectId', '目标对象', relationTargets(relationDraft.request.objectId).map(object => [object.id, `${object.name} · ${object.documentRefs[0].sourcePath}`])],
    ]) {
      const caption = node('label', t(label)); caption.htmlFor = id;
      const select = document.createElement('select'); select.id = id; select.disabled = busy;
      for (const [value, label] of options) { const option = node('option', label); option.value = value; select.append(option); }
      select.value = relationDraft.request[key];
      select.addEventListener('change', () => {
        relationDraft.request[key] = select.value;
        if (key === 'targetObjectId') relationDraft.request.targetRevision = projection.objects.find(object => object.id === select.value)?.revision || '';
        invalidate();
      }); section.append(caption, select);
    }
    const caption = node('label', t('关系标签（可留空）')); caption.htmlFor = 'worldRelationSlot';
    const slot = document.createElement('input'); slot.type = 'text'; slot.id = 'worldRelationSlot'; slot.maxLength = 200; slot.disabled = busy;
    slot.value = relationDraft.request.slot;
    slot.addEventListener('input', () => { relationDraft.request.slot = slot.value; invalidate(); });
    const message = node('p', t(relationDraft.message)); message.id = 'worldRelationMessage'; message.setAttribute('role', 'status');
    const actions = node('div', '', 'world-actions');
    for (const [id, label, action] of [['worldRelationPreview', '预览关系', () => void runRelation('preview')],
      ['worldRelationApply', '保存关系', () => void runRelation('apply')],
      ['worldRelationCancel', '取消修改', () => { if (!busy && canDiscard()) { relationDraft = null; render(); el('worldRelationAdd')?.focus(); } }]]) {
      const button = node('button', t(label), 'doc-btn'); button.type = 'button'; button.id = id; button.disabled = busy;
      button.addEventListener('click', action); actions.append(button);
    }
    const preview = node('div', '', 'world-property-diff'); preview.id = 'worldRelationDiff';
    if (relationDraft.preview) {
      const relation = relationDraft.preview.relation, source = projection.objects.find(item => item.id === relation.sourceObjectId), target = projection.objects.find(item => item.id === relation.targetObjectId);
      preview.append(node('h4', t('将添加的关系')), node('p', `${source?.name || relation.sourceObjectId} → ${target?.name || relation.targetObjectId}`),
        node('p', `${t(relation.properties.kind === 'part-of' ? '归属' : '引用')}${relation.properties.slot ? ` · ${relation.properties.slot}` : ''}`));
    }
    section.append(caption, slot, message, actions, preview); inspector.append(section);
  }
  async function runRelation(mode) {
    if (busy || !relationDraft || !canAddRelation(projection?.objects.find(item => item.id === relationDraft.request.objectId))
      || mode === 'apply' && !relationDraft.preview) return;
    busy = true; setBusy(true); relationDraft.message = mode === 'preview' ? '正在预览关系…' : '正在保存关系…'; render();
    try {
      const result = await requestWorldCommand({ ...relationDraft.request, mode });
      if (mode === 'preview') { relationDraft.preview = result; relationDraft.message = '预览已就绪；应用时会再次检查版本。'; }
      else {
        relationDraft = null; notice = '关系已保存。';
        try { await applied(result); } catch { notice = '关系已保存，但文档预览更新失败，请重新构建。'; }
        try { await readProjection(); } catch { failed = true; projection = null; notice = '关系已保存，请刷新核对内容。'; }
      }
    } catch (error) {
      relationDraft.preview = null;
      const code = error.payload?.errorCode || error.payload?.data?.errorCode;
      recoveryNeeded = ['world_recovery_required', 'world_recovery_conflict', 'world_journal_invalid'].includes(code);
      relationDraft.message = ['world_revision_conflict', 'world_read_conflict'].includes(code)
        ? '工程版本已变化。关系草稿仍保留，请记下选择后刷新，再重新预览。'
        : code === 'world_relation_exists' ? '此关系已存在；同一类型和目标不能重复添加。'
        : code === 'world_relation_cycle' ? '此归属会形成循环，请选择其他目标或使用引用关系。'
        : ['world_relation_read_only', 'world_relation_object_missing', 'world_relation_self'].includes(code) ? '请选择另一个已登记且原文可用的对象。'
        : code === 'world_record_invalid' ? '登记信息无法安全编辑，请检查重复键或无效格式。'
        : '关系请求未完成。草稿仍保留，请核对保存结果后重新预览。';
    } finally { busy = false; setBusy(false); render(); el(relationDraft?.preview ? 'worldRelationApply' : relationDraft ? 'worldRelationTarget' : 'worldRelationAdd')?.focus(); }
  }
  function renderCreation(inspector) {
    const title = node('h3', t('创建对象')); title.id = 'worldObjectName';
    inspector.append(title, node('p', t('选择类型并填写原文；创建前可预览对象和保存位置。')));
    const section = node('section', '', 'world-property-editor world-create-editor');
    const typeLabel = node('label', t('对象类型')); typeLabel.htmlFor = 'worldCreateType';
    const types = document.createElement('select'); types.id = 'worldCreateType'; types.disabled = busy;
    for (const type of createTypes()) { const option = node('option', type.label); option.value = type.definition.id; types.append(option); }
    types.value = creation.request.documentType;
    const invalidate = () => { creation.preview = null; creation.message = ''; updateDraftActions(); el('worldCreateMessage').textContent = ''; };
    types.addEventListener('change', () => { creation.request.documentType = types.value; invalidate(); });
    section.append(typeLabel, types);
    for (const [id, key, label, tag] of [['worldCreatePath', 'sourcePath', '原文路径', 'input'], ['worldCreateContent', 'content', '对象原文', 'textarea']]) {
      const caption = node('label', t(label)); caption.htmlFor = id;
      const input = document.createElement(tag); input.id = id; input.value = creation.request[key]; input.disabled = busy;
      input.maxLength = key === 'content' ? 262144 : 1024;
      if (tag === 'textarea') { input.rows = 9; input.spellcheck = false; }
      else { input.type = 'text'; input.autocomplete = 'off'; }
      input.addEventListener('input', () => { creation.request[key] = input.value; invalidate(); });
      section.append(caption, input);
    }
    const message = node('p', t(creation.message)); message.id = 'worldCreateMessage'; message.setAttribute('role', 'status');
    const actions = node('div', '', 'world-actions');
    for (const [id, label, action] of [['worldCreatePreview', '预览新对象', () => void runCreate('preview')],
      ['worldCreateApply', '保存新对象', () => void runCreate('apply')],
      ['worldCreateCancel', '取消创建', () => { if (!busy && canDiscard()) { creation = null; render(); el('worldCreate').focus(); } }]]) {
      const button = node('button', t(label), 'doc-btn'); button.type = 'button'; button.id = id; button.disabled = busy;
      button.addEventListener('click', action); actions.append(button);
    }
    const preview = node('div', '', 'world-property-diff'); preview.id = 'worldCreateDiff';
    if (creation.preview) {
      const { object, changes } = creation.preview, change = changes[0];
      preview.append(node('h4', object.name), node('p', `${t('对象身份')} · ${object.id}`, 'world-source'),
        node('p', `${t('原文路径')} · ${change.sourcePath}`, 'world-source'), node('h5', t('将保存的原文')), node('pre', change.afterText));
      const fields = node('ul', '', 'world-links');
      for (const field of Object.values(object.properties)) fields.append(node('li', `${field.label} · ${field.value}`));
      preview.append(fields);
    }
    section.append(message, actions, preview); inspector.append(section);
  }
  async function runCreate(mode) {
    if (busy || !creation || !canCreate() || mode === 'apply' && !creation.preview) return;
    busy = true; setBusy(true); creation.message = mode === 'preview' ? '正在预览新对象…' : '正在保存新对象…'; render();
    try {
      const result = await requestWorldCommand({ ...creation.request, mode });
      if (mode === 'preview') { creation.preview = result; creation.message = '预览已就绪；应用时会再次检查版本。'; }
      else {
        creation = null; selectedId = result.object.id; notice = '新对象已保存。';
        el('worldSearch').value = '';
        try { await applied(result); } catch { notice = '新对象已保存，但文档预览更新失败，请重新构建。'; }
        try { await readProjection(); } catch { failed = true; projection = null; notice = '新对象已保存，请刷新核对内容。'; }
      }
    } catch (error) {
      creation.preview = null;
      const code = error.payload?.errorCode || error.payload?.data?.errorCode;
      recoveryNeeded = ['world_recovery_required', 'world_recovery_conflict', 'world_journal_invalid'].includes(code);
      creation.message = ['world_revision_conflict', 'world_read_conflict'].includes(code)
        ? '工程版本已变化。草稿仍保留，请复制内容后刷新，再重新预览。'
        : code === 'world_create_path_conflict' ? '保存位置已被使用，请更换原文路径后重新预览。'
        : code === 'world_create_path_invalid' ? '请使用文档目录内的有效路径，支持 Markdown、TXT、JSON 或 YAML。'
        : code === 'world_create_source_invalid' ? '原文与文件格式不符，请检查 JSON 或 YAML 语法。'
        : code === 'world_type_unknown' ? '对象类型已变化。草稿仍保留，请复制内容后刷新。'
        : '请求未完成。草稿仍保留；请刷新核对已保存内容后再预览。';
    } finally { busy = false; setBusy(false); render(); el(creation?.preview ? 'worldCreateApply' : creation ? 'worldCreateContent' : 'worldCreate')?.focus(); }
  }
  function renderPropertyEditor(inspector) {
    const section = node('section', '', 'world-property-editor');
    section.append(node('h4', t('修改属性：{0}', draft.label)));
    const label = node('label', t('新值')); label.htmlFor = 'worldPropertyValue';
    const input = document.createElement('textarea'); input.id = 'worldPropertyValue'; input.rows = 3;
    input.maxLength = 262144; input.value = draft.value; input.disabled = busy;
    input.addEventListener('input', () => { draft.value = input.value; draft.preview = null; draft.message = ''; updateDraftActions(); el('worldPropertyMessage').textContent = ''; });
    const message = node('p', t(draft.message)); message.id = 'worldPropertyMessage'; message.setAttribute('role', 'status');
    const actions = node('div', '', 'world-actions');
    for (const [id, label, action] of [['worldPropertyPreview', '预览修改', () => void runCommand('preview')],
      ['worldPropertyApply', '应用修改', () => void runCommand('apply')],
      ['worldPropertyCancel', '取消修改', () => { if (!busy && canDiscard()) { draft = null; renderInspector(); updateDraftActions(); } }]]) {
      const button = node('button', t(label), 'doc-btn'); button.type = 'button'; button.id = id; button.disabled = busy;
      button.addEventListener('click', action); actions.append(button);
    }
    if (batchSupported) {
      const stage = node('button', t('加入待提交修改'), 'doc-btn doc-btn-ghost'); stage.type = 'button'; stage.id = 'worldPropertyStage';
      stage.addEventListener('click', () => {
        if (stage.disabled || !canEdit()) return;
        queued.push({ request: { ...draft.request, value: draft.value }, label: draft.label,
          before: draft.preview.change.beforeText, after: draft.preview.change.afterText });
        draft = null; batchPreview = null; notice = ''; render(); el('worldBatchPreview')?.focus();
      });
      actions.append(stage);
    }
    const diff = node('div', '', 'world-property-diff'); diff.id = 'worldPropertyDiff';
    if (draft.preview) for (const [label, value] of [['修改前', draft.preview.change.beforeText], ['修改后', draft.preview.change.afterText]]) {
      diff.append(node('h5', t(label)), node('pre', value));
    }
    section.append(label, input, message, actions, diff); inspector.append(section); updateDraftActions();
  }
  async function runCommand(mode) {
    if (busy || !draft || !canEdit() || mode === 'apply' && (!draft.preview || queued.length)) return;
    busy = true; setBusy(true); draft.message = mode === 'preview' ? '正在预览属性修改…' : '正在保存属性修改…'; render();
    try {
      const result = await requestWorldCommand({ ...draft.request, value: draft.value, mode });
      if (mode === 'preview') { draft.preview = result; draft.message = '预览已就绪；应用时会再次检查版本。'; }
      else {
        draft = null; notice = '属性已保存。'; updateDraftActions();
        try { await applied(result); }
        catch { notice = '属性已保存，但文档预览更新失败，请重新构建。'; }
        try { await readProjection(); }
        catch { failed = true; projection = null; notice = '属性已保存，但世界读取失败，请刷新核对。'; }
      }
    } catch (error) {
      draft.preview = null;
      const code = error.payload?.errorCode || error.payload?.data?.errorCode;
      recoveryNeeded = ['world_recovery_required', 'world_recovery_conflict', 'world_journal_invalid'].includes(code);
      draft.message = ['world_revision_conflict', 'world_read_conflict'].includes(code)
        ? '工程版本已变化。草稿仍保留，请复制内容后刷新，再重新预览。'
        : code === 'world_property_roundtrip' ? '此值会改变其他字段或文档结构，请使用原文编辑器。'
        : code === 'world_property_value_invalid' ? '值与属性类型不符，请检查数字或布尔值。'
        : '请求未完成。草稿仍保留；请刷新核对已保存内容后再预览。';
    } finally {
      busy = false; setBusy(false); render();
      el(draft?.preview ? 'worldPropertyApply' : draft ? 'worldPropertyValue' : 'worldRefresh')?.focus();
    }
  }
  function renderBatch() {
    const section = el('worldBatch'); section.replaceChildren(); section.hidden = !queued.length;
    if (!queued.length) return;
    const title = node('h3', t('待提交修改（{0}）', queued.length)); title.id = 'worldBatchTitle';
    section.append(title, node('p', t('每个对象可暂存一个属性，最多 32 个对象。切换对象后可继续添加。')));
    const list = node('ol', '', 'world-batch-list');
    for (const [index, item] of queued.entries()) {
      const object = projection?.objects.find(object => object.id === item.request.objectId);
      const row = node('li', '');
      row.append(node('strong', `${object?.name || item.request.objectId} · ${item.label}`), node('pre', `${item.before} → ${item.after}`));
      const remove = node('button', t('移除此项'), 'doc-btn doc-btn-ghost'); remove.type = 'button'; remove.disabled = busy;
      remove.setAttribute('aria-label', t('移除修改：{0}', item.label));
      remove.addEventListener('click', () => { queued.splice(index, 1); batchPreview = null; render(); el('worldBatchPreview')?.focus(); });
      row.append(remove); list.append(row);
    }
    const actions = node('div', '', 'world-actions');
    for (const [id, label, action] of [['worldBatchPreview', '预览批量修改', () => void runBatch('preview')],
      ['worldBatchApply', '提交全部修改', () => void runBatch('apply')],
      ['worldBatchClear', '清空待提交', () => { if (!busy && canDiscard(true)) { queued = []; batchPreview = null; render(); } }]]) {
      const button = node('button', t(label), 'doc-btn'); button.id = id; button.type = 'button'; button.disabled = busy;
      button.addEventListener('click', action); actions.append(button);
    }
    section.append(list, actions);
    if (batchPreview) section.append(node('p', t('整批预览已通过，提交时会再次检查全部版本。')));
  }
  async function runBatch(mode) {
    if (busy || !queued.length || dirty() || !canEdit() || mode === 'apply' && !batchPreview) return;
    const first = queued[0].request;
    const request = { command: 'changeset.apply', mode, worldId: first.worldId, baseRevision: first.baseRevision,
      actorRef: first.actorRef, commands: queued.map(({ request }) => {
        const { command, objectId, objectRevision, sourceRevision, propertyPath, value } = request;
        return { command, objectId, objectRevision, sourceRevision, propertyPath, value };
      }) };
    busy = true; setBusy(true); notice = mode === 'preview' ? '正在预览整批修改…' : '正在提交整批修改…'; render();
    try {
      const result = await requestWorldCommand(request);
      if (mode === 'preview') { batchPreview = result; notice = ''; }
      else {
        queued = []; draft = null; batchPreview = null; notice = '整批修改已保存。';
        try { await applied(result); } catch { notice = '整批修改已保存，但文档预览更新失败，请重新构建。'; }
        try { await readProjection(); } catch { failed = true; projection = null; notice = '整批修改已保存，请刷新核对内容。'; }
      }
    } catch (error) {
      batchPreview = null;
      const code = error.payload?.errorCode || error.payload?.data?.errorCode;
      recoveryNeeded = ['world_recovery_required', 'world_recovery_conflict', 'world_journal_invalid'].includes(code);
      notice = recoveryNeeded ? '提交尚未完成，请先恢复。待提交修改仍保留。'
        : '整批请求未完成。修改仍保留，请刷新核对保存结果后重新预览。';
    } finally { busy = false; setBusy(false); render(); el(batchPreview ? 'worldBatchApply' : queued.length ? 'worldBatchPreview' : 'worldRefresh')?.focus(); }
  }
  async function recover() {
    if (busy || getContext().busy || !recoverySupported) return;
    busy = true; setBusy(true); batchPreview = null; if (draft) draft.preview = null; if (creation) creation.preview = null; if (relationDraft) relationDraft.preview = null; if (resourceDraft) resourceDraft.preview = null; render();
    try {
      const result = await requestWorldCommand({ command: 'world.recover', mode: 'apply' });
      recoveryNeeded = false; notice = '恢复已完成。请核对保存结果；原草稿和待提交修改仍保留。';
      await applied(result); await readProjection();
    } catch { notice = '无法完成恢复。请保留工程及事务记录，检查外部修改后重试。'; }
    finally { busy = false; setBusy(false); render(); }
  }
  function render() {
    translatePage(dialog);
    el('worldStatus').textContent = busy ? t('正在处理世界…') : failed ? t('无法读取世界，请检查工程后重试。') : projection ? t('{0} 个对象 · {1} 个资源', projection.objects.length, projection.resources.length) : '';
    el('worldCommandStatus').textContent = t(notice);
    el('worldName').textContent = projection?.world.name || '';
    el('worldRefresh').disabled = busy;
    el('worldClose').disabled = busy;
    el('worldCreate').hidden = !createSupported;
    el('worldRecover').hidden = !recoveryNeeded || !recoverySupported;
    el('worldRecover').disabled = busy || getContext().busy;
    dialog.setAttribute('aria-busy', String(busy));
    el('worldDiagnosticSummary').textContent = t('诊断（{0}）', projection?.diagnostics.length || 0);
    const diagnostics = el('worldDiagnostics'); diagnostics.replaceChildren();
    for (const item of projection?.diagnostics || []) {
      const owner = projection.objects.find(object => object.id === item.objectId)?.name
        || projection.resources.find(resource => resource.id === item.resourceId)?.descriptor.name || '';
      diagnostics.append(node('li', `${owner ? `${owner} · ` : ''}${t(diagnosticLabels[item.code] || item.code)}`));
    }
    renderBatch(); renderList(); renderInspector();
    updateDraftActions();
  }
  async function readProjection() {
    const current = generation;
    const { payload } = await fetchJsonApiRequest(WORLD_API_PATH, { cache: 'no-store' }, 45000, t('读取世界'));
    if (current !== generation || !dialog.open) return;
    projection = payload; failed = false;
    if (!projection.objects.some(object => object.id === selectedId)) selectedId = projection.objects[0]?.id || '';
  }
  async function refresh() {
    if (busy || !canDiscard(true)) return;
    const current = ++generation; busy = true; failed = false; projection = null; draft = null; creation = null; relationDraft = null; resourceDraft = null; queued = []; batchPreview = null; notice = ''; render();
    try {
      await readProjection();
      recoveryNeeded = false;
    } catch (error) {
      if (current === generation) failed = true;
      recoveryNeeded = ['world_recovery_required', 'world_recovery_conflict', 'world_journal_invalid'].includes(error.payload?.errorCode || error.payload?.data?.errorCode);
    }
    finally { if (current === generation) { busy = false; render(); } }
  }
  button.addEventListener('click', () => { if (!dialog.open) { dialog.showModal(); void refresh(); } });
  el('worldRefresh').addEventListener('click', () => void refresh());
  el('worldRecover').addEventListener('click', () => void recover());
  el('worldCreate').addEventListener('click', () => {
    if (busy || creation || !canCreate() || !canDiscard()) return;
    const type = createTypes()[0].definition, root = projection.world.sourceWorkspaceVersion === 3 ? 'documents' : 'design-data';
    draft = null; relationDraft = null; resourceDraft = null; notice = '';
    creation = { preview: null, message: '', request: { command: 'object.create', mode: 'preview',
      worldId: projection.world.id, baseRevision: projection.world.revision, objectId: crypto.randomUUID(), documentType: type.id,
      sourcePath: [root, type.directory, 'new-object.md'].filter(Boolean).join('/'), content: '', actorRef: { kind: 'user', id: 'local-ui' } } };
    render(); el('worldCreatePath').focus();
  });
  const close = () => { if (!busy && canDiscard(true)) { draft = null; creation = null; relationDraft = null; resourceDraft = null; queued = []; batchPreview = null; render(); dialog.close(); } };
  el('worldClose').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
  });
  dialog.addEventListener('close', () => { generation++; busy = false; });
  el('worldSearch').maxLength = 200;
  el('worldSearch').addEventListener('input', renderList);
  onLanguageChange(() => { if (dialog.open) render(); });
  return { setAvailable(available, commands = []) { button.hidden = !available; writable = commands.includes('property.set');
    batchSupported = commands.includes('changeset.apply'); recoverySupported = commands.includes('world.recover'); createSupported = commands.includes('object.create'); relationSupported = commands.includes('relation.add'); resourceSupported = commands.includes('resource.bind'); } };
}
