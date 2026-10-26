// Saved opt-in physics declarations. Rust owns body rules; this adapter binds
// registered source and scene instances without simulating or writing anything.
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_PHYSICS2D_MAX_BYTES = 65536;
export const SCENE_PHYSICS2D_CAPABILITIES = Object.freeze(['physics.bodies2d', 'physics.character2d', 'physics.sensors2d']);
export const SCENE_PHYSICS2D_SLIDE_CAPABILITY = 'physics.character-slide2d';
export const SCENE_PHYSICS2D_MOTION_CAPABILITY = 'physics.character-motion2d';
export const SCENE_PHYSICS2D_ONE_WAY_CAPABILITY = 'physics.one-way-platform2d';
export const SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY = 'physics.platform-motion2d';
export const scenePhysics2DCapabilities = document => [SCENE_PHYSICS2D_CAPABILITIES[0],
  ...(document?.bodies?.some(body => body.kind === 'character') ? [SCENE_PHYSICS2D_CAPABILITIES[1]] : []),
  ...(document?.bodies?.some(body => body.kind === 'sensor') ? [SCENE_PHYSICS2D_CAPABILITIES[2]] : []),
  ...(document?.bodies?.some(body => body.kind === 'character' && body.collisionResponse === 'slide') ? [SCENE_PHYSICS2D_SLIDE_CAPABILITY] : []),
  ...(document?.bodies?.some(body => body.kind === 'character' && body.characterMotion) ? [SCENE_PHYSICS2D_MOTION_CAPABILITY] : []),
  ...(document?.bodies?.some(body => body.kind === 'static' && body.oneWay) ? [SCENE_PHYSICS2D_ONE_WAY_CAPABILITY] : []),
  ...(document?.bodies?.some(body => body.kind === 'static' && body.platformMotion) ? [SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY] : [])];
const uuid = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = message => { throw Object.assign(new TypeError(message), { errorCode: 'build_physics_invalid' }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const location = value => uuid(value?.objectId) && typeof value.sourcePath === 'string' && value.sourcePath.length <= 4096
  && value.sourcePath.endsWith('.json') && normalizeSourcePath(value.sourcePath) === value.sourcePath
  && !/[\x00-\x1f\x7f:]/.test(value.sourcePath) && revision(value.sourceRevision);
const validRange = (value, pointer) => exact(value, ['start', 'end', 'encoding', 'propertyPath', 'exact'])
  && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && value.start >= 0 && value.end > value.start
  && value.end <= SCENE_PHYSICS2D_MAX_BYTES && value.encoding === 'utf-16' && value.propertyPath === pointer && value.exact === true;

// Frozen-plan admission must not invoke accessors, serializers or inherited
// fields. Other scene extensions remain intact and retain their own contracts.
function copyData(input) {
  const active = new Set(); let nodes = 0, chars = 0;
  const copy = (value, depth = 0) => {
    if (++nodes > 1000000 || depth > 32) fail('The frozen scene plan exceeds its data limit.');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if (value.length > 131072 || (chars += value.length) > 8 * 1024 * 1024) fail('The frozen scene plan exceeds its text limit.');
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) fail('Expected plain frozen scene data.');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('Expected plain frozen scene data.');
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), length = descriptors.length?.value;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length > 8192 || keys.length !== length + 1)
      || !array && keys.length > 128) fail('Invalid frozen scene collection.');
    active.add(value); const output = array ? [] : {};
    for (const key of array ? Array.from({ length }, (_, index) => String(index)) : keys) {
      const entry = descriptors[key];
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
        || !entry?.enumerable || !Object.hasOwn(entry, 'value')) fail('Expected explicit frozen scene values.');
      output[key] = copy(entry.value, depth + 1);
    }
    active.delete(value); return output;
  };
  return copy(input);
}

