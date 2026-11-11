// A transient selection of an admitted native sample. This helper performs no
// navigation, author edits, engine work, replay evaluation or host I/O.
import { validateProjectPhysics2DObservation } from './project-physics2d-trace.mjs';
import { projectRuntimeUuid } from './project-runtime-contracts.mjs';

const ownerKeys = ['sessionOwner', 'navigationOwner', 'backendId', 'jobId', 'buildId', 'snapshotId', 'assemblyId'];
const sampleKeys = ['visitIndex', 'sceneId', 'instanceId', 'stepIndex', 'sequence'];
const invalid = () => { throw new TypeError('Invalid physical observation sample selection.'); };

// Never serialize caller objects or evaluate getters to obtain identity. The
// fixed scalar records also reject inherited, hidden and symbolic authority.
function fields(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
function owner(input) {
  const result = fields(input, ownerKeys);
  if (!text(result.sessionOwner, 1024 * 1024) || !text(result.navigationOwner, 1024 * 1024)
    || !['backendId', 'jobId', 'buildId'].every(key => text(result[key], 256))
    || typeof result.snapshotId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(result.snapshotId)
    || !projectRuntimeUuid(result.assemblyId)) invalid();
  return result;
}

export function resolveProjectPhysics2DObservationSelection(observation, input, inputOwner) {
  try {
    const request = fields(input, [...ownerKeys, ...sampleKeys]), currentOwner = owner(inputOwner);
    if (ownerKeys.some(key => request[key] !== currentOwner[key])
      || !integer(request.visitIndex, 64) || !projectRuntimeUuid(request.sceneId) || !projectRuntimeUuid(request.instanceId)
      || !integer(request.stepIndex, 30) || !integer(request.sequence, 256)) return null;
    const admitted = validateProjectPhysics2DObservation(observation);
    if (admitted.assemblyId !== currentOwner.assemblyId) return null;
    const sample = admitted.samples[request.sequence - 1];
    if (!sample || sampleKeys.some(key => sample[key] !== request[key])) return null;
    return Object.freeze({ instanceId: sample.instanceId, stepKey: `${sample.visitIndex}:${sample.sceneId}:${sample.stepIndex}`, sequence: sample.sequence });
  } catch { return null; }
}
