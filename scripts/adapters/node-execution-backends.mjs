// Only the local host registers implementations. Transport descriptors contain
// data; neither project files nor HTTP requests can install executable code.
import { validateExecutionBackendDescriptor, checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';
import { buildError } from './node-build-snapshot.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

export const DEFAULT_EXECUTION_BACKEND = 'org.viento.godot4';
const methods = ['availability', 'identify', 'generate', 'fingerprint', 'executePhase', 'diagnostics', 'createEventReader', 'cleanupProject'];
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const invalid = message => { throw buildError('build_backend_invalid', message); };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
};

export function createExecutionBackendRegistry(implementations = [GODOT4_EXECUTION_ADAPTER, BEVY_EXECUTION_ADAPTER]) {
  if (!Array.isArray(implementations) || implementations.length > 8) invalid('Invalid host backend registry.');
  const adapters = new Map();
  for (const implementation of implementations) {
    const descriptor = validateExecutionBackendDescriptor(implementation?.descriptor);
    if (adapters.has(descriptor.id) || implementation.contractVersion !== 1
      || typeof implementation.acceptsLegacyBuildRecords !== 'boolean'
      || methods.some(name => typeof implementation[name] !== 'function')
      || ['buildPhases', 'runtimePhases'].some(name => !Array.isArray(implementation[name]) || implementation[name].length > 16
        || implementation[name].some(phase => typeof phase !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(phase) || phase === 'run')
        || new Set(implementation[name]).size !== implementation[name].length)) invalid('Invalid host backend implementation.');
    // Capture host methods once; later caller mutations cannot change an
    // already-selected adapter while an asynchronous job owns it.
    const adapter = { descriptor, contractVersion: 1, acceptsLegacyBuildRecords: implementation.acceptsLegacyBuildRecords,
      buildPhases: Object.freeze([...implementation.buildPhases]), runtimePhases: Object.freeze([...implementation.runtimePhases]) };
    for (const name of methods) adapter[name] = implementation[name].bind(implementation);
    adapters.set(descriptor.id, Object.freeze(adapter));
  }
  return Object.freeze({
    descriptors: () => Object.freeze([...adapters.values()].map(adapter => adapter.descriptor)),
    resolve(id) {
      if (typeof id !== 'string' || !adapters.has(id)) throw buildError('build_backend_missing', 'The selected execution backend is not registered on this host.');
      return adapters.get(id);
    },
  });
}

export function assertBackendOperation(adapter, operation, plan, platform = process.platform) {
  const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation, platform, ...(plan ? { plan } : {}) });
  if (diagnostics.length) throw buildError(diagnostics[0].code, diagnostics[0].message, { diagnostics });
}

export async function executionAdapterFingerprint(adapter) {
  const value = await adapter.fingerprint();
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'contractVersion,id,sha256'
    || value.id !== adapter.descriptor.id || value.contractVersion !== adapter.contractVersion || !hash(value.sha256)) invalid('Invalid execution adapter fingerprint.');
  return Object.freeze({ id: value.id, contractVersion: value.contractVersion, sha256: value.sha256 });
}

