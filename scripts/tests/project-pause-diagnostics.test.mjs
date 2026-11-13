import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT as pause } from '../../engine/godot-project-pause-script.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT as retry } from '../../engine/godot-scene-retry-script.mjs';
import { inspectProjectPauseReferences as inspect } from '../../engine/project-pause-diagnostics.mjs';
import { runtimeProject, runtimeId } from './helpers/project-runtime-fixture.mjs';
const invalidInspection = run => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'build_project_pause_invalid');
function fixture(code = pause) {
  const plan = runtimeProject({ behavior: true }), behavior = plan.scenes[0].behaviors;
  behavior.sources[0].content = code; behavior.bindings[0].events = [];
  behavior.bindings[0].parameters = {};
  const document = { record: { id: behavior.manifest.objectId, sourcePath: behavior.manifest.sourcePath },
    sourcePath: behavior.manifest.sourcePath, sourceRevision: behavior.manifest.sourceRevision, content: '' };
  const write = () => { document.content = '\ufeff' + JSON.stringify({ bindings: behavior.bindings }, null, '\t').replaceAll('\n', '\r\n') + '\r\n'; };
  write(); return { scenes: plan.scenes, behavior, binding: behavior.bindings[0], document, write };
}

test('only exact pause source requires no target and admits a one-member assembly and default display text without altering authors', () => {
  const f = fixture(), before = structuredClone(f.scenes);
  assert.deepEqual(inspect(f.scenes, [f.document]), []); assert.deepEqual(f.scenes, before);
  f.scenes.splice(1); f.binding.parameters.paused_text = '暂停中 😀'; f.binding.parameters.action_name = 'menu_retry';
  assert.deepEqual(inspect(f.scenes, [f.document]), []);
});

test('pause action and display errors are blocking parameter diagnostics with exact author ranges', () => {
  for (const [parameter, value, code, reason] of [
    ['action_name', '', 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', false, 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', '\ud800', 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', 'ui_cancel', 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', 'a'.repeat(65), 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', 'Pause', 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', 'pause\n', 'build_project_pause_parameter_invalid', 'action'],
    ['action_name', 'pause\r', 'build_project_pause_parameter_invalid', 'action'],
    ['paused_text', '', 'build_project_pause_text_invalid', 'text'],
    ['paused_text', null, 'build_project_pause_text_invalid', 'text'],
    ['paused_text', '\ud800', 'build_project_pause_text_invalid', 'text'],
    ['paused_text', 'line\nnext', 'build_project_pause_text_invalid', 'text'],
    ['paused_text', '\u0085', 'build_project_pause_text_invalid', 'text'],
    ['resume_text', '😀'.repeat(161), 'build_project_pause_text_invalid', 'text'],
    ['resume_text', '界'.repeat(161), 'build_project_pause_text_invalid', 'text'],
  ]) {
    const f = fixture(); f.binding.parameters[parameter] = value; f.write();
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, code); assert.equal(row.reason, reason);
    assert.equal(row.parameter, parameter); assert.equal(row.propertyPath, '/bindings/0/parameters/' + parameter);
    assert.equal(row.sourceRange.exact, true); assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(value));
  }
});

test('edited pause sources, old retry, other languages and duplicate source identities are never inferred', () => {
  for (const code of [pause + '\n', '\ufeff' + pause, pause.replaceAll('\n', '\r\n'), retry]) {
    const f = fixture(code); f.binding.parameters = { target_scene_id: '', action_name: false, paused_text: false, resume_text: false };
    assert.deepEqual(inspect(f.scenes, [f.document]), []);
  }
  for (const field of ['backendId', 'language']) {
    const f = fixture(); f.behavior[field] = 'custom'; f.binding.parameters.action_name = '';
    assert.deepEqual(inspect(f.scenes, []), []);
  }
  const f = fixture(); f.behavior.sources.push(structuredClone(f.behavior.sources[0])); f.binding.parameters.action_name = '';
  assert.deepEqual(inspect(f.scenes, []), []);
});

test('pause source locations are omitted for stale or ambiguous author identity', () => {
  for (const change of [doc => { doc.sourceRevision = 'sha256:' + '0'.repeat(64); }, doc => { doc.sourcePath = 'elsewhere.json'; }, doc => { doc.record.sourcePath = 'elsewhere.json'; }]) {
    const f = fixture(); f.binding.parameters.paused_text = ''; f.write(); change(f.document);
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.reason, 'text'); assert.equal(Object.hasOwn(row, 'sourceRange'), false);
  }
  const f = fixture(); f.binding.parameters.paused_text = ''; f.write();
  assert.equal(Object.hasOwn(inspect(f.scenes, [f.document, structuredClone(f.document)])[0], 'sourceRange'), false);
});

