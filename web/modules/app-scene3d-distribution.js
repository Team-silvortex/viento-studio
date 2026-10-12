import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DDistributionProposal, isScene3DDistributionProposal } from '../../engine/scene3d-distribution.mjs';
import { supportsStudioCoreScene3DDistributionPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A local multi-object authoring form. The injected source port owns draft
// application; this module has no renderer, backend, World or Save capability.
export function setupScene3DDistribution({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dDistributionStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dDistributionStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-distribution.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dDistributionBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dDistributionUnavailable'; unavailable.className = 'scene3d-distribution-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dDistributionDialog'; dialog.className = 'scene3d-distribution-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dDistributionTitle');
  dialog.innerHTML = `<header class="scene3d-distribution-header"><h2 id="scene3dDistributionTitle" data-i18n="等距分布3D位置"></h2>
    <button id="scene3dDistributionClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-distribution-note" data-i18n="明确勾选至少三个对象，再指定作者X/Y/Z轴。核心按原坐标排序并等距分布，检查完整原文后应用到草稿，仍需普通保存。"></p>
    <p id="scene3dDistributionPath" class="scene3d-distribution-note"></p><p id="scene3dDistributionStatus" role="status" aria-live="polite"></p>
    <p id="scene3dDistributionDiagnostic" class="scene3d-distribution-diagnostic"></p>
    <section id="scene3dDistributionFields"><label class="scene3d-distribution-search"><span data-i18n="按名称或UUID查找对象"></span><input id="scene3dDistributionSearch" type="search" autocomplete="off" spellcheck="false"></label>
      <div class="scene3d-distribution-selection-controls"><p id="scene3dDistributionSelection" role="status" aria-live="polite"></p>
        <button id="scene3dDistributionSelectResults" type="button" class="doc-btn doc-btn-ghost" data-i18n="选中当前结果"></button>
        <button id="scene3dDistributionClearSelection" type="button" class="doc-btn doc-btn-ghost" data-i18n="清空选择"></button></div>
      <p class="scene3d-distribution-note" data-i18n="搜索只过滤列表；隐藏的已选对象仍参与等距分布。默认不选择任何对象。"></p>
      <p id="scene3dDistributionNoResults" class="scene3d-distribution-note" hidden data-i18n="没有匹配的对象。请修改名称或UUID筛选。"></p>
      <ul id="scene3dDistributionObjects" class="scene3d-distribution-objects"></ul>
      <fieldset class="scene3d-distribution-axis"><legend data-i18n="作者位置轴"></legend>
        <label><span data-i18n="作者轴"></span><select id="scene3dDistributionAxis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
      </fieldset>
      <p class="scene3d-distribution-note" data-i18n="只修改所选对象的作者轴位置；两端原坐标、其他坐标、旋转和尺寸保持原文。同坐标按原声明顺序排列。二进制64位舍入后若无法严格递增，整批拒绝。这不是方块边缘或屏幕分布。"></p></section>
    <section id="scene3dDistributionReview" hidden><h3 data-i18n="等距分布审阅"></h3><p id="scene3dDistributionImpact" class="scene3d-distribution-note"></p><h4 data-i18n="分布顺序（按原作者坐标排序）"></h4><ol id="scene3dDistributionOrdered" class="scene3d-distribution-ordered"></ol>
      <div class="scene3d-distribution-comparison"><section><h4 data-i18n="修改前的对象声明"></h4><pre id="scene3dDistributionBefore"></pre></section>
        <section><h4 data-i18n="修改后的对象声明"></h4><pre id="scene3dDistributionAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dDistributionChangedPaths"></ul>
      <details id="scene3dDistributionSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dDistributionSource" tabindex="0"></pre></details></section>
    <p class="scene3d-distribution-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-distribution-footer"><button id="scene3dDistributionCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查等距分布"></button>
      <button id="scene3dDistributionApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dDistributionCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dDistribution${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, rowsEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let selected = new Set(), axis = 'x', proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DDistributionPatch === 'function' && supportsStudioCoreScene3DDistributionPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && typeof context.sourcePath === 'string'
    && context.sourcePath && typeof context.sourceToken === 'string' && context.sourceToken);
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context) && !context.busy && supported()
    && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const selectedObjects = () => session?.model.objects.filter(object => selected.has(object.instanceId)) || [];
  const matches = () => { const query = el('Search').value.trim().toLowerCase(); return session?.model.objects.filter(object => !query || object.name.toLowerCase().includes(query) || object.instanceId.toLowerCase().includes(query)) || []; };
  const rawChoices = () => Array.from(el('Objects').querySelectorAll('input[type=checkbox]'), checkbox => [checkbox.dataset.instanceId, checkbox.checked]);
  const consistentSelection = () => JSON.stringify(rawChoices()) === JSON.stringify(matches().map(object => [object.instanceId, selected.has(object.instanceId)]));
  const consistentIntent = () => consistentSelection() && el('Axis').value === axis && ['x', 'y', 'z'].includes(axis);
  const changed = () => selected.size > 0 || axis !== 'x';
  const signature = () => JSON.stringify({ selected: selectedObjects().map(object => object.instanceId), query: el('Search').value, choices: rawChoices(), axis: el('Axis').value });
  const approvalMatches = () => Boolean(proposal && approved === proposal && consistentIntent() && signature() === rawSignature
    && isScene3DDistributionProposal(proposal) && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '等距分布尚未应用到原文草稿。'; }
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
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '等距分布尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开等距分布。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('等距分布3D位置');
    button.title = supported() ? t('等距分布3D位置') : t('当前核心不支持3D等距分布，原文编辑和其他3D功能仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D等距分布');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; const locked = pending || !current();
    el('Search').disabled = locked; el('Search').placeholder = t('名称或UUID'); el('SelectResults').disabled = locked || !matches().length; el('ClearSelection').disabled = locked || !selected.size;
    el('Axis').disabled = locked; el('Axis').value = axis;
    el('Check').disabled = locked || selected.size < 3; el('Apply').disabled = locked || !approvalMatches(); el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObjects, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObjects, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('Impact').textContent = proposal ? `${t('已选对象')}：${proposal.instanceIds.length} · ${t('作者轴')}：${proposal.axis.toUpperCase()}` : '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    el('Ordered').replaceChildren();
    if (proposal) {
      const component = ['x', 'y', 'z'].indexOf(proposal.axis);
      for (const id of proposal.orderedInstanceIds) {
        const before = proposal.beforeObjects.find(object => object.instanceId === id), after = proposal.afterObjects.find(object => object.instanceId === id), item = node('li');
        item.dataset.instanceId = id; item.append(node('span', before.name), node('code', id), node('span', proposal.axis.toUpperCase() + '：' + before.position[component] + ' → ' + after.position[component])); el('Ordered').append(item);
      }
      const first = proposal.beforeObjects.find(object => object.instanceId === proposal.orderedInstanceIds[0]), last = proposal.beforeObjects.find(object => object.instanceId === proposal.orderedInstanceIds.at(-1));
      el('Impact').textContent += ' · ' + t('两端原坐标') + '：' + first.position[component] + ', ' + last.position[component] + ' ' + t('米');
    }
    renderObjects();
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次等距分布？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected.clear(); viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = ''; el('Search').value = ''; axis = 'x'; el('Axis').value = 'x';
    if (dialog.open) dialog.close(); queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) { const code = error?.errorCode;
    message = code === 'scene3d_distribution_unchanged' ? '等距分布未改变任何坐标，原文草稿保持不变。' : code === 'scene3d_distribution_conflict' ? '原文草稿已变化，请关闭后重新打开等距分布。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取等距分布对象…'; diagnostic = ''; selected.clear(); el('Search').value = ''; axis = 'x'; el('Axis').value = 'x';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && supported() && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content, baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false; session = { snapshot, model: parsed.model };
      message = '请选择至少三个对象和作者轴。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function check() {
    if (pending || !current() || selected.size < 3) { refresh(); return false; }
    if (!consistentIntent()) { invalidate(); message = '对象选择或作者轴已变化，请重新确认后检查。'; refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const ids = selectedObjects().map(object => object.instanceId), candidate = createScene3DDistributionProposal(session.snapshot, { instanceIds: ids, axis });
      if (!current() || !consistentIntent() || signature() !== raw) return false;
      if (!isScene3DDistributionProposal(candidate) || candidate.kind !== 'scene3d-distribution' || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.beforeContent !== session.snapshot.content || JSON.stringify(candidate.instanceIds) !== JSON.stringify(ids) || candidate.axis !== axis
        || JSON.stringify(candidate.beforeObjects) !== JSON.stringify(selectedObjects()) || !Array.isArray(candidate.orderedInstanceIds) || candidate.orderedInstanceIds.length !== ids.length || new Set(candidate.orderedInstanceIds).size !== ids.length || candidate.orderedInstanceIds.some(id => !ids.includes(id))
        || !Array.isArray(candidate.afterObjects) || JSON.stringify(candidate.afterObjects.map(object => object.instanceId)) !== JSON.stringify(ids)
        || candidate.afterObjects.some(object => !Array.isArray(object.position) || object.position.length !== 3 || object.position.some(value => !Number.isFinite(value)) || typeof object.name !== 'string')
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length) throw Error('The complete source proposal was not confirmed.');
      proposal = candidate; approved = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); message = '等距分布已检查，请审阅分布顺序、两端坐标、所有选中对象与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '无法完成等距分布；请检查选择、作者轴和数值精度后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && consistentIntent() && signature() === raw && proposal === candidate && isScene3DDistributionProposal(candidate) && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用等距分布到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false; const context = getContext();
      if (formEpoch !== form || !consistentIntent() || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical || result?.applied !== true
        || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || !result.sourceToken
        || result.sourceToken === owner.snapshot.token || !eligible(context) || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '等距分布未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  el('Search').addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('SelectResults').addEventListener('click', () => { if (!pending && current()) { for (const object of matches()) selected.add(object.instanceId); invalidate(); refresh(); } });
  el('ClearSelection').addEventListener('click', () => { if (!pending && current()) { selected.clear(); invalidate(); refresh(); } });
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
