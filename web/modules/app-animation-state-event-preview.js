import { setupAnimationStateTrialCase } from './app-animation-state-trial-case.js';
import { animationStateEventPreviewKeys } from '../../engine/animation-state-event-preview.mjs';
import { createAnimationStateTrialSequence, previewAnimationStateTrialStep, appendAnimationStateTrialStep, truncateAnimationStateTrialSequence, ANIMATION_STATE_TRIAL_LIMITS } from '../../engine/animation-state-trial-sequence.mjs';
import { supportsStudioCoreAnimationStateConditions } from '../../engine/studio-core.mjs';

// Local, fixed manual samples only. This view cannot change the author table,
// approve source, publish an event, read live shared state or execute a script.
export function setupAnimationStateEventPreview({ container, getTable, getContext = () => ({}), onLocate = () => false, translate = value => value, idPrefix = 'animationStateEventPreview' } = {}) {
  const document = container.ownerDocument;
  if (!document.getElementById('animationStateEventPreviewStyle')) {
    const style = document.createElement('link'); style.id = 'animationStateEventPreviewStyle'; style.rel = 'stylesheet'; style.href = '/web/animation-state-event-preview.css';
    (document.head || document.body).append(style);
  }
  container.innerHTML = `<section class="animation-state-event-preview" aria-labelledby="${idPrefix}Toggle">
    <button id="${idPrefix}Toggle" type="button" class="doc-btn doc-btn-ghost" aria-expanded="false" aria-controls="${idPrefix}Body"></button>
    <div id="${idPrefix}Body" hidden><p id="${idPrefix}Note" class="script-create-note"></p>
      <div id="${idPrefix}Samples" class="animation-state-event-preview-samples">
        <label><span id="${idPrefix}TriggerKindLabel"></span><select id="${idPrefix}TriggerKind"><option value="event"></option><option value="completed"></option></select></label>
        <label><span id="${idPrefix}CurrentStateLabel"></span><select id="${idPrefix}CurrentState"></select></label>
        <label id="${idPrefix}EventFields"><span id="${idPrefix}EventNameLabel"></span><input id="${idPrefix}EventName" type="text" maxlength="64" list="${idPrefix}EventNames" autocomplete="off"><datalist id="${idPrefix}EventNames"></datalist></label>
        <div id="${idPrefix}Payload" class="animation-state-event-preview-payload"></div>
      </div><p id="${idPrefix}CompletionNote" class="script-create-note" hidden></p><section id="${idPrefix}SharedSection"><h4 id="${idPrefix}SharedTitle"></h4><p id="${idPrefix}SharedNote" class="script-create-note"></p>
      <div id="${idPrefix}SharedStates" class="animation-state-event-preview-shared"></div><p id="${idPrefix}SharedEmpty" class="script-create-note"></p></section>
      <button id="${idPrefix}Run" type="button" class="doc-btn"></button><p id="${idPrefix}Status" role="status" aria-live="polite"></p>
      <section id="${idPrefix}Result" hidden aria-labelledby="${idPrefix}ResultTitle"><h4 id="${idPrefix}ResultTitle"></h4><p id="${idPrefix}Summary"></p><ol id="${idPrefix}Candidates"></ol><button id="${idPrefix}Adopt" type="button" class="doc-btn"></button></section>
      <section id="${idPrefix}History" aria-labelledby="${idPrefix}HistoryTitle"><h4 id="${idPrefix}HistoryTitle"></h4><p id="${idPrefix}HistorySummary" class="script-create-note"></p>
        <div class="animation-state-trial-actions"><button id="${idPrefix}Undo" type="button" class="doc-btn doc-btn-ghost"></button><button id="${idPrefix}ClearHistory" type="button" class="doc-btn doc-btn-ghost"></button></div>
        <ol id="${idPrefix}HistoryList" class="animation-state-trial-history"></ol></section><div id="${idPrefix}CaseHost"></div>
    </div></section>`;
  const el = suffix => container.querySelector('#' + idPrefix + suffix), text = (key, ...args) => translate(key, ...args);
  const rawBufferLimit = 262144;
  const encoder = new TextEncoder(), decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  let disposed = false, expanded = false, epoch = 0, sampleEpoch = 0, rowSequence = 0, model = null, signature = null, generation;
  let sequence = null, pending = null, undoBuffers = [], undoBufferSizes = [], rawBufferBytes = 0, historyViews = [], pendingBytes = 0, stepSequence = 0, notice = '';
  let result = null, resultOwner = null, error = '', stale = false, initialized = false, sharedRows = new Map(), sampleCache = new Map(), resultViews = [];
  const context = () => getContext(), active = value => value.active === true && value.available !== false && value.disabled !== true;
  const eventMode = () => el('TriggerKind').value === 'event';
  const controlsActive = () => !disposed && expanded && active(context()) && Boolean(model);
  function node(tag, suffix, className) {
    const element = document.createElement(tag); if (suffix) element.id = idPrefix + suffix; if (className) element.className = className; return element;
  }
  function options(control, values, selected) {
    control.replaceChildren();
    for (const value of values) { const option = node('option'); option.value = value; option.textContent = value; control.append(option); }
    control.value = selected;
  }
  function clearResult(changed = false) {
    epoch++; result = null; pending = null; pendingBytes = 0; resultOwner = null; resultViews = []; el('Candidates').replaceChildren(); el('Result').hidden = true;
    stale = stale || changed; el('Summary').textContent = '';
  }
  function scalarControl(parent, suffix, { missing = false, owner = () => true } = {}) {
    const root = node('div', suffix + 'Fields', 'animation-state-event-preview-scalar'), label = node('label'), title = node('span', suffix + 'Label');
    const type = node('select', suffix + 'Type'); label.append(title, type); root.append(label);
    options(type, missing ? ['missing', 'string', 'number', 'boolean'] : ['string', 'number', 'boolean'], missing ? 'missing' : 'string');
    const stringLabel = node('label'), stringTitle = node('span'), string = node('textarea', suffix + 'String'); string.rows = 2; string.maxLength = 4096; stringLabel.append(stringTitle, string);
    const numberLabel = node('label'), numberTitle = node('span'), number = node('input', suffix + 'Number'); number.type = 'text'; number.inputMode = 'decimal'; number.value = '0'; numberLabel.append(numberTitle, number);
    const booleanLabel = node('label'), booleanTitle = node('span'), boolean = node('select', suffix + 'Boolean'); options(boolean, ['false', 'true'], 'false'); booleanLabel.append(booleanTitle, boolean);
    root.append(stringLabel, numberLabel, booleanLabel); parent.append(root);
    const fields = [type, string, number, boolean];
    const raw = () => ({ type: type.value, string: string.value, number: number.value, boolean: boolean.value });
    const set = value => { type.value = value.type; string.value = value.string; number.value = value.number; boolean.value = value.boolean; };
    const read = () => {
      if (missing && type.value === 'missing') return { valid: true, missing: true };
      if (type.value === 'string') return { valid: encoder.encode(string.value).length <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(string.value), value: string.value };
      if (type.value === 'boolean') return { valid: ['true', 'false'].includes(boolean.value), value: boolean.value === 'true' };
      if (type.value === 'number') {
        const value = Number(number.value), match = decimal.exec(number.value);
        return { valid: Boolean(match && match[0] === number.value && Number.isFinite(value) && Math.abs(value) <= 1e9), value: Object.is(value, -0) ? 0 : value };
      }
      return { valid: false };
    };
    function refresh(titleText, enabled, validate = true) {
      title.textContent = titleText;
      const labels = { missing: '缺失（不提供此键）', string: '字符串（string）', number: '数字（number）', boolean: '布尔值（boolean）' };
      for (const option of type.children) option.textContent = text(labels[option.value]);
      stringTitle.textContent = numberTitle.textContent = booleanTitle.textContent = text('手动样本值');
      stringLabel.hidden = type.value !== 'string'; numberLabel.hidden = type.value !== 'number'; booleanLabel.hidden = type.value !== 'boolean';
      const valid = !validate || read().valid;
      for (const field of fields) field.disabled = !enabled;
      type.setAttribute('aria-invalid', String(!Object.hasOwn(labels, type.value) || !missing && type.value === 'missing'));
      string.setAttribute('aria-invalid', String(type.value === 'string' && !valid)); number.setAttribute('aria-invalid', String(type.value === 'number' && !valid)); boolean.setAttribute('aria-invalid', String(type.value === 'boolean' && !valid));
      type.setAttribute('aria-label', titleText); string.setAttribute('aria-label', titleText + ' · ' + text('手动样本值')); number.setAttribute('aria-label', string.getAttribute('aria-label')); boolean.setAttribute('aria-label', string.getAttribute('aria-label'));
    }
    for (const field of fields) field.addEventListener(field === type || field === boolean ? 'change' : 'input', () => {
      if (!controlsActive() || !eventMode() || !owner()) return; sampleEpoch++; error = ''; notice = ''; clearResult(true); updateText();
    });
    return { root, raw, set, read, refresh };
  }
  const payload = scalarControl(el('Payload'), 'Payload');
  const caseView = setupAnimationStateTrialCase({ container: el('CaseHost'), idPrefix: idPrefix + 'Case', getTable, translate,
    getContext: () => ({ ...context(), active: !disposed && context().active === true, visible: expanded }),
    getSequence: () => {
      if (!controlsActive() || !sequence?.steps.length || context().generation !== generation) return null;
      try { return JSON.stringify(getTable()) === signature ? sequence : null; } catch { return null; }
    } });
  function sampleSignature() { return JSON.stringify([el('CurrentState').value, el('TriggerKind').value, ...(eventMode() ? [el('EventName').value, payload.raw(), [...sharedRows].map(([key, row]) => [key, row.raw()])] : [])]); }
  function allTableKeys(table) {
    const keys = new Set();
    for (const transition of table.transitions) {
      const condition = transition.trigger.condition;
      for (const leaf of condition ? condition.conditions || [condition] : []) if (leaf.selector) keys.add(leaf.selector.key);
    }
    return keys;
  }
  function syncSharedRows() {
    if (!eventMode()) return;
    const allowed = allTableKeys(model.table);
    for (const [key, row] of sharedRows) if (allowed.has(key)) sampleCache.set(key, row.raw());
    let keys = [];
    try { keys = animationStateEventPreviewKeys(model, el('CurrentState').value, el('EventName').value); } catch { /* Incomplete manual selection has no visible sample keys. */ }
    if (JSON.stringify(keys) === JSON.stringify([...sharedRows.keys()])) return;
    sharedRows = new Map(); el('SharedStates').replaceChildren();
    for (const key of keys) {
      const card = node('div', '', 'animation-state-event-preview-shared-row'); card.dataset.key = key;
      const row = scalarControl(card, 'Shared' + (++rowSequence), { missing: true, owner: () => sharedRows.get(key) === row });
      if (sampleCache.has(key)) row.set(sampleCache.get(key)); sharedRows.set(key, row); el('SharedStates').append(card);
    }
  }
  function requiresComparison() { return model?.table.transitions.some(edge => Object.hasOwn(edge.trigger, 'condition')); }
  const comparisonReady = () => !eventMode() || !requiresComparison() || supportsStudioCoreAnimationStateConditions();
  function sample() {
    if (el('TriggerKind').value === 'completed') return { kind: 'completed' };
    if (!eventMode()) throw Error('sample');
    const value = payload.read(); if (!value.valid) throw Error('sample');
    const projectState = [];
    for (const [key, row] of sharedRows) { const item = row.read(); if (!item.valid) throw Error('sample'); if (!item.missing) projectState.push({ key, value: item.value }); }
    return { kind: 'event', event: { name: el('EventName').value, value: value.value }, projectState };
  }
  function current(ticket) {
    if (!ticket || ticket.revoked) return false;
    // Once a caller observes lost ownership, restoration of the same values
    // cannot revive that pending action. Budget limits do not affect ownership.
    const revoke = () => { ticket.revoked = true; return false; };
    try {
      if (disposed || !expanded || !active(context()) || !comparisonReady() || ticket !== resultOwner || ticket.sequence !== sequence || !pending || ticket.epoch !== epoch || ticket.sampleEpoch !== sampleEpoch || context().generation !== ticket.generation) return revoke();
      return JSON.stringify(getTable()) === ticket.signature && sampleSignature() === ticket.sample ? true : revoke();
    } catch { return revoke(); }
  }

  function candidateViews(target, value, ticket = null) {
    return value.candidates.map(candidate => {
      const suffix = ticket ? 'Transition' + (candidate.transitionIndex + 1) : '';
      const card = node('li', suffix, 'animation-state-event-preview-candidate'); card.dataset.status = candidate.status;
      const title = node('h5'), status = node('p'), kind = node('p'), list = node('ol');
      const leaves = candidate.leaves.map(leaf => { const item = node('li', '', 'animation-state-event-preview-leaf'), rule = node('p'), actual = node('p'), outcome = node('p'); item.dataset.status = leaf.status; item.append(rule, actual, outcome); list.append(item); return { leaf, rule, actual, outcome }; });
      card.append(title, status, kind, list);
      let locate = null;
      if (ticket) {
        locate = node('button', suffix + 'Locate', 'doc-btn doc-btn-ghost'); locate.type = 'button';
        locate.addEventListener('click', () => { if (current(ticket)) onLocate({ kind: 'transition', index: candidate.transitionIndex }, { isCurrent: () => current(ticket) }); }); card.append(locate);
      }
      target.append(card); return { candidate, title, status, kind, leaves, locate };
    });
  }
  function renderResult() { resultViews = candidateViews(el('Candidates'), result, resultOwner); }
  function captureBuffers() {
    const cache = new Map(sampleCache);
    for (const [key, row] of sharedRows) cache.set(key, row.raw());
    return { stateKey: el('CurrentState').value, kind: el('TriggerKind').value, eventName: el('EventName').value, payload: payload.raw(), cache };
  }
  function bufferBytes(value) {
    let bytes = 0;
    const add = input => {
      if (typeof input !== 'string' || input.length > rawBufferLimit - bytes) { bytes = rawBufferLimit + 1; return false; }
      bytes += encoder.encode(input).length; return bytes <= rawBufferLimit;
    };
    for (const item of [value.stateKey, value.kind, value.eventName, ...Object.values(value.payload)]) if (!add(item)) return bytes;
    for (const [key, raw] of value.cache) for (const item of [key, ...Object.values(raw)]) if (!add(item)) return bytes;
    return bytes;
  }
  function restoreBuffers(value) {
    el('CurrentState').value = value.stateKey; el('TriggerKind').value = value.kind; el('EventName').value = value.eventName; payload.set(value.payload);
    sampleCache = new Map(value.cache); sharedRows = new Map(); el('SharedStates').replaceChildren(); syncSharedRows();
  }
  function clearHistory() { undoBuffers = []; undoBufferSizes = []; rawBufferBytes = 0; historyViews = []; el('HistoryList').replaceChildren(); }
  function historyCurrent(view) {
    if (disposed || !expanded || !active(context()) || !sequence || !historyViews.includes(view) || context().generation !== generation) return false;
    try { return JSON.stringify(getTable()) === signature; } catch { return false; }
  }
  function appendHistoryView(step) {
    const item = node('li', 'Step' + (++stepSequence), 'animation-state-trial-step'); item.dataset.stepIndex = String(step.index);
    const title = node('h5'), trigger = node('p'), samples = node('p'), details = node('details'), summary = node('summary'), list = node('ol');
    details.append(summary, list); item.append(title, trigger, samples, details); el('HistoryList').append(item);
    const view = { step, item, title, trigger, samples, details, summary, list, candidates: null, languageKey: null }; historyViews.push(view);
    details.addEventListener('toggle', () => {
      if (!details.open || !historyCurrent(view)) return;
      if (!view.candidates) { view.candidates = candidateViews(list, step.result); view.languageKey = null; }
      updateHistoryText();
    });
    return view;
  }
  function updateHistoryText() {
    const languageKey = text('手动步骤历史');
    for (const view of historyViews) {
      if (view.languageKey === languageKey) continue; view.languageKey = languageKey;
      const { step } = view;
      view.title.textContent = text('手动步骤 {0}：{1} → {2}', step.index + 1, step.stateKey, step.nextStateKey);
      view.trigger.textContent = step.input.kind === 'event' ? text('事件样本：{0} · {1}', step.input.event.name, scalarText(step.input.event.value)) : text('假设当前动画完成通知已送达。');
      view.samples.textContent = step.input.kind === 'event'
        ? text('已提供的共享样本：{0}', step.input.projectState.length ? step.input.projectState.map(entry => text('{0}：{1}', entry.key, scalarText(entry.value))).join(' · ') : text('无（其余键缺失）'))
        : text('此步未读取事件载荷或共享样本。');
      view.summary.textContent = text(step.result.candidates.length ? '查看此步条件详情' : '此步没有候选转换。');
      if (view.candidates) updateCandidateText(view.candidates, false);
    }
  }
  const scalarText = value => text('{0}：{1}', text(typeof value === 'number' ? '数字（number）' : typeof value === 'boolean' ? '布尔值（boolean）' : '字符串（string）'), JSON.stringify(value));
  function updateText() {
    caseView.refresh();
    const available = !disposed && active(context());
    el('Toggle').textContent = text(expanded ? '收起状态试算' : '状态试算'); el('Toggle').disabled = !available; el('Toggle').setAttribute('aria-expanded', String(expanded)); el('Body').hidden = !expanded;
    if (!expanded) return;
    el('Note').textContent = text('使用手动样本检查状态转换；试算不会推进状态，记录并继续才采用预测目标。这里不执行脚本、不发布事件，也不代表历史运行或动画播放成功。');
    el('TriggerKindLabel').textContent = text('样本触发方式');
    for (const option of el('TriggerKind').children) option.textContent = text(option.value === 'event' ? '项目事件样本' : '当前动画完成（手动假设）');
    el('EventFields').hidden = el('Payload').hidden = el('SharedSection').hidden = !eventMode();
    el('CompletionNote').hidden = eventMode(); el('CompletionNote').textContent = text('假设控制器有效，且当前所选片段的完成通知已送达。这里只检查完成转换，不模拟片段匹配、播放器或进入成功。');
    el('CurrentStateLabel').textContent = text('样本当前状态'); el('EventNameLabel').textContent = text('样本事件名称');
    el('SharedTitle').textContent = text('手动共享状态样本'); el('SharedNote').textContent = text('仅列出当前状态与事件涉及的共享键。同一键在本次试算中使用固定值；实际运行可能在每次读取时变化。');
    el('SharedEmpty').textContent = text('此状态与事件没有需要提供的共享状态键。'); el('SharedEmpty').hidden = sharedRows.size !== 0;
    el('Run').textContent = text(eventMode() ? '试算此事件' : '试算完成转换'); el('ResultTitle').textContent = text('手动试算结果');
    const enabled = controlsActive();
    payload.refresh(text('样本事件载荷类型'), enabled && eventMode(), eventMode());
    for (const [key, row] of sharedRows) row.refresh(text('共享状态样本：{0}', key), enabled && eventMode(), eventMode());
    for (const option of el('CurrentState').children) if (model && !model.states.some(item => item.key === option.value)) option.textContent = text('已移除状态：{0}', option.value);
    const validState = Boolean(model?.states.some(item => item.key === el('CurrentState').value));
    const validEvent = !eventMode() || /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(el('EventName').value) && !['constructor', 'prototype', '__proto__'].includes(el('EventName').value);
    let validSample = true; try { sample(); } catch { validSample = false; }
    el('CurrentState').setAttribute('aria-invalid', String(!validState)); el('EventName').setAttribute('aria-invalid', String(!validEvent));
    el('CurrentState').disabled = el('TriggerKind').disabled = !enabled; el('EventName').disabled = !enabled || !eventMode();
    el('Run').disabled = !enabled || !sequence || !['event', 'completed'].includes(el('TriggerKind').value) || !comparisonReady() || !validState || !validEvent || !validSample;
    const withinBudget = sequence && sequence.steps.length < ANIMATION_STATE_TRIAL_LIMITS.steps && sequence.sampleBytes + pendingBytes <= ANIMATION_STATE_TRIAL_LIMITS.sampleBytes;
    const rawWithinBudget = !pending || rawBufferBytes + bufferBytes(captureBuffers()) <= rawBufferLimit;
    el('Adopt').textContent = text('记录并继续'); el('Adopt').disabled = !resultOwner || !current(resultOwner) || !withinBudget || !rawWithinBudget;
    el('Undo').textContent = text('撤回最后一步'); el('Undo').disabled = !enabled || !sequence?.steps.length;
    el('ClearHistory').textContent = text('清空步骤'); el('ClearHistory').disabled = !enabled || !sequence?.steps.length;
    el('HistoryTitle').textContent = text('手动步骤历史');
    el('HistorySummary').textContent = text('{0}/{1} 步 · 样本 {2}/{3} 字节；仅保留本次表单会话。', sequence?.steps.length || 0, ANIMATION_STATE_TRIAL_LIMITS.steps, sequence?.sampleBytes || 0, ANIMATION_STATE_TRIAL_LIMITS.sampleBytes);
    updateHistoryText();
    const issue = error || (pending && !rawWithinBudget ? '用于撤回的原始输入超过 256 KiB 预算；请缩短输入或撤回、清空步骤。单次试算仍可使用。' : '') || (pending && !withinBudget ? '步骤或样本预算已满，请撤回或清空步骤后继续。' : '') || notice || (model && !comparisonReady() ? '当前核心无法比较事件样本；状态表输入仍然保留。' : !model ? '' : !validState ? '请选择当前表中的状态。'
      : !validEvent ? '请输入有效事件名称；未配置的合法名称也可以试算。' : !validSample ? '请检查手动样本：数字须为有限十进制且绝对值不超过 1e9，字符串须为有效 Unicode 且不超过 4096 UTF-8 字节。'
      : stale ? '状态表或样本已变化，请重新试算。' : '填写手动样本后试算；不会修改状态表或源码草稿。');
    el('Status').textContent = text(issue); el('Result').hidden = !result;
    if (!result) return;
    el('Summary').textContent = result.selected ? text('样本选择转换 {0}：{1} → {2}', result.selected.transitionIndex + 1, result.stateKey, result.selected.stateKey)
      : text('此样本未选择转换；当前状态保持 {0}。', result.stateKey);
    const canLocate = current(resultOwner);
    updateCandidateText(resultViews, canLocate);
  }
  function updateCandidateText(views, canLocate) {
    for (const view of views) {
      const { candidate } = view; view.title.textContent = text('转换 {0}：{1} → {2}', candidate.transitionIndex + 1, candidate.from, candidate.to);
      view.status.textContent = text(candidate.status === 'selected' ? '此样本选中此分支。' : candidate.status === 'rejected' ? '此样本不满足此分支。' : '前面的分支已选中，此分支未求值。');
      view.kind.textContent = text(({ fallback: '无条件分支', scalar: '单条件', all: '全部满足', any: '任一满足', completed: '动画完成转换' })[candidate.kind]);
      if (view.locate) { view.locate.textContent = text('定位转换字段'); view.locate.disabled = !canLocate; }
      for (const item of view.leaves) {
        const { leaf } = item, condition = leaf.condition, source = condition.selector ? text('项目共享状态 {0}', condition.selector.key) : text('事件载荷');
        const operator = ({ eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' })[condition.operator];
        item.rule.textContent = text('条件 {0}：{1} {2} {3}', leaf.index + 1, source, operator, scalarText(condition.value));
        item.actual.textContent = leaf.status === 'not-evaluated' ? text('未读取样本值。') : leaf.actual.status === 'missing' ? text('样本中未提供此共享键。') : text('实际样本：{0}', scalarText(leaf.actual.value));
        item.outcome.textContent = leaf.status === 'not-evaluated' ? text(candidate.status === 'not-evaluated' ? '前面的分支已选中，此条件未求值。' : '组合已短路，此条件未求值。')
          : leaf.reason === 'missing' ? text('共享键缺失，条件不匹配（包括不等于比较）。') : leaf.reason === 'type-mismatch' ? text('样本类型不同，条件不匹配（包括不等于比较）。')
          : text(leaf.matches ? '比较匹配。' : '比较不匹配。');
      }
    }
  }
  function refresh() {
    if (disposed) return;
    const value = context();
    if (value.active !== true) { expanded = false; clearResult(); clearHistory(); sequence = null; model = null; signature = null; }
    // Collapsed views do not inspect a table or construct sample rows.
    if (!expanded) { updateText(); return; }
    if (!active(value)) { clearResult(); clearHistory(); sequence = null; model = null; signature = null; error = value.available === false ? '当前核心无法提供事件试算。' : '表单当前不可操作，试算结果已清除。'; updateText(); return; }
    let nextSignature;
    try { nextSignature = JSON.stringify(getTable()); } catch { nextSignature = null; }
    if (!model || signature !== nextSignature || generation !== value.generation) {
      clearResult(Boolean(result)); clearHistory(); sequence = null; error = ''; notice = ''; signature = nextSignature; generation = value.generation;
      for (const [key, row] of sharedRows) sampleCache.set(key, row.raw());
      try {
        sequence = createAnimationStateTrialSequence(getTable()); model = sequence.model;
        if (initialized && model.states.some(item => item.key === el('CurrentState').value) && sequence.stateKey !== el('CurrentState').value) sequence = createAnimationStateTrialSequence(model.table, el('CurrentState').value);
        const keys = allTableKeys(model.table); for (const key of sampleCache.keys()) if (!keys.has(key)) sampleCache.delete(key);
        const state = initialized ? el('CurrentState').value : model.table.initialState;
        options(el('CurrentState'), model.states.map(item => item.key), state);
        if (!model.states.some(item => item.key === state)) { const option = node('option'); option.value = state; option.textContent = text('已移除状态：{0}', state); el('CurrentState').append(option); el('CurrentState').value = state; }
        options(el('EventNames'), model.eventNames, ''); if (!initialized) el('EventName').value = model.eventNames[0] || '';
        initialized = true; syncSharedRows();
      } catch (cause) { sequence = null; model = null; sharedRows = new Map(); el('SharedStates').replaceChildren(); error = cause?.errorCode === 'studio_core_unavailable' ? '当前核心无法提供事件试算。' : '状态表尚未有效，无法试算。请先修正状态、转换和条件字段。'; }
    }
    if (model && sequence && sequence.stateKey !== el('CurrentState').value) {
      clearResult(true); clearHistory(); notice = '手动选择了起始状态；此前步骤已清除。';
      try { sequence = createAnimationStateTrialSequence(model.table, el('CurrentState').value); } catch { sequence = null; notice = ''; }
    }
    if (!comparisonReady() || resultOwner && !current(resultOwner)) clearResult(Boolean(result));
    updateText();
  }
  function sampleChanged() {
    if (!controlsActive() || !eventMode()) return;
    sampleEpoch++; error = ''; notice = ''; clearResult(true); syncSharedRows(); updateText();
  }
  el('EventName').addEventListener('input', sampleChanged);
  el('CurrentState').addEventListener('change', () => {
    if (!controlsActive()) return;
    sampleEpoch++; clearResult(true); clearHistory(); error = ''; notice = '手动选择了起始状态；此前步骤已清除。';
    try { sequence = createAnimationStateTrialSequence(model.table, el('CurrentState').value); } catch { sequence = null; notice = ''; }
    syncSharedRows(); updateText();
  });
  el('TriggerKind').addEventListener('change', () => {
    if (!controlsActive()) return; sampleEpoch++; clearResult(true); error = ''; notice = ''; syncSharedRows(); updateText();
  });
  el('Toggle').addEventListener('click', () => { if (disposed || !active(context())) return; expanded = !expanded; clearResult(); refresh(); });
  function trialError(cause) {
    return cause?.errorCode === 'animation_state_trial_sequence_limit' ? '步骤或样本预算已满，请撤回或清空步骤后继续。'
      : cause?.errorCode === 'studio_core_unavailable' ? '当前核心无法比较事件样本；状态表输入仍然保留。' : '无法试算此样本，请检查输入。';
  }
  el('Run').addEventListener('click', () => {
    if (!controlsActive()) return; refresh(); if (el('Run').disabled) return;
    clearResult(); error = ''; notice = '';
    try {
      const input = sample(), ticket = { epoch, sampleEpoch, generation: context().generation, signature, sample: sampleSignature(), sequence };
      pending = previewAnimationStateTrialStep(sequence, input); pendingBytes = encoder.encode(JSON.stringify(pending.input)).length; resultOwner = ticket;
      if (!current(ticket)) { clearResult(true); updateText(); return; }
      result = pending.result; stale = false; renderResult();
    } catch (cause) { clearResult(); error = trialError(cause); }
    updateText();
  });
  el('Adopt').addEventListener('click', () => {
    if (!current(resultOwner)) return;
    try {
      const buffers = captureBuffers(), bytes = bufferBytes(buffers);
      if (rawBufferBytes + bytes > rawBufferLimit) { error = '用于撤回的原始输入超过 256 KiB 预算；请缩短输入或撤回、清空步骤。单次试算仍可使用。'; updateText(); return; }
      const next = appendAnimationStateTrialStep(sequence, pending);
      sequence = next; undoBuffers.push(buffers); undoBufferSizes.push(bytes); rawBufferBytes += bytes; appendHistoryView(next.steps.at(-1));
      el('CurrentState').value = next.stateKey; sampleEpoch++; clearResult(); stale = false; error = ''; notice = '已记录此手动步骤；可填写下一样本。'; syncSharedRows();
    } catch (cause) { clearResult(); error = trialError(cause); }
    updateText(); el('TriggerKind').focus({ preventScroll: true });
  });
  el('Undo').addEventListener('click', () => {
    if (!controlsActive() || !sequence?.steps.length) return;
    refresh(); if (!sequence?.steps.length || el('Undo').disabled) return;
    try {
      sequence = truncateAnimationStateTrialSequence(sequence, sequence.steps.length - 1);
      const buffers = undoBuffers.pop(), view = historyViews.pop(); rawBufferBytes -= undoBufferSizes.pop(); view.item.remove(); sampleEpoch++; clearResult();
      restoreBuffers(buffers); stale = false; error = ''; notice = '已撤回最后一步并恢复当时的手动样本。';
    } catch (cause) { clearResult(); error = trialError(cause); }
    updateText(); el('TriggerKind').focus({ preventScroll: true });
  });
  el('ClearHistory').addEventListener('click', () => {
    if (!controlsActive() || !sequence?.steps.length) return;
    refresh(); if (!sequence?.steps.length || el('ClearHistory').disabled) return;
    try { sequence = createAnimationStateTrialSequence(model.table, el('CurrentState').value); clearHistory(); clearResult(); sampleEpoch++; stale = false; error = ''; notice = '步骤已清空；当前手动状态与输入保持不变。'; }
    catch (cause) { clearResult(); error = trialError(cause); }
    updateText(); el('CurrentState').focus({ preventScroll: true });
  });
  // Construction must not read the parent's not-yet-initialized session.
  el('Toggle').textContent = text('状态试算');
  return Object.freeze({ refresh, reset() {
    if (disposed) return; caseView.reset(); expanded = false; clearResult(); clearHistory(); sequence = null; model = null; signature = null; initialized = false; stale = false; error = ''; notice = ''; sampleEpoch++; el('TriggerKind').value = 'event';
    sharedRows = new Map(); sampleCache = new Map(); el('SharedStates').replaceChildren(); el('CurrentState').replaceChildren(); el('EventName').value = '';
    payload.set({ type: 'string', string: '', number: '0', boolean: 'false' }); el('Body').hidden = true; el('Toggle').textContent = text('状态试算'); el('Toggle').setAttribute('aria-expanded', 'false');
  }, dispose() { if (disposed) return; caseView.dispose(); disposed = true; clearResult(); clearHistory(); sequence = null; model = null; sharedRows.clear(); sampleCache.clear(); container.replaceChildren(); } });
}
