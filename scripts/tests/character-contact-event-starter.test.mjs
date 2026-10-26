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
import { GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT as source } from '../../engine/godot-character-contact-events-script.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const starterId = 'godot-character-contact-events';
const context = () => ({ sourceToken: 'character-contacts:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: '档案' }] });
const request = (root = 'documents') => ({ starterId, documentType: 'document', sourcePath: `${root}/scripts/移动碰撞.txt` });
const hash = value => createHash('sha256').update(value).digest('hex');

// Every complete record predates this starter, including the existing motion,
// sensor, animation and audio source contracts.
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
  "godot-project-event-audio": "3afab14ffab40e59f57a6ca7bef2e83870c6e6a1a8129a4d26ea2cf51b7c3be6",
  "godot-project-audio": "996427e086f4a00794c1395669e13405720e9ee7c757070c6d59c7dbe74b78b7",
  "godot-project-animation": "ef30751c0eeda5792b32968c8ee208de8f1ac196ad615564bc37d036073e673a",
  "godot-project-animation-clip": "31a7175fc3045337203df565d14f288532de36449f95a627d33bfbadc2bb8d66",
  "godot-project-animation-event": "38812ff2ba95b913ab2ecc110be3697259bfe9735d08b8c28682956b7399bc78",
  "godot-project-animation-completion": "1909c15074e1e037abe042e09446ac339a68fa5fb362cdda0d104464fc966d84",
  "godot-project-animation-state-table": "608d6a5c7a087fcfb17b084d7c2194b27a4130f43e580bc0fc9e3cbd062ac666"
};

test('contact starter adds one catalog entry while preserving every previous record and source byte', () => {
  const all = listScriptStarters();
  // Drop-through and platform endpoints are separately verified catalog extensions.
  assert.deepEqual(all.filter(row => !Object.hasOwn(legacy, row.id)).map(row => row.id), [starterId, 'godot-character-drop-through', 'godot-platform-endpoint-events']);
  assert.equal(all.length, Object.keys(legacy).length + 3);
  assert.equal(new Set(all.map(row => row.id)).size, all.length);
  for (const [id, expected] of Object.entries(legacy)) assert.equal(hash(JSON.stringify(all.find(row => row.id === id))), expected, id);
  const row = all.find(item => item.id === starterId);
  assert.deepEqual(Object.keys(row), ['id', 'languageId', 'backendId', 'label', 'description', 'content']);
  assert.equal(row.languageId, 'gdscript'); assert.equal(row.backendId, 'org.viento.godot4');
  assert.equal(row.content, source); assert.ok(source.endsWith('\n')); assert.ok(Buffer.byteLength(source) < 65536);
  assert.ok(Object.isFrozen(row)); assert.throws(() => { row.content = ''; }, TypeError);
});

test('contact starter prepares exact ordinary TXT source without core, registration, physics, or event publishing authority', () => {
  assert.equal(getStudioCoreMetadata().ready, false);
  for (const documentRoot of ['documents', '作品/原文']) {
    const current = { ...context(), documentRoot }, selected = request(documentRoot), before = structuredClone({ current, selected });
    const proposal = prepareScriptDraft(current, selected);
    assert.ok(isScriptDraftProposal(proposal)); assert.ok(Object.isFrozen(proposal));
    assert.equal(proposal.format, 'viento-script-draft'); assert.equal(proposal.schemaVersion, 1);
    assert.equal(proposal.content, source);
    assert.deepEqual(prepareScriptDraftApply(current, proposal), { ...selected, languageId: 'gdscript', backendId: 'org.viento.godot4', content: source });
    assert.deepEqual({ current, selected }, before);
    for (const key of ['bindingId', 'objectId', 'instanceId', 'parameters', 'events', 'relations', 'physics', 'run', 'save']) assert.equal(Object.hasOwn(proposal, key), false);
  }
});

test('contact source draft stays bound to its source context and rejects forged or caller supplied authority', () => {
  const current = context(), selected = request(), proposal = prepareScriptDraft(current, selected);
  for (const altered of [{ ...current, sourceToken: 'new-session' }, { ...current, documentRoot: 'other' },
    { ...current, documentTypes: [{ id: 'document', label: 'Changed' }] }]) {
    assert.throws(() => prepareScriptDraftApply(altered, proposal), { errorCode: 'script_authoring_conflict' });
  }
  assert.throws(() => prepareScriptDraftApply(current, { ...proposal }), { errorCode: 'script_authoring_conflict' });
  for (const extra of [{ content: 'extends Node\n' }, { parameters: {} }, { sourcePath: '../outside.txt' }]) {
    assert.throws(() => prepareScriptDraft(current, { ...selected, ...extra }), { errorCode: 'script_authoring_invalid' });
  }
  let reads = 0;
  const accessor = { ...selected }; Object.defineProperty(accessor, 'starterId', { enumerable: true, get() { reads++; return starterId; } });
  assert.throws(() => prepareScriptDraft(current, accessor), { errorCode: 'script_authoring_invalid' }); assert.equal(reads, 0);
});

test('contact source consumes only its own versioned two-string port and publishes the other instance scalar', () => {
  for (const key of ['viento_character_contacts', 'viento_project', 'viento_instance_id']) assert.ok(source.includes(`get_meta("${key}")`));
  assert.match(source, /@export var started_event: String = "physics\.contact_started"/);
  assert.match(source, /@export var ended_event: String = "physics\.contact_ended"/);
  assert.match(source, /@export var other_instance_id: String = ""/);
  assert.match(source, /contacts\.protocol_version\(\)/);
  assert.match(source, /arguments\.size\(\) == 2.*arguments\[0\]\["type"\] == TYPE_STRING.*arguments\[1\]\["type"\] == TYPE_STRING/);
  assert.match(source, /_project\.publish_event\(name, instance_id\)/);
  assert.doesNotMatch(source, /get_parent\(|Input\.|move_and|is_on_floor|grounded|position|velocity|VIENTO_|print\(|call_deferred|FileAccess|load\(/);
  assert.doesNotMatch(source, /JSON\.|publish_event\(name, \{|publish_event\(name, \[/);
});

test('contact starter label and exact description have English and Japanese translations', () => {
  const row = listScriptStarters().find(item => item.id === starterId);
  for (const dictionary of [en, ja]) for (const key of [row.label, row.description]) {
    assert.equal(typeof dictionary[key], 'string', key); assert.ok(dictionary[key].length); assert.notEqual(dictionary[key], key);
  }
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot checks contact source, exact signatures, other-instance filtering, disabled events and cleanup', {
  skip: native ? false : 'Set VIENTO_GODOT_BIN for native contact starter verification', timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-character-contact-starter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Character contact starter harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(directory, 'publisher.gd'), source), fs.writeFile(path.join(directory, 'test.gd'), nativeHarness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', directory, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.host/data'),
      XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') },
  });
  const log = stdout + stderr;
  assert.match(stdout, /CHARACTER_CONTACT_STARTER_OK:30/);
  assert.doesNotMatch(log, /SCRIPT ERROR:|Parse Error|Compile Error|Assertion failed|Leaked|leaked/);
  const errors = log.split('\n').filter(line => line.startsWith('ERROR:'));
  assert.equal(errors.length, 24, log);
  assert.ok(errors.every(line => line.startsWith('ERROR: Character contact events: ')), log);
  for (const text of ['Bind this script to a character', 'unsupported contract', 'behavior instance identity',
    'other_instance_id must', 'invalid other-body identity', 'no longer available', 'rejected the character contact event']) assert.ok(log.includes(text), text);
});

const nativeHarness = String.raw`extends SceneTree
const Publisher = preload("res://publisher.gd")
const SELF_ID := "11111111-1111-4111-8111-111111111111"
const OTHER_ID := "22222222-2222-4222-8222-222222222222"
const BODY_ID := "33333333-3333-4333-8333-333333333333"
const UNRELATED_ID := "44444444-4444-4444-8444-444444444444"

class Contacts extends RefCounted:
	signal started(body_id: String, instance_id: String)
	signal ended(body_id: String, instance_id: String)
	func protocol_version():
		return 1

class OldContacts extends Contacts:
	func protocol_version():
		return 0

class FloatVersion extends Contacts:
	func protocol_version():
		return 1.0

class WrongArity extends RefCounted:
	signal started(body_id: String)
	signal ended(body_id: String, instance_id: String)
	func protocol_version():
		return 1

class WrongTypes extends RefCounted:
	signal started(body_id, instance_id)
	signal ended(body_id: String, instance_id: String)
	func protocol_version():
		return 1

class MissingEnded extends RefCounted:
	signal started(body_id: String, instance_id: String)
	func protocol_version():
		return 1

class Project extends RefCounted:
	var publications: Array = []
	var accepted = true
	func publish_event(name, value):
		if typeof(accepted) == TYPE_BOOL and accepted:
			publications.append([name, value])
		return accepted

var checked := 0

func publisher(project, contacts):
	var instance = Publisher.new()
	instance.set_meta("viento_project", project)
	instance.set_meta("viento_instance_id", SELF_ID)
	if contacts != null:
		instance.set_meta("viento_character_contacts", contacts)
	return instance

func disconnected(contacts) -> bool:
	return contacts.get_signal_connection_list("started").is_empty() and contacts.get_signal_connection_list("ended").is_empty()

func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	var project = Project.new()
	var contacts = Contacts.new()
	var instance = publisher(project, contacts)
	root.add_child(instance)
	assert(project.publications.is_empty())
	assert(contacts.get_signal_connection_list("started").size() == 1)
	assert(contacts.get_signal_connection_list("ended").size() == 1)
	contacts.started.emit(BODY_ID, OTHER_ID)
	contacts.ended.emit(BODY_ID, OTHER_ID)
	assert(project.publications == [["physics.contact_started", OTHER_ID], ["physics.contact_ended", OTHER_ID]])
	instance.free()
	contacts.started.emit(BODY_ID, OTHER_ID)
	contacts.ended.emit(BODY_ID, OTHER_ID)
	assert(project.publications.size() == 2)
	assert(disconnected(contacts))
	checked += 1

	project = Project.new()
	contacts = Contacts.new()
	instance = publisher(project, contacts)
	instance.other_instance_id = OTHER_ID
	root.add_child(instance)
	contacts.started.emit(BODY_ID, UNRELATED_ID)
	contacts.ended.emit(BODY_ID, UNRELATED_ID)
	assert(project.publications.is_empty())
	contacts.started.emit(BODY_ID, OTHER_ID)
	contacts.ended.emit(BODY_ID, OTHER_ID)
	assert(project.publications == [["physics.contact_started", OTHER_ID], ["physics.contact_ended", OTHER_ID]])
	instance.free()
	checked += 1

	for start_enabled in [true, false]:
		project = Project.new()
		contacts = Contacts.new()
		instance = publisher(project, contacts)
		instance.started_event = "custom.start" if start_enabled else ""
		instance.ended_event = "" if start_enabled else "custom.end"
		root.add_child(instance)
		assert(contacts.get_signal_connection_list("started").size() == (1 if start_enabled else 0))
		assert(contacts.get_signal_connection_list("ended").size() == (0 if start_enabled else 1))
		contacts.started.emit(BODY_ID, OTHER_ID)
		contacts.ended.emit(BODY_ID, OTHER_ID)
		assert(project.publications == [["custom.start" if start_enabled else "custom.end", OTHER_ID]])
		instance.free()
		checked += 1

	project = Project.new()
	contacts = Contacts.new()
	instance = publisher(project, contacts)
	instance.started_event = ""
	instance.ended_event = ""
	root.add_child(instance)
	contacts.started.emit(BODY_ID, OTHER_ID)
	contacts.ended.emit(BODY_ID, OTHER_ID)
	assert(project.publications.is_empty())
	assert(disconnected(contacts))
	instance.free()
	checked += 1

	for unavailable in [null, false, RefCounted.new(), OldContacts.new(), FloatVersion.new(), WrongArity.new(), WrongTypes.new(), MissingEnded.new()]:
		project = Project.new()
		instance = publisher(project, unavailable)
		root.add_child(instance)
		assert(instance.get("_contacts") == null)
		assert(project.publications.is_empty())
		instance.free()
		checked += 1

	for invalid_meta in [["viento_project", false], ["viento_project", RefCounted.new()], ["viento_instance_id", false]]:
		project = Project.new()
		contacts = Contacts.new()
		instance = publisher(project, contacts)
		instance.set_meta(invalid_meta[0], invalid_meta[1])
		root.add_child(instance)
		contacts.started.emit(BODY_ID, OTHER_ID)
		assert(project.publications.is_empty())
		assert(disconnected(contacts))
		instance.free()
		checked += 1

	for invalid_filter in ["not-a-uuid", "AAAAAAAA-2222-4222-8222-222222222222", OTHER_ID + "\n", " " + OTHER_ID, OTHER_ID + " "]:
		project = Project.new()
		contacts = Contacts.new()
		instance = publisher(project, contacts)
		instance.other_instance_id = invalid_filter
		root.add_child(instance)
		contacts.started.emit(BODY_ID, OTHER_ID)
		assert(project.publications.is_empty())
		assert(disconnected(contacts))
		instance.free()
		checked += 1

	for invalid_pair in [["bad", OTHER_ID], [BODY_ID, "bad"], [BODY_ID, SELF_ID], [BODY_ID, true]]:
		project = Project.new()
		contacts = Contacts.new()
		instance = publisher(project, contacts)
		root.add_child(instance)
		instance.call("_on_started", invalid_pair[0], invalid_pair[1])
		assert(project.publications.is_empty())
		assert(disconnected(contacts))
		instance.free()
		checked += 1

	for rejected in [false, 1]:
		project = Project.new()
		project.accepted = rejected
		contacts = Contacts.new()
		instance = publisher(project, contacts)
		root.add_child(instance)
		contacts.started.emit(BODY_ID, OTHER_ID)
		assert(project.publications.is_empty())
		assert(disconnected(contacts))
		instance.free()
		checked += 1

	project = Project.new()
	contacts = Contacts.new()
	instance = publisher(project, contacts)
	root.add_child(instance)
	instance.set("_project", null)
	contacts.started.emit(BODY_ID, OTHER_ID)
	assert(project.publications.is_empty())
	assert(disconnected(contacts))
	instance.free()
	checked += 1

	project = Project.new()
	contacts = Contacts.new()
	var parent := Node.new()
	parent.set_meta("viento_project", project)
	parent.set_meta("viento_instance_id", SELF_ID)
	parent.set_meta("viento_character_contacts", contacts)
	root.add_child(parent)
	instance = Publisher.new()
	parent.add_child(instance)
	contacts.started.emit(BODY_ID, OTHER_ID)
	assert(project.publications.is_empty())
	assert(disconnected(contacts))
	parent.free()
	checked += 1

	project = Project.new()
	contacts = Contacts.new()
	instance = publisher(project, contacts)
	root.add_child(instance)
	contacts.started.emit(BODY_ID, OTHER_ID)
	instance.free()
	assert(project.publications == [["physics.contact_started", OTHER_ID]])
	instance = publisher(project, contacts)
	root.add_child(instance)
	assert(project.publications.size() == 1)
	contacts.started.emit(BODY_ID, OTHER_ID)
	assert(project.publications == [["physics.contact_started", OTHER_ID], ["physics.contact_started", OTHER_ID]])
	instance.free()
	assert(disconnected(contacts))
	checked += 1

	print("CHARACTER_CONTACT_STARTER_OK:" + str(checked))
	quit()
`;
