import { setupSceneAnimationTrackCopy } from './app-scene-animation-track-copy.js';
import { setupSceneAnimationRetime } from './app-scene-animation-retime.js';
import { setupSceneAnimationUsage } from './app-scene-animation-usage.js';
import { setupSceneAnimationClips } from './app-scene-animation-clips.js';
import { supportsStudioCoreSceneAnimationSprites, supportsStudioCoreSceneAnimationClips, supportsStudioCoreSceneAnimationRetime, supportsStudioCoreSceneAnimationTrackCopy, supportsStudioCoreSceneAnimationInstances } from '../../engine/studio-core.mjs';
import { isSceneAnimationTargets, sceneAnimationTargetsMatchSource, sceneAnimationTargetValue, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, isSceneAnimationProposal, retimeSceneAnimationDraft, copySceneAnimationTrackDraft } from '../../engine/scene-animation-edit.mjs';
import { createSceneAnimationPlayer } from './scene-animation-player.js';
import { renderSceneAnimationSample } from './scene-animation-preview.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This editor owns a form, a schematic preview and reviewed draft proposals.
// Source writes, Save, world resolution and backend playback remain separate.
export function setupSceneAnimation({ getContext = () => ({}), getSource = async () => null, getTargets = null, getUsage = null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('sceneAnimationStyle')) {
    const style = document.createElement('link'); style.id = 'sceneAnimationStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-animation.css';
    (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'sceneAnimationBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'sceneAnimationDialog'; dialog.className = 'scene-animation-dialog';
  dialog.dataset.vientoCloseGuard = 'true'; dialog.setAttribute('aria-labelledby', 'sceneAnimationTitle');
  dialog.innerHTML = `<header><h2 id="sceneAnimationTitle" data-i18n="编辑场景动画"></h2><button id="sceneAnimationClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="scene-animation-body"><p id="sceneAnimationPath" class="muted"></p><p id="sceneAnimationScene" class="muted"></p>
      <p data-i18n="编辑实例的二维偏移、旋转、缩放、不透明度与序列帧。可从已保存场景读取实例名称，或手动填写稳定实例编号。"></p><p class="muted" data-i18n="时长大于 0 且不超过 60 秒；每条轨道最多 64 个关键帧，首帧时间为 0，后续时间递增且不超过时长。"></p>
      <section id="sceneAnimationTargets" class="scene-animation-targets" aria-labelledby="sceneAnimationTargetsTitle">
        <div class="scene-animation-toolbar"><h3 id="sceneAnimationTargetsTitle" data-i18n="场景实例目录"></h3><button id="sceneAnimationTargetsRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新场景实例"></button></div>
        <p id="sceneAnimationTargetsStatus" class="muted" role="status" aria-live="polite"></p>
        <p id="sceneAnimationTargetsPath" class="muted"></p><p class="muted" data-i18n="目录来自上次读取的已保存场景，不包含场景草稿。名称相同的实例用完整编号区分；缺失目标不会自动替换。"></p></section>
      <section id="sceneAnimationFields" hidden><div class="scene-animation-settings">
        <label><span data-i18n="动画时长（秒）"></span><input id="sceneAnimationDuration" type="text" inputmode="decimal"></label>
        <label><span data-i18n="循环播放"></span><select id="sceneAnimationLoop"><option value="true" data-i18n="是"></option><option value="false" data-i18n="否"></option></select></label>
        <label><span data-i18n="运行播放范围"></span><select id="sceneAnimationPlaybackScope"><option value="scene" data-i18n="整场景共用播放"></option><option value="instance" data-i18n="每个实例独立播放"></option></select></label></div>
        <p class="muted" data-i18n="按实例运行时，动画控制只影响调用行为所属实例的轨道。选择后需检查、审阅并保存；临时预览范围不会修改此设置。"></p>
        <p id="sceneAnimationPlaybackScopeProjectHint" class="muted" hidden data-i18n="按实例运行目前需要从项目组装构建，单独场景构建暂不支持此范围；已保存场景预览仍可单独使用。"></p>
        <p id="sceneAnimationPlaybackScopeStatus" class="muted" role="status"></p>
        <section id="sceneAnimationRetime"></section>
        <section id="sceneAnimationClips"></section>
        <div class="scene-animation-toolbar"><h3 data-i18n="动画轨道"></h3><button id="sceneAnimationAddTrack" class="doc-btn doc-btn-ghost" type="button" data-i18n="添加动画轨道"></button></div>
        <p class="muted" data-i18n="偏移范围 ±10000；旋转范围 ±36000 度；缩放范围 0.01–100；不透明度 0–1（0 为完全透明）。"></p>
        <section id="sceneAnimationTrackCopy"></section>
        <p id="sceneAnimationCounts" class="muted"></p><div id="sceneAnimationTracks"></div></section>
      <section id="sceneAnimationUsage" hidden></section>
      <section id="sceneAnimationPreview"><h3 data-i18n="动画采样示意"></h3>
        <p class="muted" data-i18n="此处以基本形状和帧索引展示已检查的动画采样，不加载素材或物理。位移按 12% 显示；保存后可在场景预览查看实际图片。"></p>
        <label id="sceneAnimationClipSelection"><span data-i18n="预览动画片段"></span><select id="sceneAnimationPreviewClip"></select></label><p id="sceneAnimationClipRange" class="muted"></p>
        <div id="sceneAnimationStage" class="scene-animation-stage" role="img" data-i18n-aria-label="动画采样示意"></div>
        <div class="scene-animation-transport"><button id="sceneAnimationPlay" type="button" class="doc-btn doc-btn-ghost" data-i18n="播放动画"></button><button id="sceneAnimationPause" type="button" class="doc-btn doc-btn-ghost" data-i18n="暂停动画"></button><button id="sceneAnimationStop" type="button" class="doc-btn doc-btn-ghost" data-i18n="停止动画"></button></div>
        <label><span data-i18n="动画时间"></span><input id="sceneAnimationPosition" type="range" min="0" max="1" step="0.01" value="0"></label>
        <output id="sceneAnimationTime" for="sceneAnimationPosition"></output><pre id="sceneAnimationValues" lang="" tabindex="0"></pre>
        <p id="sceneAnimationPreviewStatus" role="status"></p></section>
      <section id="sceneAnimationReview" hidden><h3 data-i18n="动画修改审阅"></h3><ul id="sceneAnimationChangedPaths"></ul><div class="scene-animation-comparison">
        <section><h4 data-i18n="修改前的完整原文"></h4><pre id="sceneAnimationBefore" lang="" tabindex="0"></pre></section><section><h4 data-i18n="应用后的完整原文"></h4><pre id="sceneAnimationAfter" lang="" tabindex="0"></pre></section></div></section></div>
    <p id="sceneAnimationStatus" role="status" aria-live="polite"></p><p id="sceneAnimationDiagnostic" class="scene-animation-diagnostic"></p>
    <footer><p class="muted" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p><div><button id="sceneAnimationCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查并预览动画"></button><button id="sceneAnimationApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button><button id="sceneAnimationCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></div></footer>`;
  document.body.append(dialog);
  const el = name => dialog.querySelector('#sceneAnimation' + name);
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  let disposed = false, epoch = 0, session = null, pending = false, proposal = null, approval = '', draft = null, rows = [], initial = '', opener = null;
  let targetCatalog = null, targetState = 'idle', targetGeneration = 0, targetCapability = null, targetCatalogToken, approvedTargets = null;
  let scopeGeneration = 0, scopeCapability = supportsStudioCoreSceneAnimationInstances();
  let message = '', diagnostic = '', translations = [], previewForm = '', previewState = 'stopped', latestSample = null, previewModel = null, selectedClip = null;
  const eligible = context => context.editable === true && !context.creating && context.sourceJSON === true && context.animationSource === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string';
  const current = () => {
    const context = getContext(); return Boolean(!disposed && dialog.open && session && eligible(context) && context.available === true && !context.busy
      && context.sourcePath === session.source.sourcePath && context.sourceToken === session.source.token);
  };
  const raw = () => session ? { durationSeconds: el('Duration').value, loop: el('Loop').value, ...(session.model.schemaVersion === 4 || el('PlaybackScope').value !== 'scene' ? { playbackScope: el('PlaybackScope').value } : {}), tracks: rows.map(row => ({ id: row.id,
    instanceId: row.instance.value, property: row.property.value, interpolation: row.interpolation.value,
    ...(row.property.value === 'spriteFrame2d' ? { grid: { columns: row.columns.value, rows: row.gridRows.value } } : {}),
    keyframes: row.keys.map(key => ({ atSeconds: key.time.value, value: key.vector ? [key.x.value, key.y.value] : key.x.value })) })), ...([3, 4].includes(session.model.schemaVersion) || clips.getValue().length ? { clips: clips.getValue() } : {}) } : null;
  const signature = () => JSON.stringify(raw());
  const dirty = () => Boolean(session && signature() !== initial);
  const canReadTargets = () => typeof getTargets === 'function' && getContext().targetsAvailable === true;
  const hasTargets = () => Boolean(session && current() && canReadTargets() && targetCatalog && targetState === 'ready'
    && targetCatalogToken === getContext().targetsToken && sceneAnimationTargetsMatchSource(targetCatalog, session.source));
  const scopeReady = () => {
    const supported = supportsStudioCoreSceneAnimationInstances();
    if (supported !== scopeCapability) { scopeCapability = supported; scopeGeneration++; if (!supported) { proposal = null; approval = ''; approvedTargets = null; } }
    return session?.model.schemaVersion !== 4 && el('PlaybackScope').value === 'scene' || supported;
  };
  const approved = () => scopeReady() && isSceneAnimationProposal(proposal) && signature() === approval
    && (!approvedTargets || hasTargets() && targetCatalog === approvedTargets);
  const previewCurrent = () => current() && scopeReady() && previewForm === signature();
  function paintValues() {
    el('Stage').setAttribute('aria-label', t('动画采样示意'));
    if (latestSample) renderSceneAnimationSample(el('Stage'), latestSample, { label: id => t('场景实例：{0}', id), frameLabel: index => t('帧索引 {0}', index) });
    el('Values').textContent = (latestSample?.values || []).map(value => `${value.instanceId}\n${t(propertyLabels[value.property])}: ${JSON.stringify(value.value)}`).join('\n\n');
  }
  let clips;
  const usage = setupSceneAnimationUsage({ container: el('Usage'), getUsage, translate: t,
    getContext: () => ({ current: current(), available: getContext().usageAvailable === true, usageToken: getContext().usageToken, source: session?.source, clips: clips?.getValue() || [] }),
    onSelectionChange: (_selected, previous) => { clips?.refresh(); if (previous) clips?.focusUsage(previous); } });
  clips = setupSceneAnimationClips({ container: el('Clips'), onChange: changed, onUsage: id => usage.open(id), translate: t,
    getContext: () => ({ available: supportsStudioCoreSceneAnimationClips(), durationSeconds: el('Duration').value, loop: el('Loop').value === 'true', usageAvailable: typeof getUsage === 'function' && getContext().usageAvailable === true && current(), usageSelected: usage.selectedClipId() }) });
  const retime = setupSceneAnimationRetime({ container: el('Retime'), translate: t,
    getContext: () => ({ session, sourcePath: getContext().sourcePath, sourceToken: getContext().sourceToken,
      current: current(), available: supportsStudioCoreSceneAnimationRetime(), locked: pending, form: signature() }),
    prepare: async durationSeconds => {
      const owner = session, request = epoch, signatureBefore = signature(), value = edit();
      const result = await retimeSceneAnimationDraft(owner.source.content, value, durationSeconds);
      return () => {
        if (!current() || pending || owner !== session || request !== epoch || signatureBefore !== signature() || !supportsStudioCoreSceneAnimationRetime()) return null;
        if (result.durationSeconds === value.durationSeconds) return false;
        draft = form(result); render(); invalidate(); refresh(); return true;
      };
    } });
  const trackCopy = setupSceneAnimationTrackCopy({ container: el('TrackCopy'), translate: t,
    getContext: () => ({ session, sourcePath: getContext().sourcePath, sourceToken: getContext().sourceToken,
      current: current(), available: supportsStudioCoreSceneAnimationTrackCopy(), locked: pending, form: signature(),
      catalog: targetCatalog, catalogGeneration: targetGeneration, catalogToken: getContext().targetsToken, targetsAvailable: hasTargets(),
      tracks: rows.map(row => { const instance = hasTargets() && targetCatalog.targets.find(target => target.instanceId === row.instance.value);
        return { id: row.id, label: `${t(propertyLabels[row.property.value])} · ${instance ? targetLabel(instance) : row.instance.value} · ${row.id}` }; }),
      targets: hasTargets() ? targetCatalog.targets.map(target => ({ instanceId: target.instanceId, label: targetLabel(target) })) : [] }),
    prepare: async (sourceTrackId, targetInstanceId) => {
      const owner = session, request = epoch, signatureBefore = signature(), catalog = targetCatalog, generation = targetGeneration;
      if (!hasTargets()) throw Error('targets');
      const target = sceneAnimationTargetValue(catalog, targetInstanceId), value = edit();
      const used = new Set([owner.model.sceneObjectId, target, ...value.tracks.flatMap(track => [track.id, track.instanceId]), ...(value.clips || []).map(clip => clip.id)]); let id;
      for (let attempt = 0; attempt < 8; attempt++) { const candidate = globalThis.crypto?.randomUUID?.(); if (typeof candidate === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(candidate) && !used.has(candidate)) { id = candidate; break; } }
      if (!id) throw Error('identity');
      const result = await copySceneAnimationTrackDraft(owner.source.content, value, sourceTrackId, target, id);
      return () => {
        if (!current() || pending || owner !== session || request !== epoch || signatureBefore !== signature() || !supportsStudioCoreSceneAnimationTrackCopy()
          || !hasTargets() || targetCatalog !== catalog || generation !== targetGeneration) return null;
        draft = form(result); render(); invalidate(); refresh(); return true;
      };
    } });
  function refreshClipSelection() {
    const choices = previewModel?.clips || [], selector = el('PreviewClip'), signature = JSON.stringify([choices.map(clip => [clip.id, clip.name]), t('完整动画')]);
    el('ClipSelection').hidden = !choices.length;
    if (selector.dataset.choices !== signature) {
      selector.dataset.choices = signature; selector.replaceChildren();
      for (const [id, label] of [['', t('完整动画')], ...choices.map(clip => [clip.id, `${clip.name} · ${clip.id}`])]) { const option = node('option', label); option.value = id; selector.append(option); }
    }
    selector.value = selectedClip || ''; selector.disabled = !previewCurrent() || pending;
    const clip = choices.find(item => item.id === selectedClip);
    el('Position').max = String(clip ? clip.endSeconds - clip.startSeconds : previewModel?.durationSeconds || 1);
    el('ClipRange').textContent = clip ? t('原时间轴 {0}–{1} 秒 · 片段时间从 0 开始', clip.startSeconds, clip.endSeconds) : '';
  }
  const player = createSceneAnimationPlayer({ isCurrent: previewCurrent,
    onSample: value => { latestSample = value; paintValues(); el('Position').value = String(value.localTimeSeconds); el('Time').textContent = `${value.localTimeSeconds.toFixed(2)} / ${Number(el('Position').max).toFixed(2)} s`; },
    onState: value => { previewState = value.state; refreshTransport(); },
  });
  function clearPreview() { previewForm = ''; previewModel = null; selectedClip = null; latestSample = null; player.clear(); el('Stage').replaceChildren(); el('Values').textContent = ''; el('Position').value = '0'; el('Time').textContent = ''; }
  function invalidate() { proposal = null; approval = ''; approvedTargets = null; diagnostic = ''; message = '动画表单已变化；检查后可预览并应用。'; clearPreview(); }
  function changed() { if (!pending && current()) { draft = raw(); invalidate(); refresh(); } }
  // Directory reads have independent permission/request generations. Updating
  // labels never rebuilds form rows or overwrites the authored instance field.
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
  function targetLabel(target) { return t('{0} · 实例 {1}', target.name, target.instanceId); }
  function refreshTargets() {
    const ready = hasTargets(), available = canReadTargets(), locked = pending || !current();
    el('Targets').hidden = !session;
    el('TargetsRefresh').hidden = !available; el('TargetsRefresh').disabled = locked || targetState === 'loading';
    el('TargetsStatus').textContent = targetState === 'loading' ? t('正在读取已保存场景的实例…')
      : targetState === 'failed' ? t('无法读取场景实例；保留手动编辑和采样，目标尚未验证。可刷新重试。')
      : ready ? t('已读取 {0} 个已保存实例；检查时核对当前表单目标。', targetCatalog.targets.length)
      : t('尚未验证目标实例。可手动编辑与采样；保存后的场景构建仍会检查目标。');
    el('TargetsPath').textContent = ready ? targetCatalog.scene.sourcePath : '';
    for (const row of rows) {
      row.targetField.hidden = !available; row.target.disabled = locked || !ready;
      const first = t('从已保存场景选择实例'), renderKey = JSON.stringify([ready ? targetCatalog.targets.map(targetLabel) : [], first]);
      if (row.targetRenderKey !== renderKey) {
        row.targetRenderKey = renderKey; row.target.replaceChildren();
        const placeholder = node('option', first); placeholder.value = ''; row.target.append(placeholder);
        if (ready) for (const target of targetCatalog.targets) { const option = node('option', targetLabel(target)); option.value = target.instanceId; row.target.append(option); }
      }
      const known = ready && targetCatalog.targets.some(target => target.instanceId === row.instance.value);
      row.target.value = known ? row.instance.value : '';
      row.targetHint.hidden = !ready || known;
      row.targetHint.textContent = !ready || known ? '' : t('当前编号未在上次读取的场景中找到，请选择实例或修正编号。原值已保留。');
    }
  }
  async function loadTargets() {
    if (pending || !current() || !canReadTargets()) return false;
    const owner = session, request = ++targetGeneration, capability = getContext().targetsToken;
    targetCatalog = null; targetCatalogToken = undefined; targetState = 'loading'; revokeTargetApproval(); refresh();
    const owns = () => !disposed && request === targetGeneration && owner === session && current() && canReadTargets() && getContext().targetsToken === capability;
    try {
      const catalog = await getTargets(owner.source); if (!owns()) return false;
      if (!isSceneAnimationTargets(catalog) || !sceneAnimationTargetsMatchSource(catalog, owner.source)) throw Error('targets');
      // A pending manual check may have completed while the directory loaded.
      // A newly available directory requires one check against that snapshot.
      revokeTargetApproval(); targetCatalog = catalog; targetCatalogToken = capability; targetState = 'ready'; return true;
    } catch {
      if (owns()) { revokeTargetApproval(); targetCatalog = null; targetState = 'failed'; }
      return false;
    } finally { if (!disposed && owner === session && dialog.open) refresh(); }
  }
  const propertyLabels = { offset2d: '二维偏移', rotation2d: '二维旋转（度）', scale2d: '二维缩放', opacity: '不透明度', spriteFrame2d: '序列帧（等分网格）' };
  function translated(tag, key, ...args) { const result = node(tag), update = () => { result.textContent = t(key, ...args); }; translations.push(update); update(); return result; }
  function field(key, control) { const label = node('label'); label.append(translated('span', key), control); return label; }
  function input(name, value, number = true) {
    const result = node('input'); result.id = 'sceneAnimation' + name; result.type = 'text'; result.value = value; result.spellcheck = false;
    if (number) result.inputMode = 'decimal'; result.addEventListener('input', changed); return result;
  }
  function select(name, value, choices) {
    const result = node('select'); result.id = 'sceneAnimation' + name;
    for (const [id, label] of choices) { const option = translated('option', label); option.value = id; result.append(option); }
    result.value = value; return result;
  }
  const totalKeys = () => rows.reduce((sum, row) => sum + row.keys.length, 0);
  function render() {
    translations = []; rows = []; el('Tracks').replaceChildren(); clips.setValue(draft.clips || []);
    el('Duration').value = draft.durationSeconds; el('Loop').value = draft.loop; el('PlaybackScope').value = draft.playbackScope || 'scene';
    const owner = session, request = epoch;
    for (const [index, value] of draft.tracks.entries()) {
      const box = node('section'); box.className = 'scene-animation-track'; box.dataset.trackId = value.id;
      const base = `Track${index}`, title = translated('h4', '动画轨道 {0}', index + 1), identity = node('code', value.id);
      const row = { id: value.id, box, keys: [], instance: input(base + 'Instance', value.instanceId, false),
        property: select(base + 'Property', value.property, Object.entries(propertyLabels).filter(([name]) => name !== 'spriteFrame2d' || supportsStudioCoreSceneAnimationSprites())),
        interpolation: select(base + 'Interpolation', value.interpolation, value.property === 'spriteFrame2d' ? [['step', '逐帧保持']] : [['linear', '线性插值'], ['step', '逐帧保持']]),
        columns: input(base + 'Columns', value.grid?.columns ?? '2'), gridRows: input(base + 'Rows', value.grid?.rows ?? '2'),
        target: select(base + 'Target', '', []), targetHint: node('p'), targetRenderKey: null,
        remove: translated('button', '移除动画轨道'), add: translated('button', '添加关键帧') };
      const owns = () => current() && !pending && session === owner && epoch === request && rows.includes(row) && el('Tracks').contains(box);
      for (const button of [row.remove, row.add]) { button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; }
      const heading = node('div'); heading.className = 'scene-animation-toolbar'; heading.append(title, row.remove);
      const settings = node('div'); settings.className = 'scene-animation-track-settings'; settings.append(field('目标场景实例编号', row.instance), field('动画属性', row.property), field('插值方式', row.interpolation));
      row.targetField = field('按场景实例名称选择', row.target); row.targetField.className = 'scene-animation-target-field'; row.targetHint.className = 'scene-animation-target-hint';
      row.targetHint.id = 'sceneAnimation' + base + 'TargetHint'; row.instance.setAttribute('aria-describedby', row.targetHint.id);
      box.append(heading, identity, row.targetField, row.targetHint, settings);
      if (value.property === 'spriteFrame2d') {
        const grid = node('div'); grid.className = 'scene-animation-settings';
        row.columns.inputMode = 'numeric'; row.gridRows.inputMode = 'numeric';
        grid.append(field('图集列数', row.columns), field('图集行数', row.gridRows));
        const hint = translated('p', '按从左到右、从上到下的顺序编号，从 0 开始；行列各为 1–64。仅逐帧保持，不在帧之间插值。'); hint.className = 'muted';
        const resource = translated('p', '序列帧使用目标实例现有的图片。请在场景或投影的图片字段选择图集；此处不会绑定或替换资源。'); resource.className = 'muted';
        box.append(grid, hint, resource);
      }
      row.target.addEventListener('change', () => {
        if (!owns() || !hasTargets()) return;
        try { const value = sceneAnimationTargetValue(targetCatalog, row.target.value); if (value !== row.instance.value) { row.instance.value = value; changed(); } }
        catch { refreshTargets(); }
      });
      row.interpolation.addEventListener('change', changed);
      row.property.addEventListener('change', () => {
        if (!owns()) return;
        const previous = draft.tracks[index].property;
        draft = raw(); const updated = draft.tracks[index], vector = ['offset2d', 'scale2d'].includes(updated.property);
        if (updated.property === 'spriteFrame2d') {
          updated.interpolation = 'step';
          for (const key of updated.keyframes) key.value = '0';
        } else {
          delete updated.grid;
          for (const key of updated.keyframes) if (previous === 'spriteFrame2d' || Array.isArray(key.value) !== vector) key.value = vector ? updated.property === 'scale2d' ? ['1', '1'] : ['0', '0'] : updated.property === 'opacity' ? '1' : '0';
        }
        render(); changed();
      });
      row.remove.addEventListener('click', () => { if (!owns() || rows.length <= 1) return; draft = raw(); draft.tracks.splice(index, 1); render(); changed(); });
      for (const [keyIndex, valueKey] of value.keyframes.entries()) {
        const item = node('div'); item.className = 'scene-animation-key';
        const keyBase = base + `Key${keyIndex}`, vector = Array.isArray(valueKey.value), values = vector ? valueKey.value : [valueKey.value];
        const key = { time: input(keyBase + 'Time', valueKey.atSeconds), vector, x: input(keyBase + 'X', values[0]), y: input(keyBase + 'Y', values[1] || '0'), remove: translated('button', '移除关键帧') };
        key.remove.id = 'sceneAnimation' + keyBase + 'Remove'; key.remove.type = 'button'; key.remove.className = 'doc-btn doc-btn-ghost';
        if (value.property === 'spriteFrame2d') key.x.inputMode = 'numeric';
        item.append(field('关键帧时间（秒）', key.time), field(vector ? 'X 值' : value.property === 'spriteFrame2d' ? '帧索引（从 0 开始）' : '关键帧数值', key.x)); if (vector) item.append(field('Y 值', key.y)); item.append(key.remove);
        key.remove.addEventListener('click', () => { if (!owns() || row.keys.length <= 1 || !row.keys.includes(key) || !box.contains(item)) return; draft = raw(); draft.tracks[index].keyframes.splice(keyIndex, 1); render(); changed(); });
        row.keys.push(key); box.append(item);
      }
      row.add.id = 'sceneAnimation' + base + 'AddKey'; row.remove.id = 'sceneAnimation' + base + 'Remove';
      row.add.addEventListener('click', () => {
        if (!owns() || row.keys.length >= 64 || totalKeys() >= 512) return;
        draft = raw(); const track = draft.tracks[index], last = track.keyframes.at(-1), duration = Number(draft.durationSeconds);
        let insertion = track.keyframes.length, time = last ? Number(last.atSeconds) + 0.1 : 0, template = last;
        if (last && Number.isFinite(duration) && duration > Number(last.atSeconds)) time = Math.min(duration, time);
        else if (last && track.keyframes.length > 1) {
          let gap = 0;
          for (let i = 1; i < track.keyframes.length; i++) {
            const left = Number(track.keyframes[i - 1].atSeconds), right = Number(track.keyframes[i].atSeconds), middle = left + (right - left) / 2;
            if (right - left > gap && middle > left && middle < right) { gap = right - left; insertion = i; time = middle; template = track.keyframes[i - 1]; }
          }
        }
        track.keyframes.splice(insertion, 0, { atSeconds: String(Number.isFinite(time) ? time : 0),
          value: template ? (Array.isArray(template.value) ? [...template.value] : template.value) : ['offset2d', 'scale2d'].includes(track.property) ? ['0', '0'] : '0' });
        render(); changed();
      });
      box.append(row.add); rows.push(row); el('Tracks').append(box);
    }
  }
  function refreshTransport() {
    const ready = previewCurrent() && !pending;
    refreshClipSelection();
    el('Play').disabled = !ready || previewState === 'playing'; el('Pause').disabled = !ready || previewState !== 'playing';
    el('Stop').disabled = !ready; el('Position').disabled = !ready;
    el('PreviewStatus').textContent = t(!ready ? '检查当前表单后可播放示意。' : previewState === 'error' ? '动画采样失败，请重新检查。' : previewState === 'playing' ? '正在播放动画示意。' : '动画示意已就绪。');
  }
  function refresh() {
    if (disposed) return;
    observeTargetCapability();
    if (session && !scopeReady()) clearPreview();
    const context = getContext(); button.hidden = !eligible(context); button.disabled = context.available !== true || Boolean(context.busy); button.textContent = t('编辑场景动画');
    if (session && !current()) { if (!pending) proposal = null; resetTargets({ review: !pending }); clearPreview(); message = '原文已变化，请返回后重新打开动画编辑。'; }
    if (!pending && proposal && !approved()) invalidate();
    translatePage(dialog); for (const translate of translations) translate();
    dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty()); el('Fields').hidden = !session;
    const locked = pending || !current();
    for (const control of el('Fields').querySelectorAll('input,select,button')) control.disabled = locked;
    clips.setDisabled(locked);
    el('PlaybackScope').disabled = locked || !supportsStudioCoreSceneAnimationInstances();
    el('PlaybackScopeProjectHint').hidden = el('PlaybackScope').value !== 'instance';
    el('PlaybackScopeStatus').textContent = supportsStudioCoreSceneAnimationInstances() ? '' : t('当前核心不支持实例运行范围；整场景旧格式仍可编辑。');
    el('AddTrack').disabled = locked || rows.length >= 32 || totalKeys() >= 512;
    for (const row of rows) { row.interpolation.disabled = locked || row.property.value === 'spriteFrame2d'; row.remove.disabled = locked || rows.length <= 1; row.add.disabled = locked || row.keys.length >= 64 || totalKeys() >= 512; for (const key of row.keys) key.remove.disabled = locked || row.keys.length <= 1; }
    el('Check').disabled = locked || !scopeReady(); el('Apply').disabled = locked || !approved();
    el('Path').textContent = session?.source.sourcePath || context.sourcePath || '';
    el('Scene').textContent = session ? t('动画所属场景：{0}', session.model.sceneObjectId) : '';
    el('Counts').textContent = t('轨道 {0} / 32 · 关键帧 {1} / 512', rows.length, totalKeys());
    el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic;
    el('Review').hidden = !proposal; el('Before').textContent = proposal?.beforeContent || ''; el('After').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    refreshTargets(); refreshTransport(); usage.refresh(); retime.refresh(); trackCopy.refresh();
  }
  function close(force = false) {
    if (!force && dirty() && !window.confirm(t('丢弃本次动画表单修改？原文草稿不会改变。'))) return false;
    const target = opener, request = ++epoch; clearPreview(); resetTargets(); usage.reset(); retime.reset(); trackCopy.reset(); opener = null; session = null; pending = false; proposal = null; draft = null; rows = []; message = ''; diagnostic = '';
    if (dialog.open) dialog.close(); refresh();
    Promise.resolve().then(() => { if (!disposed && request === epoch && !dialog.open && target?.isConnected !== false) target?.focus?.(); }); return true;
  }
  const fail = (error, key) => { proposal = null; approval = ''; approvedTargets = null; message = key; diagnostic = typeof error?.errorCode === 'string' ? error.errorCode : ''; };
  function form(model) { return { durationSeconds: String(model.durationSeconds), loop: String(model.loop), ...(model.schemaVersion === 4 ? { playbackScope: model.playbackScope } : {}), ...([3, 4].includes(model.schemaVersion) ? { clips: model.clips } : {}), tracks: model.tracks.map(row => ({ ...row,
    ...(row.grid ? { grid: { columns: String(row.grid.columns), rows: String(row.grid.rows) } } : {}),
    keyframes: row.keyframes.map(key => ({ atSeconds: String(key.atSeconds), value: Array.isArray(key.value) ? key.value.map(String) : String(key.value) })) })) }; }
  function preview(model) { previewForm = signature(); previewModel = model; if (!model.clips?.some(clip => clip.id === selectedClip)) selectedClip = null; refreshClipSelection(); player.load(model); if (selectedClip) player.selectClip(selectedClip); }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || context.available !== true) return false;
    const request = ++epoch; opener = document.activeElement; pending = true; message = '正在读取动画文档…'; dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && next.available === true
      && next.sourcePath === context.sourcePath && next.sourceToken === context.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || Object.keys(source).length !== 5 || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken
        || !/^sha256:[a-f0-9]{64}$/.test(source.sourceRevision) || !/^sha256:[a-f0-9]{64}$/.test(source.baseSourceRevision) || typeof source.content !== 'string') throw Error('source');
      const captured = Object.freeze({ ...source }), model = await readSceneAnimationDocument(captured.content); if (!owns()) return false;
      session = { source: captured, model }; draft = form(model); render(); retime.reset(draft.durationSeconds); trackCopy.reset(); initial = signature(); preview(model); message = '编辑关键帧，检查后应用到原文草稿。'; return true;
    } catch (error) { if (owns()) fail(error, '无法读取有效动画文档，请检查原文。'); return false; }
    finally { if (!disposed && request === epoch && dialog.open) { pending = false; refresh(); if (session && canReadTargets()) void loadTargets(); } }
  }
  function numeric(value) { if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw Error('number'); return Number(value); }
  function edit() {
    const value = raw(); if (!scopeReady()) throw Object.assign(new Error('Animation scope is unavailable.'), { errorCode: 'studio_core_unavailable' });
    if (value.playbackScope !== undefined && !['scene', 'instance'].includes(value.playbackScope)) throw Error('scope');
    if (!['true', 'false'].includes(value.loop)) throw Error('loop');
    return { durationSeconds: numeric(value.durationSeconds), loop: value.loop === 'true', ...(value.playbackScope !== undefined ? { playbackScope: value.playbackScope } : {}), ...(value.clips ? { clips: value.clips.map(clip => { if (!['true', 'false'].includes(clip.loop)) throw Error('clip loop'); return { ...clip, startSeconds: numeric(clip.startSeconds), endSeconds: numeric(clip.endSeconds), loop: clip.loop === 'true' }; }) } : {}), tracks: value.tracks.map(row => ({ ...row,
      ...(row.grid ? { grid: { columns: numeric(row.grid.columns), rows: numeric(row.grid.rows) } } : {}),
      keyframes: row.keyframes.map(key => ({ atSeconds: numeric(key.atSeconds), value: Array.isArray(key.value) ? key.value.map(numeric) : numeric(key.value) })) })) };
  }
  async function check() {
    if (pending || !current() || !scopeReady()) return false;
    const scopeRequest = scopeGeneration;
    const owner = session, request = epoch, form = signature(), targets = hasTargets() ? targetCatalog : null, targetRequest = targetGeneration; pending = true; invalidate(); message = '正在检查动画修改…'; refresh();
    const owns = () => scopeReady() && scopeRequest === scopeGeneration && request === epoch && session === owner && current() && signature() === form && targetRequest === targetGeneration
      && (targets ? hasTargets() && targetCatalog === targets : !hasTargets());
    try {
      const value = edit();
      if (form === initial) { if (targets) validateSceneAnimationTargets(targets, owner.model); preview(owner.model); message = '动画示意已就绪。'; return true; }
      const candidate = await createSceneAnimationProposal(owner.source, value); if (!owns()) return false;
      if (!isSceneAnimationProposal(candidate) || candidate.sourceToken !== owner.source.token || candidate.beforeContent !== owner.source.content) throw Error('proposal');
      const model = await readSceneAnimationDocument(candidate.afterContent); if (!owns()) return false;
      if (targets) validateSceneAnimationTargets(targets, model);
      proposal = candidate; approval = form; approvedTargets = targets; preview(model); message = targets ? '动画及目录目标已检查，请审阅完整原文后应用。' : '动画参数已检查；目标尚未验证。请审阅完整原文后应用。'; return true;
    } catch (error) { if (owns()) fail(error, '动画修改未通过检查，输入已保留。'); return false; }
    finally { if (request === epoch && session === owner && dialog.open) { pending = false; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approved()) return false;
    const owner = session, request = epoch, candidate = proposal, form = approval, targets = approvedTargets, scopeRequest = scopeGeneration; player.pause();
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => scopeReady() && scopeRequest === scopeGeneration && owns() && current() && proposal === candidate && signature() === form && approvedTargets === targets
      && (!targets || hasTargets() && targetCatalog === targets);
    pending = true; message = '正在应用动画修改到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged, ...(targets ? { targets } : {}) }); if (!owns()) return false;
      const context = getContext();
      if (proposal !== candidate || signature() !== form || result?.applied !== true || result.sourcePath !== owner.source.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || result.sourceToken === owner.source.token || !eligible(context) || !context.available || context.busy
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('result');
      opener = null; close(true); result.focus?.(); return true;
    } catch (error) { if (owns()) fail(error, '动画修改未确认应用，输入已保留。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  function addTrack() {
    if (pending || !current() || rows.length >= 32 || totalKeys() >= 512) return;
    const used = new Set([session.model.sceneObjectId, ...rows.flatMap(row => [row.id, row.instance.value])]); let id;
    for (let attempt = 0; attempt < 8; attempt++) { const candidate = globalThis.crypto?.randomUUID?.(); if (typeof candidate === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(candidate) && !used.has(candidate)) { id = candidate; break; } }
    if (!id) { message = '无法生成动画轨道编号，请重试。'; refresh(); return; }
    draft = raw(); draft.tracks.push({ id, instanceId: '', property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: '0', value: ['0', '0'] }] }); render(); changed();
    rows.at(-1).instance.focus();
  }
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('TargetsRefresh').addEventListener('click', () => void loadTargets());
  el('PlaybackScope').addEventListener('change', () => {
    if (pending || !current() || !supportsStudioCoreSceneAnimationInstances()) { el('PlaybackScope').value = draft?.playbackScope || 'scene'; return; }
    changed();
  });
  el('Duration').addEventListener('input', changed); el('Loop').addEventListener('change', changed); el('AddTrack').addEventListener('click', addTrack);
  el('Play').addEventListener('click', () => { if (previewCurrent() && !pending) player.play(); }); el('Pause').addEventListener('click', () => player.pause()); el('Stop').addEventListener('click', () => player.stop());
  el('PreviewClip').addEventListener('change', () => { if (!previewCurrent() || pending) return; const selected = el('PreviewClip').value || null; if (selected !== null && !previewModel.clips?.some(clip => clip.id === selected)) { refreshClipSelection(); return; } selectedClip = selected; refreshClipSelection(); player.selectClip(selectedClip); });
  el('Position').addEventListener('input', () => { if (previewCurrent() && !pending) player.seek(Number(el('Position').value)); });
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); } });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  function hidden() { if (document.hidden || document.visibilityState === 'hidden') player.pause(); }
  const pagehide = () => player.pause(); document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide);
  const unsubscribe = onLanguageChange(() => { if (!disposed) { refresh(); paintValues(); } });
  function dispose() { if (disposed) return; close(true); disposed = true; usage.dispose(); clips.dispose(); retime.dispose(); trackCopy.dispose(); player.dispose(); unsubscribe?.(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); button.remove(); dialog.remove(); }
  refresh(); return Object.freeze({ open, refresh, dispose });
}
