import { createSceneCompositionStructureDraft } from '../../engine/scene-composition-structure.mjs';
import { supportsStudioCoreCompositionStructure } from '../../engine/studio-core.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

const copy = value => JSON.parse(JSON.stringify(value));
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fields = ['Key', 'Object', 'Group', 'X', 'Y', 'Width', 'Height', 'Color', 'Speed', 'Controls', 'Image'];
const noImage = '__none__';

// All structural changes, identity maps and source patches are validated by the
// pure core. This form owns only a single pending author operation and approval.
export function setupSceneCompositionStructure({ getContext = () => ({}), validateDraft = async () => ({ ok: false }),
  applySourceDraft = async () => ({ applied: false }), sourceApplied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCompositionStructureDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionStructureTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="sceneCompositionStructureTitle" data-i18n="编辑片段结构"></h2>
    <button id="sceneCompositionStructureClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回预览"></button></header>
    <p class="build-note" data-i18n="新增或移除共享演员会作用于该片段的全部放置。实例身份逐一列出，组织组不提供空间变换。"></p>
    <p id="sceneCompositionStructureMessage" role="status" aria-live="polite"></p>
    <div class="scene-settings"><label class="scene-field"><span data-i18n="选择共享片段"></span><select id="sceneCompositionStructureFragment"></select></label>
      <label class="scene-field"><span data-i18n="片段现有演员"></span><select id="sceneCompositionStructureActor"></select></label></div>
    <p id="sceneCompositionStructureIdentity" class="build-hint"></p>
    <div class="build-actions"><button id="sceneCompositionStructureAdd" type="button" class="doc-btn" data-i18n="新增片段演员"></button>
      <button id="sceneCompositionStructureRemove" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除片段演员"></button></div>
    <p id="sceneCompositionStructureRemoveHint" class="build-hint"></p>
    <fieldset id="sceneCompositionStructureFields" class="scene-actor" hidden><legend data-i18n="新增演员声明"></legend>
      <div class="scene-settings"><label class="scene-field"><span data-i18n="局部标识"></span><input id="sceneCompositionStructureKey" type="text" maxlength="64" spellcheck="false"></label>
        <label class="scene-field"><span data-i18n="关联对象"></span><select id="sceneCompositionStructureObject"></select></label>
        <label class="scene-field"><span data-i18n="所属组织组"></span><select id="sceneCompositionStructureGroup"></select></label>
        <label class="scene-field"><span data-i18n="位置 X"></span><input id="sceneCompositionStructureX" type="number" min="-100000" max="100000" step="any"></label>
        <label class="scene-field"><span data-i18n="位置 Y"></span><input id="sceneCompositionStructureY" type="number" min="-100000" max="100000" step="any"></label>
        <label class="scene-composition-structure-inherited"><input id="sceneCompositionStructureInherited" type="checkbox"><span data-i18n="继承关联游戏投影的默认值"></span></label>
        <label class="scene-field"><span data-i18n="宽度"></span><input id="sceneCompositionStructureWidth" type="number" min="1" max="2048" step="any"></label>
        <label class="scene-field"><span data-i18n="高度"></span><input id="sceneCompositionStructureHeight" type="number" min="1" max="2048" step="any"></label>
        <label class="scene-field"><span data-i18n="颜色"></span><input id="sceneCompositionStructureColor" type="text" spellcheck="false"></label>
        <label class="scene-field"><span data-i18n="速度"></span><input id="sceneCompositionStructureSpeed" type="number" min="0" max="2000" step="any"></label>
        <label class="scene-field"><span data-i18n="控制"></span><select id="sceneCompositionStructureControls"><option value="arrows" data-i18n="方向键"></option><option value="none" data-i18n="无内置控制"></option></select></label>
        <label class="scene-field"><span data-i18n="场景图片"></span><select id="sceneCompositionStructureImage"></select></label></div>
      <p id="sceneCompositionStructureDefaults" class="build-hint"></p><p class="build-hint" data-i18n="位置是偏移前的局部坐标；每个放置再加自己的偏移。新增演员追加到片段末尾。"></p>
    </fieldset>
    <section aria-labelledby="sceneCompositionStructureImpactTitle"><h3 id="sceneCompositionStructureImpactTitle" data-i18n="结构修改影响"></h3>
      <p id="sceneCompositionStructureImpact" class="build-hint"></p><ul id="sceneCompositionStructureTargets" class="scene-composition-structure-targets"></ul></section>
    <p class="build-hint" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p>
    <details id="sceneCompositionStructureReview" class="build-raw" hidden><summary data-i18n="将应用到原文草稿的完整内容"></summary><pre id="sceneCompositionStructureSource" tabindex="0"></pre></details>
    <ul id="sceneCompositionStructureDiagnostics" class="scene-diagnostics"></ul>
    <details id="sceneCompositionStructureError" class="build-raw" hidden><summary data-i18n="原始细节与日志"></summary><pre id="sceneCompositionStructureDetails"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCompositionStructureCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查片段结构修改"></button>
      <button id="sceneCompositionStructureApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneCompositionStructureCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#sceneCompositionStructure${suffix}`);
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  let session = null, mode = '', pending = false, proposal = null, approved = null, rawSignature = '', candidateSignature = '', message = '', details = '', diagnostics = [];
  let openEpoch = 0, formEpoch = 0, disposed = false, opener = null, focusEpoch = 0;
  const fragment = () => session?.draft.fragments.find(item => item.fragmentId === el('Fragment').value);
  const actor = () => fragment()?.actors.find(item => item.key === el('Actor').value);
  const object = () => session?.objects.find(item => item.id === el('Object').value);
  const changed = () => Boolean(mode);
  const signature = () => JSON.stringify({ mode, fragment: el('Fragment').value, actor: el('Actor').value,
    fields: fields.map(field => el(field).value), inherited: el('Inherited').checked, instances: session?.instances || [] });
  const current = () => { const c = getContext(); return Boolean(session && !disposed && supportsStudioCoreCompositionStructure()
    && c.canEditCompositionStructure === true && c.compositionSourceWritable === true && c.editable && !c.creating && !c.busy
    && c.sceneDraftPath === session.sourcePath && c.sceneDraftToken === session.token && session.isCurrent()); };
  const approvalMatches = () => Boolean(approved && proposal === approved && signature() === rawSignature && JSON.stringify(proposal) === candidateSignature);
  const number = suffix => { const raw = el(suffix).value.trim(), value = Number(raw); if (!raw || !Number.isFinite(value)) throw new TypeError('A numeric field is incomplete.'); return value; };
  function edit() {
    const part = fragment(); if (!part) throw new TypeError('Select a fragment.');
    if (mode === 'remove') return { action: 'remove', fragmentId: part.fragmentId, actorKey: el('Actor').value };
    if (mode !== 'add') throw new TypeError('Select an operation.');
    if (!object()) throw new TypeError('Select a registered definition.');
    const item = { key: el('Key').value.trim(), objectId: el('Object').value, position: [number('X'), number('Y')] };
    if (el('Group').value) item.groupKey = el('Group').value;
    if (el('Inherited').checked) {
      if (!object()?.projectionDefaults) throw new TypeError('The selected definition has no compatible game projection.');
      item.useProjectionDefaults = true;
    } else Object.assign(item, { size: [number('Width'), number('Height')], color: el('Color').value.trim(), speed: number('Speed'), controls: el('Controls').value });
    const image = el('Image').value;
    if (image === noImage) {
      if (!el('Inherited').checked) throw new TypeError('Explicit no-image is only valid with projection inheritance.');
      item.imageResourceId = null;
    } else if (image) item.imageResourceId = image;
    return { action: 'add', fragmentId: part.fragmentId, actor: item, instances: copy(session.instances) };
  }
  function invalidate() { formEpoch++; proposal = null; approved = null; details = ''; diagnostics = []; message = '片段结构修改尚未应用到原文草稿。'; }
  function fillChoices() {
    const part = fragment(), previous = el('Actor').value;
    el('Actor').replaceChildren(); el('Group').replaceChildren();
    const root = node('option', t('无组织组')); root.value = ''; root.dataset.i18n = '无组织组'; el('Group').append(root);
    for (const item of part?.actors || []) { const choice = node('option', `${item.key} · ${session.objects.find(object => object.id === item.objectId)?.name || item.objectId}`); choice.value = item.key; el('Actor').append(choice); }
    el('Actor').value = part?.actors.some(item => item.key === previous) ? previous : part?.actors[0]?.key || '';
    for (const item of part?.groups || []) { const choice = node('option', `${item.name} · ${item.key}`); choice.value = item.key; el('Group').append(choice); }
    el('Group').value = '';
  }
  function discardOperation() {
    if (changed() && !window.confirm(t('丢弃本次片段结构修改？原文草稿不会改变。'))) return false;
    mode = ''; if (session) session.instances = []; invalidate(); return true;
  }
  function beginAdd() {
    if (pending || !current() || !session.objects.length || !discardOperation()) return;
    mode = 'add'; session.instances = (fragment()?.placements || []).map(item => ({ placementId: item.placementId, instanceId: crypto.randomUUID() }));
    const taken = new Set(fragment().actors.map(item => item.key)); let index = 1; while (taken.has(`actor${index}`)) index++;
    el('Key').value = `actor${index}`; el('Object').value = session.objects[0].id; el('Group').value = '';
    for (const [field, value] of [['X', '200'], ['Y', '220'], ['Width', '80'], ['Height', '80'], ['Color', '#ffffff'], ['Speed', '160'], ['Controls', 'arrows'], ['Image', '']]) el(field).value = value;
    el('Inherited').checked = Boolean(object()?.projectionDefaults); invalidate(); refresh(); el('Key').focus();
  }
  function beginRemove() {
    if (pending || !current() || !actor() || fragment().actors.length <= 1 || !discardOperation()) return;
    mode = 'remove'; invalidate(); refresh();
  }
  function renderTargets() {
    const list = el('Targets'); list.replaceChildren(); const part = fragment();
    if (!part || !mode) { el('Impact').textContent = t('选择新增或移除后，列出每个放置的身份影响。'); return; }
    const key = mode === 'add' ? el('Key').value.trim() : el('Actor').value;
    const targets = proposal?.targets || (mode === 'add' ? session.instances.map(item => ({ ...item, actorKey: key, overrides: [] }))
      : part.placements.map(item => ({ placementId: item.placementId, instanceId: item.actorIds[key], actorKey: key,
        overrides: Object.keys(item.overrides?.find(override => override.actorKey === key)?.values || {}) })));
    el('Impact').textContent = targets.length ? t(mode === 'add' ? '将在 {0} 个放置中新增演员。生成身份保持固定，检查不会重新分配。' : '将从 {0} 个放置中移除演员、身份映射及该演员的局部覆盖。其他演员与组织组保持。', targets.length)
      : t('此片段尚未放置；只修改共享声明，不生成场景实例。');
    for (const target of targets) {
      const row = node('li'); row.dataset.placementId = target.placementId; row.dataset.instanceId = target.instanceId; row.dataset.actorKey = target.actorKey;
      row.append(node('p', `${t('放置')} · ${target.placementId}`), node('p', `${t(mode === 'add' ? '新增实例身份' : '移除实例身份')} · ${target.instanceId}`), node('p', `${t('局部标识')} · ${target.actorKey}`));
      if (mode === 'remove') row.append(node('p', target.overrides.length ? t('同时清理局部覆盖：{0}', target.overrides.join(' · ')) : t('此放置没有该演员的局部覆盖。')));
      if (mode === 'add') { const placement = part.placements.find(item => item.placementId === target.placementId), offset = placement.offset || [0, 0];
        const x = el('X').value.trim(), y = el('Y').value.trim();
        row.append(node('p', x && y && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? t('候选场景位置：{0}, {1}', Number(x) + offset[0], Number(y) + offset[1]) : t('局部位置输入尚未完整。')));
        if (el('Group').value) row.append(node('p', `${t('所属组织组')} · ${el('Group').value} · ${placement.groupIds[el('Group').value] || ''}`)); }
      list.append(row);
    }
  }
  function refresh() {
    translatePage(dialog); const valid = current();
    if (proposal && (signature() !== rawSignature || JSON.stringify(proposal) !== candidateSignature)) { proposal = null; approved = null; message = '片段结构修改尚未应用到原文草稿。'; }
    if (session && !pending && !valid) { approved = null; message = '原文或预览已变化，请重新预览后编辑片段结构。'; }
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(changed());
    for (const field of ['Fragment', 'Actor', ...fields]) el(field).disabled = pending || !valid || field === 'Actor' && mode === 'add';
    for (const field of ['Width', 'Height', 'Color', 'Speed', 'Controls']) el(field).disabled = pending || !valid || el('Inherited').checked;
    const noImageOption = [...el('Image').children].find(option => option.value === noImage); if (noImageOption) noImageOption.disabled = !el('Inherited').checked;
    el('Inherited').disabled = pending || !valid || !object()?.projectionDefaults;
    el('Add').disabled = pending || !valid || !session?.objects.length; el('Remove').disabled = pending || !valid || !actor() || fragment()?.actors.length <= 1;
    el('Check').disabled = pending || !valid || !mode; el('Apply').disabled = pending || !valid || !approvalMatches();
    el('Close').disabled = pending; el('Cancel').disabled = pending; el('Fields').hidden = mode !== 'add';
    el('RemoveHint').textContent = fragment()?.actors.length <= 1 ? t('每个片段必须保留至少一个演员。') : '';
    el('Defaults').textContent = t(el('Inherited').checked ? '尺寸、颜色、速度与控制读取关联游戏投影；留空图片表示继承，明确无图会写入 null。未使用的显式输入保留。' : '新增声明使用显式字段；留空图片表示无图，不会自动继承投影。');
    el('Message').textContent = t(message); el('Review').hidden = !proposal; el('Source').textContent = proposal?.afterContent || '';
    el('Error').hidden = !details; el('Details').textContent = details; el('Diagnostics').replaceChildren();
    for (const issue of diagnostics) el('Diagnostics').append(node('li', `${issue.code || ''} ${issue.propertyPath || ''}`));
    const part = fragment(); el('Identity').textContent = part ? t('片段：{0}；演员：{1}；放置：{2}', part.fragmentId, part.actors.length, part.placements.length) : '';
    renderTargets();
  }
  function reset() { openEpoch++; formEpoch++; session = null; mode = ''; pending = false; proposal = null; approved = null; details = ''; diagnostics = []; dialog.dataset.dirty = 'false'; }
  function close() { if (pending || !discardOperation()) return false; reset(); dialog.close(); return true; }
  function report(error, fallback) {
    const payload = error?.payload?.data || error?.payload || {}, code = error?.errorCode || payload.errorCode;
    message = code === 'scene_composition_structure_conflict' ? '原文或预览已变化，请重新预览后编辑片段结构。'
      : code === 'scene_composition_structure_content_limit' ? '修改后的配方超过 128 KiB；请缩减原文后重试。' : fallback;
    details = error?.message || ''; diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  }
  async function check() {
    if (pending || !current() || !changed()) { refresh(); return; }
    approved = null; proposal = null; details = ''; diagnostics = [];
    const owner = session, epoch = formEpoch, raw = signature();
    try { proposal = copy(owner.draft.propose(edit())); rawSignature = raw; candidateSignature = JSON.stringify(proposal); }
    catch (error) { report(error, '片段结构修改有误，请检查声明、身份和数量限制后重试。'); refresh(); return; }
    const candidate = proposal, candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在检查配方与素材…'; el('Review').open = true; refresh();
    try { const result = await validateDraft(copy(candidate), { isCurrent: unchanged }); if (!unchanged()) return;
      if (result?.ok !== true) throw Object.assign(new Error('The candidate validation was not confirmed.'), { payload: result });
      approved = candidate; message = '片段结构已检查，请确认全部放置身份及完整原文后应用。';
    } catch (error) { if (unchanged()) report(error, '配方或素材检查未通过。修改保留，请处理诊断后重试。'); }
    finally { if (owns()) { pending = false; if (!current()) message = '原文或预览已变化，请重新预览后编辑片段结构。'; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approvalMatches()) { refresh(); return; }
    const owner = session, candidate = approved, epoch = formEpoch, raw = signature(), candidateSig = candidateSignature;
    const owns = () => session === owner && dialog.open && !disposed;
    const unchanged = () => owns() && current() && formEpoch === epoch && signature() === raw && proposal === candidate && JSON.stringify(candidate) === candidateSig;
    pending = true; message = '正在应用片段结构到原文草稿…'; refresh();
    try { const result = await applySourceDraft(copy(candidate), { isCurrent: unchanged });
      if (!owns()) return;
      if (result?.applied !== true) throw Object.assign(new Error('The structure source draft was not applied.'), { payload: result });
      // A successful host edit advances its source token, so completion uses the owned receipt instead of the old token.
      focusEpoch++; opener = null; reset(); dialog.close(); await sourceApplied(result, copy(candidate));
    } catch (error) { if (unchanged()) report(error, '片段结构修改未应用。修改保留，请检查后重试。'); }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  for (const field of fields) el(field).addEventListener(['Object', 'Group', 'Controls', 'Image'].includes(field) ? 'change' : 'input', () => {
    if (pending || !current()) return;
    if (field === 'Object') el('Inherited').checked = Boolean(object()?.projectionDefaults);
    invalidate(); refresh();
  });
  el('Inherited').addEventListener('change', () => { if (!pending && current()) { invalidate(); refresh(); } });
  el('Fragment').addEventListener('change', () => {
    if (pending || !current()) return;
    const requested = el('Fragment').value; el('Fragment').value = session.fragmentId;
    if (!discardOperation()) { refresh(); return; }
    session.fragmentId = requested; el('Fragment').value = requested; fillChoices(); refresh();
  });
  el('Actor').addEventListener('change', () => { if (pending || !current() || mode === 'add') return; invalidate(); refresh(); });
  el('Add').addEventListener('click', beginAdd); el('Remove').addEventListener('click', beginRemove);
  el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  for (const suffix of ['Close', 'Cancel']) el(suffix).addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (dialog.open) return; const target = opener, epoch = focusEpoch; opener = null; if (session) reset(); queueMicrotask(() => { if (!dialog.open && !disposed && epoch === focusEpoch) target?.focus?.(); }); });
  const unsubscribe = onLanguageChange(() => { refresh(); });
  function destroy() { if (disposed) return; disposed = true; focusEpoch++; reset(); dialog.close(); unsubscribe?.(); dialog.remove(); }
  return { refresh, close, dispose: destroy, destroy,
    async open({ model, source, actorId = null, objects = [], images = [], isCurrent = () => false }) {
      if (disposed || dialog.open) return false;
      const epoch = ++openEpoch, token = getContext().sceneDraftToken;
      const eligible = () => { const c = getContext(); return epoch === openEpoch && !disposed && !dialog.open && supportsStudioCoreCompositionStructure()
        && c.canEditCompositionStructure === true && c.compositionSourceWritable === true && c.editable && !c.creating && !c.busy
        && c.sceneDraftToken === token && c.sceneDraftPath === source?.sourcePath && isCurrent(); };
      if (!eligible()) return false;
      try {
        const options = copy(objects), imageOptions = copy(images), selectedLocation = model?.sourceLocations?.actors?.find(item => item.instanceId === actorId);
        const draft = await createSceneCompositionStructureDraft(model, source, { digest }); if (!eligible()) return false;
        session = { draft, objects: options, images: imageOptions, instances: [], token, sourcePath: source.sourcePath, isCurrent,
          fragmentId: draft.fragments.some(item => item.fragmentId === selectedLocation?.composition?.fragmentId) ? selectedLocation.composition.fragmentId : draft.fragments[0]?.fragmentId };
        el('Fragment').replaceChildren(); for (const part of draft.fragments) { const option = node('option', part.fragmentId); option.value = part.fragmentId; el('Fragment').append(option); }
        el('Fragment').value = session.fragmentId;
        el('Object').replaceChildren(); for (const item of options) { const option = node('option', item.sourcePath ? `${item.name} · ${item.sourcePath}` : item.name || item.id); option.value = item.id; el('Object').append(option); }
        el('Object').value = options[0]?.id || ''; fillChoices();
        el('Image').replaceChildren(); const empty = node('option', t('留空：继承投影或不使用图片')); empty.value = ''; empty.dataset.i18n = '留空：继承投影或不使用图片'; el('Image').append(empty);
        const none = node('option', t('明确不使用投影图片（null）')); none.value = noImage; none.dataset.i18n = '明确不使用投影图片（null）'; el('Image').append(none);
        for (const item of imageOptions) { const option = node('option', item.path ? `${item.name || item.path} · ${item.path}` : item.name || item.id); option.value = item.id; el('Image').append(option); }
        mode = ''; proposal = null; approved = null; pending = false; details = ''; diagnostics = []; formEpoch++;
        message = '选择片段后新增或移除演员；一次审阅一项结构操作。'; opener = document.activeElement; focusEpoch++;
        refresh(); dialog.showModal(); el('Fragment').focus(); return true;
      } catch (error) { if (!eligible()) return false; report(error, '片段结构编辑暂不可用，请重新预览当前配方后重试。'); window.alert(t(message)); return false; }
    },
  };
}
