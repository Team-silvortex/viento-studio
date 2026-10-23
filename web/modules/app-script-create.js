import { supportsStudioCoreAnimationStateConditions, supportsStudioCoreAnimationStateBranches, supportsStudioCoreAnimationStateSelectors, supportsStudioCoreAnimationStateCombinations } from '../../engine/studio-core.mjs';
import { listScriptStarters, prepareScriptDraft, prepareAnimationStateScriptDraft, DEFAULT_ANIMATION_STATE_TABLE, supportsAnimationStateScript } from '../../engine/script-authoring.mjs';
import { setupAnimationStateScript } from './app-animation-state-script.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This form owns a local choice and preview. The editor port alone owns the
// handoff to a new source draft; saving remains the normal document operation.
export function setupScriptCreate({ getContext = () => ({}), createDraft = async () => false } = {}) {
  const actions = document.getElementById('docEditActions');
  if (!actions) return Object.freeze({ open: () => false, refresh() {}, dispose() {} });
  if (!document.getElementById('scriptCreateStyle')) {
    const style = document.createElement('link');
    style.id = 'scriptCreateStyle'; style.rel = 'stylesheet'; style.href = '/web/script-create.css';
    (document.head || document.body).append(style);
  }
  if (!document.getElementById('animationStateScriptStyle')) {
    const style = document.createElement('link');
    style.id = 'animationStateScriptStyle'; style.rel = 'stylesheet'; style.href = '/web/animation-state-script.css';
    (document.head || document.body).append(style);
  }
  const button = document.createElement('button');
  button.id = 'scriptCreateBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost';
  actions.append(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'scriptCreateDialog'; dialog.className = 'script-create-dialog';
  dialog.setAttribute('aria-labelledby', 'scriptCreateTitle');
  dialog.innerHTML = `<header class="script-create-header"><h2 id="scriptCreateTitle" data-i18n="新建脚本"></h2><button id="scriptCreateClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="script-create-body"><p data-i18n="选择起始内容，在原文编辑器中继续编写，再用保存登记 TXT 脚本。"></p>
      <p class="script-create-note" data-i18n="选择 Godot 4 / GDScript 或 Bevy / Rust 起始内容，无需先安装对应工具链。本次只创建草稿；保存和场景关联分别在编辑器中完成。"></p>
      <fieldset id="scriptCreateFields"><legend data-i18n="脚本草稿设置"></legend><div class="script-create-grid">
        <label><span data-i18n="起始内容"></span><select id="scriptCreateStarter"></select></label>
        <label><span data-i18n="文档类型"></span><select id="scriptCreateType"></select></label>
        <label class="script-create-path"><span data-i18n="TXT 原文路径"></span><input id="scriptCreatePath" type="text" maxlength="1024" spellcheck="false" aria-describedby="scriptCreatePathHint" /></label>
      </div><p id="scriptCreatePathHint" class="script-create-note" data-i18n="使用工程正文目录内的 .txt 路径。已有文件会在保存时检查。"></p></fieldset>
      <div id="scriptCreateStateTable" hidden></div>
      <section aria-labelledby="scriptCreatePreviewTitle"><h3 id="scriptCreatePreviewTitle" data-i18n="完整脚本预览"></h3><p id="scriptCreateDescription" class="script-create-note"></p>
        <pre id="scriptCreateSource" tabindex="0" aria-labelledby="scriptCreatePreviewTitle"></pre></section>
    </div><p id="scriptCreateStatus" class="script-create-status" role="status" aria-live="polite"></p>
    <footer class="script-create-footer"><button id="scriptCreateApply" type="button" class="doc-btn" data-i18n="创建脚本草稿"></button><button id="scriptCreateCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消创建"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#scriptCreate' + suffix);
  const starters = listScriptStarters();
  const fields = ['Starter', 'Type', 'Path'];
  let disposed = false, epoch = 0, owner = null, baseline = '', proposal = null, reviewed = '';
  let phase = false, invalidated = false, message = '', opener = null, pendingFocus = null;
  const raw = () => ({ starterId: el('Starter').value, documentType: el('Type').value, sourcePath: el('Path').value });
  const isStateTable = () => el('Starter').value === 'godot-project-animation-state-table';
  const tableEditor = setupAnimationStateScript({ container: el('StateTable'), translate: t,
    getContext: () => ({ active: dialog.open && isStateTable(), disabled: phase || !owns(), available: supportsAnimationStateScript() }),
    onChange: () => { if (!phase && dialog.open && isStateTable()) review(); },
  });
  let conditionRevision = 0, observedConditionSupport, observedBranchSupport, observedSelectorSupport, observedCombinationSupport;
  const hasCombinations = () => tableEditor.getValue().transitions.some(edge => edge.trigger.condition && (Object.hasOwn(edge.trigger.condition, 'combine') || Object.hasOwn(edge.trigger.condition, 'conditions')));
  const hasSelectors = () => tableEditor.getValue().transitions.some(edge => edge.trigger.condition && Object.hasOwn(edge.trigger.condition, 'selector'));
  const conditionsReady = () => {
    const table = tableEditor.getValue();
    if (hasCombinations()) {
      const supported = supportsStudioCoreAnimationStateCombinations();
      if (observedCombinationSupport !== undefined && observedCombinationSupport !== supported) conditionRevision++;
      observedCombinationSupport = supported; return supported;
    }
    if (hasSelectors()) {
      const supported = supportsStudioCoreAnimationStateSelectors();
      if (observedSelectorSupport !== undefined && observedSelectorSupport !== supported) conditionRevision++;
      observedSelectorSupport = supported; return supported;
    }
    let ready = true;
    if (table.eventSelection !== 'firstMatch' && table.transitions.some(edge => Object.hasOwn(edge.trigger, 'condition'))) {
      const supported = supportsStudioCoreAnimationStateConditions();
      if (observedConditionSupport !== undefined && observedConditionSupport !== supported) conditionRevision++;
      observedConditionSupport = supported; ready = supported;
    }
    if (table.eventSelection === 'firstMatch') {
      const supported = supportsStudioCoreAnimationStateBranches();
      if (observedBranchSupport !== undefined && observedBranchSupport !== supported) conditionRevision++;
      observedBranchSupport = supported; ready = ready && supported;
    }
    return ready;
  };
  const capabilityMessage = () => hasCombinations() && !supportsStudioCoreAnimationStateCombinations()
    ? '当前核心不支持组合条件；已有输入会保留，可明确切回单条件。'
    : hasSelectors() && !supportsStudioCoreAnimationStateSelectors()
    ? '当前核心不支持项目共享状态条件；已有输入会保留，可选择事件载荷或无条件。'
    : tableEditor.getValue().eventSelection === 'firstMatch' && !supportsStudioCoreAnimationStateBranches()
    ? '当前核心不支持有序事件分支；已有输入会保留，可切回单一转换模式。'
    : '当前核心不支持事件载荷条件；无条件转换仍可编辑，已有条件会保留。';
  const signature = () => JSON.stringify({ ...raw(), table: tableEditor.getValue() });
  const coreContext = context => ({ sourceToken: context.sourceToken, documentRoot: context.documentRoot,
    documentTypes: context.documentTypes?.map(item => ({ id: item.id, label: item.label })) });
  const eligible = context => !disposed && context.editable === true && !context.busy && !context.dirty && !context.creating
    && typeof context.sourceToken === 'string' && context.sourceToken.length > 0
    && typeof context.documentRoot === 'string' && Array.isArray(context.documentTypes) && context.documentTypes.length > 0;
  const owns = (generation = epoch) => {
    const context = getContext();
    return generation === epoch && dialog.open && owner && !invalidated && eligible(context)
      && JSON.stringify(coreContext(context)) === owner.signature;
  };
  function options(select, values, selected) {
    select.replaceChildren();
    for (const [value, label] of values) {
      const item = document.createElement('option'); item.value = value; item.textContent = label; select.append(item);
    }
    select.value = selected;
  }
  function renderChoices() {
    const input = raw();
    options(el('Starter'), starters.map(item => [item.id, t(item.label)]), input.starterId);
    options(el('Type'), (owner?.context.documentTypes || []).map(item => [item.id, item.label]), input.documentType);
  }
  function render() {
    if (disposed) return;
    const context = getContext();
    button.textContent = t('新建脚本'); button.hidden = context.editable !== true;
    button.disabled = !eligible(context) || dialog.open;
    if (!dialog.open) return;
    translatePage(dialog);
    dialog.dataset.dirty = String(signature() !== baseline);
    dialog.setAttribute('aria-busy', String(phase));
    const canChange = !phase && owns();
    el('Fields').disabled = !canChange;
    for (const field of fields) el(field).disabled = !canChange;
    const stateAvailable = !isStateTable() || supportsAnimationStateScript() && conditionsReady();
    el('StateTable').hidden = !isStateTable(); tableEditor.refresh();
    el('Apply').disabled = !canChange || !stateAvailable || !proposal || reviewed !== signature();
    el('Close').disabled = phase; el('Cancel').disabled = phase;
    const starter = starters.find(item => item.id === el('Starter').value);
    el('Description').textContent = starter ? t(starter.description) : '';
    el('Source').textContent = proposal?.content || (isStateTable() ? '' : starter?.content || '');
    el('Status').textContent = t(message);
  }
  function review() {
    proposal = null; reviewed = '';
    if (!owns()) {
      invalidated = true;
      message = '工程或编辑器已变化，设置已保留。请返回编辑器后重新打开。';
    } else {
      try {
        if (isStateTable() && (!supportsAnimationStateScript() || !conditionsReady())) throw Object.assign(new Error('Animation state table unavailable'), { errorCode: 'studio_core_unavailable' });
        proposal = isStateTable() ? prepareAnimationStateScriptDraft(owner.context, raw(), tableEditor.getValue()) : prepareScriptDraft(owner.context, raw()); reviewed = signature();
        message = '请审阅完整脚本；创建草稿后可在原文编辑器继续修改。';
      } catch (error) {
        message = (error?.code || error?.errorCode) === 'animation_state_script_source_limit'
          ? '生成脚本超过 64 KiB，请缩短条件文本或减少转换。'
          : (error?.code || error?.errorCode) === 'animation_state_condition_invalid'
            ? '请检查事件载荷条件的类型、比较方式和比较值。'
            : error?.code === 'studio_core_unavailable' || error?.errorCode === 'studio_core_unavailable'
          ? supportsAnimationStateScript() ? capabilityMessage() : '当前核心不支持动画状态表；其他起始脚本仍可使用。'
          : error?.code === 'animation_state_table_invalid' || error?.errorCode === 'animation_state_table_invalid'
            ? hasCombinations() ? '请检查状态、转换及组合条件：每组需要 1–8 项有效条件，不支持空组、嵌套或无条件项。'
              : hasSelectors() ? '请检查状态标识、转换、共享状态键以及条件的类型、比较方式和比较值。'
              : tableEditor.getValue().eventSelection === 'firstMatch'
              ? '请检查状态与事件分支：条件分支按顺序排列，无条件分支只能位于同一状态、同名事件的最后。'
              : tableEditor.getValue().transitions.some(edge => Object.hasOwn(edge.trigger, 'condition'))
              ? '请检查状态标识、初始状态、转换及事件载荷条件。'
              : '请检查状态标识、初始状态和转换：标识不能重复或缺失，同一触发不能重复。'
            : '请选择当前工程的文档类型，并填写正文目录内有效的 .txt 路径。';
      }
    }
    render();
  }
  function closeDialog(focus) {
    epoch++; owner = null; proposal = null; reviewed = ''; phase = false;
    dialog.dataset.dirty = 'false'; dialog.setAttribute('aria-busy', 'false');
    pendingFocus = { epoch, focus: focus || (() => opener?.focus()) };
    dialog.close(); render();
  }
  function close() {
    if (phase) return false;
    if (signature() !== baseline && !window.confirm(t('丢弃本次脚本创建设置？编辑器内容不会改变。'))) return false;
    closeDialog(); return true;
  }
  async function apply() {
    if (phase || !owns() || (isStateTable() && (!supportsAnimationStateScript() || !conditionsReady()))) { if (!phase) review(); return; }
    // Programmatic edits must also receive a visible preview before handoff.
    if (!proposal || reviewed !== signature()) { review(); return; }
    const generation = epoch, form = signature(), candidate = proposal, conditionVersion = conditionRevision;
    const isCurrent = () => owns(generation) && form === signature() && proposal === candidate && (!isStateTable() || supportsAnimationStateScript() && conditionsReady() && conditionRevision === conditionVersion);
    phase = true; message = '正在打开脚本草稿…'; render();
    try {
      const result = await createDraft(candidate, { isCurrent });
      if (disposed || generation !== epoch || !dialog.open || form !== signature()) return;
      // A successful editor handoff changes its source token and creating flag.
      // The port checks isCurrent immediately before that synchronous mutation.
      if (result?.applied === true) { closeDialog(typeof result.focus === 'function' ? result.focus : undefined); return; }
      message = '未创建脚本草稿，设置已保留。请检查编辑器状态后重试。';
    } catch {
      if (disposed || generation !== epoch || !dialog.open) return;
      message = '未创建脚本草稿，设置已保留。请检查编辑器状态后重试。';
    } finally {
      if (!disposed && generation === epoch && dialog.open) {
        phase = false;
        if (!owns()) { invalidated = true; proposal = null; message = '工程或编辑器已变化，设置已保留。请返回编辑器后重新打开。'; }
        render();
      }
    }
  }
  function refresh() {
    if (disposed) return;
    if (dialog.open && isStateTable() && (!supportsAnimationStateScript() || !conditionsReady())) {
      proposal = null; reviewed = ''; message = supportsAnimationStateScript() ? capabilityMessage() : '当前核心不支持动画状态表；其他起始脚本仍可使用。';
    }
    if (dialog.open && !owns()) {
      invalidated = true;
      if (!phase) proposal = null;
      message = '工程或编辑器已变化，设置已保留。请返回编辑器后重新打开。';
    }
    render();
  }
  function open() {
    if (dialog.open || !eligible(getContext())) return false;
    const context = coreContext(getContext());
    const documentType = context.documentTypes.find(item => item.id === 'script')?.id || context.documentTypes[0].id;
    const input = { starterId: starters[0].id, documentType, sourcePath: `${context.documentRoot}/scripts/new-script.txt` };
    try { prepareScriptDraft(context, input); } catch { return false; }
    epoch++; owner = { context, signature: JSON.stringify(context) }; opener = document.activeElement;
    phase = false; invalidated = false; pendingFocus = null;
    options(el('Starter'), starters.map(item => [item.id, t(item.label)]), input.starterId);
    options(el('Type'), context.documentTypes.map(item => [item.id, item.label]), input.documentType);
    el('Path').value = input.sourcePath; tableEditor.reset(DEFAULT_ANIMATION_STATE_TABLE); baseline = signature();
    dialog.showModal(); review(); el('Starter').focus(); return true;
  }
  button.addEventListener('click', open);
  for (const field of fields) for (const event of ['input', 'change']) el(field).addEventListener(event, () => { if (!phase) review(); });
  el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', close); el('Cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && ['s', 'enter'].includes(event.key.toLowerCase())) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    if (dialog.open || disposed) return;
    const pending = pendingFocus; pendingFocus = null;
    if (!pending) { epoch++; owner = null; proposal = null; phase = false; dialog.dataset.dirty = 'false'; dialog.setAttribute('aria-busy', 'false'); }
    render();
    if (pending?.epoch === epoch) pending.focus();
  });
  const unsubscribe = onLanguageChange(() => { if (dialog.open && !disposed) renderChoices(); refresh(); });
  refresh();
  return Object.freeze({ open, refresh, dispose() {
    if (disposed) return;
    disposed = true; epoch++; owner = null; proposal = null; phase = false; pendingFocus = null;
    if (typeof unsubscribe === 'function') unsubscribe();
    tableEditor.dispose(); dialog.close(); dialog.remove(); button.remove();
  } });
}
