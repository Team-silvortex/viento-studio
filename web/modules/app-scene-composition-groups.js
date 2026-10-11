import { createSceneCompositionGroupsDraft } from '../../engine/scene-composition-groups.mjs';
import { supportsStudioCoreCompositionGroups } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const copy = value => JSON.parse(JSON.stringify(value));
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

// This form owns one organizational edit. Raw declarations, stable identities
// and source changes are checked by the independent engine contract.
export function setupSceneCompositionGroups({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionGroupsDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionGroupsTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionGroupsTitle" data-i18n="编辑组织分组"></h2>
    <button id="sceneCompositionGroupsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="组织分组作用于共享片段的全部放置，只整理成员与层级，不改变坐标、绘制顺序或空间变换。"></p>
    <p id="sceneCompositionGroupsMessage" role="status" aria-live="polite"></p>
    <div class="scene-settings"><label class="scene-field"><span data-i18n="选择共享片段"></span><select id="sceneCompositionGroupsFragment"></select></label>
      <label class="scene-field"><span data-i18n="选择组织组"></span><select id="sceneCompositionGroupsGroup"></select></label>
      <label class="scene-field"><span data-i18n="片段现有演员"></span><select id="sceneCompositionGroupsActor"></select></label></div>
    <p id="sceneCompositionGroupsIdentity" class="build-hint"></p>
    <div class="build-actions"><button id="sceneCompositionGroupsAdd" type="button" class="doc-btn" data-i18n="新增组织组"></button>
      <button id="sceneCompositionGroupsEdit" type="button" class="doc-btn" data-i18n="修改组名称与父组"></button>
      <button id="sceneCompositionGroupsAssign" type="button" class="doc-btn" data-i18n="调整演员归组"></button>
      <button id="sceneCompositionGroupsRemove" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除空叶组"></button></div>
    <p id="sceneCompositionGroupsRemoveHint" class="build-hint"></p>
    <fieldset id="sceneCompositionGroupsFields" class="scene-actor" hidden><legend data-i18n="组织组声明"></legend>
      <div class="scene-settings"><label class="scene-field"><span data-i18n="局部标识"></span><input id="sceneCompositionGroupsKey" type="text" maxlength="64" spellcheck="false"></label>
        <label class="scene-field"><span data-i18n="组名称"></span><input id="sceneCompositionGroupsName" type="text" maxlength="160"></label>
        <label class="scene-field"><span data-i18n="父组织组"></span><select id="sceneCompositionGroupsParent"></select></label></div>
      <p class="build-hint" data-i18n="现有组的局部标识固定；根组不声明父组。名称保留输入原字串。"></p>
    </fieldset>
    <fieldset id="sceneCompositionGroupsMembership" class="scene-actor" hidden><legend data-i18n="演员组织归属"></legend>
      <label class="scene-field"><span data-i18n="所属组织组"></span><select id="sceneCompositionGroupsAssignment"></select></label>
      <p class="build-hint" data-i18n="取消归组只删除共享演员的组声明；各放置仍保留同一演员身份。"></p>
    </fieldset>
    <section><h3 data-i18n="原文中的组织结构"></h3><ul id="sceneCompositionGroupsBefore" class="scene-composition-groups-targets"></ul></section>
    <section><h3 data-i18n="全部放置的组织影响"></h3><p id="sceneCompositionGroupsImpact" class="build-hint"></p>
      <ul id="sceneCompositionGroupsTargets" class="scene-composition-groups-targets"></ul></section>
    <p class="build-hint" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <details id="sceneCompositionGroupsReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionGroupsSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionGroupsDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionGroupsError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionGroupsDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionGroupsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查组织分组修改"></button>
      <button id="sceneCompositionGroupsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionGroupsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionGroups${suffix}`);
  const node = (tag, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
  let session = null, mode = '', pending = false, proposal = null, approved = null, rawSignature = '', candidateSignature = '', message = '', details = '', diagnostics = [];
  let openEpoch = 0, formEpoch = 0, disposed = false, opener = null, focusEpoch = 0;
  const fragment = () => session?.draft.fragments.find(item => item.fragmentId === el('Fragment').value);
  const group = () => fragment()?.groups.find(item => item.key === el('Group').value);
  const actor = () => fragment()?.actors.find(item => item.key === el('Actor').value);
  const emptyLeaf = () => Boolean(group() && !fragment().actors.some(item => item.groupKey === group().key)
    && !fragment().groups.some(item => item.parentKey === group().key));
  const signature = () => JSON.stringify({ mode, fragment: el('Fragment').value, group: el('Group').value, actor: el('Actor').value,
    key: el('Key').value, name: el('Name').value, parent: el('Parent').value, assignment: el('Assignment').value, instances: session?.instances || [] });
  const current = () => { const c = getContext(); return Boolean(session && !disposed && supportsStudioCoreCompositionGroups()
    && c.canEditCompositionGroups === true && c.compositionSourceWritable === true && c.editable && !c.creating && !c.busy
    && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent()); };
  const approvalMatches = () => Boolean(approved && proposal === approved && signature() === rawSignature && JSON.stringify(proposal) === candidateSignature);
  function edit() {
    const part = fragment(); if (!part) throw new TypeError('Select an existing fragment.');
    if (mode === 'remove') return { action: mode, fragmentId: part.fragmentId, groupKey: el('Group').value };
    if (mode === 'assign') return { action: mode, fragmentId: part.fragmentId, actorKey: el('Actor').value, groupKey: el('Assignment').value || null };
    if (mode === 'edit') return { action: mode, fragmentId: part.fragmentId, groupKey: el('Group').value, name: el('Name').value, parentKey: el('Parent').value || null };
    if (mode !== 'add') throw new TypeError('Select an organizational operation.');
    return { action: mode, fragmentId: part.fragmentId, group: { key: el('Key').value.trim(), name: el('Name').value,
      ...(el('Parent').value ? { parentKey: el('Parent').value } : {}) }, instances: copy(session.instances) };
  }
  function invalidate() { formEpoch++; proposal = null; approved = null; details = ''; diagnostics = []; message = '组织分组修改尚未应用到原文草稿。'; }
  function fillChoices() {
    const part = fragment(), oldGroup = el('Group').value, oldActor = el('Actor').value;
    for (const suffix of ['Group', 'Actor', 'Parent', 'Assignment']) el(suffix).replaceChildren();
    for (const [suffix, label] of [['Parent', '根组织组'], ['Assignment', '取消归组']]) {
      const root = node('option', t(label)); root.value = ''; root.dataset.i18n = label; el(suffix).append(root);
    }
    for (const item of part?.groups || []) for (const suffix of ['Group', 'Parent', 'Assignment']) {
      const option = node('option', `${item.name} · ${item.key}`); option.value = item.key; el(suffix).append(option);
    }
    for (const item of part?.actors || []) { const option = node('option', item.key); option.value = item.key; el('Actor').append(option); }
    el('Group').value = part?.groups.some(item => item.key === oldGroup) ? oldGroup : part?.groups[0]?.key || '';
    el('Actor').value = part?.actors.some(item => item.key === oldActor) ? oldActor : part?.actors[0]?.key || '';
    el('Parent').value = ''; el('Assignment').value = actor()?.groupKey || '';
  }
  function discardOperation() {
    if (mode && !window.confirm(t('丢弃本次组织分组修改？原文草稿不会改变。'))) return false;
    mode = ''; if (session) session.instances = []; invalidate(); return true;
  }
  function begin(action) {
    if (pending || !current() || !fragment() || ['edit', 'remove'].includes(action) && !group()
      || action === 'assign' && !actor() || action === 'remove' && !emptyLeaf() || !discardOperation()) return;
    mode = action;
    if (action === 'add') {
      session.instances = fragment().placements.map(item => ({ placementId: item.placementId, groupId: crypto.randomUUID() }));
      const taken = new Set(fragment().groups.map(item => item.key)); let index = 1; while (taken.has(`group${index}`)) index++;
      el('Key').value = `group${index}`; el('Name').value = t('新组织组'); el('Parent').value = '';
    } else if (action === 'edit') { el('Key').value = group().key; el('Name').value = group().name; el('Parent').value = group().parentKey || ''; }
    else if (action === 'assign') el('Assignment').value = actor().groupKey || '';
    invalidate(); refresh(); if (['add', 'edit'].includes(action)) el(action === 'add' ? 'Key' : 'Name').focus();
  }
  function renderBefore() {
    const list = el('Before'); list.replaceChildren(); const part = fragment(); if (!part) return;
    for (const item of part.groups) { const row = node('li', t('组：{0} · {1}；父组：{2}', item.name, item.key, item.parentKey || t('根组织组'))); row.dataset.groupKey = item.key; list.append(row); }
    for (const item of part.actors) { const row = node('li', t('演员：{0}；所属组：{1}', item.key, item.groupKey || t('未归组'))); row.dataset.actorKey = item.key; list.append(row); }
  }
  function renderTargets() {
    const list = el('Targets'); list.replaceChildren(); const part = fragment();
    if (!part || !mode) { el('Impact').textContent = t('选择一项组织操作，再检查全部放置的原有与候选归属。'); return; }
    if (!part.placements.length) { el('Impact').textContent = t('此片段尚未放置；只修改共享声明，不生成场景实例。'); return; }
    el('Impact').textContent = t(proposal ? '已检查 {0} 个放置；下方列出全部组与演员的原有及候选归属。' : '检查后列出 {0} 个放置的完整组织影响；已有身份不变。', part.placements.length);
    if (!proposal) { for (const item of session.instances) { const row = node('li', `${t('放置')} · ${item.placementId} · ${t('新增组织组身份')} · ${item.groupId}`);
      row.dataset.placementId = item.placementId; row.dataset.groupId = item.groupId; list.append(row); } return; }
    for (const target of proposal.targets) {
      const original = part.placements.find(item => item.placementId === target.placementId), row = node('li'); row.dataset.placementId = target.placementId; row.dataset.fragmentId = target.fragmentId;
      row.append(node('p', `${t('放置')} · ${target.placementId}`));
      for (const item of target.groups) {
        const before = part.groups.find(group => group.key === item.groupKey), parentId = before?.parentKey ? original.groupIds[before.parentKey] : null;
        const line = node('p', t('组：{0} · {1} · {2}；父身份：{3} → {4}', item.name, item.groupKey, item.groupId, parentId || t('根组织组'), item.parentGroupId || t('根组织组')));
        line.dataset.groupKey = item.groupKey; line.dataset.groupId = item.groupId; line.dataset.beforeParentGroupId = parentId || ''; line.dataset.parentGroupId = item.parentGroupId || ''; row.append(line);
        if (before && before.name !== item.name) row.append(node('p', t('名称：{0} → {1}', before.name, item.name)));
      }
      for (const removed of part.groups.filter(item => !target.groups.some(group => group.groupKey === item.key))) {
        const line = node('p', t('移除组织组身份：{0} · {1}', removed.key, original.groupIds[removed.key])); line.dataset.removedGroupId = original.groupIds[removed.key]; row.append(line);
      }
      for (const item of target.actors) {
        const before = part.actors.find(actor => actor.key === item.actorKey), groupId = before.groupKey ? original.groupIds[before.groupKey] : null;
        const line = node('p', t('演员：{0} · {1}；组身份：{2} → {3}', item.actorKey, item.instanceId, groupId || t('未归组'), item.groupId || t('未归组')));
        line.dataset.actorKey = item.actorKey; line.dataset.instanceId = item.instanceId; line.dataset.beforeGroupId = groupId || ''; line.dataset.groupId = item.groupId || ''; row.append(line);
      }
      list.append(row);
    }
  }
  function refresh() {
    translatePage(dialog); const valid = current();
    if (proposal && (signature() !== rawSignature || JSON.stringify(proposal) !== candidateSignature)) { proposal = null; approved = null; message = '组织分组修改尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后编辑组织分组。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(Boolean(mode));
    for (const suffix of ['Fragment', 'Group', 'Actor', 'Key', 'Name', 'Parent', 'Assignment']) el(suffix).disabled = pending || !valid || suffix === 'Key' && mode !== 'add';
    for (const suffix of ['Add', 'Edit', 'Assign', 'Remove']) el(suffix).disabled = pending || !valid || !fragment()
      || suffix === 'Edit' && !group() || suffix === 'Assign' && !actor() || suffix === 'Remove' && !emptyLeaf();
    el('Check').disabled = pending || !valid || !mode; el('Apply').disabled = pending || !valid || !approvalMatches();
    el('Close').disabled = pending; el('Cancel').disabled = pending; el('Fields').hidden = !['add', 'edit'].includes(mode); el('Membership').hidden = mode !== 'assign';
    el('RemoveHint').textContent = group() && !emptyLeaf() ? t('只可删除无直接演员和直接子组的空叶组；请先移动成员或子组。不会自动提升层级。') : '';
    el('Identity').textContent = fragment() ? t('片段：{0}；组织组：{1}；放置：{2}', fragment().fragmentId, fragment().groups.length, fragment().placements.length) : '';
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details; el('Diagnostics').replaceChildren();
    for (const issue of diagnostics) el('Diagnostics').append(node('li', `${issue.code || ''} ${issue.propertyPath || ''}`)); renderBefore(); renderTargets();
  }
  function reset() { openEpoch++; formEpoch++; session = null; mode = ''; pending = false; proposal = null; approved = null; details = ''; diagnostics = []; dialog.dataset.dirty = 'false'; }
  function close() { if (pending || !discardOperation()) return false; reset(); dialog.close(); return true; }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_groups_conflict' || code === 'scene_composition_override_conflict' ? '原文或预览已变化，请重新预览后编辑组织分组。'
      : code === 'scene_composition_groups_content_limit' ? '修改后的配方超过 128 KiB；请缩减原文后重试。'
      : code === 'scene_composition_groups_unchanged' ? '组织声明没有变化；请调整名称、父组或演员归属后检查。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !mode) { refresh(); return; }
    approved = null; proposal = null; details = ''; diagnostics = [];
    const owner = session, epoch = formEpoch, raw = signature();
    try { proposal = copy(owner.draft.propose(edit())); rawSignature = raw; candidateSignature = JSON.stringify(proposal); }
    catch (error) { report(error, '组织分组修改有误，请检查名称、父组、循环与数量限制后重试。'); refresh(); return; }
    const candidate = proposal, candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try { const result = await validateDraft(copy(candidate), { isCurrent: unchanged }); if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('The candidate validation was not confirmed.'), { payload: result });
      approved = candidate; message = '组织分组已检查，请确认全部放置归属与完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后编辑组织分组。'; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, raw = signature(), candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在应用组织分组到原文草稿…'; refresh();
    try { const result = await applySourceDraft(copy(candidate), { isCurrent: unchanged }); if (!owns()) return;
      if (result?.applied !== true) throw new Error('The source draft application was not confirmed.');
      await sourceApplied(result, copy(candidate)); if (!owns()) return; reset(); dialog.close();
    } catch (error) { if (owns()) report(error, '组织分组修改未应用。修改保留，请检查后重试。'); }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const suffix of ['Key', 'Name', 'Parent', 'Assignment']) el(suffix).addEventListener(['Parent', 'Assignment'].includes(suffix) ? 'change' : 'input', () => { if (!pending && current()) { invalidate(); refresh(); } });
  for (const suffix of ['Fragment', 'Group', 'Actor']) el(suffix).addEventListener('change', () => {
    if (pending || !current()) return;
    const requested = el(suffix).value, previous = session[suffix.toLowerCase()]; el(suffix).value = previous;
    if (!discardOperation()) { refresh(); return; } el(suffix).value = requested;
    if (suffix === 'Fragment') fillChoices();
    session.fragment = el('Fragment').value; session.group = el('Group').value; session.actor = el('Actor').value; refresh();
  });
  for (const [suffix, action] of [['Add', 'add'], ['Edit', 'edit'], ['Assign', 'assign'], ['Remove', 'remove']]) el(suffix).addEventListener('click', () => begin(action));
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
      const eligible = () => { const c = getContext(); return epoch === openEpoch && !disposed && !dialog.open && supportsStudioCoreCompositionGroups()
        && c.canEditCompositionGroups === true && c.compositionSourceWritable === true && c.editable && !c.creating && !c.busy
        && c.sceneDraftToken === token && c.sceneDraftPath === source?.sourcePath && isCurrent(); };
      if (!eligible()) return false;
      try {
        const selected = model?.sourceLocations?.actors?.find(item => item.instanceId === actorId)?.composition;
        const draft = await createSceneCompositionGroupsDraft(model, source, { digest }); if (!eligible()) return false;
        const chosen = draft.fragments.find(item => item.fragmentId === selected?.fragmentId) || draft.fragments[0];
        session = { draft, token, sourcePath: source.sourcePath, isCurrent, instances: [], fragment: chosen?.fragmentId || '', group: '', actor: selected?.localKey || '' };
        el('Fragment').replaceChildren(); for (const part of draft.fragments) { const option = node('option', part.fragmentId); option.value = part.fragmentId; el('Fragment').append(option); }
        el('Fragment').value = session.fragment; fillChoices();
        if (chosen?.actors.some(item => item.key === selected?.localKey)) el('Actor').value = selected.localKey;
        session.group = el('Group').value; session.actor = el('Actor').value;
        el('Key').value = ''; el('Name').value = ''; mode = ''; proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '选择片段、组织组或演员后操作；一次审阅一项组织修改。'; opener = document.activeElement; focusEpoch++;
        refresh(); dialog.showModal(); el('Fragment').focus(); return true;
      } catch (error) { if (!eligible()) return false; report(error, '组织分组编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false; }
    },
  };
}
