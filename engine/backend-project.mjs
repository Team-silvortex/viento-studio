// Portable descriptions only. A manifest grants no filesystem, cleanup, tool,
// or executable authority; the host must bind its own ownership receipt.
export const BACKEND_PROJECT_SCHEMA_VERSION = 2;
export const BACKEND_PROJECT_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const ROOT_KEYS = ['format', 'schemaVersion', 'buildId', 'snapshotId', 'source', 'backend', 'executionAdapter', 'tool', 'project', 'files', 'resources', 'dependencies', 'evidence', 'lifecycle'];
const LIFECYCLE = Object.freeze({ authority: 'author-workspace', generatedProject: 'derived-read-only', resources: 'copies',
  rebuild: 'saved-author-inputs', runtimeCopies: 'temporary', persistence: 'until-owner-cleanup' });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const token = value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value);
const namespace = value => typeof value === 'string' && value.length <= 192 && /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(value);
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const relative = value => text(value, 4096) && !/[\\:\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const projectPath = value => relative(value) && value.startsWith('project/');
// Author paths are audit data, never output authority. Preserve readable legacy
// names (including Linux colons/line breaks) while keeping logical containment.
const auditPath = value => {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\0]/.test(value) || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  const parts = value.split('/').filter(part => part && part !== '.');
  return parts.length > 0 && !parts.includes('..');
};
const sourcePath = value => auditPath(value) && !value.split('/').filter(part => part && part !== '.').join('/').startsWith('.');
const invalid = () => Object.assign(new TypeError('Invalid backend project manifest.'), { errorCode: 'backend_project_invalid' });
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function detach(input) {
  let nodes = 0, chars = 0;
  const ancestors = new Set();
  function copy(value, depth) {
    if (++nodes > 150000 || depth > 8) throw invalid();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if (value.length > 4096 || (chars += value.length) > BACKEND_PROJECT_MANIFEST_MAX_BYTES) throw invalid();
      for (const character of value) if (character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff) throw invalid();
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    if (Object.getOwnPropertyDescriptor(value, 'toJSON') || prototype && Object.getOwnPropertyDescriptor(prototype, 'toJSON')) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (array && (value.length > 8192 || keys.length !== value.length + 1)) throw invalid();
    const result = array ? [] : {};
    ancestors.add(value);
    for (const key of array ? Array.from({ length: value.length }, (_, index) => String(index)) : keys) {
      const property = descriptors[key];
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !property?.enumerable || !Object.hasOwn(property, 'value')) throw invalid();
      result[key] = copy(property.value, depth + 1);
    }
    ancestors.delete(value); return result;
  }
  try { return copy(input, 0); } catch { throw invalid(); }
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function ordered(items, field) {
  for (let index = 1; index < items.length; index++) if (items[index - 1][field] >= items[index][field]) throw invalid();
}

