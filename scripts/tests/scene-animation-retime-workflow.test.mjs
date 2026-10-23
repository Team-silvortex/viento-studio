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
import { retimeSceneAnimationDraft, createSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { sampleSceneAnimation, sampleSceneAnimationClip } from '../../engine/scene-animation-core.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const parse = value => JSON.parse(value.replace(/^\ufeff/, ''));
const fields = d => ({ durationSeconds: d.durationSeconds, loop: d.loop, tracks: d.tracks, clips: d.clips });

async function retimeAndSave(t, documents = 'documents', probe = false) {
  const f = await projectAnimationClipsAuthor(t);
  await f.script('checkpoint', probe ? `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.seek_animation(0.125)
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tprint("RETIME_VISUAL:" + JSON.stringify([scene.project_animation_position, scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x, scene.animation_sprites["${f.instanceId}"].frame, scene.project_animation_phase]))
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
` : 'extends Node\n');
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => { value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/'); });
  }
  const sourcePath = `${documents}/animations/scene-0.json`, file = path.join(f.author, sourcePath);
  const original = '\ufeff' + (await fs.readFile(file, 'utf8')).replaceAll('\n', '\r\n'); await fs.writeFile(file, original);
  const before = await fingerprint(f.author, { authorOnly: true });
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author });
  const call = async (route, payload) => { const response = await request(base, route, payload); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const read = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'retime-workflow', content: original, baseline: original, version: read.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, targetsAvailable: true };
  const writes = [];
  const host = createSceneAnimationSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspectTargets: value => call('/api/scene-animation-targets', value), writeDraft: value => { state.content = value; writes.push(value); } });
  const source = await host.getSource(), targets = await host.getTargets(source), current = parse(original);
  // This edit is still local when timing changes: the operation must not revert
  // author values to the previously saved file.
  current.tracks[0].keyframes.at(-1).value[0] = 200;
  const result = await retimeSceneAnimationDraft(original, fields(current), .5);
  assert.equal(result.durationSeconds, .5); assert.equal(result.schemaVersion, 3);
  assert.deepEqual(result.clips.map(c => [c.startSeconds,c.endSeconds]), [[.125,.375],[.25,.5]]);
  assert.deepEqual(result.tracks.map(track => track.keyframes.map(key => key.atSeconds)), [[0,.5],[0,.125,.25]]);
  assert.equal(writes.length, 0); assert.equal(state.content, original);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before, 'retime is not a source or file write');
  const proposal = await createSceneAnimationProposal(source, fields(result));
  assert.ok(proposal.changedPaths.includes('/tracks/0/keyframes/1/value'));
  assert.ok(proposal.changedPaths.includes('/clips/1/startSeconds'));
  await host.applyDraft(proposal, { targets }); assert.equal(writes.length, 1);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before, 'Apply only writes ordinary editor memory');
  assert.ok(state.content.startsWith('\ufeff')); assert.equal(state.content.replaceAll('\r\n', '').includes('\n'), false);
  const saved = await call('/api/doc', { path: sourcePath, content: state.content, expectedVersion: read.version });
  assert.equal(saved.version, 'sha256:' + hash(state.content)); assert.equal(await fs.readFile(file, 'utf8'), state.content);
  const after = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]), [sourcePath]);
  const captured = await captureBuildSnapshot(f.author, f.sceneIds[0]); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.animation.document, result);
  for (const time of [0,.125,.25,.375,.5,.75]) {
    assert.deepEqual(sampleSceneAnimation(result,time).values, sampleSceneAnimation(current,time * 2).values);
    assert.deepEqual(sampleSceneAnimationClip(result,f.clipIds[0][1],time).values, sampleSceneAnimationClip(current,f.clipIds[0][1],time * 2).values);
  }
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), after);
  return { ...f, result, after };
}

for (const documents of ['documents','design-data']) test(`current form retime → reviewed source → ordinary Save → frozen plan and Rust samples (${documents})`, async t => {
  await retimeAndSave(t, documents);
});

test('actual Godot uses saved retimed keyframes and clip bounds without changing its runtime protocol', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for actual retimed animation integration',
}, async t => {
  const f = await retimeAndSave(t, 'documents', true), tool = process.env.VIENTO_GODOT_BIN, output = path.join(f.temporary, 'retime-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: false });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics || ran)); assert.equal(ran.record.events[0].protocol, 7);
  const commands = ran.record.events.filter(row => row.event === 'animation-command');
  assert.deepEqual(commands.map(row => [row.command.action,row.state.clipId,row.state.positionSeconds]), [['select',f.clipIds[0][1],0],['seek',f.clipIds[0][1],.125]]);
  const observed = ran.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith('RETIME_VISUAL:')).map(line => JSON.parse(line.slice('RETIME_VISUAL:'.length)));
  assert.deepEqual(observed, [[.125,.375,150,3,'paused']]);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), f.after);
});
