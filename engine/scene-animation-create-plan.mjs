// One identity-allocated starter track. Rust owns format validation; this pure
// authoring plan owns neither scene lookup, files, playback nor rendering.
import { inspectSceneAnimation } from './scene-animation-core.mjs';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const invalid = () => { throw new TypeError('Expected exact animation creation data.'); };
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
export function createSceneAnimationCreationDraft(input) {
  try {
    const raw = record(input, ['sceneObjectId', 'trackId', 'instanceId', 'property', 'durationSeconds', 'loop', 'endValue']);
    if (['sceneObjectId', 'trackId', 'instanceId', 'property'].some(key => typeof raw[key] !== 'string')
      || typeof raw.durationSeconds !== 'number' || !Number.isFinite(raw.durationSeconds) || typeof raw.loop !== 'boolean') invalid();
    const identities = { offset2d: [0, 0], rotation2d: 0, scale2d: [1, 1], opacity: 1 };
    if (!Object.hasOwn(identities, raw.property)) invalid();
    const endValue = Array.isArray(identities[raw.property]) ? vector(raw.endValue) : raw.endValue;
    if (!Array.isArray(endValue) && (typeof endValue !== 'number' || !Number.isFinite(endValue))) invalid();
    const { document } = inspectSceneAnimation({ format: 'viento-scene-animation', schemaVersion: 1,
      sceneObjectId: raw.sceneObjectId, durationSeconds: raw.durationSeconds, loop: raw.loop,
      tracks: [{ id: raw.trackId, instanceId: raw.instanceId, property: raw.property, interpolation: 'linear',
        keyframes: [{ atSeconds: 0, value: identities[raw.property] }, { atSeconds: raw.durationSeconds, value: endValue }] }] });
    return freeze({ ok: true, content: JSON.stringify(document, null, 2) + '\n', diagnostics: [] });
  } catch (error) {
    return freeze({ ok: false, content: null, diagnostics: [{ severity: 'error', code: error?.errorCode === 'studio_core_unavailable' ? error.errorCode : 'build_animation_invalid',
      message: 'Expected allocated scene/track/instance identities and complete bounded visual animation settings.', propertyPath: '' }] });
  }
}
