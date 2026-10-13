// Read-only viewport adaptation shared by line navigation and verified source
// locations. Full text is measured: cutting a word at the target changes wrap.
export function revealSourceOffset(textarea, text, offset) {
  if (!textarea || typeof text !== 'string' || text.length > 4 * 1024 * 1024
    || textarea.value !== text || !Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  const document = textarea.ownerDocument, view = document?.defaultView;
  if (!view?.getComputedStyle || !document.createRange || !textarea.clientWidth || !textarea.clientHeight) return false;
  const computed = view.getComputedStyle(textarea), mirror = document.createElement('div');
  try {
    const style = mirror.style;
    for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant',
      'fontFeatureSettings', 'fontVariationSettings', 'lineHeight', 'letterSpacing', 'wordSpacing',
      'textIndent', 'textTransform', 'textRendering', 'direction', 'tabSize', 'whiteSpace',
      'wordBreak', 'overflowWrap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) style[name] = computed[name];
    Object.assign(style, { position: 'absolute', left: '-100000px', top: '0', visibility: 'hidden',
      pointerEvents: 'none', margin: '0', border: '0', boxSizing: 'border-box', width: `${textarea.clientWidth}px`,
      height: 'auto', minHeight: '0', maxHeight: 'none', overflow: 'visible' });
    if (textarea.wrap === 'off') style.whiteSpace = 'pre';
    mirror.setAttribute('aria-hidden', 'true');
    // A trailing zero-width character gives an empty final logical line a box.
    mirror.textContent = text + '\u200b'; document.body.append(mirror);
    const range = document.createRange();
    range.setStart(mirror.firstChild, offset);
    range.setEnd(mirror.firstChild, offset + (text.codePointAt(offset) > 0xffff ? 2 : 1));
    const row = range.getBoundingClientRect(), box = mirror.getBoundingClientRect();
    const top = row.top - box.top, left = row.left - box.left;
    if (![top, left, row.height].every(Number.isFinite) || row.height <= 0 || textarea.value !== text) return false;
    textarea.scrollTop = Math.max(0, top - (textarea.clientHeight - row.height) / 2);
    textarea.scrollLeft = textarea.wrap === 'off' ? Math.max(0, left - textarea.clientWidth / 2) : 0;
    return true;
  } catch { return false; }
  finally { mirror.remove(); }
}
