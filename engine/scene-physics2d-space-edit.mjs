// Local collider offsets are proposals for existing checked form fields. They
// carry no source-edit authority and never move the scene's instance itself.
import { isScenePhysics2DSpaceView } from './scene-physics2d-space.mjs';
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';

const proposals = new WeakMap();
const fail = () => { throw Object.assign(new TypeError('Invalid scene physics offset adjustment.'), { errorCode: 'scene_physics2d_space_edit_invalid' }); };
function vector(input) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype
    || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')
    || Object.getOwnPropertyDescriptor(input, 'length')?.value !== 2 || Reflect.ownKeys(input).length !== 3) fail();
  const result = [];
  for (let index = 0; index < 2; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Number.isFinite(descriptor.value)) fail();
    result.push(descriptor.value);
  }
  return result;
}
const sameVector = (a, b) => a.every((value, index) => value === b[index]);

export function createScenePhysics2DOffsetProposal(view, bodyId, inputDelta) {
  try {
    if (!isScenePhysics2DSpaceView(view) || typeof bodyId !== 'string') fail();
    const body = view.bodies.find(value => value.id === bodyId);
    // Missing instances have declarations but no scene-space adjustment target.
    if (!body) fail();
    const actor = view.actors.find(value => value.instanceId === body.instanceId);
    if (!actor) fail();
    const delta = vector(inputDelta), fromOffset = [...body.offset], offset = fromOffset.map((value, index) => value + delta[index]);
    // Rust remains the single owner of legal local offsets and body geometry.
    // Inspection of one existing body cannot change its kind, shape or masks.
    inspectScenePhysics2D({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: view.scene.objectId,
      bodies: [{ id: body.id, instanceId: body.instanceId, kind: body.kind, shape: body.shape, offset, layer: body.layer, mask: body.mask }] });
    const proposal = Object.freeze({ bodyId, instanceId: body.instanceId,
      fromOffset: Object.freeze(fromOffset), offset: Object.freeze(offset), delta: Object.freeze(delta),
      center: Object.freeze(actor.position.map((value, index) => value + offset[index])) });
    proposals.set(proposal, view); return proposal;
  } catch (error) {
    if (error?.errorCode === 'studio_core_unavailable') throw error;
    fail();
  }
}
export function isScenePhysics2DOffsetProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}
export function scenePhysics2DOffsetProposalMatches(proposal, currentView, bodyId, currentOffset) {
  if (!isScenePhysics2DOffsetProposal(proposal) || proposals.get(proposal) !== currentView || proposal.bodyId !== bodyId) return false;
  try {
    const body = currentView.bodies.find(value => value.id === bodyId);
    return Boolean(body && sameVector(body.offset, proposal.fromOffset) && sameVector(vector(currentOffset), proposal.fromOffset));
  } catch { return false; }
}
