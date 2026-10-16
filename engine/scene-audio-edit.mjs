// Audio authoring owns source-safe leaf and array patches. Rust owns audio semantics;
// the editor host retains Save, resource resolution and playback authority.
import { inspectSceneAudio } from './scene-audio-core.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { isSceneAudioResources, sceneAudioResourcesMatchSource, sceneAudioResourcesEqual, sceneAudioResourceIdentityIds } from './scene-audio-resources.mjs';
const MAX_SOURCE_BYTES = 65536;
const proposals = new WeakSet();
const proposalModes = new WeakMap();
const proposalResources = new WeakMap();
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
const trackFields = ['role', 'volume', 'loop'];
const trackKeys = ['id', 'resourceId', ...trackFields];
const cueFields = ['atSeconds', 'action'];
const timelineFields = ['trackId', ...cueFields];
const cueKeys = ['id', 'trackId', ...cueFields];
function sourceRange(parsed, path) {
  const range = locateJsonSource(parsed, path);
  if (!range?.exact || range.encoding !== 'utf-16') fail();
  return range;
}
function applyPatches(content, patches, offset = 0) {
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    content = content.slice(0, patch.start - offset) + patch.text + content.slice(patch.end - offset);
  }
  return content;
}
function leafPatches(parsed, before, after, path, fields) {
  return fields.filter(key => canonicalJson(before[key]) !== canonicalJson(after[key]))
    .map(key => ({ ...sourceRange(parsed, `${path}/${key}`), text: JSON.stringify(after[key]) }));
}
function captureTrackRows(before, inputs, catalog) {
  if (!Array.isArray(inputs)) fail();
  const originals = new Map(before.tracks.map((row, index) => [row.id, { row, index }]));
  const resources = new Set(catalog ? catalog.resources.map(row => row.resourceId) : before.tracks.map(row => row.resourceId));
  const reserved = new Set([before.sceneObjectId, ...before.tracks.flatMap(row => [row.id, row.resourceId]), ...before.cues.map(row => row.id),
    ...(catalog ? sceneAudioResourceIdentityIds(catalog) : [])]);
  let lastIndex = -1, appended = false;
  return inputs.map(input => {
    const row = record(input, trackKeys), existing = originals.get(row.id);
    if (catalog && !resources.has(row.resourceId)) fail();
    if (existing) {
      if (appended || existing.index <= lastIndex || !catalog && row.resourceId !== existing.row.resourceId) fail();
      lastIndex = existing.index;
    } else {
      // Ordinary duplication stays within the source resource set. A branded
      // catalog adds only the already-bound choices checked by the host.
      if (reserved.has(row.id) || !resources.has(row.resourceId)) fail();
      appended = true;
    }
    return row;
  });
}
function captureCueRows(before, inputs, arrangeTimeline = false, candidateTracks = before.tracks, resourceIdentities = []) {
  if (!Array.isArray(inputs)) fail();
  const originals = new Map(before.cues.map((row, index) => [row.id, { row, index }]));
  const reserved = new Set([before.sceneObjectId, ...[...before.tracks, ...candidateTracks].flatMap(row => [row.id, row.resourceId]), ...resourceIdentities]);
  let lastIndex = -1, appended = false;
  return inputs.map(input => {
    const row = record(input, cueKeys), existing = originals.get(row.id);
    if (existing) {
      // The cue-only API keeps its ordered-subsequence and fixed-binding
      // contract. The separate timeline API permits arranging those identities.
      if (!arrangeTimeline && (appended || existing.index <= lastIndex || row.trackId !== existing.row.trackId)) fail();
      lastIndex = existing.index;
    } else {
      if (reserved.has(row.id)) fail();
      appended = true;
    }
    return row;
  });
}
function audioArrayPatch(content, parsed, kind, before, after, fields, keys) {
  const range = sourceRange(parsed, `/${kind}`);
  const originals = before.map((row, index) => ({ row, index, range: sourceRange(parsed, `/${kind}/${index}`) }));
  const byId = new Map(originals.map(entry => [entry.row.id, entry]));
  let prefix, suffix, separator, emptyTemplate;
  if (originals.length) {
    prefix = content.slice(range.start + 1, originals[0].range.start);
    suffix = content.slice(originals.at(-1).range.end, range.end - 1);
    separator = originals.length > 1
      ? content.slice(originals.at(-2).range.end, originals.at(-1).range.start) : `,${prefix}`;
  } else {
    // An empty array has no cue to reuse. Follow the document's line ending
    // and indentation, including the common pretty-printed "cues": [] case.
    const newline = content.match(/\r\n|\n|\r/)?.[0];
    const indentation = index => content.slice(0, index).split(/\r\n|\n|\r/).at(-1).match(/^[ \t]*/)[0];
    const base = indentation(range.start), unit = indentation(sourceRange(parsed, '/format').start) || '  ';
    const rowIndent = base + unit;
    prefix = newline ? newline + rowIndent : '';
    suffix = newline ? newline + base : '';
    separator = `,${prefix}`;
    emptyTemplate = row => newline
      ? JSON.stringify(row, null, unit).replaceAll('\n', newline + rowIndent) : JSON.stringify(row);
  }
  const pieces = after.map((row, index) => {
    const existing = byId.get(row.id), template = existing || originals[0];
    const text = template
      ? applyPatches(content.slice(template.range.start, template.range.end),
        leafPatches(parsed, template.row, row, `/${kind}/${template.index}`, existing ? fields : keys), template.range.start)
      : emptyTemplate(row);
    const preceding = index === 0 ? prefix : existing?.index > 0
      ? content.slice(originals[existing.index - 1].range.end, existing.range.start) : separator;
    return preceding + text;
  });
  return { ...range, text: `[${pieces.join('')}${suffix}]` };
}
async function patchAudio(content, edit, mode = 'leaf', catalog) {
  const editResources = mode === 'resources', editTracks = mode === 'tracks' || editResources;
  const editCueStructure = mode !== 'leaf', arrangeTimeline = mode === 'timeline' || editTracks;
  const editableCueFields = arrangeTimeline ? timelineFields : cueFields;
  const editableTrackFields = editResources ? ['resourceId', ...trackFields] : trackFields;
  const before = await readSceneAudioDocument(content);
  const copied = copyData(edit), rows = record(copied, ['tracks', 'cues']);
  const candidate = JSON.parse(JSON.stringify(before));
  for (const [kind, fields] of [...(editTracks ? [] : [['tracks', trackFields]]), ...(editCueStructure ? [] : [['cues', cueFields]])]) {
    if (!Array.isArray(rows[kind]) || rows[kind].length !== before[kind].length) fail();
    for (const [index, input] of rows[kind].entries()) {
      const row = record(input, ['id', ...fields]);
      if (row.id !== before[kind][index].id) fail();
      for (const key of fields) candidate[kind][index][key] = row[key];
    }
  }
  if (editTracks) candidate.tracks = captureTrackRows(before, rows.tracks, editResources ? catalog : undefined);
  if (editCueStructure) candidate.cues = captureCueRows(before, rows.cues, arrangeTimeline, candidate.tracks, editResources ? sceneAudioResourceIdentityIds(catalog) : []);
  await inspectSceneAudio(candidate);
  const parsed = parseJsonSource(content), patches = [], changedPaths = [];
  for (const [kind, fields, keys] of [['tracks', editableTrackFields, trackKeys], ['cues', editableCueFields, cueKeys]]) {
    const structureChanged = candidate[kind].length !== before[kind].length || candidate[kind].some((row, index) => row.id !== before[kind][index].id);
    if (structureChanged) patches.push(audioArrayPatch(content, parsed, kind, before[kind], candidate[kind], fields, keys));
    else for (const [index, row] of candidate[kind].entries()) {
      patches.push(...leafPatches(parsed, before[kind][index], row, `/${kind}/${index}`, fields));
    }
  }
  changedPaths.push(...patches.map(patch => patch.propertyPath));
  if (!patches.length) throw error('unchanged');
  const afterContent = applyPatches(content, patches);
  const after = await readSceneAudioDocument(afterContent);
  if (canonicalJson(after) !== canonicalJson(candidate)) fail();
  return { beforeContent: content, afterContent, edit: copied, changedPaths };
}
async function createProposal(source, edit, mode, catalog) {
  // Capture caller-owned input before the first asynchronous core invocation.
  const captured = captureSource(source), copied = copyData(edit);
  if (mode === 'resources' && !sceneAudioResourcesMatchSource(catalog, captured)) fail();
  const patched = await patchAudio(captured.content, copied, mode, catalog);
  const proposal = freeze({ kind: 'scene-audio', sourcePath: captured.sourcePath, sourceToken: captured.token,
    baseSourceRevision: captured.baseSourceRevision, sourceRevision: captured.sourceRevision, ...patched });
  proposals.add(proposal);
  proposalModes.set(proposal, mode);
  if (mode === 'resources') proposalResources.set(proposal, catalog);
  return proposal;
}
// Keep the original API's exact leaf-only transport contract unchanged.
export async function createSceneAudioProposal(source, edit) { return createProposal(source, edit, 'leaf'); }
export async function createSceneAudioCueProposal(source, edit) { return createProposal(source, edit, 'cues'); }
export async function createSceneAudioTimelineProposal(source, edit) { return createProposal(source, edit, 'timeline'); }
export async function createSceneAudioTrackProposal(source, edit) { return createProposal(source, edit, 'tracks'); }
export async function createSceneAudioResourceProposal(source, edit, catalog) { return createProposal(source, edit, 'resources', catalog); }
export function isSceneAudioProposal(value) { return Boolean(value && typeof value === 'object' && proposals.has(value)); }
export function sceneAudioProposalNeedsResources(value) { return isSceneAudioProposal(value) && proposalModes.get(value) === 'resources'; }
export async function prepareSceneAudioApply(source, proposal, { digest, resources } = {}) {
  if (!isSceneAudioProposal(proposal) || typeof digest !== 'function') throw error('conflict');
  let captured;
  try { captured = captureSource(source); } catch { throw error('conflict'); }
  if (captured.sourcePath !== proposal.sourcePath || captured.token !== proposal.sourceToken
    || captured.baseSourceRevision !== proposal.baseSourceRevision || captured.sourceRevision !== proposal.sourceRevision
    || captured.content !== proposal.beforeContent) throw error('conflict');
  const needsResources = sceneAudioProposalNeedsResources(proposal), reviewedResources = proposalResources.get(proposal);
  if (needsResources && (!isSceneAudioResources(resources) || resources === reviewedResources
    || !sceneAudioResourcesMatchSource(resources, captured) || !sceneAudioResourcesEqual(resources, reviewedResources))) throw error('conflict');
  const hash = await digest(captured.content);
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || `sha256:${hash}` !== captured.sourceRevision) throw error('conflict');
  if (needsResources) {
    const savedHash = await digest(resources.savedContent);
    if (typeof savedHash !== 'string' || !/^[a-f0-9]{64}$/.test(savedHash) || `sha256:${savedHash}` !== captured.baseSourceRevision) throw error('conflict');
  }
  const repeated = await patchAudio(captured.content, proposal.edit, proposalModes.get(proposal), needsResources ? resources : undefined);
  if (repeated.afterContent !== proposal.afterContent || canonicalJson(repeated.changedPaths) !== canonicalJson(proposal.changedPaths)) throw error('conflict');
  return freeze({ sourcePath: captured.sourcePath, afterContent: repeated.afterContent, changedPaths: repeated.changedPaths });
}
