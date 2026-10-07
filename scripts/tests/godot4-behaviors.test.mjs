import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotProject } from '../backends/godot4-dispatch.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url)));
const ids = { manifest: '88888888-8888-4888-8888-888888888888', source: '99999999-9999-4999-8999-999999999999',
  bindings: ['77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666'] };
const script = `extends Node
signal arrived(checkpoint: String, distance: float)
@export var checkpoint: String = "dock"
@export var speed: float = 160.0
@export var enabled: bool = true
@export var count: int = 1
func _ready() -> void:
\tif enabled:
\t\tarrived.emit(checkpoint, speed * count * 0.25)
`;
function plan(content = script) {
  const value = structuredClone(golden.plan);
  value.schemaVersion = 3; value.resources = [];
  value.actors.forEach(actor => { delete actor.imageResourceId; });
  value.requiredCapabilities = ['scene2d', 'input.arrows', 'state.movement', 'behavior.bindings', 'behavior.gdscript'];
  const manifest = { objectId: ids.manifest, sourcePath: 'documents/behaviors.json', sourceRevision: `sha256:${hash('{}')}` };
  value.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', manifest,
    sources: [{ objectId: ids.source, sourcePath: 'documents/guard.txt', sourceRevision: `sha256:${hash(content)}`, language: 'gdscript', content }],
    bindings: value.actors.map((actor, index) => ({ bindingId: ids.bindings[index], instanceId: actor.instanceId, objectId: actor.objectId,
      implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: ids.source },
      parameters: { checkpoint: index ? 'west' : 'east', speed: index ? 80 : 160, enabled: true, count: 1 },
      events: [{ signal: 'arrived', event: 'arrived' }], declaration: { ...manifest, propertyPath: `/bindings/${index}` } })) };
  return value;
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-godot-behaviors-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function materialize(t, value) {
  const directory = await temporary(t), generated = await adapter.generate(value);
  for (const [file, bytes] of generated.files) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), bytes); }
  return { directory, generated };
}
const godot = process.env.VIENTO_GODOT_BIN;
const real = { skip: !godot ? 'Set VIENTO_GODOT_BIN for real Godot behavior execution' : false };
const frame = value => `VIENTO_RUNTIME:${JSON.stringify(value)}\n`;
const states = value => value.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, position: actor.position, state: 'idle' }));
const ready = value => ({ protocol: 3, event: 'ready', sceneObjectId: value.scene.objectId, actors: states(value) });
const event = value => { const binding = value.behaviors.bindings[0]; return { protocol: 3, event: 'behavior', bindingId: binding.bindingId,
  instanceId: binding.instanceId, objectId: binding.objectId, name: 'arrived', arguments: ['east', 40] }; };

test('plan 3 adds separate exact source files while the old generator files and source map remain intact', async () => {
  const value = plan(), before = structuredClone(value), generated = await adapter.generate(value);
  const { behaviors, ...base } = value; base.schemaVersion = 2;
  const legacy = await generateGodotProject(base);
  for (const file of ['project.godot', 'runtime.gd', 'scene.json']) assert.deepEqual(generated.files.get(file), legacy.files.get(file));
  assert.deepEqual(generated.files.get(`behaviors/${ids.source}.gd`), Buffer.from(script));
  assert.equal(generated.backend.version, '0.3.0'); assert.equal(generated.backend.protocolVersion, 3);
  assert.notEqual(generated.backend.sha256, legacy.backend.sha256); assert.equal(generated.sourceMap.schemaVersion, 3);
  assert.deepEqual(generated.sourceMap.objects, legacy.sourceMap.objects);
  assert.deepEqual(generated.sourceMap.behaviors.map(item => item.bindingId), ids.bindings);
  assert.deepEqual(generated.sourceMap.behaviors[1].declaration, value.behaviors.bindings[1].declaration);
  assert.deepEqual(value, before);
});

