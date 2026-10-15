import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { inspectProjectAssembly, validateProjectAssembly } from '../../engine/project-assembly.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';

// This author controller owns only a JSON draft. It has no engine, polling,
// scene-editor, media or build-snapshot access.
export function setupProjectAssembly({ getContext, setBusy = () => {}, request, applied = async () => {} }) {
  const dialog = document.createElement('dialog'); dialog.id = 'projectAssemblyDialog'; dialog.className = 'project-assembly';
  dialog.setAttribute('aria-labelledby', 'projectAssemblyTitle'); dialog.dataset.vientoCloseGuard = 'true';
  dialog.innerHTML = `<header><h2 id="projectAssemblyTitle" data-i18n="项目组装"></h2><button id="projectAssemblyClose" type="button" class="doc-btn" data-i18n="返回构建"></button></header>
    <div class="project-assembly-body"><p data-i18n="将已保存的二维场景组合为一个项目，选择启动场景。成员顺序会保存在普通 JSON 文档中。"></p>
    <div class="project-assembly-picker"><label for="projectAssemblyDocuments" data-i18n="已保存组装"></label><select id="projectAssemblyDocuments"></select><button id="projectAssemblyLoad" type="button" class="doc-btn" data-i18n="载入组装"></button><button id="projectAssemblyNew" type="button" class="doc-btn" data-i18n="新建组装"></button><button id="projectAssemblyRefresh" type="button" class="doc-btn" data-i18n="重新读取工程"></button></div>
    <fieldset id="projectAssemblyFields"><div class="project-assembly-grid"><label for="projectAssemblyName" data-i18n="组装名称"></label><input id="projectAssemblyName" maxlength="160" autocomplete="off"><label for="projectAssemblyPath" data-i18n="组装保存位置"></label><input id="projectAssemblyPath" maxlength="1024" autocomplete="off"><label for="projectAssemblyType" data-i18n="文档类型"></label><select id="projectAssemblyType"></select></div>
    <div class="project-assembly-members"><section><label for="projectAssemblyCandidate" data-i18n="可添加场景"></label><select id="projectAssemblyCandidate"></select><button id="projectAssemblyAdd" type="button" class="doc-btn" data-i18n="加入项目"></button></section>
    <section><label for="projectAssemblyMembers" data-i18n="有序场景成员"></label><select id="projectAssemblyMembers" size="8"></select><div class="project-assembly-actions"><button id="projectAssemblyUp" type="button" class="doc-btn" data-i18n="上移"></button><button id="projectAssemblyDown" type="button" class="doc-btn" data-i18n="下移"></button><button id="projectAssemblyRemove" type="button" class="doc-btn" data-i18n="移除成员"></button></div></section></div>
    <label for="projectAssemblyEntry" data-i18n="启动场景"></label><select id="projectAssemblyEntry"></select><p id="projectAssemblyCount"></p></fieldset>
    <details id="projectAssemblyReview" hidden open><summary data-i18n="待保存组装原文"></summary><pre id="projectAssemblySource"></pre></details></div>
    <p id="projectAssemblyStatus" role="status" aria-live="polite"></p><p id="projectAssemblyError" role="alert" hidden></p>
    <footer><button id="projectAssemblyCheck" type="button" class="doc-btn" data-i18n="审阅组装"></button><button id="projectAssemblySave" type="button" class="doc-btn" data-i18n="保存组装"></button><button id="projectAssemblyCancel" type="button" class="doc-btn" data-i18n="取消"></button></footer>`;
  document.body.append(dialog);
  if (!document.querySelector('link[data-project-assembly]')) { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/web/project-assembly.css'; style.dataset.projectAssembly = 'true'; (document.head || document.body).append(style); }
  const el = name => dialog.querySelector('#projectAssembly' + name), copy = value => JSON.parse(JSON.stringify(value));
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const version = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const identity = value => JSON.stringify([value.session, value.sourceToken]);
  let available = false, disposed = false, owner = '', epoch = 0, busy = false, catalog = null, loaded = null, draft = null, baseline = '', preview = null, pending = null, needsRefresh = false, selectedMember = '', error = '', message = '', opener;
  const owns = token => !disposed && dialog.open && available && (token === undefined || token === epoch) && getContext().visible === true && identity(getContext()) === owner;
  const writable = () => owns() && !busy && !pending && !needsRefresh && catalog && draft && getContext().editable === true && !getContext().dirty && !getContext().creating && !getContext().busy;
  const signature = () => JSON.stringify(draft), dirty = () => Boolean(pending || draft && signature() !== baseline);
  const notifyBusy = value => { busy = value; setBusy(value); };
  function fields() { if (draft) { draft.title = el('Name').value; draft.path = el('Path').value; draft.type = el('Type').value; draft.entrySceneId = el('Entry').value; } }
  function options(select, rows, selected, placeholder = '') {
    const out = [];
    if (placeholder) { const option = document.createElement('option'); option.value = ''; option.textContent = t(placeholder); out.push(option); }
    for (const [value, label] of rows) { const option = document.createElement('option'); option.value = value; option.textContent = label; out.push(option); }
    select.replaceChildren(...out); select.value = selected;
  }
  const sceneLabel = id => { const item = catalog?.scenes.find(item => item.id === id); return item ? `${item.title} · ${item.path}` : id; };
  function render() {
    if (disposed) return; translatePage(dialog);
    options(el('Documents'), (catalog?.documents || []).map(item => [item.id, `${item.title}${item.valid ? '' : ' · ' + t('需要修复')}`]), el('Documents').value || loaded?.id || '', '选择组装文档');
    options(el('Type'), (catalog?.defaults.documentTypes || []).map(item => [item.id, t(item.label)]), draft?.type || '');
    options(el('Candidate'), (catalog?.scenes || []).filter(item => !draft?.sceneIds.includes(item.id)).map(item => [item.id, `${item.title} · ${item.path}`]), el('Candidate').value || (catalog?.scenes || []).find(item => !draft?.sceneIds.includes(item.id))?.id || '');
    const memberRows = (draft?.sceneIds || []).map((id, index) => [id, `${index + 1}. ${sceneLabel(id)}`]);
    options(el('Members'), memberRows, selectedMember); options(el('Entry'), memberRows, draft?.entrySceneId || '', '选择启动场景');
    el('Name').value = draft?.title || ''; el('Path').value = draft?.path || '';
    const can = writable(), locked = busy || Boolean(pending) || !owns();
    el('Fields').disabled = locked || !draft; el('Path').disabled = locked || Boolean(loaded); el('Type').disabled = locked || Boolean(loaded);
    el('Documents').disabled = locked; el('Load').disabled = locked || !el('Documents').value;
    el('New').disabled = locked || !catalog; el('Refresh').disabled = busy || !owns();
    el('Add').disabled = !can || !el('Candidate').value || draft.sceneIds.length >= 32;
    const index = draft?.sceneIds.indexOf(selectedMember) ?? -1;
    el('Remove').disabled = !can || index < 0; el('Up').disabled = !can || index < 1; el('Down').disabled = !can || index < 0 || index === draft.sceneIds.length - 1;
    el('Check').disabled = !can; el('Save').disabled = !can || !preview || preview.signature !== signature();
    el('Close').disabled = el('Cancel').disabled = busy;
    el('Review').hidden = !preview; el('Source').textContent = preview?.content || '';
    el('Count').textContent = t('已选择 {0} / 32 个场景', draft?.sceneIds.length || 0);
    el('Status').textContent = t(!owns() && dialog.open ? '当前作者会话已变化，请返回后重新打开组装。' : pending ? '组装保存结果尚未确认。请重新读取工程核对，勿重复保存。' : busy ? '正在处理项目组装…' : message);
    el('Error').hidden = !error; el('Error').textContent = error ? t(error) : '';
    dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(busy));
  }
  function checkedCatalog(value) {
    if (!value || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !version(value.baseRevision) || !Array.isArray(value.scenes) || !Array.isArray(value.documents)
      || typeof value.defaults?.documentsPath !== 'string' || !Array.isArray(value.defaults.documentTypes)
      || value.scenes.some(item => !uuid(item.id) || !version(item.version) || typeof item.path !== 'string' || typeof item.title !== 'string')
      || value.documents.some(item => !uuid(item.id) || !version(item.version) || typeof item.path !== 'string' || typeof item.title !== 'string')
      || new Set(value.scenes.map(item => item.id)).size !== value.scenes.length) throw Error('Invalid assembly catalog.');
    return copy(value);
  }
  function checkedDocument(value, expectedId) {
    const parsed = inspectProjectAssembly(value?.content);
    if (!uuid(value?.id) || expectedId && value.id !== expectedId || !version(value.version) || !version(value.baseRevision) || !/^world:[a-f0-9]{64}$/.test(value.worldId)
      || typeof value.path !== 'string' || typeof value.documentType !== 'string' || !parsed.recognized || !parsed.ok) throw Error('Invalid assembly document.');
    return { value: copy(value), definition: copy(parsed.value) };
  }
  function takeDocument(value) {
    const checked = checkedDocument(value); loaded = checked.value;
    draft = { title: checked.definition.title, sceneIds: checked.definition.sceneIds, entrySceneId: checked.definition.entrySceneId, path: value.path, type: value.documentType };
    selectedMember = draft.sceneIds[0] || ''; baseline = signature(); preview = null; pending = null; needsRefresh = false; error = ''; message = '组装已载入，可调整成员与启动场景。';
  }
  function newDraft() {
    loaded = null; draft = { title: t('新项目组装'), sceneIds: [], entrySceneId: '', path: `${catalog.defaults.documentsPath}/projects/assembly.json`, type: catalog.defaults.documentType };
    selectedMember = ''; baseline = signature(); preview = null; needsRefresh = false; error = ''; message = '选择场景后审阅完整组装原文，再保存。';
  }
  async function hash(content) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)); return 'sha256:' + Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join(''); }
  async function refresh() {
    if (!owns() || busy) return false;
    const token = epoch; notifyBusy(true); error = ''; render();
    try {
      const next = checkedCatalog(await request({ action: 'assembly-list' })); if (!owns(token)) return false;
      if (catalog && next.worldId !== catalog.worldId) throw Error('Foreign author world.'); catalog = next;
      if (pending) {
        const match = catalog.documents.find(item => item.path === pending.path && (!pending.id || item.id === pending.id));
        if (match) {
          const checked = checkedDocument(await request({ action: 'assembly-load', documentId: match.id }), match.id); if (!owns(token)) return false;
          if (checked.value.worldId === pending.worldId && checked.value.path === pending.path && checked.value.documentType === pending.type && checked.value.content === pending.content && checked.value.version === pending.version) {
            takeDocument(checked.value); catalog.baseRevision = checked.value.baseRevision;
            await applied(checked.value); if (token !== epoch || !dialog.open || getContext().session !== JSON.parse(owner)[0] || !getContext().visible || getContext().dirty || getContext().creating) return false; owner = identity(getContext()); message = '组装已保存，可在构建目标中选择。';
          }
        }
      } else { needsRefresh = false; if (!draft) newDraft(); preview = null; message = '工程目录已刷新；当前组装草稿已保留，请重新审阅。'; }
      return true;
    } catch (failure) { if (owns(token)) error = '无法读取项目组装；当前草稿已保留。'; return false; }
    finally { if (token === epoch && !disposed) { notifyBusy(false); render(); } }
  }
  async function load(id = el('Documents').value) {
    if (!owns() || busy || pending || !uuid(id) || dirty() && !window.confirm(t('载入会替换当前组装草稿。继续吗？'))) return false;
    const token = epoch; notifyBusy(true); error = ''; render();
    try {
      const result = checkedDocument(await request({ action: 'assembly-load', documentId: id }), id); if (!owns(token)) return false;
      if (catalog?.worldId !== result.value.worldId) throw Error('Foreign author world.');
      takeDocument(result.value); catalog.baseRevision = result.value.baseRevision; return true;
    } catch { if (owns(token)) error = '无法载入组装，请在原文编辑器修复；当前草稿已保留。'; return false; }
    finally { if (token === epoch && !disposed) { notifyBusy(false); render(); } }
  }
  function review() {
    if (!writable()) return false; fields(); preview = null; error = '';
    try {
      const value = validateProjectAssembly({ format: 'viento-project-assembly', schemaVersion: 1, title: draft.title, sceneIds: draft.sceneIds, entrySceneId: draft.entrySceneId });
      if (value.sceneIds.some(id => !catalog.scenes.some(item => item.id === id)) || getCreatePathError(draft.path) || !draft.path.startsWith(catalog.defaults.documentsPath + '/') || !/\.json$/i.test(draft.path) || !catalog.defaults.documentTypes.some(type => type.id === draft.type)) throw Error('Invalid assembly location or membership.');
      const content = loaded && signature() === baseline ? loaded.content : JSON.stringify(value, null, 2) + '\n';
      preview = { signature: signature(), content }; message = '请核对成员顺序、启动场景与完整原文，再保存组装。';
    } catch { error = '组装设置无效，请选择 1–32 个不同场景、有效启动场景和 JSON 保存位置。'; }
    render(); return Boolean(preview);
  }
  async function save() {
    if (!writable() || !preview || preview.signature !== signature()) return false;
    fields(); if (preview.signature !== signature()) { preview = null; render(); return false; }
    const token = epoch, content = preview.content, payload = { action: 'assembly-save', worldId: catalog.worldId, baseRevision: catalog.baseRevision, content,
      ...(loaded ? { documentId: loaded.id, expectedVersion: loaded.version } : { sourcePath: draft.path, documentType: draft.type }) };
    notifyBusy(true); error = ''; render();
    try {
      const expected = await hash(content); if (!owns(token)) return false;
      pending = { id: loaded?.id || null, path: draft.path, type: draft.type, content, version: expected, worldId: catalog.worldId };
      const result = checkedDocument(await request(payload), pending.id); if (!owns(token)) return false;
      if (result.value.path !== pending.path || result.value.documentType !== pending.type || result.value.content !== content || result.value.version !== expected || result.value.worldId !== pending.worldId) throw Error('Unconfirmed assembly save.');
      takeDocument(result.value); catalog.baseRevision = result.value.baseRevision;
      await applied(result.value); if (token !== epoch || !dialog.open || getContext().session !== JSON.parse(owner)[0] || !getContext().visible || getContext().dirty || getContext().creating) return false; owner = identity(getContext()); message = '组装已保存，可在构建目标中选择。'; return true;
    } catch (failure) {
      if (owns(token)) {
        const code = failure.errorCode || failure.payload?.errorCode || failure.payload?.data?.errorCode;
        if (['project_assembly_document_conflict', 'project_assembly_document_exists', 'project_assembly_document_invalid', 'project_assembly_document_path', 'project_assembly_document_type', 'registry_busy'].includes(code)) { pending = null; needsRefresh = true; }
        preview = null; error = pending ? '' : '组装保存未完成；当前草稿已保留，请重新读取并审阅。';
      }
      return false;
    } finally { if (token === epoch && !disposed) { notifyBusy(false); render(); } }
  }
  function close() {
    if (busy || dirty() && !window.confirm(t('丢弃当前未保存的组装设置？'))) return false;
    epoch++; owner = ''; catalog = loaded = draft = preview = pending = null; dialog.dataset.dirty = 'false'; dialog.close(); opener?.focus?.(); return true;
  }
  async function open(documentId = '') {
    const context = getContext(); if (!available || disposed || dialog.open || !context.visible || !context.editable || context.dirty || context.creating || context.busy) return false;
    owner = identity(context); epoch++; opener = document.activeElement; message = ''; error = ''; dialog.showModal(); render();
    if (await refresh() && documentId) await load(documentId); return true;
  }
  function changed() { fields(); preview = null; error = ''; render(); }
  for (const name of ['Name', 'Path']) el(name).addEventListener('input', changed);
  for (const name of ['Type', 'Entry']) el(name).addEventListener('change', changed);
  el('Documents').addEventListener('change', render); el('Candidate').addEventListener('change', render);
  el('Members').addEventListener('change', () => { selectedMember = el('Members').value; render(); });
  el('Add').addEventListener('click', () => { if (!writable() || draft.sceneIds.length >= 32 || !catalog.scenes.some(item => item.id === el('Candidate').value) || draft.sceneIds.includes(el('Candidate').value)) return; draft.sceneIds.push(el('Candidate').value); selectedMember = el('Candidate').value; if (!draft.entrySceneId) draft.entrySceneId = selectedMember; preview = null; render(); });
  el('Remove').addEventListener('click', () => { if (!writable()) return; draft.sceneIds = draft.sceneIds.filter(id => id !== selectedMember); if (!draft.sceneIds.includes(draft.entrySceneId)) draft.entrySceneId = ''; selectedMember = draft.sceneIds[0] || ''; preview = null; render(); });
  for (const [name, offset] of [['Up', -1], ['Down', 1]]) el(name).addEventListener('click', () => { if (!writable()) return; const index = draft.sceneIds.indexOf(selectedMember), next = index + offset; if (index < 0 || next < 0 || next >= draft.sceneIds.length) return; [draft.sceneIds[index], draft.sceneIds[next]] = [draft.sceneIds[next], draft.sceneIds[index]]; preview = null; render(); });
  el('New').addEventListener('click', () => { if (!busy && !pending && catalog && (!dirty() || window.confirm(t('丢弃当前未保存的组装设置？')))) { newDraft(); render(); } });
  el('Load').addEventListener('click', () => void load()); el('Refresh').addEventListener('click', () => void refresh()); el('Check').addEventListener('click', review); el('Save').addEventListener('click', () => void save());
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  const unsubscribe = onLanguageChange(render);
  return Object.freeze({ open, refresh: render, isBusy: () => busy, setAvailable(value) { available = value === true; render(); }, dispose() { epoch++; disposed = true; if (busy) notifyBusy(false); if (typeof unsubscribe === 'function') unsubscribe(); dialog.remove(); } });
}
