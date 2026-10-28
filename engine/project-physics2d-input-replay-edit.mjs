// Engine-neutral, immutable editing operations for finite physics input replay.
// Steps and inclusive indices are zero-based; the last step is always released.
import { PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS as count,
  validateProjectPhysics2DInputReplay as validate } from './project-physics2d-input-replay.mjs';

export const PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS = Object.freeze(['left', 'right', 'up', 'down', 'jump']);

const invalidEdit = () => Object.assign(new TypeError('Invalid physics input replay edit.'), {
  errorCode: 'runtime_physics2d_input_edit_invalid',
});

export function setProjectPhysics2DInputReplayRange(input, action, start, end, pressed) {
  const replay = validate(input);
  if (!PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS.includes(action) || !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end) || start < 0 || end < start || end >= count
    || typeof pressed !== 'boolean' || (pressed && end === count - 1)) throw invalidEdit();
  const steps = replay.steps.map((step, index) => index >= start && index <= end
    ? { ...step, [action]: pressed } : { ...step });
  return validate({ ...replay, steps });
}

export function clearProjectPhysics2DInputReplay(input) {
  const replay = validate(input);
  const steps = replay.steps.map(() => Object.fromEntries(PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS.map(action => [action, false])));
  return validate({ ...replay, steps });
}
