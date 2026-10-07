// Read-only observations of admitted runtime events. Coordinates are samples,
// not a simulated or reflected engine world; author links come from the plan.
import { validateSceneControlPlan, SCENE_CONTROL_TRACE_FORMAT } from './scene-control-program.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const invalid = () => new TypeError('Invalid Scene2D runtime observation, plan or query.');
const finitePosition = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const motionState = value => value === 'idle' || value === 'moving';
const maxDisplayName = 4096;
const keys = (value, allowed, required = allowed) => plain(value)
  && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => has(value, key));

// Detach without executing accessors or accepting hidden properties, sparse
// arrays or prototype keys. Every public input is treated as bounded data.
function detach(input) {
  const active = new Set();
  let nodes = 0, characters = 0;
  function copy(value, depth) {
    if (++nodes > 65536 || depth > 32) throw invalid();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw invalid();
      return value;
    }
    if (typeof value === 'string') {
      characters += value.length;
      if (value.length > 65536 || characters > 4 * 1024 * 1024) throw invalid();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), entries = Reflect.ownKeys(descriptors);
    if (entries.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) throw invalid();
    for (const key of entries) {
      const descriptor = descriptors[key];
      if (!has(descriptor, 'value') || !(array && key === 'length') && !descriptor.enumerable) throw invalid();
    }
    active.add(value);
    let output;
    if (array) {
      const length = descriptors.length.value;
      if (!Number.isSafeInteger(length) || length > 4096 || entries.length !== length + 1) throw invalid();
      output = [];
      for (let index = 0; index < length; index++) {
        if (!has(descriptors, String(index))) throw invalid();
        output.push(copy(descriptors[index].value, depth + 1));
      }
    } else {
      if (entries.length > 256) throw invalid();
      output = {};
      for (const key of entries) {
        characters += key.length;
        if (key.length > 256 || characters > 4 * 1024 * 1024) throw invalid();
        output[key] = copy(descriptors[key].value, depth + 1);
      }
    }
    active.delete(value);
    return output;
  }
  return copy(input, 0);
}

// Match the existing project-relative source identifier rules. A colon or a
// newline in an existing Linux filename is not executable or URL authority.
const relativeSourcePath = value => {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\0]/.test(value)
    || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  const parts = value.split('/').filter(part => part && part !== '.');
  return parts.length > 0 && !parts.includes('..') && !parts.join('/').startsWith('.');
};
const pointer = value => typeof value === 'string' && value.length <= 4096
  && (value === '' || value.startsWith('/')) && !/~(?:[^01]|$)/u.test(value);
const text = value => typeof value === 'string' && value.length <= maxDisplayName;

function dataDescriptors(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
    || ownKeys.length > 256) throw invalid();
  for (const key of ownKeys) {
    if (!has(descriptors[key], 'value') || !(array && key === 'length') && !descriptors[key].enumerable) throw invalid();
  }
  return descriptors;
}

function fields(value, selected) {
  const descriptors = dataDescriptors(value), result = {};
  for (const key of selected) if (has(descriptors, key)) result[key] = descriptors[key].value;
  return result;
}

// Large author titles and behavior source do not belong in an observation.
// Select identity/provenance before detaching; truncate only its display name,
// so adding a query cannot reject a scene the existing planner can execute.
function observationPlan(input) {
  const plan = fields(input, ['format', 'kind', 'schemaVersion', 'scene', 'actors']);
  plan.scene = fields(plan.scene, ['objectId', 'sourcePath', 'sourceRevision']);
  const descriptors = dataDescriptors(plan.actors, true), count = descriptors.length.value;
  if (count < 1 || count > 128 || Reflect.ownKeys(descriptors).length !== count + 1) throw invalid();
  plan.actors = [];
  for (let index = 0; index < count; index++) {
    if (!has(descriptors, String(index))) throw invalid();
    const actor = fields(descriptors[index].value, ['objectId', 'instanceId', 'name', 'sourcePath', 'sourceRevision', 'declaration', 'fieldSources']);
    if (has(actor, 'name')) {
      if (typeof actor.name !== 'string') throw invalid();
      actor.name = actor.name.slice(0, maxDisplayName);
    }
    if (actor.fieldSources) actor.fieldSources = fields(actor.fieldSources, ['position']);
    plan.actors.push(actor);
  }
  return detach(plan);
}

