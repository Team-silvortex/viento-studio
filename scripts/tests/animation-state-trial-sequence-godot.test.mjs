import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createAnimationStateTrialSequence as create, previewAnimationStateTrialStep as preview, appendAnimationStateTrialStep as append } from '../../engine/animation-state-trial-sequence.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for actual generated GDScript trial-sequence checks' : false, timeout: 60000 };
const leaf = (value = true, key, operator = 'eq') => ({ type: typeof value, operator, value, ...(key === undefined ? {} : { selector: { kind: 'projectState', key } }) });
const group = (combine, conditions) => ({ combine, conditions });
const edge = (condition, to = 'attack', name = 'go') => ({ from: 'idle', to, trigger: { kind: 'event', name, ...(condition === undefined ? {} : { condition }) } });
const completed = from => ({ from, to: 'idle', trigger: { kind: 'completed' } });
const table = (version) => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'other' }],
  ...(version >= 3 ? { eventSelection: 'firstMatch' } : {}), transitions: [
    edge(version === 1 ? undefined : version === 2 || version === 3 ? leaf(3, undefined, 'gte') : version === 4 ? leaf(true, 'ready') : group('all', [leaf(3, undefined, 'gte'), leaf(true, 'ready')])),
    ...(version >= 3 ? [edge(version === 5 ? group('any', [leaf(true), leaf('go', 'mode')]) : leaf(true), 'other'), edge(undefined, 'idle')] : []),
    completed('attack'), completed('other'), edge(undefined, 'idle', 'restart'),
  ] });
const event = (value = true, values = {}, name = 'go') => ({ kind: 'event', event: { name, value }, projectState: Object.entries(values).map(([key, value]) => ({ key, value })) });
const inputs = [event(0), event(3, { ready: true }), { kind: 'completed' }, event(true, { ready: false }), { kind: 'completed' },
  event('fallback', { ready: false, mode: 'go' }), { kind: 'completed' }, event(true, {}, 'restart'), event(true, {}, 'unknown'), { kind: 'completed' }];
