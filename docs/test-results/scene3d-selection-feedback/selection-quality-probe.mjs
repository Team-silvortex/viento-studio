import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pickScene3DObject } from '../../../web/modules/scene3d-picking.js';
import { createScene3DRenderer } from '../../../web/modules/scene3d-renderer.js';
import { multiply4, perspective4, lookAt4, objectMatrix4 } from '../../../web/modules/scene3d-math.js';

// Independent view quality proof. The reference projects and clips individual
// triangles; it does not invert matrices or use ray/box slab intersection.
const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['web/modules/scene3d-picking.js', 'web/modules/scene3d-renderer.js',
  'web/modules/scene3d-math.js', 'web/modules/app-scene3d-preview.js'];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async path => [path, sha(await fs.readFile(new URL(path, root)))])));
const beforeSources = await hashes(), cases = [], counts = { triangleReferenceSamples: 0,
  float32UploadedSamples: 0, clipSurfaceCases: 0, gestureScenarios: 0, selectionScenarios: 0 };
async function run(name, callback) {
  try { await callback(); cases.push({ name, ok: true }); }
  catch (error) { cases.push({ name, ok: false, error: error.stack || String(error) }); }
}
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const object = (n, position = [0, 0, 0], size = [2, 2, 2], rotationDegrees = [0, 0, 0]) =>
  ({ instanceId: uuid(n), name: `Box ${n}`, primitive: 'box', position, size, rotationDegrees, color: '#85d7bb' });
const camera = (values = {}) => ({ position: [0, 0, 6], target: [0, 0, 0], fovDegrees: 60, near: .1, far: 100, ...values });
const scene = (objects = [object(1)], view = camera()) => ({ format: 'viento-scene3d-model', schemaVersion: 1,
  name: 'Independent pick fixture', viewport: [800, 600], background: '#203040', camera: view,
  light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 }, objects });
const rect = { left: 17, top: 23, width: 640, height: 480 };
const apply4 = (m, v) => Array.from({ length: 4 }, (_, row) => v.reduce((sum, value, col) => sum + m[col * 4 + row] * value, 0));
function frame(objects, view = camera(), bounds = rect, width = 640, height = 480) {
  const origin = view.target, eye = view.position.map((value, index) => value - origin[index]);
  return { rect: { ...bounds }, width, height,
    viewProjection: new Float32Array(multiply4(perspective4(view.fovDegrees, width / height, view.near, view.far), lookAt4(eye, [0, 0, 0]))),
    objects: objects.map(item => ({ instanceId: item.instanceId, model: new Float32Array(objectMatrix4({ ...item,
      position: item.position.map((value, index) => value - origin[index]) })) })) };
}
const faceQuads = [
  [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]],
  [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]],
  [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]],
  [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]],
  [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]],
  [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]],
];
const planes = [v => v[3] + v[0], v => v[3] - v[0], v => v[3] + v[1],
  v => v[3] - v[1], v => v[3] + v[2], v => v[3] - v[2]];
