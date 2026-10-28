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
import { GODOT_CHARACTER_MOTION_EVENTS_SCRIPT as publisher } from '../../engine/godot-character-motion-events-script.mjs';
import { GODOT_PROJECT_EVENT_AUDIO_SCRIPT as audio } from '../../engine/godot-project-event-audio-script.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const context = () => ({ sourceToken: 'character-events:1', documentRoot: 'documents', documentTypes: [{ id: 'document', label: '档案' }] });
const sources = { 'godot-character-motion-events': publisher, 'godot-project-event-audio': audio };
const selected = (starterId, documentRoot = 'documents') => ({ starterId, documentType: 'document', sourcePath: `${documentRoot}/scripts/角色事件.txt` });
const hash = value => createHash('sha256').update(value).digest('hex');

// Frozen before this addition: old starters keep their existing contracts.
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
  "godot-project-audio": "996427e086f4a00794c1395669e13405720e9ee7c757070c6d59c7dbe74b78b7",
  "godot-project-animation": "ef30751c0eeda5792b32968c8ee208de8f1ac196ad615564bc37d036073e673a",
  "godot-project-animation-clip": "31a7175fc3045337203df565d14f288532de36449f95a627d33bfbadc2bb8d66",
  "godot-project-animation-event": "38812ff2ba95b913ab2ecc110be3697259bfe9735d08b8c28682956b7399bc78",
  "godot-project-animation-completion": "1909c15074e1e037abe042e09446ac339a68fa5fb362cdda0d104464fc966d84",
  "godot-project-animation-state-table": "608d6a5c7a087fcfb17b084d7c2194b27a4130f43e580bc0fc9e3cbd062ac666"
};

test('new character event and audio starters preserve every existing catalog record and ordinary source byte', () => {
  const all = listScriptStarters();
  assert.deepEqual(all.filter(row => !Object.hasOwn(legacy, row.id)).map(row => row.id), ['godot-character-motion-events', 'godot-character-contact-events', 'godot-character-drop-through', 'godot-platform-endpoint-events', 'godot-project-event-audio', 'godot-character-intent']);
  assert.equal(all.length, Object.keys(legacy).length + 6);
  assert.equal(new Set(all.map(row => row.id)).size, all.length);
  for (const [id, expected] of Object.entries(legacy)) {
    assert.equal(hash(JSON.stringify(all.find(row => row.id === id))), expected, id);
  }
  for (const [id, content] of Object.entries(sources)) {
    const row = all.find(item => item.id === id);
    assert.deepEqual(Object.keys(row), ['id', 'languageId', 'backendId', 'label', 'description', 'content']);
    assert.equal(row.languageId, 'gdscript'); assert.equal(row.backendId, 'org.viento.godot4');
    assert.equal(row.content, content); assert.equal(content.endsWith('\n'), true); assert.ok(Buffer.byteLength(content) < 65536);
    assert.ok(Object.isFrozen(row)); assert.throws(() => { row.content = ''; }, TypeError);
  }
});

test('both starters prepare exact ordinary TXT drafts without the Rust core, registration, physics or execution authority', () => {
  assert.equal(getStudioCoreMetadata().ready, false);
  for (const [id, content] of Object.entries(sources)) for (const documentRoot of ['documents', '作品/原文']) {
    const current = { ...context(), documentRoot }, request = selected(id, documentRoot), before = structuredClone({ current, request });
    const proposal = prepareScriptDraft(current, request);
    assert.ok(isScriptDraftProposal(proposal)); assert.ok(Object.isFrozen(proposal));
    assert.equal(proposal.format, 'viento-script-draft'); assert.equal(proposal.schemaVersion, 1);
    assert.equal(proposal.content, content);
    assert.deepEqual(prepareScriptDraftApply(current, proposal), { ...request, languageId: 'gdscript', backendId: 'org.viento.godot4', content });
    assert.deepEqual({ current, request }, before);
    for (const key of ['bindingId', 'objectId', 'instanceId', 'parameters', 'events', 'relations', 'physics', 'run', 'save']) assert.equal(Object.hasOwn(proposal, key), false);
  }
});

