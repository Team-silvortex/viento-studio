import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { parseJsonSource, locateJsonSource, JSON_SOURCE_LIMITS } from '../../engine/json-source.mjs';

const parse = content => {
  const result = parseJsonSource(content);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.diagnostics, []);
  return result;
};
const token = (source, parsed, pointer, options) => {
  const range = locateJsonSource(parsed, pointer, options);
  assert.ok(range, pointer);
  assert.equal(range.encoding, 'utf-16');
  return source.slice(range.start, range.end);
};

test('JSON source accepts object, array and primitive roots without rebuilding semantic values', () => {
  for (const source of ['null', 'false', 'true', '0', '-0', '1.6e2', '1e1000', '900719925474099312345', '"文字😀"', '[]', '{}', '[null,false,1,"x",{}]']) {
    const parsed = parse(source);
    assert.deepEqual(parsed.value, JSON.parse(source));
    assert.equal(token(source, parsed, ''), source);
    assert.equal(locateJsonSource(parsed, '').exact, true);
  }
  const parsed = parse('[null,false,{"imageResourceId":null}]');
  assert.equal(token('[null,false,{"imageResourceId":null}]', parsed, '/2/imageResourceId'), 'null');
  assert.equal(locateJsonSource(parse('null'), '/missing', { nearest: true }), null);
});

test('ranges are original UTF-16 offsets including BOM and CRLF around Chinese, emoji and escapes', () => {
  const source = '\uFEFF\r\n{\r\n  "标题": "😀前\\u6587",\r\n  "na\\u006de": "尾\\n行",\r\n  "值": [10, null]\r\n}\r\n';
  const parsed = parse(source);
  assert.deepEqual(parsed.value, { 标题: '😀前文', name: '尾\n行', 值: [10, null] });
  for (const [pointer, expected] of [['/标题', '"😀前\\u6587"'], ['/name', '"尾\\n行"'], ['/值', '[10, null]'], ['/值/0', '10'], ['/值/1', 'null']]) {
    const range = locateJsonSource(parsed, pointer);
    assert.deepEqual(range, { start: source.indexOf(expected), end: source.indexOf(expected) + expected.length,
      encoding: 'utf-16', propertyPath: pointer, exact: true });
    assert.equal(source.slice(range.start, range.end), expected);
  }
  const root = locateJsonSource(parsed, '');
  assert.equal(root.start, source.indexOf('{'));
  assert.equal(root.end, source.lastIndexOf('}') + 1);
});

test('JSON pointers handle empty and escaped keys without prototype pollution or array coercion', () => {
  const source = '{"":{"a/b":{"~key":null}},"a~1b":7,"__proto__":{"polluted":true},"constructor":{"prototype":{"x":3}},"list":[10,20]}';
  const parsed = parse(source);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.getPrototypeOf(parsed.value), Object.prototype);
  assert.equal(Object.hasOwn(parsed.value, '__proto__'), true);
  for (const [pointer, expected] of [['//a~1b/~0key', 'null'], ['/a~01b', '7'], ['/__proto__/polluted', 'true'], ['/constructor/prototype/x', '3'], ['/list/1', '20']]) {
    assert.equal(token(source, parsed, pointer), expected);
  }
  for (const pointer of ['/list/01', '/list/-1', '/list/-', '/list/2', '/toString', '/__proto__/missing', 'list', '/a~2b', '/a~']) {
    assert.equal(locateJsonSource(parsed, pointer), null, pointer);
  }
  assert.equal(token(source, parsed, '/'), '{"a/b":{"~key":null}}');
});

test('nearest fallback uses an existing container and reports its actual pointer', () => {
  const source = '{"actors":[{"position":[1,2],"imageResourceId":null}],"":{}}';
  const parsed = parse(source);
  for (const [requested, actual, expected] of [
    ['/actors/0/speed', '/actors/0', '{"position":[1,2],"imageResourceId":null}'],
    ['/actors/0/imageResourceId/child', '/actors/0', '{"position":[1,2],"imageResourceId":null}'],
    ['/actors/8/position', '/actors', '[{"position":[1,2],"imageResourceId":null}]'],
    ['/missing/path', '', source], ['//child', '/', '{}'],
  ]) {
    assert.equal(locateJsonSource(parsed, requested), null);
    const range = locateJsonSource(parsed, requested, { nearest: true });
    assert.equal(range.propertyPath, actual); assert.equal(range.exact, false);
    assert.equal(source.slice(range.start, range.end), expected);
  }
  assert.equal(locateJsonSource(parsed, '/actors/0/imageResourceId', { nearest: true }).exact, true);
  assert.equal(locateJsonSource(parsed, '/~wrong', { nearest: true }), null);
});