export function executionPhaseDiagnostics(adapter, result, plan) {
  const statuses = ['succeeded', 'failed', 'cancelled', 'timeout', 'unavailable', 'output-limit', 'observer-failed'];
  if (!result || typeof result !== 'object' || !statuses.includes(result.status)
    || result.status === 'succeeded' && result.exitCode !== undefined && result.exitCode !== 0) invalid('Invalid execution phase result.');
  const diagnostics = adapter.diagnostics(result, plan);
  if (!Array.isArray(diagnostics)) invalid('Invalid execution phase diagnostics.');
  if (result.status !== 'succeeded' && !diagnostics.some(item => item.severity === 'error')) {
    return [...diagnostics, { severity: 'error', code: `build_process_${result.status.replaceAll('-', '_')}`,
      message: 'The execution backend phase did not succeed.', objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' }];
  }
  return diagnostics;
}

// Resolve navigation against frozen author data, never executable output paths.
// Adapters supply semantic pointers; JSON editor details stay in this layer.
export function attachFrozenDiagnosticSources(diagnostics, documents, objectIds) {
  const eligible = new Set(objectIds), parsed = new Map();
  return diagnostics.map(item => {
    if (!eligible.has(item.objectId)) return item;
    const document = documents.find(document => document.record?.id === item.objectId && document.sourcePath === item.sourcePath);
    if (!document || typeof document.content !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(document.sourceRevision)) return item;
    let sourceRange = item.sourceRange;
    if (document.sourcePath.toLowerCase().endsWith('.json') && typeof item.propertyPath === 'string') {
      if (!parsed.has(document)) parsed.set(document, parseJsonSource(document.content));
      sourceRange = locateJsonSource(parsed.get(document), item.propertyPath, { nearest: true }) || sourceRange;
    }
    return { ...item, sourceRevision: document.sourceRevision, ...(sourceRange ? { sourceRange: { ...sourceRange } } : {}) };
  });
}

function relativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(value)
    && value.split('/').every(part => part.length && part !== '.' && part !== '..');
}

// Validate and detach every output before creating a destination or trusting a
// stored artifact inventory. Resource bindings are neutral UUID → file paths.
export function validateGeneratedExecutionProject(adapter, plan, generated) {
  const selectedPlan = adapter.descriptor.plans.find(item => item.kind === plan.kind && item.schemaVersion === plan.schemaVersion);
  if (!selectedPlan || !generated || !(generated.files instanceof Map) || !(generated.resourceFiles instanceof Map)
    || generated.files.size < 1 || generated.files.size > 512 || generated.resourceFiles.size !== plan.resources.length
    || generated.backend?.id !== adapter.descriptor.id || generated.backend.protocolVersion !== selectedPlan.runtimeProtocolVersion
    || typeof generated.backend.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(generated.backend.version)
    || !hash(generated.backend.sha256)) invalid('Invalid generated backend project.');
  const artifact = generated.artifact;
  if (!artifact || Object.keys(artifact).sort().join(',') !== 'entry,kind,requiresTool'
    || typeof artifact.kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(artifact.kind)
    || !relativePath(artifact.entry) || typeof artifact.requiresTool !== 'boolean') invalid('Invalid generated artifact declaration.');
  const files = new Map(), resourceFiles = new Map(), destinations = new Set();
  let bytes = 0;
  for (const [name, content] of generated.files) {
    if (!relativePath(name) || !(content instanceof Uint8Array) || content.byteLength > 32 * 1024 * 1024) invalid('Invalid generated file path or bytes.');
    files.set(name, Buffer.from(content)); destinations.add(name); bytes += content.byteLength;
  }
  for (const resource of plan.resources) {
    const name = generated.resourceFiles.get(resource.id);
    if (!relativePath(name) || destinations.has(name)) invalid('Invalid or overlapping generated resource destination.');
    resourceFiles.set(resource.id, name); destinations.add(name); bytes += resource.size;
  }
  if (bytes > 256 * 1024 * 1024 || !destinations.has(artifact.entry)) invalid('Generated project exceeds its budget or lacks an entry file.');
  // A file cannot also be a directory, including across media bindings. Reject
  // this before writes so publication cannot fail midway through materializing.
  for (const name of destinations) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { if (destinations.has(parts.join('/'))) invalid('Overlapping generated file and directory paths.'); parts.pop(); }
  }
  let sourceMap, backend;
  try { sourceMap = clone(generated.sourceMap); backend = clone(generated.backend); }
  catch { invalid('Invalid generated metadata.'); }
  if (!sourceMap || typeof sourceMap !== 'object' || Array.isArray(sourceMap)) invalid('Invalid generated source map.');
  return { files, resourceFiles, sourceMap: freeze(sourceMap), backend: freeze(backend), artifact: Object.freeze({ ...artifact }) };
}
