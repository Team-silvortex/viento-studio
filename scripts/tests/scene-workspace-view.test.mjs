import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { SCENE_WORKSPACE_MIN_SCALE as minScale, SCENE_WORKSPACE_MAX_SCALE as maxScale,
  fitSceneWorldView as fit, focusSceneWorkspaceView as focus, sceneWorldGrid as grid } from '../../engine/scene-workspace-view.mjs';

const actor = (x, y, width = 80, height = 40) => ({ position: [x, y], size: [width, height] });
const invalid = fn => assert.throws(fn, { errorCode: 'scene_workspace_view_invalid' });
const screen = (view, point) => [point[0] * view.scale + view.offsetX, point[1] * view.scale + view.offsetY];
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
function contains(view, [left, top, right, bottom], width, height, padding = 24) {
  const start = screen(view, [left, top]), end = screen(view, [right, bottom]);
  assert.ok(start[0] >= padding - 1e-8 && start[1] >= padding - 1e-8, JSON.stringify({ view, start, end }));
  assert.ok(end[0] <= width - padding + 1e-8 && end[1] <= height - padding + 1e-8, JSON.stringify({ view, start, end }));
}
function inspectGrid(result) {
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.bounds) && Object.isFrozen(result.xs) && Object.isFrozen(result.ys));
  assert.ok(Number.isFinite(result.step) && result.step >= 32);
  for (const [values, start, end] of [[result.xs, result.bounds.left, result.bounds.right], [result.ys, result.bounds.top, result.bounds.bottom]]) {
    assert.ok(values.length <= 256);
    assert.equal(new Set(values).size, values.length);
    values.forEach((value, index) => {
      assert.ok(Number.isFinite(value)); assert.ok(value >= start && value <= end);
      assert.ok(value % result.step === 0, 'grid coordinate is an exact step multiple (negative modulo may be -0)');
      assert.equal(Object.is(value, -0), false);
      if (index) assert.ok(value > values[index - 1]);
    });
  }
}

test('fit world includes negative and off-viewport actor geometry as well as the default viewport frame', () => {
  const actors = [actor(-1000, -800, 200, 100), actor(2000, 1500, 200, 100)];
  const view = fit([640, 480], actors, 800, 600);
  close(view.scale, 0.23); close(view.offsetX, 285); close(view.offsetY, 219.5);
  contains(view, [-1100, -850, 2100, 1550], 800, 600);
  contains(view, [0, 0, 640, 480], 800, 600);
  assert.deepEqual(Object.keys(view), ['scale', 'offsetX', 'offsetY']);
});

test('selection focus frames only supplied actor bounds, including negative positions, without expanding to the viewport', () => {
  const selected = [actor(-200, -150)], view = focus(selected, 640, 480);
  close(view.scale, 7.4);
  close(screen(view, [-200, -150])[0], 320); close(screen(view, [-200, -150])[1], 240);
  contains(view, [-240, -170, -160, -130], 640, 480);
  assert.ok(screen(view, [640, 480])[0] > 640, 'runtime viewport does not constrain focus');
  assert.equal(focus([], 640, 480), null);
});

test('empty world geometry retains the default viewport frame and small selections respect the maximum zoom', () => {
  const view = fit([640, 480], [], 800, 600);
  close(view.scale, 1.15); close(view.offsetX, 32); close(view.offsetY, 24);
  const tiny = focus([actor(100000, -100000, 1, 1)], 65536, 65536);
  assert.equal(tiny.scale, maxScale); assert.deepEqual(screen(tiny, [100000, -100000]), [32768, 32768]);
});

