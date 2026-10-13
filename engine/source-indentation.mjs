// A source-editor operation on normalized textarea text. Parsing, serialization,
// file writes and language-specific formatting remain the caller's concern.
const maximumLength = 4 * 1024 * 1024;
const requestKeys = ['text', 'selectionStart', 'selectionEnd', 'selectionDirection', 'action', 'indent'];
const directions = ['none', 'forward', 'backward'];
const modes = { tab: '\t', 'spaces-2': '  ', 'spaces-4': '    ' };
const invalid = () => {
  throw Object.assign(new TypeError('Invalid normalized source indentation request.'), {
    errorCode: 'source_indentation_invalid',
  });
};

function sourceText(text) {
  // Check the size before scanning, slicing or constructing replacement text.
  if (typeof text !== 'string' || text.length > maximumLength || text.includes('\r')) invalid();
  return text;
}

function readRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== requestKeys.length || keys.some(key => !requestKeys.includes(key))) invalid();
  const result = {};
  for (const key of requestKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  sourceText(result.text);
  if (!Number.isSafeInteger(result.selectionStart) || !Number.isSafeInteger(result.selectionEnd)
    || result.selectionStart < 0 || result.selectionEnd < result.selectionStart
    || result.selectionEnd > result.text.length || !directions.includes(result.selectionDirection)
    || !['indent', 'outdent'].includes(result.action) || typeof result.indent !== 'string'
    || !Object.hasOwn(modes, result.indent)) invalid();
  return result;
}

function lineEnd(text, from) {
  const newline = text.indexOf('\n', from);
  return newline === -1 ? text.length : newline;
}

// Right affinity keeps a caret/selection at an insertion point after the new
// indentation. Removed-prefix positions clamp to its beginning. Coordinates
// passed here are always those of the original text, including UTF-16 offsets.
function boundaryDelta(offset, at, removed, inserted) {
  if (offset < at) return 0;
  if (offset <= at + removed) return inserted - (offset - at);
  return inserted - removed;
}

export function planSourceIndentation(input) {
  const { text, selectionStart, selectionEnd, selectionDirection, action, indent } = readRequest(input);
  const start = selectionStart === 0 ? 0 : text.lastIndexOf('\n', selectionStart - 1) + 1;
  // A nonempty selection ending at the following line's start belongs only to
  // the preceding lines. A collapsed caret there belongs to the following line.
  const lastOffset = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd;
  const end = lineEnd(text, lastOffset);
  const unit = modes[indent], width = indent === 'spaces-2' ? 2 : 4;
  let mappedStart = selectionStart, mappedEnd = selectionEnd, changed = false, lengthDelta = 0;
  // Bound temporary chunk arrays even for input consisting of millions of
  // empty lines; no per-line edit objects or full-document split is needed.
  const chunks = [], parts = [];
  for (let current = start; current <= end;) {
    const next = Math.min(lineEnd(text, current), end);
    const at = current === 0 && text.charCodeAt(0) === 0xfeff ? 1 : current;
    let removed = 0, inserted = '';
    if (action === 'indent') inserted = unit;
    else if (text[at] === '\t') removed = 1;
    else while (removed < width && at + removed < next && text[at + removed] === ' ') removed++;
    lengthDelta += inserted.length - removed;
    // A successful edit must remain eligible for a subsequent operation. Check
    // the whole resulting document, including text outside this replacement.
    if (text.length + lengthDelta > maximumLength) invalid();
    if (removed || inserted.length) {
      changed = true;
      mappedStart += boundaryDelta(selectionStart, at, removed, inserted.length);
      mappedEnd += boundaryDelta(selectionEnd, at, removed, inserted.length);
    }
    parts.push(text.slice(current, at), inserted, text.slice(at + removed, next));
    if (next === end) break;
    parts.push('\n');
    if (parts.length >= 4096) { chunks.push(parts.join('')); parts.length = 0; }
    current = next + 1;
  }
  chunks.push(parts.join(''));
  return Object.freeze({ start, end, replacement: chunks.join(''), selectionStart: mappedStart,
    selectionEnd: mappedEnd, selectionDirection, changed });
}

export function detectSourceIndentation(input) {
  const text = sourceText(input);
  for (let current = 0; current < text.length;) {
    const end = lineEnd(text, current);
    const at = current === 0 && text.charCodeAt(0) === 0xfeff ? 1 : current;
    let content = at;
    while (content < end && (text[content] === ' ' || text[content] === '\t')) content++;
    if (content > at && text.slice(content, end).trim()) {
      if (text[at] === '\t') return 'tab';
      let spaces = 0;
      while (text[at + spaces] === ' ') spaces++;
      return spaces > 0 && spaces % 2 === 0 && spaces % 4 !== 0 ? 'spaces-2' : 'spaces-4';
    }
    current = end + 1;
  }
  return 'spaces-4';
}