test('adapter refuses mismatched behavior languages, identities, sources, types and budgets before generation', async () => {
  const cases = [v => v.behaviors.backendId = 'org.other.engine', v => v.behaviors.language = 'rust',
    v => v.behaviors.bindings[0].implementation.language = 'rust', v => v.behaviors.bindings[1].bindingId = ids.bindings[0],
    v => v.behaviors.bindings[0].instanceId = ids.source, v => v.behaviors.bindings[0].parameters.speed = null,
    v => v.behaviors.sources[0].sourceRevision = `sha256:${'0'.repeat(64)}`,
    v => v.behaviors.sources[0].sourcePath = '../../outside.gd', v => v.behaviors.bindings[0].declaration.sourcePath = '/etc/passwd',
    v => v.behaviors.bindings[0].events.push({ signal: 'arrived', event: 'again' })];
  for (const mutate of cases) { const value = plan(); mutate(value); await assert.rejects(adapter.generate(value), error => ['build_behavior_invalid', 'build_behavior_backend_unsupported', 'build_behavior_language_unsupported'].includes(error.errorCode)); }
  await assert.rejects(adapter.generate(plan('x'.repeat(65537))));
});

test('protocol 3 streams paired instance bindings and keeps author locations entirely in the trusted DTO', () => {
  const value = plan(), reader = adapter.createEventReader(value), observed = event(value);
  const text = frame(ready(value)); reader.push(text.slice(0, 15)); reader.push(text.slice(15)); reader.push(frame(observed));
  const binding = value.behaviors.bindings[1];
  reader.push(frame({ protocol: 3, event: 'diagnostic', severity: 'error', code: 'runtime_behavior_parameter', message: 'Wrong type',
    bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId, parameter: 'speed' }));
  reader.finish();
  assert.deepEqual(reader.events[1], observed);
  assert.equal(reader.diagnostics[0].propertyPath, '/bindings/1/parameters/speed');
  assert.equal(reader.diagnostics[0].sourcePath, value.behaviors.manifest.sourcePath);
  assert.equal(reader.diagnostics[0].instanceId, binding.instanceId);
});

test('protocol 3 rejects forged identities, names, paths, arguments and lifecycle violations', () => {
  const value = plan(), baseline = event(value);
  for (const malicious of [{ ...baseline, bindingId: ids.source }, { ...baseline, instanceId: ids.source }, { ...baseline, objectId: ids.source },
    { ...baseline, name: 'undeclared' }, { ...baseline, arguments: [null] }, { ...baseline, arguments: [1, 2, 3, 4, 5] },
    { ...baseline, arguments: [{ sourcePath: '/etc/passwd' }] }, { ...baseline, sourcePath: '/etc/passwd' }, { ...baseline, protocol: 2 }]) {
    const reader = adapter.createEventReader(value); reader.push(frame(ready(value))); reader.push(frame(malicious)); reader.finish();
    assert.equal(reader.events.length, 1); assert.ok(reader.diagnostics.some(item => item.code === 'runtime_protocol_invalid'));
  }
  const binding = value.behaviors.bindings[0];
  const diagnostic = { protocol: 3, event: 'diagnostic', bindingId: binding.bindingId, instanceId: binding.instanceId,
    objectId: binding.objectId, severity: 'error', code: 'runtime_behavior_parameter', message: 'Wrong type', parameter: 'speed' };
  for (const malicious of [{ ...diagnostic, code: ['runtime_behavior_parameter'] }, { ...diagnostic, parameter: ['speed'] },
    { ...diagnostic, parameter: null }, { ...diagnostic, code: { value: 'runtime_behavior_parameter' } }]) {
    const reader = adapter.createEventReader(value); reader.push(frame(ready(value))); reader.push(frame(malicious)); reader.finish();
    assert.equal(reader.events.length, 1); assert.deepEqual(reader.diagnostics.map(item => item.code), ['runtime_protocol_invalid']);
  }
  const reader = adapter.createEventReader(value); reader.push(frame(baseline)); assert.equal(reader.events.length, 0);
  reader.push(frame(ready(value))); reader.push(frame({ protocol: 3, event: 'finished', actors: states(value), fixedDelta: 0.25 }));
  reader.push(frame(baseline)); assert.equal(reader.events.length, 2);
  reader.push('VIENTO_RUNTIME:' + 'x'.repeat(65536) + '\n'); reader.finish();
  assert.ok(reader.diagnostics.length >= 3);
});

