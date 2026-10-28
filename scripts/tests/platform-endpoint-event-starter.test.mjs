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
import { GODOT_PLATFORM_ENDPOINT_EVENTS_SCRIPT as source } from '../../engine/godot-platform-endpoint-events-script.mjs';

const starterId = 'godot-platform-endpoint-events';
const context = () => ({ sourceToken: 'platform-endpoints:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: '档案' }] });
const request = (root = 'documents') => ({ starterId, documentType: 'document', sourcePath: `${root}/scripts/平台端点事件.txt` });
const hash = value => createHash('sha256').update(value).digest('hex');

// All 19 complete records captured before adding this starter. Hashes include
// metadata and ordinary source, not just IDs or selected source fragments.
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
  "godot-character-drop-through": "d642a1294696bc9f38d119b3ad83bcfcc8f6f56209c43d54d94b1447e742e973",
  "godot-project-event-audio": "3afab14ffab40e59f57a6ca7bef2e83870c6e6a1a8129a4d26ea2cf51b7c3be6",
  "godot-project-audio": "996427e086f4a00794c1395669e13405720e9ee7c757070c6d59c7dbe74b78b7",
  "godot-project-animation": "ef30751c0eeda5792b32968c8ee208de8f1ac196ad615564bc37d036073e673a",
  "godot-project-animation-clip": "31a7175fc3045337203df565d14f288532de36449f95a627d33bfbadc2bb8d66",
  "godot-project-animation-event": "38812ff2ba95b913ab2ecc110be3697259bfe9735d08b8c28682956b7399bc78",
  "godot-project-animation-completion": "1909c15074e1e037abe042e09446ac339a68fa5fb362cdda0d104464fc966d84",
  "godot-project-animation-state-table": "608d6a5c7a087fcfb17b084d7c2194b27a4130f43e580bc0fc9e3cbd062ac666"
};

test('platform endpoint starter adds one record and preserves all 19 complete previous records', () => {
  const all = listScriptStarters();
  assert.equal(Object.keys(legacy).length, 19);
  assert.equal(all.length, 21);
  assert.equal(new Set(all.map(row => row.id)).size, 21);
  assert.deepEqual(all.filter(row => !Object.hasOwn(legacy, row.id)).map(row => row.id), [starterId, 'godot-character-intent']);
  for (const [id, expected] of Object.entries(legacy)) assert.equal(hash(JSON.stringify(all.find(row => row.id === id))), expected, id);
  const row = all.find(item => item.id === starterId);
  assert.deepEqual(Object.keys(row), ['id', 'languageId', 'backendId', 'label', 'description', 'content']);
  assert.equal(row.languageId, 'gdscript'); assert.equal(row.backendId, 'org.viento.godot4');
  assert.equal(row.content, source); assert.ok(source.endsWith('\n')); assert.ok(Object.isFrozen(row));
  assert.throws(() => { row.content = ''; }, TypeError);
});

test('platform endpoint script prepares an ordinary source draft without physics, registration or execution authority', () => {
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

test('platform endpoint draft rejects stale contexts, forged proposals, accessor and caller-supplied authority', () => {
  const current = context(), selected = request(), proposal = prepareScriptDraft(current, selected);
  for (const altered of [{ ...current, sourceToken: 'new-session' }, { ...current, documentRoot: 'other' },
    { ...current, documentTypes: [{ id: 'document', label: 'Changed' }] }]) {
    assert.throws(() => prepareScriptDraftApply(altered, proposal), { errorCode: 'script_authoring_conflict' });
  }
  assert.throws(() => prepareScriptDraftApply(current, { ...proposal }), { errorCode: 'script_authoring_conflict' });
  for (const extra of [{ content: 'extends Node\n' }, { parameters: {} }, { sourcePath: '../outside.txt' }, { runtime: true }]) {
    assert.throws(() => prepareScriptDraft(current, { ...selected, ...extra }), { errorCode: 'script_authoring_invalid' });
  }
  let reads = 0;
  const accessor = { ...selected }; Object.defineProperty(accessor, 'starterId', { enumerable: true, get() { reads++; return starterId; } });
  assert.throws(() => prepareScriptDraft(current, accessor), { errorCode: 'script_authoring_invalid' }); assert.equal(reads, 0);
});

test('platform endpoint source consumes only its local endpoint port and publishes its own scalar identity', () => {
  assert.deepEqual(Array.from(source.matchAll(/@export var (\w+): (\w+) = ([^\n]+)/g), match => match.slice(1)), [
    ['origin_event', 'String', '"physics.platform_origin"'], ['destination_event', 'String', '"physics.platform_destination"'],
  ]);
  for (const metadata of ['viento_platform_events', 'viento_project', 'viento_instance_id']) assert.ok(source.includes(`get_meta("${metadata}")`));
  assert.match(source, /_port_method\(platform, "protocol_version", 0, TYPE_INT\)/);
  assert.match(source, /_port_method\(project, "publish_event", 2, TYPE_BOOL\)/);
  assert.match(source, /_project\.publish_event\(name, _instance_id\)/);
  assert.doesNotMatch(source, /get_parent\(|get_node\(|Input\.|move_and|is_on_floor|position|velocity|VIENTO_|print\(|call_deferred|FileAccess|load\(|128|_process\(|_physics_process\(/);
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot checks platform endpoint signatures, own identity, independent disable and lifecycle cleanup', {
  skip: native ? false : 'Set VIENTO_GODOT_BIN for native platform endpoint starter verification', timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-platform-endpoint-starter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Platform endpoint starter harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(directory, 'starter.gd'), source), fs.writeFile(path.join(directory, 'test.gd'), nativeHarness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', directory, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.host/data'),
      XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') },
  });
  const log = stdout + stderr;
  const marker = stdout.split('\n').find(line => line.startsWith('PLATFORM_ENDPOINT_STARTER_OK:'));
  assert.ok(marker, log);
  const result = JSON.parse(marker.slice('PLATFORM_ENDPOINT_STARTER_OK:'.length));
  assert.equal(result.checked, 38); assert.equal(result.expectedFailures, 29);
  assert.doesNotMatch(log, /SCRIPT ERROR:|Parse Error|Compile Error|Assertion failed|Leaked|leaked/);
  const errors = log.split('\n').filter(line => line.startsWith('ERROR:'));
  assert.equal(errors.length, result.expectedFailures, log);
  assert.ok(errors.every(line => line.startsWith('ERROR: Platform endpoint events: ')), log);
  const output = process.env.VIENTO_PLATFORM_EVENTS_STARTER_REPORT_DIR;
  if (output) {
    await fs.mkdir(output, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(output, 'starter-native-stdout.log'), stdout), fs.writeFile(path.join(output, 'starter-native-stderr.log'), stderr),
      fs.writeFile(path.join(output, 'starter-generated.gd'), source), fs.writeFile(path.join(output, 'starter-native-harness.gd'), nativeHarness),
      fs.writeFile(path.join(output, 'starter-native.json'), JSON.stringify({ ...result, sourceSha256: hash(source), legacyCount: Object.keys(legacy).length, legacyHashes: legacy }, null, 2) + '\n'),
    ]);
  }
});

const nativeHarness = String.raw`extends SceneTree
const Starter = preload("res://starter.gd")
const INSTANCE_ID := "11111111-1111-4111-8111-111111111111"
const OTHER_ID := "22222222-2222-4222-8222-222222222222"

class Port extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version() -> int:
		return 1

class OldPort extends Port:
	func protocol_version() -> int:
		return 0

class WrongVersionType extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version():
		return 1.0

class WrongVersionArity extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version(_value: int) -> int:
		assert(false)
		return 1

class OptionalVersionArgument extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version(_value: int = 0) -> int:
		assert(false)
		return 1

class WrongOriginSignal extends RefCounted:
	signal origin_reached(value: String)
	signal destination_reached
	func protocol_version() -> int:
		return 1

class WrongDestinationSignal extends RefCounted:
	signal origin_reached
	signal destination_reached(value: String)
	func protocol_version() -> int:
		return 1

class MissingSignal extends RefCounted:
	signal origin_reached
	func protocol_version() -> int:
		return 1

class NodePort extends Node:
	signal origin_reached
	signal destination_reached
	func protocol_version() -> int:
		return 1

class Project extends RefCounted:
	var publications: Array = []
	var accepted := true
	var calls := 0
	func publish_event(name, value) -> bool:
		calls += 1
		if not accepted:
			return false
		publications.append([name, value])
		return true

class TypedProject extends RefCounted:
	var publications: Array = []
	func publish_event(name: String, value: String) -> bool:
		publications.append([name, value])
		return true

class NodeProject extends Node:
	func publish_event(_name, _value) -> bool:
		return true

class WrongProjectArity extends RefCounted:
	func publish_event(_name) -> bool:
		assert(false)
		return true

class OptionalProjectArgument extends RefCounted:
	func publish_event(_name, _value = "") -> bool:
		assert(false)
		return true

class WrongProjectReturn extends RefCounted:
	func publish_event(_name, _value) -> int:
		assert(false)
		return 1

class UntypedProjectReturn extends RefCounted:
	func publish_event(_name, _value):
		assert(false)
		return true

class WrongProjectTypes extends RefCounted:
	func publish_event(_name: int, _value: int) -> bool:
		assert(false)
		return true

var checked := 0
var expected_failures := 0

func starter(project, port):
	var instance = Starter.new()
	instance.set_meta("viento_project", project)
	instance.set_meta("viento_instance_id", INSTANCE_ID)
	instance.set_meta("viento_platform_events", port)
	return instance

func disconnected(instance, port) -> void:
	assert(instance.get("_platform") == null)
	assert(instance.get("_project") == null)
	assert(instance.get("_instance_id") == "")
	assert(not instance.get("_origin_connected"))
	assert(not instance.get("_destination_connected"))
	if typeof(port) == TYPE_OBJECT and is_instance_valid(port):
		for name in ["origin_reached", "destination_reached"]:
			if port.has_signal(name):
				assert(port.get_signal_connection_list(name).is_empty())

func invalid(instance, port) -> void:
	root.add_child(instance)
	disconnected(instance, port)
	instance.free()
	checked += 1
	expected_failures += 1

func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	var project = Project.new()
	var port = Port.new()
	var instance = starter(project, port)
	root.add_child(instance)
	assert(project.publications.is_empty())
	assert(port.get_signal_connection_list("origin_reached").size() == 1)
	assert(port.get_signal_connection_list("destination_reached").size() == 1)
	port.destination_reached.emit()
	port.origin_reached.emit()
	assert(project.publications == [["physics.platform_destination", INSTANCE_ID], ["physics.platform_origin", INSTANCE_ID]])
	root.remove_child(instance)
	disconnected(instance, port)
	port.destination_reached.emit()
	port.origin_reached.emit()
	assert(project.publications.size() == 2)
	instance.free()
	checked += 1

	for disabled in ["origin", "destination", "both"]:
		project = Project.new()
		port = Port.new()
		instance = starter(project, port)
		instance.origin_event = "custom.origin" if disabled == "destination" else ""
		instance.destination_event = "custom.destination" if disabled == "origin" else ""
		root.add_child(instance)
		assert(project.publications.is_empty())
		assert(port.get_signal_connection_list("origin_reached").size() == (1 if disabled == "destination" else 0))
		assert(port.get_signal_connection_list("destination_reached").size() == (1 if disabled == "origin" else 0))
		port.origin_reached.emit()
		port.destination_reached.emit()
		var expected := []
		if disabled == "destination":
			expected.append(["custom.origin", INSTANCE_ID])
		if disabled == "origin":
			expected.append(["custom.destination", INSTANCE_ID])
		assert(project.publications == expected)
		instance.free()
		assert(port.get_signal_connection_list("origin_reached").is_empty())
		assert(port.get_signal_connection_list("destination_reached").is_empty())
		checked += 1

	project = TypedProject.new()
	port = Port.new()
	instance = starter(project, port)
	instance.origin_event = "custom.origin"
	instance.destination_event = "custom.destination"
	root.add_child(instance)
	port.origin_reached.emit()
	port.destination_reached.emit()
	assert(project.publications == [["custom.origin", INSTANCE_ID], ["custom.destination", INSTANCE_ID]])
	instance.free()
	checked += 1

	project = Project.new()
	port = Port.new()
	var other_port = Port.new()
	instance = starter(project, port)
	var other = starter(project, other_port)
	other.set_meta("viento_instance_id", OTHER_ID)
	root.add_child(instance)
	root.add_child(other)
	port.destination_reached.emit()
	assert(project.publications == [["physics.platform_destination", INSTANCE_ID]])
	other_port.origin_reached.emit()
	assert(project.publications == [["physics.platform_destination", INSTANCE_ID], ["physics.platform_origin", OTHER_ID]])
	instance.free()
	other_port.destination_reached.emit()
	assert(project.publications.back() == ["physics.platform_destination", OTHER_ID])
	other.free()
	checked += 1

	for unavailable in [false, RefCounted.new(), OldPort.new(), WrongVersionType.new(), WrongVersionArity.new(), OptionalVersionArgument.new(), WrongOriginSignal.new(), WrongDestinationSignal.new(), MissingSignal.new()]:
		project = Project.new()
		instance = starter(project, unavailable)
		invalid(instance, unavailable)
		assert(project.publications.is_empty())

	for unavailable in [false, RefCounted.new(), WrongProjectArity.new(), OptionalProjectArgument.new(), WrongProjectReturn.new(), UntypedProjectReturn.new(), WrongProjectTypes.new()]:
		port = Port.new()
		instance = starter(unavailable, port)
		invalid(instance, port)

	for identity in [false, 1, "", "not-a-uuid", "AAAAAAAA-1111-4111-8111-111111111111", INSTANCE_ID + "\n", " " + INSTANCE_ID, "11111111-1111-4111-8111-11111111111g"]:
		project = Project.new()
		port = Port.new()
		instance = starter(project, port)
		instance.set_meta("viento_instance_id", identity)
		invalid(instance, port)
		assert(project.publications.is_empty())

	for key in ["viento_project", "viento_platform_events", "viento_instance_id"]:
		project = Project.new()
		port = Port.new()
		instance = starter(project, port)
		instance.remove_meta(key)
		invalid(instance, port)
		assert(project.publications.is_empty())

	project = Project.new()
	project.accepted = false
	port = Port.new()
	instance = starter(project, port)
	root.add_child(instance)
	port.destination_reached.emit()
	disconnected(instance, port)
	port.origin_reached.emit()
	assert(project.calls == 1 and project.publications.is_empty())
	instance.free()
	checked += 1
	expected_failures += 1

	var dead_project = NodeProject.new()
	port = Port.new()
	instance = starter(dead_project, port)
	root.add_child(instance)
	dead_project.free()
	port.origin_reached.emit()
	disconnected(instance, port)
	instance.free()
	checked += 1
	expected_failures += 1

	project = Project.new()
	var dead_port = NodePort.new()
	instance = starter(project, dead_port)
	root.add_child(instance)
	dead_port.free()
	instance.free()
	assert(project.publications.is_empty())
	checked += 1

	project = Project.new()
	port = Port.new()
	instance = starter(project, port)
	root.add_child(instance)
	root.remove_child(instance)
	disconnected(instance, port)
	instance.request_ready()
	root.add_child(instance)
	assert(project.publications.is_empty())
	port.origin_reached.emit()
	assert(project.publications == [["physics.platform_origin", INSTANCE_ID]])
	assert(port.get_signal_connection_list("origin_reached").size() == 1)
	instance.free()
	checked += 1

	# No source-level lifetime cap: the project owns acceptance and its existing
	# publication budget. The source disconnects only after an explicit refusal.
	project = Project.new()
	port = Port.new()
	instance = starter(project, port)
	root.add_child(instance)
	for index in range(256):
		port.destination_reached.emit()
	assert(project.calls == 256 and project.publications.size() == 256)
	instance.free()
	checked += 1

	print("PLATFORM_ENDPOINT_STARTER_OK:" + JSON.stringify({"checked": checked, "expectedFailures": expected_failures}))
	quit()
`;
