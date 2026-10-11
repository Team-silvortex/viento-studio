// One recipe instance's canvas positions live in Rust; the recipe source stays
// authoritative. Applying the position-only proposal remains the caller's
// ordinary source-editor operation, after rechecking its live owner.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { createSceneGeometryDraft, moveSceneSelection } from './scene-layout.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => {
  throw Object.assign(new TypeError('Move only the selected recipe instance within its local and scene coordinate bounds.'),
    { errorCode: 'scene_layout_position_invalid' });
};
function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { throw Object.assign(new TypeError('The layout requires a valid recipe preview.'), { errorCode: 'scene_composition_override_invalid' }); }
}
function pair(value) {
  if (!Array.isArray(value) || value.length !== 2
    || Array.from(value).some(number => typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 100000)) invalid();
  return [...value];
}

/** Bind one stable instance to its exact saved/current author source. */
export async function createSceneCompositionLayoutDraft(model, source, instanceId, { digest } = {}) {
  const preview = clone(model);
  // The override factory also snapshots source and identities before its first
  // await. Our detached preview remains private while the digest is pending.
  const binding = await createSceneCompositionOverrideDraft(preview, source, instanceId, { digest });
  const actors = clone(preview.actors), actor = actors.find(item => item.instanceId === binding.actorId);
  const initialWorld = [...binding.effectiveValues.position], initialLocal = [...binding.values.position], offset = [...binding.offset];
  const geometry = createSceneGeometryDraft([actor], [actor]);
  const localAt = world => world.map((coordinate, axis) => coordinate === initialWorld[axis]
    ? initialLocal[axis] : coordinate - offset[axis]);
  const validateWorld = value => {
    const world = pair(value);
    // A world position may be in range while subtracting a placement offset
    // produces an invalid local coordinate. Reject before mutating history.
    pair(localAt(world)); return world;
  };
  function setPositions(input) {
    geometry.assertAlive();
    if (!Array.isArray(input) || input.length > 1) invalid();
    const changes = Array.from(input, change => {
      if (!plain(change) || Object.keys(change).length !== 2 || !Object.hasOwn(change, 'objectId')
        || !Object.hasOwn(change, 'position') || change.objectId !== binding.actorId) invalid();
      return { objectId: binding.actorId, position: validateWorld(change.position) };
    });
    return geometry.setPositions(changes);
  }
  return {
    actorId: binding.actorId, objectId: binding.objectId, placementId: binding.placementId, actorKey: binding.actorKey,
    get offset() { return [...offset]; },
    actors() {
      geometry.assertAlive();
      const position = geometry.currentPosition(binding.actorId);
      return actors.map(item => ({ ...clone(item), ...(item.instanceId === binding.actorId ? { position: [...position] } : {}) }));
    },
    state: geometry.state,
    currentPosition: geometry.currentPosition,
    localPosition() { geometry.assertAlive(); return localAt(geometry.currentPosition(binding.actorId)); },
    setPosition(id, position) { return setPositions([{ objectId: id, position }]); },
    setPositions,
    move(ids, delta, snap = 0) {
      geometry.assertAlive();
      if (!Array.isArray(ids) || ids.length > 1 || Array.from(ids).some(id => id !== binding.actorId)) invalid();
      return setPositions(moveSceneSelection(geometry.actors(), [...ids], delta, snap));
    },
    undo: geometry.undo,
    redo: geometry.redo,
    reset: geometry.reset,
    dispose: geometry.dispose,
    propose() {
      geometry.assertAlive();
      if (!geometry.state().dirty) {
        throw Object.assign(new TypeError('No recipe instance position changed.'), { errorCode: 'scene_composition_override_unchanged' });
      }
      return binding.propose({ position: localAt(geometry.currentPosition(binding.actorId)) });
    },
  };
}
