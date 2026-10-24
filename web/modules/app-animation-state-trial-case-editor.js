import { parseAnimationStateTrialCase, ANIMATION_STATE_TRIAL_CASE_LIMITS } from '../../engine/animation-state-trial-case.mjs';
import { isComposingInput } from './app-keyboard.js';

// Checking only admits a local case definition. Applying never changes author
// data or the manual path, executes a runtime or replays a case by itself.
export function setupAnimationStateTrialCaseEditor({ container, idPrefix = 'animationStateTrialCaseEditor', getContext = () => ({}), onApply = () => false, onStateChange = () => {}, translate = value => value } = {}) {
  const document = container.ownerDocument;
  if (!document.getElementById('animationStateTrialCaseEditorStyle')) {
    const link = document.createElement('link'); link.id = 'animationStateTrialCaseEditorStyle'; link.rel = 'stylesheet'; link.href = '/web/animation-state-trial-case-editor.css'; (document.head || document.body).append(link);
  }
  container.innerHTML = `<section id="${idPrefix}Panel" class="animation-state-trial-case-editor" hidden aria-labelledby="${idPrefix}Title">
    <h4 id="${idPrefix}Title"></h4><p id="${idPrefix}Note" class="script-create-note"></p>
    <label for="${idPrefix}Text" id="${idPrefix}TextLabel"></label><textarea id="${idPrefix}Text" rows="16" wrap="soft" spellcheck="false" aria-describedby="${idPrefix}Note ${idPrefix}Bytes ${idPrefix}Status"></textarea>
    <p id="${idPrefix}Bytes" class="script-create-note"></p><p id="${idPrefix}Status" role="status" aria-live="polite"></p><p id="${idPrefix}Error" role="alert" hidden></p>
    <div class="animation-state-trial-case-editor-actions"><button id="${idPrefix}Check" type="button" class="doc-btn"></button><button id="${idPrefix}Apply" type="button" class="doc-btn"></button><button id="${idPrefix}Cancel" type="button" class="doc-btn doc-btn-ghost"></button></div></section>`;
  const el = suffix => container.querySelector('#' + idPrefix + suffix), text = (key, ...args) => translate(key, ...args), encoder = new TextEncoder();
  let disposed = false, opened = false, owner = null, initialText = '', revision = 0, epoch = 0, approval = null, error = '', stale = false, measuredText = null, measuredBytes = 0;
  const context = () => getContext(), visible = value => !disposed && value.active === true && value.visible !== false;
  const usable = value => opened && visible(value) && value.disabled !== true;
  const dirty = () => opened && el('Text').value !== initialText;
  function revoke(changed = false) { if (approval) approval.revoked = true; approval = null; epoch++; stale = stale || changed; }
  function clear() { revoke(); opened = false; owner = null; initialText = ''; revision++; error = ''; stale = false; el('Text').value = ''; measuredText = null; }
  function notify(reason) { onStateChange({ open: opened, dirty: dirty(), reason }); }
  function current(ticket) {
    if (!ticket || ticket.revoked) return false;
    if (!usable(context()) || ticket !== approval || ticket.owner !== owner || ticket.epoch !== epoch || ticket.revision !== revision || ticket.text !== el('Text').value) { ticket.revoked = true; return false; }
    return true;
  }
  function measure() {
    const raw = el('Text').value;
    if (raw === measuredText) return; measuredText = raw;
    // Bound encoding allocation, without truncating oversized input.
    measuredBytes = raw.length > ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes ? null : encoder.encode(raw).length;
  }
  function render() {
    el('Panel').hidden = !opened; if (!opened) return;
    const value = context(), on = usable(value), checked = current(approval); measure();
    el('Title').textContent = text('编辑试算用例 JSON'); el('Note').textContent = text('检查只验证用例定义；应用会替换载入用例并清除旧回放，仍需明确重跑。不会修改作者状态表、当前手动路径或源码草稿。');
    el('TextLabel').textContent = text('用例 JSON 草稿'); el('Check').textContent = text('检查 JSON'); el('Apply').textContent = text('应用用例'); el('Cancel').textContent = text('取消编辑');
    el('Bytes').textContent = measuredBytes === null ? text('原文超过 {0} UTF-8 字节；输入仍保留。', ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes) : text('原文 {0}/{1} UTF-8 字节 · 最多 32 步、64 KiB 样本。', measuredBytes, ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes);
    el('Text').disabled = !on; el('Check').disabled = !on; el('Apply').disabled = !checked; el('Cancel').disabled = !visible(value);
    el('Status').textContent = checked ? text('定义检查通过：起始状态 {0} · {1} 步。尚未应用或重跑。', approval.value.initialStateKey, approval.value.steps.length) : text(stale ? '草稿或编辑权限已变化，请重新检查后应用。' : '修改 JSON 后检查，再明确应用；取消会保留原载入用例。');
    el('Error').hidden = !error; el('Error').textContent = error ? text(error) : ''; el('Text').setAttribute('aria-invalid', String(Boolean(error)));
  }
  function refresh() {
    if (disposed) return;
    const value = context();
    if (value.active !== true) clear();
    else if (opened && (!visible(value) || value.disabled === true)) revoke(Boolean(approval));
    else if (approval && !current(approval)) revoke(true);
    render();
  }
  function cancel() { if (!opened || !visible(context())) return false; clear(); render(); notify('cancelled'); return true; }
  el('Text').addEventListener('input', () => { if (!usable(context())) return; revision++; revoke(true); error = ''; render(); notify('changed'); });
  el('Check').addEventListener('click', () => {
    if (!usable(context())) return;
    revoke(); error = ''; const raw = el('Text').value, ticket = { owner, revision, epoch, text: raw, value: null };
    try { ticket.value = parseAnimationStateTrialCase(raw); approval = ticket; if (!current(ticket)) { revoke(true); render(); return; } stale = false; }
    catch (cause) { error = cause?.errorCode === 'animation_state_trial_case_limit' ? '用例超过 128 KiB 原文、32 步或 64 KiB 样本限制；输入已保留。' : '用例 JSON、版本或字段无效；输入已保留，请修正后重新检查。'; }
    render(); notify('checked');
  });
  el('Apply').addEventListener('click', () => {
    const ticket = approval; if (!current(ticket)) { if (opened) { revoke(true); render(); } return; }
    try {
      if (onApply(ticket.value, { text: ticket.text, owner: ticket.owner, isCurrent: () => current(ticket) }) !== true) { error = '用例未应用，编辑内容已保留。请检查编辑会话后重试。'; render(); return; }
      clear(); render(); notify('applied');
    } catch { error = '用例未应用，编辑内容已保留。请检查编辑会话后重试。'; render(); }
  });
  el('Cancel').addEventListener('click', cancel);
  container.addEventListener('keydown', event => {
    if (!opened) return;
    const composing = isComposingInput(event);
    // WebKit can derive a dialog cancel without the keyboard composition flag.
    if (event.key === 'Escape' && visible(context())) { event.preventDefault(); event.stopPropagation(); if (!composing && !event.repeat) cancel(); }
    else if (!composing && (event.ctrlKey || event.metaKey) && ['s', 'enter'].includes(String(event.key).toLowerCase())) { event.preventDefault(); event.stopPropagation(); }
  });
  return Object.freeze({ open({ text: raw, owner: nextOwner } = {}) {
    if (disposed || opened || !visible(context()) || context().disabled === true || typeof raw !== 'string' || nextOwner === null || nextOwner === undefined) return false;
    clear(); opened = true; owner = nextOwner; initialText = raw; el('Text').value = raw; render(); notify('opened'); el('Text').focus({ preventScroll: true }); return true;
  }, isOpen: () => opened, isDirty: dirty, refresh,
  reset() { if (disposed) return; clear(); el('Panel').hidden = true; },
  dispose() { if (disposed) return; clear(); disposed = true; container.replaceChildren(); },
  });
}
