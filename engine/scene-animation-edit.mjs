// Animation authoring owns source-safe leaf and array patches. Rust owns animation semantics;
// the editor host retains Save, resource resolution and playback authority.
import { inspectSceneAnimation } from './scene-animation-core.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';
const MAX_SOURCE_BYTES = 131072;
const proposals = new WeakSet();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const revision = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const error = (kind = 'invalid') => Object.assign(new TypeError('The animation edit does not match the reviewed source.'), {
  errorCode: `scene_animation_authoring_${kind}`,
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
    || typeof source.content !== 'string' || source.content.length > MAX_SOURCE_BYTES
    || !validUnicode(source.content) || new TextEncoder().encode(source.content).length > MAX_SOURCE_BYTES) fail();
  return Object.freeze(source);
}

// Snapshot user data without invoking getters, serializers or inherited values.
// Domain validation remains owned by the Rust scene animation core.
function copyData(input, depth = 0, budget = { nodes: 0, bytes: 0 }) {
  if (++budget.nodes > 8192 || depth > 12) fail();
  if (typeof input === 'string') {
    if (input.length > MAX_SOURCE_BYTES || !validUnicode(input)
      || (budget.bytes += new TextEncoder().encode(input).length) > MAX_SOURCE_BYTES) fail();
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
      || (budget.bytes += new TextEncoder().encode(key).length) > MAX_SOURCE_BYTES) fail();
    Object.defineProperty(output, key, { enumerable: true, configurable: true, writable: true,
      value: copyData(descriptor.value, depth + 1, budget) });
  }
  // Dense arrays may not carry extra named/symbol fields instead of an index.
  if (array && names.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length))) fail();
  return output;
}


export async function readSceneAnimationDocument(content) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > MAX_SOURCE_BYTES) fail();
  const parsed = parseJsonSource(content);
  if (!parsed.ok) fail();
  await inspectSceneAnimation(parsed.value);
  return parsed.value;
}
function range(parsed, path) {
  const value = locateJsonSource(parsed, path);
  if (!value?.exact || value.encoding !== 'utf-16') fail();
  return value;
}
function replacement(content, parsed, path, value) {
  const location = range(parsed, path), newline = content.match(/\r\n|\n|\r/)?.[0];
  const indent = offset => content.slice(0, offset).split(/\r\n|\n|\r/).at(-1).match(/^[ \t]*/)[0];
  const unit = indent(range(parsed, '/format').start) || '  ', base = indent(location.start);
  const text = value && typeof value === 'object' && newline
    ? JSON.stringify(value, null, unit).replaceAll('\n', newline + base) : JSON.stringify(value);
  return { ...location, text };
}
async function patch(content, edit) {
  const before = await readSceneAnimationDocument(content);
  const fields = record(edit, ['durationSeconds', 'loop', 'tracks']);
  const candidate = { ...before, ...fields };
  await inspectSceneAnimation(candidate);
  const parsed = parseJsonSource(content), patches = [];
  const leaf = (path, a, b) => { if (canonicalJson(a) !== canonicalJson(b)) patches.push(replacement(content, parsed, path, b)); };
  leaf('/durationSeconds', before.durationSeconds, candidate.durationSeconds);
  leaf('/loop', before.loop, candidate.loop);
  const sameTracks = before.tracks.length === candidate.tracks.length && before.tracks.every((row, i) => row.id === candidate.tracks[i].id);
  if (!sameTracks) leaf('/tracks', before.tracks, candidate.tracks);
  else before.tracks.forEach((row, i) => {
    const next = candidate.tracks[i], path = `/tracks/${i}`;
    for (const key of ['instanceId', 'property', 'interpolation']) leaf(`${path}/${key}`, row[key], next[key]);
    if (row.keyframes.length !== next.keyframes.length) leaf(`${path}/keyframes`, row.keyframes, next.keyframes);
    else row.keyframes.forEach((frame, j) => {
      leaf(`${path}/keyframes/${j}/atSeconds`, frame.atSeconds, next.keyframes[j].atSeconds);
      leaf(`${path}/keyframes/${j}/value`, frame.value, next.keyframes[j].value);
    });
  });
  if (!patches.length) throw error('unchanged');
  let afterContent = content;
  for (const item of [...patches].sort((a, b) => b.start - a.start)) afterContent = afterContent.slice(0, item.start) + item.text + afterContent.slice(item.end);
  if (canonicalJson(await readSceneAnimationDocument(afterContent)) !== canonicalJson(candidate)) fail();
  return { beforeContent: content, afterContent, edit, changedPaths: patches.map(item => item.propertyPath) };
}
export async function createSceneAnimationProposal(source, edit) {
  const captured = captureSource(source), copied = copyData(edit);
  const proposal = freeze({ kind: 'scene-animation', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision, ...await patch(captured.content, copied) });
  proposals.add(proposal); return proposal;
}
export const isSceneAnimationProposal = value => Boolean(value && typeof value === 'object' && proposals.has(value));
export async function prepareSceneAnimationApply(source, proposal, { digest } = {}) {
  if (!isSceneAnimationProposal(proposal) || typeof digest !== 'function') throw error('conflict');
  let captured;
  try { captured = captureSource(source); } catch { throw error('conflict'); }
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken || captured.baseSourceRevision !== proposal.baseSourceRevision
    || captured.sourceRevision !== proposal.sourceRevision || captured.content !== proposal.beforeContent) throw error('conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('conflict');
  const checked = await patch(captured.content, proposal.edit);
  if (checked.afterContent !== proposal.afterContent || canonicalJson(checked.changedPaths) !== canonicalJson(proposal.changedPaths)) throw error('conflict');
  return freeze({ sourcePath: captured.sourcePath, afterContent: checked.afterContent, changedPaths: checked.changedPaths });
}
