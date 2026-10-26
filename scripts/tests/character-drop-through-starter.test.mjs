import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listScriptStarters, prepareScriptDraft, isScriptDraftProposal, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import { getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { GODOT_CHARACTER_DROP_THROUGH_SCRIPT as source } from '../../engine/godot-character-drop-through-script.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const starterId = 'godot-character-drop-through';
const context = () => ({ sourceToken: 'character-drop:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: '档案' }] });
const request = (root = 'documents') => ({ starterId, documentType: 'document', sourcePath: `${root}/scripts/单向平台下穿.txt` });
const hash = value => createHash('sha256').update(value).digest('hex');

// Full records captured before adding this starter, including free-planar contacts.
const legacy = {
  "godot-node": "f7c9c42ce0c1ad057ddfa5f41662dacccac5386298e800c8c5a11a54e88fe5b9",
  "godot-signal": "7b97068f8af94a322f16085836ffc0b7c37014892acdba18c3f2bd71a1b72495",
  "bevy-rust": "894cdc4c6264e9895ea1de0772c58e3b070b303fac70de8caba0ce0b994eab50",
  "bevy-rust-signal": "daeebeafa99ff07a6d42d01c1eb6ae14765575ad9b2c8358cd34f300338004b3",
  "bevy-rust-motion": "fa7a22820fa9a99d42a91803b1b71cd7b34dd6dccea77f9032a3707e68125761",
  "godot-scene-switch": "5c7725bdc9368c7032867e09cd8fb9fa282a2c394f50c09d763deba8f86b6ca6",
  "godot-project-state": "15ff5e01230fcfcc4b27da4a9e92b7f5522540165ab8162ad00f1367c088431a",
  "godot-project-events": "134fd0b43371bdbc386aefd1b2e276b2c8e3ba8a9935f0d14a9f413bfcba6fe9",
  "godot-physics-sensor": "9a62b5cc9f648a9a5ceb47544975397e025812c60890415c8380e4262356221c",
  "godot-character-motion-events": "8609f61352e60153cdc092ea1659cb360e512132090c0d554856b867c5e9276a",
  "godot-character-contact-events": "e9be3d223fc1256929d8073b4227d73e3a97b6dc6d61bc0c9aa1b66192d53f18",
  "godot-project-event-audio": "3afab14ffab40e59f57a6ca7bef2e83870c6e6a1a8129a4d26ea2cf51b7c3be6",
  "godot-project-audio": "996427e086f4a00794c1395669e13405720e9ee7c757070c6d59c7dbe74b78b7",
  "godot-project-animation": "ef30751c0eeda5792b32968c8ee208de8f1ac196ad615564bc37d036073e673a",
  "godot-project-animation-clip": "31a7175fc3045337203df565d14f288532de36449f95a627d33bfbadc2bb8d66",
  "godot-project-animation-event": "38812ff2ba95b913ab2ecc110be3697259bfe9735d08b8c28682956b7399bc78",
  "godot-project-animation-completion": "1909c15074e1e037abe042e09446ac339a68fa5fb362cdda0d104464fc966d84",
  "godot-project-animation-state-table": "608d6a5c7a087fcfb17b084d7c2194b27a4130f43e580bc0fc9e3cbd062ac666"
};

test('drop-through starter adds exactly one record while preserving all 18 previous records byte-for-byte', () => {
  const all = listScriptStarters();
  assert.equal(Object.keys(legacy).length, 18);
  assert.deepEqual(all.filter(row => !Object.hasOwn(legacy, row.id)).map(row => row.id), [starterId, 'godot-platform-endpoint-events']);
  assert.equal(all.length, 20);
  assert.equal(new Set(all.map(row => row.id)).size, all.length);
  for (const [id, expected] of Object.entries(legacy)) assert.equal(hash(JSON.stringify(all.find(row => row.id === id))), expected, id);
  const row = all.find(item => item.id === starterId);
  assert.deepEqual(Object.keys(row), ['id', 'languageId', 'backendId', 'label', 'description', 'content']);
  assert.equal(row.languageId, 'gdscript'); assert.equal(row.backendId, 'org.viento.godot4');
  assert.equal(row.content, source); assert.ok(source.endsWith('\n')); assert.ok(Object.isFrozen(row));
});

test('drop-through prepares only an ordinary TXT draft with no implicit physics, binding, registration or execution authority', () => {
  assert.equal(getStudioCoreMetadata().ready, false);
  for (const documentRoot of ['documents', '作品/原文']) {
    const current = { ...context(), documentRoot }, selected = request(documentRoot), before = structuredClone({ current, selected });
    const proposal = prepareScriptDraft(current, selected);
    assert.ok(isScriptDraftProposal(proposal)); assert.ok(Object.isFrozen(proposal));
    assert.equal(proposal.format, 'viento-script-draft'); assert.equal(proposal.schemaVersion, 1);
    assert.deepEqual(prepareScriptDraftApply(current, proposal), { ...selected, languageId: 'gdscript', backendId: 'org.viento.godot4', content: source });
    assert.deepEqual({ current, selected }, before);
    for (const key of ['bindingId', 'objectId', 'instanceId', 'parameters', 'events', 'relations', 'physics', 'run', 'save']) assert.equal(Object.hasOwn(proposal, key), false);
  }
});

test('drop-through draft rejects stale contexts, unbranded copies and caller-supplied content or parameters', () => {
  const current = context(), selected = request(), proposal = prepareScriptDraft(current, selected);
  for (const altered of [{ ...current, sourceToken: 'new-session' }, { ...current, documentRoot: 'other' },
    { ...current, documentTypes: [{ id: 'document', label: 'Changed' }] }]) {
    assert.throws(() => prepareScriptDraftApply(altered, proposal), { errorCode: 'script_authoring_conflict' });
  }
  assert.throws(() => prepareScriptDraftApply(current, { ...proposal }), { errorCode: 'script_authoring_conflict' });
  for (const extra of [{ content: 'extends Node\n' }, { parameters: {} }, { sourcePath: '../outside.txt' }]) {
    assert.throws(() => prepareScriptDraft(current, { ...selected, ...extra }), { errorCode: 'script_authoring_invalid' });
  }
});

test('drop-through source exposes one ordinary input parameter and consumes only the self-scoped versioned request port', () => {
  assert.deepEqual(Array.from(source.matchAll(/@export var (\w+): (\w+) = ([^\n]+)/g), match => match.slice(1)), [['drop_action','String','"ui_down"']]);
  assert.match(source, /get_meta\("viento_character_drop"\)/);
  assert.match(source, /_port_method\(drop, "protocol_version", TYPE_INT\)/);
  assert.match(source, /_port_method\(drop, "request_drop", TYPE_BOOL\)/);
  assert.match(source, /var rising := pressed and not _held/);
  assert.match(source, /typeof\(accepted\) != TYPE_BOOL/);
  assert.doesNotMatch(source, /not accepted|viento_project|publish_event|signal |get_parent\(|move_and|is_on_floor|grounded|position|velocity|collision_mask|VIENTO_|print\(|call_deferred|FileAccess|load\(/);
});

test('drop-through starter label and exact description have English and Japanese translations', () => {
  const row = listScriptStarters().find(item => item.id === starterId);
  for (const dictionary of [en, ja]) for (const key of [row.label, row.description]) {
    assert.equal(typeof dictionary[key], 'string', key); assert.ok(dictionary[key].length); assert.notEqual(dictionary[key], key);
  }
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot validates request signatures, input rising edges, normal refusals and lifecycle cleanup', {
  skip: native ? false : 'Set VIENTO_GODOT_BIN for native drop-through starter verification', timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-character-drop-starter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Character drop-through starter harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(directory, 'drop.gd'), source), fs.writeFile(path.join(directory, 'test.gd'), nativeHarness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', directory, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.host/data'),
      XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') },
  });
  const log = stdout + stderr;
  assert.match(stdout, /CHARACTER_DROP_STARTER_OK:17/);
  assert.doesNotMatch(log, /SCRIPT ERROR:|Parse Error|Compile Error|Assertion failed|Leaked|leaked/);
  const errors = log.split('\n').filter(line => line.startsWith('ERROR:'));
  assert.equal(errors.length, 14, log);
  assert.ok(errors.every(line => line.startsWith('ERROR: Character drop-through: ')), log);
});

const nativeHarness = String.raw`extends SceneTree
const Starter = preload("res://drop.gd")
const ACTION := "test_drop_action"

class Port extends RefCounted:
	var calls := 0
	var accepted := true
	func protocol_version() -> int:
		return 1
	func request_drop() -> bool:
		calls += 1
		return accepted

class OldPort extends Port:
	func protocol_version() -> int:
		return 0

class MissingRequest extends RefCounted:
	func protocol_version() -> int:
		return 1

class WrongArity extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_drop(_value: int = 0) -> bool:
		return true

class WrongReturn extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_drop() -> int:
		return 1

class UntypedVersion extends RefCounted:
	func protocol_version():
		return 1
	func request_drop() -> bool:
		return true

class UntypedRequest extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_drop():
		return true

class NodePort extends Node:
	func protocol_version() -> int:
		return 1
	func request_drop() -> bool:
		return true

var checked := 0

func starter(port):
	var instance = Starter.new()
	instance.drop_action = ACTION
	if port != null:
		instance.set_meta("viento_character_drop", port)
	return instance

func step(instance, pressed: bool) -> void:
	if pressed:
		Input.action_press(ACTION)
	else:
		Input.action_release(ACTION)
	instance._process(0.016)

func stopped(instance) -> bool:
	return not instance.is_processing() and instance.get("_drop") == null and instance.get("_held") == false

func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	InputMap.add_action(ACTION)
	Input.action_release(ACTION)
	var port = Port.new()
	var instance = starter(port)
	root.add_child(instance)
	assert(instance.is_processing())
	assert(port.calls == 0)
	step(instance, false)
	step(instance, true)
	for index in range(20):
		step(instance, true)
	assert(port.calls == 1)
	step(instance, false)
	step(instance, true)
	assert(port.calls == 2)
	root.remove_child(instance)
	assert(stopped(instance))
	instance.free()
	assert(port.calls == 2)
	checked += 1

	Input.action_release(ACTION)
	port = Port.new()
	port.accepted = false
	instance = starter(port)
	root.add_child(instance)
	step(instance, true)
	step(instance, true)
	assert(port.calls == 1 and instance.is_processing())
	port.accepted = true
	step(instance, true)
	assert(port.calls == 1)
	step(instance, false)
	step(instance, true)
	assert(port.calls == 2 and instance.is_processing())
	instance.free()
	checked += 1

	Input.action_press(ACTION)
	port = Port.new()
	instance = starter(port)
	root.add_child(instance)
	step(instance, true)
	assert(port.calls == 0)
	step(instance, false)
	step(instance, true)
	assert(port.calls == 1)
	instance.free()
	instance = starter(port)
	root.add_child(instance)
	step(instance, true)
	assert(port.calls == 1)
	instance.free()
	checked += 1

	Input.action_release(ACTION)
	for invalid in [null, false, RefCounted.new(), MissingRequest.new(), WrongArity.new(), WrongReturn.new(), UntypedVersion.new(), UntypedRequest.new(), OldPort.new()]:
		instance = starter(invalid)
		root.add_child(instance)
		assert(stopped(instance))
		instance.free()
		checked += 1

	for invalid_action in ["", "unknown_action"]:
		port = Port.new()
		instance = starter(port)
		instance.drop_action = invalid_action
		root.add_child(instance)
		assert(stopped(instance))
		assert(port.calls == 0)
		instance.free()
		checked += 1

	var node_port = NodePort.new()
	instance = starter(node_port)
	root.add_child(instance)
	node_port.free()
	step(instance, true)
	assert(stopped(instance))
	instance.free()
	checked += 1

	Input.action_release(ACTION)
	port = Port.new()
	instance = starter(port)
	root.add_child(instance)
	InputMap.erase_action(ACTION)
	instance._process(0.016)
	assert(stopped(instance) and port.calls == 0)
	instance.free()
	InputMap.add_action(ACTION)
	checked += 1

	var parent = Node.new()
	port = Port.new()
	parent.set_meta("viento_character_drop", port)
	root.add_child(parent)
	instance = starter(null)
	parent.add_child(instance)
	assert(stopped(instance) and port.calls == 0)
	parent.free()
	checked += 1

	Input.action_release(ACTION)
	InputMap.erase_action(ACTION)
	print("CHARACTER_DROP_STARTER_OK:" + str(checked))
	quit()
`;
