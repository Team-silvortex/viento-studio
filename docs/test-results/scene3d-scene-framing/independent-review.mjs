// Stage-only independent scene-framing review. No build, HTTP or source writer.
// Corner oracles use sequential Z/Y/X rotation and GPU-uploaded Float32 arrays;
// they do not use the new scene-bounds algorithm to predict containment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sceneBounds, frameSceneCamera } from '../../../web/modules/scene3d-math.js';
import { createScene3DRenderer } from '../../../web/modules/scene3d-renderer.js';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import * as core from '../../../engine/studio-core.mjs';

const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(await fs.readFile(new URL('source-before.json', out), 'utf8'));
const protectedPaths = Object.keys(baseline).filter(path => path.startsWith('crates/') || path.startsWith('schemas/')
  || path.startsWith('scripts/backends/') || path.startsWith('scripts/adapters/') || /^engine\/(?:scene3d[^/]*\.mjs|studio-core\.)/.test(path)
  || ['web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'engine/studio-modules.mjs'].includes(path));
const reviewPaths = ['web/modules/scene3d-math.js', 'web/modules/scene3d-renderer.js', 'web/modules/app-scene3d-preview.js', 'web/i18n/en.js', 'web/i18n/ja.js'];
async function hashes(paths) { return Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await fs.readFile(new URL(path, root)))]))); }
const before = await hashes(reviewPaths), protectedBefore = await hashes(protectedPaths);
assert.ok(protectedPaths.length > 30);
for (const path of protectedPaths) assert.equal(protectedBefore[path], baseline[path], path);
await core.initializeStudioCore(() => fs.readFile(new URL('engine/studio-core.wasm', root)));
const cases = [], counts = { cornerContainmentScenarios: 0, uploadedFloat32Scenarios: 0, cornersChecked: 0, controllerCases: 0 };
async function run(name, callback, scope) {
  try { await callback(); cases.push({ name, ok: true, scope }); }
  catch (error) { cases.push({ name, ok: false, scope, error: error.stack || String(error) }); }
}
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const box = (n, position, size = [2, 3, 4], rotationDegrees = [23, -41, 67]) => ({ instanceId: id(n), name: `Box ${n} 箱🦊`,
  primitive: 'box', position, size, rotationDegrees, color: '#aB89CD' });
const scene = objects => ({ format: 'viento-scene3d-model', schemaVersion: 1, name: '全景🦊', viewport: [800, 600],
  background: '#142538', camera: structuredClone(camera), light: { direction: [-1, -2, -1], color: '#FFFFFF', energy: 1 }, objects });
