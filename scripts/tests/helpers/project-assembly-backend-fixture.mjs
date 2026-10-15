import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import '../../adapters/node-studio-core.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
export async function projectAssemblyAuthor(t, { entry = 'behavior', title = 'Two-scene project' } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-assembly-backend-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const author = path.join(temporary, 'author');
  await fs.cp(new URL('../../../examples/scene-behaviors/', import.meta.url), author, { recursive: true });
  const assemblyId = '12345678-1234-4234-8234-123456789abc', behaviorSceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const audioSceneId = '12345678-1234-4234-8234-123456789abd', audioId = '88888888-8888-4888-8888-888888888888';
  const scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff', waveId = '99999999-9999-4999-8999-999999999999';
  const entrySceneId = entry === 'audio' ? audioSceneId : behaviorSceneId;
  const read = async file => JSON.parse(await fs.readFile(path.join(author, file)));
  const write = async (file, value) => { await fs.mkdir(path.dirname(path.join(author, file)), { recursive: true }); await fs.writeFile(path.join(author, file), json(value)); };
  const workspace = await read('workspace.json');
  workspace.documentTypes.push({ id: 'audio', label: 'Audio', directory: 'audio', parserProfile: 'structured', template: 'audio.json' },
    { id: 'assembly', label: 'Project assembly', directory: 'projects', parserProfile: 'structured', template: 'assembly.json' });
  await write('workspace.json', workspace);
  const audioRoot = new URL('../../../examples/scene-audio/', import.meta.url);
  await fs.cp(new URL('templates/audio.json', audioRoot), path.join(author, 'templates/audio.json'));
  await fs.cp(new URL('assets/tone.wav', audioRoot), path.join(author, 'assets/tone.wav'));
  await fs.cp(new URL(`metadata/assets/${waveId}.json`, audioRoot), path.join(author, `metadata/assets/${waveId}.json`));
  const scene = await read('documents/scenes/demo.json'); scene.title = 'Second scene with shared actors and audio';
  await write('documents/scenes/audio.json', scene);
  const record = await read(`metadata/documents/${behaviorSceneId}.json`);
  await write(`metadata/documents/${audioSceneId}.json`, { ...record, id: audioSceneId, sourcePath: 'documents/scenes/audio.json',
    relations: [record.relations[0], { kind: 'audio', targetId: audioId, slot: 'scene audio' }] });
  const audio = JSON.parse(await fs.readFile(new URL('documents/audio/demo.json', audioRoot))); audio.sceneObjectId = audioSceneId;
  await write('documents/audio/demo.json', audio);
  const audioRecord = JSON.parse(await fs.readFile(new URL(`metadata/documents/${audioId}.json`, audioRoot)));
  audioRecord.relations[0].targetId = audioSceneId; await write(`metadata/documents/${audioId}.json`, audioRecord);
  const assembly = { format: 'viento-project-assembly', schemaVersion: 1, title, entrySceneId, sceneIds: [behaviorSceneId, audioSceneId] };
  await write('documents/projects/demo.json', assembly); await write('templates/assembly.json', assembly);
  await write(`metadata/documents/${assemblyId}.json`, { ...record, id: assemblyId, sourcePath: 'documents/projects/demo.json', documentType: 'assembly',
    relations: assembly.sceneIds.map(targetId => ({ kind: 'reference', targetId, slot: 'scene' })) });
  return { temporary, author, assemblyId, sceneIds: assembly.sceneIds, entrySceneId, scriptId, waveId };
}

export async function projectAssemblyBuildFixture(t, options = {}) {
  const { captureBuildSnapshot, buildHash } = await import('../../adapters/node-build-snapshot.mjs');
  const { createExecutionBackendRegistry, validateGeneratedExecutionProject, executionAdapterFingerprint } = await import('../../adapters/node-execution-backends.mjs');
  const { createBackendProjectManifest } = await import('../../adapters/node-backend-project.mjs');
  const { randomUUID } = await import('node:crypto');
  const f = await projectAssemblyAuthor(t, options), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  if (!captured.ok) throw new Error(JSON.stringify(captured.diagnostics));
  const adapter = createExecutionBackendRegistry().resolve('org.viento.godot4');
  const generated = validateGeneratedExecutionProject(adapter, captured.plan, await adapter.generate(captured.plan));
  const directory = path.join(f.temporary, 'derived');
  const build = { format: 'viento-build-record', schemaVersion: 1, buildId: randomUUID(), snapshotId: captured.snapshotId, status: 'succeeded',
    backend: generated.backend, executionAdapter: await executionAdapterFingerprint(adapter),
    tool: { version: '4.7.2.stable.fixture', sha256: buildHash('assembly-fixture-tool'), platform: 'linux', arch: 'x64' },
    artifact: { ...generated.artifact, entry: `project/${generated.artifact.entry}`, files: [] }, diagnostics: [], phases: [] };
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, 'project', name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
    build.artifact.files.push({ path: name, size: bytes.byteLength, sha256: buildHash(bytes) });
  }
  const snapshot = captured.snapshot, sourceMap = generated.sourceMap;
  for (const [name, value] of [['build.json', build], ['snapshot.json', snapshot], ['source-map.json', sourceMap]]) await fs.writeFile(path.join(directory, name), json(value));
  const project = createBackendProjectManifest({ build, snapshot, sourceMap, generated });
  const manifestBytes = json(project), manifestSha256 = buildHash(manifestBytes); await fs.writeFile(path.join(directory, 'backend-project.json'), manifestBytes);
  return { ...f, directory, captured, build, snapshot, sourceMap, generated, project, adapter, manifestSha256,
    pins: { expectedBuildId: build.buildId, expectedSnapshotId: build.snapshotId, expectedManifestSha256: manifestSha256 } };
}
