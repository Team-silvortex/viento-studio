import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { createProjectCausalAnchors } from '../../engine/project-causal-anchors.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const tool = process.env.VIENTO_GODOT_BIN;
const native = { skip: !tool && 'Set VIENTO_GODOT_BIN for native causal anchor verification', timeout: 120000 };
const json = value => JSON.stringify(value, null, 2) + '\n';
const instanceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const driverBinding = '62626262-6262-4262-8262-000000000009';
const node = (anchors, kind, sequence) => anchors.nodes.find(row => row.id === `${kind}:${sequence}`);
const root = (anchors, kind, sequence, reason) => anchors.roots.some(row => row.id === `${kind}:${sequence}` && row.reasons.includes(reason));
const edge = (anchors, from, to, relation) => anchors.edges.some(row => row.from === from && row.to === to && row.relation === relation);

async function authorHashes(directory) {
  const hashes = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(directory, file);
    if (!relative.startsWith('.viento/')) hashes[relative] = buildHash(await fs.readFile(file));
  }
  return hashes;
}

async function author(t, { states = false, instances = false } = {}) {
  const f = await projectAnimationClipsAuthor(t, { sprites: false });
  if (instances) await f.edit('documents/animations/scene-0.json', document => {
    document.schemaVersion = 4; document.playbackScope = 'instance';
    document.tracks.push(...document.tracks.map((track, index) => ({ ...structuredClone(track),
      id: `62626262-6262-4262-8262-${String(index + 100).padStart(12, '0')}`, instanceId: instanceB })));
  });
  if (states || instances) {
    await f.edit('documents/behaviors/demo.json', document => {
      if (states) document.bindings[0].parameters = { clip_idle: f.clipIds[0][0], clip_action: f.clipIds[0][1] };
      document.bindings.push({ ...structuredClone(document.bindings[0]), bindingId: driverBinding,
        instanceId: instances ? instanceB : f.instanceId, parameters: {},
        implementation: { ...document.bindings[0].implementation, sourceObjectId: f.secondScriptId } });
    });
    await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', document => {
      document.relations.push({ kind: 'reference', targetId: f.secondScriptId, slot: 'implementation' });
    });
  }
  if (states) await f.script('checkpoint', generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content);
  await f.script('second', 'extends Node\n');
  return f;
}

// Real engine _process callbacks advance clock windows. Only the short native
// animation step is controlled; the long tail never fabricates clock stamps.
const driver = (setup, { ready = '', methods = '', tail = '', terminal = '\tcall_deferred("_finish")' } = {}) => `extends Node
var p
var steps := 0
func _ready() -> void:
\tp = get_meta("viento_project")
\tset_process(false)
${ready}\tcall_deferred("_start")
func _start() -> void:
\tvar host = p.host.get_ref()
\thost.set_process(false)
\thost.flush_requests()
${setup}
\tset_process(true)
func _step(seconds: float) -> void:
\tvar host = p.host.get_ref()
\thost.elapsed_seconds += seconds
\thost.total_seconds += seconds
\thost.current.project_step(seconds)
\thost.flush_requests()
func _process(_delta: float) -> void:
\tsteps += 1
\tfor key in ["tail.a", "tail.b", "tail.c", "tail.d"]:
\t\tp.write_state(key, steps)
${tail}\tif steps == 40:
\t\tset_process(false)
${terminal.split('\n').map(line => '\t' + line).join('\n')}
func _finish() -> void:
\tp.host.get_ref().finish_project()
${methods}`;