function corners(object) {
  const [x, y, z] = object.rotationDegrees.map(v => v * Math.PI / 180), values = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    let [a, b, c] = [object.size[0] * sx / 2, object.size[1] * sy / 2, object.size[2] * sz / 2];
    [a, b] = [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    values.push([a, b, c].map((v, index) => v + object.position[index]));
  }
  return values;
}
const unit = v => { const length = Math.hypot(...v); return v.map(n => n / length); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
function close(a, b) { assert.equal(a.length, b.length); a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) <= Math.max(1e-10, 16 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(b[index]))), `${value} != ${b[index]}`)); }
function assertCorners(view, objects, aspect) {
  const back = unit(view.position.map((value, index) => value - view.target[index])), right = unit(cross([0, 1, 0], back)), up = cross(back, right);
  const tangent = Math.tan(view.fovDegrees * Math.PI / 360);
  for (const object of objects) for (const corner of corners(object)) {
    const relative = corner.map((value, index) => value - view.position[index]), depth = -dot(relative, back);
    const x = dot(relative, right) / (depth * tangent * aspect), y = dot(relative, up) / (depth * tangent);
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && depth > view.near && depth < view.far);
    assert.ok(Math.abs(x) <= 1 / 1.2 + 1e-5 && Math.abs(y) <= 1 / 1.2 + 1e-5, `${x}, ${y}, aspect ${aspect}`); counts.cornersChecked++;
  }
}
const arrangements = [
  [box(1, [100000, -100000, 100000], [.001, .001, .001])],
  [box(1, [-100000, 100000, -100000], [1000, .001, 17], [36000, -35999, 179]), box(2, [100000, -100000, 100000], [.001, 1000, .001])],
  [box(1, [7, -2, 9]), box(2, [-13, 2, 1], [.001, 1000, .001], [17, 82, -131]), box(3, [0, 1, 0], [99, 1000, 299])],
  Array.from({ length: 128 }, (_, n) => box(n + 1, [Math.cos(n) * 99999, Math.sin(n) * 99999, n % 2 ? -99999 : 99999], n % 3 ? [.001, 1000, .001] : [1000, 999, 1], [n * 19, -n * 3, n * 17])),
];
await run('all rotated declarations contribute to independent eight-corner bounds in source order, including one and 128 objects', () => {
  for (const objects of arrangements) {
    const before = JSON.stringify(objects), points = objects.flatMap(corners), wantMin = [0, 1, 2].map(axis => Math.min(...points.map(p => p[axis]))), wantMax = [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis])));
    const bounds = sceneBounds(objects); assert.ok(bounds); close(bounds.min, wantMin); close(bounds.max, wantMax);
    const center = wantMin.map((value, axis) => (value + wantMax[axis]) / 2); close(bounds.center, center);
    const radius = Math.max(...points.map(point => Math.hypot(...point.map((v, axis) => v - center[axis])))); close([bounds.radius], [radius]);
    for (const value of [bounds, bounds.min, bounds.max, bounds.center]) assert.ok(Object.isFrozen(value));
    assert.equal(JSON.stringify(objects), before);
    const reordered = sceneBounds([...objects].reverse()); close(reordered.min, bounds.min); close(reordered.max, bounds.max); close(reordered.center, bounds.center); close([reordered.radius], [bounds.radius]);
  }
}, 'independent-double-corner-oracle');
await run('full-scene cameras contain every independent corner at extreme author coordinates, FOV and actual narrow/wide aspect', () => {
  for (const objects of arrangements) for (const fovDegrees of [1, 60, 179]) for (const aspect of [1 / 8192, 1 / 2048, .2, 1, 8192]) {
    const input = { ...structuredClone(camera), fovDegrees, near: 10000, far: 100000 }, original = JSON.stringify([input, objects]);
    const framed = frameSceneCamera(input, objects, aspect); assert.ok(framed); assert.ok(Object.isFrozen(framed) && Object.isFrozen(framed.position) && Object.isFrozen(framed.target));
    assert.equal(framed.fovDegrees, fovDegrees);
    const heading = unit(input.position.map((v, i) => v - input.target[i])), actualHeading = unit(framed.position.map((v, i) => v - framed.target[i]));
    actualHeading.forEach((value, axis) => assert.ok(Math.abs(value - heading[axis]) < 1e-6, 'binary64 target addition preserves heading within distant tiny-object precision'));
    assertCorners(framed, objects, aspect); assert.equal(JSON.stringify([input, objects]), original); counts.cornerContainmentScenarios++;
  }
}, 'independent-double-corner-oracle');
function rendererFixture(options = {}) {
  let lost = false, observed, currentModel, currentView; const draws = [], calls = [], errors = [], listeners = new Map(), captures = new Set();
  const gl = Object.fromEntries(['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'].map((name, i) => [name, i + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => ({});
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniform3fv', 'uniform1f', 'uniform1i', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => calls.push([name, ...args]);
  gl.uniformMatrix4fv = (name, _, matrix) => { if (name === 'model') currentModel = [...matrix]; if (name === 'viewProjection') currentView = [...matrix]; };
  gl.drawArrays = () => { if (options.throwDraw) throw Error('Independent injected drawing failure'); draws.push({ model: [...currentModel], view: [...currentView] }); };
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getUniformLocation = (_, name) => name;
  gl.isContextLost = () => lost || options.contextLost === true; gl.getExtension = () => ({ loseContext() { lost = true; } });
  const canvas = { width: 0, height: 0, getContext: () => gl, getBoundingClientRect: () => options.bounds || { left: 0, top: 0, width: 701, height: 400 },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture(id) { return captures.has(id); }, releasePointerCapture(id) { captures.delete(id); listeners.get('lostpointercapture')?.({ pointerId: id }); } };
  const picks = [], renderer = createScene3DRenderer(canvas, { pixelRatio: () => options.dpr ?? 1, onPick: (...args) => picks.push(args), onError(error) { errors.push(error.message); options.onError?.(error); },
    observe(callback) { observed = callback; return { observe() {}, disconnect() {} }; } });
  return { renderer, canvas, draws, calls, errors, listeners, captures, picks, resize() { observed(); }, options };
}
function uploadedCorners(draw) {
  const transform = (m, v) => Array.from({ length: 4 }, (_, row) => { let total = Math.fround(0); for (let col = 0; col < 4; col++) total = Math.fround(total + Math.fround(m[col * 4 + row] * v[col])); return total; });
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    const clip = transform(draw.view, transform(draw.model, [x, y, z, 1])); assert.ok(clip.every(Number.isFinite) && clip[3] > 0);
    const ndc = clip.slice(0, 3).map(value => value / clip[3]); assert.ok(Math.abs(ndc[0]) < .835 && Math.abs(ndc[1]) < .835); assert.ok(ndc[2] > -1 && ndc[2] < 1);
  }
}
await run('actual renderer uploads a contained Float32 projection for every source object and retains selection without mutating native model', () => {
  for (const objects of arrangements) for (const fovDegrees of [1, 179]) for (const bounds of [{ width: 1, height: 8192 }, { width: 8192, height: 1 }, { width: 390, height: 844 }]) {
    const f = rendererFixture({ bounds }), model = scene(structuredClone(objects)); model.camera.fovDegrees = fovDegrees; model.camera.near = 10000; model.camera.far = 100000;
    const original = JSON.stringify(model); f.renderer.setModel(model); f.renderer.setSelectedObject(model.objects.at(-1).instanceId);
    const prior = f.draws.length; assert.equal(f.renderer.focusAll(), true); const after = f.draws.slice(prior); assert.equal(after.length, objects.length);
    after.forEach(uploadedCorners); assert.equal(f.renderer.snapshot().selectedInstanceId, model.objects.at(-1).instanceId); assert.equal(JSON.stringify(model), original);
    const first = f.renderer.snapshot(); first.camera.target[0] += 10; assert.notDeepEqual(first.camera.target, f.renderer.snapshot().camera.target);
    f.renderer.resetView(); assert.deepEqual(f.renderer.snapshot().camera, model.camera); assert.equal(f.renderer.snapshot().selectedInstanceId, model.objects.at(-1).instanceId);
    f.renderer.dispose(); counts.uploadedFloat32Scenarios++;
  }
}, 'actual-renderer-with-recording-GL-fixture-no-GPU-acceptance');
await run('focused full scenes retain smooth first wheel scaling beyond old orbit clamps and reset restores the author camera', () => {
  for (const tiny of [false, true]) {
    const f = rendererFixture({ bounds: tiny ? { width: 400, height: 400 } : { width: 1, height: 8192 } });
    const model = scene(tiny ? [box(1, [100000, -100000, 100000], [.001, .001, .001])] : arrangements[1]); model.camera.fovDegrees = tiny ? 179 : 1;
    f.renderer.setModel(model); assert.equal(f.renderer.focusAll(), true);
    const distance = value => Math.hypot(...value.position.map((v, i) => v - value.target[i])), old = distance(f.renderer.snapshot().camera);
    assert.ok(tiny ? old < .01 : old > 200000); f.listeners.get('wheel')({ deltaY: 1, preventDefault() {} });
    assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / old - Math.exp(.001)) < 1e-6);
    f.renderer.resetView(); assert.deepEqual(f.renderer.snapshot().camera, model.camera); f.renderer.dispose();
  }
}, 'actual-renderer-event-fixture');
await run('lost disposed or uninitialized full-scene requests are false camera/selection no-ops and consume no extra draw', () => {
  const f = rendererFixture(), before = f.renderer.snapshot(); assert.equal(f.renderer.focusAll(), false); assert.deepEqual(f.renderer.snapshot(), before);
  f.renderer.setModel(scene(arrangements[2])); const ready = f.renderer.snapshot(), prior = f.draws.length;
  f.options.contextLost = true; assert.equal(f.renderer.focusAll(), false); assert.deepEqual(f.renderer.snapshot(), ready); assert.equal(f.draws.length, prior);
  f.renderer.dispose(); const disposed = f.renderer.snapshot(); assert.equal(f.renderer.focusAll(), false); assert.deepEqual(f.renderer.snapshot(), disposed);
}, 'actual-renderer-event-fixture');