function sourceLocation(value, depth = 0, contributor = false) {
  if (depth > 4 || !keys(value, ['objectId', 'sourcePath', 'propertyPath', 'sourceRevision', 'sourceRange', 'contributors',
    'relatedObjectId', ...(contributor ? ['role'] : [])], ['objectId', 'sourcePath', 'propertyPath'])
    || !uuid(value.objectId) || !relativeSourcePath(value.sourcePath) || !pointer(value.propertyPath)
    || has(value, 'relatedObjectId') && !uuid(value.relatedObjectId)
    || has(value, 'sourceRevision') && value.sourceRevision !== null
      && !(typeof value.sourceRevision === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.sourceRevision))) throw invalid();
  if (has(value, 'sourceRange')) {
    const range = value.sourceRange;
    if (!keys(range, ['start', 'end', 'encoding', 'propertyPath', 'exact'], ['start', 'end', 'encoding'])
      || !Number.isSafeInteger(range.start) || range.start < 0 || !Number.isSafeInteger(range.end) || range.end <= range.start
      || range.encoding !== 'utf-16' || has(range, 'propertyPath') && !pointer(range.propertyPath)
      || has(range, 'exact') && typeof range.exact !== 'boolean') throw invalid();
  }
  if (has(value, 'role') && (typeof value.role !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.role))) throw invalid();
  if (has(value, 'contributors')) {
    if (!Array.isArray(value.contributors) || value.contributors.length > 128) throw invalid();
    for (const item of value.contributors) sourceLocation(item, depth + 1, true);
  }
  return value;
}

function actorIdentity(actor, protocol) {
  return protocol === 1 ? actor.objectId : actor.instanceId;
}

function validateObservation(value) {
  if (!keys(value, ['format', 'schemaVersion', 'sceneObjectId', 'protocolVersion', 'phase', 'sequence', 'actors', 'control'],
    ['format', 'schemaVersion', 'sceneObjectId', 'protocolVersion', 'phase', 'sequence', 'actors'])
    || value.format !== 'viento-runtime-observation' || value.schemaVersion !== 1 || !uuid(value.sceneObjectId)
    || ![1, 2, 3].includes(value.protocolVersion) || !['waiting', 'ready', 'finished'].includes(value.phase)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || value.phase === 'waiting' && value.sequence !== 0
    || value.phase === 'ready' && value.sequence < 1
    || value.phase === 'finished' && value.sequence < 2
    || !Array.isArray(value.actors) || value.actors.length > 128) throw invalid();
  const control = has(value, 'control') ? value.control : null;
  if (has(value, 'control') && (!keys(control, ['stepCount', 'completedSteps', 'fixedDelta'])
    || ![1, 2].includes(value.protocolVersion) || !Number.isSafeInteger(control.stepCount) || control.stepCount < 1 || control.stepCount > 64
    || !Number.isSafeInteger(control.completedSteps) || control.completedSteps < 0 || control.completedSteps > control.stepCount
    || !Number.isFinite(control.fixedDelta) || control.fixedDelta <= 0 || control.fixedDelta > 0.25
    || control.fixedDelta * control.stepCount > 8 || value.actors.length * control.stepCount > 1024
    || value.phase === 'waiting' && control.completedSteps !== 0
    || value.phase === 'finished' && control.completedSteps !== control.stepCount
    || value.phase === 'ready' && value.sequence < 1 + control.completedSteps)) throw invalid();
  const seen = new Set();
  for (const actor of value.actors) {
    if (!keys(actor, ['objectId', ...(value.protocolVersion === 1 ? [] : ['instanceId']), 'name', 'position', 'state',
      'positionSample', 'positionCurrent', 'source', ...(control ? ['positionStep'] : [])],
    ['objectId', ...(value.protocolVersion === 1 ? [] : ['instanceId']), 'name', 'position', 'state', 'positionSample', 'positionCurrent', 'source'])
      || !uuid(actor.objectId)
      || value.protocolVersion !== 1 && !uuid(actor.instanceId) || !text(actor.name)
      || seen.has(actorIdentity(actor, value.protocolVersion)) || typeof actor.positionCurrent !== 'boolean') throw invalid();
    seen.add(actorIdentity(actor, value.protocolVersion));
    sourceLocation(actor.source);
    if (value.phase === 'waiting') {
      if (actor.position !== null || actor.state !== null || actor.positionSample !== null || actor.positionCurrent
        || has(actor, 'positionStep')) throw invalid();
    } else if (!finitePosition(actor.position) || !motionState(actor.state)
      || value.phase === 'ready' && (control && control.completedSteps > 0
        ? actor.positionSample !== 'control' || actor.positionStep !== control.completedSteps - 1
          || !actor.positionCurrent && value.sequence < 2 + control.completedSteps
        : actor.positionSample !== 'ready' || has(actor, 'positionStep') || !actor.positionCurrent && value.sequence < 2)
      || value.phase === 'finished' && (actor.positionSample !== 'finished' || !actor.positionCurrent || has(actor, 'positionStep'))) throw invalid();
  }
  return value;
}

