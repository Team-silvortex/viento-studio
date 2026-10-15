// Portable protocol 3 admission. Execution adapters validate and compile source
// bytes; this module owns binding identity, lifecycle and frozen navigation.
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';
import { createSceneRuntimeEventReader } from './scene-runtime-events.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const scalar = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
  || typeof value === 'string' && value.length <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const relative = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const location = value => plain(value) && uuid(value.objectId) && relative(value.sourcePath) && revision(value.sourceRevision);
const invalid = () => { throw new TypeError('Expected a frozen Scene2D behavior plan using runtime protocol 3.'); };

// Do not invoke caller getters or serializers while admitting a plan. Capture
// ordinary records with limits before the shared author schema sees them.
function capture(value, budget = { nodes: 0, bytes: 0 }, depth = 0) {
  if (++budget.nodes > 32768 || depth > 20) invalid();
  if (typeof value === 'string') {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
      || (budget.bytes += new TextEncoder().encode(value).length) > 2 * 1024 * 1024) invalid();
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') invalid();
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) invalid();
  const output = array ? [] : {}, properties = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(properties)) {
    if (array && key === 'length') continue;
    const descriptor = properties[key];
    if (typeof key !== 'string' || key.length > 4096 || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || array && !/^(0|[1-9][0-9]*)$/.test(key)) invalid();
    Object.defineProperty(output, key, { value: capture(descriptor.value, budget, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  if (array && (output.length !== value.length || Object.keys(output).length !== value.length)) invalid();
  return output;
}

function captureEventPlan(input) {
  const plan = capture(input), value = plan?.behaviors;
  if (plan?.format !== 'viento-build-plan' || plan.schemaVersion !== 3 || plan.kind !== 'scene2d' || !location(plan.scene)
    || !Array.isArray(plan.actors) || plan.actors.length < 1 || plan.actors.length > 128
    || !exact(value, ['format', 'schemaVersion', 'backendId', 'language', 'manifest', 'sources', 'bindings'])
    || value.format !== 'viento-behavior-plan' || value.schemaVersion !== 1 || !location(value.manifest)
    || !exact(value.manifest, ['objectId', 'sourcePath', 'sourceRevision'])
    || !value.manifest.sourcePath.toLowerCase().endsWith('.json') || value.manifest.objectId === plan.scene.objectId
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > SCENE_BEHAVIOR_LIMITS.sources
    || !Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > SCENE_BEHAVIOR_LIMITS.bindings) invalid();
  const actors = new Map();
  for (const actor of plan.actors) {
    if (!plain(actor) || !uuid(actor.instanceId) || !uuid(actor.objectId) || actors.has(actor.instanceId)) invalid();
    actors.set(actor.instanceId, actor.objectId);
  }
  const sources = new Set(); let bytes = 0;
  for (const source of value.sources) {
    if (!exact(source, ['objectId', 'sourcePath', 'sourceRevision', 'language', 'content']) || !location(source)
      || !source.sourcePath.toLowerCase().endsWith('.txt') || source.objectId === value.manifest.objectId || source.objectId === plan.scene.objectId
      || sources.has(source.objectId) || source.language !== value.language || typeof source.content !== 'string') invalid();
    const length = new TextEncoder().encode(source.content).length;
    if (length > SCENE_BEHAVIOR_LIMITS.sourceBytes || (bytes += length) > SCENE_BEHAVIOR_LIMITS.totalSourceBytes) invalid();
    sources.add(source.objectId);
  }
  const declaredSources = new Set();
  const bindings = value.bindings.map((binding, index) => {
    if (!exact(binding, ['bindingId', 'instanceId', 'objectId', 'implementation', 'parameters', 'events', 'declaration'])
      || !plain(binding.implementation) || binding.implementation.backendId !== value.backendId || binding.implementation.language !== value.language
      || !sources.has(binding.implementation.sourceObjectId) || !actors.has(binding.instanceId) || actors.get(binding.instanceId) !== binding.objectId
      || !location(binding.declaration) || !exact(binding.declaration, ['objectId', 'sourcePath', 'sourceRevision', 'propertyPath'])
      || binding.declaration.objectId !== value.manifest.objectId
      || binding.declaration.sourcePath !== value.manifest.sourcePath || binding.declaration.sourceRevision !== value.manifest.sourceRevision
      || binding.declaration.propertyPath !== `/bindings/${index}`) invalid();
    declaredSources.add(binding.implementation.sourceObjectId);
    const { objectId, declaration, ...author } = binding; return author;
  });
  if (sources.size !== declaredSources.size || !inspectSceneBehaviors(JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1,
    sceneObjectId: plan.scene.objectId, bindings })).ok) invalid();
  return plan;
}

function bindingLocation(binding, property) {
  return { ...binding.declaration, propertyPath: `${binding.declaration.propertyPath}${property ? `/parameters/${property}` : ''}`,
    bindingId: binding.bindingId, instanceId: binding.instanceId, relatedObjectId: binding.objectId };
}

export function createSceneBehaviorEventReader(input, { onEvent } = {}) {
  const plan = captureEventPlan(input), value = plan.behaviors;
  const events = [], diagnostics = [], bindings = new Map(value.bindings.map(binding => [binding.bindingId, binding]));
  const legacy = createSceneRuntimeEventReader({ ...plan, schemaVersion: 2 });
  const prefix = 'VIENTO_RUNTIME:', maxLineLength = 65536, maxEvents = 4096;
  let pending = '', dropping = false, ended = false, ready = false, finished = false, limitReported = false;
  const invalidFrame = () => { if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_protocol_invalid',
    message: 'Invalid behavior runtime protocol frame.', objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '' }); };
  const accept = text => {
    if (!text.startsWith(prefix)) return null;
    if (events.length >= maxEvents) { if (!limitReported) { limitReported = true; invalidFrame(); } return null; }
    let frame;
    try { frame = JSON.parse(text.slice(prefix.length)); } catch { invalidFrame(); return null; }
    if (!plain(frame) || frame.protocol !== 3 || finished) { invalidFrame(); return null; }
    const binding = bindings.get(frame.bindingId);
    const identified = binding && binding.instanceId === frame.instanceId && binding.objectId === frame.objectId;
    if (frame.event === 'behavior') {
      if (!ready || !exact(frame, ['protocol', 'event', 'bindingId', 'instanceId', 'objectId', 'name', 'arguments']) || !identified
        || !binding.events.some(event => event.event === frame.name) || !Array.isArray(frame.arguments)
        || frame.arguments.length > 4 || !frame.arguments.every(scalar)) { invalidFrame(); return null; }
    } else if (frame.event === 'diagnostic' && frame.bindingId !== undefined) {
      if (!exact(frame, ['protocol', 'event', 'bindingId', 'instanceId', 'objectId', 'severity', 'code', 'message', 'parameter']) || !identified
        || frame.severity !== 'error' || typeof frame.code !== 'string' || !/^runtime_behavior_[a-z_]{1,80}$/.test(frame.code)
        || typeof frame.message !== 'string' || !frame.message.length || frame.message.length > 4096
        || frame.parameter !== undefined && (typeof frame.parameter !== 'string' || !Object.hasOwn(binding.parameters, frame.parameter))) { invalidFrame(); return null; }
      diagnostics.push({ severity: frame.severity, code: frame.code, message: frame.message, ...bindingLocation(binding, frame.parameter) });
    } else {
      const count = legacy.diagnostics.length;
      const accepted = legacy.push(prefix + JSON.stringify({ ...frame, protocol: 2 }) + '\n');
      diagnostics.push(...legacy.diagnostics.slice(count));
      if (!accepted.length) return null;
      if (frame.event === 'ready') ready = true;
      if (frame.event === 'finished') finished = true;
    }
    events.push(frame); onEvent?.(frame); return frame;
  };
  return { events, diagnostics,
    push(text) {
      if (ended) return [];
      const accepted = [];
      for (const part of text.split(/(?<=\n)/)) {
        const complete = part.endsWith('\n');
        if (!dropping) {
          if (pending.length + part.length > maxLineLength) { if ((pending + part.slice(0, prefix.length)).startsWith(prefix)) invalidFrame(); pending = ''; dropping = true; }
          else pending += part;
        }
        if (complete) {
          if (!dropping) { const frame = accept(pending.replace(/\r?\n$/, '')); if (frame) accepted.push(frame); }
          pending = ''; dropping = false;
        }
      }
      return accepted;
    },
    finish() { if (!ended && pending && !dropping) accept(pending); pending = ''; ended = true; return { events, diagnostics }; },
  };
}
