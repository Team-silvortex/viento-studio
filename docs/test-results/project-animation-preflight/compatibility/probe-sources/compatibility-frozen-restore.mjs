import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory, moduleAt, hash, startReport, pass, finishReport } from './compatibility-common.mjs';

const report = await startReport('compatibility-frozen-restore', 'Actual readFrozenProjectBuild with an intact synthetic succeeded-record header and full frozen author source. No historical tool compilation, Godot import, run, or playback is claimed.');
const { projectAnimationPreflightFixture } = await moduleAt('scripts/tests/helpers/project-animation-preflight-fixture.mjs');
const { readWorldSnapshot } = await moduleAt('scripts/adapters/node-world-projection.mjs');
const { createBuildTargetPlan } = await moduleAt('engine/build-target.mjs');
const { canonicalJson } = await moduleAt('engine/world-projection.mjs');
const { captureBuildSnapshot } = await moduleAt('scripts/adapters/node-build-snapshot.mjs');
const { readFrozenProjectBuild } = await moduleAt('scripts/adapters/node-project-build.mjs');
const { generateGodotAssemblyProject } = await moduleAt('scripts/backends/godot4-project.mjs');
const { createProjectAnimationStateCatalog } = await moduleAt('engine/project-animation-states.mjs');
const { createExecutionBackendRegistry } = await moduleAt('scripts/adapters/node-execution-backends.mjs');
const cleanups = [];
try {
  const f = await projectAnimationPreflightFixture({ after: callback => cleanups.push(callback) });
  const observed = await readWorldSnapshot(f.author), planned = createBuildTargetPlan(observed, f.assemblyId);
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics));
  const scene = planned.plan.scenes.find(item => item.scene.objectId === f.sceneIds[0]);
  assert.equal(scene.animation.document.clips.some(clip => clip.id === f.missingClip), false);
  assert.ok(planned.plan.scenes[1].animation.document.clips.some(clip => clip.id === f.missingClip));
  const catalog = createProjectAnimationStateCatalog(planned.plan);
  const controller = catalog.scenes.flatMap(item => item.controllers).find(item => item.bindingId === f.bindingId);
  assert.ok(controller.clips.includes(f.missingClip));
  const generated = await generateGodotAssemblyProject(planned.plan);
  assert.equal(generated.backend.protocolVersion, 10);
  const snapshot = { format: 'viento-build-snapshot', schemaVersion: 1, source: observed.source, plan: planned.plan };
  const frozenDirectory = await fs.mkdtemp(path.join(directory, 'compatibility-frozen-fixture-'));
  const build = { format: 'viento-build-record', schemaVersion: 1, buildId: randomUUID(), status: 'succeeded',
    snapshotId: `sha256:${hash(canonicalJson(snapshot))}`, backend: generated.backend };
  const bytes = Object.fromEntries([['build.json', build], ['snapshot.json', snapshot]].map(([name, value]) => [name, JSON.stringify(value, null, 2) + '\n']));
  await Promise.all(Object.entries(bytes).map(([name, content]) => fs.writeFile(path.join(frozenDirectory, name), content)));
  await fs.writeFile(path.join(frozenDirectory, 'FIXTURE-NOT-COMPILED.txt'),
    'Synthetic succeeded-record header for testing readFrozenProjectBuild only. Full captured author source and canonical snapshot hash are real; no native tool compiled or ran this fixture.\n');
  const fresh = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(fresh.ok, false); assert.equal(Object.hasOwn(fresh, 'snapshotId'), false);
  const diagnostic = fresh.diagnostics.find(item => item.code === 'build_animation_state_clip_missing' && item.clipId === f.missingClip);
  assert.ok(diagnostic, JSON.stringify(fresh.diagnostics));
  assert.equal(diagnostic.propertyPath, '/bindings/1/parameters/clip_attack');
  assert.equal(diagnostic.sourcePath, f.behaviorPath);
  // Instrument a real registry adapter so any attempted tool operation fails.
  const actualRegistry = createExecutionBackendRegistry(), adapterOperations = [], resolutions = [];
  const guardedRegistry = { resolve(id) {
    resolutions.push(id); const adapter = actualRegistry.resolve(id);
    return new Proxy(adapter, { get(target, key, receiver) {
      if (typeof Reflect.get(target, key, receiver) !== 'function') return Reflect.get(target, key, receiver);
      return () => { adapterOperations.push(String(key)); throw new Error(`Unexpected adapter operation during restore: ${String(key)}`); };
    } });
  } };
  // Delete the disposable live author tree first: restore must rely only on frozen source.
  await fs.rm(f.author, { recursive: true, force: true });
  const restored = await readFrozenProjectBuild(frozenDirectory, { backendId: 'org.viento.godot4', backendRegistry: guardedRegistry });
  assert.equal(canonicalJson(restored.plan), canonicalJson(planned.plan));
  assert.equal(restored.build.snapshotId, build.snapshotId);
  assert.deepEqual(resolutions, ['org.viento.godot4']); assert.deepEqual(adapterOperations, []);
  const restoredController = createProjectAnimationStateCatalog(restored.plan).scenes.flatMap(item => item.controllers).find(item => item.bindingId === f.bindingId);
  assert.ok(restoredController.clips.includes(f.missingClip));
  for (const [name, content] of Object.entries(bytes)) assert.equal(await fs.readFile(path.join(frozenDirectory, name), 'utf8'), content);
  pass(report, { name: 'missing-named-clip-frozen-restore', fixtureDirectory: frozenDirectory,
    fixtureNature: 'synthetic successful-record header; full real author capture; no compiled tool output',
    snapshotId: build.snapshotId, fileSha256: Object.fromEntries(Object.entries(bytes).map(([name, content]) => [name, hash(content)])),
    missingClip: f.missingClip, absentFromBoundScene: true, presentInAnotherScene: true,
    freshCapture: { accepted: false, snapshotIdAbsent: true, diagnostic },
    frozenRead: { accepted: true, exactPlanRestored: true, namedClipPreserved: true, liveAuthorRemovedBeforeRead: true,
      fixtureBytesUnchanged: true, adapterResolutions: resolutions, adapterOperations },
    effectiveGeneratedProtocol: generated.backend.protocolVersion, generatedFileCount: generated.files.size,
    nativeCompilation: false, runtimeExecution: false });
} finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
await finishReport(report);