await run('attempted drawing failure restores camera and selection, invalidates picking and reports the existing drawing-error path', () => {
  const f = rendererFixture(), model = scene(arrangements[2]); f.renderer.setModel(model); f.renderer.setSelectedObject(model.objects[1].instanceId);
  const before = f.renderer.snapshot(); f.options.throwDraw = true;
  assert.equal(f.renderer.focusAll(), false); assert.deepEqual(f.renderer.snapshot().camera, before.camera);
  assert.equal(f.renderer.snapshot().selectedInstanceId, before.selectedInstanceId); assert.equal(f.renderer.snapshot().draws, before.draws);
  assert.equal(f.errors.length, 1); assert.match(f.errors[0], /drawing failure/); assert.equal(f.renderer.hitTest(200, 200), null); f.renderer.dispose();
}, 'actual-renderer-injected-drawing-error');

const { createScene3DObjectIndex, queryScene3DObjects } = await import('../../../engine/scene3d-navigation.mjs');
const { dialogHarness, flushDialogs } = await import('../../../scripts/tests/dialog-harness.mjs');
const rawScene = () => '\uFEFF' + JSON.stringify({ ...scene(arrangements[2]), format: 'viento-scene3d' }, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
async function controllerFixture(options = {}) {
  let rawSource = rawScene(), sourceCalls = 0, locationCalls = 0, supported = true, languageChanged;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/scenes/world.json', sourceToken: 'independent-scene-view:1' };
  const instances = [];
  const h = await dialogHarness('app-scene3d-preview', { parseScene3DSource, createScene3DObjectIndex, queryScene3DObjects,
    supportsStudioCoreScene3D: () => supported, t: value => value, translatePage() {},
    onLanguageChange(callback) { languageChanged = callback; return () => {}; },
    createScene3DRenderer(_, ports) {
      if (options.unsupported) return null;
      const f = rendererFixture({ onError: ports.onError }), current = { f, ports, models: [], allCalls: 0 };
      const decorated = { ...f.renderer, setModel(model) { current.models.push(model); return f.renderer.setModel(model); },
        focusAll: options.missingFocusAll ? undefined : () => { current.allCalls++; return f.renderer.focusAll(); } };
      current.decorated = decorated; instances.push(current); return Object.freeze(decorated);
    } });
  const controller = h.runtime.setupScene3DPreview({ getContext: () => context,
    getSource: async () => { sourceCalls++; return { sourcePath: context.sourcePath, token: context.sourceToken, content: rawSource }; },
    locateSource: async () => { locationCalls++; throw Error('Independent view grants no source-navigation transition'); } });
  const el = suffix => h.element('scene3d' + suffix), changeQuery = query => { el('Search').value = query; el('Search').dispatch('input'); };
  return { h, controller, context, el, changeQuery, instances, raw: () => rawSource, setRaw(value) { rawSource = value; }, sourceCalls: () => sourceCalls,
    locationCalls: () => locationCalls, setSupported(value) { supported = value; }, language: () => languageChanged?.() };
}
async function ui(name, callback, options) {
  let h; await run(name, async () => { try { h = await controllerFixture(options); await callback(h); }
    finally { h?.controller.dispose(); await flushDialogs(); } }, 'actual-preview-controller-native-parse-and-recording-renderer'); counts.controllerCases++;
}
await ui('full-scene framing ignores filtered and no-match lists, retaining stable selected UUID and exact source without additional source reads', async h => {
  const source = h.raw(); assert.equal(await h.controller.open(), true);
  h.el('Objects').querySelectorAll('button')[1].click(); const current = h.instances[0], selected = current.f.renderer.snapshot().selectedInstanceId;
  h.changeQuery('never matches any object'); assert.equal(h.el('Objects').querySelectorAll('button').length, 0); assert.equal(h.el('SelectionHidden').hidden, false);
  const prior = current.f.draws.length; assert.equal(h.el('FocusAll').disabled, false); h.el('FocusAll').click();
  assert.equal(current.allCalls, 1); assert.equal(current.f.draws.length - prior, current.models[0].objects.length);
  assert.equal(current.f.renderer.snapshot().selectedInstanceId, selected); assert.equal(h.raw(), source);
  assert.equal(h.sourceCalls(), 1); assert.equal(h.locationCalls(), 0); assert.equal(h.el('Search').value, 'never matches any object');
  h.language(); assert.equal(h.el('FocusAll').disabled, false); assert.equal(current.f.renderer.snapshot().selectedInstanceId, selected);
});
await ui('changed invalid author draft retains the last complete valid model for framing while original-location permission stays disabled', async h => {
  await h.controller.open(); const current = h.instances[0], originalModel = JSON.stringify(current.models[0]);
  h.setRaw('invalid draft retained literally 🦊'); h.context.sourceToken = 'independent-scene-view:2'; h.controller.refresh();
  assert.equal(h.el('Locate').disabled, true); assert.equal(h.el('FocusAll').disabled, false); h.el('FocusAll').click();
  assert.equal(h.sourceCalls(), 1); assert.equal(current.allCalls, 1); assert.equal(JSON.stringify(current.models[0]), originalModel);
  h.el('Refresh').click(); await flushDialogs(); assert.equal(current.models.length, 1); assert.equal(h.el('Locate').disabled, true);
  h.el('FocusAll').click(); assert.equal(current.allCalls, 2); assert.equal(h.raw(), 'invalid draft retained literally 🦊');
  assert.match(h.el('Status').textContent, /当前预览|上一次|上次/); assert.equal(h.locationCalls(), 0);
});
await ui('busy ineligible unsupported or released source owners cannot invoke full-scene framing through forced button events', async h => {
  await h.controller.open(); const current = h.instances[0];
  for (const [key, value] of [['busy', true], ['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', 'documents/scenes/other.json']]) {
    const before = h.context[key]; h.context[key] = value; h.el('FocusAll').dispatch('click'); assert.equal(current.allCalls, 0); h.context[key] = before;
  }
  h.setSupported(false); h.el('FocusAll').dispatch('click'); assert.equal(current.allCalls, 0); h.setSupported(true);
  h.controller.close(); h.el('FocusAll').dispatch('click'); assert.equal(current.allCalls, 0);
});
await ui('a true drawing exception is reported and disables full-scene navigation without replacing its diagnostic with ordinary framing rejection', async h => {
  await h.controller.open(); const current = h.instances[0], before = current.f.renderer.snapshot(); current.f.options.throwDraw = true;
  h.el('FocusAll').click(); assert.equal(current.allCalls, 1); assert.equal(current.f.errors.length, 1);
  assert.equal(h.el('FocusAll').disabled, true); assert.equal(h.el('Fallback').hidden, false);
  assert.match(h.el('Status').textContent, /绘制中断/); assert.match(h.el('Diagnostics').textContent, /drawing failure/);
  assert.deepEqual(current.f.renderer.snapshot().camera, before.camera); assert.equal(h.locationCalls(), 0);
});
await ui('a legacy renderer without focusAll leaves original navigation and native object declarations usable', async h => {
  await h.controller.open(); assert.equal(h.el('FocusAll').disabled, true); h.el('FocusAll').dispatch('click');
  assert.equal(h.instances[0].allCalls, 0); assert.equal(h.el('Focus').disabled, false); assert.equal(h.el('Objects').querySelectorAll('button').length, 3);
}, { missingFocusAll: true });
await ui('no-WebGL preview still supports native declarations and query without granting the new view control or any writer', async h => {
  await h.controller.open(); assert.equal(h.el('FocusAll').disabled, true); assert.equal(h.el('Fallback').hidden, false);
  h.changeQuery('Box 2'); assert.equal(h.el('Objects').querySelectorAll('button').length, 1); h.el('FocusAll').dispatch('click');
  assert.equal(h.instances.length, 0); assert.equal(h.locationCalls(), 0); assert.equal(h.sourceCalls(), 1);
}, { unsupported: true });
const after = await hashes(reviewPaths), protectedAfter = await hashes(protectedPaths);
const result = { format: 'viento-scene3d-full-scene-independent-review', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter),
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases, counts,
  reviewSources: before, reviewSourcesAfter: after, protectedSourceFiles: protectedPaths.length, protectedSources: protectedBefore,
  sourceStable: JSON.stringify(before) === JSON.stringify(after), oldNativeAuthorBackendSourcesStable: JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter),
  limitations: ['This round does not rerun or claim the preceding complete 3811 application checks or 307 Rust tests.',
    'Recorded GL calls and Float32 corner calculations are an independent CPU oracle, not real browser or hardware GPU acceptance.',
    'Full-scene containment does not guarantee a distant tiny object occupies a visible pixel.',
    'No author proposal, disk writer, HTTP, build, installed desktop or device acceptance is granted by this reviewer.'] };
await fs.writeFile(new URL('independent-review.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: result.ok, passed: result.passed, failed: result.failed, counts, sourceStable: result.sourceStable }) + '\n');
if (!result.ok) process.exitCode = 1;