function actorsByInstance(plan) {
  if (!Array.isArray(plan.actors) || !plan.actors.length || plan.actors.length > 128) fail('Physics requires scene instances.');
  const actors = new Map();
  for (const actor of plan.actors) {
    if (!uuid(actor?.instanceId) || !uuid(actor.objectId) || actors.has(actor.instanceId)
      || !['arrows', 'none'].includes(actor.controls) || !Number.isFinite(actor.speed) || actor.speed < 0 || actor.speed > 2000) {
      fail('Physics requires unique scene instances with valid movement fields.');
    }
    actors.set(actor.instanceId, actor);
  }
  return actors;
}

export function stripScenePhysics2DPlan(input) {
  const { physics, ...plan } = copyData(input);
  if (!Array.isArray(plan.requiredCapabilities)) fail('Invalid scene capabilities.');
  return { ...plan, requiredCapabilities: plan.requiredCapabilities.filter(value => !SCENE_PHYSICS2D_CAPABILITIES.includes(value) && value !== SCENE_PHYSICS2D_SLIDE_CAPABILITY && value !== SCENE_PHYSICS2D_MOTION_CAPABILITY && value !== SCENE_PHYSICS2D_ONE_WAY_CAPABILITY && value !== SCENE_PHYSICS2D_PLATFORM_MOTION_CAPABILITY) };
}

export function validateScenePhysics2DPlan(input) {
  const plan = copyData(input), physics = plan?.physics;
  if (plan?.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![2, 3].includes(plan.schemaVersion)
    || !uuid(plan.scene?.objectId) || !Array.isArray(plan.requiredCapabilities)
    || !exact(physics, ['format', 'schemaVersion', 'manifest', 'document', 'locations'])
    || physics.format !== 'viento-physics2d-plan' || physics.schemaVersion !== 1
    || !exact(physics.manifest, ['objectId', 'sourcePath', 'sourceRevision']) || !location(physics.manifest)
    || physics.manifest.objectId === plan.scene.objectId) fail('Invalid scene physics plan.');
  let document;
  try { document = inspectScenePhysics2D(physics.document).document; }
  catch (error) { if (error.errorCode === 'studio_core_unavailable') throw error; fail('Invalid frozen physics declaration.'); }
  if (document.sceneObjectId !== plan.scene.objectId) fail('Physics must belong to the frozen scene.');
  if (!scenePhysics2DCapabilities(document).every(value => plan.requiredCapabilities.includes(value))) fail('Missing scene physics capability.');
  const actors = actorsByInstance(plan);
  if (!exact(physics.locations, ['bodies']) || !Array.isArray(physics.locations.bodies)
    || physics.locations.bodies.length !== document.bodies.length) fail('Invalid physics source map.');
  for (const [index, body] of document.bodies.entries()) {
    const actor = actors.get(body.instanceId), mapped = physics.locations.bodies[index], source = mapped?.declaration, pointer = `/bodies/${index}`;
    if (!actor) fail('Physics targets an instance outside the frozen scene.');
    if (body.kind !== 'character' && (actor.controls !== 'none' || actor.speed !== 0)) fail('Static bodies and sensors require controls none and zero speed.');
    if (!exact(mapped, ['id', 'declaration']) || mapped.id !== body.id || !location(source)
      || !exact(source, ['objectId', 'sourcePath', 'sourceRevision', 'propertyPath', ...(Object.hasOwn(source, 'sourceRange') ? ['sourceRange'] : [])])
      || source.objectId !== physics.manifest.objectId || source.sourcePath !== physics.manifest.sourcePath
      || source.sourceRevision !== physics.manifest.sourceRevision || source.propertyPath !== pointer
      || Object.hasOwn(source, 'sourceRange') && !validRange(source.sourceRange, pointer)) fail('Invalid physics source map.');
  }
  return { ...physics, document };
}

