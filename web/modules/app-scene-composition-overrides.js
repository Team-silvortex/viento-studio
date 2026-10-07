import { createSceneCompositionOverrideDraft } from '../../engine/scene-composition-overrides.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value));

// This dialog only proposes a source-text edit. The editor owns the live source
// session, dependency validation, guarded application and eventual normal save.
export function setupSceneCompositionOverrides({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionOverridesDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionOverridesTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionOverridesTitle" data-i18n="编辑此实例覆盖"></h2>
    <button id="sceneCompositionOverridesClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="局部覆盖只应用到当前放置中的这个实例；共用片段和其他实例保持原样。"></p>
    <p id="sceneCompositionOverridesIdentity" class="build-hint"></p><p id="sceneCompositionOverridesMessage" role="status" aria-live="polite"></p>
    <fieldset id="sceneCompositionOverridesFields" class="scene-actor"><legend data-i18n="局部位置（偏移前）"></legend>
      <p id="sceneCompositionOverridesOffset" class="build-hint"></p>
      <div class="scene-settings"><label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneCompositionOverridesX" type="number" min="-100000" max="100000" step="any"></label>
      <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneCompositionOverridesY" type="number" min="-100000" max="100000" step="any"></label>
      <label class="scene-field"><span data-i18n="宽度"></span><input id="sceneCompositionOverridesWidth" type="number" min="1" max="2048" step="any"></label>
      <label class="scene-field"><span data-i18n="高度"></span><input id="sceneCompositionOverridesHeight" type="number" min="1" max="2048" step="any"></label>
      <label class="scene-field"><span data-i18n="颜色"></span><input id="sceneCompositionOverridesColor" type="text" spellcheck="false"></label>
      <label class="scene-field"><span data-i18n="速度"></span><input id="sceneCompositionOverridesSpeed" type="number" min="0" max="2000" step="any"></label>
      <label class="scene-field"><span data-i18n="控制"></span><select id="sceneCompositionOverridesControls"><option value="none" data-i18n="不接受输入"></option><option value="arrows" data-i18n="方向键"></option></select></label>
      <label class="scene-field"><span data-i18n="场景图片"></span><select id="sceneCompositionOverridesImage"></select></label></div></fieldset>
    <p class="build-hint" data-i18n="未改动字段保留原有继承与覆盖。应用后仍需在编辑器保存。"></p>
    <details id="sceneCompositionOverridesReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionOverridesSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionOverridesDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionOverridesError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionOverridesDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionOverridesCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查覆盖修改"></button>
      <button id="sceneCompositionOverridesApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionOverridesCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionOverrides${suffix}`);
  const fields = ['X', 'Y', 'Width', 'Height', 'Color', 'Speed', 'Controls', 'Image'];
  let session = null, openEpoch = 0, formEpoch = 0, disposed = false, opener = null, closeFocusEpoch = 0;
  let pending = false, proposal = null, approved = null, approvedSignature = '', message = '', details = '', diagnostics = [];
  const current = () => {
    const c = getContext();
    return Boolean(session && !disposed && c.compositionSourceWritable === true && c.canEditCompositionOverride === true && c.editable && !c.creating && !c.busy
      && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent());
  };
  const formSignature = () => JSON.stringify(fields.map(field => el(field).value));
  const numeric = suffix => {
    const raw = el(suffix).value.trim(), value = Number(raw);
    if (!raw || !Number.isFinite(value)) throw new TypeError('Each numeric field requires a finite number.');
    return value;
  };
  function values() {
    return { position: [numeric('X'), numeric('Y')], size: [numeric('Width'), numeric('Height')], color: el('Color').value.trim(),
      speed: numeric('Speed'), controls: el('Controls').value, imageResourceId: el('Image').value.trim() || null };
  }
  function changed() {
    if (!session) return false;
    try { return JSON.stringify(values()) !== JSON.stringify(session.values); }
    catch { return true; }
  }
  function refresh() {
    translatePage(dialog);
    const valid = current();
    if (approved && approvedSignature !== formSignature()) { approved = null; message = '实例覆盖尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后编辑实例覆盖。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    for (const field of fields) el(field).disabled = pending || !valid;
    el('Check').disabled = pending || !valid || !changed(); el('Apply').disabled = pending || !valid || !approved;
    el('Close').disabled = pending; el('Cancel').disabled = pending;
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details;
    const list = el('Diagnostics'); list.replaceChildren();
    for (const issue of diagnostics) { const row = document.createElement('li'); row.textContent = `${issue.code || ''} ${issue.propertyPath || ''}`; list.append(row); }
    if (session) {
      const { fragmentId, placementId, actorKey, offset } = session.draft;
      el('Identity').textContent = `${t('片段')} · ${fragmentId} · ${t('放置')} · ${placementId} · ${t('局部标识')} · ${actorKey}`;
      el('Offset').textContent = t('画布位置 = 局部位置 + 放置偏移（{0}, {1}）。', ...offset);
    }
  }
  function reset() {
    openEpoch++; formEpoch++; session = null; pending = false; proposal = null; approved = null; details = ''; diagnostics = [];
    dialog.setAttribute('aria-busy', 'false'); dialog.dataset.dirty = 'false';
  }
  function close() {
    if (pending) return false;
    if (changed() && !window.confirm(t('丢弃本次实例覆盖修改？原文草稿不会改变。'))) return false;
    reset(); dialog.close(); return true;
  }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {};
    const code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_override_conflict' ? '原文或预览已变化，请重新预览后编辑实例覆盖。'
      : code === 'scene_composition_override_unchanged' ? '没有需要应用的覆盖修改。'
      : code === 'scene_composition_override_content_limit' ? '修改后的配方超过 128 KiB；请缩减原文后重试。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !changed()) { refresh(); return; }
    approved = null; proposal = null; diagnostics = []; details = '';
    const owner = session, epoch = formEpoch, signature = formSignature();
    try { proposal = owner.draft.propose(values()); }
    catch (error) { report(error, '覆盖修改有误，请检查字段值后重试。'); refresh(); return; }
    const candidate = proposal;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && formSignature() === signature && proposal === candidate;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try {
      const result = await validateDraft(copy(candidate), { isCurrent: unchanged });
      if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('Recipe validation was not confirmed.'), { payload: result });
      approved = candidate; approvedSignature = signature; message = '覆盖修改已检查，请确认完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally {
      if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后编辑实例覆盖。'; refresh(); }
    }
  }
  async function apply() {
    if (pending || !current() || !approved || approved !== proposal || approvedSignature !== formSignature()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, signature = formSignature();
    const owns = () => session === owner && dialog.open && !disposed;
    const isCurrent = () => owns() && current() && approved === candidate && formEpoch === epoch && formSignature() === signature;
    pending = true; message = '正在应用实例覆盖到原文草稿…'; refresh();
    try {
      const result = await applySourceDraft(copy(candidate), { isCurrent });
      if (!owns()) return;
      if (result?.applied !== true) throw new Error('The editor did not confirm applying the recipe override.');
      // Applying advances the source token. Only the same dialog operation may
      // finish; the host already checked the live token immediately before edit.
      closeFocusEpoch++; opener = null; reset(); dialog.close();
      await sourceApplied(result, candidate);
    } catch (error) {
      if (owns()) { approved = null; report(error, '覆盖修改未应用。修改保留，请检查后重试。'); }
    } finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const field of fields) el(field).addEventListener(['Controls', 'Image'].includes(field) ? 'change' : 'input', () => {
    formEpoch++; approved = null; proposal = null; details = ''; diagnostics = []; message = '实例覆盖尚未应用到原文草稿。'; refresh();
  });
  el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const focus = opener, epoch = closeFocusEpoch; opener = null;
    if (session) reset();
    queueMicrotask(() => { if (!dialog.open && !disposed && epoch === closeFocusEpoch) focus?.focus?.(); });
  });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!pending) void (approved ? apply() : check()); }
  });
  const unsubscribe = onLanguageChange(refresh);
  return {
    refresh,
    async open({ model, source, instanceId, images = [], isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => {
        const c = getContext();
        return epoch === openEpoch && !disposed && !dialog.open && c.compositionSourceWritable === true && c.canEditCompositionOverride === true && c.editable && !c.creating && !c.busy
          && c.sceneDraftToken === token && c.sceneDraftPath === source?.sourcePath && isCurrent();
      };
      if (!eligible()) return false;
      try {
        const draft = await createSceneCompositionOverrideDraft(model, source, instanceId, { digest });
        if (!eligible()) return false;
        const initial = draft.values;
        const picker = el('Image'); picker.replaceChildren();
        const option = (id, label) => { const item = document.createElement('option'); item.value = id; item.textContent = label; picker.append(item); };
        if (draft.canClearImage || !initial.imageResourceId) option('', t('不使用图片'));
        for (const image of images) option(image.id, image.path ? `${image.name || image.path} · ${image.path}` : image.name || image.id);
        if (initial.imageResourceId && !images.some(image => image.id === initial.imageResourceId)) option(initial.imageResourceId, t('当前图片（资源不可用）'));
        session = { draft, sourcePath: source.sourcePath, token, isCurrent, values: { position: [...initial.position], size: [...initial.size], color: initial.color,
          speed: initial.speed, controls: initial.controls, imageResourceId: initial.imageResourceId || null } };
        for (const [field, value] of [['X', initial.position[0]], ['Y', initial.position[1]], ['Width', initial.size[0]], ['Height', initial.size[1]],
          ['Color', initial.color], ['Speed', initial.speed], ['Controls', initial.controls], ['Image', initial.imageResourceId || '']]) el(field).value = String(value);
        proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '实例覆盖尚未应用到原文草稿。'; opener = document.activeElement; closeFocusEpoch++;
        refresh(); dialog.showModal(); el('X').focus(); return true;
      } catch (error) {
        if (!eligible()) return false;
        report(error, '实例覆盖编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false;
      }
    },
    destroy() { disposed = true; closeFocusEpoch++; reset(); dialog.close(); unsubscribe?.(); dialog.remove(); },
  };
}
