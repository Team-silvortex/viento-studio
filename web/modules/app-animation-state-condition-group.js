import { setupAnimationStateCondition } from './app-animation-state-condition.js';

// A flat local editor: scalar children keep their own source/type buffers.
// Source review, draft ownership and runtime evaluation remain with the hosts.
export function setupAnimationStateConditionGroup({ container, getContext = () => ({}), onChange = () => {}, translate = value => value, idPrefix = 'animationStateCondition', value } = {}) {
  const document = container.ownerDocument;
  if (!document.getElementById('animationStateConditionGroupStyle')) {
    const style = document.createElement('link'); style.id = 'animationStateConditionGroupStyle'; style.rel = 'stylesheet'; style.href = '/web/animation-state-condition-group.css';
    (document.head || document.body).append(style);
  }
  container.className = 'animation-state-condition-group';
  container.innerHTML = `<label><span data-condition-group-i18n="条件组合方式"></span><select id="${idPrefix}Combination"><option value="single" data-condition-group-i18n="单条件"></option><option value="all" data-condition-group-i18n="全部满足"></option><option value="any" data-condition-group-i18n="任一满足"></option></select></label>
    <p class="script-create-note" data-condition-group-i18n="单条件和组合分别保留输入；切换不会自动合并或选择组合中的某一项。"></p>
    <p id="${idPrefix}SingleNote" class="script-create-note" hidden data-condition-group-i18n="此表原来使用组合条件。首次切回单条件从无条件开始，请明确设置；原组合输入仍然保留。"></p>
    <div id="${idPrefix}Single"></div>
    <div id="${idPrefix}Group" hidden><p id="${idPrefix}GroupNote" class="script-create-note"></p>
      <div id="${idPrefix}Items" class="animation-state-condition-group-items"></div>
      <button id="${idPrefix}AddItem" type="button" class="doc-btn doc-btn-ghost" data-condition-group-i18n="添加条件"></button></div>
    <p id="${idPrefix}GroupStatus" class="script-create-note" role="status" aria-live="polite"></p>`;
  const elements = new Map();
  const el = suffix => {
    if (!elements.has(suffix)) elements.set(suffix, container.querySelector('#' + idPrefix + suffix));
    return elements.get(suffix);
  };
  const text = (key, ...args) => translate(key, ...args);
  let renderingContext = null;
  const readContext = () => renderingContext || getContext();
  let disposed = false, combination = 'single', initializedGroup = false, copiedSingle = false, singleFromGroup = false, sequence = 0, rows = [];
  const editable = () => !disposed && readContext().active === true && readContext().disabled !== true;
  const groupWritable = () => editable() && el('Combination').value !== 'single' && readContext().combinationsAvailable === true;
  const owns = row => groupWritable() && rows.includes(row);
  const single = setupAnimationStateCondition({ container: el('Single'), idPrefix, translate,
    getContext: () => ({ ...readContext(), active: !disposed && readContext().active === true && el('Combination').value === 'single' }),
    onChange: () => { if (editable() && el('Combination').value === 'single') changed(); },
  });
  function node(tag, id, className) {
    const element = document.createElement(tag); if (id) element.id = idPrefix + id; if (className) element.className = className; return element;
  }
  function button(parent, id, key, action) {
    const element = node('button', id, 'doc-btn doc-btn-ghost'); element.type = 'button'; element.dataset.conditionGroupI18n = key; element.addEventListener('click', action); parent.append(element); return element;
  }
  function changed() { refresh(); onChange(); }
  function move(row, delta) {
    if (!owns(row)) return;
    const index = rows.indexOf(row), target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const focused = document.activeElement;
    rows.splice(index, 1); rows.splice(target, 0, row); el('Items').replaceChildren(...rows.map(item => item.element)); changed();
    if (focused && container.contains(focused)) (focused.disabled ? row.element.querySelector('select') : focused).focus({ preventScroll: true });
  }
  function remove(row) {
    if (!owns(row)) return;
    const index = rows.indexOf(row); rows.splice(index, 1); row.editor.dispose(); row.element.remove(); changed();
    (rows[Math.min(index, rows.length - 1)]?.element.querySelector('select') || el('AddItem')).focus({ preventScroll: true });
  }
  function add(condition) {
    const id = ++sequence, row = {};
    row.element = node('section', 'Item' + id + 'Row', 'animation-state-condition-group-item'); row.element.dataset.itemId = String(id);
    const heading = node('div', 'Item' + id + 'Heading', 'animation-state-condition-group-heading');
    row.order = node('strong', 'Item' + id + 'Order'); heading.append(row.order);
    row.up = button(heading, 'Item' + id + 'MoveUp', '上移条件', () => move(row, -1));
    row.down = button(heading, 'Item' + id + 'MoveDown', '下移条件', () => move(row, 1));
    row.remove = button(heading, 'Item' + id + 'Remove', '移除条件', () => remove(row)); row.element.append(heading);
    const fields = node('div', 'Item' + id + 'Fields'); row.element.append(fields);
    row.editor = setupAnimationStateCondition({ container: fields, idPrefix: idPrefix + 'Item' + id, translate, allowNone: false, value: condition,
      getContext: () => ({ active: !disposed && rows.includes(row) && readContext().active === true && el('Combination').value !== 'single',
        disabled: !owns(row), available: readContext().combinationsAvailable === true, selectorsAvailable: readContext().combinationsAvailable === true }),
      onChange: () => { if (owns(row)) changed(); },
    });
    rows.push(row); el('Items').append(row.element); return row;
  }
  const getValue = () => el('Combination').value === 'single' ? single.getValue()
    : { combine: el('Combination').value, conditions: rows.map(row => row.editor.getValue()) };
  function refresh() {
    if (disposed) return;
    const context = readContext(), previousContext = renderingContext; renderingContext = context;
    try {
    const current = el('Combination').value, grouped = current !== 'single';
    container.hidden = context.active !== true;
    for (const element of container.querySelectorAll('[data-condition-group-i18n]')) element.textContent = text(element.dataset.conditionGroupI18n);
    el('Combination').disabled = !editable();
    for (const option of el('Combination').children) option.disabled = option.value !== 'single' && context.combinationsAvailable !== true;
    el('Single').hidden = grouped; el('SingleNote').hidden = grouped || !singleFromGroup; el('Group').hidden = !grouped;
    el('GroupNote').textContent = text(copiedSingle
      ? '首次切换时已把单条件输入复制为第 1 项；之后两套输入独立保留。每组最多 8 项，不支持嵌套。'
      : '每组最多 8 项，不支持嵌套。全部满足要求每项都匹配；任一满足要求至少一项匹配。');
    el('AddItem').disabled = !groupWritable() || rows.length >= 8;
    for (const [index, row] of rows.entries()) {
      row.order.textContent = text('条件 {0}', index + 1);
      row.up.disabled = !owns(row) || index === 0; row.down.disabled = !owns(row) || index === rows.length - 1; row.remove.disabled = !owns(row);
      row.up.setAttribute('aria-label', text('上移条件 {0}', index + 1)); row.down.setAttribute('aria-label', text('下移条件 {0}', index + 1)); row.remove.setAttribute('aria-label', text('移除条件 {0}', index + 1));
      row.editor.refresh();
    }
    single.refresh();
    el('GroupStatus').textContent = text(!['single', 'all', 'any'].includes(current) ? '请选择有效的条件组合方式。'
      : grouped && context.combinationsAvailable !== true ? '当前核心不支持组合条件；已有输入会保留，可明确切回单条件。'
        : grouped && !rows.length ? '组合至少需要 1 项条件；空组合不能生成脚本。'
          : grouped ? '{0}/8 项条件' : '', rows.length);
    } finally { renderingContext = previousContext; }
  }
  function setValue(condition) {
    if (disposed) return;
    for (const row of rows) row.editor.dispose(); rows = []; el('Items').replaceChildren();
    const grouped = condition && (Object.hasOwn(condition, 'combine') || Object.hasOwn(condition, 'conditions'));
    combination = grouped ? condition.combine : 'single'; el('Combination').value = combination;
    initializedGroup = Boolean(grouped); copiedSingle = false; singleFromGroup = Boolean(grouped); single.setValue(grouped ? undefined : condition);
    if (grouped && Array.isArray(condition.conditions)) for (const item of condition.conditions) add(item);
  }
  el('Combination').addEventListener('change', () => {
    if (disposed) return;
    const next = el('Combination').value;
    if (!editable()) { el('Combination').value = combination; refresh(); return; }
    if (!['single', 'all', 'any'].includes(next)) { combination = next; changed(); return; }
    if (next !== 'single' && readContext().combinationsAvailable !== true) { el('Combination').value = combination; refresh(); return; }
    if (next !== 'single' && !initializedGroup) {
      initializedGroup = true; const condition = single.getValue();
      if (condition !== undefined) { add(condition); copiedSingle = true; }
    }
    combination = next; changed();
  });
  el('AddItem').addEventListener('click', () => {
    if (!groupWritable() || rows.length >= 8) return;
    const row = add({ type: 'string', operator: 'eq', value: '' }); changed(); row.element.querySelector('select').focus();
  });
  // Parent session ownership is not initialized until construction completes.
  setValue(value);
  return Object.freeze({ getValue, setValue, refresh, dispose() {
    if (disposed) return; disposed = true; single.dispose(); for (const row of rows) row.editor.dispose(); rows = []; container.replaceChildren();
  } });
}
