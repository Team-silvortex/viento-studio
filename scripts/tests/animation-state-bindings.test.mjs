import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureAnimationStateBindings, discoverAnimationStateBindings, reviewAnimationStateBindings } from '../../engine/animation-state-bindings.mjs';
import { captureSceneBehaviorAnimationClips } from '../../engine/scene-animation-directory.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/godot-animation-state-script.mjs';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') });
const animation = () => ({ format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(10), instanceId: id(8), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }],
  clips: [{ id: id(5), name: '待機 / Idle', startSeconds: .25, endSeconds: 1, loop: true },
    { id: id(4), name: '攻撃 / Attack', startSeconds: .5, endSeconds: 2, loop: false }] });
const source = () => {
  const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(3), instanceId: id(8),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(9) }, parameters: {}, events: [] }] });
  return { sourcePath: 'documents/behaviors/main.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content };
};
function catalog(document = animation()) {
  const raw = { format: 'viento-scene-animation-directory', schemaVersion: 1, status: document ? 'ready' : 'empty', worldId: 'world:' + 'a'.repeat(64),
    revision: revision('world'), scene: scene(), manifest: document ? { objectId: id(2), sourcePath: 'documents/animations/main.json', sourceRevision: revision(JSON.stringify(document)), content: JSON.stringify(document) } : null };
  return captureSceneBehaviorAnimationClips(source(), raw, scene());
}
const descriptor = () => ({ format: 'viento-animation-state-bindings', schemaVersion: 1, initialState: 'idle',
  states: [{ stateKey: 'idle', parameterName: 'clip_idle', hasCompletion: false }, { stateKey: 'action', parameterName: 'clip_action', hasCompletion: true }] });
const row = (name, value = '', type = 'string') => ({ name, type, value });
const selections = (idle = id(5), action = id(4)) => [{ stateKey: 'idle', clipId: idle }, { stateKey: 'action', clipId: action }];
const review = (parameters = [], extra = {}) => reviewAnimationStateBindings({ declaration: descriptor(), catalog: catalog(), parameters, ...extra });
const invalid = { errorCode: 'animation_state_bindings_invalid' };
const codes = result => result.issues.map(issue => issue.code);
const prefix = '# Viento animation state script\n#@viento-animation-state-script ';
function editHeader(content, change) { const end = content.indexOf('\n', prefix.length), header = JSON.parse(content.slice(prefix.length, end)); change(header); return prefix + JSON.stringify(header) + content.slice(end); }
function versionTable(version) {
  const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE), scalar = { type: 'boolean', operator: 'eq', value: true };
  if (version === 2 || version === 3) table.transitions[0].trigger.condition = scalar;
  if (version === 3) table.eventSelection = 'firstMatch';
  if (version === 4) table.transitions[0].trigger.condition = { ...scalar, selector: { kind: 'projectState', key: 'combat.enabled' } };
  if (version === 5) table.transitions[0].trigger.condition = { combine: 'all', conditions: [scalar, { ...scalar, selector: { kind: 'projectState', key: 'combat.enabled' } }] };
  return table;
}

