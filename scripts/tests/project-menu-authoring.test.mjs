import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_PROJECT_MENU_SCRIPT as menu } from '../../engine/godot-project-menu-script.mjs';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply, isScriptDraftProposal } from '../../engine/script-authoring.mjs';
const context = () => ({ sourceToken: 'menu:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: 'Document' }] });
const request = () => ({ starterId: 'godot-project-menu', documentType: 'document', sourcePath: 'documents/scripts/menu.txt' });

test('menu prepares an exact ordinary source draft with no target or author write authority', () => {
  const all = listScriptStarters(), starter = all.find(row => row.id === request().starterId);
  assert.equal(all.filter(row => row.id === starter.id).length, 1);
  assert.equal(starter.content, menu); assert.equal(starter.backendId, 'org.viento.godot4'); assert.equal(starter.languageId, 'gdscript');
  assert.ok(Object.isFrozen(starter)); assert.ok(menu.endsWith('\n')); assert.ok(Buffer.byteLength(menu) < 65536);
  const owner = context(), selected = request(), before = structuredClone({ owner, selected });
  const draft = prepareScriptDraft(owner, selected); assert.ok(isScriptDraftProposal(draft)); assert.ok(Object.isFrozen(draft));
  assert.equal(draft.content, menu); assert.equal(prepareScriptDraftApply(owner, draft).content, menu);
  assert.deepEqual({ owner, selected }, before);
  for (const key of ['sceneId', 'instanceId', 'objectId', 'bindingId', 'parameters', 'inputMap', 'relations', 'save', 'run']) assert.equal(Object.hasOwn(draft, key), false);
  assert.throws(() => prepareScriptDraftApply({ ...owner, sourceToken: 'menu:2' }, draft), { errorCode: 'script_authoring_conflict' });
  assert.throws(() => prepareScriptDraftApply(owner, { ...draft }), { errorCode: 'script_authoring_conflict' });
});
test('menu bootstrap configures only its bounded built-in controller, never arbitrary commands or processing modes', () => {
  for (const token of ['@export var title: String = "Menu"', '@export var display_mode: String = "scene"',
    'get_meta("viento_project_menu")', 'port.has_method("configure")', 'port.configure(title, items_json, display_mode)',
    'typeof(accepted) != TYPE_BOOL or not accepted', 'push_error("Project menu: "']) assert.ok(menu.includes(token), token);
  for (const token of ['Input.', 'InputMap.', 'process_mode', 'PROCESS_MODE', 'get_tree(', '_input(', '_process(', '_physics_process(',
    'write_state(', 'publish_event(', 'request_scene(', 'request_restart(', 'FileAccess', 'load(', 'VIENTO_PROJECT:']) assert.equal(menu.includes(token), false, token);
});
