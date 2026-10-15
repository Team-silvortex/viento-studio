// Versioned, opt-in scene audio. Author scene formats and legacy plans stay intact.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { inspectSceneAudio } from './scene-audio-core.mjs';
export const SCENE_AUDIO_CAPABILITIES = Object.freeze(['audio.nonspatial', 'audio.timeline']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = message => { throw Object.assign(new Error(message), { errorCode: 'build_audio_invalid' }); };
const resourceValid = resource => uuid(resource?.id) && resource.kind === 'audio' && resource.extension === 'wav'
  && /^[a-f0-9]{64}$/.test(resource.sha256) && Number.isSafeInteger(resource.size) && resource.size >= 44 && resource.size <= 32 * 1024 * 1024;
const location = value => uuid(value?.objectId) && typeof value.sourcePath === 'string' && value.sourcePath.length <= 4096
  && value.sourcePath.endsWith('.json') && !/[\x00-\x1f\x7f\\:]/.test(value.sourcePath)
  && !value.sourcePath.split('/').some(part => !part || part === '.' || part === '..') && revision(value.sourceRevision);

export function stripSceneAudioPlan(plan) {
  const { audio, ...base } = structuredClone(plan);
  return { ...base, resources: base.resources.filter(resource => resource.kind !== 'audio'),
    requiredCapabilities: base.requiredCapabilities.filter(capability => !SCENE_AUDIO_CAPABILITIES.includes(capability)) };
}

export function validateSceneAudioPlan(plan) {
  const audio = plan?.audio;
  if (plan?.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![2, 3].includes(plan.schemaVersion)
    || audio?.format !== 'viento-audio-plan' || audio.schemaVersion !== 1 || !location(audio.manifest)
    || audio.manifest.objectId === plan.scene?.objectId || !Array.isArray(plan.resources)
    || !SCENE_AUDIO_CAPABILITIES.every(capability => plan.requiredCapabilities?.includes(capability))) fail('Invalid scene audio plan.');
  let checked;
  try { checked = inspectSceneAudio(audio.document).document; } catch { fail('Invalid frozen audio declaration.'); }
  if (checked.sceneObjectId !== plan.scene.objectId) fail('Audio must belong to the frozen scene.');
  const resources = new Map();
  for (const resource of plan.resources) {
    if (resources.has(resource.id)) fail('Duplicate frozen resource.');
    resources.set(resource.id, resource);
  }
  const used = new Set();
  for (const track of checked.tracks) {
    if (!resourceValid(resources.get(track.resourceId))) fail('Audio tracks require registered, bounded WAV resources.');
    used.add(track.resourceId);
  }
  if (plan.resources.some(resource => resource.kind === 'audio' && !used.has(resource.id))) fail('Unused audio resource.');
  for (const [key, entries] of [['tracks', checked.tracks], ['cues', checked.cues]]) {
    const mapped = audio.locations?.[key];
    if (!Array.isArray(mapped) || mapped.length !== entries.length || new Set(mapped.map(item => item.id)).size !== mapped.length) fail('Invalid audio source map.');
    for (const entry of entries) {
      const item = mapped.find(item => item.id === entry.id), at = item?.declaration;
      if (!location(at) || at.objectId !== audio.manifest.objectId || at.sourcePath !== audio.manifest.sourcePath
        || at.sourceRevision !== audio.manifest.sourceRevision || !new RegExp(`^/${key}/\\d+$`).test(at.propertyPath)) fail('Invalid audio source map.');
    }
  }
  return { ...audio, document: checked };
}

export function resolveSceneAudio(observed, plan) {
  const documents = observed.source.documents, scene = documents.find(document => document.record?.id === plan.scene.objectId);
  const selected = (scene?.record.relations || []).filter(relation => relation.kind === 'audio');
  const result = (audio, resources = [], diagnostics = []) => ({ ok: diagnostics.length === 0, audio, resources, diagnostics });
  if (!selected.length) return result(null);
  const base = { objectId: scene.record.id, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, propertyPath: '' };
  const sceneIssue = message => result(null, [], [{ severity: 'error', code: 'build_audio_invalid', message, ...base }]);
  if (selected.length !== 1) return sceneIssue('A scene may reference one audio declaration.');
  if (![2, 3].includes(plan.schemaVersion)) return sceneIssue('Audio requires a Scene2D with stable instance identities.');
  const source = documents.find(document => document.record?.id === selected[0].targetId);
  if (!source || typeof source.content !== 'string' || source.content.length > 32768 || new TextEncoder().encode(source.content).length > 32768
    || source.record.format !== 'viento-document' || !source.sourcePath.endsWith('.json') || source.sourcePath !== source.record.sourcePath
    || source.record.id === scene.record.id) return sceneIssue('Select an available registered audio JSON document of at most 32 KiB.');
  const parsed = parseJsonSource(source.content);
  const provenance = { objectId: source.record.id, sourcePath: source.sourcePath, sourceRevision: source.sourceRevision };
  const at = pointer => ({ ...provenance, propertyPath: pointer,
    ...(parsed.ok ? { sourceRange: locateJsonSource(parsed, pointer, { nearest: true }) } : {}) });
  const diagnostics = [];
  const issue = (message, pointer = '', details = {}) => diagnostics.push({ severity: 'error', code: 'build_audio_invalid', message, ...at(pointer), ...details });
  if (!parsed.ok) { for (const error of parsed.diagnostics) issue(error.message, error.propertyPath || ''); return result(null, [], diagnostics); }
  let document;
  try { document = inspectSceneAudio(parsed.value).document; } catch (error) { issue(error.message || 'Invalid audio declaration.'); return result(null, [], diagnostics); }
  if (document.sceneObjectId !== scene.record.id) issue('The audio declaration must name the scene that references it.', '/sceneObjectId');
  if (!source.record.relations?.some(relation => relation.kind !== 'part-of' && relation.targetId === scene.record.id)) issue('Register the audio-to-scene reference so migration retains the dependency.', '/sceneObjectId');
  const resources = new Map();
  for (const [index, track] of parsed.value.tracks.entries()) {
    const asset = observed.source.assets.find(item => item.record?.id === track.resourceId)?.record;
    const pointer = `/tracks/${index}/resourceId`;
    const resource = asset && { id: asset.id, kind: 'audio', extension: asset.location?.path?.split('.').at(-1).toLowerCase(), ...asset.content };
    if (asset?.kind !== 'audio' || !resourceValid(resource)) { issue('Choose a registered PCM WAV with a content hash, at most 32 MiB.', pointer, { resourceId: track.resourceId }); continue; }
    if (!source.record.assetBindings?.some(binding => binding.assetId === track.resourceId)) {
      issue('Bind the audio resource to this declaration so resource packages retain it.', pointer, { resourceId: track.resourceId }); continue;
    }
    resources.set(track.resourceId, resource);
  }
  if (diagnostics.length) return result(null, [], diagnostics);
  const audio = { format: 'viento-audio-plan', schemaVersion: 1, manifest: provenance, document,
    locations: Object.fromEntries(['tracks', 'cues'].map(key => [key, parsed.value[key].map((item, index) => ({ id: item.id, declaration: at(`/${key}/${index}`) }))])) };
  return result(audio, [...resources.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

export function audioResourceLocation(plan, resourceId) {
  const track = plan.audio?.document.tracks.find(track => track.resourceId === resourceId);
  const entry = plan.audio?.locations.tracks.find(item => item.id === track?.id)?.declaration;
  return entry ? { ...entry, propertyPath: `${entry.propertyPath}/resourceId`, sourceRange: entry.sourceRange ? { ...entry.sourceRange, exact: false } : undefined } : null;
}
