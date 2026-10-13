import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const model = () => ({ background: '#142538', camera: { position: [0, 0, 8], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 },
  light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '11111111-1111-4111-8111-111111111111', position: [0, 0, 0], rotationDegrees: [0, 0, 0], size: [2, 2, 2], color: '#85d7bb' }] });
function fixture(options = {}) {
  const calls = [], events = new Map(), documentEvents = new Map(), captures = new Set(), picks = [], errors = [], views = [], viewDrawCounts = []; let observer;
  const eventTarget = entries => ({ addEventListener: (name, callback, capture) => entries.set(name, { callback, capture }), removeEventListener: name => entries.delete(name) });
  const gl = Object.fromEntries(['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'].map((key, index) => [key, index + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => ({});
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'drawArrays', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getUniformLocation = (_, name) => name;
  gl.isContextLost = () => Boolean(options.lost); gl.getExtension = () => null;
  const canvas = { ...eventTarget(events), ownerDocument: eventTarget(documentEvents), width: 0, height: 0, getContext: () => gl,
    getBoundingClientRect: () => options.bounds || { left: 10, top: 20, width: 300, height: 200 },
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); events.get('lostpointercapture')?.callback({ pointerId: id }); } };
  const renderer = createScene3DRenderer(canvas, { pixelRatio: () => options.dpr || 1,
    onError: error => { errors.push(error.message); if (options.throwConsumer) throw Error('consumer failed'); }, onPick: (...args) => picks.push(args),
    onViewChange: receipt => { views.push(receipt); viewDrawCounts.push(calls.filter(call => call[0] === 'drawArrays').length);
      options.onViewChange?.(receipt); if (options.throwView) throw Error('view consumer failed'); },
    observe: callback => { observer = callback; return { observe() {}, disconnect() {} }; } });
  const send = (name, extra = {}) => events.get(name)?.callback({ button: 0, isPrimary: true, pointerId: 7, clientX: 160, clientY: 120, timeStamp: 100, preventDefault() {}, ...extra });
  return { gl, canvas, renderer, calls, events, documentEvents, captures, picks, errors, views, viewDrawCounts, send, resize: () => observer() };
}
const move = (f, dx = 30, dy = -15, extra = {}) => f.send('pointermove', { clientX: 160 + dx, clientY: 120 + dy, ...extra });
function matchesView(f) {
  const receipt = f.views.at(-1), snapshot = f.renderer.snapshot();
  assert.deepEqual(receipt, { camera: snapshot.camera, projectionMode: snapshot.projectionMode });
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.camera));
  assert.ok(Object.isFrozen(receipt.camera.position) && Object.isFrozen(receipt.camera.target));
  if (receipt.camera.up) assert.ok(Object.isFrozen(receipt.camera.up));
}
function expectChange(f, action) {
  const before = f.renderer.snapshot(), count = f.views.length; action(); const after = f.renderer.snapshot();
  const changed = JSON.stringify(before.camera) !== JSON.stringify(after.camera) || before.projectionMode !== after.projectionMode;
  assert.equal(f.views.length, count + Number(changed)); matchesView(f);
}

test('view receipts start only after a successful draw and contain a detached immutable camera with no author or host fields', () => {
  const f = fixture(), value = model(); assert.deepEqual(f.views, []); assert.equal(f.renderer.setModel(value), true); matchesView(f);
  const receipt = f.views[0]; assert.deepEqual(Object.keys(receipt).sort(), ['camera', 'projectionMode']); assert.equal(f.viewDrawCounts[0], 1);
  assert.notEqual(receipt.camera, value.camera); assert.notEqual(receipt.camera.position, value.camera.position); assert.notEqual(receipt.camera.target, value.camera.target);
  assert.throws(() => receipt.camera.position[0] = 99, TypeError); assert.throws(() => receipt.camera.near = 99, TypeError); assert.throws(() => receipt.projectionMode = 'orthographic', TypeError);
  const snapshot = f.renderer.snapshot(); snapshot.camera.position[0] = 99; value.camera.target[0] = 99;
  assert.equal(receipt.camera.position[0], 0); assert.equal(receipt.camera.target[0], 0); assert.equal(f.renderer.snapshot().camera.position[0], 0); f.renderer.dispose();
});

test('six standard directions projections focus orbit pan wheel and reset publish only the successfully drawn current view', () => {
  const f = fixture(); f.renderer.setModel(model());
  for (const projection of ['orthographic', 'perspective']) {
    expectChange(f, () => f.renderer.setProjectionMode(projection));
    for (const direction of ['front', 'back', 'left', 'right', 'top', 'bottom']) expectChange(f, () => f.renderer.setViewDirection(direction));
    expectChange(f, () => { f.send('pointerdown'); move(f); f.send('pointerup', { clientX: 190, clientY: 105 }); });
    expectChange(f, () => { f.send('pointerdown', { shiftKey: true }); move(f); f.send('pointerup', { clientX: 190, clientY: 105 }); });
    expectChange(f, () => f.send('wheel', { deltaY: 100 }));
    expectChange(f, () => f.renderer.focusAll()); expectChange(f, () => f.renderer.focusObject(model().objects[0].instanceId));
    expectChange(f, () => f.renderer.resetView()); assert.equal(Object.hasOwn(f.views.at(-1).camera, 'up'), false);
  }
  f.renderer.dispose();
});