test('all legal extreme actor coordinates fit a narrow author workspace far below the former 2-percent zoom floor', () => {
  const actors = [actor(-100000, -100000, 2048, 2048), actor(100000, 100000, 2048, 2048)];
  for (const [width, height] of [[390, 844], [390.5, 844.25], [65536, 65536]]) {
    const view = fit([4096, 4096], actors, width, height);
    assert.ok(view.scale >= minScale && view.scale <= maxScale);
    contains(view, [-101024, -101024, 101024, 101024], width, height);
  }
  assert.ok(fit([4096, 4096], actors, 390, 844).scale < 0.02);
  const tinyCanvas = fit([4096, 4096], actors, 1, 1);
  close(screen(tinyCanvas, [0, 0])[0], 0.5); close(screen(tinyCanvas, [0, 0])[1], 0.5);
  contains(tinyCanvas, [-101024, -101024, 101024, 101024], 1, 1, 0);
});

test('view calculations neither mutate source geometry nor retain caller-owned containers', () => {
  const actors = [actor(-90, 120)], viewport = [640, 480], before = structuredClone({ actors, viewport });
  const world = fit(viewport, actors, 390.5, 844.25), focused = focus(actors, 390.5, 844.25);
  assert.ok(Object.isFrozen(world) && Object.isFrozen(focused));
  assert.deepEqual({ actors, viewport }, before);
  const repeated = fit(viewport, actors, 390.5, 844.25); assert.deepEqual(repeated, world); assert.notEqual(repeated, world);
  const stored = structuredClone(world); actors[0].position[0] = 10000; viewport[0] = 4096;
  assert.deepEqual(world, stored);
});

test('world and selection geometry admit only finite bounded explicit data and at most 128 actors', () => {
  const many = Array.from({ length: 128 }, (_, index) => actor(index * 10, -index * 10, 1, 2048));
  assert.ok(Number.isFinite(fit([640, 480], many, 640, 480).scale));
  invalid(() => fit([640, 480], [...many, actor(0, 0)], 640, 480));
  for (const position of [[100000.01, 0], [-100000.01, 0], [0, Infinity], [NaN, 0], ['0', 0], [0], [0, 0, 0]]) {
    invalid(() => focus([{ position, size: [10, 10] }], 640, 480));
  }
  for (const size of [[0.99, 10], [2048.01, 10], [NaN, 10], [10, Infinity]]) {
    invalid(() => fit([640, 480], [{ position: [0, 0], size }], 640, 480));
  }
  invalid(() => fit([640, 480], [{ ...actor(0, 0), sourcePath: 'author.json' }], 640, 480));
  for (const viewport of [[63, 480], [4097, 480], [640.5, 480], [640, NaN]]) invalid(() => fit(viewport, [], 640, 480));
  for (const value of [0, 0.5, -1, 65536.5, Infinity, NaN, '390']) {
    invalid(() => fit([640, 480], [], value, 480)); invalid(() => focus([], 640, value));
  }
});

test('workspace data capture refuses getters, hidden fields, sparse arrays, symbols and foreign prototypes without executing code', () => {
  let invoked = 0;
  const getter = { enumerable: true, get() { invoked++; return [0, 0]; } };
  for (const change of [
    values => { Object.defineProperty(values[0], 'position', getter); },
    values => { Object.defineProperty(values[0].position, '0', getter); },
    values => { Object.defineProperty(values, '0', getter); },
    values => { delete values[0]; },
    values => { delete values[0].position[0]; },
    values => { Object.defineProperty(values[0], 'size', { enumerable: false, value: [80, 40] }); },
    values => { values[0][Symbol('other')] = true; },
    values => { values.toJSON = () => []; },
    values => { Object.setPrototypeOf(values[0], { position: [0, 0] }); },
    values => { Object.setPrototypeOf(values, null); },
  ]) { const values = [actor(0, 0)]; change(values); invalid(() => fit([640, 480], values, 640, 480)); }
  const view = { scale: 1, offsetX: 0, offsetY: 0 }; Object.defineProperty(view, 'scale', { enumerable: true, get() { invoked++; return 1; } });
  invalid(() => grid(view, 640, 480)); assert.equal(invoked, 0);
  assert.ok(focus([Object.assign(Object.create(null), actor(0, 0))], 640, 480));
});

