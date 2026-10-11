import { createSceneCompositionDefinitionsDraft } from '../../engine/scene-composition-definitions.mjs';
import { supportsStudioCoreCompositionDefinitions, supportsStudioCoreCompositionDefinitionRename } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const copy = value => JSON.parse(JSON.stringify(value));
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fields = ['FragmentId', 'Key', 'Object', 'X', 'Y', 'Width', 'Height', 'Color', 'Speed', 'Controls', 'Image'];
const noImage = '__none__';

// Definitions are author declarations. This independent form never allocates
// instance identities or adds placements; the core owns every source mutation.
export function setupSceneCompositionDefinitions({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionDefinitionsDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionDefinitionsTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionDefinitionsTitle" data-i18n="管理片段定义"></h2>
    <button id="sceneCompositionDefinitionsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="新增、复制、重命名或移除共享片段定义，不创建放置或实例身份。重命名同步更新现有放置引用，演员和组织组身份保持。"></p>
    <p id="sceneCompositionDefinitionsMessage" role="status" aria-live="polite"></p>
    <label class="scene-field"><span data-i18n="选择共享片段"></span><select id="sceneCompositionDefinitionsFragment"></select></label>
    <p id="sceneCompositionDefinitionsIdentity" class="build-hint"></p>
    <div class="build-actions"><button id="sceneCompositionDefinitionsAdd" type="button" class="doc-btn" data-i18n="新增片段定义"></button>
      <button id="sceneCompositionDefinitionsCopy" type="button" class="doc-btn" data-i18n="复制片段定义"></button>
      <button id="sceneCompositionDefinitionsRename" type="button" class="doc-btn" data-i18n="重命名片段定义"></button>
      <button id="sceneCompositionDefinitionsRemove" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除片段定义"></button></div>
    <p id="sceneCompositionDefinitionsRenameHint" class="build-hint"></p>
    <p id="sceneCompositionDefinitionsRemoveHint" class="build-hint"></p><ul id="sceneCompositionDefinitionsBlockers" class="scene-composition-definitions-targets"></ul>
    <fieldset id="sceneCompositionDefinitionsFields" class="scene-actor" hidden><legend id="sceneCompositionDefinitionsFieldTitle"></legend>
      <label class="scene-field"><span data-i18n="片段标识"></span><input id="sceneCompositionDefinitionsFragmentId" type="text" maxlength="64" spellcheck="false"></label>
      <p id="sceneCompositionDefinitionsOperationHint" class="build-hint"></p>
      <fieldset id="sceneCompositionDefinitionsActorFields"><legend data-i18n="初始演员声明"></legend>
        <div class="scene-settings"><label class="scene-field"><span data-i18n="局部标识"></span><input id="sceneCompositionDefinitionsKey" type="text" maxlength="64" spellcheck="false"></label>
          <label class="scene-field"><span data-i18n="关联对象"></span><select id="sceneCompositionDefinitionsObject"></select></label>
          <label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneCompositionDefinitionsX" type="number" min="-100000" max="100000" step="any"></label>
          <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneCompositionDefinitionsY" type="number" min="-100000" max="100000" step="any"></label>
          <label class="scene-composition-structure-inherited"><input id="sceneCompositionDefinitionsInherited" type="checkbox"><span data-i18n="继承关联游戏投影的默认值"></span></label>
          <label class="scene-field"><span data-i18n="宽度"></span><input id="sceneCompositionDefinitionsWidth" type="number" min="1" max="2048" step="any"></label>
          <label class="scene-field"><span data-i18n="高度"></span><input id="sceneCompositionDefinitionsHeight" type="number" min="1" max="2048" step="any"></label>
          <label class="scene-field"><span data-i18n="颜色"></span><input id="sceneCompositionDefinitionsColor" type="text" spellcheck="false"></label>
          <label class="scene-field"><span data-i18n="速度"></span><input id="sceneCompositionDefinitionsSpeed" type="number" min="0" max="2000" step="any"></label>
          <label class="scene-field"><span data-i18n="控制"></span><select id="sceneCompositionDefinitionsControls"><option value="arrows" data-i18n="方向键"></option><option value="none" data-i18n="不接受输入"></option></select></label>
          <label class="scene-field"><span data-i18n="场景图片"></span><select id="sceneCompositionDefinitionsImage"></select></label></div>
        <p id="sceneCompositionDefinitionsDefaults" class="build-hint"></p>
      </fieldset>
    </fieldset>
    <details class="build-raw"><summary data-i18n="当前片段原始声明"></summary><pre id="sceneCompositionDefinitionsBefore" tabindex="0"></pre></details>
    <section aria-labelledby="sceneCompositionDefinitionsImpactTitle"><h3 id="sceneCompositionDefinitionsImpactTitle" data-i18n="片段定义影响"></h3>
      <p id="sceneCompositionDefinitionsImpact" class="build-hint"></p><ul id="sceneCompositionDefinitionsTargets" class="scene-composition-definitions-targets"></ul></section>
    <p class="build-hint" data-i18n="首次放置时检查有效投影和图片内容；本次仅检查声明与已登记依赖，不保证未放置片段的渲染结果。"></p>
    <p class="build-hint" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <details id="sceneCompositionDefinitionsReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionDefinitionsSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionDefinitionsDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionDefinitionsError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionDefinitionsDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionDefinitionsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查片段定义修改"></button>
      <button id="sceneCompositionDefinitionsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionDefinitionsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionDefinitions${suffix}`);
  const node = (tag, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
  let session = null, mode = '', pending = false, proposal = null, approved = null, rawSignature = '', candidateSignature = '', message = '', details = '', diagnostics = [];
  let openEpoch = 0, formEpoch = 0, disposed = false, opener = null, focusEpoch = 0;
  const fragment = () => session?.draft.fragments.find(item => item.fragmentId === el('Fragment').value);
  const object = () => session?.objects.find(item => item.id === el('Object').value);
  const changed = () => Boolean(mode);
  const renameSupported = () => typeof supportsStudioCoreCompositionDefinitionRename === 'function' && supportsStudioCoreCompositionDefinitionRename();
  const signature = () => JSON.stringify({ mode, fragment: el('Fragment').value, fields: fields.map(field => el(field).value), inherited: el('Inherited').checked });
  const sourceCurrent = () => { const context = getContext(); return Boolean(session && !disposed && supportsStudioCoreCompositionDefinitions()
    && context.canEditCompositionDefinitions === true && context.compositionSourceWritable === true && context.editable && !context.creating && !context.busy
    && context.sceneDraftPath === session.sourcePath && context.sceneDraftToken === session.token && session.isCurrent()); };
  const current = () => sourceCurrent() && (mode !== 'rename' || renameSupported());
  const approvalMatches = () => Boolean(approved && proposal === approved && signature() === rawSignature && JSON.stringify(proposal) === candidateSignature);
  const removable = () => Boolean(fragment() && !fragment().placements.length && session.draft.fragments.length > 1);
  const number = suffix => { const raw = el(suffix).value.trim(), value = Number(raw); if (!raw || !Number.isFinite(value)) throw new TypeError('A numeric field is incomplete.'); return value; };
  function edit() {
    if (mode === 'remove') return { action: 'remove', fragmentId: el('Fragment').value };
    const fragmentId = el('FragmentId').value.trim();
    if (mode === 'rename') return { action: 'rename', fragmentId: el('Fragment').value, newFragmentId: fragmentId };
    if (mode === 'copy') return { action: 'copy', sourceFragmentId: el('Fragment').value, fragmentId };
    if (mode !== 'add' || !object()) throw new TypeError('Select a registered definition.');
    const actor = { key: el('Key').value.trim(), objectId: el('Object').value, position: [number('X'), number('Y')] };
    if (el('Inherited').checked) {
      if (!object()?.projectionDefaults) throw new TypeError('The selected definition has no compatible game projection.');
      actor.useProjectionDefaults = true;
    } else Object.assign(actor, { size: [number('Width'), number('Height')], color: el('Color').value.trim(), speed: number('Speed'), controls: el('Controls').value });
    const image = el('Image').value;
    if (image === noImage) { if (!el('Inherited').checked) throw new TypeError('Explicit no-image requires projection inheritance.'); actor.imageResourceId = null; }
    else if (image) actor.imageResourceId = image;
    return { action: 'add', fragment: { fragmentId, actors: [actor], groups: [] } };
  }
  function invalidate() { formEpoch++; proposal = null; approved = null; details = ''; diagnostics = []; message = '片段定义修改尚未应用到原文草稿。'; }
  function discardOperation() {
    if (changed() && !window.confirm(t('丢弃本次片段定义修改？原文草稿不会改变。'))) return false;
    mode = ''; invalidate(); return true;
  }
  function begin(action) {
    if (pending || !sourceCurrent() || action === 'rename' && !renameSupported() || action === 'add' && !session.objects.length || action !== 'add' && !fragment()
      || action === 'remove' && !removable() || !discardOperation()) return;
    mode = action;
    if (action !== 'remove') {
      const taken = new Set(session.draft.fragments.map(item => item.fragmentId)); let index = 1; while (taken.has(`fragment${index}`)) index++;
      el('FragmentId').value = action === 'rename' ? fragment().fragmentId : `fragment${index}`;
    }
    if (action === 'add') {
      el('Key').value = 'actor1'; el('Object').value = session.objects[0].id;
      for (const [suffix, value] of [['X', '200'], ['Y', '220'], ['Width', '80'], ['Height', '80'], ['Color', '#ffffff'], ['Speed', '160'], ['Controls', 'arrows'], ['Image', '']]) el(suffix).value = value;
      el('Inherited').checked = Boolean(object()?.projectionDefaults);
    }
    invalidate(); refresh(); if (action !== 'remove') el('FragmentId').focus();
  }
  function renderTargets() {
    const list = el('Targets'); list.replaceChildren(); const before = fragment();
    if (!mode) { el('Impact').textContent = t('选择新增、复制、重命名或移除后，审阅定义声明及引用影响。'); return; }
    let part = before;
    if (proposal && mode !== 'remove') part = JSON.parse(proposal.afterContent.replace(/^\uFEFF/, '')).fragments.find(item => item.fragmentId === (proposal.edit.fragment?.fragmentId || proposal.edit.newFragmentId || proposal.edit.fragmentId));
    else if (mode === 'add') { try { part = edit().fragment; } catch { part = null; } }
    else if (mode === 'copy') part = { ...before, fragmentId: el('FragmentId').value.trim(), placements: [] };
    else if (mode === 'rename') part = { ...before, fragmentId: el('FragmentId').value.trim() };
    el('Impact').textContent = t(mode === 'add' ? '新增一个未放置片段，包含初始演员且没有组织组；不会生成实例身份。'
      : mode === 'copy' ? '复制完整演员和组织组声明；新片段尚未放置，原片段与所有放置保持。'
      : mode === 'rename' ? '重命名片段并同步全部放置引用；演员、组织组身份、有效字段、偏移和局部覆盖保持。不会生成新身份。'
      : '仅移除此未放置片段声明；定义文档、素材、其他片段和全部放置保持。');
    if (!part) { list.append(node('li', t('初始演员输入尚未完整。'))); return; }
    const row = node('li'); row.dataset.fragmentId = part.fragmentId;
    row.append(node('p', `${t('共享片段')} · ${part.fragmentId}`), node('p', t('演员：{0}；组织组：{1}；相关放置：{2}', part.actors.length, part.groups.length, ['remove', 'rename'].includes(mode) ? before.placements.length : 0)));
    if (mode === 'copy') row.append(node('p', `${t('来源片段')} · ${before.fragmentId}`));
    if (mode === 'rename') {
      row.dataset.previousFragmentId = before.fragmentId;
      row.append(node('p', t('片段标识：{0} → {1}', before.fragmentId, part.fragmentId)));
      const references = node('ul'); references.id = 'sceneCompositionDefinitionsReferences'; references.className = 'scene-composition-definitions-targets';
      for (const placement of before.placements) {
        const reference = node('li'); reference.dataset.placementId = placement.placementId;
        reference.append(node('p', `${t('同步引用的放置')} · ${placement.placementId}`));
        for (const actor of before.actors) { const line = node('p', `${t('演员身份保持')} · ${actor.key} · ${placement.actorIds[actor.key]}`);
          line.dataset.actorKey = actor.key; line.dataset.instanceId = placement.actorIds[actor.key]; reference.append(line); }
        for (const group of before.groups) { const line = node('p', `${t('组织组身份保持')} · ${group.key} · ${placement.groupIds[group.key]}`);
          line.dataset.groupKey = group.key; line.dataset.groupId = placement.groupIds[group.key]; reference.append(line); }
        references.append(reference);
      }
      row.append(references);
    }
    for (const actor of part.actors) {
      const line = node('p', `${t('演员声明')} · ${actor.key} · ${session.objects.find(item => item.id === actor.objectId)?.name || actor.objectId} · ${actor.objectId}`);
      line.dataset.actorKey = actor.key; line.dataset.objectId = actor.objectId; row.append(line);
      if (typeof actor.imageResourceId === 'string') { const image = node('p', `${t('图片引用')} · ${actor.imageResourceId}`); image.dataset.resourceId = actor.imageResourceId; row.append(image); }
    }
    for (const group of part.groups) { const line = node('p', `${t('组织组声明')} · ${group.name} · ${group.key} · ${group.parentKey || t('根组织组')}`); line.dataset.groupKey = group.key; row.append(line); }
    const raw = copy(part); delete raw.placements; row.append(node('pre', JSON.stringify(raw, null, 2))); list.append(row);
  }
  function refresh() {
    translatePage(dialog); const valid = sourceCurrent(), editable = current(), part = fragment();
    if (proposal && (signature() !== rawSignature || JSON.stringify(proposal) !== candidateSignature)) { proposal = null; approved = null; message = '片段定义修改尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后管理片段定义。'; }
    if (session && !pending && valid && !editable) { approved = null; message = '当前核心不支持片段重命名；新增、复制和移除仍可使用。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    for (const suffix of ['Fragment', ...fields]) el(suffix).disabled = pending || !editable;
    for (const suffix of ['Width', 'Height', 'Color', 'Speed', 'Controls']) el(suffix).disabled = pending || !valid || el('Inherited').checked;
    el('Inherited').disabled = pending || !valid || !object()?.projectionDefaults;
    const none = [...el('Image').children].find(option => option.value === noImage); if (none) none.disabled = !el('Inherited').checked;
    el('Add').disabled = pending || !valid || !session?.objects.length; el('Copy').disabled = pending || !valid || !part; el('Remove').disabled = pending || !valid || !removable();
    el('Rename').disabled = pending || !valid || !part || !renameSupported();
    el('RenameHint').textContent = renameSupported() ? '' : t('当前核心不支持片段重命名；新增、复制和移除仍可使用。');
    el('Check').disabled = pending || !editable || !mode; el('Apply').disabled = pending || !editable || !approvalMatches();
    el('Close').disabled = pending; el('Cancel').disabled = pending; el('Fields').hidden = !['add', 'copy', 'rename'].includes(mode); el('ActorFields').hidden = mode !== 'add';
    el('FieldTitle').textContent = t(mode === 'rename' ? '重命名片段定义' : '新片段标识');
    el('OperationHint').textContent = t(mode === 'rename' ? '填写配方内唯一的新标识，区分大小写；全部现有放置引用会同步更新，身份与声明保持。'
      : '片段标识须在配方内唯一；复制只更换此标识，完整保留原演员和组织组声明。');
    el('RemoveHint').textContent = mode === 'rename' ? t('已放置和未放置片段均可重命名；仅移除操作要求没有放置引用。') : part?.placements.length ? t('此片段仍被放置引用，须先移除这些放置：{0}', part.placements.map(item => item.placementId).join(' · '))
      : session?.draft.fragments.length === 1 ? t('配方必须保留至少一个片段定义。') : '';
    el('Blockers').replaceChildren(); for (const placement of part?.placements || []) { const row = node('li', `${t('引用此定义的放置')} · ${placement.placementId}`); row.dataset.placementId = placement.placementId; el('Blockers').append(row); }
    el('Identity').textContent = part ? t('片段：{0}；演员：{1}；放置：{2}', part.fragmentId, part.actors.length, part.placements.length) : '';
    const raw = part && copy(part); if (raw) delete raw.placements; el('Before').textContent = raw ? JSON.stringify(raw, null, 2) : '';
    el('Defaults').textContent = t(el('Inherited').checked ? '尺寸、颜色、速度与控制读取关联游戏投影；留空图片表示继承，明确无图会写入 null。未使用的显式输入保留。' : '新增声明使用显式字段；留空图片表示无图，不会自动继承投影。');
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details; el('Diagnostics').replaceChildren();
    for (const issue of diagnostics) el('Diagnostics').append(node('li', `${issue.code || ''} ${issue.propertyPath || ''}`)); renderTargets();
  }
  function reset() { openEpoch++; formEpoch++; session = null; mode = ''; pending = false; proposal = null; approved = null; details = ''; diagnostics = []; dialog.dataset.dirty = 'false'; }
  function close() { if (pending || !discardOperation()) return false; reset(); dialog.close(); return true; }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_definitions_conflict' || code === 'scene_composition_override_conflict' ? '原文或预览已变化，请重新预览后管理片段定义。'
      : code === 'scene_composition_definitions_content_limit' ? '修改后的配方超过 128 KiB；请缩减原文后重试。'
      : code === 'scene_composition_definitions_unchanged' ? '片段标识未变化；请填写不同的新标识后检查。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !changed()) { refresh(); return; }
    approved = null; proposal = null; details = ''; diagnostics = [];
    const owner = session, epoch = formEpoch, raw = signature();
    try { proposal = copy(owner.draft.propose(edit())); rawSignature = raw; candidateSignature = JSON.stringify(proposal); }
    catch (error) { report(error, '片段定义修改有误，请检查标识、声明和数量限制后重试。'); refresh(); return; }
    const candidate = proposal, candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try { const result = await validateDraft(copy(candidate), { isCurrent: unchanged }); if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('The candidate validation was not confirmed.'), { payload: result });
      approved = candidate; message = '片段定义已检查，请确认声明引用与完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后管理片段定义。'; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, raw = signature(), candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在应用片段定义到原文草稿…'; refresh();
    try { const result = await applySourceDraft(copy(candidate), { isCurrent: unchanged }); if (!owns()) return;
      if (result?.applied !== true) throw new Error('The source draft application was not confirmed.');
      focusEpoch++; opener = null; reset(); dialog.close(); await sourceApplied(result, copy(candidate));
    } catch (error) { if (owns()) report(error, '片段定义修改未应用。修改保留，请检查后重试。'); }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const suffix of fields) el(suffix).addEventListener(['Object', 'Controls', 'Image'].includes(suffix) ? 'change' : 'input', () => {
    if (pending || !current()) return; if (suffix === 'Object') el('Inherited').checked = Boolean(object()?.projectionDefaults); invalidate(); refresh();
  });
  el('Inherited').addEventListener('change', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('Fragment').addEventListener('change', () => {
    if (pending || !current()) return; const requested = el('Fragment').value; el('Fragment').value = session.fragmentId;
    if (!discardOperation()) { refresh(); return; } session.fragmentId = requested; el('Fragment').value = requested; refresh();
  });
  for (const [suffix, action] of [['Add', 'add'], ['Copy', 'copy'], ['Rename', 'rename'], ['Remove', 'remove']]) el(suffix).addEventListener('click', () => begin(action));
  el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  for (const suffix of ['Close', 'Cancel']) el(suffix).addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (dialog.open) return; const target = opener, epoch = focusEpoch; opener = null; if (session) reset(); queueMicrotask(() => { if (!dialog.open && !disposed && epoch === focusEpoch) target?.focus?.(); }); });
  const unsubscribe = onLanguageChange(refresh);
  function destroy() { if (disposed) return; disposed = true; focusEpoch++; reset(); dialog.close(); unsubscribe?.(); dialog.remove(); }
  return { refresh, close, dispose: destroy, destroy,
    async open({ model, source, actorId = null, objects = [], images = [], isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken, sourcePath = source?.sourcePath;
      const eligible = () => { const context = getContext(); return epoch === openEpoch && !disposed && !dialog.open && supportsStudioCoreCompositionDefinitions()
        && context.canEditCompositionDefinitions === true && context.compositionSourceWritable === true && context.editable && !context.creating && !context.busy
        && context.sceneDraftToken === token && context.sceneDraftPath === sourcePath && isCurrent(); };
      if (!eligible()) return false;
      try {
        const options = copy(objects), imageOptions = copy(images), selected = model?.sourceLocations?.actors?.find(item => item.instanceId === actorId)?.composition?.fragmentId;
        const draft = await createSceneCompositionDefinitionsDraft(model, source, { digest }); if (!eligible()) return false;
        session = { draft, objects: options, token, sourcePath, isCurrent,
          fragmentId: draft.fragments.some(item => item.fragmentId === selected) ? selected : draft.fragments[0]?.fragmentId || '' };
        el('Fragment').replaceChildren(); for (const part of draft.fragments) { const option = node('option', part.fragmentId); option.value = part.fragmentId; el('Fragment').append(option); } el('Fragment').value = session.fragmentId;
        el('Object').replaceChildren(); for (const item of options) { const option = node('option', item.sourcePath ? `${item.name || item.id} · ${item.sourcePath}` : item.name || item.id); option.value = item.id; el('Object').append(option); } el('Object').value = options[0]?.id || '';
        el('Image').replaceChildren(); for (const [value, label] of [['', '留空：继承投影或不使用图片'], [noImage, '明确不使用投影图片（null）']]) { const option = node('option', t(label)); option.value = value; option.dataset.i18n = label; el('Image').append(option); }
        for (const item of imageOptions) { const option = node('option', item.path ? `${item.name || item.path} · ${item.path}` : item.name || item.id); option.value = item.id; el('Image').append(option); }
        mode = ''; proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '选择一项片段定义操作；一次审阅一个修改。重命名可同步已放置片段的引用。'; opener = document.activeElement; focusEpoch++;
        refresh(); dialog.showModal(); el('Fragment').focus(); return true;
      } catch (error) { if (!eligible()) return false; report(error, '片段定义管理暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false; }
    },
  };
}
