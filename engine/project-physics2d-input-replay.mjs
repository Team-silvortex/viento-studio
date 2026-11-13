// Portable, finite input data for a single isolated Scene2D project run.
// This contract does not simulate motion, edit author data or own engine input.
export const PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT = 'viento-physics2d-input-replay';
export const PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS = 30;
export const PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA = 1 / 60;
export const PROJECT_PHYSICS2D_INPUT_REPLAY_TARGET_LIMIT = 8;
export const PROJECT_PHYSICS2D_INPUT_REPLAY_INSTANCES_CAPABILITY = 'physics.input-replay-instances2d';

const actions = ['left', 'right', 'up', 'down', 'jump'];
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => Object.assign(new TypeError('Invalid finite physics input replay.'), {
  errorCode: 'runtime_physics2d_input_invalid',
});

// Read descriptors before values: executable getters, hidden keys, symbols,
// sparse arrays and serialization hooks are not input data.
function dataFields(input, keys) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(name => typeof name !== 'string' || !keys.includes(name))
    || keys.some(name => !Object.hasOwn(descriptors, name) || !descriptors[name].enumerable
      || !Object.hasOwn(descriptors[name], 'value'))) throw invalid();
  return Object.fromEntries(keys.map(name => [name, descriptors[name].value]));
}
function dataArray(input, min, max) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max || names.length !== length + 1) throw invalid();
  const values = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    values.push(descriptor.value);
  }
  return values;
}
function actionFields(input, targeted = false) {
  const row = dataFields(input, targeted ? ['instanceId', ...actions] : actions);
  if (actions.some(action => typeof row[action] !== 'boolean') || targeted && !uuid(row.instanceId)) throw invalid();
  return Object.freeze(row);
}

export function validateProjectPhysics2DInputReplay(input) {
  const value = dataFields(input, ['format', 'schemaVersion', 'fixedDelta', 'steps']);
  if (value.format !== PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT || ![1, 2].includes(value.schemaVersion)
    || value.fixedDelta !== PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA) throw invalid();
  const targets = new Set();
  const steps = dataArray(value.steps, PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS, PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS)
    .map(raw => {
      if (value.schemaVersion === 1) return actionFields(raw);
      const step = dataFields(raw, ['inputs']), seen = new Set();
      const inputs = dataArray(step.inputs, 0, PROJECT_PHYSICS2D_INPUT_REPLAY_TARGET_LIMIT).map(rawRow => {
        const row = actionFields(rawRow, true);
        if (seen.has(row.instanceId)) throw invalid();
        seen.add(row.instanceId); targets.add(row.instanceId);
        if (targets.size > PROJECT_PHYSICS2D_INPUT_REPLAY_TARGET_LIMIT) throw invalid();
        return row;
      });
      return Object.freeze({ inputs: Object.freeze(inputs) });
    });
  const finalRows = value.schemaVersion === 1 ? [steps.at(-1)] : steps.at(-1).inputs;
  if (finalRows.some(row => actions.some(action => row[action]))) throw invalid();
  return Object.freeze({ format: value.format, schemaVersion: value.schemaVersion, fixedDelta: value.fixedDelta,
    steps: Object.freeze(steps) });
}
