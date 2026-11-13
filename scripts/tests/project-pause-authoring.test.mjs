import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT as pause } from '../../engine/godot-project-pause-script.mjs';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply, isScriptDraftProposal } from '../../engine/script-authoring.mjs';
const context = () => ({ sourceToken: 'pause:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: 'Document' }] });
const request = () => ({ starterId: 'godot-project-pause', documentType: 'document', sourcePath: 'documents/scripts/pause.txt' });

test('pause prepares an exact ordinary source draft with no target or author write authority', () => {
  const all = listScriptStarters(), starter = all.find(row => row.id === request().starterId);
  assert.equal(all.filter(row => row.id === starter.id).length, 1);
  assert.equal(starter.content, pause); assert.equal(starter.backendId, 'org.viento.godot4'); assert.equal(starter.languageId, 'gdscript');
  assert.ok(Object.isFrozen(starter)); assert.ok(pause.endsWith('\n')); assert.ok(Buffer.byteLength(pause) < 65536);
  const owner = context(), selected = request(), before = structuredClone({ owner, selected });
  const draft = prepareScriptDraft(owner, selected); assert.ok(isScriptDraftProposal(draft)); assert.ok(Object.isFrozen(draft));
  assert.equal(draft.content, pause); assert.equal(prepareScriptDraftApply(owner, draft).content, pause);
  assert.deepEqual({ owner, selected }, before);
  for (const key of ['sceneId', 'instanceId', 'objectId', 'bindingId', 'parameters', 'inputMap', 'relations', 'save', 'run']) assert.equal(Object.hasOwn(draft, key), false);
  assert.throws(() => prepareScriptDraftApply({ ...owner, sourceToken: 'pause:2' }, draft), { errorCode: 'script_authoring_conflict' });
  assert.throws(() => prepareScriptDraftApply(owner, { ...draft }), { errorCode: 'script_authoring_conflict' });
});
test('pause author source delegates only bounded configuration to its independent visit controller', () => {
  for (const token of ['@export var action_name: String = "pause"', '@export var paused_text: String = "Paused"',
    '@export var resume_text: String = "Release controls to resume"', 'get_meta("viento_project_pause")',
    'port.has_method("configure_toggle_action")', 'port.configure_toggle_action(action_name, paused_text, resume_text)',
    'typeof(accepted) != TYPE_BOOL or not accepted', 'push_error("Project pause: "']) assert.ok(pause.includes(token), token);
  for (const token of ['Input.', 'InputMap.', 'process_mode', 'PROCESS_MODE', 'get_tree(', '_input(', '_process(', '_physics_process(',
    'write_state(', 'publish_event(', 'request_scene(', 'request_restart(', 'FileAccess', 'load(', 'VIENTO_PROJECT:']) assert.equal(pause.includes(token), false, token);
});
