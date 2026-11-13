import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_SCENE_RESTART_SCRIPT as restart } from '../../engine/godot-scene-restart-script.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT as retry } from '../../engine/godot-scene-retry-script.mjs';
import { inspectProjectSceneRestartReferences as inspect } from '../../engine/project-scene-restart-diagnostics.mjs';
import { runtimeProject, runtimeId } from './helpers/project-runtime-fixture.mjs';
const invalidInspection = run => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'build_scene_restart_invalid');
function fixture(code = restart) {
  const plan = runtimeProject({ behavior: true }), behavior = plan.scenes[0].behaviors;
  behavior.sources[0].content = code; behavior.bindings[0].events = [];
  behavior.bindings[0].parameters = {};
  const document = { record: { id: behavior.manifest.objectId, sourcePath: behavior.manifest.sourcePath },
    sourcePath: behavior.manifest.sourcePath, sourceRevision: behavior.manifest.sourceRevision, content: '' };
  const write = () => { document.content = '\ufeff' + JSON.stringify({ bindings: behavior.bindings }, null, '\t').replaceAll('\n', '\r\n') + '\r\n'; };
  write(); return { scenes: plan.scenes, behavior, binding: behavior.bindings[0], document, write };
}

test('only exact restart source requires no target and admits a one-member assembly and default initializer without altering authors', () => {
  const f = fixture(), before = structuredClone(f.scenes);
  assert.deepEqual(inspect(f.scenes, [f.document]), []); assert.deepEqual(f.scenes, before);
  f.scenes.splice(1); f.binding.parameters.state_values_json = '{}'; f.binding.parameters.action_name = 'menu_retry';
  assert.deepEqual(inspect(f.scenes, [f.document]), []);
});

test('restart action and JSON errors are blocking parameter diagnostics with exact author ranges', () => {
  for (const [parameter, value, code, reason] of [
    ['action_name', '', 'build_scene_restart_parameter_invalid', 'action'],
    ['action_name', false, 'build_scene_restart_parameter_invalid', 'action'],
    ['action_name', '\ud800', 'build_scene_restart_parameter_invalid', 'action'],
    ['state_values_json', false, 'build_scene_restart_values_invalid', 'type'],
    ['state_values_json', '{"score":0,"\\u0073core":2}', 'build_scene_restart_values_invalid', 'json'],
    ['state_values_json', '\ufeff{}', 'build_scene_restart_values_invalid', 'json'],
    ['state_values_json', '{"score":1e309}', 'build_scene_restart_values_invalid', 'value'],
    ['state_values_json', JSON.stringify({ a: '界'.repeat(1363) }), 'build_scene_restart_values_invalid', 'text'],
  ]) {
    const f = fixture(); f.binding.parameters[parameter] = value; f.write();
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, code); assert.equal(row.reason, reason);
    assert.equal(row.parameter, parameter); assert.equal(row.propertyPath, '/bindings/0/parameters/' + parameter);
    assert.equal(row.sourceRange.exact, true); assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(value));
  }
});

test('edited restart sources, old retry, other languages and duplicate source identities are never inferred', () => {
  for (const code of [restart + '\n', '\ufeff' + restart, restart.replaceAll('\n', '\r\n'), retry]) {
    const f = fixture(code); f.binding.parameters = { target_scene_id: '', action_name: false, state_values_json: '{' };
    assert.deepEqual(inspect(f.scenes, [f.document]), []);
  }
  for (const field of ['backendId', 'language']) {
    const f = fixture(); f.behavior[field] = 'custom'; f.binding.parameters.action_name = '';
    assert.deepEqual(inspect(f.scenes, []), []);
  }
  const f = fixture(); f.behavior.sources.push(structuredClone(f.behavior.sources[0])); f.binding.parameters.action_name = '';
  assert.deepEqual(inspect(f.scenes, []), []);
});

