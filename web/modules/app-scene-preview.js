import { sceneStructureActors } from '../../engine/scene-structure.mjs';
import { createSceneOutline } from './app-scene-outline.js';
import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest, fetchWithTimeout } from './app-services.js';
import { createScenePreviewCanvas } from './app-scene-preview-canvas.js';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';

const PREVIEW_API = SCENE_PREVIEW_API_PATH;
const previewUUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const diagnosticLabels = {
  'composition-document-invalid': '场景配方有误，请检查片段、放置和局部覆盖。',
  build_scene_required: '请选择已登记且可读取的场景文档。',
  build_scene_format: '场景必须使用 viento-scene2d 第 1、2 或 3 版 JSON 格式。',
  build_scene_json: '场景 JSON 格式有误，请打开原文检查。',
  build_scene_value: '场景字段的值不符合要求，请检查标出的位置。',
  build_actor_value: '角色字段的值不符合要求，请检查标出的位置。',
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
  build_actor_unlinked: '请先在世界与对象中登记场景到角色的关系。',
  build_projection_invalid: '场景引用的投影无效，请检查投影原文。',
  build_projection_source: '投影的来源对象不可读取或不是普通对象，请检查来源。',
  build_projection_unlinked: '投影缺少来源关系，请检查对象登记。',
  build_projection_runtime: '此投影不支持当前二维场景，请选择兼容的游戏投影。',
  build_image_unsupported: '请选择已登记的 PNG、JPEG、WebP 或 SVG 图片。',
  build_image_unbound: '请先在世界与对象中将图片绑定到角色或场景。',
  build_image_unverified: '图片缺少有效的内容校验信息，请重新导入。',
  build_resource_changed: '图片内容与登记信息不符，请重新导入后检查计划。',
  build_resource_unavailable: '构建所需素材不可读取，请检查素材位置。',
  build_feature_unsupported: '场景使用了当前后端尚未支持的功能。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
};

