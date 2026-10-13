// Literal operations on normalized source-editor text. Callers own the editor,
// focus, undo history and file persistence; these plans never mutate a document.
const maximumText = 4 * 1024 * 1024;
const maximumQuery = 4096;
const maximumReplacement = 65536;
const maximumMatches = 10000;
const invalid = () => Object.assign(new TypeError('Invalid normalized source search request.'), {
  errorCode: 'source_search_invalid',
});
const limit = () => Object.assign(new RangeError('Source search operation exceeds its processing limit.'), {
  errorCode: 'source_search_limit',
});

function record(input, required, optional) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) throw invalid();
  const names = Reflect.ownKeys(input), allowed = [...required, ...optional];
  if (names.length < required.length || names.length > allowed.length
    || names.some(key => typeof key !== 'string' || !allowed.includes(key))) throw invalid();
  const result = {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(result, key))) throw invalid();
  return result;
}

const normalized = (value, maximum) => typeof value === 'string'
  && value.length <= maximum && !value.includes('\r');
const highSurrogate = code => code >= 0xd800 && code <= 0xdbff;
const lowSurrogate = code => code >= 0xdc00 && code <= 0xdfff;
const boundary = (text, offset) => !(offset > 0 && offset < text.length
  && highSurrogate(text.charCodeAt(offset - 1)) && lowSurrogate(text.charCodeAt(offset)));

function readRequest(input, replacing) {
  try {
    const required = replacing ? ['text', 'query', 'replacement', 'selectionStart', 'selectionEnd'] : ['text', 'query'];
    const value = record(input, required, replacing ? ['matchCase', 'all'] : ['matchCase']);
    if (!normalized(value.text, maximumText) || !normalized(value.query, maximumQuery)
      || Object.hasOwn(value, 'matchCase') && typeof value.matchCase !== 'boolean') throw invalid();
    if (!Object.hasOwn(value, 'matchCase')) value.matchCase = true;
    if (replacing) {
      if (!normalized(value.replacement, maximumReplacement)
        || !Number.isSafeInteger(value.selectionStart) || !Number.isSafeInteger(value.selectionEnd)
        || value.selectionStart < 0 || value.selectionEnd < value.selectionStart || value.selectionEnd > value.text.length
        || !boundary(value.text, value.selectionStart) || !boundary(value.text, value.selectionEnd)
        || Object.hasOwn(value, 'all') && typeof value.all !== 'boolean') throw invalid();
      if (!Object.hasOwn(value, 'all')) value.all = false;
    }
    return value;
  } catch { throw invalid(); }
}

function matches({ text, query, matchCase }) {
  const result = [];
  if (query) {
    // Unicode simple case folding operates on the original string, so an
    // expanding lowercase mapping (for example İ) cannot move later offsets.
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, matchCase ? 'gu' : 'giu');
    for (let match; (match = expression.exec(text));) {
      const start = match.index, end = start + match[0].length;
      if (!boundary(text, start) || !boundary(text, end)) continue;
      if (result.length === maximumMatches) throw limit();
      result.push(Object.freeze({ start, end }));
    }
  }
  return Object.freeze(result);
}

export function findSourceMatches(input) {
  return matches(readRequest(input, false));
}

function unchanged({ text, selectionStart, selectionEnd }, count = 0) {
  return Object.freeze({ changed: false, start: selectionStart, end: selectionEnd,
    replacement: text.slice(selectionStart, selectionEnd), selectionStart, selectionEnd, count });
}

export function planSourceReplacement(input) {
  const value = readRequest(input, true);
  const { text, replacement, selectionStart, selectionEnd, all } = value;
  const found = matches(value);
  const selected = all ? found : found.filter(match => match.start === selectionStart && match.end === selectionEnd);
  if (!selected.length) return unchanged(value);
  let resultingLength = text.length;
  for (const match of selected) resultingLength += replacement.length - (match.end - match.start);
  // Check the whole document before constructing the encompassing edit. Text
  // outside this span still counts towards the source editor's size limit.
  if (resultingLength > maximumText) throw limit();
  const start = selected[0].start, end = selected.at(-1).end, parts = [];
  let previous = start;
  for (const match of selected) {
    parts.push(text.slice(previous, match.start), replacement);
    previous = match.end;
  }
  const inserted = parts.join('');
  if (inserted === text.slice(start, end)) return unchanged(value, selected.length);
  let caret = start + inserted.length;
  // Previously isolated surrogates can form a pair across the edited boundary.
  // Keep author text exact and give the resulting caret right affinity rather
  // than placing it between the new pair's UTF-16 code units.
  const beforeCaret = inserted.length ? inserted.charCodeAt(inserted.length - 1) : text.charCodeAt(start - 1);
  if (highSurrogate(beforeCaret) && lowSurrogate(text.charCodeAt(end))) caret++;
  return Object.freeze({ changed: true, start, end, replacement: inserted,
    selectionStart: caret, selectionEnd: caret, count: selected.length });
}
