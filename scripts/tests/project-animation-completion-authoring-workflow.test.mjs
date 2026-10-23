import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serve, request } from './helpers.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
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

async function authorCompletionAnimation(t, documents = 'documents') {
  const f = await spriteAnimationFixture(t), clipId = id(50), idleId = id(51), assemblyId = id(60);
  await f.edit(animationPath, value => { value.schemaVersion = 3; value.clips = [{ id: clipId, name: '攻撃 / Strike', startSeconds: .5, endSeconds: .75, loop: false }, { id: idleId, name: '待機 / Idle', startSeconds: .75, endSeconds: 1.5, loop: true }]; });
  await f.edit('workspace.json', value => { value.documentTypes.push({ id: 'assembly', label: 'Assembly', directory: 'projects', parserProfile: 'structured', template: 'assembly.json' }); });
  const assembly = { format: 'viento-project-assembly', schemaVersion: 1, title: 'Completion workflow', entrySceneId: sceneId, sceneIds: [sceneId] };
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
  const context = { sourceToken: 'completion-animation-workflow', documentRoot: empty.documentRoot, documentTypes: empty.documentTypes };
  const sources = [];
  for (const [index, starterId] of ['godot-project-animation-event', 'godot-project-animation-completion', 'godot-project-events'].entries()) {
    const before = await fingerprint(f.root, { authorOnly: true });
    const sourcePath = `${documents}/scripts/${['事件动画', '完成衔接', 'publisher'][index]}.txt`, starter = listScriptStarters().find(row => row.id === starterId);
    const proposal = prepareScriptDraft(context, { starterId, documentType: 'character', sourcePath });
    const draft = prepareScriptDraftApply(context, proposal); assert.equal(draft.content, starter.content);
    assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before, 'starter review is read-only');
    const saved = await call('/api/doc', { path: sourcePath, content: draft.content, documentType: draft.documentType, create: true });
    const record = (await readRegistry(f.root)).documents.find(row => row.sourcePath === sourcePath); assert.ok(record);
    assert.equal(await f.read(sourcePath), starter.content); assert.deepEqual(record.relations, []);
    const after = await fingerprint(f.root, { authorOnly: true });
    assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(), [sourcePath, `metadata/documents/${record.id}.json`].sort());
    for (const [name, bytes] of Object.entries(before)) assert.equal(after[name], bytes, name);
    sources.push({ ...record, content: starter.content, version: saved.version });
  }
  const available = await catalog(); assert.equal(available.sources.length, 3);
  const creation = createSceneBehaviorCreationDraft({ sceneObjectId: sceneId, backendId: 'org.viento.godot4', language: 'gdscript',
    bindings: sources.map((source, i) => ({ bindingId: id(i + 1), instanceId: available.scene.instances[0].instanceId, sourceObjectId: source.id })) });
  assert.equal(creation.ok, true, JSON.stringify(creation));
  const model = JSON.parse(creation.content); model.bindings[0].parameters = { event_name: 'checkpoint', clip_id: '' };
  model.bindings[1].parameters = { finished_clip_id: '', next_clip_id: '' };
  const content = '\ufeff' + json(model).replaceAll('\n', '\r\n'), sourcePath = `${documents}/behaviors/completion-animation.json`;
  const command = { command: 'behavior.create', mode: 'preview', worldId: available.worldId, baseRevision: available.baseRevision,
    actorRef: { kind: 'user', id: 'completion-animation-workflow' }, objectId: id(4), documentType: 'character', sourcePath, content,
    sceneObjectId: sceneId, sceneObjectRevision: available.scene.objectRevision, sceneSourceRevision: available.scene.sourceRevision };
  const beforeBehavior = await fingerprint(f.root, { authorOnly: true });
  await call('/api/world/commands', command); assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), beforeBehavior);
  await call('/api/world/commands', { ...command, mode: 'apply' });
  const afterBehavior = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterBehavior).filter(name => afterBehavior[name] !== beforeBehavior[name]).sort(), [sourcePath, `metadata/documents/${id(4)}.json`, `metadata/documents/${sceneId}.json`].sort());
  const read = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'completion-animation-parameter-review', content, baseline: content, version: read.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, animationClipsAvailable: true };
  let draftWrites = 0;
  const host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspect: value => call('/api/scene-behavior-authoring', value), inspectAnimationDirectory: value => call('/api/scene-animation-directory', value),
    writeDraft: value => { state.content = value; draftWrites++; } });
  const source = await host.getSource(), directory = await host.getAnimationClips(source);
  const selected = directory.clips.find(row => row.name === '攻撃 / Strike'); assert.equal(selected.clipId, clipId);
  model.bindings[0].parameters.clip_id = sceneBehaviorAnimationClipValue(directory, selected.clipId);
  model.bindings[1].parameters.finished_clip_id = sceneBehaviorAnimationClipValue(directory, selected.clipId);
  const next = directory.clips.find(row => row.name === '待機 / Idle'); assert.equal(next.clipId, idleId);
  model.bindings[1].parameters.next_clip_id = sceneBehaviorAnimationClipValue(directory, next.clipId);
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
  assert.deepEqual(captured.plan.behaviors.bindings.find(row => row.bindingId === id(1)).parameters, { event_name: 'checkpoint', clip_id: clipId });
  assert.deepEqual(captured.plan.behaviors.bindings.find(row => row.bindingId === id(2)).parameters, { finished_clip_id: clipId, next_clip_id: idleId });
  for (const saved of sources) {
    const frozen = captured.plan.behaviors.sources.find(row => row.objectId === saved.id); assert.ok(frozen);
    assert.equal(frozen.content, saved.content); assert.equal(frozen.sourceRevision, saved.version);
  }
  assert.equal(captured.plan.animation.document.clips[0].id, clipId);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), after);
  return { ...f, clipId, idleId, assemblyId, after };
}

for (const documents of ['documents', 'design-data']) test(`event/completion starters → ordinary TXT Save → three bindings → two named parameters → reviewed Save (${documents})`, async t => {
  await authorCompletionAnimation(t, documents);
});

test('saved starters execute attack → natural completion → idle in actual Godot', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for completion animation authoring integration',
}, async t => {
  const f = await authorCompletionAnimation(t), output = path.join(f.directory, 'completion-build'), tool = process.env.VIENTO_GODOT_BIN;
  const built = await buildProject({ root: f.root, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics || ran));
  const commands = ran.record.events.filter(row => row.event === 'animation-command');
  assert.deepEqual(commands.map(row => row.command.action), ['select', 'play', 'select', 'play']);
  assert.ok(commands.slice(0,2).every(row => row.state.clipId === f.clipId && row.bindingId === id(1)));
  assert.ok(commands.slice(2).every(row => row.state.clipId === f.idleId && row.bindingId === id(2)));
  const completions = ran.record.events.filter(row => row.event === 'animation-completed');
  assert.equal(completions.length, 1); assert.equal(completions[0].state.clipId, f.clipId);
  assert.equal(completions[0].state.positionSeconds, .25);
  assert.equal(completions[0].commandSequence, 2);
  const completed = ran.record.events.filter(row => row.event === 'animation-completion-delivery');
  assert.equal(completed.length, 1); assert.equal(completed[0].status, 'handled');
  assert.equal(commands[0].command.clipId, f.clipId); assert.equal(commands[0].state.positionSeconds, 0);
  const deliveries = ran.record.events.filter(row => row.event === 'event-delivery');
  assert.equal(deliveries.length, 2); assert.ok(deliveries.every(row => row.status === 'handled'));
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), f.after);
});
