import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';
import { supportsStudioCoreScene3DPropertiesPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// Local object properties and review state only. The editor port owns source
// application; this form neither renders nor saves the author document.
export function setupScene3DProperties({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dPropertiesStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dPropertiesStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-properties.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dPropertiesBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dPropertiesUnavailable'; unavailable.className = 'scene3d-properties-note';
  (document.getElementById('modeSwitch') || document.body).append(button, unavailable);
  const properties = [{ id: 'Name', field: 'name', label: '名称' }, { id: 'Color', field: 'color', label: '颜色' }];
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dPropertiesDialog'; dialog.className = 'scene3d-properties-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dPropertiesTitle');
  dialog.innerHTML = `<header class="scene3d-properties-header"><h2 id="scene3dPropertiesTitle" data-i18n="编辑3D属性"></h2>
    <button id="scene3dPropertiesClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-properties-note" data-i18n="选择对象并勾选要修改的名称或颜色。检查完整候选原文后应用到草稿，再由编辑器普通保存。"></p>
    <p id="scene3dPropertiesPath" class="scene3d-properties-note"></p><p id="scene3dPropertiesStatus" role="status" aria-live="polite"></p>
    <p id="scene3dPropertiesDiagnostic" class="scene3d-properties-diagnostic"></p>
    <section id="scene3dPropertiesFields"><label class="scene3d-properties-object"><span data-i18n="场景对象"></span>
      <select id="scene3dPropertiesInstance"></select></label><p id="scene3dPropertiesIdentity" class="scene3d-properties-identity"></p>
      <div class="scene3d-properties-inputs">${properties.map(property => `<fieldset><legend><label><input id="scene3dProperties${property.id}Selected" type="checkbox">
        <span data-i18n="${property.label}"></span> · <span data-i18n="修改"></span></label></legend>
        <label for="scene3dProperties${property.id}"><span data-i18n="${property.label}"></span>${property.field === 'name' ? '<textarea id="scene3dPropertiesName" rows="2" spellcheck="false"></textarea>' : '<input id="scene3dPropertiesColor" type="text" spellcheck="false" maxlength="7" placeholder="#ffffff">'}</label></fieldset>`).join('')}</div>
      <p class="scene3d-properties-note" data-i18n="名称保留填写的空格和字符，颜色使用六位十六进制值。对象UUID、变换、未勾选字段和其他对象保持原文。"></p></section>
    <section id="scene3dPropertiesReview" hidden><h3 data-i18n="3D属性审阅"></h3>
      <div class="scene3d-properties-comparison"><section><h4 data-i18n="修改前的对象声明"></h4><pre id="scene3dPropertiesBefore"></pre></section>
        <section><h4 data-i18n="修改后的对象声明"></h4><pre id="scene3dPropertiesAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dPropertiesChangedPaths"></ul>
      <details id="scene3dPropertiesSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dPropertiesSource" tabindex="0"></pre></details></section>
    <p class="scene3d-properties-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-properties-footer"><button id="scene3dPropertiesCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D属性"></button>
      <button id="scene3dPropertiesApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dPropertiesCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dProperties${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let originalName = '', seededName = '';
  let selected = '', proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DPropertiesPatch === 'function' && supportsStudioCoreScene3DPropertiesPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string' && context.sourceToken);
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context)
    && !context.busy && supported() && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const object = () => session?.model.objects.find(item => item.instanceId === selected);
  const changed = () => properties.some(property => el(property.id + 'Selected').checked);
  const signature = () => JSON.stringify({ instanceId: el('Instance').value, properties: properties.map(property => [el(property.id + 'Selected').checked, el(property.id).value]) });
  const approvalMatches = () => Boolean(proposal && approved === proposal && el('Instance').value === selected
    && proposal.instanceId === selected && signature() === rawSignature && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '3D属性修改尚未应用到原文草稿。'; }
  function fillObject() {
    const item = object(); if (!item) return;
    for (const property of properties) { el(property.id + 'Selected').checked = false; el(property.id).value = item[property.field]; }
    // Textareas display CR/CRLF as LF. An untouched display must retain the
    // original decoded author string rather than silently rewrite its newlines.
    originalName = item.name; seededName = el('Name').value;
    el('Instance').value = selected; invalidate();
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { proposal = null; approved = null; message = '3D属性修改尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开3D属性编辑。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('编辑3D属性');
    button.title = supported() ? t('编辑3D属性') : t('当前核心不支持3D属性编辑，3D只读预览和原文编辑仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D属性编辑');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; el('Identity').textContent = object() ? `${object().name} · ${selected}` : '';
    const locked = pending || !current(); el('Instance').disabled = locked;
    for (const property of properties) { el(property.id + 'Selected').disabled = locked; el(property.id).disabled = locked || !el(property.id + 'Selected').checked; }
    el('Check').disabled = locked || !changed(); el('Apply').disabled = locked || !approvalMatches(); el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObject, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObject, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次3D属性修改？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected = ''; viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = ''; originalName = ''; seededName = '';
    for (const property of properties) el(property.id + 'Selected').checked = false;
    if (dialog.open) dialog.close();
    queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) {
    const code = error?.errorCode;
    message = code === 'scene3d_properties_unchanged' ? '3D属性未改变，原文草稿保持不变。'
      : code === 'scene3d_properties_conflict' ? '原文草稿已变化，请关闭后重新打开3D属性编辑。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取3D对象属性…'; diagnostic = '';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && epoch === request && eligible(next) && !next.busy
      && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken && supported(); };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content,
        baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false;
      session = { snapshot, model: parsed.model }; selected = parsed.model.objects[0].instanceId;
      el('Instance').replaceChildren(); for (const item of parsed.model.objects) { const choice = node('option', item.name); choice.value = item.instanceId; el('Instance').append(choice); }
      fillObject(); message = '选择对象并勾选要修改的3D属性。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (epoch === request && dialog.open) { pending = false; refresh(); } }
  }
  function values() {
    const result = {};
    for (const property of properties) if (el(property.id + 'Selected').checked) {
      const raw = el(property.id).value;
      if (property.field === 'color' && !/^#[a-f0-9]{6}$/i.test(raw)) throw Error(t('颜色须填写六位十六进制值，例如#ffffff。'));
      result[property.field] = property.field === 'name' && raw === seededName ? originalName : raw;
    }
    return result;
  }
  function check() {
    if (pending || !current() || !changed()) { refresh(); return false; }
    // A silent selector change has not loaded that object's declarations.
    if (el('Instance').value !== selected) { el('Instance').value = selected; invalidate(); refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const input = values(), candidate = createScene3DPropertiesProposal(session.snapshot, { instanceId: selected, values: input });
      if (!current() || signature() !== raw) return false;
      if (!candidate || candidate.kind !== 'scene3d-properties' || candidate.sourcePath !== session.snapshot.sourcePath
        || candidate.sourceToken !== session.snapshot.token || candidate.beforeContent !== session.snapshot.content || candidate.instanceId !== selected
        || JSON.stringify(candidate.values) !== JSON.stringify(input) || typeof candidate.afterContent !== 'string'
        || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length
        || !candidate.beforeObject || !candidate.afterObject) throw Error('The complete object properties source proposal was not confirmed.');
      proposal = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); approved = candidate;
      message = '3D属性已检查，请审阅对象声明与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '3D属性有误，请检查名称和颜色后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && epoch === request && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && signature() === raw && proposal === candidate && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用3D属性到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false;
      const context = getContext();
      if (formEpoch !== form || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical
        || result?.applied !== true || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || !result.sourceToken || result.sourceToken === owner.snapshot.token || !eligible(context)
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '3D属性修改未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const property of properties) {
    el(property.id + 'Selected').addEventListener('change', () => { if (!pending && current()) { invalidate(); refresh(); } });
    el(property.id).addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  }
  el('Instance').addEventListener('change', () => {
    const requested = el('Instance').value; el('Instance').value = selected;
    if (pending || !current() || !session.model.objects.some(item => item.instanceId === requested)) return;
    if (requested === selected) return;
    if (changed() && !window.confirm(t('丢弃本次3D属性修改？原文草稿不会改变。'))) return;
    selected = requested; fillObject(); refresh();
  });
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
