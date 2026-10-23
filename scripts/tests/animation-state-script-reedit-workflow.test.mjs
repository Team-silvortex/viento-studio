import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serve, request } from './helpers.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters, prepareScriptDraft, prepareAnimationStateScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import { createAnimationStateScriptSourceHost } from '../../web/modules/app-animation-state-script-source.js';
import { createAnimationStateScriptProposal } from '../../engine/animation-state-script-edit.mjs';
import { readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { sceneBehaviorAnimationClipValue } from '../../engine/scene-animation-directory.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { spriteAnimationFixture, sceneId, animationPath } from './helpers/scene-animation-sprite-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const id = n => `54545454-5454-4545-8545-${String(n).padStart(12, '0')}`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');

async function reeditStateAnimation(t, documents = 'documents') {
  const f = await spriteAnimationFixture(t), clipId = id(50), idleId = id(51), assemblyId = id(60);
  await f.edit(animationPath, value => { value.schemaVersion = 3; value.clips = [{ id: clipId, name: '攻撃 / Strike', startSeconds: .5, endSeconds: .75, loop: false }, { id: idleId, name: '待機 / Idle', startSeconds: .75, endSeconds: 1.5, loop: true }]; });
  await f.edit('workspace.json', value => { value.documentTypes.push({ id: 'assembly', label: 'Assembly', directory: 'projects', parserProfile: 'structured', template: 'assembly.json' }); });
  const assembly = { format: 'viento-project-assembly', schemaVersion: 1, title: 'Animation state table workflow', entrySceneId: sceneId, sceneIds: [sceneId] };
  await f.write('documents/projects/demo.json', json(assembly)); await f.write('templates/assembly.json', json(assembly));
  const sceneRecord = JSON.parse(await f.read(`metadata/documents/${sceneId}.json`));
  await f.write(`metadata/documents/${assemblyId}.json`, json({ ...sceneRecord, id: assemblyId, documentType: 'assembly', sourcePath: 'documents/projects/demo.json',
    relations: [{ kind: 'reference', targetId: sceneId, slot: 'scene' }], assetBindings: [] }));
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.root, 'templates'), path.join(f.root, 'data-template'));
    await fs.rename(path.join(f.root, 'documents'), path.join(f.root, documents));
    for (const name of await fs.readdir(path.join(f.root, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => { value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/'); });
  }
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root });
  const call = async (route, payload) => { const response = await request(base, route, payload); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const catalog = () => call('/api/scene-behavior-creation', { sceneObjectId: sceneId });
  const empty = await catalog(); assert.deepEqual(empty.sources, []);
  assert.equal(empty.documentTypes.some(type => type.id === 'script'), false, 'generic document types can own scripts');
  const context = { sourceToken: 'state-animation-workflow', documentRoot: empty.documentRoot, documentTypes: empty.documentTypes };
  const table = { initialState: 'idle', states: [{key:'idle'},{key:'move'},{key:'attack'}], transitions: [
    {from:'idle',to:'attack',trigger:{kind:'event',name:'checkpoint'}},
    {from:'attack',to:'idle',trigger:{kind:'completed'}},
    {from:'idle',to:'move',trigger:{kind:'event',name:'move'}},
    {from:'move',to:'idle',trigger:{kind:'event',name:'stop'}},
    {from:'move',to:'attack',trigger:{kind:'event',name:'checkpoint'}},
  ] };
  const sources = [];
  for (const [index, starterId] of ['godot-project-animation-state-table', 'godot-project-events'].entries()) {
    const before = await fingerprint(f.root, { authorOnly: true });
    const sourcePath = `${documents}/scripts/${['状态脚本', 'publisher'][index]}.txt`, starter = listScriptStarters().find(row => row.id === starterId);
    const selection = { starterId, documentType: 'character', sourcePath };
    const proposal = index === 0 ? prepareAnimationStateScriptDraft(context, selection, { ...table, transitions: table.transitions.map(edge => edge.trigger.name === 'checkpoint' ? { ...edge, trigger: { kind: 'event', name: 'before-edit' } } : edge) }) : prepareScriptDraft(context, selection);
    const draft = prepareScriptDraftApply(context, proposal); assert.equal(draft.content, proposal.content);
    const savedContent = index === 0 ? '\ufeff' + draft.content.replaceAll('\n', '\r\n') : draft.content;
    if (index === 0) assert.notEqual(draft.content, starter.content, 'custom state table is emitted, not replaced by the default starter');
    assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before, 'starter review is read-only');
    const saved = await call('/api/doc', { path: sourcePath, content: savedContent, documentType: draft.documentType, create: true });
    const record = (await readRegistry(f.root)).documents.find(row => row.sourcePath === sourcePath); assert.ok(record);
    assert.equal(await f.read(sourcePath), savedContent); assert.deepEqual(record.relations, []);
    const after = await fingerprint(f.root, { authorOnly: true });
    assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(), [sourcePath, `metadata/documents/${record.id}.json`].sort());
    for (const [name, bytes] of Object.entries(before)) assert.equal(after[name], bytes, name);
    sources.push({ ...record, content: savedContent, version: saved.version });
  }
  const controller = sources[0], controllerRegistration = (await readRegistry(f.root)).documents.find(row => row.id === sources[0].id), beforeEdit = await fingerprint(f.root, { authorOnly: true });
  const current = { document: {}, token: 'reedit-script', sourcePath: controller.sourcePath, content: controller.content,
    baseline: controller.content, version: controller.version, editable: true, sourceTXT: true, available: true, creating: false, busy: false };
  let scriptDraftWrites = 0;
  const scriptHost = createAnimationStateScriptSourceHost({ getState: () => ({ ...current }), digest: async value => hash(value),
    writeDraft: value => { current.content = value; scriptDraftWrites++; } });
  const savedTable = readAnimationStateScriptSource(current.content);
  assert.equal(savedTable.newline, '\r\n'); assert.equal(savedTable.bom, '\ufeff');
  assert.ok(savedTable.table.transitions.some(edge => edge.trigger.name === 'before-edit'));
  const scriptSource = await scriptHost.getSource();
  const scriptEdit = await createAnimationStateScriptProposal(scriptSource, table);
  assert.notEqual(scriptEdit.afterContent, scriptEdit.beforeContent);
  assert.deepEqual(scriptEdit.beforeParameters, scriptEdit.afterParameters, 'event changes do not migrate clip parameters');
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), beforeEdit, 'reopen and review are read-only');
  await scriptHost.applyDraft(scriptEdit);
  assert.equal(scriptDraftWrites, 1); assert.equal(await f.read(controller.sourcePath), controller.content);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), beforeEdit, 'applying does not bypass ordinary Save');
  assert.ok(current.content.startsWith('\ufeff')); assert.equal(current.content.replaceAll('\r\n', '').includes('\n'), false);
  assert.deepEqual(readAnimationStateScriptSource(current.content).table, table);
  const savedEdit = await call('/api/doc', { path: controller.sourcePath, content: current.content, expectedVersion: current.version });
  const afterEdit = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterEdit).filter(name => afterEdit[name] !== beforeEdit[name]), [controller.sourcePath]);
  assert.deepEqual((await readRegistry(f.root)).documents.find(row => row.id === controller.id),
    controllerRegistration, 'script identity and registration are preserved');
  controller.content = current.content; controller.version = savedEdit.version;
  current.baseline = current.content; current.version = savedEdit.version;
  assert.deepEqual(readAnimationStateScriptSource((await scriptHost.getSource()).content).table, table, 'reopens the newly saved declaration');
  const noOpSource = await scriptHost.getSource();
  await assert.rejects(() => createAnimationStateScriptProposal(noOpSource, table), { errorCode: 'animation_state_script_authoring_unchanged' });
  assert.equal(scriptDraftWrites, 1);
  const available = await catalog(); assert.equal(available.sources.length, 2);
  const creation = createSceneBehaviorCreationDraft({ sceneObjectId: sceneId, backendId: 'org.viento.godot4', language: 'gdscript',
    bindings: sources.map((source, i) => ({ bindingId: id(i + 1), instanceId: available.scene.instances[0].instanceId, sourceObjectId: source.id })) });
  assert.equal(creation.ok, true, JSON.stringify(creation));
  const model = JSON.parse(creation.content); model.bindings[0].parameters = { clip_idle: '', clip_move: '', clip_attack: '' };
  const content = '\ufeff' + json(model).replaceAll('\n', '\r\n'), sourcePath = `${documents}/behaviors/state-animation.json`;
  const command = { command: 'behavior.create', mode: 'preview', worldId: available.worldId, baseRevision: available.baseRevision,
    actorRef: { kind: 'user', id: 'state-animation-workflow' }, objectId: id(4), documentType: 'character', sourcePath, content,
    sceneObjectId: sceneId, sceneObjectRevision: available.scene.objectRevision, sceneSourceRevision: available.scene.sourceRevision };
  const beforeBehavior = await fingerprint(f.root, { authorOnly: true });
  await call('/api/world/commands', command); assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), beforeBehavior);
  await call('/api/world/commands', { ...command, mode: 'apply' });
  const afterBehavior = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterBehavior).filter(name => afterBehavior[name] !== beforeBehavior[name]).sort(), [sourcePath, `metadata/documents/${id(4)}.json`, `metadata/documents/${sceneId}.json`].sort());
  const read = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'state-animation-parameter-review', content, baseline: content, version: read.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, animationClipsAvailable: true };
  let draftWrites = 0;
  const host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspect: value => call('/api/scene-behavior-authoring', value), inspectAnimationDirectory: value => call('/api/scene-animation-directory', value),
    writeDraft: value => { state.content = value; draftWrites++; } });
  const source = await host.getSource(), directory = await host.getAnimationClips(source);
  const selected = directory.clips.find(row => row.name === '攻撃 / Strike'); assert.equal(selected.clipId, clipId);
  model.bindings[0].parameters.clip_attack = sceneBehaviorAnimationClipValue(directory, selected.clipId);
  const next = directory.clips.find(row => row.name === '待機 / Idle'); assert.equal(next.clipId, idleId);
  model.bindings[0].parameters.clip_idle = sceneBehaviorAnimationClipValue(directory, next.clipId);
  model.bindings[0].parameters.clip_move = sceneBehaviorAnimationClipValue(directory, next.clipId);
  const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });
  const reviewed = await call('/api/scene-behavior-authoring', { sourcePath, content });
  await host.applyDraft(proposal, { dependencyRevision: reviewed.dependencyRevision });
  assert.equal(draftWrites, 1); assert.equal(await f.read(sourcePath), content);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterBehavior, 'parameter review only updates editor memory');
  assert.ok(state.content.startsWith('\ufeff')); assert.equal(state.content.replaceAll('\r\n', '').includes('\n'), false);
  await call('/api/doc', { path: sourcePath, content: state.content, expectedVersion: read.version });
  const after = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== afterBehavior[name]), [sourcePath]);
  const captured = await captureBuildSnapshot(f.root, sceneId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.behaviors.bindings.find(row => row.bindingId === id(1)).parameters, { clip_idle: idleId, clip_move: idleId, clip_attack: clipId });
  assert.deepEqual(captured.plan.behaviors.bindings.find(row => row.bindingId === id(2)).parameters, {});
  for (const saved of sources) {
    const frozen = captured.plan.behaviors.sources.find(row => row.objectId === saved.id); assert.ok(frozen);
    assert.equal(frozen.content, saved.content); assert.equal(frozen.sourceRevision, saved.version);
  }
  assert.equal(captured.plan.animation.document.clips[0].id, clipId);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), after);
  return { ...f, clipId, idleId, assemblyId, after };
}

