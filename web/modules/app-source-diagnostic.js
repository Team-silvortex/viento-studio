import { createSourceDiagnosticSnapshot } from '../../engine/source-diagnostic.mjs';
import { createSourceLineIndex } from '../../engine/source-position.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// Build results are observations of one source revision. This panel never
// revalidates source or treats editing/undo as evidence that an issue is fixed.
export function setupSourceDiagnostic({ textarea, container, getContext = () => ({}) } = {}) {
  if (!textarea || !container) return Object.freeze({ show: () => false, refresh() {}, clear() {}, dispose() {} });
  const document = textarea.ownerDocument;
  if (!document.getElementById('sourceDiagnosticStyle')) {
    const style = document.createElement('link');
    style.id = 'sourceDiagnosticStyle'; style.rel = 'stylesheet'; style.href = '/web/source-diagnostic.css';
    (document.head || document.body).append(style);
  }
  const panel = document.createElement('section');
  panel.id = 'sourceDiagnosticPanel'; panel.className = 'source-diagnostic-panel';
  panel.setAttribute('aria-labelledby', 'sourceDiagnosticTitle');
  panel.innerHTML = '<div class="source-diagnostic-heading"><strong id="sourceDiagnosticTitle"></strong><button id="sourceDiagnosticDismiss" type="button" class="doc-btn doc-btn-ghost"></button></div><p id="sourceDiagnosticMessage"></p><p id="sourceDiagnosticLocation"></p><p id="sourceDiagnosticState" role="status" aria-live="polite"></p><details id="sourceDiagnosticDetails"><summary id="sourceDiagnosticDetailsLabel"></summary><code id="sourceDiagnosticCode"></code><pre id="sourceDiagnosticDetailText"></pre></details>';
  container.append(panel); container.classList.add('source-diagnostic-container');
  const title = panel.querySelector('#sourceDiagnosticTitle'), message = panel.querySelector('#sourceDiagnosticMessage');
  const location = panel.querySelector('#sourceDiagnosticLocation'), state = panel.querySelector('#sourceDiagnosticState');
  const details = panel.querySelector('#sourceDiagnosticDetails'), code = panel.querySelector('#sourceDiagnosticCode');
  const detailText = panel.querySelector('#sourceDiagnosticDetailText'), dismiss = panel.querySelector('#sourceDiagnosticDismiss');
  let disposed = false, session = null;
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const available = current => !disposed && current.visible === true && typeof current.sourceToken === 'string'
    && current.sourceToken.length > 0 && textarea.isConnected && container.isConnected;
  const owns = saved => {
    const current = context();
    return saved && available(current) && current.sourceToken === saved.token;
  };
  function clear() {
    session = null; panel.hidden = true; details.open = false;
    for (const element of [title, message, location, state, code, detailText]) element.textContent = '';
    panel.dataset.status = ''; panel.dataset.severity = '';
  }
  function refresh() {
    if (disposed) return;
    if (!owns(session)) { clear(); return; }
    if (textarea.value !== session.text) session.changed = true;
    const { snapshot, changed, position } = session;
    panel.hidden = false;
    panel.dataset.status = changed ? 'changed' : snapshot.status;
    panel.dataset.severity = snapshot.severity;
    title.textContent = t('原文诊断：{0}', t({ error: '错误', warning: '警告', info: '提示' }[snapshot.severity]));
    dismiss.textContent = t('关闭诊断');
    message.textContent = t(snapshot.messageKey);
    const path = snapshot.sourcePath + (snapshot.propertyPath ? ` · ${snapshot.propertyPath}` : '');
    location.textContent = position && !changed
      ? `${path} · ${t('第 {0} 行，第 {1} 列', position.line, position.column)}` : path;
    state.textContent = t(changed ? '原文已修改，此诊断尚未重新检查。' : {
      exact: '此位置来自已核对的原文；修改后请重新检查。',
      stale: '诊断所依据的原文已变化，位置已失效。请重新检查。',
      approximate: '此诊断只有大致位置，请结合原文核对。',
      unavailable: '此诊断没有可用的原文位置，请结合详情核对。',
    }[snapshot.status]);
    panel.querySelector('#sourceDiagnosticDetailsLabel').textContent = t('诊断详情');
    code.textContent = snapshot.code; detailText.textContent = snapshot.detail;
    detailText.hidden = !snapshot.detail;
  }
  function show(value) {
    const current = context();
    if (!available(current)) { refresh(); return false; }
    if (session && session.token !== current.sourceToken) clear();
    const token = current.sourceToken;
    let snapshot, position = null;
    const text = textarea.value;
    try {
      snapshot = createSourceDiagnosticSnapshot(value);
      if (snapshot.status === 'exact') {
        const boundary = offset => offset <= text.length && !(offset > 0 && offset < text.length
          && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
        if (!boundary(snapshot.range.start) || !boundary(snapshot.range.end)) return false;
        position = createSourceLineIndex(text).position(snapshot.range.start);
      }
    } catch { return false; }
    // Validation is synchronous, but getters/host callbacks must not let an old
    // source acquire a diagnostic after changing the active document.
    const latest = context();
    if (!available(latest) || latest.sourceToken !== token || textarea.value !== text) return false;
    session = { snapshot, token, text, position, changed: false };
    details.open = false; panel.scrollTop = 0; refresh(); return true;
  }
  const input = () => { if (session) session.changed = true; refresh(); };
  const keepSelection = event => { if (event.button === 0) event.preventDefault(); };
  function close() {
    const saved = session, returnFocus = panel.contains(document.activeElement);
    const text = textarea.value;
    const selection = { start: textarea.selectionStart, end: textarea.selectionEnd,
      direction: textarea.selectionDirection, top: textarea.scrollTop, left: textarea.scrollLeft };
    clear();
    if (!returnFocus || !owns(saved) || textarea.disabled || textarea.readOnly
      || document.querySelector('dialog[open]')) return;
    textarea.focus({ preventScroll: true });
    if (owns(saved) && textarea.value === text && !document.querySelector('dialog[open]')) {
      textarea.setSelectionRange(selection.start, selection.end, selection.direction);
      textarea.scrollTop = selection.top; textarea.scrollLeft = selection.left;
    }
  }
  dismiss.addEventListener('pointerdown', keepSelection); dismiss.addEventListener('click', close);
  textarea.addEventListener('input', input); textarea.addEventListener('focus', refresh);
  const unsubscribe = onLanguageChange(refresh);
  clear();
  return Object.freeze({ show, refresh, clear, dispose() {
    if (disposed) return;
    clear(); disposed = true;
    if (typeof unsubscribe === 'function') unsubscribe();
    dismiss.removeEventListener('pointerdown', keepSelection); dismiss.removeEventListener('click', close);
    textarea.removeEventListener('input', input); textarea.removeEventListener('focus', refresh);
    panel.remove(); container.classList.remove('source-diagnostic-container');
  } });
}
