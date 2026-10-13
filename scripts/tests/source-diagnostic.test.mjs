import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSourceDiagnosticSnapshot } from '../../engine/source-diagnostic.mjs';

const maximumOffset = 4 * 1024 * 1024;
const invalid = error => error instanceof TypeError && error.errorCode === 'source_diagnostic_invalid';
const sample = (change = {}) => ({ sourcePath: 'documents/场景/旅人😀.json', propertyPath: '/actors/0/speed',
  code: 'source_value', severity: 'error', messageKey: '请检查此字段。', sourceRevision: `sha256:${'a'.repeat(64)}`,
  status: 'exact', range: { start: 12, end: 15 }, ...change });

test('capture detaches and freezes scalar data and its verified normalized range', () => {
  const input = sample(), result = createSourceDiagnosticSnapshot(input);
  assert.deepEqual(result, { ...input, detail: '' });
  assert.notEqual(result, input); assert.notEqual(result.range, input.range);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.range));
  input.sourcePath = 'documents/other.json'; input.range.start = 0;
  assert.equal(result.sourcePath, 'documents/场景/旅人😀.json'); assert.equal(result.range.start, 12);
  assert.throws(() => { result.status = 'stale'; }, TypeError);
  assert.throws(() => { result.range.end = 17; }, TypeError);
});

test('author text and Unicode paths remain exact without translation, trimming or normalization', () => {
  const input = sample({ sourcePath: 'documents/e\u0301 空間😀.json', propertyPath: '/人物/名字~1称呼',
    messageKey: '  A <script> is literal\n日本語😀  ', detail: '\ufeff详情\r\n  Original text\t<em>unchanged</em>' });
  const result = createSourceDiagnosticSnapshot(input);
  for (const key of ['sourcePath', 'propertyPath', 'messageKey', 'detail']) assert.equal(result[key], input[key]);
  assert.notEqual(result.sourcePath, result.sourcePath.normalize('NFC'));
});

test('nonexact states carry no range and permit unknown revisions and a root property', () => {
  for (const status of ['stale', 'approximate', 'unavailable']) {
    for (const severity of ['error', 'warning', 'info']) {
      const input = sample({ status, severity, sourceRevision: '', propertyPath: '' }); delete input.range;
      const result = createSourceDiagnosticSnapshot(input);
      assert.equal(result.status, status); assert.equal(result.severity, severity);
      assert.equal(result.sourceRevision, ''); assert.equal(result.propertyPath, '');
      assert.equal(Object.hasOwn(result, 'range'), false); assert.equal(result.detail, '');
    }
  }
});

test('missing, unknown and symbol fields are rejected at both levels', () => {
  for (const key of ['sourcePath', 'propertyPath', 'code', 'severity', 'messageKey', 'sourceRevision', 'status', 'range']) {
    const input = sample(); delete input[key]; assert.throws(() => createSourceDiagnosticSnapshot(input), invalid, key);
  }
  for (const key of ['sourceRange', 'toJSON', '__proto__', 'constructor', Symbol('extra')]) {
    const input = sample(); Object.defineProperty(input, key, { value: 'untrusted', enumerable: true });
    assert.throws(() => createSourceDiagnosticSnapshot(input), invalid);
  }
  for (const range of [{ start: 0 }, { end: 1 }, { start: 0, end: 1, encoding: 'utf-16' },
    { start: 0, end: 1, [Symbol('extra')]: true }]) {
    assert.throws(() => createSourceDiagnosticSnapshot(sample({ range })), invalid);
  }
});

test('accessors and nonenumerable fields cannot be read into snapshots', () => {
  let calls = 0;
  for (const [nested, key] of [[false, 'detail'], [false, 'sourcePath'], [true, 'start']]) {
    const input = sample(), target = nested ? input.range : input;
    Object.defineProperty(target, key, { get() { calls++; throw Error('getter must not run'); }, enumerable: true });
    assert.throws(() => createSourceDiagnosticSnapshot(input), invalid);
  }
  const hidden = sample(); Object.defineProperty(hidden, 'code', { value: 'hidden', enumerable: false });
  assert.throws(() => createSourceDiagnosticSnapshot(hidden), invalid);
  assert.equal(calls, 0);
});

