import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { serve, request } from './helpers.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptSourceHost } from '../../web/modules/app-animation-state-script-source.js';
import { createAnimationStateScriptProposal } from '../../engine/animation-state-script-edit.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { reviewScriptParameterRows } from '../../engine/script-parameter-interface.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const conflict = { errorCode: 'scene_behavior_authoring_conflict' };
const form = parameters => ({ backendId: 'org.viento.godot4', language: 'gdscript', parameters: Object.entries(parameters).map(([name, value]) => ({ name, type: typeof value, value: String(value) })) });
const publisher = `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar p=get_meta("viento_project")
\tvar host=get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tp.publish_event("action",true)
\thost.flush_requests()
\thost.elapsed_seconds+=0.5
\thost.total_seconds+=0.5
\thost.current.project_step(0.5)
\thost.flush_requests()
\thost.finish_project()
`;

async function renameAndBind(t, documents = 'documents') {
  const f = await projectAnimationClipsAuthor(t);
  const controllerContent = '\ufeff' + DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replaceAll('\n', '\r\n');
  await f.script('checkpoint', controllerContent); await f.script('second', publisher);
  await f.edit('documents/behaviors/demo.json', manifest => {
    manifest.bindings[0].parameters = { clip_idle: f.clipIds[0][0], clip_action: f.clipIds[0][1] };
    manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId: f.secondBindingId,
      implementation: { ...manifest.bindings[0].implementation, sourceObjectId: f.secondScriptId }, parameters: {} });
  });
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata => metadata.relations.push({ kind: 'reference', targetId: f.secondScriptId, slot: 'implementation' }));
  if (documents !== 'documents') {
    await f.edit('workspace.json', workspace => { workspace.version = 2; workspace.paths.documents = documents; workspace.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, record => { record.sourcePath = record.sourcePath.replace(/^documents\//, documents + '/'); });
  }
  const sourcePath = `${documents}/behaviors/demo.json`, controllerPath = `${documents}/scripts/checkpoint.txt`, publisherPath = `${documents}/scripts/second.txt`;
  const behaviorFile = path.join(f.author, sourcePath), original = '\ufeff' + (await fs.readFile(behaviorFile, 'utf8')).replaceAll('\n', '\r\n');
  await fs.writeFile(behaviorFile, original);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author });
  const call = async (route, payload) => { const response = await request(base, route, payload); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const sourceRead = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'parameter-review', content: original, baseline: original, version: sourceRead.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true };
  const writes = [];
  const behaviorHost = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspect: payload => call('/api/scene-behavior-authoring', payload), writeDraft: content => { writes.push(content); state.content = content; } });
  const source = await behaviorHost.getSource(), before = await fingerprint(f.author, { authorOnly: true });
  const oldReview = await call('/api/scene-behavior-authoring', { sourcePath, content: original });
  const oldContract = oldReview.sources.find(row => row.objectId === f.scriptId).parameterContract;
  assert.equal(oldContract.status, 'ready'); assert.deepEqual(oldContract.parameters.map(row => row.name), ['clip_idle', 'clip_action']);
  assert.equal(Object.hasOwn(oldReview.sources.find(row => row.objectId === f.secondScriptId), 'parameterContract'), false, 'ordinary scripts retain the older catalog shape');
  const oldModel = JSON.parse(original.slice(1));
  const emptyReview = reviewScriptParameterRows(oldContract, form({ clip_idle: '', clip_action: '' }));
  assert.deepEqual(emptyReview.invalidValues, [], 'empty clip values intentionally select the whole animation');
  const staleModel = structuredClone(oldModel); staleModel.bindings[0].parameters.clip_idle = '';
  const staleProposal = createSceneBehaviorProposal(source, { bindings: staleModel.bindings });

  const savedScript = await call('/api/doc?path=' + encodeURIComponent(controllerPath));
  const scriptState = { document: {}, sourcePath: controllerPath, token: 'rename-state', content: controllerContent, baseline: controllerContent,
    version: savedScript.version, editable: true, creating: false, busy: false, available: true, sourceTXT: true };
  const scriptHost = createAnimationStateScriptSourceHost({ getState: () => ({ ...scriptState }), digest: async value => hash(value), writeDraft: content => { scriptState.content = content; } });
  const table = structuredClone(readAnimationStateScriptSource(controllerContent).table);
  table.states[1].key = 'strike';
  for (const edge of table.transitions) { if (edge.from === 'action') edge.from = 'strike'; if (edge.to === 'action') edge.to = 'strike'; }
  const edit = await createAnimationStateScriptProposal(await scriptHost.getSource(), table);
  assert.deepEqual(edit.beforeParameters.map(row => row.name), ['clip_idle', 'clip_action']);
  assert.deepEqual(edit.afterParameters.map(row => row.name), ['clip_idle', 'clip_strike']);
  await scriptHost.applyDraft(edit);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before, 'script table application only changes memory');
  await call('/api/doc', { path: controllerPath, content: scriptState.content, expectedVersion: savedScript.version });
  const afterScript = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(afterScript).filter(name => afterScript[name] !== before[name]), [controllerPath]);
  assert.equal(await fs.readFile(behaviorFile, 'utf8'), original, 'state renaming never migrates bindings automatically');
  await assert.rejects(behaviorHost.applyDraft(staleProposal, { dependencyRevision: oldReview.dependencyRevision }), conflict);
  assert.deepEqual(writes, [], 'changing script source invalidates a previously reviewed behavior edit');

  const review = await call('/api/scene-behavior-authoring', { sourcePath, content: original });
  assert.notEqual(review.dependencyRevision, oldReview.dependencyRevision);
  const contract = review.sources.find(row => row.objectId === f.scriptId).parameterContract;
  assert.deepEqual(contract.parameters.map(row => row.name), ['clip_idle', 'clip_strike']);
  const mismatched = reviewScriptParameterRows(contract, form(oldModel.bindings[0].parameters));
  assert.deepEqual(mismatched.missing.map(row => row.name), ['clip_strike']);
  assert.deepEqual(mismatched.unknown, [{ index: 1, name: 'clip_action' }]);
  assert.equal(mismatched.canAddMissing, true);
  assert.equal(await fs.readFile(behaviorFile, 'utf8'), original, 'contract review does not alter parameter names or values');
  const model = structuredClone(oldModel);
  // This is the author's explicit rename, preserving the selected clip UUID.
  model.bindings[0].parameters.clip_strike = model.bindings[0].parameters.clip_action;
  delete model.bindings[0].parameters.clip_action;
  const corrected = reviewScriptParameterRows(contract, form(model.bindings[0].parameters));
  for (const key of ['missing', 'unknown', 'typeMismatches', 'invalidValues', 'duplicateNames']) assert.deepEqual(corrected[key], []);
  const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });

  // Even an ordinary, contract-less source belongs to the dependency review.
  const publisherRead = await call('/api/doc?path=' + encodeURIComponent(publisherPath));
  await call('/api/doc', { path: publisherPath, content: publisher + '\n# author source changed after parameter review\n', expectedVersion: publisherRead.version });
  const beforeApply = await fingerprint(f.author, { authorOnly: true });
  await assert.rejects(behaviorHost.applyDraft(proposal, { dependencyRevision: review.dependencyRevision }), conflict);
  assert.deepEqual(writes, []); assert.equal(state.content, original);
  const refreshed = await call('/api/scene-behavior-authoring', { sourcePath, content: proposal.afterContent });
  assert.notEqual(refreshed.dependencyRevision, review.dependencyRevision);
  assert.equal(Object.hasOwn(refreshed.sources.find(row => row.objectId === f.secondScriptId), 'parameterContract'), false);
  await behaviorHost.applyDraft(proposal, { dependencyRevision: refreshed.dependencyRevision });
  assert.deepEqual(writes, [proposal.afterContent]); assert.equal(state.baseline, original); assert.equal(state.version, sourceRead.version);
  assert.equal(await fs.readFile(behaviorFile, 'utf8'), original); assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), beforeApply);
  assert.ok(state.content.startsWith('\ufeff')); assert.equal(state.content.replaceAll('\r\n', '').includes('\n'), false);
  await call('/api/doc', { path: sourcePath, content: state.content, expectedVersion: sourceRead.version });
  const after = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== beforeApply[name]), [sourcePath]);
  const captured = await captureBuildSnapshot(f.author, f.sceneIds[0]); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.behaviors.bindings[0].parameters, { clip_idle: f.clipIds[0][0], clip_strike: f.clipIds[0][1] });
  assert.deepEqual(captured.plan.behaviors.bindings[1].parameters, {});
  assert.equal(captured.plan.behaviors.sources.find(row => row.objectId === f.scriptId).content, scriptState.content);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), after);
  return { ...f, sourcePath, after, updatedScript: scriptState.content };
}

