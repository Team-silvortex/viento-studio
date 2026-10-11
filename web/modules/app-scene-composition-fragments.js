import { createSceneCompositionFragmentDraft } from '../../engine/scene-composition-fragments.mjs';
import { supportsStudioCoreCompositionFragment, supportsStudioCoreCompositionFragmentEdit } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value));
const groups = [
  { field: 'position', suffix: 'Position', inputs: ['X', 'Y'], label: '局部位置（偏移前）' },
  { field: 'size', suffix: 'Size', inputs: ['Width', 'Height'], label: '尺寸' },
  { field: 'color', suffix: 'Color', inputs: ['Color'], label: '颜色' },
  { field: 'speed', suffix: 'Speed', inputs: ['Speed'], label: '速度' },
  { field: 'controls', suffix: 'Controls', inputs: ['Controls'], label: '控制' },
  { field: 'imageResourceId', suffix: 'Image', inputs: ['Image'], label: '场景图片' },
];
const fields = groups.flatMap(group => group.inputs);
const resetGroups = groups.filter(group => group.field !== 'position');
const noImage = '__none__';

// The editor owns dependency checks, the source session and normal Save. This
// form edits explicit fragment declarations, never the selected instance's
// effective values or its placement overrides.
export function setupSceneCompositionFragments({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionFragmentsDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionFragmentsTitle');
  const selection = (suffix, label) => `<label class="scene-composition-fragment-select"><input id="sceneCompositionFragments${suffix}Selected" type="checkbox"><span data-i18n="修改"></span><span data-i18n="${label}"></span></label>`;
  const restoration = suffix => `<label class="scene-composition-fragment-restore"><input id="sceneCompositionFragments${suffix}Reset" type="checkbox" aria-describedby="sceneCompositionFragmentsResetHelp"><span id="sceneCompositionFragments${suffix}ResetLabel" data-i18n="恢复继承"></span></label>`;
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionFragmentsTitle" data-i18n="编辑共享片段"></h2>
    <button id="sceneCompositionFragmentsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="修改会作用于引用此片段的多个放置；局部覆盖仍优先。"></p>
    <p id="sceneCompositionFragmentsIdentity" class="build-hint"></p><p id="sceneCompositionFragmentsMessage" role="status" aria-live="polite"></p>
    <fieldset id="sceneCompositionFragmentsFields" class="scene-actor"><legend data-i18n="片段声明字段"></legend>
    <p class="build-hint" data-i18n="只显示片段原文声明的值。未声明字段留空；勾选修改后才会设置，不会改动其他字段的继承或局部覆盖。"></p>
    <div class="scene-settings">
      <div class="scene-composition-fragment-group">${selection('Position', '局部位置（偏移前）')}
        <label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneCompositionFragmentsX" type="number" min="-100000" max="100000" step="any"></label>
        <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneCompositionFragmentsY" type="number" min="-100000" max="100000" step="any"></label><p id="sceneCompositionFragmentsPositionStatus" class="build-hint"></p></div>
      <div class="scene-composition-fragment-group">${selection('Size', '尺寸')}
        <label class="scene-field"><span data-i18n="宽度"></span><input id="sceneCompositionFragmentsWidth" type="number" min="1" max="2048" step="any"></label>
        <label class="scene-field"><span data-i18n="高度"></span><input id="sceneCompositionFragmentsHeight" type="number" min="1" max="2048" step="any"></label>${restoration('Size')}<p id="sceneCompositionFragmentsSizeStatus" class="build-hint"></p></div>
      <div class="scene-composition-fragment-group scene-composition-fragment-single">${selection('Color', '颜色')}
        <label class="scene-field"><span data-i18n="颜色"></span><input id="sceneCompositionFragmentsColor" type="text" spellcheck="false"></label>${restoration('Color')}<p id="sceneCompositionFragmentsColorStatus" class="build-hint"></p></div>
      <div class="scene-composition-fragment-group scene-composition-fragment-single">${selection('Speed', '速度')}
        <label class="scene-field"><span data-i18n="速度"></span><input id="sceneCompositionFragmentsSpeed" type="number" min="0" max="2000" step="any"></label>${restoration('Speed')}<p id="sceneCompositionFragmentsSpeedStatus" class="build-hint"></p></div>
      <div class="scene-composition-fragment-group scene-composition-fragment-single">${selection('Controls', '控制')}
        <label class="scene-field"><span data-i18n="控制"></span><select id="sceneCompositionFragmentsControls"><option value="" data-i18n="请选择"></option><option value="none" data-i18n="不接受输入"></option><option value="arrows" data-i18n="方向键"></option></select></label>${restoration('Controls')}<p id="sceneCompositionFragmentsControlsStatus" class="build-hint"></p></div>
      <div class="scene-composition-fragment-group scene-composition-fragment-single">${selection('Image', '场景图片')}
        <label class="scene-field"><span data-i18n="场景图片"></span><select id="sceneCompositionFragmentsImage"></select></label>${restoration('Image')}<p id="sceneCompositionFragmentsImageStatus" class="build-hint"></p></div>
    </div><p id="sceneCompositionFragmentsResetHelp" class="build-hint"></p></fieldset>
    <section class="scene-composition-fragment-targets" aria-labelledby="sceneCompositionFragmentsTargetsTitle"><h3 id="sceneCompositionFragmentsTargetsTitle" data-i18n="共享片段的引用实例"></h3>
      <p id="sceneCompositionFragmentsImpact" class="build-hint"></p><ul id="sceneCompositionFragmentsTargets"></ul></section>
    <p class="build-hint" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <details id="sceneCompositionFragmentsReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionFragmentsSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionFragmentsDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionFragmentsError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionFragmentsDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionFragmentsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查共享片段修改"></button>
      <button id="sceneCompositionFragmentsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionFragmentsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionFragments${suffix}`);
  let session = null, openEpoch = 0, formEpoch = 0, disposed = false, opener = null, closeFocusEpoch = 0;
  let pending = false, proposal = null, proposalSignature = '', approved = null, approvedSignature = '', approvedCandidateSignature = '', message = '', details = '', diagnostics = [];
  const selected = () => groups.filter(group => el(`${group.suffix}Selected`).checked);
  const selectedResets = () => resetGroups.filter(group => el(`${group.suffix}Reset`).checked).map(group => group.field);
  const signature = () => JSON.stringify({ fields: fields.map(field => el(field).value), selected: groups.map(group => el(`${group.suffix}Selected`).checked), reset: resetGroups.map(group => el(`${group.suffix}Reset`).checked) });
  const current = () => {
    const c = getContext();
    return Boolean(session && !disposed && supportsStudioCoreCompositionFragment() && c.compositionSourceWritable === true && c.canEditCompositionFragment === true
      && c.editable && !c.creating && !c.busy && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent()
      && (!selectedResets().length || supportsStudioCoreCompositionFragmentEdit()));
  };
  const numeric = suffix => {
    const raw = el(suffix).value.trim(), value = Number(raw);
    if (!raw || !Number.isFinite(value)) throw new TypeError('Each selected numeric field requires a finite number.');
    return value;
  };
  function values() {
    const result = {};
    for (const group of selected()) {
      switch (group.field) {
        case 'position': result.position = [numeric('X'), numeric('Y')]; break;
        case 'size': result.size = [numeric('Width'), numeric('Height')]; break;
        case 'speed': result.speed = numeric('Speed'); break;
        case 'imageResourceId': {
          const id = el('Image').value;
          if (!id) throw new TypeError('Select a resource or explicitly choose no image.');
          result.imageResourceId = id === noImage ? null : id; break;
        }
        default: result[group.field] = el(group.inputs[0]).value.trim();
      }
    }
    return result;
  }
  function changed() {
    if (!session || !selected().length && !selectedResets().length) return false;
    if (selectedResets().some(field => Object.hasOwn(session.values, field))) return true;
    try {
      const input = values();
      return Object.keys(input).some(field => !Object.hasOwn(session.values, field) || JSON.stringify(input[field]) !== JSON.stringify(session.values[field]));
    } catch { return true; }
  }
  const approvalMatches = () => approved && approved === proposal && approvedSignature === signature() && approvedCandidateSignature === JSON.stringify(proposal);
  function renderTargets() {
    const list = el('Targets'); list.replaceChildren();
    if (!session) { el('Impact').textContent = ''; return; }
    const restores = proposal ? proposal.reset || [] : selectedResets();
    const selectedFields = proposal ? [...Object.keys(proposal.values), ...restores] : [...selected().map(group => group.field), ...restores];
    const labels = keys => keys.map(key => t(groups.find(group => group.field === key).label)).join(' · ');
    let affected = 0;
    for (const target of session.targets) {
      const row = document.createElement('li'); row.dataset.instanceId = target.instanceId; row.dataset.placementId = target.placementId;
      const heading = document.createElement('p'); heading.textContent = `${session.names.get(target.instanceId) || t('实例')} · ${target.instanceId} · ${t('放置')} · ${target.placementId}`;
      row.append(heading);
      const masked = selectedFields.filter(field => target.overrides.includes(field)), receiving = selectedFields.filter(field => !target.overrides.includes(field));
      if (receiving.length) {
        const set = receiving.filter(field => !restores.includes(field)), reset = receiving.filter(field => restores.includes(field));
        if (set.length) { const note = document.createElement('p'); note.textContent = t('参与共享修改：{0}', labels(set)); row.append(note); }
        if (reset.length) { const note = document.createElement('p'); note.textContent = session.draft.useProjectionDefaults ? t('重新继承投影：{0}', labels(reset)) : t('移除共享图片声明后不使用图片。'); row.append(note); }
        affected++;
      }
      if (masked.length) { const note = document.createElement('p'); note.textContent = t('局部覆盖仍优先：{0}', labels(masked)); row.append(note); }
      if (!selectedFields.length) { const note = document.createElement('p'); note.textContent = t('勾选字段后显示该实例的修改影响。'); row.append(note); }
      list.append(row);
    }
    el('Impact').textContent = !selectedFields.length ? t('引用实例：{0}；尚未选择修改字段。', session.targets.length)
      : affected ? t('引用实例：{0}；{1} 个实例参与所选字段的共享修改。', session.targets.length, affected)
        : t('所有引用实例均有局部覆盖；本次只更新片段声明。');
  }
  function refresh() {
    translatePage(dialog);
    const valid = current();
    if (proposal && proposalSignature !== signature()) { approved = null; proposal = null; message = '共享片段修改尚未应用到原文草稿。'; }
    if (approved && !approvalMatches()) { approved = null; proposal = null; message = '共享片段修改尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后编辑共享片段。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    for (const group of groups) {
      const resetting = group.field !== 'position' && el(`${group.suffix}Reset`).checked;
      const enabled = Boolean(el(`${group.suffix}Selected`).checked) && !resetting;
      el(`${group.suffix}Selected`).disabled = pending || !valid;
      el(`${group.suffix}Selected`).setAttribute('aria-label', t('修改：{0}', t(group.label)));
      for (const field of group.inputs) el(field).disabled = pending || !valid || !enabled;
      el(`${group.suffix}Status`).textContent = t(resetting ? session?.draft.useProjectionDefaults ? '已选择恢复；显示的仍是恢复前的声明。' : '已选择移除图片声明；移除后不使用图片。'
        : session && Object.hasOwn(session.values, group.field) ? '片段已声明此字段。' : '片段未声明此字段；勾选后明确设置。');
    }
    for (const group of resetGroups) {
      const available = Boolean(session && Object.hasOwn(session.values, group.field) && (session.draft.useProjectionDefaults || group.field === 'imageResourceId'));
      const label = group.field === 'imageResourceId' && session && !session.draft.useProjectionDefaults ? '移除图片声明' : '恢复继承';
      el(`${group.suffix}Reset`).disabled = pending || !valid || !supportsStudioCoreCompositionFragmentEdit() || !available;
      el(`${group.suffix}Reset`).setAttribute('aria-label', t('共享声明操作：{0} · {1}', t(group.label), t(label)));
      el(`${group.suffix}ResetLabel`).textContent = t(label);
    }
    el('ResetHelp').textContent = t(!supportsStudioCoreCompositionFragmentEdit() ? '当前核心不支持共享声明恢复；字段设置仍可使用。'
      : session?.draft.useProjectionDefaults ? '恢复会移除共享片段声明并重新读取投影继承；所有引用的局部覆盖仍优先。位置声明必须保留。'
        : '此片段未启用投影继承，只能移除图片声明；移除后无图，局部图片覆盖仍优先。其他必需声明保持。');
    el('Check').disabled = pending || !valid || !changed(); el('Apply').disabled = pending || !valid || !approvalMatches();
    el('Close').disabled = pending; el('Cancel').disabled = pending;
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details;
    const list = el('Diagnostics'); list.replaceChildren();
    for (const issue of diagnostics) { const row = document.createElement('li'); row.textContent = `${issue.code || ''} ${issue.propertyPath || ''}`; list.append(row); }
    if (session) el('Identity').textContent = `${t('片段')} · ${session.draft.fragmentId} · ${t('局部标识')} · ${session.draft.actorKey}`;
    renderTargets();
  }
  function reset() {
    openEpoch++; formEpoch++; session = null; pending = false; proposal = null; approved = null; approvedSignature = ''; approvedCandidateSignature = ''; details = ''; diagnostics = [];
    for (const group of groups) el(`${group.suffix}Selected`).checked = false;
    for (const group of resetGroups) el(`${group.suffix}Reset`).checked = false;
    dialog.setAttribute('aria-busy', 'false'); dialog.dataset.dirty = 'false';
  }
  function close() {
    if (pending) return false;
    if (changed() && !window.confirm(t('丢弃本次共享片段修改？原文草稿不会改变。'))) return false;
    reset(); dialog.close(); return true;
  }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = ['scene_composition_fragment_conflict', 'scene_composition_override_conflict'].includes(code) ? '原文或预览已变化，请重新预览后编辑共享片段。'
      : ['scene_composition_fragment_unchanged', 'scene_composition_override_unchanged'].includes(code) ? '没有需要应用的共享片段修改。'
        : ['scene_composition_fragment_content_limit', 'scene_composition_override_content_limit'].includes(code) ? '修改后的配方超过 128 KiB；请缩减原文后重试。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !changed()) { refresh(); return; }
    approved = null; proposal = null; diagnostics = []; details = '';
    const owner = session, epoch = formEpoch, raw = signature();
    try {
      const resets = selectedResets(), input = values();
      proposal = copy(resets.length ? owner.draft.proposeEdit({ values: input, reset: resets }) : owner.draft.propose(input)); proposalSignature = raw;
    }
    catch (error) { report(error, '共享片段修改有误，请检查所选字段值后重试。'); refresh(); return; }
    const candidate = proposal, candidateSignature = JSON.stringify(candidate);
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSignature;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try {
      const result = await validateDraft(copy(candidate), { isCurrent: unchanged });
      if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('Recipe validation was not confirmed.'), { payload: result });
      approved = candidate; approvedSignature = raw; approvedCandidateSignature = candidateSignature; message = '共享片段修改已检查，请确认引用实例和完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后编辑共享片段。'; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, raw = signature(), candidateSignature = JSON.stringify(candidate);
    const owns = () => session === owner && dialog.open && !disposed;
    const isCurrent = () => owns() && current() && approved === candidate && formEpoch === epoch && signature() === raw && JSON.stringify(candidate) === candidateSignature;
    pending = true; message = '正在应用共享片段到原文草稿…'; refresh();
    try {
      const result = await applySourceDraft(copy(candidate), { isCurrent });
      if (!owns()) return;
      if (result?.applied !== true) throw new Error('The editor did not confirm applying the fragment declaration.');
      // An accepted host receipt advances the live source token. Completion is
      // still bound to this dialog operation and its unchanged canonical draft.
      closeFocusEpoch++; opener = null; reset(); dialog.close(); await sourceApplied(result, copy(candidate));
    } catch (error) { if (owns()) { approved = null; report(error, '共享片段修改未应用。修改保留，请检查后重试。'); } }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  const edited = () => { formEpoch++; approved = null; proposal = null; details = ''; diagnostics = []; message = '共享片段修改尚未应用到原文草稿。'; refresh(); };
  for (const group of groups) {
    el(`${group.suffix}Selected`).addEventListener('change', () => {
      if (pending || !current()) return;
      if (group.field !== 'position' && el(`${group.suffix}Selected`).checked) el(`${group.suffix}Reset`).checked = false;
      edited();
    });
    for (const field of group.inputs) el(field).addEventListener(['Controls', 'Image'].includes(field) ? 'change' : 'input', () => {
      if (!pending && current() && el(`${group.suffix}Selected`).checked) edited();
    });
  }
  for (const group of resetGroups) el(`${group.suffix}Reset`).addEventListener('change', () => {
    if (pending || !current() || !supportsStudioCoreCompositionFragmentEdit()) return;
    if (!session || !Object.hasOwn(session.values, group.field) || !session.draft.useProjectionDefaults && group.field !== 'imageResourceId') { el(`${group.suffix}Reset`).checked = false; refresh(); return; }
    if (el(`${group.suffix}Reset`).checked) el(`${group.suffix}Selected`).checked = false;
    edited();
  });
  el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const focus = opener, epoch = closeFocusEpoch; opener = null; if (session) reset();
    queueMicrotask(() => { if (!dialog.open && !disposed && epoch === closeFocusEpoch) focus?.focus?.(); });
  });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!pending) void (approvalMatches() ? apply() : check()); } });
  const unsubscribe = onLanguageChange(refresh);
  function destroy() { if (disposed) return; disposed = true; closeFocusEpoch++; reset(); dialog.close(); unsubscribe?.(); dialog.remove(); }
  return {
    refresh, close, dispose: destroy, destroy,
    async open({ model, source, actorId, images = [], isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => { const c = getContext(); return epoch === openEpoch && !disposed && !dialog.open && supportsStudioCoreCompositionFragment()
        && c.compositionSourceWritable === true && c.canEditCompositionFragment === true && c.editable && !c.creating && !c.busy
        && c.sceneDraftToken === token && c.sceneDraftPath === source?.sourcePath && isCurrent(); };
      if (!eligible()) return false;
      try {
        const names = new Map(copy(model.actors || []).map(actor => [actor.instanceId, actor.name || actor.title || '']));
        const draft = await createSceneCompositionFragmentDraft(model, source, actorId, { digest });
        if (!eligible()) return false;
        const initial = copy(draft.values), picker = el('Image'); picker.replaceChildren();
        const option = (id, label) => { const item = document.createElement('option'); item.value = id; item.textContent = label; picker.append(item); };
        option('', t('请选择')); if (draft.useProjectionDefaults === true) option(noImage, t('不使用图片'));
        for (const image of images) option(image.id, image.path ? `${image.name || image.path} · ${image.path}` : image.name || image.id);
        if (initial.imageResourceId && !images.some(image => image.id === initial.imageResourceId)) option(initial.imageResourceId, t('当前图片（资源不可用）'));
        session = { draft, sourcePath: source.sourcePath, token, isCurrent, values: initial, targets: copy(draft.targets), names };
        for (const [field, value] of [['X', initial.position?.[0]], ['Y', initial.position?.[1]], ['Width', initial.size?.[0]], ['Height', initial.size?.[1]],
          ['Color', initial.color], ['Speed', initial.speed], ['Controls', initial.controls], ['Image', initial.imageResourceId === null ? noImage : initial.imageResourceId]]) el(field).value = value === undefined ? '' : String(value);
        for (const group of groups) el(`${group.suffix}Selected`).checked = false;
        for (const group of resetGroups) el(`${group.suffix}Reset`).checked = false;
        proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '共享片段修改尚未应用到原文草稿。'; opener = document.activeElement; closeFocusEpoch++;
        refresh(); dialog.showModal(); el('PositionSelected').focus(); return true;
      } catch (error) {
        if (!eligible()) return false;
        report(error, '共享片段编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false;
      }
    },
  };
}
