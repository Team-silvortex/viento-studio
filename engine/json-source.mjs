// Strict JSON values plus dependency-free ranges of the original JSON tokens.
// This module owns no document I/O, author identities, scene rules or rendering.

export const JSON_SOURCE_LIMITS = Object.freeze({ characters: 8 * 1024 * 1024, depth: 64, nodes: 100000 });
const indexes = new WeakMap();
const escapePointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const pointerFor = parts => parts.length ? `/${parts.map(escapePointer).join('/')}` : '';
const whitespace = character => character === ' ' || character === '\t' || character === '\r' || character === '\n';
const diagnostic = (code, message, propertyPath = '') => ({ code, message, propertyPath });
const failure = issue => ({ ok: false, value: null, ambiguous: false, diagnostics: [issue] });

// JSON.parse is the sole syntax gate. This scan only budgets already-valid
// tokens before source indexing, including values hidden by duplicate keys.
// Walking the parsed value alone would miss those discarded subtrees.
function checkBudget(source) {
  let containers = 0, nodes = 0;
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (whitespace(character) || character === ':' || character === ',') { index++; continue; }
    if (character === '}' || character === ']') { containers--; index++; continue; }
    if (character === '"') {
      index++;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index++] === '"') break;
      }
      let after = index;
      while (whitespace(source[after])) after++;
      if (source[after] === ':') continue; // Map keys are not value nodes.
    } else if (character !== '{' && character !== '[') {
      while (index < source.length && !whitespace(source[index]) && ![',', '}', ']'].includes(source[index])) index++;
    }
    if (containers > JSON_SOURCE_LIMITS.depth) return diagnostic('json_source_limit', 'JSON value depth exceeds 64.');
    if (++nodes > JSON_SOURCE_LIMITS.nodes) return diagnostic('json_source_limit', 'JSON source exceeds 100000 value nodes.');
    if (character === '{' || character === '[') { containers++; index++; }
  }
  return null;
}

/** Parse JSON without normalizing its bytes; source locations are UTF-16 offsets. */
export function parseJsonSource(content, { allowDuplicateKeys = false } = {}) {
  if (typeof content !== 'string') return failure(diagnostic('json_source_invalid', 'JSON source must be a string.'));
  if (content.length > JSON_SOURCE_LIMITS.characters) return failure(diagnostic('json_source_limit', 'JSON source exceeds 8 Mi UTF-16 code units.'));
  const bom = content.startsWith('\uFEFF') ? 1 : 0, source = content.slice(bom);
  let value;
  try { value = JSON.parse(source); }
  catch { return failure(diagnostic('json_source_syntax', 'The source is not valid JSON.')); }
  const exceeded = checkBudget(source);
  if (exceeded) return failure(exceeded);
  let root, duplicate = null;
  try {
    // JSON.parse above already accepted the complete text and owns every
    // semantic value. This bounded scan only indexes token boundaries; numbers
    // and literals are never interpreted again or normalized into new text.
    let cursor = 0;
    const skipWhitespace = () => { while (whitespace(source[cursor])) cursor++; };
    const stringEnd = () => {
      if (source[cursor++] !== '"') throw new Error('Invalid string token boundary.');
      while (cursor < source.length) {
        const character = source[cursor++];
        if (character === '\\') cursor++;
        else if (character === '"') return;
      }
      throw new Error('Missing string token boundary.');
    };
    const visit = (parts = []) => {
      skipWhitespace();
      const start = cursor, character = source[cursor], container = character === '{' || character === '[';
      const entry = { start: start + bom, end: 0, encoding: 'utf-16', container, children: new Map() };
      if (container) {
        const object = character === '{', closing = object ? '}' : ']';
        cursor++; skipWhitespace();
        let index = 0;
        while (source[cursor] !== closing) {
          let key;
          if (object) {
            const keyStart = cursor;
            stringEnd();
            // Decode keys only, including escapes and surrogate pairs, so the
            // pointer and duplicate rules agree exactly with JSON.parse.
            key = JSON.parse(source.slice(keyStart, cursor));
            skipWhitespace();
            if (source[cursor++] !== ':') throw new Error('Missing key boundary.');
          } else key = String(index++);
          if (typeof key !== 'string') throw new Error('Invalid JSON key.');
          const next = [...parts, key];
          if (entry.children.has(key)) {
            duplicate = diagnostic('json_source_duplicate_key', 'JSON object contains a duplicate decoded key.', pointerFor(next));
            return null;
          }
          const child = visit(next);
          if (!child) return null;
          entry.children.set(key, child);
          skipWhitespace();
          if (source[cursor] === closing) break;
          if (source[cursor++] !== ',') throw new Error('Missing value boundary.');
          skipWhitespace();
        }
        cursor++;
      } else if (character === '"') stringEnd();
      else while (cursor < source.length && !whitespace(source[cursor]) && ![',', '}', ']'].includes(source[cursor])) cursor++;
      if (cursor <= start || cursor > source.length) throw new Error('Invalid value token boundary.');
      entry.end = cursor + bom;
      return entry;
    };
    root = visit();
    if (!duplicate) {
      skipWhitespace();
      if (cursor !== source.length) throw new Error('Unexpected text after indexed root.');
    }
  } catch {
    return failure(diagnostic('json_source_index_invalid', 'Cannot derive reliable source ranges from this JSON.'));
  }
  if (duplicate) return { ok: allowDuplicateKeys === true, value: allowDuplicateKeys === true ? value : null,
    ambiguous: true, diagnostics: [duplicate] };
  const result = { ok: true, value, ambiguous: false, diagnostics: [] };
  indexes.set(result, root);
  return result;
}

/** Locate a JSON Pointer, optionally falling back to the nearest existing container. */
export function locateJsonSource(parsed, pointer, { nearest = false } = {}) {
  if (!parsed?.ok || parsed.ambiguous || typeof pointer !== 'string'
    || pointer !== '' && !pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) return null;
  const root = indexes.get(parsed);
  if (!root) return null;
  const parts = pointer === '' ? [] : pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let node = root, parent = root.container ? { node: root, count: 0 } : null;
  const location = (entry, count, exact) => ({ start: entry.start, end: entry.end, encoding: entry.encoding,
    propertyPath: pointerFor(parts.slice(0, count)), exact });
  for (let index = 0; index < parts.length; index++) {
    const child = node.children.get(parts[index]);
    if (!child) return nearest === true && parent ? location(parent.node, parent.count, false) : null;
    node = child;
    if (node.container) parent = { node, count: index + 1 };
  }
  return location(node, parts.length, true);
}
