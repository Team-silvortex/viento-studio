import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { resolveSceneCamera2DFrame as resolve, fitSceneCamera2DFrame as fit, moveSceneCamera2DFrame as move } from '../../engine/scene-camera2d-frame.mjs';
import { SCENE_WORKSPACE_MIN_SCALE, SCENE_WORKSPACE_MAX_SCALE } from '../../engine/scene-workspace-view.mjs';
const id = n => `97979797-9797-4979-8979-${String(n).padStart(12, '0')}`;
const actor = (n = 1, position = [400, 240], size = [40, 60]) => ({ instanceId: id(n), position, size });
const fixed = (center = [400, 240], zoom = 1) => ({ mode: 'fixed', center, zoom });
const follow = (targetInstanceId = id(2), offset = [-24, 16], zoom = 2) => ({ mode: 'follow', targetInstanceId, offset, zoom });
const input = (camera = fixed(), actors = [actor()], viewport = [800, 480]) => ({ camera, actors, viewport });
const invalid = fn => assert.throws(fn, { errorCode: 'scene_camera2d_frame_invalid' });
const point = (view, x, y) => [view.offsetX + x * view.scale, view.offsetY + y * view.scale];
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function contains(view, rectangle, width, height, padding = 24) {
  const [left, top] = point(view, rectangle.left, rectangle.top), [right, bottom] = point(view, rectangle.right, rectangle.bottom);
  assert.ok(left >= padding - 1e-8 && top >= padding - 1e-8, JSON.stringify({ view, left, top }));
  assert.ok(right <= width - padding + 1e-8 && bottom <= height - padding + 1e-8, JSON.stringify({ view, right, bottom }));
}