export function resolveScenePhysics2D(observed, input) {
  const documents = observed.source.documents;
  const scenes = documents.filter(document => document.record?.id === input.scene.objectId), scene = scenes[0];
  const selected = (scene?.record.relations || []).filter(relation => relation.kind === 'references' && relation.slot === 'physics2d');
  const result = (physics, diagnostics = []) => ({ ok: diagnostics.length === 0, physics, diagnostics });
  if (!selected.length) return result(null);
  const plan = copyData(input);
  const base = { objectId: scene.record.id, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, propertyPath: '' };
  const sceneIssue = message => result(null, [{ severity: 'error', code: 'build_physics_invalid', message, ...base }]);
  if (scenes.length !== 1 || selected.length !== 1) return sceneIssue('A scene may reference one physics declaration.');
  if (plan.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![2, 3].includes(plan.schemaVersion)
    || !uuid(plan.scene.objectId)) return sceneIssue('Physics requires a Scene2D with stable instance identities.');
  const sources = documents.filter(document => document.record?.id === selected[0].targetId), source = sources[0];
  if (sources.length !== 1 || typeof source?.content !== 'string' || source.content.length > SCENE_PHYSICS2D_MAX_BYTES
    || new TextEncoder().encode(source.content).length > SCENE_PHYSICS2D_MAX_BYTES
    || source.record.format !== 'viento-document' || source.record.version !== 1 || typeof source.sourcePath !== 'string' || !source.sourcePath.endsWith('.json')
    || source.sourcePath !== source.record.sourcePath || source.record.id === scene.record.id) {
    return sceneIssue('Select an available registered physics JSON document of at most 64 KiB.');
  }
  const parsed = parseJsonSource(source.content), manifest = { objectId: source.record.id, sourcePath: source.sourcePath, sourceRevision: source.sourceRevision };
  const at = pointer => ({ ...manifest, propertyPath: pointer,
    ...(parsed.ok ? { sourceRange: locateJsonSource(parsed, pointer, { nearest: true }) } : {}) });
  const diagnostics = [], issue = (message, pointer = '', details = {}) => diagnostics.push({ severity: 'error', code: 'build_physics_invalid', message, ...at(pointer), ...details });
  if (!location(manifest)) { issue('Invalid physics source identity.'); return result(null, diagnostics); }
  if (!parsed.ok) { for (const error of parsed.diagnostics) issue(error.message, error.propertyPath || ''); return result(null, diagnostics); }
  let document;
  try { document = inspectScenePhysics2D(parsed.value).document; }
  catch (error) { if (error.errorCode === 'studio_core_unavailable') throw error; issue(error.message || 'Invalid physics declaration.'); return result(null, diagnostics); }
  if (document.sceneObjectId !== scene.record.id) issue('The physics declaration must name the scene that references it.', '/sceneObjectId');
  if (!source.record.relations?.some(relation => relation.kind === 'references' && relation.targetId === scene.record.id)) {
    issue('Register the physics-to-scene reference so migration retains the dependency.', '/sceneObjectId');
  }
  let actors;
  try { actors = actorsByInstance(plan); } catch (error) { return sceneIssue(error.message); }
  for (const [index, body] of document.bodies.entries()) {
    const actor = actors.get(body.instanceId), pointer = `/bodies/${index}/instanceId`;
    if (!actor) issue('Select a stable instance from this scene.', pointer, { bodyId: body.id, instanceId: body.instanceId });
    else if (body.kind !== 'character' && (actor.controls !== 'none' || actor.speed !== 0)) {
      issue('Static bodies and sensors require controls none and zero speed on their scene instance.', pointer,
        { bodyId: body.id, instanceId: body.instanceId, objectId: manifest.objectId });
    }
  }
  if (diagnostics.length) return result(null, diagnostics);
  return result({ format: 'viento-physics2d-plan', schemaVersion: 1, manifest, document,
    locations: { bodies: document.bodies.map((body, index) => ({ id: body.id, declaration: at(`/bodies/${index}`) })) } });
}