for (const documents of ['documents', 'design-data']) test(`saved state table → reopen → edit event → BOM/CRLF draft → same-file Save → bind and freeze (${documents})`, async t => {
  await reeditStateAnimation(t, documents);
});

test('re-edited and saved controller executes the updated event → attack → completion idle in actual Godot', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for completion animation authoring integration',
}, async t => {
  const f = await reeditStateAnimation(t), output = path.join(f.directory, 'completion-build'), tool = process.env.VIENTO_GODOT_BIN;
  const built = await buildProject({ root: f.root, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics || ran));
  const commands = ran.record.events.filter(row => row.event === 'animation-command');
  assert.deepEqual(commands.map(row => row.command.action), ['select', 'play', 'select', 'play', 'select', 'play']);
  assert.ok(commands.every(row => row.bindingId === id(1)));
  assert.ok(commands.slice(0,2).every(row => row.state.clipId === f.idleId));
  assert.ok(commands.slice(2,4).every(row => row.state.clipId === f.clipId));
  assert.ok(commands.slice(4).every(row => row.state.clipId === f.idleId));
  const completions = ran.record.events.filter(row => row.event === 'animation-completed');
  assert.equal(completions.length, 1); assert.equal(completions[0].state.clipId, f.clipId);
  assert.equal(completions[0].state.positionSeconds, .25);
  assert.equal(completions[0].commandSequence, 4);
  const completed = ran.record.events.filter(row => row.event === 'animation-completion-delivery');
  assert.equal(completed.length, 1); assert.equal(completed[0].status, 'handled');
  assert.equal(commands[0].command.clipId, f.idleId); assert.equal(commands[0].state.positionSeconds, 0);
  const deliveries = ran.record.events.filter(row => row.event === 'event-delivery');
  assert.equal(deliveries.length, 2, 'controller and the ordinary publisher each subscribe to checkpoint'); assert.ok(deliveries.every(row => row.status === 'handled'));
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), f.after);
});
