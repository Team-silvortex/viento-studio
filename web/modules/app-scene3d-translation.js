import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DTranslationProposal, isScene3DTranslationProposal } from '../../engine/scene3d-translation.mjs';
import { supportsStudioCoreScene3DTranslationPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A local multi-object authoring form. The injected source port owns draft
// application; this module has no renderer, backend, World or Save capability.
export function setupScene3DTranslation({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dTranslationStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dTranslationStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-translation.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dTranslationBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dTranslationUnavailable'; unavailable.className = 'scene3d-translation-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dTranslationDialog'; dialog.className = 'scene3d-translation-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dTranslationTitle');
  dialog.innerHTML = `<header class="scene3d-translation-header"><h2 id="scene3dTranslationTitle" data-i18n="整体移动3D对象"></h2>
    <button id="scene3dTranslationClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-translation-note" data-i18n="明确勾选要移动的对象，再设置统一位移。检查全部对象和完整原文后应用到草稿，仍需普通保存。"></p>
    <p id="scene3dTranslationPath" class="scene3d-translation-note"></p><p id="scene3dTranslationStatus" role="status" aria-live="polite"></p>
    <p id="scene3dTranslationDiagnostic" class="scene3d-translation-diagnostic"></p>
    <section id="scene3dTranslationFields"><label class="scene3d-translation-search"><span data-i18n="按名称或UUID查找对象"></span><input id="scene3dTranslationSearch" type="search" autocomplete="off" spellcheck="false"></label>
      <div class="scene3d-translation-selection-controls"><p id="scene3dTranslationSelection" role="status" aria-live="polite"></p>
        <button id="scene3dTranslationSelectResults" type="button" class="doc-btn doc-btn-ghost" data-i18n="选中当前结果"></button>
        <button id="scene3dTranslationClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清空选择"></button></div>
      <p class="scene3d-translation-note" data-i18n="搜索只过滤列表；隐藏的已选对象仍参与整体移动。默认不选中任何对象。"></p>
      <p id="scene3dTranslationNoResults" class="scene3d-translation-note" hidden data-i18n="没有匹配的对象。请修改名称或UUID筛选。"></p>
      <ul id="scene3dTranslationObjects" class="scene3d-translation-objects"></ul>
      <fieldset class="scene3d-translation-offset"><legend data-i18n="统一位移 XYZ（米）"></legend><div class="scene3d-translation-axes">${['X', 'Y', 'Z'].map(axis => `<label>${axis}<input id="scene3dTranslation${axis}" type="number" step="any" min="-200000" max="200000" value="0" aria-label="${axis}"></label>`).join('')}</div></fieldset>
      <p class="scene3d-translation-note" data-i18n="核心会原子检查所有最终位置；任一对象越界则整批拒绝，其他字段和未选对象保持原文。"></p></section>
    <section id="scene3dTranslationReview" hidden><h3 data-i18n="整体平移审阅"></h3><p id="scene3dTranslationImpact" class="scene3d-translation-note"></p>
      <div class="scene3d-translation-comparison"><section><h4 data-i18n="修改前的对象声明"></h4><pre id="scene3dTranslationBefore"></pre></section>
        <section><h4 data-i18n="修改后的对象声明"></h4><pre id="scene3dTranslationAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dTranslationChangedPaths"></ul>
      <details id="scene3dTranslationSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dTranslationSource" tabindex="0"></pre></details></section>
    <p class="scene3d-translation-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-translation-footer"><button id="scene3dTranslationCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查整体平移"></button>
      <button id="scene3dTranslationApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dTranslationCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dTranslation${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, rowsEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let selected = new Set(), proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DTranslationPatch === 'function' && supportsStudioCoreScene3DTranslationPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && typeof context.sourcePath === 'string'
    && context.sourcePath && typeof context.sourceToken === 'string' && context.sourceToken);
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context) && !context.busy && supported()
    && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const selectedObjects = () => session?.model.objects.filter(object => selected.has(object.instanceId)) || [];
  const matches = () => { const query = el('Search').value.trim().toLowerCase(); return session?.model.objects.filter(object => !query || object.name.toLowerCase().includes(query) || object.instanceId.toLowerCase().includes(query)) || []; };
  const rawChoices = () => Array.from(el('Objects').querySelectorAll('input[type=checkbox]'), checkbox => [checkbox.dataset.instanceId, checkbox.checked]);
  const consistentSelection = () => JSON.stringify(rawChoices()) === JSON.stringify(matches().map(object => [object.instanceId, selected.has(object.instanceId)]));
  const changed = () => selected.size > 0 || ['X', 'Y', 'Z'].some(axis => el(axis).value !== '0');
  const signature = () => JSON.stringify({ selected: selectedObjects().map(object => object.instanceId), query: el('Search').value, choices: rawChoices(), offset: ['X', 'Y', 'Z'].map(axis => el(axis).value) });
  const approvalMatches = () => Boolean(proposal && approved === proposal && consistentSelection() && signature() === rawSignature
    && isScene3DTranslationProposal(proposal) && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '整体平移尚未应用到原文草稿。'; }
  function renderObjects() {
    const focusedId = el('Objects').contains(document.activeElement) ? document.activeElement?.dataset?.instanceId : null;
    const owner = session, request = epoch, generation = ++rowsEpoch;
    el('Objects').replaceChildren(); const rows = matches(), locked = pending || !current();
    for (const object of rows) {
      const item = node('li'), label = node('label'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.dataset.instanceId = object.instanceId;
      checkbox.checked = selected.has(object.instanceId); checkbox.disabled = locked;
      checkbox.addEventListener('change', () => {
        if (pending || !current() || session !== owner || epoch !== request || rowsEpoch !== generation
          || !el('Objects').contains(checkbox) || checkbox.dataset.instanceId !== object.instanceId) return;
        checkbox.checked ? selected.add(object.instanceId) : selected.delete(object.instanceId); invalidate(); refresh();
      });
      label.append(checkbox, node('span', object.name)); item.append(label, node('code', object.instanceId)); el('Objects').append(item);
      if (focusedId === object.instanceId && !locked) checkbox.focus();
    }
    el('NoResults').hidden = !session || rows.length !== 0;
    const visibleSelected = rows.filter(object => selected.has(object.instanceId)).length;
    el('Selection').textContent = `${t('已选对象')}：${selected.size} / ${session?.model.objects.length || 0} · ${t('筛选结果外的已选对象')}：${selected.size - visibleSelected} · ${t('匹配对象')}：${rows.length}`;
  }
  function refresh() {
    if (disposed) return; const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '整体平移尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开整体平移。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('整体移动3D对象');
    button.title = supported() ? t('整体移动3D对象') : t('当前核心不支持3D整体平移，原文编辑和其他3D功能仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D整体平移');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; const locked = pending || !current();
    el('Search').disabled = locked; el('Search').placeholder = t('名称或UUID'); el('SelectResults').disabled = locked || !matches().length; el('ClearSelection').disabled = locked || !selected.size;
    for (const axis of ['X', 'Y', 'Z']) el(axis).disabled = locked;
    el('Check').disabled = locked || !selected.size; el('Apply').disabled = locked || !approvalMatches(); el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObjects, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObjects, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('Impact').textContent = proposal ? `${t('已选对象')}：${proposal.instanceIds.length} · ${t('统一位移 XYZ（米）')}：${proposal.offset.join(', ')}` : '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    renderObjects();
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次整体平移？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected.clear(); viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = ''; el('Search').value = ''; for (const axis of ['X', 'Y', 'Z']) el(axis).value = '0';
    if (dialog.open) dialog.close(); queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) { const code = error?.errorCode;
    message = code === 'scene3d_translation_unchanged' ? '整体平移未改变任何位置，原文草稿保持不变。' : code === 'scene3d_translation_conflict' ? '原文草稿已变化，请关闭后重新打开整体平移。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取整体平移对象…'; diagnostic = ''; selected.clear(); el('Search').value = ''; for (const axis of ['X', 'Y', 'Z']) el(axis).value = '0';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && supported() && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content, baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false; session = { snapshot, model: parsed.model };
      message = '选择对象并设置统一位移。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function offset() { return ['X', 'Y', 'Z'].map(axis => { const raw = el(axis).value.trim(), number = Number(raw); if (!raw || !Number.isFinite(number) || number < -200000 || number > 200000) throw Error(t('位移XYZ需要完整的有限数值，范围为负200000到200000米。')); return number; }); }
  function check() {
    if (pending || !current() || !selected.size) { refresh(); return false; }
    if (!consistentSelection()) { invalidate(); message = '对象选择已变化，请重新确认选择后检查。'; refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const ids = selectedObjects().map(object => object.instanceId), delta = offset(), candidate = createScene3DTranslationProposal(session.snapshot, { instanceIds: ids, offset: delta });
      if (!current() || !consistentSelection() || signature() !== raw) return false;
      if (!isScene3DTranslationProposal(candidate) || candidate.kind !== 'scene3d-translation' || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.beforeContent !== session.snapshot.content || JSON.stringify(candidate.instanceIds) !== JSON.stringify(ids) || JSON.stringify(candidate.offset) !== JSON.stringify(delta)
        || JSON.stringify(candidate.beforeObjects) !== JSON.stringify(selectedObjects()) || !Array.isArray(candidate.afterObjects) || JSON.stringify(candidate.afterObjects.map(object => object.instanceId)) !== JSON.stringify(ids)
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length) throw Error('The complete source proposal was not confirmed.');
      proposal = candidate; approved = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); message = '整体平移已检查，请审阅所有选中对象与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '整体平移有误，请检查对象选择、位移与最终位置范围后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && consistentSelection() && signature() === raw && proposal === candidate && isScene3DTranslationProposal(candidate) && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用整体平移到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false; const context = getContext();
      if (formEpoch !== form || !consistentSelection() || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical || result?.applied !== true
        || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || !result.sourceToken
        || result.sourceToken === owner.snapshot.token || !eligible(context) || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '整体平移未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  el('Search').addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('SelectResults').addEventListener('click', () => { if (!pending && current()) { for (const object of matches()) selected.add(object.instanceId); invalidate(); refresh(); } });
  el('ClearSelection').addEventListener('click', () => { if (!pending && current()) { selected.clear(); invalidate(); refresh(); } });
  for (const axis of ['X', 'Y', 'Z']) el(axis).addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', check); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(refresh); refresh();
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); unavailable.remove(); dialog.remove(); }
  return Object.freeze({ open, close, refresh, dispose, destroy: dispose });
}
