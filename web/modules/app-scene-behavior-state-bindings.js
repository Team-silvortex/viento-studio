import { reviewAnimationStateBindings } from '../../engine/animation-state-bindings.mjs';
import { isSceneBehaviorAnimationClips, sceneBehaviorAnimationClipsMatchSource } from '../../engine/scene-animation-directory.mjs';

// A local configuration contribution. Discovery and source ownership come from
// the host; only an explicit apply returns parameter rows to the ordinary form.
export function setupSceneBehaviorStateBindings({ container, getContext = () => ({}), getAnimationClips, onApply = () => {}, translate = value => value } = {}) {
  const document = container.ownerDocument;
  const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
  const issueText = {
    'duplicate-parameter': '参数名重复，请先在参数表中修正。',
    'type-mismatch': '状态片段参数需要文本类型，请先在参数表中修正。',
    'invalid-clip': '当前值不是有效片段编号，请明确选择片段或完整动画。',
    'clip-missing': '当前片段不在已保存的本场景动画中，请重新选择。',
    'animation-missing': '当前场景没有已保存动画，请先创建并保存动画。',
    'parameter-limit': '补齐状态参数会超过 32 项，请先整理参数表。',
    'completion-loop': '此状态有完成转换，但所选片段循环播放，不会自然完成。',
  };
  let disposed = false, generation = 0, owner = null, catalog = null, loading = false, message = '', choices = null, view = null;
  const identity = context => [context.session, context.source, context.script, context.declaration, context.bindingId, context.instanceId, context.rows,
    context.backendId, context.language, context.scene?.objectId, context.scene?.sourcePath, context.scene?.sourceRevision, JSON.stringify(context.parameters)];
  const eligible = context => context.current === true && context.available === true && typeof getAnimationClips === 'function'
    && context.declaration && context.backendId === 'org.viento.godot4' && context.language === 'gdscript';
  function current(token) {
    if (disposed || !token || owner !== token || token.revoked) return false;
    const context = getContext();
    if (!eligible(context) || !identity(context).every((value, index) => value === token.identity[index])) { token.revoked = true; return false; }
    // Once another form operation is observed, an in-flight directory read
    // cannot regain authority when that operation finishes.
    if (context.pending && loading) { generation++; loading = false; message = '读取已中止，请重新读取状态片段配置。'; }
    return true;
  }
  const mutable = token => current(token) && !getContext().pending && !loading;
  const matches = (value, context) => isSceneBehaviorAnimationClips(value) && sceneBehaviorAnimationClipsMatchSource(value, context.source)
    && ['objectId', 'sourcePath', 'sourceRevision'].every(key => value.scene[key] === context.scene?.[key]);
  const signature = value => JSON.stringify(value);
  const review = () => reviewAnimationStateBindings({ declaration: getContext().declaration, catalog, parameters: getContext().parameters,
    ...(choices ? { selections: choices } : {}) });
  function reset() { generation++; owner = null; catalog = null; loading = false; choices = null; message = ''; view = null; container.replaceChildren(); }
  function createView(token) {
    const title = node('h4'), note = node('p'), load = node('button'), status = node('p'), path = node('p'), rows = node('div'), issues = node('ul'), apply = node('button'), resetChoices = node('button'), actions = node('div');
    for (const [element, suffix] of [[title,'Title'],[load,'Load'],[status,'Status'],[path,'Path'],[apply,'Apply'],[resetChoices,'Reset']]) element.id = 'sceneBehaviorsStateBindings' + suffix;
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    for (const element of [note, status, path]) element.className = 'scene-behaviors-note';
    for (const element of [load, apply, resetChoices]) { element.type = 'button'; element.className = 'doc-btn doc-btn-ghost'; }
    actions.className = 'scene-behaviors-state-binding-actions'; actions.append(apply, resetChoices);
    container.classList.add('scene-behaviors-state-bindings'); container.append(title, note, load, status, path, rows, issues, actions);
    load.addEventListener('click', () => { if (mutable(token)) void read(token); });
    resetChoices.addEventListener('click', () => { if (mutable(token) && catalog) { choices = null; message = ''; refresh(); } });
    apply.addEventListener('click', () => { if (mutable(token) && catalog) void applyChoices(token); });
    return { title, note, load, status, path, rows, issues, apply, resetChoices, pickers: new Map() };
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (!eligible(context)) { reset(); container.hidden = true; return; }
    if (!current(owner)) { reset(); owner = { identity: identity(context) }; view = createView(owner); }
    container.hidden = false; container.setAttribute('aria-busy', String(loading));
    view.title.textContent = translate('状态与动画片段');
    view.note.textContent = translate('按状态选择本场景已保存的动画片段，再应用到参数表。完整动画使用空值；其循环设置请在动画文档中核对。');
    view.load.textContent = translate('读取状态片段配置'); view.apply.textContent = translate('应用状态片段到参数表'); view.resetChoices.textContent = translate('重置片段选择');
    view.load.disabled = !mutable(owner); view.resetChoices.disabled = !mutable(owner) || !catalog;
    view.status.dataset.status = loading ? 'loading' : catalog ? 'ready' : message ? 'error' : 'idle';
    view.status.textContent = translate(message || (catalog ? '选择尚未写入参数表；应用后仍需检查、审阅和保存。' : '读取本场景动画后，按状态配置片段。'));
    view.path.textContent = catalog?.manifest ? translate('动画来源：{0}', catalog.manifest.sourcePath) : '';
    view.apply.disabled = true; view.issues.replaceChildren();
    if (!catalog) { view.rows.replaceChildren(); view.pickers.clear(); return; }
    let result;
    try { result = review(); } catch { view.status.textContent = translate('无法检查状态片段配置，参数表保持不变。'); return; }
    const token = owner;
    for (const state of result.states) {
      let picker = view.pickers.get(state.stateKey);
      if (!picker) {
        const wrapper = node('div'), label = node('label'), caption = node('span'), select = node('select'), detail = node('p');
        wrapper.className = 'scene-behaviors-state-binding'; wrapper.dataset.stateKey = state.stateKey; detail.className = 'scene-behaviors-note';
        select.id = 'sceneBehaviorsStateBinding_' + state.stateKey; detail.id = select.id + 'Detail'; select.setAttribute('aria-describedby', detail.id);
        label.append(caption, select); wrapper.append(label, detail); view.rows.append(wrapper);
        picker = { wrapper, caption, select, detail, options: '' }; view.pickers.set(state.stateKey, picker);
        select.addEventListener('change', () => {
          if (!mutable(token) || !catalog) return;
          const previous = review();
          if (!previous.states.some(row => row.stateKey === state.stateKey) || select.value !== '' && !catalog.clips.some(clip => clip.clipId === select.value)) return;
          choices = previous.states.map(row => ({ stateKey: row.stateKey, clipId: row.stateKey === state.stateKey ? select.value : row.clipId })); refresh();
        });
      }
      picker.caption.textContent = translate('状态 {0} · {1}', state.stateKey, state.parameterName);
      const options = [['', translate('完整动画（空值）')], ...catalog.clips.map(clip => [clip.clipId,
        translate('片段 {0} · {1}–{2} 秒 · {3} · {4}', clip.name, clip.startSeconds, clip.endSeconds, translate(clip.loop ? '循环' : '不循环'), clip.clipId)])];
      if (state.clipId !== '' && !catalog.clips.some(clip => clip.clipId === state.clipId)) options.push([state.clipId, translate('不可用的当前值：{0}', state.clipId)]);
      const optionSignature = signature(options);
      if (picker.options !== optionSignature) {
        picker.select.replaceChildren(); for (const [value, label] of options) { const option = node('option', label); option.value = value; picker.select.append(option); } picker.options = optionSignature;
      }
      picker.select.value = state.clipId; picker.select.disabled = !mutable(token);
      picker.detail.textContent = state.issues.map(issue => translate(issueText[issue.code])).join(' ');
    }
    for (const issue of result.issues.filter(issue => !issue.stateKey)) view.issues.append(node('li', translate(issueText[issue.code])));
    view.apply.disabled = !mutable(token) || !result.canApply || signature(result.parameters) === signature(context.parameters);
  }
  async function read(token) {
    const request = ++generation, source = getContext().source;
    loading = true; message = '正在读取状态片段配置…'; refresh();
    const owns = () => current(token) && generation === request;
    try {
      const value = await getAnimationClips(source); if (!owns()) return;
      if (!matches(value, getContext())) throw Error('Invalid animation catalog.');
      catalog = value; choices = null; message = '';
    } catch { if (owns()) { catalog = null; choices = null; message = '无法读取状态片段配置，参数表保持不变。请重试。'; } }
    finally { if (owns()) { loading = false; refresh(); } }
  }
  async function applyChoices(token) {
    let result;
    try { result = review(); } catch { return; }
    if (!result.canApply || signature(result.parameters) === signature(getContext().parameters)) return;
    const request = ++generation, original = catalog, selection = signature(choices);
    const owns = () => current(token) && generation === request && !getContext().pending && catalog === original && signature(choices) === selection;
    loading = true; message = '正在复核已保存的动画片段…'; refresh();
    try {
      const value = await getAnimationClips(getContext().source); if (!owns()) return;
      if (!matches(value, getContext()) || signature(value) !== signature(original)) {
        catalog = null; choices = null; message = '已保存的动画已变化，请重新读取配置；参数表保持不变。'; return;
      }
      // Synchronous callback owns the only form mutation. No save or execution.
      onApply(result.parameters, { isCurrent: owns });
    } catch { if (owns()) message = '无法复核状态片段配置，参数表保持不变。请重试。'; }
    finally { if (current(token) && generation === request) { loading = false; refresh(); } }
  }
  refresh();
  return Object.freeze({ refresh, reset, dispose() { if (disposed) return; reset(); disposed = true; } });
}
