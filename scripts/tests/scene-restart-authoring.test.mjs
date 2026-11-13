import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_SCENE_RESTART_SCRIPT as restart } from '../../engine/godot-scene-restart-script.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT as retry } from '../../engine/godot-scene-retry-script.mjs';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply, isScriptDraftProposal } from '../../engine/script-authoring.mjs';
const context = () => ({ sourceToken: 'restart:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: 'Document' }] });
const request = () => ({ starterId: 'godot-action-scene-restart', documentType: 'document', sourcePath: 'documents/scripts/restart.txt' });

test('restart prepares an exact ordinary source draft with no target or author write authority', () => {
  const all = listScriptStarters(), starter = all.find(row => row.id === request().starterId);
  assert.equal(all.filter(row => row.id === starter.id).length, 1);
  assert.equal(starter.content, restart); assert.equal(starter.backendId, 'org.viento.godot4'); assert.equal(starter.languageId, 'gdscript');
  assert.ok(Object.isFrozen(starter)); assert.ok(restart.endsWith('\n')); assert.ok(Buffer.byteLength(restart) < 65536);
  const owner = context(), selected = request(), before = structuredClone({ owner, selected });
  const draft = prepareScriptDraft(owner, selected); assert.ok(isScriptDraftProposal(draft)); assert.ok(Object.isFrozen(draft));
  assert.equal(draft.content, restart); assert.equal(prepareScriptDraftApply(owner, draft).content, restart);
  assert.deepEqual({ owner, selected }, before);
  for (const key of ['sceneId', 'instanceId', 'objectId', 'bindingId', 'parameters', 'inputMap', 'relations', 'save', 'run']) assert.equal(Object.hasOwn(draft, key), false);
  assert.throws(() => prepareScriptDraftApply({ ...owner, sourceToken: 'restart:2' }, draft), { errorCode: 'script_authoring_conflict' });
  assert.throws(() => prepareScriptDraftApply(owner, { ...draft }), { errorCode: 'script_authoring_conflict' });
});
test('restart retains exact established input/focus and strict parser code while old retry keeps its target contract', () => {
  const input = text => text.slice(text.indexOf('func _process('), text.indexOf('func _fail('));
  assert.equal(input(restart).replace('_project.request_restart(_initial_values)', '_project.request_retry(target_scene_id, _initial_values)'), input(retry));
  assert.equal(restart.slice(restart.indexOf('func _json_space(')), retry.slice(retry.indexOf('func _json_space(')));
  assert.ok(restart.includes('get_meta("viento_project_restart")')); assert.ok(restart.includes('project.has_method("request_restart")'));
  for (const token of ['target_scene_id', 'func _uuid(', 'request_retry', 'get_tree().reload', 'InputMap.add']) assert.equal(restart.includes(token), false, token);
  assert.ok(retry.includes('@export var target_scene_id: String = ""'));
  assert.ok(retry.includes('_project.request_retry(target_scene_id, _initial_values)'));
  assert.equal(listScriptStarters().find(row => row.id === 'godot-action-scene-retry').content, retry);
});