export function validateBackendProjectManifest(input) {
  const value = detach(input); exact(value, ROOT_KEYS);
  if (value.format !== 'viento-backend-project' || ![1, BACKEND_PROJECT_SCHEMA_VERSION].includes(value.schemaVersion) || !uuid(value.buildId) || !revision(value.snapshotId)) throw invalid();
  const assembly = value.schemaVersion === 2;
  exact(value.source, assembly
    ? ['workspaceId', 'assemblyId', 'sourcePath', 'sourceRevision', 'planKind', 'planSchemaVersion', 'entrySceneId', 'scenes']
    : ['workspaceId', 'sceneId', 'sourcePath', 'sourceRevision', 'planKind', 'planSchemaVersion']);
  const source = value.source;
  if (!text(source.workspaceId, 192) || !uuid(assembly ? source.assemblyId : source.sceneId) || !sourcePath(source.sourcePath) || !revision(source.sourceRevision)
    || !token(source.planKind) || !Number.isInteger(source.planSchemaVersion) || source.planSchemaVersion < 1 || source.planSchemaVersion > 65535) throw invalid();
  if (assembly) {
    if (source.planKind !== 'project' || source.planSchemaVersion !== 1 || !uuid(source.entrySceneId)
      || !Array.isArray(source.scenes) || !source.scenes.length || source.scenes.length > 32) throw invalid();
    const ids = new Set(), paths = new Set();
    for (const scene of source.scenes) {
      exact(scene, ['sceneId', 'sourcePath', 'sourceRevision']);
      if (!uuid(scene.sceneId) || scene.sceneId === source.assemblyId || ids.has(scene.sceneId) || !sourcePath(scene.sourcePath)
        || scene.sourcePath === source.sourcePath || paths.has(scene.sourcePath) || !revision(scene.sourceRevision)) throw invalid();
      ids.add(scene.sceneId); paths.add(scene.sourcePath);
    }
    if (!ids.has(source.entrySceneId)) throw invalid();
  } else if (source.planKind === 'project') throw invalid();
  exact(value.backend, ['id', 'version', 'protocolVersion', 'sha256']);
  const backend = value.backend;
  if (!namespace(backend.id) || typeof backend.version !== 'string' || backend.version.length > 32 || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(backend.version)
    || !Number.isInteger(backend.protocolVersion) || backend.protocolVersion < 1 || backend.protocolVersion > 65535 || !hash(backend.sha256)) throw invalid();
  if (value.executionAdapter !== null) {
    exact(value.executionAdapter, ['id', 'contractVersion', 'sha256']);
    if (value.executionAdapter.id !== backend.id || value.executionAdapter.contractVersion !== 1 || !hash(value.executionAdapter.sha256)) throw invalid();
  }
  exact(value.tool, ['version', 'sha256', 'platform', 'arch']);
  if (!text(value.tool.version, 256) || /[/\\]/.test(value.tool.version) || !hash(value.tool.sha256) || !token(value.tool.platform) || !token(value.tool.arch)) throw invalid();
  exact(value.project, ['kind', 'root', 'entry', 'requiresTool']);
  if (!token(value.project.kind) || value.project.root !== 'project' || !projectPath(value.project.entry) || typeof value.project.requiresTool !== 'boolean') throw invalid();
  // Protocol 9 adds one generated observer wrapper per recognized author source.
  // Keep older backends and standalone scenes within their published inventory budget.
  const stateEntries = assembly && backend.id === 'org.viento.godot4'
    && backend.protocolVersion === 9 && value.project.kind === 'godot-project';
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > (stateEntries ? 1152 : 640)
    || stateEntries && value.files.filter(file => file?.role !== 'resource-copy').length > 1024) throw invalid();
  let total = 0;
  for (const file of value.files) {
    exact(file, ['path', 'size', 'sha256', 'role', 'resourceId', 'sourceObjectId']);
    if (!projectPath(file.path) || !integer(file.size, 32 * 1024 * 1024) || !hash(file.sha256)
      || !['generated', 'resource-copy', 'author-source-copy'].includes(file.role)) throw invalid();
    if (file.role === 'resource-copy' ? !uuid(file.resourceId) || file.sourceObjectId !== null
      : file.role === 'author-source-copy' ? !uuid(file.sourceObjectId) || file.resourceId !== null
        : file.resourceId !== null || file.sourceObjectId !== null) throw invalid();
    total += file.size;
  }
  if (total > 256 * 1024 * 1024) throw invalid(); ordered(value.files, 'path');
  const paths = new Set(value.files.map(file => file.path));
  if (!paths.has(value.project.entry)) throw invalid();
  for (const name of paths) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { if (paths.has(parts.join('/'))) throw invalid(); parts.pop(); }
  }
  if (!Array.isArray(value.resources) || value.resources.length > 128) throw invalid();
  const resources = new Set(); let resourceBytes = 0;
  for (const resource of value.resources) {
    exact(resource, ['resourceId', 'sourcePath', 'generatedPath', 'size', 'sha256']);
    const file = value.files.find(file => file.path === resource.generatedPath);
    if (!uuid(resource.resourceId) || resources.has(resource.resourceId) || !auditPath(resource.sourcePath) || !projectPath(resource.generatedPath)
      || !integer(resource.size, 32 * 1024 * 1024) || !hash(resource.sha256) || !file || file.role !== 'resource-copy'
      || file.resourceId !== resource.resourceId || file.size !== resource.size || file.sha256 !== resource.sha256) throw invalid();
    resources.add(resource.resourceId); resourceBytes += resource.size;
  }
  if (resourceBytes > 128 * 1024 * 1024 || value.files.some(file => file.role === 'resource-copy' && !resources.has(file.resourceId))) throw invalid();
  ordered(value.resources, 'generatedPath');
  if (!Array.isArray(value.dependencies) || value.dependencies.length > 8192) throw invalid();
  const objects = new Set();
  for (const dependency of value.dependencies) {
    exact(dependency, ['objectId', 'sourcePath', 'sourceRevision', 'role']);
    if (dependency.objectId !== null && (!uuid(dependency.objectId) || objects.has(dependency.objectId)) || !sourcePath(dependency.sourcePath)
      || dependency.sourceRevision !== null && !revision(dependency.sourceRevision) || !(assembly ? ['assembly', 'scene', 'behavior-source', 'author-document'] : ['scene', 'behavior-source', 'author-document']).includes(dependency.role)) throw invalid();
    if (dependency.objectId) objects.add(dependency.objectId);
  }
  ordered(value.dependencies, 'sourcePath');
  const scenes = value.dependencies.filter(item => item.role === 'scene');
  if (assembly) {
    const targets = value.dependencies.filter(item => item.role === 'assembly');
    if (targets.length !== 1 || targets[0].objectId !== source.assemblyId || targets[0].sourcePath !== source.sourcePath || targets[0].sourceRevision !== source.sourceRevision
      || scenes.length !== source.scenes.length || source.scenes.some(scene => !scenes.some(item => item.objectId === scene.sceneId
        && item.sourcePath === scene.sourcePath && item.sourceRevision === scene.sourceRevision))) throw invalid();
  } else if (scenes.length !== 1 || scenes[0].objectId !== source.sceneId || scenes[0].sourcePath !== source.sourcePath || scenes[0].sourceRevision !== source.sourceRevision) throw invalid();
  if (value.files.some(file => file.role === 'author-source-copy' && !value.dependencies.some(item => item.objectId === file.sourceObjectId && item.role === 'behavior-source' && item.sourceRevision !== null))) throw invalid();
  if (!Array.isArray(value.evidence) || value.evidence.length !== 3) throw invalid();
  const evidencePaths = ['build.json', 'snapshot.json', 'source-map.json'];
  for (const [index, evidence] of value.evidence.entries()) {
    exact(evidence, ['path', 'size', 'sha256']);
    if (evidence.path !== evidencePaths[index] || !integer(evidence.size, evidence.path === 'snapshot.json' ? 80 * 1024 * 1024 : 4 * 1024 * 1024) || !evidence.size || !hash(evidence.sha256)) throw invalid();
  }
  exact(value.lifecycle, Object.keys(LIFECYCLE));
  if (Object.entries(LIFECYCLE).some(([field, expected]) => value.lifecycle[field] !== expected)) throw invalid();
  // The host publishes this exact readable JSON form; a compact-only budget
  // must not admit a manifest that its own bounded reader cannot reopen.
  if (new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n').length > BACKEND_PROJECT_MANIFEST_MAX_BYTES) throw invalid();
  return freeze(value);
}

