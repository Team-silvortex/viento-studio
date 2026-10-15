import { createSceneAudioCreationDraft } from '../../engine/scene-audio-create-plan.mjs';
import { captureSceneAudioCreationContext, createSceneAudioCreationRequest, validateSceneAudioCreationResult, confirmSceneAudioCreation } from '../../engine/scene-audio-creation-contract.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This controller owns a reviewed creation form. Resource verification, atomic
// writes, source navigation and later audio editing remain separate host ports.
export function setupSceneAudioCreate({ getContext = () => ({}), setBusy = () => {}, inspect = async () => null,
  command = async () => null, applied = async () => {}, openSource = async () => false } = {}) {
  if (!document.getElementById('sceneAudioCreateStyle')) {
    const style = document.createElement('link'); style.id = 'sceneAudioCreateStyle'; style.rel = 'stylesheet'; style.href = '/web/scene-audio-create.css';
    (document.head || document.body).append(style);
  }
  const dialog = document.createElement('dialog'); dialog.id = 'sceneAudioCreateDialog'; dialog.className = 'scene-audio-create-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneAudioCreateTitle'); dialog.setAttribute('data-viento-close-guard', 'true');
  dialog.innerHTML = `<header class="scene-audio-create-header"><h2 id="sceneAudioCreateTitle" data-i18n="场景声音设置"></h2><button id="sceneAudioCreateClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回构建"></button></header>
    <div class="scene-audio-create-body"><p data-i18n="为已保存场景创建声音轨道，选择定时播放或由行为触发；保存后可打开原文继续编辑。此操作不播放声音。"></p>
    <p id="sceneAudioCreateScene" class="scene-audio-create-note"></p><button id="sceneAudioCreateRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="重新读取工程"></button>
    <section id="sceneAudioCreateExisting" hidden><h3 data-i18n="场景已有关联声音"></h3><p id="sceneAudioCreateManifest"></p><p data-i18n="已有声音文档不会重复创建。打开原文后，可使用独立声音字段编辑器。"></p></section>
    <p id="sceneAudioCreateEmpty" data-i18n="没有可选的已登记 WAV。请先通过素材库导入 WAV，再重新读取工程。" hidden></p>
    <fieldset id="sceneAudioCreateFields" hidden><legend data-i18n="新声音文档"></legend><div class="scene-audio-create-grid">
      <label><span data-i18n="文档类型"></span><select id="sceneAudioCreateType"></select></label>
      <label><span data-i18n="原文路径"></span><input id="sceneAudioCreatePath" type="text" maxlength="1024" spellcheck="false" /></label></div>
      <h3 data-i18n="声音轨道"></h3><p id="sceneAudioCreateCount" class="scene-audio-create-note"></p>
      <div class="scene-audio-create-tracks"><div class="scene-audio-create-list"><label><span data-i18n="选择要编辑的音轨"></span><select id="sceneAudioCreateTrackList" size="5"></select></label>
      <div class="scene-audio-create-list-actions"><button id="sceneAudioCreateAddTrack" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加音轨"></button><button id="sceneAudioCreateRemoveTrack" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除选中音轨"></button></div></div>
      <div class="scene-audio-create-grid"><label class="scene-audio-create-wide"><span data-i18n="已登记 WAV 素材"></span><select id="sceneAudioCreateResource"></select></label>
      <label><span data-i18n="声音用途"></span><select id="sceneAudioCreateRole"></select></label>
      <label><span data-i18n="音量（0–1）"></span><input id="sceneAudioCreateVolume" type="text" inputmode="decimal" maxlength="32" /></label>
      <label><span data-i18n="循环播放"></span><select id="sceneAudioCreateLoop"></select></label>
      <label><span data-i18n="播放方式"></span><select id="sceneAudioCreateStartMode" aria-describedby="sceneAudioCreateStartHint"></select></label>
      <label><span data-i18n="开始时间（秒，0–60）"></span><input id="sceneAudioCreateStart" type="text" inputmode="decimal" maxlength="32" aria-describedby="sceneAudioCreateStartHint" /></label>
      <p id="sceneAudioCreateStartHint" class="scene-audio-create-wide scene-audio-create-note" role="status"></p></div></div>
      <p class="scene-audio-create-note" data-i18n="定时音轨创建一条播放提示；行为音轨不创建定时提示。候选素材尚未验证；审阅和保存时会核对真实 PCM16 WAV 与资源摘要。"></p><p id="sceneAudioCreateIdentity" class="scene-audio-create-note"></p></fieldset>
    <section id="sceneAudioCreateReview" hidden><h3 data-i18n="新声音文档审阅"></h3><p data-i18n="保存会新建声音正文和登记，并更新场景的声音关系；原场景和素材字节保持。"></p>
      <p id="sceneAudioCreatePlaybackSummary" class="scene-audio-create-note"></p><h4 data-i18n="将登记的关系和素材绑定"></h4><ul id="sceneAudioCreateRelations"></ul><h4 data-i18n="将创建的完整原文"></h4><pre id="sceneAudioCreateSourceText" tabindex="0"></pre></section></div>
    <div class="scene-audio-create-feedback"><p id="sceneAudioCreateStatus" role="status" aria-live="polite"></p><p id="sceneAudioCreateDetails" class="scene-audio-create-note"></p></div>
    <footer class="scene-audio-create-footer"><button id="sceneAudioCreateCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="审阅新声音"></button><button id="sceneAudioCreateSave" type="button" class="doc-btn" data-i18n="保存声音与关系"></button><button id="sceneAudioCreateOpen" type="button" class="doc-btn" data-i18n="打开声音原文" hidden></button><button id="sceneAudioCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneAudioCreate' + suffix), copy = value => JSON.parse(JSON.stringify(value));
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const digest = async value => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
  const fail = key => { throw Object.assign(new Error(t(key)), { uiKey: key }); };
  let enabled = false, disposed = false, epoch = 0, owner = null, catalog = null, draft = null, selectedTrackId = '', baseline = '', preview = null;
  let phase = '', pendingWrite = null, needsRefresh = false, busyOwned = false, message = '', details = '', opener = null;
  const fields = ['Type', 'Path', 'Resource', 'Role', 'Volume', 'Loop', 'StartMode', 'Start'];
  const selectedTrack = () => draft?.tracks.find(track => track.trackId === selectedTrackId);
  const trackInput = () => ({ resourceId: el('Resource').value, role: el('Role').value, volume: el('Volume').value, loop: el('Loop').value, startMode: el('StartMode').value, atSeconds: el('Start').value });
  const raw = () => ({ Type: el('Type').value, Path: el('Path').value,
    tracks: (draft?.tracks || []).map(track => ({ ...track, ...(track.trackId === selectedTrackId ? trackInput() : {}) })) });
  const signature = () => JSON.stringify(raw());
  const eligible = () => { const c = getContext(); return Boolean(!disposed && enabled && c.editable && !c.dirty && !c.creating && !c.busy && c.visible === true && uuid(c.sceneId) && typeof c.session === 'string'); };
  const owns = (generation = epoch, acceptToken = false) => { const c = getContext(); return Boolean(generation === epoch && dialog.open && owner && !owner.invalidated && eligible()
    && c.sceneId === owner.sceneId && c.session === owner.session && (acceptToken || c.sourceToken === owner.sourceToken)); };
  const canEdit = () => Boolean(!phase && !pendingWrite && !needsRefresh && catalog?.status === 'empty' && draft && owns());
  const approval = () => preview && preview.catalog === catalog && preview.signature === signature();
  const dirty = () => Boolean(pendingWrite || preview || draft && catalog?.status !== 'ready' && signature() !== baseline);
  const hostBusy = value => { if (busyOwned !== value) { busyOwned = value; setBusy(value); } };
  function capture() { if (draft) Object.assign(draft, raw()); }
  function invalidate() { preview = null; message = '声音尚未保存，请先审阅原文、关系和素材绑定。'; details = ''; }
  function options(select, values, value) {
    select.replaceChildren();
    if (!values.some(([id]) => id === value)) { const placeholder = document.createElement('option'); placeholder.value = value || ''; placeholder.textContent = value ? t('已不可用：{0}', value) : t('请选择'); select.append(placeholder); }
    for (const [id, label] of values) { const option = document.createElement('option'); option.value = id; option.textContent = label; select.append(option); }
    select.value = value;
  }
  function renderList() {
    if (!draft || !catalog) return;
    options(el('TrackList'), draft.tracks.map((track, index) => [track.trackId, `${index + 1}. ${catalog.resources.find(resource => resource.resourceId === track.resourceId)?.name || t('请选择')} · ${t(track.startMode === 'behavior' ? '由行为触发' : '定时播放')}`]), selectedTrackId);
  }
  function renderFields() {
    if (!draft || catalog?.status !== 'empty') return;
    options(el('Type'), catalog.documentTypes.map(item => [item.id, item.label]), draft.Type); el('Path').value = draft.Path;
    const track = selectedTrack();
    options(el('Resource'), catalog.resources.map(resource => [resource.resourceId, `${resource.name} · ${resource.sourcePath}`]), track?.resourceId || '');
    options(el('Role'), [['music', t('音乐')], ['effect', t('音效')]], track?.role || 'effect');
    options(el('Loop'), [['false', t('否')], ['true', t('是')]], track?.loop || 'false');
    options(el('StartMode'), [['timeline', t('定时播放')], ['behavior', t('由行为触发')]], track?.startMode ?? 'timeline');
    el('Volume').value = track?.volume ?? ''; el('Start').value = track?.atSeconds ?? ''; renderList();
  }
  function newTrack(resourceId) {
    const trackId = crypto.randomUUID(), cueId = crypto.randomUUID(), used = new Set([draft?.objectId, ...(draft?.tracks || []).flatMap(track => [track.trackId, track.cueId])]);
    if (!uuid(trackId) || !uuid(cueId) || trackId === cueId || used.has(trackId) || used.has(cueId)) throw Error('Invalid stable audio identity.');
    return { trackId, cueId, resourceId, role: 'effect', volume: '1', loop: 'false', startMode: 'timeline', atSeconds: '0' };
  }
  function addTrack() {
    if (!canEdit() || !catalog.resources.length || draft.tracks.length >= 16) return;
    capture(); try { const track = newTrack(selectedTrack()?.resourceId || catalog.resources[0].resourceId); draft.tracks.push(track); selectedTrackId = track.trackId; }
    catch { return; }
    renderFields(); invalidate(); update(); el('Resource').focus();
  }
  function removeTrack() {
    if (!canEdit() || draft.tracks.length <= 1) return;
    capture(); const index = draft.tracks.findIndex(track => track.trackId === selectedTrackId); if (index < 0) return;
    draft.tracks.splice(index, 1); selectedTrackId = draft.tracks[Math.min(index, draft.tracks.length - 1)].trackId; renderFields(); invalidate(); update();
  }
  function update() {
    if (disposed) return;
    translatePage(dialog); dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(Boolean(phase)));
    const existing = catalog?.status === 'ready';
    el('Fields').hidden = catalog?.status !== 'empty' || !draft; el('Fields').disabled = !canEdit();
    fields.forEach(name => { el(name).disabled = !canEdit(); }); el('TrackList').disabled = !canEdit();
    el('Start').disabled = !canEdit() || el('StartMode').value !== 'timeline';
    el('StartHint').textContent = t(el('StartMode').value === 'behavior' ? '不创建定时播放提示；需在项目行为中引用音轨身份并发起播放。' : '按开始时间创建一条播放提示。');
    el('AddTrack').disabled = !canEdit() || !catalog.resources.length || draft.tracks.length >= 16;
    el('RemoveTrack').disabled = !canEdit() || draft.tracks.length <= 1;
    el('Existing').hidden = !existing; el('Manifest').textContent = existing ? `${catalog.manifest.sourcePath} · ${catalog.manifest.objectId}` : '';
    el('Empty').hidden = catalog?.status !== 'empty' || catalog.resources.length > 0;
    el('Scene').textContent = catalog ? t('场景：{0} · {1}', catalog.scene.sourcePath, catalog.scene.objectId) : '';
    el('Count').textContent = draft ? t('音轨 {0}/16；至少保留一条。', draft.tracks.length) : '';
    el('Identity').textContent = draft ? t('新文档身份：{0} · 音轨身份：{1}', draft.objectId, selectedTrackId) : '';
    el('Check').hidden = existing; el('Save').hidden = existing; el('Check').disabled = !canEdit() || !catalog.resources.length; el('Save').disabled = !canEdit() || !approval();
    el('Open').hidden = !existing; el('Open').disabled = Boolean(phase || pendingWrite || needsRefresh) || !existing || !owns();
    el('Refresh').disabled = Boolean(phase) || !owns(); el('Close').disabled = Boolean(phase); el('Cancel').disabled = Boolean(phase);
    el('Review').hidden = !approval(); el('SourceText').textContent = approval() ? preview.request.content : ''; el('PlaybackSummary').textContent = ''; el('Relations').replaceChildren();
    if (approval()) {
      const request = preview.request, audioDocument = JSON.parse(request.content), resources = [...new Set(audioDocument.tracks.map(track => track.resourceId))].sort();
      const timed = audioDocument.cues.length, behavior = audioDocument.tracks.length - timed;
      el('PlaybackSummary').textContent = timed === 0 ? t('全部 {0} 条音轨由行为触发；未创建定时播放提示。', behavior)
        : behavior === 0 ? t('全部 {0} 条音轨定时播放；创建 {1} 条播放提示。', timed, timed)
        : t('{0} 条音轨定时播放，{1} 条由行为触发；创建 {2} 条定时播放提示。', timed, behavior, timed);
      const values = [`${catalog.scene.objectId} → audio → ${request.objectId}`, `${request.objectId} → references → ${catalog.scene.objectId}`,
        ...resources.map(id => t('素材绑定：{0} → {1}', request.objectId, id))];
      for (const value of values) { const item = document.createElement('li'); item.textContent = value; el('Relations').append(item); }
    }
    el('Status').textContent = t(message); el('Details').textContent = details;
  }
  function stale() { preview = null; needsRefresh = true; message = '来源或会话已变化，请返回构建后重新打开声音设置。'; }
  async function readContext(generation) {
    const value = await inspect({ sceneObjectId: owner.sceneId });
    return owns(generation) ? captureSceneAudioCreationContext(value, owner.sceneId) : null;
  }
  async function notifySaved(generation, next) {
    try { await applied(pendingWrite.result, pendingWrite.result ? undefined : { reconciled: true, catalog: next }); }
    finally { if (owns(generation, true)) owner.sourceToken = getContext().sourceToken; }
    if (!owns(generation)) return false;
    pendingWrite.notified = true; return true;
  }
  async function reload(generation) {
    if (pendingWrite?.result && !pendingWrite.notified && !await notifySaved(generation)) return;
    let next = await readContext(generation); if (!next) return;
    const observed = value => pendingWrite && confirmSceneAudioCreation(value, pendingWrite.request, pendingWrite.sourceRevision);
    if (pendingWrite && observed(next) && !pendingWrite.notified) {
      if (!await notifySaved(generation, next)) return;
      next = await readContext(generation); if (!next) return;
    }
    catalog = next; preview = null; needsRefresh = false;
    if (pendingWrite && observed(next) && pendingWrite.notified) { pendingWrite = null; draft = null; selectedTrackId = ''; message = '声音与关系已确认保存。可打开原文继续编辑。'; }
    else if (pendingWrite) message = '声音保存结果尚未确认，请重新读取工程核对，勿重复创建。';
    else if (next.status === 'ready') { draft = null; selectedTrackId = ''; message = '此场景已有声音文档，可打开原文继续编辑。'; }
    else {
      if (!draft) {
        const objectId = crypto.randomUUID(); if (!uuid(objectId)) throw Error('Invalid stable audio identity.');
        draft = { objectId, Type: next.documentTypes[0].id, Path: `${next.documentRoot}/audio/new-audio.json`, tracks: [] };
        draft.tracks.push(newTrack(next.resources[0]?.resourceId || '')); selectedTrackId = draft.tracks[0].trackId; renderFields(); baseline = signature();
      } else renderFields();
      message = '选择已登记 WAV 和播放设置，审阅后保存声音文档。';
    }
  }
  async function read() {
    if (phase || !owns()) return; capture(); const generation = epoch; preview = null; phase = 'read'; hostBusy(true); message = '正在读取场景声音目录…'; details = ''; update();
    try { await reload(generation); }
    catch (error) { if (owns(generation)) { preview = null; needsRefresh = true; message = '无法读取声音目录。设置已保留，请检查关系并重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  function number(value) {
    if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) fail('请输入完整的数字。');
    return Number(value);
  }
  function request() {
    capture();
    if (!catalog.documentTypes.some(type => type.id === draft.Type) || draft.tracks.some(track => !catalog.resources.some(resource => resource.resourceId === track.resourceId))) fail('请选择当前工程中的文档类型和已登记 WAV。');
    if (!draft.Path.startsWith(catalog.documentRoot + '/') || !/\.json$/i.test(draft.Path) || getCreatePathError(draft.Path)) fail('请使用正文目录内可迁移的 JSON 文件路径。');
    const tracks = draft.tracks.map(track => {
      if (!['true', 'false'].includes(track.loop)) fail('请选择有效的循环设置。');
      if (!['timeline', 'behavior'].includes(track.startMode)) fail('请选择有效的播放方式。');
      const { atSeconds, ...settings } = track;
      return { ...settings, volume: number(track.volume), loop: track.loop === 'true', ...(track.startMode === 'timeline' ? { atSeconds: number(atSeconds) } : {}) };
    });
    const planned = createSceneAudioCreationDraft({ sceneObjectId: catalog.scene.objectId, tracks });
    if (!planned.ok) fail('声音设置无效，请检查音量、开始时间和独立轨道身份。');
    return createSceneAudioCreationRequest(catalog, { objectId: draft.objectId, documentType: draft.Type, sourcePath: draft.Path, content: planned.content });
  }
  async function run(mode) {
    if (!canEdit() || mode === 'apply' && !approval()) { if (!phase && preview && !approval()) { invalidate(); update(); } return; }
    let requested; try { requested = mode === 'apply' ? { ...copy(preview.request), mode } : request(); }
    catch (error) { preview = null; message = error.uiKey || '声音设置无效，请检查音量、开始时间和独立轨道身份。'; details = error.message || ''; update(); return; }
    const generation = epoch, inputSignature = signature(), snapshot = catalog; phase = mode; hostBusy(true); details = ''; message = mode === 'apply' ? '正在保存声音文档与关系…' : '正在审阅声音文档与资源…'; update();
    try {
      const sourceRevision = await digest(requested.content); if (!owns(generation) || signature() !== inputSignature || catalog !== snapshot) return;
      if (mode === 'apply') pendingWrite = { request: copy(requested), sourceRevision, result: null, notified: false };
      const result = await command(requested); if (!owns(generation) || signature() !== inputSignature || catalog !== snapshot) return;
      const valid = validateSceneAudioCreationResult(result, requested, snapshot, sourceRevision);
      if (mode === 'preview') { preview = { request: copy(requested), signature: inputSignature, catalog: snapshot }; message = '声音创建已审阅，请确认完整原文、关系和素材绑定后保存。'; }
      else { pendingWrite.result = valid; preview = null; await reload(generation); }
    } catch (error) {
      if (generation !== epoch || disposed) return;
      preview = null; const code = error.errorCode || error.payload?.errorCode || error.payload?.data?.errorCode;
      const rejected = ['world_write_busy', 'world_revision_conflict', 'world_read_conflict', 'world_type_unknown', 'world_audio_invalid', 'world_audio_resource_changed', 'world_audio_resource_format', 'world_audio_resource_unavailable', 'world_audio_resource_limit', 'world_create_path_invalid', 'world_create_path_conflict'];
      if (pendingWrite && !pendingWrite.result && rejected.includes(code)) pendingWrite = null;
      needsRefresh = !pendingWrite;
      message = pendingWrite ? '声音保存结果尚未确认，请重新读取工程核对，勿重复创建。' : error.uiKey || '声音请求未完成。设置已保留，请重新读取并审阅。'; details = error.message || '';
    } finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (!owns()) stale(); update(); } }
  }
  function close(restoreFocus = true) {
    if (phase) return false;
    if (dirty() && !window.confirm(t('丢弃本次声音创建设置？已保存的声音与关系会保留。'))) return false;
    epoch++; owner = null; catalog = null; draft = null; pendingWrite = null; preview = null; selectedTrackId = ''; dialog.dataset.dirty = 'false'; dialog.close(); if (restoreFocus) opener?.focus(); return true;
  }
  async function navigate() {
    if (phase || pendingWrite || needsRefresh || catalog?.status !== 'ready' || !owns()) return;
    const generation = epoch, previous = catalog; phase = 'open'; hostBusy(true); message = '正在核对声音原文…'; details = ''; update();
    try {
      const next = await readContext(generation); if (!next) return; catalog = next;
      if (next.status !== 'ready' || next.worldId !== previous.worldId || next.manifest.objectId !== previous.manifest.objectId || next.manifest.sourceRevision !== previous.manifest.sourceRevision) {
        message = '声音文档或关系已变化，请确认目录后重新打开原文。'; return;
      }
      hostBusy(false);
      const isCurrent = () => { const c = getContext(); return Boolean(generation === epoch && dialog.open && !disposed && enabled && owner && !owner.invalidated
        && c.sceneId === owner.sceneId && c.session === owner.session && c.editable && !c.dirty && !c.creating); };
      if (!owns(generation)) return;
      const result = await openSource(next.manifest.sourcePath, { sourceRevision: next.manifest.sourceRevision, isCurrent });
      if (generation !== epoch || disposed) return;
      if (result !== false && isCurrent()) { phase = ''; close(false); result?.focus?.(); }
      else message = '声音原文未打开，请重新读取工程后重试。';
    } catch (error) { if (generation === epoch && !disposed) { message = '声音原文未打开，请重新读取工程后重试。'; details = error.message || ''; } }
    finally { if (generation === epoch && !disposed) { phase = ''; hostBusy(false); if (dialog.open && !owns()) stale(); update(); } }
  }
  fields.forEach(name => { for (const event of ['input', 'change']) el(name).addEventListener(event, () => { if (canEdit()) { capture(); renderList(); invalidate(); update(); } }); });
  el('TrackList').addEventListener('change', () => { if (!canEdit()) return; const id = el('TrackList').value; if (!draft.tracks.some(track => track.trackId === id)) return; capture(); selectedTrackId = id; renderFields(); update(); });
  el('AddTrack').addEventListener('click', addTrack); el('RemoveTrack').addEventListener('click', removeTrack);
  el('Check').addEventListener('click', () => void run('preview')); el('Save').addEventListener('click', () => void run('apply')); el('Refresh').addEventListener('click', () => void read()); el('Open').addEventListener('click', () => void navigate());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); });
  const unsubscribe = onLanguageChange(() => { if (dialog.open && !disposed) { capture(); renderFields(); update(); } });
  return Object.freeze({
    open(sceneId) {
      if (dialog.open || !eligible() || getContext().sceneId !== sceneId) return false;
      epoch++; const context = getContext(); owner = { session: context.session, sceneId, sourceToken: context.sourceToken }; opener = document.activeElement;
      catalog = null; draft = null; selectedTrackId = ''; baseline = ''; preview = null; pendingWrite = null; needsRefresh = false; message = ''; details = ''; phase = '';
      dialog.showModal(); update(); void read(); return true;
    },
    setAvailable(value, commands = []) { enabled = value === true && Array.isArray(commands) && commands.includes('audio.create'); if (dialog.open) { if (!enabled && owner) owner.invalidated = true; update(); } },
    dispose() { if (disposed) return; disposed = true; epoch++; hostBusy(false); phase = ''; owner = null; if (typeof unsubscribe === 'function') unsubscribe(); dialog.close(); dialog.remove(); },
  });
}
