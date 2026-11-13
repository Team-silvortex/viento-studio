import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_PROJECT_MENU_SCRIPT as menu } from '../../engine/godot-project-menu-script.mjs';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT as pause } from '../../engine/godot-project-pause-script.mjs';
import { inspectProjectMenuReferences as inspect } from '../../engine/project-menu-diagnostics.mjs';
import { runtimeProject, runtimeId } from './helpers/project-runtime-fixture.mjs';
const invalid = run => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'build_project_menu_invalid');
function fixture(code = menu) {
  const plan = runtimeProject({ behavior: true }), behavior = plan.scenes[0].behaviors;
  behavior.sources[0].content = code; behavior.bindings[0].events = []; behavior.bindings[0].parameters = {};
  const document = { record: { id: behavior.manifest.objectId, sourcePath: behavior.manifest.sourcePath },
    sourcePath: behavior.manifest.sourcePath, sourceRevision: behavior.manifest.sourceRevision, content: '' };
  const write = () => { document.content = '\ufeff' + JSON.stringify({ bindings: behavior.bindings }, null, '\t').replaceAll('\n', '\r\n') + '\r\n'; };
  write(); return { plan, scenes: plan.scenes, behavior, binding: behavior.bindings[0], document, write };
}
function addPause(f, source = pause) {
  const id = runtimeId(99); f.behavior.sources.push({ ...structuredClone(f.behavior.sources[0]), objectId: id, content: source });
  f.behavior.bindings.push({ ...structuredClone(f.binding), bindingId: runtimeId(98), implementation: { ...f.binding.implementation, sourceObjectId: id }, parameters: {} });
}
const items = command => JSON.stringify([{ id: 'choice', label: '开始 · 開始', command }]);
test('default menu is a one-member ordinary author declaration and never alters source data', () => {
  const f = fixture(); f.scenes.splice(1); const before = structuredClone(f.scenes); assert.deepEqual(inspect(f.scenes, [f.document]), []); assert.deepEqual(f.scenes, before);
});
test('menu errors locate exact author parameter values, including nested JSON encoded as ordinary String', () => {
  for (const [parameter, value, reason] of [['title', '', 'title'], ['title', '\ud800', 'title'], ['display_mode', 'pause', 'display_mode'],
    ['items_json', false, 'items_json'], ['items_json', '{', 'items_json'], ['items_json', items('resume'), 'command'],
    ['items_json', '[{"id":"a","id":"b","label":"x","command":"finish"}]', 'duplicate']]) {
    const f = fixture(); f.binding.parameters[parameter] = value; f.write();
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, 'build_project_menu_configuration_invalid'); assert.equal(row.reason, reason); assert.equal(row.parameter, parameter);
    assert.equal(row.propertyPath, '/bindings/0/parameters/' + parameter); assert.equal(row.sourceRange.exact, true);
    assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(value)); assert.ok(Object.isFrozen(row));
  }
});
test('menu scene and retry targets are checked against the complete frozen assembly', () => {
  const f = fixture(), targetSceneId = f.scenes[1].scene.objectId;
  for (const command of ['scene', 'retry']) {
    f.binding.parameters.items_json = JSON.stringify([{ id: 'begin', label: 'Start', command, targetSceneId }]); assert.deepEqual(inspect(f.scenes, []), []);
    for (const target of [f.scenes[0].scene.objectId, runtimeId(999)]) {
      f.binding.parameters.items_json = JSON.stringify([{ id: 'begin', label: 'Start', command, targetSceneId: target }]);
      assert.equal(inspect(f.scenes, [])[0].reason, 'target');
    }
  }
});
test('paused menu requires an exact bound pause controller in the same scene', () => {
  const f = fixture(); f.binding.parameters = { display_mode: 'paused', items_json: items('resume') }; f.write();
  const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, 'build_project_menu_pause_required'); assert.equal(row.propertyPath, '/bindings/0/parameters/display_mode');
  assert.equal(row.sourceRange.exact, true); addPause(f); assert.deepEqual(inspect(f.scenes, []), []);
  f.behavior.sources[1].content += '# custom\n'; assert.equal(inspect(f.scenes, [])[0].code, 'build_project_menu_pause_required');
  f.behavior.sources[1].content = pause; f.behavior.bindings.pop(); assert.equal(inspect(f.scenes, [])[0].code, 'build_project_menu_pause_required');
});
test('one menu per mode permits a scene and paused menu together but diagnoses duplicate binding ranges', () => {
  const f = fixture(); f.behavior.bindings.push({ ...structuredClone(f.binding), bindingId: runtimeId(77) }); f.write();
  const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, 'build_project_menu_duplicate'); assert.equal(row.propertyPath, '/bindings/1'); assert.equal(row.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(f.document.content.slice(row.sourceRange.start, row.sourceRange.end)), f.behavior.bindings[1]);
  f.behavior.bindings[1].parameters = { display_mode: 'paused', items_json: items('resume') }; addPause(f); assert.deepEqual(inspect(f.scenes, []), []);
});
test('edited source, advisory BOM/CRLF, foreign implementations and duplicate source identities acquire no official semantics', () => {
  for (const content of [menu + '\n', '\ufeff' + menu, menu.replaceAll('\n', '\r\n'), pause]) {
    const f = fixture(content); f.binding.parameters = { title: false, items_json: '{', display_mode: false }; assert.deepEqual(inspect(f.scenes, []), []);
  }
  for (const field of ['language', 'backendId']) { const f = fixture(); f.behavior[field] = 'custom'; f.binding.parameters.title = false; assert.deepEqual(inspect(f.scenes, []), []); }
  const f = fixture(); f.behavior.sources.push(structuredClone(f.behavior.sources[0])); f.binding.parameters.title = false; assert.deepEqual(inspect(f.scenes, []), []);
});
test('source range attachment rejects stale or ambiguous author evidence', () => {
  for (const change of [doc => { doc.sourceRevision = 'sha256:' + '0'.repeat(64); }, doc => { doc.sourcePath = 'elsewhere.json'; }, doc => { doc.record.sourcePath = 'elsewhere.json'; }]) {
    const f = fixture(); f.binding.parameters.title = ''; f.write(); change(f.document); assert.equal(Object.hasOwn(inspect(f.scenes, [f.document])[0], 'sourceRange'), false);
  }
  const f = fixture(); f.binding.parameters.title = ''; f.write(); assert.equal(Object.hasOwn(inspect(f.scenes, [f.document, structuredClone(f.document)])[0], 'sourceRange'), false);
});
test('bounded menu inspection does not execute accessors or recursively freeze arbitrary identity objects', () => {
  let calls = 0;
  for (const key of ['title', 'items_json', 'display_mode']) { const f = fixture(); Object.defineProperty(f.binding.parameters, key, { enumerable: true, get() { calls++; return false; } }); invalid(() => inspect(f.scenes, [])); }
  for (const key of ['objectId', 'sourcePath', 'sourceRevision']) { const f = fixture(); f.behavior.manifest[key] = { get bad() { calls++; return false; } }; invalid(() => inspect(f.scenes, [])); }
  invalid(() => inspect(Array(1), [])); invalid(() => inspect(Array(33).fill({}), []));
  const extra = []; extra.extra = true; invalid(() => inspect([], extra));
  const f = fixture(); Object.defineProperty(f.binding.parameters, 'title', { enumerable: false, value: 'Menu' }); invalid(() => inspect(f.scenes, []));
  assert.equal(calls, 0);
});
test('menu diagnostics are bounded with exact omissions and original binding order', () => {
  const f = fixture(); f.binding.parameters.title = '';
  const scenes = Array.from({ length: 5 }, (_, sceneIndex) => { const scene = structuredClone(f.scenes[0]); scene.scene.objectId = runtimeId(200 + sceneIndex);
    scene.behaviors.bindings = Array.from({ length: 32 }, (_, index) => ({ ...structuredClone(f.binding), bindingId: runtimeId(1000 + sceneIndex * 32 + index) })); return scene; });
  const rows = inspect(scenes, []); assert.equal(rows.length, 256); assert.equal(rows[0].bindingId, runtimeId(1000));
  assert.equal(rows[1].code, 'build_project_menu_duplicate'); assert.equal(rows[255].code, 'build_project_menu_limit'); assert.equal(rows[255].omittedCount, 5 * (32 + 31) - 255);
});
