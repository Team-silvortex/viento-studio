import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT as source } from '../../engine/godot-project-pause-script.mjs';
import { inspectProjectInputActionReferences as inspect } from '../../engine/project-input-action-diagnostics.mjs';
const id = n => `61616161-6161-4161-8161-${String(n).padStart(12, '0')}`;
function fixture(parameters = {}, content = source) {
  const sourcePath = 'documents/behaviors/pause.json', sourceRevision = 'sha256:' + '1'.repeat(64);
  const binding = { bindingId: id(4), instanceId: id(5), parameters, implementation: { sourceObjectId: id(3) } };
  const document = { record: { id: id(2), sourcePath }, sourcePath, sourceRevision, content: JSON.stringify({ bindings: [binding] }, null, 2) };
  const scenes = [{ scene: { objectId: id(1) }, behaviors: { backendId: 'org.viento.godot4', language: 'gdscript',
    manifest: { objectId: id(2), sourcePath, sourceRevision }, sources: [{ objectId: id(3), content }], bindings: [binding] } }];
  return { scenes, document, diagnostics: map => inspect(scenes, map, [document]) };
}
test('official pause action suggestions respect built-in defaults and project-mapped actions', () => {
  assert.equal(fixture().diagnostics(null)[0].code, 'build_input_action_unconfigured');
  assert.deepEqual(fixture().diagnostics({ actions: [{ name: 'pause', keys: ['KeyP'] }] }), []);
  assert.deepEqual(fixture({ action_name: 'ui_accept' }).diagnostics(null), []);
  assert.deepEqual(fixture({ action_name: 'pause_game' }).diagnostics({ actions: [{ name: 'pause_game', keys: ['KeyR'] }] }), []);
});
test('unmapped pause action warnings preserve manifest revision, binding identity and exact range', () => {
  const f = fixture({ action_name: 'pause_game' }), [row] = f.diagnostics({ actions: [] });
  assert.equal(row.code, 'build_input_action_unmapped'); assert.equal(row.severity, 'warning');
  assert.equal(row.sceneId, id(1)); assert.equal(row.bindingId, id(4)); assert.equal(row.instanceId, id(5));
  assert.equal(row.sourceRevision, f.document.sourceRevision); assert.equal(row.sourceRange.exact, true);
  assert.equal(row.propertyPath, '/bindings/0/parameters/action_name');
  assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), '"pause_game"');
  assert.equal(f.diagnostics(null)[0].code, 'build_input_action_unconfigured');
});
test('input suggestions remain canonical-LF-only and never infer edited pause exports', () => {
  for (const content of [source + '\n', '\uFEFF' + source, source.replaceAll('\n', '\r\n'), source.replace('String = "pause"', 'String = "pause_game"'),
    'extends Node\n@export var action_name: String = "pause_game"\n']) {
    assert.deepEqual(fixture({ action_name: 'missing' }, content).diagnostics(null), []);
  }
});
