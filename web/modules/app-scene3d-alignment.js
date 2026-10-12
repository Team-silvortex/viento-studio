import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DAlignmentProposal, isScene3DAlignmentProposal } from '../../engine/scene3d-alignment.mjs';
import { supportsStudioCoreScene3DAlignmentPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A local multi-object authoring form. The injected source port owns draft
// application; this module has no renderer, backend, World or Save capability.
export function setupScene3DAlignment({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dAlignmentStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dAlignmentStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-alignment.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dAlignmentBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dAlignmentUnavailable'; unavailable.className = 'scene3d-alignment-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dAlignmentDialog'; dialog.className = 'scene3d-alignment-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dAlignmentTitle');
  dialog.innerHTML = `<header class="scene3d-alignment-header"><h2 id="scene3dAlignmentTitle" data-i18n="对齐3D位置"></h2>
    <button id="scene3dAlignmentClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-alignment-note" data-i18n="明确勾选至少两个对象，并指定一个已选参照对象。沿作者X/Y/Z轴对齐对象位置，检查完整原文后应用到草稿，仍需普通保存。"></p>
    <p id="scene3dAlignmentPath" class="scene3d-alignment-note"></p><p id="scene3dAlignmentStatus" role="status" aria-live="polite"></p>
    <p id="scene3dAlignmentDiagnostic" class="scene3d-alignment-diagnostic"></p>
    <section id="scene3dAlignmentFields"><label class="scene3d-alignment-search"><span data-i18n="按名称或UUID查找对象"></span><input id="scene3dAlignmentSearch" type="search" autocomplete="off" spellcheck="false"></label>
      <div class="scene3d-alignment-selection-controls"><p id="scene3dAlignmentSelection" role="status" aria-live="polite"></p>
        <button id="scene3dAlignmentSelectResults" type="button" class="doc-btn doc-btn-ghost" data-i18n="选中当前结果"></button>
        <button id="scene3dAlignmentClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清空选择"></button></div>
      <p class="scene3d-alignment-note" data-i18n="搜索只过滤列表；隐藏的已选对象仍参与位置对齐。默认不选择对象或参照对象。"></p>
      <p id="scene3dAlignmentNoResults" class="scene3d-alignment-note" hidden data-i18n="没有匹配的对象。请修改名称或UUID筛选。"></p>
      <ul id="scene3dAlignmentObjects" class="scene3d-alignment-objects"></ul>
      <fieldset class="scene3d-alignment-reference"><legend data-i18n="参照对象与作者轴"></legend><div class="scene3d-alignment-controls">
        <label><span data-i18n="参照对象（必须已选）"></span><select id="scene3dAlignmentAnchor"></select></label>
        <label><span data-i18n="作者轴"></span><select id="scene3dAlignmentAxis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
      </div><p id="scene3dAlignmentCoordinate" class="scene3d-alignment-note"></p></fieldset>
      <p class="scene3d-alignment-note" data-i18n="仅将所选对象指定轴的位置设为参照对象的原坐标；其他坐标、旋转和尺寸保持原文。这是作者轴位置对齐，不是方块边缘或屏幕对齐。"></p></section>
    <section id="scene3dAlignmentReview" hidden><h3 data-i18n="位置对齐审阅"></h3><p id="scene3dAlignmentImpact" class="scene3d-alignment-note"></p>
      <div class="scene3d-alignment-comparison"><section><h4 data-i18n="修改前的对象声明"></h4><pre id="scene3dAlignmentBefore"></pre></section>
        <section><h4 data-i18n="修改后的对象声明"></h4><pre id="scene3dAlignmentAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dAlignmentChangedPaths"></ul>
      <details id="scene3dAlignmentSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dAlignmentSource" tabindex="0"></pre></details></section>
    <p class="scene3d-alignment-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-alignment-footer"><button id="scene3dAlignmentCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查位置对齐"></button>
      <button id="scene3dAlignmentApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dAlignmentCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dAlignment${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, rowsEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let selected = new Set(), anchor = '', axis = 'x', proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DAlignmentPatch === 'function' && supportsStudioCoreScene3DAlignmentPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && typeof context.sourcePath === 'string'
    && context.sourcePath && typeof context.sourceToken === 'string' && context.sourceToken);
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context) && !context.busy && supported()
    && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const selectedObjects = () => session?.model.objects.filter(object => selected.has(object.instanceId)) || [];
  const matches = () => { const query = el('Search').value.trim().toLowerCase(); return session?.model.objects.filter(object => !query || object.name.toLowerCase().includes(query) || object.instanceId.toLowerCase().includes(query)) || []; };
  const rawChoices = () => Array.from(el('Objects').querySelectorAll('input[type=checkbox]'), checkbox => [checkbox.dataset.instanceId, checkbox.checked]);
  const consistentSelection = () => JSON.stringify(rawChoices()) === JSON.stringify(matches().map(object => [object.instanceId, selected.has(object.instanceId)]));
  const consistentIntent = () => consistentSelection() && el('Anchor').value === anchor && el('Axis').value === axis && ['x', 'y', 'z'].includes(axis) && (!anchor || selected.has(anchor));
  const changed = () => selected.size > 0 || anchor !== '' || axis !== 'x';
  const signature = () => JSON.stringify({ selected: selectedObjects().map(object => object.instanceId), query: el('Search').value, choices: rawChoices(), anchor: el('Anchor').value, axis: el('Axis').value });
  const approvalMatches = () => Boolean(proposal && approved === proposal && consistentIntent() && signature() === rawSignature
    && isScene3DAlignmentProposal(proposal) && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '位置对齐尚未应用到原文草稿。'; }
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
        checkbox.checked ? selected.add(object.instanceId) : selected.delete(object.instanceId); if (!selected.has(anchor)) anchor = ''; invalidate(); refresh();
      });
      label.append(checkbox, node('span', object.name)); item.append(label, node('code', object.instanceId)); el('Objects').append(item);
      if (focusedId === object.instanceId && !locked) checkbox.focus();
    }
    el('NoResults').hidden = !session || rows.length !== 0;
    const visibleSelected = rows.filter(object => selected.has(object.instanceId)).length;
    el('Selection').textContent = `${t('已选对象')}：${selected.size} / ${session?.model.objects.length || 0} · ${t('筛选结果外的已选对象')}：${selected.size - visibleSelected} · ${t('匹配对象')}：${rows.length}`;
  }
  function renderReference() {
    const focused = document.activeElement === el('Anchor'), choices = selectedObjects();
    el('Anchor').replaceChildren(); const blank = node('option', t('请选择已选参照对象')); blank.value = ''; el('Anchor').append(blank);
    for (const object of choices) { const option = node('option', `${object.name} · ${object.instanceId}`); option.value = object.instanceId; el('Anchor').append(option); }
    el('Anchor').value = anchor; el('Axis').value = axis;
    if (focused && !el('Anchor').disabled) el('Anchor').focus();
    const object = choices.find(object => object.instanceId === anchor);
    el('Coordinate').textContent = object ? `${t('参照原坐标')} ${axis.toUpperCase()}：${object.position[['x', 'y', 'z'].indexOf(axis)]} ${t('米')}` : t('参照对象为空；请选择已选对象，不会自动指定。');
  }
  function refresh() {
    if (disposed) return; const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '位置对齐尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开位置对齐。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('对齐3D位置');
    button.title = supported() ? t('对齐3D位置') : t('当前核心不支持3D位置对齐，原文编辑和其他3D功能仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D位置对齐');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; const locked = pending || !current();
    el('Search').disabled = locked; el('Search').placeholder = t('名称或UUID'); el('SelectResults').disabled = locked || !matches().length; el('ClearSelection').disabled = locked || !selected.size;
    el('Anchor').disabled = locked || !selected.size; el('Axis').disabled = locked;
    el('Check').disabled = locked || selected.size < 2 || !anchor; el('Apply').disabled = locked || !approvalMatches(); el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObjects, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObjects, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('Impact').textContent = proposal ? `${t('已选对象')}：${proposal.instanceIds.length} · ${t('参照对象')}：${proposal.anchorInstanceId} · ${t('作者轴')}：${proposal.axis.toUpperCase()}` : '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    renderObjects(); renderReference();
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次位置对齐？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected.clear(); viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = ''; el('Search').value = ''; anchor = ''; axis = 'x'; el('Anchor').value = ''; el('Axis').value = 'x';
    if (dialog.open) dialog.close(); queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) { const code = error?.errorCode;
    message = code === 'scene3d_alignment_unchanged' ? '位置对齐未改变任何坐标，原文草稿保持不变。' : code === 'scene3d_alignment_conflict' ? '原文草稿已变化，请关闭后重新打开位置对齐。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取位置对齐对象…'; diagnostic = ''; selected.clear(); el('Search').value = ''; anchor = ''; axis = 'x'; el('Anchor').value = ''; el('Axis').value = 'x';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && supported() && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content, baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false; session = { snapshot, model: parsed.model };
      message = '请选择至少两个对象、已选参照对象和作者轴。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function check() {
    if (pending || !current() || selected.size < 2 || !anchor) { refresh(); return false; }
    if (!consistentIntent()) { invalidate(); message = '对象选择、参照对象或作者轴已变化，请重新确认后检查。'; refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const ids = selectedObjects().map(object => object.instanceId), candidate = createScene3DAlignmentProposal(session.snapshot, { instanceIds: ids, anchorInstanceId: anchor, axis });
      if (!current() || !consistentIntent() || signature() !== raw) return false;
      if (!isScene3DAlignmentProposal(candidate) || candidate.kind !== 'scene3d-alignment' || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.beforeContent !== session.snapshot.content || JSON.stringify(candidate.instanceIds) !== JSON.stringify(ids) || candidate.anchorInstanceId !== anchor || candidate.axis !== axis
        || JSON.stringify(candidate.beforeObjects) !== JSON.stringify(selectedObjects()) || !Array.isArray(candidate.afterObjects) || JSON.stringify(candidate.afterObjects.map(object => object.instanceId)) !== JSON.stringify(ids)
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length) throw Error('The complete source proposal was not confirmed.');
      proposal = candidate; approved = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); message = '位置对齐已检查，请审阅参照坐标、所有选中对象与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '位置对齐有误，请检查对象选择、参照对象和作者轴后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && consistentIntent() && signature() === raw && proposal === candidate && isScene3DAlignmentProposal(candidate) && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用位置对齐到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false; const context = getContext();
      if (formEpoch !== form || !consistentIntent() || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical || result?.applied !== true
        || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || !result.sourceToken
        || result.sourceToken === owner.snapshot.token || !eligible(context) || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '位置对齐未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  el('Search').addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('SelectResults').addEventListener('click', () => { if (!pending && current()) { for (const object of matches()) selected.add(object.instanceId); invalidate(); refresh(); } });
  el('ClearSelection').addEventListener('click', () => { if (!pending && current()) { selected.clear(); anchor = ''; invalidate(); refresh(); } });
  el('Anchor').addEventListener('change', () => { if (!pending && current()) { const value = el('Anchor').value; if (value === '' || selected.has(value)) anchor = value; invalidate(); refresh(); } });
  el('Axis').addEventListener('change', () => { if (!pending && current()) { const value = el('Axis').value; if (['x', 'y', 'z'].includes(value)) axis = value; invalidate(); refresh(); } });
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', check); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(refresh); refresh();
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); unavailable.remove(); dialog.remove(); }
  return Object.freeze({ open, close, refresh, dispose, destroy: dispose });
}
