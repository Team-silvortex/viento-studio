import { detectSourceIndentation, planSourceIndentation } from '../../engine/source-indentation.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// The source editor keeps ownership of input, dirty state, Save and undo. This
// control only plans a text replacement and asks the browser to perform it.
export function setupSourceIndentation({ textarea, container, getContext = () => ({}) } = {}) {
  if (!textarea || !container) return Object.freeze({ refresh() {}, dispose() {} });
  const document = textarea.ownerDocument;
  if (!document.getElementById('sourceIndentStyle')) {
    const style = document.createElement('link');
    style.id = 'sourceIndentStyle'; style.rel = 'stylesheet'; style.href = '/web/source-indentation.css';
    (document.head || document.body).append(style);
  }
  const toolbar = document.createElement('div');
  toolbar.id = 'sourceIndentToolbar'; toolbar.className = 'source-indent-toolbar';
  toolbar.innerHTML = `<label for="sourceIndentUnit" id="sourceIndentLabel"></label><select id="sourceIndentUnit"><option value="tab"></option><option value="spaces-2"></option><option value="spaces-4"></option></select><button id="sourceIndent" type="button" class="doc-btn doc-btn-ghost"></button><button id="sourceOutdent" type="button" class="doc-btn doc-btn-ghost"></button><span id="sourceIndentStatus" role="status" aria-live="polite"></span>`;
  container.prepend(toolbar);
  container.classList.add('source-indentation-container');
  const unit = toolbar.querySelector('#sourceIndentUnit');
  const indentButton = toolbar.querySelector('#sourceIndent');
  const outdentButton = toolbar.querySelector('#sourceOutdent');
  const status = toolbar.querySelector('#sourceIndentStatus');
  const units = ['tab', 'spaces-2', 'spaces-4'];
  let disposed = false, composing = false, executing = false, token, message = '';
  unit.value = 'spaces-4';
  const available = context => !disposed && !composing && context.editable === true
    && typeof context.sourceToken === 'string' && context.sourceToken.length > 0
    && textarea.isConnected && container.isConnected && !textarea.readOnly && !textarea.disabled
    && !document.querySelector('dialog[open]');
  function refresh() {
    if (disposed) return;
    const context = getContext(), enabled = available(context);
    // A loading session may still contain the previous document's text.
    if (enabled && token !== context.sourceToken) {
      token = context.sourceToken; message = '';
      try { unit.value = detectSourceIndentation(textarea.value); } catch { unit.value = 'spaces-4'; }
    }
    toolbar.hidden = context.editable !== true;
    toolbar.setAttribute('aria-label', t('原文缩进'));
    toolbar.querySelector('#sourceIndentLabel').textContent = t('缩进单位');
    const labels = ['制表符', '2 个空格', '4 个空格'];
    for (let index = 0; index < units.length; index++) unit.options[index].textContent = t(labels[index]);
    indentButton.textContent = t('增加缩进'); outdentButton.textContent = t('减少缩进');
    indentButton.title = t('增加缩进（Ctrl / ⌘ + ]）'); outdentButton.title = t('减少缩进（Ctrl / ⌘ + [）');
    for (const control of [unit, indentButton, outdentButton]) control.disabled = !enabled || executing;
    status.textContent = t(message);
  }
  const snapshot = () => ({ start: textarea.selectionStart, end: textarea.selectionEnd,
    direction: textarea.selectionDirection, top: textarea.scrollTop, left: textarea.scrollLeft });
  function select(start, end, direction, saved) {
    textarea.setSelectionRange(start, end, direction);
    textarea.scrollTop = saved.top; textarea.scrollLeft = saved.left;
  }
  function perform(action, event) {
    if (executing || event?.isComposing || event?.keyCode === 229) return false;
    refresh();
    const context = getContext();
    if (!available(context) || !units.includes(unit.value)) return false;
    const text = textarea.value, saved = snapshot(), sourceToken = context.sourceToken;
    let plan;
    try {
      plan = planSourceIndentation({ text, selectionStart: saved.start, selectionEnd: saved.end,
        selectionDirection: saved.direction, action, indent: unit.value });
    } catch {
      message = '当前原文无法执行缩进，请检查文本与选区。'; refresh(); return false;
    }
    if (!plan.changed) return false;
    const owns = () => {
      const current = getContext();
      return available(current) && current.sourceToken === sourceToken && textarea.value === text;
    };
    if (!owns()) { refresh(); return false; }
    textarea.focus({ preventScroll: true });
    if (!owns()) { refresh(); return false; }
    select(plan.start, plan.end, 'forward', saved);
    const expected = text.slice(0, plan.start) + plan.replacement + text.slice(plan.end);
    let sawInput = false;
    const observeInput = () => { sawInput = true; };
    textarea.addEventListener('input', observeInput);
    executing = true;
    try {
      // One native replacement forms one undoable operation. Never retry with
      // .value or setRangeText, which would discard the browser's undo history.
      try { document.execCommand('insertText', false, plan.replacement); } catch { /* Report below without retrying. */ }
      const actual = textarea.value;
      if (actual === text) {
        select(saved.start, saved.end, saved.direction, saved);
        message = '当前浏览器无法保留撤销记录，未执行缩进。';
        return false;
      }
      if (actual === expected) {
        select(plan.selectionStart, plan.selectionEnd, plan.selectionDirection, saved);
        message = '';
      } else {
        textarea.scrollTop = saved.top; textarea.scrollLeft = saved.left;
        message = '缩进未能完整应用，请检查原文或撤销后重试。';
      }
      // Some hosts apply insertText without emitting input. Keep the existing
      // editor informed without adding another event when native input fired.
      if (!sawInput) textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return actual === expected;
    } finally {
      textarea.removeEventListener('input', observeInput);
      executing = false; refresh();
    }
  }
  const indent = event => perform('indent', event);
  const outdent = event => perform('outdent', event);
  const keepSelection = event => { if (!composing && event.button === 0) event.preventDefault(); };
  const keydown = event => {
    if (event.target !== textarea || event.defaultPrevented || event.isComposing || event.keyCode === 229
      || composing || executing || event.repeat || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)
      || !['[', ']'].includes(event.key) || !available(getContext())) return;
    event.preventDefault(); event.stopPropagation();
    perform(event.key === ']' ? 'indent' : 'outdent', event);
  };
  const compositionStart = () => { composing = true; refresh(); };
  const compositionEnd = () => { composing = false; refresh(); };
  const input = () => { if (!executing) { message = ''; refresh(); } };
  const changeUnit = () => { if (!units.includes(unit.value)) unit.value = 'spaces-4'; message = ''; refresh(); };
  indentButton.addEventListener('pointerdown', keepSelection); outdentButton.addEventListener('pointerdown', keepSelection);
  indentButton.addEventListener('click', indent); outdentButton.addEventListener('click', outdent);
  unit.addEventListener('change', changeUnit);
  textarea.addEventListener('keydown', keydown); textarea.addEventListener('input', input);
  textarea.addEventListener('focus', refresh);
  document.addEventListener?.('close', refresh, true);
  textarea.addEventListener('compositionstart', compositionStart); textarea.addEventListener('compositionend', compositionEnd);
  const unsubscribe = onLanguageChange(refresh);
  refresh();
  return Object.freeze({ refresh, dispose() {
    if (disposed) return;
    disposed = true;
    if (typeof unsubscribe === 'function') unsubscribe();
    textarea.removeEventListener('keydown', keydown); textarea.removeEventListener('input', input);
    textarea.removeEventListener('focus', refresh);
    document.removeEventListener?.('close', refresh, true);
    textarea.removeEventListener('compositionstart', compositionStart); textarea.removeEventListener('compositionend', compositionEnd);
    indentButton.removeEventListener('pointerdown', keepSelection); outdentButton.removeEventListener('pointerdown', keepSelection);
    indentButton.removeEventListener('click', indent); outdentButton.removeEventListener('click', outdent);
    unit.removeEventListener('change', changeUnit);
    toolbar.remove(); container.classList.remove('source-indentation-container');
  } });
}
