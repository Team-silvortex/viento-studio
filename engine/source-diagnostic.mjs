// Detached display data for a source editor. The caller verifies revisions and
// translates source ranges to normalized textarea offsets before capture.
const requiredKeys = ['sourcePath', 'propertyPath', 'code', 'severity', 'messageKey', 'sourceRevision', 'status'];
const optionalKeys = ['detail', 'range'];
const maximumOffset = 4 * 1024 * 1024;
const invalid = () => Object.assign(new TypeError('Invalid source diagnostic snapshot.'), {
  errorCode: 'source_diagnostic_invalid',
});

function record(input, required, optional = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const prototype = Object.getPrototypeOf(input);
  // This also accepts plain records from another realm without invoking their
  // constructors, accessors, iterators or JSON serializers.
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) throw invalid();
  const names = Reflect.ownKeys(input), allowed = [...required, ...optional];
  if (names.length < required.length || names.length > allowed.length
    || names.some(key => typeof key !== 'string' || !allowed.includes(key))) throw invalid();
  const output = {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    output[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(output, key))) throw invalid();
  return output;
}

const text = (value, maximum, allowEmpty = false) => typeof value === 'string'
  && (allowEmpty || value.length > 0) && value.length <= maximum;

export function createSourceDiagnosticSnapshot(input) {
  try {
    const value = record(input, requiredKeys, optionalKeys);
    if (!text(value.sourcePath, 4096) || value.sourcePath.includes('\\') || /[\u0000-\u001f\u007f]/.test(value.sourcePath)
      || /^[a-z]:/i.test(value.sourcePath) || value.sourcePath.split('/').some(part => !part || part === '.' || part === '..')
      || !text(value.propertyPath, 2048, true) || value.propertyPath !== '' && !value.propertyPath.startsWith('/')
      || !text(value.code, 160) || !['error', 'warning', 'info'].includes(value.severity)
      || !text(value.messageKey, 2000) || Object.hasOwn(value, 'detail') && !text(value.detail, 8192, true)
      || typeof value.sourceRevision !== 'string' || value.sourceRevision !== '' && !/^sha256:[a-f0-9]{64}$/.test(value.sourceRevision)
      || !['exact', 'stale', 'approximate', 'unavailable'].includes(value.status)) throw invalid();
    const exact = value.status === 'exact';
    if (Object.hasOwn(value, 'range') !== exact) throw invalid();
    let range;
    if (exact) {
      range = record(value.range, ['start', 'end']);
      if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
        || range.start < 0 || range.end < range.start || range.end > maximumOffset) throw invalid();
      Object.freeze(range);
    }
    return Object.freeze({ sourcePath: value.sourcePath, propertyPath: value.propertyPath, code: value.code,
      severity: value.severity, messageKey: value.messageKey, detail: value.detail ?? '',
      sourceRevision: value.sourceRevision, status: value.status, ...(exact ? { range } : {}) });
  } catch { throw invalid(); }
}