function clipped(vertices) {
  let polygon = vertices;
  for (const signed of planes) {
    const next = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length], av = signed(a), bv = signed(b);
      if (av >= 0) next.push(a);
      if ((av >= 0) !== (bv >= 0)) { const t = av / (av - bv); next.push(a.map((value, i) => value + t * (b[i] - value))); }
    }
    polygon = next;
  }
  return polygon.filter(v => v[3] > 0 && v.every(Number.isFinite)).map(v => v.slice(0, 3).map(value => value / v[3]));
}
function triangleDepth(vertices, x, y) {
  const [a, b, c] = vertices, divisor = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (divisor === 0) return null;
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / divisor;
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / divisor, w = 1 - u - v;
  if (Math.min(u, v, w) < -1e-10) return null;
  return u * a[2] + v * b[2] + w * c[2];
}
function projectedReference(current, clientX, clientY) {
  const r = current.rect;
  if (clientX < r.left || clientX >= r.left + r.width || clientY < r.top || clientY >= r.top + r.height) return null;
  const x = (clientX - r.left) / r.width * 2 - 1, y = 1 - (clientY - r.top) / r.height * 2;
  let nearest = Infinity, selected = null;
  for (const item of current.objects) {
    let depth = Infinity;
    for (const quad of faceQuads) for (const indices of [[0, 1, 2], [0, 2, 3]]) {
      const polygon = clipped(indices.map(index => apply4(current.viewProjection, apply4(item.model, [...quad[index], 1]))));
      for (let index = 1; index + 1 < polygon.length; index++) {
        const z = triangleDepth([polygon[0], polygon[index], polygon[index + 1]], x, y);
        if (z !== null) depth = Math.min(depth, z);
      }
    }
    // Identical geometry has identical triangle computations, preserving
    // declaration-order ties without assuming a hardware depth-buffer format.
    if (depth <= nearest && depth !== Infinity) { nearest = depth; selected = item.instanceId; }
  }
  return selected;
}
function fixture(options = {}) {
  const calls = [], listeners = new Map(), captures = new Set(), picks = []; let observer, lost = false;
  const gl = Object.fromEntries(['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER',
    'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'].map((key, i) => [key, i + 1]));
  for (const key of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[key] = () => { const value = { key }; calls.push([key, value]); return value; };
  for (const key of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData',
    'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram',
    'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'drawArrays', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader'])
    gl[key] = (...args) => calls.push([key, ...args.map(arg => arg instanceof Float32Array ? new Float32Array(arg) : arg)]);
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getUniformLocation = (_, key) => key; gl.isContextLost = () => lost;
  gl.getExtension = () => ({ loseContext() { lost = true; } });
  const canvas = { width: 0, height: 0, getContext: () => gl, getBoundingClientRect: () => ({ ...(options.bounds || rect) }),
    addEventListener(key, callback) { listeners.set(key, callback); }, removeEventListener(key, callback) { if (listeners.get(key) === callback) listeners.delete(key); },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); if (options.releaseDispatchesLost) listeners.get('lostpointercapture')?.({ pointerId: id }); } };
  const renderer = createScene3DRenderer(canvas, { pixelRatio: () => options.dpr || 1,
    onError: error => calls.push(['onError', error.message]),
    onPick(id, hint) { picks.push({ id, focus: hint?.focus }); options.onPick?.(id, hint, renderer); },
    observe(callback) { observer = callback; return { observe() {}, disconnect() {} }; } });
  let now = 1000;
  const send = (type, values = {}) => { now += 10; listeners.get(type)?.({ button: 0, buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2, timeStamp: now, preventDefault() {}, ...values }); };
  const tap = values => { send('pointerdown', values); send('pointerup', values); };
  const uniformFrame = objects => {
    const viewProjection = calls.findLast(call => call[0] === 'uniformMatrix4fv' && call[1] === 'viewProjection')[3];
    const matrices = calls.filter(call => call[0] === 'uniformMatrix4fv' && call[1] === 'model').slice(-objects.length).map(call => call[3]);
    return { rect: { ...(options.bounds || rect) }, width: canvas.width, height: canvas.height, viewProjection,
      objects: objects.map((item, index) => ({ instanceId: item.instanceId, model: matrices[index] })) };
  };
  return { renderer, canvas, calls, picks, send, tap, resize: () => observer?.(), uniformFrame,
    lose() { lost = true; send('webglcontextlost'); }, captures };
}

