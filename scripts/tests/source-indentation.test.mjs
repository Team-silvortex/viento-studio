import test from 'node:test';
import assert from 'node:assert/strict';
import { planSourceIndentation, detectSourceIndentation } from '../../engine/source-indentation.mjs';

const request = (text, changes = {}) => ({ text, selectionStart: 0, selectionEnd: 0,
  selectionDirection: 'none', action: 'indent', indent: 'spaces-4', ...changes });
const plan = (text, changes) => planSourceIndentation(request(text, changes));
const apply = (text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
const invalid = error => error?.errorCode === 'source_indentation_invalid';

test('a caret indents the complete current line with an immutable local replacement', () => {
  const text = 'before\nhello world\nafter', edit = plan(text, { selectionStart: 9, selectionEnd: 9 });
  assert.deepEqual(edit, { start: 7, end: 18, replacement: '    hello world', selectionStart: 13,
    selectionEnd: 13, selectionDirection: 'none', changed: true });
  assert.equal(apply(text, edit), 'before\n    hello world\nafter');
  assert.equal(Object.isFrozen(edit), true);
  assert.throws(() => { edit.replacement = 'changed'; }, TypeError);
});

test('each indentation mode inserts exactly its own unit and moves a line-start caret', () => {
  for (const [indent, prefix] of [['tab', '\t'], ['spaces-2', '  '], ['spaces-4', '    ']]) {
    const edit = plan('value', { indent });
    assert.equal(apply('value', edit), `${prefix}value`);
    assert.equal(edit.selectionStart, prefix.length); assert.equal(edit.selectionEnd, prefix.length);
  }
});

test('a selection ending at the next line start leaves that next line untouched', () => {
  const text = 'one\ntwo\nthree', edit = plan(text, { selectionStart: 0, selectionEnd: 8, indent: 'tab' });
  assert.equal(edit.start, 0); assert.equal(edit.end, 7);
  assert.equal(edit.replacement, '\tone\n\ttwo');
  assert.equal(apply(text, edit), '\tone\n\ttwo\nthree');
  assert.equal(edit.selectionStart, 1); assert.equal(edit.selectionEnd, 10);
  const collapsed = plan(text, { selectionStart: 8, selectionEnd: 8, indent: 'tab' });
  assert.equal(apply(text, collapsed), 'one\ntwo\n\tthree');
});

test('partial multiline selections retain their content boundaries and backward direction', () => {
  const text = 'alpha\nbeta\ngamma', selected = { selectionStart: 2, selectionEnd: 8, selectionDirection: 'backward', indent: 'spaces-2' };
  const edit = plan(text, selected), result = apply(text, edit);
  assert.equal(result, '  alpha\n  beta\ngamma');
  assert.equal(edit.selectionStart, 4); assert.equal(edit.selectionEnd, 12);
  assert.equal(result.slice(edit.selectionStart, edit.selectionEnd), 'pha\n  be');
  assert.equal(edit.selectionDirection, 'backward');
});

test('outdent removes one leading tab or at most the selected width of ASCII spaces', () => {
  const text = '\talpha\n  beta\n      gamma\n \tdelta\nlast';
  for (const [indent, expected] of [['tab', 'alpha\nbeta\n  gamma\n\tdelta\nlast'],
    ['spaces-4', 'alpha\nbeta\n  gamma\n\tdelta\nlast'], ['spaces-2', 'alpha\nbeta\n    gamma\n\tdelta\nlast']]) {
    const edit = plan(text, { action: 'outdent', indent, selectionEnd: text.length });
    assert.equal(apply(text, edit), expected); assert.equal(edit.selectionEnd, expected.length);
  }
});

test('outdent clamps positions inside the removed prefix while retaining later positions', () => {
  for (const [position, expected] of [[0, 0], [1, 0], [3, 0], [4, 0], [5, 1]]) {
    const edit = plan('    value', { action: 'outdent', selectionStart: position, selectionEnd: position });
    assert.equal(edit.selectionStart, expected); assert.equal(edit.selectionEnd, expected);
  }
  const edit = plan('    value', { action: 'outdent', selectionStart: 1, selectionEnd: 7, selectionDirection: 'forward' });
  assert.equal(edit.selectionStart, 0); assert.equal(edit.selectionEnd, 3); assert.equal(edit.selectionDirection, 'forward');
});

test('UTF-16 offsets preserve emoji combining marks and all content outside ASCII indentation', () => {
  const text = '😀 前\n\t夢e\u0301😀\n\u00a0 kept\n\u3000kept\n\u2003kept', start = text.indexOf('夢'), end = text.indexOf('\n', start);
  const edit = plan(text, { selectionStart: start, selectionEnd: end, action: 'outdent' });
  const result = apply(text, edit);
  assert.equal(result, '😀 前\n夢e\u0301😀\n\u00a0 kept\n\u3000kept\n\u2003kept');
  assert.equal(result.slice(edit.selectionStart, edit.selectionEnd), '夢e\u0301😀');
  const all = plan(result, { selectionEnd: result.length, action: 'outdent' });
  assert.equal(all.changed, false); assert.equal(apply(result, all), result);
});

test('only an initial BOM is outside indentation and its original index remains zero', () => {
  const text = '\ufeffalpha\n\ufeffbeta', edit = plan(text, { selectionStart: 1, selectionEnd: text.length, indent: 'tab' });
  assert.equal(apply(text, edit), '\ufeff\talpha\n\t\ufeffbeta');
  assert.equal(edit.selectionStart, 2); assert.equal(edit.selectionEnd, text.length + 2);
  const reverse = plan(apply(text, edit), { action: 'outdent', selectionStart: edit.selectionStart, selectionEnd: edit.selectionEnd });
  assert.equal(apply(apply(text, edit), reverse), text); assert.equal(reverse.selectionStart, 1);
  const beforeBom = plan('\ufeffalpha');
  assert.equal(beforeBom.selectionStart, 0); assert.equal(apply('\ufeffalpha', beforeBom), '\ufeff    alpha');
  assert.equal(apply('\ufeff', plan('\ufeff', { selectionStart: 1, selectionEnd: 1 })), '\ufeff    ');
});

test('empty text blank lines trailing newlines and selected newline characters have distinct ranges', () => {
  const empty = plan(''); assert.equal(apply('', empty), '    '); assert.equal(empty.selectionStart, 4);
  const text = 'a\n\nb\n';
  assert.equal(apply(text, plan(text, { selectionStart: text.length, selectionEnd: text.length, indent: 'tab' })), 'a\n\nb\n\t');
  const whole = plan(text, { selectionEnd: text.length, indent: 'tab' });
  assert.equal(apply(text, whole), '\ta\n\t\n\tb\n');
  assert.equal(whole.end, text.length - 1); assert.equal(whole.selectionEnd, text.length + 3);
  const newline = plan('a\nb', { selectionStart: 1, selectionEnd: 2, indent: 'tab' });
  assert.equal(apply('a\nb', newline), '\ta\nb');
  assert.equal(apply('a\nb', newline).slice(newline.selectionStart, newline.selectionEnd), '\n');
});

test('a no-op outdent retains both selection endpoints direction and untouched text', () => {
  for (const text of ['', 'plain', 'alpha\nbeta\n', '\ufeffplain']) {
    const edit = plan(text, { action: 'outdent', selectionEnd: text.length, selectionDirection: 'backward' });
    assert.equal(edit.changed, false); assert.equal(apply(text, edit), text);
    assert.equal(edit.selectionStart, 0); assert.equal(edit.selectionEnd, text.length); assert.equal(edit.selectionDirection, 'backward');
  }
});

test('indent followed by outdent restores exact text and selections across all units', () => {
  const texts = ['alpha\n  beta\n\tgamma', '\ufeff😀\n\t世界\n', '\n\nend'];
  for (const text of texts) for (const indent of ['tab', 'spaces-2', 'spaces-4']) {
    const first = plan(text, { indent, selectionStart: Math.min(1, text.length), selectionEnd: text.length, selectionDirection: 'backward' });
    const changed = apply(text, first), second = plan(changed, { action: 'outdent', indent,
      selectionStart: first.selectionStart, selectionEnd: first.selectionEnd, selectionDirection: first.selectionDirection });
    assert.equal(apply(changed, second), text); assert.equal(second.selectionStart, Math.min(1, text.length));
    assert.equal(second.selectionEnd, text.length); assert.equal(second.selectionDirection, 'backward');
  }
});

test('detection uses the first nonblank ASCII-indented line and does not infer from later lines', () => {
  assert.equal(detectSourceIndentation('plain\n\tvalue\n  later'), 'tab');
  assert.equal(detectSourceIndentation('plain\n  value\n\tlater'), 'spaces-2');
  assert.equal(detectSourceIndentation('plain\n    value\n\tlater'), 'spaces-4');
  assert.equal(detectSourceIndentation('\ufeff\tvalue'), 'tab');
  assert.equal(detectSourceIndentation(' \t\n\t\n  \u00a0\n\n    value'), 'spaces-4');
});

test('detection chooses two spaces for positive even widths not divisible by four', () => {
  for (const count of [2, 6, 10]) assert.equal(detectSourceIndentation(' '.repeat(count) + 'value'), 'spaces-2');
  for (const count of [1, 3, 4, 5, 8]) assert.equal(detectSourceIndentation(' '.repeat(count) + 'value'), 'spaces-4');
  assert.equal(detectSourceIndentation('  \tvalue'), 'spaces-2');
  assert.equal(detectSourceIndentation('\t  value'), 'tab');
  for (const text of ['', '\n', 'plain\nnext', '  \n\t\n', '\u00a0value', '\u3000value']) assert.equal(detectSourceIndentation(text), 'spaces-4');
});

test('invalid indices directions operations and modes are rejected without coercion', () => {
  for (const change of [{ selectionStart: -1 }, { selectionStart: 2, selectionEnd: 1 }, { selectionEnd: 4 },
    { selectionStart: 0.1 }, { selectionStart: NaN }, { selectionEnd: Infinity }, { selectionEnd: '2' },
    { selectionStart: Number.MAX_SAFE_INTEGER + 1 }, { selectionDirection: '' }, { selectionDirection: null },
    { action: 'format' }, { indent: 'spaces-8' }, { indent: 'constructor' }, { indent: '__proto__' },
    { indent: { toString() { throw Error('do not coerce'); } } }]) assert.throws(() => plan('abc', change), invalid);
});

test('requests require exact own enumerable data fields without invoking getters', () => {
  for (const input of [null, [], 'text', { ...request('a'), extra: true }, { ...request('a'), [Symbol('extra')]: true },
    Object.create(request('a')), Object.assign(Object.create({ inherited: true }), request('a'))]) {
    assert.throws(() => planSourceIndentation(input), invalid);
  }
  for (const key of Object.keys(request('a'))) {
    const missing = request('a'); delete missing[key]; assert.throws(() => planSourceIndentation(missing), invalid);
    const accessor = request('a'); Object.defineProperty(accessor, key, { enumerable: true, get() { throw Error('do not read'); } });
    assert.throws(() => planSourceIndentation(accessor), invalid);
    const hidden = request('a'); Object.defineProperty(hidden, key, { enumerable: false });
    assert.throws(() => planSourceIndentation(hidden), invalid);
  }
  assert.equal(planSourceIndentation(Object.assign(Object.create(null), request('a'))).replacement, '    a');
});

test('the planner does not mutate frozen input and detection rejects nontext or raw carriage returns', () => {
  const input = Object.freeze(request('😀value', { selectionStart: 2, selectionEnd: 4 })), before = structuredClone(input);
  planSourceIndentation(input); assert.deepEqual(input, before);
  for (const text of [null, 1, {}, ['value'], new String('value'), 'a\rb', 'a\r\nb']) {
    assert.throws(() => plan(text), invalid); assert.throws(() => detectSourceIndentation(text), invalid);
  }
});

test('the input limit is four Mi UTF-16 units, including surrogate pairs, and checked before planning', () => {
  const maximum = 4 * 1024 * 1024, text = '😀'.repeat(maximum / 2);
  const edit = plan(text, { selectionStart: maximum, selectionEnd: maximum, action: 'outdent', indent: 'tab' });
  assert.equal(edit.replacement.length, maximum); assert.equal(edit.selectionStart, maximum); assert.equal(edit.changed, false);
  assert.equal(detectSourceIndentation(text), 'spaces-4');
  for (const oversized of [text + 'x', 'x'.repeat(maximum + 1)]) {
    assert.throws(() => plan(oversized), invalid); assert.throws(() => detectSourceIndentation(oversized), invalid);
  }
});

test('resulting whole-text length is bounded while documents at the limit can still outdent', () => {
  const maximum = 4 * 1024 * 1024, text = 'x\n' + 'y'.repeat(maximum - 2);
  const input = Object.freeze(request(text, { indent: 'tab' }));
  // This replacement would contain just two characters, but the untouched
  // remainder makes the resulting document exceed the processing limit.
  assert.throws(() => planSourceIndentation(input), invalid); assert.equal(input.text, text);
  const short = '\n'.repeat(maximum / 2);
  assert.throws(() => plan(short, { selectionEnd: short.length, indent: 'spaces-2' }), invalid);
  const atLimit = '\t' + 'x'.repeat(maximum - 1), reduced = plan(atLimit, { action: 'outdent', indent: 'tab',
    selectionStart: maximum, selectionEnd: maximum });
  assert.equal(apply(atLimit, reduced), atLimit.slice(1)); assert.equal(reduced.selectionEnd, maximum - 1);
  const restored = plan(apply(atLimit, reduced), { indent: 'tab', selectionStart: maximum - 1, selectionEnd: maximum - 1 });
  assert.equal(apply(apply(atLimit, reduced), restored), atLimit); assert.equal(restored.selectionEnd, maximum);
});

test('many short selected lines preserve the final empty line and map boundaries without per-line records', () => {
  const text = 'x\n'.repeat(100000), edit = plan(text, { selectionEnd: text.length, indent: 'spaces-2' });
  assert.equal(apply(text, edit), '  x\n'.repeat(100000)); assert.equal(edit.selectionStart, 2);
  assert.equal(edit.selectionEnd, text.length + 200000);
  const outdent = plan(apply(text, edit), { action: 'outdent', indent: 'spaces-2',
    selectionStart: edit.selectionStart, selectionEnd: edit.selectionEnd });
  assert.equal(apply(apply(text, edit), outdent), text);
});