test('new starter drafts remain bound to the exact source context and reject forged proposals and caller supplied source', () => {
  for (const id of Object.keys(sources)) {
    const current = context(), request = selected(id), proposal = prepareScriptDraft(current, request);
    for (const altered of [{ ...current, sourceToken: 'new-session' }, { ...current, documentRoot: 'other' },
      { ...current, documentTypes: [{ id: 'document', label: 'Changed' }] }]) {
      assert.throws(() => prepareScriptDraftApply(altered, proposal), { errorCode: 'script_authoring_conflict' });
    }
    assert.throws(() => prepareScriptDraftApply(current, { ...proposal }), { errorCode: 'script_authoring_conflict' });
    for (const extra of [{ content: 'extends Node\n' }, { parameters: {} }, { sourcePath: '../outside.txt' }]) {
      assert.throws(() => prepareScriptDraft(current, { ...request, ...extra }), { errorCode: 'script_authoring_invalid' });
    }
    let reads = 0;
    const accessor = { ...request }; Object.defineProperty(accessor, 'starterId', { enumerable: true, get() { reads++; return id; } });
    assert.throws(() => prepareScriptDraft(current, accessor), { errorCode: 'script_authoring_invalid' }); assert.equal(reads, 0);
  }
});

test('publisher reads its own versioned port and binding identity without polling engine motion or smoke telemetry', () => {
  for (const key of ['viento_character_motion', 'viento_project', 'viento_instance_id']) assert.ok(publisher.includes(`get_meta("${key}")`));
  assert.match(publisher, /@export var jumped_event: String = "physics\.jumped"/);
  assert.match(publisher, /@export var landed_event: String = "physics\.landed"/);
  assert.match(publisher, /motion\.protocol_version\(\)/);
  assert.match(publisher, /_project\.publish_event\(name, _instance_id\)/);
  assert.doesNotMatch(publisher, /get_parent\(|Input\.|move_and|is_on_floor|position|velocity|VIENTO_|print\(|call_deferred|FileAccess|load\(/);
  assert.doesNotMatch(audio, /publish_event|stop_audio|call_deferred|FileAccess|AudioStreamPlayer|load\(/);
  assert.match(audio, /@export var event_name: String = "physics\.landed"/);
  assert.match(audio, /@export var instance_id: String = ""/);
  assert.match(audio, /_project\.subscribe_event\(event_name, _on_event\)/);
});

test('both new starter labels and descriptions have English and Japanese translations', () => {
  for (const id of Object.keys(sources)) {
    const row = listScriptStarters().find(item => item.id === id);
    for (const dictionary of [en, ja]) for (const key of [row.label, row.description]) {
      assert.equal(typeof dictionary[key], 'string', key); assert.ok(dictionary[key].length); assert.notEqual(dictionary[key], key);
    }
  }
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot validates source and checks publishing, disabled names, filters, port failures and lifecycle cleanup', {
  skip: native ? false : 'Set VIENTO_GODOT_BIN for native starter-port verification', timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-character-event-starters-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Character event starter harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(directory, 'publisher.gd'), publisher), fs.writeFile(path.join(directory, 'audio.gd'), audio),
    fs.writeFile(path.join(directory, 'test.gd'), nativeHarness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', directory, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.host/data'),
      XDG_CONFIG_HOME: path.join(directory, '.host/config'), XDG_CACHE_HOME: path.join(directory, '.host/cache') },
  });
  const log = stdout + stderr;
  assert.match(stdout, /CHARACTER_EVENT_STARTERS_OK:19/);
  assert.doesNotMatch(log, /SCRIPT ERROR:|Parse Error|Compile Error|Assertion failed|Leaked|leaked/);
  const errors = log.split('\n').filter(line => line.startsWith('ERROR:'));
  assert.equal(errors.length, 14, log);
  assert.ok(errors.every(line => /^ERROR: (Character motion events|Project event audio): /.test(line)), log);
  for (const text of ['Bind this script to a character', 'unsupported contract', 'behavior instance identity',
    'rejected the character motion event', 'Cannot subscribe', 'rejected the requested audio track']) assert.ok(log.includes(text), text);
});

