import { captureSceneAnimationVisualFrame } from './scene-animation-visual-frame.mjs';

// An instance layer carries separate Rust samples, each with its own local
// clock. Validate the whole layer before the renderer replaces any actor.
export function captureSceneAnimationInstanceVisualFrame(actors, input) {
  const invalid = () => { throw new TypeError('Invalid instance animation visual layer.'); };
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), count = descriptors.length?.value;
  if (!Number.isInteger(count) || count < 1 || count > 32 || Reflect.ownKeys(descriptors).length !== count + 1) invalid();
  const instances = new Set(), tracks = new Set(), frames = [];
  for (let index = 0; index < count; index++) {
    const descriptor = descriptors[index]; if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    const row = descriptor.value;
    if (!row || typeof row !== 'object' || Array.isArray(row) || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) invalid();
    const properties = Object.getOwnPropertyDescriptors(row);
    if (Reflect.ownKeys(properties).length !== 2 || ['instanceId','sample'].some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value'))) invalid();
    const instanceId = properties.instanceId.value, sample = properties.sample.value;
    if (instances.has(instanceId)) invalid();
    const captured = captureSceneAnimationVisualFrame(actors, sample);
    if (captured.length !== 1 || captured[0].instanceId !== instanceId) invalid();
    for (const value of sample.values) { if (tracks.has(value.trackId)) invalid(); tracks.add(value.trackId); }
    if (tracks.size > 32) invalid();
    instances.add(instanceId); frames.push(captured[0]);
  }
  return Object.freeze(frames);
}