export function createSceneRuntimeObservation(input, { controlProgram } = {}) {
  const plan = observationPlan(input);
  if (!plain(plan) || plan.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![1, 2, 3].includes(plan.schemaVersion)
    || !uuid(plan.scene?.objectId) || !Array.isArray(plan.actors) || plan.actors.length < 1 || plan.actors.length > 128) throw invalid();
  const protocolVersion = plan.schemaVersion, paired = protocolVersion !== 1, identities = new Map();
  const program = controlProgram === undefined ? null : validateSceneControlPlan(input, controlProgram);
  if (program && protocolVersion === 3) throw invalid();
  const actors = plan.actors.map((actor, index) => {
    if (!plain(actor) || !uuid(actor.objectId) || (paired ? !uuid(actor.instanceId) : has(actor, 'instanceId'))) throw invalid();
    const identity = actorIdentity(actor, protocolVersion);
    if (identities.has(identity) || has(actor, 'name') && !text(actor.name)) throw invalid();
    const source = sourceLocation(actor.declaration || actor.fieldSources?.position
      || { objectId: actor.objectId, sourcePath: actor.sourcePath, propertyPath: '' });
    const attachRevision = location => {
      if (!has(location, 'sourceRevision')) {
        const owner = [plan.scene, actor].find(item => item.objectId === location.objectId && item.sourcePath === location.sourcePath);
        if (owner?.sourceRevision) location.sourceRevision = owner.sourceRevision;
      }
      for (const contributor of location.contributors || []) attachRevision(contributor);
    };
    attachRevision(source); sourceLocation(source);
    const result = { objectId: actor.objectId, ...(paired ? { instanceId: actor.instanceId } : {}),
      name: actor.name ?? actor.objectId, position: null, state: null, positionSample: null, positionCurrent: false, source };
    identities.set(identity, index);
    return result;
  });
  // Indices preserve plan order even when a ready/finished collection arrives
  // in a different ECS iteration order.
  const view = { format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: plan.scene.objectId,
    protocolVersion, phase: 'waiting', sequence: 0, actors,
    ...(program ? { control: { stepCount: program.steps.length, completedSteps: 0, fixedDelta: program.fixedDelta } } : {}) };
  validateObservation(view);
  const indexFor = frame => {
    const index = identities.get(actorIdentity(frame, protocolVersion));
    return index !== undefined && actors[index].objectId === frame.objectId ? index : null;
  };
  return Object.freeze({
    push(inputEvent) {
      let frame;
      try { frame = detach(inputEvent); } catch { return false; }
      if (!plain(frame) || frame.protocol !== protocolVersion || view.phase === 'finished'
        || view.sequence === Number.MAX_SAFE_INTEGER) return false;
      if (frame.event === 'state') {
        if (view.phase !== 'ready' || !keys(frame, ['protocol', 'event', ...(paired ? ['instanceId'] : []), 'objectId', 'state'])
          || !motionState(frame.state)) return false;
        const index = indexFor(frame);
        if (index === null) return false;
        actors[index].state = frame.state; actors[index].positionCurrent = false; view.sequence++;
        return true;
      }
      if (!['ready', 'finished'].includes(frame.event) || frame.event === 'ready' && view.phase !== 'waiting'
        || frame.event === 'finished' && view.phase !== 'ready'
        || !keys(frame, frame.event === 'ready' ? ['protocol', 'event', 'sceneObjectId', 'actors'] : ['protocol', 'event', 'actors', 'fixedDelta'])
        || frame.event === 'ready' && frame.sceneObjectId !== view.sceneObjectId
        || frame.event === 'finished' && (!Number.isFinite(frame.fixedDelta) || frame.fixedDelta <= 0)
        || frame.event === 'finished' && program && (view.control.completedSteps !== program.steps.length
          || frame.fixedDelta !== program.fixedDelta)
        || !Array.isArray(frame.actors) || frame.actors.length !== actors.length) return false;
      const updates = new Map();
      for (const item of frame.actors) {
        if (!keys(item, [...(paired ? ['instanceId'] : []), 'objectId', 'position', 'state'])
          || !finitePosition(item.position) || !motionState(item.state)) return false;
        const index = indexFor(item);
        if (index === null || updates.has(index)) return false;
        updates.set(index, item);
      }
      for (const [index, item] of updates) {
        actors[index].position = item.position; actors[index].state = item.state;
        actors[index].positionSample = frame.event; actors[index].positionCurrent = true;
        delete actors[index].positionStep;
      }
      view.phase = frame.event; view.sequence++;
      return true;
    },
    pushSample(inputSample) {
      if (!program || view.phase !== 'ready' || view.sequence === Number.MAX_SAFE_INTEGER) return false;
      let frame;
      try { frame = detach(inputSample); } catch { return false; }
      if (!keys(frame, ['format', 'schemaVersion', 'protocolVersion', 'event', 'stepIndex', 'actors'])
        || frame.format !== SCENE_CONTROL_TRACE_FORMAT || frame.schemaVersion !== 1 || frame.protocolVersion !== protocolVersion
        || frame.event !== 'sample' || frame.stepIndex !== view.control.completedSteps || !Number.isSafeInteger(frame.stepIndex)
        || frame.stepIndex >= program.steps.length || !Array.isArray(frame.actors) || frame.actors.length !== actors.length) return false;
      const updates = new Map();
      for (const item of frame.actors) {
        if (!keys(item, [...(paired ? ['instanceId'] : []), 'objectId', 'position', 'state'])
          || !finitePosition(item.position) || !motionState(item.state)) return false;
        const index = indexFor(item);
        if (index === null || updates.has(index)) return false;
        updates.set(index, item);
      }
      for (const [index, item] of updates) {
        actors[index].position = item.position; actors[index].state = item.state;
        actors[index].positionSample = 'control'; actors[index].positionCurrent = true;
        actors[index].positionStep = frame.stepIndex;
      }
      view.control.completedSteps++; view.sequence++;
      return true;
    },
    snapshot() { return detach(view); },
  });
}

export function querySceneRuntimeObservation(input, inputRequest = {}) {
  const view = validateObservation(detach(input)), request = detach(inputRequest);
  if (!keys(request, ['instanceId', 'objectId'], []) || has(request, 'instanceId') && !uuid(request.instanceId)
    || has(request, 'objectId') && !uuid(request.objectId)) throw invalid();
  view.actors = view.actors.filter(actor => (!has(request, 'instanceId') || actor.instanceId === request.instanceId)
    && (!has(request, 'objectId') || actor.objectId === request.objectId));
  return view;
}