test('bounded pause inspection rejects accessors, sparse lists and hidden fields without invoking callers', () => {
  let calls = 0;
  for (const parameter of ['action_name', 'paused_text', 'resume_text']) {
    const f = fixture(); Object.defineProperty(f.binding.parameters, parameter, { enumerable: true, get() { calls++; return '{}'; } });
    invalidInspection(() => inspect(f.scenes, []));
  }
  assert.equal(calls, 0);
  const f = fixture(); Object.defineProperty(f.binding.parameters, 'paused_text', { enumerable: false, value: 'Paused' });
  invalidInspection(() => inspect(f.scenes, [])); invalidInspection(() => inspect(Array(1), []));
  invalidInspection(() => inspect(Array(33).fill({}), []));
  const extra = []; extra.extra = true; invalidInspection(() => inspect([], extra));
  const bindings = fixture(); bindings.behavior.bindings = Array(33).fill(bindings.binding); invalidInspection(() => inspect(bindings.scenes, []));
  const sources = fixture(); sources.behavior.sources = Array(9).fill(sources.behavior.sources[0]); invalidInspection(() => inspect(sources.scenes, []));
});

test('pause diagnostic truncation preserves order and exact omission counts', () => {
  const f = fixture(); f.binding.parameters = { action_name: '', paused_text: '', resume_text: '' };
  const scenes = Array.from({ length: 4 }, (_, sceneIndex) => {
    const scene = structuredClone(f.scenes[0]); scene.scene.objectId = runtimeId(100 + sceneIndex);
    scene.behaviors.bindings = Array.from({ length: 32 }, (_, index) => ({ ...structuredClone(f.binding), bindingId: runtimeId(1000 + sceneIndex * 32 + index) }));
    return scene;
  });
  // Each scene's first binding has three parameter diagnostics; its other 31
  // bindings each add a duplicate diagnostic, for 508 actual errors.
  const rows = inspect(scenes, []); assert.equal(rows.length, 256); assert.equal(Object.isFrozen(rows), true);
  assert.equal(rows[0].bindingId, runtimeId(1000)); assert.equal(rows[0].parameter, 'action_name');
  assert.equal(rows[3].bindingId, runtimeId(1001)); assert.equal(rows[3].code, 'build_project_pause_duplicate');
  assert.equal(rows[255].code, 'build_project_pause_limit'); assert.equal(rows[255].omittedCount, 508 - 255);
});



test('malformed pause provenance rejects object values without freezing or invoking their accessors', () => {
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

test('pause display bounds count Unicode characters and preserve exact multilingual text', () => {
  for (const text of ['Paused', '暂停中', '一時停止中', '😀'.repeat(160), 'e\u0301'.repeat(80), ' ']) {
    const f = fixture(); f.binding.parameters.paused_text = text; f.binding.parameters.resume_text = text;
    const before = structuredClone(f.scenes); assert.deepEqual(inspect(f.scenes, []), []); assert.deepEqual(f.scenes, before);
  }
  for (const action of ['pause', 'pause_game', 'a'.repeat(64), 'ui_accept', 'ui_left']) {
    const f = fixture(); f.binding.parameters.action_name = action; assert.deepEqual(inspect(f.scenes, []), []);
  }
});

test('one official pause binding per scene is required, with exact duplicate-binding provenance', () => {
  const f = fixture(); f.behavior.bindings.push({ ...structuredClone(f.binding), bindingId: runtimeId(999) }); f.write();
  const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, 'build_project_pause_duplicate'); assert.equal(row.reason, 'duplicate');
  assert.equal(row.bindingId, runtimeId(999)); assert.equal(row.propertyPath, '/bindings/1'); assert.equal(row.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(f.document.content.slice(row.sourceRange.start, row.sourceRange.end)), f.behavior.bindings[1]);
  const other = structuredClone(f.scenes[0]); other.behaviors.bindings.splice(1); other.scene.objectId = runtimeId(998);
  f.behavior.bindings.splice(1); assert.deepEqual(inspect([f.scenes[0], other], []), []);
  f.behavior.sources.push({ ...structuredClone(f.behavior.sources[0]), objectId: runtimeId(997) });
  assert.deepEqual(inspect(f.scenes, []), [], 'an unbound official source does not configure another controller');
  f.behavior.bindings.push({ ...structuredClone(f.binding), bindingId: runtimeId(996), implementation: { sourceObjectId: runtimeId(995) } });
  f.behavior.sources.push({ ...structuredClone(f.behavior.sources[0]), objectId: runtimeId(995), content: pause + '# custom\n' });
  assert.deepEqual(inspect(f.scenes, []), [], 'an edited source never acquires official pause semantics');
});