async function run(name, f, options = {}) {
  const before = await authorHashes(f.author), output = { stdout: '', stderr: '' }, frames = [], views = [];
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool,
    output: path.join(f.temporary, 'causal-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, json(built.record?.diagnostics || built));
  assert.deepEqual(await authorHashes(f.author), before);
  let runtime;
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, tool, headless: true, smoke: false,
    timeoutMs: 60000, ...options, onProgress: event => {
      if (event.output) output[event.output.stream] += event.output.text;
      if (event.event) frames.push(event.event);
      if (event.runtime) runtime = event.runtime;
      if (event.causalAnchors) views.push({ runtime, anchors: event.causalAnchors });
      options.onProgress?.(event);
    } });
  assert.ok(result.record, json(result));
  const disk = JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json')));
  assert.deepEqual(disk, result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.deepEqual(await authorHashes(f.author), before);
  assert.equal(frames.length, result.record.eventRetention.total);
  assert.deepEqual(result.record.causalAnchors, createProjectCausalAnchors(result.record.runtime));
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  const evidence = process.env.VIENTO_CAUSAL_ANCHORS_EVIDENCE;
  if (evidence) {
    const directory = path.join(evidence, name); await fs.mkdir(directory, { recursive: true });
    const sourceHashes = {}, authorScripts = {};
    const sources = ['../../engine/project-causal-anchors.mjs', '../../engine/project-runtime-query.mjs',
      '../../engine/project-runtime-events.mjs', '../../engine/project-execution-clock.mjs',
      '../../engine/project-animation-state-entry-triggers.mjs', '../../engine/project-animation-completions.mjs',
      '../adapters/node-project-build.mjs', '../backends/godot4-adapter.mjs',
      '../backends/godot4-execution-clock.mjs', '../backends/godot4-execution-budget.mjs',
      './project-causal-anchors-godot.test.mjs'];
    for (const entry of await fs.readdir(new URL('../backends/godot4/', import.meta.url)))
      if ((entry.startsWith('project-') || entry.startsWith('execution-clock-')) && entry.endsWith('.gd')) sources.push(`../backends/godot4/${entry}`);
    for (const file of sources) sourceHashes[path.relative(path.resolve(new URL('../..', import.meta.url).pathname), new URL(file, import.meta.url).pathname)] = buildHash(await fs.readFile(new URL(file, import.meta.url)));
    for (const file of Object.keys(before)) if (file.startsWith('documents/scripts/')) authorScripts[file] = await fs.readFile(path.join(f.author, file), 'utf8');
    await Promise.all([
      fs.writeFile(path.join(directory, 'summary.json'), json({ schemaVersion: 1, name, recordedAt: new Date().toISOString(),
        node: process.version, platform: process.platform, arch: process.arch, mode: 'headless', smoke: false,
        tool: { executable: tool, ...built.record.tool }, backend: built.record.backend, ok: result.ok, status: result.status,
        lifecycle: result.record.lifecycle, executionClock: result.record.executionClock,
        causalAnchors: result.record.causalAnchors, eventRetention: result.record.eventRetention,
        authorFiles: Object.keys(before).length, authorUnchangedAfterBuildAndRun: true, diskRecordMatches: true,
        temporaryProjectRemoved: true, sourceHashes, diagnostics: result.record.diagnostics,
        stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr) })),
      fs.writeFile(path.join(directory, 'author-hashes.json'), json(before)),
      fs.writeFile(path.join(directory, 'author-scripts.json'), json(authorScripts)),
      fs.writeFile(path.join(directory, 'build-snapshot.json'), json(snapshot)),
      fs.writeFile(path.join(directory, 'session.json'), json(disk)),
      fs.writeFile(path.join(directory, 'observed-events.json'), json(frames)),
      fs.writeFile(path.join(directory, 'anchor-updates.json'), json(views.map(view => view.anchors))),
      fs.writeFile(path.join(directory, 'stdout.log'), output.stdout),
      fs.writeFile(path.join(directory, 'stderr.log'), output.stderr),
    ]);
  }
  return { result, frames, views, snapshot };
}

function longTail(observed) {
  const { record } = observed.result;
  assert.ok(record.executionClock.totalWindows > 32, json(record.executionClock));
  assert.equal(record.executionClock.windows.length, 32);
  assert.ok(record.executionClock.retention.dropped > 0);
  assert.ok(record.eventRetention.total > 128);
  assert.equal(record.events.length, 128);
  assert.ok(record.eventRetention.dropped > 0);
  assert.equal(record.events.some(row => row.event === 'animation-command' && row.commandSequence <= 4), false);
}
function succeeds(observed) {
  assert.equal(observed.result.ok, true, json(observed.result.record.diagnostics));
  assert.equal(observed.result.status, 'succeeded');
  assert.deepEqual(observed.result.record.diagnostics, []);
}
const activeTail = observed => {
  const view = observed.views.findLast(row => row.runtime?.project.sharedState?.revision >= 160
    && row.runtime.project.visits.at(-1)?.phase === 'ready');
  assert.ok(view, 'A live detached anchor update survives the raw and clock tails.');
  assert.deepEqual(view.anchors, createProjectCausalAnchors(view.runtime));
  return view;
};

