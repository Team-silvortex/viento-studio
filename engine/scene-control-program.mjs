// A finite control replay is data, separate from author scenes and engine
// handles. Admission never simulates movement or invents source provenance.
export const SCENE_CONTROL_FORMAT = 'viento-runtime-control';
export const SCENE_CONTROL_TRACE_FORMAT = 'viento-runtime-trace';
export const SCENE_CONTROL_TRACE_PREFIX = 'VIENTO_TRACE:';
export const SCENE_CONTROL_SAMPLE_LIMIT = 1024;
export const SCENE_CONTROL_V1_FILE_MAX_BYTES = 16 * 1024;
export const SCENE_CONTROL_V2_FILE_MAX_BYTES = 256 * 1024;

const has = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new TypeError('Invalid finite Scene2D control replay data.'), {
  errorCode: 'runtime_control_invalid',
});
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const keys = (value, expected) => plain(value) && Object.keys(value).length === expected.length
  && expected.every(key => has(value, key));
const controls = ['left', 'right', 'up', 'down'];
const state = value => value === 'idle' || value === 'moving';
const position = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const relativeSourcePath = value => {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\0]/.test(value)
    || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  const parts = value.split('/').filter(part => part && part !== '.');
  return parts.length > 0 && !parts.includes('..') && !parts.join('/').startsWith('.');
};

// Reject accessors, hidden keys and non-data prototypes before touching values.
// The same bounded copy is used for public program and trace-frame inputs.
function detach(input) {
  const active = new Set();
  let nodes = 0, characters = 0;
  function copy(value, depth) {
    if (++nodes > 8192 || depth > 12) throw invalid();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw invalid();
      return value;
    }
    if (typeof value === 'string') {
      characters += value.length;
      if (value.length > 4096 || characters > 128 * 1024) throw invalid();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) throw invalid();
    for (const key of ownKeys) {
      const descriptor = descriptors[key];
      if (!has(descriptor, 'value') || !(array && key === 'length') && !descriptor.enumerable) throw invalid();
    }
    active.add(value);
    let output;
    if (array) {
      const length = descriptors.length.value;
      if (!Number.isSafeInteger(length) || length > 256 || ownKeys.length !== length + 1) throw invalid();
      output = [];
      for (let index = 0; index < length; index++) {
        if (!has(descriptors, String(index))) throw invalid();
        output.push(copy(descriptors[index].value, depth + 1));
      }
    } else {
      if (ownKeys.length > 32) throw invalid();
      output = {};
      for (const key of ownKeys) {
        characters += key.length;
        if (key.length > 128 || characters > 128 * 1024) throw invalid();
        output[key] = copy(descriptors[key].value, depth + 1);
      }
    }
    active.delete(value);
    return output;
  }
  return copy(input, 0);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

// Count bounded schema 2 collections before deep copying. Otherwise a valid
// over-budget program can reach the defensive copy-node limit first and lose
// its actionable input-budget diagnostic. Read descriptors only; malformed
// containers still go through the existing strict detach rejection.
function checkInstanceInputBudget(input) {
  function dataFields(value, expected) {
    if (!plain(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
    if (names.length !== expected.length || !expected.every(key => has(fields, key))
      || names.some(key => typeof key !== 'string' || !has(fields[key], 'value') || !fields[key].enumerable)) return null;
    return fields;
  }
  function dataArray(value, maximum) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields), length = fields.length?.value;
    if (!Number.isSafeInteger(length) || length > maximum || names.length !== length + 1) return null;
    for (let index = 0; index < length; index++) {
      const field = fields[index];
      if (!field || !has(field, 'value') || !field.enumerable) return null;
    }
    return { fields, length };
  }
  const fields = dataFields(input, ['format', 'schemaVersion', 'fixedDelta', 'steps']);
  if (!fields || fields.schemaVersion.value !== 2 || fields.format.value !== SCENE_CONTROL_FORMAT) return;
  const steps = dataArray(fields.steps.value, 64), delta = fields.fixedDelta.value;
  if (!steps || steps.length < 1 || !Number.isFinite(delta) || delta <= 0 || delta > 0.25 || delta * steps.length > 8) return;
  let count = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = dataFields(steps.fields[index].value, ['inputs']);
    const inputs = step && dataArray(step.inputs.value, 128);
    if (!inputs) return;
    count += inputs.length;
    if (count > SCENE_CONTROL_SAMPLE_LIMIT) {
      throw Object.assign(new TypeError('Finite control replay exceeds the instance input budget.'), {
        errorCode: 'runtime_control_limit',
      });
    }
  }
}

