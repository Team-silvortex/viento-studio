// Frozen project envelope admission is independent of author parsing and host IO.
import { canonicalJson } from './canonical-json.mjs';

// This validates the project envelope and cross-scene invariants. Existing
// scene validators/generators retain responsibility for each scene's semantics.
export function validateProjectAssemblyPlan(input) {
  const fail = () => { throw Object.assign(new TypeError('Invalid project assembly build plan.'), { errorCode: 'build_assembly_invalid' }); };
  let nodes = 0, chars = 0;
  const active = new Set();
  function detach(value, depth = 0) {
    if (++nodes > 1000000 || depth > 32) return fail();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if (value.length > 65536 || (chars += value.length) > 64 * 1024 * 1024) return fail();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) return fail();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail();
    const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
    if (array && (!Number.isSafeInteger(properties.length?.value) || properties.length.value > 8192 || keys.length !== properties.length.value + 1)) return fail();
    if (!array && keys.length > 128) return fail();
    const result = array ? [] : {};
    active.add(value);
    for (const key of array ? Array.from({ length: properties.length.value }, (_, index) => String(index)) : keys) {
      const descriptor = properties[key];
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
      result[key] = detach(descriptor.value, depth + 1);
    }
    active.delete(value); return result;
  }
  const value = detach(input), uuid = id => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
  const revision = item => typeof item === 'string' && /^sha256:[a-f0-9]{64}$/.test(item);
  const text = item => typeof item === 'string' && item.length > 0 && item.length <= 4096;
  const exact = (item, keys) => item && typeof item === 'object' && !Array.isArray(item)
    && Object.keys(item).length === keys.length && keys.every(key => Object.hasOwn(item, key));
  if (!exact(value, ['format', 'schemaVersion', 'kind', 'projectId', 'worldId', 'worldRevision', 'assembly', 'entrySceneId', 'scenes', 'resources', 'requiredCapabilities'])
    || value.format !== 'viento-build-plan' || value.kind !== 'project' || value.schemaVersion !== 1
    || !text(value.projectId) || !text(value.worldId) || !revision(value.worldRevision)
    || !exact(value.assembly, ['objectId', 'sourcePath', 'sourceRevision', 'title']) || !uuid(value.assembly.objectId)
    || !text(value.assembly.sourcePath) || !value.assembly.sourcePath.toLowerCase().endsWith('.json') || !revision(value.assembly.sourceRevision)
    || typeof value.assembly.title !== 'string' || !value.assembly.title.trim() || value.assembly.title.length > 160 || /[\x00-\x1f\x7f]/.test(value.assembly.title)
    || !Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 32
    || !Array.isArray(value.resources) || value.resources.length > 128 || !Array.isArray(value.requiredCapabilities)) return fail();
  const ids = new Set(), paths = new Set(), capabilities = new Set(['project.scenes']), resources = new Map();
  for (const scene of value.scenes) {
    if (scene?.format !== 'viento-build-plan' || scene.kind !== 'scene2d' || ![1, 2, 3].includes(scene.schemaVersion)
      || scene.projectId !== value.projectId || scene.worldId !== value.worldId || scene.worldRevision !== value.worldRevision
      || !uuid(scene.scene?.objectId) || scene.scene.objectId === value.assembly.objectId || ids.has(scene.scene.objectId)
      || !text(scene.scene.sourcePath) || paths.has(scene.scene.sourcePath) || !revision(scene.scene.sourceRevision)
      || !Array.isArray(scene.actors) || scene.actors.length < 1 || scene.actors.length > 128
      || !Array.isArray(scene.resources) || !Array.isArray(scene.requiredCapabilities) || scene.requiredCapabilities.length > 128) return fail();
    ids.add(scene.scene.objectId); paths.add(scene.scene.sourcePath);
    for (const capability of scene.requiredCapabilities) {
      if (typeof capability !== 'string' || capability.length > 128 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(capability)) return fail();
      capabilities.add(capability);
    }
    for (const resource of scene.resources) {
      if (!uuid(resource?.id)) return fail();
      if (resources.has(resource.id) && canonicalJson(resources.get(resource.id)) !== canonicalJson(resource)) return fail();
      resources.set(resource.id, resource);
    }
  }
  if (!ids.has(value.entrySceneId)
    || canonicalJson(value.resources) !== canonicalJson([...resources.values()].sort((a, b) => a.id.localeCompare(b.id)))
    || canonicalJson(value.requiredCapabilities) !== canonicalJson([...capabilities].sort())) return fail();
  const freeze = item => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } return item; };
  return freeze(value);
}