test('fixed framing uses explicit viewport divided by zoom without consulting actor extent or moving actors', () => {
  const value = input(fixed([-100, 900], 2), [actor(1, [10000, -10000])]), before = structuredClone(value);
  const frame = resolve(value);
  assert.deepEqual(frame, { mode: 'fixed', center: [-100, 900], size: [400, 240], bounds: { left: -300, top: 780, right: 100, bottom: 1020 } });
  assert.deepEqual(value, before); assert.equal(Object.hasOwn(frame, 'targetInstanceId'), false);
  assert.equal(Object.hasOwn(frame, 'targetPosition'), false); assert.deepEqual(resolve(input(fixed(), [])), resolve(input(fixed(), [actor()])));
});
test('follow framing selects a stable instance and adds world offset to its logical root only', () => {
  const actors = [actor(1, [200, 220]), actor(2, [1500, 900])], frame = resolve(input(follow(), actors));
  assert.deepEqual(frame, { mode: 'follow', targetInstanceId: id(2), center: [1476, 916], size: [400, 240],
    bounds: { left: 1276, top: 796, right: 1676, bottom: 1036 }, targetPosition: [1500, 900] });
  actors[0].position = [10000, 10000]; assert.deepEqual(resolve(input(follow(), actors)), frame);
  actors[1].size = [2048, 1]; assert.deepEqual(resolve(input(follow(), actors)), frame, 'camera targets the logical position, not actor bounds');
});
test('legal coordinate and zoom extremes produce finite full frames even outside author position limits', () => {
  const frames = [resolve(input(fixed([-100000, 100000], 8), [], [64, 64])),
    resolve(input(follow(id(1), [100000, -100000], 0.125), [actor(1, [100000, -100000])], [4096, 4096]))];
  assert.deepEqual(frames[0].size, [8, 8]); assert.deepEqual(frames[1].center, [200000, -200000]);
  assert.deepEqual(frames[1].size, [32768, 32768]); assert.deepEqual(frames[1].bounds, { left: 183616, top: -216384, right: 216384, bottom: -183616 });
  assert.ok(Object.values(frames[1].bounds).every(Number.isFinite));
});
test('frame results are detached and deeply frozen without retaining mutable source vectors', () => {
  const value = input(follow(), [actor(2)]), frame = resolve(value);
  assert.ok([frame, frame.center, frame.size, frame.bounds, frame.targetPosition].every(Object.isFrozen));
  value.camera.offset[0] = 800; value.actors[0].position[0] = 10; value.viewport[0] = 1024;
  assert.deepEqual(frame.center, [376, 256]); assert.deepEqual(frame.targetPosition, [400, 240]); assert.deepEqual(frame.size, [400, 240]);
});
test('camera unions, zoom and viewport sizes are explicit bounded inputs', () => {
  for (const camera of [fixed([100001, 0]), fixed([0, -100001]), fixed([0, NaN]), fixed([0]), fixed([0, 0], 0), fixed([0, 0], 0.1249), fixed([0, 0], 8.01),
    { ...fixed(), mode: 'none' }, { ...fixed(), offset: [0, 0] }, { ...follow(), center: [0, 0] }, { ...follow(), targetInstanceId: 'not-an-instance' },
    { ...fixed(), zoom: '1' }, { ...fixed(), zoom: Infinity }]) invalid(() => resolve(input(camera)));
  for (const viewport of [[63, 480], [800, 4097], [800.5, 480], [800], [800, 480, 1], [NaN, 480]]) invalid(() => resolve(input(fixed(), [], viewport)));
  invalid(() => resolve({ ...input(), source: 'undeclared authority' }));
});
test('geometry budgets and unique instance membership are independent of selected framing mode', () => {
  assert.doesNotThrow(() => resolve(input(fixed(), Array.from({ length: 128 }, (_, index) => actor(index + 1)))));
  for (const actors of [Array.from({ length: 129 }, (_, index) => actor(index + 1)), [actor(), actor()],
    [actor(1, [100001, 0])], [actor(1, [0, 0], [0, 20])], [actor(1, [0, 0], [2049, 20])], [{ ...actor(), objectId: id(8) }]]) invalid(() => resolve(input(fixed(), actors)));
  invalid(() => resolve(input(follow(), [actor(1)]))); invalid(() => resolve(input(follow(), [])));
});
test('strict capture rejects accessors, hidden/symbol properties, custom prototypes and sparse or named arrays without invoking code', () => {
  let calls = 0;
  const getter = input(); Object.defineProperty(getter.camera, 'zoom', { enumerable: true, get() { calls++; return 1; } });
  const actorGetter = input(); Object.defineProperty(actorGetter.actors[0], 'position', { enumerable: true, get() { calls++; return [0, 0]; } });
  const hidden = input(); Object.defineProperty(hidden.camera, 'center', { value: [0, 0], enumerable: false });
  const symbol = input(); symbol.actors[0][Symbol('extra')] = 1;
  const sparse = input(); sparse.viewport = [800, ,];
  const named = input(); named.actors.extra = 1;
  const serializer = input(); serializer.camera.toJSON = () => { calls++; return fixed(); };
  const prototype = input(); prototype.camera = Object.assign(Object.create({ mode: 'fixed' }), fixed());
  for (const value of [getter, actorGetter, hidden, symbol, sparse, named, serializer, prototype]) invalid(() => resolve(value));
  assert.equal(calls, 0);
});
test('camera-only fitting centers and contains the complete frame while all-fitting also includes actor rectangles', () => {
  const actors = [actor(1, [-2000, -1200], [200, 100]), actor(2, [3000, 2000], [100, 200])], frame = resolve(input(fixed([400, 240], 2), actors));
  const cameraView = fit(frame, actors, 800, 600, { scope: 'camera' });
  contains(cameraView, frame.bounds, 800, 600); close(point(cameraView, ...frame.center)[0], 400); close(point(cameraView, ...frame.center)[1], 300);
  assert.ok(point(cameraView, -2100, -1250)[0] < 0);
  const allView = fit(frame, actors, 800, 600, { scope: 'all' });
  contains(allView, { left: -2100, top: -1250, right: 3050, bottom: 2100 }, 800, 600);
  contains(allView, frame.bounds, 800, 600); assert.ok(allView.scale < cameraView.scale); assert.ok(Object.isFrozen(allView));
});
test('fitting supports fractional/narrow pixels and all legal world extremes with shared workspace scale bounds', () => {
  const actors = [actor(1, [-100000, -100000], [2048, 2048]), actor(2, [100000, 100000])], frame = resolve(input(follow(id(2), [100000, 100000], 0.125), actors, [4096, 4096]));
  for (const [width, height] of [[390, 844], [390.5, 844.25], [1, 1], [65536, 65536]]) {
    const view = fit(frame, actors, width, height, { scope: 'all' });
    assert.ok(view.scale >= SCENE_WORKSPACE_MIN_SCALE && view.scale <= SCENE_WORKSPACE_MAX_SCALE);
    contains(view, { left: -101024, top: -101024, right: 216384, bottom: 216384 }, width, height, width === 1 ? 0 : 24);
  }
  assert.ok(fit(frame, actors, 390, 844, { scope: 'all' }).scale < 0.02);
  const tiny = resolve(input(fixed([100000, -100000], 8), [], [64, 64]));
  assert.equal(fit(tiny, [], 65536, 65536, { scope: 'camera' }).scale, SCENE_WORKSPACE_MAX_SCALE);
});
test('fit rejects malformed/stale frames, unknown scopes, dimensions and accessor options', () => {
  const actors = [actor(2)], original = resolve(input(follow(), actors));
  for (const change of [value => { value.bounds.left++; }, value => { value.size = [0, 100]; }, value => { value.mode = 'other'; },
    value => { value.targetInstanceId = id(9); }, value => { value.targetPosition = [0, 0]; }, value => { value.extra = true; }]) {
    const frame = structuredClone(original); change(frame); invalid(() => fit(frame, actors, 640, 480, { scope: 'camera' }));
  }
  for (const [width, height] of [[0, 480], [640, NaN], [Infinity, 480], [65537, 480]]) invalid(() => fit(original, actors, width, height, { scope: 'all' }));
  for (const options of [{}, { scope: 'world' }, { scope: 'camera', extra: true }]) invalid(() => fit(original, actors, 640, 480, options));
  let calls = 0; const options = {}; Object.defineProperty(options, 'scope', { enumerable: true, get() { calls++; return 'camera'; } });
  invalid(() => fit(original, actors, 640, 480, options)); assert.equal(calls, 0);
});
test('moving a frame updates only center or offset and clamps each axis without touching zoom or target', () => {
  const fixedCamera = fixed([99990, -99990], 0.125), moved = move(fixedCamera, [50, -100]);
  assert.deepEqual(moved, fixed([100000, -100000], 0.125)); assert.deepEqual(fixedCamera, fixed([99990, -99990], 0.125));
  const followCamera = follow(id(2), [-10, 20], 8), followed = move(followCamera, [50.5, -80.25]);
  assert.deepEqual(followed, follow(id(2), [40.5, -60.25], 8)); assert.ok(Object.isFrozen(followed.offset));
  assert.deepEqual(move(followCamera, [Number.MAX_VALUE, -Number.MAX_VALUE]), follow(id(2), [100000, -100000], 8));
});
test('zero delta preserves numeric values including signed zero and still returns a detached frozen camera', () => {
  for (const value of [fixed([-0, 1.25]), follow(id(1), [0.1, -0])]) {
    const result = move(value, [0, -0]), key = value.mode === 'fixed' ? 'center' : 'offset';
    assert.notEqual(result, value); assert.notEqual(result[key], value[key]);
    result[key].forEach((coordinate, index) => assert.ok(Object.is(coordinate, value[key][index])));
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[key]));
  }
});
test('move rejects invalid deltas and non-data vectors before any getter or source mutation', () => {
  const value = follow(), before = structuredClone(value);
  for (const delta of [[0], [0, 0, 0], [NaN, 0], [0, Infinity], ['2', 0], [0, ,]]) invalid(() => move(value, delta));
  let calls = 0; const getter = [0, 0]; Object.defineProperty(getter, '0', { enumerable: true, get() { calls++; return 10; } });
  invalid(() => move(value, getter)); assert.equal(calls, 0); assert.deepEqual(value, before);
});
test('framing and fitting remain stable at fractional offsets on the author coordinate boundary', () => {
  for (const coordinate of [0.1, 10000.1, -10000.1, 99999.999999, -99999.999999]) {
    const actors = [actor(1, [coordinate, coordinate])];
    for (const offset of [-100000, 0, 100000]) {
      const frame = resolve(input(follow(id(1), [offset, offset], 0.3), actors));
      const view = fit(frame, actors, 390.5, 844.25, { scope: 'camera' }); contains(view, frame.bounds, 390.5, 844.25);
    }
  }
});
test('the same pure module executes in a browser-style realm without Node, DOM or host callbacks', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-camera2d-frame.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gmu, ''), /(?:from\s+['"]node:|\b(?:process|Buffer|window)\b|(?<!\.)\bdocument\b)/u);
  const context = vm.createContext({ SCENE_WORKSPACE_MIN_SCALE, SCENE_WORKSPACE_MAX_SCALE });
  vm.runInContext(source.replace(/^import .*\n/gmu, '').replaceAll('export ', '') + '\nglobalThis.api={resolveSceneCamera2DFrame,fitSceneCamera2DFrame,moveSceneCamera2DFrame};', context);
  const value = input(follow(), [actor(2, [1500, 900])]);
  const actual = JSON.parse(vm.runInContext(`const value=${JSON.stringify(value)};const frame=api.resolveSceneCamera2DFrame(value);JSON.stringify({frame,view:api.fitSceneCamera2DFrame(frame,value.actors,390,844,{scope:'all'}),camera:api.moveSceneCamera2DFrame(value.camera,[20,-10]),frozen:Object.isFrozen(frame.bounds),globals:[typeof process,typeof document,typeof window,typeof Buffer]});`, context));
  const frame = resolve(value); assert.deepEqual(actual.frame, frame); assert.deepEqual(actual.view, fit(frame, value.actors, 390, 844, { scope: 'all' }));
  assert.deepEqual(actual.camera, move(value.camera, [20, -10])); assert.equal(actual.frozen, true); assert.deepEqual(actual.globals, ['undefined', 'undefined', 'undefined', 'undefined']);
});
