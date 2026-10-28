// Portable assertions over one finite physics-input replay. This layer neither
// performs physics nor authenticates native samples: only a trusted host may
// supply observations produced by its own completed run.
import { validateProjectPhysics2DInputReplay } from './project-physics2d-input-replay.mjs';
import { validateProjectPhysics2DReplayPlan, validateProjectPhysics2DReplayObservation } from './project-physics2d-replay-contract.mjs';
import { freezeProjectRuntimeData, projectRuntimeUuid } from './project-runtime-contracts.mjs';

export const PROJECT_PHYSICS2D_REPLAY_CASE_FORMAT = 'viento-physics2d-replay-case';
export const PROJECT_PHYSICS2D_REPLAY_CASE_LIMIT = 128;
const invalid = () => Object.assign(new TypeError('Invalid physics replay acceptance case.'), { errorCode: 'runtime_physics2d_case_invalid' });

// Inspect descriptors before reading any value; reject executable or hidden
// properties, inherited prototypes, sparse arrays and serialization hooks.
function fields(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || names.some(key => typeof key !== 'string'
    || ![...required, ...optional].includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw invalid();
  return Object.fromEntries(names.map(key => [key, descriptors[key].value]));
}
function array(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max || names.length !== length + 1) throw invalid();
  const result = [];
  for (let i = 0; i < length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result.push(descriptor.value);
  }
  return result;
}
function pair(input, min, max) {
  const values = array(input, 2, 2);
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) throw invalid();
  return values;
}

export function validateProjectPhysics2DReplayCase(input, inputPlan) {
  const dto = fields(input, ['format', 'schemaVersion', 'program', 'checks']);
  if (dto.format !== PROJECT_PHYSICS2D_REPLAY_CASE_FORMAT || dto.schemaVersion !== 1) throw invalid();
  let program;
  try { program = validateProjectPhysics2DInputReplay(dto.program); } catch { throw invalid(); }
  const seen = new Set();
  const checks = array(dto.checks, 1, PROJECT_PHYSICS2D_REPLAY_CASE_LIMIT).map(raw => {
    const row = fields(raw, ['instanceId', 'stepIndex'], ['positionAfter', 'contact']);
    if (!projectRuntimeUuid(row.instanceId) || !Number.isSafeInteger(row.stepIndex) || row.stepIndex < 1 || row.stepIndex > 30
      || !Object.hasOwn(row, 'positionAfter') && !Object.hasOwn(row, 'contact')) throw invalid();
    const key = `${row.instanceId}:${row.stepIndex}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
    const result = { instanceId: row.instanceId, stepIndex: row.stepIndex };
    if (Object.hasOwn(row, 'positionAfter')) {
      const position = fields(row.positionAfter, ['value', 'tolerance']);
      result.positionAfter = { value: pair(position.value, -1e9, 1e9), tolerance: pair(position.tolerance, 0, 1e6) };
    }
    if (Object.hasOwn(row, 'contact')) {
      const contact = fields(row.contact, ['exists'], ['bodyId']);
      if (typeof contact.exists !== 'boolean' || Object.hasOwn(contact, 'bodyId') && !projectRuntimeUuid(contact.bodyId)) throw invalid();
      result.contact = contact;
    }
    return result;
  });
  if (inputPlan !== undefined) {
    const plan = validateProjectPhysics2DReplayPlan(inputPlan, { backendId: 'org.viento.godot4', capabilities: ['physics.observe2d'] });
    const bodies = plan.scenes[0].physics.document.bodies;
    const characters = new Map(bodies.filter(body => body.kind === 'character').map(body => [body.instanceId, body]));
    const colliders = new Map(bodies.filter(body => body.kind !== 'sensor').map(body => [body.id, body]));
    for (const check of checks) {
      const body = characters.get(check.instanceId);
      if (!body || check.contact?.bodyId && (!colliders.has(check.contact.bodyId) || check.contact.bodyId === body.id)) throw invalid();
    }
  }
  return freezeProjectRuntimeData({ format: dto.format, schemaVersion: dto.schemaVersion, program, checks });
}

export function evaluateProjectPhysics2DReplayCase(plan, input, observation, { complete } = {}) {
  const replayCase = validateProjectPhysics2DReplayCase(input, plan);
  if (complete !== true) return freezeProjectRuntimeData({ status: 'incomplete', checks: [] });
  let view;
  try { view = validateProjectPhysics2DReplayObservation(plan, observation); }
  catch { return freezeProjectRuntimeData({ status: 'incomplete', checks: [] }); }
  const samples = new Map(view.samples.map(sample => [`${sample.instanceId}:${sample.stepIndex}`, sample]));
  const checks = replayCase.checks.map(check => {
    const sample = samples.get(`${check.instanceId}:${check.stepIndex}`);
    const result = { instanceId: check.instanceId, stepIndex: check.stepIndex, passed: true };
    if (check.positionAfter) {
      const expected = check.positionAfter.value, tolerance = check.positionAfter.tolerance, actual = sample.positionAfter;
      const passed = actual.every((value, axis) => Math.abs(value - expected[axis]) <= tolerance[axis]);
      result.positionAfter = { expected, tolerance, actual, passed }; result.passed &&= passed;
    }
    if (check.contact) {
      const actual = check.contact.bodyId ? sample.contacts.some(item => item.collider?.bodyId === check.contact.bodyId) : sample.contacts.length > 0;
      const passed = actual === check.contact.exists;
      result.contact = { ...check.contact, actual, passed }; result.passed &&= passed;
    }
    return result;
  });
  return freezeProjectRuntimeData({ status: checks.every(check => check.passed) ? 'passed' : 'failed', checks });
}
