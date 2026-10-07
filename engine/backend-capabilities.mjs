// Portable admission checks only. Executables, artifact generators and process
// lifecycle belong to host adapters; a descriptor never supplies runnable code.
export const EXECUTION_BACKEND_DESCRIPTOR_SCHEMA_VERSION = 1;

const DESCRIPTOR_KEYS = ['format', 'schemaVersion', 'id', 'label', 'version', 'platforms', 'plans', 'capabilities', 'execution', 'extensions'];
const OPERATIONS = ['build', 'headlessLogic', 'windowPreview', 'windowCapture', 'offscreenRender', 'embeddedViewport', 'gpuCompute'];
const NAMESPACE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PLATFORM = /^[a-z][a-z0-9-]*$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const INVALID_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function invalid() {
  const error = new TypeError('Invalid execution backend descriptor or support request.');
  error.errorCode = 'build_backend_invalid';
  return error;
}

// Inspect property descriptors before reading values. In particular JSON-like
// objects with getters, symbols, hidden fields, custom prototypes or sparse
// arrays cannot acquire authority while they are being validated.
function detachData(input, { maxNodes = 32768, maxChars = 4 * 1024 * 1024, maxArray = 8192 } = {}) {
  const active = new Set();
  let nodes = 0, chars = 0;
  function copy(value, depth) {
    if (++nodes > maxNodes || depth > 32) throw invalid();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalid(); return value; }
    if (typeof value === 'string') {
      chars += value.length;
      if (value.length > 65536 || chars > maxChars) throw invalid();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalid();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string' || INVALID_KEYS.has(key))) throw invalid();
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !(array && key === 'length') && !descriptor.enumerable) throw invalid();
    }
    let result;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > maxArray || keys.length !== length + 1) throw invalid();
      result = [];
      active.add(value);
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(descriptors, String(index))) throw invalid();
        result.push(copy(descriptors[index].value, depth + 1));
      }
    } else {
      if (keys.length > 256) throw invalid();
      result = {};
      active.add(value);
      for (const key of keys) {
        chars += key.length;
        if (key.length > 256 || chars > maxChars) throw invalid();
        result[key] = copy(descriptors[key].value, depth + 1);
      }
    }
    active.delete(value);
    return result;
  }
  try { return copy(input, 0); }
  catch { throw invalid(); }
}

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function token(value, expression, max = 128) {
  if (typeof value !== 'string' || value.length > max || !expression.test(value)) throw invalid();
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid();
}
function tokens(value, expression, maximum, length = 128) {
  if (!Array.isArray(value) || value.length > maximum) throw invalid();
  const seen = new Set();
  for (const item of value) {
    token(item, expression, length);
    if (seen.has(item)) throw invalid();
    seen.add(item);
  }
}
function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function validateExecutionBackendDescriptor(input) {
  const value = detachData(input, { maxNodes: 2048, maxChars: 32768, maxArray: 128 });
  exact(value, DESCRIPTOR_KEYS);
  if (value.format !== 'viento-execution-backend' || value.schemaVersion !== EXECUTION_BACKEND_DESCRIPTOR_SCHEMA_VERSION) throw invalid();
  token(value.id, NAMESPACE, 192);
  text(value.label, 256);
  token(value.version, VERSION, 32);
  tokens(value.platforms, PLATFORM, 32, 64);
  tokens(value.capabilities, IDENTIFIER, 128);
  if (!Array.isArray(value.plans) || value.plans.length > 32) throw invalid();
  const plans = new Set();
  for (const plan of value.plans) {
    exact(plan, ['kind', 'schemaVersion', 'runtimeProtocolVersion']);
    if (plan.kind !== 'scene2d' || ![1, 2, 3].includes(plan.schemaVersion) || ![1, 2, 3].includes(plan.runtimeProtocolVersion)) throw invalid();
    const key = `${plan.kind}:${plan.schemaVersion}`;
    if (plans.has(key)) throw invalid();
    plans.add(key);
  }
  exact(value.execution, OPERATIONS);
  if (OPERATIONS.some(operation => typeof value.execution[operation] !== 'boolean') || value.execution.windowCapture && !value.execution.windowPreview) throw invalid();
  if (!Array.isArray(value.extensions) || value.extensions.length > 64) throw invalid();
  const extensions = new Set();
  for (const extension of value.extensions) {
    exact(extension, ['id', 'version']);
    token(extension.id, NAMESPACE, 256);
    token(extension.version, VERSION, 32);
    if (!extension.id.startsWith(`${value.id}.`) || extensions.has(extension.id)) throw invalid();
    extensions.add(extension.id);
  }
  return freeze(value);
}

