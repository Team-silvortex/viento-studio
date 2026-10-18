import { readSceneAudioDocument, createSceneAudioTrackProposal, createSceneAudioResourceProposal, isSceneAudioProposal } from '../../engine/scene-audio-edit.mjs';
import { isSceneAudioResources, sceneAudioResourcesMatchSource, sceneAudioResourceIdentityIds } from '../../engine/scene-audio-resources.mjs';
import { isSceneAudioUsage, sceneAudioUsageMatchSource, sceneAudioUsageSource } from '../../engine/scene-audio-usage.mjs';
import { createSceneAudioAudition } from './scene-audio-audition.js';
import { sourceLocationSelection } from './app-source-location.js';
import { revealSourceOffset } from './app-source-reveal.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// Source drafts and verified audition use separate ports. This panel cannot
// save documents, fetch arbitrary assets, run cues or control a backend.
export function setupSceneAudio({ getContext = () => ({}), getSource = async () => null, getResources = null, loadAudition = null, getUsage = null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('sceneAudioStyle')) {
    const style = document.createElement('link'); style.id = 'sceneAudioStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene-audio.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'sceneAudioBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'sceneAudioDialog'; dialog.className = 'scene-audio-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneAudioTitle');
  // The saved JSON has an unknown author language. Its textarea uses lang=""
  // so switching the UI language cannot reshape code or move its viewport.
  dialog.innerHTML = `<header class="scene-audio-header"><h2 id="sceneAudioTitle" data-i18n="编辑场景声音"></h2><button id="sceneAudioClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="scene-audio-body"><p class="scene-audio-note" data-i18n="管理声音轨道和时间提示，可选择已绑定的 WAV 素材。编辑不会自动播放声音。"></p>
      <p id="sceneAudioPath" class="scene-audio-note"></p><p id="sceneAudioScene" class="scene-audio-note"></p>
      <section id="sceneAudioFields" hidden><h3 data-i18n="声音轨道"></h3><p id="sceneAudioTrackCount" class="scene-audio-note"></p>
        <div id="sceneAudioResources" class="scene-audio-resources" hidden><button id="sceneAudioLoadResources" type="button" class="doc-btn doc-btn-ghost" data-i18n="读取已绑定素材"></button>
          <p class="scene-audio-note" data-i18n="先在作品世界中为声音文档绑定已导入的 WAV 素材，再在此读取并选择。这里不会修改资源绑定。"></p>
          <p id="sceneAudioResourceStatus" class="scene-audio-note" role="status" aria-live="polite"></p></div>
        <p class="scene-audio-note" data-i18n="行为脚本可能通过轨道编号引用声音。移除前请检查脚本；此处不会自动修改脚本。"></p><div id="sceneAudioTracks"></div>
        <section id="sceneAudioUsage" class="scene-audio-usage" aria-labelledby="sceneAudioUsageTitle" hidden>
          <div class="scene-audio-usage-toolbar"><h3 id="sceneAudioUsageTitle" data-i18n="音轨使用位置"></h3><div>
            <button id="sceneAudioUsageRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新已保存行为"></button>
            <button id="sceneAudioUsageDismiss" type="button" class="doc-btn doc-btn-ghost" data-i18n="收起使用位置"></button></div></div>
          <p id="sceneAudioUsageTrack" class="scene-audio-note"></p>
          <p class="scene-audio-note" data-i18n="时间提示来自当前表单，行为文字匹配来自上次读取的同场景已保存文档。只匹配完整音轨编号，不解析脚本、其他场景或未保存行为草稿；未发现匹配不代表可以安全移除。"></p>
          <h4 data-i18n="当前表单的时间提示"></h4><p id="sceneAudioUsageCueStatus" class="scene-audio-note"></p><ul id="sceneAudioUsageCueList"></ul>
          <h4 data-i18n="已保存行为的文字匹配"></h4><p id="sceneAudioUsageStatus" class="scene-audio-note" role="status" aria-live="polite"></p>
          <p id="sceneAudioUsageBehaviorPath" class="scene-audio-note"></p><ul id="sceneAudioUsageBehaviorList"></ul>
          <section id="sceneAudioUsageSource" class="scene-audio-usage-source" aria-labelledby="sceneAudioUsageSourceTitle" hidden>
            <h4 id="sceneAudioUsageSourceTitle" data-i18n="上次读取的已保存原文"></h4>
            <p id="sceneAudioUsageSourcePath" class="scene-audio-note"></p><p id="sceneAudioUsageSourceField" class="scene-audio-note"></p>
            <textarea id="sceneAudioUsageSourceText" lang="" readonly spellcheck="false" aria-labelledby="sceneAudioUsageSourceTitle" aria-describedby="sceneAudioUsageSourcePath sceneAudioUsageSourceField"></textarea>
            <div class="scene-audio-usage-source-actions"><button id="sceneAudioUsageSourceLocate" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新定位参数"></button>
              <button id="sceneAudioUsageSourceDismiss" type="button" class="doc-btn doc-btn-ghost" data-i18n="收起原文"></button></div>
          </section>
        </section>
        <div class="scene-audio-cue-toolbar"><h3 data-i18n="声音时间提示"></h3><button id="sceneAudioAddCue" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加时间提示"></button></div>
        <p id="sceneAudioCueCount" class="scene-audio-note"></p><p class="scene-audio-note" data-i18n="可为每条提示选择当前音轨。按时间执行；同一时刻按列表顺序执行。上下移动不会改变触发时间。"></p>
        <p id="sceneAudioEmptyCues" class="scene-audio-note" data-i18n="没有时间提示；声音仍可由项目行为控制。" hidden></p><div id="sceneAudioCues"></div></section>
      <section id="sceneAudioReview" hidden><h3 data-i18n="声音修改审阅"></h3><ul id="sceneAudioChangedPaths"></ul><div class="scene-audio-comparison">
        <section><h4 data-i18n="修改前的完整原文"></h4><pre id="sceneAudioBefore" tabindex="0"></pre></section><section><h4 data-i18n="应用后的完整原文"></h4><pre id="sceneAudioAfter" tabindex="0"></pre></section></div></section></div>
    <div class="scene-audio-feedback"><p id="sceneAudioStatus" role="status" aria-live="polite"></p><p id="sceneAudioDiagnostic" class="scene-audio-diagnostic"></p></div>
    <footer class="scene-audio-footer"><div id="sceneAudioPreview" class="scene-audio-preview" hidden>
      <p class="scene-audio-note scene-audio-preview-help" data-i18n="按当前音量和循环设置试听一条 WAV；不会执行时间提示或保存修改。"></p>
      <p id="sceneAudioPreviewStatus" class="scene-audio-note" role="status" aria-live="polite"></p><button id="sceneAudioStopPreview" type="button" class="doc-btn doc-btn-ghost" data-i18n="停止试听"></button>
      <div id="sceneAudioPreviewTransport" class="scene-audio-preview-transport" hidden>
        <div class="scene-audio-preview-actions"><button id="sceneAudioPausePreview" type="button" class="doc-btn doc-btn-ghost" data-i18n="暂停试听"></button><button id="sceneAudioResumePreview" type="button" class="doc-btn doc-btn-ghost" data-i18n="继续试听" hidden></button></div>
        <label class="scene-audio-preview-position"><span data-i18n="试听进度"></span><input id="sceneAudioPreviewPosition" type="range" min="0" max="0" value="0" step="0.01" aria-describedby="sceneAudioPreviewTime"></label>
        <output id="sceneAudioPreviewTime" for="sceneAudioPreviewPosition" aria-live="off"></output></div></div>
      <span class="scene-audio-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></span><div>
      <button id="sceneAudioCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查声音修改"></button><button id="sceneAudioApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneAudioCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></div></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneAudio' + suffix);
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  let epoch = 0, disposed = false, pending = false, session = null, draft = null, initial = '', proposal = null, approval = '', opener = null;
  let tracks = [], cues = [], message = '', diagnostic = '', resourceCatalog = null, resourceState = 'idle';
  let formTranslations = [];
  let usageTrackId = '', usageCatalog = null, usageState = 'idle', usageGeneration = 0, usageSource = null;
  let audition = null, previewOwner = null, previewFailure = null, previewTimer = null;
  let previewSeeking = false, previewPointer = false, previewKey = false, previewResumeFocus = null;
  const resourceIdentities = new Set();
  const canReadResources = () => typeof getResources === 'function' && getContext().resourcesAvailable === true;
  const hasResources = () => Boolean(session && resourceCatalog && canReadResources() && sceneAudioResourcesMatchSource(resourceCatalog, session.source));
  const canReadUsage = () => typeof getUsage === 'function' && getContext().usageAvailable === true;
  const canPreview = () => typeof loadAudition === 'function' && getContext().auditionAvailable === true && audition?.available() === true;
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && context.audioSource === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(!disposed && dialog.open && session && eligible(context)
    && context.available === true && !context.busy && context.sourcePath === session.source.sourcePath && context.sourceToken === session.source.token); };
  const raw = () => session ? {
    tracks: tracks.map(row => ({ id: row.id, resourceId: row.resource.value, role: row.role.value, volume: row.volume.value, loop: row.loop.value })),
    cues: cues.map(row => ({ id: row.id, trackId: row.track.value, atSeconds: row.atSeconds.value, action: row.action.value })),
  } : null;
  const signature = () => JSON.stringify(raw());
  const dirty = () => Boolean(session && signature() !== initial);
  const approved = () => Boolean(isSceneAudioProposal(proposal) && signature() === approval && (!needsResources(raw()) || hasResources()));
  function invalidate() { proposal = null; approval = ''; message = '声音修改尚未应用；检查后再应用到草稿。'; diagnostic = ''; }
  function capture() { if (session) draft = raw(); }
  function changed() { stopPreview(); if (!pending && current()) { capture(); invalidate(); refresh(); } }
  function translatedNode(tag, key, ...args) {
    const element = node(tag), translate = () => { element.textContent = typeof key === 'function' ? key() : t(key, ...args); };
    formTranslations.push(translate); translate(); return element;
  }
  function field(key, value) { const label = node('label'); label.append(translatedNode('span', key), value); return label; }
  function input(id, value) {
    const result = node('input'); result.type = 'text'; result.inputMode = 'decimal'; result.id = 'sceneAudio' + id;
    result.value = value; result.spellcheck = false; result.addEventListener('input', changed); return result;
  }
  function select(id, value, choices) {
    const result = node('select'); result.id = 'sceneAudio' + id;
    for (const [key, label] of choices) { const option = translatedNode('option', label); option.value = key; result.append(option); }
    result.value = value; result.addEventListener('change', changed); return result;
  }
  function needsResources(value) {
    const originals = new Map(session.model.tracks.map(row => [row.id, row.resourceId])), resources = new Set(originals.values());
    return value.tracks.some(row => originals.has(row.id) ? originals.get(row.id) !== row.resourceId : !resources.has(row.resourceId));
  }
  function stopPreview() {
    clearPreviewTimer(); previewSeeking = false; previewPointer = false; previewKey = false; previewResumeFocus = null;
    previewOwner = null; previewFailure = null; audition?.stop();
  }
  function clearPreviewTimer() { if (previewTimer !== null) clearTimeout(previewTimer); previewTimer = null; }
  function previewTime(seconds) {
    const centiseconds = Math.floor(Math.max(0, seconds) * 100 + 1e-7), minutes = Math.floor(centiseconds / 6000);
    return `${minutes}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
  }
  function paintPreviewPosition(preview, input = false) {
    const duration = Number.isFinite(preview.durationSeconds) ? Math.max(0, preview.durationSeconds) : 0;
    const range = el('PreviewPosition'); range.max = String(duration); range.step = String(duration / 1000 || 0.001);
    if (!input && (previewSeeking || previewPointer || previewKey)) return;
    const requested = input ? Number(range.value) : preview.positionSeconds;
    const position = Number.isFinite(requested) ? Math.max(0, Math.min(duration, requested)) : 0;
    range.value = String(position);
    const time = `${previewTime(position)} / ${previewTime(duration)}`;
    el('PreviewTime').textContent = time;
    range.setAttribute('aria-valuetext', t('试听位置：{0} / {1}', previewTime(position), previewTime(duration)));
  }
  function schedulePreviewProgress() {
    if (previewTimer !== null || disposed || !dialog.open || audition?.snapshot().status !== 'playing') return;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (disposed || !dialog.open) return;
      if (!previewOwner?.isCurrent()) { stopPreview(); refreshPreview(); return; }
      const preview = audition.snapshot();
      if (preview.status !== 'playing') return;
      // Progress never redraws the form/review or repeatedly announces status.
      paintPreviewPosition(preview); schedulePreviewProgress();
    }, 250);
  }
  function refreshPreview() {
    if (disposed) return;
    if (previewOwner && !previewOwner.isCurrent()) stopPreview();
    const preview = previewFailure || audition?.snapshot() || { status: 'idle', trackId: null, resourceId: null };
    const active = ['loading', 'playing', 'paused', 'resuming'].includes(preview.status);
    const buffered = ['playing', 'paused', 'resuming'].includes(preview.status) && preview.durationSeconds > 0;
    const focused = document.activeElement;
    const focusResume = focused === el('PausePreview') && preview.status === 'paused';
    const focusPause = preview.status === 'playing' && (focused === el('ResumePreview')
      || previewResumeFocus === previewOwner && previewResumeFocus !== null && focused === document.body);
    el('Preview').hidden = !canPreview() && !active && preview.status !== 'error';
    el('StopPreview').disabled = !active;
    el('PreviewTransport').hidden = !buffered;
    el('PausePreview').hidden = preview.status !== 'playing'; el('PausePreview').disabled = !buffered || preview.status !== 'playing';
    el('ResumePreview').hidden = !['paused', 'resuming'].includes(preview.status); el('ResumePreview').disabled = !buffered || preview.status !== 'paused';
    el('PreviewPosition').disabled = !buffered || preview.status === 'resuming';
    // Swap only the active transport button; seeking and other editing keep focus.
    if (focusResume) el('ResumePreview').focus(); else if (focusPause) el('PausePreview').focus();
    if (preview.status !== 'resuming') previewResumeFocus = null;
    if (!buffered) { previewSeeking = false; previewPointer = false; previewKey = false; }
    paintPreviewPosition(preview);
    if (preview.status === 'playing') schedulePreviewProgress(); else clearPreviewTimer();
    const previewStatus = el('PreviewStatus'); previewStatus.dataset.status = preview.status;
    previewStatus.dataset.trackId = preview.trackId || ''; previewStatus.dataset.resourceId = preview.resourceId || '';
    previewStatus.dataset.errorCode = preview.errorCode || '';
    const trackNumber = tracks.findIndex(row => row.id === preview.trackId) + 1;
    const statusText = preview.status === 'loading' ? t('正在加载试听音轨 {0}…', trackNumber)
      : preview.status === 'playing' ? t('正在试听音轨 {0}。', trackNumber)
      : preview.status === 'paused' ? t('已暂停试听音轨 {0}。', trackNumber)
      : preview.status === 'resuming' ? t('正在继续试听音轨 {0}…', trackNumber)
      : preview.status === 'error' ? t(previewErrorMessage(preview.errorCode))
      : hasResources() ? t('点击音轨上的试听按钮开始。') : t('请先读取已绑定素材，再试听音轨。');
    if (previewStatus.textContent !== statusText) previewStatus.textContent = statusText;
    for (const row of tracks) {
      const missing = !hasResources() || !resourceCatalog.resources.some(item => item.resourceId === row.resource.value);
      row.preview.hidden = !canPreview(); row.preview.disabled = pending || !current() || !canPreview() || missing
        || ['loading', 'resuming'].includes(preview.status) && preview.trackId === row.id;
    }
  }
  function transportCurrent() {
    if (previewOwner?.isCurrent()) return true;
    stopPreview(); refreshPreview(); return false;
  }
  function transportFailed(owner) {
    if (previewOwner !== owner || !owner?.isCurrent()) return;
    const previous = audition.snapshot(); stopPreview();
    previewFailure = { status: 'error', trackId: previous.trackId, resourceId: previous.resourceId, errorCode: 'scene_audio_audition_device' }; refreshPreview();
  }
  function pausePreview() {
    if (!transportCurrent() || audition.snapshot().status !== 'playing') return;
    previewSeeking = false; previewPointer = false; previewKey = false;
    const owner = previewOwner;
    try { audition.pause(); refreshPreview(); } catch { transportFailed(owner); }
  }
  function resumePreview() {
    if (!transportCurrent() || audition.snapshot().status !== 'paused') return;
    previewSeeking = false; previewPointer = false; previewKey = false;
    const owner = previewOwner; previewResumeFocus = document.activeElement === el('ResumePreview') ? owner : null;
    // The adapter must resume AudioContext within this direct user gesture.
    try { Promise.resolve(audition.resume()).catch(() => transportFailed(owner)); refreshPreview(); } catch { transportFailed(owner); }
  }
  function seekPreview() {
    const seconds = Number(el('PreviewPosition').value); previewSeeking = false;
    if (!transportCurrent() || !['playing', 'paused'].includes(audition.snapshot().status)) return;
    const owner = previewOwner;
    try { audition.seek(seconds); refreshPreview(); } catch { transportFailed(owner); }
  }
  function previewErrorMessage(code) {
    if (code === 'scene_audio_audition_invalid') return '试听需要完整的 0–1 音量和有效循环设置。';
    if (code === 'scene_audio_audition_decoded_limit') return '此素材解码后的声音数据超过 128 MiB，无法试听。';
    if (code === 'scene_audio_audition_unavailable') return '当前环境不支持音轨试听。';
    if (code === 'scene_audio_audition_device') return '无法启动音频输出，请检查设备后重试。';
    if (code === 'scene_audio_audition_decode' || code === 'scene_audio_audition_format' || code === 'build_audio_format') return '无法解码此 WAV 素材，请检查格式。';
    if (code === 'scene_audio_audition_conflict' || code === 'scene_audio_audition_resource_changed') return '素材或原文已变化，请重新读取素材后再试听。';
    if (code === 'scene_audio_audition_size') return '素材超出试听大小限制。';
    return '无法试听此音轨，请检查素材后重试。';
  }
  function previewTrack(id) {
    if (pending || !current() || !canPreview() || !hasResources() || document.hidden || document.visibilityState === 'hidden') { refresh(); return; }
    const row = tracks.find(item => item.id === id);
    if (!row || !resourceCatalog.resources.some(item => item.resourceId === row.resource.value)) { refresh(); return; }
    stopPreview();
    let volume;
    try {
      volume = numeric(row.volume.value);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1 || !['true', 'false'].includes(row.loop.value)) throw Error('invalid');
    } catch {
      previewFailure = { status: 'error', trackId: id, resourceId: row.resource.value, errorCode: 'scene_audio_audition_invalid' }; refresh(); return;
    }
    const owner = session, request = epoch, catalog = resourceCatalog, form = signature();
    const resourceId = row.resource.value, loop = row.loop.value === 'true';
    // Keep ownership tied to the entire raw form, without requiring unrelated
    // unfinished fields to parse. Silent edits cannot start a late audition.
    const ticket = { isCurrent: () => previewOwner === ticket && session === owner && request === epoch && !pending
      && current() && canPreview() && hasResources() && resourceCatalog === catalog && signature() === form
      && !document.hidden && document.visibilityState !== 'hidden' };
    previewOwner = ticket;
    const failed = () => {
      if (!ticket.isCurrent()) return;
      stopPreview(); previewFailure = { status: 'error', trackId: id, resourceId, errorCode: 'scene_audio_audition_load' }; refresh();
    };
    try {
      // Invoke before the click handler yields so Web Audio retains the gesture.
      Promise.resolve(audition.play({ source: owner.source, catalog, resourceId, trackId: id, volume, loop, isCurrent: ticket.isCurrent }))
        .catch(failed);
    } catch { failed(); }
  }
  function clearUsageSource() {
    usageSource = null; el('UsageSource').hidden = true; el('UsageSourceText').value = '';
    el('UsageSourcePath').textContent = ''; el('UsageSourceField').textContent = '';
  }
  function usageSourceCurrent() {
    return Boolean(usageSource && current() && canReadUsage() && usageSource.owner === session
      && usageSource.catalog === usageCatalog && usageSource.trackId === usageTrackId
      && tracks.some(row => row.id === usageTrackId) && usageCatalog.matches.includes(usageSource.match));
  }
  function locateUsageSource() {
    if (!usageSourceCurrent()) { clearUsageSource(); return false; }
    const { source } = usageSource, selection = sourceLocationSelection(source.content, source, source.sourceRevision);
    if (selection.status !== 'exact') return false;
    const textarea = el('UsageSourceText');
    if (textarea.value !== source.content.replace(/\r\n|\r/g, '\n')) return false;
    textarea.focus({ preventScroll: true }); textarea.selectionStart = selection.start; textarea.selectionEnd = selection.end;
    el('UsageSource').scrollIntoView?.({ block: 'nearest' });
    revealSourceOffset(textarea, textarea.value, selection.start); return true;
  }
  function showUsageSource(owner, catalog, trackId, match, control) {
    if (!current() || !canReadUsage() || owner !== session || catalog !== usageCatalog || trackId !== usageTrackId
      || !tracks.some(row => row.id === trackId) || !catalog.matches.includes(match) || match.trackId !== trackId
      || !el('UsageBehaviorList').contains(control)) return false;
    let source;
    try { source = sceneAudioUsageSource(catalog, match); } catch { return false; }
    if (sourceLocationSelection(source.content, source, source.sourceRevision).status !== 'exact') return false;
    usageSource = { owner, catalog, trackId, match, source };
    el('UsageSourceText').value = source.content.replace(/\r\n|\r/g, '\n');
    refreshUsageSource(); return locateUsageSource();
  }
  function refreshUsageSource() {
    if (!usageSourceCurrent()) { if (usageSource) clearUsageSource(); return; }
    el('UsageSource').hidden = false;
    el('UsageSourcePath').textContent = t('已保存行为文档：{0}', usageSource.source.sourcePath);
    el('UsageSourceField').textContent = t('参数 {0} · {1}', usageSource.match.parameterName, usageSource.source.propertyPath);
    el('UsageSourceLocate').disabled = false; el('UsageSourceDismiss').disabled = false;
  }
  function clearUsage() {
    clearUsageSource(); usageGeneration++; usageTrackId = ''; usageCatalog = null; usageState = 'idle';
  }
  function refreshUsage() {
    if (!current() || !canReadUsage()) {
      if (usageTrackId || usageCatalog || usageState !== 'idle') clearUsage();
    }
    if (usageTrackId && !tracks.some(row => row.id === usageTrackId)) { usageTrackId = ''; clearUsageSource(); }
    for (const row of tracks) {
      row.usage.hidden = !canReadUsage(); row.usage.disabled = !current() || !canReadUsage();
      row.usage.setAttribute('aria-expanded', String(row.id === usageTrackId));
    }
    const visible = Boolean(usageTrackId && current() && canReadUsage());
    el('Usage').hidden = !visible; el('Usage').dataset.trackId = usageTrackId;
    el('UsageRefresh').disabled = !visible || usageState === 'loading';
    el('UsageDismiss').disabled = !visible;
    el('UsageTrack').textContent = visible ? t('音轨编号：{0}', usageTrackId) : '';
    const currentCues = visible ? cues.flatMap((row, index) => row.track.value === usageTrackId ? [{ row, index }] : []) : [];
    el('UsageCueStatus').textContent = currentCues.length ? t('当前表单有 {0} 条时间提示引用此音轨。', currentCues.length) : t('当前表单没有时间提示引用此音轨。');
    el('UsageCueList').replaceChildren();
    for (const { row, index } of currentCues) {
      const item = node('li'), locate = node('button', t('定位提示')), owner = session, trackId = usageTrackId, cueId = row.id;
      locate.type = 'button'; locate.id = `sceneAudioUsageCue${index}Locate`; locate.className = 'doc-btn doc-btn-ghost'; locate.dataset.cueId = cueId;
      locate.addEventListener('click', () => {
        // A list index is presentation only. Detached buttons cannot target a
        // replacement row after reordering, deletion, retargeting or a reload.
        if (!current() || !canReadUsage() || session !== owner || usageTrackId !== trackId || !cues.includes(row)
          || row.id !== cueId || row.track.value !== trackId || row.track.disabled
          || !el('UsageCueList').contains(locate) || !el('Cues').contains(row.track)) return;
        row.track.focus({ preventScroll: true }); row.track.scrollIntoView?.({ block: 'nearest' });
      });
      item.append(node('p', t('第 {0} 条提示 · {1}', index + 1, cueId)), locate); el('UsageCueList').append(item);
    }
    const matches = visible && usageCatalog ? usageCatalog.matches.filter(row => row.trackId === usageTrackId) : [];
    const status = el('UsageStatus'); status.dataset.status = usageState;
    status.textContent = usageState === 'loading' ? t('正在读取已保存行为中的音轨文字匹配…')
      : usageState === 'failed' ? t('无法读取使用位置；表单和审阅已保留，可刷新重试。')
      : usageCatalog ? usageCatalog.behavior === null ? t('当前场景没有关联的已保存行为文档。')
        : matches.length ? t('上次读取找到 {0} 处完整编号文字匹配。', matches.length)
        : t('上次读取未在已保存行为参数中找到完整编号文字匹配。')
      : t('尚未读取已保存行为。');
    el('UsageBehaviorPath').textContent = visible && usageCatalog?.behavior ? t('已保存行为文档：{0}', usageCatalog.behavior.sourcePath) : '';
    el('UsageBehaviorList').replaceChildren();
    for (const [index, match] of matches.entries()) {
      const item = node('li'), source = node('button', t('查看参数原文')), owner = session, catalog = usageCatalog, trackId = usageTrackId;
      source.type = 'button'; source.id = `sceneAudioUsageMatch${index}Source`; source.className = 'doc-btn doc-btn-ghost'; source.dataset.propertyPath = match.propertyPath;
      source.addEventListener('click', () => showUsageSource(owner, catalog, trackId, match, source));
      item.append(node('p', t('绑定 {0} · 实例 {1}', match.bindingId, match.instanceId)), node('p', t('参数 {0} · {1}', match.parameterName, match.propertyPath)), source);
      el('UsageBehaviorList').append(item);
    }
    refreshUsageSource();
  }
  async function loadUsage() {
    if (!current() || !canReadUsage() || !usageTrackId || usageState === 'loading') { refreshUsage(); return false; }
    const owner = session, request = epoch, generation = ++usageGeneration;
    clearUsageSource(); usageCatalog = null; usageState = 'loading'; refreshUsage();
    // Advisory reads belong to the source session, not the current form or
    // selection. Editing and checked proposals continue independently.
    const owns = () => !disposed && request === epoch && session === owner && generation === usageGeneration && current() && canReadUsage();
    try {
      const catalog = await getUsage(owner.source);
      if (!owns()) return false;
      if (!isSceneAudioUsage(catalog) || !sceneAudioUsageMatchSource(catalog, owner.source)) throw Error('Invalid audio usage snapshot');
      usageCatalog = catalog; usageState = 'ready'; return true;
    } catch {
      if (owns()) usageState = 'failed';
      return false;
    } finally {
      if (!disposed && request === epoch && session === owner && dialog.open) refreshUsage();
    }
  }
  function showUsage(id) {
    if (!current() || !canReadUsage() || !tracks.some(row => row.id === id)) { refreshUsage(); return; }
    if (usageTrackId !== id) clearUsageSource();
    usageTrackId = id; refreshUsage();
    // Only an explicit track selection scrolls; reads and refreshes keep the
    // current viewport and keyboard focus while their result arrives.
    el('Usage').scrollIntoView?.({ block: 'nearest' });
    if (!usageCatalog && usageState !== 'loading') void loadUsage();
  }
  function render() {
    formTranslations = []; tracks = []; cues = []; el('Tracks').replaceChildren(); el('Cues').replaceChildren();
    if (!session) return;
    for (const [index, row] of draft.tracks.entries()) {
      const wrapper = node('section'); wrapper.className = 'scene-audio-track';
      const identity = node('p', t('轨道 {0} · 资源 {1}', row.id, row.resourceId)); identity.className = 'scene-audio-note';
      const available = hasResources() ? resourceCatalog.resources : [];
      const options = available.map(item => [item.resourceId, () => t('素材 {0} · {1}', item.name, item.sourcePath)]);
      if (!available.some(item => item.resourceId === row.resourceId)) options.unshift([row.resourceId, () => t(resourceCatalog ? '当前素材（目录中不可用）：{0}' : '当前素材：{0}', row.resourceId)]);
      const resource = select(`Track${index}Resource`, row.resourceId, options), resourceField = field('WAV 素材', resource);
      resourceField.className = 'scene-audio-resource-field';
      const resourceHint = node('p'); resourceHint.className = 'scene-audio-note'; resourceHint.id = `sceneAudioTrack${index}ResourceHint`;
      const role = select(`Track${index}Role`, row.role, [['music', '音乐'], ['effect', '音效']]);
      const volume = input(`Track${index}Volume`, row.volume), loop = select(`Track${index}Loop`, row.loop, [['true', '是'], ['false', '否']]);
      const clone = translatedNode('button', '复制音轨'), remove = translatedNode('button', '移除音轨');
      for (const [control, suffix, action] of [[clone, 'Clone', cloneTrack], [remove, 'Remove', removeTrack]]) {
        control.type = 'button'; control.id = `sceneAudioTrack${index}${suffix}`; control.className = 'doc-btn doc-btn-ghost';
        control.addEventListener('click', () => action(row.id));
      }
      const preview = translatedNode('button', '试听音轨'); preview.type = 'button'; preview.id = `sceneAudioTrack${index}Preview`; preview.className = 'doc-btn doc-btn-ghost';
      preview.addEventListener('click', () => previewTrack(row.id));
      const usage = translatedNode('button', '查看使用位置'); usage.type = 'button'; usage.id = `sceneAudioTrack${index}Usage`; usage.className = 'doc-btn doc-btn-ghost';
      const owner = session;
      usage.setAttribute('aria-controls', 'sceneAudioUsage'); usage.addEventListener('click', () => {
        if (session === owner && tracks.some(item => item.usage === usage) && el('Tracks').contains(usage)) showUsage(row.id);
      });
      const actions = node('div'); actions.className = 'scene-audio-track-actions'; actions.append(preview, usage, clone, remove);
      const removalHint = node('p'); removalHint.className = 'scene-audio-note'; removalHint.id = `sceneAudioTrack${index}RemovalHint`;
      wrapper.append(identity, resourceField, resourceHint, field('声音用途', role), field('音量（0–1）', volume), field('循环播放', loop), actions, removalHint); el('Tracks').append(wrapper);
      tracks.push({ id: row.id, resource, identity, resourceHint, role, volume, loop, clone, remove, removalHint, preview, usage });
    }
    for (const [index, row] of draft.cues.entries()) {
      const wrapper = node('section'); wrapper.className = 'scene-audio-cue';
      const existing = session.model.cues.some(cue => cue.id === row.id);
      const identity = translatedNode('p', existing ? '提示 {0}' : '新增提示 {0}', row.id); identity.className = 'scene-audio-note';
      const track = select(`Cue${index}Track`, row.trackId, draft.tracks.map((item, trackIndex) => [item.id, () => t('音轨 {0} · {1}', trackIndex + 1, item.id)]));
      const atSeconds = input(`Cue${index}Time`, row.atSeconds), action = select(`Cue${index}Action`, row.action, [['play', '播放'], ['stop', '停止']]);
      const remove = translatedNode('button', '移除时间提示'); remove.type = 'button'; remove.id = `sceneAudioCue${index}Remove`; remove.className = 'doc-btn doc-btn-ghost';
      remove.addEventListener('click', () => removeCue(row.id));
      const up = translatedNode('button', '上移'), down = translatedNode('button', '下移');
      for (const [control, suffix, direction] of [[up, 'Up', -1], [down, 'Down', 1]]) {
        control.type = 'button'; control.id = `sceneAudioCue${index}${suffix}`; control.className = 'doc-btn doc-btn-ghost';
        control.addEventListener('click', () => moveCue(row.id, direction));
      }
      const actions = node('div'); actions.className = 'scene-audio-cue-actions'; actions.append(up, down, remove);
      wrapper.append(identity, field('提示音轨', track), field('触发时间（秒，0–60）', atSeconds), field('声音操作', action), actions); el('Cues').append(wrapper);
      cues.push({ id: row.id, track, atSeconds, action, up, down });
    }
  }
  function refresh() {
    if (disposed) return;
    if (previewOwner && !previewOwner.isCurrent()) stopPreview();
    const context = getContext(); button.hidden = !eligible(context); button.disabled = context.available !== true || Boolean(context.busy); button.textContent = t('编辑场景声音');
    if (proposal && !approved()) invalidate();
    if (session && !current()) { if (!pending) proposal = null; message = '原文已变化，请返回后重新打开声音编辑。'; }
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty());
    el('Fields').hidden = !session; const locked = pending || !current();
    for (const element of el('Fields').querySelectorAll('input,select,button')) element.disabled = locked;
    const referencedTracks = new Set(cues.map(row => row.track.value));
    for (const row of tracks) {
      const reason = tracks.length <= 1 ? '至少保留一条音轨。' : referencedTracks.has(row.id) ? '先移除引用此音轨的时间提示，或将提示换到其他音轨。' : '';
      row.clone.disabled = locked || tracks.length >= 16; row.remove.disabled = locked || Boolean(reason);
      row.removalHint.textContent = reason ? t(reason) : ''; row.removalHint.hidden = !reason;
      row.resource.disabled = locked || !hasResources();
      row.identity.textContent = t('轨道 {0} · 资源 {1}', row.id, row.resource.value);
      const missing = hasResources() && !resourceCatalog.resources.some(item => item.resourceId === row.resource.value);
      row.resourceHint.hidden = !missing; row.resourceHint.textContent = missing ? t('所选素材不在当前可用绑定中，选择已保留。请检查绑定或选择其他 WAV 素材。') : '';
    }
    el('Resources').hidden = !canReadResources(); el('LoadResources').disabled = locked || !canReadResources();
    el('ResourceStatus').textContent = resourceState === 'loading' ? t('正在读取已绑定的 WAV 素材…')
      : resourceState === 'failed' ? t('无法读取已绑定素材；表单和选择已保留，可重试。')
      : resourceCatalog ? resourceCatalog.resources.length ? t('已读取 {0} 个已绑定 WAV 素材。', resourceCatalog.resources.length)
        : t('当前没有可用的已绑定 WAV 素材。请先绑定素材，再重新读取。') : t('尚未读取已绑定素材；原有编辑仍可继续。');
    el('TrackCount').textContent = t('声音轨道 {0} / 16', tracks.length);
    for (const [index, row] of cues.entries()) { row.up.disabled = locked || index === 0; row.down.disabled = locked || index === cues.length - 1; }
    el('AddCue').disabled = locked || cues.length >= 64;
    el('CueCount').textContent = t('时间提示 {0} / 64', cues.length); el('EmptyCues').hidden = !session || cues.length !== 0;
    el('Check').disabled = locked || !dirty(); el('Apply').disabled = locked || !approved();
    el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic ? t(diagnostic) : '';
    el('Review').hidden = !proposal; el('Before').textContent = proposal?.beforeContent || ''; el('After').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    el('Path').textContent = session?.source.sourcePath || context.sourcePath || '';
    el('Scene').textContent = session ? t('声音所属场景：{0}', session.model.sceneObjectId) : '';
    refreshUsage(); refreshPreview();
  }
  function close(force = false) {
    stopPreview();
    if (!force && dirty() && !window.confirm(t('丢弃本次声音表单修改？原文草稿不会改变。'))) return false;
    clearUsage();
    const target = opener, request = ++epoch; opener = null; session = null; draft = null; tracks = []; cues = []; proposal = null; pending = false; message = ''; diagnostic = ''; resourceCatalog = null; resourceState = 'idle'; resourceIdentities.clear();
    if (dialog.open) dialog.close(); refresh();
    Promise.resolve().then(() => { if (!disposed && request === epoch && !dialog.open && target?.isConnected !== false) target?.focus?.(); }); return true;
  }
  function allocateIdentity() {
    const used = new Set([session.model.sceneObjectId, ...session.model.tracks.flatMap(row => [row.id, row.resourceId]),
      ...session.model.cues.map(row => row.id), ...draft.tracks.flatMap(row => [row.id, row.resourceId]), ...draft.cues.map(row => row.id),
      ...resourceIdentities]);
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = globalThis.crypto?.randomUUID?.();
        if (typeof candidate !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(candidate)) break;
        if (!used.has(candidate)) return candidate;
      }
    } catch { /* Failed allocation leaves the form and source intact. */ }
    return null;
  }
  function cloneTrack(id) {
    if (pending || !current() || tracks.length >= 16) { refresh(); return; }
    stopPreview();
    capture(); const original = draft.tracks.find(row => row.id === id); if (!original) return;
    const identity = allocateIdentity();
    if (!identity) { message = '无法生成新的音轨身份，请稍后重试。'; diagnostic = ''; refresh(); return; }
    draft.tracks.push({ ...original, id: identity }); invalidate(); render(); refresh(); tracks.at(-1)?.volume.focus();
  }
  function removeTrack(id) {
    if (pending || !current()) { refresh(); return; }
    stopPreview();
    capture(); const index = draft.tracks.findIndex(row => row.id === id); if (index < 0) return;
    const reason = draft.tracks.length <= 1 ? '至少保留一条音轨。' : draft.cues.some(row => row.trackId === id) ? '先移除引用此音轨的时间提示，或将提示换到其他音轨。' : '';
    if (reason) { message = reason; diagnostic = ''; refresh(); return; }
    draft.tracks.splice(index, 1); invalidate(); render(); refresh(); tracks[Math.min(index, tracks.length - 1)]?.volume.focus();
  }
  function addCue() {
    if (pending || !current() || cues.length >= 64) { refresh(); return; }
    stopPreview();
    capture(); const id = allocateIdentity();
    if (!id) { message = '无法生成新的提示身份，请稍后重试。'; diagnostic = ''; refresh(); return; }
    draft.cues.push({ id, trackId: draft.tracks[0].id, atSeconds: '0', action: 'play' });
    invalidate(); render(); refresh(); cues.at(-1)?.track.focus();
  }
  function removeCue(id) {
    if (pending || !current()) { refresh(); return; }
    stopPreview();
    capture(); const index = draft.cues.findIndex(row => row.id === id); if (index < 0) return;
    draft.cues.splice(index, 1); invalidate(); render(); refresh();
    (cues[Math.min(index, cues.length - 1)]?.atSeconds || el('AddCue')).focus();
  }
  function moveCue(id, direction) {
    if (pending || !current()) { refresh(); return; }
    stopPreview();
    capture(); const index = draft.cues.findIndex(row => row.id === id), destination = index + direction;
    if (index < 0 || destination < 0 || destination >= draft.cues.length) { refresh(); return; }
    [draft.cues[index], draft.cues[destination]] = [draft.cues[destination], draft.cues[index]];
    invalidate(); render(); refresh();
    const moved = cues[destination], control = direction < 0 ? moved.up : moved.down;
    (control.disabled ? moved.track : control).focus();
  }
  function fail(error, fallback) {
    const code = error?.errorCode;
    message = code === 'scene_audio_authoring_conflict' ? '原文已变化，请返回后重新打开声音编辑。'
      : code === 'scene_audio_authoring_unchanged' ? '声音内容没有变化，原文草稿保持不变。' : fallback;
    diagnostic = error?.uiKey || (typeof error?.message === 'string' ? error.message : '');
  }
  async function loadResources() {
    stopPreview();
    if (pending || !current() || !canReadResources()) { refresh(); return false; }
    capture(); invalidate(); const owner = session, request = epoch, form = signature();
    resourceCatalog = null; resourceState = 'loading'; pending = true; refresh();
    const owns = () => request === epoch && session === owner && current() && canReadResources() && signature() === form;
    try {
      const catalog = await getResources(owner.source); if (!owns()) return false;
      if (!isSceneAudioResources(catalog) || !sceneAudioResourcesMatchSource(catalog, owner.source)) throw Object.assign(Error(t('素材目录与当前声音原文不一致。')), { uiKey: '素材目录与当前声音原文不一致。' });
      resourceCatalog = catalog; for (const id of sceneAudioResourceIdentityIds(catalog)) resourceIdentities.add(id); resourceState = 'ready'; return true;
    } catch (error) {
      if (owns()) { resourceState = 'failed'; fail(error, '无法读取已绑定素材；表单和选择已保留，可重试。'); }
      return false;
    } finally {
      if (!disposed && request === epoch && session === owner && dialog.open) {
        if (resourceState === 'loading') resourceState = 'failed';
        capture(); render(); pending = false; refresh();
      }
    }
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || context.available !== true) return false;
    const request = ++epoch; opener = document.activeElement; pending = true; message = '正在读取声音文档…'; diagnostic = ''; dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next) && !next.busy && next.available === true
      && context.sourcePath === next.sourcePath && context.sourceToken === next.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!source || Object.keys(source).length !== 5 || source.sourcePath !== context.sourcePath || source.token !== context.sourceToken
        || !revision(source.baseSourceRevision) || !revision(source.sourceRevision) || typeof source.content !== 'string') throw Error(t('声音文档来源无效。'));
      const captured = Object.freeze({ ...source }), model = await readSceneAudioDocument(captured.content); if (!owns()) return false;
      session = { source: captured, model };
      draft = { tracks: model.tracks.map(row => ({ id: row.id, resourceId: row.resourceId, role: row.role, volume: String(row.volume), loop: String(row.loop) })),
        cues: model.cues.map(row => ({ id: row.id, trackId: row.trackId, atSeconds: String(row.atSeconds), action: row.action })) };
      render(); initial = signature(); invalidate(); message = '编辑音量、循环与时间提示；检查后应用到草稿。'; return true;
    } catch (error) { if (owns()) fail(error, '无法读取有效声音文档，请检查原文。'); return false; }
    finally { if (!disposed && request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function numeric(value) {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw Object.assign(Error(t('请输入完整的数字。')), { uiKey: '请输入完整的数字。' });
    return Number(value);
  }
  function edit() {
    const value = raw(); return { tracks: value.tracks.map(row => {
      if (!['true', 'false'].includes(row.loop)) throw Error(t('请选择有效的循环设置。'));
      return { ...row, volume: numeric(row.volume), loop: row.loop === 'true' };
    }), cues: value.cues.map(row => ({ ...row, atSeconds: numeric(row.atSeconds) })) };
  }
  async function check() {
    stopPreview();
    if (pending || !current() || !dirty()) { refresh(); return false; }
    capture(); invalidate(); const owner = session, request = epoch, form = signature(); pending = true; message = '正在检查声音修改…'; refresh();
    const owns = () => request === epoch && session === owner && current() && signature() === form;
    try {
      const value = edit(), replaceResources = needsResources(value);
      if (replaceResources && !hasResources()) throw Object.assign(Error(t('替换素材前请先读取当前已绑定的 WAV 素材。')), { uiKey: '替换素材前请先读取当前已绑定的 WAV 素材。' });
      const candidate = replaceResources ? await createSceneAudioResourceProposal(owner.source, value, resourceCatalog) : await createSceneAudioTrackProposal(owner.source, value); if (!owns()) return false;
      if (!isSceneAudioProposal(candidate) || candidate.sourceToken !== owner.source.token || candidate.beforeContent !== owner.source.content) throw Error(t('声音文档来源无效。'));
      proposal = candidate; approval = form; message = '声音修改已检查，请审阅完整原文后应用。'; return true;
    } catch (error) { if (owns()) fail(error, '声音修改未通过检查，输入已保留。'); return false; }
    finally { if (!disposed && request === epoch && session === owner && dialog.open) { pending = false; refresh(); } }
  }
  async function apply() {
    stopPreview();
    if (pending || !current() || !approved()) { refresh(); return false; }
    const owner = session, request = epoch, candidate = proposal, form = approval;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && proposal === candidate && signature() === form && (!needsResources(raw()) || hasResources());
    pending = true; message = '正在应用声音修改到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false;
      const context = getContext();
      if (proposal !== candidate || signature() !== form || result?.applied !== true || result.sourcePath !== owner.source.sourcePath
        || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || result.sourceToken === owner.source.token
        || !eligible(context) || context.available !== true || context.busy || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error(t('声音文档来源无效。'));
      opener = null; close(true); result.focus?.(); return true;
    } catch (error) { if (owns()) fail(error, '声音修改未确认应用，输入已保留。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('AddCue').addEventListener('click', addCue);
  el('UsageRefresh').addEventListener('click', () => void loadUsage());
  el('UsageDismiss').addEventListener('click', () => { const selected = usageTrackId; clearUsageSource(); usageTrackId = ''; refreshUsage(); tracks.find(row => row.id === selected)?.usage.focus(); });
  el('UsageSourceLocate').addEventListener('click', locateUsageSource);
  el('UsageSourceDismiss').addEventListener('click', () => { if (!usageSourceCurrent()) return; clearUsageSource(); el('UsageRefresh').focus(); });
  el('LoadResources').addEventListener('click', () => void loadResources());
  el('StopPreview').addEventListener('click', () => { stopPreview(); refreshPreview(); });
  el('PausePreview').addEventListener('click', pausePreview); el('ResumePreview').addEventListener('click', resumePreview);
  const previewPosition = el('PreviewPosition'), seekKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  previewPosition.addEventListener('pointerdown', () => { if (!previewPosition.disabled) previewPointer = true; });
  previewPosition.addEventListener('pointerup', () => { previewPointer = false; if (!previewSeeking) paintPreviewPosition(audition.snapshot()); });
  previewPosition.addEventListener('keydown', event => { if (!previewPosition.disabled && seekKeys.has(event.key)) previewKey = true; });
  previewPosition.addEventListener('keyup', event => { if (seekKeys.has(event.key)) { previewKey = false; if (!previewSeeking) paintPreviewPosition(audition.snapshot()); } });
  previewPosition.addEventListener('input', () => { if (!previewPosition.disabled) { previewSeeking = true; paintPreviewPosition(audition.snapshot(), true); } });
  previewPosition.addEventListener('change', seekPreview);
  const cancelSeek = () => { previewSeeking = false; previewPointer = false; previewKey = false; paintPreviewPosition(audition.snapshot()); };
  previewPosition.addEventListener('pointercancel', cancelSeek); previewPosition.addEventListener('blur', cancelSeek);
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); } });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(() => { if (disposed) return; if (proposal && !approved()) invalidate(); for (const translate of formTranslations) translate(); refresh(); });
  function hidden() { if (document.hidden || document.visibilityState === 'hidden') { stopPreview(); refresh(); } }
  function pagehide() { stopPreview(); refresh(); }
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide);
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); audition?.dispose(); button.remove(); dialog.remove(); }
  audition = createSceneAudioAudition({ load: loadAudition, onChange: () => refreshPreview() });
  refresh(); return Object.freeze({ refresh, dispose, open });
}
