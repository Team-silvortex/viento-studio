import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve, request } from './helpers.mjs';
import { projectAnimationPreflightFixture, preflightBehaviorId } from './helpers/project-animation-preflight-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const godot = process.env.VIENTO_GODOT_BIN;
const missingCode = 'build_animation_state_clip_missing';
const read = (f, name) => fs.readFile(path.join(f.author, name), 'utf8');
const pointer = '/bindings/1/parameters/clip_attack';
function assertIssue(result, f, code, at = pointer, expectedText = f.behaviorText) {
  assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
  assert.equal(result.snapshotId, undefined, 'a rejected author review cannot produce a frozen snapshot identity');
  const issue = result.diagnostics.find(row => row.code === code); assert.ok(issue, JSON.stringify(result.diagnostics));
  assert.equal(issue.objectId, preflightBehaviorId); assert.equal(issue.sourcePath, f.behaviorPath); assert.equal(issue.propertyPath, at);
  assert.equal(issue.bindingId, f.bindingId); assert.equal(issue.instanceId, f.instanceId);
  const expected = locateJsonSource(parseJsonSource(expectedText), at); assert.ok(expected);
  assert.deepEqual(issue.sourceRange, expected, 'source range retains exact BOM, CRLF and UTF-16 offsets');
  return issue;
}
async function host(t, f) {
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author, VIENTO_GODOT_BIN: godot || process.execPath,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(f.temporary, 'cache'), XDG_CONFIG_HOME: path.join(f.temporary, 'config') });
  const api = async (route, payload) => { const result = await request(base, route, payload); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  const job = async action => {
    const accepted = await api('/api/project-build', { action, targetId: f.assemblyId });
    for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
      const state = await api('/api/project-build');
      if (state.job?.id === accepted.job.id && state.job.status !== 'running') return state.job;
      await delay(20);
    }
    throw Error('Author preflight job did not settle');
  };
  return { api, job };
}
async function saveRepair(h, f) {
  const before = await fingerprint(f.author, { authorOnly: true });
  const saved = await h.api('/api/doc?path=' + encodeURIComponent(f.behaviorPath));
  const text = await read(f, f.behaviorPath), content = text.replace(JSON.stringify(f.missingClip), JSON.stringify(f.goodClip));
  assert.notEqual(content, text); assert.ok(content.startsWith('\ufeff')); assert.ok(content.includes('\r\n'));
  await h.api('/api/doc', { path: f.behaviorPath, content, expectedVersion: saved.version });
  const after = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => before[name] !== after[name]), [f.behaviorPath]);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.equal(await read(f, f.behaviorPath), content);
  return after;
}

for (const documents of ['documents', 'design-data']) test(`author preflight: missing noninitial clip stays scene-local, HTTP/CLI reject, ordinary Save repairs (${documents})`, async t => {
  const f = await projectAnimationPreflightFixture(t, { documents }), before = await fingerprint(f.author, { authorOnly: true });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId), issue = assertIssue(captured, f, missingCode);
  assert.equal(f.behaviorText.slice(issue.sourceRange.start, issue.sourceRange.end), JSON.stringify(f.missingClip));
  assert.ok((await f.read(`${documents}/animations/scene-1.json`)).clips.some(clip => clip.id === f.missingClip), 'matching UUID in another scene cannot satisfy this controller');
  const cli = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId]);
  assert.deepEqual(cli.diagnostics, captured.diagnostics); assert.equal(cli.ok, false); assert.equal(cli.snapshotId, undefined);
  const h = await host(t, f), planned = await h.job('plan');
  assert.equal(planned.status, 'failed'); assert.deepEqual(planned.diagnostics, captured.diagnostics);
  const rejectedBuild = await h.job('build'); assert.equal(rejectedBuild.status, 'failed');
  assert.deepEqual(rejectedBuild.diagnostics, captured.diagnostics); assert.equal(rejectedBuild.phase, 'completed');
  assert.equal((await h.api('/api/project-build')).toolStatus.status, 'unchecked', 'preflight failure must not inspect the configured executable');
  await assert.rejects(fs.stat(path.join(f.temporary, 'cache/io.viento.studio/builds')), { code: 'ENOENT' });
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before, 'failed review and API checks preserve every author byte');
  const repaired = await saveRepair(h, f), fixed = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(fixed.ok, true, JSON.stringify(fixed.diagnostics)); assert.match(fixed.snapshotId, /^sha256:/);
  assert.equal((await h.job('plan')).status, 'succeeded');
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), repaired);
});

