import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProjectSceneNavigationReferences as inspect } from '../../engine/project-scene-navigation-diagnostics.mjs';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT as action, GODOT_EVENT_SCENE_SWITCH_SCRIPT as event } from '../../engine/godot-scene-navigation-scripts.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { runtimeProject, runtimeId } from './helpers/project-runtime-fixture.mjs';

function fixture(code = action) {
  const plan = runtimeProject({ behavior:true }), behavior = plan.scenes[0].behaviors;
  behavior.sources[0].content = code;
  behavior.bindings[0].parameters = { target_scene_id:plan.scenes[1].scene.objectId };
  behavior.bindings[0].events = [];
  const content = '\ufeff' + JSON.stringify({ bindings:behavior.bindings }, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  const document = { record:{ id:behavior.manifest.objectId, sourcePath:behavior.manifest.sourcePath },
    sourcePath:behavior.manifest.sourcePath, sourceRevision:behavior.manifest.sourceRevision, content };
  return { plan, scenes:plan.scenes, behavior, binding:behavior.bindings[0], document };
}
const rejected = run => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'build_scene_navigation_invalid');

test('both exact starters admit member targets and optional defaults without altering authors', () => {
  for (const code of [action, event]) {
    const f = fixture(code), before = structuredClone(f.scenes);
    assert.deepEqual(inspect(f.scenes, [f.document]), []);
    assert.deepEqual(f.scenes, before);
  }
});

test('target errors preserve scene, binding, instance and exact UTF-16 source provenance', () => {
  for (const [target, reason] of [['', 'required'], [false, 'uuid'], [runtimeId(10).toUpperCase(), 'uuid'], [runtimeId(90), 'member']]) {
    const f = fixture(); f.binding.parameters.target_scene_id = target;
    f.document.content = '\ufeff' + JSON.stringify({ bindings:[f.binding] }, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
    const rows = inspect(f.scenes, [f.document]); assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.code, 'build_scene_navigation_target_invalid'); assert.equal(row.reason, reason); assert.equal(row.severity, 'error');
    assert.equal(row.sceneId, f.scenes[0].scene.objectId); assert.equal(row.bindingId, f.binding.bindingId); assert.equal(row.instanceId, f.binding.instanceId);
    assert.equal(row.objectId, f.document.record.id); assert.equal(row.sourcePath, f.document.sourcePath); assert.equal(row.sourceRevision, f.document.sourceRevision);
    assert.equal(row.propertyPath, '/bindings/0/parameters/target_scene_id'); assert.equal(row.sourceRange.exact, true);
    assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(target));
    assert.ok(Object.isFrozen(rows) && Object.isFrozen(row) && Object.isFrozen(row.sourceRange));
    assert.throws(() => { row.sourceRange.start = 0; }, TypeError);
  }
  const f = fixture(); f.binding.parameters.target_scene_id = f.scenes[0].scene.objectId;
  assert.equal(inspect(f.scenes, [f.document])[0].reason, 'current');
});

test('missing target is required and selects the nearest real author object without fabricating a range', () => {
  const f = fixture(); delete f.binding.parameters.target_scene_id;
  f.document.content = JSON.stringify({ bindings:[f.binding] });
  const [row] = inspect(f.scenes, [f.document]);
  assert.equal(row.reason, 'required'); assert.equal(row.sourceRange.exact, false);
  assert.equal(row.sourceRange.propertyPath, '/bindings/0/parameters');
  assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), '{}');
  delete f.binding.parameters;
  f.document.content = JSON.stringify({ bindings:[f.binding] });
  assert.equal(inspect(f.scenes, [f.document])[0].sourceRange.propertyPath, '/bindings/0');
});

test('action values remain ordinary nonempty text while event/filter bounds mirror existing ports', () => {
  const f = fixture();
  for (const value of ['start_game', '動作.開始', 'ui_accept', 'x'.repeat(4096)]) {
    f.binding.parameters.action_name = value; assert.deepEqual(inspect(f.scenes, []), []);
  }
  for (const value of ['', false, 0, '\ud800', 'x'.repeat(4097)]) {
    f.binding.parameters.action_name = value;
    const [row] = inspect(f.scenes, []); assert.equal(row.parameter, 'action_name'); assert.equal(row.reason, 'action');
  }
  const e = fixture(event);
  for (const value of ['game.complete', 'A'.repeat(64)]) { e.binding.parameters.event_name = value; assert.deepEqual(inspect(e.scenes, []), []); }
  for (const value of ['', '1event', 'game.complete\n', 'constructor', 'prototype', '__proto__', false, 'x'.repeat(65)]) {
    e.binding.parameters.event_name = value;
    const [row] = inspect(e.scenes, []); assert.equal(row.code, 'build_scene_navigation_parameter_invalid'); assert.equal(row.reason, 'event');
  }
  delete e.binding.parameters.event_name;
  for (const value of ['', '界'.repeat(1365) + 'a', '😀'.repeat(1024), '\0\t\n\r']) {
    e.binding.parameters.payload_filter = value; assert.deepEqual(inspect(e.scenes, []), []);
  }
  for (const value of [0, false, '\udfff', '界'.repeat(1366), '😀'.repeat(1025)]) {
    e.binding.parameters.payload_filter = value;
    const [row] = inspect(e.scenes, []); assert.equal(row.parameter, 'payload_filter'); assert.equal(row.reason, 'filter');
  }
});

