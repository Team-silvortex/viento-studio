// Rendering boundary for already sampled values. This module does not sample
// curves or change actor layout; Rust remains the animation rule owner.
const invalid = () => { throw new TypeError('Invalid scene animation visual sample.'); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const finite = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
  return Object.fromEntries(keys.map(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(); return [key, descriptor.value]; }));
}
function list(value, max, item) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > max || Reflect.ownKeys(value).length !== length + 1) invalid();
  return Array.from({ length }, (_, index) => { const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(); return item(descriptor.value); });
}
export function captureSceneAnimationVisualFrame(actors, input) {
  const identities = list(actors, 128, actor => {
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(actor))) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(actor, 'instanceId');
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    return descriptor.value;
  });
  const members = new Set(identities);
  if (members.size !== actors.length || [...members].some(id => !uuid(id))) invalid();
  const sample = record(input, ['timeSeconds', 'localTimeSeconds', 'finished', 'values']);
  if (!finite(sample.timeSeconds, 0, 86400) || !finite(sample.localTimeSeconds, 0, 60) || typeof sample.finished !== 'boolean') invalid();
  const tracks = new Set(), channels = new Set(), frames = new Map();
  list(sample.values, 32, input => {
    const sprite = Object.getOwnPropertyDescriptor(input, 'property')?.value === 'spriteFrame2d';
    const row = record(input, ['trackId', 'instanceId', 'property', 'value', ...(sprite ? ['grid'] : [])]);
    if (!uuid(row.trackId) || tracks.has(row.trackId) || !members.has(row.instanceId)
      || !['offset2d', 'rotation2d', 'scale2d', 'opacity', 'spriteFrame2d'].includes(row.property)) invalid();
    const channel = row.instanceId + ':' + row.property;
    if (channels.has(channel)) invalid(); tracks.add(row.trackId); channels.add(channel);
    let value = row.value;
    if (sprite) {
      const grid = record(row.grid, ['columns', 'rows']);
      if (![grid.columns, grid.rows].every(v => Number.isInteger(v) && v >= 1 && v <= 64)
        || !Number.isInteger(value) || value < 0 || value >= grid.columns * grid.rows) invalid();
      value = Object.freeze({ ...grid, index: value });
    } else if (['offset2d', 'scale2d'].includes(row.property)) {
      const low = row.property === 'scale2d' ? 0.01 : -10000, high = row.property === 'scale2d' ? 100 : 10000;
      value = list(value, 2, entry => { if (!finite(entry, low, high)) invalid(); return entry; });
      if (value.length !== 2) invalid(); Object.freeze(value);
    } else if (!finite(value, row.property === 'opacity' ? 0 : -36000, row.property === 'opacity' ? 1 : 36000)) invalid();
    if (!frames.has(row.instanceId)) frames.set(row.instanceId, { instanceId: row.instanceId,
      offset2d: Object.freeze([0, 0]), rotation2d: 0, scale2d: Object.freeze([1, 1]), opacity: 1 });
    frames.get(row.instanceId)[row.property] = value;
  });
  return Object.freeze([...frames.values()].map(Object.freeze));
}
