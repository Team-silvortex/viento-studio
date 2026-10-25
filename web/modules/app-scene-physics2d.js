import { supportsStudioCoreScenePhysics2DResponse, supportsStudioCoreScenePhysics2DMotion, supportsStudioCoreScenePhysics2DOneWay } from '../../engine/studio-core.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { isScenePhysics2DTargets, scenePhysics2DTargetsMatchSource, scenePhysics2DTargetValue, validateScenePhysics2DTargets } from '../../engine/scene-physics2d-targets.mjs';
import { isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource, createScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { isScenePhysics2DOffsetProposal, scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';
import { isScenePhysics2DResizeProposal, scenePhysics2DResizeProposalMatches } from '../../engine/scene-physics2d-space-resize.mjs';
import { setupScenePhysics2DSpace } from './app-scene-physics2d-space.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// Declaration authoring owns a form, a readonly saved-instance directory and a
// reviewed draft. It has no file, Save, physics solver or execution authority.
export function setupScenePhysics2D({ getContext = () => ({}), getSource = async () => null, getTargets = null, getSpace = null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('scenePhysics2DStyle')) {
    const style = document.createElement('link'); style.id = 'scenePhysics2DStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene-physics2d.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scenePhysics2DBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'scenePhysics2DDialog'; dialog.className = 'scene-physics2d-dialog';
  dialog.dataset.vientoCloseGuard = 'true'; dialog.setAttribute('aria-labelledby', 'scenePhysics2DTitle');
  dialog.innerHTML = `<header class="scene-physics2d-header"><h2 id="scenePhysics2DTitle" data-i18n="编辑二维物理"></h2>
    <button id="scenePhysics2DClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="scene-physics2d-body"><p data-i18n="编辑已有物理声明，检查后应用到原文草稿。"></p>
      <p class="scene-physics2d-note" data-i18n="目录核对已保存的实例身份；运动属性和构建条件仍由工程预检检查。"></p>
      <p id="scenePhysics2DPath" class="scene-physics2d-note"></p><p id="scenePhysics2DScene" class="scene-physics2d-note"></p>
      <section id="scenePhysics2DTargets" class="scene-physics2d-targets" aria-labelledby="scenePhysics2DTargetsTitle" hidden>
        <div class="scene-physics2d-targets-toolbar"><h3 id="scenePhysics2DTargetsTitle" data-i18n="场景实例目录"></h3><button id="scenePhysics2DTargetsRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新场景实例"></button></div>
        <p id="scenePhysics2DTargetsStatus" class="scene-physics2d-note" role="status" aria-live="polite"></p><p id="scenePhysics2DTargetsPath" class="scene-physics2d-note"></p>
        <p class="scene-physics2d-note" data-i18n="目录来自上次读取的已保存场景，不包含场景草稿。名称相同的实例用完整编号区分；缺失目标不会自动替换。"></p></section>
      <section id="scenePhysics2DSpace" class="scene-physics2d-space" aria-labelledby="scenePhysics2DSpaceTitle" hidden>
        <div class="scene-physics2d-targets-toolbar"><h3 id="scenePhysics2DSpaceTitle" data-i18n="场景中的碰撞形状"></h3><button id="scenePhysics2DSpaceEdit" type="button" class="doc-btn doc-btn-ghost" aria-pressed="false" data-i18n="调整碰撞偏移"></button><button id="scenePhysics2DSpaceResize" type="button" class="doc-btn doc-btn-ghost" aria-pressed="false" data-i18n="调整碰撞尺寸"></button><button id="scenePhysics2DSpaceRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新场景位置"></button></div>
        <p class="scene-physics2d-note" data-i18n="以已保存场景的位置显示检查过的物理参数；浅色框为实例逻辑尺寸。点击形状或列表选择碰撞体，不运行碰撞模拟。"></p>
        <p id="scenePhysics2DSpaceEditHint" class="scene-physics2d-note" data-i18n="调整模式只改变碰撞体相对实例的偏移；松手后更新参数表，仍需检查、审阅并保存。场景实例位置保持。" hidden></p>
        <p id="scenePhysics2DSpaceResizeHint" class="scene-physics2d-note" data-i18n="尺寸模式保持碰撞中心与偏移；拖动手柄后更新宽高或半径，仍需检查、审阅并保存。" hidden></p>
        <p id="scenePhysics2DSpaceStatus" class="scene-physics2d-note" role="status" aria-live="polite"></p><p id="scenePhysics2DSpacePath" class="scene-physics2d-note"></p>
        <div id="scenePhysics2DSpaceView" hidden></div></section>
      <section id="scenePhysics2DFields" class="scene-physics2d-fields" hidden><aside>
        <label for="scenePhysics2DBody" data-i18n="碰撞体"></label><select id="scenePhysics2DBody" size="8"></select>
        <p id="scenePhysics2DCount" class="scene-physics2d-note"></p><div class="scene-physics2d-actions">
          <button id="scenePhysics2DAdd" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加碰撞体"></button>
          <button id="scenePhysics2DRemove" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除碰撞体"></button></div></aside>
        <section class="scene-physics2d-detail"><h3 data-i18n="物理声明参数"></h3><p id="scenePhysics2DIdentity" class="scene-physics2d-note"></p>
          <label id="scenePhysics2DTargetField" for="scenePhysics2DTarget" hidden><span data-i18n="按场景实例名称选择"></span><select id="scenePhysics2DTarget" aria-describedby="scenePhysics2DTargetHint"></select></label>
          <p id="scenePhysics2DTargetHint" class="scene-physics2d-note" hidden></p>
          <label for="scenePhysics2DInstance" data-i18n="实例编号"></label><input id="scenePhysics2DInstance" type="text" lang="" spellcheck="false" aria-describedby="scenePhysics2DInstanceHint scenePhysics2DTargetHint">
          <p id="scenePhysics2DInstanceHint" class="scene-physics2d-note" data-i18n="手动填写已有场景实例的编号；不会新建或修改场景实例。"></p>
          <div class="scene-physics2d-grid"><label><span data-i18n="物理类型"></span><select id="scenePhysics2DKind">
            <option value="static" data-i18n="静态碰撞体"></option><option value="character" data-i18n="角色碰撞体"></option><option value="sensor" data-i18n="触发区域"></option></select></label>
            <label><span data-i18n="碰撞形状"></span><select id="scenePhysics2DShape"><option value="box" data-i18n="矩形"></option><option value="circle" data-i18n="圆形"></option></select></label></div>
          <section id="scenePhysics2DMotionSection" class="scene-physics2d-motion">
            <label><span data-i18n="角色移动方式"></span><select id="scenePhysics2DMotion" aria-describedby="scenePhysics2DMotionHint scenePhysics2DMotionUnavailable"><option value="free" data-i18n="自由平面"></option><option value="platformer" data-i18n="重力与跳跃"></option></select></label>
            <p id="scenePhysics2DMotionHint" class="scene-physics2d-note" data-i18n="启用重力与跳跃会同时选择滑动响应。左右键移动，空格或 Enter 在已着地时起跳；按住不会连续跳跃。水平速度沿用场景实例，不修改场景原文。"></p>
            <p id="scenePhysics2DMotionUnavailable" class="scene-physics2d-note" data-i18n="当前核心不支持此运动格式；旧格式的自由平面物理参数仍可编辑。" hidden></p>
            <div id="scenePhysics2DMotionFields" class="scene-physics2d-grid" hidden>
              <label><span data-i18n="重力（单位/秒²）"></span><input id="scenePhysics2DGravity" type="text" inputmode="decimal" lang="" spellcheck="false" aria-describedby="scenePhysics2DMotionBounds"></label>
              <label><span data-i18n="起跳速度（单位/秒）"></span><input id="scenePhysics2DJumpSpeed" type="text" inputmode="decimal" lang="" spellcheck="false" aria-describedby="scenePhysics2DMotionBounds"></label>
              <label><span data-i18n="最大下落速度（单位/秒）"></span><input id="scenePhysics2DMaxFallSpeed" type="text" inputmode="decimal" lang="" spellcheck="false" aria-describedby="scenePhysics2DMotionBounds"></label>
              <p id="scenePhysics2DMotionBounds" class="scene-physics2d-note" data-i18n="重力 1–20000，起跳速度 0–4000，最大下落速度 1–4000。起跳速度为 0 时禁用跳跃。向下为正；关闭后保留滑动响应和已升级的文档格式。"></p>
            </div>
          </section>
          <label id="scenePhysics2DResponseField"><span data-i18n="角色碰撞响应"></span><select id="scenePhysics2DResponse" aria-describedby="scenePhysics2DResponseHint scenePhysics2DResponseUnavailable"><option value="stop" data-i18n="碰撞后停止"></option><option value="slide" data-i18n="沿碰撞面滑动"></option></select></label>
          <p id="scenePhysics2DResponseHint" class="scene-physics2d-note" data-i18n="停止会截断本步移动；滑动会保留沿碰撞面的移动。仅影响角色逻辑碰撞，不改写视觉偏移或运行空间图模拟。"></p>
          <p id="scenePhysics2DResponseUnavailable" class="scene-physics2d-note" data-i18n="当前核心不支持角色滑动；已有停止行为及其他物理参数仍可编辑。" hidden></p>
          <section id="scenePhysics2DOneWaySection" class="scene-physics2d-one-way" hidden>
            <label><span data-i18n="静态碰撞方式"></span><select id="scenePhysics2DOneWay" aria-describedby="scenePhysics2DOneWayHint scenePhysics2DOneWayUnavailable"><option value="solid" data-i18n="普通碰撞"></option><option value="one-way" data-i18n="单向平台"></option></select></label>
            <p id="scenePhysics2DOneWayHint" class="scene-physics2d-note" data-i18n="仅用于静态矩形。角色可从下方穿过，并从上方落到平台上；不会改变形状、偏移或场景位置。"></p>
            <p id="scenePhysics2DOneWayUnavailable" class="scene-physics2d-note" data-i18n="当前核心不支持单向平台格式；旧格式的物理参数仍可编辑。" hidden></p>
            <label id="scenePhysics2DOneWayMarginField" hidden><span data-i18n="穿透容差（场景单位）"></span><input id="scenePhysics2DOneWayMargin" type="text" inputmode="decimal" lang="" spellcheck="false" aria-describedby="scenePhysics2DOneWayBounds"></label>
            <p id="scenePhysics2DOneWayBounds" class="scene-physics2d-note" data-i18n="容差为 1–64，影响单向碰撞判定；不是平台厚度。关闭单向设置会保留已升级的文档格式。" hidden></p>
          </section>
          <div id="scenePhysics2DBox" class="scene-physics2d-grid"><label><span data-i18n="宽度"></span><input id="scenePhysics2DWidth" type="text" inputmode="decimal" lang="" spellcheck="false"></label>
            <label><span data-i18n="高度"></span><input id="scenePhysics2DHeight" type="text" inputmode="decimal" lang="" spellcheck="false"></label></div>
          <label id="scenePhysics2DCircle"><span data-i18n="半径"></span><input id="scenePhysics2DRadius" type="text" inputmode="decimal" lang="" spellcheck="false"></label>
          <div class="scene-physics2d-grid"><label><span data-i18n="偏移 X"></span><input id="scenePhysics2DX" type="text" inputmode="decimal" lang="" spellcheck="false"></label>
            <label><span data-i18n="偏移 Y"></span><input id="scenePhysics2DY" type="text" inputmode="decimal" lang="" spellcheck="false"></label>
            <label><span data-i18n="碰撞层"></span><input id="scenePhysics2DLayer" type="text" inputmode="numeric" lang="" spellcheck="false" aria-describedby="scenePhysics2DLayersHint"></label>
            <label><span data-i18n="碰撞掩码"></span><input id="scenePhysics2DMask" type="text" inputmode="numeric" lang="" spellcheck="false" aria-describedby="scenePhysics2DLayersHint"></label></div>
          <p id="scenePhysics2DLayersHint" class="scene-physics2d-note" data-i18n="层与掩码均为 0–65535；按位组合 16 个碰撞层。"></p>
          <section class="scene-physics2d-preview"><h3 data-i18n="物理形状示意"></h3>
            <p class="scene-physics2d-note" data-i18n="局部坐标示意；不运行碰撞，也不表示场景中的位置。"></p>
            <p id="scenePhysics2DPreviewHint" class="scene-physics2d-note" data-i18n="检查当前表单后显示形状示意。"></p>
            <div id="scenePhysics2DStage" class="scene-physics2d-stage" role="img" hidden></div></section>
        </section></section>
      <section id="scenePhysics2DReview" hidden><h3 data-i18n="物理修改审阅"></h3><ul id="scenePhysics2DChangedPaths"></ul>
        <div class="scene-physics2d-comparison"><section><h4 data-i18n="修改前的完整原文"></h4><pre id="scenePhysics2DBefore" lang="" tabindex="0"></pre></section>
          <section><h4 data-i18n="应用后的完整原文"></h4><pre id="scenePhysics2DAfter" lang="" tabindex="0"></pre></section></div></section></div>
    <div class="scene-physics2d-feedback"><p id="scenePhysics2DStatus" role="status" aria-live="polite"></p><p id="scenePhysics2DDiagnostic"></p></div>
    <footer class="scene-physics2d-footer"><span class="scene-physics2d-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></span><div>
      <button id="scenePhysics2DCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查物理修改"></button>
      <button id="scenePhysics2DApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="scenePhysics2DCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></div></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#scenePhysics2D' + suffix);
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const names = { Instance: 'instanceId', Kind: 'kind', Response: 'collisionResponse', Motion: 'motion', Gravity: 'gravity', JumpSpeed: 'jumpSpeed', MaxFallSpeed: 'maxFallSpeed', OneWay: 'oneWayMode', OneWayMargin: 'oneWayMargin', Shape: 'shape', Width: 'width', Height: 'height', Radius: 'radius', X: 'x', Y: 'y', Layer: 'layer', Mask: 'mask' };
  let disposed = false, epoch = 0, session = null, pending = false, draft = [], selected = '', initial = '', proposal = null, approval = '', previewModel = null, previewForm = '', opener = null, message = '', diagnostic = '';
  let targetCatalog = null, targetState = 'idle', targetGeneration = 0, targetCapability = null, targetCatalogToken, approvedTargets = null, targetRenderKey = null;
  let spaceCatalog = null, spaceState = 'idle', spaceGeneration = 0, spaceCapability = null, spaceCatalogToken, spaceView = null, spaceViewCatalog = null, spaceViewModel = null, spaceViewFailed = false, spaceMode = 'view';
  const spaceRenderer = typeof setupScenePhysics2DSpace === 'function' ? setupScenePhysics2DSpace({ root: el('SpaceView'), onSelect: id => {
    if (pending || !current() || !hasSpace() || !previewModel || previewForm !== signature() || !spaceView
      || ![...spaceView.bodies, ...spaceView.missingBodies].some(body => body.id === id)) return;
    selectBody(id);
  }, onOffsetProposal: acceptSpaceOffset, onResizeProposal: acceptSpaceResize }) : { render() {}, clear() {} };
  let observedMotionCapability, motionGeneration = 0, observedOneWayCapability, oneWayGeneration = 0;
  const reserved = new Set();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && context.physicsSource === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(!disposed && dialog.open && session && eligible(context) && context.available === true && !context.busy
    && context.sourcePath === session.source.sourcePath && context.sourceToken === session.source.token); };
  const responseAvailable = () => typeof supportsStudioCoreScenePhysics2DResponse === 'function' && supportsStudioCoreScenePhysics2DResponse();
  const motionAvailable = () => typeof supportsStudioCoreScenePhysics2DMotion === 'function' && supportsStudioCoreScenePhysics2DMotion();
  const oneWayAvailable = () => typeof supportsStudioCoreScenePhysics2DOneWay === 'function' && supportsStudioCoreScenePhysics2DOneWay();
  const staticBox = body => body.kind === 'static' && (body.shape === 'box' || body.shape?.kind === 'box');
  const requiredSchema = bodies => Math.max(session?.model.schemaVersion || 1, bodies.some(body => staticBox(body) && (body.oneWay || body.oneWayMode === 'one-way')) ? 4 : bodies.some(body => body.kind === 'character' && (body.characterMotion || body.motion === 'platformer')) ? 3 : bodies.some(body => body.kind === 'character' && body.collisionResponse === 'slide') ? 2 : 1);
  const schemaAvailable = schema => schema === 4 ? oneWayAvailable() : schema === 3 ? motionAvailable() : schema === 2 ? responseAvailable() : schema === 1;
  const capabilityRevision = schema => schema === 4 ? oneWayGeneration : schema === 3 ? motionGeneration : 0;
  const featureAvailable = minimum => schemaAvailable(Math.max(requiredSchema(raw()), minimum));
  const unavailable = () => Object.assign(new Error('Physics document capability unavailable.'), { errorCode: 'studio_core_unavailable' });
  const raw = () => draft.map(row => row.id === selected ? { ...row, ...Object.fromEntries(Object.entries(names).map(([id, key]) => [key, el(id).value])) } : row);
  const signature = () => JSON.stringify(raw().map(({ width, height, radius, collisionResponse, responsePresent, motion, gravity, jumpSpeed, maxFallSpeed, oneWayMode, oneWayMargin, ...row }) => ({ ...row, ...(staticBox(row) ? { oneWayMode, ...(oneWayMode === 'one-way' ? { oneWayMargin } : {}) } : {}), ...(row.kind === 'character' ? { collisionResponse, motion, ...(motion === 'platformer' ? { gravity, jumpSpeed, maxFallSpeed } : {}) } : {}), ...(row.shape === 'box' ? { width, height } : { radius }) })));
  const dirty = () => Boolean(session && signature() !== initial);
  const canReadTargets = () => typeof getTargets === 'function' && getContext().targetsAvailable === true;
  const hasTargets = () => Boolean(session && current() && canReadTargets() && targetCatalog && targetState === 'ready'
    && targetCatalogToken === getContext().targetsToken && scenePhysics2DTargetsMatchSource(targetCatalog, session.source));
  const approved = () => isScenePhysics2DProposal(proposal) && signature() === approval
    && schemaAvailable(requiredSchema(proposal.edit.bodies))
    && (!approvedTargets || hasTargets() && targetCatalog === approvedTargets);
  const capture = () => { if (session) draft = raw(); };
  function clearPreview() { previewModel = null; previewForm = ''; el('Stage').replaceChildren(); el('Stage').hidden = true; el('PreviewHint').hidden = false; clearSpaceView(); }
  function invalidate() { proposal = null; approval = ''; approvedTargets = null; clearPreview(); message = '物理表单已变化；检查后可预览并应用。'; diagnostic = ''; }
  function shapeVisibility() { el('Box').hidden = el('Shape').value !== 'box'; el('Circle').hidden = el('Shape').value !== 'circle'; }
  function changed() { if (pending || !current()) return; capture(); invalidate(); shapeVisibility(); refresh(); }
  // Directory requests have a separate generation; a failed lookup never owns
  // or rewrites fields. Only a checked catalog may accompany an Apply ticket.
  function revokeTargetApproval() {
    if (proposal || pending) message = '目标目录已变化，请重新检查后应用。';
    proposal = null; approval = ''; approvedTargets = null;
  }
  function resetTargets({ review = true } = {}) {
    targetGeneration++; targetCatalog = null; targetCatalogToken = undefined; targetState = 'idle';
    if (review) revokeTargetApproval();
  }
  function observeTargetCapability() {
    const capability = { available: canReadTargets(), token: getContext().targetsToken };
    if (targetCapability && (capability.available !== targetCapability.available || capability.token !== targetCapability.token)) resetTargets();
    targetCapability = capability;
  }
  const targetLabel = target => t('{0} · 实例 {1}', target.name, target.instanceId);
  function refreshTargets() {
    const ready = hasTargets(), available = canReadTargets(), locked = pending || !current();
    el('Targets').hidden = !session;
    el('TargetsRefresh').hidden = !available; el('TargetsRefresh').disabled = locked || targetState === 'loading';
    el('TargetsStatus').textContent = targetState === 'loading' ? t('正在读取已保存场景的实例…')
      : targetState === 'failed' ? t('无法读取场景实例；保留手动编辑，目标尚未验证。可刷新重试。')
      : ready ? t('已读取 {0} 个已保存实例；检查时核对当前表单目标。', targetCatalog.targets.length)
      : t('尚未验证目标实例。可手动编辑；保存后的场景构建仍会检查目标。');
    el('TargetsPath').textContent = ready ? targetCatalog.scene.sourcePath : '';
    el('TargetField').hidden = !available; el('Target').disabled = locked || !ready;
    const first = t('从已保存场景选择实例'), renderKey = JSON.stringify([ready ? targetCatalog.targets.map(targetLabel) : [], first]);
    if (targetRenderKey !== renderKey) {
      targetRenderKey = renderKey; el('Target').replaceChildren();
      const placeholder = node('option', first); placeholder.value = ''; el('Target').append(placeholder);
      if (ready) for (const target of targetCatalog.targets) { const option = node('option', targetLabel(target)); option.value = target.instanceId; el('Target').append(option); }
    }
    const known = ready && targetCatalog.targets.some(target => target.instanceId === el('Instance').value);
    el('Target').value = known ? el('Instance').value : '';
    el('TargetHint').hidden = !ready || known;
    el('TargetHint').textContent = !ready || known ? '' : t('当前编号未在上次读取的场景中找到，请选择实例或修正编号。原值已保留。');
  }
  async function loadTargets() {
    if (pending || !current() || !canReadTargets()) return false;
    const owner = session, request = ++targetGeneration, capability = getContext().targetsToken;
    targetCatalog = null; targetCatalogToken = undefined; targetState = 'loading'; revokeTargetApproval(); refresh();
    const owns = () => !disposed && request === targetGeneration && owner === session && current() && canReadTargets() && getContext().targetsToken === capability;
    try {
      const catalog = await getTargets(owner.source); if (!owns()) return false;
      if (!isScenePhysics2DTargets(catalog) || !scenePhysics2DTargetsMatchSource(catalog, owner.source)) throw Error('targets');
      revokeTargetApproval(); targetCatalog = catalog; targetCatalogToken = capability; targetState = 'ready'; return true;
    } catch {
      if (owns()) { revokeTargetApproval(); targetCatalog = null; targetState = 'failed'; }
      return false;
    } finally { if (!disposed && owner === session && dialog.open) refresh(); }
  }
  // A scene-space observation never participates in a draft's Apply ticket.
  // Refresh, loss or failure cannot change the form or revoke its review.
  const canReadSpace = () => typeof getSpace === 'function' && getContext().spaceAvailable === true;
  const hasSpace = () => Boolean(session && current() && canReadSpace() && spaceCatalog && spaceState === 'ready'
    && spaceCatalogToken === getContext().spaceToken && scenePhysics2DSpaceMatchSource(spaceCatalog, session.source));
  function clearSpaceView() { spaceView = null; spaceViewCatalog = null; spaceViewModel = null; spaceViewFailed = false; spaceRenderer.clear(); }
  function resetSpace() { spaceMode = 'view'; spaceGeneration++; spaceCatalog = null; spaceCatalogToken = undefined; spaceState = 'idle'; clearSpaceView(); }
  function observeSpaceCapability() {
    const capability = { available: canReadSpace(), token: getContext().spaceToken };
    if (spaceCapability && (capability.available !== spaceCapability.available || capability.token !== spaceCapability.token)) resetSpace();
    spaceCapability = capability;
  }
  function refreshSpace() {
    const ready = hasSpace(), available = canReadSpace(), model = current() && previewForm === signature() ? previewModel : null;
    el('Space').hidden = !session; el('SpaceRefresh').hidden = !available; el('SpaceRefresh').disabled = pending || !current() || spaceState === 'loading';
    if (!ready || !model) clearSpaceView();
    else if (spaceViewCatalog !== spaceCatalog || spaceViewModel !== model) {
      clearSpaceView(); spaceViewCatalog = spaceCatalog; spaceViewModel = model;
      try { spaceView = createScenePhysics2DSpaceView(spaceCatalog, model); } catch { spaceViewFailed = true; }
    }
    el('SpaceStatus').textContent = spaceState === 'loading' ? t('正在读取已保存场景的位置…')
      : spaceState === 'failed' || spaceViewFailed ? t('无法显示场景位置；字段编辑仍可使用，可刷新重试。')
      : !ready ? t('尚未读取场景位置；字段编辑和局部形状示意仍可使用。')
      : !model ? t('表单有未检查的修改；检查后显示场景中的碰撞形状。')
      : t('已显示 {0} 个碰撞体；场景草稿不包含在此视图中。', spaceView.bodies.length);
    el('SpacePath').textContent = ready ? spaceCatalog.scene.sourcePath : '';
    for (const [name, value] of [['SpaceEdit', 'offset'], ['SpaceResize', 'resize']]) {
      el(name).hidden = !available; el(name).disabled = pending || !current() || (spaceMode !== value && (!ready || !model || !spaceView?.bodies.some(body => body.id === selected)));
      el(name).setAttribute('aria-pressed', String(spaceMode === value)); el(name + 'Hint').hidden = spaceMode !== value;
    }
    spaceRenderer.render(spaceView, { selected, enabled: !pending && current() && ready && Boolean(model), mode: spaceMode });
  }
  // Spatial proposals supply existing checked fields, never source-edit rights.
  // Both interactions use the same session/model fence and ordinary review path.
  function checkedSpaceBody(expectedMode) {
    if (pending || !current() || spaceMode !== expectedMode || !hasSpace() || !previewModel || previewForm !== signature()
      || !spaceView || spaceViewCatalog !== spaceCatalog || spaceViewModel !== previewModel) return null;
    return previewModel.bodies.find(value => value.id === selected) || null;
  }
  function acceptSpaceOffset(candidate) {
    const body = checkedSpaceBody('offset');
    if (!body || !isScenePhysics2DOffsetProposal(candidate) || candidate.instanceId !== body.instanceId
      || !scenePhysics2DOffsetProposalMatches(candidate, spaceView, selected, body.offset)) return false;
    const [x, y] = candidate.offset;
    if (x === body.offset[0] && y === body.offset[1]) return true;
    // Keep equivalent numeric spelling on untouched axes and all other fields.
    if (x !== body.offset[0]) el('X').value = String(x);
    if (y !== body.offset[1]) el('Y').value = String(y);
    capture(); invalidate(); message = '碰撞偏移已更新到参数表，请检查修改后再应用。'; refresh(); el('X').focus(); return true;
  }
  function acceptSpaceResize(candidate) {
    const body = checkedSpaceBody('resize');
    if (!body || !isScenePhysics2DResizeProposal(candidate) || candidate.instanceId !== body.instanceId
      || !scenePhysics2DResizeProposalMatches(candidate, spaceView, selected, body.shape)) return false;
    const values = body.shape.kind === 'box'
      ? [['Width', body.shape.size[0], candidate.shape.size[0]], ['Height', body.shape.size[1], candidate.shape.size[1]]]
      : [['Radius', body.shape.radius, candidate.shape.radius]];
    const changed = values.filter(([, before, after]) => before !== after);
    if (!changed.length) return true;
    for (const [name, , value] of changed) el(name).value = String(value);
    capture(); invalidate(); message = '碰撞尺寸已更新到参数表，请检查修改后再应用。'; refresh(); el(changed[0][0]).focus(); return true;
  }
  async function loadSpace() {
    if (pending || !current() || !canReadSpace()) return false;
    const owner = session, request = ++spaceGeneration, capability = getContext().spaceToken;
    spaceCatalog = null; spaceCatalogToken = undefined; spaceState = 'loading'; clearSpaceView(); refresh();
    const owns = () => !disposed && request === spaceGeneration && owner === session && current() && canReadSpace() && getContext().spaceToken === capability;
    try {
      const catalog = await getSpace(owner.source); if (!owns()) return false;
      if (!isScenePhysics2DSpace(catalog) || !scenePhysics2DSpaceMatchSource(catalog, owner.source)) throw Error('space');
      spaceCatalog = catalog; spaceCatalogToken = capability; spaceState = 'ready'; return true;
    } catch { if (owns()) { spaceCatalog = null; spaceState = 'failed'; } return false; }
    finally { if (!disposed && owner === session && dialog.open) refresh(); }
  }
  function renderList() {
    const picker = el('Body');
    if (picker.children.length !== draft.length || draft.some((row, index) => picker.children[index]?.value !== row.id)) {
      picker.replaceChildren(); for (const row of draft) { const option = node('option'); option.value = row.id; picker.append(option); }
    }
    for (const [index, row] of draft.entries()) picker.children[index].textContent = `${t('碰撞体 {0}', index + 1)} · ${row.id}`;
    picker.value = selected;
  }
  function renderSelected() {
    const row = draft.find(body => body.id === selected); if (!row) return;
    for (const [id, key] of Object.entries(names)) el(id).value = row[key];
    shapeVisibility(); renderList();
  }
  // A read-only local-space illustration. Uniform scaling includes the origin
  // and shape bounds; this renderer never mutates physics or reads scene data.
  function paintPreview() {
    const body = current() && previewForm === signature() ? previewModel?.bodies.find(row => row.id === selected) : null;
    const stage = el('Stage'); stage.replaceChildren(); stage.hidden = !body; el('PreviewHint').hidden = Boolean(body);
    stage.setAttribute('aria-label', t('物理形状示意')); if (!body) return;
    const [x, y] = body.offset, width = body.shape.kind === 'box' ? body.shape.size[0] : body.shape.radius * 2,
      height = body.shape.kind === 'box' ? body.shape.size[1] : body.shape.radius * 2;
    const left = Math.min(0, x - width / 2), right = Math.max(0, x + width / 2), top = Math.min(0, y - height / 2), bottom = Math.max(0, y + height / 2);
    const scale = Math.min(260 / Math.max(1, right - left), 140 / Math.max(1, bottom - top));
    const originX = 150 - (left + right) * scale / 2, originY = 90 - (top + bottom) * scale / 2;
    const horizontal = node('span'), vertical = node('span'), origin = node('span', '0'), shape = node('span');
    horizontal.className = 'scene-physics2d-axis-x'; vertical.className = 'scene-physics2d-axis-y'; origin.className = 'scene-physics2d-origin';
    shape.className = 'scene-physics2d-shape ' + (body.shape.kind === 'circle' ? 'scene-physics2d-round' : ''); shape.dataset.kind = body.shape.kind;
    horizontal.style.top = `${originY / 1.8}%`; vertical.style.left = `${originX / 3}%`; origin.style.left = `${originX / 3}%`; origin.style.top = `${originY / 1.8}%`;
    shape.style.left = `${(originX + (x - width / 2) * scale) / 3}%`; shape.style.top = `${(originY + (y - height / 2) * scale) / 1.8}%`;
    shape.style.width = `${width * scale / 3}%`; shape.style.height = `${height * scale / 1.8}%`; stage.dataset.bodyId = body.id; stage.append(horizontal, vertical, shape, origin);
  }
  function refresh() {
    if (disposed) return;
    const capability = motionAvailable();
    if (observedMotionCapability !== undefined && capability !== observedMotionCapability) motionGeneration++;
    observedMotionCapability = capability;
    const oneWayCapability = oneWayAvailable();
    if (observedOneWayCapability !== undefined && oneWayCapability !== observedOneWayCapability) oneWayGeneration++;
    observedOneWayCapability = oneWayCapability;
    const context = getContext(); button.hidden = !eligible(context); button.disabled = context.available !== true || Boolean(context.busy); button.textContent = t('编辑二维物理');
    observeTargetCapability(); observeSpaceCapability();
    if (session && !current()) { if (!pending) { proposal = null; approval = ''; } resetTargets({ review: !pending }); resetSpace(); clearPreview(); message = '原文已变化，请返回后重新打开物理编辑。'; }
    if (!pending && proposal && !approved() || previewModel && previewForm !== signature()) invalidate();
    translatePage(dialog); shapeVisibility(); renderList(); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty());
    el('Fields').hidden = !session; const locked = pending || !current();
    for (const control of el('Fields').querySelectorAll('input,select,button')) control.disabled = locked;
    const character = el('Kind').value === 'character';
    el('ResponseField').hidden = !character; el('ResponseHint').hidden = !character;
    const platformer = character && el('Motion').value === 'platformer';
    el('MotionSection').hidden = !character; el('MotionFields').hidden = !platformer;
    el('MotionUnavailable').hidden = !character || featureAvailable(3);
    el('Motion').disabled = locked || !character || !featureAvailable(3);
    for (const name of ['Gravity', 'JumpSpeed', 'MaxFallSpeed']) el(name).disabled = locked || !platformer || !featureAvailable(3);
    const responseEditable = featureAvailable(2);
    el('ResponseUnavailable').hidden = !character || responseEditable; el('Response').disabled = locked || !character || !responseEditable || platformer;
    const platform = el('Kind').value === 'static' && el('Shape').value === 'box', oneWay = platform && el('OneWay').value === 'one-way';
    el('OneWaySection').hidden = !platform; el('OneWayMarginField').hidden = !oneWay; el('OneWayBounds').hidden = !oneWay;
    el('OneWayUnavailable').hidden = !platform || oneWayAvailable(); el('OneWay').disabled = locked || !platform || !oneWayAvailable();
    el('OneWayMargin').disabled = locked || !oneWay || !oneWayAvailable();
    el('Add').disabled = locked || draft.length >= 128; el('Remove').disabled = locked || draft.length <= 1;
    el('Check').disabled = locked || targetState === 'loading'; el('Apply').disabled = locked || !approved();
    el('Path').textContent = session?.source.sourcePath || context.sourcePath || ''; el('Scene').textContent = session ? t('物理所属场景：{0}', session.model.sceneObjectId) : '';
    el('Identity').textContent = selected ? t('碰撞体身份：{0}', selected) : ''; el('Count').textContent = t('碰撞体 {0} / 128', draft.length);
    el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Review').hidden = !proposal; el('Before').textContent = proposal?.beforeContent || ''; el('After').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    refreshTargets(); paintPreview(); refreshSpace();
  }
  function close(force = false) {
    if (!force && dirty() && !window.confirm(t('丢弃本次物理表单修改？原文草稿不会改变。'))) return false;
    const target = opener, request = ++epoch; resetTargets(); resetSpace(); opener = null; session = null; pending = false; draft = []; selected = ''; proposal = null; approval = ''; reserved.clear(); clearPreview(); message = ''; diagnostic = '';
    if (dialog.open) dialog.close(); refresh();
    Promise.resolve().then(() => { if (!disposed && request === epoch && !dialog.open && target?.isConnected !== false) target?.focus?.(); }); return true;
  }
  function fail(error, text) { proposal = null; approval = ''; approvedTargets = null; clearPreview(); message = text; diagnostic = typeof error?.errorCode === 'string' ? error.errorCode : ''; }
  const form = body => ({ id: body.id, instanceId: body.instanceId, kind: body.kind, collisionResponse: body.collisionResponse ?? 'stop', responsePresent: Object.hasOwn(body, 'collisionResponse'),
    oneWayMode: body.oneWay ? 'one-way' : 'solid', oneWayMargin: String(body.oneWay?.margin ?? 1),
    motion: body.characterMotion?.kind || 'free', gravity: String(body.characterMotion?.gravity ?? 980), jumpSpeed: String(body.characterMotion?.jumpSpeed ?? 360), maxFallSpeed: String(body.characterMotion?.maxFallSpeed ?? 1200), shape: body.shape.kind,
    width: String(body.shape.kind === 'box' ? body.shape.size[0] : 32), height: String(body.shape.kind === 'box' ? body.shape.size[1] : 32), radius: String(body.shape.kind === 'circle' ? body.shape.radius : 16),
    x: String(body.offset[0]), y: String(body.offset[1]), layer: String(body.layer), mask: String(body.mask) });
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || context.available !== true) return false;
    const request = ++epoch; opener = document.activeElement; pending = true; message = '正在读取物理文档…'; dialog.showModal(); refresh();
    const motionRequest = motionGeneration, motionCapability = motionAvailable(), oneWayRequest = oneWayGeneration, oneWayCapability = oneWayAvailable();
    const owns = () => { const now = getContext(); return !disposed && dialog.open && request === epoch && eligible(now) && !now.busy && now.available === true
      && now.sourcePath === context.sourcePath && now.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || Object.keys(source).length !== 5 || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken
        || !revision(source.sourceRevision) || !revision(source.baseSourceRevision) || typeof source.content !== 'string') throw Error('source');
      const captured = Object.freeze({ ...source }), model = await readScenePhysics2DDocument(captured.content); if (!owns()) return false;
      if (model.schemaVersion === 4 && (!oneWayCapability || !oneWayAvailable() || oneWayGeneration !== oneWayRequest)
        || model.schemaVersion === 3 && (!motionCapability || !motionAvailable() || motionGeneration !== motionRequest)) throw unavailable();
      session = { source: captured, model }; draft = model.bodies.map(form); selected = draft[0].id;
      for (const value of [model.sceneObjectId, ...model.bodies.flatMap(body => [body.id, body.instanceId])]) reserved.add(value);
      renderSelected(); initial = signature(); previewModel = model; previewForm = initial; message = '编辑已有物理声明，检查后应用到原文草稿。'; return true;
    } catch (error) { if (owns()) fail(error, '无法读取有效物理文档，请检查原文。'); return false; }
    finally { if (!disposed && request === epoch && dialog.open) { pending = false; refresh(); if (session && canReadTargets()) void loadTargets(); if (session && canReadSpace()) void loadSpace(); } }
  }
  function numeric(value) {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw Object.assign(new TypeError('Incomplete number.'), { errorCode: 'scene_physics2d_authoring_invalid' });
    return Number(value);
  }
  function edit() {
    if (raw().some(row => staticBox(row) && !['solid', 'one-way'].includes(row.oneWayMode))) throw Object.assign(new TypeError('Invalid one-way platform mode.'), { errorCode: 'scene_physics2d_authoring_invalid' });
    if (raw().some(row => row.kind === 'character' && !['free', 'platformer'].includes(row.motion))) throw Object.assign(new TypeError('Invalid character motion mode.'), { errorCode: 'scene_physics2d_authoring_invalid' });
    if (!schemaAvailable(requiredSchema(raw()))) throw unavailable();
    return { bodies: raw().map(row => ({ id: row.id, instanceId: row.instanceId, kind: row.kind,
      ...(staticBox(row) && row.oneWayMode === 'one-way' ? { oneWay: { margin: numeric(row.oneWayMargin) } } : {}),
      ...(row.kind === 'character' && (row.collisionResponse !== 'stop' || row.responsePresent) ? { collisionResponse: row.collisionResponse } : {}),
      ...(row.kind === 'character' && row.motion === 'platformer' ? { characterMotion: { kind: 'platformer', gravity: numeric(row.gravity), jumpSpeed: numeric(row.jumpSpeed), maxFallSpeed: numeric(row.maxFallSpeed) } } : {}),
      shape: row.shape === 'box' ? { kind: 'box', size: [numeric(row.width), numeric(row.height)] } : row.shape === 'circle' ? { kind: 'circle', radius: numeric(row.radius) } : { kind: row.shape },
      offset: [numeric(row.x), numeric(row.y)], layer: numeric(row.layer), mask: numeric(row.mask) })) };
  }
  async function check() {
    if (pending || !current() || targetState === 'loading') return false;
    capture(); const owner = session, request = epoch, value = signature(), targets = hasTargets() ? targetCatalog : null, targetRequest = targetGeneration, schema = requiredSchema(raw()), capabilityRequest = capabilityRevision(schema); pending = true; invalidate(); message = '正在检查物理修改…'; refresh();
    const owns = () => request === epoch && session === owner && current() && signature() === value && schemaAvailable(schema) && capabilityRevision(schema) === capabilityRequest && targetRequest === targetGeneration
      && (targets ? hasTargets() && targetCatalog === targets : !hasTargets());
    try {
      if (!schemaAvailable(schema)) throw unavailable();
      if (value === initial) { if (targets) validateScenePhysics2DTargets(targets, owner.model); previewModel = owner.model; previewForm = value; message = '物理参数已检查；未修改原文。'; return true; }
      const candidate = await createScenePhysics2DProposal(owner.source, edit()); if (!owns()) return false;
      if (!isScenePhysics2DProposal(candidate) || candidate.kind !== 'scene-physics2d' || candidate.sourcePath !== owner.source.sourcePath
        || candidate.sourceToken !== owner.source.token || candidate.beforeContent !== owner.source.content) throw Error('proposal');
      const model = await readScenePhysics2DDocument(candidate.afterContent); if (!owns()) return false;
      if (targets) validateScenePhysics2DTargets(targets, model);
      proposal = candidate; approval = value; approvedTargets = targets; previewModel = model; previewForm = value;
      message = targets ? '物理参数及目录目标已检查，请审阅完整原文后应用。' : '物理参数已检查；目标尚未验证。请审阅完整原文后应用。'; return true;
    } catch (error) {
      if (!owns()) return false;
      // The native declaration checker can validate equivalent numeric input
      // (for example 32 and 3.2e1) without producing a source patch.
      if (error?.errorCode === 'scene_physics2d_authoring_unchanged') {
        try { if (targets) validateScenePhysics2DTargets(targets, owner.model); }
        catch (targetError) { fail(targetError, '物理修改未通过检查，输入已保留。'); return false; }
        previewModel = owner.model; previewForm = value; message = '物理参数已检查；未修改原文。'; diagnostic = ''; return true;
      }
      fail(error, '物理修改未通过检查，输入已保留。'); return false;
    }
    finally { if (request === epoch && session === owner && dialog.open) { pending = false; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approved()) { refresh(); return false; }
    const owner = session, request = epoch, candidate = proposal, value = approval, targets = approvedTargets, targetRequest = targetGeneration, capabilityRequest = capabilityRevision(requiredSchema(candidate.edit.bodies));
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && capabilityRevision(requiredSchema(candidate.edit.bodies)) === capabilityRequest && approved() && proposal === candidate && signature() === value && approvedTargets === targets
      && targetRequest === targetGeneration && (!targets || hasTargets() && targetCatalog === targets);
    pending = true; message = '正在应用物理修改到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged, ...(targets ? { targets } : {}) }); if (!owns()) return false;
      const context = getContext();
      if (proposal !== candidate || signature() !== value || result?.applied !== true || result.sourcePath !== owner.source.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || result.sourceToken === owner.source.token || !eligible(context) || context.available !== true || context.busy
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('result');
      opener = null; close(true); result.focus?.(); return true;
    } catch (error) { if (owns()) fail(error, '物理修改未确认应用，输入已保留。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  function add() {
    if (pending || !current() || draft.length >= 128) return;
    capture(); for (const row of draft) { reserved.add(row.id); reserved.add(row.instanceId); }
    let id;
    try { for (let attempt = 0; attempt < 16; attempt++) { const value = globalThis.crypto?.randomUUID?.(); if (uuid(value) && !reserved.has(value)) { id = value; break; } } } catch { /* No fallback identity. */ }
    if (!id) { message = '无法分配新的碰撞体编号，输入已保留。'; refresh(); return; }
    reserved.add(id); draft.push({ id, instanceId: '', kind: 'static', collisionResponse: 'stop', responsePresent: false, oneWayMode: 'solid', oneWayMargin: '1', motion: 'free', gravity: '980', jumpSpeed: '360', maxFallSpeed: '1200', shape: 'box', width: '32', height: '32', radius: '16', x: '0', y: '0', layer: '1', mask: '1' });
    selected = id; invalidate(); renderSelected(); refresh(); el('Instance').focus();
  }
  function remove() {
    if (pending || !current() || draft.length <= 1) return;
    capture(); const index = draft.findIndex(row => row.id === selected); draft.splice(index, 1); selected = draft[Math.min(index, draft.length - 1)].id;
    invalidate(); renderSelected(); refresh(); el('Body').focus();
  }
  function selectBody(next) {
    if (pending || !current() || !draft.some(row => row.id === next)) { el('Body').value = selected; return; }
    capture(); selected = next; renderSelected(); refresh();
  }
  el('Body').addEventListener('change', () => selectBody(el('Body').value));
  el('TargetsRefresh').addEventListener('click', () => { void loadTargets(); });
  el('SpaceRefresh').addEventListener('click', () => { void loadSpace(); });
  for (const [name, value] of [['SpaceEdit', 'offset'], ['SpaceResize', 'resize']]) el(name).addEventListener('click', () => {
    if (pending || !current() || !canReadSpace() || (spaceMode !== value && (!hasSpace() || !spaceView || !previewModel || previewForm !== signature() || !spaceView.bodies.some(body => body.id === selected)))) return;
    spaceMode = spaceMode === value ? 'view' : value; refresh();
  });
  el('Target').addEventListener('change', () => {
    if (pending || !current() || !hasTargets()) { refreshTargets(); return; }
    try { const value = scenePhysics2DTargetValue(targetCatalog, el('Target').value); if (value !== el('Instance').value) { el('Instance').value = value; changed(); } }
    catch { refreshTargets(); }
  });
  for (const [name] of Object.entries(names)) el(name).addEventListener(['Kind', 'Shape', 'Response', 'Motion', 'OneWay'].includes(name) ? 'change' : 'input', () => {
    if (pending || !current()) return;
    // Only an explicit mode/kind choice enables the required slide response;
    // refreshes and silent field changes cannot repair or authorize a draft.
    if (['Kind', 'Motion'].includes(name) && el('Kind').value === 'character' && el('Motion').value === 'platformer' && featureAvailable(3)) el('Response').value = 'slide';
    changed();
  });
  button.addEventListener('click', () => { void open(); }); el('Check').addEventListener('click', () => { void check(); }); el('Apply').addEventListener('click', () => { void apply(); });
  el('Add').addEventListener('click', add); el('Remove').addEventListener('click', remove);
  for (const name of ['Close', 'Cancel']) el(name).addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(() => { if (!disposed) refresh(); });
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); dialog.remove(); }
  refresh(); return Object.freeze({ open, refresh, dispose });
}
