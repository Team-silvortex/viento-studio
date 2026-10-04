// Strict JSON values plus source ranges supplied by the existing YAML CST.
// This module owns no document I/O, author identities, scene rules or rendering.
import { parseDocument, isMap, isSeq, isScalar } from '../node_modules/yaml/browser/index.js';

export const JSON_SOURCE_LIMITS = Object.freeze({ characters: 8 * 1024 * 1024, depth: 64, nodes: 100000 });
const indexes = new WeakMap();
const escapePointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const pointerFor = parts => parts.length ? `/${parts.map(escapePointer).join('/')}` : '';
const whitespace = character => character === ' ' || character === '\t' || character === '\r' || character === '\n';
const diagnostic = (code, message, propertyPath = '') => ({ code, message, propertyPath });
const failure = issue => ({ ok: false, value: null, ambiguous: false, diagnostics: [issue] });

// JSON.parse is the sole syntax gate. This scan only budgets already-valid
// tokens before CST construction, including values hidden by duplicate keys.
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
    // Values come exclusively from JSON.parse. A failsafe CST avoids allocating
    // BigInts or otherwise interpreting numeric tokens just to find their spans.
    const parsed = parseDocument(source, { keepSourceTokens: true, uniqueKeys: false, schema: 'failsafe' });
    if (parsed.errors.length) return failure(diagnostic('json_source_index_invalid', 'Cannot derive reliable source ranges from this JSON.'));
    const range = node => {
      const start = node?.range?.[0], end = node?.range?.[1];
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) {
        throw new Error('Invalid CST range.');
      }
      return { start: start + bom, end: end + bom, encoding: 'utf-16' };
    };
    const visit = (node, parts = []) => {
      const span = range(node), container = isMap(node) || isSeq(node);
      const entry = { ...span, container, children: new Map() };
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key)) throw new Error('Invalid JSON key node.');
          const keyRange = range(pair.key);
          // Decode the original JSON token, including escaped and surrogate keys.
          const key = JSON.parse(content.slice(keyRange.start, keyRange.end));
          if (typeof key !== 'string') throw new Error('Invalid JSON key.');
          const next = [...parts, key];
          if (entry.children.has(key)) {
            duplicate = diagnostic('json_source_duplicate_key', 'JSON object contains a duplicate decoded key.', pointerFor(next));
            return null;
          }
          const child = visit(pair.value, next);
          if (!child) return null;
          entry.children.set(key, child);
        }
      } else if (isSeq(node)) {
        for (const [index, item] of node.items.entries()) {
          const key = String(index), child = visit(item, [...parts, key]);
          if (!child) return null;
          entry.children.set(key, child);
        }
      } else if (!isScalar(node)) throw new Error('Invalid JSON value node.');
      return entry;
    };
    root = visit(parsed.contents);
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
