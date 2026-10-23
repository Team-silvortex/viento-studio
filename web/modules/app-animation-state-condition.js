// Per-transition local condition input. It owns typed input buffers but cannot
// edit a table, write a draft, execute an event or approve generated source.
export function setupAnimationStateCondition({ container, getContext = () => ({}), onChange = () => {}, translate = value => value, idPrefix = 'animationStateCondition', value, allowNone = true } = {}) {
  const document = container.ownerDocument;
  if (!document.getElementById('animationStateConditionStyle')) {
    const style = document.createElement('link'); style.id = 'animationStateConditionStyle'; style.rel = 'stylesheet'; style.href = '/web/animation-state-condition.css';
    (document.head || document.body).append(style);
  }
  container.className = 'animation-state-condition';
  container.innerHTML = `<label><span data-condition-i18n="条件来源"></span><select id="${idPrefix}Mode"><option value="none" data-condition-i18n="无条件"></option><option value="compare" data-condition-i18n="事件载荷"></option><option value="shared" data-condition-i18n="项目共享状态"></option></select></label>
    <div id="${idPrefix}Fields" class="animation-state-condition-fields" hidden><label id="${idPrefix}KeyLabel" class="animation-state-condition-key" hidden><span data-condition-i18n="共享状态键"></span><input id="${idPrefix}Key" type="text" maxlength="64" spellcheck="false" aria-describedby="${idPrefix}KeyHint"></label><p id="${idPrefix}KeyHint" class="script-create-note" hidden data-condition-i18n="状态键以字母开头，只含字母、数字、点、下划线或连字符，最多 64 个字符；不能使用 constructor、prototype 或 __proto__。"></p><label><span data-condition-i18n="值类型"></span><select id="${idPrefix}Type"><option value="string" data-condition-i18n="字符串（string）"></option><option value="number" data-condition-i18n="数字（number）"></option><option value="boolean" data-condition-i18n="布尔值（boolean）"></option></select></label>
      <label><span data-condition-i18n="比较方式"></span><select id="${idPrefix}Operator"><option value="eq" data-condition-i18n="等于"></option><option value="ne" data-condition-i18n="不等于"></option><option value="lt" data-condition-i18n="小于"></option><option value="lte" data-condition-i18n="小于或等于"></option><option value="gt" data-condition-i18n="大于"></option><option value="gte" data-condition-i18n="大于或等于"></option></select></label>
      <label id="${idPrefix}StringLabel" class="animation-state-condition-value"><span data-condition-i18n="比较值"></span><textarea id="${idPrefix}String" rows="2" maxlength="4096" spellcheck="false"></textarea></label>
      <label id="${idPrefix}NumberLabel" class="animation-state-condition-value" hidden><span data-condition-i18n="比较值"></span><input id="${idPrefix}Number" type="text" inputmode="decimal" spellcheck="false"></label>
      <label id="${idPrefix}BooleanLabel" class="animation-state-condition-value" hidden><span data-condition-i18n="比较值"></span><select id="${idPrefix}Boolean"><option value="false">false</option><option value="true">true</option></select></label>
      <p id="${idPrefix}Note" class="script-create-note"></p></div>
    <p id="${idPrefix}Status" class="script-create-note" role="status" aria-live="polite"></p>`;
  const elements = new Map();
  const el = suffix => {
    if (!elements.has(suffix)) elements.set(suffix, container.querySelector('#' + idPrefix + suffix));
    return elements.get(suffix);
  };
  let disposed = false, rawString = '', displayedString = '', mode = 'none', displayedMode = 'compare';
  const buffers = new Map();
  const editable = () => { if (disposed) return false; const context = getContext(); return context.active === true && context.disabled !== true; };
  const available = (value, context = getContext()) => value === 'none' && allowNone || (value === 'shared' ? context.selectorsAvailable === true : value === 'compare' && context.available === true);
  const writable = () => editable() && available(el('Mode').value);
  function capture() {
    buffers.set(displayedMode, { type: el('Type').value, operator: el('Operator').value, rawString, displayedString,
      string: el('String').value, number: el('Number').value, boolean: el('Boolean').value, key: el('Key').value });
  }
  function restore(value) {
    const buffer = buffers.get(value) || { type: 'string', operator: 'eq', rawString: '', string: '', number: '', boolean: 'false', key: '' };
    displayedMode = value; el('Type').value = buffer.type; el('Operator').value = buffer.operator;
    rawString = buffer.rawString; el('String').value = buffer.string; displayedString = buffer.displayedString ?? el('String').value;
    el('Number').value = buffer.number; el('Boolean').value = buffer.boolean; el('Key').value = buffer.key;
  }
  function numberValue() {
    const raw = el('Number').value;
    const matched = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.exec(raw);
    const number = matched?.[0] === raw ? Number(raw) : NaN;
    return Number.isFinite(number) && Math.abs(number) <= 1e9 ? number : raw;
  }
  function getValue() {
    if (el('Mode').value === 'none' && allowNone) return undefined;
    const type = el('Type').value;
    const value = type === 'number' ? numberValue() : type === 'boolean' ? el('Boolean').value === 'true' ? true : el('Boolean').value === 'false' ? false : el('Boolean').value
      : el('String').value === displayedString ? rawString : el('String').value;
    return { type: ['compare', 'shared'].includes(el('Mode').value) ? type : '', operator: el('Operator').value, value, ...(el('Mode').value === 'shared' ? { selector: { kind: 'projectState', key: el('Key').value } } : {}) };
  }
  const signature = () => JSON.stringify(getValue());
  let observed;
  function refresh() {
    if (disposed) return;
    const context = getContext(), enabled = writable(), current = getValue();
    for (const element of container.querySelectorAll('[data-condition-i18n]')) element.textContent = translate(element.dataset.conditionI18n);
    container.hidden = context.active !== true;
    for (const element of container.querySelectorAll('input, select, textarea')) element.disabled = !enabled;
    el('Mode').disabled = !editable();
    for (const option of el('Mode').children) { option.disabled = !available(option.value, context); option.hidden = option.value === 'none' && !allowNone; }
    const shared = el('Mode').value === 'shared';
    el('KeyLabel').hidden = el('KeyHint').hidden = !shared;
    el('Note').textContent = translate(shared
      ? '收到事件时比较指定的项目共享状态；状态键缺失或类型不同时不触发（包括不等于）。状态改变本身不触发转换。数字精确比较，不使用误差容限。'
      : '按所选类型比较事件载荷，类型不同时不触发（包括不等于）。数字精确比较，不使用误差容限。');
    el('Fields').hidden = !current;
    for (const type of ['String', 'Number', 'Boolean']) el(type + 'Label').hidden = el('Type').value !== type.toLowerCase();
    for (const option of el('Operator').children) option.disabled = el('Type').value !== 'number' && !['eq', 'ne'].includes(option.value);
    const badKey = shared && (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(el('Key').value) || ['constructor', 'prototype', '__proto__'].includes(el('Key').value));
    const badNumber = current?.type === 'number' && typeof current.value !== 'number';
    const badOperator = current && current.type !== 'number' && !['eq', 'ne'].includes(current.operator);
    const tooLong = current?.type === 'string' && new TextEncoder().encode(current.value).length > 4096;
    el('Key').setAttribute('aria-invalid', String(badKey));
    el('Number').setAttribute('aria-invalid', String(badNumber)); el('Operator').setAttribute('aria-invalid', String(Boolean(badOperator))); el('String').setAttribute('aria-invalid', String(tooLong));
    const message = !['none', 'compare', 'shared'].includes(el('Mode').value) ? '请选择有效的条件来源。'
      : !available(el('Mode').value, context) ? shared
      ? '当前核心不支持项目共享状态条件；已有输入会保留，可选择事件载荷或无条件。'
      : '当前核心不支持事件载荷条件；无条件转换仍可编辑，已有条件会保留。'
      : badKey ? '请输入有效的共享状态键；输入会原样保留，不会自动删除空格。'
      : badNumber ? '请输入有限数字，绝对值不超过 1,000,000,000；空白和未完成数字不是零。'
        : badOperator ? '字符串和布尔值仅支持等于或不等于；请明确选择比较方式。'
          : tooLong ? '条件字符串的 UTF-8 长度不能超过 4096 字节。' : '';
    el('Status').textContent = translate(message);
  }
  function changed(force = false) {
    if (!writable()) return;
    const next = signature(), differs = next !== observed; observed = next; refresh(); if (differs || force === true) onChange();
  }
  function setValue(condition) {
    if (disposed) return;
    buffers.clear(); mode = condition === undefined ? 'none' : Object.hasOwn(condition, 'selector') ? 'shared' : 'compare'; displayedMode = mode === 'shared' ? 'shared' : 'compare';
    el('Mode').value = mode; el('Key').value = condition?.selector?.key ?? ''; el('Type').value = condition?.type || 'string'; el('Operator').value = condition?.operator || 'eq';
    rawString = condition?.type === 'string' ? condition.value : ''; el('String').value = rawString; displayedString = el('String').value;
    el('Number').value = condition?.type === 'number' ? String(condition.value) : ''; el('Boolean').value = condition?.type === 'boolean' ? String(condition.value) : 'false';
    observed = signature();
  }
  el('Mode').addEventListener('change', () => {
    if (disposed) return;
    const next = el('Mode').value;
    if (!editable() || !['none', 'compare', 'shared'].includes(next) || !available(next)) { el('Mode').value = mode; refresh(); return; }
    if (next !== 'none' && next !== displayedMode) { capture(); restore(next); }
    mode = next; changed(true);
  });
  for (const suffix of ['Type', 'Operator', 'Boolean']) el(suffix).addEventListener('change', changed);
  for (const suffix of ['String', 'Number', 'Key']) el(suffix).addEventListener('input', changed);
  // Construction must not ask the parent for session guards before it exists.
  setValue(value);
  return Object.freeze({ getValue, setValue, refresh, dispose() { if (disposed) return; disposed = true; container.replaceChildren(); } });
}
