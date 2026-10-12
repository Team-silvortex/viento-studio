// Read-only display indexing and source navigation. Scene admission and exact
// UTF-16 declaration locations belong exclusively to the native 3D parser.
import { parseScene3DSource } from './scene3d.mjs';

const indexes = new WeakSet(), locations = new WeakSet();
const invalid = () => Object.assign(new TypeError('Expected a current read-only 3D source snapshot or object index.'), { errorCode: 'scene3d_navigation_invalid' });
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function captureSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const keys = ['sourcePath', 'token', 'content'], descriptors = Object.getOwnPropertyDescriptors(input), prototype = Object.getPrototypeOf(input);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null || Reflect.ownKeys(descriptors).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) throw invalid();
  const source = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  if (typeof source.content !== 'string' || typeof source.token !== 'string' || !source.token || source.token.length > 256
    || typeof source.sourcePath !== 'string' || !source.sourcePath || source.sourcePath.length > 4096
    || source.sourcePath.startsWith('/') || source.sourcePath.includes('\\') || source.sourcePath.includes('\0')
    || source.sourcePath.split('/').some(part => !part || part === '.' || part === '..') || !/\.json$/i.test(source.sourcePath)) throw invalid();
  return source;
}

/** A detached display index over an already admitted native model. This is
 * deliberately not a source/schema parser and grants no editing authority. */
export function createScene3DObjectIndex(parsed) {
  const objects = parsed?.model?.objects, declarations = parsed?.sourceLocations?.objects;
  if (!Array.isArray(objects) || !Array.isArray(declarations)) throw invalid();
  const byId = new Map(declarations.map(item => [item.instanceId, item]));
  const rows = objects.map(object => {
    if (typeof object?.name !== 'string' || typeof object?.instanceId !== 'string') throw invalid();
    const location = byId.get(object.instanceId);
    return { instanceId: object.instanceId, name: object.name, primitive: object.primitive,
      propertyPath: location?.propertyPath || '', sourceRange: location?.sourceRange ? { ...location.sourceRange } : null };
  });
  const index = freeze({ objects: rows }); indexes.add(index); return index;
}

/** Matching is presentation-only: trim the query, lowercase it, then match a
 * literal substring of name or UUID. Authored names remain byte-for-byte. */
export function queryScene3DObjects(index, query = '') {
  if (!indexes.has(index) || typeof query !== 'string') throw invalid();
  const needle = query.trim().toLowerCase();
  return Object.freeze(index.objects.filter(object => !needle || object.name.toLowerCase().includes(needle) || object.instanceId.toLowerCase().includes(needle)));
}

/** Reparse exact source; never accept a caller's numeric index or range. */
export function createScene3DSourceLocation(snapshot, instanceId) {
  const source = captureSnapshot(snapshot);
  if (typeof instanceId !== 'string') throw invalid();
  const parsed = parseScene3DSource(source.content);
  const location = parsed.sourceLocations.objects.find(item => item.instanceId === instanceId);
  if (!location) throw invalid();
  const receipt = freeze({ kind: 'scene3d-source-location', ...source, instanceId,
    propertyPath: location.propertyPath, sourceRange: { ...location.sourceRange } });
  locations.add(receipt); return receipt;
}

export function isScene3DSourceLocation(value) { return locations.has(value); }

/** Only the selection offsets are translated to a textarea's normalized LF
 * display. Original source, receipt and native UTF-16 ranges remain unchanged. */
export function scene3DSourceDisplaySelection(location, displayedContent) {
  if (!locations.has(location) || typeof displayedContent !== 'string'
    || displayedContent !== location.content.replace(/\r\n|\r/g, '\n')) throw invalid();
  return Object.freeze({ start: location.content.slice(0, location.sourceRange.start).replace(/\r\n|\r/g, '\n').length,
    end: location.content.slice(0, location.sourceRange.end).replace(/\r\n|\r/g, '\n').length });
}