test('generated script inventory rejects traversal and symlink sources before process invocation', async t => {
  const value = plan(), f = await materialize(t, value);
  const manifest = JSON.parse(await fs.readFile(path.join(f.directory, 'behaviors.json')));
  manifest.sources[0].path = '../outside.gd';
  await fs.writeFile(path.join(f.directory, 'behaviors.json'), JSON.stringify(manifest));
  await assert.rejects(adapter.executePhase({ phase: 'script-check', directory: f.directory, tool: { executable: process.execPath } }), { errorCode: 'build_behavior_invalid' });
  manifest.sources[0].path = `behaviors/${ids.source}.gd`;
  await fs.writeFile(path.join(f.directory, 'behaviors.json'), JSON.stringify(manifest));
  await fs.rm(path.join(f.directory, manifest.sources[0].path));
  await fs.symlink(path.join(f.directory, 'runtime.gd'), path.join(f.directory, manifest.sources[0].path));
  await assert.rejects(adapter.executePhase({ phase: 'script-check', directory: f.directory, tool: { executable: process.execPath } }));
});

test('script checking owns a fixed source inventory, preserves literal arguments and forwards cancellation', async t => {
  const value = plan(), f = await materialize(t, value), calls = path.join(f.directory, 'calls.jsonl'), executable = path.join(f.directory, 'tool ; literal');
  await fs.writeFile(executable, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');\n`, { mode: 0o700 });
  const result = await adapter.executePhase({ phase: 'script-check', directory: f.directory, tool: { executable } });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual((await fs.readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse), ['runtime.gd', 'behavior-runtime.gd', `behaviors/${ids.source}.gd`]
    .map(file => ['--path', f.directory, '--headless', '--script', `res://${file}`, '--check-only']));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.executePhase({ phase: 'script-check', directory: f.directory, tool: { executable }, signal: controller.signal }));
  assert.equal((await fs.readFile(calls, 'utf8')).trim().split('\n').length, 3);
});

test('real Godot creates independent behavior nodes, binds scalar parameters and routes ready signals before unchanged movement smoke', real, async t => {
  const value = plan(), f = await materialize(t, value), tool = await adapter.identify(godot);
  const initial = new Map([...f.generated.files].map(([file, bytes]) => [file, hash(bytes)]));
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: f.directory, tool });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  }
  const reader = adapter.createEventReader(value);
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } });
  reader.finish(); assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual([...adapter.diagnostics(result, value), ...reader.diagnostics], [], result.stdout + result.stderr);
  assert.deepEqual(reader.events.filter(item => item.event === 'behavior').map(item => [item.bindingId, item.arguments]), [[ids.bindings[0], ['east', 40]], [ids.bindings[1], ['west', 20]]]);
  assert.equal(reader.events[0].event, 'ready'); assert.equal(reader.events.at(-1).event, 'finished');
  const finished = reader.events.at(-1);
  for (const [index, actor] of value.actors.entries()) assert.equal(finished.actors[index].position[0], actor.position[0] + (actor.controls === 'arrows' ? actor.speed * 0.25 : 0));
  await adapter.cleanupProject(f.directory);
  for (const [file, expected] of initial) assert.equal(hash(await fs.readFile(path.join(f.directory, file))), expected, 'execution cannot edit generated source');
});

test('real Godot rejects parameter and signal mismatches with binding-owned diagnostics', real, async t => {
  const tool = await adapter.identify(godot);
  for (const [mutate, code, pointer] of [[v => v.behaviors.bindings[0].parameters.count = 1.5, 'runtime_behavior_parameter', '/bindings/0/parameters/count'],
    [v => v.behaviors.bindings[0].parameters.script = 'untrusted', 'runtime_behavior_parameter', '/bindings/0/parameters/script'],
    [v => v.behaviors.bindings[0].events[0].signal = 'missing', 'runtime_behavior_signal', '/bindings/0']]) {
    const value = plan(); mutate(value); const f = await materialize(t, value), reader = adapter.createEventReader(value);
    const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } });
    reader.finish(); assert.notEqual(result.status, 'succeeded');
    assert.ok(reader.diagnostics.some(item => item.code === code && item.propertyPath === pointer), result.stdout + result.stderr);
    assert.ok(!reader.events.some(item => item.event === 'finished'));
  }
});

