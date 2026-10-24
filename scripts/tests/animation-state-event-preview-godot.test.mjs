import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createAnimationStateEventPreview, evaluateAnimationStateEventPreview } from '../../engine/animation-state-event-preview.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const leaf = (value = true, key, operator = 'eq') => ({ type: typeof value, operator, value, ...(key === undefined ? {} : { selector: { kind: 'projectState', key } }) });
const group = (combine, conditions) => ({ combine, conditions });
const edge = (condition, to = 'action', name = 'go', from = 'idle') => ({ from, to, trigger: { kind: 'event', name, ...(condition === undefined ? {} : { condition }) } });
const table = (transitions, ordered = false) => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }, { key: 'other' }], transitions, ...(ordered ? { eventSelection: 'firstMatch' } : {}) });
const sample = (value = true, values = {}, stateKey = 'idle', name = 'go') => ({ stateKey, event: { name, value }, projectState: Object.entries(values).map(([key, value]) => ({ key, value })) });
const digest = content => createHash('sha256').update(content).digest('hex');
function literal(value) {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); return `PackedByteArray(${JSON.stringify([...bytes])}).decode_double(0)`; }
  if (typeof value === 'string') return value.length ? `(${[...value].map(character => `String.chr(${character.codePointAt(0)})`).join('+')})` : '""';
  throw Error('Only valid sample scalars reach the Godot probe.');
}
function fixtures() {
  const scenarios = [];
  const add = (version, name, declaration, inputs) => { for (const [ordinal, input] of inputs.entries()) scenarios.push({ version, name: `${name}-${ordinal}`, table: declaration, input }); };
  add(1, 'unguarded', table([edge(), edge(undefined, 'idle', 'restart'), { from: 'action', to: 'idle', trigger: { kind: 'completed' } }]),
    [sample(), sample(false, {}, 'idle', 'restart'), sample(true, {}, 'action'), sample(true, {}, 'idle', 'unknown')]);
  const constants = [true, false, 0, .3, .1 + .2, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -53, 1e9, -1e9, '', '前\0後🎮\n'];
  for (const constant of constants) {
    const declaration = table([edge(leaf(constant)), edge(leaf(constant, undefined, 'ne'), 'other', 'different')]);
    add(2, `typed-${constants.indexOf(constant)}`, declaration, [sample(constant), sample(typeof constant === 'boolean' ? 0 : true), sample(constant, {}, 'idle', 'different')]);
  }
  for (const operator of ['lt', 'lte', 'gt', 'gte']) add(2, operator, table([edge(leaf(.3, undefined, operator))]), [sample(.3), sample(.1 + .2), sample(0)]);
  add(3, 'firstMatch', table([edge(leaf(5, undefined, 'gte')), { from: 'action', to: 'idle', trigger: { kind: 'completed' } }, edge(leaf(true), 'other'), edge(undefined, 'idle')], true),
    [sample(5), sample(2), sample(true), sample(false), sample(true, {}, 'action')]);
  add(4, 'selected', table([edge(leaf(true, 'ready')), edge(leaf(1, 'speed', 'ne'), 'other'), edge(undefined, 'idle')], true),
    [sample(false, { ready: true, speed: 2 }), sample(false, { ready: false, speed: 2 }), sample(false, { ready: false }), sample(false, { ready: 1, speed: true }), sample(false, { ready: false, speed: 1 })]);
  for (const combine of ['all', 'any']) add(5, combine, table([edge(group(combine, [leaf(true, 'a'), leaf(true, 'b'), leaf(true, 'c')]))]),
    [sample(false, { a: false, b: false, c: false }), sample(false, { a: true, b: false, c: true }), sample(false, { a: false, b: true, c: false }), sample(false, { a: true, b: true, c: true }), sample()]);
  const mixed = table([edge(group('all', [leaf(.5, undefined, 'gte'), leaf(true, 'ready'), leaf(true, 'ready')])),
    edge(group('any', [leaf(true), leaf('go', 'mode')]), 'other'), edge(undefined, 'idle')], true);
  add(5, 'mixed-branches', mixed, [sample(1, { ready: true, mode: 'go' }), sample(1, { ready: false, mode: 'go' }), sample(true), sample(0), sample(1), sample('go', { mode: 'go' })]);
  add(5, 'missing-ne', table([edge(group('any', [leaf(false, 'missing', 'ne'), leaf(true, 'ready')]), 'idle')]), [sample(true), sample(true, { ready: true }), sample(true, { missing: 0, ready: true }), sample(true, { missing: true, ready: false })]);
  add(5, 'singleton', table([edge(group('all', [leaf(true, 'one')]))]), [sample(false, { one: true }), sample(false, { one: false })]);
  add(5, 'nul', table([edge(group('all', [leaf('前\0後🎮\n'), leaf('前\0後🎮\n', 'text')]))]), [sample('前\0後🎮\n', { text: '前\0後🎮\n' }), sample('前', { text: '前\0後🎮\n' })]);
  // A selected branch is not entered or played by the preview. Even a real
  // failed _enter_state returns immediately instead of trying another branch.
  scenarios.push({ version: 5, name: 'selected-entry-rejected', table: mixed, input: sample(1, { ready: true, mode: 'go' }), enterResult: false });
  return scenarios;
}

