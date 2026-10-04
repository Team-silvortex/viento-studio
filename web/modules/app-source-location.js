const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const pointer = value => typeof value === 'string' && (value === '' || value.startsWith('/'));
const boundary = (source, index) => !(index > 0 && index < source.length
  && (source[index - 1] === '\r' && source[index] === '\n'
    || /[\uD800-\uDBFF]/.test(source[index - 1]) && /[\uDC00-\uDFFF]/.test(source[index])));
const textareaOffset = (source, index) => source.slice(0, index).replace(/\r\n|\r/g, '\n').length;

// Source ranges use UTF-16 offsets in the exact observed file, including BOM and
// original newlines. Textareas keep UTF-16 but normalize CRLF and CR to LF.
// Never turn a nearest-container hint or an old revision into an exact selection.
export function sourceLocationSelection(source, location, currentRevision) {
  if (typeof source !== 'string' || !location || !revision(location.sourceRevision) || !revision(currentRevision)) return { status: 'unavailable' };
  if (location.sourceRevision !== currentRevision) return { status: 'stale' };
  const range = location.sourceRange;
  if (!range || range.encoding !== 'utf-16' || !pointer(location.propertyPath) || !pointer(range.propertyPath)
    || typeof range.exact !== 'boolean' || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end < range.start || range.end > source.length
    || !boundary(source, range.start) || !boundary(source, range.end)) return { status: 'unavailable' };
  if (!range.exact || range.propertyPath !== location.propertyPath) return { status: 'approximate' };
  return { status: 'exact', start: textareaOffset(source, range.start), end: textareaOffset(source, range.end) };
}
