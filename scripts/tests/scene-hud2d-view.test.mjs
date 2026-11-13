import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { resolveSceneHUD2DView as view, formatSceneHUD2DNumber as number } from '../../engine/scene-hud2d-view.mjs';
import { projectSharedStateKey, projectSharedStateScalar } from '../../engine/project-shared-state.mjs';
import { hudLabel, hudBar, hudDocument as document } from './helpers/scene-hud2d-fixture.mjs';
const run = (state = [], elements = [hudLabel(), hudBar()], viewport = [800, 480]) => view({ document: document(elements), viewport, state });
const invalid = fn => assert.throws(fn, { errorCode: 'scene_hud2d_view_invalid' });
test('HUD anchors place rectangle pivots in screen space and respond only to viewport dimensions', () => {
  const anchors = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  for (const [index, anchor] of anchors.entries()) {
    const rect = run([], [{ ...hudLabel(), anchor, offset: [10, -20], size: [200, 40] }], [800.5, 480.25]).elements[0].rect;
    assert.deepEqual(rect, { x: index % 3 / 2 * 600.5 + 10, y: Math.floor(index / 3) / 2 * 440.25 - 20, width: 200, height: 40 });
  }
  assert.deepEqual(run().elements[1].rect, { x: 588, y: 16, width: 200, height: 20 });
});
test('state label distinguishes missing, zero, false and empty string without mutating samples', () => {
  for (const [state, expected] of [[[], 'Score: —'], [[{ key: 'score', value: 0 }], 'Score: 0'], [[{ key: 'score', value: false }], 'Score: false'], [[{ key: 'score', value: true }], 'Score: true'], [[{ key: 'score', value: '' }], 'Score: ']]) {
    const before = structuredClone(state), result = run(state); assert.equal(result.elements[0].text, expected); assert.deepEqual(state, before);
  }
});
test('number presentation quantizes ties away from zero, trims decimal zeros and never uses exponents or locale', () => {
  for (const [value, text] of [[-0, '0'], [.00049, '0'], [-.00049, '0'], [.0005, '0.001'], [-.0005, '-0.001'], [1.2345, '1.235'], [-1.2345, '-1.235'], [12.3, '12.3'], [999999999.9996, '1000000000'], [1e9, '1000000000'], [-1e9, '-1000000000']]) assert.equal(number(value), text);
  for (const value of [NaN, Infinity, 1e9 + 1, '2', null]) invalid(() => number(value));
});
test('legal state control characters display replacements and Unicode truncation counts whole codepoints', () => {
  const state = [{ key: 'score', value: '\0\u0007\u007f\t\r\n中文' }], before = structuredClone(state);
  assert.equal(run(state).elements[0].text, 'Score: \ufffd\ufffd\ufffd\t\r\n中文'); assert.deepEqual(state, before);
  const content = { kind: 'state', key: 'score', prefix: '😀'.repeat(64), suffix: '終'.repeat(64), missing: '' };
  const result = run([{ key: 'score', value: '界'.repeat(200) }], [{ ...hudLabel(), content }]).elements[0].text;
  assert.equal([...result].length, 257); assert.equal(result, '😀'.repeat(64) + '界'.repeat(192) + '…');
});
test('bar uses fallback only for missing/non-number values and clamps display ratio without rewriting values', () => {
  for (const [state, value, ratio] of [[[], 50, .5], [[{ key: 'health', value: false }], 50, .5], [[{ key: 'health', value: '20' }], 50, .5], [[{ key: 'health', value: 0 }], 0, 0], [[{ key: 'health', value: -20 }], -20, 0], [[{ key: 'health', value: 150 }], 150, 1]]) {
    const before = structuredClone(state), bar = run(state).elements[1]; assert.equal(bar.value, value); assert.equal(bar.ratio, ratio); assert.deepEqual(state, before);
  }
});
test('view results fully detach and freeze state-derived text, viewport and geometry', () => {
  const raw = { document: document(), viewport: [800, 480], state: [{ key: 'score', value: 'hello' }] }, result = view(raw);
  raw.viewport[0] = 100; raw.document.elements[0].offset[0] = 99; raw.state[0].value = 'changed';
  assert.equal(result.elements[0].text, 'Score: hello'); assert.equal(result.elements[0].rect.x, 12); assert.equal(result.viewport[0], 800);
  for (const value of [result, result.viewport, result.elements, result.elements[0], result.elements[0].rect]) assert.ok(Object.isFrozen(value));
});
test('sample state is bounded scalar data with strict own descriptors and never executes getters', () => {
  for (const state of [[{ key: 'score', value: 'x'.repeat(1000000) }], [{ key: 'score', value: null }], [{ key: 'score', value: {} }], [{ key: 'score', value: Infinity }], [{ key: 'score', value: '\ud800' }], [{ key: 'score', value: '😀'.repeat(1025) }], [{ key: '__proto__', value: 1 }], [{ key: 'score', value: 1 }, { key: 'score', value: 2 }], Array.from({ length: 65 }, (_, n) => ({ key: 'key' + n, value: n }))]) invalid(() => run(state));
  let calls = 0; const state = [{ key: 'score', value: 0 }]; Object.defineProperty(state[0], 'value', { enumerable: true, get() { calls++; return 9; } }); invalid(() => run(state)); assert.equal(calls, 0);
  for (const viewport of [[0, 1], [65537, 1], [NaN, 400], [800], [800, 480, 1]]) invalid(() => run([], [], viewport));
});
test('the same HUD layout/value source executes in a browser realm with no DOM, Node or host', async () => {
  const [domain, model] = await Promise.all(['scene-hud2d.mjs', 'scene-hud2d-view.mjs'].map(name => fs.readFile(new URL('../../engine/' + name, import.meta.url), 'utf8')));
  const context = vm.createContext({ projectSharedStateKey, projectSharedStateScalar });
  vm.runInContext('(function(){' + domain.replace(/^import .*\n/gmu, '').replaceAll('export ', '') + ';globalThis.domain={validateSceneHUD2DDocument,SCENE_HUD2D_ANCHORS};})();', context);
  vm.runInContext('(function(){const {validateSceneHUD2DDocument,SCENE_HUD2D_ANCHORS}=domain;' + model.replace(/^import .*\n/gmu, '').replaceAll('export ', '') + ';globalThis.view=resolveSceneHUD2DView;})();', context);
  const raw = { document: document(), viewport: [390.5, 844.25], state: [{ key: 'score', value: -1.2345 }, { key: 'health', value: 150 }] };
  const actual = JSON.parse(vm.runInContext('JSON.stringify(view(' + JSON.stringify(raw) + '))', context)); assert.deepEqual(actual, view(raw));
});
