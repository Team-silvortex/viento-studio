import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { WORLD_API_PATH, queryWorldProjection } from '../../engine/world-query.mjs';
import { canSetObjectProperty, MAX_CHANGESET_COMMANDS } from '../../engine/world-command-contract.mjs';
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
    <p class="world-note" data-i18n="只显示已保存内容。编辑模式下可预览属性修改并单独或批量保存，原文仍是保存来源。"></p>
    <p id="worldStatus" role="status" aria-live="polite"></p>
    <p id="worldCommandStatus" role="status" aria-live="polite"></p>
    <button type="button" id="worldRecover" class="doc-btn" data-i18n="恢复未完成的提交" hidden></button>
    <section id="worldBatch" class="world-batch" aria-labelledby="worldBatchTitle" hidden></section>
    <div class="world-layout"><section class="world-object-browser" aria-labelledby="worldObjectsTitle"><h3 id="worldObjectsTitle" data-i18n="对象"></h3>
      <label for="worldSearch" data-i18n="搜索对象"></label><input id="worldSearch" type="search" data-i18n-placeholder="名称、身份或原文路径" autocomplete="off" />
      <div id="worldObjects" class="world-object-list"></div></section>
      <section id="worldInspector" class="world-inspector" aria-labelledby="worldObjectName"></section></div>
    <details class="world-diagnostics"><summary id="worldDiagnosticSummary"></summary><ul id="worldDiagnostics"></ul></details>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  let projection = null, selectedId = '', generation = 0, busy = false, failed = false, writable = false, draft = null, notice = '';
  let batchSupported = false, recoverySupported = false, recoveryNeeded = false, queued = [], batchPreview = null;
  const dirty = () => Boolean(draft && draft.value !== draft.original);
  const canDiscard = (all = false) => !(dirty() || all && queued.length) || window.confirm(t('属性有未保存的修改，确定丢弃？'));
  const canEdit = () => {
    const context = getContext();
    return writable && context.editable && !context.dirty && !context.creating && !context.busy;
  };
  function node(tag, text, className = '') {
    const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
  }
  function renderInspector() {
    const inspector = el('worldInspector'); inspector.replaceChildren();
    if (!projection || !selectedId) { inspector.append(node('p', t('请选择对象查看属性与来源。'))); return; }
    const { object } = queryWorldProjection(projection, { command: 'object.inspect', objectId: selectedId });
    const title = node('h3', object.name); title.id = 'worldObjectName'; inspector.append(title);
    inspector.append(node('p', `${projection.types.find(type => type.id === object.typeRef)?.label || object.typeRef} · ${object.documentRefs[0].sourcePath}`, 'world-source'));
    const facts = node('dl', '', 'world-facts');
    for (const [label, value] of [[t('对象身份'), object.id], [t('来源版本'), object.documentRefs[0].sourceRevision || '—']]) {
      facts.append(node('dt', label), node('dd', value));
    }
    inspector.append(facts);
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
        if (busy || object.id !== selectedId && !canDiscard()) return;
        if (object.id !== selectedId) { draft = null; updateDraftActions(); }
        selectedId = object.id; renderList(); renderInspector();
        list.querySelector('[aria-pressed="true"]')?.focus();
      }); list.append(item);
    }
    if (!objects.length) list.append(node('p', t('没有匹配的对象。')));
  }
  function updateDraftActions() {
    dialog.dataset.dirty = String(dirty() || queued.length > 0);
    if (el('worldPropertyPreview')) el('worldPropertyPreview').disabled = busy || !dirty();
    if (el('worldPropertyApply')) el('worldPropertyApply').disabled = busy || !draft?.preview || !dirty() || queued.length > 0;
    if (el('worldPropertyStage')) el('worldPropertyStage').disabled = busy || !draft?.preview || !dirty()
      || queued.length >= MAX_CHANGESET_COMMANDS || queued.some(item => item.request.objectId === draft.request.objectId);
    if (el('worldBatchPreview')) el('worldBatchPreview').disabled = busy || dirty() || !canEdit();
    if (el('worldBatchApply')) el('worldBatchApply').disabled = busy || dirty() || !canEdit() || !batchPreview;
    if (el('worldPropertyDiff')) el('worldPropertyDiff').hidden = !draft?.preview;
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
    busy = true; setBusy(true); batchPreview = null; if (draft) draft.preview = null; render();
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
    const current = ++generation; busy = true; failed = false; projection = null; draft = null; queued = []; batchPreview = null; notice = ''; render();
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
  const close = () => { if (!busy && canDiscard(true)) { draft = null; queued = []; batchPreview = null; updateDraftActions(); dialog.close(); } };
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
    batchSupported = commands.includes('changeset.apply'); recoverySupported = commands.includes('world.recover'); } };
}