export function summarizeBackendProject(input) {
  const value = validateBackendProjectManifest(input);
  return Object.freeze({ buildId: value.buildId, snapshotId: value.snapshotId, backendId: value.backend.id, ...(value.schemaVersion === 1 ? { sceneId: value.source.sceneId }
      : { assemblyId: value.source.assemblyId, entrySceneId: value.source.entrySceneId, sceneCount: value.source.scenes.length }),
    sourcePath: value.source.sourcePath, kind: value.project.kind, entry: value.project.entry,
    fileCount: value.files.length, resourceCount: value.resources.length, dependencyCount: value.dependencies.length,
    totalBytes: value.files.reduce((sum, file) => sum + file.size, 0) });
}

/** Uniform author identity without presenting an assembly as a scene. */
export function backendProjectSourceIdentity(input) {
  const { source, schemaVersion } = validateBackendProjectManifest(input);
  return Object.freeze({ objectId: schemaVersion === 2 ? source.assemblyId : source.sceneId,
    sourcePath: source.sourcePath, sourceRevision: source.sourceRevision, planKind: source.planKind, planSchemaVersion: source.planSchemaVersion,
    entrySceneId: schemaVersion === 2 ? source.entrySceneId : source.sceneId, sceneCount: schemaVersion === 2 ? source.scenes.length : 1 });
}
