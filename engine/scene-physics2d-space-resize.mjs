// Size gestures propose edits to an existing collider's checked shape. They
// preserve its center, offset and kind and carry no source or Save authority.
import { isScenePhysics2DSpaceView } from './scene-physics2d-space.mjs';
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';

const proposals = new WeakMap();
const fail = () => { throw Object.assign(new TypeError('Invalid scene physics shape resize.'), { errorCode: 'scene_physics2d_space_resize_invalid' }); };
const safeSerializers = () => !Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') && !Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
function vector(input, length) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || !safeSerializers()
    || Object.getOwnPropertyDescriptor(input, 'length')?.value !== length || Reflect.ownKeys(input).length !== length + 1) fail();
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Number.isFinite(descriptor.value)) fail();
    result.push(descriptor.value);
  }
  return result;
}
function shape(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || !safeSerializers()) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  const kind = descriptors.kind;
  if (!kind?.enumerable || !Object.hasOwn(kind, 'value') || !['box', 'circle'].includes(kind.value)) fail();
  const property = kind.value === 'box' ? 'size' : 'radius', value = descriptors[property];
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string' || !['kind', property].includes(key))
    || !value?.enumerable || !Object.hasOwn(value, 'value')) fail();
  if (kind.value === 'box') return { kind: 'box', size: vector(value.value, 2) };
  if (!Number.isFinite(value.value)) fail();
  return { kind: 'circle', radius: value.value };
}
const sameShape = (a, b) => a.kind === b.kind && (a.kind === 'box' ? a.size.every((value, index) => value === b.size[index]) : a.radius === b.radius);
const freezeShape = value => { if (value.kind === 'box') Object.freeze(value.size); return Object.freeze(value); };

export function createScenePhysics2DResizeProposal(view, bodyId, inputDelta) {
  try {
    if (!isScenePhysics2DSpaceView(view) || typeof bodyId !== 'string') fail();
    const body = view.bodies.find(value => value.id === bodyId);
    // A missing instance has no checked scene-space resize target.
    if (!body) fail();
    const delta = vector(inputDelta, body.shape.kind === 'box' ? 2 : 1), fromShape = shape(body.shape);
    const resized = fromShape.kind === 'box' ? { kind: 'box', size: fromShape.size.map((value, index) => value + delta[index]) }
      : { kind: 'circle', radius: fromShape.radius + delta[0] };
    // Full dimensions and radius are checked by the existing native rules.
    // This layer never clamps, snaps or substitutes its own size limits.
    inspectScenePhysics2D({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: view.scene.objectId,
      bodies: [{ id: body.id, instanceId: body.instanceId, kind: body.kind, shape: resized, offset: body.offset, layer: body.layer, mask: body.mask }] });
    const proposal = Object.freeze({ bodyId, instanceId: body.instanceId, fromShape: freezeShape(fromShape), shape: freezeShape(resized),
      center: Object.freeze([...body.center]), delta: Object.freeze(delta) });
    proposals.set(proposal, view); return proposal;
  } catch (error) {
    if (error?.errorCode === 'studio_core_unavailable') throw error;
    fail();
  }
}
export function isScenePhysics2DResizeProposal(value) {
  return Boolean(value && typeof value === 'object' && proposals.has(value));
}
export function scenePhysics2DResizeProposalMatches(proposal, currentView, bodyId, currentShape) {
  if (!isScenePhysics2DResizeProposal(proposal) || proposals.get(proposal) !== currentView || proposal.bodyId !== bodyId) return false;
  try {
    const body = currentView.bodies.find(value => value.id === bodyId);
    return Boolean(body && sameShape(body.shape, proposal.fromShape) && sameShape(shape(currentShape), proposal.fromShape));
  } catch { return false; }
}
