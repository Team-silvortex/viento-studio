import { SCENE_COMPOSITION_CREATE_API_PATH, SCENE_COMPOSITION_CREATE_MAX_ACTORS, validateCompositionCreateCatalog, prepareCompositionDraft, prepareCompositionDraftApply } from '../../engine/scene-composition-create.mjs';
import { planCompositionCreateLayout } from '../../engine/scene-composition-create-layout.mjs';
import { fetchJsonApiRequest } from './app-services.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// The form owns choices and a review. Its host owns the source draft; the
// ordinary document Save operation remains the only persistence step.
export function setupSceneCompositionCreate({ getContext = () => ({}), createDraft = async () => false } = {}) {
  const actions = document.getElementById('docEditActions');
  if (!actions) return Object.freeze({ open: () => false, refresh() {}, setAvailable() {}, dispose() {} });
  if (!document.getElementById('sceneCompositionCreateStyle')) {
    const style = document.createElement('link');
    style.id = 'sceneCompositionCreateStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-composition-create.css';
    (document.head || document.body).append(style);
  }
  const button = document.createElement('button');
  button.id = 'sceneCompositionCreateBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; actions.append(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'sceneCompositionCreateDialog'; dialog.className = 'scene-composition-create-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneCompositionCreateTitle');
  dialog.innerHTML = `<header class="scene-composition-create-header"><h2 id="sceneCompositionCreateTitle" data-i18n="新建场景配方"></h2><button id="sceneCompositionCreateClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="scene-composition-create-body"><p data-i18n="选择一个或多个对象创建可复用的二维场景配方，再用片段、放置与布局编辑器继续丰富。"></p>
      <p class="scene-composition-create-note" data-i18n="本次只创建 JSON 草稿；保存后才会登记到工程。对象、投影与素材原文保持不变。"></p>
      <button id="sceneCompositionCreateReload" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取对象"></button>
      <p id="sceneCompositionCreateEmpty" class="scene-composition-create-note" hidden data-i18n="暂无可用对象。请返回编辑器，在世界与对象中创建并保存对象，或为已有对象创建兼容二维场景的游戏投影。"></p>
      <fieldset id="sceneCompositionCreateFields"><legend data-i18n="场景配方设置"></legend><div class="scene-composition-create-grid">
        <label><span data-i18n="配方名称"></span><input id="sceneCompositionCreateName" type="text" maxlength="160" /></label>
        <label><span data-i18n="文档类型"></span><select id="sceneCompositionCreateType"></select></label>
        <label class="scene-composition-create-wide"><span data-i18n="JSON 原文路径"></span><input id="sceneCompositionCreatePath" type="text" maxlength="1024" spellcheck="false" aria-describedby="sceneCompositionCreatePathHint" /></label>
        <p id="sceneCompositionCreatePathHint" class="scene-composition-create-note scene-composition-create-wide" data-i18n="使用工程正文目录内未占用的 .json 路径。保存时会再次检查。"></p>
        <label class="scene-composition-create-wide"><span data-i18n="片段标识"></span><input id="sceneCompositionCreateFragment" type="text" maxlength="64" spellcheck="false" /></label>
        <p class="scene-composition-create-note scene-composition-create-wide" data-i18n="片段和演员标识使用英文字母、数字、短横线或下划线，并以字母开头。"></p>
        <label><span data-i18n="视口宽度"></span><input id="sceneCompositionCreateWidth" type="number" step="any" min="64" max="4096" /></label>
        <label><span data-i18n="视口高度"></span><input id="sceneCompositionCreateHeight" type="number" step="any" min="64" max="4096" /></label>
        <label class="scene-composition-create-wide"><span data-i18n="背景颜色（十六进制）"></span><input id="sceneCompositionCreateBackground" type="text" maxlength="9" spellcheck="false" /></label>
      </div>
      <h3 data-i18n="配方演员"></h3><p id="sceneCompositionCreateActorCount" class="scene-composition-create-note"></p>
      <div class="scene-composition-create-actors"><div class="scene-composition-create-actor-list">
        <label><span data-i18n="选择要编辑的演员"></span><select id="sceneCompositionCreateActorList" size="5"></select></label>
        <div class="scene-composition-create-actor-actions"><button id="sceneCompositionCreateAddActor" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加演员"></button><button id="sceneCompositionCreateRemoveActor" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除选中演员"></button></div>
      </div><div class="scene-composition-create-grid">
        <label class="scene-composition-create-wide"><span data-i18n="演员标识"></span><input id="sceneCompositionCreateActor" type="text" maxlength="64" spellcheck="false" /></label>
        <label class="scene-composition-create-wide"><span data-i18n="对象或二维投影"></span><select id="sceneCompositionCreateObject"></select></label>
        <label class="scene-composition-create-check scene-composition-create-wide"><input id="sceneCompositionCreateInherit" type="checkbox" /><span data-i18n="继承投影默认值"></span></label>
        <p id="sceneCompositionCreateInheritanceHint" class="scene-composition-create-note scene-composition-create-wide" data-i18n="仅游戏投影支持继承。关闭后使用配方的基础外观与行为，可在配方编辑器中继续调整。"></p>
        <label><span data-i18n="对象位置 X"></span><input id="sceneCompositionCreateX" type="text" inputmode="decimal" maxlength="32" spellcheck="false" /></label>
        <label><span data-i18n="对象位置 Y"></span><input id="sceneCompositionCreateY" type="text" inputmode="decimal" maxlength="32" spellcheck="false" /></label>
      </div></div>
      <p class="scene-composition-create-note" data-i18n="普通对象初始使用方向键控制，多个演员会一起移动；保存后可在片段编辑器调整。"></p>
      <details id="sceneCompositionCreateLayoutPanel" class="scene-composition-create-layout"><summary data-i18n="起始排布辅助"></summary>
        <p class="scene-composition-create-note" data-i18n="排布按演员列表顺序替换全部位置，不改变身份、对象和继承。间距为中心距离，不保证避免重叠。"></p>
        <div class="scene-composition-create-grid">
          <label><span data-i18n="排布方式"></span><select id="sceneCompositionCreateLayoutMode"><option value="row" data-i18n="横向排列"></option><option value="column" data-i18n="纵向排列"></option><option value="grid" data-i18n="网格排列"></option></select></label>
          <label><span data-i18n="网格列数"></span><input id="sceneCompositionCreateLayoutColumns" type="text" inputmode="numeric" maxlength="3" spellcheck="false" /></label>
          <label><span data-i18n="起点 X"></span><input id="sceneCompositionCreateLayoutOriginX" type="text" inputmode="decimal" maxlength="32" spellcheck="false" /></label>
          <label><span data-i18n="起点 Y"></span><input id="sceneCompositionCreateLayoutOriginY" type="text" inputmode="decimal" maxlength="32" spellcheck="false" /></label>
          <label><span data-i18n="水平中心间距"></span><input id="sceneCompositionCreateLayoutSpacingX" type="text" inputmode="decimal" maxlength="32" spellcheck="false" /></label>
          <label><span data-i18n="垂直中心间距"></span><input id="sceneCompositionCreateLayoutSpacingY" type="text" inputmode="decimal" maxlength="32" spellcheck="false" /></label>
        </div>
        <p class="scene-composition-create-note" data-i18n="先预览全部坐标，再应用到此表单。排布后仍需审阅完整 JSON；文档保存沿用编辑器的保存操作。"></p>
        <div class="scene-composition-create-layout-actions"><button id="sceneCompositionCreateLayoutReview" type="button" class="doc-btn doc-btn-ghost" data-i18n="预览排布"></button><button id="sceneCompositionCreateLayoutApply" type="button" class="doc-btn doc-btn-ghost" data-i18n="应用排布"></button><button id="sceneCompositionCreateLayoutUndo" type="button" class="doc-btn doc-btn-ghost" data-i18n="撤销本次排布"></button></div>
        <p id="sceneCompositionCreateLayoutStatus" class="scene-composition-create-note" role="status" aria-live="polite"></p>
        <section id="sceneCompositionCreateLayoutPreview" hidden aria-labelledby="sceneCompositionCreateLayoutPreviewTitle"><h4 id="sceneCompositionCreateLayoutPreviewTitle" data-i18n="全部演员：原坐标 → 新坐标"></h4><pre id="sceneCompositionCreateLayoutSource" tabindex="0" aria-labelledby="sceneCompositionCreateLayoutPreviewTitle"></pre></section>
      </details>
      </fieldset>
      <section id="sceneCompositionCreatePreview" hidden aria-labelledby="sceneCompositionCreatePreviewTitle"><h3 id="sceneCompositionCreatePreviewTitle" data-i18n="完整场景配方审阅"></h3><pre id="sceneCompositionCreateSource" tabindex="0" aria-labelledby="sceneCompositionCreatePreviewTitle"></pre></section>
    </div><p id="sceneCompositionCreateStatus" class="scene-composition-create-status" role="status" aria-live="polite"></p>
    <footer class="scene-composition-create-footer"><button id="sceneCompositionCreateReview" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅场景配方"></button><button id="sceneCompositionCreateApply" type="button" class="doc-btn" data-i18n="创建配方草稿"></button><button id="sceneCompositionCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneCompositionCreate' + suffix);
  const fields = ['Name', 'Type', 'Path', 'Object', 'Inherit', 'Fragment', 'Actor', 'Width', 'Height', 'X', 'Y', 'Background'];
  const layoutFields = ['LayoutMode', 'LayoutOriginX', 'LayoutOriginY', 'LayoutSpacingX', 'LayoutSpacingY', 'LayoutColumns'];
  let layoutPreview = null, layoutUndo = null, layoutMessage = '';
  let available = false, disposed = false, epoch = 0, owner = null, catalog = null, proposal = null, reviewed = '', baseline = '';
  let actors = [], selectedActorId = '';
  let phase = '', invalidated = false, message = '', opener = null, pendingFocus = null, requestController = null;
  const selectedActor = () => actors.find(actor => actor.instanceId === selectedActorId);
  const actorFields = () => ({ actorKey: el('Actor').value, objectId: el('Object').value, useProjectionDefaults: el('Inherit').checked === true,
    position: [el('X').value, el('Y').value] });
  const captureSelected = () => { const actor = selectedActor(); if (actor) Object.assign(actor, actorFields()); };
  const raw = () => ({ documentType: el('Type').value, sourcePath: el('Path').value, title: el('Name').value,
    fragmentId: el('Fragment').value, viewport: [el('Width').value, el('Height').value], background: el('Background').value,
    actors: actors.map(actor => ({ ...actor, ...(actor.instanceId === selectedActorId ? actorFields() : {}), position: actor.instanceId === selectedActorId ? [el('X').value, el('Y').value] : [...actor.position] })) });
  const number = value => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new TypeError('Invalid numeric field');
    return Number(value);
  };
  const signature = () => JSON.stringify(raw());
  const layoutRaw = () => ({ mode: el('LayoutMode').value, origin: [el('LayoutOriginX').value, el('LayoutOriginY').value],
    spacing: [el('LayoutSpacingX').value, el('LayoutSpacingY').value], columns: el('LayoutColumns').value });
  const layoutSignature = () => JSON.stringify(layoutRaw());
  const dirtySignature = () => JSON.stringify({ author: raw(), layout: layoutRaw() });
  const coreContext = context => ({ sourceToken: context.sourceToken, documentRoot: context.documentRoot,
    documentTypes: context.documentTypes?.map(item => ({ id: item.id, label: item.label })) });
  const eligible = context => available && !disposed && context.editable === true && !context.busy && !context.dirty && !context.creating
    && typeof context.sourceToken === 'string' && context.sourceToken.length > 0 && typeof context.documentRoot === 'string'
    && Array.isArray(context.documentTypes) && context.documentTypes.length > 0;
  const owns = (generation = epoch) => generation === epoch && dialog.open && owner && !invalidated && eligible(getContext())
    && JSON.stringify(coreContext(getContext())) === owner.signature;
  const selectedObject = () => catalog?.objects.find(item => item.id === el('Object').value);
  function clearReview() { proposal = null; reviewed = ''; el('Source').textContent = ''; }
  function options(select, values, selected) {
    select.replaceChildren();
    for (const [value, label] of values) { const item = document.createElement('option'); item.value = value; item.textContent = label; select.append(item); }
    if (selected && !values.some(([value]) => value === selected)) {
      const missing = document.createElement('option'); missing.value = selected; missing.textContent = t('已不可用：{0}', selected); select.append(missing);
    }
    select.value = selected;
  }
  function renderActorList() {
    options(el('ActorList'), actors.map((actor, index) => {
      const object = catalog?.objects.find(item => item.id === actor.objectId);
      const name = object?.name || (actor.objectId ? t('已不可用：{0}', actor.objectId) : t('未选择对象'));
      return [actor.instanceId, `${index + 1}. ${actor.actorKey || t('未命名演员')} · ${name}`];
    }), selectedActorId);
    el('ActorCount').textContent = t('演员 {0}/{1}；每个演员都有独立实例身份，可重复使用同一对象。', actors.length, SCENE_COMPOSITION_CREATE_MAX_ACTORS);
  }
  function renderSelectedActor() {
    const actor = selectedActor(); if (!actor) return;
    options(el('Object'), (catalog?.objects || []).map(item => [item.id, `${item.name} · ${item.sourcePath}`]), actor.objectId);
    el('Actor').value = actor.actorKey; el('Inherit').checked = actor.useProjectionDefaults;
    el('X').value = actor.position[0]; el('Y').value = actor.position[1];
  }
  function renderChoices() {
    captureSelected();
    options(el('Type'), (owner?.context.documentTypes || []).map(item => [item.id, item.label]), el('Type').value);
    renderSelectedActor(); renderActorList();
  }
  function changed() { clearLayout(); clearReview(); message = '填写配方设置，然后审阅完整 JSON。'; renderActorList(); render(); }
  function selectActor() {
    if (phase || !owns()) { el('ActorList').value = selectedActorId; return; }
    const next = actors.find(actor => actor.instanceId === el('ActorList').value); if (!next) return;
    captureSelected(); selectedActorId = next.instanceId; renderSelectedActor(); renderActorList(); render();
  }
  function addActor() {
    if (phase || !owns() || !catalog?.objects.length || actors.length >= SCENE_COMPOSITION_CREATE_MAX_ACTORS) return;
    captureSelected(); const previous = selectedActor();
    let instanceId;
    try { instanceId = crypto.randomUUID(); } catch { return; }
    if (instanceId === owner.placementId || actors.some(actor => actor.instanceId === instanceId) || catalog.existingIdentities.includes(instanceId)) return;
    const keys = new Set(actors.map(actor => actor.actorKey)); let suffix = 1, actorKey = 'actor';
    while (keys.has(actorKey)) actorKey = `actor${++suffix}`;
    let position = ['200', '220'];
    try {
      const x = number(previous.position[0]) + 96, y = number(previous.position[1]);
      if (Math.abs(x) <= 100000 && Math.abs(y) <= 100000) position = [String(x), previous.position[1]];
    } catch { /* Keep the explicit starter position for unfinished coordinates. */ }
    const objectId = previous?.objectId || catalog.objects[0].id;
    actors.push({ instanceId, actorKey, objectId, useProjectionDefaults: previous?.objectId ? previous.useProjectionDefaults : catalog.objects[0].canInheritProjection, position });
    selectedActorId = instanceId; renderSelectedActor(); changed(); el('Actor').focus();
  }
  function removeActor() {
    if (phase || !owns() || actors.length <= 1) return;
    captureSelected(); const index = actors.findIndex(actor => actor.instanceId === selectedActorId); if (index < 0) return;
    actors.splice(index, 1); selectedActorId = actors[Math.min(index, actors.length - 1)].instanceId;
    renderSelectedActor(); changed(); el('ActorList').focus();
  }
  function clearLayout() { layoutPreview = null; layoutUndo = null; layoutMessage = ''; }
  function layoutCurrent() { return layoutPreview && layoutPreview.author === signature() && layoutPreview.settings === layoutSignature(); }
  function layoutUndoCurrent() { return layoutUndo && layoutUndo.author === signature(); }
  function renderLayout(canChange) {
    if (layoutPreview && !layoutCurrent()) { layoutPreview = null; layoutMessage = '配方或排布设置已变化，请重新预览排布。'; }
    if (layoutUndo && !layoutUndoCurrent()) layoutUndo = null;
    for (const field of layoutFields) el(field).disabled = !canChange;
    el('LayoutReview').disabled = !canChange;
    el('LayoutApply').disabled = !canChange || !layoutCurrent() || layoutPreview.plan.changedCount === 0;
    el('LayoutUndo').disabled = !canChange || !layoutUndoCurrent();
    el('LayoutPreview').hidden = !layoutPreview;
    el('LayoutSource').textContent = layoutPreview ? layoutPreview.before.map((actor, index) => t('{0}：({1}, {2}) → ({3}, {4})', actor.actorKey,
      actor.position[0], actor.position[1], layoutPreview.plan.positions[index].position[0], layoutPreview.plan.positions[index].position[1])).join('\n') : '';
    el('LayoutStatus').textContent = t(layoutMessage);
  }
  function reviewLayout() {
    if (phase) return;
    layoutPreview = null;
    if (!owns()) { contextChanged(); render(); return; }
    try {
      const before = raw().actors, settings = layoutRaw();
      const plan = planCompositionCreateLayout(before.map(actor => ({ instanceId: actor.instanceId, position: actor.position.map(number) })), {
        mode: settings.mode, origin: settings.origin.map(number), spacing: settings.spacing.map(number), columns: number(settings.columns),
      });
      layoutPreview = { author: signature(), settings: layoutSignature(), before, plan };
      layoutMessage = plan.changedCount ? '请检查全部旧、新坐标；点击应用排布后才会修改演员位置。' : '全部演员已处于该排布，无需应用。';
    } catch { layoutMessage = '无法预览排布。请填写完整坐标和有效间距、列数；全部位置必须在允许范围内。'; }
    render();
  }
  function applyLayout() {
    if (phase) return;
    if (!owns()) { contextChanged(); render(); return; }
    if (!layoutCurrent()) { layoutPreview = null; layoutMessage = '配方或排布设置已变化，请重新预览排布。'; render(); return; }
    if (!layoutPreview.plan.changedCount) return;
    const before = raw().actors.map(actor => ({ instanceId: actor.instanceId, position: [...actor.position] }));
    captureSelected();
    for (const [index, actor] of actors.entries()) actor.position = layoutPreview.plan.positions[index].position.map(String);
    renderSelectedActor(); layoutUndo = { author: signature(), positions: before }; layoutPreview = null; clearReview();
    layoutMessage = '排布已应用到表单，可撤销本次排布。请重新审阅完整 JSON。';
    message = '填写配方设置，然后审阅完整 JSON。'; render();
  }
  function undoLayout() {
    if (phase) return;
    if (!owns()) { contextChanged(); render(); return; }
    if (!layoutUndoCurrent()) { layoutUndo = null; layoutMessage = '配方内容已变化，不能撤销旧排布。'; render(); return; }
    captureSelected();
    for (const [index, actor] of actors.entries()) actor.position = [...layoutUndo.positions[index].position];
    renderSelectedActor(); layoutUndo = null; layoutPreview = null; clearReview();
    layoutMessage = '已恢复排布前的全部坐标，请重新审阅完整 JSON。';
    message = '填写配方设置，然后审阅完整 JSON。'; render();
  }
  function render() {
    if (disposed) return;
    const context = getContext(); button.textContent = t('新建场景配方'); button.hidden = !available || context.editable !== true;
    button.disabled = !eligible(context) || dialog.open;
    if (!dialog.open) return;
    translatePage(dialog); dialog.dataset.dirty = String(dirtySignature() !== baseline); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    const canChange = !phase && owns();
    el('Fields').disabled = !canChange; renderLayout(canChange);
    for (const field of fields) el(field).disabled = !canChange;
    el('Inherit').disabled = !canChange || !selectedObject()?.canInheritProjection && !el('Inherit').checked;
    el('ActorList').disabled = !canChange;
    el('AddActor').disabled = !canChange || !catalog?.objects.length || actors.length >= SCENE_COMPOSITION_CREATE_MAX_ACTORS;
    el('RemoveActor').disabled = !canChange || actors.length <= 1;
    el('Reload').disabled = !canChange;
    el('Review').disabled = !canChange || !catalog?.objects.length;
    el('Apply').disabled = !canChange || !proposal || reviewed !== signature();
    el('Close').disabled = phase === 'applying'; el('Cancel').disabled = phase === 'applying';
    el('Empty').hidden = !catalog || catalog.objects.length !== 0;
    el('Preview').hidden = !proposal; el('Status').textContent = t(message);
  }
  function contextChanged() {
    invalidated = true; clearLayout(); clearReview(); message = '工程或编辑器已变化，设置已保留。请返回编辑器后重新打开。';
  }
  async function readCatalog(signal) {
    const { payload } = await fetchJsonApiRequest(SCENE_COMPOSITION_CREATE_API_PATH, { cache: 'no-store', signal }, 15000, t('读取配方可用对象'));
    const result = validateCompositionCreateCatalog(payload);
    if (result.documentRoot !== owner?.context.documentRoot || JSON.stringify(result.documentTypes) !== JSON.stringify(owner.context.documentTypes)) {
      throw Object.assign(new Error('The project types changed.'), { errorCode: 'composition_authoring_conflict' });
    }
    return result;
  }
  async function load(initial = false) {
    if (phase || !owns()) return;
    captureSelected();
    const generation = epoch; phase = 'loading'; clearReview(); message = '正在读取配方可用对象…';
    const controller = new AbortController(); requestController = controller; render();
    try {
      const result = await readCatalog(controller.signal);
      if (!owns(generation)) return;
      catalog = result;
      if (initial) {
        actors[0].objectId = catalog.objects[0]?.id || '';
        actors[0].useProjectionDefaults = Boolean(catalog.objects[0]?.canInheritProjection);
        renderSelectedActor();
      }
      renderChoices();
      if (initial) baseline = dirtySignature();
      message = catalog.objects.length ? '填写配方设置，然后审阅完整 JSON。' : '暂无可用对象，请先保存对象或创建二维游戏投影。';
    } catch (error) {
      if (disposed || generation !== epoch || !dialog.open) return;
      catalog = null;
      message = error?.errorCode === 'composition_authoring_conflict'
        ? '工程或编辑器已变化，设置已保留。请返回编辑器后重新打开。'
        : '无法读取配方可用对象。设置已保留，请重新读取或返回编辑器。';
      if (error?.errorCode === 'composition_authoring_conflict') invalidated = true;
    } finally {
      if (!disposed && generation === epoch && dialog.open) {
        requestController = null; phase = ''; if (!owns()) contextChanged(); render();
      }
    }
  }
  function review() {
    if (phase) return;
    clearReview();
    if (!owns()) contextChanged();
    else if (!catalog) message = '请先重新读取配方可用对象。';
    else {
      try {
        const request = raw();
        request.actors = request.actors.map(actor => ({ ...actor, position: actor.position.map(number) }));
        request.viewport = request.viewport.map(number);
        proposal = prepareCompositionDraft(owner.context, catalog, { ...request, placementId: owner.placementId });
        reviewed = signature(); el('Source').textContent = proposal.content;
        message = '配方已检查，请审阅完整 JSON；创建后可继续编辑，保存后才会登记。';
      } catch (error) {
        message = error?.errorCode === 'composition_authoring_path_conflict' ? '配方路径已被占用，请修改路径后重新审阅。'
          : '配方设置无效。请检查文档类型、JSON 路径、对象、标识、坐标、画布和背景颜色。';
      }
    }
    render();
  }
  function closeDialog(focus) {
    epoch++; requestController?.abort(); requestController = null; owner = null; catalog = null; clearLayout(); clearReview(); phase = '';
    dialog.dataset.dirty = 'false'; dialog.setAttribute('aria-busy', 'false'); pendingFocus = { epoch, focus: focus || (() => opener?.focus()) };
    dialog.close(); render();
  }
  function close() {
    if (phase === 'applying') return false;
    if (dirtySignature() !== baseline && !window.confirm(t('丢弃本次配方创建设置？编辑器内容不会改变。'))) return false;
    closeDialog(); return true;
  }
  async function apply() {
    if (phase || !owns()) { if (!phase) review(); return; }
    if (!proposal || reviewed !== signature()) { review(); return; }
    const generation = epoch, form = signature(), candidate = proposal;
    const isCurrent = () => owns(generation) && form === signature() && proposal === candidate;
    phase = 'applying'; message = '正在核对工程并打开配方草稿…';
    const controller = new AbortController(); requestController = controller; render();
    try {
      const freshCatalog = await readCatalog(controller.signal);
      if (!isCurrent()) return;
      prepareCompositionDraftApply(coreContext(getContext()), freshCatalog, candidate);
      const result = await createDraft(candidate, { catalog: freshCatalog, isCurrent });
      if (disposed || generation !== epoch || !dialog.open || form !== signature()) return;
      // A successful synchronous host mutation changes the editor identity.
      if (result?.applied === true) { closeDialog(typeof result.focus === 'function' ? result.focus : undefined); return; }
      message = '未创建配方草稿，设置已保留。请检查编辑器状态后重试。';
    } catch (error) {
      if (disposed || generation !== epoch || !dialog.open) return;
      if (['composition_authoring_conflict', 'composition_authoring_path_conflict'].includes(error?.errorCode)) {
        catalog = null; clearReview(); message = '工程对象或保存路径已变化。设置已保留，请重新读取对象并审阅。';
      } else message = '未创建配方草稿，设置已保留。请检查编辑器状态后重试。';
    } finally {
      if (!disposed && generation === epoch && dialog.open) {
        requestController = null; phase = ''; if (!owns()) contextChanged(); render();
      }
    }
  }
  function refresh() {
    if (disposed) return;
    if (dialog.open && !owns()) contextChanged(); render();
  }
  function open() {
    if (dialog.open || !eligible(getContext())) return false;
    const context = coreContext(getContext());
    let placementId, instanceId;
    try { placementId = crypto.randomUUID(); instanceId = crypto.randomUUID(); } catch { return false; }
    epoch++; owner = { context, signature: JSON.stringify(context), placementId }; opener = document.activeElement;
    catalog = null; clearLayout(); clearReview(); phase = ''; invalidated = false; pendingFocus = null;
    options(el('Type'), context.documentTypes.map(item => [item.id, item.label]), context.documentTypes.find(item => item.id === 'scene')?.id || context.documentTypes[0].id);
    actors = [{ instanceId, actorKey: 'actor', objectId: '', useProjectionDefaults: false, position: ['200', '220'] }];
    selectedActorId = instanceId; renderSelectedActor(); renderActorList();
    el('Name').value = t('新场景配方'); el('Path').value = `${context.documentRoot}/scenes/new-composition.json`;
    el('Fragment').value = 'main'; el('Actor').value = 'actor'; el('Width').value = '960'; el('Height').value = '540';
    el('X').value = '200'; el('Y').value = '220'; el('Background').value = '#142233';
    el('LayoutMode').value = 'row'; el('LayoutOriginX').value = '200'; el('LayoutOriginY').value = '220';
    el('LayoutSpacingX').value = '96'; el('LayoutSpacingY').value = '96'; el('LayoutColumns').value = '4'; el('LayoutPanel').open = false;
    baseline = dirtySignature();
    dialog.showModal(); void load(true); el('Close').focus(); return true;
  }
  button.addEventListener('click', open);
  for (const field of fields) for (const event of ['input', 'change']) el(field).addEventListener(event, () => {
    if (phase) return;
    if (field === 'Object') el('Inherit').checked = Boolean(selectedObject()?.canInheritProjection);
    captureSelected(); changed();
  });
  for (const field of layoutFields) for (const event of ['input', 'change']) el(field).addEventListener(event, () => {
    if (phase) return;
    layoutPreview = null; layoutMessage = ''; render();
  });
  el('LayoutReview').addEventListener('click', reviewLayout); el('LayoutApply').addEventListener('click', applyLayout); el('LayoutUndo').addEventListener('click', undoLayout);
  el('ActorList').addEventListener('change', selectActor); el('AddActor').addEventListener('click', addActor); el('RemoveActor').addEventListener('click', removeActor);
  el('Reload').addEventListener('click', () => void load()); el('Review').addEventListener('click', review);
  el('Apply').addEventListener('click', () => void apply()); el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && ['s', 'enter'].includes(event.key.toLowerCase())) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open || disposed) return;
    const pending = pendingFocus; pendingFocus = null;
    if (!pending) { epoch++; requestController?.abort(); requestController = null; owner = null; catalog = null; clearLayout(); clearReview(); phase = ''; dialog.dataset.dirty = 'false'; dialog.setAttribute('aria-busy', 'false'); }
    render(); if (pending?.epoch === epoch) pending.focus();
  });
  const unsubscribe = onLanguageChange(() => { if (dialog.open && !disposed) renderChoices(); refresh(); });
  refresh();
  return Object.freeze({ open, refresh, setAvailable(value) { available = value === true; refresh(); }, dispose() {
    if (disposed) return;
    disposed = true; epoch++; requestController?.abort(); requestController = null; owner = null; catalog = null; proposal = null; clearLayout(); phase = ''; pendingFocus = null;
    if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); button.remove();
  } });
}
