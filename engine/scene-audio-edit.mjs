// Audio authoring owns source-safe leaf patches only. Rust owns audio semantics;
// the editor host retains Save, resource resolution and playback authority.
import { inspectSceneAudio } from './scene-audio-core.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';
const MAX_SOURCE_BYTES = 65536;
const proposals = new WeakSet();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const revision = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const error = (kind = 'invalid') => Object.assign(new TypeError('The audio edit does not match the reviewed source.'), {
  errorCode: `scene_audio_authoring_${kind}`,
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
// Domain validation remains owned by the Rust scene audio core.
function copyData(input, depth = 0, budget = { nodes: 0, bytes: 0 }) {
  if (++budget.nodes > 4096 || depth > 12) fail();
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

export async function readSceneAudioDocument(content) {
  if (typeof content !== 'string' || new TextEncoder().encode(content).length > MAX_SOURCE_BYTES) fail();
  const parsed = parseJsonSource(content);
  if (!parsed.ok) fail();
  await inspectSceneAudio(parsed.value);
  // Validation may return a time-sorted playback representation. Author source
  // order remains authoritative for editing, including cues at equal times.
  return parsed.value;
}
async function patchAudio(content, edit) {
  const before = await readSceneAudioDocument(content);
  const copied = copyData(edit), rows = record(copied, ['tracks', 'cues']);
  const candidate = JSON.parse(JSON.stringify(before));
  for (const [kind, fields] of [['tracks', ['role', 'volume', 'loop']], ['cues', ['atSeconds', 'action']]]) {
    if (!Array.isArray(rows[kind]) || rows[kind].length !== before[kind].length) fail();
    for (const [index, input] of rows[kind].entries()) {
      const row = record(input, ['id', ...fields]);
      if (row.id !== before[kind][index].id) fail();
      for (const key of fields) candidate[kind][index][key] = row[key];
    }
  }
  await inspectSceneAudio(candidate);
  const parsed = parseJsonSource(content), patches = [], changedPaths = [];
  for (const [kind, fields] of [['tracks', ['role', 'volume', 'loop']], ['cues', ['atSeconds', 'action']]]) {
    for (const [index, row] of candidate[kind].entries()) {
      for (const key of fields) {
        if (canonicalJson(row[key]) === canonicalJson(before[kind][index][key])) continue;
        const path = `/${kind}/${index}/${key}`, range = locateJsonSource(parsed, path);
        if (!range?.exact || range.encoding !== 'utf-16') fail();
        patches.push({ ...range, text: JSON.stringify(row[key]) }); changedPaths.push(path);
      }
    }
  }
  if (!patches.length) throw error('unchanged');
  let afterContent = content;
  for (const patch of patches.sort((a, b) => b.start - a.start)) afterContent = afterContent.slice(0, patch.start) + patch.text + afterContent.slice(patch.end);
  const after = await readSceneAudioDocument(afterContent);
  if (canonicalJson(after) !== canonicalJson(candidate)) fail();
  return { beforeContent: content, afterContent, edit: copied, changedPaths };
}
export async function createSceneAudioProposal(source, edit) {
  // Capture caller-owned input before the first asynchronous core invocation.
  const captured = captureSource(source), copied = copyData(edit);
  const patched = await patchAudio(captured.content, copied);
  const proposal = freeze({ kind: 'scene-audio', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision, ...patched });
  proposals.add(proposal); return proposal;
}
export function isSceneAudioProposal(value) { return Boolean(value && typeof value === 'object' && proposals.has(value)); }
export async function prepareSceneAudioApply(source, proposal, { digest } = {}) {
  if (!isSceneAudioProposal(proposal) || typeof digest !== 'function') throw error('conflict');
  let captured;
  try { captured = captureSource(source); } catch { throw error('conflict'); }
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('conflict');
  const repeated = await patchAudio(captured.content, proposal.edit);
  if (repeated.afterContent !== proposal.afterContent || canonicalJson(repeated.changedPaths) !== canonicalJson(proposal.changedPaths)) throw error('conflict');
  return freeze({ sourcePath: captured.sourcePath, afterContent: repeated.afterContent, changedPaths: repeated.changedPaths });
}