for (const documents of ['documents', 'design-data']) test(`state rename → refreshed parameter contract → explicit parameter repair → review → ordinary Save → plan (${documents})`, async t => {
  await renameAndBind(t, documents);
});

test('repaired state parameters execute in actual Godot and survive delivery ZIP reopening without the author workspace', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for actual parameter repair and portable delivery', timeout: 120000,
}, async t => {
  const f = await renameAndBind(t), tool = process.env.VIENTO_GODOT_BIN, output = path.join(f.temporary, 'parameter-build');
  const keys = ['XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'], previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const [index, key] of keys.entries()) { process.env[key] = path.join(f.temporary, 'xdg-' + index); await fs.mkdir(process.env[key]); }
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const verify = events => {
    assert.equal(events[0].protocol, 7);
    const commands = events.filter(row => row.event === 'animation-command');
    assert.deepEqual(commands.map(row => row.command.action), ['select', 'play', 'select', 'play', 'select', 'play']);
    assert.deepEqual(commands.filter(row => row.command.action === 'select').map(row => row.command.clipId), [f.clipIds[0][0], f.clipIds[0][1], f.clipIds[0][0]]);
    assert.ok(commands.every(row => row.bindingId === f.bindingId));
    assert.equal(events.filter(row => row.event === 'animation-completed').length, 1);
    assert.deepEqual(events.filter(row => row.event === 'animation-completion-delivery').map(row => row.status), ['handled']);
  };
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: false });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics || ran)); verify(ran.record.events);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), f.after);
  const inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
  const zip = path.join(f.temporary, 'parameter-repair.zip'); await writeExportZip(delivery, zip);
  assert.ok((await verifyBackendProjectDelivery(zip)).fileCount > 0);
  const moved = path.join(f.temporary, 'delivery'), archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try {
    for await (const entry of archive.eachEntry()) {
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json')));
  await fs.rename(f.author, f.author + '-offline'); await fs.rm(output, { recursive: true });
  const directory = path.join(moved, 'project'), retained = await fs.readFile(path.join(directory, 'behaviors', f.scriptId + '.gd'), 'utf8');
  assert.equal(retained, f.updatedScript); assert.equal(readAnimationStateScriptSource(retained).table.states[1].key, 'strike');
  const identified = await adapter.identify(tool);
  for (const phase of [...adapter.buildPhases, 'run']) {
    const execution = await adapter.executePhase({ phase, directory, tool: identified, smoke: false, timeoutMs: 60000 });
    assert.equal(execution.status, 'succeeded', execution.stdout + execution.stderr);
    assert.deepEqual(adapter.diagnostics(execution, snapshot.plan), [], execution.stdout + execution.stderr);
    if (phase === 'run') { const reader = adapter.createEventReader(snapshot.plan, { capabilities: built.record.backend.capabilities }); reader.push(execution.stdout); assert.deepEqual(reader.finish().diagnostics, [], execution.stdout + execution.stderr); verify(reader.events); }
  }
  assert.deepEqual(await fingerprint(f.author + '-offline', { authorOnly: true }), f.after);
});
