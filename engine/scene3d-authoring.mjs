// Shared source identity admission only. Each authoring intent owns its own
// native operation, private proposal brand and complete-candidate review.
const snapshotKeys = ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision'];
const revision = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

export function assertScene3DAuthoringRecord(value, keys, failure) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) throw failure();
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key)
    || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) throw failure();
}

export function captureScene3DAuthoringSource(input, failure) {
  assertScene3DAuthoringRecord(input, snapshotKeys, failure);
  const copy = Object.fromEntries(snapshotKeys.map(key => [key, input[key]]));
  if (typeof copy.content !== 'string' || typeof copy.token !== 'string' || !copy.token || copy.token.length > 256
    || typeof copy.sourcePath !== 'string' || !copy.sourcePath || copy.sourcePath.length > 4096
    || copy.sourcePath.startsWith('/') || copy.sourcePath.includes('\\') || copy.sourcePath.includes('\0')
    || copy.sourcePath.split('/').some(part => !part || part === '.' || part === '..') || !/\.json$/i.test(copy.sourcePath)
    || !revision(copy.baseSourceRevision) || !revision(copy.sourceRevision)) throw failure();
  return Object.freeze(copy);
}
