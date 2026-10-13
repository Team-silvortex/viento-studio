import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createProjectProblemsSnapshot, filterProjectProblems } from '../../engine/project-problems.mjs';

const task = () => ({ id: 'job-one', kind: 'plan', status: 'failed', backendId: 'org.viento.godot4', sceneId: 'scene-one' });
const diagnostic = (overrides = {}) => ({ code: 'build_actor_value', severity: 'error',
  messageKey: '角色字段的值不符合要求，请检查标出的位置。', detail: 'Speed must be numeric.',
  sourcePath: 'documents/scenes/旅人.json', propertyPath: '/actors/0/speed', sourceRevision: `sha256:${'a'.repeat(64)}`,
  sourceRange: { encoding: 'utf-16', start: 20, end: 24, exact: true, propertyPath: '/actors/0/speed' }, ...overrides });
const request = (diagnostics = [diagnostic()]) => ({ task: task(), diagnostics });
const snapshot = diagnostics => createProjectProblemsSnapshot(request(diagnostics));
const invalid = operation => assert.throws(operation, error => error instanceof TypeError && error.errorCode === 'project_problems_invalid');
const withoutRange = overrides => { const value = diagnostic(overrides); delete value.sourceRange; return value; };

test('one task observation detaches every record and deeply freezes provenance', () => {
  const input = request(), result = createProjectProblemsSnapshot(input);
  assert.deepEqual(result.task, input.task);
  assert.deepEqual(result.rows[0], { index: 0, ...input.diagnostics[0] });
  for (const value of [result, result.task, result.rows, result.rows[0], result.rows[0].sourceRange]) assert.equal(Object.isFrozen(value), true);
  input.task.id = 'new-job'; input.diagnostics[0].detail = 'changed'; input.diagnostics[0].sourceRange.start = 3;
  input.diagnostics.push(diagnostic());
  assert.equal(result.task.id, 'job-one'); assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].detail, 'Speed must be numeric.'); assert.equal(result.rows[0].sourceRange.start, 20);
});

test('duplicate problems retain original order and distinct zero-based indices', () => {
  const repeated = diagnostic(), result = snapshot([repeated, diagnostic({ severity: 'warning' }), repeated]);
  assert.deepEqual(result.rows.map(row => [row.index, row.severity]), [[0, 'error'], [1, 'warning'], [2, 'error']]);
  assert.notEqual(result.rows[0], result.rows[2]); assert.notEqual(result.rows[0].sourceRange, result.rows[2].sourceRange);
  const filtered = filterProjectProblems(result, { severity: 'error' });
  assert.deepEqual(filtered.rows.map(row => row.index), [0, 2]);
  assert.deepEqual(filtered.counts, { error: 2, warning: 1, info: 0 });
});

test('empty observations and missing source locations remain explicit', () => {
  const result = snapshot([]); assert.deepEqual(result.rows, []);
  assert.deepEqual(filterProjectProblems(result), { rows: [], total: 0, matched: 0, counts: { error: 0, warning: 0, info: 0 } });
  const missing = withoutRange({ sourcePath: '', propertyPath: '', sourceRevision: '', detail: '', severity: 'info' });
  const row = snapshot([missing]).rows[0];
  assert.equal(row.sourcePath, ''); assert.equal(Object.hasOwn(row, 'sourceRange'), false);
});

test('all existing task phases and outcomes retain their exact scalar identity', () => {
  for (const kind of ['plan', 'build', 'run', 'suite']) for (const status of ['running', 'succeeded', 'failed', 'cancelled', 'timeout']) {
    const input = request([]); input.task.kind = kind; input.task.status = status;
    assert.deepEqual(createProjectProblemsSnapshot(input).task, input.task);
  }
});

test('bounded task identity and enum validation rejects ambiguous ownership', () => {
  for (const [key, value] of [['id', ''], ['id', 'x'.repeat(161)], ['backendId', ''], ['backendId', 'engine\nother'],
    ['sceneId', {}], ['kind', 'check-all'], ['status', 'complete']]) {
    const input = request(); input.task[key] = value; invalid(() => createProjectProblemsSnapshot(input));
  }
  const input = request([]); input.task.sceneId = ''; assert.equal(createProjectProblemsSnapshot(input).task.sceneId, '');
});

test('exact and approximate original UTF-16 ranges stay unchanged for the source host', () => {
  const point = diagnostic({ sourceRange: { encoding: 'utf-16', start: 0, end: 0, exact: true, propertyPath: '' } });
  const approximate = diagnostic({ sourceRange: { encoding: 'utf-16', start: 1, end: 4194304, exact: false, propertyPath: '/actors' } });
  const result = snapshot([point, approximate]);
  assert.deepEqual(result.rows[0].sourceRange, point.sourceRange);
  assert.deepEqual(result.rows[1].sourceRange, approximate.sourceRange);
  assert.notEqual(result.rows[0].sourceRange.propertyPath, result.rows[0].propertyPath);
});

