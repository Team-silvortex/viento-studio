import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const starter = listScriptStarters().find(item => item.id === 'godot-character-intent');
const context = { sourceToken: 'editor:42', documentRoot: 'documents', documentTypes: [{ id: 'document', label: '文档' }] };
const request = { starterId: 'godot-character-intent', documentType: 'document', sourcePath: 'documents/scripts/movement.txt' };

test('character intent starter is an ordinary, immutable Godot script with translated selection text', () => {
  assert.ok(starter); assert.equal(starter.backendId, 'org.viento.godot4'); assert.equal(starter.languageId, 'gdscript');
  assert.ok(Object.isFrozen(starter));
  for (const dictionary of [en, ja]) for (const key of [starter.label, starter.description]) {
    assert.equal(typeof dictionary[key], 'string'); assert.ok(dictionary[key].length); assert.notEqual(dictionary[key], key);
  }
  const proposal = prepareScriptDraft(context, request);
  assert.deepEqual(prepareScriptDraftApply(context, proposal), { ...request, languageId: 'gdscript', backendId: 'org.viento.godot4', content: starter.content });
  assert.throws(() => prepareScriptDraftApply({ ...context, sourceToken: 'stale' }, proposal), { errorCode: 'script_authoring_conflict' });
  for (const key of ['instanceId', 'bindingId', 'physics', 'relations', 'run', 'save']) assert.equal(Object.hasOwn(proposal, key), false);
});

test('starter consumes only the versioned, self-scoped movement intent port', () => {
  assert.match(starter.content, /get_meta\("viento_character_intent"\)/);
  assert.match(starter.content, /port\.protocol_version\(\)/);
  for (const [name, value] of [['left_action', 'ui_left'], ['right_action', 'ui_right'], ['jump_action', 'ui_accept']]) {
    assert.ok(starter.content.includes(`@export var ${name}: String = "${value}"`));
  }
  assert.match(starter.content, /_intent\.submit\(Input\.get_axis\(left_action, right_action\), jump_pressed\)/);
  assert.match(starter.content, /jump_held and not _jump_held/);
  assert.doesNotMatch(starter.content, /get_parent\(|move_and|global_position|velocity|viento_project|publish_event|FileAccess|load\(/);
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot starter submits input edges and treats a refused request as normal', { skip: native ? false : 'Set VIENTO_GODOT_BIN for native starter verification', timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-character-intent-starter-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(dir, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Intent starter harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(dir, 'starter.gd'), starter.content),
    fs.writeFile(path.join(dir, 'test.gd'), harness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', dir, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1',
      XDG_DATA_HOME: path.join(dir, 'data'), XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_CACHE_HOME: path.join(dir, 'cache') },
  });
  assert.match(stdout, /INTENT_STARTER_OK/); assert.doesNotMatch(stdout + stderr, /ERROR:|SCRIPT ERROR|Parse Error|Assertion failed|Leaked/);
});

const harness = String.raw`extends SceneTree

class Port:
	extends RefCounted
	var requests: Array = []
	func protocol_version() -> int:
		return 1
	func submit(axis, jump) -> bool:
		requests.append([axis, jump])
		return requests.size() != 2

func _initialize() -> void:
	call_deferred("run_test")

func run_test() -> void:
	var port = Port.new()
	var actor = load("res://starter.gd").new()
	actor.set_meta("viento_character_intent", port)
	root.add_child(actor)
	actor.set_physics_process(false)
	Input.action_press("ui_right")
	Input.action_press("ui_accept")
	actor._physics_process(0.016)
	actor._physics_process(0.016)
	Input.action_release("ui_accept")
	Input.action_release("ui_right")
	Input.action_press("ui_left")
	actor._physics_process(0.016)
	Input.action_press("ui_accept")
	actor._physics_process(0.016)
	assert(port.requests == [[1.0, true], [1.0, false], [-1.0, false], [-1.0, true]])
	Input.action_release("ui_accept")
	Input.action_release("ui_left")
	root.remove_child(actor)
	actor.free()
	print("INTENT_STARTER_OK")
	quit()
`;
