import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLineIndex } from '../../engine/source-position.mjs';

const maximumLength = 4 * 1024 * 1024;
const invalid = error => error?.errorCode === 'source_position_invalid';

test('empty source has one empty logical line and a valid end caret', () => {
  const index = createSourceLineIndex('');
  assert.equal(index.length, 0); assert.equal(index.lineCount, 1);
  assert.deepEqual(index.position(0), { line: 1, column: 1 });
  assert.deepEqual(index.lineRange(1), { start: 0, end: 0 });
});

test('logical lines distinguish a newline caret from the next line start', () => {
  const index = createSourceLineIndex('alpha\nbeta');
  assert.equal(index.length, 10); assert.equal(index.lineCount, 2);
  assert.deepEqual(index.position(0), { line: 1, column: 1 });
  assert.deepEqual(index.position(5), { line: 1, column: 6 });
  assert.deepEqual(index.position(6), { line: 2, column: 1 });
  assert.deepEqual(index.position(10), { line: 2, column: 5 });
  assert.deepEqual(index.lineRange(1), { start: 0, end: 5 });
  assert.deepEqual(index.lineRange(2), { start: 6, end: 10 });
});

test('consecutive and trailing LFs retain empty lines and exclude LF from ranges', () => {
  const text = '\none\n\n', index = createSourceLineIndex(text);
  assert.equal(index.lineCount, 4);
  assert.deepEqual([1, 2, 3, 4].map(line => index.lineRange(line)), [
    { start: 0, end: 0 }, { start: 1, end: 4 }, { start: 5, end: 5 }, { start: 6, end: 6 },
  ]);
  assert.deepEqual(index.position(5), { line: 3, column: 1 });
  assert.deepEqual(index.position(text.length), { line: 4, column: 1 });
});

test('columns use UTF-16 units including surrogate and combining-mark boundaries', () => {
  const index = createSourceLineIndex('😀e\u0301夢\n𠮷');
  for (const offset of [0, 1, 2, 3, 4, 5]) {
    assert.deepEqual(index.position(offset), { line: 1, column: offset + 1 });
  }
  assert.deepEqual(index.lineRange(1), { start: 0, end: 5 });
  assert.deepEqual(index.lineRange(2), { start: 6, end: 8 });
  assert.deepEqual(index.position(7), { line: 2, column: 2 });
  assert.deepEqual(index.position(8), { line: 2, column: 3 });
});

test('tabs and long visually wrapped text remain ordinary logical columns', () => {
  const text = '\t  ' + 'word '.repeat(1024), index = createSourceLineIndex(text);
  assert.equal(index.lineCount, 1);
  assert.deepEqual(index.position(1), { line: 1, column: 2 });
  assert.deepEqual(index.position(3), { line: 1, column: 4 });
  assert.deepEqual(index.position(text.length), { line: 1, column: text.length + 1 });
  assert.deepEqual(index.lineRange(1), { start: 0, end: text.length });
});

test('only the initial BOM is skipped for a first-line range and logical column', () => {
  const index = createSourceLineIndex('\ufeffalpha\n\ufeffbeta');
  assert.deepEqual(index.position(0), { line: 1, column: 1 });
  assert.deepEqual(index.position(1), { line: 1, column: 1 });
  assert.deepEqual(index.position(6), { line: 1, column: 6 });
  assert.deepEqual(index.position(7), { line: 2, column: 1 });
  assert.deepEqual(index.position(8), { line: 2, column: 2 });
  assert.deepEqual(index.lineRange(1), { start: 1, end: 6 });
  assert.deepEqual(index.lineRange(2), { start: 7, end: 12 });
});

test('BOM-only and BOM-before-LF documents retain valid empty content ranges', () => {
  const bom = createSourceLineIndex('\ufeff');
  assert.equal(bom.length, 1); assert.equal(bom.lineCount, 1);
  assert.deepEqual(bom.lineRange(1), { start: 1, end: 1 });
  assert.deepEqual(bom.position(1), { line: 1, column: 1 });
  const newline = createSourceLineIndex('\ufeff\n');
  assert.deepEqual(newline.lineRange(1), { start: 1, end: 1 });
  assert.deepEqual(newline.lineRange(2), { start: 2, end: 2 });
  assert.deepEqual(newline.position(1), { line: 1, column: 1 });
  assert.deepEqual(newline.position(2), { line: 2, column: 1 });
});