export function validateSceneControlProgram(input) {
  checkInstanceInputBudget(input);
  const value = detach(input);
  if (!keys(value, ['format', 'schemaVersion', 'fixedDelta', 'steps']) || value.format !== SCENE_CONTROL_FORMAT
    || ![1, 2].includes(value.schemaVersion) || !Number.isFinite(value.fixedDelta) || value.fixedDelta <= 0 || value.fixedDelta > 0.25
    || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 64
    || value.fixedDelta * value.steps.length > 8) throw invalid();
  if (value.schemaVersion === 1) {
    for (const step of value.steps) {
      if (!keys(step, controls) || controls.some(key => typeof step[key] !== 'boolean')) throw invalid();
    }
    if (controls.some(key => value.steps.at(-1)[key])) throw invalid();
  } else {
    let inputCount = 0;
    for (const step of value.steps) {
      if (!keys(step, ['inputs']) || !Array.isArray(step.inputs) || step.inputs.length > 128) throw invalid();
      inputCount += step.inputs.length;
      if (inputCount > SCENE_CONTROL_SAMPLE_LIMIT) {
        throw Object.assign(new TypeError('Finite control replay exceeds the instance input budget.'), {
          errorCode: 'runtime_control_limit',
        });
      }
      const seen = new Set();
      for (const row of step.inputs) {
        if (!keys(row, ['instanceId', ...controls]) || !uuid(row.instanceId) || seen.has(row.instanceId)
          || controls.some(key => typeof row[key] !== 'boolean')) throw invalid();
        seen.add(row.instanceId);
      }
    }
    if (value.steps.at(-1).inputs.some(row => controls.some(key => row[key]))) throw invalid();
  }
  return freeze(value);
}

// Select only the identity fields required by trace admission, avoiding copies
// of author source or behavior text and retaining diagnostics from the plan.
function planIdentity(input) {
  function selected(value, names) {
    if (!plain(value)) throw invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), result = {};
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.length > 256 || ownKeys.some(key => typeof key !== 'string'
      || ['__proto__', 'constructor', 'prototype'].includes(key))) throw invalid();
    for (const key of ownKeys) {
      if (!has(descriptors[key], 'value') || !descriptors[key].enumerable) throw invalid();
    }
    for (const name of names) {
      const descriptor = descriptors[name];
      if (!descriptor || !has(descriptor, 'value') || !descriptor.enumerable) throw invalid();
      result[name] = descriptor.value;
    }
    return result;
  }
  const plan = selected(input, ['format', 'kind', 'schemaVersion', 'scene', 'actors']);
  const scene = selected(plan.scene, ['objectId', 'sourcePath']);
  if (plan.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![1, 2].includes(plan.schemaVersion)
    || !uuid(scene.objectId) || !relativeSourcePath(scene.sourcePath)) throw invalid();
  if (!Array.isArray(plan.actors) || Object.getPrototypeOf(plan.actors) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(plan.actors), ownKeys = Reflect.ownKeys(descriptors);
  const count = descriptors.length?.value;
  if (!Number.isSafeInteger(count) || count < 1 || count > 128 || ownKeys.length !== count + 1) throw invalid();
  const paired = plan.schemaVersion === 2, actors = [];
  for (let index = 0; index < count; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !has(descriptor, 'value') || !descriptor.enumerable) throw invalid();
    actors.push(selected(descriptor.value, ['objectId', ...(paired ? ['instanceId'] : [])]));
  }
  const result = detach({ protocolVersion: plan.schemaVersion, scene, actors }), seen = new Set();
  for (const actor of result.actors) {
    const identity = paired ? actor.instanceId : actor.objectId;
    if (!uuid(actor.objectId) || paired && !uuid(actor.instanceId) || seen.has(identity)) throw invalid();
    seen.add(identity);
  }
  return result;
}

function validateReplay(inputPlan, inputProgram) {
  const plan = planIdentity(inputPlan), program = validateSceneControlProgram(inputProgram);
  if (program.schemaVersion === 2) {
    if (plan.protocolVersion !== 2) {
      throw Object.assign(new TypeError('Instance control replay requires Scene2D plan version 2.'), {
        errorCode: 'runtime_control_unsupported',
      });
    }
    const instances = new Set(plan.actors.map(actor => actor.instanceId));
    for (const step of program.steps) {
      if (step.inputs.some(row => !instances.has(row.instanceId))) {
        throw Object.assign(new TypeError('Control replay target is not an instance of the frozen scene.'), {
          errorCode: 'runtime_control_target_missing',
        });
      }
    }
  }
  if (plan.actors.length * program.steps.length > SCENE_CONTROL_SAMPLE_LIMIT) {
    throw Object.assign(new TypeError('Finite control replay exceeds the actor sample budget.'), {
      errorCode: 'runtime_control_limit',
    });
  }
  return { plan, program };
}

// The joint budget bounds sample rows and state frames before any process is
// started, in addition to the independent control-program duration limit.
export function validateSceneControlPlan(inputPlan, inputProgram) {
  return validateReplay(inputPlan, inputProgram).program;
}