test('manual preview matches actual v1-v5 GDScript scalar bytes and explicitly preserves the NUL transport limitation', {
  skip: !tool ? 'Set VIENTO_GODOT_BIN for real generated-script event preview parity' : false, timeout: 90000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-event-preview-godot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sources = new Map(), cases = fixtures();
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Manual event trial parity"\n');
  for (const [index, row] of cases.entries()) {
    const content = generateEditableGodotAnimationStateScript(row.table).content;
    assert.ok(content.includes(`"generator":"godot-gdscript-v${row.version}"`));
    const generated = `controller_${index}.gd`, probe = `probe_${index}.gd`;
    sources.set(generated, digest(content)); await fs.writeFile(path.join(directory, generated), content);
    const subclass = `extends "res://${generated}"
var target: int = -1
var comparisons: Array = []
var entry_result: bool = true
func _enter_state(next_state: int) -> bool:
\ttarget = next_state
\treturn entry_result
${row.version === 1 ? '' : `func _condition_matches(value, condition: Dictionary) -> bool:
\tvar result: bool = super._condition_matches(value, condition)
\tcomparisons.append(result)
\treturn result
`}`;
    await fs.writeFile(path.join(directory, probe), subclass);
  }
  const source = `extends SceneTree
class TracePort extends RefCounted:
\tvar values: Dictionary = {}
\tvar reads: Array = []
\tfunc read_state(key) -> Variant:
\t\treads.append(key)
\t\treturn values.get(key)
func scalar_witness(value) -> Dictionary:
\tif typeof(value) == TYPE_STRING:
\t\treturn {"type":"string","bytes":Array(value.to_utf8_buffer())}
\tif typeof(value) == TYPE_BOOL:
\t\treturn {"type":"boolean","value":value}
\tvar bytes := PackedByteArray()
\tbytes.resize(8)
\tbytes.encode_double(0,float(value))
\treturn {"type":"number","bytes":Array(bytes)}
func state_witness(values: Dictionary) -> Array:
\tvar entries: Array = []
\tfor key in values:
\t\tentries.append({"key":key,"value":scalar_witness(values[key])})
\treturn entries
func _initialize() -> void:
${cases.map((row, index) => `\tvar port_${index} = TracePort.new()
\tport_${index}.values = {${row.input.projectState.map(({ key, value }) => `${JSON.stringify(key)}:${literal(value)}`).join(',')}}
\tvar node_${index} = load("res://probe_${index}.gd").new()
\tnode_${index}._project = port_${index}
\tnode_${index}._active = true
\tnode_${index}._state = ${row.table.states.findIndex(state => state.key === row.input.stateKey)}
\tnode_${index}.entry_result = ${row.enterResult !== false}
\tvar payload_${index} = ${literal(row.input.event.value)}
\tvar handled_${index} = node_${index}._on_event(payload_${index},${JSON.stringify(row.input.event.name)})
\tprint("PARITY:"+JSON.stringify([${index},node_${index}.target,port_${index}.reads,node_${index}.comparisons,handled_${index},scalar_witness(payload_${index}),state_witness(port_${index}.values)]))
\tnode_${index}.free()`).join('\n')}
\tquit()
`;
  await fs.writeFile(path.join(directory, 'run.gd'), source);
  const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' };
  for (const [key, name] of [['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data']]) { env[key] = path.join(directory, name); await fs.mkdir(env[key]); }
  const result = await promisify(execFile)(tool, ['--headless', '--path', directory, '--script', 'res://run.gd'], { env, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(/SCRIPT ERROR|Parse Error|ERROR:/.test(result.stderr), false, result.stderr);
  const traces = result.stdout.split('\n').filter(line => line.startsWith('PARITY:')).map(line => JSON.parse(line.slice(7)));
  assert.equal(traces.length, cases.length, result.stdout);
  const transportDifferences = [], selectionDifferences = [];
  const decode = witness => {
    if (witness.type === 'boolean') { assert.equal(typeof witness.value, 'boolean'); return witness.value; }
    assert.ok(Array.isArray(witness.bytes) && witness.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
    const bytes = Uint8Array.from(witness.bytes);
    if (witness.type === 'string') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.equal(witness.type, 'number'); assert.equal(bytes.length, 8); return new DataView(bytes.buffer).getFloat64(0, true);
  };
  const traceFor = (row, input, index) => {
    const preview = evaluateAnimationStateEventPreview(createAnimationStateEventPreview(row.table), input);
    const reached = preview.candidates.flatMap(candidate => candidate.leaves.filter(leaf => leaf.status === 'evaluated'));
    const target = preview.selected === null ? -1 : row.table.states.findIndex(state => state.key === preview.selected.stateKey);
    return [index, target, reached.filter(leaf => leaf.condition.selector).map(leaf => leaf.condition.selector.key), reached.map(leaf => leaf.matches), row.enterResult !== false || preview.selected === null];
  };
  // Godot's String.chr(0) constructs U+FFFD, not NUL. Keep this discrepancy
  // explicit instead of silently changing author constants or manual samples.
  const constructed = value => typeof value === 'string' ? value.replaceAll('\0', '\ufffd') : value;
  for (const [index, row] of cases.entries()) await t.test(`${row.version}:${row.name}`, () => {
    const observed = { stateKey: row.input.stateKey, event: { name: row.input.event.name, value: decode(traces[index][5]) },
      projectState: traces[index][6].map(entry => ({ key: entry.key, value: decode(entry.value) })) };
    const expectedConstruction = { stateKey: row.input.stateKey, event: { name: row.input.event.name, value: constructed(row.input.event.value) },
      projectState: row.input.projectState.map(entry => ({ key: entry.key, value: constructed(entry.value) })) };
    assert.deepEqual(observed, expectedConstruction, 'The probe must account for every scalar byte before claiming runtime parity.');
    const actual = traces[index].slice(0, 5), requested = traceFor(row, row.input, index);
    assert.deepEqual(actual, traceFor(row, observed, index), 'Rust/JS and GDScript compare the same actually represented scalar.');
    if (JSON.stringify(observed) === JSON.stringify(row.input)) assert.deepEqual(actual, requested);
    else {
      transportDifferences.push(`${row.version}:${row.name}`);
      if (JSON.stringify(actual) !== JSON.stringify(requested)) selectionDifferences.push(`${row.version}:${row.name}`);
    }
  });
  assert.deepEqual(transportDifferences, ['2:typed-11-0', '2:typed-11-2', '5:nul-0', '5:nul-1']);
  assert.deepEqual(selectionDifferences, ['2:typed-11-0', '2:typed-11-2', '5:nul-0'], 'The three originally failed manual-vs-Godot NUL cases stay visible and asserted.');
  for (const [name, hash] of sources) assert.equal(digest(await fs.readFile(path.join(directory, name))), hash, `author bytes changed: ${name}`);
  t.diagnostic(`Verified ${cases.length} actual-input samples across original generators v1-v5; ${sources.size} generated source hashes unchanged. Four samples replace NUL during Godot construction; three retain an explicitly asserted difference from the original manual sample.`);
});

// Separate construction evidence explains why a nominal NUL input cannot be
// treated as the same scalar on both sides of the generated-script test.
test('real Godot embedded NUL constructors expose replacement or truncation bytes explicitly', {
  skip: !tool ? 'Set VIENTO_GODOT_BIN for the embedded NUL construction probe' : false, timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-event-preview-nul-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Embedded NUL construction evidence"\n');
  await fs.writeFile(path.join(directory, 'probe.gd'), String.raw`extends SceneTree
func report(name: String, value: String) -> void:
	var points: Array = []
	for index in range(value.length()):
		points.append(value.unicode_at(index))
	print("NUL_PROBE:" + JSON.stringify({"name":name,"length":value.length(),"points":points,"utf8":Array(value.to_utf8_buffer()),"base64":Marshalls.raw_to_base64(value.to_utf8_buffer()) if not value.is_empty() else ""}))
func _initialize() -> void:
	report("chr-zero", String.chr(0))
	report("chr-concatenation", String.chr(65) + String.chr(0) + String.chr(66))
	report("utf8-byte-decoding", PackedByteArray([65,0,66]).get_string_from_utf8())
	report("ascii-byte-decoding", PackedByteArray([65,0,66]).get_string_from_ascii())
	report("json-escaped-decoding", JSON.parse_string('"A\\u0000B"'))
	report("gd-escaped-literal", "A\u0000B")
	report("from-utf32-bytes", PackedByteArray([65,0,0,0,0,0,0,0,66,0,0,0]).get_string_from_utf32())
	quit()
`);
  const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' };
  for (const [key, name] of [['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data']]) { env[key] = path.join(directory, name); await fs.mkdir(env[key]); }
  const result = await promisify(execFile)(tool, ['--headless', '--path', directory, '--script', 'res://probe.gd'], { env, timeout: 20000, maxBuffer: 1024 * 1024 });
  assert.equal(/SCRIPT ERROR|Parse Error|ERROR:/.test(result.stderr), false, result.stderr);
  const rows = result.stdout.split('\n').filter(line => line.startsWith('NUL_PROBE:')).map(line => JSON.parse(line.slice(10)));
  const replacement = [65, 239, 191, 189, 66];
  assert.deepEqual(rows.map(row => [row.name, row.utf8]), [
    ['chr-zero', [239, 191, 189]], ['chr-concatenation', replacement], ['utf8-byte-decoding', [65]], ['ascii-byte-decoding', [65]],
    ['json-escaped-decoding', replacement], ['gd-escaped-literal', replacement], ['from-utf32-bytes', replacement],
  ]);
  assert.ok(rows.every(row => !row.utf8.includes(0)), 'No tested constructor preserves the requested embedded NUL.');
});
