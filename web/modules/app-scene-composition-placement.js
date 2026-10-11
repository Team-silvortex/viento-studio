import { createSceneCompositionPlacementDraft } from '../../engine/scene-composition-placement.mjs';
import { supportsStudioCoreCompositionPlacement } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value));

// A placement is the shared offset for its mapped instances. Author groups
// remain organizational; the parent owns dependency checks and normal Save.
export function setupSceneCompositionPlacement({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionPlacementDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionPlacementTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionPlacementTitle" data-i18n="编辑放置偏移"></h2>
    <button id="sceneCompositionPlacementClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="偏移在每个演员的局部位置覆盖之后相加，影响此放置的全部实例。分组只组织内容，不进行空间变换。"></p>
    <p id="sceneCompositionPlacementIdentity" class="build-hint"></p><p id="sceneCompositionPlacementStatus" role="status" aria-live="polite"></p>
    <fieldset id="sceneCompositionPlacementFields" class="scene-actor"><legend data-i18n="放置偏移"></legend>
      <p id="sceneCompositionPlacementDeclared" class="build-hint"></p><p id="sceneCompositionPlacementEffective" class="build-hint"></p>
      <div class="scene-settings"><label class="scene-field"><span data-i18n="偏移 X"></span><input id="sceneCompositionPlacementX" type="number" min="-100000" max="100000" step="any"></label>
        <label class="scene-field"><span data-i18n="偏移 Y"></span><input id="sceneCompositionPlacementY" type="number" min="-100000" max="100000" step="any"></label></div>
      <label class="scene-composition-placement-reset"><input id="sceneCompositionPlacementReset" type="checkbox"><span data-i18n="移除偏移声明，恢复缺省零偏移"></span></label>
      <p class="build-hint" data-i18n="未声明偏移与明确声明 [0,0] 是不同的原文。恢复会删除偏移字段，保留恢复前输入；取消恢复后可继续编辑。"></p>
    </fieldset>
    <section class="scene-composition-placement-targets" aria-labelledby="sceneCompositionPlacementTargetsTitle"><h3 id="sceneCompositionPlacementTargetsTitle" data-i18n="此放置的全部实例"></h3>
      <p id="sceneCompositionPlacementImpact" class="build-hint"></p><ul id="sceneCompositionPlacementTargets"></ul><p id="sceneCompositionPlacementGroupNote" class="build-hint"></p><ul id="sceneCompositionPlacementGroups"></ul></section>
    <p class="build-hint" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <details id="sceneCompositionPlacementReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary>
      <h3 data-i18n="原文差异（只读）"></h3><pre id="sceneCompositionPlacementDiff" tabindex="0"></pre><h3 data-i18n="完整候选原文"></h3><pre id="sceneCompositionPlacementSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionPlacementDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionPlacementError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionPlacementDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionPlacementCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查放置偏移修改"></button>
      <button id="sceneCompositionPlacementApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionPlacementCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionPlacement${suffix}`);
  let session = null, openEpoch = 0, formEpoch = 0, disposed = false, opener = null, closeFocusEpoch = 0;
  let pending = false, proposal = null, proposalSignature = '', approved = null, approvedSignature = '', approvedCandidateSignature = '', message = '', details = '', diagnostics = [];
  const signature = () => JSON.stringify([el('X').value, el('Y').value, el('Reset').checked]);
  const current = () => {
    const c = getContext();
    return Boolean(session && !disposed && supportsStudioCoreCompositionPlacement() && c.compositionSourceWritable === true && c.canEditCompositionPlacement === true
      && c.editable && !c.creating && !c.busy && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent());
  };
  function offset() {
    if (el('Reset').checked) return null;
    return ['X', 'Y'].map(suffix => {
      const raw = el(suffix).value.trim(), value = Number(raw);
      if (!raw || !Number.isFinite(value) || Math.abs(value) > 100000) throw new TypeError('Both placement offset coordinates must be finite and within ±100000.');
      return value;
    });
  }
  function changed() {
    if (!session) return false;
    if (el('Reset').checked) return session.offset !== null;
    if (session.offset === null && !el('X').value.trim() && !el('Y').value.trim()) return false;
    try { return JSON.stringify(offset()) !== JSON.stringify(session.offset); } catch { return true; }
  }
  const approvalMatches = () => approved && approved === proposal && approvedSignature === signature() && approvedCandidateSignature === JSON.stringify(proposal);
  function renderTargets() {
    el('Targets').replaceChildren(); el('Groups').replaceChildren();
    if (!session) { el('Impact').textContent = ''; el('GroupNote').textContent = ''; return; }
    for (const target of session.targets) {
      const row = document.createElement('li'); row.dataset.instanceId = target.instanceId; row.dataset.actorKey = target.actorKey;
      row.textContent = `${session.names.get(target.instanceId) || t('实例')} · ${target.instanceId} · ${t('局部标识')} · ${target.actorKey}`;
      el('Targets').append(row);
    }
    for (const group of session.groups) {
      const row = document.createElement('li'); row.dataset.groupId = group.groupId; row.dataset.groupKey = group.groupKey;
      row.textContent = `${group.groupId} · ${t('局部标识')} · ${group.groupKey}`; el('Groups').append(row);
    }
    el('Impact').textContent = t('此放置包含 {0} 个实例；其局部位置与覆盖保持，场景位置统一加上放置偏移。', session.targets.length);
    el('GroupNote').textContent = t('组织分组：{0}；身份与组织关系保持，分组不提供空间变换。', session.groups.length);
  }
  function sourceDifference(before, after) {
    let start = 0, endBefore = before.length, endAfter = after.length;
    while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
    return `${t('移除的原文')}\n${before.slice(start, endBefore)}\n\n${t('新增的原文')}\n${after.slice(start, endAfter)}`;
  }
  function refresh() {
    translatePage(dialog);
    const valid = current();
    if (proposal && proposalSignature !== signature() || approved && !approvalMatches()) { approved = null; proposal = null; message = '放置偏移修改尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后编辑放置偏移。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    for (const suffix of ['X', 'Y']) el(suffix).disabled = pending || !valid || el('Reset').checked;
    el('Reset').disabled = pending || !valid || session?.offset === null;
    el('Check').disabled = pending || !valid || !changed(); el('Apply').disabled = pending || !valid || !approvalMatches();
    el('Close').disabled = pending; el('Cancel').disabled = pending;
    el('Status').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Diff').textContent = proposal ? `${proposal.changedPaths.join('\n')}\n\n${sourceDifference(session.beforeContent, proposal.afterContent)}` : '';
    el('Error').hidden = !details; el('Details').textContent = details;
    el('Diagnostics').replaceChildren();
    for (const issue of diagnostics) { const row = document.createElement('li'); row.textContent = `${issue.code || ''} ${issue.propertyPath || ''}`; el('Diagnostics').append(row); }
    if (session) {
      el('Identity').textContent = `${t('放置')} · ${session.draft.placementId} · ${t('片段')} · ${session.draft.fragmentId}`;
      el('Declared').textContent = session.offset === null ? t('原文未声明偏移；输入留空，不会自动新增 [0,0]。') : t('原文已声明偏移：{0}, {1}', ...session.offset);
      el('Effective').textContent = el('Reset').checked ? t('已选择移除声明；检查后使用缺省 [0,0]，显示的仍是恢复前输入。')
        : t('当前预览的生效偏移：{0}, {1}', ...(session.offset || [0, 0]));
    }
    renderTargets();
  }
  function reset() {
    openEpoch++; formEpoch++; session = null; pending = false; proposal = null; approved = null; approvedSignature = ''; approvedCandidateSignature = ''; details = ''; diagnostics = [];
    el('Reset').checked = false; dialog.setAttribute('aria-busy', 'false'); dialog.dataset.dirty = 'false';
  }
  function close() {
    if (pending) return false;
    if (changed() && !window.confirm(t('丢弃本次放置偏移修改？原文草稿不会改变。'))) return false;
    reset(); dialog.close(); return true;
  }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_override_conflict' ? '原文或预览已变化，请重新预览后编辑放置偏移。'
      : code === 'scene_composition_override_unchanged' ? '没有需要应用的放置偏移修改。'
        : code === 'scene_composition_override_content_limit' ? '修改后的配方超过 128 KiB；请缩减原文后重试。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !changed()) { refresh(); return; }
    approved = null; proposal = null; diagnostics = []; details = '';
    const owner = session, epoch = formEpoch, raw = signature();
    try { proposal = copy(owner.draft.propose(offset())); proposalSignature = raw; }
    catch (error) { report(error, '放置偏移修改有误，请检查两项坐标后重试。'); refresh(); return; }
    const candidate = proposal, candidateSignature = JSON.stringify(candidate);
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSignature;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try {
      const result = await validateDraft(copy(candidate), { isCurrent: unchanged });
      if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('Recipe validation was not confirmed.'), { payload: result });
      approved = candidate; approvedSignature = raw; approvedCandidateSignature = candidateSignature; message = '放置偏移已检查，请确认全部实例和完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后编辑放置偏移。'; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, raw = signature(), candidateSignature = JSON.stringify(candidate);
    const owns = () => session === owner && dialog.open && !disposed;
    const isCurrent = () => owns() && current() && approved === candidate && formEpoch === epoch && signature() === raw && JSON.stringify(candidate) === candidateSignature;
    pending = true; message = '正在应用放置偏移到原文草稿…'; refresh();
    try {
      const result = await applySourceDraft(copy(candidate), { isCurrent });
      if (!owns()) return;
      if (result?.applied !== true) throw new Error('The editor did not confirm applying the placement offset.');
      closeFocusEpoch++; opener = null; reset(); dialog.close(); await sourceApplied(result, copy(candidate));
    } catch (error) { if (owns()) { approved = null; report(error, '放置偏移修改未应用。修改保留，请检查后重试。'); } }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  const edited = () => { formEpoch++; approved = null; proposal = null; details = ''; diagnostics = []; message = '放置偏移修改尚未应用到原文草稿。'; refresh(); };
  for (const suffix of ['X', 'Y']) el(suffix).addEventListener('input', () => { if (!pending && current() && !el('Reset').checked) edited(); });
  el('Reset').addEventListener('change', () => { if (!pending && current()) { if (session.offset === null) el('Reset').checked = false; edited(); } });
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
  return { refresh, close, dispose: destroy, destroy,
    async open({ model, source, actorId, isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const sourcePath = source?.sourcePath, epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => { const c = getContext(); return epoch === openEpoch && !disposed && !dialog.open && supportsStudioCoreCompositionPlacement()
        && c.compositionSourceWritable === true && c.canEditCompositionPlacement === true && c.editable && !c.creating && !c.busy
        && c.sceneDraftToken === token && c.sceneDraftPath === sourcePath && isCurrent(); };
      if (!eligible()) return false;
      try {
        const before = copy(source), frozen = copy(model);
        const names = new Map((frozen.actors || []).map(actor => [actor.instanceId, actor.name || actor.title || '']));
        const draft = await createSceneCompositionPlacementDraft(frozen, before, actorId, { digest });
        if (!eligible()) return false;
        session = { draft, sourcePath: before.sourcePath, beforeContent: before.content, token, isCurrent, offset: copy(draft.offset), targets: copy(draft.targets), groups: copy(draft.groups), names };
        for (const [index, suffix] of ['X', 'Y'].entries()) el(suffix).value = session.offset === null ? '' : String(session.offset[index]);
        el('Reset').checked = false; proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '放置偏移修改尚未应用到原文草稿。'; opener = document.activeElement; closeFocusEpoch++;
        refresh(); dialog.showModal(); el('X').focus(); return true;
      } catch (error) {
        if (!eligible()) return false;
        report(error, '放置偏移编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false;
      }
    },
  };
}
