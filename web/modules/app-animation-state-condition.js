// Per-transition local condition input. It owns typed input buffers but cannot
// edit a table, write a draft, execute an event or approve generated source.
export function setupAnimationStateCondition({ container, getContext = () => ({}), onChange = () => {}, translate = value => value, idPrefix = 'animationStateCondition', value } = {}) {
  const document = container.ownerDocument;
  if (!document.getElementById('animationStateConditionStyle')) {
    const style = document.createElement('link'); style.id = 'animationStateConditionStyle'; style.rel = 'stylesheet'; style.href = '/web/animation-state-condition.css';
    (document.head || document.body).append(style);
  }
  container.className = 'animation-state-condition';
  container.innerHTML = `<label><span data-condition-i18n="事件载荷条件"></span><select id="${idPrefix}Mode"><option value="none" data-condition-i18n="无条件"></option><option value="compare" data-condition-i18n="比较事件载荷"></option></select></label>
    <div id="${idPrefix}Fields" class="animation-state-condition-fields" hidden><label><span data-condition-i18n="值类型"></span><select id="${idPrefix}Type"><option value="string" data-condition-i18n="字符串（string）"></option><option value="number" data-condition-i18n="数字（number）"></option><option value="boolean" data-condition-i18n="布尔值（boolean）"></option></select></label>
      <label><span data-condition-i18n="比较方式"></span><select id="${idPrefix}Operator"><option value="eq" data-condition-i18n="等于"></option><option value="ne" data-condition-i18n="不等于"></option><option value="lt" data-condition-i18n="小于"></option><option value="lte" data-condition-i18n="小于或等于"></option><option value="gt" data-condition-i18n="大于"></option><option value="gte" data-condition-i18n="大于或等于"></option></select></label>
      <label id="${idPrefix}StringLabel" class="animation-state-condition-value"><span data-condition-i18n="比较值"></span><textarea id="${idPrefix}String" rows="2" maxlength="4096" spellcheck="false"></textarea></label>
      <label id="${idPrefix}NumberLabel" class="animation-state-condition-value" hidden><span data-condition-i18n="比较值"></span><input id="${idPrefix}Number" type="text" inputmode="decimal" spellcheck="false"></label>
      <label id="${idPrefix}BooleanLabel" class="animation-state-condition-value" hidden><span data-condition-i18n="比较值"></span><select id="${idPrefix}Boolean"><option value="false">false</option><option value="true">true</option></select></label>
      <p class="script-create-note" data-condition-i18n="按所选类型比较事件载荷，类型不同时不触发（包括不等于）。数字精确比较，不使用误差容限。"></p></div>
    <p id="${idPrefix}Status" class="script-create-note" role="status" aria-live="polite"></p>`;
  const el = suffix => container.querySelector('#' + idPrefix + suffix);
  let disposed = false, rawString = '', displayedString = '';
  const writable = () => { if (disposed) return false; const context = getContext(); return context.active === true && context.available === true && context.disabled !== true; };
  function numberValue() {
    const raw = el('Number').value;
    const matched = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.exec(raw);
    const number = matched?.[0] === raw ? Number(raw) : NaN;
    return Number.isFinite(number) && Math.abs(number) <= 1e9 ? number : raw;
  }
  function getValue() {
    if (el('Mode').value === 'none') return undefined;
    const type = el('Type').value;
    const value = type === 'number' ? numberValue() : type === 'boolean' ? el('Boolean').value === 'true' ? true : el('Boolean').value === 'false' ? false : el('Boolean').value
      : el('String').value === displayedString ? rawString : el('String').value;
    return { type, operator: el('Operator').value, value };
  }
  const signature = () => JSON.stringify(getValue());
  let observed;
  function refresh() {
    if (disposed) return;
    const context = getContext(), enabled = writable(), current = getValue();
    for (const element of container.querySelectorAll('[data-condition-i18n]')) element.textContent = translate(element.dataset.conditionI18n);
    container.hidden = context.active !== true;
    for (const element of container.querySelectorAll('input, select, textarea')) element.disabled = !enabled;
    el('Fields').hidden = !current;
    for (const type of ['String', 'Number', 'Boolean']) el(type + 'Label').hidden = el('Type').value !== type.toLowerCase();
    for (const option of el('Operator').children) option.disabled = el('Type').value !== 'number' && !['eq', 'ne'].includes(option.value);
    const badNumber = current?.type === 'number' && typeof current.value !== 'number';
    const badOperator = current && current.type !== 'number' && !['eq', 'ne'].includes(current.operator);
    const tooLong = current?.type === 'string' && new TextEncoder().encode(current.value).length > 4096;
    el('Number').setAttribute('aria-invalid', String(badNumber)); el('Operator').setAttribute('aria-invalid', String(Boolean(badOperator))); el('String').setAttribute('aria-invalid', String(tooLong));
    const message = context.available !== true ? '当前核心不支持事件载荷条件；无条件转换仍可编辑，已有条件会保留。'
      : badNumber ? '请输入有限数字，绝对值不超过 1,000,000,000；空白和未完成数字不是零。'
        : badOperator ? '字符串和布尔值仅支持等于或不等于；请明确选择比较方式。'
          : tooLong ? '条件字符串的 UTF-8 长度不能超过 4096 字节。' : '';
    el('Status').textContent = translate(message);
  }
  function changed() {
    if (!writable()) return;
    const next = signature(), differs = next !== observed; observed = next; refresh(); if (differs) onChange();
  }
  function setValue(condition) {
    if (disposed) return;
    el('Mode').value = condition === undefined ? 'none' : 'compare'; el('Type').value = condition?.type || 'string'; el('Operator').value = condition?.operator || 'eq';
    rawString = condition?.type === 'string' ? condition.value : ''; el('String').value = rawString; displayedString = el('String').value;
    el('Number').value = condition?.type === 'number' ? String(condition.value) : ''; el('Boolean').value = condition?.type === 'boolean' ? String(condition.value) : 'false';
    observed = signature();
  }
  for (const suffix of ['Mode', 'Type', 'Operator', 'Boolean']) el(suffix).addEventListener('change', changed);
  for (const suffix of ['String', 'Number']) el(suffix).addEventListener('input', changed);
  // Construction must not ask the parent for session guards before it exists.
  setValue(value);
  return Object.freeze({ getValue, setValue, refresh, dispose() { if (disposed) return; disposed = true; container.replaceChildren(); } });
}