test('paths reject traversal, absolute paths, repeated segments and platform separators', () => {
  for (const sourcePath of ['../secret', 'a/../secret', 'a/./b', './a', '/tmp/a', 'a//b', 'a/', 'C:/a', 'C:private', '\\server\\a', 'a\\b', 'a\u0000b', 'a\nb', 'x'.repeat(4097)]) {
    invalid(() => snapshot([diagnostic({ sourcePath })]));
  }
  assert.equal(snapshot([diagnostic({ sourcePath: '文档/雪😀/a b.json' })]).rows[0].sourcePath, '文档/雪😀/a b.json');
});

test('dishonest ranges or revisions reject the whole snapshot rather than hide a problem', () => {
  for (const sourceRevision of ['bad', 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(63), null, '']) {
    invalid(() => snapshot([diagnostic(), diagnostic({ sourceRevision })]));
  }
  for (const change of [{ encoding: 'bytes' }, { start: -1 }, { end: 19 }, { start: 0.5 }, { end: Infinity },
    { end: 4194305 }, { exact: 'true' }, { propertyPath: 'actors' }, { extra: true }]) {
    invalid(() => snapshot([diagnostic({ sourceRange: { ...diagnostic().sourceRange, ...change } })]));
  }
  invalid(() => snapshot([diagnostic({ sourcePath: '' })]));
  invalid(() => snapshot([diagnostic({ sourceRange: null })]));
});

test('metadata budgets and severity reject malformed display data without truncation', () => {
  for (const [key, value] of [['code', ''], ['code', 'x'.repeat(161)], ['messageKey', ''], ['messageKey', 'x'.repeat(2001)],
    ['detail', 'x'.repeat(8193)], ['detail', {}], ['propertyPath', '/'.repeat(2049)], ['propertyPath', 'field'], ['severity', 'fatal']]) {
    invalid(() => snapshot([diagnostic({ [key]: value })]));
  }
  const maximum = diagnostic({ code: 'x'.repeat(160), messageKey: 'x'.repeat(2000), detail: 'x'.repeat(8192), propertyPath: '/'.repeat(2048) });
  assert.equal(snapshot([maximum]).rows[0].detail.length, 8192);
});

test('256 complete rows are admitted; oversized or sparse arrays are rejected atomically', () => {
  assert.equal(snapshot(Array.from({ length: 256 }, () => diagnostic())).rows.length, 256);
  invalid(() => snapshot(Array.from({ length: 257 }, () => diagnostic())));
  invalid(() => snapshot(new Array(1)));
  const extra = [diagnostic()]; extra.extra = true; invalid(() => snapshot(extra));
  invalid(() => createProjectProblemsSnapshot({ task: task(), diagnostics: { 0: diagnostic(), length: 1 } }));
});

test('strict records reject inherited values, extra keys and nonenumerable properties', () => {
  const inherited = Object.create(diagnostic()); invalid(() => snapshot([inherited]));
  invalid(() => snapshot([diagnostic({ index: 0 })])); invalid(() => snapshot([diagnostic({ extra: true })]));
  const hidden = diagnostic(); Object.defineProperty(hidden, 'detail', { value: 'hidden', enumerable: false }); invalid(() => snapshot([hidden]));
  const symbol = diagnostic(); symbol[Symbol('extra')] = true; invalid(() => snapshot([symbol]));
  invalid(() => createProjectProblemsSnapshot({ ...request(), extra: true }));
  invalid(() => createProjectProblemsSnapshot(null));
});

test('record and array accessors are rejected without executing authored code', () => {
  let reads = 0;
  const getter = { enumerable: true, get() { reads++; throw Error('must not read'); } };
  for (const mutate of [input => Object.defineProperty(input, 'task', getter),
    input => Object.defineProperty(input.task, 'id', getter), input => Object.defineProperty(input.diagnostics, '0', getter),
    input => Object.defineProperty(input.diagnostics[0], 'detail', getter), input => Object.defineProperty(input.diagnostics[0].sourceRange, 'start', getter)]) {
    const input = request(); mutate(input); invalid(() => createProjectProblemsSnapshot(input));
  }
  assert.equal(reads, 0);
});

test('plain cross-realm and null-prototype records work without invoking constructors', () => {
  const other = vm.runInNewContext('(' + JSON.stringify(request()) + ')');
  assert.deepEqual(createProjectProblemsSnapshot(other), snapshot());
  const input = request(); Object.setPrototypeOf(input, null); Object.setPrototypeOf(input.task, null);
  Object.setPrototypeOf(input.diagnostics[0], null); Object.setPrototypeOf(input.diagnostics[0].sourceRange, null);
  assert.deepEqual(createProjectProblemsSnapshot(input), snapshot());
});