const nativeHarness = "extends SceneTree\nconst Publisher = preload(\"res://publisher.gd\")\nconst Audio = preload(\"res://audio.gd\")\nconst INSTANCE_ID := \"11111111-1111-4111-8111-111111111111\"\nconst OTHER_ID := \"22222222-2222-4222-8222-222222222222\"\nconst TRACK_ID := \"33333333-3333-4333-8333-333333333333\"\n\nclass Motion extends RefCounted:\n\tsignal jumped\n\tsignal landed\n\tfunc protocol_version() -> int:\n\t\treturn 1\n\nclass OldMotion extends Motion:\n\tfunc protocol_version() -> int:\n\t\treturn 0\n\nclass WrongSignals extends RefCounted:\n\tsignal jumped(value)\n\tsignal landed\n\tfunc protocol_version() -> int:\n\t\treturn 1\n\nclass Project extends RefCounted:\n\tvar publications: Array = []\n\tvar tracks: Array = []\n\tvar subscriptions: Dictionary = {}\n\tvar removals: Array = []\n\tvar next_id := 0\n\tvar reject_publish := false\n\tvar reject_subscribe := false\n\tvar reject_audio := false\n\tfunc publish_event(name, value) -> bool:\n\t\tif reject_publish:\n\t\t\treturn false\n\t\tpublications.append([name, value])\n\t\treturn true\n\tfunc subscribe_event(name, callback) -> int:\n\t\tif reject_subscribe:\n\t\t\treturn 0\n\t\tnext_id += 1\n\t\tsubscriptions[next_id] = {\"name\": name, \"callback\": callback}\n\t\treturn next_id\n\tfunc unsubscribe_event(token) -> bool:\n\t\tremovals.append(token)\n\t\treturn subscriptions.erase(token)\n\tfunc play_audio(track_id) -> bool:\n\t\tif reject_audio:\n\t\t\treturn false\n\t\ttracks.append(track_id)\n\t\treturn true\n\tfunc deliver(name, value) -> Array:\n\t\tvar results := []\n\t\tfor token in subscriptions.keys():\n\t\t\tvar row: Dictionary = subscriptions[token]\n\t\t\tif row[\"name\"] == name:\n\t\t\t\tresults.append(row[\"callback\"].call(value))\n\t\treturn results\n\nvar checked := 0\n\nfunc publisher(project, motion):\n\tvar instance = Publisher.new()\n\tinstance.set_meta(\"viento_project\", project)\n\tinstance.set_meta(\"viento_instance_id\", INSTANCE_ID)\n\tif motion != null:\n\t\tinstance.set_meta(\"viento_character_motion\", motion)\n\treturn instance\n\nfunc audio(project):\n\tvar instance = Audio.new()\n\tinstance.track_id = TRACK_ID\n\tinstance.set_meta(\"viento_project\", project)\n\treturn instance\n\nfunc _initialize() -> void:\n\tcall_deferred(\"run_checks\")\n\nfunc run_checks() -> void:\n\tvar project = Project.new()\n\tvar motion = Motion.new()\n\tvar instance = publisher(project, motion)\n\troot.add_child(instance)\n\tassert(project.publications.is_empty())\n\tassert(motion.get_signal_connection_list(\"jumped\").size() == 1)\n\tassert(motion.get_signal_connection_list(\"landed\").size() == 1)\n\tmotion.jumped.emit()\n\tmotion.landed.emit()\n\tassert(project.publications == [[\"physics.jumped\", INSTANCE_ID], [\"physics.landed\", INSTANCE_ID]])\n\tinstance.free()\n\tmotion.jumped.emit()\n\tmotion.landed.emit()\n\tassert(project.publications.size() == 2)\n\tassert(motion.get_signal_connection_list(\"jumped\").is_empty())\n\tassert(motion.get_signal_connection_list(\"landed\").is_empty())\n\tchecked += 1\n\n\tproject = Project.new()\n\tmotion = Motion.new()\n\tinstance = publisher(project, motion)\n\tinstance.jumped_event = \"\"\n\tinstance.landed_event = \"actor.touchdown\"\n\troot.add_child(instance)\n\tassert(motion.get_signal_connection_list(\"jumped\").is_empty())\n\tmotion.jumped.emit()\n\tmotion.landed.emit()\n\tassert(project.publications == [[\"actor.touchdown\", INSTANCE_ID]])\n\tinstance.free()\n\tchecked += 1\n\n\tproject = Project.new()\n\tmotion = Motion.new()\n\tinstance = publisher(project, motion)\n\tinstance.jumped_event = \"\"\n\tinstance.landed_event = \"\"\n\troot.add_child(instance)\n\tmotion.jumped.emit()\n\tmotion.landed.emit()\n\tassert(project.publications.is_empty())\n\tassert(motion.get_signal_connection_list(\"jumped\").is_empty())\n\tassert(motion.get_signal_connection_list(\"landed\").is_empty())\n\tinstance.free()\n\tchecked += 1\n\n\tfor unavailable in [null, false, RefCounted.new(), OldMotion.new(), WrongSignals.new()]:\n\t\tproject = Project.new()\n\t\tinstance = publisher(project, unavailable)\n\t\troot.add_child(instance)\n\t\tassert(instance.get(\"_motion\") == null)\n\t\tassert(project.publications.is_empty())\n\t\tinstance.free()\n\t\tchecked += 1\n\n\tfor invalid_meta in [\"viento_project\", \"viento_instance_id\"]:\n\t\tproject = Project.new()\n\t\tmotion = Motion.new()\n\t\tinstance = publisher(project, motion)\n\t\tinstance.set_meta(invalid_meta, false)\n\t\troot.add_child(instance)\n\t\tmotion.jumped.emit()\n\t\tassert(project.publications.is_empty())\n\t\tassert(motion.get_signal_connection_list(\"jumped\").is_empty())\n\t\tinstance.free()\n\t\tchecked += 1\n\n\tproject = Project.new()\n\tproject.reject_publish = true\n\tmotion = Motion.new()\n\tinstance = publisher(project, motion)\n\troot.add_child(instance)\n\tmotion.jumped.emit()\n\tassert(project.publications.is_empty())\n\tassert(motion.get_signal_connection_list(\"jumped\").is_empty())\n\tassert(motion.get_signal_connection_list(\"landed\").is_empty())\n\tinstance.free()\n\tchecked += 1\n\n\tproject = Project.new()\n\tinstance = audio(project)\n\troot.add_child(instance)\n\tassert(project.publications.is_empty())\n\tassert(project.tracks.is_empty())\n\tassert(project.subscriptions.size() == 1)\n\tassert(project.deliver(\"other.event\", INSTANCE_ID).is_empty())\n\tassert(project.tracks.is_empty())\n\tassert(project.deliver(\"physics.landed\", INSTANCE_ID) == [true])\n\tassert(project.deliver(\"physics.landed\", true) == [true])\n\tassert(project.tracks == [TRACK_ID, TRACK_ID])\n\tinstance.free()\n\tassert(project.subscriptions.is_empty())\n\tassert(project.removals == [1])\n\tassert(project.deliver(\"physics.landed\", INSTANCE_ID).is_empty())\n\tchecked += 1\n\n\tproject = Project.new()\n\tinstance = audio(project)\n\tinstance.event_name = \"actor.touchdown\"\n\tinstance.instance_id = INSTANCE_ID\n\troot.add_child(instance)\n\tassert(project.deliver(\"physics.landed\", INSTANCE_ID).is_empty())\n\tassert(project.deliver(\"actor.touchdown\", OTHER_ID) == [true])\n\tassert(project.deliver(\"actor.touchdown\", true) == [true])\n\tassert(project.tracks.is_empty())\n\tassert(project.deliver(\"actor.touchdown\", INSTANCE_ID) == [true])\n\tassert(project.tracks == [TRACK_ID])\n\tinstance.free()\n\tchecked += 1\n\n\tfor parameter in [\"track_id\", \"instance_id\", \"event_name\"]:\n\t\tproject = Project.new()\n\t\tinstance = audio(project)\n\t\tinstance.set(parameter, \"\" if parameter == \"event_name\" else \"not-a-uuid\")\n\t\troot.add_child(instance)\n\t\tassert(project.tracks.is_empty())\n\t\tassert(project.subscriptions.is_empty())\n\t\tinstance.free()\n\t\tchecked += 1\n\n\tproject = Project.new()\n\tproject.reject_subscribe = true\n\tinstance = audio(project)\n\troot.add_child(instance)\n\tassert(instance.get(\"_subscription\") == 0)\n\tassert(project.subscriptions.is_empty())\n\tassert(project.tracks.is_empty())\n\tinstance.free()\n\tchecked += 1\n\n\tproject = Project.new()\n\tproject.reject_audio = true\n\tinstance = audio(project)\n\troot.add_child(instance)\n\tassert(project.deliver(\"physics.landed\", INSTANCE_ID) == [false])\n\tassert(project.tracks.is_empty())\n\tassert(project.subscriptions.is_empty())\n\tassert(project.removals == [1])\n\tinstance.free()\n\tchecked += 1\n\n\tinstance = audio(RefCounted.new())\n\troot.add_child(instance)\n\tassert(instance.get(\"_subscription\") == 0)\n\tinstance.free()\n\tchecked += 1\n\n\tprint(\"CHARACTER_EVENT_STARTERS_OK:\" + str(checked))\n\tquit()\n";