test('selection redraw stable render resize drag mode and same-camera reload never publish duplicate view receipts', () => {
  const options = {}, f = fixture(options); f.renderer.setModel(model()); const receipt = f.views[0];
  f.renderer.setSelectedObject(model().objects[0].instanceId); f.renderer.setSelectedObject(null); f.renderer.setDragMode('pan'); f.renderer.render();
  options.bounds = { left: 20, top: 30, width: 700, height: 400 }; f.resize();
  const next = model(); next.objects[0].color = '#ff5500'; next.objects[0].position = [3, 2, 1]; next.camera.extra = { sourceTag: 'not a view field' }; f.renderer.setModel(next);
  assert.equal(f.views.length, 1); assert.equal(f.views[0], receipt); assert.equal(Object.hasOwn(receipt.camera, 'extra'), false);
  next.camera.fovDegrees = 60; f.renderer.setModel(next); assert.equal(f.views.length, 2); assert.equal(f.views.at(-1).camera.fovDegrees, 60); assert.equal(Object.hasOwn(f.views.at(-1).camera, 'extra'), false); f.renderer.dispose();
});

test('reload publishes new authored camera while earlier receipts remain frozen and detached from later views', () => {
  const f = fixture(); f.renderer.setModel(model()); f.renderer.setViewDirection('top'); const old = f.views.at(-1), raw = JSON.stringify(old);
  assert.throws(() => old.camera.up[0] = 5, TypeError); const next = model(); next.camera.position = [5, 3, 8]; next.camera.target = [1, 0, 2];
  expectChange(f, () => f.renderer.setModel(next)); assert.equal(JSON.stringify(old), raw); assert.equal(Object.hasOwn(f.views.at(-1).camera, 'up'), false); f.renderer.dispose();
});

test('selection-only repaints keep both view notification deduplication and legitimate double-click qualification', () => {
  const f = fixture(); f.renderer.setModel(model()); f.send('pointerdown'); f.send('pointerup'); f.renderer.setSelectedObject(model().objects[0].instanceId); f.send('dblclick', { timeStamp: 110 });
  assert.deepEqual(f.picks, [[model().objects[0].instanceId, { focus: false }], [model().objects[0].instanceId, { focus: true }]]); assert.equal(f.views.length, 1); f.renderer.dispose();
});

test('numeric preflight refusal preserves the last valid receipt and picking frame without falsely revoking availability', () => {
  const f = fixture(), value = model(); f.renderer.setModel(value); const receipt = f.views[0];
  for (const action of [() => f.renderer.setViewDirection('bad'), () => f.renderer.setProjectionMode('bad'), () => f.renderer.focusObject('missing')]) assert.equal(action(), false);
  value.objects.push({ ...value.objects[0], size: [0, 1, 1] }); assert.equal(f.renderer.focusAll(), false); value.objects.pop();
  value.objects[0].size[0] = 1e39; assert.equal(f.renderer.setProjectionMode('orthographic'), false); value.objects[0].size[0] = 2;
  f.renderer.setDragMode('pan'); f.send('pointerdown'); move(f, 1e308, 0); f.send('pointerup');
  assert.deepEqual(f.views, [receipt]); assert.equal(f.renderer.hitTest(160, 120), value.objects[0].instanceId); assert.deepEqual(f.errors, []); f.renderer.dispose();
});

test('atomic projection framing and pan draw failures revoke the receipt without publishing a rejected camera or mode', () => {
  for (const action of [f => f.renderer.setProjectionMode('orthographic'), f => f.renderer.setViewDirection('top'), f => f.renderer.focusAll(),
    f => { f.renderer.setDragMode('pan'); f.send('pointerdown'); move(f); }]) {
    const f = fixture(); f.renderer.setModel(model()); const before = f.renderer.snapshot(), old = f.gl.uniformMatrix4fv;
    f.gl.uniformMatrix4fv = () => { throw Error('injected receipt draw failure'); }; action(f);
    assert.deepEqual(f.views.map(receipt => receipt && receipt.projectionMode), ['perspective', null]); assert.deepEqual(f.renderer.snapshot().camera, before.camera);
    assert.equal(f.renderer.snapshot().projectionMode, before.projectionMode); assert.equal(f.renderer.hitTest(160, 120), null); assert.deepEqual(f.errors, ['injected receipt draw failure']);
    f.gl.uniformMatrix4fv = old; assert.equal(f.renderer.render(), true); assert.equal(f.views.length, 3); matchesView(f); f.renderer.dispose();
  }
});

