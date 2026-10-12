import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { supportsStudioCoreScene3DObjectsPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// Local structure inputs and review belong to this form. Source authority and
// ordinary Save remain with the injected editor draft port.
export function setupScene3DObjects({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dObjectsStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dObjectsStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-objects.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dObjectsBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dObjectsUnavailable'; unavailable.className = 'scene3d-objects-note';
  (document.getElementById('modeSwitch') || document.body).append(button, unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dObjectsDialog'; dialog.className = 'scene3d-objects-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dObjectsTitle');
  dialog.innerHTML = `<header class="scene3d-objects-header"><h2 id="scene3dObjectsTitle" data-i18n="管理3D对象"></h2>
    <button id="scene3dObjectsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-objects-note" data-i18n="新增、复制或移除方块。检查完整候选原文后应用到草稿，再由编辑器普通保存。"></p>
    <p id="scene3dObjectsPath" class="scene3d-objects-note"></p><p id="scene3dObjectsStatus" role="status" aria-live="polite"></p>
    <p id="scene3dObjectsDiagnostic" class="scene3d-objects-diagnostic"></p>
    <section id="scene3dObjectsFields"><label><span data-i18n="对象操作"></span><select id="scene3dObjectsAction">
      <option value="add" data-i18n="新增方块"></option><option value="copy" data-i18n="复制方块"></option><option value="remove" data-i18n="移除方块"></option></select></label>
      <label id="scene3dObjectsObjectField"><span data-i18n="场景对象"></span><select id="scene3dObjectsObject"></select></label>
      <p id="scene3dObjectsIdentity" class="scene3d-objects-identity"></p>
      <label id="scene3dObjectsNewIdentityField"><span data-i18n="新对象UUID"></span><input id="scene3dObjectsNewIdentity" type="text" readonly></label>
      <div class="scene3d-objects-properties"><label id="scene3dObjectsNameField"><span data-i18n="名称"></span><input id="scene3dObjectsName" type="text"></label>
        <label id="scene3dObjectsColorField"><span data-i18n="颜色"></span><input id="scene3dObjectsColor" type="text" placeholder="#87d8b9" spellcheck="false"></label></div>
      <p id="scene3dObjectsDefaults" class="scene3d-objects-note" data-i18n="新增方块使用位置[0,0,0]、旋转[0,0,0]和尺寸[1,1,1]；应用后可在独立变换表单调整。"></p>
      <p id="scene3dObjectsCopyNote" class="scene3d-objects-note" data-i18n="复制保留原方块的变换与颜色，使用新UUID和明确填写的名称。"></p>
      <p id="scene3dObjectsCount" role="status"></p><p id="scene3dObjectsBlocked" class="scene3d-objects-diagnostic"></p></section>
    <section id="scene3dObjectsReview" hidden><h3 data-i18n="3D对象审阅"></h3>
      <div class="scene3d-objects-comparison"><section><h4 data-i18n="修改前的对象声明"></h4><pre id="scene3dObjectsBefore"></pre></section>
        <section><h4 data-i18n="修改后的对象声明"></h4><pre id="scene3dObjectsAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dObjectsChangedPaths"></ul>
      <details id="scene3dObjectsSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dObjectsSource" tabindex="0"></pre></details></section>
    <p class="scene3d-objects-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-objects-footer"><button id="scene3dObjectsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D对象"></button>
      <button id="scene3dObjectsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dObjectsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dObjects${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  let epoch = 0, formEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let action = 'add', selected = '', allocated = '', baseline = '', proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DObjectsPatch === 'function' && supportsStudioCoreScene3DObjectsPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context)
    && !context.busy && supported() && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const object = () => session?.model.objects.find(item => item.instanceId === selected);
  const signature = () => JSON.stringify([el('Action').value, el('Object').value, el('NewIdentity').value, el('Name').value, el('Color').value]);
  const boundInputs = () => el('Action').value === action && el('Object').value === selected && el('NewIdentity').value === allocated;
  const changed = () => Boolean(session && (proposal || signature() !== baseline));
  const targetId = () => action === 'remove' ? selected : allocated;
  const blocked = () => !session ? '' : action === 'remove' && session.model.objects.length === 1
    ? '场景必须保留至少一个对象，不能移除最后的方块。' : action !== 'remove' && session.model.objects.length >= 128
      ? '场景已有128个对象，新增或复制前请先移除一个对象。' : '';
  const approvalMatches = () => Boolean(proposal && approved === proposal && boundInputs() && proposal.action === action
    && proposal.instanceId === targetId() && proposal.sourceInstanceId === (action === 'copy' ? selected : null)
    && signature() === rawSignature && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '3D对象修改尚未应用到原文草稿。'; }
  function begin(nextAction, nextSelected) {
    action = nextAction; selected = nextSelected; allocated = action === 'remove' ? '' : crypto.randomUUID();
    el('Action').value = action; el('Object').value = selected; el('NewIdentity').value = allocated;
    el('Name').value = action === 'copy' ? object().name : action === 'add' ? t('新建方块') : '';
    el('Color').value = action === 'add' ? '#87d8b9' : object()?.color || '';
    invalidate(); baseline = signature();
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '3D对象修改尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开3D对象管理。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('管理3D对象');
    button.title = supported() ? t('管理3D对象') : t('当前核心不支持3D对象管理，3D只读预览和原文编辑仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D对象管理');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; el('Identity').textContent = action !== 'add' && object() ? `${object().name} · ${selected}` : '';
    el('ObjectField').hidden = action === 'add'; el('NewIdentityField').hidden = action === 'remove'; el('NameField').hidden = action === 'remove';
    el('ColorField').hidden = action !== 'add'; el('Defaults').hidden = action !== 'add'; el('CopyNote').hidden = action !== 'copy';
    const locked = pending || !current(); el('Action').disabled = locked; el('Object').disabled = locked || action === 'add';
    el('NewIdentity').disabled = locked; el('Name').disabled = locked || action === 'remove'; el('Color').disabled = locked || action !== 'add';
    for (const option of el('Action').children) option.disabled = option.value !== 'remove' && Boolean(session && session.model.objects.length >= 128);
    el('Blocked').textContent = t(blocked());
    const count = session?.model.objects.length; el('Count').textContent = session ? `${t('对象数量')}: ${count} → ${count + (action === 'remove' ? -1 : 1)}` : '';
    el('Check').disabled = locked || Boolean(blocked()); el('Apply').disabled = locked || !approvalMatches();
    el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObject, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObject, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次3D对象修改？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected = ''; allocated = ''; baseline = ''; viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = '';
    if (dialog.open) dialog.close();
    queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) {
    message = error?.errorCode === 'scene3d_objects_conflict' ? '原文草稿已变化，请关闭后重新打开3D对象管理。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取3D对象声明…'; diagnostic = '';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && epoch === request && eligible(next) && !next.busy
      && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken && supported(); };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content,
        baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false;
      session = { snapshot, model: parsed.model };
      el('Object').replaceChildren(); for (const item of session.model.objects) { const choice = node('option', item.name); choice.value = item.instanceId; el('Object').append(choice); }
      begin('add', session.model.objects[0].instanceId); message = '选择新增、复制或移除3D方块，并检查完整原文。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (epoch === request && dialog.open) { pending = false; refresh(); } }
  }
  function edit() {
    if (action === 'remove') return { action, instanceId: selected };
    if (action === 'copy') return { action, instanceId: selected, newInstanceId: allocated, name: el('Name').value };
    return { action, object: { instanceId: allocated, name: el('Name').value, primitive: 'box', position: [0, 0, 0],
      rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: el('Color').value } };
  }
  function check() {
    if (pending || !current() || blocked()) { refresh(); return false; }
    // Silent selector/identity changes do not load a new operation or author values.
    if (!boundInputs()) { el('Action').value = action; el('Object').value = selected; el('NewIdentity').value = allocated; invalidate(); refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature(), input = edit();
    try {
      const candidate = createScene3DObjectsProposal(session.snapshot, input);
      if (!current() || !boundInputs() || signature() !== raw) return false;
      if (!candidate || candidate.kind !== 'scene3d-objects' || candidate.action !== action || candidate.instanceId !== targetId()
        || candidate.sourceInstanceId !== (action === 'copy' ? selected : null) || canonical(candidate.edit) !== canonical(input)
        || candidate.sourcePath !== session.snapshot.sourcePath || candidate.sourceToken !== session.snapshot.token
        || candidate.baseSourceRevision !== session.snapshot.baseSourceRevision || candidate.sourceRevision !== session.snapshot.sourceRevision
        || candidate.beforeContent !== session.snapshot.content || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent
        || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length
        || (action === 'add' ? candidate.beforeObject !== null : candidate.beforeObject?.instanceId !== selected)
        || (action === 'remove' ? candidate.afterObject !== null : candidate.afterObject?.instanceId !== allocated)) throw Error('The complete object proposal was not confirmed.');
      const after = parseScene3DSource(candidate.afterContent).model;
      if (after.objects.length !== session.model.objects.length + (action === 'remove' ? -1 : 1)) throw Error('The object count in the complete candidate was not confirmed.');
      proposal = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); approved = candidate;
      message = '3D对象已检查，请审阅数量、对象声明与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '3D对象操作有误，请检查名称、颜色和对象限制后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonicalProposal = proposalSignature;
    const owns = () => !disposed && dialog.open && epoch === request && session === owner;
    const unchanged = () => owns() && current() && boundInputs() && formEpoch === form && signature() === raw && proposal === candidate && JSON.stringify(candidate) === canonicalProposal;
    pending = true; message = '正在应用3D对象操作到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false;
      const context = getContext();
      if (!boundInputs() || formEpoch !== form || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonicalProposal
        || result?.applied !== true || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || result.sourceToken === owner.snapshot.token || !eligible(context)
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '3D对象操作未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const field of ['Name', 'Color']) el(field).addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  function changeOperation(nextAction, nextSelected) {
    el('Action').value = action; el('Object').value = selected;
    if (pending || !current() || !['add', 'copy', 'remove'].includes(nextAction) || !session.model.objects.some(item => item.instanceId === nextSelected)
      || nextAction !== 'remove' && session.model.objects.length >= 128 || nextAction === action && nextSelected === selected) return;
    if (changed() && !window.confirm(t('丢弃本次3D对象修改？原文草稿不会改变。'))) return;
    begin(nextAction, nextSelected); refresh();
  }
  el('Action').addEventListener('change', () => changeOperation(el('Action').value, selected));
  el('Object').addEventListener('change', () => changeOperation(action, el('Object').value));
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', check); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation();
    if (!event.repeat && !event.isComposing && event.keyCode !== 229) close();
  });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(refresh); refresh();
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); unavailable.remove(); dialog.remove(); }
  return Object.freeze({ open, close, refresh, dispose, destroy: dispose });
}
