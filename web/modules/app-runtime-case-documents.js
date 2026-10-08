import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { validateRuntimeCase } from '../../engine/runtime-verification-case.mjs';

// Author documents are independent of the frozen execution plan and its polling.
export function setupRuntimeCaseDocuments({ container, getState, getText, setText, request, onChange = () => {} }) {
  container.innerHTML = `<div class="build-case-documents"><h4 data-i18n="工程验收用例"></h4>
    <p class="build-hint" data-i18n="用例保存到工程正文，可随工程或资源包迁移。载入不会改动控制回放文本。"></p>
    <div class="build-case-document-picker"><label for="projectBuildCaseDocumentSelect" data-i18n="已保存用例"></label>
    <select id="projectBuildCaseDocumentSelect"></select>
    <button id="projectBuildCaseDocumentRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新用例"></button>
    <button id="projectBuildCaseDocumentLoad" type="button" class="doc-btn doc-btn-ghost" data-i18n="载入用例"></button></div>
    <div class="build-case-document-fields"><label for="projectBuildCaseDocumentPath" data-i18n="用例保存位置"></label>
    <input id="projectBuildCaseDocumentPath" type="text" maxlength="2048" autocomplete="off">
    <label for="projectBuildCaseDocumentType" data-i18n="用例文档类型"></label><select id="projectBuildCaseDocumentType"></select></div>
    <div class="build-actions"><button id="projectBuildCaseDocumentSave" type="button" class="doc-btn" data-i18n="保存用例"></button>
    <button id="projectBuildCaseDocumentSaveAs" type="button" class="doc-btn doc-btn-ghost" data-i18n="用例另存为"></button>
    <button id="projectBuildCaseDocumentNew" type="button" class="doc-btn doc-btn-ghost" data-i18n="作为新用例"></button></div>
    <p id="projectBuildCaseDocumentStatus" class="build-hint" role="status" aria-live="polite"></p>
    <p id="projectBuildCaseDocumentError" role="alert" hidden></p></div>`;
  const el = id => container.querySelector(`#projectBuildCaseDocument${id}`);
  const errors = {
    runtime_case_document_conflict: '用例原文已变化。请重新载入，或另存为新用例；当前草稿已保留。',
    conflict: '用例原文已变化。请重新载入，或另存为新用例；当前草稿已保留。',
    'document was modified by another client': '用例原文已变化。请重新载入，或另存为新用例；当前草稿已保留。',
    'document already exists': '请填写工程正文目录内未占用的 JSON 保存位置。',
    runtime_case_document_exists: '请填写工程正文目录内未占用的 JSON 保存位置。',
    runtime_case_scene_conflict: '场景原文已变化。请刷新用例并重新载入，再核对检查；当前草稿已保留。',
    runtime_case_scene_mismatch: '此用例属于另一个场景。请选择对应场景，或明确作为新用例。',
    runtime_case_scene_missing: '场景来源不可读取，不能载入或保存用例。已有冻结构建仍可运行。',
    world_unavailable: '场景来源不可读取，不能载入或保存用例。已有冻结构建仍可运行。',
    runtime_case_document_missing: '已保存用例不可读取。请刷新用例列表；当前草稿已保留。',
    runtime_case_document_path: '请填写工程正文目录内未占用的 JSON 保存位置。',
    runtime_case_document_invalid: '用例文档格式或场景引用无效，请检查验收定义。',
    runtime_case_invalid: '用例文档格式或场景引用无效，请检查验收定义。',
    runtime_case_target_missing: '用例检查引用了当前场景中不存在的实例，请核对后保存。',
    runtime_case_limit: '运行验收超出限制，请减少检查或控制步骤。',
    runtime_case_document_limit: '运行验收超出限制，请减少检查或控制步骤。',
    runtime_case_document_unlinked: '场景尚未登记到角色的关系，请先在世界与对象中补齐，再保存用例。',
    runtime_case_dependency_unavailable: '用例依赖的场景或角色原文不可读取，请恢复来源后再载入或保存。',
  };
  let catalog = null, catalogScene = '', choice = '', loaded = null, boundScene = '', baseline = '';
  let busy = false, epoch = 0, revision = 0, errorKey = '', uncertain = false, lastScene = '', pathEdited = false;
  const pendingSaves = new Set();
  const snapshot = () => ({ ...getState(), revision, text: getText() });
  const owns = (owner, requestEpoch, textRequired = false) => {
    const now = getState();
    return epoch === requestEpoch && now.visible && now.session === owner.session && now.sceneId === owner.sceneId
      && (!textRequired || revision === owner.revision && getText() === owner.text);
  };
  const dirty = () => getText() !== baseline;
  const foreign = () => Boolean(boundScene && boundScene !== getState().sceneId);
  const readable = () => {
    const state = getState();
    return state.available && state.visible && state.sceneId && !state.offline && !state.active && !busy;
  };
  const writable = () => {
    const state = getState();
    return readable() && state.editable && !state.dirty && !state.creating && !state.busy && !foreign() && !uncertain;
  };
  const fail = error => { errorKey = errors[error?.errorCode || error?.code] || '无法读取或保存用例，请重试；当前草稿已保留。'; };
  function suggestedPath() {
    if (!catalog || catalogScene !== getState().sceneId) return '';
    const prefix = `${catalog.defaults.documentsPath.replace(/\/$/, '')}/runtime-cases/${getState().sceneId.slice(0, 8)}-case`;
    const occupied = new Set(catalog.documents.map(item => item.path));
    if (loaded?.path) occupied.add(loaded.path);
    let candidate = `${prefix}.json`, suffix = 2;
    while (occupied.has(candidate)) candidate = `${prefix}-${suffix++}.json`;
    return candidate;
  }
  function readDefinition() {
    const text = getText();
    if (new TextEncoder().encode(text).length > 262144) throw Object.assign(new Error('Case exceeds budget.'), { errorCode: 'runtime_case_limit' });
    return validateRuntimeCase(JSON.parse(text));
  }
  function render() {
    const state = getState();
    if (lastScene !== state.sceneId) {
      lastScene = state.sceneId; choice = ''; pathEdited = false; revision++;
      el('Path').value = suggestedPath();
    }
    translatePage(container);
    const currentCatalog = catalogScene === state.sceneId ? catalog : null;
    const documents = currentCatalog?.documents || [];
    const signature = JSON.stringify([documents, choice, t('请先刷新用例列表'), t('暂无已保存用例'), t('需要修复')]);
    if (el('Select').dataset.signature !== signature) {
      const options = [];
      const placeholder = document.createElement('option'); placeholder.value = '';
      placeholder.textContent = t(currentCatalog ? '暂无已保存用例' : '请先刷新用例列表'); options.push(placeholder);
      for (const item of documents) {
        const option = document.createElement('option'); option.value = item.id;
        option.textContent = `${item.title || item.path}${item.valid ? '' : ` · ${t('需要修复')}`}`;
        options.push(option);
      }
      el('Select').replaceChildren(...options); el('Select').value = choice; el('Select').dataset.signature = signature;
    }
    const types = currentCatalog?.defaults.documentTypes || [];
    const typeSignature = JSON.stringify(types.map(item => [item.id, t(item.label)]));
    if (el('Type').dataset.signature !== typeSignature) {
      const previous = el('Type').value, options = types.map(item => {
        const option = document.createElement('option'); option.value = item.id; option.textContent = t(item.label); return option;
      });
      el('Type').replaceChildren(...options);
      el('Type').value = types.some(item => item.id === previous) ? previous : currentCatalog?.defaults.documentType || '';
      el('Type').dataset.signature = typeSignature;
    }
    el('Refresh').disabled = !readable(); el('Load').disabled = !readable() || !documents.some(item => item.id === choice);
    el('Select').disabled = busy || state.active || !currentCatalog;
    let valid = false; try { readDefinition(); valid = true; } catch {}
    const canSave = writable() && valid && Boolean(loaded?.sceneVersion || currentCatalog?.sceneVersion);
    el('Save').disabled = !canSave || (!loaded && (!el('Path').value.trim() || !el('Type').value));
    el('SaveAs').disabled = !canSave || !currentCatalog || !el('Path').value.trim() || !el('Type').value;
    el('New').disabled = busy || state.active || uncertain || !state.sceneId;
    el('Path').disabled = busy || state.active; el('Type').disabled = busy || state.active;
    const message = uncertain ? '保存结果尚未确认。请刷新并明确载入，避免重复写入；当前草稿已保留。'
      : foreign() ? '此用例属于另一个场景。请选择对应场景，或明确作为新用例。'
        : loaded && !loaded.valid ? '已载入需要修复的用例。请核对场景与检查，运行和保存都会重新校验。'
          : loaded ? (dirty() ? '已载入 {0} · 有未保存修改' : '已载入 {0}')
            : currentCatalog ? '新用例草稿；保存时关联当前场景。' : '先刷新用例列表，即可选择或保存工程用例。';
    el('Status').textContent = busy ? t('正在处理工程用例…') : t(message, loaded?.title || loaded?.path || '');
    el('Error').hidden = !errorKey; el('Error').textContent = errorKey ? t(errorKey) : '';
  }
  async function refresh() {
    if (!readable()) return;
    const owner = snapshot(), requestEpoch = ++epoch; busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request({ action: 'case-list', sceneId: owner.sceneId });
      if (!owns(owner, requestEpoch)) return;
      if (result?.sceneId !== owner.sceneId || typeof result.sceneVersion !== 'string' || !Array.isArray(result.documents)
        || typeof result.defaults?.documentsPath !== 'string' || !Array.isArray(result.defaults.documentTypes)) throw new Error('Invalid case catalog.');
      catalog = result; catalogScene = owner.sceneId;
      if (!catalog.documents.some(item => item.id === choice)) choice = loaded?.sceneId === owner.sceneId && catalog.documents.some(item => item.id === loaded.id) ? loaded.id : '';
      if (!pathEdited) el('Path').value = suggestedPath();
    } catch (error) { if (owns(owner, requestEpoch)) fail(error); }
    finally { if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  function applyLoaded(result, text) {
    loaded = result; boundScene = result.sceneId; baseline = text; uncertain = false;
    choice = result.id; setText(text); revision++; errorKey = ''; pathEdited = false; el('Path').value = suggestedPath();
  }
  async function load() {
    if (!readable() || !choice || catalogScene !== getState().sceneId) return;
    if (dirty() && !window.confirm(t('载入会替换当前未保存的验收草稿。继续吗？'))) return;
    const owner = snapshot(), documentId = choice, requestEpoch = ++epoch; busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request({ action: 'case-load', documentId });
      if (!owns(owner, requestEpoch, true)) return;
      if (result?.id !== documentId || result.sceneId !== owner.sceneId) throw Object.assign(new Error('Foreign case.'), { errorCode: 'runtime_case_scene_mismatch' });
      let definition = result.definition;
      if (!definition) { try { definition = JSON.parse(result.content?.replace(/^\uFEFF/, '')).case; } catch {} }
      if (!definition || typeof result.content !== 'string' || typeof result.version !== 'string') throw Object.assign(new Error('Invalid case document.'), { errorCode: 'runtime_case_document_invalid' });
      applyLoaded(result, JSON.stringify(definition, null, 2));
    } catch (error) { if (owns(owner, requestEpoch, true)) fail(error); }
    finally { if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  async function save(asNew = false) {
    if (!writable()) return;
    const owner = snapshot(), previous = loaded;
    const create = asNew || !previous, currentCatalog = catalogScene === owner.sceneId ? catalog : null;
    let content, definition;
    try {
      definition = readDefinition();
      content = previous?.sceneId === owner.sceneId && owner.text === baseline ? previous.content
        : JSON.stringify({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: owner.sceneId, case: definition }, null, 2);
    } catch (error) { fail(error); render(); return; }
    const sceneVersion = create ? currentCatalog?.sceneVersion : previous.sceneVersion;
    if (!sceneVersion || create && (!el('Path').value.trim() || !el('Type').value)) return;
    const payload = { action: 'case-save', sceneId: owner.sceneId, sceneVersion, content,
      ...(create ? { sourcePath: el('Path').value.trim(), documentType: el('Type').value }
        : { documentId: previous.id, expectedVersion: previous.version }) };
    const requestEpoch = ++epoch; pendingSaves.add(requestEpoch); busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request(payload);
      if (!owns(owner, requestEpoch)) { uncertain = true; return; }
      if (!result?.id || result.sceneId !== owner.sceneId || typeof result.version !== 'string' || result.content !== content) {
        uncertain = true; throw new Error('Unconfirmed case save.');
      }
      loaded = result; boundScene = result.sceneId; baseline = owner.text; choice = result.id; uncertain = false;
      if (catalogScene === owner.sceneId && catalog) {
        const { id, path, title, version, sceneId, valid, diagnostics } = result;
        catalog = { ...catalog, documents: [...catalog.documents.filter(item => item.id !== id), { id, path, title, version, sceneId, valid, diagnostics }] };
      }
      pathEdited = false; el('Path').value = suggestedPath();
    } catch (error) {
      if (owns(owner, requestEpoch)) {
        fail(error);
        // An HTTP conflict is a definite rejection. A missing transport response
        // must be reconciled by an explicit read, never an automatic duplicate.
        const status = error?.status ?? error?.statusCode;
        if (!Number.isInteger(status) || status < 400 || status >= 500) uncertain = true;
      }
    } finally { pendingSaves.delete(requestEpoch); if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  el('Refresh').addEventListener('click', () => void refresh());
  el('Load').addEventListener('click', () => void load());
  el('Save').addEventListener('click', () => void save());
  el('SaveAs').addEventListener('click', () => void save(true));
  el('Select').addEventListener('change', () => { choice = el('Select').value; errorKey = ''; render(); });
  el('Path').addEventListener('input', () => { pathEdited = true; render(); });
  el('Type').addEventListener('change', render);
  el('New').addEventListener('click', () => {
    if (busy || getState().active || uncertain) return;
    loaded = null; boundScene = getState().sceneId; baseline = ''; choice = ''; uncertain = false;
    errorKey = ''; revision++; pathEdited = false; el('Path').value = suggestedPath(); render(); onChange();
  });
  onLanguageChange(render);
  render();
  return {
    render, refresh, isBusy: () => busy, runAllowed: () => !foreign() && !busy,
    boundSceneId: () => boundScene || null,
    changed() { revision++; errorKey = ''; render(); },
    generated() {
      if (boundScene !== getState().sceneId) { loaded = null; baseline = ''; choice = ''; }
      boundScene = getState().sceneId; revision++; errorKey = ''; render();
    },
    closed() { if (pendingSaves.size) uncertain = true; epoch++; busy = false; render(); },
  };
}
