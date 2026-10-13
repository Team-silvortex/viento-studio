import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { findSourceMatches, planSourceReplacement } from '../../engine/source-search.mjs';

const maximumText = 4 * 1024 * 1024;
const invalid = error => error instanceof TypeError && error.errorCode === 'source_search_invalid';
const limit = error => error instanceof RangeError && error.errorCode === 'source_search_limit';
const find = (text, query, options = {}) => findSourceMatches({ text, query, ...options });
const request = (text, changes = {}) => ({ text, query: 'cat', replacement: 'dog', selectionStart: 0, selectionEnd: 0, ...changes });
const plan = (text, changes) => planSourceReplacement(request(text, changes));
const apply = (text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);

test('literal matches are nonoverlapping immutable ranges in the original source', () => {
  const input = Object.freeze({ text: 'cat catapult cat', query: 'cat' }), result = findSourceMatches(input);
  assert.deepEqual(result, [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 13, end: 16 }]);
  assert.ok(Object.isFrozen(result)); assert.ok(result.every(Object.isFrozen));
  assert.throws(() => result.push({ start: 1, end: 2 }), TypeError);
  assert.throws(() => { result[0].start = 3; }, TypeError);
  assert.deepEqual(input, { text: 'cat catapult cat', query: 'cat' });
  assert.deepEqual(find('aaaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(find('banana', 'ana'), [{ start: 1, end: 4 }]);
});

test('regular expression punctuation and newlines are ordinary literal search text', () => {
  const query = '.*+?^${}()|[]\\/-\nnext', text = `start ${query} finish ${query}`;
  assert.deepEqual(find(text, query), [{ start: 6, end: 6 + query.length }, { start: 14 + query.length, end: 14 + 2 * query.length }]);
  assert.deepEqual(find('axb a.b', 'a.b'), [{ start: 4, end: 7 }]);
  assert.deepEqual(find('a\u0000b\u0000', '\u0000'), [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
});

test('empty queries and absent text produce a frozen empty result without insertion matches', () => {
  for (const [text, query] of [['', ''], ['abc', ''], ['', 'a'], ['abc', 'longer'], ['abc', 'z']]) {
    const result = find(text, query); assert.deepEqual(result, []); assert.ok(Object.isFrozen(result));
  }
  const edit = plan('cat', { query: '', all: true, selectionStart: 1, selectionEnd: 2 });
  assert.deepEqual(edit, { changed: false, start: 1, end: 2, replacement: 'a', selectionStart: 1, selectionEnd: 2, count: 0 });
});

test('Unicode simple case folding retains offsets after expanding lowercase characters', () => {
  const text = 'İA a Kk ſS ßss 𐐀𐐨';
  assert.deepEqual(find(text, 'a'), [{ start: 3, end: 4 }]);
  assert.deepEqual(find(text, 'a', { matchCase: false }), [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(find(text, 'k', { matchCase: false }), [{ start: 5, end: 6 }, { start: 6, end: 7 }]);
  assert.deepEqual(find(text, 's', { matchCase: false }), [{ start: 8, end: 9 }, { start: 9, end: 10 }, { start: 12, end: 13 }, { start: 13, end: 14 }]);
  assert.deepEqual(find(text, 'ss', { matchCase: false }), [{ start: 8, end: 10 }, { start: 12, end: 14 }]);
  assert.deepEqual(find('ß', 'ss', { matchCase: false }), []);
  assert.deepEqual(find(text, '𐐨', { matchCase: false }), [{ start: 15, end: 17 }, { start: 17, end: 19 }]);
  assert.deepEqual(find('İi', 'i', { matchCase: false }), [{ start: 1, end: 2 }]);
});

test('UTF-16 offsets preserve emoji, combining sequences, BOM and author whitespace', () => {
  const text = '\ufeff😀e\u0301 中\n😀e\u0301 ';
  assert.deepEqual(find(text, '😀e\u0301'), [{ start: 1, end: 5 }, { start: 8, end: 12 }]);
  assert.deepEqual(find(text, 'é'), []);
  const edit = plan(text, { query: '😀e\u0301', replacement: '夢', all: true });
  assert.equal(apply(text, edit), '\ufeff夢 中\n夢 ');
  assert.deepEqual(edit, { changed: true, start: 1, end: 12, replacement: '夢 中\n夢', selectionStart: 6, selectionEnd: 6, count: 2 });
  assert.deepEqual(find(text, '\ufeff'), [{ start: 0, end: 1 }]);
});

test('matching never splits a surrogate pair but isolated surrogates remain author text', () => {
  const text = '\ud83d😀\ude00';
  assert.deepEqual(find(text, '\ud83d'), [{ start: 0, end: 1 }]);
  assert.deepEqual(find(text, '\ude00'), [{ start: 3, end: 4 }]);
  assert.deepEqual(find('😀', '\ud83d'), []); assert.deepEqual(find('😀', '\ude00'), []);
  const edit = plan(text, { query: '\ud83d', replacement: 'x', all: true });
  assert.equal(apply(text, edit), 'x😀\ude00');
  for (const selected of [{ selectionStart: 1, selectionEnd: 1 }, { selectionStart: 0, selectionEnd: 1 }, { selectionStart: 1, selectionEnd: 2 }]) {
    assert.throws(() => plan('😀', { query: '😀', ...selected }), invalid);
    assert.throws(() => plan('😀', { query: '😀', ...selected, all: true }), invalid);
  }
});

test('new surrogate pairs across replacement boundaries keep exact text and a caret after the pair', () => {
  const inserted = plan('cat\ude00tail', { replacement: '\ud83d', selectionEnd: 3 });
  assert.equal(apply('cat\ude00tail', inserted), '😀tail');
  assert.equal(inserted.start, 0); assert.equal(inserted.end, 3); assert.equal(inserted.replacement, '\ud83d');
  assert.equal(inserted.selectionStart, 2); assert.equal(inserted.selectionEnd, 2);
  const deleted = plan('\ud83dcat\ude00', { replacement: '', all: true });
  assert.equal(apply('\ud83dcat\ude00', deleted), '😀');
  assert.equal(deleted.start, 1); assert.equal(deleted.end, 4); assert.equal(deleted.replacement, '');
  assert.equal(deleted.selectionStart, 2); assert.equal(deleted.selectionEnd, 2);
});

test('single replacement requires exactly a current match and ignores overlapping candidates', () => {
  const text = 'cat cat', edit = plan(text, { selectionStart: 4, selectionEnd: 7 });
  assert.deepEqual(edit, { changed: true, start: 4, end: 7, replacement: 'dog', selectionStart: 7, selectionEnd: 7, count: 1 });
  assert.equal(apply(text, edit), 'cat dog'); assert.ok(Object.isFrozen(edit));
  assert.throws(() => { edit.replacement = 'unowned'; }, TypeError);
  for (const [selectionStart, selectionEnd] of [[0, 0], [0, 2], [0, 7], [1, 3], [3, 4]]) {
    const current = plan(text, { selectionStart, selectionEnd });
    assert.equal(current.changed, false); assert.equal(current.count, 0);
    assert.equal(apply(text, current), text); assert.equal(current.selectionStart, selectionStart); assert.equal(current.selectionEnd, selectionEnd);
  }
  assert.equal(plan('aaa', { query: 'aa', selectionStart: 1, selectionEnd: 3 }).changed, false);
});

test('replacement strings are literal and never expand dollar or capture references', () => {
  const text = 'cat middle cat', replacement = '$& $1 $$ $` $\' \\ 😀';
  const one = plan(text, { replacement, selectionStart: 0, selectionEnd: 3 });
  assert.equal(apply(text, one), `${replacement} middle cat`);
  const all = plan(text, { replacement, all: true });
  assert.equal(apply(text, all), `${replacement} middle ${replacement}`);
  assert.equal(all.selectionStart, all.replacement.length); assert.equal(all.selectionStart, all.selectionEnd);
});

test('multiline queries and replacement text preserve literal newlines and trailing whitespace', () => {
  const text = '\ufeffbefore\ncat\n  tail\ncat\n  tail\nafter\n';
  const query = 'cat\n  tail', replacement = 'one\n\n two\t ';
  const edit = plan(text, { query, replacement, all: true });
  assert.equal(apply(text, edit), '\ufeffbefore\none\n\n two\t \none\n\n two\t \nafter\n');
  assert.equal(edit.count, 2); assert.equal(edit.selectionStart, edit.start + edit.replacement.length);
});

test('replace all produces one minimal span preserving every intervening character and outer text', () => {
  const text = '\ufeffbefore cat\n😀 unmodified\tcat\nend', edit = plan(text, { replacement: 'kitten', all: true, selectionStart: text.length, selectionEnd: text.length });
  assert.equal(edit.start, text.indexOf('cat')); assert.equal(edit.end, text.lastIndexOf('cat') + 3);
  assert.equal(edit.replacement, 'kitten\n😀 unmodified\tkitten'); assert.equal(edit.count, 2);
  assert.equal(apply(text, edit), '\ufeffbefore kitten\n😀 unmodified\tkitten\nend');
  assert.equal(edit.selectionStart, edit.start + edit.replacement.length); assert.equal(edit.selectionEnd, edit.selectionStart);
  const removed = plan('start aaa end', { query: 'a', replacement: '', all: true });
  assert.equal(apply('start aaa end', removed), 'strt  end'); assert.equal(removed.count, 4);
});

test('case-insensitive replacement still changes author casing when requested', () => {
  const text = 'Cat cat CAT', edit = plan(text, { replacement: 'cat', matchCase: false, all: true });
  assert.equal(edit.changed, true); assert.equal(edit.count, 3); assert.equal(apply(text, edit), 'cat cat cat');
  assert.equal(plan(text, { selectionStart: 0, selectionEnd: 3 }).changed, false);
  assert.equal(apply(text, plan(text, { matchCase: false, selectionStart: 0, selectionEnd: 3 })), 'dog cat CAT');
});

test('textual no-ops retain current selection and report matched count without an edit', () => {
  const text = 'cat cat';
  const one = plan(text, { replacement: 'cat', selectionStart: 4, selectionEnd: 7 });
  assert.deepEqual(one, { changed: false, start: 4, end: 7, replacement: 'cat', selectionStart: 4, selectionEnd: 7, count: 1 });
  const all = plan(text, { replacement: 'cat', all: true, selectionStart: 1, selectionEnd: 5 });
  assert.deepEqual(all, { changed: false, start: 1, end: 5, replacement: 'at c', selectionStart: 1, selectionEnd: 5, count: 2 });
  const none = plan(text, { query: 'absent', all: true, selectionStart: 1, selectionEnd: 5 });
  assert.equal(none.changed, false); assert.equal(none.count, 0); assert.equal(apply(text, none), text);
});

test('frozen inputs are not mutated and independent calls retain no search cursor', () => {
  const input = Object.freeze(request('cat cat', { all: true })), before = structuredClone(input);
  assert.deepEqual(planSourceReplacement(input), planSourceReplacement(input)); assert.deepEqual(input, before);
  const expected = [{ start: 0, end: 3 }, { start: 4, end: 7 }];
  assert.deepEqual(find('cat cat', 'cat'), expected); find('other', 'cat'); assert.deepEqual(find('cat cat', 'cat'), expected);
});

test('invalid source, query, replacement and boolean fields are rejected without coercion', () => {
  for (const value of [undefined, null, 1, true, [], {}, new String('cat'), 'a\rb', 'a\r\nb']) {
    assert.throws(() => find(value, 'a'), invalid);
    assert.throws(() => find('abc', value), invalid);
    assert.throws(() => plan('abc', { replacement: value }), invalid);
  }
  for (const value of [undefined, null, 0, 1, 'false', {}]) {
    assert.throws(() => find('cat', 'cat', { matchCase: value }), invalid);
    assert.throws(() => plan('cat', { matchCase: value }), invalid);
    assert.throws(() => plan('cat', { all: value }), invalid);
  }
});

test('both replacement modes require safe ordered selection indices even when query is empty', () => {
  for (const changes of [{ selectionStart: -1 }, { selectionStart: 2, selectionEnd: 1 }, { selectionEnd: 4 },
    { selectionStart: 0.5 }, { selectionEnd: Infinity }, { selectionStart: NaN }, { selectionEnd: '2' },
    { selectionStart: Number.MAX_SAFE_INTEGER + 1 }, { selectionEnd: null }]) {
    for (const all of [false, true]) for (const query of ['cat', '']) assert.throws(() => plan('cat', { ...changes, all, query }), invalid);
  }
});

test('requests require exact own enumerable data fields without reading getters', () => {
  let calls = 0;
  for (const [fn, base] of [[findSourceMatches, { text: 'cat', query: 'cat', matchCase: false }],
    [planSourceReplacement, request('cat', { all: true, matchCase: false })]]) {
    for (const key of Object.keys(base)) {
      const input = { ...base }; Object.defineProperty(input, key, { enumerable: true, get() { calls++; return base[key]; } });
      assert.throws(() => fn(input), invalid);
      const hidden = { ...base }; Object.defineProperty(hidden, key, { enumerable: false }); assert.throws(() => fn(hidden), invalid);
    }
    for (const key of ['extra', 'toJSON', '__proto__', 'constructor', Symbol('extra')]) {
      const input = { ...base }; Object.defineProperty(input, key, { value: true, enumerable: true }); assert.throws(() => fn(input), invalid);
    }
  }
  assert.equal(calls, 0);
  for (const key of ['text', 'query']) { const input = { text: 'cat', query: 'cat' }; delete input[key]; assert.throws(() => findSourceMatches(input), invalid); }
  for (const key of ['text', 'query', 'replacement', 'selectionStart', 'selectionEnd']) {
    const input = request('cat'); delete input[key]; assert.throws(() => planSourceReplacement(input), invalid);
  }
});

test('nonrecords and inherited data are rejected while cross-realm and null-prototype records work', () => {
  class Request { constructor() { Object.assign(this, request('cat')); } }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const input of [undefined, null, false, 1, 'cat', [], new Date(), new Request(), Object.create(request('cat')), revoked.proxy]) {
    assert.throws(() => findSourceMatches(input), invalid); assert.throws(() => planSourceReplacement(input), invalid);
  }
  const plain = request('cat cat', { all: true });
  assert.deepEqual(planSourceReplacement(vm.runInNewContext(`(${JSON.stringify(plain)})`)), planSourceReplacement(plain));
  assert.deepEqual(planSourceReplacement(Object.assign(Object.create(null), plain)), planSourceReplacement(plain));
  assert.deepEqual(findSourceMatches(vm.runInNewContext('({ text: "cat", query: "cat" })')), [{ start: 0, end: 3 }]);
});

test('input limits count UTF-16 units and reject oversized text before an empty query can bypass them', () => {
  const text = '😀'.repeat(maximumText / 2);
  assert.deepEqual(find(text, ''), []);
  assert.equal(plan(text, { query: '', all: true, selectionStart: maximumText, selectionEnd: maximumText }).changed, false);
  for (const oversized of [text + 'x', 'x'.repeat(maximumText + 1)]) {
    assert.throws(() => find(oversized, ''), invalid); assert.throws(() => plan(oversized, { query: '' }), invalid);
  }
  const query = '😀'.repeat(2048);
  assert.deepEqual(find(query, query), [{ start: 0, end: 4096 }]);
  assert.throws(() => find(query, query + 'x'), invalid);
  const replacement = '😀'.repeat(32768), edit = plan('cat', { replacement, selectionEnd: 3 });
  assert.equal(apply('cat', edit), replacement);
  assert.throws(() => plan('cat', { replacement: replacement + 'x', selectionEnd: 3 }), invalid);
});

test('the match budget rejects complete operations beyond ten thousand matches without returning a prefix', () => {
  const text = 'a'.repeat(10000), result = find(text, 'a');
  assert.equal(result.length, 10000); assert.deepEqual(result.at(-1), { start: 9999, end: 10000 });
  const edit = plan(text, { query: 'a', replacement: 'b', all: true });
  assert.equal(edit.count, 10000); assert.equal(apply(text, edit), 'b'.repeat(10000));
  for (const matchCase of [true, false]) {
    assert.throws(() => find(text + 'a', 'a', { matchCase }), limit);
    assert.throws(() => plan(text + 'a', { query: 'a', matchCase, selectionEnd: 1 }), limit);
    assert.throws(() => plan(text + 'a', { query: 'a', matchCase, all: true }), limit);
  }
  assert.deepEqual(find('aa', 'a'), [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
});

test('replacement budgets include untouched text and allow exact-limit, shrinking and no-op results', () => {
  const text = 'cat' + 'z'.repeat(maximumText - 3);
  assert.throws(() => plan(text, { replacement: 'cats', selectionEnd: 3 }), limit);
  assert.throws(() => plan(text, { replacement: 'cats', all: true }), limit);
  const sameSize = plan(text, { selectionEnd: 3 }); assert.equal(apply(text, sameSize).length, maximumText);
  const shorter = plan(text, { replacement: '', selectionEnd: 3 }); assert.equal(apply(text, shorter).length, maximumText - 3);
  const noOp = plan(text, { replacement: 'cat', all: true }); assert.equal(noOp.changed, false); assert.equal(noOp.count, 1);
  assert.throws(() => plan('a'.repeat(100), { query: 'a', replacement: 'x'.repeat(65536), all: true }), limit);
});
