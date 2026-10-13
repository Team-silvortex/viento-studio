// Local behavior authoring has no dependency, Save, World or execution authority.
// The host still owns the editor session and rechecks it after asynchronous work.
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';

const proposals = new WeakSet();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const revision = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const error = (kind = 'invalid') => Object.assign(new TypeError('The behavior edit does not match the reviewed source.'), {
  errorCode: `scene_behavior_authoring_${kind}`,
});
const fail = () => { throw error(); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const validUnicode = text => {
  for (const character of text) { const code = character.codePointAt(0); if (code >= 0xd800 && code <= 0xdfff) return false; }
  return true;
};
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function captureSource(input) {
  const source = record(input, sourceKeys);
  if (typeof source.sourcePath !== 'string' || !source.sourcePath || source.sourcePath.length > 4096
    || !validUnicode(source.sourcePath) || source.sourcePath.startsWith('/') || /^[A-Za-z]:/.test(source.sourcePath)
    || /[\\\0]/.test(source.sourcePath) || source.sourcePath.split('/').some(part => !part || part === '.' || part === '..')
    || !/\.json$/i.test(source.sourcePath) || typeof source.token !== 'string' || !source.token || source.token.length > 256
    || !validUnicode(source.token) || !revision(source.baseSourceRevision) || !revision(source.sourceRevision)
    || typeof source.content !== 'string' || source.content.length > SCENE_BEHAVIOR_LIMITS.manifestBytes
    || !validUnicode(source.content) || new TextEncoder().encode(source.content).length > SCENE_BEHAVIOR_LIMITS.manifestBytes) fail();
  return Object.freeze(source);
}

// Snapshot user data without invoking getters, serializers or inherited values.
// Domain validation below remains owned by inspectSceneBehaviors.
function copyData(input, depth = 0, budget = { nodes: 0, bytes: 0 }) {
  if (++budget.nodes > 4096 || depth > 12) fail();
  if (typeof input === 'string') {
    if (input.length > SCENE_BEHAVIOR_LIMITS.manifestBytes || !validUnicode(input)
      || (budget.bytes += new TextEncoder().encode(input).length) > SCENE_BEHAVIOR_LIMITS.manifestBytes) fail();
    return input;
  }
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'number') { if (!Number.isFinite(input)) fail(); return input; }
  if (!input || typeof input !== 'object') fail();
  const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)
    || array && input.length > 4096 || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
    || array && Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length > 4097 || array && names.length !== input.length + 1) fail();
  const output = array ? [] : Object.create(null);
  for (const key of array ? Array.from({ length: input.length }, (_, index) => String(index)) : names) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
      || key.length > 192 || !validUnicode(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || (budget.bytes += new TextEncoder().encode(key).length) > SCENE_BEHAVIOR_LIMITS.manifestBytes) fail();
    Object.defineProperty(output, key, { enumerable: true, configurable: true, writable: true,
      value: copyData(descriptor.value, depth + 1, budget) });
  }
  // Dense arrays may not carry extra named/symbol fields instead of an index.
  if (array && names.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length))) fail();
  return output;
}
function inspect(content) {
  const result = inspectSceneBehaviors(content);
  if (!result.recognized || !result.ok || !result.value) fail();
  return result.value;
}
const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
function location(parsed, path) {
  const range = locateJsonSource(parsed, path);
  if (!range?.exact || range.encoding !== 'utf-16') fail();
  return range;
}
function formatValue(value, content, range) {
  const raw = content.slice(range.start, range.end);
  if (!/[\r\n]/.test(raw)) return JSON.stringify(value);
  const eol = content.match(/\r\n|\r|\n/)?.[0] || '\n';
  const prefix = content.slice(0, range.start), base = prefix.slice(Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r')) + 1).match(/^[\t ]*/)[0];
  const child = raw.match(/(?:\r\n|\r|\n)([\t ]+)\S/)?.[1];
  const unit = child?.startsWith(base) && child.length > base.length ? child.slice(base.length) : base.includes('\t') ? '\t' : '  ';
  return JSON.stringify(value, null, unit).replaceAll('\n', eol + base);
}
function patchesFor(before, after, oldPath, newPath, parsed, content, patches, changedPaths) {
  if (canonicalJson(before) === canonicalJson(after)) return;
  const array = Array.isArray(before), afterArray = Array.isArray(after);
  if (before && after && typeof before === 'object' && typeof after === 'object' && array === afterArray
    && (array ? before.length === after.length : Object.keys(before).length === Object.keys(after).length
      && Object.keys(before).every(key => Object.hasOwn(after, key)))) {
    for (const key of Object.keys(before)) patchesFor(before[key], after[key], `${oldPath}/${pointer(key)}`, `${newPath}/${pointer(key)}`, parsed, content, patches, changedPaths);
    return;
  }
  const range = location(parsed, oldPath);
  patches.push({ ...range, text: formatValue(after, content, range) }); changedPaths.push(newPath);
}
function patchBindings(content, bindings) {
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
  const before = inspect(content), copied = copyData(bindings);
  const candidate = inspect(JSON.stringify({ ...before, bindings: copied }));
  const implementation = before.bindings[0].implementation;
  if (candidate.bindings.some(binding => binding.implementation.backendId !== implementation.backendId
    || binding.implementation.language !== implementation.language)) fail();
  if (canonicalJson(before.bindings) === canonicalJson(candidate.bindings)) throw error('unchanged');
  const parsed = parseJsonSource(content), array = location(parsed, '/bindings');
  const spans = before.bindings.map((_, index) => location(parsed, `/bindings/${index}`));
  const byId = new Map(before.bindings.map((binding, index) => [binding.bindingId, { binding, index, range: spans[index] }]));
  const separators = spans.slice(0, -1).map((span, index) => content.slice(span.end, spans[index + 1].start));
  const prefix = content.slice(array.start, spans[0].start), suffix = content.slice(spans.at(-1).end, array.end);
  const changedPaths = [], pieces = [];
  for (const [index, binding] of candidate.bindings.entries()) {
    if (index) {
      const left = byId.get(candidate.bindings[index - 1].bindingId), right = byId.get(binding.bindingId);
      pieces.push(left && right?.index === left.index + 1 ? separators[left.index]
        : (left && separators[left.index]) || (right && separators[right.index - 1]) || separators[0] || ',' + prefix.slice(1));
    }
    const original = byId.get(binding.bindingId);
    if (!original) { pieces.push(formatValue(binding, content, spans[0])); continue; }
    const patches = [];
    patchesFor(original.binding, binding, `/bindings/${original.index}`, `/bindings/${index}`, parsed, content, patches, changedPaths);
    let raw = content.slice(original.range.start, original.range.end);
    for (const patch of patches.sort((left, right) => right.start - left.start)) raw = raw.slice(0, patch.start - original.range.start) + patch.text + raw.slice(patch.end - original.range.start);
    pieces.push(raw);
  }
  const afterContent = content.slice(0, array.start) + prefix + pieces.join('') + suffix + content.slice(array.end);
  const after = inspect(afterContent);
  if (canonicalJson(after) !== canonicalJson(candidate)) fail();
  const structural = before.bindings.length !== after.bindings.length
    || before.bindings.some((binding, index) => after.bindings[index]?.bindingId !== binding.bindingId);
  return { beforeContent: content, afterContent, bindings: after.bindings, changedPaths: structural ? ['/bindings'] : changedPaths };
}

export function createSceneBehaviorProposal(source, edit) {
  const captured = captureSource(source), { bindings } = record(edit, ['bindings']);
  const patched = patchBindings(captured.content, bindings);
  const proposal = freeze({ kind: 'scene-behaviors', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision, ...patched });
  proposals.add(proposal); return proposal;
}

export function isSceneBehaviorProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}

export async function prepareSceneBehaviorApply(source, proposal, { digest } = {}) {
  if (!isSceneBehaviorProposal(proposal) || typeof digest !== 'function') throw error('conflict');
  let captured;
  try { captured = captureSource(source); } catch { throw error('conflict'); }
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('conflict');
  const repeated = patchBindings(captured.content, proposal.bindings);
  if (repeated.beforeContent !== proposal.beforeContent || repeated.afterContent !== proposal.afterContent
    || !repeated.changedPaths.length || canonicalJson(repeated.changedPaths) !== canonicalJson(proposal.changedPaths)) throw error('conflict');
  return freeze({ afterContent: repeated.afterContent, sourcePath: captured.sourcePath, changedPaths: repeated.changedPaths });
}
