import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';
import { supportsStudioCoreScene3DPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This authoring form owns only local inputs and review state. The injected
// draft port retains the editor's source authority and ordinary Save boundary.
export function setupScene3DTransforms({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dTransformsStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dTransformsStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-transforms.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dTransformsBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dTransformsUnavailable'; unavailable.className = 'scene3d-transforms-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const vectors = [
    { id: 'Position', field: 'position', label: '位置 XYZ', min: -100000, max: 100000 },
    { id: 'Rotation', field: 'rotationDegrees', label: '旋转 XYZ（度）', min: -36000, max: 36000 },
    { id: 'Size', field: 'size', label: '尺寸 XYZ', min: .001, max: 1000 },
  ];
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dTransformsDialog'; dialog.className = 'scene3d-transforms-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dTransformsTitle');
  dialog.innerHTML = `<header class="scene3d-transforms-header"><h2 id="scene3dTransformsTitle" data-i18n="编辑3D变换"></h2>
    <button id="scene3dTransformsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-transforms-note" data-i18n="逐项勾选要修改的变换。检查完整候选原文后应用到草稿，再由编辑器普通保存。"></p>
    <p id="scene3dTransformsPath" class="scene3d-transforms-note"></p><p id="scene3dTransformsStatus" role="status" aria-live="polite"></p>
    <p id="scene3dTransformsDiagnostic" class="scene3d-transforms-diagnostic"></p>
    <section id="scene3dTransformsFields"><label class="scene3d-transforms-object"><span data-i18n="场景对象"></span>
      <select id="scene3dTransformsObject"></select></label><p id="scene3dTransformsIdentity" class="scene3d-transforms-identity"></p>
      <div class="scene3d-transforms-vectors">${vectors.map(vector => `<fieldset><legend><label><input id="scene3dTransforms${vector.id}Selected" type="checkbox">
        <span data-i18n="${vector.label}"></span> · <span data-i18n="修改"></span></label></legend>
        <div class="scene3d-transforms-axes">${['X', 'Y', 'Z'].map(axis => `<label>${axis}<input id="scene3dTransforms${vector.id}${axis}" type="number" step="any" min="${vector.min}" max="${vector.max}" aria-label="${axis}"></label>`).join('')}</div></fieldset>`).join('')}</div>
      <p class="scene3d-transforms-note" data-i18n="位置单位为米，旋转单位为度且使用XYZ欧拉顺序。未勾选字段和其他对象保持原文。"></p></section>
    <section id="scene3dTransformsReview" hidden><h3 data-i18n="3D变换审阅"></h3>
      <div class="scene3d-transforms-comparison"><section><h4 data-i18n="修改前的对象声明"></h4><pre id="scene3dTransformsBefore"></pre></section>
        <section><h4 data-i18n="修改后的对象声明"></h4><pre id="scene3dTransformsAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dTransformsChangedPaths"></ul>
      <details id="scene3dTransformsSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dTransformsSource" tabindex="0"></pre></details></section>
    <p class="scene3d-transforms-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-transforms-footer"><button id="scene3dTransformsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D变换"></button>
      <button id="scene3dTransformsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dTransformsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dTransforms${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let selected = '', proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DPatch === 'function' && supportsStudioCoreScene3DPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context)
    && !context.busy && supported() && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const object = () => session?.model.objects.find(item => item.instanceId === selected);
  const changed = () => vectors.some(vector => el(`${vector.id}Selected`).checked);
  const signature = () => JSON.stringify({ selected: el('Object').value, vectors: vectors.map(vector => [el(`${vector.id}Selected`).checked, ...['X', 'Y', 'Z'].map(axis => el(vector.id + axis).value)]) });
  const approvalMatches = () => Boolean(proposal && approved === proposal && el('Object').value === selected
    && proposal.instanceId === selected && signature() === rawSignature && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '3D变换修改尚未应用到原文草稿。'; }
  function fillObject() {
    const item = object(); if (!item) return;
    for (const vector of vectors) {
      el(`${vector.id}Selected`).checked = false;
      for (const [index, axis] of ['X', 'Y', 'Z'].entries()) el(vector.id + axis).value = String(item[vector.field][index]);
    }
    el('Object').value = selected; invalidate();
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { approved = null; proposal = null; message = '3D变换修改尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开3D变换编辑。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('编辑3D变换');
    button.title = supported() ? t('编辑3D变换') : t('当前核心不支持3D变换编辑，3D只读预览和原文编辑仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D变换编辑');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; el('Identity').textContent = object() ? `${object().name} · ${selected}` : '';
    const locked = pending || !current(); el('Object').disabled = locked;
    for (const vector of vectors) {
      el(`${vector.id}Selected`).disabled = locked;
      for (const axis of ['X', 'Y', 'Z']) el(vector.id + axis).disabled = locked || !el(`${vector.id}Selected`).checked;
    }
    el('Check').disabled = locked || !changed(); el('Apply').disabled = locked || !approvalMatches();
    // Cancellation invalidates the port guard even while an operation is awaiting.
    el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeObject, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterObject, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次3D变换修改？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; selected = ''; viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = '';
    for (const vector of vectors) el(`${vector.id}Selected`).checked = false;
    if (dialog.open) dialog.close();
    queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) {
    const code = error?.errorCode;
    message = code === 'scene3d_transform_unchanged' ? '3D变换未改变，原文草稿保持不变。'
      : code === 'scene3d_transform_conflict' ? '原文草稿已变化，请关闭后重新打开3D变换编辑。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取3D变换声明…'; diagnostic = '';
    dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && epoch === request && eligible(next) && !next.busy
      && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken && supported(); };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || typeof source.content !== 'string' || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken) throw Error('The source snapshot no longer belongs to this editor session.');
      const snapshot = Object.freeze({ sourcePath: source.sourcePath, token: source.token, content: source.content,
        baseSourceRevision: source.baseSourceRevision, sourceRevision: source.sourceRevision });
      const parsed = parseScene3DSource(snapshot.content); if (!owns()) return false;
      session = { snapshot, model: parsed.model }; selected = session.model.objects[0].instanceId;
      el('Object').replaceChildren(); for (const item of session.model.objects) { const choice = node('option', item.name); choice.value = item.instanceId; el('Object').append(choice); }
      fillObject(); message = '选择对象并勾选要修改的3D变换。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (epoch === request && dialog.open) { pending = false; refresh(); } }
  }
  function values() {
    const result = {};
    for (const vector of vectors) if (el(`${vector.id}Selected`).checked) result[vector.field] = ['X', 'Y', 'Z'].map(axis => {
      const raw = el(vector.id + axis).value.trim(), number = Number(raw);
      if (!raw || !Number.isFinite(number)) throw Error(t('所选变换的XYZ数值尚未完整。')); return number;
    });
    return result;
  }
  function check() {
    if (pending || !current() || !changed()) { refresh(); return false; }
    // A silent select mutation has not loaded the requested author's values.
    // Keep the bound object and require a fresh review rather than mixing them.
    if (el('Object').value !== selected) { el('Object').value = selected; invalidate(); refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const candidate = createScene3DTransformProposal(session.snapshot, { instanceId: selected, values: values() });
      if (!current() || signature() !== raw) return false;
      if (!candidate || candidate.kind !== 'scene3d-transform' || candidate.sourcePath !== session.snapshot.sourcePath
        || candidate.sourceToken !== session.snapshot.token || candidate.beforeContent !== session.snapshot.content || candidate.instanceId !== selected
        || typeof candidate.afterContent !== 'string' || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length) throw Error('The complete source proposal was not confirmed.');
      proposal = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); approved = candidate;
      message = '3D变换已检查，请审阅对象与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '3D变换有误，请检查数值范围后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && epoch === request && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && signature() === raw && proposal === candidate && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用3D变换到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false;
      const context = getContext();
      if (formEpoch !== form || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical
        || result?.applied !== true || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || result.sourceToken === owner.snapshot.token || !eligible(context)
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '3D变换未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const vector of vectors) {
    el(`${vector.id}Selected`).addEventListener('change', () => { if (!pending && current()) { invalidate(); refresh(); } });
    for (const axis of ['X', 'Y', 'Z']) el(vector.id + axis).addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  }
  el('Object').addEventListener('change', () => {
    const requested = el('Object').value; el('Object').value = selected;
    if (pending || !current() || !session.model.objects.some(item => item.instanceId === requested)) return;
    if (changed() && !window.confirm(t('丢弃本次3D变换修改？原文草稿不会改变。'))) return;
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
