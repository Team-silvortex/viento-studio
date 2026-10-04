import { validateSceneGroups } from '../../engine/scene-groups.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { requestWorldCommand, readDocSource } from './app-doc-service.js';
import { API_PATHS } from '../../scripts/lib/doc-api-contract.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { renderProjectionRuntime } from '../../engine/object-projection-template.mjs';

const sceneCreateErrors = {
  world_revision_conflict: '工程已变化。场景草稿保留，请重新读取工程并预览。',
  world_read_conflict: '工程已变化。场景草稿保留，请重新读取工程并预览。',
  world_create_path_conflict: '保存位置已被使用，请修改路径后重新预览。',
  world_create_path_invalid: '请使用正文目录内可迁移的 JSON 文件路径。',
  world_object_not_found: '场景已不存在。草稿保留，请返回构建面板核对。',
  world_identity_conflict: '此身份已经登记，请先核对已保存内容。',
  world_type_unknown: '文档类型已变化，请重新读取工程并选择类型。',
  world_scene_invalid: '场景声明不符合构建要求，请检查标出的位置。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
  world_recovery_conflict: '工程存在未完成的提交，请先在世界与对象中恢复。',
  world_journal_invalid: '工程存在未完成的提交，请先在世界与对象中恢复。',
};
const sceneDiagnosticLabels = {
  build_projection_invalid: '场景引用的投影无效，请检查投影原文。',
  build_projection_source: '投影的来源对象不可读取或不是普通对象，请检查来源。',
  build_projection_unlinked: '投影缺少来源关系，请检查对象登记。',
  build_projection_runtime: '此投影不支持当前二维场景，请选择兼容的游戏投影。',
  build_actor_missing: '场景引用的角色不存在或原文不可用。',
  build_actor_duplicate: '同一个角色不能在场景中重复声明。',
  build_group_value: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_missing: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_duplicate: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_parent: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_cycle: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_depth: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_actor_group: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_instance_missing: '每个场景实例都需要有效的 UUID 身份。',
  build_instance_duplicate: '场景实例身份不能重复，请为复制的实例使用新身份。',
  build_actor_value: '角色字段的值不符合要求，请检查标出的位置。',
  build_scene_value: '场景字段的值不符合要求，请检查标出的位置。',
  build_image_unsupported: '请选择已登记的 PNG、JPEG、WebP 或 SVG 图片。',
  build_image_unverified: '图片缺少有效的内容校验信息，请重新导入。',
  build_resource_changed: '图片内容与登记信息不符，请重新导入后检查计划。',
  build_resource_unavailable: '构建所需素材不可读取，请检查素材位置。',
  build_feature_unsupported: '场景使用了当前后端尚未支持的功能。',
};
const sceneUuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const sceneCopy = value => JSON.parse(JSON.stringify(value));
const sceneDigest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sceneActorFields = ['size', 'color', 'speed', 'controls', 'imageResourceId'];