test('author preflight rejects invalid parameter value before backend resolution, tool inspection or output creation', async t => {
  const f = await projectAnimationPreflightFixture(t, { valid: true });
  const content = f.behaviorText.replace(JSON.stringify(f.goodClip), '42'); await f.write(f.behaviorPath, content);
  const before = await fingerprint(f.author, { authorOnly: true }), phases = [], output = path.join(f.temporary, 'never-created'); let resolves = 0;
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, tool: '/must-not-be-opened', output,
    backendRegistry: { resolve() { resolves++; throw Error('Backend must not be consulted for invalid author inputs'); } }, onProgress: item => phases.push(item.phase) });
  assertIssue(result, f, 'build_animation_state_parameters_invalid', pointer, content);
  assert.equal(result.status, 'rejected'); assert.equal(resolves, 0); assert.deepEqual(phases, ['snapshot']);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' }); assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before);
  const cli = await runProjectBuildCommand(['--command', 'build', '--root', f.author, '--target', f.assemblyId, '--tool', '/must-not-be-opened', '--output', output]);
  assert.equal(cli.ok, false); assert.equal(cli.diagnostics[0].code, 'build_animation_state_parameters_invalid');
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('author preflight rejects controller without scene animation even when every state uses whole-animation defaults', async t => {
  const f = await projectAnimationPreflightFixture(t, { valid: true });
  const behavior = JSON.parse(f.behaviorText.slice(1)); behavior.bindings[1].parameters = {}; await f.write(f.behaviorPath, behavior);
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, record => { record.relations = record.relations.filter(row => row.kind !== 'animation'); });
  const before = await fingerprint(f.author, { authorOnly: true }), result = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(issue => issue.code === 'build_animation_state_animation_missing'), JSON.stringify(result.diagnostics));
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before);
});

test('author preflight rejects missing instance tracks at its binding and does not borrow tracks from another scene', async t => {
  const f = await projectAnimationPreflightFixture(t, { valid: true });
  await f.edit(f.animationPath, animation => { animation.schemaVersion = 4; animation.playbackScope = 'instance';
    animation.tracks.forEach(track => { track.instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'; }); });
  const before = await fingerprint(f.author, { authorOnly: true }), result = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(result.ok, false); const issue = result.diagnostics.find(row => row.code === 'build_animation_state_target_missing'); assert.ok(issue, JSON.stringify(result.diagnostics));
  assert.equal(issue.objectId, preflightBehaviorId); assert.equal(issue.sourcePath, f.behaviorPath); assert.equal(issue.bindingId, f.bindingId);
  assert.ok(issue.sourceRange); assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), before);
});

test('repaired ordinary Save builds and runs a strict controller with actual Godot; fresh checks preserve frozen runtime protocol', {
  skip: !godot && 'Set VIENTO_GODOT_BIN for actual Godot preflight recovery', timeout: 120000,
}, async t => {
  const f = await projectAnimationPreflightFixture(t, { documents: 'design-data' }), h = await host(t, f);
  assert.equal((await captureBuildSnapshot(f.author, f.assemblyId)).ok, false);
  const after = await saveRepair(h, f), output = path.join(f.temporary, 'godot-recovered');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool: godot, output });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool: godot, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics || ran.diagnostics));
  const commands = ran.record.events.filter(row => row.event === 'animation-command');
  assert.deepEqual(commands.map(row => row.command.action), ['select', 'play']);
  assert.ok(commands.every(row => row.state.clipId === f.clipIds[0][0]));
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), after);
});
