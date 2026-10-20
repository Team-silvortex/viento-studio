import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, request } from './helpers.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { spriteAnimationFixture, sceneId, animationPath } from './helpers/scene-animation-sprite-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const id = n => `54545454-5454-4545-8545-${String(n).padStart(12, '0')}`;

for (const starterId of ['godot-project-animation', 'godot-project-animation-clip']) for (const documents of ['documents', 'design-data']) test(`${starterId}: review → ordinary TXT save → first behavior → frozen animation with ${documents}`, async t => {
  const f = await spriteAnimationFixture(t), named = starterId.endsWith('-clip'), clipId = id(50);
  if (named) await f.edit(animationPath, value => { value.schemaVersion = 3; value.clips = [{ id: clipId, name: 'Attack', startSeconds: .5, endSeconds: 1.5, loop: false }]; });
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.root, 'templates'), path.join(f.root, 'data-template'));
    await fs.rename(path.join(f.root, 'documents'), path.join(f.root, documents));
    for (const name of await fs.readdir(path.join(f.root, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => { value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/'); });
  }
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root });
  const catalogue = async () => { const response = await request(base, '/api/scene-behavior-creation', { sceneObjectId: sceneId }); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const before = await fingerprint(f.root, { authorOnly: true }), empty = await catalogue();
  assert.deepEqual(empty.sources, []); assert.equal(empty.documentTypes.some(type => type.id === 'script'), false);
  const context = { sourceToken: 'editor:fresh-scene', documentRoot: empty.documentRoot, documentTypes: empty.documentTypes };
  const sourcePath = `${documents}/scripts/动画 command.txt`, starter = listScriptStarters().find(item => item.id === starterId);
  const proposal = prepareScriptDraft(context, { starterId: starter.id, documentType: 'character', sourcePath });
  assert.equal(proposal.content, starter.content);
  const draft = prepareScriptDraftApply(context, proposal);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before, 'review and normal draft handoff do not write');
  const saved = await request(base, '/api/doc', { path: draft.sourcePath, content: draft.content, documentType: draft.documentType, create: true });
  assert.equal(saved.status, 200, JSON.stringify(saved)); assert.equal(await f.read(sourcePath), starter.content);
  const registration = (await readRegistry(f.root)).documents.find(item => item.sourcePath === sourcePath);
  assert.ok(registration); assert.equal(registration.documentType, 'character'); assert.deepEqual(registration.relations, []);
  const afterSave = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterSave).filter(name => afterSave[name] !== before[name]).sort(), [sourcePath, `metadata/documents/${registration.id}.json`].sort());
  for (const [name, hash] of Object.entries(before)) assert.equal(afterSave[name], hash, name);
  const catalog = await catalogue(); assert.equal(catalog.sources.length, 1); assert.equal(catalog.sources[0].objectId, registration.id);
  const creation = createSceneBehaviorCreationDraft({ sceneObjectId: sceneId, backendId: 'org.viento.godot4', language: 'gdscript',
    bindings: [{ bindingId: id(1), instanceId: catalog.scene.instances[0].instanceId, sourceObjectId: registration.id }] });
  assert.equal(creation.ok, true, JSON.stringify(creation));
  const parameters = named ? { clip_id: clipId } : { command: 'seek', time_seconds: 1.25 };
  const body = JSON.parse(creation.content); body.bindings[0].parameters = parameters;
  const content = JSON.stringify(body, null, 2) + '\n', behaviorPath = `${documents}/behaviors/animation-control.json`;
  const command = { command: 'behavior.create', mode: 'preview', worldId: catalog.worldId, baseRevision: catalog.baseRevision,
    actorRef: { kind: 'user', id: 'animation-starter-workflow' }, objectId: id(2), documentType: 'character', sourcePath: behaviorPath,
    content, sceneObjectId: sceneId, sceneObjectRevision: catalog.scene.objectRevision, sceneSourceRevision: catalog.scene.sourceRevision };
  const preview = await request(base, '/api/world/commands', command); assert.equal(preview.status, 200, JSON.stringify(preview));
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterSave);
  const applied = await request(base, '/api/world/commands', { ...command, mode: 'apply' }); assert.equal(applied.status, 200, JSON.stringify(applied));
  const afterBehavior = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterBehavior).filter(name => afterBehavior[name] !== afterSave[name]).sort(), [behaviorPath, `metadata/documents/${id(2)}.json`, `metadata/documents/${sceneId}.json`].sort());
  const captured = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.behaviors.sources[0].content, starter.content); assert.equal(captured.plan.behaviors.sources[0].sourceRevision, saved.data.version);
  assert.deepEqual(captured.plan.behaviors.bindings[0].parameters, parameters);
  assert.equal(captured.plan.animation.document.schemaVersion, named ? 3 : 2);
  if (named) assert.equal(captured.plan.animation.document.clips[0].id, clipId); assert.ok(captured.plan.animation.document.tracks.some(track => track.property === 'spriteFrame2d'));
  assert.equal(afterBehavior[animationPath.replace(/^documents\//, documents + '/')], before[animationPath.replace(/^documents\//, documents + '/')]);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterBehavior, 'snapshot capture remains read-only');
});