test('restart source locations are omitted for stale or ambiguous author identity', () => {
  for (const change of [doc => { doc.sourceRevision = 'sha256:' + '0'.repeat(64); }, doc => { doc.sourcePath = 'elsewhere.json'; }, doc => { doc.record.sourcePath = 'elsewhere.json'; }]) {
    const f = fixture(); f.binding.parameters.state_values_json = '{'; f.write(); change(f.document);
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.reason, 'json'); assert.equal(Object.hasOwn(row, 'sourceRange'), false);
  }
  const f = fixture(); f.binding.parameters.state_values_json = '{'; f.write();
  assert.equal(Object.hasOwn(inspect(f.scenes, [f.document, structuredClone(f.document)])[0], 'sourceRange'), false);
});

test('bounded restart inspection rejects accessors, sparse lists and hidden fields without invoking callers', () => {
  let calls = 0;
  for (const parameter of ['action_name', 'state_values_json']) {
    const f = fixture(); Object.defineProperty(f.binding.parameters, parameter, { enumerable: true, get() { calls++; return '{}'; } });
    invalidInspection(() => inspect(f.scenes, []));
  }
  assert.equal(calls, 0);
  const f = fixture(); Object.defineProperty(f.binding.parameters, 'state_values_json', { enumerable: false, value: '{}' });
  invalidInspection(() => inspect(f.scenes, [])); invalidInspection(() => inspect(Array(1), []));
  invalidInspection(() => inspect(Array(33).fill({}), []));
  const extra = []; extra.extra = true; invalidInspection(() => inspect([], extra));
  const bindings = fixture(); bindings.behavior.bindings = Array(33).fill(bindings.binding); invalidInspection(() => inspect(bindings.scenes, []));
  const sources = fixture(); sources.behavior.sources = Array(9).fill(sources.behavior.sources[0]); invalidInspection(() => inspect(sources.scenes, []));
});

test('restart diagnostic truncation preserves order and exact omission counts', () => {
  for (const count of [256, 288, 320]) {
    const f = fixture(); f.binding.parameters.action_name = '';
    const scenes = Array.from({ length: Math.ceil(count / 32) }, (_, sceneIndex) => {
      const scene = structuredClone(f.scenes[0]); scene.scene.objectId = runtimeId(100 + sceneIndex);
      scene.behaviors.bindings = Array.from({ length: Math.min(32, count - sceneIndex * 32) }, (_, index) => ({ ...structuredClone(f.binding), bindingId: runtimeId(1000 + sceneIndex * 32 + index) }));
      return scene;
    });
    const rows = inspect(scenes, []); assert.equal(rows.length, 256); assert.equal(Object.isFrozen(rows), true);
    assert.equal(rows[0].bindingId, runtimeId(1000)); assert.equal(rows[254].bindingId, runtimeId(1254));
    assert.equal(rows[255].code, count === 256 ? 'build_scene_restart_parameter_invalid' : 'build_scene_restart_limit');
    if (count > 256) assert.equal(rows[255].omittedCount, count - 255);
  }
});


test('malformed restart provenance rejects object values without freezing or invoking their accessors', () => {
  let calls = 0;
  const poisoned = () => ({ get unexpected() { calls++; return 'called'; } });
  for (const field of ['objectId', 'sourcePath', 'sourceRevision']) {
    const f = fixture(); f.binding.parameters.action_name = ''; f.behavior.manifest[field] = poisoned();
    invalidInspection(() => inspect(f.scenes, []));
  }
  for (const field of ['bindingId', 'instanceId']) {
    const f = fixture(); f.binding.parameters.action_name = ''; f.binding[field] = poisoned();
    invalidInspection(() => inspect(f.scenes, []));
  }
  const f = fixture(); f.binding.parameters.action_name = ''; f.scenes[0].scene.objectId = poisoned();
  invalidInspection(() => inspect(f.scenes, [])); assert.equal(calls, 0);
});