function checkOrigins(observed, kind, record, bindingId, sceneId) {
  const scene = observed.snapshot.plan.scenes.find(row => row.scene.objectId === sceneId);
  const declaration = scene.behaviors.bindings.find(row => row.bindingId === bindingId);
  assert.equal(record.origin.bindingId, bindingId);
  assert.equal(record.origin.sceneId, sceneId);
  assert.deepEqual(record.origin.source, declaration.declaration, kind);
}

test('native event and completion entry evidence survives forty windows and a rotated raw tail', native, async t => {
  const f = await author(t, { states: true });
  await f.script('second', driver('\tp.publish_event("action", true)\n\thost.flush_requests()\n\t_step(0.5)', {
    tail: '\tp.publish_event("noise", steps)\n\tp.play_animation()\n\tp.host.get_ref().flush_requests()\n',
  }));
  const observed = await run('state-chain-tail', f); succeeds(observed); longTail(observed);
  assert.equal(observed.result.record.events.some(row => ['animation-completed', 'animation-state-entered'].includes(row.event) || row.event === 'event-publish' && row.name === 'action'), false);
  const { anchors, runtime } = activeTail(observed);
  assert.deepEqual(runtime.project.animationStateEntries.entries.map(row => row.stateKey), ['idle', 'action', 'idle']);
  const event = node(anchors, 'events', 1).record, completion = node(anchors, 'animationCompletions', 1).record;
  assert.equal(anchors.retention.events.total, 41); assert.equal(anchors.retention.animationCommands.total, 46);
  assert.ok(anchors.retention.events.dropped > 0); assert.ok(anchors.retention.animationCommands.dropped > 0);
  assert.equal(root(anchors, 'events', 1, 'recent'), false);
  assert.equal(root(anchors, 'animationCommands', 4, 'recent'), false);
  checkOrigins(observed, 'event', event, driverBinding, f.sceneIds[0]);
  checkOrigins(observed, 'command', node(anchors, 'animationCommands', 4).record, f.bindingId, f.sceneIds[0]);
  assert.equal(event.deliveries[0].status, 'handled'); assert.equal(completion.deliveries[0].status, 'handled');
  assert.ok(edge(anchors, 'animationStateEntries:2', 'events:1', 'trigger'));
  assert.ok(edge(anchors, 'animationStateEntries:3', 'animationCompletions:1', 'trigger'));
  assert.ok(edge(anchors, 'animationCompletions:1', 'animationCommands:4', 'playback-command'));
  assert.ok(root(anchors, 'animationStateEntries', 3, 'latest-controller-entry'));
  assert.equal(node(anchors, 'animationStateEntries', 2).record.scriptSource.objectId, f.scriptId);
  assert.equal(node(anchors, 'animationStateEntries', 3).record.commandSequence, 4);
  // A watermark is retained as such; it is never relabeled as entry->future-command causation.
  assert.equal(anchors.edges.some(row => row.from === 'animationStateEntries:3' && ['animationCommands:5', 'animationCommands:6'].includes(row.to)), false);
  assert.deepEqual(createProjectCausalAnchors(observed.result.record.runtime, { recentPerKind: 0 }).nodes, []);
});

test('native instance baseline keeps the exact target command independently of the global watermark', native, async t => {
  const f = await author(t, { instances: true });
  await f.script('second', 'extends Node\n');
  await f.script('checkpoint', driver(`\tvar q
\tfor actor in host.current.actors:
\t\tif actor["instanceId"] == "${instanceB}":
\t\t\tq = actor["node"].get_node("behavior_${driverBinding.replaceAll('-', '_')}").get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.play_animation()
\tq.select_animation_clip("${f.clipIds[0][0]}")
\tq.play_animation()
\thost.flush_requests()
\t_step(0.5)`));
  const observed = await run('instance-watermark-tail', f); succeeds(observed); longTail(observed);
  const live = activeTail(observed), anchors = createProjectCausalAnchors(live.runtime, { recentPerKind: 0 });
  const completion = node(anchors, 'animationCompletions', 1).record;
  assert.deepEqual(completion.target, { kind: 'instance', instanceId: f.instanceId });
  assert.equal(completion.commandSequence, 4); assert.equal(completion.targetCommandSequence, 2);
  assert.ok(edge(anchors, 'animationCompletions:1', 'animationCommands:2', 'playback-command'));
  assert.ok(edge(anchors, 'animationCompletions:1', 'animationCommands:4', 'global-watermark'));
  assert.equal(edge(anchors, 'animationCompletions:1', 'animationCommands:4', 'playback-command'), false);
  assert.ok(root(anchors, 'animationCompletions', 1, 'target-baseline'));
  assert.ok(root(anchors, 'animationCommands', 4, 'target-baseline'));
  assert.deepEqual(node(anchors, 'animationCommands', 2).record.target, { kind: 'instance', instanceId: f.instanceId });
  assert.deepEqual(node(anchors, 'animationCommands', 4).record.target, { kind: 'instance', instanceId: instanceB });
  checkOrigins(observed, 'target A', node(anchors, 'animationCommands', 2).record, f.bindingId, f.sceneIds[0]);
  checkOrigins(observed, 'target B', node(anchors, 'animationCommands', 4).record, driverBinding, f.sceneIds[0]);
});

