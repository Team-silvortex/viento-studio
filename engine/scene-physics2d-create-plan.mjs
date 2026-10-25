// One identity-allocated starter body. Rust owns format validation; this pure
// authoring plan owns neither scene lookup, files, simulation nor rendering.
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const invalid = () => { throw new TypeError('Expected exact physics2d creation data.'); };
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) invalid();
  const keys = Reflect.ownKeys(value); if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) invalid();
  return Object.fromEntries(fields.map(key => { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid(); return [key, d.value]; }));
}
function vector(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== 3
    || Object.getOwnPropertyDescriptor(value, 'length')?.value !== 2) invalid();
  return [0, 1].map(index => { const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (!d?.enumerable || !Object.hasOwn(d, 'value') || typeof d.value !== 'number' || !Number.isFinite(d.value)) invalid(); return d.value; });
}
export function createScenePhysics2DCreationDraft(input) {
  try {
    const hasResponse = input !== null && typeof input === 'object' && Object.hasOwn(input, 'collisionResponse');
    const raw = record(input, ['sceneObjectId', 'bodyId', 'instanceId', 'kind', 'shape', 'offset', 'layer', 'mask', ...(hasResponse ? ['collisionResponse'] : [])]);
    if (hasResponse && (raw.kind !== 'character' || !['stop', 'slide'].includes(raw.collisionResponse))) invalid();
    if (['sceneObjectId', 'bodyId', 'instanceId', 'kind'].some(key => typeof raw[key] !== 'string')
      || typeof raw.layer !== 'number' || typeof raw.mask !== 'number') invalid();
    // Capture the discriminator before choosing exact shape fields; no getter
    // or author serializer is invoked before native rule validation.
    const discriminator = raw.shape && Object.getOwnPropertyDescriptor(raw.shape, 'kind');
    if (!discriminator?.enumerable || !Object.hasOwn(discriminator, 'value')) invalid();
    const fields = discriminator.value === 'box' ? ['kind', 'size'] : discriminator.value === 'circle' ? ['kind', 'radius'] : [];
    if (!fields.length) invalid();
    const shape = record(raw.shape, fields);
    if (shape.kind === 'box') shape.size = vector(shape.size);
    else if (typeof shape.radius !== 'number' || !Number.isFinite(shape.radius)) invalid();
    const slide = raw.collisionResponse === 'slide';
    const { document } = inspectScenePhysics2D({ format: 'viento-scene-physics2d', schemaVersion: slide ? 2 : 1,
      sceneObjectId: raw.sceneObjectId, bodies: [{ id: raw.bodyId, instanceId: raw.instanceId, kind: raw.kind,
        shape, offset: vector(raw.offset), layer: raw.layer, mask: raw.mask, ...(slide ? { collisionResponse: 'slide' } : {}) }] });
    return freeze({ ok: true, content: JSON.stringify(document, null, 2) + '\n', diagnostics: [] });
  } catch (error) {
    return freeze({ ok: false, content: null, diagnostics: [{ severity: 'error', code: error?.errorCode === 'studio_core_unavailable' ? error.errorCode : 'build_physics_invalid',
      message: 'Expected allocated scene/body/instance identities and complete bounded physics settings.', propertyPath: '' }] });
  }
}
