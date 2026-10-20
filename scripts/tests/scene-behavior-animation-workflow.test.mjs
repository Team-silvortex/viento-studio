import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serve, request } from './helpers.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { sceneBehaviorAnimationClipValue } from '../../engine/scene-animation-directory.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

async function selectAndSave(t, documents = 'documents') {
  const f = await projectAnimationClipsAuthor(t);
  await f.script('checkpoint', listScriptStarters().find(row => row.id === 'godot-project-animation-clip').content);
  await f.edit('documents/behaviors/demo.json', value => { value.bindings[0].parameters = { clip_id: '' }; });
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => {
      value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/');
    });
  }
  const sourcePath = `${documents}/behaviors/demo.json`, file = path.join(f.author, sourcePath);
  const original = '\ufeff' + (await fs.readFile(file, 'utf8')).replaceAll('\n', '\r\n');
  await fs.writeFile(file, original);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author });
  const call = async (route, payload) => { const result = await request(base, route, payload); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  const read = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'animation-picker-workflow', content: original, baseline: original, version: read.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, animationClipsAvailable: true };
  let writes = 0;
  const host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspect: value => call('/api/scene-behavior-authoring', value), inspectAnimationDirectory: value => call('/api/scene-animation-directory', value),
    writeDraft: content => { writes++; state.content = content; } });
  const before = await fingerprint(f.author, { authorOnly: true }), source = await host.getSource(); assert.ok(source);
  const catalog = await host.getAnimationClips(source);
  assert.equal(catalog.clips.length, 2); assert.equal(catalog.scene.objectId, f.sceneIds[0]);
  const selected = catalog.clips.find(row => row.name === '攻撃 / Strike'); assert.ok(selected);
  assert.equal(selected.clipId, f.clipIds[0][1]);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before, 'reading and selecting do not write author data');
  const model = JSON.parse(original.replace(/^\ufeff/, '')); model.bindings[0].parameters.clip_id = sceneBehaviorAnimationClipValue(catalog, selected.clipId);
  const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });
  const review = await call('/api/scene-behavior-authoring', { sourcePath, content: original });
  await host.applyDraft(proposal, { dependencyRevision: review.dependencyRevision });
  assert.equal(writes, 1); assert.equal(await fs.readFile(file, 'utf8'), original, 'apply is only an in-memory draft');
  assert.ok(state.content.startsWith('\ufeff')); assert.equal(state.content.replaceAll('\r\n', '').includes('\n'), false);
  const saved = await call('/api/doc', { path: sourcePath, content: state.content, expectedVersion: read.version });
  assert.equal(saved.version, 'sha256:' + hash(state.content)); assert.equal(await fs.readFile(file, 'utf8'), state.content);
  const after = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => before[name] !== after[name]), [sourcePath]);
  const captured = await captureBuildSnapshot(f.author, f.sceneIds[0]); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.behaviors.bindings[0].parameters.clip_id, selected.clipId);
  assert.equal(captured.plan.animation.document.clips[1].id, selected.clipId);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), after);
  return { ...f, selected, sourcePath, after };
}

for (const directory of ['documents', 'design-data']) test(`saved clip directory → explicit parameter → reviewed draft → ordinary Save → frozen plan (${directory})`, async t => {
  await selectAndSave(t, directory);
});

test('actual Godot receives the selected saved clip UUID through the ordinary behavior parameter workflow', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for actual animation picker integration',
}, async t => {
  const f = await selectAndSave(t), output = path.join(f.temporary, 'picker-build'), tool = process.env.VIENTO_GODOT_BIN;
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics || ran));
  const commands = ran.record.events.filter(row => row.event === 'animation-command');
  assert.deepEqual(commands.map(row => row.command.action), ['select', 'play']);
  assert.ok(commands.every(row => row.state.clipId === f.selected.clipId));
  assert.equal(commands[0].command.clipId, f.selected.clipId); assert.equal(commands[0].state.positionSeconds, 0);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), f.after);
});
