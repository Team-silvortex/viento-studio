// Portable delivery descriptions grant no import, execution or filesystem authority.
import { validateBackendProjectManifest } from './backend-project.mjs';

const keys = ['format', 'schemaVersion', 'manifestSha256', 'fileName', 'project'];
const invalid = () => Object.assign(new TypeError('Invalid backend project delivery review.'), { errorCode: 'backend_project_delivery_invalid' });
const fileName = project => `viento-${project.buildId}.viento-build.zip`;

export function createBackendProjectDeliveryReview(project, manifestSha256) {
  if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifestSha256)) throw invalid();
  let checked;
  try { checked = validateBackendProjectManifest(project); } catch { throw invalid(); }
  return Object.freeze({ format: 'viento-build-delivery-review', schemaVersion: 1,
    manifestSha256, fileName: fileName(checked), project: checked });
}

export function validateBackendProjectDeliveryReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw invalid();
  const value = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  const review = createBackendProjectDeliveryReview(value.project, value.manifestSha256);
  if (value.format !== review.format || value.schemaVersion !== review.schemaVersion || value.fileName !== review.fileName) throw invalid();
  return review;
}