function supportRequest(input) {
  const value = detachData(input);
  if (!plain(value) || Object.keys(value).some(key => !['operation', 'platform', 'plan'].includes(key))) throw invalid();
  if (Object.hasOwn(value, 'operation') && !OPERATIONS.includes(value.operation)) throw invalid();
  if (Object.hasOwn(value, 'platform')) token(value.platform, PLATFORM, 64);
  if (Object.hasOwn(value, 'plan')) {
    const plan = value.plan;
    if (!plain(plan) || typeof plan.format !== 'string' || !plan.format || plan.format.length > 128
      || !Number.isSafeInteger(plan.schemaVersion) || plan.schemaVersion < 1) throw invalid();
    token(plan.kind, IDENTIFIER);
    tokens(plan.requiredCapabilities, IDENTIFIER, 128);
    if (!plain(plan.scene)) throw invalid();
    text(plan.scene.objectId, 256);
    text(plan.scene.sourcePath, 4096);
    if (Object.hasOwn(plan, 'behaviors')) {
      if (!plain(plan.behaviors) || plan.behaviors.format !== 'viento-behavior-plan' || plan.behaviors.schemaVersion !== 1) throw invalid();
      token(plan.behaviors.backendId, NAMESPACE, 192);
      token(plan.behaviors.language, IDENTIFIER, 64);
    }
  }
  return value;
}

export function checkExecutionBackendSupport(descriptor, request = {}) {
  const backend = validateExecutionBackendDescriptor(descriptor);
  const value = supportRequest(request);
  const location = { objectId: value.plan?.scene.objectId || null, sourcePath: value.plan?.scene.sourcePath || '', propertyPath: '' };
  const diagnostic = (code, message, details = {}) => ({ severity: 'error', code, message, ...location, ...details });
  const diagnostics = [];
  if (!value.operation || !backend.execution[value.operation]) diagnostics.push(diagnostic('build_execution_unsupported',
    value.operation ? `Backend does not support execution operation: ${value.operation}` : 'Select an execution operation.', value.operation ? { operation: value.operation } : {}));
  if (value.platform && !backend.platforms.includes(value.platform)) diagnostics.push(diagnostic('build_platform_unsupported',
    `Backend does not support platform: ${value.platform}`, { platform: value.platform }));
  if (value.plan) {
    const plan = value.plan;
    if (plan.format !== 'viento-build-plan' || !backend.plans.some(item => item.kind === plan.kind && item.schemaVersion === plan.schemaVersion)) {
      diagnostics.push(diagnostic('build_backend_plan_unsupported', 'Backend does not support this build plan kind and schema.',
        { kind: plan.kind, schemaVersion: plan.schemaVersion }));
    }
    for (const capability of plan.requiredCapabilities) {
      if (!backend.capabilities.includes(capability)) diagnostics.push(diagnostic('build_capability_missing', `Backend lacks capability: ${capability}`, { capability }));
    }
    if (plan.behaviors && plan.behaviors.backendId !== backend.id) diagnostics.push(diagnostic('build_behavior_backend_unsupported',
      'The declared behavior implementation belongs to a different execution backend.', { backendId: plan.behaviors.backendId }));
  }
  return diagnostics;
}

export function canExecuteBackend(descriptor, operation, platform) {
  try {
    return checkExecutionBackendSupport(descriptor, { operation, ...(platform === undefined ? {} : { platform }) }).length === 0;
  } catch { return false; }
}