test('native cancellation preserves a pending delivery and early playback source after both tails rotate', native, async t => {
  const f = await author(t), controller = new AbortController();
  await f.script('checkpoint', driver(`\tp.select_animation_clip("${f.clipIds[0][0]}")\n\tp.play_animation()\n\thost.flush_requests()`, {
    ready: '\tp.subscribe_event("hold", _hold)\n', terminal: '\tp.publish_event("hold", true)',
    // Hold the native callback until cancellation reaches the process. The wire
    // has published the recipient but cannot yet claim a successful delivery.
    methods: 'func _hold(_value) -> bool:\n\tOS.delay_msec(10000)\n\treturn true\n',
  }));
  let cancelled = false;
  const observed = await run('cancelled-pending-tail', f, { signal: controller.signal, onProgress: event => {
    if (event.event?.event === 'event-publish' && event.event.name === 'hold') { cancelled = true; controller.abort(); }
  } });
  assert.equal(cancelled, true); assert.equal(observed.result.status, 'cancelled'); assert.equal(observed.result.ok, false);
  longTail(observed);
  assert.equal(observed.result.record.executionClock.phase, 'incomplete');
  const anchors = createProjectCausalAnchors(observed.result.record.runtime, { recentPerKind: 0 });
  assert.ok(root(anchors, 'events', 1, 'pending-delivery'));
  assert.equal(node(anchors, 'events', 1).record.deliveries[0].status, 'pending');
  assert.ok(root(anchors, 'animationCommands', 2, 'target-baseline'));
  checkOrigins(observed, 'pending publisher', node(anchors, 'events', 1).record, f.bindingId, f.sceneIds[0]);
  checkOrigins(observed, 'old playing baseline', node(anchors, 'animationCommands', 2).record, f.bindingId, f.sceneIds[0]);
  assert.equal(observed.frames.some(row => row.event === 'event-delivery'), false);
});

test('native scene switching releases old live roots while zero-recent recomputation preserves the new visit', native, async t => {
  const f = await author(t, { states: true });
  await f.script('second', driver(`\tif host.visit_index == 1:
\t\tp.publish_event("action", true)
\t\thost.flush_requests()
\t\t_step(0.5)
\t\tp.request_scene("${f.sceneIds[1]}")
\t\treturn
\tp.select_animation_clip("${f.clipIds[1][0]}")
\tp.play_animation()
\thost.flush_requests()`));
  const observed = await run('visit-release-tail', f); succeeds(observed); longTail(observed);
  const live = activeTail(observed);
  assert.equal(live.runtime.project.visits.length, 2);
  assert.equal(live.runtime.project.visits[0].phase, 'left');
  const anchors = createProjectCausalAnchors(live.runtime, { recentPerKind: 0 });
  assert.ok(anchors.nodes.length > 0);
  assert.ok(anchors.roots.every(row => row.reasons.every(reason => reason === 'target-baseline')));
  assert.ok(anchors.nodes.every(row => row.kind === 'animationCommands' && row.record.origin.visitIndex === 2 && row.record.origin.sceneId === f.sceneIds[1]));
  assert.equal(anchors.nodes.some(row => ['events', 'animationCompletions', 'animationStateEntries'].includes(row.kind)), false);
  assert.deepEqual(anchors, createProjectCausalAnchors(structuredClone(live.runtime), { recentPerKind: 0 }));
  const finished = createProjectCausalAnchors(observed.result.record.runtime, { recentPerKind: 0 });
  assert.deepEqual(finished.nodes, []); assert.deepEqual(finished.roots, []); assert.deepEqual(finished.edges, []);
  assert.ok(finished.retention.aggregate.dropped > 0);
});
