// Actual local Godot / Bevy tools, disposable author workspaces and owned cache.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const output = path.resolve(process.env.VIENTO_BACKEND_PROJECT_OUTPUT || 'docs/test-results/backend-project-management/real-backends');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose a new empty evidence directory.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-project-smoke-'));
const report = { startedAt: new Date().toISOString(), node: process.version, cases: [], ok: false,
  limitations: ['Actual Linux tool processes and service/CLI only; GUI/browser recorded separately.',
    'No installed Tauri window, Android device, generated-project author editing or ns-nova runtime.'] };
const services = [];
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function tree(directory) {
  const values = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      values[path.relative(directory, file)] = buildHash(await fs.readFile(file));
    }
  }
  return values;
}
async function settle(service) {
  for (let i = 0; i < 1500; i++) { const value = await service.status(); if (value.job.status !== 'running') return value; await delay(50); }
  throw new Error('Build or runtime did not finish.');
}
try {
  for (const [name, example, backendId, tool] of [
    ['godot-image', 'scene2d', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN],
    ['godot-instances', 'bevy-headless', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN],
    ['godot-behaviors', 'scene-behaviors', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN],
    ['bevy-instances', 'bevy-headless', 'org.viento.bevy', process.env.VIENTO_BEVY_BIN],
  ]) {
    assert.ok(tool, `Supply actual tool for ${name}`);
    const root = path.join(temporary, name), cacheRoot = path.join(temporary, `${name}-cache`);
    await fs.cp(new URL(`../../examples/${example}/`, import.meta.url), root, { recursive: true });
    const before = await tree(root), service = createProjectBuildService(root, { tool, backendId, cacheRoot }); services.push(service);
    await service.command({ action: 'build', sceneId });
    const built = await settle(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
    const detail = await service.command({ action: 'inspect-project', buildId: built.latestBuild.id });
    assert.equal(detail.inspection.recorded, true); assert.equal(detail.project.backend.id, backendId);
    assert.equal(detail.inspection.complete, true, 'Only declared, owned files remain after backend import cleanup.');
    assert.equal(detail.project.source.sceneId, sceneId); assert.equal(detail.project.buildId, built.latestBuild.id);
    assert.deepEqual(await tree(root), before);
    await fs.writeFile(path.join(output, `${name}-manifest.json`), JSON.stringify(detail.project, null, 2) + '\n');
    const moved = `${root}-offline`; await fs.rename(root, moved);
    const offline = await service.command({ action: 'inspect-project', buildId: built.latestBuild.id });
    assert.deepEqual(offline.project, detail.project);
    const portable = path.join(temporary, `${name}-moved-build`); await fs.cp(detail.buildDirectory, portable, { recursive: true });
    assert.deepEqual((await inspectBackendProject({ buildDirectory: portable })).project, detail.project);
    await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
    const ran = await settle(service); assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
    const afterRun = await service.command({ action: 'inspect-project', buildId: built.latestBuild.id });
    assert.equal(afterRun.inspection.complete, false); assert.ok(afterRun.inspection.extraPaths.some(item => item.path === 'sessions'));
    const altered = path.join(temporary, `${name}-altered-build`); await fs.cp(portable, altered, { recursive: true });
    await fs.appendFile(path.join(altered, 'source-map.json'), ' ');
    await assert.rejects(inspectBackendProject({ buildDirectory: altered }), { errorCode: 'backend_project_changed' });
    const legacy = path.join(temporary, `${name}-legacy-build`); await fs.cp(portable, legacy, { recursive: true });
    await fs.unlink(path.join(legacy, 'backend-project.json'));
    const legacyBefore = await tree(legacy), legacyDetail = await runProjectBuildCommand(['--command', 'inspect', '--build', legacy]);
    assert.equal(legacyDetail.inspection.recorded, false); assert.deepEqual(await tree(legacy), legacyBefore);
    await fs.rename(moved, root);
    const row = { name, backendId, tool: detail.project.tool, kind: detail.project.project.kind,
      buildId: detail.project.buildId, snapshotId: detail.project.snapshotId, files: detail.project.files.length,
      resources: detail.project.resources.length, dependencies: detail.project.dependencies.length,
      initialInspection: detail.inspection, afterRunInspection: afterRun.inspection,
      authorUnchanged: true, sourceOffline: true, relocatedOutput: true, legacyReadOnly: true,
      sourceMapTamperRejected: true, runtime: ran.job.status };
    report.cases.push(row); console.log(`${name}: ${row.kind}, ${row.files} files, ${row.runtime}, extra=${detail.inspection.extraPaths.length}`);
    await service.close();
  }
  report.ok = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack, errorCode: error.errorCode };
  process.exitCode = 1;
} finally {
  await Promise.allSettled(services.map(service => service.close()));
  await fs.rm(temporary, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases.length, failure: report.failure, output }, null, 2));
}
