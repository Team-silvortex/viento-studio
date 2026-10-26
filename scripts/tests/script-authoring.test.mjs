import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { listScriptStarters, prepareScriptDraft, isScriptDraftProposal, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';

const context = () => ({ sourceToken: 'editor:7:3', documentRoot: 'documents',
  documentTypes: [{ id: 'document', label: '档案' }, { id: 'character', label: '角色' }] });
const request = () => ({ starterId: 'godot-node', documentType: 'document', sourcePath: 'documents/scripts/new.txt' });
const invalid = error => error?.errorCode === 'script_authoring_invalid';
const conflict = error => error?.errorCode === 'script_authoring_conflict';
const propose = (source = context(), selection = request()) => prepareScriptDraft(source, selection);

test('known starters are immutable data and the minimal Node contains no lifecycle or execution instructions', () => {
  const all = listScriptStarters();
  assert.deepEqual(all.map(item => item.id), ['godot-node', 'godot-signal', 'bevy-rust', 'bevy-rust-signal', 'bevy-rust-motion', 'godot-scene-switch', 'godot-project-state', 'godot-project-events', 'godot-physics-sensor', 'godot-character-motion-events', 'godot-character-contact-events', 'godot-character-drop-through', 'godot-platform-endpoint-events', 'godot-project-event-audio', 'godot-project-audio', 'godot-project-animation', 'godot-project-animation-clip', 'godot-project-animation-event', 'godot-project-animation-completion', 'godot-project-animation-state-table']);
  assert.equal(all[0].content, 'extends Node\n');
  for (const starter of all) {
    assert.deepEqual(Object.keys(starter), ['id', 'languageId', 'backendId', 'label', 'description', 'content']);
    const rust = starter.id.startsWith('bevy-rust');
    assert.equal(starter.languageId, rust ? 'rust' : 'gdscript'); assert.equal(starter.backendId, rust ? 'org.viento.bevy-rust' : 'org.viento.godot4');
    assert.equal(Object.isFrozen(starter), true);
    assert.throws(() => { starter.content = 'changed'; }, TypeError);
  }
  assert.equal(Object.isFrozen(all), true); assert.throws(() => all.pop(), TypeError);
});

test('the signal starter retains the exact existing validated checkpoint source including indentation and final newline', async () => {
  const expected = await fs.readFile(new URL('../../examples/scene-behaviors/templates/script.txt', import.meta.url), 'utf8');
  const selection = { ...request(), starterId: 'godot-signal' }, proposal = propose(context(), selection);
  assert.equal(listScriptStarters()[1].content, expected); assert.equal(proposal.content, expected);
  assert.equal(prepareScriptDraftApply(context(), proposal).content, expected);
  for (const key of ['parameters', 'events', 'relations', 'objectId', 'instanceId', 'bindingId']) assert.equal(Object.hasOwn(proposal, key), false);
});

test('planning binds the exact creation context without mutating it or acquiring registration fields', () => {
  const current = context(), selected = request(), before = structuredClone({ current, selected }), proposal = propose(current, selected);
  assert.equal(proposal.format, 'viento-script-draft'); assert.equal(proposal.schemaVersion, 1);
  assert.equal(isScriptDraftProposal(proposal), true);
  assert.deepEqual(proposal, { format: 'viento-script-draft', schemaVersion: 1, ...current, ...selected,
    languageId: 'gdscript', backendId: 'org.viento.godot4', content: 'extends Node\n' });
  assert.deepEqual({ current, selected }, before);
});

test('any existing project type can create TXT under a custom document root without requiring a script type', () => {
  const current = { ...context(), documentRoot: '作品/原文', documentTypes: [{ id: 'lore', label: '設定 😀' }] };
  const selected = { ...request(), documentType: 'lore', sourcePath: '作品/原文/脚本 😀.TXT' };
  const proposal = propose(current, selected);
  assert.equal(proposal.sourcePath, selected.sourcePath); assert.equal(proposal.documentType, 'lore');
  assert.equal(prepareScriptDraftApply(current, proposal).content, 'extends Node\n');
});

test('unsupported starters types request fields and nonstring choices are rejected rather than inferred or coerced', () => {
  for (const change of [{ starterId: 'rust' }, { starterId: 'godot-node ' }, { documentType: 'script' },
    { starterId: { toString() { throw new Error('must not coerce'); } } }, { documentType: null },
    { languageId: 'gdscript' }, { content: 'arbitrary code' }, { parameters: {} }, { sourcePath: ['documents/new.txt'] }]) {
    assert.throws(() => propose(context(), { ...request(), ...change }), invalid);
  }
});

test('paths must remain exact portable TXT paths inside the selected document root', () => {
  for (const sourcePath of ['documents', 'documents-old/new.txt', 'other/new.txt', '/documents/new.txt', 'C:/new.txt',
    'documents/../new.txt', 'documents/./new.txt', 'documents//new.txt', 'documents\\new.txt',
    'docs-standard/documents/new.txt', 'documents/.private/new.txt', 'documents/node_modules/new.txt',
    'documents/CON.txt', 'documents/name?.txt', 'documents/dir /new.txt', 'documents/new.txt ',
    'documents/new.gd', 'documents/new.md', 'documents/new', 'documents/new.txt/', 'documents/bad\0.txt']) {
    assert.throws(() => propose(context(), { ...request(), sourcePath }), invalid, sourcePath);
  }
});

test('filename byte limits are checked after the TXT suffix and exact accepted Unicode spelling is preserved', () => {
  for (const name of ['a'.repeat(251), '中'.repeat(83), 'e\u0301']) {
    const sourcePath = `documents/${name}.txt`;
    assert.equal(propose(context(), { ...request(), sourcePath }).sourcePath, sourcePath);
  }
  for (const name of ['a'.repeat(252), '中'.repeat(84)]) {
    assert.throws(() => propose(context(), { ...request(), sourcePath: `documents/${name}.txt` }), invalid);
  }
  const longPath = 'documents/' + 'a/'.repeat(506) + 'x.txt';
  assert.ok(longPath.length > 1024); assert.throws(() => propose(context(), { ...request(), sourcePath: longPath }), invalid);
});

test('invalid document roots and session tokens never produce usable drafts', () => {
  for (const documentRoot of ['', '/documents', '../documents', 'docs-standard', 'docs-standard/documents',
    'documents/', 'documents//text', '.documents', 'documents/CON', 'a'.repeat(256), 'a/'.repeat(450) + 'b']) {
    assert.throws(() => propose({ ...context(), documentRoot }, { ...request(), sourcePath: `${documentRoot}/new.txt` }), invalid);
  }
  for (const sourceToken of ['', null, 7, 'x'.repeat(257)]) assert.throws(() => propose({ ...context(), sourceToken }), invalid);
});

test('unpaired Unicode is rejected in every caller supplied text field without rewriting source spelling', () => {
  for (const bad of ['\ud800', '\udfff']) {
    for (const current of [{ ...context(), sourceToken: bad }, { ...context(), documentRoot: `documents/${bad}` },
      { ...context(), documentTypes: [{ id: 'document', label: bad }] }, { ...context(), documentTypes: [{ id: bad, label: 'type' }] }]) {
      assert.throws(() => propose(current), invalid);
    }
    for (const change of [{ starterId: bad }, { documentType: bad }, { sourcePath: `documents/${bad}.txt` }]) {
      assert.throws(() => propose(context(), { ...request(), ...change }), invalid);
    }
  }
});

test('catalogs require unique bounded project type identifiers with complete entries', () => {
  for (const documentTypes of [[], {}, null, [context().documentTypes[0], context().documentTypes[0]],
    [{ id: 'Script', label: 'Script' }], [{ id: 'bad.type', label: 'Bad' }], [{ id: 'constructor', label: 'Bad' }],
    [{ id: 'x'.repeat(65), label: 'Bad' }], [{ id: 'document', label: '' }], [{ id: 'document' }],
    [{ id: 'document', label: 'Text', template: 'script.txt' }],
    Array.from({ length: 257 }, (_, i) => ({ id: `type${i}`, label: 'Type' }))]) {
    assert.throws(() => propose({ ...context(), documentTypes }), invalid);
  }
  const documentTypes = Array.from({ length: 256 }, (_, i) => ({ id: `type${i}`, label: 'Type' }));
  assert.equal(propose({ ...context(), documentTypes }, { ...request(), documentType: 'type255' }).documentTypes.length, 256);
});

test('both individual labels and aggregate UTF-8 catalog text have finite budgets', () => {
  assert.throws(() => propose({ ...context(), documentTypes: [{ id: 'document', label: 'x'.repeat(4097) }] }), invalid);
  const documentTypes = Array.from({ length: 3 }, (_, i) => ({ id: `type${i}`, label: '中'.repeat(4096) }));
  assert.throws(() => propose({ ...context(), documentTypes }, { ...request(), documentType: 'type0' }), invalid);
  documentTypes.pop();
  assert.equal(propose({ ...context(), documentTypes }, { ...request(), documentType: 'type0' }).documentTypes.length, 2);
});

test('proposals detach and deeply freeze their entire catalog rather than retaining mutable caller authority', () => {
  const current = context(), selected = request(), proposal = propose(current, selected);
  current.documentTypes[0].label = 'Renamed'; selected.sourcePath = 'documents/replaced.txt';
  assert.equal(proposal.documentTypes[0].label, '档案'); assert.equal(proposal.sourcePath, 'documents/scripts/new.txt');
  for (const value of [proposal, proposal.documentTypes, ...proposal.documentTypes]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { proposal.documentTypes[0].id = 'other'; }, TypeError);
  assert.throws(() => prepareScriptDraftApply(current, proposal), conflict);
  assert.equal(prepareScriptDraftApply(context(), proposal).sourcePath, proposal.sourcePath);
});

test('context request type and array accessors are rejected without evaluating getters', () => {
  let invoked = 0;
  const getter = (value, key) => Object.defineProperty(value, key, { enumerable: true, configurable: true, get() { invoked++; throw new Error('getter executed'); } });
  for (const field of ['sourceToken', 'documentRoot', 'documentTypes']) assert.throws(() => propose(getter(context(), field)), invalid);
  for (const field of ['starterId', 'documentType', 'sourcePath']) assert.throws(() => propose(context(), getter(request(), field)), invalid);
  for (const field of ['id', 'label']) {
    const current = context(); getter(current.documentTypes[0], field); assert.throws(() => propose(current), invalid);
  }
  const current = context(); getter(current.documentTypes, '0'); assert.throws(() => propose(current), invalid);
  assert.equal(invoked, 0);
});

test('custom prototypes serializers and symbol or non-enumerable fields cannot add hidden authority', () => {
  let invoked = 0;
  const inherited = Object.create({ get sourceToken() { invoked++; return 'editor:7:3'; } });
  inherited.documentRoot = 'documents'; inherited.documentTypes = context().documentTypes;
  const serialized = { ...context(), toJSON() { invoked++; return context(); } };
  const symbol = context(); symbol[Symbol('extra')] = true;
  const hidden = context(); Object.defineProperty(hidden, 'hidden', { value: true });
  const hiddenRequired = context(); Object.defineProperty(hiddenRequired, 'sourceToken', { enumerable: false });
  for (const current of [inherited, serialized, symbol, hidden, hiddenRequired]) assert.throws(() => propose(current), invalid);
  const badRequest = Object.assign(Object.create({ inherited: true }), request());
  assert.throws(() => propose(context(), badRequest), invalid);
  const badType = context(); Object.setPrototypeOf(badType.documentTypes[0], { inherited: true });
  assert.throws(() => propose(badType), invalid);
  assert.equal(invoked, 0);
});

test('sparse augmented inherited and excessive arrays cannot enter a context snapshot', () => {
  const sparse = context().documentTypes; delete sparse[0];
  const augmented = context().documentTypes; augmented.extra = true;
  const symbolic = context().documentTypes; symbolic[Symbol('extra')] = true;
  const inherited = context().documentTypes; Object.setPrototypeOf(inherited, Object.create(Array.prototype));
  const excessive = []; excessive.length = 1000000;
  for (const documentTypes of [sparse, augmented, symbolic, inherited, excessive]) assert.throws(() => propose({ ...context(), documentTypes }), invalid);
});

test('plain null-prototype contexts requests and type records remain valid data', () => {
  const current = Object.assign(Object.create(null), context());
  current.documentTypes = current.documentTypes.map(item => Object.assign(Object.create(null), item));
  const selected = Object.assign(Object.create(null), request());
  const proposal = propose(current, selected);
  assert.equal(isScriptDraftProposal(proposal), true);
  assert.deepEqual(prepareScriptDraftApply(current, proposal), {
    ...request(), languageId: 'gdscript', backendId: 'org.viento.godot4', content: 'extends Node\n',
  });
});

test('the private proposal brand rejects clones serialized inherited wrapped and foreign-module proposals', async () => {
  const proposal = propose(), foreign = await import('../../engine/script-authoring.mjs?foreign-test');
  const throwing = Object.defineProperty({}, 'sourceToken', { get() { throw new Error('must not inspect forged proposal'); } });
  for (const input of [null, true, 'proposal', {}, { ...proposal }, structuredClone(proposal), JSON.parse(JSON.stringify(proposal)),
    Object.create(proposal), new Proxy(proposal, {}), throwing, foreign.prepareScriptDraft(context(), request())]) {
    assert.equal(isScriptDraftProposal(input), false); assert.throws(() => prepareScriptDraftApply(context(), input), conflict);
  }
});

test('apply rejects session root catalog label ordering membership and shape changes without invoking a new getter', () => {
  const proposal = propose(), variants = [{ ...context(), sourceToken: 'another-session' }, { ...context(), documentRoot: 'other' },
    { ...context(), documentTypes: context().documentTypes.reverse() }, { ...context(), documentTypes: context().documentTypes.slice(0, 1) },
    { ...context(), documentTypes: [...context().documentTypes, { id: 'new', label: 'New' }] },
    { ...context(), documentTypes: [{ id: 'document', label: 'Renamed' }, context().documentTypes[1]] },
    { ...context(), documentTypes: [{ id: 'renamed', label: '档案' }, context().documentTypes[1]] },
    { ...context(), extra: true }, null];
  let invoked = 0;
  variants.push(Object.defineProperty(context(), 'sourceToken', { enumerable: true, get() { invoked++; return proposal.sourceToken; } }));
  for (const current of variants) assert.throws(() => prepareScriptDraftApply(current, proposal), conflict);
  assert.equal(invoked, 0);
});

test('accepted drafts expose only frozen creation data and keep saved identifiers or relationship authority absent', () => {
  const proposal = propose(), accepted = prepareScriptDraftApply(context(), proposal);
  assert.equal(Object.isFrozen(accepted), true);
  assert.deepEqual(Object.keys(accepted), ['starterId', 'languageId', 'backendId', 'documentType', 'sourcePath', 'content']);
  assert.throws(() => { accepted.content = 'overwritten'; }, TypeError);
  assert.throws(() => { proposal.sourcePath = 'documents/other.txt'; }, TypeError);
  assert.equal(isScriptDraftProposal(accepted), false);
  assert.deepEqual(prepareScriptDraftApply(context(), proposal), accepted);
});


test('Bevy Rust starters create ordinary reviewed TXT drafts with their exact profile and no world or build authority', () => {
  for (const starter of listScriptStarters().filter(item => item.languageId === 'rust')) {
    const selected = { ...request(), starterId: starter.id }, proposal = propose(context(), selected);
    assert.equal(proposal.backendId, 'org.viento.bevy-rust'); assert.equal(proposal.languageId, 'rust');
    assert.equal(proposal.sourcePath, 'documents/scripts/new.txt'); assert.equal(proposal.content, starter.content);
    assert.equal(isScriptDraftProposal(proposal), true); assert.equal(Object.isFrozen(proposal), true);
    assert.deepEqual(prepareScriptDraftApply(context(), proposal), { ...selected, languageId: 'rust', backendId: 'org.viento.bevy-rust', content: starter.content });
    for (const key of ['parameters', 'events', 'relations', 'objectId', 'bindingId', 'dependencies', 'buildCommand']) assert.equal(Object.hasOwn(proposal, key), false);
    assert.throws(() => prepareScriptDraftApply({ ...context(), sourceToken: 'different-source' }, proposal), conflict);
  }
});

test('the Bevy Rust signal starter owns borrowed strings before emission and propagates parameter or signal errors', () => {
  const empty = listScriptStarters().find(item => item.id === 'bevy-rust');
  assert.equal(empty.content, 'use crate::runtime::BehaviorContext;\n\npub fn ready(_ctx: &mut BehaviorContext) -> Result<(), String> {\n    Ok(())\n}\n');
  const signal = listScriptStarters().find(item => item.id === 'bevy-rust-signal');
  assert.equal(signal.content, 'use crate::runtime::BehaviorContext;\n\npub fn ready(ctx: &mut BehaviorContext) -> Result<(), String> {\n    let checkpoint = ctx.string("checkpoint")?.to_owned();\n    let amount = ctx.number("amount")?;\n    ctx.emit("arrived", vec![checkpoint.into(), amount.into()])?;\n    Ok(())\n}\n');
});


test('the audio starter remains a reviewed ordinary draft with an explicit track parameter and no registration authority', () => {
  const starter = listScriptStarters().find(item => item.id === 'godot-project-audio');
  const selected = { ...request(), starterId: starter.id }, proposal = propose(context(), selected);
  assert.equal(starter.label, 'Godot / 事件声音'); assert.match(starter.description, /音轨 UUID/);
  assert.equal(proposal.content, starter.content); assert.equal(proposal.backendId, 'org.viento.godot4');
  assert.equal(prepareScriptDraftApply(context(), proposal).content, starter.content);
  for (const key of ['parameters', 'audio', 'tracks', 'relations', 'trackId', 'objectId', 'bindingId', 'buildCommand']) assert.equal(Object.hasOwn(proposal, key), false);
  assert.throws(() => prepareScriptDraftApply({ ...context(), sourceToken: 'another-task' }, proposal), conflict);
});

test('the audio starter guards missing project or track, defers publication and accepts only boolean play/stop requests', () => {
  const content = listScriptStarters().find(item => item.id === 'godot-project-audio').content;
  assert.match(content, /@export var track_id: String = ""/);
  assert.match(content, /if track_id\.is_empty\(\) or not has_meta\("viento_project"\):\n\t\treturn/);
  assert.match(content, /subscribe_event\("sound", _on_sound\) == 0/);
  assert.match(content, /call_deferred\("_publish_sound"\)/);
  assert.match(content, /func _publish_sound\(\) -> void:\n\t_project\.publish_event\("sound", true\)/);
  assert.match(content, /func _on_sound\(value\) -> bool:\n\tif typeof\(value\) != TYPE_BOOL:\n\t\treturn false/);
  assert.match(content, /if value:\n\t\treturn _project\.play_audio\(track_id\)\n\treturn _project\.stop_audio\(track_id\)\n$/);
  assert.doesNotMatch(content, /AudioStreamPlayer|AudioServer|await |res:\/\/|\.wav/);
});

test('the animation starter is an ordinary project-scoped draft with four explicit commands and no resource authority', () => {
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation');
  const selected = { ...request(), starterId: starter.id }, proposal = propose(context(), selected);
  assert.equal(starter.label, 'Godot / 项目动画控制');
  assert.match(starter.description, /当前场景的整份动画/); assert.match(starter.description, /单场景运行时不控制动画/);
  assert.equal(prepareScriptDraftApply(context(), proposal).content, starter.content);
  assert.equal(proposal.languageId, 'gdscript'); assert.equal(proposal.backendId, 'org.viento.godot4');
  for (const key of ['animation', 'tracks', 'relations', 'objectId', 'instanceId', 'bindingId', 'parameters', 'buildCommand']) assert.equal(Object.hasOwn(proposal, key), false);
  assert.throws(() => prepareScriptDraftApply({ ...context(), sourceToken: 'changed' }, proposal), conflict);
  assert.match(starter.content, /if not project\.has_method\("play_animation"\):\n\t\treturn/);
  assert.match(starter.content, /@export var command: String = "play"/);
  assert.match(starter.content, /@export var time_seconds: float = 0\.0/);
  assert.match(starter.content, /if not has_meta\("viento_project"\):\n\t\treturn/);
  for (const command of ['play', 'pause', 'stop']) assert.ok(starter.content.includes(`"${command}":\n\t\t\tproject.${command}_animation()`));
  assert.match(starter.content, /"seek":\n\t\t\tproject\.seek_animation\(time_seconds\)/);
  assert.doesNotMatch(starter.content, /get_tree|get_parent|AnimationPlayer|Sprite2D|FileAccess|res:\/\/|UUID|await /);
});

test('named animation clip starter selects by stable UUID and guards older project ports',()=>{
 const starter=listScriptStarters().find(item=>item.id==='godot-project-animation-clip'),proposal=propose(context(),{...request(),starterId:starter.id});
 assert.equal(prepareScriptDraftApply(context(),proposal).content,starter.content);
 assert.match(starter.content,/if not project\.has_method\("select_animation_clip"\):\n\t\treturn/);
 assert.match(starter.content,/var selection = null if clip_id\.is_empty\(\) else clip_id/);
 assert.match(starter.content,/if project\.select_animation_clip\(selection\):\n\t\tproject\.play_animation\(\)/);
 assert.doesNotMatch(starter.content,/AnimationPlayer|FileAccess|get_parent|seek_animation|call_deferred/);
});


test('event animation starter follows ordinary reviewed TXT creation without acquiring behavior or execution authority', () => {
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation-event');
  const current = { ...context(), documentRoot: 'design-data' }, selected = { ...request(), starterId: starter.id, sourcePath: 'design-data/scripts/事件 动画.txt' };
  const before = structuredClone({ current, selected }), proposal = prepareScriptDraft(current, selected);
  assert.equal(isScriptDraftProposal(proposal), true);
  assert.deepEqual(prepareScriptDraftApply(current, proposal), { starterId: starter.id, backendId: 'org.viento.godot4', languageId: 'gdscript', documentType: selected.documentType, sourcePath: selected.sourcePath, content: starter.content });
  assert.deepEqual({ current, selected }, before);
  for (const key of ['parameters', 'events', 'relations', 'objectId', 'instanceId', 'bindingId']) assert.equal(Object.hasOwn(proposal, key), false);
  assert.equal(starter.content.endsWith('\n'), true);
});


test('completion animation starter uses ordinary reviewed TXT drafts and preserves stale-session protection', () => {
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation-completion');
  for (const documentRoot of ['documents', '设计/正文']) {
    const current = { ...context(), documentRoot };
    const selection = { ...request(), starterId: starter.id, sourcePath: `${documentRoot}/scripts/动画衔接.txt` };
    const before = structuredClone({ current, selection }), proposal = prepareScriptDraft(current, selection);
    assert.equal(isScriptDraftProposal(proposal), true);
    assert.deepEqual(prepareScriptDraftApply(current, proposal), { ...selection, backendId: 'org.viento.godot4', languageId: 'gdscript', content: starter.content });
    assert.deepEqual({ current, selection }, before);
    for (const key of ['parameters', 'events', 'relations', 'objectId', 'instanceId', 'bindingId']) assert.equal(Object.hasOwn(proposal, key), false);
    assert.throws(() => prepareScriptDraftApply({ ...current, sourceToken: 'new-session' }, proposal), conflict);
    assert.equal(starter.content.endsWith('\n'), true);
  }
});