export function setupScenePreview({ container, getContext = () => ({}), getDraft = async () => null, openSource = () => false, editScene = () => {}, editLayout = () => false, editDraftLayout = async () => false, editCompositionOverride = async () => false }) {
  container.classList.add('scene-preview');
  container.innerHTML = `<p class="build-note" data-i18n="查看已保存场景或当前原文草稿的静态布局，无需构建或安装运行引擎。移动、输入和状态变化请使用运行测试。"></p>
    <p id="scenePreviewDraft" class="build-hint" hidden data-i18n="存在未保存草稿；预览仍使用上次保存的场景和投影。"></p>
    <div class="scene-preview-toolbar"><button id="scenePreviewRefresh" type="button" class="doc-btn"></button>
    <button id="scenePreviewDraftRefresh" type="button" class="doc-btn" data-i18n="预览当前草稿"></button>
    <button id="scenePreviewFit" type="button" class="doc-btn doc-btn-ghost" data-i18n="适应画布"></button>
    <button id="scenePreviewZoomOut" type="button" class="doc-btn doc-btn-ghost" data-i18n="缩小"></button>
    <output id="scenePreviewZoom" aria-live="off"></output>
    <button id="scenePreviewZoomIn" type="button" class="doc-btn doc-btn-ghost" data-i18n="放大"></button>
    <label class="scene-preview-grid"><input id="scenePreviewGrid" type="checkbox"><span data-i18n="显示网格"></span></label></div>
    <p id="scenePreviewMessage" role="status" aria-live="polite"></p>
    <p id="scenePreviewProvenance" class="build-hint"></p>
    <p id="scenePreviewSummary" class="build-hint"></p>
    <p id="scenePreviewComposition" class="build-hint" hidden></p><div id="scenePreviewSceneSources" class="scene-preview-toolbar" hidden></div>
    <p class="build-hint" id="scenePreviewHelp" data-i18n="点击角色查看属性；拖动画布平移，滚轮缩放。画布聚焦后可用方向键平移、加减键缩放、0 适应画布。"></p>
    <div class="scene-preview-layout"><canvas id="scenePreviewCanvas" tabindex="0" aria-describedby="scenePreviewHelp" data-i18n-aria-label="已保存的二维场景预览"></canvas>
    <aside><h3 data-i18n="场景对象"></h3><label class="scene-field"><span data-i18n="搜索场景对象与分组"></span><input id="scenePreviewSearch" type="search"></label><ol id="scenePreviewObjects"></ol><p id="scenePreviewSelection" role="status" aria-live="polite"></p>
    <section id="scenePreviewInspector" aria-labelledby="scenePreviewInspectorTitle"><h3 id="scenePreviewInspectorTitle" data-i18n="对象属性"></h3><div id="scenePreviewProperties"></div><button id="scenePreviewCompositionOverride" type="button" class="doc-btn" hidden data-i18n="编辑此实例覆盖"></button><p id="scenePreviewCompositionOverrideHint" class="build-hint" hidden></p></section></aside></div>
    <div class="scene-preview-toolbar"><button id="scenePreviewDraftLayoutEdit" type="button" class="doc-btn" hidden data-i18n="调整草稿布局"></button><button id="scenePreviewLayoutEdit" type="button" class="doc-btn" data-i18n="编辑场景布局"></button><button id="scenePreviewEdit" type="button" class="doc-btn" data-i18n="编辑场景"></button>
    <button id="scenePreviewSource" type="button" class="doc-btn doc-btn-ghost"></button></div>
    <ul id="scenePreviewDiagnostics" class="scene-diagnostics"></ul>`;
  const el = id => container.querySelector(`#${id}`);
  const node = (tag, text, className = '') => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; };
  let available = false, visible = false, sceneId = '', requestEpoch = 0, controller = null, model = null, selected = null, disposed = false;
  let state = 'empty', errorKey = '', diagnostics = [], imageErrors = [], images = new Map();
  let selectedGroup = null, compositionOverrideOpening = false;
  let sceneSourceSignature = '';
  let inspectorSignature = '', loadingKind = 'saved', diagnosticsOrigin = null, pendingPreview = null, loadingDraftToken = null, wantedDraft = false, modelReleased = false, modelDraftToken = null, draftLayoutOpening = false;
  const revisionPattern = /^sha256:[a-f0-9]{64}$/;
  const canPreviewDraft = () => { const context = getContext(); return context.canPreviewDraft === true && !context.creating && !context.busy; };
  const isComposition = () => Boolean(model?.composition || getContext().previewKind === 'composition');
  const canEditDraftLayout = () => Boolean(!isComposition() && model?.draft && state === 'ready' && visible && available && !disposed
    && canPreviewDraft() && getContext().editable && getContext().canEditDraftLayout === true && getContext().sceneDraftToken === modelDraftToken);
  const canEditCompositionOverride = () => {
    const context = getContext();
    return Boolean(model?.composition && state === 'ready' && available && visible && !disposed && selected
      && model.actors.some(actor => sceneActorIdentity(actor) === selected) && context.canEditCompositionOverride === true
      && context.compositionSourceWritable === true && context.editable && !context.creating && !context.busy
      && context.sceneDraftPath === model.scene.sourcePath
      && (context.dirty ? model.draft && context.sceneDraftToken === modelDraftToken : !model.draft));
  };
  function renderCompositionOverride() {
    const actor = model?.actors.find(item => sceneActorIdentity(item) === selected), context = getContext();
    const button = el('scenePreviewCompositionOverride'); button.hidden = !model?.composition || !actor;
    button.disabled = compositionOverrideOpening || !canEditCompositionOverride();
    const hint = el('scenePreviewCompositionOverrideHint');
    hint.hidden = button.hidden || !button.disabled;
    hint.textContent = t(context.compositionSourceWritable && context.dirty
      ? '原文有未保存修改，请先预览当前草稿，再编辑此实例覆盖。'
      : '请先在源码模式打开同一配方，再编辑此实例覆盖。');
  }
  const modelOrigin = () => model ? { sourcePath: model.scene.sourcePath, draft: model.draft || null } : null;
  const canvas = createScenePreviewCanvas({ canvas: el('scenePreviewCanvas'), onSelect(id) { selectedGroup = null; selected = id; renderSelection(); },
    onViewChange(view) { el('scenePreviewZoom').textContent = `${Math.round(view.scale * 100)}%`; } });
  const release = id => {
    if (!previewUUID.test(id || '')) return;
    void fetchJsonApiRequest(`${PREVIEW_API}?previewId=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }, 5000, t('释放场景预览')).catch(() => {});
  };
  function releaseModel() { if (!modelReleased && model) { release(model.previewId); modelReleased = true; } }
  function disposeImages(values) { for (const image of values.values()) { image.width = 0; image.height = 0; } values.clear(); }
  function disposePending() {
    if (!pendingPreview) return;
    release(pendingPreview.payload.previewId); disposeImages(pendingPreview.images); pendingPreview = null;
  }
  function cancelRequest() { requestEpoch++; controller?.abort(); controller = null; disposePending(); }
  function reset() {
    cancelRequest();
    releaseModel(); outline.reset(); model = null; selected = null; selectedGroup = null; diagnostics = []; imageErrors = [];
    canvas.setScene(null); canvas.setImages(new Map());
    disposeImages(images);
    images = new Map(); state = 'empty'; errorKey = ''; diagnosticsOrigin = null; inspectorSignature = '';
  }
  async function navigate(location, origin = modelOrigin()) {
    const target = origin?.draft && location.sourcePath === origin.sourcePath
      ? { ...location, sourceRevision: origin.draft.sourceRevision, previewDraft: true } : location;
    try { await openSource(target.sourcePath, target); }
    catch { errorKey = '无法打开原文，请返回编辑器查找该文档。'; render(); }
  }
  function sourceButton(label, location, id, origin = modelOrigin()) {
    const button = node('button', t(label), 'doc-btn doc-btn-ghost'); button.type = 'button'; if (id) button.id = id;
    button.dataset.propertyPath = location.propertyPath || '';
    button.addEventListener('click', () => void navigate(location, origin)); return button;
  }
  const outline = createSceneOutline({ root: el('scenePreviewObjects'), search: el('scenePreviewSearch'),
    onActorSelect(id) { selectedGroup = null; selected = id; canvas.select(selected); renderSelection(); },
    onGroupSource(id) {
      const location = model?.sourceLocations?.groups?.find(group => group.groupId === id);
      if (!location) return;
      if (model?.composition) { selectedGroup = id; selected = null; canvas.select(null); renderSelection(); }
      else void navigate(location.fields?.name || location.declaration);
    },
  });
  const roleLabels = { template: '片段字段', override: '局部覆盖', offset: '放置偏移', identity: '身份映射' };
  function appendSources(cell, location, label = '查看字段来源', origin = modelOrigin()) {
    if (!location) return;
    if (isComposition() && Array.isArray(location.contributors) && location.contributors.length) {
      for (const contribution of location.contributors) {
        const link = sourceButton(roleLabels[contribution.role] || '查看字段来源', contribution, undefined, origin);
        link.dataset.compositionRole = contribution.role;
        link.setAttribute('aria-label', t('查看 {0} 的来源', `${t(label)} · ${t(roleLabels[contribution.role] || '查看字段来源')}`));
        cell.append(link);
      }
    } else {
      const link = sourceButton('查看字段来源', location, undefined, origin); link.setAttribute('aria-label', t('查看 {0} 的来源', t(label))); cell.append(link);
    }
  }
  function declarationSource(location) {
    return model?.composition ? location?.contributors?.find(item => item.role === 'template') || location : location;
  }
  function appendIdentitySource(row, declaration) {
    const identity = model?.composition && declaration?.contributors?.find(item => item.role === 'identity');
    if (identity) { const link = sourceButton('身份映射', identity); link.dataset.compositionRole = 'identity'; row.append(link); }
  }
  function appendCompositionIdentity(properties, composition) {
    if (!composition) return;
    for (const [label, key] of [['片段', 'fragmentId'], ['放置', 'placementId'], ['局部标识', 'localKey']]) {
      properties.append(node('p', `${t(label)} · ${composition[key]}`, 'build-monospace'));
    }
  }
  function renderSelection() {
    renderCompositionOverride();
    const actors = model?.actors || [], actor = actors.find(item => sceneActorIdentity(item) === selected);
    const provenance = Array.isArray(model?.sourceLocations?.actors) ? model.sourceLocations.actors.find(item => sceneActorIdentity(item) === sceneActorIdentity(actor)) : null;
    const group = model?.sceneStructure?.groups?.find(item => item.groupId === selectedGroup);
    const groupProvenance = model?.sourceLocations?.groups?.find(item => item.groupId === selectedGroup);
    outline.setSelection(selected ? [selected] : []);
    const properties = el('scenePreviewProperties');
    el('scenePreviewInspector').hidden = !actor && !group;
    el('scenePreviewSelection').textContent = actor || group ? t('已选择：{0}', (actor || group).name) : t('从画布或对象列表选择角色。');
    el('scenePreviewInspectorTitle').textContent = actor || group ? `${t('对象属性')} · ${(actor || group).name}` : t('对象属性');
    const signature = JSON.stringify([actor || null, provenance, group, groupProvenance, modelOrigin(), t('查看字段来源'), t('位置（中心）')]);
    if (signature === inspectorSignature) return;
    inspectorSignature = signature; properties.replaceChildren();
    if (group && model?.composition) {
      appendCompositionIdentity(properties, groupProvenance?.composition);
      for (const [field, label] of [['name', '分组名称'], ['parentGroupId', '父分组']]) {
        const location = groupProvenance?.fields?.[field];
        if (location) { const row = node('p', `${t(label)} · ${group[field] || ''}`); appendSources(row, location, label); properties.append(row); }
      }
      const identity = node('p', group.groupId, 'build-monospace'); appendIdentitySource(identity, groupProvenance?.declaration); properties.append(identity);
      if (groupProvenance?.declaration) properties.append(sourceButton('打开片段声明', declarationSource(groupProvenance.declaration), 'scenePreviewGroupSource'));
      return;
    }
    if (!actor) return;
    appendCompositionIdentity(properties, provenance?.composition);
    const list = node('dl', '', 'scene-preview-properties');
    const rows = [['位置（中心）', 'position', actor.position.join(', ')], ['尺寸', 'size', actor.size.join(' × ')], ['颜色', 'color', actor.color],
      ['速度', 'speed', String(actor.speed)], ['控制', 'controls', t(actor.controls === 'arrows' ? '方向键' : '不接受输入')], ['场景图片', 'imageResourceId', actor.imageResourceId || t('不使用图片')]];
    for (const [label, field, value] of rows) {
      list.append(node('dt', t(label))); const cell = node('dd', value);
      const location = provenance?.fields?.[field] || actor.fieldSources?.[field] || { ...actor.declaration, propertyPath: `${actor.declaration.propertyPath}/${field}` };
      const inherited = location.sourcePath === actor.sourcePath && location.sourcePath !== model.scene.sourcePath;
      cell.append(node('small', t(inherited ? '继承自投影' : '场景中的值')));
      appendSources(cell, location, label);
      if (field === 'size') for (const [axis, label] of [['size/0', '宽度'], ['size/1', '高度']]) {
        const axisLocation = provenance?.fields?.[axis];
        if (axisLocation) {
          if (model?.composition && axisLocation.contributors?.length) appendSources(cell, axisLocation, label);
          else { const link = sourceButton(label, axisLocation); link.setAttribute('aria-label', t('查看 {0} 的来源', t(label))); cell.append(link); }
        }
      }
      list.append(cell);
    }
    if (actor.instanceId) { const identity = node('p', `${t('实例身份')} · ${actor.instanceId}`, 'build-monospace'); appendIdentitySource(identity, provenance?.declaration); properties.append(identity); }
    properties.append(list, node('p', actor.objectId, 'build-monospace'), sourceButton('打开对象原文', provenance?.definition || { objectId: actor.objectId, sourcePath: actor.sourcePath }, 'scenePreviewActorSource'));
    properties.append(sourceButton(model?.composition ? '打开片段声明' : '打开场景声明', declarationSource(provenance?.declaration || actor.declaration), 'scenePreviewDeclarationSource'));
    if (actor.origin) properties.append(sourceButton('打开原 OC', actor.origin, 'scenePreviewOriginSource'));
  }
  function render() {
    translatePage(container); const context = getContext();
    if (state === 'loading' && loadingKind === 'draft' && (!canPreviewDraft() || context.sceneDraftToken !== loadingDraftToken)) {
      const changed = context.sceneDraftToken !== loadingDraftToken;
      cancelRequest(); state = 'error'; errorKey = changed ? '草稿已变化，请重新预览。' : '当前场景草稿不可预览，请回到对应场景原文后重试。';
    }
    const busy = state === 'loading';
    container.dataset.scenePreviewState = state; container.setAttribute('aria-busy', String(busy));
    el('scenePreviewDraft').hidden = Boolean(model?.draft) || (!context.dirty && !context.creating);
    el('scenePreviewRefresh').textContent = t(isComposition() ? '预览已保存配方' : '预览已保存场景');
    el('scenePreviewRefresh').disabled = !available || !sceneId || busy;
    el('scenePreviewDraftRefresh').disabled = !available || !sceneId || busy || !canPreviewDraft();
    for (const id of ['scenePreviewFit', 'scenePreviewZoomIn', 'scenePreviewZoomOut', 'scenePreviewGrid']) el(id).disabled = !model;
    el('scenePreviewEdit').hidden = isComposition();
    el('scenePreviewEdit').disabled = isComposition() || !model || Boolean(model.draft) || busy || !context.editable || context.dirty || context.creating || context.busy || context.canEditScene === false;
    el('scenePreviewSource').disabled = !model;
    el('scenePreviewSource').textContent = t(isComposition() ? '打开配方原文' : '打开场景原文');
    el('scenePreviewLayoutEdit').hidden = isComposition() || !model?.sceneEditing || Boolean(model?.draft);
    el('scenePreviewLayoutEdit').disabled = state !== 'ready' || el('scenePreviewEdit').disabled;
    el('scenePreviewDraftLayoutEdit').hidden = isComposition() || !model?.draft;
    el('scenePreviewDraftLayoutEdit').disabled = draftLayoutOpening || !canEditDraftLayout();
    el('scenePreviewMessage').textContent = errorKey ? t(errorKey) : t(busy
      ? loadingKind === 'draft' ? '正在读取当前草稿与图片…' : '正在读取已保存场景与图片…'
      : state === 'ready' ? imageErrors.length ? '场景已载入，部分图片无法显示；占位图不会修改原始素材。'
        : model?.draft ? '已载入当前草稿的布局；草稿尚未保存。' : '已载入保存时的布局。修改场景或投影后，刷新预览查看变化。'
        : state === 'invalid' ? '场景无法预览，请检查下方诊断。' : '请选择场景以查看预览。');
    el('scenePreviewProvenance').textContent = model ? t(state === 'error' || state === 'invalid'
      ? model.draft ? '当前画面：上一次有效草稿预览。' : '当前画面：上一次有效的已保存场景预览。'
      : model.composition ? model.draft ? '当前画面：未保存配方草稿的展开结果。投影和素材使用已保存内容。' : '当前画面：已保存配方的展开结果。'
      : model.draft ? '当前画面：未保存草稿。投影和素材使用已保存内容。' : '当前画面：已保存场景。') : '';
    el('scenePreviewCanvas').setAttribute('aria-label', t(model?.draft ? '未保存的二维场景草稿预览' : '已保存的二维场景预览'));
    el('scenePreviewComposition').hidden = !isComposition();
    el('scenePreviewComposition').textContent = `${t('配方预览（只读）')} · ${t('该预览由配方展开生成；请编辑配方原文以修改布局。')}`;
    const sceneSources = el('scenePreviewSceneSources'); sceneSources.hidden = !model?.composition;
    const sourceSignature = JSON.stringify([model?.composition, model?.sourceLocations?.sceneFields, modelOrigin(), t('查看字段来源')]);
    if (sourceSignature !== sceneSourceSignature) {
      sceneSourceSignature = sourceSignature; sceneSources.replaceChildren();
      if (model?.composition) for (const [field, label] of [['title', '标题'], ['viewport', '画布尺寸'], ['background', '背景颜色']]) {
        const location = model.sourceLocations?.sceneFields?.[field];
        if (location) { const link = sourceButton(label, location); link.setAttribute('aria-label', t('查看 {0} 的来源', t(label))); sceneSources.append(link); }
      }
    }
    el('scenePreviewSummary').textContent = model ? `${t('{0} × {1} · {2} 个角色', ...model.scene.viewport, model.actors.length)} · ${model.composition ? t('配方：{0} 个片段 · {1} 次放置', model.composition.fragmentCount, model.composition.placementCount) : t('快照：{0}', model.snapshotId)}` : '';
    el('scenePreviewCanvas').hidden = !model || !visible; el('scenePreviewHelp').hidden = !model || !visible;
    outline.setModel({ groups: model?.sceneStructure?.groups || [], actors: model ? sceneStructureActors(model.sceneStructure, model.actors) : [] });
    renderSelection();
    const issues = el('scenePreviewDiagnostics'); issues.replaceChildren();
    if (diagnostics.length) issues.append(node('li', t(diagnosticsOrigin?.kind === 'draft' ? '以下诊断来自本次草稿。' : '以下诊断来自已保存内容。'), 'build-hint'));
    for (const diagnostic of diagnostics) {
      const item = node('li', ''); item.append(node('p', `${t(diagnosticLabels[diagnostic.code] || '场景无法预览，请打开标出位置检查。')} (${diagnostic.code || 'scene_preview_failed'})`));
      if (isComposition() && diagnostic.contributors?.length) appendSources(item, diagnostic, '查看字段来源', diagnosticsOrigin);
      else if (diagnostic.sourcePath) { const link = sourceButton('打开原文', diagnostic, undefined, diagnosticsOrigin); link.textContent += ` · ${diagnostic.sourcePath}${diagnostic.propertyPath || ''}`; item.append(link); } issues.append(item);
    }
    for (const id of imageErrors) issues.append(node('li', t('图片无法解码或超过预览内存限制：{0}', id)));
  }
  async function decode(resource, signal, epoch, payload) {
    const url = new URL(resource.url, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || url.pathname !== PREVIEW_API || url.searchParams.get('previewId') !== payload.previewId || url.searchParams.get('resourceId') !== resource.id) throw new Error('Invalid preview resource URL');
    const blob = await fetchWithTimeout(url.href, { cache: 'no-store', signal }, 15000, t('读取预览图片'), async response => {
      if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
      const value = await response.blob(); if (value.size !== resource.size) throw new Error('Image size changed'); return value;
    });
    if (signal.aborted || epoch !== requestEpoch) throw new DOMException('Aborted', 'AbortError');
    const users = payload.actors.filter(actor => actor.imageResourceId === resource.id);
    const width = Math.max(1, ...users.map(actor => Math.ceil(actor.size[0]))), height = Math.max(1, ...users.map(actor => Math.ceil(actor.size[1])));
    const urlObject = URL.createObjectURL(blob), image = new Image();
    try {
      await new Promise((resolve, reject) => {
        const abort = () => { cleanup(); image.src = ''; reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('Image decode timeout')); }, 15000);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        image.onload = () => { cleanup(); resolve(); }; image.onerror = () => { cleanup(); reject(new Error('Image decode failed')); };
        signal.addEventListener('abort', abort, { once: true }); image.src = urlObject;
      });
      if (signal.aborted || epoch !== requestEpoch) throw new DOMException('Aborted', 'AbortError');
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024) throw new Error('Image dimensions exceed preview limit');
      const decoded = document.createElement('canvas'); decoded.width = width; decoded.height = height;
      decoded.getContext('2d').drawImage(image, 0, 0, width, height); return decoded;
    } finally { URL.revokeObjectURL(urlObject); image.onload = null; image.onerror = null; image.src = ''; }
  }
  async function refresh(kind = 'saved') {
    if (!available || !visible || !sceneId || disposed || (kind === 'draft' && !canPreviewDraft())) return;
    wantedDraft = kind === 'draft';
    if (kind === 'saved') reset(); else cancelRequest();
    const epoch = requestEpoch, requestedScene = sceneId, draftToken = getContext().sceneDraftToken;
    loadingDraftToken = draftToken;
    controller = new AbortController(); const signal = controller.signal;
    loadingKind = kind; state = 'loading'; errorKey = ''; diagnostics = []; diagnosticsOrigin = null; render();
    const ownsRequest = () => epoch === requestEpoch && !signal.aborted && sceneId === requestedScene && visible && available && !disposed;
    const assertDraftContext = () => {
      if (kind !== 'draft') return;
      if (getContext().sceneDraftToken !== draftToken) throw Object.assign(new Error('Draft changed'), { draftChanged: true });
      if (!canPreviewDraft()) throw Object.assign(new Error('Draft unavailable'), { draftUnavailable: true });
    };
    let draft = null, candidate = null;
    try {
      if (kind === 'draft') {
        draft = await getDraft(requestedScene);
        if (!ownsRequest()) return;
        assertDraftContext();
        if (!draft || typeof draft.sourcePath !== 'string' || !revisionPattern.test(draft.baseSourceRevision || '') || typeof draft.content !== 'string') {
          throw Object.assign(new Error('Draft unavailable'), { draftUnavailable: true });
        }
        // Detach the request from the editor's mutable draft object before any I/O.
        draft = { sourcePath: draft.sourcePath, baseSourceRevision: draft.baseSourceRevision, content: draft.content };
      }
      const { payload } = await fetchJsonApiRequest(PREVIEW_API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: requestedScene, ...(draft ? { draft } : {}) }), signal }, 30000, t('读取场景预览'));
      if (!ownsRequest()) { release(payload?.previewId); return; }
      try { assertDraftContext(); } catch (error) { release(payload?.previewId); throw error; }
      if (!payload?.ok || payload.format !== 'viento-scene-preview' || ![1, 2].includes(payload.schemaVersion) || !previewUUID.test(payload.previewId || '') || payload.scene?.objectId !== requestedScene || !Array.isArray(payload.actors) || !Array.isArray(payload.resources)
        || payload.actors.some(actor => !previewUUID.test(actor?.objectId || '') || (payload.schemaVersion === 2 ? !previewUUID.test(actor.instanceId || '') : Object.hasOwn(actor, 'instanceId')))
        || new Set(payload.actors.map(sceneActorIdentity)).size !== payload.actors.length
        || (kind === 'draft' ? payload.scene.sourcePath !== draft.sourcePath || payload.draft?.baseSourceRevision !== draft.baseSourceRevision
          || !revisionPattern.test(payload.draft?.sourceRevision || '') || Object.hasOwn(payload, 'sceneEditing') : Object.hasOwn(payload, 'draft'))) {
        release(payload?.previewId); throw Object.assign(new Error('Invalid preview response'), { payload });
      }
      const composition = payload.composition;
      if (getContext().previewKind === 'composition' && !composition || composition && (
        composition.format !== 'viento-scene-composition-preview' || composition.schemaVersion !== 1
        || composition.recipeObjectId !== requestedScene || composition.sourcePath !== payload.scene.sourcePath
        || !revisionPattern.test(composition.sourceRevision || '') || composition.sourceRevision !== payload.scene.sourceRevision
        || !Number.isInteger(composition.fragmentCount) || composition.fragmentCount < 1 || composition.fragmentCount > 32
        || !Number.isInteger(composition.placementCount) || composition.placementCount < 1 || composition.placementCount > 128
        || kind === 'draft' && composition.sourceRevision !== payload.draft.sourceRevision)) {
        release(payload.previewId); throw Object.assign(new Error('Invalid composition preview response'), { payload });
      }
      try { sceneStructureActors(payload.sceneStructure, payload.actors); }
      catch (error) { release(payload.previewId); throw error; }
      candidate = { payload, images: new Map(), imageErrors: [] }; pendingPreview = candidate;
      let cursor = 0, pixelCount = 0;
      const worker = async () => {
        while (ownsRequest() && cursor < payload.resources.length) {
          const resource = payload.resources[cursor++];
          try {
            const actors = payload.actors.filter(actor => actor.imageResourceId === resource.id);
            pixelCount += Math.max(1, ...actors.map(actor => Math.ceil(actor.size[0]))) * Math.max(1, ...actors.map(actor => Math.ceil(actor.size[1])));
            if (pixelCount > 16 * 1024 * 1024) throw new Error('Preview image memory limit');
            const image = await decode(resource, signal, epoch, payload);
            if (!ownsRequest()) { image.width = 0; image.height = 0; return; }
            candidate.images.set(resource.id, image);
          } catch { if (ownsRequest()) candidate.imageErrors.push(resource.id); }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!ownsRequest()) return;
      assertDraftContext();
      const previousModel = model, previousImages = images, previousReleased = modelReleased;
      model = payload; modelDraftToken = kind === 'draft' ? draftToken : null; modelReleased = false; images = candidate.images; imageErrors = candidate.imageErrors; pendingPreview = null;
      if (!model.actors.some(actor => sceneActorIdentity(actor) === selected)) selected = null;
      if (!model.sceneStructure?.groups?.some(group => group.groupId === selectedGroup)) selectedGroup = null;
      canvas.setScene(model); canvas.setImages(images); canvas.select(selected); canvas.setVisible(true);
      if (!previousReleased) release(previousModel?.previewId); disposeImages(previousImages);
      state = 'ready'; render();
    } catch (error) {
      if (!ownsRequest()) return;
      if (pendingPreview === candidate) disposePending();
      diagnostics = error.payload?.diagnostics || error.payload?.data?.diagnostics || [];
      const failureDraft = error.payload?.draft || error.payload?.data?.draft;
      diagnosticsOrigin = { kind, sourcePath: draft?.sourcePath || model?.scene.sourcePath,
        draft: kind === 'draft' && revisionPattern.test(failureDraft?.sourceRevision || '') ? failureDraft : null };
      if (kind === 'draft') {
        state = diagnostics.length ? 'invalid' : 'error';
        errorKey = error.draftChanged ? '草稿已变化，请重新预览。'
          : error.draftUnavailable || !canPreviewDraft() ? '当前场景草稿不可预览，请回到对应场景原文后重试。'
          : error.payload?.errorCode === 'scene_preview_request_invalid' ? '草稿过大或参数无效；场景草稿最多支持 128 KiB。'
          : error.payload?.errorCode === 'scene_preview_draft_conflict' ? '已保存原文已变化；请处理编辑冲突后重新预览草稿。'
          : model ? '草稿有误；当前显示上一次有效预览。' : '草稿无法预览，请检查原文与下方诊断。';
      } else if (diagnostics.length) state = 'invalid';
      else { state = 'error'; errorKey = ['build_input_changed', 'world_read_conflict', 'scene_preview_superseded'].includes(error.payload?.errorCode)
        ? '工程内容正在变化，请刷新场景预览重试。' : '场景预览读取失败，请刷新重试。'; }
      render();
    } finally { if (epoch === requestEpoch) controller = null; }
  }
  el('scenePreviewRefresh').addEventListener('click', () => { if (state !== 'loading') void refresh(); });
  el('scenePreviewDraftRefresh').addEventListener('click', () => { if (state !== 'loading') void refresh('draft'); });
  el('scenePreviewFit').addEventListener('click', () => canvas.fit());
  el('scenePreviewZoomIn').addEventListener('click', () => canvas.zoom(1.25));
  el('scenePreviewZoomOut').addEventListener('click', () => canvas.zoom(0.8));
  el('scenePreviewGrid').addEventListener('change', () => canvas.setGrid(el('scenePreviewGrid').checked));
  el('scenePreviewSource').addEventListener('click', () => { if (model) void navigate(model.sourceLocations?.scene || { objectId: model.scene.objectId, sourcePath: model.scene.sourcePath }); });
  el('scenePreviewEdit').addEventListener('click', () => {
    const context = getContext(); if (!isComposition() && model && !model.draft && state !== 'loading' && context.editable && !context.dirty && !context.creating && !context.busy && context.canEditScene !== false) editScene(sceneId);
  });
  el('scenePreviewLayoutEdit').addEventListener('click', () => {
    const context = getContext();
    if (!isComposition() && model?.sceneEditing && !model.draft && state === 'ready' && context.editable && !context.dirty && !context.creating && !context.busy && context.canEditScene !== false) {
      if (editLayout({ model, images }) === false) { errorKey = '布局编辑暂不可用，请刷新场景预览重试。'; render(); }
    }
  });
  el('scenePreviewDraftLayoutEdit').addEventListener('click', async () => {
    if (draftLayoutOpening || !canEditDraftLayout()) return;
    const openingModel = model, epoch = requestEpoch, token = getContext().sceneDraftToken;
    const isCurrent = () => canEditDraftLayout() && model === openingModel && requestEpoch === epoch && getContext().sceneDraftToken === token;
    draftLayoutOpening = true; render();
    try {
      const opened = await editDraftLayout({ model: openingModel, images, isCurrent });
      if (opened === false && isCurrent()) errorKey = '草稿布局编辑暂不可用，请重新预览当前草稿后重试。';
    } catch {
      if (isCurrent()) errorKey = '草稿布局编辑暂不可用，请重新预览当前草稿后重试。';
    } finally { draftLayoutOpening = false; if (!disposed) render(); }
  });
  el('scenePreviewCompositionOverride').addEventListener('click', async () => {
    if (compositionOverrideOpening || !canEditCompositionOverride()) return;
    const openingModel = model, instanceId = selected, epoch = requestEpoch, token = getContext().sceneDraftToken;
    const isCurrent = () => canEditCompositionOverride() && model === openingModel && selected === instanceId
      && requestEpoch === epoch && getContext().sceneDraftToken === token;
    compositionOverrideOpening = true; render();
    try {
      const opened = await editCompositionOverride({ model: openingModel, instanceId, isCurrent });
      if (opened === false && isCurrent()) errorKey = '实例覆盖编辑暂不可用，请重新预览当前配方后重试。';
    } catch {
      if (isCurrent()) errorKey = '实例覆盖编辑暂不可用，请重新预览当前配方后重试。';
    } finally { compositionOverrideOpening = false; if (!disposed) render(); }
  });
  const unsubscribe = onLanguageChange(() => { if (!disposed) { render(); outline.refresh(); } }); render();
  return {
    setAvailable(value) { if (available === value) { render(); return; } available = value; if (!value) { wantedDraft = false; reset(); } render(); if (value && visible) void refresh(); },
    setScene(value) { if (sceneId === value) { render(); return; } sceneId = value || ''; wantedDraft = false; reset(); render(); if (visible) void refresh(); },
    setVisible(value) {
      if (visible === value) { render(); return; }
      visible = value; canvas.setVisible(value);
      if (!value) {
        if (wantedDraft) {
          // The source editor sits behind this dialog. Keep one decoded snapshot
          // for a natural close/edit/reopen cycle, but release server resources.
          cancelRequest(); releaseModel(); state = model ? 'ready' : 'empty'; diagnostics = []; diagnosticsOrigin = null; errorKey = '';
        } else reset();
        render();
      } else void refresh(wantedDraft && canPreviewDraft() ? 'draft' : 'saved');
    },
    refreshDraft() {
      const context = getContext();
      // Applying positions can return the source exactly to its saved baseline.
      // A clean editor has no draft request; refresh the explicitly saved view.
      if (model?.draft && !context.dirty && !context.creating && context.sceneDraftPath === model.scene.sourcePath) {
        wantedDraft = false; return refresh('saved');
      }
      wantedDraft = true; return refresh('draft');
    },
    invalidate() { wantedDraft = false; reset(); render(); if (visible) void refresh(); },
    destroy() { disposed = true; visible = false; wantedDraft = false; reset(); unsubscribe?.(); canvas.destroy(); },
  };
}
