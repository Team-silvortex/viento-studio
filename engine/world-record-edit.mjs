import { parseDocument, isMap, isSeq } from 'yaml';
import { createError } from './service-error.mjs';
import { canonicalJson } from './world-projection.mjs';

const invalid = () => { throw createError(422, 'The registration cannot be edited without changing other data', {}, 'world_record_invalid'); };

// Insert new JSON tokens without reserializing existing numbers, whitespace or
// extension fields. Callers validate the item and the allowed field themselves.
export function appendRecordItem(content, field, item) {
  let before;
  try { before = JSON.parse(content); } catch { invalid(); }
  const parsed = parseDocument(content, { keepSourceTokens: true, intAsBigInt: true, uniqueKeys: true });
  if (parsed.errors.length || !isMap(parsed.contents)) invalid();
  const root = parsed.contents, pair = root.items.find(entry => entry.key?.value === field);
  if (pair && !isSeq(pair.value)) invalid();
  const target = pair ? pair.value : root, last = target.items.at(-1);
  const at = last ? (isMap(target) ? last.value : last)?.range?.[1] : target.range[0] + 1;
  if (!Number.isInteger(at) || !target.flow) invalid();
  const value = pair ? JSON.stringify(item) : `${JSON.stringify(field)}: [${JSON.stringify(item)}]`;
  const afterContent = content.slice(0, at) + (last ? ', ' : '') + value + content.slice(at);
  let after;
  try { after = JSON.parse(afterContent); } catch { invalid(); }
  if (canonicalJson(after) !== canonicalJson({ ...before, [field]: [...(before[field] || []), item] })) invalid();
  return { before, after, afterContent };
}

// Change just a path token when moving registrations between v2/v3 roots.
export function replaceRecordString(content, field, value) {
  const before = JSON.parse(content);
  const parsed = parseDocument(content, { keepSourceTokens: true, intAsBigInt: true, uniqueKeys: true });
  if (parsed.errors.length || !isMap(parsed.contents) || typeof before[field] !== 'string' || typeof value !== 'string') invalid();
  const pair = parsed.contents.items.find(entry => entry.key?.value === field);
  if (!pair?.value?.range) invalid();
  const [start, end] = pair.value.range;
  const afterContent = content.slice(0, start) + JSON.stringify(value) + content.slice(end);
  if (canonicalJson(JSON.parse(afterContent)) !== canonicalJson({ ...before, [field]: value })) invalid();
  return afterContent;
}

// The edited record is guarded by exact byte hashes; the rest of the registry
// pins resource identities and relation targets during transaction recovery.
export function registrationGuard(registry, objectId) {
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return canonicalJson({ documents: registry.documents.filter(item => item.id !== objectId).sort(byId),
    assets: [...registry.assets].sort(byId) });
}
