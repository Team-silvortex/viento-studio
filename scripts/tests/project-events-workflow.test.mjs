import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { projectEventsAuthor } from './helpers/project-events-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

async function settled(service) {
  for (let index = 0; index < 3000; index++) {
    const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(20);
  }
  assert.fail('Project-event job did not finish');
}
async function authorHashes(root) {
  const entries = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('.viento/')) entries[relative] = buildHash(await fs.readFile(file));
  }
  return entries;
}

test('project event service freezes sender and receivers, resets each run and restores author-offline execution', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for actual project switching',
}, async t => {
  const f = await projectEventsAuthor(t), [first, second] = f.sceneIds;
  const options = { tool: process.env.VIENTO_GODOT_BIN, cacheRoot: path.join(f.temporary, 'host-cache') };
  const service = createProjectBuildService(f.author, options); t.after(() => service.close());
  const before = await authorHashes(f.author);
  await service.command({ action: 'plan', targetId: f.assemblyId });
  const planned = await settled(service); assert.equal(planned.job.status, 'succeeded', JSON.stringify(planned.job.diagnostics));
  await service.command({ action: 'build', targetId: f.assemblyId, expectedSnapshotId: planned.job.plan.snapshotId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const frozenMembers = structuredClone(built.latestBuild.scenes);
  assert.deepEqual(frozenMembers.map(row => row.sceneId), [first, second]);
  for (const member of frozenMembers) {
    assert.equal(member.planSchemaVersion, 3); assert.equal(member.runtimeProtocolVersion, 3);
    assert.match(member.sourceRevision, /^sha256:[a-f0-9]{64}$/); assert.match(member.sourcePath, /^documents\/scenes\//);
  }
  const buildId = built.latestBuild.id;
  await service.command({ action: 'run', buildId, mode: 'headless' });
  const ran = await settled(service); assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
  assert.equal(ran.job.sceneId, f.assemblyId); assert.equal(ran.job.targetKind, 'project');
  assert.equal(ran.job.runtime.sceneObjectId, first);
  assert.equal(ran.job.runtime.project.assemblyId, f.assemblyId);
  assert.equal(ran.job.runtime.project.activeSceneId, first);
  assert.deepEqual(ran.job.runtime.project.visits.map(row => row.sceneId), [first, second, first]);
  assert.deepEqual(ran.job.runtime.project.visits.map(row => row.index), [1, 2, 3]);
  assert.equal(ran.job.runtime.project.visits.at(-1).phase, 'finished');
  assert.ok(ran.job.runtime.actors.every(actor => actor.positionSample === 'finished'));
  const shared = ran.job.runtime.project.sharedState;
  assert.equal(ran.job.runtime.project.protocolVersion, 4); assert.equal(shared.revision, f.expectedRevision);
  assert.deepEqual(shared.entries.map(({ key, value }) => ({ key, value })), f.expectedEntries);
  const bus = ran.job.runtime.project.events;
  assert.equal(bus.sequence, f.expectedSequence);
  assert.deepEqual(bus.entries.map(entry => entry.name), f.expectedNames);
  assert.deepEqual(bus.entries.map(entry => entry.deliveries.map(delivery => delivery.status)), f.expectedDeliveries);
  const firstPublication = bus.entries[0];
  assert.equal(firstPublication.origin.bindingId, f.publisherBindingId);
  assert.equal(firstPublication.deliveries[0].origin.bindingId, f.receiverBindingId);
  assert.notEqual(firstPublication.origin.source.propertyPath, firstPublication.deliveries[0].origin.source.propertyPath);
  assert.deepEqual(bus.entries.map(entry => entry.origin.visitIndex), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(ran.job.events.filter(event => event.event === 'event-publish').map(event => event.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(ran.job.events.filter(event => event.event === 'event-delivery').length, 7);
  assert.equal(ran.job.events[0].eventSequence, 0); assert.equal(ran.job.events.at(-1).eventSequence, 6);
  assert.equal(ran.job.events[0].stateRevision, 0); assert.equal(ran.job.events.at(-1).stateRevision, 8);

  // The public query path must admit project observations and retain visit
  // ownership when selecting an instance reused in more than one scene.
  const actor = ran.job.runtime.actors[0];
  const inspect = await service.command({ action: 'inspect', jobId: ran.job.id, instanceId: actor.instanceId });
  assert.equal(inspect.jobId, ran.job.id); assert.equal(inspect.buildId, buildId);
  assert.equal(inspect.sceneObjectId, first); assert.deepEqual(inspect.project, ran.job.runtime.project);
  assert.deepEqual(inspect.actors, [actor]);
  assert.deepEqual((await service.command({ action: 'inspect', jobId: ran.job.id, objectId: f.assemblyId })).actors, []);
  await assert.rejects(service.command({ action: 'inspect', jobId: built.job.id }), { errorCode: 'runtime_query_job_missing' });
  assert.deepEqual(await authorHashes(f.author), before);
  const restart = await service.command({ action: 'run', buildId, mode: 'headless' });
  assert.notEqual(restart.job.id, ran.job.id); assert.deepEqual(restart.job.events, []);
  await assert.rejects(service.command({ action: 'inspect', jobId: ran.job.id }), { errorCode: 'runtime_query_job_missing' });
  const repeated = await settled(service); assert.equal(repeated.job.status, 'succeeded', JSON.stringify(repeated.job.diagnostics));
  assert.deepEqual(repeated.job.runtime.project.sharedState, shared);
  assert.deepEqual(repeated.job.runtime.project.events, bus);
  assert.deepEqual(repeated.job.events.filter(event => event.event === 'state'), ran.job.events.filter(event => event.event === 'state'));
  assert.deepEqual(await authorHashes(f.author), before);

  // The current author catalog must never rewrite frozen provenance shown by
  // a completed build, even if a scene's title or actor source later changes.
  const sourcePath = path.join(f.author, frozenMembers[0].sourcePath);
  const changed = JSON.parse(await fs.readFile(sourcePath)); changed.title = 'Edited after build';
  await fs.writeFile(sourcePath, JSON.stringify(changed) + '\n');
  assert.deepEqual((await service.status({ refresh: true })).latestBuild.scenes, frozenMembers);
  await service.close();
  await fs.rename(path.join(f.author, 'documents'), path.join(f.author, 'author-offline'));
  const restored = createProjectBuildService(f.author, options); t.after(() => restored.close());
  await restored.status(); await restored.command({ action: 'select-project', buildId });
  assert.deepEqual((await restored.status()).latestBuild.scenes, frozenMembers);
  await restored.command({ action: 'run', buildId, mode: 'headless' });
  const again = await settled(restored); assert.equal(again.job.status, 'succeeded', JSON.stringify(again.job.diagnostics));
  assert.deepEqual(again.job.runtime.project.visits, ran.job.runtime.project.visits);
  assert.deepEqual(again.job.runtime.actors, ran.job.runtime.actors);
  const restoredView = await restored.command({ action: 'inspect', jobId: again.job.id, instanceId: actor.instanceId });
  assert.deepEqual(restoredView.project, inspect.project); assert.deepEqual(restoredView.actors, inspect.actors);
});