test('visible-world grid covers negative coordinates and anchors exact zero without clipping to a runtime viewport', () => {
  const result = grid({ scale: 1, offsetX: 100.5, offsetY: 50.25 }, 640.5, 480.75);
  assert.deepEqual(result.bounds, { left: -100.5, top: -50.25, right: 540, bottom: 430.5 });
  assert.equal(result.step, 32); assert.equal(result.xs[0], -96); assert.equal(result.xs.at(-1), 512);
  assert.equal(result.ys[0], -32); assert.equal(result.ys.at(-1), 416); assert.ok(result.xs.includes(0) && result.ys.includes(0));
  inspectGrid(result);
});

test('grid coarsens as zoom decreases but never becomes finer than the independent 32-unit snap base', () => {
  for (const [scale, expected] of [[0.25, 128], [0.5, 64], [0.75, 64], [1, 32], [2, 32], [16, 32]]) {
    const result = grid({ scale, offsetX: 0, offsetY: 0 }, 390, 844);
    assert.equal(result.step, expected); inspectGrid(result);
  }
  const none = grid({ scale: 1, offsetX: -1, offsetY: -1 }, 1, 1);
  assert.deepEqual(none.xs, []); assert.deepEqual(none.ys, []);
});

test('grid maintains a bounded budget at minimum zoom, maximum pixel sizes and far negative or positive pans', () => {
  for (const scale of [minScale, 0.001, 0.02, 1, maxScale]) for (const [width, height] of [[1, 1], [390.5, 844.25], [65536, 65536]]) {
    for (const offset of [0, -100000, 100000, -1e12, 1e12]) {
      const result = grid({ scale, offsetX: offset, offsetY: -offset }, width, height);
      inspectGrid(result);
    }
  }
  inspectGrid(grid({ scale: maxScale, offsetX: 1e20, offsetY: -1e20 }, 65536, 65536));
});

test('invalid, overflowing or precision-collapsed grid transforms are rejected rather than producing unbounded or invented lines', () => {
  for (const change of [view => { view.scale = minScale / 2; }, view => { view.scale = maxScale + 1; },
    view => { view.scale = 0; }, view => { view.offsetX = Infinity; }, view => { view.offsetY = NaN; },
    view => { view.extra = 1; }, view => { view.offsetX = Number.MAX_VALUE; view.scale = minScale; },
    view => { view.offsetX = 1e100; }]) {
    const view = { scale: 1, offsetX: 0, offsetY: 0 }; change(view); invalid(() => grid(view, 390, 844));
  }
  for (const value of [0, NaN, Infinity, 65537]) invalid(() => grid({ scale: 1, offsetX: 0, offsetY: 0 }, value, 844));
});

test('same source runs in a browser-style realm without Node imports or prototype coercion', async () => {
  const source = (await fs.readFile(new URL('../../engine/scene-workspace-view.mjs', import.meta.url), 'utf8')).replaceAll('export ', '');
  const context = vm.createContext({});
  const result = vm.runInContext(`${source}
({ view: fitSceneWorldView([640,480], [{position:[-200,-100],size:[40,20]}],390.5,844.25),
    focused: focusSceneWorkspaceView([{position:[-200,-100],size:[40,20]}],390.5,844.25),
    grid: sceneWorldGrid({scale:0.001,offsetX:100,offsetY:-50},390.5,844.25) })`, context);
  assert.ok(Object.isFrozen(result.view) && Object.isFrozen(result.focused) && Object.isFrozen(result.grid.xs));
  assert.equal(result.grid.xs.length <= 256, true);
  const actual = JSON.parse(JSON.stringify(result.view));
  assert.deepEqual(actual, fit([640, 480], [actor(-200, -100, 40, 20)], 390.5, 844.25));
});
