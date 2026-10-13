import { revealSourceOffset } from './app-source-reveal.js';
import { createSourceLineIndex } from '../../engine/source-position.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

export function setupSourcePosition({ textarea, container, getContext = () => ({}) } = {}) {
  if (!textarea || !container) return Object.freeze({ refresh() {}, dispose() {} });
  const document = textarea.ownerDocument;
  if (!document.getElementById('sourcePositionStyle')) {
    const style = document.createElement('link');
    style.id = 'sourcePositionStyle'; style.rel = 'stylesheet'; style.href = '/web/source-position.css';
    (document.head || document.body).append(style);
  }
  const bar = document.createElement('div');
  bar.id = 'sourcePositionBar'; bar.className = 'source-position-bar';
  bar.innerHTML = '<span id="sourcePositionText"></span><button id="sourcePositionOpen" type="button" class="doc-btn doc-btn-ghost"></button>';
  container.append(bar); container.classList.add('source-position-container');
  const textLabel = bar.querySelector('#sourcePositionText'), openButton = bar.querySelector('#sourcePositionOpen');
  const dialog = document.createElement('dialog');
  dialog.id = 'sourcePositionDialog'; dialog.className = 'source-position-dialog';
  dialog.setAttribute('aria-labelledby', 'sourcePositionTitle');
  dialog.innerHTML = '<form id="sourcePositionForm" novalidate><h2 id="sourcePositionTitle"></h2><label for="sourcePositionLine" id="sourcePositionLabel"></label><input id="sourcePositionLine" type="number" min="1" step="1" inputmode="numeric" aria-describedby="sourcePositionHint sourcePositionStatus" required><p id="sourcePositionHint"></p><p id="sourcePositionStatus" role="status" aria-live="polite"></p><div class="source-position-actions"><button id="sourcePositionCancel" type="button" class="doc-btn doc-btn-ghost"></button><button id="sourcePositionGo" type="submit" class="doc-btn"></button></div></form>';
  document.body.append(dialog);
  const form = dialog.querySelector('#sourcePositionForm'), lineInput = dialog.querySelector('#sourcePositionLine');
  const go = dialog.querySelector('#sourcePositionGo'), cancel = dialog.querySelector('#sourcePositionCancel');
  const status = dialog.querySelector('#sourcePositionStatus');
  let disposed = false, composing = false, inputComposing = false, session = null;
  let cachedText, cachedIndex, message = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const foreignModal = () => [...document.querySelectorAll('dialog[open]')].some(node => node !== dialog);
  const available = current => !disposed && current.editable === true
    && typeof current.sourceToken === 'string' && current.sourceToken.length > 0
    && textarea.isConnected && container.isConnected && !textarea.readOnly && !textarea.disabled && !foreignModal();
  function index() {
    const value = textarea.value;
    if (value !== cachedText) {
      cachedText = value; cachedIndex = null;
      try { cachedIndex = createSourceLineIndex(value); } catch { /* Unsupported source stays editable. */ }
    }
    return cachedIndex;
  }
  const activeOffset = () => textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd;
  const owns = saved => {
    const current = context();
    return saved && !saved.stale && available(current) && current.sourceToken === saved.token && textarea.value === saved.text;
  };
  function refresh() {
    if (disposed) return;
    const current = context(), sourceIndex = index();
    bar.hidden = current.editable !== true;
    bar.setAttribute('aria-label', t('原文位置'));
    openButton.textContent = t('跳转到行'); openButton.title = t('跳转到行（Ctrl / ⌘ + G）');
    openButton.disabled = !available(current) || composing || Boolean(session) || !sourceIndex;
    if (sourceIndex) {
      const position = sourceIndex.position(activeOffset());
      textLabel.textContent = t('第 {0} 行，第 {1} 列 · 共 {2} 行', position.line, position.column, sourceIndex.lineCount);
    } else textLabel.textContent = t('当前原文无法显示位置。');
    dialog.querySelector('#sourcePositionTitle').textContent = t('跳转到行');
    dialog.querySelector('#sourcePositionLabel').textContent = t('目标行号');
    go.textContent = t('跳转'); cancel.textContent = t('取消');
    if (session && !owns(session)) session.stale = true;
    dialog.querySelector('#sourcePositionHint').textContent = session
      ? t('请输入 1 到 {0} 之间的整数行号。', session.index.lineCount) : '';
    go.disabled = !session || session.stale || composing || inputComposing;
    status.textContent = t(session?.stale ? '原文或编辑会话已变化，请关闭后重新跳转。' : message);
  }
  function open(event) {
    if (event?.isComposing || event?.keyCode === 229 || composing || session) return false;
    const current = context(), sourceIndex = index();
    if (!available(current) || !sourceIndex) { refresh(); return false; }
    session = { token: current.sourceToken, text: textarea.value, index: sourceIndex,
      start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection,
      top: textarea.scrollTop, left: textarea.scrollLeft, stale: false };
    message = ''; inputComposing = false;
    lineInput.value = String(sourceIndex.position(activeOffset()).line);
    lineInput.max = String(sourceIndex.lineCount);
    refresh();
    try { dialog.showModal(); } catch { session = null; refresh(); return false; }
    lineInput.focus(); lineInput.select();
    return true;
  }
  function finish(line = null) {
    const saved = session;
    if (!saved) return false;
    if (line !== null && !owns(saved)) { saved.stale = true; refresh(); return false; }
    session = null; message = ''; inputComposing = false;
    dialog.close();
    // Closing/focusing can synchronously switch documents through other host
    // listeners. Recheck after both before applying any selection or scroll.
    if (owns(saved)) {
      textarea.focus({ preventScroll: true });
      if (owns(saved)) {
        if (line === null) {
          textarea.setSelectionRange(saved.start, saved.end, saved.direction);
          textarea.scrollTop = saved.top; textarea.scrollLeft = saved.left;
        } else {
          const offset = saved.index.lineRange(line).start;
          textarea.setSelectionRange(offset, offset, 'none');
          try { revealSourceOffset(textarea, saved.text, offset); } catch { /* Native caret navigation remains available. */ }
        }
      }
    }
    refresh(); return true;
  }
  function submit(event) {
    event?.preventDefault(); event?.stopPropagation();
    if (disposed || !session || composing || inputComposing || event?.isComposing || event?.keyCode === 229 || event?.repeat) return;
    const value = lineInput.value, line = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(line) || line > session.index.lineCount) {
      message = '请输入范围内的整数行号。'; refresh(); return;
    }
    finish(line);
  }
  const cancelSession = event => { event?.preventDefault(); finish(); };
  const closed = () => { if (!dialog.open && session) finish(); };
  const keepSelection = event => { if (!composing && event.button === 0) event.preventDefault(); };
  const keydown = event => {
    if (event.target !== textarea || event.defaultPrevented || event.isComposing || event.keyCode === 229
      || composing || event.repeat || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)
      || event.key?.toLowerCase() !== 'g' || !available(context()) || !index()) return;
    event.preventDefault(); event.stopPropagation(); open(event);
  };
  const dialogKey = event => {
    if (event.key !== 'Enter') return;
    // Prevent an IME confirmation or key repeat from becoming form submission,
    // including when the submit button itself has keyboard focus.
    if (event.isComposing || event.keyCode === 229 || event.repeat || inputComposing) {
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (event.target !== lineInput) return;
    const prevented = event.defaultPrevented;
    event.preventDefault(); event.stopPropagation();
    if (!prevented) submit(event);
  };
  const compositionStart = () => { composing = true; refresh(); };
  const compositionEnd = () => { composing = false; refresh(); };
  const inputCompositionStart = () => { inputComposing = true; refresh(); };
  const inputCompositionEnd = () => { inputComposing = false; refresh(); };
  const input = () => { message = ''; refresh(); };
  const selectionChanged = () => { if (document.activeElement === textarea) refresh(); };
  openButton.addEventListener('pointerdown', keepSelection); openButton.addEventListener('click', open);
  cancel.addEventListener('click', cancelSession); form.addEventListener('submit', submit);
  dialog.addEventListener('cancel', cancelSession); dialog.addEventListener('close', closed); dialog.addEventListener('keydown', dialogKey);
  lineInput.addEventListener('input', input); lineInput.addEventListener('compositionstart', inputCompositionStart); lineInput.addEventListener('compositionend', inputCompositionEnd);
  textarea.addEventListener('keydown', keydown); textarea.addEventListener('compositionstart', compositionStart); textarea.addEventListener('compositionend', compositionEnd);
  for (const type of ['input', 'select', 'keyup', 'click', 'focus']) textarea.addEventListener(type, refresh);
  document.addEventListener?.('selectionchange', selectionChanged, true); document.addEventListener?.('close', refresh, true);
  const unsubscribe = onLanguageChange(refresh);
  refresh();
  return Object.freeze({ refresh, dispose() {
    if (disposed) return;
    disposed = true; session = null;
    if (typeof unsubscribe === 'function') unsubscribe();
    openButton.removeEventListener('pointerdown', keepSelection); openButton.removeEventListener('click', open);
    cancel.removeEventListener('click', cancelSession); form.removeEventListener('submit', submit);
    dialog.removeEventListener('cancel', cancelSession); dialog.removeEventListener('close', closed); dialog.removeEventListener('keydown', dialogKey);
    lineInput.removeEventListener('input', input); lineInput.removeEventListener('compositionstart', inputCompositionStart); lineInput.removeEventListener('compositionend', inputCompositionEnd);
    textarea.removeEventListener('keydown', keydown); textarea.removeEventListener('compositionstart', compositionStart); textarea.removeEventListener('compositionend', compositionEnd);
    for (const type of ['input', 'select', 'keyup', 'click', 'focus']) textarea.removeEventListener(type, refresh);
    document.removeEventListener?.('selectionchange', selectionChanged, true); document.removeEventListener?.('close', refresh, true);
    dialog.close(); dialog.remove(); bar.remove(); container.classList.remove('source-position-container');
  } });
}
