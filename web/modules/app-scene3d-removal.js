import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DRemovalProposal, isScene3DRemovalProposal } from '../../engine/scene3d-removal.mjs';
import { supportsStudioCoreScene3DRemovalPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A local multi-object authoring form. The injected source port owns draft
// application; this module has no renderer, backend, World or Save capability.
export function setupScene3DRemoval({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dRemovalStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dRemovalStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-removal.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dRemovalBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dRemovalUnavailable'; unavailable.className = 'scene3d-removal-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dRemovalDialog'; dialog.className = 'scene3d-removal-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dRemovalTitle');
  dialog.innerHTML = `<header class="scene3d-removal-header"><h2 id="scene3dRemovalTitle" data-i18n="批量移除3D对象"></h2><button id="scene3dRemovalClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-removal-note" data-i18n="勾选要移除的对象，审阅待删除、保留对象和完整原文后应用到草稿；仍需普通保存。场景至少保留一个对象。"></p>
    <p id="scene3dRemovalPath" class="scene3d-removal-note"></p><p id="scene3dRemovalStatus" role="status" aria-live="polite"></p><p id="scene3dRemovalDiagnostic" class="scene3d-removal-diagnostic"></p>
    <section id="scene3dRemovalFields"><label class="scene3d-removal-search"><span data-i18n="按名称或UUID查找对象"></span><input id="scene3dRemovalSearch" type="search" autocomplete="off" spellcheck="false"></label>
      <div class="scene3d-removal-selection-controls"><p id="scene3dRemovalSelection" role="status" aria-live="polite"></p><button id="scene3dRemovalSelectResults" type="button" class="doc-btn doc-btn-ghost" data-i18n="选中当前结果"></button><button id="scene3dRemovalClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清空选择"></button></div>
      <p class="scene3d-removal-note" data-i18n="搜索只过滤列表；隐藏的已选对象仍参与移除。默认不选择任何对象，全选不会自动保留或删减某个对象。"></p><p id="scene3dRemovalNoResults" class="scene3d-removal-note" hidden data-i18n="没有匹配的对象。请修改名称或UUID筛选。"></p>
      <ul id="scene3dRemovalObjects" class="scene3d-removal-objects"></ul><p id="scene3dRemovalCapacity" role="status"></p><p id="scene3dRemovalBlocked" class="scene3d-removal-diagnostic"></p></section>
    <section id="scene3dRemovalReview" hidden><h3 data-i18n="3D批量移除审阅"></h3><p id="scene3dRemovalImpact" class="scene3d-removal-note"></p>
      <div class="scene3d-removal-comparison"><section><h4 data-i18n="待移除对象声明"></h4><pre id="scene3dRemovalBefore"></pre></section><section><h4 data-i18n="保留对象声明"></h4><pre id="scene3dRemovalAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dRemovalChangedPaths"></ul><details id="scene3dRemovalSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dRemovalSource" tabindex="0"></pre></details></section>
    <p class="scene3d-removal-note" data-i18n="移除只删除对象声明及必要分隔符，保留对象的顺序、身份和原文写法；不会删除素材。应用后仍需在编辑器保存。"></p>
    <footer class="scene3d-removal-footer"><button id="scene3dRemovalCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D移除"></button><button id="scene3dRemovalApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button><button id="scene3dRemovalCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dRemoval${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, rowsEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let selected = new Set(), proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DRemovalPatch === 'function' && supportsStudioCoreScene3DRemovalPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && typeof context.sourcePath === 'string'
    && context.sourcePath && typeof context.sourceToken === 'string' && context.sourceToken);
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context) && !context.busy && supported()
    && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const selectedObjects = () => session?.model.objects.filter(object => selected.has(object.instanceId)) || [];
  const matches = () => { const query = el('Search').value.trim().toLowerCase(); return session?.model.objects.filter(object => !query || object.name.toLowerCase().includes(query) || object.instanceId.toLowerCase().includes(query)) || []; };
  const rawChoices = () => Array.from(el('Objects').querySelectorAll('input[type=checkbox]'), checkbox => [checkbox.dataset.instanceId, checkbox.checked]);
  const consistentSelection = () => JSON.stringify(rawChoices()) === JSON.stringify(matches().map(object => [object.instanceId, selected.has(object.instanceId)]));
  const ids = () => selectedObjects().map(object => object.instanceId);
  const consistentIntent = () => consistentSelection();
  const maximum = () => session ? session.model.objects.length - 1 : 0;
  const blocked = () => !session ? '' : session.model.objects.length === 1 ? '场景至少保留一个对象；当前只有一个对象。' : selected.size > maximum() ? '场景至少保留一个对象；请取消勾选一个对象。' : '';
  const changed = () => selected.size > 0;
  const signature = () => JSON.stringify({ selected: ids(), query: el('Search').value, choices: rawChoices() });
  const approvalMatches = () => Boolean(proposal && approved === proposal && consistentIntent() && signature() === rawSignature
    && isScene3DRemovalProposal(proposal) && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '3D批量移除尚未应用到原文草稿。'; }
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
        invalidate(); if (checkbox.checked) selected.add(object.instanceId); else selected.delete(object.instanceId); refresh();
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
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '3D批量移除尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开3D批量移除。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('批量移除3D对象');
    button.title = supported() ? t('批量移除3D对象') : t('当前核心不支持3D批量移除，原文编辑和其他3D功能仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D批量移除');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; const locked = pending || !current();
    el('Search').disabled = locked; el('Search').placeholder = t('名称或UUID'); el('SelectResults').disabled = locked || !matches().length; el('ClearSelection').disabled = locked || !selected.size;
    el('Check').disabled = locked || !selected.size || Boolean(blocked()); el('Apply').disabled = locked || !approvalMatches(); el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.removedObjects, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.remainingObjects, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('Capacity').textContent = session ? t('对象数量') + '：' + session.model.objects.length + ' → ' + (session.model.objects.length - selected.size) + ' · ' + t('本次最多移除数量') + '：' + maximum() : ''; el('Blocked').textContent = t(blocked());
    el('Impact').textContent = proposal ? `${t('已选对象')}：${proposal.instanceIds.length} · ${t('保留对象数量')}：${proposal.remainingObjects.length}` : '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    renderObjects();
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次3D批量移除？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected.clear(); viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = ''; el('Search').value = '';
    if (dialog.open) dialog.close(); queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) { const code = error?.errorCode;
    message = code === 'scene3d_removal_conflict' ? '原文草稿已变化，请关闭后重新打开3D批量移除。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取可移除的3D对象…'; diagnostic = ''; selected.clear(); el('Search').value = '';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && supported() && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content, baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false; session = { snapshot, model: parsed.model };
      message = '请选择要移除的对象；至少保留一个对象。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function check() {
    if (pending || !current() || !selected.size || blocked()) { refresh(); return false; }
    if (!consistentIntent()) { invalidate(); message = '对象选择已变化，请重新确认后检查。'; refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const selectedIds = ids(), remainingObjects = session.model.objects.filter(object => !selected.has(object.instanceId));
      const candidate = createScene3DRemovalProposal(session.snapshot, { instanceIds: selectedIds });
      if (!current() || !consistentIntent() || signature() !== raw) return false;
      const paths = session.model.objects.flatMap((object, index) => selected.has(object.instanceId) ? ['/objects/' + index] : []);
      if (!isScene3DRemovalProposal(candidate) || candidate.kind !== 'scene3d-removal' || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.baseSourceRevision !== session.snapshot.baseSourceRevision || candidate.sourceRevision !== session.snapshot.sourceRevision
        || candidate.beforeContent !== session.snapshot.content || JSON.stringify(candidate.instanceIds) !== JSON.stringify(selectedIds)
        || JSON.stringify(candidate.removedObjects) !== JSON.stringify(selectedObjects()) || JSON.stringify(candidate.remainingObjects) !== JSON.stringify(remainingObjects)
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || JSON.stringify(candidate.changedPaths) !== JSON.stringify(paths)) throw Error('The complete removal proposal was not confirmed.');
      const afterModel = parseScene3DSource(candidate.afterContent).model;
      if (!remainingObjects.length || JSON.stringify(afterModel.objects) !== JSON.stringify(remainingObjects)) throw Error('The surviving object inventory was not confirmed.');
      proposal = candidate; approved = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); message = '3D移除已检查，请审阅待删除、保留对象及完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '3D批量移除有误，请检查选择和保留对象后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && consistentIntent() && signature() === raw && proposal === candidate && isScene3DRemovalProposal(candidate) && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用3D批量移除到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false; const context = getContext();
      if (formEpoch !== form || !consistentIntent() || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical || result?.applied !== true
        || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || !result.sourceToken
        || result.sourceToken === owner.snapshot.token || !eligible(context) || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '3D批量移除未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  el('Search').addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('SelectResults').addEventListener('click', () => { if (!pending && current()) { invalidate(); for (const object of matches()) selected.add(object.instanceId); refresh(); } });
  el('ClearSelection').addEventListener('click', () => { if (!pending && current()) { selected.clear(); invalidate(); refresh(); } });
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', check); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(refresh); refresh();
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); unavailable.remove(); dialog.remove(); }
  return Object.freeze({ open, close, refresh, dispose, destroy: dispose });
}