await run('projected clipped-triangle reference agrees across rotated, occluded, narrow and translated Float32 frames', () => {
  const configs = [
    { objects: [object(1)], view: camera() },
    { objects: [object(1, [0, 0, -3], [3, 3, 3]), object(2, [0, 0, 1], [1, 1, 1])], view: camera() },
    { objects: [object(1, [-1, .3, 0], [2, .5, 3], [37, -49, 63]), object(2, [1, -.2, 1], [1, 2, .5], [-19, 51, 31])], view: camera({ position: [4, 2, 7] }) },
    { objects: [object(1, [0, 0, 0], [6, 6, 6], [13, 27, -51])], view: camera({ near: 5.5, far: 8 }) },
    { objects: [object(1, [100000, -100000, 100000], [.001, .002, .003], [31, 47, 63])], view: camera({ position: [100000, -100000, 100000.02], target: [100000, -100000, 100000], near: .001, far: 1 }) },
    { objects: [object(1, [0, 0, 0], [3, 3, 3])], view: camera({ fovDegrees: 179, near: .001, far: 100000 }) },
    { objects: [object(1, [0, 0, 0], [3, 3, 3], [11, 25, 59])], view: camera({ fovDegrees: 1 }), width: 1, height: 2048 },
    { objects: [object(1, [0, 0, 0], [3, 3, 3], [11, 25, 59])], view: camera(), width: 2048, height: 1 },
  ];
  for (const c of configs) {
    const current = frame(c.objects, c.view, rect, c.width || 640, c.height || 480);
    for (let row = 0; row < 11; row++) for (let col = 0; col < 13; col++) {
      const x = rect.left + rect.width * (col + .371) / 13, y = rect.top + rect.height * (row + .613) / 11;
      assert.equal(pickScene3DObject(current, x, y), projectedReference(current, x, y), `config ${configs.indexOf(c)}, ${col}/${row}`);
      counts.triangleReferenceSamples++;
    }
  }
});
await run('clip surfaces use visible exit faces and omit synthetic near caps, behind-camera and far-hidden boxes', () => {
  const tests = [
    { item: object(1, [0, 0, 4], [2, 2, 4]), view: camera({ near: 1, far: 10 }), expected: uuid(1) },
    { item: object(1, [0, 0, 0], [100, 100, 100]), view: camera({ near: 1, far: 2 }), expected: null },
    { item: object(1, [0, 0, 8]), view: camera(), expected: null },
    { item: object(1, [0, 0, -10]), view: camera({ far: 10 }), expected: null },
    { item: object(1, [0, 0, 5.7], [.1, .1, .1]), view: camera({ near: 1 }), expected: null },
  ];
  for (const c of tests) {
    const current = frame([c.item], c.view);
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    assert.equal(projectedReference(current, x, y), c.expected); assert.equal(pickScene3DObject(current, x, y), c.expected);
    counts.clipSurfaceCases++;
  }
});
await run('equal-depth LEQUAL selects last source declaration without mutating matrices', () => {
  const current = frame([object(1), object(2)]), captured = structuredClone(current);
  assert.equal(pickScene3DObject(current, rect.left + rect.width / 2, rect.top + rect.height / 2), uuid(2));
  current.objects.reverse(); assert.equal(pickScene3DObject(current, rect.left + rect.width / 2, rect.top + rect.height / 2), uuid(1));
  current.objects.reverse(); assert.deepEqual(current, captured);
});
await run('outside rect and invalid matrix frames are null and never infer an author object', () => {
  const current = frame([object(1)]);
  for (const point of [[rect.left - 1, rect.top], [rect.left + rect.width, rect.top], [rect.left, rect.top + rect.height], [NaN, 23]])
    assert.equal(pickScene3DObject(current, ...point), null);
  for (const bad of [null, { ...current, viewProjection: new Float32Array(16) }, { ...current, width: 0 },
    { ...current, rect: { ...rect, width: 0 } }, { ...current, objects: [{ instanceId: uuid(1), model: new Float32Array(16) }] }])
    assert.equal(pickScene3DObject(bad, 100, 100), null);
});
await run('renderer hitTest uses the actual uploaded Float32 matrices and rect without extra draws or source changes', () => {
  const options = { dpr: 2 }, f = fixture(options), data = scene([object(1, [0, 0, 0], [2, 3, 1], [37, -43, 59]), object(2, [1, 0, -1])]);
  const original = structuredClone(data); f.renderer.setModel(data);
  assert.equal(typeof f.renderer.hitTest, 'function'); const before = f.renderer.snapshot(), calls = f.calls.length;
  const current = f.uniformFrame(data.objects);
  for (let row = 0; row < 7; row++) for (let col = 0; col < 9; col++) {
    const x = rect.left + rect.width * (col + .431) / 9, y = rect.top + rect.height * (row + .271) / 7;
    assert.equal(f.renderer.hitTest(x, y), projectedReference(current, x, y)); counts.float32UploadedSamples++;
  }
  assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.deepEqual(data, original); f.renderer.dispose();
});
await run('position-only canvas scrolling remaps current CSS client coordinates without redraw while size changes require a fresh frame', () => {
  const options = { bounds: { ...rect } }, f = fixture(options), data = scene(); f.renderer.setModel(data);
  const before = f.renderer.snapshot(), calls = f.calls.length;
  options.bounds = { ...rect, left: rect.left + rect.width + 13, top: rect.top + 8 };
  assert.equal(f.renderer.hitTest(options.bounds.left + rect.width / 2, options.bounds.top + rect.height / 2), uuid(1));
  assert.equal(f.renderer.hitTest(rect.left + rect.width / 2, rect.top + rect.height / 2), null);
  assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  options.bounds.width += 10; assert.equal(f.renderer.hitTest(options.bounds.left + options.bounds.width / 2, options.bounds.top + rect.height / 2), null);
  f.resize(); assert.equal(f.renderer.hitTest(options.bounds.left + options.bounds.width / 2, options.bounds.top + rect.height / 2), uuid(1));
  f.renderer.dispose();
});
await run('canvas position changes during a pending tap or before double-click revoke the old gesture owner', () => {
  for (const phase of ['pending', 'moving', 'completed']) {
    const options = { bounds: { ...rect } }, f = fixture(options); f.renderer.setModel(scene());
    if (phase !== 'completed') f.send('pointerdown'); else f.tap();
    // A one-pixel position change keeps the same client point inside the box
    // and below the drag threshold. It must still revoke the old frame owner.
    options.bounds.left += 1;
    if (phase === 'pending') f.send('pointerup');
    else if (phase === 'moving') {
      const before = f.renderer.snapshot();
      f.send('pointermove', { clientX: rect.left + rect.width / 2 + 30 }); f.send('pointerup');
      assert.deepEqual(f.renderer.snapshot(), before, 'scroll invalidates the drag before orbit or draw');
    } else f.send('dblclick');
    assert.equal(f.picks.length, phase !== 'completed' ? 0 : 1, phase);
    f.tap({ clientX: options.bounds.left + rect.width / 2 });
    assert.equal(f.picks.at(-1)?.id, uuid(1)); assert.equal(f.picks.at(-1)?.focus, false);
    counts.gestureScenarios++; f.renderer.dispose();
  }
});
await run('tap, native double-click and jitter emit stable UUID while author data remains intact', () => {
  const f = fixture({ releaseDispatchesLost: true }), data = scene(), original = structuredClone(data); f.renderer.setModel(data);
  f.send('pointerdown'); f.send('pointermove', { clientX: rect.left + rect.width / 2 + 1 }); f.send('pointerup');
  assert.deepEqual(f.picks, [{ id: uuid(1), focus: false }]); assert.deepEqual(f.renderer.snapshot().camera, data.camera);
  f.tap(); f.send('dblclick'); assert.equal(f.picks.length, 3); assert.equal(f.picks[1].focus, false); assert.equal(f.picks[2].focus, true); assert.equal(f.captures.size, 0);
  assert.deepEqual(data, original); counts.gestureScenarios += 2; f.renderer.dispose();
});
await run('out-and-back drag remains a drag and prevents stale double-tap focus', () => {
  const f = fixture(), data = scene(); f.renderer.setModel(data); f.tap();
  f.send('pointerdown'); f.send('pointermove', { clientX: rect.left + rect.width / 2 + 30 }); f.send('pointermove'); f.send('pointerup');
  assert.equal(f.picks.length, 1); f.renderer.resetView(); f.tap();
  f.send('dblclick'); assert.equal(f.picks.length, 3); assert.equal(f.picks[1].focus, false); assert.equal(f.picks[2].focus, true); counts.gestureScenarios++; f.renderer.dispose();
});
await run('cancel, capture loss, wheel, reset, refresh, resize and secondary pointer invalidate pending taps', () => {
  for (const name of ['cancel', 'lost', 'wheel', 'reset', 'setModel', 'resize', 'secondary', 'context']) {
    const f = fixture(), data = scene(); f.renderer.setModel(data); f.send('pointerdown');
    if (name === 'cancel') f.send('pointercancel');
    if (name === 'lost') f.send('lostpointercapture');
    if (name === 'wheel') f.send('wheel', { deltaY: 1 });
    if (name === 'reset') f.renderer.resetView();
    if (name === 'setModel') f.renderer.setModel(scene([object(2)]));
    if (name === 'resize') f.resize();
    if (name === 'secondary') f.send('pointerdown', { pointerId: 2, isPrimary: false, pointerType: 'touch' });
    if (name === 'context') f.lose();
    f.send('pointerup'); assert.equal(f.picks.length, 0, name); counts.gestureScenarios++; f.renderer.dispose();
  }
});
await run('last tap is cleared by misses, drag interruptions, wheel and model generation changes', () => {
  for (const name of ['miss', 'cancel', 'lost', 'wheel', 'reset', 'setModel', 'resize', 'secondary']) {
    const f = fixture(), data = scene(); f.renderer.setModel(data); f.tap();
    if (name === 'miss') f.tap({ clientX: rect.left + 1, clientY: rect.top + 1 });
    if (name === 'cancel') { f.send('pointerdown'); f.send('pointercancel'); }
    if (name === 'lost') { f.send('pointerdown'); f.send('lostpointercapture'); }
    if (name === 'wheel') f.send('wheel', { deltaY: 0 });
    if (name === 'reset') f.renderer.resetView();
    if (name === 'setModel') f.renderer.setModel(data);
    if (name === 'resize') f.resize();
    if (name === 'secondary') f.send('pointerdown', { pointerId: 2, isPrimary: false, pointerType: 'touch' });
    f.send('dblclick'); assert.equal(f.picks.length, 1, name); f.tap(); assert.equal(f.picks.length, 2, name); assert.equal(f.picks[1].focus, false, name);
    counts.gestureScenarios++; f.renderer.dispose();
  }
});
await run('callback throw and callback dispose leave capture released and no old handler resurrects a view', () => {
  for (const mode of ['throw', 'dispose', 'setModel']) {
    const f = fixture({ onPick(id, hint, renderer) {
      if (mode === 'throw') throw new Error('deliberate callback failure');
      if (mode === 'dispose') renderer.dispose();
      if (mode === 'setModel') renderer.setModel(scene([object(2)]));
    } });
    f.renderer.setModel(scene()); assert.doesNotThrow(() => f.tap()); assert.equal(f.captures.size, 0);
    const before = f.renderer.snapshot(); f.send('pointerup'); assert.deepEqual(f.renderer.snapshot(), before);
    if (mode === 'dispose') { assert.equal(f.renderer.hitTest(rect.left + rect.width / 2, rect.top + rect.height / 2), null); assert.equal(f.picks.length, 1); }
    if (mode === 'setModel') { f.tap(); assert.equal(f.picks.at(-1).id, uuid(2)); assert.equal(f.picks.at(-1).focus, false); }
    counts.gestureScenarios++; f.renderer.dispose();
  }
});

