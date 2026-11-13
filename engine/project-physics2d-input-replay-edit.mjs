// Engine-neutral, immutable editing operations for finite physics input replay.
// Steps and inclusive indices are zero-based; the last step is always released.
import { PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS as count, PROJECT_PHYSICS2D_INPUT_REPLAY_TARGET_LIMIT as targetLimit,
  validateProjectPhysics2DInputReplay as validate } from './project-physics2d-input-replay.mjs';

export const PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS = Object.freeze(['left', 'right', 'up', 'down', 'jump']);

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalidEdit = () => Object.assign(new TypeError('Invalid physics input replay edit.'), {
  errorCode: 'runtime_physics2d_input_edit_invalid',
});
const released = () => Object.fromEntries(PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS.map(action => [action, false]));

export function setProjectPhysics2DInputReplayRange(input, action, start, end, pressed, instanceId) {
  const replay = validate(input);
  if (!PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS.includes(action) || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end) || start < 0 || end < start || end >= count
    || typeof pressed !== 'boolean' || (pressed && end === count - 1)
    || (replay.schemaVersion === 1 ? instanceId !== undefined : !uuid(instanceId))) throw invalidEdit();
  if (replay.schemaVersion === 2 && pressed) {
    const targets = new Set(replay.steps.flatMap(step => step.inputs.map(row => row.instanceId)));
    if (!targets.has(instanceId) && targets.size >= targetLimit) throw invalidEdit();
  }
  const steps = replay.steps.map((step, index) => {
    const selected = index >= start && index <= end;
    if (replay.schemaVersion === 1) return selected ? { ...step, [action]: pressed } : { ...step };
    let found = false;
    const inputs = step.inputs.map(row => {
      if (row.instanceId !== instanceId || !selected) return { ...row };
      found = true;
      return { ...row, [action]: pressed };
    });
    // An omitted instance is already released. Do not spend a row merely to
    // release it; a pressed action creates the complete explicit input row.
    if (selected && pressed && !found) {
      if (inputs.length >= targetLimit) throw invalidEdit();
      inputs.push({ instanceId, ...released(), [action]: true });
    }
    return { inputs };
  });
  return validate({ ...replay, steps });
}

export function clearProjectPhysics2DInputReplay(input, instanceId) {
  const replay = validate(input);
  if (instanceId !== undefined && (replay.schemaVersion === 1 || !uuid(instanceId))) throw invalidEdit();
  const steps = replay.steps.map(step => replay.schemaVersion === 1 ? released()
    : { inputs: step.inputs.map(row => instanceId === undefined || row.instanceId === instanceId
      ? { instanceId: row.instanceId, ...released() } : { ...row }) });
  return validate({ ...replay, steps });
}

// Conversion is explicit and lossless for the selected frozen directory. An
// existing v2 program is already instance-scoped; never remap or discard rows.
export function convertProjectPhysics2DInputReplayToInstances(input, instanceIds) {
  const replay = validate(input);
  if (replay.schemaVersion === 2) return replay;
  if (!Array.isArray(instanceIds) || Object.getPrototypeOf(instanceIds) !== Array.prototype) throw invalidEdit();
  const descriptors = Object.getOwnPropertyDescriptors(instanceIds), keys = Reflect.ownKeys(descriptors);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > targetLimit || keys.length !== length + 1) throw invalidEdit();
  const ids = [], seen = new Set();
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !uuid(descriptor.value) || seen.has(descriptor.value)) throw invalidEdit();
    seen.add(descriptor.value); ids.push(descriptor.value);
  }
  return validate({ ...replay, schemaVersion: 2,
    steps: replay.steps.map(step => ({ inputs: ids.map(instanceId => ({ instanceId, ...step })) })) });
}