test('Unicode line separator characters stay in the source logical line', () => {
  const text = 'a\u2028b\u2029c\u0085d', index = createSourceLineIndex(text);
  assert.equal(index.lineCount, 1);
  assert.deepEqual(index.position(text.length), { line: 1, column: 8 });
  assert.deepEqual(index.lineRange(1), { start: 0, end: 7 });
});

test('non-string input is rejected without invoking coercion', () => {
  let coerced = false;
  const input = { toString() { coerced = true; return 'text'; } };
  for (const value of [undefined, null, 0, true, [], {}, new String('text'), input, Symbol('x')]) {
    assert.throws(() => createSourceLineIndex(value), invalid);
  }
  assert.equal(coerced, false);
});

test('CR and CRLF must be normalized by the caller instead of silently rewritten', () => {
  for (const text of ['\r', 'a\r\nb', 'a\rb', 'last\r', '\ufeff\r\n']) {
    assert.throws(() => createSourceLineIndex(text), invalid);
  }
});

test('invalid caret offsets are rejected without coercion or clamping', () => {
  const index = createSourceLineIndex('abc\n');
  for (const offset of [-1, 5, 0.5, NaN, Infinity, -Infinity, '0', null, undefined, {}, 0n]) {
    assert.throws(() => index.position(offset), invalid);
  }
  assert.deepEqual(index.position(4), { line: 2, column: 1 });
});

test('line numbers are one-based integers and invalid ranges are rejected', () => {
  const index = createSourceLineIndex('one\ntwo');
  for (const line of [0, -1, 3, 1.5, NaN, Infinity, '1', null, undefined, {}, 1n]) {
    assert.throws(() => index.lineRange(line), invalid);
  }
  assert.deepEqual(index.lineRange(2), { start: 4, end: 7 });
});

test('the API and returned values are immutable and reveal no mutable index', () => {
  const index = createSourceLineIndex('one\ntwo');
  assert.deepEqual(Reflect.ownKeys(index).sort(), ['length', 'lineCount', 'lineRange', 'position'].sort());
  assert.equal(Object.isFrozen(index), true);
  assert.throws(() => { index.lineCount = 20; }, TypeError);
  const position = index.position(4), range = index.lineRange(2);
  assert.equal(Object.isFrozen(position), true); assert.equal(Object.isFrozen(range), true);
  assert.throws(() => { position.column = 99; }, TypeError);
  assert.throws(() => { range.start = 0; }, TypeError);
  const { position: locate, lineRange: rangeOf } = index;
  assert.deepEqual(locate.call(null, 4), { line: 2, column: 1 });
  assert.deepEqual(rangeOf.call({}, 2), { start: 4, end: 7 });
});

test('independent indexes and repeated out-of-order queries retain their own cached lines', () => {
  const a = createSourceLineIndex('a\n'.repeat(8192)), b = createSourceLineIndex('different');
  for (const line of [8193, 1, 4096, 8192, 2, 4097, 1, 8193]) {
    const start = (line - 1) * 2;
    assert.deepEqual(a.position(start), { line, column: 1 });
    assert.deepEqual(a.lineRange(line), { start, end: line === 8193 ? start : start + 1 });
    assert.deepEqual(b.position(9), { line: 1, column: 10 });
    assert.equal(b.lineCount, 1);
  }
});

test('the maximum UTF-16 length is accepted and larger source is rejected', () => {
  const text = '😀'.repeat(maximumLength / 2), index = createSourceLineIndex(text);
  assert.equal(index.length, maximumLength); assert.equal(index.lineCount, 1);
  assert.deepEqual(index.position(maximumLength), { line: 1, column: maximumLength + 1 });
  assert.deepEqual(index.lineRange(1), { start: 0, end: maximumLength });
  assert.throws(() => createSourceLineIndex(text + 'x'), invalid);
});

test('maximum-density LF source has bounded storage and a reachable final empty line', () => {
  const index = createSourceLineIndex('\n'.repeat(maximumLength));
  assert.equal(index.length, maximumLength); assert.equal(index.lineCount, maximumLength + 1);
  for (const offset of [0, 1, 1048576, maximumLength - 1, maximumLength]) {
    assert.deepEqual(index.position(offset), { line: offset + 1, column: 1 });
    assert.deepEqual(index.lineRange(offset + 1), { start: offset, end: offset });
  }
});
