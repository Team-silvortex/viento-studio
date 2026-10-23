import { supportsStudioCoreAnimationStateConditions, supportsStudioCoreAnimationStateBranches, supportsStudioCoreAnimationStateSelectors, supportsStudioCoreAnimationStateCombinations } from '../../engine/studio-core.mjs';
import { readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal, isAnimationStateScriptProposal } from '../../engine/animation-state-script-edit.mjs';
import { setupAnimationStateScript } from './app-animation-state-script.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// Editing owns a local table and an exact source review. The host alone applies
// a branded proposal to the existing draft; ordinary Save retains file access.
export function setupAnimationStateScriptEdit({ getContext = () => ({}), getSource = async () => null, applyDraft = async () => null } = {}) {
  const actions = document.getElementById('docEditActions');
  if (!actions) return Object.freeze({ open: async () => false, refresh() {}, dispose() {} });
  for (const [id, href] of [['animationStateScriptEditStyle', '/web/animation-state-script-edit.css'], ['animationStateScriptStyle', '/web/animation-state-script.css']]) {
    if (document.getElementById(id)) continue;
    const style = document.createElement('link'); style.id = id; style.rel = 'stylesheet'; style.href = href;
    (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'animationStateScriptEditBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; actions.append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'animationStateScriptEditDialog'; dialog.className = 'animation-state-script-edit-dialog';
  dialog.dataset.vientoCloseGuard = 'true'; dialog.setAttribute('aria-labelledby', 'animationStateScriptEditTitle');
  dialog.innerHTML = `<header><h2 id="animationStateScriptEditTitle" data-i18n="编辑动画状态表"></h2><button id="animationStateScriptEditClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <div class="animation-state-script-edit-body"><p id="animationStateScriptEditPath" class="script-create-note"></p><div id="animationStateScriptEditFields"></div>
      <section id="animationStateScriptEditReview" hidden aria-labelledby="animationStateScriptEditReviewTitle"><h3 id="animationStateScriptEditReviewTitle" data-i18n="审阅状态表脚本修改"></h3>
        <div id="animationStateScriptEditParameters" hidden><p data-i18n="状态标识变化会改变 clip_ 参数；已有行为绑定不会自动迁移。请检查以下参数变化，并在保存后调整行为参数。"></p>
          <p id="animationStateScriptEditAdded"></p><p id="animationStateScriptEditRemoved"></p></div>
        <h4 data-i18n="修改前原文"></h4><pre id="animationStateScriptEditBefore" tabindex="0"></pre><h4 data-i18n="修改后原文"></h4><pre id="animationStateScriptEditAfter" tabindex="0"></pre>
      </section></div>
    <p id="animationStateScriptEditStatus" role="status" aria-live="polite"></p>
    <footer><p class="script-create-note" data-i18n="应用只更新原文草稿；仍需在编辑器保存。"></p><div>
      <button id="animationStateScriptEditCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查并生成脚本"></button>
      <button id="animationStateScriptEditApply" type="button" class="doc-btn" data-i18n="应用到原文草稿"></button>
      <button id="animationStateScriptEditCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消修改"></button></div></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector('#animationStateScriptEdit' + suffix);
  let disposed = false, epoch = 0, session = null, initial = '', proposal = null, approval = '', pending = false, invalidated = false, message = '', opener = null;
  const eligible = context => context.editable === true && context.sourceTXT === true && context.stateTableSource === true && !context.creating
    && typeof context.sourcePath === 'string' && context.sourcePath.length > 0 && typeof context.sourceToken === 'string' && context.sourceToken.length > 0;
  const current = () => {
    const context = getContext();
    return !disposed && dialog.open && session && !invalidated && eligible(context) && context.available === true && !context.busy
      && context.sourcePath === session.source.sourcePath && context.sourceToken === session.source.token;
  };
  const tableEditor = setupAnimationStateScript({ container: el('Fields'), idPrefix: 'animationStateScriptEditTable', mode: 'edit', translate: t,
    getContext: () => ({ active: Boolean(session) && dialog.open, disabled: pending || !current(), available: getContext().available === true }),
    onChange: () => { if (!pending && current()) { invalidate(); refresh(); } },
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
  const signature = () => JSON.stringify(tableEditor.getValue());
  const dirty = () => Boolean(session && signature() !== initial);
  const approved = () => current() && conditionsReady() && proposal && approval === signature();
  function invalidate() { proposal = null; approval = ''; message = '状态表已变化，请检查并审阅脚本后应用。'; }
  function refresh() {
    if (disposed) return;
    const context = getContext(); button.textContent = t('编辑动画状态表'); button.hidden = !eligible(context); button.disabled = context.available !== true || Boolean(context.busy) || dialog.open;
    if (!dialog.open) return;
    if (session && !current()) { invalidated = true; if (!pending) { proposal = null; approval = ''; } message = '脚本原文或编辑器已变化，请返回后重新打开状态表。'; }
    if (current() && !conditionsReady()) { proposal = null; approval = ''; message = capabilityMessage(); }
    if (!pending && current() && proposal && !approved()) invalidate();
    translatePage(dialog); tableEditor.refresh(); dialog.dataset.dirty = String(dirty()); dialog.setAttribute('aria-busy', String(pending));
    el('Fields').hidden = !session;
    el('Path').textContent = session?.source.sourcePath || context.sourcePath || '';
    el('Status').textContent = t(message);
    el('Check').disabled = pending || !current() || !conditionsReady(); el('Apply').disabled = pending || !approved();
    el('Review').hidden = !proposal; el('Before').textContent = proposal?.beforeContent || ''; el('After').textContent = proposal?.afterContent || '';
    const before = new Set(proposal?.beforeParameters.map(item => item.name) || []), after = new Set(proposal?.afterParameters.map(item => item.name) || []);
    const added = [...after].filter(name => !before.has(name)), removed = [...before].filter(name => !after.has(name));
    el('Parameters').hidden = !added.length && !removed.length;
    el('Added').textContent = added.length ? t('新增片段参数：{0}', added.join(', ')) : '';
    el('Removed').textContent = removed.length ? t('移除片段参数：{0}', removed.join(', ')) : '';
  }
  function close(force = false) {
    if (!force && dirty() && !window.confirm(t('丢弃本次状态表修改？原文草稿不会改变。'))) return false;
    const target = opener, request = ++epoch; opener = null; session = null; proposal = null; approval = ''; pending = false; initial = ''; invalidated = false; message = '';
    dialog.dataset.dirty = 'false'; dialog.setAttribute('aria-busy', 'false'); if (dialog.open) dialog.close(); refresh();
    Promise.resolve().then(() => { if (!disposed && epoch === request && !dialog.open) target?.focus?.(); }); return true;
  }
  function readFailure(error) {
    const code = error?.errorCode || error?.code;
    return code === 'animation_state_script_source_limit' ? '生成脚本超过 64 KiB，请缩短条件文本或减少转换。'
      : code === 'animation_state_script_source_modified' ? '源码已手动修改，不能用状态表覆盖。请继续在原文编辑器修改。'
      : code === 'animation_state_script_source_unsupported' ? '此状态表声明版本暂不支持，原文保持不变。'
        : code === 'studio_core_unavailable' ? '当前核心不支持动画状态表；普通源码编辑仍可使用。'
          : '无法读取有效状态表声明，原文保持不变。';
  }
  async function open() {
    const context = { ...getContext() }; if (disposed || dialog.open || !eligible(context) || context.available !== true || context.busy) return false;
    const request = ++epoch; invalidated = false; opener = document.activeElement; pending = true; message = '正在读取脚本状态表…'; dialog.showModal(); refresh();
    const owns = () => { const next = getContext(); return !disposed && dialog.open && epoch === request && eligible(next) && next.available === true && !next.busy
      && context.sourcePath === next.sourcePath && context.sourceToken === next.sourceToken; };
    try {
      const source = await getSource(); if (!owns()) return false;
      const keys = ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision'];
      if (!source || typeof source !== 'object' || Reflect.ownKeys(source).length !== keys.length) throw Error('source');
      const descriptors = Object.getOwnPropertyDescriptors(source);
      if (keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('source');
      const captured = Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key].value])));
      if (captured.sourcePath !== context.sourcePath || captured.token !== context.sourceToken || captured.sourceRevision.length !== 71 || captured.baseSourceRevision.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(captured.sourceRevision)
        || !/^sha256:[a-f0-9]{64}$/.test(captured.baseSourceRevision)) throw Error('source');
      const model = readAnimationStateScriptSource(captured.content); if (!owns()) return false;
      session = { source: captured }; tableEditor.reset(model.table); initial = signature(); message = '修改状态与转换，检查后审阅完整脚本。'; return true;
    } catch (error) { if (owns()) message = readFailure(error); return false; }
    finally { if (!disposed && epoch === request && dialog.open) { pending = false; if (!owns()) message = '脚本原文或编辑器已变化，请返回后重新打开状态表。'; refresh(); } }
  }
  async function check() {
    if (pending || !current() || !conditionsReady()) return false;
    const owner = session, request = epoch, form = signature(), conditionVersion = conditionRevision; invalidate(); pending = true; message = '正在检查状态表脚本…'; refresh();
    const owns = () => epoch === request && session === owner && current() && conditionsReady() && conditionRevision === conditionVersion && signature() === form;
    try {
      const candidate = await createAnimationStateScriptProposal(owner.source, tableEditor.getValue()); if (!owns()) return false;
      if (!isAnimationStateScriptProposal(candidate) || candidate.sourcePath !== owner.source.sourcePath || candidate.sourceToken !== owner.source.token
        || candidate.beforeContent !== owner.source.content) throw Error('proposal');
      proposal = candidate; approval = form; message = '请审阅完整前后源码与片段参数变化，再应用到原文草稿。'; return true;
    } catch (error) {
      if (owns()) message = (error?.errorCode || error?.code) === 'animation_state_script_source_limit' ? '生成脚本超过 64 KiB，请缩短条件文本或减少转换。'
        : (error?.errorCode || error?.code) === 'animation_state_condition_invalid' ? '请检查事件载荷条件的类型、比较方式和比较值。'
          : (error?.errorCode || error?.code) === 'animation_state_table_invalid' && hasCombinations() ? '请检查状态、转换及组合条件：每组需要 1–8 项有效条件，不支持空组、嵌套或无条件项。'
          : (error?.errorCode || error?.code) === 'animation_state_table_invalid' && hasSelectors() ? '请检查状态标识、转换、共享状态键以及条件的类型、比较方式和比较值。'
          : error?.errorCode === 'animation_state_script_authoring_unchanged' ? '状态表没有变化，原文草稿未修改。' : '状态表脚本未通过检查，输入已保留。';
      return false;
    } finally {
      if (!disposed && epoch === request && session === owner && dialog.open) {
        pending = false; if (current() && signature() !== form) message = '状态表已变化，请检查并审阅脚本后应用。'; refresh();
      }
    }
  }
  async function apply() {
    if (pending || !approved()) return false;
    const owner = session, request = epoch, candidate = proposal, form = approval, conditionVersion = conditionRevision;
    const owns = () => !disposed && dialog.open && epoch === request && session === owner;
    const unchanged = () => owns() && current() && conditionsReady() && conditionRevision === conditionVersion && proposal === candidate && signature() === form;
    pending = true; message = '正在应用状态表脚本到原文草稿…'; refresh();
    try {
      const result = await applyDraft(candidate, { isCurrent: unchanged }); if (!owns()) return false;
      const context = getContext();
      if (proposal !== candidate || signature() !== form || result?.applied !== true || result.sourcePath !== owner.source.sourcePath || result.content !== candidate.afterContent
        || typeof result.sourceToken !== 'string' || result.sourceToken === owner.source.token || !eligible(context) || context.available !== true || context.busy
        || context.sourcePath !== result.sourcePath || context.sourceToken !== result.sourceToken) throw Error('result');
      opener = null; close(true); result.focus?.(); return true;
    } catch { if (owns()) { proposal = null; approval = ''; message = '状态表脚本未确认应用，输入已保留。'; } return false; }
    finally { if (owns()) { pending = false; refresh(); } }
  }
  button.addEventListener('click', () => void open()); el('Check').addEventListener('click', () => void check()); el('Apply').addEventListener('click', () => void apply());
  el('Close').addEventListener('click', () => close()); el('Cancel').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!event.isComposing && !event.repeat) close(); });
  dialog.addEventListener('keydown', event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && ['s', 'enter'].includes(event.key.toLowerCase())) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!dialog.open && !disposed && (session || pending)) close(true); });
  const unsubscribe = onLanguageChange(refresh); refresh();
  return Object.freeze({ open, refresh, dispose() {
    if (disposed) return; disposed = true; epoch++; session = null; proposal = null; pending = false;
    if (typeof unsubscribe === 'function') unsubscribe(); tableEditor.dispose(); dialog.close(); dialog.remove(); button.remove();
  } });
}
