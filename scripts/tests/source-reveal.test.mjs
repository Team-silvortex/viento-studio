import test from 'node:test';
import assert from 'node:assert/strict';
import { revealSourceOffset } from '../../web/modules/app-source-reveal.js';

function fixture(text = '第一行\nlong_unbroken_word_ending_here\n😀tail\n') {
  let value = text, removed = 0, creates = 0, fail = '', duringMeasure = () => {};
  const mirrors = [], ranges = [], computed = { fontFamily: 'monospace', fontSize: '15px', fontWeight: '400', fontStyle: 'normal',
    fontStretch: 'normal', fontVariant: 'normal', fontFeatureSettings: 'normal', fontVariationSettings: 'normal',
    lineHeight: '28.5px', letterSpacing: '0.4px', wordSpacing: '1px', textIndent: '0px', textTransform: 'none',
    textRendering: 'auto', direction: 'ltr', tabSize: '4', whiteSpace: 'pre-wrap', wordBreak: 'normal',
    overflowWrap: 'break-word', paddingTop: '24px', paddingRight: '30px', paddingBottom: '24px', paddingLeft: '30px' };
  let row = { top: 800, left: 640, height: 24 };
  const document = {
    defaultView: { getComputedStyle: () => computed },
    createElement(tag) {
      creates++; assert.equal(tag, 'div');
      const element = { style: {}, attributes: {}, text: '', firstChild: null,
        setAttribute(name, content) { this.attributes[name] = content; },
        set textContent(content) { this.text = content; this.firstChild = { data: content }; },
        set innerHTML(_) { throw Error('must never parse source as markup'); },
        getBoundingClientRect() { if (fail === 'mirror') throw Error('no layout'); return { top: 100, left: 20 }; },
        remove() { removed++; const index = mirrors.indexOf(this); if (index >= 0) mirrors.splice(index, 1); } };
      return element;
    },
    body: { append(element) { mirrors.push(element); if (fail === 'append') throw Error('append failed'); } },
    createRange() {
      if (fail === 'range') throw Error('range failed');
      const range = { start: null, end: null,
        setStart(node, offset) { this.start = { node, offset }; },
        setEnd(node, offset) { this.end = { node, offset }; },
        getBoundingClientRect() { duringMeasure(); if (fail === 'measure') throw Error('measurement failed'); return row; } };
      ranges.push(range); return range;
    },
  };
  const textarea = { ownerDocument: document, clientWidth: 320, clientHeight: 200, wrap: 'soft', readOnly: false,
    selectionStart: 2, selectionEnd: 7, selectionDirection: 'backward', scrollTop: 17, scrollLeft: 9,
    get value() { return value; }, set value(_) { throw Error('navigation cannot rewrite source'); },
    focus() { throw Error('measurement cannot change focus'); }, setSelectionRange() { throw Error('measurement cannot change selection'); },
    dispatchEvent() { throw Error('measurement cannot dispatch input'); } };
  return { textarea, document, computed, mirrors, ranges, text, removed: () => removed, creates: () => creates,
    setValue: content => { value = content; }, setRow: next => { row = next; }, fail: step => { fail = step; },
    duringMeasure: callback => { duringMeasure = callback; } };
}

test('viewport reveal measures full text at a midword offset with the exact textarea width and wrapping styles', () => {
  const h = fixture(), offset = h.text.indexOf('unbroken') + 4; let mirror;
  h.duringMeasure(() => { mirror = h.mirrors[0]; });
  assert.equal(revealSourceOffset(h.textarea, h.text, offset), true);
  assert.equal(mirror.text, h.text + '\u200b', 'the word suffix must stay present to preserve real wrap');
  assert.deepEqual(h.ranges[0].start, { node: mirror.firstChild, offset });
  assert.deepEqual(h.ranges[0].end, { node: mirror.firstChild, offset: offset + 1 });
  for (const [key, expected] of Object.entries(h.computed)) assert.equal(mirror.style[key], expected, key);
  assert.equal(mirror.style.width, '320px'); assert.equal(mirror.style.boxSizing, 'border-box');
  assert.equal(mirror.style.visibility, 'hidden'); assert.equal(mirror.attributes['aria-hidden'], 'true');
  assert.equal(h.textarea.scrollTop, 612); assert.equal(h.textarea.scrollLeft, 0);
  assert.equal(h.removed(), 1); assert.equal(h.mirrors.length, 0);
});