test('duplicate decoded keys are rejected at every depth and compatibility mode never invents a range', () => {
  for (const [source, path, expected] of [
    ['{"title":1,"ti\\u0074le":2}', '/title', { title: 2 }],
    ['{"nested":{"a/b":1,"a\\/b":2}}', '/nested/a~1b', { nested: { 'a/b': 2 } }],
    ['[{"~":1,"\\u007e":2}]', '/0/~0', [{ '~': 2 }]],
    ['{"":null,"":false}', '/', { '': false }],
    ['{"__proto__":1,"__proto__":2}', '/__proto__', JSON.parse('{"__proto__":2}')],
  ]) {
    const rejected = parseJsonSource(source);
    assert.equal(rejected.ok, false); assert.equal(rejected.ambiguous, true);
    assert.equal(rejected.diagnostics[0].code, 'json_source_duplicate_key');
    assert.equal(rejected.diagnostics[0].propertyPath, path);
    assert.ok(rejected.diagnostics[0].message);
    const accepted = parseJsonSource(source, { allowDuplicateKeys: true });
    assert.equal(accepted.ok, true); assert.equal(accepted.ambiguous, true);
    assert.deepEqual(accepted.value, expected);
    for (const parsed of [rejected, accepted]) for (const pointer of ['', path, '/missing']) {
      assert.equal(locateJsonSource(parsed, pointer), null);
      assert.equal(locateJsonSource(parsed, pointer, { nearest: true }), null);
    }
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('numeric spellings and explicit null image suppression remain exact original tokens', () => {
  const source = '{"speed":1.600e+2,"negative":-0,"precise":900719925474099312345,"imageResourceId":null,"omitted":{}}';
  const parsed = parse(source);
  assert.equal(parsed.value.speed, 160); assert.equal(Object.is(parsed.value.negative, -0), true);
  assert.equal(parsed.value.precise, JSON.parse('900719925474099312345'));
  assert.equal(parsed.value.imageResourceId, null);
  for (const [pointer, raw] of [['/speed', '1.600e+2'], ['/negative', '-0'], ['/precise', '900719925474099312345'], ['/imageResourceId', 'null']]) {
    assert.equal(token(source, parsed, pointer), raw);
  }
  assert.equal(locateJsonSource(parsed, '/omitted/imageResourceId'), null);
});

test('only complete strict JSON passes syntax validation despite YAML accepting more forms', () => {
  for (const source of ['', '   ', '\uFEFF\uFEFF{}', '{x: 1}', '{"x":1,}', '{"x":1} trailing', '[1,]', 'true false', '01', 'NaN', 'Infinity', '.inf', 'null\0', '"line\nfeed"', '{"x": /* comment */ 1}', '---\n{"x":1}']) {
    const result = parseJsonSource(source);
    assert.equal(result.ok, false, JSON.stringify(source));
    assert.equal(result.diagnostics[0].code, 'json_source_syntax', JSON.stringify(source));
    assert.equal(locateJsonSource(result, '', { nearest: true }), null);
  }
  for (const source of [null, undefined, {}, [], 42, true]) {
    assert.equal(parseJsonSource(source).diagnostics[0].code, 'json_source_invalid');
  }
});

test('character, depth and node limits include overwritten duplicate values before CST parsing', () => {
  const characters = JSON_SOURCE_LIMITS.characters;
  const atLimit = '"' + 'x'.repeat(characters - 2) + '"';
  assert.equal(parseJsonSource(atLimit).ok, true);
  assert.equal(parseJsonSource('\uFEFF' + atLimit).diagnostics[0].code, 'json_source_limit');
  const nested = depth => '['.repeat(depth) + 'null' + ']'.repeat(depth);
  assert.equal(parseJsonSource(nested(JSON_SOURCE_LIMITS.depth)).ok, true);
  assert.equal(parseJsonSource(nested(JSON_SOURCE_LIMITS.depth + 1)).diagnostics[0].code, 'json_source_limit');
  assert.equal(parseJsonSource('{"discarded":' + nested(JSON_SOURCE_LIMITS.depth + 1) + ',"discarded":0}', { allowDuplicateKeys: true }).diagnostics[0].code, 'json_source_limit');
  const allowed = '[' + '0,'.repeat(JSON_SOURCE_LIMITS.nodes - 2) + '0]';
  assert.equal(parseJsonSource(allowed).ok, true);
  const over = '[' + '0,'.repeat(JSON_SOURCE_LIMITS.nodes - 1) + '0]';
  assert.equal(parseJsonSource(over).diagnostics[0].code, 'json_source_limit');
  const duplicates = '{' + '"a":0,'.repeat(JSON_SOURCE_LIMITS.nodes - 1) + '"a":0}';
  assert.equal(parseJsonSource(duplicates, { allowDuplicateKeys: true }).diagnostics[0].code, 'json_source_limit');
});

async function isolated(overrides = {}) {
  const source = await fs.readFile(new URL('../../engine/json-source.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfrom\s+['"]node:/);
  return vm.runInNewContext(source.replace(/^import .*\n/m, '').replaceAll('export ', '') + '\n({parseJsonSource,locateJsonSource})', {
    parseDocument, isMap, isSeq, isScalar, ...overrides,
  });
}

test('source indexing works without Node or DOM globals and catches CST failures', async () => {
  const portable = await isolated();
  const result = portable.parseJsonSource('\uFEFF{"值":null}');
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(portable.locateJsonSource(result, '/值'))),
    { start: 6, end: 10, encoding: 'utf-16', propertyPath: '/值', exact: true });
  for (const parseDocument of [() => { throw new Error('Parser failure'); }, () => ({ errors: [{ code: 'BROKEN' }] }), () => ({ errors: [], contents: { range: [99,100] } })]) {
    const broken = await isolated({ parseDocument });
    const parsed = broken.parseJsonSource('{"a":1}');
    assert.equal(parsed.ok, false); assert.equal(parsed.diagnostics[0].code, 'json_source_index_invalid');
    assert.equal(broken.locateJsonSource(parsed, ''), null);
  }
});

test('returned spans are detached and foreign or serialized results cannot supply a forged index', () => {
  const source = '{"a":1}', parsed = parse(source), range = locateJsonSource(parsed, '/a');
  range.start = 0; range.end = 1;
  assert.equal(token(source, parsed, '/a'), '1');
  assert.equal(locateJsonSource(JSON.parse(JSON.stringify(parsed)), '/a'), null);
  assert.equal(locateJsonSource({ ok: true, value: { a: 1 }, ambiguous: false }, '/a'), null);
});