test('strict complete v1-v5 sources yield the same bounded binding metadata, preserving BOM and CRLF acceptance', () => {
  for (const version of [1, 2, 3, 4, 5]) {
    const content = generateEditableGodotAnimationStateScript(versionTable(version)).content;
    assert.match(content, new RegExp('"generator":"godot-gdscript-v' + version + '"'));
    for (const bom of ['', '\ufeff']) for (const newline of ['\n', '\r\n']) {
      const value = discoverAnimationStateBindings(bom + content.replaceAll('\n', newline));
      assert.deepEqual(value, descriptor()); assert.ok(Object.isFrozen(value.states[0]));
      assert.equal(JSON.stringify(value).includes('extends Node'), false);
    }
  }
});
test('discovery follows real state order and completion origins, not naming conventions or event names', () => {
  const table = { initialState: 'constructor', states: [{ key: 'action' }, { key: 'constructor' }, { key: 'idle' }], transitions: [
    { from: 'constructor', to: 'constructor', trigger: { kind: 'completed' } }, { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'completed' } } ] };
  const value = discoverAnimationStateBindings(generateEditableGodotAnimationStateScript(table).content);
  assert.equal(value.initialState, 'constructor'); assert.deepEqual(value.states.map(item => [item.stateKey, item.hasCompletion]), [['action', false], ['constructor', true], ['idle', false]]);
});
test('ordinary, edited, malformed, unsupported and spoofed source markers never expose actionable metadata', () => {
  const source = DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT;
  for (const content of [null, {}, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT, '@export var clip_idle: String = ""\n', 'unrelated\n' + source, source + '# edited\n',
    source.replace('@export var clip_idle', '@export var clip_other'), prefix + '{}\n', editHeader(source, e => { e.schemaVersion = 2; }),
    editHeader(source, e => { e.generator = 'godot-gdscript-v99'; }), editHeader(source, e => { e.table.initialState = 'missing'; }),
    editHeader(source, e => { e.table.states[0].key = 'idle\n'; }), source.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')])
    assert.equal(discoverAnimationStateBindings(content), null);
});
test('optional core absence does not infer metadata from generated declarations', async () => {
  const module = new URL('../../engine/animation-state-bindings.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';import {discoverAnimationStateBindings} from ${JSON.stringify(module)};assert.equal(discoverAnimationStateBindings(${JSON.stringify(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT)}),null);`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
});
test('descriptor capture detaches and freezes all fields without requiring transient source authority', () => {
  const input = descriptor(), value = captureAnimationStateBindings(input);
  input.states[0].stateKey = 'other'; input.initialState = 'other';
  assert.deepEqual(value, descriptor()); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.states)); assert.ok(Object.isFrozen(value.states[0]));
  assert.deepEqual(captureAnimationStateBindings(JSON.parse(JSON.stringify(value))), value);
});
test('descriptor rejects incomplete, duplicate, misleading or oversized state metadata', () => {
  for (const change of [d => { d.format = 'other'; }, d => { d.schemaVersion = 2; }, d => { d.initialState = 'absent'; }, d => { d.extra = true; },
    d => { d.states = []; }, d => { d.states.push(d.states[0]); }, d => { d.states = Array(17).fill(d.states[0]); },
    d => { d.states[0].parameterName = 'clip_action'; }, d => { d.states[0].hasCompletion = 1; }, d => { d.states[0].extra = true; },
    d => { d.states[0].stateKey = 'UPPER'; }, d => { d.states[0].stateKey = 'idle\n'; d.states[0].parameterName = 'clip_idle\n'; },
    d => { d.states[0].stateKey = 'a'.repeat(33); }, d => { d.states[0].stateKey = '__proto__'; }]) {
    const value = descriptor(); change(value); assert.throws(() => captureAnimationStateBindings(value), invalid);
  }
});
test('capture and review reject getters, hidden fields, symbols, sparse arrays and inherited prototypes without executing getters', () => {
  let calls = 0; const getter = { enumerable: true, get() { calls++; return []; } };
  for (const change of [d => Object.defineProperty(d, 'states', getter), d => Object.defineProperty(d.states[0], 'hasCompletion', getter),
    d => Object.defineProperty(d.states, '0', getter), d => { delete d.states[0]; }, d => { d.states.extra = true; }, d => { d[Symbol()] = true; },
    d => Object.defineProperty(d, 'hidden', { value: true }), d => Object.setPrototypeOf(d, { extra: true })]) {
    const d = descriptor(); change(d); assert.throws(() => captureAnimationStateBindings(d), invalid);
  }
  for (const change of [d => Object.defineProperty(d, 'parameters', getter), d => Object.defineProperty(d.parameters[0], 'value', getter),
    d => Object.defineProperty(d.selections[0], 'clipId', getter), d => { d.parameters[Symbol()] = true; }, d => { delete d.selections[0]; },
    d => { d.extra = true; }, d => Object.setPrototypeOf(d.parameters[0], { inherited: true })]) {
    const d = { declaration: descriptor(), catalog: catalog(), parameters: [row('clip_idle')], selections: selections() }; change(d);
    assert.throws(() => reviewAnimationStateBindings(d), invalid);
  }
  assert.equal(calls, 0);
});
test('only existing branded animation catalogs are accepted, without reading forged getters', () => {
  let calls = 0; const real = catalog();
  for (const forged of [null, {}, { ...real }, structuredClone(real), Object.create(real), { get status() { calls++; return 'ready'; } }])
    assert.throws(() => review([], { catalog: forged }), invalid);
  assert.equal(calls, 0);
});
test('missing parameters default to full animation and append in declaration order', () => {
  const value = review(); assert.equal(value.canApply, true); assert.deepEqual(value.parameters, [row('clip_idle'), row('clip_action')]);
  assert.deepEqual(value.states.map(s => s.clipId), ['', '']); assert.deepEqual(codes(value), []);
});
test('explicit complete selections update matching rows and append missing targets while preserving foreign raw values and order', () => {
  const parameters = [row('speed', '1e-', 'number'), row('clip_action', id(999)), row('unknown', 'prefix\0日本語🎮'), row('flag', 'false', 'boolean'), row('negative_zero', '-0', 'number')];
  const before = structuredClone(parameters), selected = selections().reverse(), result = review(parameters, { selections: selected });
  assert.equal(result.canApply, true); assert.deepEqual(result.parameters, [parameters[0], row('clip_action', id(4)), ...parameters.slice(2), row('clip_idle', id(5))]);
  assert.deepEqual(parameters, before); assert.deepEqual(selected, selections().reverse()); assert.ok(Object.isFrozen(result.parameters[0]));
  assert.ok(Object.isFrozen(result.states[0].issues)); assert.ok(Object.isFrozen(result.issues));
});
test('explicit full-animation selection is retained, and local validity does not imply a change or Save permission', () => {
  const rows = [row('clip_idle'), row('clip_action')], value = review(rows, { selections: selections('', '') });
  assert.equal(value.canApply, true); assert.deepEqual(value.parameters, rows); assert.deepEqual(codes(value), []);
});
test('invalid current text and absent clip references are explicit, and a complete selection can repair them', () => {
  for (const [clip, code] of [['bad', 'invalid-clip'], [id(4) + '\n', 'invalid-clip'], [id(999), 'clip-missing']]) {
    const parameters = [row('clip_action', clip)], value = review(parameters);
    assert.equal(value.canApply, false); assert.equal(value.parameters, null); assert.equal(value.states[1].clipId, clip); assert.deepEqual(codes(value), [code]);
    assert.equal(review(parameters, { selections: selections() }).canApply, true);
  }
});
test('duplicate target names and wrong scalar types prevent any replacement even with valid selections', () => {
  for (const [parameters, code] of [[[row('clip_idle', ''), row('clip_idle', id(5))], 'duplicate-parameter'], [[row('clip_action', 'true', 'boolean')], 'type-mismatch']]) {
    const before = structuredClone(parameters), value = review(parameters, { selections: selections() });
    assert.equal(value.canApply, false); assert.equal(value.parameters, null); assert.ok(codes(value).includes(code)); assert.deepEqual(parameters, before);
  }
});
test('unrelated duplicate names and unfinished raw values remain owned by ordinary behavior validation', () => {
  const parameters = [row('unrelated', 'bad'), row('unrelated', '1e-', 'number')], value = review(parameters, { selections: selections() });
  assert.equal(value.canApply, true); assert.deepEqual(value.parameters.slice(0, 2), parameters);
});
test('missing animation blocks configuration including an empty full-animation choice', () => {
  const value = review([], { catalog: catalog(null) }); assert.equal(value.canApply, false); assert.equal(value.parameters, null); assert.deepEqual(codes(value), ['animation-missing']);
});
test('completion on a looping named clip only warns; event-only loops and finite completion clips stay valid', () => {
  const value = review([], { selections: selections(id(5), id(5)) });
  assert.equal(value.canApply, true); assert.equal(value.parameters[1].value, id(5));
  assert.deepEqual(value.issues, [{ code: 'completion-loop', severity: 'warning', stateKey: 'action', parameterName: 'clip_action' }]);
  assert.deepEqual(value.states[0].issues, []); assert.deepEqual(value.states[1].issues, value.issues);
  assert.deepEqual(codes(review([], { selections: selections() })), []);
});
test('full-animation loop behavior is never guessed from the named catalog or schema version', () => {
  for (const schemaVersion of [1, 2, 3]) for (const loop of [false, true]) {
    const a = animation(); a.schemaVersion = schemaVersion; a.loop = loop; if (schemaVersion < 3) delete a.clips; else a.clips = [];
    const value = review([], { catalog: catalog(a) }); assert.equal(value.canApply, true); assert.deepEqual(codes(value), []);
  }
});
test('parameter budget counts missing rows and exact full capacity permits updates', () => {
  const unknown = count => Array.from({ length: count }, (_, i) => row('extra_' + i, 'keep'));
  assert.equal(review(unknown(30)).parameters.length, 32);
  const tooMany = review(unknown(31)); assert.equal(tooMany.canApply, false); assert.equal(tooMany.parameters, null); assert.deepEqual(codes(tooMany), ['parameter-limit']);
  assert.equal(review([...unknown(30), row('clip_idle'), row('clip_action')], { selections: selections() }).parameters.length, 32);
  assert.throws(() => review(unknown(33)), invalid);
});
test('selection lists must name every state exactly once and cannot silently omit, duplicate or add targets', () => {
  for (const selected of [undefined, null, [], [selections()[0]], [selections()[0], selections()[0]], [...selections(), { stateKey: 'extra', clipId: '' }],
    [{ stateKey: 'unknown', clipId: '' }, selections()[1]], [{ ...selections()[0], extra: true }, selections()[1]], [{ ...selections()[0], clipId: null }, selections()[1]]])
    assert.throws(() => review([], { selections: selected }), invalid);
});
test('parameter raw text and shapes are bounded without coercion or evaluation', () => {
  for (const parameters of [[row('clip_idle', 1)], [row('clip_idle', '', 'object')], [row('x', '\ud800')], [row('x', 'a'.repeat(4097))],
    [row('a'.repeat(4097))], [{ ...row('x'), extra: true }]]) assert.throws(() => review(parameters), invalid);
  assert.equal(review([row('x', 'a'.repeat(4096))]).parameters[0].value.length, 4096);
});
test('independent binding reviews share immutable catalogs without leaking selections or modifying prior results', () => {
  const saved = catalog(), a = review([], { catalog: saved, selections: selections() }), b = review([row('clip_idle')], { catalog: saved, selections: selections('', '') });
  assert.deepEqual(a.parameters, [row('clip_idle', id(5)), row('clip_action', id(4))]); assert.deepEqual(b.parameters, [row('clip_idle'), row('clip_action')]);
  assert.deepEqual(a.states.map(s => s.clipId), [id(5), id(4)]); assert.equal(saved.clips.length, 2);
});
