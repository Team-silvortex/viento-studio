// Real tools and disposable workspaces: persistent recovery through the same
// service commands used by the editor, including old runtime/control/case paths.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { savedSuite } from './runtime-case-suite-fixture.mjs';
import { runtimeCase, program, sceneId } from './runtime-case-fixture.mjs';

const output = path.resolve(process.env.VIENTO_BACKEND_PROJECT_CATALOG_OUTPUT || path.join(os.tmpdir(), `viento-backend-project-catalog-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Use a new empty evidence directory.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-project-catalog-smoke-'));
const services = [], report = { startedAt: new Date().toISOString(), node: process.version, cases: [], ok: false,
  limitations: ['Actual Linux services and Godot/Bevy tool processes. Browser recorded separately.',
    'No installed Tauri window, Android device, native ns-nova runtime, arbitrary generated-project editing or automatic deletion of restored outputs.'] };
async function tree(root) {
  const values = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); values[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return values;
}
async function settle(service) {
  for (let i = 0; i < 1500; i++) { const value = await service.status(); if (value.job.status !== 'running') return value; await delay(50); }
  throw new Error('Task did not finish.');
}
try {
  for (const [name, example, backendId, tool, instances] of [
    ['godot-image', 'scene2d', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN, false],
    ['godot-instances', 'bevy-headless', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN, true],
    ['godot-behaviors', 'scene-behaviors', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN, false],
    ['bevy-instances', 'bevy-headless', 'org.viento.bevy', process.env.VIENTO_BEVY_BIN, true],
  ]) {
    assert.ok(tool, `Supply actual tool for ${name}`);
    const root = path.join(temporary, name), cacheRoot = path.join(temporary, `${name}-cache`);
    await fs.cp(new URL(`../../examples/${example}/`, import.meta.url), root, { recursive: true });
    if (instances) {
      // The shared assertion fixture explicitly drives both instances. The
      // untouched demonstration disables controls on its second actor.
      const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
      for (const actor of scene.actors) actor.controls = 'arrows';
      await fs.writeFile(file, JSON.stringify(scene, null, 2) + '\n');
    }
    const suite = instances ? await savedSuite({ root }) : null;
    const authors = await tree(root), create = configuredTool => {
      const service = createProjectBuildService(root, { tool: configuredTool, backendId, cacheRoot }); services.push(service); return service;
    };
    let service = create(tool);
    await service.command({ action: 'build', sceneId }); const built = await settle(service);
    assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
    const id = built.latestBuild.id, detail = await service.command({ action: 'inspect-project', buildId: id });
    const frozen = await tree(detail.buildDirectory);
    await service.close(); service = create('');
    const restored = await service.status(); assert.equal(restored.projects[0].id, id);
    assert.equal(restored.projects[0].availability, 'unchecked'); assert.equal(restored.latestBuild, null);
    assert.equal(restored.projects[0].retentionReason, 'backend_project_previous_session');
    await service.command({ action: 'inspect-project', buildId: id });
    assert.equal((await service.status()).latestBuild, null);
    assert.equal((await service.command({ action: 'select-project', buildId: id })).latestBuild.id, id);
    assert.deepEqual(await tree(detail.buildDirectory), frozen, 'tool-free inspection/selection does not modify project bytes');
    await service.close(); service = create(tool);
    await assert.rejects(service.command({ action: 'run', buildId: id, mode: 'headless' }), { errorCode: 'build_artifact_missing' });
    const offline = `${root}-offline`; await fs.rename(root, offline);
    const selected = await service.command({ action: 'select-project', buildId: id });
    assert.equal(selected.scenes[0].frozenOnly, true); assert.equal(selected.latestBuild.id, id);
    await service.command({ action: 'run', buildId: id, mode: 'headless' }); const ran = await settle(service);
    assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
    const row = { name, backendId, buildId: id, snapshotId: detail.project.snapshotId, tool: detail.project.tool,
      restartRestored: true, toolFreeInspectionAndSelection: true, explicitSelectionRequired: true,
      authorOfflineRuntime: ran.job.status, control: null, verification: null, suite: null, reports: 0 };
    if (instances) {
      await service.command({ action: 'run', buildId: id, mode: 'headless', controlProgram: program() }); const controlled = await settle(service);
      assert.equal(controlled.job.status, 'succeeded', JSON.stringify(controlled.job.diagnostics));
      assert.equal(controlled.job.control.samples.length, 4); row.control = '4 actual per-instance samples';
      await service.command({ action: 'run', buildId: id, mode: 'headless', runtimeCase: runtimeCase(), runtimeCaseSceneId: sceneId });
      const verified = await settle(service); assert.equal(verified.job.status, 'succeeded', JSON.stringify(verified.job.diagnostics));
      assert.equal(verified.job.verification.evaluation.status, 'passed'); row.verification = verified.job.verification.evaluation;
    }
    await fs.rename(offline, root);
    if (suite) {
      await service.command({ action: 'suite-run', buildId: id, suiteDocumentId: suite.group.id, expectedVersion: suite.group.version });
      const batch = await settle(service); assert.equal(batch.job.status, 'succeeded', JSON.stringify(batch.job.diagnostics));
      assert.equal(batch.job.suite.summary.status, 'passed'); row.suite = batch.job.suite.summary;
      for (const member of batch.job.suite.entries) {
        assert.equal(member.reportAvailable, true);
        const leaf = await service.command({ action: 'suite-report', jobId: batch.job.id, documentId: member.documentId });
        assert.equal(leaf.evaluation.status, 'passed'); row.reports++;
      }
    }
    const after = await tree(detail.buildDirectory);
    for (const [file, hash] of Object.entries(frozen)) assert.equal(after[file], hash, file);
    const checked = await service.command({ action: 'inspect-project', buildId: id });
    assert.ok(checked.inspection.extraPaths.some(entry => entry.path === 'sessions'));
    assert.deepEqual(await tree(root), authors); row.frozenInputsAndAuthorsUnchanged = true;
    row.sessionReportsPreserved = true; report.cases.push(row); console.log(`${name}: restart → explicit selection → runtime${instances ? ' → control → verification → suite reports' : ''} passed`);
    await fs.writeFile(path.join(output, `${name}-manifest.json`), JSON.stringify(detail.project, null, 2) + '\n');
    await service.close();
  }
  report.ok = true;
} catch (error) { report.failure = { message: error.message, errorCode: error.errorCode, stack: error.stack }; process.exitCode = 1; }
finally {
  await Promise.allSettled(services.map(service => service.close())); await fs.rm(temporary, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases.length, failure: report.failure, output }));
}
