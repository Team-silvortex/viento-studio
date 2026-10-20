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
import { createSceneAnimationSourceHost } from '../../web/modules/app-scene-animation-source.js';
import { createSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { sceneAnimationUsageSource } from '../../engine/scene-animation-usage.mjs';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const parse = value => JSON.parse(value.replace(/^\ufeff/, ''));

async function fixture(t, documents = 'documents') {
  const f = await projectAnimationClipsAuthor(t);
  await f.edit('documents/behaviors/demo.json', value => {
    value.bindings[0].parameters = { chosen_clip: f.clipIds[0][1], same_clip: f.clipIds[0][1], note: `中文🙂 ${f.clipIds[0][1]} in text`, amount: 1 };
  });
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => {
      value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/');
    });
  }
  const sourcePath = `${documents}/animations/scene-0.json`, file = path.join(f.author, sourcePath);
  const behaviorPath = `${documents}/behaviors/demo.json`, behaviorFile = path.join(f.author, behaviorPath);
  for (const file of [path.join(f.author, sourcePath), behaviorFile]) await fs.writeFile(file, '\ufeff' + (await fs.readFile(file, 'utf8')).replaceAll('\n', '\r\n'));
  const original = await fs.readFile(file, 'utf8'), behaviorContent = await fs.readFile(behaviorFile, 'utf8');
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author });
  const call = async (route, value) => { const response = await request(base, route, value); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const read = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'animation-usage-workflow', content: original, baseline: original, version: read.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, usageAvailable: true };
  const writes = [];
  const host = createSceneAnimationSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspectUsage: value => call('/api/scene-animation-usage', value), writeDraft: value => { writes.push(value); state.content = value; } });
  const save = async edit => {
    const source = await host.getSource(), proposal = await createSceneAnimationProposal(source, edit);
    await host.applyDraft(proposal);
    const saved = await call('/api/doc', { path: sourcePath, content: state.content, expectedVersion: state.version });
    state.baseline = state.content; state.version = saved.version; return proposal;
  };
  return { ...f, sourcePath, behaviorPath, file, behaviorFile, original, behaviorContent, host, state, call, writes, save };
}

for (const directory of ['documents', 'design-data']) test(`clip usage → exact saved behavior source → rename and ordinary Save keeps the ID and matching parameters (${directory})`, async t => {
  const f = await fixture(t, directory), before = await fingerprint(f.author, { authorOnly: true });
  const source = await f.host.getSource(), usage = await f.host.getUsage(source), selected = f.clipIds[0][1];
  const matches = usage.matches.filter(row => row.clipId === selected);
  assert.equal(matches.length, 2); assert.deepEqual(matches.map(row => row.parameterName), ['chosen_clip', 'same_clip']);
  assert.equal(usage.scene.objectId, f.sceneIds[0]); assert.equal(usage.animation.sourcePath, f.sourcePath);
  const ranges = [];
  for (const match of matches) {
    const location = sceneAnimationUsageSource(usage, match);
    assert.equal(location.content, f.behaviorContent); assert.equal(location.sourcePath, f.behaviorPath);
    const selection = sourceLocationSelection(location.content, location, location.sourceRevision); assert.equal(selection.status, 'exact');
    assert.equal(JSON.parse(location.content.replaceAll('\r\n', '\n').slice(selection.start, selection.end)), selected);
    ranges.push(selection.start);
  }
  assert.equal(new Set(ranges).size, 2, 'repeated IDs select their own parameter tokens');
  assert.deepEqual(f.writes, []); assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before);
  const model = parse(f.original); model.clips[1].name = '改名 / Renamed / 改名済み';
  const proposal = await f.save({ durationSeconds: model.durationSeconds, loop: model.loop, tracks: model.tracks, clips: model.clips });
  assert.deepEqual(proposal.changedPaths, ['/clips/1/name']);
  assert.ok(f.state.content.startsWith('\ufeff')); assert.equal(f.state.content.replaceAll('\r\n', '').includes('\n'), false);
  const refreshed = await f.host.getUsage(await f.host.getSource());
  assert.deepEqual(refreshed.matches, usage.matches); assert.equal(parse(refreshed.savedContent).clips[1].name, model.clips[1].name);
  const afterRename = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(afterRename).filter(name => before[name] !== afterRename[name]), [f.sourcePath]);
  // Inspection grants no removal/write authority and does not make plain strings
  // protected references. The existing ordinary edit can still remove the clip.
  model.clips.splice(1, 1);
  await f.save({ durationSeconds: model.durationSeconds, loop: model.loop, tracks: model.tracks, clips: model.clips });
  assert.equal(await fs.readFile(f.behaviorFile, 'utf8'), f.behaviorContent);
  const afterRemoval = await f.host.getUsage(await f.host.getSource());
  assert.equal(parse(afterRemoval.savedContent).clips.some(row => row.id === selected), false);
  assert.equal(afterRemoval.matches.filter(row => row.clipId === selected).length, 2, 'literal matches remain visible to the contract; deletion did not migrate parameters');
  const after = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => before[name] !== after[name]), [f.sourcePath]);
});

test('an observed usage source stays an exact saved snapshot until explicit refresh reads externally edited behavior', async t => {
  const f = await fixture(t), source = await f.host.getSource(), old = await f.host.getUsage(source), match = old.matches[0];
  const first = sceneAnimationUsageSource(old, match);
  const changed = f.behaviorContent.replaceAll(f.clipIds[0][1], f.clipIds[0][0]);
  await fs.writeFile(f.behaviorFile, changed);
  assert.deepEqual(sceneAnimationUsageSource(old, match), first);
  const fresh = await f.host.getUsage(source);
  assert.notEqual(fresh.behavior.sourceRevision, old.behavior.sourceRevision);
  assert.ok(fresh.matches.every(row => row.clipId === f.clipIds[0][0]));
  assert.equal(sceneAnimationUsageSource(fresh, fresh.matches[0]).content, changed);
  assert.throws(() => sceneAnimationUsageSource(fresh, match), { errorCode: 'scene_animation_usage_invalid' });
  assert.deepEqual(f.writes, []); assert.equal(await fs.readFile(f.file, 'utf8'), f.original);
});
