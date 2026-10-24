import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readWorldSnapshot } from '../../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../../adapters/node-world-commands.mjs';
import { transactionHash } from '../../lib/world-transaction-state.mjs';
import { workspacePaths } from '../../lib/project-layout.mjs';

export const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', oldManifestId = '88888888-8888-4888-8888-888888888887';
export const manifestId = '99999999-4444-4444-8444-444444444444';
export const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const journal = '.viento/world-transactions';
export const json = value => JSON.stringify(value, null, 2) + '\n';

export async function physics2DFixture(t, version = 3) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics2d-create-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../../examples/scene-animation/', import.meta.url), root, { recursive: true });
  const manifest = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: sceneId, bodies: [
    { id: '33333333-1111-4111-8111-111111111111', instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      kind: 'character', shape: { kind: 'box', size: [80, 80] }, offset: [0, 0], layer: 1, mask: 1 },
    { id: '33333333-2222-4222-8222-222222222222', instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      kind: 'sensor', shape: { kind: 'circle', radius: 40 }, offset: [0, 0], layer: 2, mask: 1 },
  ] };
  const workspaceFile = path.join(root, 'workspace.json'), workspace = JSON.parse(await fs.readFile(workspaceFile));
  workspace.documentTypes = workspace.documentTypes.filter(type => type.id !== 'animation');
  workspace.documentTypes.push({ id: 'physics', label: 'Physics / 物理 / 物理', directory: 'physics', parserProfile: 'structured', template: 'physics.json' });
  await fs.writeFile(workspaceFile, json(workspace));
  await fs.rm(path.join(root, 'templates/animation.json')); await fs.writeFile(path.join(root, 'templates/physics.json'), json(manifest));
  await fs.mkdir(path.join(root, 'documents/physics'));
  await fs.rm(path.join(root, 'documents/animations/demo.json')); await fs.rm(path.join(root, `metadata/documents/${oldManifestId}.json`));
  const sceneRecordPath = `metadata/documents/${sceneId}.json`, record = JSON.parse(await fs.readFile(path.join(root, sceneRecordPath)));
  record.relations = record.relations.filter(relation => relation.kind !== 'animation');
  let sceneRecord = json(record).replace('"assetBindings": []', '"assetBindings": [],\n  "extension": {"precise":900719925474099312345,"keep":"保留"}').replaceAll('\n', '\r\n');
  await fs.writeFile(path.join(root, sceneRecordPath), sceneRecord);
  const paths = workspacePaths({ version }), documents = paths.documents;
  if (version === 2) {
    const workspaceFile = path.join(root, 'workspace.json'), workspace = JSON.parse(await fs.readFile(workspaceFile));
    workspace.version = 2; workspace.paths = paths; await fs.writeFile(workspaceFile, json(workspace));
    await fs.rename(path.join(root, 'documents'), path.join(root, documents)); await fs.rename(path.join(root, 'templates'), path.join(root, paths.templates));
    for (const file of await fs.readdir(path.join(root, 'metadata/documents'))) {
      const name = path.join(root, 'metadata/documents', file), content = await fs.readFile(name, 'utf8');
      await fs.writeFile(name, content.replace('"sourcePath": "documents/', `"sourcePath": "${documents}/`));
    }
    sceneRecord = await fs.readFile(path.join(root, sceneRecordPath), 'utf8');
  }
  const sourcePath = `${documents}/physics/created.json`, scenePath = `${documents}/scenes/demo.json`;
  const observed = await readWorldSnapshot(root), scene = observed.projection.objects.find(object => object.id === sceneId);
  const input = { command: 'physics2d.create', mode: 'apply', worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
    actorRef: { kind: 'tool', id: 'physics2d-create-test' }, objectId: manifestId, documentType: 'physics', sourcePath,
    content: '\uFEFF' + json(manifest).replaceAll('\n', '\r\n'), sceneObjectId: sceneId, sceneObjectRevision: scene.revision,
    sceneSourceRevision: scene.documentRefs[0].sourceRevision };
  return { root, input, documents, scenePath, sceneRecord, manifest, files: [sourcePath, `metadata/documents/${manifestId}.json`, sceneRecordPath],
    execute: createWorldCommandService(root) };
}

export async function fingerprint(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (relative === '.viento/registry.lock') continue;
    result[relative] = transactionHash(await fs.readFile(file));
  }
  return result;
}

export const targetContents = fixture => Promise.all(fixture.files.map(relative => fs.readFile(path.join(fixture.root, relative), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null; throw error;
})));

export async function crashPhysics2D(fixture, point, index = '-', recovering = false) {
  const requestFile = path.join(fixture.root, '.physics2d-request.json'); await fs.writeFile(requestFile, JSON.stringify(fixture.input));
  const child = fork(new URL('../world-transaction-crash-worker.mjs', import.meta.url), [fixture.root, recovering ? 'recover' : requestFile, point, String(index)],
    { silent: true, execArgv: [] });
  let stderr = '', timer; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  try {
    const event = await Promise.race([once(child, 'message').then(([message]) => message), exited.then(() => { throw Error(stderr || 'Worker exited before checkpoint'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(stderr || 'Worker checkpoint timed out')), 15000); })]);
    assertCheckpoint(event, point);
  } finally { clearTimeout(timer); child.kill('SIGKILL'); await exited; await fs.rm(requestFile, { force: true }); }
}
function assertCheckpoint(event, point) { if (event.stage !== point) throw Error(`Unexpected checkpoint result: ${JSON.stringify(event)}`); }

export async function childPhysics2D(fixture, requestFile) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = fork(new URL('./world-physics2d-create-worker.mjs', import.meta.url), [fixture.root, requestFile], { silent: true, execArgv: [], env });
  let stderr = '', result, failure; child.stderr.on('data', chunk => { stderr += chunk; }); child.on('message', message => { result = message.result; failure = message.failure; });
  const [exitCode] = await once(child, 'close'); return { exitCode, result, failure, stderr };
}
