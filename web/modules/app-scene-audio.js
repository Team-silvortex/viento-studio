import { readSceneAudioDocument, createSceneAudioProposal, isSceneAudioProposal } from '../../engine/scene-audio-edit.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This panel owns a form only. Its isolated source port applies ordinary drafts;
// it cannot save documents, resolve assets, start playback or control a backend.
export function setupSceneAudio({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  if (!document.getElementById('sceneAudioStyle')) {
    const style = document.createElement('link'); style.id = 'sceneAudioStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene-audio.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'sceneAudioBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'sceneAudioDialog'; dialog.className = 'scene-audio-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneAudioTitle');
  dialog.innerHTML = `<header class="scene-audio-header"><h2 id="sceneAudioTitle" data-i18n="编辑场景声音"></h2><button id="sceneAudioClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="scene-audio-body"><p class="scene-audio-note" data-i18n="调整已有声音轨道和时间提示。场景、资源与身份保持固定；编辑不会自动播放声音。"></p>
      <p id="sceneAudioPath" class="scene-audio-note"></p><p id="sceneAudioScene" class="scene-audio-note"></p>
      <section id="sceneAudioFields" hidden><h3 data-i18n="声音轨道"></h3><div id="sceneAudioTracks"></div><h3 data-i18n="声音时间提示"></h3><div id="sceneAudioCues"></div></section>
      <section id="sceneAudioReview" hidden><h3 data-i18n="声音修改审阅"></h3><ul id="sceneAudioChangedPaths"></ul><div class="scene-audio-comparison">
        <section><h4 data-i18n="修改前的完整原文"></h4><pre id="sceneAudioBefore" tabindex="0"></pre></section><section><h4 data-i18n="应用后的完整原文"></h4><pre id="sceneAudioAfter" tabindex="0"></pre></section></div></section></div>
    <div class="scene-audio-feedback"><p id="sceneAudioStatus" role="status" aria-live="polite"></p><p id="sceneAudioDiagnostic" class="scene-audio-diagnostic"></p></div>
    <footer class="scene-audio-footer"><span class="scene-audio-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></span><div>
      <button id="sceneAudioCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查声音修改"></button><button id="sceneAudioApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneAudioCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></div></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneAudio' + suffix);
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  let epoch = 0, disposed = false, pending = false, session = null, draft = null, initial = '', proposal = null, approval = '', opener = null;
  let tracks = [], cues = [], message = '', diagnostic = '';
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && context.audioSource === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(!disposed && dialog.open && session && eligible(context)
    && context.available === true && !context.busy && context.sourcePath === session.source.sourcePath && context.sourceToken === session.source.token); };
  const raw = () => session ? {
    tracks: tracks.map(row => ({ id: row.id, role: row.role.value, volume: row.volume.value, loop: row.loop.value })),
    cues: cues.map(row => ({ id: row.id, atSeconds: row.atSeconds.value, action: row.action.value })),
  } : null;
  const signature = () => JSON.stringify(raw());
  const dirty = () => Boolean(session && signature() !== initial);
  const approved = () => Boolean(isSceneAudioProposal(proposal) && signature() === approval);
  function invalidate() { proposal = null; approval = ''; message = '声音修改尚未应用；检查后再应用到草稿。'; diagnostic = ''; }
  function capture() { if (session) draft = raw(); }
  function changed() { if (!pending && current()) { capture(); invalidate(); refresh(); } }
  function field(key, value) { const label = node('label'); label.append(node('span', t(key)), value); return label; }
  function input(id, value) {
    const result = node('input'); result.type = 'text'; result.inputMode = 'decimal'; result.id = 'sceneAudio' + id;
    result.value = value; result.spellcheck = false; result.addEventListener('input', changed); return result;
  }
  function select(id, value, choices) {
    const result = node('select'); result.id = 'sceneAudio' + id;
    for (const [key, label] of choices) { const option = node('option', t(label)); option.value = key; result.append(option); }
    result.value = value; result.addEventListener('change', changed); return result;
  }
  function render() {
    tracks = []; cues = []; el('Tracks').replaceChildren(); el('Cues').replaceChildren();
    if (!session) return;
    for (const [index, row] of draft.tracks.entries()) {
      const wrapper = node('section'); wrapper.className = 'scene-audio-track';
      const identity = node('p', t('轨道 {0} · 资源 {1}', row.id, session.model.tracks[index].resourceId)); identity.className = 'scene-audio-note';
      const role = select(`Track${index}Role`, row.role, [['music', '音乐'], ['effect', '音效']]);
      const volume = input(`Track${index}Volume`, row.volume), loop = select(`Track${index}Loop`, row.loop, [['true', '是'], ['false', '否']]);
      wrapper.append(identity, field('声音用途', role), field('音量（0–1）', volume), field('循环播放', loop)); el('Tracks').append(wrapper);
      tracks.push({ id: row.id, role, volume, loop });
    }
    for (const [index, row] of draft.cues.entries()) {
      const wrapper = node('section'); wrapper.className = 'scene-audio-cue';
      const identity = node('p', t('提示 {0} · 轨道 {1}', row.id, session.model.cues[index].trackId)); identity.className = 'scene-audio-note';
      const atSeconds = input(`Cue${index}Time`, row.atSeconds), action = select(`Cue${index}Action`, row.action, [['play', '播放'], ['stop', '停止']]);
      wrapper.append(identity, field('触发时间（秒，0–60）', atSeconds), field('声音操作', action)); el('Cues').append(wrapper);
      cues.push({ id: row.id, atSeconds, action });
    }
  }
  function refresh() {
    if (disposed) return;
    const context = getContext(); button.hidden = !eligible(context); button.disabled = context.available !== true || Boolean(context.busy); button.textContent = t('编辑场景声音');
    if (proposal && !approved()) invalidate();
    if (session && !current()) { if (!pending) proposal = null; message = '原文已变化，请返回后重新打开声音编辑。'; }
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty());
    el('Fields').hidden = !session; const locked = pending || !current();
    for (const element of el('Fields').querySelectorAll('input,select,button')) element.disabled = locked;
    el('Check').disabled = locked || !dirty(); el('Apply').disabled = locked || !approved();
    el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic ? t(diagnostic) : '';
    el('Review').hidden = !proposal; el('Before').textContent = proposal?.beforeContent || ''; el('After').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    el('Path').textContent = session?.source.sourcePath || context.sourcePath || '';
    el('Scene').textContent = session ? t('声音所属场景：{0}', session.model.sceneObjectId) : '';
  }
  function close(force = false) {
    if (!force && dirty() && !window.confirm(t('丢弃本次声音表单修改？原文草稿不会改变。'))) return false;
    const target = opener, request = ++epoch; opener = null; session = null; draft = null; tracks = []; cues = []; proposal = null; pending = false; message = ''; diagnostic = '';
    if (dialog.open) dialog.close(); refresh();
    Promise.resolve().then(() => { if (!disposed && request === epoch && !dialog.open && target?.isConnected !== false) target?.focus?.(); }); return true;
  }
  function fail(error, fallback) {
    const code = error?.errorCode;
    message = code === 'scene_audio_authoring_conflict' ? '原文已变化，请返回后重新打开声音编辑。'
      : code === 'scene_audio_authoring_unchanged' ? '声音内容没有变化，原文草稿保持不变。' : fallback;
    diagnostic = error?.uiKey || (typeof error?.message === 'string' ? error.message : '');
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
      draft = { tracks: model.tracks.map(row => ({ id: row.id, role: row.role, volume: String(row.volume), loop: String(row.loop) })),
        cues: model.cues.map(row => ({ id: row.id, atSeconds: String(row.atSeconds), action: row.action })) };
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
    if (pending || !current() || !dirty()) { refresh(); return false; }
    capture(); invalidate(); const owner = session, request = epoch, form = signature(); pending = true; message = '正在检查声音修改…'; refresh();
    const owns = () => request === epoch && session === owner && current() && signature() === form;
    try {
      const candidate = await createSceneAudioProposal(owner.source, edit()); if (!owns()) return false;
      if (!isSceneAudioProposal(candidate) || candidate.sourceToken !== owner.source.token || candidate.beforeContent !== owner.source.content) throw Error(t('声音文档来源无效。'));
      proposal = candidate; approval = form; message = '声音修改已检查，请审阅完整原文后应用。'; return true;
    } catch (error) { if (owns()) fail(error, '声音修改未通过检查，输入已保留。'); return false; }
    finally { if (!disposed && request === epoch && session === owner && dialog.open) { pending = false; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approved()) { refresh(); return false; }
    const owner = session, request = epoch, candidate = proposal, form = approval;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && proposal === candidate && signature() === form;
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
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); } });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(() => { if (disposed) return; capture(); if (proposal && !approved()) invalidate(); render(); refresh(); });
  function dispose() { if (disposed) return; close(true); disposed = true; unsubscribe?.(); button.remove(); dialog.remove(); }
  refresh(); return Object.freeze({ refresh, dispose, open });
}
