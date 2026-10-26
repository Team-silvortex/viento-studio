// Source-safe physics declaration edits. Rust owns body rules; the host owns
// source identity, ordinary draft writes, scene lookup and Save authority.
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { normalizeSourcePath } from './source-path.mjs';

const MAX_BYTES = 65536;
const proposals = new WeakSet();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const bodyKeys = ['id', 'instanceId', 'kind', 'shape', 'offset', 'layer', 'mask'];
const error = (kind = 'invalid') => Object.assign(new TypeError('The physics edit does not match the reviewed source.'), {
  errorCode: `scene_physics2d_authoring_${kind}`,
});
const fail = () => { throw error(); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const unicode = value => {
  for (const character of value) { const code = character.codePointAt(0); if (code >= 0xd800 && code <= 0xdfff) return false; }
  return true;
};
const revision = value => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
function safeSerialization() {
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
}
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function contentBytes(content) {
  if (typeof content !== 'string' || content.length > MAX_BYTES || !unicode(content)
    || new TextEncoder().encode(content).length > MAX_BYTES) fail();
}
function captureSource(input) {
  const source = record(input, sourceKeys);
  if (typeof source.sourcePath !== 'string' || !source.sourcePath || source.sourcePath.length > 4096
    || !unicode(source.sourcePath) || normalizeSourcePath(source.sourcePath) !== source.sourcePath
    || /[\x00-\x1f\x7f:\\]/.test(source.sourcePath) || !source.sourcePath.endsWith('.json')
    || typeof source.token !== 'string' || !source.token || source.token.length > 256 || !unicode(source.token)
    || !revision(source.baseSourceRevision) || !revision(source.sourceRevision)) fail();
  contentBytes(source.content); return Object.freeze(source);
}
// Detach caller-owned data before the first asynchronous boundary. Descriptors
// reject accessors, sparse arrays, serializers and hidden or inherited fields.
function copyData(input, depth = 0, budget = { nodes: 0, bytes: 0 }) {
  if (++budget.nodes > 8192 || depth > 12) fail();
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES || !unicode(input) || (budget.bytes += new TextEncoder().encode(input).length) > MAX_BYTES) fail();
    return input;
  }
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'number') { if (!Number.isFinite(input)) fail(); return input; }
  if (!input || typeof input !== 'object') fail();
  const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
  if (array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors), length = descriptors.length?.value;
  if (array && (!Number.isSafeInteger(length) || length > 128 || names.length !== length + 1) || !array && names.length > 9) fail();
  const output = array ? [] : Object.create(null);
  for (const key of array ? Array.from({ length }, (_, index) => String(index)) : names) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)
      || key.length > 192 || !unicode(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    output[key] = copyData(descriptor.value, depth + 1, budget);
  }
  return output;
}
async function inspect(document) {
  safeSerialization();
  try { await inspectScenePhysics2D(document); }
  catch (cause) { if (cause?.errorCode === 'studio_core_unavailable') throw cause; fail(); }
}
export async function readScenePhysics2DDocument(content) {
  contentBytes(content); safeSerialization();
  const parsed = parseJsonSource(content);
  if (!parsed.ok) fail();
  await inspect(parsed.value);
  // Keep the parsed author values/order, including signed zero, after checking
  // semantics through the native inspector. Never use a reserialized source.
  return freeze(parsed.value);
}
function range(parsed, pointer) {
  const value = locateJsonSource(parsed, pointer);
  if (!value?.exact || value.encoding !== 'utf-16') fail();
  return value;
}
function applyPatches(content, patches, offset = 0) {
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    content = content.slice(0, patch.start - offset) + patch.text + content.slice(patch.end - offset);
  }
  return content;
}
function style(content, parsed) {
  const newline = content.match(/\r\n|\n|\r/)?.[0];
  const indent = at => content.slice(0, at).split(/\r\n|\n|\r/).at(-1).match(/^[ \t]*/)[0];
  return { newline, indent, unit: indent(range(parsed, '/format').start) || '  ' };
}
function serialize(value, formatting, base) {
  return value && typeof value === 'object' && formatting.newline
    ? JSON.stringify(value, null, formatting.unit).replaceAll('\n', formatting.newline + base) : JSON.stringify(value);
}
// Optional fields share comma boundaries. Group adjacent removals and append
// additions once, so response, motion and platform changes never overlap in
// source patches. Retained keys, whitespace and value lexemes remain untouched.
function optionalPatches(content, parsed, before, after, pointer, formatting) {
  const optional = ['collisionResponse', 'characterMotion', 'oneWay', 'platformMotion'], keys = Object.keys(before);
  const removed = new Set(optional.filter(key => Object.hasOwn(before, key) && !Object.hasOwn(after, key)));
  const additions = optional.filter(key => !Object.hasOwn(before, key) && Object.hasOwn(after, key));
  const container = range(parsed, pointer), patches = [];
  for (let index = 0; index < keys.length; index++) {
    if (!removed.has(keys[index])) continue;
    const first = index;
    while (index + 1 < keys.length && removed.has(keys[index + 1])) index++;
    const last = range(parsed, `${pointer}/${keys[index]}`);
    const start = first ? range(parsed, `${pointer}/${keys[first - 1]}`).end : content.indexOf('"', container.start + 1);
    const end = first ? last.end : content.indexOf('"', last.end);
    if (start < container.start || end < start || end > container.end) fail();
    patches.push({ start, end, propertyPaths: keys.slice(first, index + 1).map(key => `${pointer}/${key}`), text: '' });
  }
  if (additions.length) {
    const kept = keys.filter(key => !removed.has(key)), last = range(parsed, `${pointer}/${kept.at(-1)}`);
    const first = range(parsed, `${pointer}/${kept[0]}`), base = formatting.indent(first.start);
    const gap = formatting.newline ? formatting.newline + base : '';
    const text = additions.map(key => `,${gap}"${key}":${formatting.newline ? ' ' : ''}${serialize(after[key], formatting, base)}`).join('');
    const paths = additions.map(key => `${pointer}/${key}`), tail = patches.find(patch => patch.start === last.end);
    if (tail) { tail.text = text; tail.propertyPaths.push(...paths); }
    else patches.push({ start: last.end, end: last.end, propertyPaths: paths, text });
  }
  return patches;
}
function bodyPatches(content, parsed, before, after, index, formatting) {
  const patches = [], pointer = `/bodies/${index}`;
  const leaf = (path, a, b) => {
    if (canonicalJson(a) === canonicalJson(b)) return;
    const location = range(parsed, path);
    patches.push({ ...location, text: serialize(b, formatting, formatting.indent(location.start)) });
  };
  for (const key of ['instanceId', 'kind']) leaf(`${pointer}/${key}`, before[key], after[key]);
  if (before.shape.kind !== after.shape.kind) leaf(`${pointer}/shape`, before.shape, after.shape);
  else if (before.shape.kind === 'box') for (let axis = 0; axis < 2; axis++) {
    leaf(`${pointer}/shape/size/${axis}`, before.shape.size[axis], after.shape.size[axis]);
  }
  else leaf(`${pointer}/shape/radius`, before.shape.radius, after.shape.radius);
  for (let axis = 0; axis < 2; axis++) leaf(`${pointer}/offset/${axis}`, before.offset[axis], after.offset[axis]);
  for (const key of ['layer', 'mask']) leaf(`${pointer}/${key}`, before[key], after[key]);
  if (Object.hasOwn(before, 'collisionResponse') && Object.hasOwn(after, 'collisionResponse')) {
    leaf(`${pointer}/collisionResponse`, before.collisionResponse, after.collisionResponse);
  }
  if (Object.hasOwn(before, 'characterMotion') && Object.hasOwn(after, 'characterMotion')) {
    for (const key of ['kind', 'gravity', 'jumpSpeed', 'maxFallSpeed']) {
      leaf(`${pointer}/characterMotion/${key}`, before.characterMotion[key], after.characterMotion[key]);
    }
  }
  if (Object.hasOwn(before, 'oneWay') && Object.hasOwn(after, 'oneWay')) {
    leaf(`${pointer}/oneWay/margin`, before.oneWay.margin, after.oneWay.margin);
  }
  if (Object.hasOwn(before, 'platformMotion') && Object.hasOwn(after, 'platformMotion')) {
    for (const key of ['kind', 'offsetX', 'speed']) {
      leaf(`${pointer}/platformMotion/${key}`, before.platformMotion[key], after.platformMotion[key]);
    }
  }
  patches.push(...optionalPatches(content, parsed, before, after, pointer, formatting));
  return patches;
}
function candidateBodies(before, inputs) {
  if (!Array.isArray(inputs)) fail();
  const originals = new Map(before.bodies.map((body, index) => [body.id, index]));
  let lastIndex = -1, appended = false;
  return inputs.map(input => {
    const hasResponse = input !== null && typeof input === 'object' && Object.hasOwn(input, 'collisionResponse');
    const hasMotion = input !== null && typeof input === 'object' && Object.hasOwn(input, 'characterMotion');
    const hasOneWay = input !== null && typeof input === 'object' && Object.hasOwn(input, 'oneWay');
    const hasPlatformMotion = input !== null && typeof input === 'object' && Object.hasOwn(input, 'platformMotion');
    const body = record(input, [...bodyKeys, ...(hasResponse ? ['collisionResponse'] : []), ...(hasMotion ? ['characterMotion'] : []), ...(hasOneWay ? ['oneWay'] : []), ...(hasPlatformMotion ? ['platformMotion'] : [])]), index = originals.get(body.id);
    if (hasResponse && (body.kind !== 'character' || !['stop', 'slide'].includes(body.collisionResponse))) fail();
    // The old default never upgrades a schema-1 document or adds redundant data.
    if (before.schemaVersion === 1 && body.collisionResponse === 'stop') delete body.collisionResponse;
    if (index === undefined) appended = true;
    else {
      // Existing identities are stable, retained in source order. New complete
      // rows are appended; deletion does not rename or reorder retained rows.
      if (appended || index <= lastIndex) fail();
      lastIndex = index;
    }
    return body;
  });
}
function bodiesPatch(content, parsed, before, after, formatting) {
  const location = range(parsed, '/bodies');
  const originals = before.map((body, index) => ({ body, index, range: range(parsed, `/bodies/${index}`) }));
  const byId = new Map(originals.map(row => [row.body.id, row]));
  const prefix = content.slice(location.start + 1, originals[0].range.start);
  const suffix = content.slice(originals.at(-1).range.end, location.end - 1);
  const separator = originals.length > 1 ? content.slice(originals.at(-2).range.end, originals.at(-1).range.start) : `,${prefix}`;
  const base = formatting.indent(originals[0].range.start);
  const pieces = after.map((body, index) => {
    const original = byId.get(body.id);
    const text = original
      ? applyPatches(content.slice(original.range.start, original.range.end),
        bodyPatches(content, parsed, original.body, body, original.index, formatting), original.range.start)
      : serialize(body, formatting, base);
    const preceding = index === 0 ? prefix : original?.index > 0
      ? content.slice(originals[original.index - 1].range.end, original.range.start) : separator;
    return preceding + text;
  });
  return { ...location, text: `[${pieces.join('')}${suffix}]` };
}
async function patch(content, edit) {
  const before = await readScenePhysics2DDocument(content), fields = record(edit, ['bodies']);
  const bodies = candidateBodies(before, fields.bodies);
  const candidate = { ...before, schemaVersion: Math.max(before.schemaVersion, bodies.some(body => Object.hasOwn(body, 'platformMotion')) ? 5 : bodies.some(body => Object.hasOwn(body, 'oneWay')) ? 4 : bodies.some(body => Object.hasOwn(body, 'characterMotion')) ? 3
    : bodies.some(body => body.collisionResponse === 'slide') ? 2 : 1), bodies };
  await inspect(candidate); safeSerialization();
  const parsed = parseJsonSource(content), formatting = style(content, parsed);
  const sameRows = before.bodies.length === candidate.bodies.length && before.bodies.every((body, index) => body.id === candidate.bodies[index].id);
  const patches = sameRows
    ? before.bodies.flatMap((body, index) => bodyPatches(content, parsed, body, candidate.bodies[index], index, formatting))
    : [bodiesPatch(content, parsed, before.bodies, candidate.bodies, formatting)];
  if (before.schemaVersion !== candidate.schemaVersion) patches.unshift({ ...range(parsed, '/schemaVersion'), text: String(candidate.schemaVersion) });
  if (!patches.length) throw error('unchanged');
  const afterContent = applyPatches(content, patches);
  const after = await readScenePhysics2DDocument(afterContent); safeSerialization();
  if (canonicalJson(after) !== canonicalJson(candidate)) fail();
  return { beforeContent: content, afterContent, edit, changedPaths: patches.flatMap(item => item.propertyPaths ?? [item.propertyPath]) };
}
export async function createScenePhysics2DProposal(source, edit) {
  safeSerialization();
  const captured = captureSource(source), copied = copyData(edit);
  const patched = await patch(captured.content, copied);
  const proposal = freeze({ kind: 'scene-physics2d', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision, ...patched });
  proposals.add(proposal); return proposal;
}
export const isScenePhysics2DProposal = value => Boolean(value && typeof value === 'object' && proposals.has(value));
export async function prepareScenePhysics2DApply(source, proposal, { digest } = {}) {
  if (!isScenePhysics2DProposal(proposal) || typeof digest !== 'function') throw error('conflict');
  let captured;
  try { captured = captureSource(source); } catch { throw error('conflict'); }
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || hash.length !== 64 || !/^[a-f0-9]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('conflict');
  const checked = await patch(captured.content, proposal.edit);
  if (checked.afterContent !== proposal.afterContent || canonicalJson(checked.changedPaths) !== canonicalJson(proposal.changedPaths)) throw error('conflict');
  return freeze({ sourcePath: captured.sourcePath, afterContent: checked.afterContent, changedPaths: checked.changedPaths });
}
