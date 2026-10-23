import { isScriptUsage, scriptUsageMatchSource, scriptUsageSource, createScriptUsageOpenSourceRequest } from '../../engine/script-usage.mjs';
import { sourceLocationSelection } from './app-source-location.js';
import { revealSourceOffset } from './app-source-reveal.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A saved-reference reader. Its only outward action is a branded navigation
// request; draft protection and revision checks remain with the source host.
export function setupScriptUsage({ getContext = () => ({}), getSource = async () => null, getUsage = async () => null, openSource = async () => false } = {}) {
  const actions = document.getElementById('docEditActions');
  if (!actions) return Object.freeze({ open: async () => false, refresh() {}, dispose() {} });
  if (!document.getElementById('scriptUsageStyle')) {
    const style = document.createElement('link'); style.id = 'scriptUsageStyle'; style.rel = 'stylesheet'; style.href = '/web/script-usage.css';
    (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scriptUsageBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; actions.append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'scriptUsageDialog'; dialog.className = 'script-usage-dialog';
  dialog.dataset.vientoCloseGuard = 'true'; dialog.setAttribute('aria-labelledby', 'scriptUsageTitle');
  dialog.innerHTML = `<header><h2 id="scriptUsageTitle" data-i18n="查看脚本使用位置"></h2><button id="scriptUsageClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="script-usage-body"><p id="scriptUsagePath"></p><p class="script-usage-note" data-i18n="仅查看当前工程已登记的非 part-of 关系引用及已保存行为绑定；不包含动态调用或未登记引用，也不会自动修改参数。"></p>
      <p id="scriptUsageDirty" class="script-usage-note" data-i18n="当前脚本有未保存修改；此列表仍读取已保存的脚本与引用文档。" hidden></p>
      <div id="scriptUsageReferences"></div>
      <section id="scriptUsageSnapshot" hidden aria-labelledby="scriptUsageSnapshotTitle"><h3 id="scriptUsageSnapshotTitle" data-i18n="已保存原文快照"></h3><p id="scriptUsageSourcePath"></p>
        <p class="script-usage-note" data-i18n="这是上次读取的只读原文。打开编辑器前会重新核对保存版本，并处理当前未保存草稿。"></p>
        <textarea id="scriptUsageSource" readonly spellcheck="false" wrap="off" lang="" aria-labelledby="scriptUsageSnapshotTitle"></textarea>
        <button id="scriptUsageOpenSource" type="button" class="doc-btn" data-i18n="在编辑器中打开原文"></button></section></div>
    <p id="scriptUsageStatus" role="status" aria-live="polite"></p>
    <footer><button id="scriptUsageRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新使用位置"></button><button id="scriptUsageCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#scriptUsage' + suffix);
  let disposed = false, epoch = 0, owner = null, source = null, catalog = null, selection = null, reading = false, navigation = null, invalidated = false, opener = null;
  let message = '', rows = [];
  const eligible = context => context.editable === true && context.sourceTXT === true && !context.creating && typeof context.sourcePath === 'string' && context.sourcePath.length > 0
    && typeof context.sourceToken === 'string' && context.sourceToken.length > 0;
  const current = () => { const context = getContext(); return !disposed && dialog.open && owner && !invalidated && eligible(context)
    && context.available === true && !context.busy && context.sourcePath === owner.sourcePath && context.sourceToken === owner.sourceToken; };
  const statusText = status => ({ bound: '已绑定到行为', unbound: '已登记引用，但没有匹配的行为绑定', 'non-behavior': '已登记引用，文档不是场景行为',
    'invalid-behavior': '已登记引用，但行为声明无效', 'invalid-json': '已登记引用，但 JSON 无效', unavailable: '已登记引用，原文暂不可用' })[status];
  function clearSnapshot() { selection = null; el('Snapshot').hidden = true; el('Source').value = ''; el('SourcePath').textContent = ''; }
  function clearResults() { catalog = null; rows = []; el('References').replaceChildren(); clearSnapshot(); }
  function invalidate() { invalidated = true; epoch++; reading = false; clearResults(); message = '脚本来源或读取能力已变化，请返回后重新查看使用位置。'; }
  function refresh() {
    if (disposed) return;
    const context = getContext(); button.textContent = t('查看脚本使用位置'); button.hidden = !eligible(context) || context.available !== true; button.disabled = context.available !== true || Boolean(context.busy) || dialog.open;
    if (!dialog.open) return;
    // Navigation owns its own ticket: entering the target editor changes the
    // source token and busy state by design. The host verifies that transition.
    if (!navigation && owner && !invalidated && !current()) invalidate();
    translatePage(dialog); dialog.setAttribute('aria-busy', String(reading || Boolean(navigation)));
    el('Path').textContent = owner?.sourcePath || ''; el('Dirty').hidden = owner?.dirty !== true;
    el('Status').textContent = message === '已读取 {0} 份引用文档，匹配 {1} 个行为绑定。' && catalog ? t(message, catalog.references.length, catalog.matches.length) : t(message);
    el('Refresh').disabled = !current() || Boolean(navigation);
    el('OpenSource').disabled = !current() || !selection || reading || Boolean(navigation);
    for (const row of rows) {
      row.status.textContent = t(statusText(row.reference.status)); row.relations.textContent = t('登记关系：{0}', row.reference.relationKinds.join(', '));
      row.sourceButton.textContent = t('查看文档原文'); row.sourceButton.disabled = !current() || reading || Boolean(navigation) || row.reference.status === 'unavailable';
      for (const item of row.bindings) {
        item.label.textContent = t('绑定 {0} · 实例 {1}', item.match.bindingId, item.match.instanceId);
        item.scene.textContent = t('场景 {0} · {1} / {2}', item.match.sceneObjectId, item.match.backendId, item.match.language);
        item.parametersLabel.textContent = t('已保存参数'); item.sourceButton.textContent = t('查看绑定原文'); item.sourceButton.disabled = !current() || reading || Boolean(navigation);
      }
    }
  }
  function showSource(reference, match, expectedCatalog, node) {
    if (!current() || reading || navigation || catalog !== expectedCatalog || !el('References').contains(node)) return false;
    try {
      const snapshot = scriptUsageSource(catalog, reference, match), range = sourceLocationSelection(snapshot.content, snapshot, snapshot.sourceRevision);
      if (range.status !== 'exact') throw Error('location');
      selection = snapshot; el('Snapshot').hidden = false; el('SourcePath').textContent = snapshot.sourcePath + (snapshot.propertyPath ? ' · ' + snapshot.propertyPath : '');
      const text = el('Source'); text.value = snapshot.content.replace(/\r\n|\r/g, '\n'); text.focus({ preventScroll: true }); text.selectionStart = range.start; text.selectionEnd = range.end;
      revealSourceOffset(text, text.value, range.start); message = '已定位保存态原文；可在编辑器中打开后继续修改。'; refresh(); return true;
    } catch { message = '无法定位此引用的保存态原文，请刷新后重试。'; refresh(); return false; }
  }
  function renderResults() {
    const expectedCatalog = catalog, fragment = document.createDocumentFragment(); rows = [];
    for (const [index, reference] of catalog.references.entries()) {
      const section = document.createElement('section'); section.className = 'script-usage-reference'; section.dataset.objectId = reference.objectId;
      const path = document.createElement('h3'); path.textContent = reference.sourcePath; const status = document.createElement('p'), relations = document.createElement('p');
      const sourceButton = document.createElement('button'); sourceButton.type = 'button'; sourceButton.className = 'doc-btn doc-btn-ghost'; sourceButton.id = 'scriptUsageSource' + (index + 1);
      sourceButton.addEventListener('click', () => showSource(reference, null, expectedCatalog, sourceButton));
      section.append(path, status, relations, sourceButton); const bindings = [];
      for (const [bindingIndex, match] of reference.bindings.entries()) {
        const card = document.createElement('div'); card.className = 'script-usage-binding'; card.dataset.bindingId = match.bindingId;
        const label = document.createElement('h4'), scene = document.createElement('p'), parametersLabel = document.createElement('p'), parameters = document.createElement('pre');
        parameters.textContent = JSON.stringify(match.parameters, null, 2);
        const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'doc-btn doc-btn-ghost'; locate.id = 'scriptUsageSource' + (index + 1) + 'Binding' + (bindingIndex + 1);
        locate.addEventListener('click', () => showSource(reference, match, expectedCatalog, locate));
        card.append(label, scene, parametersLabel, parameters, locate); section.append(card); bindings.push({ match, label, scene, parametersLabel, sourceButton: locate });
      }
      fragment.append(section); rows.push({ reference, status, relations, sourceButton, bindings });
    }
    el('References').replaceChildren(fragment);
  }
  function captureSource(value) {
    const keys = ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision'];
    if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== keys.length) throw Error('source');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('source');
    const result = Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key].value])));
    if (result.sourcePath !== owner.sourcePath || result.token !== owner.sourceToken || !/^sha256:[a-f0-9]{64}$/.test(result.sourceRevision)
      || !/^sha256:[a-f0-9]{64}$/.test(result.baseSourceRevision) || result.sourceRevision.length !== 71 || result.baseSourceRevision.length !== 71) throw Error('source');
    return result;
  }
  async function read() {
    if (!current() || navigation) return false;
    const request = ++epoch; reading = true; source = null; clearResults(); message = '正在读取脚本使用位置…'; refresh();
    const owns = () => epoch === request && current();
    try {
      const nextSource = captureSource(await getSource()); if (!owns()) return false;
      const next = await getUsage(nextSource); if (!owns()) return false;
      if (!isScriptUsage(next) || !scriptUsageMatchSource(next, nextSource)) throw Error('catalog');
      source = nextSource; catalog = next; renderResults(); message = catalog.references.length ? '已读取 {0} 份引用文档，匹配 {1} 个行为绑定。' : '未找到已登记的脚本引用；这不代表没有动态或未登记的使用。'; return true;
    } catch { if (owns()) message = '无法读取脚本使用位置；原文和草稿保持不变。'; return false; }
    finally { if (!disposed && dialog.open && epoch === request) { reading = false; refresh(); } }
  }
  function close({ focus = true } = {}) {
    const target = focus ? opener : null, request = ++epoch; opener = null; owner = null; source = null; navigation = null; reading = false; invalidated = false; clearResults(); message = '';
    if (dialog.open) dialog.close(); refresh(); Promise.resolve().then(() => { if (!disposed && epoch === request && !dialog.open) target?.focus?.(); });
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.available !== true || context.busy) return false;
    owner = context; invalidated = false; opener = document.activeElement; dialog.showModal(); return read();
  }
  async function navigate() {
    if (!current() || reading || navigation || !selection || !catalog || !scriptUsageMatchSource(catalog, source)) return false;
    const ticket = { epoch, catalog, selection }; navigation = ticket; message = '正在核对并打开引用原文…'; refresh();
    const owns = () => !disposed && dialog.open && navigation === ticket && epoch === ticket.epoch && catalog === ticket.catalog && selection === ticket.selection;
    try {
      const request = createScriptUsageOpenSourceRequest(catalog, selection), result = await openSource(request, { isCurrent: owns });
      if (!owns()) return false;
      if (result === true) { close({ focus: false }); return true; }
      if (result && typeof result.focus === 'function') { close({ focus: false }); result.focus(); return true; }
      message = '引用原文未确认打开，请刷新后重试。'; return false;
    } catch { if (owns()) message = '引用原文未确认打开，请刷新后重试。'; return false; }
    finally { if (owns()) { navigation = null; refresh(); } }
  }
  button.addEventListener('click', () => void open()); el('Refresh').addEventListener('click', () => void read()); el('OpenSource').addEventListener('click', () => void navigate());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && ['s', 'enter'].includes(event.key.toLowerCase())) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!disposed && !dialog.open && (owner || reading || navigation)) close(); });
  const unsubscribe = onLanguageChange(refresh); refresh();
  return Object.freeze({ open, refresh, dispose() { if (disposed) return; disposed = true; epoch++; owner = null; catalog = null; selection = null; navigation = null; reading = false;
    if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); button.remove(); } });
}