export function setupSceneCreate({ getContext = () => ({}), setBusy = () => {}, applied = async () => {} } = {}) {
  const dialog = document.createElement('dialog'); dialog.id = 'sceneCreateDialog'; dialog.className = 'project-build scene-create';
  dialog.setAttribute('aria-labelledby', 'sceneCreateTitle');
  dialog.innerHTML = `<header class="build-heading"><div><h2 id="sceneCreateTitle" data-i18n="创建二维场景"></h2><p data-i18n="选择已有对象组成场景。保存时一并登记对象引用和图片绑定。"></p></div>
    <button id="sceneCreateClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回构建"></button></header>
    <p id="sceneCreateNote" class="build-note" data-i18n="场景保存为本工程的 JSON 文档，角色原文与图片保持不变。创建后需另行检查计划和构建。"></p>
    <p id="sceneCreateImmutable" class="build-hint" hidden data-i18n="编辑时锁定场景身份、文档类型与路径；可修改名称、画布和场景中的对象。"></p>
    <p id="sceneCreateRetention" class="build-hint" hidden data-i18n="修改场景会保留已有对象关系与图片绑定。移除场景对象或换图不会删除原对象和素材。"></p>
    <p id="sceneCreateMessage" role="status" aria-live="polite"></p>
    <button id="sceneCreateRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <p id="sceneCreateEmpty" class="build-note" hidden data-i18n="暂无可用对象。请先返回编辑器，在世界与对象中创建并保存文档；需要图片时先通过插入素材导入。"></p>
    <form id="sceneCreateForm" novalidate><fieldset id="sceneCreateFields"><legend data-i18n="场景设置"></legend><div id="sceneCreateSettings" class="scene-settings"></div>
    <h3 data-i18n="场景中的对象"></h3><p id="sceneCreateInstanceHint" class="build-hint"></p>
    <button id="sceneCreateEnableInstances" type="button" class="doc-btn doc-btn-ghost" data-i18n="启用场景实例" hidden></button>
    <button id="sceneCreateEnableGroups" type="button" class="doc-btn doc-btn-ghost" data-i18n="启用场景分组" hidden></button>
    <section id="sceneCreateGroupSection" hidden><p class="build-hint" data-i18n="启用分组只修改草稿，预览并保存后升级场景格式。"></p><h3 data-i18n="场景分组"></h3><p class="build-hint" data-i18n="分组用于组织与整组选取，不改变位置、绘制顺序或运行行为。只能删除没有子组和实例的空组。"></p><div id="sceneCreateGroups"></div><button id="sceneCreateAddGroup" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加分组"></button></section>
    <div id="sceneCreateActors"></div><button id="sceneCreateAdd" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加场景对象"></button></fieldset>
    <ul id="sceneCreateDiagnostics" class="scene-diagnostics"></ul>
    <section id="sceneCreatePreview" class="build-summary" hidden><h3 id="sceneCreatePreviewTitle" data-i18n="将创建的场景"></h3><p id="sceneCreateSummary"></p><pre id="sceneCreateSource" tabindex="0"></pre></section>
    <details><summary data-i18n="原始细节与日志"></summary><pre id="sceneCreateDetails" tabindex="0"></pre></details>
    <footer class="build-actions scene-create-actions"><button id="sceneCreateCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="预览场景"></button>
    <button id="sceneCreateSave" type="submit" class="doc-btn" data-i18n="保存场景"></button>
    <button id="sceneCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer></form>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  let enabled = false, createSupported = true, updateSupported = false, editing = false, targetId = '', pendingApply = null, projection = null, draft = null, preview = null, saved = false, uncertain = false;
  let busy = false, dirty = false, epoch = 0, message = '', details = '', diagnostics = [], needsRefresh = false, opener = null;
  const canWrite = () => { const context = getContext(); return enabled && (editing ? updateSupported : createSupported) && context.editable && !context.dirty && !context.creating && !context.busy; };
  const types = () => (projection?.types || []).filter(type => type.definition?.id);
  const projectionRuntime = object => { try { return object?.provenance?.authoredProjection ? renderProjectionRuntime(object.provenance.authoredProjection) : null; } catch { return null; } };
  const actors = () => (projection?.objects || []).filter(object => object.id !== targetId && sceneUuid(object.id) && object.provenance?.identity === 'registered'
    && object.documentRefs?.[0]?.sourceRevision && (!Object.hasOwn(object.provenance, 'authoredProjection') || projectionRuntime(object)) && !(projection.diagnostics || []).some(item => item.objectId === object.id && item.severity === 'error'));
  const images = () => (projection?.resources || []).filter(resource => sceneUuid(resource.id) && resource.descriptor?.kind === 'image'
    && /\.(png|jpe?g|webp|svg)$/i.test(resource.descriptor.location?.path || '') && resource.availability === 'present-unverified'
    && /^[a-f0-9]{64}$/.test(resource.descriptor.content?.sha256 || '') && Number.isSafeInteger(resource.descriptor.content?.size)
    && resource.descriptor.content.size > 0 && resource.descriptor.content.size <= 32 * 1024 * 1024);
  const root = () => projection?.world.sourceWorkspaceVersion === 3 ? 'documents' : 'design-data';
  const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
  const defaultActor = (id, instanceId) => {
    const inherited = projectionRuntime(projection?.objects.find(object => object.id === id));
    return { objectId: id, ...(instanceId ? { instanceId } : {}), position: ['200', '220'], size: inherited ? inherited.size.map(String) : ['80', '80'], color: inherited?.color || '#ffffff',
      speed: String(inherited?.speed ?? 160), controls: inherited?.controls || 'arrows', imageResourceId: inherited?.imageResourceId || '', useProjectionDefaults: Boolean(inherited), inheritPresent: Boolean(inherited), overrides: [] };
  };
  const actorLabel = object => {
    const authored = object.provenance?.authoredProjection;
    if (!authored) return `${object.name} · ${object.documentRefs[0].sourcePath}`;
    const source = projection.objects.find(item => item.id === authored.sourceObjectId);
    return `${object.name} · ${source?.name || authored.sourceObjectId} · ${t(authored.template.snapshot.label)}`;
  };
  function change() { dirty = true; preview = null; diagnostics = []; details = ''; message = ''; update(); }
  function field(parent, { id, label, value, options, type = 'text', min, max, maxLength, changeValue = () => {}, pointer = '', readOnly = false }) {
    const wrapper = node('label', '', 'scene-field'); wrapper.htmlFor = id;
    const caption = node('span', t(label)); caption.dataset.i18n = label;
    const input = document.createElement(options ? 'select' : 'input'); input.id = id; input.dataset.pointer = pointer;
    if (options) {
      for (const [key, title] of options) { const option = node('option', title); option.value = key; input.append(option); }
      if (value && !options.some(([key]) => key === value)) { const missing = node('option', t('已不可用：{0}', value)); missing.value = value; input.append(missing); }
    } else {
      input.type = type;
      if (min !== undefined) input.min = min;
      if (max !== undefined) input.max = max;
      if (maxLength !== undefined) input.maxLength = maxLength;
      if (type === 'number') input.step = 'any';
    }
    input.value = value;
    if (readOnly) { if (options) input.disabled = true; else input.readOnly = true; input.setAttribute('aria-readonly', 'true'); }
    input.addEventListener(options ? 'change' : 'input', () => { if (readOnly || busy || saved || uncertain) return; changeValue(input.value); change(); });
    wrapper.append(caption, input); parent.append(wrapper); return input;
  }
  function renderFields() {
    const focused = document.activeElement, focusedId = focused?.id, start = focused?.selectionStart, end = focused?.selectionEnd;
    const settings = el('sceneCreateSettings'), list = el('sceneCreateActors'); settings.replaceChildren(); list.replaceChildren(); el('sceneCreateGroups').replaceChildren();
    if (!draft) return;
    if (editing) field(settings, { id: 'sceneCreateIdentity', label: '对象身份', value: draft.objectId, readOnly: true });
    field(settings, { id: 'sceneCreateName', label: '场景名称', value: draft.title, maxLength: 160, pointer: '/title', changeValue: value => { draft.title = value; } });
    field(settings, { id: 'sceneCreateType', label: '文档类型', value: draft.documentType,
      options: editing ? undefined : types().map(type => [type.definition.id, type.label]), readOnly: editing, changeValue: value => { draft.documentType = value; } });
    field(settings, { id: 'sceneCreatePath', label: '原文路径', value: draft.sourcePath, maxLength: 1024, readOnly: editing, changeValue: value => { draft.sourcePath = value; } });
    field(settings, { id: 'sceneCreateBackground', label: '背景颜色（十六进制）', value: draft.background, maxLength: 9, pointer: '/background', changeValue: value => { draft.background = value; } });
    ['视口宽度', '视口高度'].forEach((label, index) => field(settings, { id: `sceneCreateViewport${index}`, label, type: 'number', min: 64, max: 4096,
      value: draft.viewport[index], pointer: '/viewport', changeValue: value => { draft.viewport[index] = value; } }));
    for (const [index, group] of (draft.groups || []).entries()) {
      const card = node('fieldset', '', 'scene-group'); card.append(node('legend', t('分组 {0}', index + 1)));
      const fields = node('div', '', 'scene-actor-fields'), prefix = `sceneGroup${index}`;
      field(fields, { id: `${prefix}Identity`, label: '分组身份', value: group.groupId, pointer: `/groups/${index}/groupId`, readOnly: true });
      field(fields, { id: `${prefix}Name`, label: '分组名称', value: group.name, maxLength: 160, pointer: `/groups/${index}/name`, changeValue: value => { group.name = value; renderFields(); } });
      const descendants = new Set([group.groupId]);
      for (let pass = 0; pass < (draft.groups || []).length; pass++) for (const item of draft.groups) if (descendants.has(item.parentGroupId)) descendants.add(item.groupId);
      field(fields, { id: `${prefix}Parent`, label: '父级分组', value: group.parentGroupId || '', pointer: `/groups/${index}/parentGroupId`,
        options: [['', t('场景根级')], ...draft.groups.filter(item => !descendants.has(item.groupId)).map(item => [item.groupId, item.name])], changeValue: value => {
          if (value) group.parentGroupId = value; else delete group.parentGroupId;
          renderFields();
        } });
      const remove = node('button', t('删除空分组'), 'doc-btn doc-btn-ghost'); remove.id = `${prefix}Remove`; remove.type = 'button';
      const nonempty = () => draft.groups.some(item => item.parentGroupId === group.groupId) || draft.actors.some(actor => actor.groupId === group.groupId);
      remove.disabled = nonempty(); remove.addEventListener('click', () => {
        if (busy || saved || uncertain || nonempty()) return;
        draft.groups.splice(index, 1); change(); renderFields(); el('sceneCreateAddGroup').focus();
      });
      card.append(fields, remove); el('sceneCreateGroups').append(card);
    }
    draft.actors.forEach((actor, index) => {
      const card = node('fieldset', '', 'scene-actor'); const legend = node('legend', t('场景对象 {0}', index + 1)); card.append(legend);
      const fields = node('div', '', 'scene-actor-fields'); const prefix = `sceneActor${index}`;
      field(fields, { id: `${prefix}Object`, label: '关联对象', value: actor.objectId, pointer: `/actors/${index}/objectId`,
        options: actors().map(object => [object.id, actorLabel(object)]), changeValue: value => {
          const position = actor.position; Object.assign(actor, defaultActor(value, actor.instanceId), { position }); renderFields();
        } });
      if (draft.schemaVersion >= 2) field(fields, { id: `${prefix}Instance`, label: '实例身份', value: actor.instanceId, pointer: `/actors/${index}/instanceId`, readOnly: true });
      if (draft.schemaVersion === 3) field(fields, { id: `${prefix}Group`, label: '所属分组', value: actor.groupId || '', pointer: `/actors/${index}/groupId`,
        options: [['', t('场景根级')], ...draft.groups.map(group => [group.groupId, group.name])], changeValue: value => {
          if (value) actor.groupId = value; else delete actor.groupId;
          renderFields();
        } });
      const inherited = projectionRuntime(projection.objects.find(object => object.id === actor.objectId));
      if (inherited) {
        const label = node('label', '', 'scene-field projection-checkbox'), check = document.createElement('input');
        label.htmlFor = `${prefix}UseProjection`; check.id = `${prefix}UseProjection`; check.type = 'checkbox'; check.checked = actor.useProjectionDefaults;
        label.append(node('span', t('使用投影配置')), check); fields.append(label);
        check.addEventListener('change', () => {
          if (busy || saved || uncertain) return;
          const position = actor.position; if (check.checked) Object.assign(actor, defaultActor(actor.objectId, actor.instanceId), { position });
          actor.useProjectionDefaults = check.checked; actor.inheritPresent = check.checked; actor.overrides = []; change(); renderFields();
        });
        if (actor.useProjectionDefaults) {
          const defaults = { size: inherited.size.map(String), color: inherited.color, speed: String(inherited.speed), controls: inherited.controls, imageResourceId: inherited.imageResourceId || '' };
          for (const key of sceneActorFields) if (!actor.overrides.includes(key)) actor[key] = defaults[key];
        }
      }
      field(fields, { id: `${prefix}Image`, label: '场景图片', value: actor.imageResourceId, pointer: `/actors/${index}/imageResourceId`,
        options: [['', t('不使用图片')], ...images().map(resource => [resource.id, `${resource.descriptor.name} · ${resource.descriptor.location.path}`])], changeValue: value => { actor.imageResourceId = value; } });
      for (const [name, labels, limits] of [['position', ['位置 X', '位置 Y'], [-100000, 100000]], ['size', ['宽度', '高度'], [1, 2048]]]) {
        labels.forEach((label, axis) => field(fields, { id: `${prefix}${name}${axis}`, label, type: 'number', min: limits[0], max: limits[1], value: actor[name][axis], pointer: `/actors/${index}/${name}`,
          changeValue: value => { actor[name][axis] = value; } }));
      }
      field(fields, { id: `${prefix}Color`, label: '对象颜色（十六进制）', value: actor.color, maxLength: 9, pointer: `/actors/${index}/color`, changeValue: value => { actor.color = value; } });
      field(fields, { id: `${prefix}Speed`, label: '速度（像素／秒）', type: 'number', min: 0, max: 2000, value: actor.speed, pointer: `/actors/${index}/speed`, changeValue: value => { actor.speed = value; } });
      field(fields, { id: `${prefix}Controls`, label: '移动控制', value: actor.controls, pointer: `/actors/${index}/controls`, options: [['arrows', t('方向键')], ['none', t('不接受输入')]], changeValue: value => { actor.controls = value; } });
      if (actor.useProjectionDefaults && inherited) {
        for (const [key, suffix, label, inputs] of [
          ['imageResourceId', 'Image', '在此场景覆盖图片', ['Image']], ['size', 'Size', '在此场景覆盖尺寸', ['size0', 'size1']],
          ['color', 'Color', '在此场景覆盖颜色', ['Color']], ['speed', 'Speed', '在此场景覆盖速度', ['Speed']],
          ['controls', 'Controls', '在此场景覆盖控制', ['Controls']],
        ]) {
          const overrideLabel = node('label', '', 'scene-field projection-checkbox'), override = document.createElement('input');
          override.id = `${prefix}Override${suffix}`; override.type = 'checkbox'; override.checked = actor.overrides.includes(key); overrideLabel.htmlFor = override.id;
          overrideLabel.append(node('span', t(label)), override); fields.append(overrideLabel);
          for (const input of inputs) fields.querySelector(`#${prefix}${input}`).disabled = !override.checked;
          override.addEventListener('change', () => {
            if (busy || saved || uncertain) return;
            actor.overrides = actor.overrides.filter(value => value !== key);
            if (override.checked) actor.overrides.push(key);
            change(); renderFields();
          });
        }
        fields.append(node('p', t('位置属于场景。勾选单项覆盖可只修改该场景中的值，其他字段继续跟随投影。图片覆盖选择不使用图片可关闭继承图片。'), 'build-hint'));
      }
      const remove = node('button', t('移除场景对象'), 'doc-btn doc-btn-ghost'); remove.type = 'button'; remove.id = `${prefix}Remove`;
      remove.disabled = draft.actors.length <= 1; remove.setAttribute('aria-label', t('移除场景对象 {0}', index + 1));
      remove.addEventListener('click', () => { if (busy || saved || uncertain || draft.actors.length <= 1) return; draft.actors.splice(index, 1); change(); renderFields(); el('sceneCreateAdd').focus(); });
      const actions = node('div', '', 'build-actions');
      for (const [suffix, label, offset] of [['Up', '上移实例', -1], ['Down', '下移实例', 1]]) {
        const move = node('button', t(label), 'doc-btn doc-btn-ghost'); move.type = 'button'; move.id = `${prefix}${suffix}`;
        move.disabled = index + offset < 0 || index + offset >= draft.actors.length;
        move.setAttribute('aria-label', t('{0}：场景对象 {1}', t(label), index + 1));
        move.addEventListener('click', () => {
          if (busy || saved || uncertain || index + offset < 0 || index + offset >= draft.actors.length) return;
          [draft.actors[index], draft.actors[index + offset]] = [draft.actors[index + offset], draft.actors[index]];
          change(); renderFields(); el(`sceneActor${index + offset}Object`).focus();
        }); actions.append(move);
      }
      if (draft.schemaVersion >= 2) {
        const duplicate = node('button', t('复制场景实例'), 'doc-btn doc-btn-ghost'); duplicate.type = 'button'; duplicate.id = `${prefix}Duplicate`;
        duplicate.disabled = draft.actors.length >= 128; duplicate.setAttribute('aria-label', t('复制场景实例 {0}', index + 1));
        duplicate.addEventListener('click', () => {
          if (busy || saved || uncertain || draft.actors.length >= 128) return;
          draft.actors.splice(index + 1, 0, { ...sceneCopy(actor), instanceId: crypto.randomUUID() });
          change(); renderFields(); el(`sceneActor${index + 1}Object`).focus();
        }); actions.append(duplicate);
      }
      actions.append(remove); card.append(fields, actions); list.append(card);
    });
    if (focusedId) {
      const replacement = el(focusedId); replacement?.focus();
      if (replacement?.type === 'text' && Number.isInteger(start)) { replacement.selectionStart = start; replacement.selectionEnd = end; }
    }
  }
  function validate() {
    const issues = [];
    const issue = (code, propertyPath = '') => issues.push({ code, propertyPath });
    const numeric = (raw, low, high, integer = false) => typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))
      && Number(raw) >= low && Number(raw) <= high && (!integer || Number.isInteger(Number(raw)));
    const color = value => /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
    if (!draft || !projection) return [{ code: 'scene_catalog_required' }];
    if (!draft.title.trim() || draft.title.length > 160 || /[\x00-\x1f]/.test(draft.title)) issue('build_scene_value', '/title');
    if (!draft.viewport.every(value => numeric(value, 64, 4096, true))) issue('build_scene_value', '/viewport');
    if (!color(draft.background)) issue('build_scene_value', '/background');
    if (!editing && !types().some(type => type.definition.id === draft.documentType)) issue('world_type_unknown');
    if (!editing && (draft.sourcePath.length > 1024 || getCreatePathError(draft.sourcePath) || !draft.sourcePath.startsWith(`${root()}/`) || !draft.sourcePath.toLowerCase().endsWith('.json'))) issue('world_create_path_invalid');
    if (!draft.actors.length || draft.actors.length > 128) issue('build_scene_value', '/actors');
    const ids = new Set();
    if (draft.schemaVersion === 3) issues.push(...validateSceneGroups({ schemaVersion: 3, groups: draft.groups, actors: draft.actors }).diagnostics);
    for (const [index, actor] of draft.actors.entries()) {
      const at = `/actors/${index}`;
      if (!actors().some(object => object.id === actor.objectId)) issue('build_actor_missing', `${at}/objectId`);
      const identity = draft.schemaVersion >= 2 ? actor.instanceId : actor.objectId;
      if (draft.schemaVersion >= 2 && !sceneUuid(identity)) issue('build_instance_missing', `${at}/instanceId`);
      if (ids.has(identity)) issue(draft.schemaVersion >= 2 ? 'build_instance_duplicate' : 'build_actor_duplicate', `${at}/${draft.schemaVersion >= 2 ? 'instanceId' : 'objectId'}`);
      ids.add(identity);
      if (!actor.position.every(value => numeric(value, -100000, 100000))) issue('build_actor_value', `${at}/position`);
      if (actor.useProjectionDefaults && !projectionRuntime(projection.objects.find(object => object.id === actor.objectId))) issue('build_actor_value', `${at}/objectId`);
      const check = key => !actor.useProjectionDefaults || actor.overrides.includes(key);
      if (check('size') && !actor.size.every(value => numeric(value, 1, 2048))) issue('build_actor_value', `${at}/size`);
      if (check('speed') && !numeric(actor.speed, 0, 2000)) issue('build_actor_value', `${at}/speed`);
      if (check('color') && !color(actor.color)) issue('build_actor_value', `${at}/color`);
      if (check('controls') && !['arrows', 'none'].includes(actor.controls)) issue('build_feature_unsupported', `${at}/controls`);
      if (check('imageResourceId') && actor.imageResourceId && !images().some(resource => resource.id === actor.imageResourceId)) issue('build_image_unsupported', `${at}/imageResourceId`);
    }
    return issues;
  }
  function declaration() {
    return { format: 'viento-scene2d', schemaVersion: draft.schemaVersion, title: draft.title, viewport: draft.viewport.map(Number), background: draft.background, ...(draft.schemaVersion === 3 ? { groups: sceneCopy(draft.groups) } : {}),
      actors: draft.actors.map(actor => {
        const value = { ...(draft.schemaVersion >= 2 ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId, position: actor.position.map(Number), ...(draft.schemaVersion === 3 && actor.groupId ? { groupId: actor.groupId } : {}) };
        if (actor.inheritPresent || actor.useProjectionDefaults) value.useProjectionDefaults = actor.useProjectionDefaults;
        const include = key => !actor.useProjectionDefaults || actor.overrides.includes(key);
        if (include('size')) value.size = actor.size.map(Number);
        if (include('color')) value.color = actor.color;
        if (include('speed')) value.speed = Number(actor.speed);
        if (include('controls')) value.controls = actor.controls;
        if (include('imageResourceId') && (actor.imageResourceId || actor.useProjectionDefaults)) value.imageResourceId = actor.imageResourceId || null;
        return value;
      }) };
  }
  function command(mode) {
    const content = JSON.stringify(declaration(), null, 2) + '\n';
    const shared = { mode, worldId: projection.world.id, baseRevision: projection.world.revision,
      actorRef: { kind: 'user', id: 'local-ui' }, objectId: draft.objectId, content };
    return editing ? { command: 'scene.update', ...shared, objectRevision: draft.objectRevision, sourceRevision: draft.sourceRevision }
      : { command: 'scene.create', ...shared, documentType: draft.documentType, sourcePath: draft.sourcePath };
  }
  async function complete(result, reconciled = false) {
    saved = true; dirty = false; preview = null; uncertain = false; pendingApply = null;
    message = editing ? reconciled ? '已核对，当前保存的场景与提交内容一致。' : '场景修改已保存。返回构建面板重新检查计划并构建。'
      : '场景已创建。返回构建面板检查计划并构建。';
    try { await applied(result); }
    catch (error) { message = editing ? '场景修改已保存，但目录或构建列表刷新失败。请刷新核对，勿重复提交。'
      : '场景已创建，但目录或构建列表刷新失败。请刷新核对，勿重复创建。'; details = error.message || ''; }
  }
  function update() {
    el('sceneCreateTitle').dataset.i18n = editing ? '编辑二维场景' : '创建二维场景';
    el('sceneCreatePreviewTitle').dataset.i18n = editing ? '将保存的场景' : '将创建的场景';
    el('sceneCreateCheck').dataset.i18n = editing ? '预览修改' : '预览场景';
    el('sceneCreateSave').dataset.i18n = editing ? '保存修改' : '保存场景';
    el('sceneCreateCancel').dataset.i18n = editing ? '取消修改' : '取消创建';
    el('sceneCreateNote').hidden = editing; el('sceneCreateImmutable').hidden = !editing; el('sceneCreateRetention').hidden = !editing;
    translatePage(dialog);
    dialog.dataset.dirty = String(dirty && !saved); dialog.setAttribute('aria-busy', String(busy));
    el('sceneCreateFields').disabled = busy || saved || uncertain;
    el('sceneCreateRefresh').disabled = busy || saved;
    el('sceneCreateClose').disabled = busy; el('sceneCreateCancel').disabled = busy;
    el('sceneCreateCheck').disabled = busy || saved || uncertain || needsRefresh || !canWrite() || !draft || !actors().length;
    el('sceneCreateSave').disabled = busy || saved || uncertain || needsRefresh || !canWrite() || !preview;
    el('sceneCreateAdd').disabled = busy || saved || uncertain || !draft || !actors().length || draft.actors.length >= (draft.schemaVersion >= 2 ? 128 : Math.min(128, actors().length));
    el('sceneCreateEnableInstances').hidden = draft?.schemaVersion !== 1;
    el('sceneCreateEnableInstances').disabled = busy || saved || uncertain || !draft;
    el('sceneCreateEnableGroups').hidden = draft?.schemaVersion !== 2;
    el('sceneCreateEnableGroups').disabled = busy || saved || uncertain || !draft;
    el('sceneCreateGroupSection').hidden = draft?.schemaVersion !== 3;
    el('sceneCreateAddGroup').disabled = busy || saved || uncertain || !draft || (draft.groups || []).length >= 128;
    el('sceneCreateInstanceHint').textContent = t(draft?.schemaVersion === 1
      ? '此场景使用旧版格式，同一对象只能出现一次。启用场景实例后可重复引用；预览并保存后才升级格式。'
      : '同一对象可创建多个独立实例。复制保留配置，位置与覆盖值分别保存；调整顺序会改变重叠时的前后关系。');
    el('sceneCreateEmpty').hidden = !projection || actors().length > 0;
    el('sceneCreateMessage').textContent = t(message);
    el('sceneCreateDetails').textContent = details;
    el('sceneCreatePreview').hidden = !preview;
    el('sceneCreateSource').textContent = preview?.result.changes?.[0]?.afterText || preview?.request.content || '';
    el('sceneCreateSummary').textContent = preview ? t('{0} · {1} 个对象引用 · {2} 个图片绑定', draft.sourcePath, draft.actors.length,
      new Set(declaration().actors.map(actor => actor.imageResourceId).filter(Boolean)).size) : '';
    const list = el('sceneCreateDiagnostics'); list.replaceChildren();
    for (const item of diagnostics) {
      const text = t(sceneDiagnosticLabels[item.code] || sceneCreateErrors[item.code] || '场景声明不符合构建要求，请检查标出的位置。');
      const row = node('li');
      const target = [...dialog.querySelectorAll('[data-pointer]')].find(input => input.dataset.pointer === item.propertyPath);
      if (target) {
        const jump = node('button', `${text} ${item.propertyPath}`, 'doc-btn doc-btn-ghost'); jump.type = 'button';
        jump.addEventListener('click', () => target.focus()); row.append(jump);
      } else row.textContent = `${text}${item.propertyPath ? ` ${item.propertyPath}` : ''}`;
      list.append(row);
    }
  }
  async function read() {
    if (busy || !canWrite() || saved) return;
    const generation = ++epoch; preview = null; needsRefresh = true; busy = true; setBusy(true); message = '正在读取场景可用的对象与图片…'; update();
    try {
      const { payload } = await fetchJsonApiRequest(WORLD_API_PATH, { cache: 'no-store' }, 45000, t('读取世界'));
      if (generation !== epoch) return;
      projection = payload; preview = null; needsRefresh = false; diagnostics = []; details = '';
      if (![2, 3].includes(projection.world?.sourceWorkspaceVersion)) throw new Error('Unsupported workspace');
      if (editing) {
        const object = projection.objects.find(item => item.id === targetId), ref = object?.documentRefs?.[0];
        if (!object || !ref?.sourceRevision || !object.revision) throw Object.assign(new Error('Scene is unavailable'), { payload: { errorCode: 'world_object_not_found' } });
        if (draft && (draft.sourcePath !== ref.sourcePath || draft.documentType !== object.provenance.documentType)) {
          needsRefresh = true; message = '场景的类型或位置已变化。草稿保留，请返回构建面板重新打开。'; renderFields(); return;
        }
        const payload = await readDocSource({ docApiUrl: API_PATHS.DOC, pathValue: ref.sourcePath, requestTimeoutMs: 45000, requestLabel: t('读取场景原文') });
        if (generation !== epoch) return;
        if (typeof payload?.content !== 'string' || `sha256:${await sceneDigest(payload.content)}` !== ref.sourceRevision) throw Object.assign(new Error('Scene source changed while reading'), { payload: { errorCode: 'world_read_conflict' } });
        const content = JSON.parse(payload.content.replace(/^\uFEFF/, ''));
        if (content?.format !== 'viento-scene2d' || ![1, 2, 3].includes(content.schemaVersion) || !Array.isArray(content.actors)
          || !Array.isArray(content.viewport) || !ref.sourcePath.toLowerCase().endsWith('.json')) throw Object.assign(new Error('Unsupported scene declaration'), { payload: { errorCode: 'world_scene_invalid' } });
        if (!draft) {
          draft = { schemaVersion: content.schemaVersion, objectId: object.id, documentType: object.provenance.documentType, sourcePath: ref.sourcePath,
            objectRevision: object.revision, sourceRevision: ref.sourceRevision, title: content.title,
            viewport: content.viewport.map(String), background: content.background, ...(content.schemaVersion === 3 ? { groups: sceneCopy(content.groups) } : {}),
            actors: content.actors.map(value => {
              const defaults = defaultActor(value.objectId), actor = { ...defaults, ...sceneCopy(value),
                position: value.position?.map(String) || ['', ''], size: value.size?.map(String) || defaults.size,
                speed: String(value.speed ?? defaults.speed), imageResourceId: value.imageResourceId || '',
                useProjectionDefaults: value.useProjectionDefaults === true, inheritPresent: Object.hasOwn(value, 'useProjectionDefaults'),
                overrides: sceneActorFields.filter(key => Object.hasOwn(value, key)) };
              return actor;
            }) };
          // Refuse unsupported fields before presenting an editable form: serialization must be lossless.
          if (canonicalJson(declaration()) !== canonicalJson(content)) { draft = null; throw Object.assign(new Error('This declaration cannot be represented without changing fields'), { payload: { errorCode: 'world_scene_invalid' } }); }
        }
        if (uncertain && pendingApply && canonicalJson(content) === canonicalJson(JSON.parse(pendingApply.content))) {
          renderFields(); await complete({ status: 'applied', object, revision: projection.world.revision,
            changes: [{ kind: 'scene.update', objectId: object.id, sourcePath: ref.sourcePath }] }, true); return;
        }
        const wasUncertain = uncertain; draft.objectRevision = object.revision; draft.sourceRevision = ref.sourceRevision;
        uncertain = false; pendingApply = null;
        message = wasUncertain ? '当前保存内容与上次提交不同。草稿保留，请核对后重新预览。' : '修改场景后预览，确认原文与依赖再保存。';
        renderFields(); return;
      }
      if (!draft) {
        const type = types().find(type => type.definition.id === 'level') || types().find(type => type.definition.id === 'document') || types()[0];
        draft = { schemaVersion: 2, objectId: crypto.randomUUID(), documentType: type?.definition.id || '', sourcePath: `${root()}/scenes/new-scene.json`,
          title: t('新建场景'), viewport: ['800', '480'], background: '#0d1829', actors: actors().length ? [defaultActor(actors()[0].id, crypto.randomUUID())] : [] };
      } else if (projection.objects.some(object => object.id === draft.objectId)) {
        uncertain = true; message = '此身份已经登记，请先核对已保存内容。';
      } else { uncertain = false; if (!draft.actors.length && actors().length) draft.actors.push(defaultActor(actors()[0].id, draft.schemaVersion >= 2 ? crypto.randomUUID() : undefined)); }
      if (!uncertain) message = '配置场景后预览，确认原文与依赖再保存。';
      renderFields();
    } catch (error) {
      needsRefresh = true;
      const code = error.payload?.errorCode || error.payload?.data?.errorCode;
      message = sceneCreateErrors[code] || '无法读取工程，场景草稿保留，请重试。'; details = error.message || '';
    } finally { if (generation === epoch) { busy = false; setBusy(false); update(); } }
  }
  async function run(mode) {
    if (busy || saved || uncertain || needsRefresh || !draft || !canWrite() || mode === 'apply' && !preview) return;
    diagnostics = validate();
    if (diagnostics.length) { preview = null; message = '场景声明不符合构建要求，请检查标出的位置。'; update(); return; }
    const request = mode === 'apply' ? { ...sceneCopy(preview.request), mode } : command(mode);
    if (mode === 'apply') pendingApply = sceneCopy(request);
    busy = true; setBusy(true); message = mode === 'preview' ? '正在预览场景…' : '正在保存场景与依赖…'; details = ''; update();
    try {
      const result = await requestWorldCommand(request);
      if (mode === 'preview') { preview = { request: sceneCopy(request), result }; message = '场景预览已就绪。确认后保存场景。'; }
      else await complete(result);
    } catch (error) {
      preview = null;
      const payload = error.payload?.data || error.payload || {}, code = payload.errorCode || error.payload?.errorCode || error.errorCode;
      diagnostics = payload.diagnostics || error.payload?.diagnostics || [];
      details = [error.message, ...diagnostics.map(item => JSON.stringify(item))].filter(Boolean).join('\n');
      message = sceneCreateErrors[code] || '场景请求未完成。草稿保留，请重新读取工程核对保存结果。';
      needsRefresh = ['world_revision_conflict', 'world_read_conflict', 'world_type_unknown'].includes(code);
      if (mode === 'apply' && !['world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_scene_invalid', 'world_create_path_invalid', 'world_create_path_conflict'].includes(code)) uncertain = true;
    } finally { busy = false; setBusy(false); update(); el(preview ? 'sceneCreateSave' : saved ? 'sceneCreateClose' : 'sceneCreateCheck').focus(); }
  }
  function close() {
    if (busy || dirty && !saved && !window.confirm(t('有未保存的场景设置，确定丢弃？'))) return;
    draft = null; preview = null; dirty = false; diagnostics = []; update(); dialog.close();
  }
  el('sceneCreateAdd').addEventListener('click', () => {
    if (busy || saved || uncertain || !draft || draft.actors.length >= 128) return;
    const object = actors().find(item => !draft.actors.some(actor => actor.objectId === item.id)) || (draft.schemaVersion >= 2 ? actors()[0] : null);
    if (!object) return;
    draft.actors.push(defaultActor(object.id, draft.schemaVersion >= 2 ? crypto.randomUUID() : undefined)); change(); renderFields(); el(`sceneActor${draft.actors.length - 1}Object`).focus();
  });
  el('sceneCreateEnableGroups').addEventListener('click', () => {
    if (busy || saved || uncertain || draft?.schemaVersion !== 2) return;
    draft.schemaVersion = 3; draft.groups = []; change(); renderFields(); el('sceneCreateAddGroup').focus();
  });
  el('sceneCreateAddGroup').addEventListener('click', () => {
    if (busy || saved || uncertain || draft?.schemaVersion !== 3 || draft.groups.length >= 128) return;
    draft.groups.push({ groupId: crypto.randomUUID(), name: t('新建分组') }); change(); renderFields(); el(`sceneGroup${draft.groups.length - 1}Name`).focus();
  });
  el('sceneCreateEnableInstances').addEventListener('click', () => {
    if (busy || saved || uncertain || draft?.schemaVersion !== 1) return;
    draft.schemaVersion = 2;
    for (const actor of draft.actors) actor.instanceId = actor.objectId;
    change(); renderFields(); el('sceneActor0Instance')?.focus();
  });
  el('sceneCreateClose').addEventListener('click', close); el('sceneCreateCancel').addEventListener('click', close);
  el('sceneCreateRefresh').addEventListener('click', () => void read());
  el('sceneCreateCheck').addEventListener('click', () => void run('preview'));
  el('sceneCreateForm').addEventListener('submit', event => { event.preventDefault(); void run('apply'); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) opener?.focus(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  onLanguageChange(() => { if (dialog.open) { renderFields(); update(); } });
  return { setAvailable(value, commands = ['scene.create']) { enabled = value === true; createSupported = commands.includes('scene.create'); updateSupported = commands.includes('scene.update'); if (dialog.open) update(); },
    open(objectId = '', options = {}) {
      if (dialog.open) return false; editing = options.mode === 'edit'; targetId = editing ? objectId : '';
      if (!canWrite() || editing && !sceneUuid(targetId)) return false;
      opener = document.activeElement; projection = null; draft = null; preview = null; saved = false; uncertain = false; dirty = false; needsRefresh = false; pendingApply = null;
      message = ''; details = ''; diagnostics = []; renderFields(); update(); dialog.showModal(); void read(); return true;
    } };
}
