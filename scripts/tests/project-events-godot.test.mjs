import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for real project events' : false };
async function build(t, edit) {
  const f = await projectEventsAuthor(t); if (edit) await edit(f);
  const output = path.join(f.temporary, 'events-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  return { ...f, output };
}
async function run(f, options = {}) {
  return runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: true, ...options });
}

test('real project events deliver FIFO across separate behaviors and drain before A→B→A', real, async t => {
  const f = await build(t), result = await run(f);
  assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  const { runtime, events } = result.record, messages = runtime.project.events;
  assert.equal(events[0].protocol, 4); assert.equal(events[0].eventSequence, 0);
  assert.equal(events.at(-1).eventSequence, f.expectedSequence);
  assert.equal(messages.sequence, f.expectedSequence);
  assert.deepEqual(messages.entries.map(entry => entry.name), f.expectedNames);
  assert.deepEqual(messages.entries.map(entry => entry.deliveries.map(delivery => delivery.status)), f.expectedDeliveries);
  assert.deepEqual(runtime.project.sharedState.entries.map(({ key, value }) => ({ key, value })), f.expectedEntries);
  assert.equal(runtime.project.sharedState.revision, f.expectedRevision);
  assert.deepEqual(events.filter(event => event.event === 'scene-enter').map(event => event.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
  assert.equal(messages.entries[0].origin.bindingId, f.publisherBindingId);
  assert.equal(messages.entries[0].deliveries[0].origin.bindingId, f.receiverBindingId);
  assert.equal(messages.entries.flatMap(entry => entry.deliveries).length, 7);
});

const writeScript = (f, name, source) => fs.writeFile(path.join(f.author, `documents/scripts/${name}.txt`), source);
async function isolated(f, source) {
  await writeScript(f, 'publisher', 'extends Node\n');
  await writeScript(f, 'second', 'extends Node\n');
  await writeScript(f, 'checkpoint', source);
}
const printed = (record, prefix) => record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const publishes = result => result.record.events.filter(event => event.event === 'event-publish');
const deliveries = result => result.record.events.filter(event => event.event === 'event-delivery');
function rejected(result, f, code, bindingId = f.receiverBindingId) {
  assert.equal(result.ok, false); assert.equal(result.status, 'failed');
  assert.ok(result.record, JSON.stringify(result));
  const diagnostics = result.record.diagnostics;
  assert.ok(diagnostics.some(item => item.code === code && item.bindingId === bindingId
    && item.sourcePath === 'documents/behaviors/demo.json'), JSON.stringify(diagnostics));
  assert.equal(diagnostics.some(item => item.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(diagnostics));
  assert.equal(result.record.events.some(event => event.event === 'finished'), false);
}

test('the unchanged built-in event starter compiles in a project and safely guards a single scene', real, async t => {
  const starter = listScriptStarters().find(item => item.id === 'godot-project-events'); assert.ok(starter);
  const f = await build(t, value => isolated(value, starter.content));
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.equal(publishes(result).length, 1); assert.equal(deliveries(result).length, 1);
  assert.equal(deliveries(result)[0].status, 'handled');
  assert.deepEqual(result.record.runtime.project.sharedState.entries.map(({ key, value }) => ({ key, value })), [{ key: 'last_event', value: 'hello' }]);
  const output = path.join(f.temporary, 'single-starter');
  const single = await buildProject({ root: f.author, scene: f.sceneIds[0], tool, output });
  assert.equal(single.ok, true, JSON.stringify(single.diagnostics || single.record?.diagnostics));
  const guarded = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(guarded.ok, true, JSON.stringify(guarded.record?.diagnostics));
  assert.equal(guarded.record.events.some(event => event.event.startsWith('event-')), false);
});

test('duplicate subscriptions reuse tokens, late registrations receive no replay and self-removal stays handled', real, async t => {
  const f = await build(t, async value => {
    await isolated(value, `extends Node
var p
var token := 0
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.publish_event("late", "before")
\tp.subscribe_event("late", _unexpected)
\ttoken = p.subscribe_event("once", _once)
\tvar same = p.subscribe_event("once", _once)
\tprint("EVENT_CHECKS:" + JSON.stringify([same == token, not p.unsubscribe_event(1024)]))
\tp.publish_event("once", true)
\tp.publish_event("once", false)
\tvar first = p.subscribe_event("bound", _bound.bind(1))
\tvar repeated = p.subscribe_event("bound", _bound.bind(1))
\tvar second = p.subscribe_event("bound", _bound.bind(2))
\tvar boolean = p.subscribe_event("bound", _bound.bind(true))
\tvar shared = [3]
\tvar container = p.subscribe_event("bound", _bound.bind(shared))
\tvar reused = p.subscribe_event("bound", _bound.bind(shared))
\tvar other = p.subscribe_event("bound", _bound.bind([3]))
\tprint("BOUND_TOKENS:" + JSON.stringify([first == repeated, second > first, boolean > second, container == reused, other > container]))
\tp.publish_event("bound", true)
func _bound(_value, tag) -> bool:
\tprint("BOUND_VALUE:" + JSON.stringify(tag))
\treturn true
func _once(value) -> bool:
\treturn value == true and p.unsubscribe_event(token)
func _unexpected(_value) -> bool:
\treturn false
`);
    await writeScript(value, 'publisher', `extends Node
func _ready() -> void:
\tprint("FOREIGN_UNSUBSCRIBE:" + JSON.stringify(get_meta("viento_project").unsubscribe_event(1)))
`);
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(printed(result.record, 'EVENT_CHECKS:'), [[true, true]]);
  assert.deepEqual(printed(result.record, 'FOREIGN_UNSUBSCRIBE:'), [false]);
  assert.deepEqual(printed(result.record, 'BOUND_TOKENS:'), [[true, true, true, true, true]]);
  assert.deepEqual(printed(result.record, 'BOUND_VALUE:'), [1, 2, true, [3], [3]]);
  assert.deepEqual(publishes(result).map(event => event.recipients.length), [0, 1, 1, 5]);
  assert.deepEqual(deliveries(result).map(event => event.status), ['handled', 'skipped', 'handled', 'handled', 'handled', 'handled', 'handled']);
});

test('stale visit event ports are revoked and subscription identities are never reused', real, async t => {
  const f = await build(t, async value => {
    await isolated(value, `extends Node
static var old_port
static var old_token := 0
func _ready() -> void:
\told_port = get_meta("viento_project")
\told_token = old_port.subscribe_event("notice", _on_event)
\told_port.request_scene("${value.sceneIds[1]}")
func _on_event(_value) -> bool:
\treturn true
`);
    await writeScript(value, 'second', `extends Node
func _ready() -> void:
\tvar script = load("res://behaviors/${value.scriptId}.gd")
\tvar old = script.old_port
\tvar p = get_meta("viento_project")
\tvar token = p.subscribe_event("notice", _on_event)
\tprint("STALE_EVENTS:" + JSON.stringify([old.subscribe_event("notice", _on_event) == 0, not old.unsubscribe_event(script.old_token), not old.publish_event("notice", true), token > script.old_token]))
\tp.publish_event("notice", true)
func _on_event(_value) -> bool:
\treturn true
`);
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(printed(result.record, 'STALE_EVENTS:'), [[true, true, true, true]]);
  assert.equal(publishes(result).length, 1); assert.equal(publishes(result)[0].visitIndex, 2);
  assert.equal(deliveries(result)[0].status, 'handled');
});

test('window close waits for every captured recipient and nested FIFO publication', real, async t => {
  const f = await build(t, value => isolated(value, `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("close", _close)
\tp.subscribe_event("close", _after)
\tp.subscribe_event("nested", _nested)
\tp.publish_event("close", true)
func _close(_value) -> bool:
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
\treturn p.publish_event("nested", "last")
func _after(_value) -> bool:
\treturn p.write_state("after", true)
func _nested(value) -> bool:
\treturn p.write_state("nested", value)
`));
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(deliveries(result).map(event => [event.sequence, event.status]), [[1, 'handled'], [1, 'handled'], [2, 'handled']]);
  assert.equal(result.record.events.at(-1).eventSequence, 2);
  assert.equal(result.record.runtime.project.sharedState.revision, 2);
});

const callbackCases = [
  { name: 'false result', body: '\treturn false\n' },
  { name: 'void result', body: '\tpass\n' },
  { name: 'runtime error', body: '\tvar values = []\n\treturn values[4]\n' },
  { name: 'async callback', body: '\tawait get_tree().create_timer(0.02).timeout\n\treturn true\n' },
];
for (const scenario of callbackCases) {
  test(`real ${scenario.name} is rejected without acknowledging delivery or rolling back earlier effects`, real, async t => {
    const f = await build(t, value => isolated(value, `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("check", _receive)
\tp.publish_event("check", true)
func _receive(_value):
\tp.write_state("before_failure", true)
${scenario.body}`));
    const result = await run(f); rejected(result, f, 'runtime_behavior_event_callback');
    assert.equal(publishes(result).length, 1); assert.equal(deliveries(result).length, 0);
    assert.equal(result.record.runtime.project.sharedState.revision, 1);
    assert.equal(result.record.runtime.project.sharedState.entries[0].value, true);
  });
}

const invalidSubscriptionCases = [
  { name: 'another node callback', setup: '\tvar other = Node.new()\n\tadd_child(other)\n', callback: 'other.set_name', methods: '' },
  { name: 'wrong callback arity', setup: '', callback: '_receive', methods: '\nfunc _receive() -> bool:\n\treturn true\n' },
];
for (const scenario of invalidSubscriptionCases) {
  test(`real ${scenario.name} is rejected at the owning binding`, real, async t => {
    const f = await build(t, value => isolated(value, `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
${scenario.setup}\tprint("SUBSCRIBE_REJECTED:" + JSON.stringify(p.subscribe_event("check", ${scenario.callback})))
${scenario.methods}`));
    const result = await run(f); rejected(result, f, 'runtime_behavior_event_callback');
    assert.deepEqual(printed(result.record, 'SUBSCRIBE_REJECTED:'), [0]);
    assert.equal(publishes(result).length, 0);
  });
}

const budgetCases = [
  { name: '65th active subscription', setup: '\tfor i in range(64):\n\t\tp.subscribe_event("e" + str(i), _receive)\n', reject: 'p.subscribe_event("extra", _receive)', result: 0, sequence: 0 },
  { name: '1025th lifetime registration', setup: '\tfor i in range(1024):\n\t\tp.unsubscribe_event(p.subscribe_event("event", _receive))\n', reject: 'p.subscribe_event("event", _receive)', result: 0, sequence: 0 },
  { name: '65th queued message', setup: '\tp.subscribe_event("event", _receive)\n\tfor i in range(64):\n\t\tp.publish_event("event", true)\n', reject: 'p.publish_event("event", true)', result: false, sequence: 64 },
  { name: 'pending payload bytes beyond 16384', setup: '\tp.subscribe_event("a", _receive)\n\tfor i in range(4):\n\t\tp.publish_event("a", "x".repeat(4095))\n', reject: 'p.publish_event("a", true)', result: false, sequence: 4 },
  { name: '1025th reserved delivery', setup: '\tfor i in range(64):\n\t\tp.subscribe_event("event", _receive_bound.bind(i))\n\tfor i in range(16):\n\t\tp.publish_event("event", true)\n', reject: 'p.publish_event("event", true)', result: false, sequence: 16 },
  { name: 'session payload bytes beyond 524288', setup: '\tvar name = "n".repeat(64)\n\tfor i in range(126):\n\t\tp.publish_event(name, "x".repeat(4096))\n\tp.publish_event(name, "x".repeat(64))\n', reject: 'p.publish_event(name, true)', result: false, sequence: 127 },
];
for (const scenario of budgetCases) {
  test(`real ${scenario.name} fails before changing the accepted publication history`, real, async t => {
    const f = await build(t, value => isolated(value, `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
${scenario.setup}\tprint("EVENT_LIMIT:" + JSON.stringify(${scenario.reject}))
func _receive(_value) -> bool:
\treturn true
func _receive_bound(_value, _tag) -> bool:
\treturn true
`));
    const result = await run(f); rejected(result, f, 'runtime_behavior_event_limit');
    assert.deepEqual(printed(result.record, 'EVENT_LIMIT:'), [scenario.result]);
    assert.equal(publishes(result).length, scenario.sequence);
    assert.equal(result.record.runtime.project.events.sequence, scenario.sequence);
    assert.equal(deliveries(result).length, 0);
  });
}

test('self-publishing callbacks terminate at the session publication limit without a recursive stack', real, async t => {
  const f = await build(t, value => isolated(value, `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("again", _receive)
\tp.publish_event("again", true)
func _receive(_value) -> bool:
\treturn p.publish_event("again", true)
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_event_limit');
  assert.equal(publishes(result).length, 128); assert.equal(deliveries(result).length, 127);
  assert.ok(deliveries(result).every(event => event.status === 'handled'));
});


test('a captured callback whose behavior was freed fails instead of fabricating a skipped delivery', real, async t => {
  const f = await build(t, async value => {
    await isolated(value, `extends Node
static var instance
func _ready() -> void:
\tinstance = self
\tget_meta("viento_project").subscribe_event("gone", _receive)
func _receive(_value) -> bool:
\treturn true
`);
    await writeScript(value, 'publisher', `extends Node
func _ready() -> void:
\tcall_deferred("_publish_and_free")
func _publish_and_free() -> void:
\tget_meta("viento_project").publish_event("gone", true)
\tload("res://behaviors/${value.scriptId}.gd").instance.free()
`);
  });
  const result = await run(f); rejected(result, f, 'runtime_behavior_event_callback');
  assert.equal(publishes(result).length, 1); assert.equal(deliveries(result).length, 0);
});

for (const [name, request, code] of [
  ['boolean event name', 'p.publish_event(true, 1)', 'runtime_behavior_event_name'],
  ['non-finite event payload', 'p.publish_event("bad", NAN)', 'runtime_behavior_event_value'],
]) {
  test(`real ${name} is rejected without an implicit conversion or accepted publication`, real, async t => {
    const f = await build(t, value => isolated(value, `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tprint("EVENT_REJECTED:" + JSON.stringify(${request}))
`));
    const result = await run(f); rejected(result, f, code);
    assert.deepEqual(printed(result.record, 'EVENT_REJECTED:'), [false]);
    assert.equal(publishes(result).length, 0);
  });
}
