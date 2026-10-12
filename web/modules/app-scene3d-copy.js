import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DCopyProposal, isScene3DCopyProposal } from '../../engine/scene3d-copy.mjs';
import { supportsStudioCoreScene3DCopyPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A local multi-object authoring form. The injected source port owns draft
// application; this module has no renderer, backend, World or Save capability.
export function setupScene3DCopy({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dCopyStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dCopyStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-copy.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dCopyBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dCopyUnavailable'; unavailable.className = 'scene3d-copy-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dCopyDialog'; dialog.className = 'scene3d-copy-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dCopyTitle');
  dialog.innerHTML = `<header class="scene3d-copy-header"><h2 id="scene3dCopyTitle" data-i18n="批量复制3D对象"></h2>
    <button id="scene3dCopyClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-copy-note" data-i18n="明确勾选要复制的对象，再设置复制件的统一位移。检查原对象到新UUID的映射和完整原文后应用到草稿，仍需普通保存。"></p>
    <p id="scene3dCopyPath" class="scene3d-copy-note"></p><p id="scene3dCopyStatus" role="status" aria-live="polite"></p>
    <p id="scene3dCopyDiagnostic" class="scene3d-copy-diagnostic"></p>
    <section id="scene3dCopyFields"><label class="scene3d-copy-search"><span data-i18n="按名称或UUID查找对象"></span><input id="scene3dCopySearch" type="search" autocomplete="off" spellcheck="false"></label>
      <div class="scene3d-copy-selection-controls"><p id="scene3dCopySelection" role="status" aria-live="polite"></p>
        <button id="scene3dCopySelectResults" type="button" class="doc-btn doc-btn-ghost" data-i18n="选中当前结果"></button>
        <button id="scene3dCopyClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清空选择"></button></div>
      <p class="scene3d-copy-note" data-i18n="搜索只过滤列表；隐藏的已选对象仍参与复制。默认不选择任何对象。每个来源在本次对话框只分配一次新UUID。"></p>
      <p id="scene3dCopyNoResults" class="scene3d-copy-note" hidden data-i18n="没有匹配的对象。请修改名称或UUID筛选。"></p>
      <ul id="scene3dCopyObjects" class="scene3d-copy-objects"></ul><p id="scene3dCopyCapacity" role="status"></p><p id="scene3dCopyBlocked" class="scene3d-copy-diagnostic"></p><h3 data-i18n="来源到新对象的UUID映射"></h3><p id="scene3dCopyMappingEmpty" class="scene3d-copy-note" data-i18n="勾选来源后分配新UUID；取消后再选会复用，关闭重开才重新分配。"></p><ul id="scene3dCopyMapping" class="scene3d-copy-mapping"></ul>
      <fieldset class="scene3d-copy-offset"><legend data-i18n="统一位移 XYZ（米）"></legend><div class="scene3d-copy-axes">${['X', 'Y', 'Z'].map(axis => `<label>${axis}<input id="scene3dCopy${axis}" type="number" step="any" min="-200000" max="200000" value="0" aria-label="${axis}"></label>`).join('')}</div></fieldset>
      <p class="scene3d-copy-note" data-i18n="复制件保留原名称、旋转、尺寸和颜色，不添加名称后缀。零位移也会创建新对象。复制件按来源声明顺序追加；任一复制件位置越界或总数超过128，整批拒绝。"></p></section>
    <section id="scene3dCopyReview" hidden><h3 data-i18n="3D批量复制审阅"></h3><p id="scene3dCopyImpact" class="scene3d-copy-note"></p>
      <div class="scene3d-copy-comparison"><section><h4 data-i18n="来源对象声明"></h4><pre id="scene3dCopyBefore"></pre></section>
        <section><h4 data-i18n="新复制件声明"></h4><pre id="scene3dCopyAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dCopyChangedPaths"></ul>
      <details id="scene3dCopySourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dCopySource" tabindex="0"></pre></details></section>
    <p class="scene3d-copy-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-copy-footer"><button id="scene3dCopyCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D复制"></button>
      <button id="scene3dCopyApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dCopyCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dCopy${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, rowsEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let selected = new Set(), allocated = new Map(), proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DCopyPatch === 'function' && supportsStudioCoreScene3DCopyPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && typeof context.sourcePath === 'string'
    && context.sourcePath && typeof context.sourceToken === 'string' && context.sourceToken);
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context) && !context.busy && supported()
    && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const selectedObjects = () => session?.model.objects.filter(object => selected.has(object.instanceId)) || [];
  const matches = () => { const query = el('Search').value.trim().toLowerCase(); return session?.model.objects.filter(object => !query || object.name.toLowerCase().includes(query) || object.instanceId.toLowerCase().includes(query)) || []; };
  const rawChoices = () => Array.from(el('Objects').querySelectorAll('input[type=checkbox]'), checkbox => [checkbox.dataset.instanceId, checkbox.checked]);
  const consistentSelection = () => JSON.stringify(rawChoices()) === JSON.stringify(matches().map(object => [object.instanceId, selected.has(object.instanceId)]));
  const copies = () => selectedObjects().map(object => ({ sourceInstanceId: object.instanceId, newInstanceId: allocated.get(object.instanceId) }));
  const rawMapping = () => Array.from(el('Mapping').children, item => [item.dataset.sourceInstanceId, item.dataset.newInstanceId, item.querySelector('.scene3d-copy-source-id')?.textContent, item.querySelector('.scene3d-copy-new-id')?.textContent]);
  const consistentMapping = () => JSON.stringify(rawMapping()) === JSON.stringify(copies().map(pair => [pair.sourceInstanceId, pair.newInstanceId, pair.sourceInstanceId, pair.newInstanceId]));
  const consistentIntent = () => consistentSelection() && consistentMapping();
  const remaining = () => session ? 128 - session.model.objects.length : 0;
  const maximum = () => session ? Math.min(session.model.objects.length, remaining()) : 0;
  const blocked = () => !session ? '' : remaining() === 0 ? '场景已有128个对象；复制前请先移除对象。' : selected.size > maximum() ? '所选复制数量超过剩余容量；请减少选择。' : '';
  function allocate(id) {
    if (allocated.has(id)) return;
    const fresh = crypto.randomUUID();
    if (typeof fresh !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fresh)
      || session.model.objects.some(object => object.instanceId.toLowerCase() === fresh.toLowerCase()) || Array.from(allocated.values()).some(value => value.toLowerCase() === fresh.toLowerCase())) throw Error(t('无法分配有效且唯一的新UUID，请关闭后重试。'));
    allocated.set(id, fresh);
  }
  const changed = () => selected.size > 0 || ['X', 'Y', 'Z'].some(axis => el(axis).value !== '0');
  const signature = () => JSON.stringify({ selected: selectedObjects().map(object => object.instanceId), query: el('Search').value, choices: rawChoices(), copies: copies(), mapping: rawMapping(), offset: ['X', 'Y', 'Z'].map(axis => el(axis).value) });
  const approvalMatches = () => Boolean(proposal && approved === proposal && consistentIntent() && signature() === rawSignature
    && isScene3DCopyProposal(proposal) && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '3D批量复制尚未应用到原文草稿。'; }
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
        invalidate(); try { if (checkbox.checked) { allocate(object.instanceId); selected.add(object.instanceId); } else selected.delete(object.instanceId); } catch (error) { report(error, '无法分配有效且唯一的新UUID，请关闭后重试。'); } refresh();
      });
      label.append(checkbox, node('span', object.name)); item.append(label, node('code', object.instanceId)); el('Objects').append(item);
      if (focusedId === object.instanceId && !locked) checkbox.focus();
    }
    el('NoResults').hidden = !session || rows.length !== 0;
    const visibleSelected = rows.filter(object => selected.has(object.instanceId)).length;
    el('Selection').textContent = `${t('已选对象')}：${selected.size} / ${session?.model.objects.length || 0} · ${t('筛选结果外的已选对象')}：${selected.size - visibleSelected} · ${t('匹配对象')}：${rows.length}`;
  }
  function renderMapping() {
    el('Mapping').replaceChildren();
    for (const object of selectedObjects()) {
      const pair = { sourceInstanceId: object.instanceId, newInstanceId: allocated.get(object.instanceId) }, item = node('li'), source = node('code', pair.sourceInstanceId), target = node('code', pair.newInstanceId);
      item.dataset.sourceInstanceId = pair.sourceInstanceId; item.dataset.newInstanceId = pair.newInstanceId; source.className = 'scene3d-copy-source-id'; target.className = 'scene3d-copy-new-id';
      item.append(node('span', object.name), source, node('span', '→'), target); el('Mapping').append(item);
    }
    el('MappingEmpty').hidden = selected.size !== 0;
  }
  function refresh() {
    if (disposed) return; const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '3D批量复制尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开3D批量复制。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('批量复制3D对象');
    button.title = supported() ? t('批量复制3D对象') : t('当前核心不支持3D批量复制，原文编辑和其他3D功能仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D批量复制');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; const locked = pending || !current();
    el('Search').disabled = locked; el('Search').placeholder = t('名称或UUID'); el('SelectResults').disabled = locked || !matches().length; el('ClearSelection').disabled = locked || !selected.size;
    for (const axis of ['X', 'Y', 'Z']) el(axis).disabled = locked;
    el('Check').disabled = locked || !selected.size || Boolean(blocked()); el('Apply').disabled = locked || !approvalMatches(); el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObjects, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObjects, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('Capacity').textContent = session ? t('对象数量') + '：' + session.model.objects.length + ' → ' + (session.model.objects.length + selected.size) + ' · ' + t('剩余对象名额') + '：' + remaining() + ' · ' + t('本次最多复制数量') + '：' + maximum() : ''; el('Blocked').textContent = t(blocked());
    el('Impact').textContent = proposal ? `${t('已选对象')}：${proposal.copies.length} · ${t('统一位移 XYZ（米）')}：${proposal.offset.join(', ')}` : '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    renderObjects(); renderMapping();
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次3D批量复制？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected.clear(); allocated.clear(); viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = ''; el('Search').value = ''; for (const axis of ['X', 'Y', 'Z']) el(axis).value = '0';
    if (dialog.open) dialog.close(); queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) { const code = error?.errorCode;
    message = code === 'scene3d_copy_conflict' ? '原文草稿已变化，请关闭后重新打开3D批量复制。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取3D复制对象…'; diagnostic = ''; selected.clear(); allocated.clear(); el('Search').value = ''; for (const axis of ['X', 'Y', 'Z']) el(axis).value = '0';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && supported() && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content, baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false; session = { snapshot, model: parsed.model };
      message = '请选择来源对象并设置复制件位移。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function offset() { return ['X', 'Y', 'Z'].map(axis => { const raw = el(axis).value.trim(), number = Number(raw); if (!raw || !Number.isFinite(number) || number < -200000 || number > 200000) throw Error(t('位移XYZ需要完整的有限数值，范围为负200000到200000米。')); return number; }); }
  function check() {
    if (pending || !current() || !selected.size || blocked()) { refresh(); return false; }
    if (!consistentIntent()) { invalidate(); message = '对象选择或新UUID映射已变化，请重新确认后检查。'; refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const pairs = copies(), ids = pairs.map(pair => pair.newInstanceId), delta = offset(), candidate = createScene3DCopyProposal(session.snapshot, { copies: pairs, offset: delta });
      if (!current() || !consistentIntent() || signature() !== raw) return false;
      if (!isScene3DCopyProposal(candidate) || candidate.kind !== 'scene3d-copy' || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.beforeContent !== session.snapshot.content || JSON.stringify(candidate.copies) !== JSON.stringify(pairs) || JSON.stringify(candidate.offset) !== JSON.stringify(delta)
        || JSON.stringify(candidate.beforeObjects) !== JSON.stringify(selectedObjects()) || !Array.isArray(candidate.afterObjects) || JSON.stringify(candidate.afterObjects.map(object => object.instanceId)) !== JSON.stringify(ids)
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length) throw Error('The complete source proposal was not confirmed.');
      const afterModel = parseScene3DSource(candidate.afterContent).model;
      if (afterModel.objects.length !== session.model.objects.length + pairs.length || JSON.stringify(afterModel.objects.slice(0, session.model.objects.length)) !== JSON.stringify(session.model.objects)
        || JSON.stringify(afterModel.objects.slice(session.model.objects.length)) !== JSON.stringify(candidate.afterObjects)) throw Error('The original and appended object inventory was not confirmed.');
      proposal = candidate; approved = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); message = '3D复制已检查，请审阅数量、UUID映射、原对象与复制件声明及完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '3D批量复制有误，请检查选择、UUID、容量和复制件位置后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && consistentIntent() && signature() === raw && proposal === candidate && isScene3DCopyProposal(candidate) && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用3D批量复制到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false; const context = getContext();
      if (formEpoch !== form || !consistentIntent() || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical || result?.applied !== true
        || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || !result.sourceToken
        || result.sourceToken === owner.snapshot.token || !eligible(context) || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '3D批量复制未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  el('Search').addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('SelectResults').addEventListener('click', () => { if (!pending && current()) { invalidate(); try { const rows = matches(); for (const object of rows) allocate(object.instanceId); for (const object of rows) selected.add(object.instanceId); } catch (error) { report(error, '无法分配有效且唯一的新UUID，请关闭后重试。'); } refresh(); } });
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
