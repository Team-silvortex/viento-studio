// Declarative Studio composition only. A module or project request does not
// grant source-write, filesystem, process, backend or renderer permission.
export const STUDIO_MODULE_SCHEMA_VERSION = 1;
export const STUDIO_PROFILE_SCHEMA_VERSION = 1;

const MODULE_ID = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const CAPABILITY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DOMAINS = new Set(['project', 'language', 'authoring', 'scene', 'backend', 'workbench', 'resource', 'world']);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);

function invalid(message = 'Invalid Studio module declaration or request.') {
  const error = new TypeError(message);
  error.errorCode = 'studio_module_invalid';
  return error;
}

function detach(input) {
  const visiting = new Set(); let nodes = 0, chars = 0;
  function copy(value, depth) {
    if (++nodes > 16384 || depth > 16) throw invalid();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalid(); return value; }
    if (typeof value === 'string') {
      chars += value.length;
      if (value.length > 8192 || chars > 131072) throw invalid();
      return value;
    }
    if (!value || typeof value !== 'object' || visiting.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || RESERVED.has(key) || !Object.hasOwn(descriptor, 'value')
        || !(array && key === 'length') && !descriptor.enumerable) throw invalid();
      chars += key.length;
      if (key.length > 256 || chars > 131072) throw invalid();
    }
    visiting.add(value);
    let result;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 1024 || keys.length !== length + 1) throw invalid();
      result = [];
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(descriptors, String(index))) throw invalid();
        result.push(copy(descriptors[index].value, depth + 1));
      }
    } else {
      if (keys.length > 128) throw invalid();
      result = {};
      for (const key of keys) result[key] = copy(descriptors[key].value, depth + 1);
    }
    visiting.delete(value);
    return result;
  }
  try { return copy(input, 0); } catch { throw invalid(); }
}

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function token(value, expression) {
  if (typeof value !== 'string' || value.length > 192 || !expression.test(value)) throw invalid();
}
function api(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw invalid(); }
function freeze(value) {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function validateStudioProfile(input) {
  const profile = detach(input);
  exact(profile, ['format', 'schemaVersion', 'required', 'optional']);
  if (profile.format !== 'viento-studio-profile' || profile.schemaVersion !== STUDIO_PROFILE_SCHEMA_VERSION) throw invalid();
  const seen = new Set();
  for (const requests of [profile.required, profile.optional]) {
    if (!Array.isArray(requests) || requests.length > 128) throw invalid();
    for (const request of requests) {
      exact(request, ['capability', 'apiVersion']); token(request.capability, CAPABILITY); api(request.apiVersion);
      if (seen.has(request.capability)) throw invalid();
      seen.add(request.capability);
    }
  }
  return freeze(profile);
}

export function validateStudioModuleDescriptor(input) {
  const module = detach(input);
  exact(module, ['format', 'schemaVersion', 'id', 'apiVersion', 'dependencies', 'contributions']);
  if (module.format !== 'viento-studio-module' || module.schemaVersion !== STUDIO_MODULE_SCHEMA_VERSION || module.apiVersion !== 1) throw invalid();
  token(module.id, MODULE_ID);
  if (!Array.isArray(module.dependencies) || module.dependencies.length > 32
    || !Array.isArray(module.contributions) || module.contributions.length < 1 || module.contributions.length > 64) throw invalid();
  const dependencies = new Set(), capabilities = new Set();
  for (const dependency of module.dependencies) {
    exact(dependency, ['id', 'apiVersion']); token(dependency.id, MODULE_ID); api(dependency.apiVersion);
    if (dependency.id === module.id || dependencies.has(dependency.id)) throw invalid();
    dependencies.add(dependency.id);
  }
  for (const contribution of module.contributions) {
    exact(contribution, ['capability', 'apiVersion', 'domain']); token(contribution.capability, CAPABILITY);
    if (contribution.apiVersion !== 1 || !DOMAINS.has(contribution.domain) || capabilities.has(contribution.capability)) throw invalid();
    capabilities.add(contribution.capability);
  }
  return freeze(module);
}

const moduleDescriptor = (id, contributions, dependencies = ['org.viento.document']) => ({
  format: 'viento-studio-module', schemaVersion: 1, id, apiVersion: 1,
  dependencies: dependencies.map(id => ({ id, apiVersion: 1 })),
  contributions: contributions.map(([capability, domain]) => ({ capability, apiVersion: 1, domain })),
});

export const STUDIO_MODULES = freeze([
  moduleDescriptor('org.viento.document', [
    ['document.read', 'authoring'], ['document.edit', 'authoring'],
    ['language.markdown', 'language'], ['language.text', 'language'], ['language.json', 'language'], ['language.yaml', 'language'],
  ], []),
  moduleDescriptor('org.viento.scripts', [['authoring.script', 'authoring']]),
  moduleDescriptor('org.viento.scene-composition-create', [['scene.authoring.composition-create', 'authoring']]),
  moduleDescriptor('org.viento.settings', [['workbench.settings', 'workbench']], []),
  moduleDescriptor('org.viento.project', [['project.types', 'project'], ['project.templates', 'project']]),
  moduleDescriptor('org.viento.world', [
    ['world.query', 'world'], ['world.commands', 'world'], ['authoring.object', 'authoring'],
    ['authoring.projection', 'authoring'], ['authoring.scene2d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.export', [['project.export', 'project'], ['resource.package', 'resource']]),
  moduleDescriptor('org.viento.media', [['resource.reference', 'resource']]),
  moduleDescriptor('org.viento.build', [
    ['scene.representation.scene2d', 'scene'], ['project.authoring.assembly', 'authoring'], ['scene.authoring.behavior-creation', 'authoring'], ['scene.authoring.audio-creation', 'authoring'], ['scene.authoring.animation-creation', 'authoring'], ['scene.authoring.physics2d-creation', 'authoring'], ['scene.authoring.composition2d', 'authoring'],
    ['backend.project', 'backend'], ['backend.execution', 'backend'], ['behavior.gdscript', 'language'],
  ], ['org.viento.document', 'org.viento.world']),
  moduleDescriptor('org.viento.scene3d', [
    ['scene.representation.scene3d', 'scene'], ['scene.preview.scene3d', 'scene'],
  ]),
  moduleDescriptor('org.viento.scene3d-transforms', [
    ['scene.authoring.transforms3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-objects', [
    ['scene.authoring.objects3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-environment', [
    ['scene.authoring.environment3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-properties', [
    ['scene.authoring.properties3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-translation', [
    ['scene.authoring.translation3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-alignment', [
    ['scene.authoring.alignment3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-distribution', [
    ['scene.authoring.distribution3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-copy', [
    ['scene.authoring.copy3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene3d-removal', [
    ['scene.authoring.removal3d', 'authoring'],
  ]),
  moduleDescriptor('org.viento.scene-behaviors', [['scene.authoring.behaviors', 'authoring']]),
  moduleDescriptor('org.viento.scene-audio', [['scene.authoring.audio', 'authoring']]),
  moduleDescriptor('org.viento.scene-animation', [['scene.authoring.animation', 'authoring'], ['scene.preview.animation', 'scene']]),
  moduleDescriptor('org.viento.scene-physics2d', [['scene.authoring.physics2d', 'authoring']]),
]);

export function createStudioModuleRegistry(input = STUDIO_MODULES) {
  const declarations = detach(input);
  if (!Array.isArray(declarations) || declarations.length < 1 || declarations.length > 32) throw invalid();
  const byId = new Map(), providers = new Map();
  for (const declaration of declarations) {
    const module = validateStudioModuleDescriptor(declaration);
    if (byId.has(module.id)) throw invalid('Duplicate Studio module.');
    byId.set(module.id, module);
    for (const contribution of module.contributions) {
      if (providers.has(contribution.capability)) throw invalid('Ambiguous Studio capability provider.');
      providers.set(contribution.capability, { ...contribution, moduleId: module.id });
    }
  }
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(module) {
    if (visited.has(module.id)) return;
    if (visiting.has(module.id)) throw invalid('Studio module dependency cycle.');
    visiting.add(module.id);
    for (const dependency of module.dependencies) {
      const target = byId.get(dependency.id);
      if (!target || target.apiVersion !== dependency.apiVersion) throw invalid('Studio module dependency is unavailable.');
      visit(target);
    }
    visiting.delete(module.id); visited.add(module.id); ordered.push(module);
  }
  for (const module of byId.values()) visit(module);
  const descriptors = freeze(ordered);

  function plan(profileInput = null, optionsInput = {}) {
    const options = detach(optionsInput);
    if (!plain(options) || Object.keys(options).some(key => key !== 'enabledModules')) throw invalid();
    const enabled = Object.hasOwn(options, 'enabledModules') ? options.enabledModules : {};
    if (!plain(enabled) || Object.entries(enabled).some(([id, value]) => !byId.has(id) || typeof value !== 'boolean')) throw invalid();
    const modules = [], active = new Map();
    for (const module of descriptors) {
      const reason = enabled[module.id] === false ? 'disabled'
        : module.dependencies.some(dependency => !active.get(dependency.id)) ? 'dependency_inactive' : null;
      active.set(module.id, reason === null);
      modules.push({ id: module.id, apiVersion: module.apiVersion, active: reason === null, reason });
    }
    const capabilities = [...providers.values()].map(contribution => ({ ...contribution, active: active.get(contribution.moduleId) }));
    const requests = [], diagnostics = [];
    let satisfied = true, profile = null;
    // A malformed or future project declaration must not close the existing
    // document editor. Strict validation remains available to configuration writers.
    if (profileInput !== null && profileInput !== undefined) {
      try { profile = validateStudioProfile(profileInput); }
      catch { satisfied = false; diagnostics.push({ severity: 'error', code: 'studio_profile_invalid',
        message: 'The Studio capability profile is invalid or uses an unsupported schema.', propertyPath: '/studioProfile' }); }
    }
    if (profile) for (const [key, required] of [['required', true], ['optional', false]]) {
      for (const [index, request] of profile[key].entries()) {
        const provider = providers.get(request.capability);
        const status = !provider ? 'missing' : provider.apiVersion !== request.apiVersion ? 'version_unsupported'
          : !active.get(provider.moduleId) ? 'inactive' : 'supported';
        requests.push({ ...request, required, status, moduleId: provider?.moduleId ?? null });
        if (status !== 'supported') {
          if (required) satisfied = false;
          const messages = {
            missing: `Studio capability is not registered: ${request.capability}`,
            version_unsupported: `Studio capability API version is not supported: ${request.capability}`,
            inactive: `Studio capability module is inactive: ${request.capability}`,
          };
          const codes = { missing: 'studio_capability_missing', version_unsupported: 'studio_capability_version_unsupported', inactive: 'studio_capability_inactive' };
          diagnostics.push({ severity: required ? 'error' : 'warning', code: codes[status], message: messages[status],
            propertyPath: `/studioProfile/${key}/${index}`, capability: request.capability, apiVersion: request.apiVersion,
            moduleId: provider?.moduleId ?? null });
        }
      }
    }
    return freeze({ format: 'viento-studio-module-plan', schemaVersion: 1, modules, capabilities, requests, satisfied, diagnostics });
  }

  return Object.freeze({ descriptors: () => descriptors, plan });
}