test('filters combine severity with literal text while counts describe the complete task', () => {
  const result = snapshot([diagnostic({ detail: 'Blue SPEED' }), diagnostic({ severity: 'warning', detail: 'Blue light' }), diagnostic({ severity: 'info', detail: 'Green light' })]);
  const filtered = filterProjectProblems(result, { severity: 'warning', query: 'blue' });
  assert.deepEqual(filtered.rows.map(row => row.index), [1]); assert.equal(filtered.total, 3); assert.equal(filtered.matched, 1);
  assert.deepEqual(filtered.counts, { error: 1, warning: 1, info: 1 });
  const none = filterProjectProblems(result, { query: 'nothing' }); assert.equal(none.matched, 0); assert.equal(none.total, 3);
  assert.equal(Object.isFrozen(filtered), true); assert.equal(Object.isFrozen(filtered.rows), true); assert.equal(Object.isFrozen(filtered.counts), true);
});

test('each displayed source field is searchable without crossing field boundaries', () => {
  const result = snapshot([diagnostic()]);
  for (const query of ['BUILD_ACTOR', '角色字段', 'MUST BE NUMERIC', '旅人.JSON', '/ACTORS/0/SPEED']) assert.equal(filterProjectProblems(result, { query }).matched, 1, query);
  assert.equal(filterProjectProblems(result, { query: 'numeric.documents' }).matched, 0);
  assert.equal(filterProjectProblems(result, { query: result.task.id }).matched, 0, 'task identity is not a displayed problem field');
});

test('search treats regular-expression syntax, spaces and Unicode text as literal content', () => {
  const result = snapshot([diagnostic({ detail: '  price $& [a-z]+ .* 雪😀 Kelvin  ' }), diagnostic({ detail: 'other' })]);
  for (const query of ['$&', '[a-z]+', '.*', '雪😀', 'kelvin', '  ']) assert.deepEqual(filterProjectProblems(result, { query }).rows.map(row => row.index), [0], query);
  assert.equal(filterProjectProblems(result, { query: '^other$' }).matched, 0);
});

test('localized messages are aligned to original indices and can change without mutating snapshots', () => {
  const result = snapshot([diagnostic(), diagnostic({ severity: 'warning' })]);
  const messages = ['Invalid actor value.', 'Speed warning.'];
  assert.deepEqual(filterProjectProblems(result, { query: 'warning', messages }).rows.map(row => row.index), [1]);
  assert.deepEqual(filterProjectProblems(result, { severity: 'error', query: 'actor', messages }).rows.map(row => row.index), [0]);
  messages[0] = '値が無効です。'; assert.equal(filterProjectProblems(result, { query: '無効', messages }).matched, 1);
  assert.equal(result.rows[0].messageKey, diagnostic().messageKey);
});

test('serialized snapshots are revalidated and detached before filtering', () => {
  const serialized = JSON.parse(JSON.stringify(snapshot()));
  const result = filterProjectProblems(serialized); serialized.rows[0].sourceRange.start = 0;
  assert.equal(result.rows[0].sourceRange.start, 20); assert.equal(Object.isFrozen(result.rows[0]), true);
  for (const mutate of [value => value.rows[0].index = 2, value => value.rows[0].sourceRange.end = -1,
    value => value.rows[0].extra = true, value => value.task.id = '', value => value.rows.reverse().push(value.rows[0])]) {
    const value = JSON.parse(JSON.stringify(snapshot())); mutate(value); invalid(() => filterProjectProblems(value));
  }
});

test('query and localized message budgets fail explicitly without partial results', () => {
  const result = snapshot();
  assert.equal(filterProjectProblems(result, { query: 'x'.repeat(4096), messages: ['x'.repeat(4000)] }).matched, 0);
  for (const options of [{ query: 'x'.repeat(4097) }, { query: null }, { severity: '' }, { extra: true },
    { messages: [] }, { messages: ['x'.repeat(4001)] }, { messages: [false] }, { messages: new Array(1) }, null]) {
    invalid(() => filterProjectProblems(result, options));
  }
});

test('filter options, localized arrays and serialized rows never execute getters', () => {
  const result = snapshot(); let reads = 0;
  const getter = { enumerable: true, get() { reads++; return 'anything'; } };
  const options = {}; Object.defineProperty(options, 'query', getter); invalid(() => filterProjectProblems(result, options));
  const messages = ['']; Object.defineProperty(messages, '0', getter); invalid(() => filterProjectProblems(result, { messages }));
  const mutable = JSON.parse(JSON.stringify(result)); Object.defineProperty(mutable.rows[0], 'detail', getter); invalid(() => filterProjectProblems(mutable));
  assert.equal(reads, 0);
});
