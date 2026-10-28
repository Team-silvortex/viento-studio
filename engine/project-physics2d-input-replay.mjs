// Portable, finite input data for a single isolated Scene2D project run.
// This contract does not simulate motion, edit author data or own engine input.
export const PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT = 'viento-physics2d-input-replay';
export const PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS = 30;
export const PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA = 1 / 60;

const actions = ['left', 'right', 'up', 'down', 'jump'];
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

export function validateProjectPhysics2DInputReplay(input) {
  const value = dataFields(input, ['format', 'schemaVersion', 'fixedDelta', 'steps']);
  if (value.format !== PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT || value.schemaVersion !== 1
    || value.fixedDelta !== PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA || !Array.isArray(value.steps)
    || Object.getPrototypeOf(value.steps) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value.steps), names = Reflect.ownKeys(descriptors);
  if (descriptors.length?.value !== PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS
    || names.length !== PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS + 1) throw invalid();
  const steps = [];
  for (let index = 0; index < PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    const step = dataFields(descriptor.value, actions);
    if (actions.some(action => typeof step[action] !== 'boolean')) throw invalid();
    steps.push(Object.freeze(step));
  }
  if (actions.some(action => steps.at(-1)[action])) throw invalid();
  return Object.freeze({ format: value.format, schemaVersion: value.schemaVersion, fixedDelta: value.fixedDelta,
    steps: Object.freeze(steps) });
}