// Selection is a view-only UUID hint. These cases consume the actual renderer,
// not a parallel shader or source model implementation. Pixels are proved by
// the separate real browser producer; this fixture records GPU calls/uniforms.
const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
const geometryCalls = entries => entries.filter(call =>
  ['viewport', 'depthFunc', 'drawArrays'].includes(call[0])
  || call[0] === 'uniformMatrix4fv').map(call => call.map(value =>
    value instanceof Float32Array ? [...value] : value));
const selectionState = renderer => ({ ...renderer.snapshot(), draws: undefined, selectedInstanceId: undefined });
await run('selection accepts only current stable UUID or null and repeats are exact no-draw view no-ops', () => {
  const f = fixture(), data = scene([object(1), object(2, [2, 0, 0])]);
  assert.equal(f.renderer.setSelectedObject(uuid(1)), false);
  f.renderer.setModel(data); const original = structuredClone(data), view = selectionState(f.renderer);
  assert.equal(f.renderer.setSelectedObject(uuid(1)), true); assert.equal(f.renderer.snapshot().selectedInstanceId, uuid(1));
  assert.deepEqual(selectionState(f.renderer), view); assert.deepEqual(data, original);
  let before = f.renderer.snapshot(), calls = f.calls.length;
  assert.equal(f.renderer.setSelectedObject(uuid(1)), true); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  for (const bad of [undefined, '', 1, {}, uuid(99), uuid(1).toUpperCase() === uuid(1) ? 'UNKNOWN' : uuid(1).toUpperCase()]) {
    assert.equal(f.renderer.setSelectedObject(bad), false); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  }
  assert.equal(f.renderer.setSelectedObject(null), true); assert.equal(f.renderer.snapshot().selectedInstanceId, null);
  before = f.renderer.snapshot(); calls = f.calls.length;
  assert.equal(f.renderer.setSelectedObject(null), true); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  assert.deepEqual(data, original); counts.selectionScenarios++; f.renderer.dispose();
});
await run('selection redraw keeps actual Float32 geometry depth source order and one box pass with no resource allocation', () => {
  const f = fixture(), data = scene([object(1), object(2), object(3, [2, 1, 0])]); f.renderer.setModel(data);
  const beforeFrame = f.uniformFrame(data.objects), calls = f.calls.length, resources = f.calls.filter(call =>
    ['createProgram', 'createShader', 'createBuffer', 'createVertexArray', 'bufferData'].includes(call[0]));
  const baseline = geometryCalls(f.calls.slice(f.calls.findIndex(call => call[0] === 'viewport')));
  assert.equal(f.renderer.setSelectedObject(uuid(1)), true);
  const delta = f.calls.slice(calls);
  assert.deepEqual(geometryCalls(delta), baseline);
  assert.deepEqual(f.uniformFrame(data.objects), beforeFrame);
  assert.equal(delta.filter(call => call[0] === 'drawArrays').length, data.objects.length);
  assert.ok(delta.filter(call => call[0] === 'drawArrays').every(call => call[1] === f.calls.find(call => call[0] === 'drawArrays')[1] && call[2] === 0 && call[3] === 36));
  assert.equal(delta.some(call => ['createProgram', 'createShader', 'createBuffer', 'createVertexArray', 'bufferData', 'clearDepth', 'polygonOffset', 'lineWidth'].includes(call[0])), false);
  assert.equal(delta.some(call => call[0] === 'disable' && call[1] === f.calls.find(call => call[0] === 'enable')[1]), false);
  assert.equal(resources.filter(call => call[0] === 'createProgram').length, 1);
  assert.equal(resources.filter(call => call[0] === 'createShader').length, 2);
  assert.equal(resources.filter(call => call[0] === 'createBuffer').length, 1);
  assert.equal(resources.filter(call => call[0] === 'createVertexArray').length, 1);
  assert.equal(resources.filter(call => call[0] === 'bufferData').length, 1);
  assert.equal(resources.find(call => call[0] === 'bufferData')[2].length, 216);
  assert.equal(f.renderer.hitTest(...center), projectedReference(beforeFrame, ...center));
  counts.selectionScenarios++; f.renderer.dispose();
});
await run('selection does not reorder equal-depth ties or turn a hidden declared UUID into a geometric hit', () => {
  for (const select of [uuid(1), uuid(2), null]) {
    const f = fixture(), data = scene([object(1), object(2)]); f.renderer.setModel(data);
    assert.equal(f.renderer.setSelectedObject(select), true); assert.equal(f.renderer.hitTest(...center), uuid(2));
    const current = f.uniformFrame(data.objects); assert.deepEqual(current.objects.map(item => item.instanceId), [uuid(1), uuid(2)]);
    counts.selectionScenarios++; f.renderer.dispose();
  }
});
await run('onPick selection-only redraw and normal capture release preserve the native second tap and double click frame', () => {
  const f = fixture({ releaseDispatchesLost: true, onPick(id, hint, renderer) { assert.equal(renderer.setSelectedObject(id), true); } });
  const data = scene(), raw = JSON.stringify(data); f.renderer.setModel(data);
  f.tap(); f.tap(); f.send('dblclick');
  assert.deepEqual(f.picks, [{ id: uuid(1), focus: false }, { id: uuid(1), focus: false }, { id: uuid(1), focus: true }]);
  assert.equal(f.renderer.snapshot().selectedInstanceId, uuid(1)); assert.deepEqual(f.renderer.snapshot().camera, data.camera);
  assert.equal(f.captures.size, 0); assert.equal(JSON.stringify(data), raw); counts.selectionScenarios++; f.renderer.dispose();
});
await run('selection-only redraw during a primary pending tap leaves geometry ownership valid and does not emit its own pick', () => {
  const f = fixture({ releaseDispatchesLost: true }); f.renderer.setModel(scene()); f.send('pointerdown');
  assert.equal(f.renderer.setSelectedObject(uuid(1)), true); assert.deepEqual(f.picks, []); f.send('pointerup');
  assert.equal(f.picks.length, 1); assert.equal(f.picks[0].focus, false);
  assert.equal(f.renderer.setSelectedObject(null), true); f.send('dblclick');
  assert.equal(f.picks.length, 2); assert.equal(f.picks[1].focus, true); counts.selectionScenarios++; f.renderer.dispose();
});
await run('selection redraw across changed allocation or CSS dimensions creates a fresh geometry owner and cancels old tap', () => {
  for (const phase of ['pending', 'completed']) for (const change of ['size', 'dpr', 'backing']) {
    const options = { bounds: { ...rect }, dpr: 1 }, f = fixture(options); f.renderer.setModel(scene());
    if (phase === 'pending') f.send('pointerdown'); else f.tap();
    if (change === 'size') options.bounds.width += 10;
    if (change === 'dpr') options.dpr = 2;
    if (change === 'backing') f.canvas.width += 1;
    assert.equal(f.renderer.setSelectedObject(uuid(1)), true);
    f.send(phase === 'pending' ? 'pointerup' : 'dblclick');
    assert.equal(f.picks.length, phase === 'pending' ? 0 : 1, `${phase}/${change}`);
    counts.selectionScenarios++; f.renderer.dispose();
  }
});
await run('position-only scrolling with selection redraw remains hittable but cannot authorize a tap spanning canvas movement', () => {
  for (const phase of ['pending', 'completed']) {
    const options = { bounds: { ...rect } }, f = fixture(options); f.renderer.setModel(scene());
    if (phase === 'pending') f.send('pointerdown'); else f.tap();
    options.bounds.left += 1; assert.equal(f.renderer.setSelectedObject(uuid(1)), true);
    assert.equal(f.renderer.hitTest(...center), uuid(1)); f.send(phase === 'pending' ? 'pointerup' : 'dblclick');
    assert.equal(f.picks.length, phase === 'pending' ? 0 : 1);
    f.tap(); assert.equal(f.picks.at(-1).focus, false); counts.selectionScenarios++; f.renderer.dispose();
  }
});
await run('reset keeps selected UUID while source model replacement clears selection and old tap ownership', () => {
  const f = fixture(), data = scene(); f.renderer.setModel(data); f.renderer.setSelectedObject(uuid(1)); f.renderer.focusObject(uuid(1));
  f.renderer.resetView(); assert.equal(f.renderer.snapshot().selectedInstanceId, uuid(1)); assert.deepEqual(f.renderer.snapshot().camera, data.camera);
  f.tap(); f.renderer.setModel(scene([object(2)])); assert.equal(f.renderer.snapshot().selectedInstanceId, null);
  f.send('dblclick'); assert.equal(f.picks.length, 1); assert.equal(f.renderer.setSelectedObject(uuid(1)), false);
  assert.equal(f.renderer.setSelectedObject(uuid(2)), true); counts.selectionScenarios++; f.renderer.dispose();
});
await run('selection handles callback reentrancy without resurrecting a disposed model or author camera', () => {
  for (const mode of ['dispose', 'setModel', 'throw']) {
    const f = fixture({ onPick(id, hint, renderer) {
      assert.equal(renderer.setSelectedObject(id), true);
      if (mode === 'dispose') renderer.dispose();
      if (mode === 'setModel') renderer.setModel(scene([object(2)]));
      if (mode === 'throw') throw Error('intentional view consumer error');
    } });
    f.renderer.setModel(scene()); assert.doesNotThrow(() => f.tap()); assert.equal(f.captures.size, 0);
    if (mode !== 'throw') { f.send('dblclick'); assert.equal(f.picks.length, 1); assert.equal(f.renderer.snapshot().selectedInstanceId, null); }
    else { f.tap(); f.send('dblclick'); assert.equal(f.picks.at(-1).focus, true); }
    counts.selectionScenarios++; f.renderer.dispose();
  }
});
await run('lost context and dispose refuse selection or clear requests without draw mutation or callback', () => {
  for (const mode of ['lost', 'disposed']) {
    const f = fixture(); f.renderer.setModel(scene()); f.renderer.setSelectedObject(uuid(1));
    if (mode === 'lost') f.lose(); else f.renderer.dispose();
    const before = f.renderer.snapshot(), calls = f.calls.length;
    for (const value of [uuid(1), uuid(2), null]) assert.equal(f.renderer.setSelectedObject(value), false);
    assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.deepEqual(f.picks, []);
    counts.selectionScenarios++; f.renderer.dispose();
  }
});
await run('clipped rotated narrow far and millimetre scenes preserve all independent geometric picks after selected redraw', () => {
  const configurations = [
    { items: [object(1, [0, 0, 4], [2, 2, 4])], view: camera({ near: 1, far: 10 }) },
    { items: [object(1, [0, 0, 0], [100, 100, 100])], view: camera({ near: 1, far: 2 }) },
    { items: [object(1, [0, 0, 8])], view: camera() },
    { items: [object(1, [0, 0, -10])], view: camera({ far: 10 }) },
    { items: [object(1, [-1, .3, 0], [2, .5, 3], [37, -49, 63]), object(2, [1, -.2, 1], [1, 2, .5], [-19, 51, 31])], view: camera({ position: [4, 2, 7] }) },
    { items: [object(1, [100000, -100000, 100000], [.001, .002, .003], [31, 47, 63])], view: camera({ position: [100000, -100000, 100000.02], target: [100000, -100000, 100000], near: .001, far: 1 }) },
    { items: [object(1, [0, 0, 0], [1000, .001, .001], [173, -35999, 67])], view: camera({ fovDegrees: 1 }), bounds: { ...rect, width: 1, height: 2048 } },
    { items: [object(1, [0, 0, 0], [.001, 1000, .001], [173, -35999, 67])], view: camera({ fovDegrees: 179 }), bounds: { ...rect, width: 2048, height: 1 } },
  ];
  for (const config of configurations) {
    const options = { bounds: config.bounds || { ...rect } }, f = fixture(options), data = scene(config.items, config.view); f.renderer.setModel(data);
    const original = structuredClone(data), beforeFrame = f.uniformFrame(data.objects), hits = [];
    const r = options.bounds;
    for (let row = 0; row < 7; row++) for (let col = 0; col < 9; col++) {
      const x = r.left + r.width * (col + .431) / 9, y = r.top + r.height * (row + .271) / 7;
      assert.equal(f.renderer.hitTest(x, y), projectedReference(beforeFrame, x, y)); hits.push([x, y, f.renderer.hitTest(x, y)]);
    }
    assert.equal(f.renderer.setSelectedObject(data.objects[0].instanceId), true);
    assert.deepEqual(f.uniformFrame(data.objects), beforeFrame);
    assert.ok(f.calls.filter(call => call[0] === 'uniformMatrix4fv').every(call => [...call[3]].every(Number.isFinite)));
    for (const [x, y, id] of hits) assert.equal(f.renderer.hitTest(x, y), id);
    assert.deepEqual(data, original); counts.selectionScenarios++; f.renderer.dispose();
  }
});

const afterSources = await hashes(), output = process.argv[2];
assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const report = { format: 'viento-scene3d-selection-feedback-independent-quality', schemaVersion: 1,
  observedAt: new Date().toISOString(), node: process.version, ok: cases.every(item => item.ok),
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases, counts,
  sources: beforeSources, endSources: afterSources, sourceStable: JSON.stringify(beforeSources) === JSON.stringify(afterSources),
  scope: 'Actual pure picking helper and actual renderer code with a WebGL uniform/event fixture. Independent homogeneous clipping and triangle-depth reference, actual Float32 uniform payloads, simulated pointer/capture/resize lifecycle. Includes independent selection-only redraw and resource/depth/order/gesture assertions. This fixture does not compile/rasterize the shader or prove edge pixels; real browser/GPU pixels are separate. No native/device/install or author/Save execution claim.' };
report.ok &&= report.sourceStable;
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ok: report.ok, output, passed: report.passed, failed: report.failed, sourceStable: report.sourceStable, counts, node: process.version }));
for (const item of cases.filter(item => !item.ok)) console.error(`${item.name}\n${item.error}`);
process.exitCode = report.ok ? 0 : 1;