export function createSceneControlTraceReader(inputPlan, inputProgram, { onSample, onRuntime } = {}) {
  const { plan, program } = validateReplay(inputPlan, inputProgram);
  const protocol = plan.protocolVersion, paired = protocol === 2;
  const identity = value => paired ? value.instanceId : value.objectId;
  const actors = new Map(plan.actors.map(actor => [identity(actor), actor]));
  const samples = [], diagnostics = [], runtimePrefix = 'VIENTO_RUNTIME:';
  let pending = '', dropping = false, ready = false, finished = false, ended = false;
  const invalidFrame = () => {
    if (diagnostics.length < 128) diagnostics.push({ severity: 'error', code: 'runtime_control_trace_invalid',
      message: 'Invalid finite control replay trace.', objectId: plan.scene.objectId,
      sourcePath: plan.scene.sourcePath, propertyPath: '' });
  };
  const validActors = values => {
    if (!Array.isArray(values) || values.length !== actors.size) return false;
    const seen = new Set();
    for (const actor of values) {
      if (!keys(actor, [...(paired ? ['instanceId'] : []), 'objectId', 'position', 'state'])) return false;
      const key = identity(actor);
      if (!actors.has(key) || actors.get(key).objectId !== actor.objectId || seen.has(key)
        || !position(actor.position) || !state(actor.state)) return false;
      seen.add(key);
    }
    return true;
  };
  const sameActors = (left, right) => {
    const expected = new Map(left.map(actor => [identity(actor), actor]));
    return right.every(actor => {
      const other = expected.get(identity(actor));
      return other && actor.objectId === other.objectId && actor.state === other.state
        && actor.position[0] === other.position[0] && actor.position[1] === other.position[1];
    });
  };
  const line = text => {
    const trace = text.startsWith(SCENE_CONTROL_TRACE_PREFIX), lifecycle = text.startsWith(runtimePrefix);
    if (!trace && !lifecycle) return null;
    let frame;
    try { frame = detach(JSON.parse(text.slice(trace ? SCENE_CONTROL_TRACE_PREFIX.length : runtimePrefix.length))); }
    catch { invalidFrame(); if (lifecycle) onRuntime?.(`${text}\n`); return null; }
    if (!plain(frame)) { invalidFrame(); if (lifecycle) onRuntime?.(`${text}\n`); return null; }
    if (lifecycle) {
      if (!['ready', 'finished'].includes(frame.event)) { onRuntime?.(`${text}\n`); return null; }
      let valid = frame.protocol === protocol && !finished;
      if (frame.event === 'ready') {
        valid &&= !ready && keys(frame, ['protocol', 'event', 'sceneObjectId', 'actors'])
          && frame.sceneObjectId === plan.scene.objectId && validActors(frame.actors);
        if (valid) ready = true;
      } else {
        valid &&= ready && samples.length === program.steps.length
          && keys(frame, ['protocol', 'event', 'actors', 'fixedDelta']) && validActors(frame.actors)
          && frame.fixedDelta === program.fixedDelta && sameActors(samples.at(-1).actors, frame.actors);
        if (valid) finished = true;
      }
      // Route one admitted lifecycle line at a time so ready, each sample and
      // finished retain stream order. A contradictory final frame must not
      // overwrite the last valid observed sample before being rejected.
      if (!valid) invalidFrame(); else onRuntime?.(`${text}\n`);
      return null;
    }
    if (!ready || finished || !keys(frame, ['format', 'schemaVersion', 'protocolVersion', 'event', 'stepIndex', 'actors'])
      || frame.format !== SCENE_CONTROL_TRACE_FORMAT || frame.schemaVersion !== 1 || frame.protocolVersion !== protocol
      || frame.event !== 'sample' || frame.stepIndex !== samples.length || frame.stepIndex >= program.steps.length
      || !Number.isSafeInteger(frame.stepIndex) || !validActors(frame.actors)) { invalidFrame(); return null; }
    const sample = freeze(frame);
    samples.push(sample); onSample?.(sample); return sample;
  };
  return Object.freeze({
    get samples() { return samples.slice(); },
    get diagnostics() { return diagnostics.map(item => ({ ...item })); },
    push(text) {
      if (ended) return [];
      if (typeof text !== 'string') throw invalid();
      const accepted = [];
      for (const part of text.split(/(?<=\n)/)) {
        const complete = part.endsWith('\n');
        if (!dropping) {
          if (pending.length + part.length > 64 * 1024) {
            const start = pending + part.slice(0, Math.max(SCENE_CONTROL_TRACE_PREFIX.length, runtimePrefix.length));
            if (start.startsWith(SCENE_CONTROL_TRACE_PREFIX) || start.startsWith(runtimePrefix)) invalidFrame();
            pending = ''; dropping = true;
          } else pending += part;
        }
        if (complete) {
          if (!dropping) { const sample = line(pending.replace(/\r?\n$/, '')); if (sample) accepted.push(sample); }
          pending = ''; dropping = false;
        }
      }
      return accepted;
    },
    finish({ requireComplete = true } = {}) {
      if (typeof requireComplete !== 'boolean') throw invalid();
      if (!ended) {
        if (pending && !dropping) line(pending);
        pending = ''; ended = true;
        if (requireComplete && !finished) invalidFrame();
      }
      return { samples: samples.slice(), diagnostics: diagnostics.map(item => ({ ...item })) };
    },
  });
}