test('EOF including an empty final logical line measures the appended marker and emoji measures a whole code point', () => {
  for (const text of ['', 'one', 'one\n', '\ufeff\n']) {
    const h = fixture(text);
    assert.equal(revealSourceOffset(h.textarea, text, text.length), true);
    assert.equal(h.ranges[0].start.offset, text.length); assert.equal(h.ranges[0].end.offset, text.length + 1);
    assert.equal(h.removed(), 1);
  }
  const h = fixture(), emoji = h.text.indexOf('😀');
  assert.equal(revealSourceOffset(h.textarea, h.text, emoji), true);
  assert.equal(h.ranges[0].start.offset, emoji); assert.equal(h.ranges[0].end.offset, emoji + 2);
});

test('unwrapped source reveals horizontal position while preserving the source and native selection', () => {
  const h = fixture(); h.textarea.wrap = 'off'; h.textarea.readOnly = true; let whiteSpace;
  h.duringMeasure(() => { whiteSpace = h.mirrors[0].style.whiteSpace; });
  assert.equal(revealSourceOffset(h.textarea, h.text, 6), true);
  assert.equal(whiteSpace, 'pre'); assert.equal(h.textarea.scrollLeft, 460); assert.equal(h.textarea.scrollTop, 612);
  assert.equal(h.textarea.value, h.text);
  assert.deepEqual([h.textarea.selectionStart, h.textarea.selectionEnd, h.textarea.selectionDirection], [2, 7, 'backward']);
});

test('invalid stale or unsupported inputs return without constructing a mirror or moving the viewport', () => {
  for (const change of ['stale', 'negative', 'decimal', 'past-end', 'string-offset', 'non-text', 'oversize', 'zero-width', 'zero-height', 'no-range', 'no-style']) {
    const h = fixture(); let text = h.text, offset = 0;
    if (change === 'stale') h.setValue('different source');
    if (change === 'negative') offset = -1;
    if (change === 'decimal') offset = 0.5;
    if (change === 'past-end') offset = text.length + 1;
    if (change === 'string-offset') offset = '0';
    if (change === 'non-text') text = {};
    if (change === 'oversize') { text = 'x'.repeat(4 * 1024 * 1024 + 1); h.setValue(text); }
    if (change === 'zero-width') h.textarea.clientWidth = 0;
    if (change === 'zero-height') h.textarea.clientHeight = 0;
    if (change === 'no-range') delete h.document.createRange;
    if (change === 'no-style') delete h.document.defaultView.getComputedStyle;
    assert.equal(revealSourceOffset(h.textarea, text, offset), false, change);
    assert.equal(h.creates(), 0); assert.equal(h.textarea.scrollTop, 17); assert.equal(h.textarea.scrollLeft, 9);
  }
  assert.equal(revealSourceOffset(null, '', 0), false);
});

test('a source replacement during measurement never applies the previous document scroll', () => {
  const h = fixture(); h.duringMeasure(() => h.setValue('new source'));
  assert.equal(revealSourceOffset(h.textarea, h.text, 0), false);
  assert.equal(h.textarea.value, 'new source'); assert.equal(h.textarea.scrollTop, 17); assert.equal(h.textarea.scrollLeft, 9);
  assert.equal(h.removed(), 1); assert.equal(h.mirrors.length, 0);
});

test('invalid geometry keeps the existing viewport and always disposes its mirror', () => {
  for (const row of [{ top: NaN, left: 0, height: 24 }, { top: 20, left: Infinity, height: 24 },
    { top: 20, left: 0, height: NaN }, { top: 20, left: 0, height: 0 }, { top: 20, left: 0, height: -1 }]) {
    const h = fixture(); h.setRow(row);
    assert.equal(revealSourceOffset(h.textarea, h.text, 0), false);
    assert.equal(h.textarea.scrollTop, 17); assert.equal(h.textarea.scrollLeft, 9); assert.equal(h.removed(), 1);
  }
});

test('DOM append range and measurement failures remove temporary content without changing editor state', () => {
  for (const phase of ['append', 'range', 'measure', 'mirror']) {
    const h = fixture(); h.fail(phase);
    assert.equal(revealSourceOffset(h.textarea, h.text, 1), false, phase);
    assert.equal(h.mirrors.length, 0); assert.equal(h.removed(), 1); assert.equal(h.textarea.value, h.text);
    assert.equal(h.textarea.scrollTop, 17); assert.equal(h.textarea.scrollLeft, 9);
    assert.deepEqual([h.textarea.selectionStart, h.textarea.selectionEnd, h.textarea.selectionDirection], [2, 7, 'backward']);
  }
});
