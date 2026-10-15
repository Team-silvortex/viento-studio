import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSharedStateAuthor } from './helpers/project-shared-state-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for real shared project state' : false };
async function build(t, edit) {
  const f = await projectSharedStateAuthor(t); if (edit) await edit(f);
  const output = path.join(f.temporary, 'state-build');
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics || result.record?.diagnostics));
  return { ...f, output };
}
async function run(f) {
  return runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: true });
}

test('real project state crosses A→B→A with binding provenance and starts empty on each new run', real, async t => {
  const f = await build(t);
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
    const { events, runtime } = result.record;
    assert.deepEqual(events.filter(frame => frame.event === 'scene-enter').map(frame => frame.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
    assert.equal(events[0].protocol, 4); assert.equal(events[0].stateRevision, 0);
    assert.equal(events.at(-1).stateRevision, f.expectedRevision);
    assert.deepEqual(events.filter(frame => frame.event === 'state').map(frame => frame.revision), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(runtime.project.sharedState.entries.map(({ key, value }) => ({ key, value })), f.expectedEntries);
    assert.equal(runtime.project.sharedState.revision, f.expectedRevision);
    assert.equal(runtime.project.sharedState.lastChange.operation, 'delete');
    assert.equal(runtime.project.sharedState.lastChange.origin.bindingId, f.firstBindingId);
    assert.equal(runtime.project.sharedState.lastChange.origin.source.propertyPath, '/bindings/0');
  }
});

const firstScript = (f, source) => fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), source);
const printed = (record, prefix) => record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));

test('real state keeps booleans distinct, normalizes numeric no-ops and preserves Unicode and double precision', real, async t => {
  // Supply known IEEE bits: Godot and JS parse long decimal source literals differently.
  const fraction = 0.12345678901234567, fractionBytes = Buffer.alloc(8); fractionBytes.writeDoubleLE(fraction);
  const f = await build(t, value => firstScript(value, `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tvar checks = [p.read_state("missing") == null, p.write_state("score", 1), p.write_state("score", 1.0),
\t\tp.write_state("score", true), p.write_state("score", true), p.write_state("zero", -0.0), p.write_state("zero", 0),
\t\tp.write_state("fraction", PackedByteArray(${JSON.stringify([...fractionBytes])}).decode_double(0)), p.write_state("text", "🔑".repeat(1024)),
\t\tnot p.erase_state("missing"), p.erase_state("score"), not p.erase_state("score"), p.read_state("score") == null]
\tprint("STATE_CHECKS:" + JSON.stringify(checks))
`));
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(printed(result.record, 'STATE_CHECKS:'), [Array(13).fill(true)]);
  const state = result.record.runtime.project.sharedState;
  assert.equal(state.revision, 6);
  assert.deepEqual(state.entries.map(({ key, value }) => ({ key, value })), [
    { key: 'fraction', value: fraction }, { key: 'text', value: '🔑'.repeat(1024) }, { key: 'zero', value: 0 },
  ]);
  assert.equal(Object.is(state.entries.at(-1).value, -0), false);
  const mutations = result.record.events.filter(event => event.event === 'state');
  assert.equal(mutations[0].value, 1); assert.equal(mutations[1].value, true);
});

test('real stale visit ports cannot read, overwrite or erase the next visit session state', real, async t => {
  const f = await build(t, async value => {
    await firstScript(value, `extends Node
static var old_port
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tif p.read_state("started") == null:
\t\told_port = p
\t\tp.write_state("started", true)
\t\tp.write_state("score", 7)
\t\tp.request_scene("${value.sceneIds[1]}")
\telse:
\t\tprint("RETURN_SCORE:" + JSON.stringify(p.read_state("score")))
`);
    await fs.writeFile(path.join(value.author, 'documents/scripts/second.txt'), `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tvar old = load("res://behaviors/${value.scriptId}.gd").old_port
\tprint("STALE_STATE:" + JSON.stringify([old.read_state("score") == null, not old.write_state("score", 99), not old.erase_state("score"), p.read_state("score") == 7]))
\tp.write_state("score", 9)
\tp.request_scene("${value.sceneIds[0]}")
`);
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(printed(result.record, 'STALE_STATE:'), [[true, true, true, true]]);
  assert.deepEqual(printed(result.record, 'RETURN_SCORE:'), [9]);
  assert.equal(result.record.runtime.project.sharedState.revision, 3);
  assert.equal(result.record.events.filter(event => event.event === 'state').length, 3);
});

const invalidCases = [
  { name: 'non-string key', code: 'runtime_behavior_state_key', setup: '\tp.write_state("kept", "original")\n', request: 'p.write_state(true, 1)', revision: 1, values: [['kept', 'original']] },
  { name: 'non-finite value', code: 'runtime_behavior_state_value', setup: '\tp.write_state("kept", "original")\n', request: 'p.write_state("kept", NAN)', revision: 1, values: [['kept', 'original']] },
  { name: 'string UTF-8 overflow', code: 'runtime_behavior_state_value', setup: '\tp.write_state("kept", "original")\n', request: 'p.write_state("kept", "🔑".repeat(1024) + "a")', revision: 1, values: [['kept', 'original']] },
  { name: '65th key', code: 'runtime_behavior_state_limit', setup: '\tfor i in range(64):\n\t\tp.write_state("k" + str(i), 1)\n', request: 'p.write_state("extra", 1)', revision: 64, size: 64 },
  { name: 'aggregate byte overflow', code: 'runtime_behavior_state_limit', setup: '\tfor key in ["a", "b", "c"]:\n\t\tp.write_state(key, "x".repeat(4096))\n\tp.write_state("d", "x".repeat(4092))\n', request: 'p.write_state("e", true)', revision: 4, size: 4, bytes: 16384 },
  { name: '1025th mutation', code: 'runtime_behavior_state_limit', setup: '\tfor i in range(1024):\n\t\tp.write_state("counter", i % 2 == 0)\n', request: 'p.write_state("counter", true)', revision: 1024, values: [['counter', false]] },
];
for (const scenario of invalidCases) {
  test(`real ${scenario.name} fails at its binding without committing the rejected state`, real, async t => {
    const f = await build(t, value => firstScript(value, 'extends Node\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n' + scenario.setup + `\tprint("REJECTED_STATE:" + JSON.stringify(${scenario.request}))\n`));
    const result = await run(f); assert.equal(result.ok, false); assert.equal(result.status, 'failed');
    const diagnostics = result.record.diagnostics;
    assert.ok(diagnostics.some(item => item.code === scenario.code && item.bindingId === f.firstBindingId
      && item.sourcePath === 'documents/behaviors/demo.json' && item.propertyPath === '/bindings/0'), JSON.stringify(diagnostics));
    assert.equal(diagnostics.some(item => item.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(diagnostics));
    assert.deepEqual(printed(result.record, 'REJECTED_STATE:'), [false]);
    const state = result.record.runtime.project.sharedState;
    assert.equal(state.revision, scenario.revision); assert.equal(result.record.events.some(frame => frame.event === 'finished'), false);
    if (scenario.values) assert.deepEqual(state.entries.map(({ key, value }) => [key, value]), scenario.values);
    if (scenario.size) assert.equal(state.entries.length, scenario.size);
    if (scenario.bytes) assert.equal(state.entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.key) + Buffer.byteLength(entry.value), 0), scenario.bytes);
  });
}
