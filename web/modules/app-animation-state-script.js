import { setupAnimationStateCondition } from './app-animation-state-condition.js';
import { supportsStudioCoreAnimationStateConditions } from '../../engine/studio-core.mjs';
import { setupAnimationStateGraph } from './app-animation-state-graph.js';

// Local form only: no author files, engine execution, or draft handoff ports.
// Stable row identities keep references attached while a state key is edited.
export function setupAnimationStateScript({ container, getContext = () => ({}), onChange = () => {}, translate = value => value, idPrefix = 'animationStateScript', mode = 'create' } = {}) {
  const document = container.ownerDocument;
  container.innerHTML = `<section id="${idPrefix}Panel" class="animation-state-script" aria-labelledby="${idPrefix}Title">
    <h3 id="${idPrefix}Title" data-state-i18n="动画状态与转换"></h3>
    <p class="script-create-note" data-state-i18n="就绪时会启动初始状态，所有行为共享当前场景的动画播放头。请让一个行为负责状态切换。"></p>
    <p id="${idPrefix}Note" class="script-create-note" data-state-i18n="保存后，在场景行为的 clip_状态标识 参数中选择动画片段；留空播放完整动画。带有状态表声明且源码未手改时可重新打开表格；手改后用普通源码编辑。"></p>
    <label><span data-state-i18n="初始状态"></span><select id="${idPrefix}Initial"></select></label>
    <div id="${idPrefix}Graph"></div>
    <fieldset><legend data-state-i18n="动画状态"></legend><p class="script-create-note" data-state-i18n="状态标识须以小写字母开头，只含小写字母、数字或下划线，最多 32 个字符。"></p>
      <div id="${idPrefix}States" class="animation-state-script-rows"></div>
      <button id="${idPrefix}AddState" type="button" class="doc-btn doc-btn-ghost" data-state-i18n="添加动画状态"></button></fieldset>
    <fieldset><legend data-state-i18n="动画状态转换"></legend><p class="script-create-note" data-state-i18n="事件名以字母开头，只含字母、数字、点、下划线或连字符，最多 64 个字符。同一状态的同名事件或完成转换只能有一条。"></p>
      <div id="${idPrefix}Transitions" class="animation-state-script-rows"></div>
      <button id="${idPrefix}AddTransition" type="button" class="doc-btn doc-btn-ghost" data-state-i18n="添加状态转换"></button></fieldset>
    <p id="${idPrefix}Status" class="script-create-note" role="status" aria-live="polite"></p>
  </section>`;
  const el = suffix => container.querySelector('#' + idPrefix + suffix);
  if (mode === 'edit') el('Note').dataset.stateI18n = '此表读取当前原文中的状态表声明。检查后审阅完整源码，再应用到草稿；保存仍在编辑器完成。';
  let states = [], transitions = [], stateSequence = 0, transitionSequence = 0, missingSequence = 0, formGeneration = 0, disposed = false, forcedDisabled = false;
  const missing = new Map();
  const text = (key, ...args) => translate(key, ...args);
  const writable = () => !disposed && !forcedDisabled && getContext().active === true && getContext().disabled !== true && getContext().available !== false;
  const owns = row => writable() && (states.includes(row) || transitions.includes(row));
  function node(tag, id, className) {
    const element = document.createElement(tag);
    if (id) element.id = idPrefix + id;
    if (className) element.className = className;
    return element;
  }
  function label(parent, key, control) {
    const wrapper = node('label'), caption = node('span'); caption.dataset.stateI18n = key;
    wrapper.append(caption, control); parent.append(wrapper); return wrapper;
  }
  function button(parent, id, key, action) {
    const element = node('button', id, 'doc-btn doc-btn-ghost'); element.type = 'button'; element.dataset.stateI18n = key;
    element.addEventListener('click', action); parent.append(element); return element;
  }
  function rememberMissing(key) { const id = 'missing-' + (++missingSequence); missing.set(id, key); return id; }
  const keyFor = id => states.find(row => row.id === id)?.key.value ?? '';
  function options(select) {
    const selected = select.value;
    select.replaceChildren();
    const option = (value, caption, key) => { const item = node('option'); item.value = value; item.textContent = caption; item.dataset.stateKey = key; select.append(item); };
    option('', text('选择动画状态'), '');
    for (const row of states) option(row.id, row.key.value || text('未填写状态标识'), row.key.value);
    if (selected && !states.some(row => row.id === selected)) option(selected, text('缺失状态：{0}', missing.get(selected) || ''), '');
    select.value = selected;
    select.setAttribute('aria-invalid', String(!selected || !states.some(row => row.id === selected)));
  }
  function refresh() {
    if (disposed) return;
    for (const element of container.querySelectorAll('[data-state-i18n]')) element.textContent = text(element.dataset.stateI18n);
    options(el('Initial'));
    for (const row of transitions) {
      options(row.from); options(row.to);
      row.eventLabel.hidden = row.kind.value !== 'event';
      for (const item of row.kind.children) item.textContent = text(item.value === 'event' ? '收到项目事件' : '动画自然完成');
    }
    const disabled = !writable();
    for (const element of container.querySelectorAll('input, select, button')) element.disabled = disabled;
    el('AddState').disabled = disabled || states.length >= 16;
    el('AddTransition').disabled = disabled || transitions.length >= 64;
    const refs = [el('Initial').value, ...transitions.flatMap(row => [row.from.value, row.to.value])];
    const unavailable = getContext().available === false;
    el('Status').textContent = unavailable ? text('当前核心不支持动画状态表；其他起始脚本仍可使用。')
      : refs.some(id => !states.some(row => row.id === id)) ? text('存在缺失状态，请重新选择初始状态或转换目标后生成。')
        : text('{0}/16 个状态 · {1}/64 条转换', states.length, transitions.length);
    for (const row of transitions) row.condition.refresh();
    graphView.refresh();
  }
  function changed() { refresh(); onChange(); }
  function addState(key) {
    formGeneration++;
    const index = ++stateSequence, row = { id: 'state-' + index };
    row.element = node('div', 'State' + index, 'animation-state-script-state');
    row.key = node('input', 'State' + index + 'Key'); row.key.type = 'text'; row.key.maxLength = 32; row.key.spellcheck = false; row.key.value = key;
    label(row.element, '状态标识', row.key);
    row.remove = button(row.element, 'State' + index + 'Remove', '移除状态', () => {
      if (!owns(row)) return;
      formGeneration++; missing.set(row.id, row.key.value); states = states.filter(item => item !== row); row.element.remove(); changed();
    });
    row.key.addEventListener('input', () => { if (owns(row)) changed(); });
    states.push(row); el('States').append(row.element); return row;
  }
  function addTransition(value, resolve) {
    formGeneration++;
    const index = ++transitionSequence, row = {};
    row.element = node('div', 'Transition' + index, 'animation-state-script-transition');
    row.from = node('select', 'Transition' + index + 'From'); label(row.element, '来自状态', row.from);
    row.to = node('select', 'Transition' + index + 'To'); label(row.element, '转到状态', row.to);
    row.kind = node('select', 'Transition' + index + 'Kind'); label(row.element, '转换触发方式', row.kind);
    for (const kind of ['event', 'completed']) { const item = node('option'); item.value = kind; row.kind.append(item); }
    row.kind.value = value.trigger.kind;
    row.event = node('input', 'Transition' + index + 'Event'); row.event.type = 'text'; row.event.maxLength = 64; row.event.spellcheck = false; row.event.value = value.trigger.name ?? '';
    row.eventLabel = label(row.element, '项目事件名', row.event);
    const conditionContainer = node('div', 'Transition' + index + 'Condition'); row.element.append(conditionContainer);
    row.condition = setupAnimationStateCondition({ container: conditionContainer, idPrefix: idPrefix + 'Transition' + index + 'Condition', value: value.trigger.condition, translate,
      getContext: () => ({ active: !disposed && transitions.includes(row) && getContext().active === true && row.kind.value === 'event', disabled: !owns(row), available: supportsStudioCoreAnimationStateConditions() }),
      onChange: () => { if (owns(row) && row.kind.value === 'event') changed(); },
    });
    row.remove = button(row.element, 'Transition' + index + 'Remove', '移除转换', () => {
      if (!owns(row)) return;
      row.condition.dispose(); formGeneration++; transitions = transitions.filter(item => item !== row); row.element.remove(); changed();
    });
    // Populate before assigning: native selects cannot retain a missing option.
    options(row.from); options(row.to);
    for (const [select, key] of [[row.from, value.from], [row.to, value.to]]) {
      const id = resolve(key);
      if (!states.some(item => item.id === id)) { const item = node('option'); item.value = id; select.append(item); }
      select.value = id;
    }
    for (const control of [row.from, row.to, row.kind]) control.addEventListener('change', () => { if (owns(row)) changed(); });
    row.event.addEventListener('input', () => { if (owns(row)) changed(); });
    transitions.push(row); el('Transitions').append(row.element); return row;
  }
  function setValue(value) {
    if (disposed) return;
    for (const row of transitions) row.condition.dispose();
    formGeneration++; states = []; transitions = []; stateSequence = 0; transitionSequence = 0; missing.clear();
    el('States').replaceChildren(); el('Transitions').replaceChildren();
    for (const item of value.states) addState(item.key);
    const resolve = key => states.find(row => row.key.value === key)?.id ?? rememberMissing(key);
    const initial = resolve(value.initialState);
    el('Initial').value = ''; options(el('Initial'));
    if (!states.some(row => row.id === initial)) { const item = node('option'); item.value = initial; el('Initial').append(item); }
    el('Initial').value = initial;
    for (const item of value.transitions) addTransition(item, resolve);
    refresh();
  }
  el('Initial').addEventListener('change', () => { if (writable()) changed(); });
  el('AddState').addEventListener('click', () => {
    if (!writable() || states.length >= 16) return;
    let number = 1; while (states.some(row => row.key.value === 'state_' + number)) number++;
    const row = addState('state_' + number); changed(); row.key.focus();
  });
  el('AddTransition').addEventListener('click', () => {
    if (!writable() || transitions.length >= 64) return;
    const row = addTransition({ from: '', to: '', trigger: { kind: 'event', name: '' } }, () => '');
    changed(); row.from.focus();
  });
  const getValue = () => ({ initialState: keyFor(el('Initial').value), states: states.map(row => ({ key: row.key.value })), transitions: transitions.map(row => ({
    from: keyFor(row.from.value), to: keyFor(row.to.value), trigger: row.kind.value === 'completed' ? { kind: 'completed' } : { kind: row.kind.value, name: row.event.value, ...(row.condition.getValue() === undefined ? {} : { condition: row.condition.getValue() }) },
  })) });
  const graphView = setupAnimationStateGraph({ container: el('Graph'), idPrefix: idPrefix + 'Graph', getTable: getValue, translate,
    getContext: () => ({ ...getContext(), available: getContext().available !== false && (!getValue().transitions.some(edge => Object.hasOwn(edge.trigger, 'condition')) || supportsStudioCoreAnimationStateConditions()),
      disabled: forcedDisabled || getContext().disabled === true, generation: formGeneration }),
    onLocate({ kind, index }, { isCurrent }) {
      const row = kind === 'state' ? states[index] : kind === 'transition' ? transitions[index] : null;
      if (!row || !isCurrent() || !owns(row)) return false;
      const control = kind === 'state' ? row.key : row.from;
      control.focus({ preventScroll: true }); control.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); return true;
    },
  });
  return Object.freeze({
    getValue, setValue, reset: setValue, refresh,
    setDisabled(value) { forcedDisabled = value === true; refresh(); },
    dispose() { if (disposed) return; disposed = true; graphView.dispose(); for (const row of transitions) row.condition.dispose(); states = []; transitions = []; container.replaceChildren(); },
  });
}
