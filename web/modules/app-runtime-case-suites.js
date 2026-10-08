import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { validateRuntimeCaseSuite, summarizeRuntimeCaseSuite } from '../../engine/runtime-case-suite-contract.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

// This controller edits author membership and renders host-owned progress. It
// never queues engines, copies expectations or advances a loaded CAS baseline.
export function setupRuntimeCaseSuites({ container, request, getState, onRun, onInspect = () => {}, onChange = () => {} }) {
  container.innerHTML = `<details id="projectBuildSuiteEditor" class="build-control-editor"><summary data-i18n="批量运行验收"></summary>
    <p class="build-hint" data-i18n="将同一场景的已保存用例组成有序验收组。保存后由宿主逐份运行；断言失败继续，执行失败或取消停止剩余用例。"></p>
    <div class="build-case-document-picker"><label for="projectBuildSuiteSelect" data-i18n="已保存验收组"></label><select id="projectBuildSuiteSelect"></select>
    <button id="projectBuildSuiteRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新验收组与用例"></button>
    <button id="projectBuildSuiteLoad" type="button" class="doc-btn doc-btn-ghost" data-i18n="载入验收组"></button></div>
    <fieldset class="build-suite-members"><legend data-i18n="选择组内用例"></legend><p id="projectBuildSuiteCount" class="build-hint"></p>
    <div id="projectBuildSuiteCases"></div></fieldset>
    <div class="build-case-document-fields"><label for="projectBuildSuitePath" data-i18n="验收组保存位置"></label><input id="projectBuildSuitePath" type="text" maxlength="2048" autocomplete="off">
    <label for="projectBuildSuiteType" data-i18n="验收组文档类型"></label><select id="projectBuildSuiteType"></select></div>
    <div class="build-actions"><button id="projectBuildSuiteSave" type="button" class="doc-btn" data-i18n="保存验收组"></button>
    <button id="projectBuildSuiteSaveAs" type="button" class="doc-btn doc-btn-ghost" data-i18n="验收组另存为"></button>
    <button id="projectBuildSuiteNew" type="button" class="doc-btn doc-btn-ghost" data-i18n="作为新验收组"></button>
    <button id="projectBuildSuiteRun" type="button" class="doc-btn" data-i18n="运行已保存验收组"></button></div>
    <p id="projectBuildSuiteStatus" class="build-hint" role="status" aria-live="polite"></p><p id="projectBuildSuiteError" role="alert" hidden></p></details>
    <section id="projectBuildSuiteResult" class="build-case-result" hidden aria-labelledby="projectBuildSuiteResultTitle"><h3 id="projectBuildSuiteResultTitle" data-i18n="批量验收结果"></h3>
    <p id="projectBuildSuiteSummary" role="status" aria-live="polite"></p><ol id="projectBuildSuiteEntries"></ol></section>`;
  const el = suffix => container.querySelector(`#projectBuildSuite${suffix}`);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const version = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const errors = {
    runtime_suite_document_conflict: '验收组原文已变化。请重新载入，或另存为新组；当前成员选择已保留。',
    runtime_suite_document_exists: '请填写工程正文目录内未占用的 JSON 保存位置。',
    runtime_suite_document_path: '请填写工程正文目录内未占用的 JSON 保存位置。',
    runtime_suite_document_request: '验收组格式有误，请核对成员和保存位置。',
    runtime_suite_invalid: '验收组格式有误，请核对成员和保存位置。',
    runtime_suite_document_missing: '已保存验收组不可读取。请刷新列表；当前成员选择已保留。',
    runtime_suite_scene_conflict: '场景原文已变化。请刷新列表并重新载入验收组；当前成员选择已保留。',
    runtime_suite_scene_mismatch: '此验收组属于另一个场景。请选择对应场景，或明确作为新组。',
    runtime_suite_limit: '验收组超出 16 份用例、4096 份实例步骤或 1024 条检查的限制。',
    runtime_suite_member_missing: '验收组成员缺失或无效，请刷新并核对已保存用例。',
    runtime_suite_dependency_unavailable: '工程来源不可读取，不能载入、保存或启动批量验收。已启动批次继续使用捕获内容。',
    world_unavailable: '工程来源不可读取，不能载入、保存或启动批量验收。已启动批次继续使用捕获内容。',
    runtime_case_scene_missing: '工程来源不可读取，不能载入、保存或启动批量验收。已启动批次继续使用捕获内容。',
    runtime_case_unsupported: '批量验收仅支持无行为的第 2 版冻结场景与有限无头控制回放。',
    runtime_suite_unsupported: '批量验收仅支持无行为的第 2 版冻结场景与有限无头控制回放。',
    runtime_case_target_missing: '用例检查引用了当前场景中不存在的实例，请核对后保存。',
    runtime_case_invalid: '用例文档格式或场景引用无效，请检查验收定义。',
    runtime_case_document_unlinked: '场景尚未登记到角色的关系，请先在世界与对象中补齐，再保存用例。',
    runtime_case_dependency_unavailable: '用例依赖的场景或角色原文不可读取，请恢复来源后再载入或保存。',
  };
  let catalog = null, catalogScene = '', choice = '', loaded = null, members = [], boundScene = '', baseline = '';
  let busy = false, epoch = 0, revision = 0, lastScene = '', pathEdited = false, uncertain = false, errorKey = '';
  const pendingSaves = new Set();
  const draft = () => ({ format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: boundScene || getState().sceneId, documentIds: [...members] });
  const signature = () => canonicalJson(draft());
  const dirty = () => signature() !== baseline;
  const foreign = () => Boolean(boundScene && boundScene !== getState().sceneId);
  const owner = () => ({ ...getState(), revision, signature: signature() });
  const owns = (origin, requestEpoch, unchanged = false) => {
    const now = getState(); return epoch === requestEpoch && now.visible && now.session === origin.session && now.sceneId === origin.sceneId
      && (!unchanged || revision === origin.revision && signature() === origin.signature);
  };
  const readable = () => { const state = getState(); return Boolean(state.available && state.visible && state.sceneId && !state.active && !state.offline && !busy); };
  const writable = () => { const state = getState(); return readable() && state.editable && !state.dirty && !state.creating && !state.busy && !foreign() && !uncertain; };
  const mayRun = () => { const state = getState(); return Boolean(loaded?.valid && !dirty() && !foreign() && !uncertain && !busy && !state.offline && state.canRun && state.buildId); };
  const fail = error => { errorKey = errors[error?.code || error?.errorCode] || '验收组操作未完成，请刷新核对；当前成员选择已保留。'; };
  function suggestedPath() {
    if (catalogScene !== getState().sceneId || !catalog) return '';
    const prefix = `${catalog.defaults.documentsPath.replace(/\/$/, '')}/runtime-suites/${getState().sceneId.slice(0, 8)}-suite`;
    const occupied = new Set([...catalog.documents, ...catalog.cases].map(item => item.path)); if (loaded?.path) occupied.add(loaded.path);
    let candidate = `${prefix}.json`, number = 2; while (occupied.has(candidate)) candidate = `${prefix}-${number++}.json`; return candidate;
  }
  function renderResult() {
    const job = getState().job, suite = job?.suite, list = el('Entries');
    el('Result').hidden = job?.kind !== 'suite' || !suite || job.sceneId !== getState().sceneId || job.buildId !== getState().buildId || job.backendId !== getState().backendId;
    if (el('Result').hidden) { list.replaceChildren(); list.dataset.signature = ''; return; }
    try {
      if (!uuid(suite.documentId) || !version(suite.sourceVersion) || suite.sceneObjectId !== getState().sceneId
        || !Array.isArray(suite.entries) || suite.entries.length < 1 || suite.entries.length > 16) throw new Error('Invalid suite result.');
      const summary = summarizeRuntimeCaseSuite(suite.entries.map(item => item.state));
      if (canonicalJson(summary) !== canonicalJson(suite.summary)) throw new Error('Invalid suite counts.');
      const seen = new Set(), statuses = { queued: '等待运行', running: '正在运行', passed: '验收通过', failed: '验收未通过', incomplete: '验收未完成', 'not-run': '未运行' };
      const rows = suite.entries.map((entry, index) => {
        if (!uuid(entry.documentId) || seen.has(entry.documentId) || !version(entry.sourceVersion) || typeof entry.title !== 'string'
          || entry.title.length > 512 || ![null, 'succeeded', 'failed', 'cancelled', 'timeout'].includes(entry.executionStatus)
          || entry.sessionId !== null && !uuid(entry.sessionId)
          || !['checkCount', 'passedChecks', 'failedChecks', 'unavailableChecks'].every(key => Number.isSafeInteger(entry[key]) && entry[key] >= 0 && entry[key] <= 128)) throw new Error('Invalid suite member result.');
        seen.add(entry.documentId); const row = document.createElement('li'); row.className = 'build-case-check';
        const title = document.createElement('p'); title.textContent = t('第 {0} 项 · {1} · {2}', index + 1, entry.title, t(statuses[entry.state]));
        const counts = document.createElement('p'); counts.textContent = t('检查 {0} · 通过 {1} · 未通过 {2} · 无样本 {3}', entry.checkCount, entry.passedChecks, entry.failedChecks, entry.unavailableChecks);
        const identity = document.createElement('p'); identity.className = 'build-monospace'; identity.textContent = entry.documentId;
        const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'doc-btn doc-btn-ghost build-suite-report-open';
        inspect.dataset.caseReport = 'true'; inspect.dataset.documentId = entry.documentId; inspect.textContent = t('查看用例详情');
        inspect.disabled = entry.reportAvailable !== true || !['passed', 'failed', 'incomplete'].includes(entry.state);
        inspect.addEventListener('click', () => {
          const current = getState().job;
          if (current?.id === job.id && current?.suite?.entries.some(item => item.documentId === entry.documentId
            && item.reportAvailable === true && ['passed', 'failed', 'incomplete'].includes(item.state))) onInspect(entry.documentId);
        });
        row.append(title, counts, identity, inspect); return row;
      });
      el('Summary').textContent = t('{0} · 完成 {1}/{2} · 通过 {3} · 未通过 {4} · 未完成 {5} · 未运行 {6}',
        t({ running: '批量验收进行中', passed: '批量验收通过', failed: '批量验收未通过', incomplete: '批量验收未完成' }[summary.status]),
        summary.completed, summary.total, summary.passed, summary.failed, summary.incomplete, summary.notRun);
      const resultSignature = canonicalJson([job.id, suite.entries, suite.summary, el('Summary').textContent, rows.map(row => row.textContent)]);
      if (list.dataset.signature !== resultSignature) { list.replaceChildren(...rows); list.dataset.signature = resultSignature; }
    } catch { list.replaceChildren(); list.dataset.signature = ''; el('Summary').textContent = t('批量验收结果不可读取，请刷新状态。'); }
  }
  function render() {
    const state = getState(); container.hidden = !state.sceneId;
    if (lastScene !== state.sceneId) { lastScene = state.sceneId; choice = ''; revision++; pathEdited = false; el('Path').value = suggestedPath(); }
    translatePage(container);
    const current = catalogScene === state.sceneId ? catalog : null;
    const optionsSignature = canonicalJson([current?.documents || [], choice, t('请先刷新验收组列表'), t('暂无已保存验收组'), t('需要修复')]);
    if (el('Select').dataset.signature !== optionsSignature) {
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = t(current ? '暂无已保存验收组' : '请先刷新验收组列表');
      const options = (current?.documents || []).map(item => { const option = document.createElement('option'); option.value = item.id;
        option.textContent = `${item.title || item.path}${item.valid ? '' : ` · ${t('需要修复')}`}`; return option; });
      el('Select').replaceChildren(placeholder, ...options); el('Select').value = choice; el('Select').dataset.signature = optionsSignature;
    }
    const types = current?.defaults.documentTypes || [], typeSignature = canonicalJson(types.map(item => [item.id, t(item.label)]));
    if (el('Type').dataset.signature !== typeSignature) {
      const previous = el('Type').value; el('Type').replaceChildren(...types.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = t(item.label); return option; }));
      el('Type').value = types.some(item => item.id === previous) ? previous : current?.defaults.documentType || ''; el('Type').dataset.signature = typeSignature;
    }
    const editableMembers = Boolean(current && !state.active && !busy && !uncertain && !foreign());
    const cases = current?.cases || [], ordered = [...members.map(id => cases.find(item => item.id === id) || { id, title: id, valid: false }), ...cases.filter(item => !members.includes(item.id))];
    const memberSignature = canonicalJson([ordered, members, editableMembers, t('需要修复'), t('已选第 {0} 项'), t('未选入验收组')]);
    if (el('Cases').dataset.signature !== memberSignature) {
      const activeId = container.contains(document.activeElement) ? document.activeElement?.dataset?.documentId : null;
      el('Cases').replaceChildren(...ordered.map(item => {
        const row = document.createElement('label'); row.className = 'build-suite-member';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.documentId = item.id; checkbox.checked = members.includes(item.id);
        checkbox.disabled = !editableMembers || !checkbox.checked && (!item.valid || members.length >= 16);
        const label = document.createElement('span'); const number = members.indexOf(item.id);
        label.textContent = `${number < 0 ? t('未选入验收组') : t('已选第 {0} 项', number + 1)} · ${item.title || item.path}${item.valid ? '' : ` · ${t('需要修复')}`}`;
        label.setAttribute('title', item.id); row.append(checkbox, label);
        checkbox.addEventListener('change', () => {
          if (!editableMembers || getState().active || busy || uncertain || foreign()) { checkbox.checked = members.includes(item.id); render(); return; }
          if (checkbox.checked && !members.includes(item.id)) {
            if (members.length >= 16 || !item.valid) { checkbox.checked = false; errorKey = errors[members.length >= 16 ? 'runtime_suite_limit' : 'runtime_suite_member_missing']; render(); return; }
            members.push(item.id);
          }
          else if (!checkbox.checked) members = members.filter(id => id !== item.id);
          boundScene ||= getState().sceneId; revision++; errorKey = ''; render(); onChange();
        }); return row;
      }));
      el('Cases').dataset.signature = memberSignature;
      if (activeId) [...el('Cases').querySelectorAll('input')].find(item => item.dataset.documentId === activeId)?.focus();
    }
    el('Count').textContent = t('已选 {0}/16 份用例，按显示顺序执行。', members.length);
    el('Refresh').disabled = !readable(); el('Load').disabled = !readable() || !current?.documents.some(item => item.id === choice);
    el('Select').disabled = busy || state.active || !current;
    let valid = false; try { validateRuntimeCaseSuite(draft()); valid = true; } catch {}
    const canSave = writable() && valid && Boolean(loaded?.sceneVersion || current?.sceneVersion);
    el('Save').disabled = !canSave || !loaded && (!el('Path').value.trim() || !el('Type').value);
    el('SaveAs').disabled = !canSave || !current || !el('Path').value.trim() || !el('Type').value;
    el('New').disabled = busy || state.active || uncertain || !state.sceneId;
    el('Run').disabled = !mayRun(); el('Path').disabled = busy || state.active; el('Type').disabled = busy || state.active;
    const message = uncertain ? '验收组保存结果尚未确认。请刷新并明确载入后再写入；当前成员选择已保留。'
      : foreign() ? errors.runtime_suite_scene_mismatch : loaded && !loaded.valid ? '已载入需要修复的验收组，请核对成员后保存。'
        : loaded ? dirty() ? '已载入 {0} · 成员有未保存修改，保存后才能批量运行。' : '已载入 {0}'
          : current ? '新验收组草稿；至少选择一份用例，明确保存后才能批量运行。' : '先刷新验收组与用例列表；选择成员不会改动用例原文。';
    el('Status').textContent = busy ? t('正在处理验收组…') : t(message, loaded?.title || loaded?.path || '');
    el('Error').hidden = !errorKey; el('Error').textContent = errorKey ? t(errorKey) : '';
    renderResult();
  }
  async function refresh() {
    if (!readable()) return;
    const origin = owner(), requestEpoch = ++epoch; busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request({ action: 'suite-list', sceneId: origin.sceneId }); if (!owns(origin, requestEpoch)) return;
      if (result?.sceneId !== origin.sceneId || !version(result.sceneVersion) || !Array.isArray(result.documents) || !Array.isArray(result.cases)
        || typeof result.defaults?.documentsPath !== 'string' || !Array.isArray(result.defaults.documentTypes)) throw new Error('Invalid suite catalog.');
      catalog = result; catalogScene = origin.sceneId;
      if (!catalog.documents.some(item => item.id === choice)) choice = loaded?.sceneId === origin.sceneId && catalog.documents.some(item => item.id === loaded.id) ? loaded.id : '';
      if (!pathEdited) el('Path').value = suggestedPath();
    } catch (error) { if (owns(origin, requestEpoch)) fail(error); }
    finally { if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  async function load() {
    if (!readable() || !choice || catalogScene !== getState().sceneId) return;
    if ((loaded || members.length) && dirty() && !window.confirm(t('载入会替换当前未保存的验收组成员选择。继续吗？'))) return;
    const origin = owner(), documentId = choice, requestEpoch = ++epoch; busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request({ action: 'suite-load', documentId }); if (!owns(origin, requestEpoch, true)) return;
      const definition = validateRuntimeCaseSuite(result.definition || JSON.parse(result.content?.replace(/^\uFEFF/, '')));
      if (result.id !== documentId || result.sceneId !== origin.sceneId || definition.sceneObjectId !== origin.sceneId) throw Object.assign(new Error('Foreign suite.'), { errorCode: 'runtime_suite_scene_mismatch' });
      if (typeof result.content !== 'string' || !version(result.version) || !version(result.sceneVersion)) throw new Error('Invalid suite document.');
      loaded = result; boundScene = definition.sceneObjectId; members = [...definition.documentIds]; baseline = signature();
      uncertain = false; choice = result.id; errorKey = ''; revision++; pathEdited = false; el('Path').value = suggestedPath();
    } catch (error) { if (owns(origin, requestEpoch, true)) fail(error); }
    finally { if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  async function save(asNew = false) {
    if (!writable()) return;
    let definition; try { definition = validateRuntimeCaseSuite(draft()); } catch (error) { fail(error); render(); return; }
    const origin = owner(), previous = loaded, create = asNew || !previous, current = catalogScene === origin.sceneId ? catalog : null;
    const sceneVersion = create ? current?.sceneVersion : previous.sceneVersion;
    if (!sceneVersion || create && (!el('Path').value.trim() || !el('Type').value)) return;
    const content = previous && !dirty() ? previous.content : JSON.stringify(definition, null, 2);
    const payload = { action: 'suite-save', sceneId: origin.sceneId, sceneVersion, content,
      ...(create ? { sourcePath: el('Path').value.trim(), documentType: el('Type').value } : { documentId: previous.id, expectedVersion: previous.version }) };
    const requestEpoch = ++epoch; pendingSaves.add(requestEpoch); busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request(payload); if (!owns(origin, requestEpoch)) { uncertain = true; return; }
      if (!uuid(result?.id) || result.sceneId !== origin.sceneId || !version(result.version) || result.content !== content) { uncertain = true; throw new Error('Unconfirmed suite save.'); }
      loaded = result; boundScene = result.sceneId; baseline = origin.signature; choice = result.id; uncertain = false;
      if (catalogScene === origin.sceneId && catalog) { const { id, path, title, version, sceneId, valid, diagnostics } = result;
        catalog = { ...catalog, documents: [...catalog.documents.filter(item => item.id !== id), { id, path, title, version, sceneId, valid, diagnostics }] }; }
      pathEdited = false; el('Path').value = suggestedPath();
    } catch (error) { if (owns(origin, requestEpoch)) { fail(error); const status = error?.status ?? error?.statusCode; if (!Number.isInteger(status) || status < 400 || status >= 500) uncertain = true; } }
    finally { pendingSaves.delete(requestEpoch); if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  el('Refresh').addEventListener('click', () => void refresh()); el('Load').addEventListener('click', () => void load());
  el('Save').addEventListener('click', () => void save()); el('SaveAs').addEventListener('click', () => void save(true));
  el('Select').addEventListener('change', () => { choice = el('Select').value; errorKey = ''; render(); });
  el('Path').addEventListener('input', () => { pathEdited = true; render(); }); el('Type').addEventListener('change', render);
  el('New').addEventListener('click', () => { if (busy || getState().active || uncertain) return;
    loaded = null; boundScene = getState().sceneId; baseline = ''; choice = ''; errorKey = ''; revision++; pathEdited = false; el('Path').value = suggestedPath(); render(); onChange(); });
  el('Run').addEventListener('click', () => { if (mayRun()) void onRun({ suiteDocumentId: loaded.id, expectedVersion: loaded.version }); });
  onLanguageChange(render); render();
  return { render, isBusy: () => busy, closed() { if (pendingSaves.size) uncertain = true; epoch++; busy = false; render(); } };
}
