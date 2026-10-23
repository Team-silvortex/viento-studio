// Isolated budget probes load the production Godot completion manager and its
// actual callable identity helper. A small host supplies coordinator ports;
// transport timing, author documents and generated projects are not simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool && 'Set VIENTO_GODOT_BIN for isolated real completion-manager budget probes', timeout: 30000 };
const budgetError = 'runtime_behavior_animation_completion_limit';
const queueError = 'runtime_animation_completion_limit';
const ownerSource = `extends Node
class Counter extends RefCounted:
\tvar sequence := 0
var current
var current_scene := "11111111-1111-4111-8111-111111111111"
var visit_index := 1
var accepting := true
var failed := false
var finished := false
var pending_scene := ""
var finish_requested := false
var animation_control
var event_bus
var manager
var emitted: Array = []
var diagnostics: Array = []
var scheduled := 0
func _init() -> void:
\tcurrent = self
\tanimation_control = Counter.new()
\tevent_bus = preload("res://project-events.gd").new(self)
\tmanager = preload("res://project-animation-completions.gd").new(self)
func state_access(visit: int) -> bool:
\treturn accepting and not failed and not finished and visit == visit_index
func project_animation_declared() -> bool:
\treturn true
func state_fail(binding: Dictionary, code: String, message: String) -> bool:
\tdiagnostics.append({"code": code, "binding": binding.duplicate(true), "message": message})
\tfailed = true
\treturn false
func emit(event: String, data: Dictionary) -> void:
\tdiagnostics.append({"event": event, "code": data["code"]})
\tfailed = true
func project_emit(event: String, data: Dictionary) -> void:
\temitted.append({"event": event, "data": data.duplicate(true)})
func schedule_flush() -> void:
\tscheduled += 1
`;
const probePrefix = `extends SceneTree
class Receiver extends Node:
\tvar calls: Array = []
\tfunc completed(value, marker: int) -> bool:
\t\tcalls.append([value, marker])
\t\treturn true
\tfunc wrong_arity() -> bool:
\t\treturn true
func _initialize() -> void:
\tcall_deferred("_probe")
func binding() -> Dictionary:
\treturn {"bindingId": "22222222-2222-4222-8222-222222222222", "instanceId": "33333333-3333-4333-8333-333333333333", "objectId": "44444444-4444-4444-8444-444444444444"}
func completed_state(seconds: float = 1.0) -> Dictionary:
\treturn {"sceneObjectId": "11111111-1111-4111-8111-111111111111", "phase": "finished", "positionSeconds": 1.0, "timeSeconds": seconds, "clipId": null}
func snapshot(host, receiver) -> Dictionary:
\treturn {"active": host.manager.subscriptions.size(), "registrations": host.manager.registration_count,
\t\t"sequence": host.manager.sequence, "pending": host.manager.pending_count(), "reserved": host.manager.reserved_deliveries,
\t\t"emitted": host.emitted.size(), "scheduled": host.scheduled, "callbacks": receiver.calls.size()}
func make_receiver(host) -> Receiver:
\tvar receiver := Receiver.new()
\thost.add_child(receiver)
\treturn receiver
func _probe() -> void:
\tvar host = load("res://host.gd").new()
\troot.add_child(host)
\tvar receiver := make_receiver(host)
`;
async function probe(t, body) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-completion-queue-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' };
  for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) {
    env[key] = path.join(directory, key.toLowerCase()); await fs.mkdir(env[key], { mode: 0o700 });
  }
  for (const file of ['project-animation-completions.gd', 'project-events.gd']) {
    await fs.copyFile(new URL(`../backends/godot4/${file}`, import.meta.url), path.join(directory, file));
  }
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Isolated animation completion queue"\n');
  await fs.writeFile(path.join(directory, 'host.gd'), ownerSource);
  await fs.writeFile(path.join(directory, 'probe.gd'), probePrefix + body + '\n\thost.free()\n\tquit()\n');
  const result = await execFileAsync(tool, ['--headless', '--path', directory, '--script', 'res://probe.gd'], { env, timeout: 25000, maxBuffer: 1024 * 1024 });
  assert.doesNotMatch(result.stderr, /SCRIPT ERROR|Parse Error|ERROR:|ObjectDB instances leaked/, result.stderr);
  const rows = result.stdout.split('\n').filter(line => line.startsWith('QUEUE:')).map(line => JSON.parse(line.slice(6)));
  assert.equal(rows.length, 1, result.stdout); return rows[0];
}
function rejectedWithoutGrowth(result, code) {
  assert.equal(result.failed, true); assert.equal(result.code, code);
  assert.deepEqual(result.after, result.before, 'Rejected operation or subsequent drain changed accepted queue state');
}

