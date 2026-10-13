// Read-only observations of one build task. Navigation and source revision /
// character-boundary checks remain the source host's responsibility.
const maximumRows = 256;
const maximumOffset = 4 * 1024 * 1024;
const rowKeys = ['code', 'severity', 'messageKey', 'detail', 'sourcePath', 'propertyPath', 'sourceRevision'];
const taskKeys = ['id', 'kind', 'status', 'backendId', 'sceneId'];
const severities = ['error', 'warning', 'info'];
const invalid = () => Object.assign(new TypeError('Invalid project problems snapshot or query.'), {
  errorCode: 'project_problems_invalid',
});

function record(input, required, optional = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) throw invalid();
  const names = Reflect.ownKeys(input), allowed = [...required, ...optional];
  if (names.length < required.length || names.length > allowed.length
    || names.some(key => typeof key !== 'string' || !allowed.includes(key))) throw invalid();
  const result = {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(result, key))) throw invalid();
  return result;
}

function list(input, maximum) {
  if (!Array.isArray(input)) throw invalid();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum
    || Reflect.ownKeys(input).length !== length + 1) throw invalid();
  const result = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    result.push(descriptor.value);
  }
  return result;
}

const text = (value, maximum, empty = false) => typeof value === 'string'
  && (empty || value.length > 0) && value.length <= maximum;
const identity = (value, empty = false) => text(value, 160, empty) && !/[\u0000-\u001f\u007f]/.test(value);
const pointer = value => text(value, 2048, true) && (value === '' || value.startsWith('/'));
const revision = value => typeof value === 'string' && (value === '' || /^sha256:[a-f0-9]{64}$/.test(value));
const sourcePath = value => text(value, 4096, true) && (value === '' || !value.includes('\\')
  && !/[\u0000-\u001f\u007f]/.test(value) && !/^[a-z]:/i.test(value)
  && !value.split('/').some(part => !part || part === '.' || part === '..'));

function taskSnapshot(input) {
  const value = record(input, taskKeys);
  if (!identity(value.id) || !identity(value.backendId) || !identity(value.sceneId, true)
    || !['plan', 'build', 'run', 'suite'].includes(value.kind)
    || !['running', 'succeeded', 'failed', 'cancelled', 'timeout'].includes(value.status)) throw invalid();
  return Object.freeze(value);
}

function rowSnapshot(input, index, indexed) {
  const value = record(input, indexed ? ['index', ...rowKeys] : rowKeys, ['sourceRange']);
  if (indexed && value.index !== index || !text(value.code, 160) || !severities.includes(value.severity)
    || !text(value.messageKey, 2000) || !text(value.detail, 8192, true) || !sourcePath(value.sourcePath)
    || !pointer(value.propertyPath) || !revision(value.sourceRevision)) throw invalid();
  let sourceRange;
  if (Object.hasOwn(value, 'sourceRange')) {
    sourceRange = record(value.sourceRange, ['encoding', 'start', 'end', 'exact', 'propertyPath']);
    if (!value.sourcePath || !value.sourceRevision || sourceRange.encoding !== 'utf-16'
      || !Number.isSafeInteger(sourceRange.start) || !Number.isSafeInteger(sourceRange.end)
      || sourceRange.start < 0 || sourceRange.end < sourceRange.start || sourceRange.end > maximumOffset
      || typeof sourceRange.exact !== 'boolean' || !pointer(sourceRange.propertyPath)) throw invalid();
    // A different property path or exact:false is a valid approximate hint.
    // The source host must never promote either into an exact selection.
    Object.freeze(sourceRange);
  }
  return Object.freeze({ index, code: value.code, severity: value.severity, messageKey: value.messageKey,
    detail: value.detail, sourcePath: value.sourcePath, propertyPath: value.propertyPath,
    sourceRevision: value.sourceRevision, ...(sourceRange ? { sourceRange } : {}) });
}

function capture(input, indexed) {
  const valuesKey = indexed ? 'rows' : 'diagnostics';
  const value = record(input, ['task', valuesKey]);
  const task = taskSnapshot(value.task);
  const rows = list(value[valuesKey], maximumRows).map((row, index) => rowSnapshot(row, index, indexed));
  return Object.freeze({ task, rows: Object.freeze(rows) });
}

// Invalid source metadata rejects the whole observation. No row is silently
// omitted, repaired or given invented provenance. Hosts provide absent scalar
// fields as empty strings and omit sourceRange when there is no range.
export function createProjectProblemsSnapshot(input) {
  try { return capture(input, false); } catch { throw invalid(); }
}

export function filterProjectProblems(snapshot, options = {}) {
  try {
    // Revalidate and detach so a serialized snapshot is as safe as a local one;
    // caller mutation or getters cannot change a returned filter result.
    const captured = capture(snapshot, true);
    const request = record(options, [], ['severity', 'query', 'messages']);
    const severity = Object.hasOwn(request, 'severity') ? request.severity : 'all';
    const query = Object.hasOwn(request, 'query') ? request.query : '';
    if (!['all', ...severities].includes(severity) || !text(query, 4096, true)) throw invalid();
    const messages = Object.hasOwn(request, 'messages') ? list(request.messages, maximumRows) : null;
    if (messages && (messages.length !== captured.rows.length || messages.some(value => !text(value, 4000, true)))) throw invalid();
    const expression = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu') : null;
    const counts = { error: 0, warning: 0, info: 0 };
    const rows = [];
    for (const row of captured.rows) {
      counts[row.severity]++;
      if (severity !== 'all' && row.severity !== severity) continue;
      const haystacks = [row.code, row.messageKey, row.detail, row.sourcePath, row.propertyPath];
      if (messages) haystacks.push(messages[row.index]);
      if (!expression || haystacks.some(value => expression.test(value))) rows.push(row);
    }
    return Object.freeze({ rows: Object.freeze(rows), total: captured.rows.length,
      matched: rows.length, counts: Object.freeze(counts) });
  } catch { throw invalid(); }
}
