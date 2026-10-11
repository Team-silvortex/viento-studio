import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { captureBuildSnapshot, buildHash } from '../../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry, validateGeneratedExecutionProject, executionAdapterFingerprint } from '../../adapters/node-execution-backends.mjs';
import { createBackendProjectManifest } from '../../adapters/node-backend-project.mjs';

export const json = value => JSON.stringify(value, null, 2) + '\n';
export const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export async function backendProjectFixture(t, { backend = 'godot', version = 1, behaviors = false, recorded = true, legacy = false } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-project-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const author = path.join(temporary, 'author'), directory = path.join(temporary, 'derived');
  const example = behaviors ? 'scene-behaviors' : backend === 'bevy' ? 'bevy-headless' : 'scene2d';
  await fs.cp(new URL(`../../../examples/${example}/`, import.meta.url), author, { recursive: true });
  const scenePath = path.join(author, 'documents/scenes/demo.json');
  if (!behaviors) {
    const value = JSON.parse(await fs.readFile(scenePath)); value.schemaVersion = version;
    if (version === 1 && backend === 'bevy') value.actors = [value.actors[0]];
    value.actors.forEach((actor, index) => {
      if (version === 1) delete actor.instanceId;
      else actor.instanceId = `${String(index + 1).padStart(8, '0')}-2222-4222-8222-222222222222`;
    });
    await fs.writeFile(scenePath, json(value));
  }
  const captured = await captureBuildSnapshot(author, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const registry = createExecutionBackendRegistry(), adapter = registry.resolve(backend === 'bevy' ? 'org.viento.bevy' : 'org.viento.godot4');
  const generated = validateGeneratedExecutionProject(adapter, captured.plan, await adapter.generate(captured.plan));
  const build = { format: 'viento-build-record', schemaVersion: 1, buildId: randomUUID(), snapshotId: captured.snapshotId, status: 'succeeded',
    backend: generated.backend, ...(legacy ? {} : { executionAdapter: await executionAdapterFingerprint(adapter) }),
    tool: { version: backend === 'bevy' ? 'viento-bevy-runtime 0.3.0 bevy 0.19.1' : '4.7.2.stable.fixture', sha256: buildHash('read-only-inspection-test-identity'), platform: 'linux', arch: 'x64' },
    artifact: { ...generated.artifact, entry: `project/${generated.artifact.entry}`, files: [] }, diagnostics: [], phases: [] };
  await fs.mkdir(path.join(directory, 'project'), { recursive: true });
  for (const resource of captured.plan.resources) generated.files.set(generated.resourceFiles.get(resource.id), captured.resources.get(resource.id));
  for (const [name, bytes] of generated.files) {
    const target = path.join(directory, 'project', name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes, { flag: 'wx' });
    build.artifact.files.push({ path: name, size: bytes.byteLength, sha256: buildHash(bytes) });
  }
  const snapshot = captured.snapshot, sourceMap = generated.sourceMap;
  for (const [name, value] of [['build.json', build], ['snapshot.json', snapshot], ['source-map.json', sourceMap]]) await fs.writeFile(path.join(directory, name), json(value));
  const project = createBackendProjectManifest({ build, snapshot, sourceMap, generated });
  const manifestBytes = json(project), manifestSha256 = buildHash(manifestBytes);
  if (recorded) await fs.writeFile(path.join(directory, 'backend-project.json'), manifestBytes);
  return { temporary, author, directory, captured, build, snapshot, sourceMap, generated, project, registry, adapter, manifestSha256,
    pins: { expectedBuildId: build.buildId, expectedSnapshotId: build.snapshotId, expectedManifestSha256: manifestSha256 } };
}