test('real Godot script checking includes authored source and resolves syntax errors to registered source paths', real, async t => {
  const value = plan('extends Node\nfunc broken( -> void:\n\tpass\n'), f = await materialize(t, value), tool = await adapter.identify(godot);
  const result = await adapter.executePhase({ phase: 'script-check', directory: f.directory, tool });
  const diagnostics = adapter.diagnostics(result, value);
  assert.ok(diagnostics.some(item => item.objectId === ids.source && item.sourcePath === 'documents/guard.txt' && item.sourceLine === 2), result.stdout + result.stderr);
  const location = diagnostics.find(item => item.objectId === ids.source);
  assert.equal(value.behaviors.sources[0].content.slice(location.sourceRange.start, location.sourceRange.end), 'func broken( -> void:');
});

test('real Godot supports zero through four scalar signal arguments and multiple bindings on one actor', real, async t => {
  const content = `extends Node
signal empty()
signal one(a: bool)
signal two(a: int, b: float)
signal three(a: String, b: bool, c: int)
signal four(a: String, b: bool, c: int, d: float)
@export var enabled: bool = true
func _ready() -> void:
\tempty.emit()
\tone.emit(enabled)
\ttwo.emit(4, 1.5)
\tthree.emit("three", false, 2)
\tfour.emit("four", true, 3, 2.5)
func _exit_tree() -> void:
\tempty.emit()
`;
  const value = plan(content);
  for (const [index, binding] of value.behaviors.bindings.entries()) {
    binding.instanceId = value.actors[0].instanceId; binding.objectId = value.actors[0].objectId;
    binding.parameters = { enabled: index === 0 };
    binding.events = ['empty', 'one', 'two', 'three', 'four'].map(signal => ({ signal, event: signal }));
  }
  const f = await materialize(t, value), tool = await adapter.identify(godot), reader = adapter.createEventReader(value);
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } }); reader.finish();
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(reader.diagnostics, []);
  const events = reader.events.filter(item => item.event === 'behavior'); assert.equal(events.length, 10);
  assert.deepEqual(events.slice(0, 5).map(item => item.arguments), [[], [true], [4, 1.5], ['three', false, 2], ['four', true, 3, 2.5]]);
  assert.deepEqual(events[6].arguments, [false]); assert.equal(reader.events.at(-1).event, 'finished');
});

test('real Godot rejects unsupported script bases and non-scalar or oversized signal signatures', real, async t => {
  const tool = await adapter.identify(godot);
  for (const [content, code] of [
    ['extends RefCounted\nsignal arrived()\n', 'runtime_behavior_script'],
    ['extends Node\nsignal arrived()\nfunc _init(required: int) -> void:\n\tpass\n', 'runtime_behavior_script'],
    ['extends Node\nsignal arrived(value: Vector2)\n', 'runtime_behavior_signal'],
    ['extends Node\nsignal arrived(a: int, b: int, c: int, d: int, e: int)\n', 'runtime_behavior_signal'],
    ['extends Node\nsignal arrived(value)\n', 'runtime_behavior_signal'],
  ]) {
    const value = plan(content); value.behaviors.bindings.forEach(binding => binding.parameters = {});
    const f = await materialize(t, value), reader = adapter.createEventReader(value);
    const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } }); reader.finish();
    assert.notEqual(result.status, 'succeeded', result.stdout + result.stderr); assert.ok(reader.diagnostics.some(item => item.code === code), result.stdout + result.stderr);
  }
});

test('real Godot bounds emitted scalar values and supplies a binding diagnostic before ending the smoke', real, async t => {
  const tool = await adapter.identify(godot);
  for (const [type, expression] of [['float', 'INF'], ['int', '9223372036854775807'], ['String', '"😀".repeat(2049)']]) {
    const value = plan(`extends Node\nsignal arrived(value: ${type})\nfunc _ready() -> void:\n\tarrived.emit(${expression})\n`);
    value.behaviors.bindings.forEach(binding => binding.parameters = {});
    const f = await materialize(t, value), reader = adapter.createEventReader(value);
    const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool, onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } }); reader.finish();
    assert.notEqual(result.status, 'succeeded', result.stdout + result.stderr);
    assert.ok(reader.diagnostics.some(item => item.code === 'runtime_behavior_event'), result.stdout + result.stderr);
    assert.ok(!reader.events.some(item => item.event === 'finished'));
  }
});
