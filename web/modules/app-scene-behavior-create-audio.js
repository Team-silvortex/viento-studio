import { captureSceneBehaviorCreateAudio, isSceneBehaviorCreateAudio, sceneBehaviorCreateAudioMatchOrigin,
  proposeSceneBehaviorCreateAudio } from '../../engine/scene-behavior-create-audio.mjs';
import { listSceneBehaviorCreateStringParameters } from '../../engine/scene-behavior-create-references.mjs';
import { t } from '../i18n/index.js';

// Saved track identities only. The creator keeps its parameter source and
// review; choosing an identity never plays sound or grants author authority.
export function setupSceneBehaviorCreateAudio({ container, getContext = () => ({}), getAudioTracks, onUse = () => {}, translate = t } = {}) {
  const document = container.ownerDocument;
  const node = (tag, value = '') => { const element = document.createElement(tag); element.textContent = value; return element; };
  const ownerKeys = ['session', 'catalog', 'source', 'bindingId', 'instanceId', 'backendId', 'language', 'epoch', 'readEpoch'];
  const sceneKeys = ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'];
  let disposed = false, owner = null, view = null, catalog = null, generation = 0, loading = false, inflightContent = '';
  let track = '', parameter = '', message = '';
  const eligible = context => !disposed && context.available === true && context.current === true && typeof getAudioTracks === 'function'
    && context.session && context.catalog && context.source && context.bindingId && context.instanceId && context.origin && typeof context.content === 'string';
  const sameOrigin = (a, b) => Boolean(a && b && a.worldId === b.worldId && a.baseRevision === b.baseRevision && a.scene && b.scene && sceneKeys.every(key => a.scene[key] === b.scene[key]));
  const originSnapshot = origin => ({ worldId: origin.worldId, baseRevision: origin.baseRevision, scene: Object.fromEntries(sceneKeys.map(key => [key, origin.scene[key]])) });
  const sameOwner = (token, context = getContext()) => Boolean(token && token === owner && eligible(context)
    && ownerKeys.every(key => token[key] === context[key]) && sameOrigin(token.origin, context.origin));
  const mutable = token => sameOwner(token) && !getContext().pending && !loading;
  const selectionCurrent = () => Boolean(view && view.track.select.value === track && view.parameter.select.value === parameter);
  const usable = context => sameOwner(owner, context) && isSceneBehaviorCreateAudio(catalog) && sceneBehaviorCreateAudioMatchOrigin(catalog, context.origin);
  const stringParameters = context => { try { return listSceneBehaviorCreateStringParameters(context.content); } catch { return null; } };
  function options(select, values, selected) {
    const signature = JSON.stringify(values);
    if (select.__creationAudioOptions !== signature) {
      select.replaceChildren(); for (const [value, label] of values) { const option = node('option', label); option.value = value; select.append(option); }
      select.__creationAudioOptions = signature;
    }
    select.value = values.some(([value]) => value === selected) ? selected : '';
  }
  function reset() {
    generation++; loading = false; inflightContent = ''; owner = null; view = null; catalog = null;
    track = ''; parameter = ''; message = ''; container.replaceChildren();
  }
  function createView(token) {
    const title = node('h4'), note = node('p'), load = node('button'), status = node('p'), source = node('p'), fields = node('div'), detail = node('p'), use = node('button');
    const field = suffix => { const label = node('label'), caption = node('span'), select = node('select'); select.id = 'sceneBehaviorCreateAudio' + suffix; label.append(caption, select); fields.append(label); return { label, caption, select }; };
    for (const [suffix, element] of [['Title', title], ['Note', note], ['Load', load], ['Status', status], ['Source', source], ['Detail', detail], ['Use', use]]) element.id = 'sceneBehaviorCreateAudio' + suffix;
    note.className = status.className = source.className = detail.className = 'scene-behavior-create-note'; fields.className = 'scene-behavior-create-audio-fields';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); load.type = use.type = 'button'; load.className = use.className = 'doc-btn doc-btn-ghost';
    const result = { title, note, load, status, source, fields, detail, use, track: field('Track'), parameter: field('Parameter') };
    result.track.select.setAttribute('aria-describedby', detail.id); container.append(title, note, load, status, source, fields, detail, use);
    load.addEventListener('click', () => { if (mutable(token)) void read(token); });
    result.track.select.addEventListener('change', () => {
      if (!mutable(token) || !usable(getContext())) return;
      const chosen = result.track.select.value;
      if (chosen && !catalog.tracks.some(row => row.trackId === chosen)) { refresh(); return; }
      track = chosen; refresh();
    });
    result.parameter.select.addEventListener('change', () => {
      if (!mutable(token)) return;
      const chosen = result.parameter.select.value;
      if (chosen && !stringParameters(getContext())?.some(row => row.name === chosen)) { refresh(); return; }
      parameter = chosen; refresh();
    });
    use.addEventListener('click', () => { if (mutable(token)) void insert(token); });
    return result;
  }
  function clearDirectory() { catalog = null; track = ''; }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!eligible(context)) { reset(); container.hidden = true; return; }
    if (!sameOwner(owner, context)) { reset(); owner = { ...Object.fromEntries(ownerKeys.map(key => [key, context[key]])), origin: originSnapshot(context.origin) }; view = createView(owner); }
    if (loading && (context.pending || context.content !== inflightContent)) { generation++; loading = false; clearDirectory(); message = '连接操作已失效；参数与审阅保持不变，请重试。'; }
    const ready = usable(context), locked = loading || Boolean(context.pending), parameters = stringParameters(context);
    if (!parameters?.some(row => row.name === parameter)) parameter = '';
    if (!ready || !catalog.tracks.some(row => row.trackId === track)) track = '';
    container.hidden = false; container.className = 'scene-behavior-create-audio'; container.setAttribute('aria-busy', String(loading));
    container.dataset.status = loading ? 'loading' : ready ? catalog.status : message ? 'error' : 'idle';
    view.title.textContent = translate('按声明音轨填写行为参数');
    view.note.textContent = translate('读取当前场景已保存的音轨，明确选择音轨和已有文本参数后填入；不会识别参数用途或播放声音。');
    view.load.textContent = translate('读取场景音轨'); view.load.disabled = locked;
    view.track.caption.textContent = translate('可选场景音轨'); options(view.track.select, [['', translate('请选择音轨')], ...(ready ? catalog.tracks : []).map((row, index) => [row.trackId,
      translate('音轨 {0} · {1} · {2}', index + 1, translate(row.role === 'music' ? '音乐' : '音效'), row.trackId)])], track);
    view.track.select.disabled = locked || !ready || !catalog.tracks.length;
    view.parameter.caption.textContent = translate('写入哪个文本参数'); options(view.parameter.select, [['', translate('请选择文本参数')], ...(parameters || []).map(row => [row.name, row.name])], parameter);
    view.parameter.select.disabled = locked || !ready || !parameters?.length;
    view.source.textContent = ready ? translate('场景来源：{0}', catalog.scene.sourcePath) + (catalog.manifest ? '\n' + translate('声音来源：{0}', catalog.manifest.sourcePath) : '') : '';
    const chosen = ready ? catalog.tracks.find(row => row.trackId === track) : null;
    view.detail.textContent = chosen ? translate('音轨编号：{0}；素材编号：{1}', chosen.trackId, chosen.resourceId) : '';
    let hint = '读取来源后再选择。';
    if (parameters === null) hint = '参数 JSON 尚未有效，辅助不会修改原文；请继续手工编辑。';
    else if (ready) {
      if (!catalog.tracks.length) hint = '当前场景没有已保存的音轨；文本参数仍可直接编辑。';
      else if (!parameters.length) hint = '当前没有可选文本参数；数字和布尔值保持原样。';
      else hint = '选择不会修改参数；点击填入才会更改文本值。';
    }
    view.status.textContent = translate(message || hint); view.status.dataset.status = container.dataset.status;
    view.use.textContent = translate('填入音轨编号'); view.use.disabled = locked || !ready || !track || !parameter || !selectionCurrent();
  }
  const changedOriginMessage = '音轨目录与创建来源不一致；请在创建窗口重新读取工程，参数与审阅保持不变。';
  const readFailure = error => error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'errorCode')?.value === 'scene_behavior_create_audio_origin_changed'
    ? changedOriginMessage : '无法读取场景音轨；输入和审阅已保留，可以重试。';
  function captureDirectory(raw, context) {
    try { const value = captureSceneBehaviorCreateAudio(context.origin, raw); if (!isSceneBehaviorCreateAudio(value) || !sceneBehaviorCreateAudioMatchOrigin(value, context.origin)) throw Error('Invalid creation audio directory.'); return value; }
    catch (error) { throw error; }
  }
  async function read(token) {
    if (!mutable(token)) return false;
    const before = getContext().content, request = ++generation; loading = true; inflightContent = before; track = ''; message = '正在读取已保存的场景音轨…'; refresh();
    const owns = () => request === generation && sameOwner(token) && !getContext().pending && getContext().content === before && selectionCurrent();
    try {
      const raw = await getAudioTracks({ sceneObjectId: token.origin.scene.objectId });
      if (!owns()) { if (request === generation && sameOwner(token)) message = '连接操作已失效；参数与审阅保持不变，请重试。'; return false; }
      catalog = captureDirectory(raw, getContext()); message = ''; return true;
    } catch (error) { if (owns()) { clearDirectory(); message = readFailure(error); } return false; }
    finally { if (request === generation && sameOwner(token)) { loading = false; refresh(); } }
  }
  async function insert(token) {
    const context = getContext();
    if (!mutable(token) || !usable(context) || !selectionCurrent() || !catalog.tracks.some(row => row.trackId === track) || !stringParameters(context)?.some(row => row.name === parameter)) return false;
    const original = catalog, selected = { track, parameter }, before = context.content, fingerprint = JSON.stringify(catalog), request = ++generation;
    const owns = () => request === generation && sameOwner(token) && !getContext().pending && getContext().content === before && catalog === original
      && track === selected.track && parameter === selected.parameter && selectionCurrent();
    loading = true; inflightContent = before; message = '正在重新核对参数来源…'; refresh();
    try {
      const raw = await getAudioTracks({ sceneObjectId: token.origin.scene.objectId });
      if (!owns()) { if (request === generation && sameOwner(token)) message = '连接操作已失效；参数与审阅保持不变，请重试。'; return false; }
      const current = captureDirectory(raw, getContext());
      if (current.revision !== original.revision || JSON.stringify(current) !== fingerprint) { clearDirectory(); message = '连接目录已变化，请重新读取；参数与审阅保持不变。'; return false; }
      const proposed = proposeSceneBehaviorCreateAudio({ content: before, catalog: current, origin: getContext().origin, parameter: selected.parameter, trackId: selected.track });
      if (!owns()) return false;
      loading = false;
      if (proposed.changed) { message = '已填入音轨编号；仍需审阅新行为并保存。'; onUse(proposed, { isCurrent: owns }); }
      else message = '所选值与当前参数相同，参数与审阅保持不变。';
      return true;
    } catch (error) {
      if (owns()) {
        if (error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'errorCode')?.value === 'scene_behavior_create_parameters_invalid') message = '无法填入参数，原始输入已保留；请检查参数大小和数量。';
        else { clearDirectory(); message = readFailure(error); }
      }
      return false;
    } finally { if (request === generation && sameOwner(token)) { loading = false; refresh(); } }
  }
  refresh();
  return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; container.hidden = true; } });
}
