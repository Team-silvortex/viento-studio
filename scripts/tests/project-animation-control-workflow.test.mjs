import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectAnimationControlAuthor } from './helpers/project-animation-control-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
async function settled(service) {
  for (let i = 0; i < 3000; i++) { const value = await service.status(); if (value.job?.status !== 'running') return value; await delay(20); }
  assert.fail('Animation control job did not finish');
}
async function hashes(root) {
  const out = {};
  for (const e of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (e.isFile()) {
    const file = path.join(e.parentPath, e.name), name = path.relative(root, file);
    if (!name.startsWith('.viento/')) out[name] = buildHash(await fs.readFile(file));
  }
  return out;
}
test('actual project animation service freezes receipts, queries both origins, resets run state and restores author-offline artifacts', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for real animation service',
}, async t => {
  const f = await projectAnimationControlAuthor(t);
  await f.script('checkpoint', `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.pause_animation()
\tp.seek_animation(0.5)
\tp.play_animation()
\tp.stop_animation()
`);
  const options = { tool: process.env.VIENTO_GODOT_BIN, cacheRoot: path.join(f.temporary, 'host-cache') };
  const service = createProjectBuildService(f.author, options); t.after(() => service.close());
  const before = await hashes(f.author);
  await service.command({ action: 'plan', targetId: f.assemblyId }); const planned = await settled(service);
  assert.equal(planned.job.status, 'succeeded', JSON.stringify(planned.job.diagnostics));
  await service.command({ action: 'build', targetId: f.assemblyId, expectedSnapshotId: planned.job.plan.snapshotId }); const built = await settled(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics)); const buildId = built.latestBuild.id;
  await service.command({ action: 'run', buildId, mode: 'headless' }); const ran = await settled(service);
  assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
  const project = ran.job.runtime.project; assert.equal(project.protocolVersion, 5);
  assert.deepEqual(project.animationCommands.entries.map(e => e.command.action), ['pause', 'seek', 'play', 'stop']);
  assert.deepEqual(project.animationCommands.entries.map(e => e.state.positionSeconds), [0, .5, .5, 0]);
  assert.equal(project.animationCommands.entries[0].animation.objectId, f.animationIds[0]);
  assert.notEqual(project.animationCommands.entries[0].origin.source.sourcePath, project.animationCommands.entries[0].animation.source.sourcePath);
  const inspected = await service.command({ action: 'inspect', jobId: ran.job.id, instanceId: f.instanceId }); assert.deepEqual(inspected.project, project);
  assert.deepEqual(await hashes(f.author), before);
  await service.command({ action: 'run', buildId, mode: 'headless' }); const repeated = await settled(service);
  assert.equal(repeated.job.status, 'succeeded', JSON.stringify(repeated.job.diagnostics)); assert.deepEqual(repeated.job.runtime.project, project);
  await assert.rejects(service.command({ action: 'inspect', jobId: ran.job.id }), { errorCode: 'runtime_query_job_missing' });
  await service.close();
  await fs.rename(path.join(f.author, 'documents'), path.join(f.author, 'author-offline'));
  const restored = createProjectBuildService(f.author, options); t.after(() => restored.close());
  await restored.status(); await restored.command({ action: 'select-project', buildId });
  await restored.command({ action: 'run', buildId, mode: 'headless' }); const again = await settled(restored);
  assert.equal(again.job.status, 'succeeded', JSON.stringify(again.job.diagnostics)); assert.deepEqual(again.job.runtime.project, project);
});