test('primitive, array, class and inherited records never acquire display authority', () => {
  class Data { constructor() { Object.assign(this, sample()); } }
  for (const input of [undefined, null, true, 1, 'text', [], new Date(), new Data(), Object.create(sample())]) {
    assert.throws(() => createSourceDiagnosticSnapshot(input), invalid);
  }
  for (const range of [null, [], '0,1', Object.create({ start: 0, end: 1 })]) {
    assert.throws(() => createSourceDiagnosticSnapshot(sample({ range })), invalid);
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.throws(() => createSourceDiagnosticSnapshot(revoked.proxy), invalid);
});

test('plain records from another realm and null-prototype data remain portable', () => {
  const plain = sample();
  const foreign = vm.runInNewContext(`(${JSON.stringify(plain)})`);
  assert.deepEqual(createSourceDiagnosticSnapshot(foreign), { ...plain, detail: '' });
  const emptyPrototype = Object.assign(Object.create(null), plain);
  emptyPrototype.range = Object.assign(Object.create(null), plain.range);
  assert.deepEqual(createSourceDiagnosticSnapshot(emptyPrototype), { ...plain, detail: '' });
});

test('source paths require canonical relative segments without traversal or hidden normalization', () => {
  for (const sourcePath of ['', '/absolute.json', '//host/doc.json', 'a//b.json', './a.json', 'a/./b.json',
    '../a.json', 'a/../b.json', 'a/', 'a\\b.json', 'C:/docs/a.json', 'c:relative.json', 'a\0b.json', 'a\nb.json']) {
    assert.throws(() => createSourceDiagnosticSnapshot(sample({ sourcePath })), invalid, JSON.stringify(sourcePath));
  }
  for (const sourcePath of ['文書.json', 'documents/my file.json', '.legacy/document.json', 'documents/.../file.json']) {
    assert.equal(createSourceDiagnosticSnapshot(sample({ sourcePath })).sourcePath, sourcePath);
  }
});

test('scalar budgets accept boundaries and reject oversize values without coercion', () => {
  for (const [key, maximum, prefix] of [['sourcePath', 4096, ''], ['propertyPath', 2048, '/'],
    ['code', 160, ''], ['messageKey', 2000, ''], ['detail', 8192, '']]) {
    const value = prefix + '界'.repeat(maximum - prefix.length);
    assert.equal(createSourceDiagnosticSnapshot(sample({ [key]: value }))[key], value);
    assert.throws(() => createSourceDiagnosticSnapshot(sample({ [key]: value + 'x' })), invalid, key);
    for (const malformed of [null, 1, true, [], {}, new String('value')]) {
      assert.throws(() => createSourceDiagnosticSnapshot(sample({ [key]: malformed })), invalid, key);
    }
  }
  for (const key of ['code', 'messageKey']) assert.throws(() => createSourceDiagnosticSnapshot(sample({ [key]: '' })), invalid);
});

test('status, severity, revision and property coordinates remain explicitly typed', () => {
  for (const [key, values] of [['severity', ['', 'fatal', 'Error', null, 1]], ['status', ['', 'source', 'EXACT', null, 0]],
    ['sourceRevision', [null, undefined, 1, 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(63), 'sha1:' + 'a'.repeat(64)]],
    ['propertyPath', ['actors/0', null, 0]]]) {
    for (const value of values) assert.throws(() => createSourceDiagnosticSnapshot(sample({ [key]: value })), invalid, key);
  }
});

test('only exact snapshots can have ranges and a range cannot be silently dropped', () => {
  for (const status of ['stale', 'approximate', 'unavailable']) {
    for (const range of [undefined, null, { start: 0, end: 1 }]) {
      assert.throws(() => createSourceDiagnosticSnapshot(sample({ status, range })), invalid);
    }
  }
  for (const range of [undefined, null]) assert.throws(() => createSourceDiagnosticSnapshot(sample({ range })), invalid);
});

test('range budget allows a collapsed EOF and rejects noninteger, reversed and excessive offsets', () => {
  for (const range of [{ start: 0, end: 0 }, { start: maximumOffset, end: maximumOffset }, { start: 0, end: maximumOffset }]) {
    assert.deepEqual(createSourceDiagnosticSnapshot(sample({ range })).range, range);
  }
  for (const range of [{ start: -1, end: 1 }, { start: 2, end: 1 }, { start: 0, end: maximumOffset + 1 },
    { start: 0.5, end: 1 }, { start: 0, end: 1.5 }, { start: NaN, end: 1 }, { start: 0, end: Infinity },
    { start: '0', end: 1 }, { start: 0, end: null }, { start: 0n, end: 1 }, { start: 0, end: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => createSourceDiagnosticSnapshot(sample({ range })), invalid);
  }
});
