// Independent saved animation declarations. Scene2D author formats and static
// preview remain unchanged; only executable plans explicitly opt in.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { inspectSceneAnimation } from './scene-animation-core.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_ANIMATION_CAPABILITIES = Object.freeze(['animation.visual2d']);
export const SCENE_ANIMATION_MAX_BYTES = 131072;
export const sceneAnimationCapabilities = document => [ ...SCENE_ANIMATION_CAPABILITIES,
  ...(Array.isArray(document?.tracks) && document.tracks.some(track => track?.property === 'spriteFrame2d') ? ['animation.sprite2d'] : []),
  ...([3, 4].includes(document?.schemaVersion) ? ['animation.clips2d'] : []),
  ...(document?.schemaVersion === 4 && document.playbackScope === 'instance' ? ['animation.instances2d'] : []) ];
// A frame track crops the image already selected by its scene instance. It does
// not create another resource path, binding authority or capture IO channel.
export function sceneAnimationSpriteResource(plan, track) {
  const actor = plan.actors?.find(actor => actor.instanceId === track.instanceId);
  if (!uuid(actor?.imageResourceId) || !Array.isArray(plan.resources)) return null;
  const matching = plan.resources.filter(resource => resource?.id === actor.imageResourceId);
  const resource = matching[0];
  if (matching.length !== 1 || !resource || resource.kind !== undefined && resource.kind !== 'image'
    || !['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(resource.extension)
    || typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256)
    || !Number.isSafeInteger(resource.size) || resource.size < 1 || resource.size > 32 * 1024 * 1024) return null;
  return resource;
}
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = message => { throw Object.assign(new TypeError(message), { errorCode: 'build_animation_invalid' }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const location = value => uuid(value?.objectId) && typeof value.sourcePath === 'string' && value.sourcePath.length <= 4096
  && value.sourcePath.endsWith('.json') && normalizeSourcePath(value.sourcePath) === value.sourcePath
  && !/[\x00-\x1f\x7f:]/.test(value.sourcePath) && revision(value.sourceRevision);

export function stripSceneAnimationPlan(plan) {
  const { animation, ...base } = structuredClone(plan);
  return { ...base, requiredCapabilities: base.requiredCapabilities.filter(capability => ![...SCENE_ANIMATION_CAPABILITIES, 'animation.sprite2d', 'animation.clips2d', 'animation.instances2d'].includes(capability)) };
}

export function validateSceneAnimationPlan(plan) {
  const animation = plan?.animation;
  if (plan?.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![2, 3].includes(plan.schemaVersion)
    || !exact(animation, ['format', 'schemaVersion', 'manifest', 'document', 'locations'])
    || animation.format !== 'viento-animation-plan' || animation.schemaVersion !== (animation.document?.schemaVersion === 4 ? 3 : animation.document?.schemaVersion === 3 ? 2 : 1)
    || !exact(animation.manifest, ['objectId', 'sourcePath', 'sourceRevision']) || !location(animation.manifest)
    || animation.manifest.objectId === plan.scene?.objectId || !Array.isArray(plan.actors)
    || !SCENE_ANIMATION_CAPABILITIES.every(capability => plan.requiredCapabilities?.includes(capability))) fail('Invalid scene animation plan.');
  let document;
  try { document = inspectSceneAnimation(animation.document).document; }
  catch { fail('Invalid frozen animation declaration.'); }
  if (!sceneAnimationCapabilities(document).every(capability => plan.requiredCapabilities.includes(capability))) fail('Missing animation capability.');
  if (document.sceneObjectId !== plan.scene.objectId) fail('Animation must belong to the frozen scene.');
  const instances = new Set();
  for (const actor of plan.actors) {
    if (!uuid(actor.instanceId) || instances.has(actor.instanceId)) fail('Animation requires unique stable instance identities.');
    instances.add(actor.instanceId);
  }
  const mapped = animation.locations?.tracks;
  if (!exact(animation.locations, ['tracks', ...([3, 4].includes(document.schemaVersion) ? ['clips'] : [])]) || !Array.isArray(mapped) || mapped.length !== document.tracks.length) fail('Invalid animation source map.');
  for (const [index, track] of document.tracks.entries()) {
    if (!instances.has(track.instanceId)) fail('Animation targets an instance outside the frozen scene.');
    if (track.property === 'spriteFrame2d' && !sceneAnimationSpriteResource(plan, track)) fail('Frame animation requires the instance image in the frozen resources.');
    const item = mapped[index], at = item?.declaration;
    if (!exact(item, ['id', 'declaration']) || item.id !== track.id || !location(at)
      || at.objectId !== animation.manifest.objectId || at.sourcePath !== animation.manifest.sourcePath
      || at.sourceRevision !== animation.manifest.sourceRevision || at.propertyPath !== `/tracks/${index}`) fail('Invalid animation source map.');
  }
  if ([3, 4].includes(document.schemaVersion)) {
    if (!Array.isArray(animation.locations.clips) || animation.locations.clips.length !== document.clips.length) fail('Invalid animation clip source map.');
    for (const [index, clip] of document.clips.entries()) {
      const item = animation.locations.clips[index], at = item?.declaration;
      if (!exact(item, ['id', 'declaration']) || item.id !== clip.id || !location(at)
        || at.objectId !== animation.manifest.objectId || at.sourcePath !== animation.manifest.sourcePath
        || at.sourceRevision !== animation.manifest.sourceRevision || at.propertyPath !== `/clips/${index}`) fail('Invalid animation clip source map.');
    }
  }
  return { ...animation, document };
}

export function resolveSceneAnimation(observed, plan) {
  const documents = observed.source.documents;
  const scene = documents.find(document => document.record?.id === plan.scene.objectId);
  const selected = (scene?.record.relations || []).filter(relation => relation.kind === 'animation');
  const result = (animation, diagnostics = []) => ({ ok: diagnostics.length === 0, animation, diagnostics });
  if (!selected.length) return result(null);
  const base = { objectId: scene.record.id, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, propertyPath: '' };
  const sceneIssue = message => result(null, [{ severity: 'error', code: 'build_animation_invalid', message, ...base }]);
  if (selected.length !== 1) return sceneIssue('A scene may reference one animation declaration.');
  if (![2, 3].includes(plan.schemaVersion)) return sceneIssue('Animation requires a Scene2D with stable instance identities.');
  const source = documents.find(document => document.record?.id === selected[0].targetId);
  if (!source || typeof source.content !== 'string' || source.content.length > SCENE_ANIMATION_MAX_BYTES
    || new TextEncoder().encode(source.content).length > SCENE_ANIMATION_MAX_BYTES
    || source.record.format !== 'viento-document' || !source.sourcePath.endsWith('.json') || source.sourcePath !== source.record.sourcePath
    || source.record.id === scene.record.id) return sceneIssue('Select an available registered animation JSON document of at most 128 KiB.');
  const parsed = parseJsonSource(source.content);
  const manifest = { objectId: source.record.id, sourcePath: source.sourcePath, sourceRevision: source.sourceRevision };
  const at = pointer => ({ ...manifest, propertyPath: pointer,
    ...(parsed.ok ? { sourceRange: locateJsonSource(parsed, pointer, { nearest: true }) } : {}) });
  const diagnostics = [];
  const issue = (message, pointer = '', details = {}) => diagnostics.push({ severity: 'error', code: 'build_animation_invalid', message, ...at(pointer), ...details });
  if (!location(manifest)) { issue('Invalid animation source identity.'); return result(null, diagnostics); }
  if (!parsed.ok) {
    for (const error of parsed.diagnostics) issue(error.message, error.propertyPath || '');
    return result(null, diagnostics);
  }
  let document;
  try { document = inspectSceneAnimation(parsed.value).document; }
  catch (error) { issue(error.message || 'Invalid animation declaration.'); return result(null, diagnostics); }
  if (document.sceneObjectId !== scene.record.id) issue('The animation declaration must name the scene that references it.', '/sceneObjectId');
  if (!source.record.relations?.some(relation => relation.kind !== 'part-of' && relation.targetId === scene.record.id)) {
    issue('Register the animation-to-scene reference so migration retains the dependency.', '/sceneObjectId');
  }
  const instances = new Set(plan.actors.map(actor => actor.instanceId));
  for (const [index, track] of document.tracks.entries()) {
    if (!instances.has(track.instanceId)) issue('Select a stable instance from this scene.', `/tracks/${index}/instanceId`, { instanceId: track.instanceId });
    else if (track.property === 'spriteFrame2d' && !sceneAnimationSpriteResource(plan, track)) {
      issue('Select a registered image on this scene instance before animating its frames.', `/tracks/${index}/instanceId`, { instanceId: track.instanceId });
    }
  }
  if (diagnostics.length) return result(null, diagnostics);
  const animation = { format: 'viento-animation-plan', schemaVersion: document.schemaVersion === 4 ? 3 : document.schemaVersion === 3 ? 2 : 1, manifest, document,
    locations: { tracks: document.tracks.map((track, index) => ({ id: track.id, declaration: at(`/tracks/${index}`) })),
      ...([3, 4].includes(document.schemaVersion) ? { clips: document.clips.map((clip, index) => ({ id: clip.id, declaration: at(`/clips/${index}`) })) } : {}) } };
  return result(animation);
}