const uuid = number => `12345678-1234-4234-8234-${String(number).padStart(12, '0')}`;
const digest = content => createHash('sha256').update(content).digest('hex');
function literal(value) {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); return `PackedByteArray(${JSON.stringify([...bytes])}).decode_double(0)`; }
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  throw Error('Unexpected fixture scalar.');
}
const port = `class TracePort extends RefCounted:
\tvar values: Dictionary = {}
\tvar reads: Array = []
\tvar commands: Array = []
\tvar accept_select: bool = true
\tvar accept_play: bool = true
\tfunc read_state(key) -> Variant:
\t\treads.append(key)
\t\treturn values.get(key)
\tfunc select_animation_clip(clip_id) -> bool:
\t\tcommands.append(["select", clip_id])
\t\treturn accept_select
\tfunc play_animation() -> bool:
\t\tcommands.append(["play"])
\t\treturn accept_play
`;
async function run(t, source) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-trial-sequence-godot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Manual sequence GDScript comparison"\n');
  const hashes = new Map();
  for (let version = 1; version <= 5; version++) {
    const content = generateEditableGodotAnimationStateScript(table(version)).content;
    assert.ok(content.includes(`"generator":"godot-gdscript-v${version}"`));
    const filename = `controller_${version}.gd`; hashes.set(filename, digest(content)); await fs.writeFile(path.join(directory, filename), content);
  }
  await fs.writeFile(path.join(directory, 'run.gd'), `extends SceneTree\n${port}${source}`);
  const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' };
  for (const [key, name] of [['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data']]) { env[key] = path.join(directory, name); await fs.mkdir(env[key]); }
  const result = await promisify(execFile)(tool, ['--headless', '--path', directory, '--script', 'res://run.gd'], { env, timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(/SCRIPT ERROR|Parse Error|ERROR:/.test(result.stderr), false, result.stderr);
  for (const [filename, hash] of hashes) assert.equal(digest(await fs.readFile(path.join(directory, filename))), hash, 'Original generated author bytes remain unchanged.');
  return result.stdout;
}
const printed = (stdout, prefix) => stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const initialize = (name, version, clips) => `\tvar port_${name} = TracePort.new()
\tvar node_${name} = load("res://controller_${version}.gd").new()
\tnode_${name}._project = port_${name}
\tnode_${name}._active = true
\tnode_${name}._state = 0
\tnode_${name}._clips = [${clips.map(literal).join(',')}]
\tnode_${name}._selected_clip = ${literal(clips[0])}
`;

test('original v1-v5 GDScript matches explicitly adopted event and assumed completion steps with null and UUID clips', real, async t => {
  const cases = Array.from({ length: 5 }, (_, index) => index + 1).flatMap(version => [false, true].map(named => ({ version, named, clips: [0, 1, 2].map(index => named ? uuid(index + 1) : null) })));
  let source = 'func _initialize() -> void:\n';
  for (const [caseIndex, row] of cases.entries()) {
    const name = String(caseIndex); source += initialize(name, row.version, row.clips);
    for (const [index, input] of inputs.entries()) {
      source += `\tport_${name}.values = {${(input.projectState || []).map(({ key, value }) => `${JSON.stringify(key)}:${literal(value)}`).join(',')}}
\tport_${name}.reads.clear()
\tport_${name}.commands.clear()
\tvar before_${name}_${index} = node_${name}._state
`;
      if (input.kind === 'completed') source += `\tvar mismatch_${name}_${index} = node_${name}._on_completed(${JSON.stringify(uuid(99))})
\tprint("MISMATCH:"+JSON.stringify([${caseIndex},${index},mismatch_${name}_${index},before_${name}_${index},node_${name}._state,port_${name}.commands.size()]))
`;
      const invoke = input.kind === 'event' ? `node_${name}._on_event(${literal(input.event.value)},${JSON.stringify(input.event.name)})` : `node_${name}._on_completed(node_${name}._selected_clip)`;
      source += `\tvar handled_${name}_${index} = ${invoke}
\tprint("STEP:"+JSON.stringify([${caseIndex},${index},before_${name}_${index},node_${name}._state,handled_${name}_${index},port_${name}.reads,port_${name}.commands,node_${name}._active]))
`;
    }
    source += `\tnode_${name}.free()\n`;
  }
  source += '\tquit()\n';
  const stdout = await run(t, source), actual = printed(stdout, 'STEP:'), mismatches = printed(stdout, 'MISMATCH:');
  assert.equal(actual.length, cases.length * inputs.length); assert.equal(mismatches.length, cases.length * inputs.filter(input => input.kind === 'completed').length);
  for (const [caseIndex, row] of cases.entries()) await t.test(`v${row.version} ${row.named ? 'UUID clips' : 'whole-animation null clips'}`, () => {
    let sequence = create(table(row.version));
    for (const [index, input] of inputs.entries()) {
      const before = sequence, pending = preview(sequence, input), selected = pending.result.selected;
      const fromIndex = sequence.model.states.find(state => state.key === before.stateKey).index;
      sequence = append(sequence, pending);
      const toIndex = sequence.model.states.find(state => state.key === sequence.stateKey).index;
      const reads = pending.result.candidates.flatMap(candidate => candidate.leaves.filter(leaf => leaf.status === 'evaluated' && leaf.condition.selector).map(leaf => leaf.condition.selector.key));
      const commands = selected ? [['select', row.clips[toIndex]], ['play']] : [];
      assert.deepEqual(actual[caseIndex * inputs.length + index], [caseIndex, index, fromIndex, toIndex, true, reads, commands, true]);
      if (input.kind === 'completed') {
        assert.equal(pending.result.assumption, 'current-playback-completed');
        assert.deepEqual(mismatches.find(item => item[0] === caseIndex && item[1] === index), [caseIndex, index, true, fromIndex, fromIndex, 0], 'A foreign completion is outside the trial assumption and must be ignored.');
      }
      assert.equal(before.steps.length, index); assert.equal(sequence.steps.length, index + 1);
    }
  });
  t.diagnostic('100 explicitly adopted steps and 40 mismatched completions checked against unchanged original v1-v5 scripts; the trace port only accepts requests and is not a playback engine.');
});

test('manual target adoption explicitly differs from real rejected entry or inactive-controller behavior', real, async t => {
  let source = 'func _initialize() -> void:\n';
  for (const [index, mode] of ['select', 'play', 'inactive'].entries()) {
    source += initialize(String(index), 5, [null, null, null]);
    source += `\tport_${index}.values = {"ready":true}\n`;
    source += mode === 'inactive' ? `\tnode_${index}._active = false\n` : `\tport_${index}.accept_${mode} = false\n`;
    source += `\tvar handled_${index} = node_${index}._on_event(${literal(3)},"go")
\tprint("REJECTED:"+JSON.stringify([${JSON.stringify(mode)},handled_${index},node_${index}._state,node_${index}._active,port_${index}.commands]))
\tnode_${index}.free()
`;
  }
  source += '\tquit()\n';
  const stdout = await run(t, source), rows = printed(stdout, 'REJECTED:');
  assert.deepEqual(rows, [['select', false, -1, false, [['select', null]]], ['play', false, -1, false, [['select', null], ['play']]], ['inactive', false, -1, false, []]]);
  const sequence = create(table(5)), pending = preview(sequence, event(3, { ready: true }));
  assert.equal(pending.result.selected.stateKey, 'attack'); assert.equal(sequence.stateKey, 'idle'); assert.equal(append(sequence, pending).stateKey, 'attack');
  assert.ok(rows.every(row => row[2] !== 1), 'A proposed/manual target must never be reported as real accepted or executed state.');
});
