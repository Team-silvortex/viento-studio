import { setupSceneBehaviorParameters } from './app-scene-behavior-parameters.js';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { setupSceneBehaviorAnimationClips } from './app-scene-behavior-animation-clips.js';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { createSceneBehaviorProposal, isSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { isSceneBehaviorAudioTracks, sceneBehaviorAudioTracksMatchSource, sceneBehaviorAudioTrackValue } from '../../engine/scene-audio-directory.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This editor owns only its local form and review. The document host owns source
// versions, dependency checks and applying the resulting unsaved draft.
export function setupSceneBehaviors({ getContext = () => ({}), getSource = async () => null,
  inspect = async () => null, applyDraft = async () => null, getAudioTracks, getAnimationClips } = {}) {
  if (!document.getElementById('sceneBehaviorsStyle')) {
    const style = document.createElement('link'); style.id = 'sceneBehaviorsStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene-behaviors.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'sceneBehaviorsBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'sceneBehaviorsDialog'; dialog.className = 'scene-behaviors-dialog';
  dialog.setAttribute('aria-labelledby', 'sceneBehaviorsTitle');
  dialog.innerHTML = `<header class="scene-behaviors-header"><h2 id="sceneBehaviorsTitle" data-i18n="编辑场景行为"></h2>
    <button id="sceneBehaviorsClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="scene-behaviors-body"><p class="scene-behaviors-note" data-i18n="编辑当前绑定文档；场景、后端和语言保持固定。脚本须已登记并由本文档引用，不会自动添加关系或执行脚本。"></p>
    <p id="sceneBehaviorsPath" class="scene-behaviors-note"></p><p id="sceneBehaviorsFixed" class="scene-behaviors-note"></p>
    <section id="sceneBehaviorsFields" hidden><div class="scene-behaviors-binding-bar"><label><span data-i18n="当前行为绑定"></span><select id="sceneBehaviorsBinding"></select></label>
      <button id="sceneBehaviorsAddBinding" type="button" class="doc-btn doc-btn-ghost" data-i18n="新增行为绑定"></button>
      <button id="sceneBehaviorsRemoveBinding" type="button" class="doc-btn doc-btn-ghost" data-i18n="移除此绑定"></button></div>
      <p id="sceneBehaviorsBindingId" class="scene-behaviors-note"></p><div class="scene-behaviors-targets">
      <label><span data-i18n="场景实例"></span><select id="sceneBehaviorsInstance"></select></label>
      <label><span data-i18n="已关联脚本"></span><select id="sceneBehaviorsSource"></select></label></div>
      <h3 data-i18n="行为参数"></h3><p class="scene-behaviors-note" data-i18n="参数使用文本、数字或布尔值；名称须为ASCII标识符，具体脚本类型在构建与运行时检查。"></p>
      <section id="sceneBehaviorsParameterInterface" hidden></section>
      <section id="sceneBehaviorsAudioTracksTools" class="scene-behaviors-audio-tools" hidden>
        <button id="sceneBehaviorsLoadAudioTracks" type="button" class="doc-btn doc-btn-ghost" data-i18n="读取场景音轨"></button>
        <p class="scene-behaviors-note" data-i18n="将已保存的音轨编号填入文本参数；不会识别参数用途、执行声音或保护后续引用。"></p>
        <p id="sceneBehaviorsAudioTracksStatus" class="scene-behaviors-note" role="status" aria-live="polite"></p>
        <p id="sceneBehaviorsAudioTracksPath" class="scene-behaviors-note"></p></section>
      <section id="sceneBehaviorsAnimationClipsTools" hidden></section>
      <div id="sceneBehaviorsParameters"></div><button id="sceneBehaviorsAddParameter" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加参数"></button>
      <h3 data-i18n="信号映射"></h3><div id="sceneBehaviorsEvents"></div><button id="sceneBehaviorsAddEvent" type="button" class="doc-btn doc-btn-ghost" data-i18n="添加信号映射"></button>
      <p class="scene-behaviors-note" data-i18n="最多32条绑定、8份脚本；每条最多32个参数和8个信号。至少保留一条绑定。"></p></section>
    <section id="sceneBehaviorsReview" hidden><h3 data-i18n="行为修改审阅"></h3><ul id="sceneBehaviorsChangedPaths"></ul>
      <div class="scene-behaviors-comparison"><section><h4 data-i18n="修改前的完整原文"></h4><pre id="sceneBehaviorsBefore" tabindex="0"></pre></section>
      <section><h4 data-i18n="应用后的完整原文"></h4><pre id="sceneBehaviorsAfter" tabindex="0"></pre></section></div></section></div>
    <div class="scene-behaviors-feedback"><p id="sceneBehaviorsStatus" role="status" aria-live="polite"></p><p id="sceneBehaviorsDiagnostic" class="scene-behaviors-diagnostic"></p></div>
    <footer class="scene-behaviors-footer"><span class="scene-behaviors-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></span><div>
      <button id="sceneBehaviorsCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查行为修改"></button>
      <button id="sceneBehaviorsApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="sceneBehaviorsCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></div></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#sceneBehaviors' + suffix);
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const name = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const invalid = key => { throw Object.assign(Error(t(key || '行为编辑数据无效，请返回原文检查。')), { uiKey: key || '行为编辑数据无效，请返回原文检查。' }); };
  const exact = (value, fields) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const props = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(props);
    return keys.length === fields.length && keys.every(key => fields.includes(key) && props[key].enumerable && Object.hasOwn(props[key], 'value'));
  };
  const text = value => typeof value === 'string' && value.length <= 4096;
  let epoch = 0, disposed = false, pending = false, session = null, selected = '', draft = [], initialSignature = '';
  let proposal = null, approvalSignature = '', parameterInputs = [], eventInputs = [], opener = null, message = '', diagnostic = '';
  const parameterIdentity = Symbol('parameterIdentity');
  let rowSequence = 0, audioRequest = 0, audioPending = false, audioCatalog = null, audioMessage = '';
  const audioChoices = new Map();
  const audioAvailable = () => getContext().audioTracksAvailable === true && typeof getAudioTracks === 'function';
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && context.behaviorSource === true
    && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const current = () => { const context = getContext(); return Boolean(!disposed && dialog.open && session && eligible(context)
    && context.available === true && !context.busy && context.sourcePath === session.source.sourcePath && context.sourceToken === session.source.token); };
  const active = () => draft.find(binding => binding.bindingId === selected);
  const readVisible = () => {
    const binding = active(); if (!binding) return null;
    return { bindingId: binding.bindingId, instanceId: el('Instance').value, sourceObjectId: el('Source').value,
      parameters: parameterInputs.map(row => ({ key: row.key.value, type: row.type.value, value: row.value.value === row.displayValue ? row.rawValue : row.value.value, [parameterIdentity]: row.identity })),
      events: eventInputs.map(row => ({ signal: row.signal.value, event: row.event.value })) };
  };
  const raw = () => { const visible = readVisible(); return draft.map(binding => binding.bindingId === selected && visible ? visible : binding); };
  const signature = () => JSON.stringify(raw());
  const dirty = () => Boolean(session && signature() !== initialSignature);
  const approved = () => Boolean(proposal && signature() === approvalSignature && isSceneBehaviorProposal(proposal));
  function invalidate() { proposal = null; approvalSignature = ''; message = '行为修改尚未应用；检查后再应用到草稿。'; diagnostic = ''; }
  function capture() { const visible = readVisible(); if (visible) draft = draft.map(binding => binding.bindingId === selected ? visible : binding); }
  function changed() { if (!pending && current()) { capture(); invalidate(); refresh(); } }
  function options(select, values, value) {
    select.replaceChildren(); for (const [id, label] of values) { const option = node('option', label); option.value = id; select.append(option); } select.value = value;
  }
  function field(label, input) { const wrapper = node('label'), caption = node('span', t(label)); caption.dataset.i18n = label; wrapper.append(caption, input); return wrapper; }
  function input(id, value, multiline = false) {
    const element = node(multiline ? 'textarea' : 'input'); element.id = 'sceneBehaviors' + id;
    if (!multiline) element.type = 'text'; element.value = value; element.spellcheck = false;
    element.addEventListener('input', changed); return element;
  }
  function removeButton(label, action) { const element = node('button', t(label)); element.dataset.i18n = label; element.type = 'button'; element.className = 'doc-btn doc-btn-ghost'; element.addEventListener('click', action); return element; }
  function resetAudioTracks() { audioRequest++; audioPending = false; audioCatalog = null; audioMessage = ''; audioChoices.clear(); }
  function usableAudioTracks() { return Boolean(audioAvailable() && current() && isSceneBehaviorAudioTracks(audioCatalog)
    && sceneBehaviorAudioTracksMatchSource(audioCatalog, session.source)); }
  function audioRowCurrent(row) { return Boolean(!pending && !audioPending && usableAudioTracks() && selected === row.bindingId
    && parameterInputs.includes(row) && row.type.value === 'string' && active()?.parameters.some(item => item[parameterIdentity] === row.identity)); }
  function refreshAudioTracks() {
    const available = audioAvailable();
    if (!available || session && !current()) resetAudioTracks();
    el('AudioTracksTools').hidden = !available || !session;
    el('LoadAudioTracks').disabled = pending || audioPending || !current();
    el('AudioTracksTools').setAttribute('aria-busy', String(audioPending));
    const usable = usableAudioTracks(), ready = usable && audioCatalog.status === 'ready';
    el('AudioTracksStatus').textContent = t(audioMessage);
    el('AudioTracksStatus').dataset.status = audioPending ? 'loading' : usable ? audioCatalog.status : audioMessage ? 'error' : 'idle';
    el('AudioTracksPath').textContent = usable && audioCatalog.manifest ? t('声音来源：{0}', audioCatalog.manifest.sourcePath) : '';
    for (const row of parameterInputs) {
      if (row.type.value !== 'string') continue;
      if (!row.audio && ready) {
        const wrapper = node('div'); wrapper.className = 'scene-behaviors-audio-picker';
        const select = node('select'); select.id = `sceneBehaviorsParam${row.index}AudioTrack`;
        const use = removeButton('填入音轨编号', () => {
          if (!audioRowCurrent(row) || !select.value || audioChoices.get(row.identity) !== select.value) return;
          try {
            const value = sceneBehaviorAudioTrackValue(audioCatalog, select.value);
            if (!audioRowCurrent(row)) return;
            row.value.value = value; changed(); row.value.focus();
          } catch { audioCatalog = null; audioMessage = '场景音轨已变化，请重新读取；参数与审阅保持不变。'; refresh(); }
        });
        use.id = `sceneBehaviorsParam${row.index}UseAudioTrack`;
        select.addEventListener('change', () => { if (!audioRowCurrent(row)) return; audioChoices.set(row.identity, select.value); refresh(); });
        wrapper.append(field('可选场景音轨', select), use); row.wrapper.append(wrapper); row.audio = { wrapper, select, use, catalog: null };
      }
      if (!row.audio) continue;
      const { wrapper, select, use } = row.audio; wrapper.hidden = !ready;
      if (ready && row.audio.catalog !== audioCatalog) {
        const choice = audioChoices.get(row.identity) || '';
        options(select, [['', t('请选择音轨')], ...audioCatalog.tracks.map((track, index) => [track.trackId,
          t('音轨 {0} · {1} · {2}', index + 1, t(track.role === 'music' ? '音乐' : '音效'), track.trackId)])],
          audioCatalog.tracks.some(track => track.trackId === choice) ? choice : '');
        audioChoices.set(row.identity, select.value); row.audio.catalog = audioCatalog;
      }
      select.disabled = !audioRowCurrent(row); use.disabled = !audioRowCurrent(row) || !select.value;
    }
  }
  async function loadAudioTracks() {
    if (pending || audioPending || !current() || !audioAvailable()) return false;
    const owner = session, request = ++audioRequest, opening = epoch;
    const owns = () => !disposed && dialog.open && epoch === opening && request === audioRequest && session === owner && current() && audioAvailable();
    audioPending = true; audioMessage = '正在读取已保存的场景音轨…'; refresh();
    try {
      const value = await getAudioTracks(owner.source); if (!owns()) return false;
      if (!isSceneBehaviorAudioTracks(value) || !sceneBehaviorAudioTracksMatchSource(value, owner.source)
        || value.scene.objectId !== owner.catalog.scene.objectId || value.scene.sourcePath !== owner.catalog.scene.sourcePath
        || value.scene.sourceRevision !== owner.catalog.scene.sourceRevision) throw Error('Invalid scene audio directory.');
      audioCatalog = value; audioMessage = value.status === 'empty' ? '当前场景没有已保存的音轨；文本参数仍可直接编辑。' : '选择音轨后，点击“填入音轨编号”才会修改参数。'; return true;
    } catch { if (owns()) { audioCatalog = null; audioMessage = '无法读取场景音轨；输入和审阅已保留，可以重试。'; } return false; }
    finally { if (!disposed && epoch === opening && request === audioRequest && session === owner) { audioPending = false; refresh(); } }
  }
  const animationClips = setupSceneBehaviorAnimationClips({ container: el('AnimationClipsTools'), getAnimationClips, translate: t,
    getContext: () => ({ available: getContext().animationClipsAvailable === true, current: current(), pending, source: session?.source, scene: session?.catalog.scene, rows: parameterInputs }),
    onUse: (row, value) => { if (pending || !current() || !parameterInputs.includes(row) || row.type.value !== 'string' || selected !== row.bindingId) return; row.value.value = value; changed(); row.value.focus(); } });
  const parameterInterface = setupSceneBehaviorParameters({ container: el('ParameterInterface'), translate: t,
    getContext: () => {
      const source = session?.catalog.sources.find(item => item.objectId === el('Source').value);
      return { session, source, contract: source?.parameterContract, current: current(), pending, bindingId: selected,
        backendId: session?.backendId, language: session?.language, rows: parameterInputs,
        parameters: (readVisible()?.parameters || []).map(row => ({ name: row.key, type: row.type, value: row.value })) };
    },
    onAddMissing: (declarations, { isCurrent }) => {
      if (pending || !current() || !isCurrent() || parameterInputs.length + declarations.length > 32) return;
      capture(); if (!isCurrent()) return;
      for (const declaration of declarations) active().parameters.push({ key: declaration.name, type: declaration.type,
        value: Object.is(declaration.defaultValue, -0) ? '-0' : String(declaration.defaultValue) });
      invalidate(); renderBinding(); refresh(); parameterInputs.at(-1)?.value.focus();
    },
    onRename: (row, declaration, { isCurrent }) => {
      if (pending || !current() || !isCurrent() || !parameterInputs.includes(row) || selected !== row.bindingId || row.type.value !== declaration.type) return;
      row.key.value = declaration.name; changed(); row.key.focus();
    } });
  function renderBinding() {
    const binding = active(); parameterInputs = []; eventInputs = []; el('Parameters').replaceChildren(); el('Events').replaceChildren();
    if (!session || !binding) return;
    options(el('Binding'), draft.map((item, index) => [item.bindingId, t('绑定 {0}', index + 1)]), selected);
    el('BindingId').textContent = t('绑定身份：{0}', binding.bindingId);
    options(el('Instance'), session.catalog.scene.instances.map(item => [item.instanceId, `${item.name} · ${item.instanceId}`]), binding.instanceId);
    options(el('Source'), session.catalog.sources.map(item => [item.objectId, `${item.name} · ${item.sourcePath}`]), binding.sourceObjectId);
    for (const [index, row] of binding.parameters.entries()) {
      const wrapper = node('div'); wrapper.className = 'scene-behaviors-parameter';
      const key = input(`Param${index}Name`, row.key), type = node('select'); type.id = `sceneBehaviorsParam${index}Type`;
      options(type, [['string', t('文本')], ['number', t('数字')], ['boolean', t('布尔值')]], row.type);
      let value;
      if (row.type === 'boolean') {
        value = node('select'); value.id = `sceneBehaviorsParam${index}Value`;
        options(value, [...(!['true', 'false'].includes(row.value) ? [[row.value, t('请选择布尔值')]] : []), ['true', t('真')], ['false', t('假')]], row.value);
        value.addEventListener('change', changed);
      } else { value = input(`Param${index}Value`, row.value, row.type === 'string'); if (row.type === 'number') value.inputMode = 'decimal'; }
      type.addEventListener('change', () => { if (pending || !current()) return; capture(); invalidate(); renderBinding(); refresh(); });
      const remove = removeButton('移除参数', () => { if (pending || !current()) return; capture(); active().parameters.splice(index, 1); invalidate(); renderBinding(); refresh(); });
      remove.id = `sceneBehaviorsParam${index}Remove`;
      wrapper.append(field('参数名称', key), field('参数类型', type), field('参数值', value), remove);
      if (!row[parameterIdentity]) row[parameterIdentity] = ++rowSequence;
      el('Parameters').append(wrapper); parameterInputs.push({ key, type, value, rawValue: row.value, displayValue: value.value, identity: row[parameterIdentity], bindingId: binding.bindingId, index, wrapper });
    }
    for (const [index, row] of binding.events.entries()) {
      const wrapper = node('div'); wrapper.className = 'scene-behaviors-event';
      const signal = input(`Event${index}Signal`, row.signal), event = input(`Event${index}Name`, row.event);
      const remove = removeButton('移除信号', () => { if (pending || !current()) return; capture(); active().events.splice(index, 1); invalidate(); renderBinding(); refresh(); });
      remove.id = `sceneBehaviorsEvent${index}Remove`; wrapper.append(field('脚本信号名', signal), field('事件名称', event), remove);
      el('Events').append(wrapper); eventInputs.push({ signal, event });
    }
  }
  function refresh() {
    if (disposed) return;
    const context = getContext(); button.hidden = !eligible(context); button.disabled = context.available !== true || Boolean(context.busy);
    button.textContent = t('编辑场景行为'); button.title = t(context.available === true ? '编辑场景行为' : '当前宿主不支持行为依赖检查。');
    if (proposal && !approved()) invalidate();
    if (session && !current()) { if (!pending) proposal = null; message = '原文或依赖已变化，请返回后重新打开行为编辑。'; }
    translatePage(dialog); dialog.setAttribute('aria-busy', String(pending)); dialog.dataset.dirty = String(dirty());
    el('Fields').hidden = !session; const locked = pending || !current();
    for (const element of el('Fields').querySelectorAll('input,select,textarea,button')) element.disabled = locked;
    el('AddBinding').disabled = locked || draft.length >= 32; el('RemoveBinding').disabled = locked || draft.length <= 1;
    el('AddParameter').disabled = locked || !active() || active().parameters.length >= 32;
    el('AddEvent').disabled = locked || !active() || active().events.length >= 8;
    el('Check').disabled = locked || !dirty(); el('Apply').disabled = locked || !approved();
    el('Status').textContent = t(message); el('Diagnostic').textContent = diagnostic ? t(diagnostic) : '';
    el('Review').hidden = !proposal; el('Before').textContent = proposal?.beforeContent || ''; el('After').textContent = proposal?.afterContent || '';
    el('ChangedPaths').replaceChildren(); for (const path of proposal?.changedPaths || []) el('ChangedPaths').append(node('li', path));
    el('Path').textContent = session?.source.sourcePath || context.sourcePath || '';
    el('Fixed').textContent = session ? t('场景：{0} · 后端：{1} · 语言：{2}', session.catalog.scene.sourcePath, session.backendId, session.language) : '';
    refreshAudioTracks(); animationClips.refresh(); parameterInterface.refresh();
  }
  function close(force = false) {
    if (!force && dirty() && !window.confirm(t('丢弃本次行为表单修改？原文草稿不会改变。'))) return false;
    const target = opener, request = ++epoch; opener = null; session = null; draft = []; selected = ''; pending = false;
    resetAudioTracks(); animationClips.reset(); parameterInterface.reset(); proposal = null; parameterInputs = []; eventInputs = []; message = ''; diagnostic = '';
    if (dialog.open) dialog.close(); refresh();
    Promise.resolve().then(() => { if (!disposed && request === epoch && !dialog.open && target?.isConnected !== false) target?.focus?.(); }); return true;
  }
  function fail(error, fallback) {
    const code = error?.errorCode || error?.payload?.errorCode;
    message = code === 'scene_behavior_authoring_unchanged' ? '行为内容没有变化，原文草稿保持不变。'
      : code === 'scene_behavior_authoring_conflict' ? '原文或依赖已变化，请返回后重新打开行为编辑。' : fallback;
    diagnostic = error?.uiKey || (typeof error?.message === 'string' ? error.message : '');
  }
  function catalog(value, source, model) {
    if (!exact(value, ['format', 'schemaVersion', 'sourcePath', 'objectId', 'scene', 'sources', 'dependencyRevision'])
      || value.format !== 'viento-behavior-authoring-context' || value.schemaVersion !== 1 || value.sourcePath !== source.sourcePath
      || !uuid(value.objectId) || !revision(value.dependencyRevision)
      || !exact(value.scene, ['objectId', 'sourcePath', 'sourceRevision', 'instances']) || value.scene.objectId !== model.sceneObjectId
      || !text(value.scene.sourcePath) || !value.scene.sourcePath || !revision(value.scene.sourceRevision)
      || !Array.isArray(value.scene.instances) || value.scene.instances.length < 1 || value.scene.instances.length > 128
      || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 256) invalid();
    const instances = new Set(), sources = new Set();
    for (const item of value.scene.instances) {
      if (!exact(item, ['instanceId', 'objectId', 'name']) || !uuid(item.instanceId) || !uuid(item.objectId) || !text(item.name) || instances.has(item.instanceId)) invalid();
      instances.add(item.instanceId);
    }
    for (const item of value.sources) {
      if (!exact(item, ['objectId', 'sourcePath', 'sourceRevision', 'name', ...(Object.hasOwn(item, 'parameterContract') ? ['parameterContract'] : [])]) || !uuid(item.objectId) || sources.has(item.objectId)
        || !text(item.sourcePath) || !/\.txt$/i.test(item.sourcePath) || !revision(item.sourceRevision) || !text(item.name)) invalid();
      if (Object.hasOwn(item, 'parameterContract')) captureScriptParameterContract(item.parameterContract);
      sources.add(item.objectId);
    }
    if (model.bindings.some(binding => !instances.has(binding.instanceId) || !sources.has(binding.implementation.sourceObjectId))) invalid();
    return clone(value);
  }
  const dependencySignature = value => canonicalJson({ ...value, sources: value.sources.map(({ parameterContract, ...source }) => source) });
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.busy || context.available !== true) return false;
    const request = ++epoch; opener = document.activeElement; pending = true; message = '正在读取行为绑定与依赖…'; diagnostic = ''; dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && request === epoch && eligible(next)
      && !next.busy && next.available === true && context.sourcePath === next.sourcePath && context.sourceToken === next.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      if (!exact(source, ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content']) || source.sourcePath !== context.sourcePath
        || source.token !== context.sourceToken || !revision(source.baseSourceRevision) || !revision(source.sourceRevision) || typeof source.content !== 'string') invalid();
      const captured = Object.freeze({ ...source }), parsed = inspectSceneBehaviors(captured.content);
      if (!parsed.recognized || !parsed.ok || !parsed.value) invalid();
      const inspected = await inspect({ sourcePath: captured.sourcePath, content: captured.content }); if (!owns()) return false;
      const checked = catalog(inspected, captured, parsed.value), first = parsed.value.bindings[0].implementation;
      session = { source: captured, model: parsed.value, catalog: checked, catalogSignature: dependencySignature(checked), backendId: first.backendId, language: first.language };
      draft = parsed.value.bindings.map(binding => ({ bindingId: binding.bindingId, instanceId: binding.instanceId, sourceObjectId: binding.implementation.sourceObjectId,
        parameters: Object.entries(binding.parameters).map(([key, value]) => ({ key, type: typeof value, value: Object.is(value, -0) ? '-0' : String(value) })), events: clone(binding.events) }));
      selected = draft[0].bindingId; renderBinding(); initialSignature = signature(); invalidate(); message = '选择绑定并编辑；检查完整候选后应用到草稿。'; return true;
    } catch (error) { if (owns()) fail(error, '无法读取有效行为绑定，请检查原文和登记依赖。'); return false; }
    finally { if (!disposed && request === epoch && dialog.open) { pending = false; refresh(); } }
  }
  function bindings() {
    return raw().map(binding => {
      const parameters = {}, keys = new Set();
      for (const parameter of binding.parameters) {
        const { key, type, value } = parameter;
        if (!name(key) || ['constructor', '__proto__', 'prototype'].includes(key) || keys.has(key)) invalid('参数名称须为唯一的ASCII标识符，且不能使用保留名称。');
        keys.add(key); let scalar;
        if (type === 'string') scalar = value;
        else if (type === 'boolean' && ['true', 'false'].includes(value)) scalar = value === 'true';
        else if (type === 'number' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
          scalar = Number(value); if (!Number.isFinite(scalar) || Number.isInteger(scalar) && !Number.isSafeInteger(scalar)) invalid('数字参数须完整、有限，整数不能超过安全范围。');
        } else invalid(type === 'number' ? '数字参数须完整、有限，整数不能超过安全范围。' : '请选择有效的参数类型和值。');
        Object.defineProperty(parameters, key, { value: scalar, enumerable: true, configurable: true, writable: true });
      }
      return { bindingId: binding.bindingId, instanceId: binding.instanceId,
        implementation: { backendId: session.backendId, language: session.language, sourceObjectId: binding.sourceObjectId }, parameters, events: clone(binding.events) };
    });
  }
  async function check() {
    if (pending || !current() || !dirty()) { refresh(); return false; }
    capture(); invalidate(); const owner = session, request = epoch, form = signature(); pending = true; message = '正在检查行为修改与登记依赖…'; refresh();
    const owns = () => request === epoch && session === owner && current() && signature() === form;
    try {
      const next = bindings(), candidate = createSceneBehaviorProposal(owner.source, { bindings: next });
      if (!isSceneBehaviorProposal(candidate) || candidate.kind !== 'scene-behaviors' || candidate.sourcePath !== owner.source.sourcePath
        || candidate.sourceToken !== owner.source.token || candidate.beforeContent !== owner.source.content || typeof candidate.afterContent !== 'string'
        || candidate.afterContent === candidate.beforeContent || canonicalJson(candidate.bindings) !== canonicalJson(next)
        || !Array.isArray(candidate.changedPaths) || !candidate.changedPaths.length) invalid();
      const result = await inspect({ sourcePath: candidate.sourcePath, content: candidate.afterContent }); if (!owns()) return false;
      const parsed = inspectSceneBehaviors(candidate.afterContent); if (!parsed.ok || !parsed.value) invalid();
      const checked = catalog(result, owner.source, parsed.value);
      if (dependencySignature(checked) !== owner.catalogSignature) invalid('原文或依赖已变化，请返回后重新打开行为编辑。');
      proposal = candidate; approvalSignature = form; message = '行为与依赖已检查，请审阅完整原文后应用。'; return true;
    } catch (error) { if (owns()) fail(error, '行为修改未通过检查，输入已保留。'); return false; }
    finally { if (!disposed && request === epoch && session === owner && dialog.open) { pending = false; refresh(); } }
  }
  async function apply() {
    if (pending || !current() || !approved()) { refresh(); return false; }
    const owner = session, request = epoch, candidate = proposal, form = approvalSignature;
    const owns = () => !disposed && dialog.open && request === epoch && session === owner;
    const unchanged = () => owns() && current() && proposal === candidate && signature() === form;
    pending = true; message = '正在应用行为修改到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged, dependencyRevision: owner.catalog.dependencyRevision }); if (!owns()) return false;
      const context = getContext();
      if (proposal !== candidate || signature() !== form || result?.applied !== true || result.sourcePath !== owner.source.sourcePath
        || result.content !== candidate.afterContent || typeof result.sourceToken !== 'string' || result.sourceToken === owner.source.token
        || !eligible(context) || context.available !== true || context.busy || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) invalid();
      opener = null; close(true); result.focus?.(); return true;
    } catch (error) { if (owns()) fail(error, '行为修改未确认应用，输入已保留。'); return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  el('Binding').addEventListener('change', () => { if (pending || !current()) return; const next = el('Binding').value; capture();
    if (proposal && !approved()) invalidate(); if (draft.some(binding => binding.bindingId === next)) selected = next; renderBinding(); refresh(); });
  el('Instance').addEventListener('change', changed); el('Source').addEventListener('change', changed);
  el('AddBinding').addEventListener('click', () => {
    if (pending || !current() || draft.length >= 32) return; capture();
    try {
      const id = crypto.randomUUID(); if (!uuid(id) || draft.some(binding => binding.bindingId === id)) invalid();
      const previous = active(); draft.push({ bindingId: id, instanceId: previous.instanceId, sourceObjectId: previous.sourceObjectId, parameters: [], events: [] });
      selected = id; invalidate(); renderBinding(); refresh();
    } catch (error) { fail(error, '无法分配新的绑定身份，请重试。'); refresh(); }
  });
  el('RemoveBinding').addEventListener('click', () => { if (pending || !current() || draft.length <= 1) return; capture();
    const index = draft.findIndex(binding => binding.bindingId === selected); draft.splice(index, 1); selected = draft[Math.min(index, draft.length - 1)].bindingId; invalidate(); renderBinding(); refresh(); });
  el('AddParameter').addEventListener('click', () => { if (pending || !current() || active().parameters.length >= 32) return; capture(); active().parameters.push({ key: '', type: 'string', value: '' }); invalidate(); renderBinding(); refresh(); });
  el('AddEvent').addEventListener('click', () => { if (pending || !current() || active().events.length >= 8) return; capture(); active().events.push({ signal: '', event: '' }); invalidate(); renderBinding(); refresh(); });
  el('LoadAudioTracks').addEventListener('click', () => void loadAudioTracks());
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) close(); } });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(() => {
    if (disposed) return; capture(); if (proposal && !approved()) invalidate();
    for (const [index, option] of [...el('Binding').children].entries()) option.textContent = t('绑定 {0}', index + 1);
    if (active()) el('BindingId').textContent = t('绑定身份：{0}', active().bindingId);
    for (const row of parameterInputs) {
      for (const option of row.type.children) option.textContent = t({ string: '文本', number: '数字', boolean: '布尔值' }[option.value]);
      if (row.type.value === 'boolean') for (const option of row.value.children) option.textContent = t(option.value === 'true' ? '真' : option.value === 'false' ? '假' : '请选择布尔值');
      if (row.audio) row.audio.catalog = null;
    }
    refresh();
  });
  function dispose() { if (disposed) return; close(true); disposed = true; animationClips.dispose(); parameterInterface.dispose(); unsubscribe?.(); button.remove(); dialog.remove(); }
  refresh(); return Object.freeze({ refresh, dispose, open });
}
