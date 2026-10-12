import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { supportsStudioCoreScene3DEnvironmentPatch } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This form owns author declarations and a local review. Source application
// remains an injected editor port; preview cameras and ordinary Save are separate.
export function setupScene3DEnvironment({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scene3dEnvironmentStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dEnvironmentStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d-environment.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dEnvironmentBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dEnvironmentUnavailable'; unavailable.className = 'scene3d-environment-note';
  (document.getElementById('modeSwitch') || document.body).append(button, unavailable);
  const groups = [
    { id: 'Background', label: '背景颜色', fields: [{ id: 'Background', path: ['background'], hex: true }] },
    { id: 'CameraPosition', label: '作者相机位置 XYZ', fields: ['X', 'Y', 'Z'].map((axis, index) => ({ id: 'CameraPosition' + axis, path: ['camera', 'position', index], label: axis, min: -100000, max: 100000 })) },
    { id: 'CameraTarget', label: '作者相机目标 XYZ', fields: ['X', 'Y', 'Z'].map((axis, index) => ({ id: 'CameraTarget' + axis, path: ['camera', 'target', index], label: axis, min: -100000, max: 100000 })) },
    { id: 'Fov', label: '垂直视野（度）', fields: [{ id: 'Fov', path: ['camera', 'fovDegrees'], min: 1, max: 179 }] },
    { id: 'Clip', label: '相机裁剪范围', fields: [{ id: 'Near', path: ['camera', 'near'], label: '近裁剪面', min: .001, max: 10000 }, { id: 'Far', path: ['camera', 'far'], label: '远裁剪面', min: .001, max: 100000 }] },
    { id: 'LightDirection', label: '光照方向 XYZ', fields: ['X', 'Y', 'Z'].map((axis, index) => ({ id: 'LightDirection' + axis, path: ['light', 'direction', index], label: axis, min: -100000, max: 100000 })) },
    { id: 'LightColor', label: '光照颜色', fields: [{ id: 'LightColor', path: ['light', 'color'], hex: true }] },
    { id: 'LightEnergy', label: '光照强度', fields: [{ id: 'LightEnergy', path: ['light', 'energy'], min: 0, max: 16 }] },
  ];
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dEnvironmentDialog'; dialog.className = 'scene3d-environment-dialog';
  dialog.setAttribute('aria-labelledby', 'scene3dEnvironmentTitle');
  dialog.innerHTML = `<header class="scene3d-environment-header"><h2 id="scene3dEnvironmentTitle" data-i18n="编辑3D环境"></h2>
    <button id="scene3dEnvironmentClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-environment-note" data-i18n="逐项勾选要修改的背景、相机或光照。检查完整候选原文后应用到草稿，再由编辑器普通保存。"></p>
    <p class="scene3d-environment-note" data-i18n="这里修改作者相机声明；预览中的临时旋转和缩放不会填入此表单。保存后才会保留作者环境值。"></p>
    <p id="scene3dEnvironmentPath" class="scene3d-environment-note"></p><p id="scene3dEnvironmentStatus" role="status" aria-live="polite"></p>
    <p id="scene3dEnvironmentDiagnostic" class="scene3d-environment-diagnostic"></p>
    <section id="scene3dEnvironmentFields" class="scene3d-environment-fields">${groups.map(group => `<fieldset><legend><label><input id="scene3dEnvironment${group.id}Selected" type="checkbox">
      <span data-i18n="${group.label}"></span> · <span data-i18n="修改"></span></label></legend><div class="scene3d-environment-inputs scene3d-environment-inputs-${group.fields.length}">${group.fields.map(field => `<label for="scene3dEnvironment${field.id}">
        ${field.label ? (['X', 'Y', 'Z'].includes(field.label) ? `<span>${field.label}</span>` : `<span data-i18n="${field.label}"></span>`) : `<span data-i18n="${group.label}"></span>`}<input id="scene3dEnvironment${field.id}" ${field.hex ? 'type="text" spellcheck="false" maxlength="7" placeholder="#ffffff"' : `type="number" step="any" min="${field.min}" max="${field.max}"`} aria-label="${field.label || group.label}"></label>`).join('')}</div></fieldset>`).join('')}
      <p class="scene3d-environment-note" data-i18n="近、远裁剪面一起修改；未勾选字段、对象声明和其他场景设置保持原文。"></p></section>
    <section id="scene3dEnvironmentReview" hidden><h3 data-i18n="3D环境审阅"></h3>
      <div class="scene3d-environment-comparison"><section><h4 data-i18n="修改前的环境声明"></h4><pre id="scene3dEnvironmentBefore"></pre></section>
        <section><h4 data-i18n="修改后的环境声明"></h4><pre id="scene3dEnvironmentAfter"></pre></section></div>
      <h4 data-i18n="原文变更路径"></h4><ul id="scene3dEnvironmentChangedPaths"></ul>
      <details id="scene3dEnvironmentSourceReview"><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="scene3dEnvironmentSource" tabindex="0"></pre></details></section>
    <p class="scene3d-environment-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <footer class="scene3d-environment-footer"><button id="scene3dEnvironmentCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查3D环境"></button>
      <button id="scene3dEnvironmentApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scene3dEnvironmentCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3dEnvironment${suffix}`);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let epoch = 0, formEpoch = 0, disposed = false, pending = false, session = null, opener = null, viewPath = '';
  let proposal = null, approved = null, rawSignature = '', proposalSignature = '', message = '', diagnostic = '';
  const supported = () => typeof supportsStudioCoreScene3DEnvironmentPatch === 'function' && supportsStudioCoreScene3DEnvironmentPatch();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(session && !disposed && dialog.open && eligible(context)
    && !context.busy && supported() && context.sourcePath === session.snapshot.sourcePath && context.sourceToken === session.snapshot.token); };
  const changed = () => groups.some(group => el(group.id + 'Selected').checked);
  const signature = () => JSON.stringify(groups.map(group => [el(group.id + 'Selected').checked, ...group.fields.map(field => el(field.id).value)]));
  const approvalMatches = () => Boolean(proposal && approved === proposal && signature() === rawSignature && JSON.stringify(proposal) === proposalSignature);
  function invalidate() { formEpoch++; proposal = null; approved = null; diagnostic = ''; message = '3D环境修改尚未应用到原文草稿。'; }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(true); return; }
    if (proposal && !approvalMatches()) { proposal = null; approved = null; message = '3D环境修改尚未应用到原文草稿。'; }
    if (session && !pending && !current()) { approved = null; message = '原文草稿已变化，请关闭后重新打开3D环境编辑。'; }
    button.hidden = !eligible(context); button.disabled = Boolean(context.busy || !supported()); button.textContent = t('编辑3D环境');
    button.title = supported() ? t('编辑3D环境') : t('当前核心不支持3D环境编辑，3D只读预览和原文编辑仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D环境编辑');
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    el('Path').textContent = session?.snapshot.sourcePath || viewPath; el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Fields').hidden = !session; const locked = pending || !current();
    for (const group of groups) {
      el(group.id + 'Selected').disabled = locked;
      for (const field of group.fields) {
        el(field.id).disabled = locked || !el(group.id + 'Selected').checked;
        el(field.id).setAttribute('aria-label', t(field.label || group.label));
      }
    }
    el('Check').disabled = locked || !changed(); el('Apply').disabled = locked || !approvalMatches();
    el('Close').disabled = false; el('Cancel').disabled = false;
    el('Review').hidden = !proposal; el('Before').textContent = proposal ? JSON.stringify(proposal.beforeEnvironment, null, 2) : '';
    el('After').textContent = proposal ? JSON.stringify(proposal.afterEnvironment, null, 2) : ''; el('Source').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
  }
  function close(force = false) {
    if (!force && changed() && !window.confirm(t('丢弃本次3D环境修改？原文草稿不会改变。'))) return false;
    const target = opener; opener = null; const request = ++epoch; formEpoch++; session = null; viewPath = ''; pending = false;
    proposal = null; approved = null; message = ''; diagnostic = '';
    for (const group of groups) el(group.id + 'Selected').checked = false;
    if (dialog.open) dialog.close();
    queueMicrotask(() => { if (!disposed && !dialog.open && request === epoch && target?.isConnected !== false) target?.focus?.(); });
    refresh(); return true;
  }
  function report(error, fallback) {
    const code = error?.errorCode;
    message = code === 'scene3d_environment_unchanged' ? '3D环境未改变，原文草稿保持不变。'
      : code === 'scene3d_environment_conflict' ? '原文草稿已变化，请关闭后重新打开3D环境编辑。' : fallback;
    diagnostic = typeof error?.message === 'string' ? error.message : String(error);
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; opener = document.activeElement; viewPath = context.sourcePath; pending = true; message = '正在读取3D环境声明…'; diagnostic = '';
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
      for (const group of groups) {
        el(group.id + 'Selected').checked = false;
        for (const field of group.fields) el(field.id).value = String(field.path.reduce((value, key) => value[key], parsed.model));
      }
      invalidate(); message = '勾选要修改的3D环境字段，再检查完整原文。'; return true;
    } catch (error) { if (owns()) report(error, '无法读取有效的3D场景；请检查原文后重新打开。'); return false; }
    finally { if (epoch === request && dialog.open) { pending = false; refresh(); } }
  }
  function values() {
    const result = {};
    for (const group of groups) if (el(group.id + 'Selected').checked) for (const field of group.fields) {
      const raw = el(field.id).value; let value;
      if (field.hex) {
        if (!/^#[a-f0-9]{6}$/i.test(raw)) throw Error(t('颜色须填写六位十六进制值，例如#ffffff。'));
        value = raw;
      } else {
        value = Number(raw.trim());
        if (!raw.trim() || !Number.isFinite(value) || value < field.min || value > field.max) throw Error(t('所选环境字段的数值尚未完整或超出范围。'));
      }
      let target = result;
      for (let index = 0; index < field.path.length - 1; index++) {
        const key = field.path[index]; target = target[key] ||= typeof field.path[index + 1] === 'number' ? [] : {};
      }
      target[field.path.at(-1)] = value;
    }
    return result;
  }
  function check() {
    if (pending || !current() || !changed()) { refresh(); return false; }
    proposal = null; approved = null; diagnostic = ''; const raw = signature();
    try {
      const input = values(), candidate = createScene3DEnvironmentProposal(session.snapshot, { values: input });
      if (!current() || signature() !== raw) return false;
      if (!candidate || candidate.kind !== 'scene3d-environment' || candidate.sourcePath !== session.snapshot.sourcePath
        || candidate.sourceToken !== session.snapshot.token || candidate.beforeContent !== session.snapshot.content
        || JSON.stringify(candidate.values) !== JSON.stringify(input) || typeof candidate.afterContent !== 'string'
        || candidate.afterContent === candidate.beforeContent || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length
        || !candidate.beforeEnvironment || !candidate.afterEnvironment) throw Error('The complete environment source proposal was not confirmed.');
      proposal = candidate; rawSignature = raw; proposalSignature = JSON.stringify(candidate); approved = candidate;
      message = '3D环境已检查，请审阅环境声明与完整原文后应用。'; el('SourceReview').open = true; return true;
    } catch (error) { report(error, '3D环境有误，请检查颜色、相机和光照范围后重试。'); return false; }
    finally { refresh(); }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return false; }
    const owner = session, candidate = approved, request = epoch, form = formEpoch, raw = rawSignature, canonical = proposalSignature;
    const owns = () => !disposed && dialog.open && epoch === request && session === owner;
    const unchanged = () => owns() && current() && formEpoch === form && signature() === raw && proposal === candidate && JSON.stringify(candidate) === canonical;
    pending = true; message = '正在应用3D环境修改到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false;
      const context = getContext();
      if (formEpoch !== form || signature() !== raw || proposal !== candidate || JSON.stringify(candidate) !== canonical
        || result?.applied !== true || result.sourcePath !== owner.snapshot.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || result.sourceToken === owner.snapshot.token || !eligible(context)
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('The source draft application receipt does not match the current editor source.');
      opener = null; close(true); if (typeof result.focus === 'function') result.focus(); return true;
    } catch (error) { if (owns()) report(error, '3D环境修改未确认应用。修改保留，请核对原文后重试。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const group of groups) {
    el(group.id + 'Selected').addEventListener('change', () => { if (!pending && current()) { invalidate(); refresh(); } });
    for (const field of group.fields) el(field.id).addEventListener('input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  }
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
