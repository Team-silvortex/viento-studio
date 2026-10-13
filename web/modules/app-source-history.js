// Some desktop webviews keep the native edit history but do not route its
// keyboard shortcuts to textarea. Use that same browser stack for every source
// edit; this controller owns neither document contents nor a second undo stack.
export function setupSourceHistory({ textarea, container, getContext = () => ({}) } = {}) {
  if (!textarea || !container) return Object.freeze({ dispose() {} });
  const document = textarea.ownerDocument;
  let disposed = false, composing = false, executing = false;
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const available = current => !disposed && !composing && current.editable === true
    && typeof current.sourceToken === 'string' && current.sourceToken.length > 0
    && textarea.isConnected && container.isConnected && !textarea.readOnly && !textarea.disabled
    && document.activeElement === textarea && !document.querySelector('dialog[open]');
  const keydown = event => {
    if (event.target !== textarea || event.defaultPrevented || event.isComposing || event.keyCode === 229
      || composing || executing || event.repeat || event.altKey || Boolean(event.ctrlKey) === Boolean(event.metaKey)) return;
    const key = event.key?.toLowerCase();
    const command = key === 'z' ? (event.shiftKey ? 'redo' : 'undo')
      : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : null;
    if (!command || typeof document.execCommand !== 'function') return;
    const current = context();
    if (!available(current)) return;
    const token = current.sourceToken, before = textarea.value;
    const owns = () => { const now = context(); return available(now) && now.sourceToken === token; };
    let sawInput = false;
    const observeInput = () => { sawInput = true; };
    // Consume one shortcut once, including a no-op/unsupported command, so the
    // browser cannot apply a second undo after this synchronous native call.
    event.preventDefault(); event.stopPropagation();
    textarea.addEventListener('input', observeInput);
    executing = true;
    try {
      try { document.execCommand(command, false); } catch { /* Never rewrite .value as a fallback. */ }
      // A native input already updates the ordinary draft. Hosts that omit it
      // need one notification, but a synchronous navigation owns its new text.
      if (!sawInput && owns() && textarea.value !== before) {
        const InputEvent = document.defaultView?.Event || Event;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
    } finally {
      textarea.removeEventListener('input', observeInput);
      executing = false;
    }
  };
  const compositionStart = () => { composing = true; };
  const compositionEnd = () => { composing = false; };
  textarea.addEventListener('keydown', keydown);
  textarea.addEventListener('compositionstart', compositionStart);
  textarea.addEventListener('compositionend', compositionEnd);
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    textarea.removeEventListener('keydown', keydown);
    textarea.removeEventListener('compositionstart', compositionStart);
    textarea.removeEventListener('compositionend', compositionEnd);
  } });
}
