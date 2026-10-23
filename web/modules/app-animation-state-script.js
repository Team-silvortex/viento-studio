import { setupAnimationStateConditionGroup } from './app-animation-state-condition-group.js';
import { supportsStudioCoreAnimationStateConditions, supportsStudioCoreAnimationStateBranches, supportsStudioCoreAnimationStateSelectors, supportsStudioCoreAnimationStateCombinations } from '../../engine/studio-core.mjs';
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
    <label><span data-state-i18n="事件转换选择"></span><select id="${idPrefix}EventSelection" aria-describedby="${idPrefix}EventSelectionNote"><option value="unique" data-state-i18n="每个事件单一转换"></option><option value="firstMatch" data-state-i18n="按顺序匹配事件分支"></option></select></label>
    <p id="${idPrefix}EventSelectionNote" class="script-create-note"></p>
    <div id="${idPrefix}Graph"></div>
    <fieldset><legend data-state-i18n="动画状态"></legend><p class="script-create-note" data-state-i18n="状态标识须以小写字母开头，只含小写字母、数字或下划线，最多 32 个字符。"></p>
      <div id="${idPrefix}States" class="animation-state-script-rows"></div>
      <button id="${idPrefix}AddState" type="button" class="doc-btn doc-btn-ghost" data-state-i18n="添加动画状态"></button></fieldset>
    <fieldset><legend data-state-i18n="动画状态转换"></legend><p class="script-create-note" data-state-i18n="事件名以字母开头，只含字母、数字、点、下划线或连字符，最多 64 个字符。每个状态最多一条动画完成转换。"></p>
      <div id="${idPrefix}Transitions" class="animation-state-script-rows"></div>
      <button id="${idPrefix}AddTransition" type="button" class="doc-btn doc-btn-ghost" data-state-i18n="添加状态转换"></button></fieldset>
    <p id="${idPrefix}Status" class="script-create-note" role="status" aria-live="polite"></p>
  </section>`;
  const elements = new Map();
  const el = suffix => {
    if (!elements.has(suffix)) elements.set(suffix, container.querySelector('#' + idPrefix + suffix));
    return elements.get(suffix);
  };
  if (mode === 'edit') el('Note').dataset.stateI18n = '此表读取当前原文中的状态表声明。检查后审阅完整源码，再应用到草稿；保存仍在编辑器完成。';
  let eventSelection = 'unique';
  let states = [], transitions = [], stateSequence = 0, transitionSequence = 0, missingSequence = 0, formGeneration = 0, disposed = false, forcedDisabled = false;
  const missing = new Map();
  const text = (key, ...args) => translate(key, ...args);
  const writable = () => !disposed && !forcedDisabled && getContext().active === true && getContext().disabled !== true && getContext().available !== false;
  const owns = row => writable() && (states.includes(row) || transitions.includes(row));
  // Only a synchronous render shares this snapshot. Events and ownership guards
  // always inspect current input and capability markers after the render ends.
  let renderingCapabilities = null;
  function readCapabilities() {
    if (renderingCapabilities) return renderingCapabilities;
    const table = getValue(), conditions = table.transitions.map(edge => edge.trigger.condition).filter(value => value !== undefined);
    const grouped = conditions.some(condition => Object.hasOwn(condition, 'combine') || Object.hasOwn(condition, 'conditions'));
    const selected = conditions.some(condition => Object.hasOwn(condition, 'selector'));
    const groups = supportsStudioCoreAnimationStateCombinations(), selectors = supportsStudioCoreAnimationStateSelectors();
    const branches = supportsStudioCoreAnimationStateBranches(), payloads = supportsStudioCoreAnimationStateConditions();
    const ordered = el('EventSelection').value === 'firstMatch';
    return { grouped, selected, groups, selectors, branches, payloads, ordered,
      branchSupport: grouped ? groups : selected ? selectors : branches,
      payloadSupport: grouped && groups || selected && selectors || (ordered ? branches : payloads),
      selectorSupport: grouped && groups || selectors,
      graphSupport: grouped ? groups : selected ? selectors : (!ordered || branches) && (ordered || !conditions.length || payloads) };
  }
  const branchesAvailable = () => readCapabilities().branchSupport;
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
    const previousCapabilities = renderingCapabilities; renderingCapabilities = readCapabilities();
    try {
    for (const element of container.querySelectorAll('[data-state-i18n]')) element.textContent = text(element.dataset.stateI18n);
    options(el('Initial'));
    for (const row of transitions) {
      options(row.from); options(row.to);
      row.eventLabel.hidden = row.kind.value !== 'event';
      for (const item of row.kind.children) item.textContent = text(item.value === 'event' ? '收到项目事件' : '动画自然完成');
    }
    const disabled = !writable(), { ordered, branchSupport } = readCapabilities();
    el('EventSelectionNote').textContent = text(ordered ? '同一状态的同名事件按转换顺序检查，执行首个匹配分支；不匹配时继续。无条件分支只能位于该组最后。' : '同一状态的同名事件只能有一条转换；切回此模式会保留现有分支，请手动修正重复转换。');
    for (const element of container.querySelectorAll('input, select, button')) element.disabled = disabled;
    for (const option of el('EventSelection').children) option.disabled = disabled || option.value === 'firstMatch' && !branchSupport;
    for (const [index, row] of transitions.entries()) {
      row.order.textContent = text('转换顺序 {0}', index + 1);
      row.moveUp.hidden = row.moveDown.hidden = !ordered;
      row.moveUp.disabled = disabled || !ordered || !branchSupport || index === 0;
      row.moveDown.disabled = disabled || !ordered || !branchSupport || index === transitions.length - 1;
      row.moveUp.setAttribute('aria-label', text('上移转换 {0}', index + 1));
      row.moveDown.setAttribute('aria-label', text('下移转换 {0}', index + 1));
    }
    el('AddState').disabled = disabled || states.length >= 16;
    el('AddTransition').disabled = disabled || transitions.length >= 64;
    const refs = [el('Initial').value, ...transitions.flatMap(row => [row.from.value, row.to.value])];
    const unavailable = getContext().available === false;
    el('Status').textContent = unavailable ? text('当前核心不支持动画状态表；其他起始脚本仍可使用。')
      : readCapabilities().grouped && !readCapabilities().groups ? text('当前核心不支持组合条件；已有输入会保留，可明确切回单条件。')
      : !readCapabilities().grouped && readCapabilities().selected && !readCapabilities().selectors ? text('当前核心不支持项目共享状态条件；已有输入会保留，可选择事件载荷或无条件。')
      : ordered && !branchSupport ? text('当前核心不支持有序事件分支；已有输入会保留，可切回单一转换模式。')
        : refs.some(id => !states.some(row => row.id === id)) ? text('存在缺失状态，请重新选择初始状态或转换目标后生成。')
        : text('{0}/16 个状态 · {1}/64 条转换', states.length, transitions.length);
    for (const row of transitions) row.condition.refresh();
    graphView.refresh();
    } finally { renderingCapabilities = previousCapabilities; }
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
  function moveTransition(row, delta) {
    if (!owns(row) || el('EventSelection').value !== 'firstMatch' || !branchesAvailable()) return;
    const index = transitions.indexOf(row), destination = index + delta;
    if (destination < 0 || destination >= transitions.length) return;
    const focused = document.activeElement;
    transitions.splice(index, 1); transitions.splice(destination, 0, row); formGeneration++;
    // Move the existing rows, retaining condition buffers, references and listeners.
    el('Transitions').replaceChildren(...transitions.map(item => item.element));
    changed();
    if (focused && container.contains(focused)) (focused.disabled ? row.from : focused).focus({ preventScroll: true });
  }
  function addTransition(value, resolve) {
    formGeneration++;
    const index = ++transitionSequence, row = {};
    row.element = node('div', 'Transition' + index, 'animation-state-script-transition');
    const heading = node('div', 'Transition' + index + 'Heading', 'animation-state-script-transition-heading');
    row.order = node('strong', 'Transition' + index + 'Order'); heading.append(row.order);
    row.moveUp = button(heading, 'Transition' + index + 'MoveUp', '上移转换', () => moveTransition(row, -1));
    row.moveDown = button(heading, 'Transition' + index + 'MoveDown', '下移转换', () => moveTransition(row, 1));
    row.element.append(heading);
    row.from = node('select', 'Transition' + index + 'From'); label(row.element, '来自状态', row.from);
    row.to = node('select', 'Transition' + index + 'To'); label(row.element, '转到状态', row.to);
    row.kind = node('select', 'Transition' + index + 'Kind'); label(row.element, '转换触发方式', row.kind);
    for (const kind of ['event', 'completed']) { const item = node('option'); item.value = kind; row.kind.append(item); }
    row.kind.value = value.trigger.kind;
    row.event = node('input', 'Transition' + index + 'Event'); row.event.type = 'text'; row.event.maxLength = 64; row.event.spellcheck = false; row.event.value = value.trigger.name ?? '';
    row.eventLabel = label(row.element, '项目事件名', row.event);
    const conditionContainer = node('div', 'Transition' + index + 'Condition'); row.element.append(conditionContainer);
    row.condition = setupAnimationStateConditionGroup({ container: conditionContainer, idPrefix: idPrefix + 'Transition' + index + 'Condition', value: value.trigger.condition, translate,
      getContext: () => {
        const capabilities = readCapabilities();
        return { active: !disposed && transitions.includes(row) && getContext().active === true && row.kind.value === 'event', disabled: !owns(row),
          available: capabilities.payloadSupport, selectorsAvailable: capabilities.selectorSupport, combinationsAvailable: capabilities.groups };
      },
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
    eventSelection = Object.hasOwn(value, 'eventSelection') ? value.eventSelection : 'unique';
    el('EventSelection').value = eventSelection;
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
  el('EventSelection').addEventListener('change', () => {
    const selected = el('EventSelection').value;
    if (!writable() || !['unique', 'firstMatch'].includes(selected) || selected === 'firstMatch' && !branchesAvailable()) { el('EventSelection').value = eventSelection; return; }
    eventSelection = selected; formGeneration++; changed();
  });
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
  const getValue = () => ({ ...(el('EventSelection').value === 'unique' ? {} : { eventSelection: el('EventSelection').value }), initialState: keyFor(el('Initial').value), states: states.map(row => ({ key: row.key.value })), transitions: transitions.map(row => {
    const condition = row.kind.value === 'completed' ? undefined : row.condition.getValue();
    return { from: keyFor(row.from.value), to: keyFor(row.to.value), trigger: row.kind.value === 'completed' ? { kind: 'completed' }
      : { kind: row.kind.value, name: row.event.value, ...(condition === undefined ? {} : { condition }) } };
  }) });
  const graphView = setupAnimationStateGraph({ container: el('Graph'), idPrefix: idPrefix + 'Graph', getTable: getValue, translate,
    getContext: () => ({ ...getContext(), available: getContext().available !== false && readCapabilities().graphSupport,
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