test('64 active completion subscriptions preserve bound callback identity and reject a 65th before allocating a token', real, async t => {
  const result = await probe(t, `\tvar tokens: Array = []
\tfor index in range(64):
\t\ttokens.append(host.manager.subscribe(1, binding(), receiver, receiver.completed.bind(index)))
\tvar duplicate: int = host.manager.subscribe(1, binding(), receiver, receiver.completed.bind(0))
\tvar before := snapshot(host, receiver)
\tvar rejected: int = host.manager.subscribe(1, binding(), receiver, receiver.completed.bind(64))
\thost.manager.complete(1, completed_state())
\thost.manager.drain()
\tprint("QUEUE:" + JSON.stringify({"tokens": tokens, "duplicate": duplicate, "rejected": rejected, "arity": receiver.completed.bind(0).get_argument_count(), "before": before, "after": snapshot(host, receiver), "failed": host.failed, "code": host.diagnostics[-1]["code"]}))`);
  assert.deepEqual(result.tokens, Array.from({ length: 64 }, (_, index) => index + 1)); assert.equal(result.duplicate, 1);
  assert.equal(result.arity, 1); assert.equal(result.rejected, 0);
  assert.deepEqual(result.before, { active: 64, registrations: 64, sequence: 0, pending: 0, reserved: 0, emitted: 0, scheduled: 0, callbacks: 0 });
  rejectedWithoutGrowth(result, budgetError);
});

test('1024 lifetime tokens remain consumed after unsubscribe and the next registration allocates nothing', real, async t => {
  const result = await probe(t, `\tvar exact_tokens := true
\tvar all_unsubscribed := true
\tfor index in range(1024):
\t\tvar token: int = host.manager.subscribe(1, binding(), receiver, receiver.completed.bind(0))
\t\texact_tokens = exact_tokens and token == index + 1
\t\tall_unsubscribed = all_unsubscribed and host.manager.unsubscribe(1, binding(), token)
\tvar before := snapshot(host, receiver)
\tvar rejected: int = host.manager.subscribe(1, binding(), receiver, receiver.completed.bind(0))
\thost.manager.complete(1, completed_state())
\thost.manager.drain()
\tprint("QUEUE:" + JSON.stringify({"tokens": exact_tokens, "unsubscribed": all_unsubscribed, "rejected": rejected, "before": before, "after": snapshot(host, receiver), "failed": host.failed, "code": host.diagnostics[-1]["code"]}))`);
  assert.equal(result.tokens, true); assert.equal(result.unsubscribed, true); assert.equal(result.rejected, 0);
  assert.deepEqual(result.before, { active: 0, registrations: 1024, sequence: 0, pending: 0, reserved: 0, emitted: 0, scheduled: 0, callbacks: 0 });
  rejectedWithoutGrowth(result, budgetError);
});

test('320 accepted natural completion reports without subscribers do not queue work and report321 is rejected before emission', real, async t => {
  const result = await probe(t, `\tfor index in range(320):
\t\thost.manager.complete(1, completed_state(float(index + 1)))
\tvar before := snapshot(host, receiver)
\thost.manager.complete(1, completed_state(321.0))
\thost.manager.drain()
\tprint("QUEUE:" + JSON.stringify({"first": host.emitted[0]["data"]["completionSequence"], "last": host.emitted[-1]["data"]["completionSequence"], "before": before, "after": snapshot(host, receiver), "failed": host.failed, "code": host.diagnostics[-1]["code"]}))`);
  assert.equal(result.first, 1); assert.equal(result.last, 320);
  assert.deepEqual(result.before, { active: 0, registrations: 0, sequence: 320, pending: 0, reserved: 0, emitted: 320, scheduled: 0, callbacks: 0 });
  rejectedWithoutGrowth(result, queueError);
});

