import { createSceneCompositionPlacementsDraft } from '../../engine/scene-composition-placements.mjs';
import { supportsStudioCoreCompositionPlacements } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const copy = value => JSON.parse(JSON.stringify(value));
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// One placement operation owns its newly allocated identity maps until cancel
// or source application. Source interpretation and mutation remain in engine/.
export function setupSceneCompositionPlacements({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionPlacementsDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionPlacementsTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionPlacementsTitle" data-i18n="管理片段放置"></h2>
    <button id="sceneCompositionPlacementsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="新增、复制或移除整份片段放置。共享片段保持原样；演员与组织组的实例身份逐一列出。"></p>
    <p id="sceneCompositionPlacementsMessage" role="status" aria-live="polite"></p>
    <div class="scene-settings"><label class="scene-field"><span data-i18n="选择共享片段"></span><select id="sceneCompositionPlacementsFragment"></select></label>
      <label class="scene-field"><span data-i18n="选择现有放置"></span><select id="sceneCompositionPlacementsPlacement"></select></label></div>
    <p id="sceneCompositionPlacementsIdentity" class="build-hint"></p>
    <div class="build-actions"><button id="sceneCompositionPlacementsAdd" type="button" class="doc-btn" data-i18n="新增放置"></button>
      <button id="sceneCompositionPlacementsCopy" type="button" class="doc-btn" data-i18n="复制放置"></button>
      <button id="sceneCompositionPlacementsRemove" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除放置"></button></div>
    <p id="sceneCompositionPlacementsRemoveHint" class="build-hint"></p>
    <fieldset id="sceneCompositionPlacementsFields" class="scene-actor" hidden><legend data-i18n="新增放置偏移"></legend>
      <label class="scene-composition-structure-inherited"><input id="sceneCompositionPlacementsOffsetEnabled" type="checkbox"><span data-i18n="显式声明整组偏移"></span></label>
      <div class="scene-settings"><label class="scene-field"><span data-i18n="偏移 X"></span><input id="sceneCompositionPlacementsX" type="number" min="-100000" max="100000" step="any"></label>
        <label class="scene-field"><span data-i18n="偏移 Y"></span><input id="sceneCompositionPlacementsY" type="number" min="-100000" max="100000" step="any"></label></div>
      <p class="build-hint" data-i18n="未勾选时不写偏移声明；显式零偏移与缺省声明分开保留。偏移加在各演员局部位置之后，组织组只用于组织。"></p>
    </fieldset>
    <section aria-labelledby="sceneCompositionPlacementsImpactTitle"><h3 id="sceneCompositionPlacementsImpactTitle" data-i18n="放置结构影响"></h3>
      <p id="sceneCompositionPlacementsImpact" class="build-hint"></p><ul id="sceneCompositionPlacementsTargets" class="scene-composition-placements-targets"></ul></section>
    <p class="build-hint" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <details id="sceneCompositionPlacementsReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionPlacementsSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionPlacementsDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionPlacementsError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionPlacementsDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionPlacementsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查放置结构修改"></button>
      <button id="sceneCompositionPlacementsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionPlacementsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionPlacements${suffix}`);
  const node = (tag, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
  let session = null, mode = '', pending = false, proposal = null, approved = null, rawSignature = '', candidateSignature = '', message = '', details = '', diagnostics = [];
  let openEpoch = 0, formEpoch = 0, disposed = false, opener = null, focusEpoch = 0;
  const fragment = () => session?.draft.fragments.find(item => item.fragmentId === el('Fragment').value);
  const placement = () => session?.draft.placements.find(item => item.placementId === el('Placement').value);
  const changed = () => Boolean(mode);
  const signature = () => JSON.stringify({ mode, fragment: el('Fragment').value, placement: el('Placement').value,
    offsetEnabled: el('OffsetEnabled').checked, x: el('X').value, y: el('Y').value, allocated: session?.allocated || null });
  const current = () => { const context = getContext(); return Boolean(session && !disposed && supportsStudioCoreCompositionPlacements()
    && context.canEditCompositionPlacements === true && context.compositionSourceWritable === true && context.editable && !context.creating && !context.busy
    && context.sceneDraftPath === session.sourcePath && context.sceneDraftToken === session.token && session.isCurrent()); };
  const approvalMatches = () => Boolean(approved && proposal === approved && signature() === rawSignature && JSON.stringify(proposal) === candidateSignature);
  const number = suffix => { const raw = el(suffix).value.trim(), value = Number(raw); if (!raw || !Number.isFinite(value)) throw new TypeError('The offset input is incomplete.'); return value; };
  function edit() {
    if (mode === 'remove') return { action: 'remove', placementId: el('Placement').value };
    if (!session.allocated) throw new TypeError('Select a placement operation.');
    if (mode === 'copy') return { action: 'copy', sourcePlacementId: el('Placement').value, ...copy(session.allocated) };
    if (mode !== 'add' || !fragment()) throw new TypeError('Select an existing fragment.');
    return { action: 'add', fragmentId: fragment().fragmentId, ...copy(session.allocated),
      ...(el('OffsetEnabled').checked ? { offset: [number('X'), number('Y')] } : {}) };
  }
  function invalidate() { formEpoch++; proposal = null; approved = null; details = ''; diagnostics = []; message = '放置结构修改尚未应用到原文草稿。'; }
  function discardOperation() {
    if (changed() && !window.confirm(t('丢弃本次放置结构修改？原文草稿不会改变。'))) return false;
    mode = ''; if (session) session.allocated = null; invalidate(); return true;
  }
  function allocate(part) { return { placementId: crypto.randomUUID(),
    actorIds: Object.fromEntries(part.actors.map(item => [item.key, crypto.randomUUID()])),
    groupIds: Object.fromEntries(part.groups.map(item => [item.key, crypto.randomUUID()])) }; }
  function begin(action) {
    if (pending || !current() || action === 'add' && !fragment() || action !== 'add' && !placement()
      || action === 'remove' && session.draft.placements.length <= 1 || !discardOperation()) return;
    if (action === 'add') {
      session.allocated = allocate(fragment()); el('OffsetEnabled').checked = false; el('X').value = '0'; el('Y').value = '0';
    } else if (action === 'copy') session.allocated = allocate(session.draft.fragments.find(item => item.fragmentId === placement().fragmentId));
    mode = action; invalidate(); refresh();
  }
  function renderTargets() {
    const list = el('Targets'); list.replaceChildren();
    if (!mode) { el('Impact').textContent = t('选择一项放置操作后，审阅完整身份、组织组与覆盖影响。'); return; }
    const original = mode === 'add' ? null : placement(), part = mode === 'add' ? fragment() : session.draft.fragments.find(item => item.fragmentId === original?.fragmentId);
    if (!part) return;
    const maps = mode === 'remove' ? original : session.allocated;
    const targets = proposal ? [proposal.targets] : [{ placementId: maps.placementId, fragmentId: part.fragmentId,
      actors: part.actors.map(item => ({ actorKey: item.key, instanceId: maps.actorIds[item.key], objectId: item.objectId })),
      groups: part.groups.map(item => ({ groupKey: item.key, groupId: maps.groupIds[item.key] })),
      overrides: (original?.overrides || []).map(item => ({ actorKey: item.actorKey, fields: Object.keys(item.values) })) }];
    el('Impact').textContent = t(mode === 'add' ? '新增放置使用全新身份，不包含局部覆盖；共享声明保持。'
      : mode === 'copy' ? '复制使用全新身份，原样保留来源放置的偏移与局部覆盖声明。'
      : '移除此放置及其全部实例、组映射与局部覆盖；共享片段和其他放置保持。');
    for (const target of targets) {
      const row = node('li'); row.dataset.placementId = target.placementId; row.dataset.fragmentId = target.fragmentId;
      row.append(node('p', `${t('放置')} · ${target.placementId}`), node('p', `${t('共享片段')} · ${target.fragmentId}`));
      if (mode === 'copy') row.append(node('p', `${t('来源放置')} · ${original.placementId}`));
      const offset = mode === 'add' ? el('OffsetEnabled').checked ? `${el('X').value}, ${el('Y').value}` : null : original.offset;
      row.append(node('p', offset == null ? t('偏移声明：缺省（有效偏移 0, 0）') : t('偏移声明：{0}', Array.isArray(offset) ? offset.join(', ') : offset)));
      for (const actor of target.actors) { const line = node('p', `${t(mode === 'remove' ? '移除实例身份' : '新增实例身份')} · ${actor.actorKey} · ${actor.instanceId} · ${actor.objectId}`);
        line.dataset.instanceId = actor.instanceId; line.dataset.actorKey = actor.actorKey; row.append(line); }
      for (const group of target.groups) { const line = node('p', `${t('组织组身份')} · ${group.groupKey} · ${group.groupId}`); line.dataset.groupId = group.groupId; line.dataset.groupKey = group.groupKey; row.append(line); }
      for (const override of target.overrides) row.append(node('p', t('局部覆盖：{0} · {1}', override.actorKey, override.fields.join(' · '))));
      if (!target.overrides.length) row.append(node('p', t('此放置没有局部覆盖。'))); list.append(row);
    }
  }
  function refresh() {
    translatePage(dialog); const valid = current();
    if (proposal && (signature() !== rawSignature || JSON.stringify(proposal) !== candidateSignature)) { proposal = null; approved = null; message = '放置结构修改尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后管理片段放置。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    for (const suffix of ['Fragment', 'Placement', 'OffsetEnabled', 'X', 'Y']) el(suffix).disabled = pending || !valid
      || ['X', 'Y'].includes(suffix) && !el('OffsetEnabled').checked;
    el('Add').disabled = pending || !valid || !fragment(); el('Copy').disabled = pending || !valid || !placement();
    el('Remove').disabled = pending || !valid || !placement() || session?.draft.placements.length <= 1;
    el('Check').disabled = pending || !valid || !mode; el('Apply').disabled = pending || !valid || !approvalMatches();
    el('Close').disabled = pending; el('Cancel').disabled = pending; el('Fields').hidden = mode !== 'add';
    el('RemoveHint').textContent = session?.draft.placements.length <= 1 ? t('配方必须保留至少一个放置。') : '';
    el('Identity').textContent = session ? t('共享片段：{0}；当前放置数量：{1}', el('Fragment').value, session.draft.placements.length) : '';
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details; el('Diagnostics').replaceChildren();
    for (const issue of diagnostics) el('Diagnostics').append(node('li', `${issue.code || ''} ${issue.propertyPath || ''}`)); renderTargets();
  }
  function reset() { openEpoch++; formEpoch++; session = null; mode = ''; pending = false; proposal = null; approved = null; details = ''; diagnostics = []; dialog.dataset.dirty = 'false'; }
  function close() { if (pending || !discardOperation()) return false; reset(); dialog.close(); return true; }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_placements_conflict' || code === 'scene_composition_override_conflict' ? '原文或预览已变化，请重新预览后管理片段放置。'
      : code === 'scene_composition_placements_content_limit' ? '修改后的配方超过 128 KiB；请缩减原文后重试。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !changed()) { refresh(); return; }
    approved = null; proposal = null; details = ''; diagnostics = [];
    const owner = session, epoch = formEpoch, raw = signature();
    try { proposal = copy(owner.draft.propose(edit())); rawSignature = raw; candidateSignature = JSON.stringify(proposal); }
    catch (error) { report(error, '放置结构修改有误，请检查身份、偏移和数量限制后重试。'); refresh(); return; }
    const candidate = proposal, candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try { const result = await validateDraft(copy(candidate), { isCurrent: unchanged }); if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('The candidate validation was not confirmed.'), { payload: result });
      approved = candidate; message = '放置结构已检查，请确认完整身份与原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后管理片段放置。'; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, raw = signature(), candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在应用放置结构到原文草稿…'; refresh();
    try { const result = await applySourceDraft(copy(candidate), { isCurrent: unchanged }); if (!owns()) return;
      if (result?.applied !== true) throw new Error('The source draft application was not confirmed.');
      await sourceApplied(result, copy(candidate)); if (!owns()) return; reset(); dialog.close();
    } catch (error) { if (owns()) report(error, '放置结构修改未应用。修改保留，请检查后重试。'); }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const suffix of ['OffsetEnabled', 'X', 'Y']) el(suffix).addEventListener(suffix === 'OffsetEnabled' ? 'change' : 'input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  for (const suffix of ['Fragment', 'Placement']) el(suffix).addEventListener('change', () => {
    if (pending || !current()) return;
    const requested = el(suffix).value, previous = suffix === 'Fragment' ? session.fragmentId : session.placementId; el(suffix).value = previous;
    if (!discardOperation()) { refresh(); return; }
    el(suffix).value = requested;
    if (suffix === 'Placement') { session.placementId = requested; session.fragmentId = placement()?.fragmentId || session.fragmentId; el('Fragment').value = session.fragmentId; }
    else session.fragmentId = requested;
    refresh();
  });
  for (const [suffix, action] of [['Add', 'add'], ['Copy', 'copy'], ['Remove', 'remove']]) el(suffix).addEventListener('click', () => begin(action));
  el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  for (const suffix of ['Close', 'Cancel']) el(suffix).addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (dialog.open) return; const target = opener, epoch = focusEpoch; opener = null; if (session) reset(); queueMicrotask(() => { if (!dialog.open && !disposed && epoch === focusEpoch) target?.focus?.(); }); });
  const unsubscribe = onLanguageChange(refresh);
  function destroy() { if (disposed) return; disposed = true; focusEpoch++; reset(); dialog.close(); unsubscribe?.(); dialog.remove(); }
  return { refresh, close, dispose: destroy, destroy,
    async open({ model, source, actorId = null, isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => { const context = getContext(); return epoch === openEpoch && !disposed && !dialog.open && supportsStudioCoreCompositionPlacements()
        && context.canEditCompositionPlacements === true && context.compositionSourceWritable === true && context.editable && !context.creating && !context.busy
        && context.sceneDraftToken === token && context.sceneDraftPath === source?.sourcePath && isCurrent(); };
      if (!eligible()) return false;
      try {
        const selected = model?.sourceLocations?.actors?.find(item => item.instanceId === actorId)?.composition?.placementId;
        const draft = await createSceneCompositionPlacementsDraft(model, source, { digest }); if (!eligible()) return false;
        const chosen = draft.placements.find(item => item.placementId === selected) || draft.placements[0];
        session = { draft, token, sourcePath: source.sourcePath, isCurrent, allocated: null,
          placementId: chosen?.placementId || '', fragmentId: chosen?.fragmentId || draft.fragments[0]?.fragmentId || '' };
        for (const [suffix, collection, key] of [['Fragment', draft.fragments, 'fragmentId'], ['Placement', draft.placements, 'placementId']]) {
          el(suffix).replaceChildren(); for (const item of collection) { const option = node('option', suffix === 'Placement' ? `${item.placementId} · ${item.fragmentId}` : item.fragmentId); option.value = item[key]; el(suffix).append(option); }
        }
        el('Fragment').value = session.fragmentId; el('Placement').value = session.placementId;
        el('OffsetEnabled').checked = false; el('X').value = '0'; el('Y').value = '0';
        mode = ''; proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '选择片段或现有放置后操作；一次审阅一项放置结构修改。'; opener = document.activeElement; focusEpoch++;
        refresh(); dialog.showModal(); el('Fragment').focus(); return true;
      } catch (error) { if (!eligible()) return false; report(error, '放置结构编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false; }
    },
  };
}