test('edited starters, old ready navigation, other language and backend are never inferred', () => {
  const legacy = listScriptStarters().find(item => item.id === 'godot-scene-switch'); assert.ok(legacy);
  for (const code of [action + '\n', '\ufeff' + action, action.replaceAll('\n', '\r\n'), event + '\n# author edit', legacy.content]) {
    const f = fixture(code); f.binding.parameters = { target_scene_id:'', action_name:false, event_name:'', payload_filter:false };
    assert.deepEqual(inspect(f.scenes, [f.document]), []);
  }
  for (const field of ['backendId', 'language']) {
    const f = fixture(); f.behavior[field] = 'custom'; f.binding.parameters.target_scene_id = '';
    assert.deepEqual(inspect(f.scenes, []), []);
  }
});

test('range lookup rejects ambiguous or stale author identity without losing the actual diagnostic', () => {
  for (const edit of [doc => { doc.sourceRevision = 'sha256:' + '0'.repeat(64); }, doc => { doc.sourcePath = 'elsewhere.json'; }, doc => { doc.record.sourcePath = 'elsewhere.json'; }]) {
    const f = fixture(); f.binding.parameters.target_scene_id = ''; edit(f.document);
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.reason, 'required'); assert.equal(Object.hasOwn(row, 'sourceRange'), false);
  }
  const f = fixture(); f.binding.parameters.target_scene_id = '';
  assert.equal(Object.hasOwn(inspect(f.scenes, [f.document, structuredClone(f.document)])[0], 'sourceRange'), false);
  f.behavior.sources.push(structuredClone(f.behavior.sources[0]));
  assert.deepEqual(inspect(f.scenes, []), []);
});

test('bounded captured lists and known data fields reject accessors, sparse entries and hidden fields without invoking them', () => {
  let calls = 0;
  const f = fixture(); Object.defineProperty(f.binding.parameters, 'target_scene_id', { enumerable:true, get() { calls++; return f.scenes[1].scene.objectId; } });
  rejected(() => inspect(f.scenes, [])); assert.equal(calls, 0);
  const hidden = fixture(); Object.defineProperty(hidden.binding.parameters, 'target_scene_id', { enumerable:false, value:hidden.scenes[1].scene.objectId });
  rejected(() => inspect(hidden.scenes, []));
  const sparse = Array(1); rejected(() => inspect(sparse, []));
  const array = fixture().scenes; Object.defineProperty(array, '0', { enumerable:true, get() { calls++; return f.scenes[0]; } });
  rejected(() => inspect(array, [])); assert.equal(calls, 0);
  rejected(() => inspect(Array(33).fill({}), []));
  const extra = []; extra.extra = 1; rejected(() => inspect([], extra));
  const manyBindings = fixture(); manyBindings.behavior.bindings = Array(33).fill(manyBindings.binding); rejected(() => inspect(manyBindings.scenes, []));
});

test('up to 256 errors remain ordered; truncation reserves one precise omission marker', () => {
  for (const count of [256, 288, 320]) {
    const f = fixture(); f.binding.parameters.target_scene_id = '';
    const scenes = Array.from({ length:Math.ceil(count / 32) }, (_, sceneIndex) => {
      const scene = structuredClone(f.scenes[0]); scene.scene.objectId = runtimeId(100 + sceneIndex);
      scene.behaviors.bindings = Array.from({ length:Math.min(32, count - sceneIndex * 32) }, (_, index) => ({ ...structuredClone(f.binding), bindingId:runtimeId(1000 + sceneIndex * 32 + index) }));
      return scene;
    });
    const rows = inspect(scenes, []); assert.equal(rows.length, 256);
    assert.equal(rows[0].sceneId, runtimeId(100)); assert.equal(rows[31].bindingId, runtimeId(1031));
    assert.equal(rows.at(-1).code, count === 256 ? 'build_scene_navigation_target_invalid' : 'build_scene_navigation_limit');
    if (count > 256) assert.equal(rows.at(-1).omittedCount, count - 255);
    assert.ok(Object.isFrozen(rows));
  }
});