test('64 pending completion messages bound queued work and message65 neither reserves recipients nor invokes callbacks', real, async t => {
  const result = await probe(t, `\thost.manager.subscribe(1, binding(), receiver, receiver.completed.bind(0))
\tfor index in range(64):
\t\thost.manager.complete(1, completed_state(float(index + 1)))
\tvar before := snapshot(host, receiver)
\thost.manager.complete(1, completed_state(65.0))
\thost.manager.drain()
\tprint("QUEUE:" + JSON.stringify({"before": before, "after": snapshot(host, receiver), "failed": host.failed, "code": host.diagnostics[-1]["code"]}))`);
  assert.deepEqual(result.before, { active: 1, registrations: 1, sequence: 64, pending: 64, reserved: 64, emitted: 64, scheduled: 64, callbacks: 0 });
  rejectedWithoutGrowth(result, queueError);
});

test('1024 completed deliveries exhaust the lifetime recipient budget even after draining and new completions add no callbacks', real, async t => {
  const result = await probe(t, `\tfor index in range(64):
\t\thost.manager.subscribe(1, binding(), receiver, receiver.completed.bind(index))
\tfor index in range(16):
\t\thost.manager.complete(1, completed_state(float(index + 1)))
\t\thost.manager.drain()
\tvar correct_payloads := true
\tfor index in range(receiver.calls.size()):
\t\tcorrect_payloads = correct_payloads and receiver.calls[index] == [null, index % 64]
\tvar deliveries := 0
\tvar handled := 0
\tfor frame in host.emitted:
\t\tif frame["event"] == "animation-completion-delivery":
\t\t\tdeliveries += 1
\t\t\tif frame["data"]["status"] == "handled":
\t\t\t\thandled += 1
\tvar before := snapshot(host, receiver)
\thost.manager.complete(1, completed_state(17.0))
\thost.manager.drain()
\tprint("QUEUE:" + JSON.stringify({"payloads": correct_payloads, "deliveries": deliveries, "handled": handled, "before": before, "after": snapshot(host, receiver), "failed": host.failed, "code": host.diagnostics[-1]["code"]}))`);
  assert.equal(result.payloads, true); assert.equal(result.deliveries, 1024); assert.equal(result.handled, 1024);
  assert.deepEqual(result.before, { active: 64, registrations: 64, sequence: 16, pending: 0, reserved: 1024, emitted: 1040, scheduled: 16, callbacks: 1024 });
  rejectedWithoutGrowth(result, queueError);
});

test('foreign and wrong-arity callables never consume completion subscriptions or execute', real, async t => {
  const result = await probe(t, `\tvar foreign := make_receiver(host)
\tvar before := snapshot(host, receiver)
\tvar rejected_foreign: int = host.manager.subscribe(1, binding(), receiver, foreign.completed.bind(0))
\tvar foreign_code = host.diagnostics[-1]["code"]
\thost.failed = false
\tvar rejected_arity: int = host.manager.subscribe(1, binding(), receiver, receiver.wrong_arity)
\thost.manager.complete(1, completed_state())
\thost.manager.drain()
\tprint("QUEUE:" + JSON.stringify({"foreign": rejected_foreign, "arity": rejected_arity, "foreign_calls": foreign.calls.size(), "foreign_code": foreign_code, "before": before, "after": snapshot(host, receiver), "failed": host.failed, "code": host.diagnostics[-1]["code"]}))`);
  assert.equal(result.foreign, 0); assert.equal(result.arity, 0); assert.equal(result.foreign_calls, 0);
  assert.equal(result.foreign_code, 'runtime_behavior_animation_completion_callback');
  rejectedWithoutGrowth(result, 'runtime_behavior_animation_completion_callback');
});