test('direct render failure retains throw semantics while revoking the view and keeping old picking unavailable', () => {
  const f = fixture(); f.renderer.setModel(model()); f.gl.drawArrays = () => { throw Error('direct GPU failure'); };
  assert.throws(() => f.renderer.render(), /direct GPU failure/); assert.equal(f.views.at(-1), null); assert.equal(f.views.length, 2); assert.equal(f.renderer.hitTest(160, 120), null); f.renderer.dispose();
});

test('context loss notification precedes error diagnostics and repeated failed operations do not repeat null', () => {
  const order = [], options = { onViewChange: receipt => order.push(receipt ? 'view' : 'null') }, f = fixture(options); f.renderer.setModel(model());
  f.send('webglcontextlost'); order.push('after event'); assert.deepEqual(order, ['view', 'null', 'after event']); assert.deepEqual(f.errors, ['WebGL2 context lost.']);
  options.lost = true; assert.equal(f.renderer.render(), false); assert.equal(f.renderer.setViewDirection('top'), false); assert.equal(f.renderer.hitTest(160, 120), null); f.renderer.dispose();
  assert.equal(f.views.length, 2); assert.equal(f.views.at(-1), null);
});

test('observing a lost context without its event revokes a previously successful view and recovery requires a new draw', () => {
  const options = {}, f = fixture(options); f.renderer.setModel(model()); options.lost = true; assert.equal(f.renderer.hitTest(160, 120), null); assert.equal(f.views.at(-1), null);
  options.lost = false; assert.equal(f.renderer.hitTest(160, 120), null); assert.equal(f.views.length, 2); assert.equal(f.renderer.render(), true); matchesView(f); assert.equal(f.views.length, 3); f.renderer.dispose();
});

test('context loss during upload never publishes the failed projection and restores its transaction state', () => {
  const options = {}, f = fixture(options); f.renderer.setModel(model()); const before = f.renderer.snapshot(), old = f.gl.drawArrays;
  f.gl.drawArrays = (...args) => { old(...args); options.lost = true; }; assert.equal(f.renderer.setProjectionMode('orthographic'), false);
  assert.deepEqual(f.views.map(receipt => receipt && receipt.projectionMode), ['perspective', null]); assert.deepEqual(f.renderer.snapshot(), before); f.renderer.dispose();
});

test('invalid loaded camera and absent model send null only when there is no successfully drawable view', () => {
  const f = fixture(); assert.equal(f.renderer.render(), false); assert.deepEqual(f.views, [null]); assert.equal(f.renderer.render(), false); assert.equal(f.views.length, 1);
  f.renderer.setModel(model()); matchesView(f); const invalid = model(); invalid.camera.position = [...invalid.camera.target]; assert.equal(f.renderer.setModel(invalid), false);
  assert.equal(f.views.length, 3); assert.equal(f.views.at(-1), null); assert.equal(f.renderer.focusAll(), false); assert.equal(f.views.length, 3); f.renderer.dispose();
});

test('consumer exceptions cannot turn success into failure corrupt picking or interfere with rollback and disposal', () => {
  const f = fixture({ throwView: true }); assert.equal(f.renderer.setModel(model()), true); assert.equal(f.renderer.hitTest(160, 120), model().objects[0].instanceId); assert.deepEqual(f.errors, []);
  assert.equal(f.renderer.setProjectionMode('orthographic'), true); matchesView(f); const before = f.renderer.snapshot(); f.gl.uniformMatrix4fv = () => { throw Error('GPU failure after throwing consumer'); };
  assert.equal(f.renderer.setProjectionMode('perspective'), false); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.views.at(-1), null); assert.deepEqual(f.errors, ['GPU failure after throwing consumer']);
  assert.doesNotThrow(() => f.renderer.dispose()); assert.equal(f.events.size, 0); assert.equal(f.documentEvents.size, 0);
  for (const [name, count] of [['deleteShader', 2], ['deleteProgram', 1], ['deleteBuffer', 1], ['deleteVertexArray', 1]]) assert.equal(f.calls.filter(call => call[0] === name).length, count);
});

test('dispose revokes once and no later render model focus gesture or projection can publish a valid receipt', () => {
  const f = fixture(); f.renderer.setModel(model()); f.renderer.dispose(); assert.equal(f.views.at(-1), null); const count = f.views.length;
  f.renderer.dispose(); assert.equal(f.renderer.render(), false); assert.equal(f.renderer.setModel(model()), false); assert.equal(f.renderer.focusAll(), false); assert.equal(f.renderer.resetView(), false); assert.equal(f.renderer.setProjectionMode('orthographic'), false); f.send('wheel', { deltaY: 100 });
  assert.equal(f.views.length, count); assert.equal(f.events.size, 0); assert.equal(f.documentEvents.size, 0);
});

test('a view consumer may dispose after receiving a valid view and the disposal receipt remains the final notification', () => {
  let renderer; const f = fixture({ onViewChange: receipt => { if (receipt) renderer.dispose(); } }); renderer = f.renderer;
  assert.equal(renderer.setModel(model()), true); assert.equal(renderer.snapshot().disposed, true); assert.equal(f.views.length, 2); assert.equal(f.views.at(-1), null);
  renderer.render(); assert.equal(f.views.length, 2);
});
