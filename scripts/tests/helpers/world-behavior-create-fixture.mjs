import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readWorldSnapshot } from '../../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../../adapters/node-world-commands.mjs';
import { transactionHash } from '../../lib/world-transaction-state.mjs';
import { workspacePaths } from '../../lib/project-layout.mjs';

export const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', oldManifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const manifestId = '99999999-4444-4444-8444-444444444444', scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const journal = '.viento/world-transactions';
export const json = value => JSON.stringify(value, null, 2) + '\n';

export async function behaviorFixture(t, version = 3) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-create-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../../examples/scene-behaviors/', import.meta.url), root, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'documents/behaviors/demo.json')));
  await fs.rm(path.join(root, 'documents/behaviors/demo.json')); await fs.rm(path.join(root, `metadata/documents/${oldManifestId}.json`));
  const sceneRecordPath = `metadata/documents/${sceneId}.json`, record = JSON.parse(await fs.readFile(path.join(root, sceneRecordPath)));
  record.relations = record.relations.filter(relation => relation.kind !== 'behavior');
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
  const sourcePath = `${documents}/behaviors/created.json`, scenePath = `${documents}/scenes/demo.json`, scriptPath = `${documents}/scripts/checkpoint.txt`;
  const observed = await readWorldSnapshot(root), scene = observed.projection.objects.find(object => object.id === sceneId);
  const input = { command: 'behavior.create', mode: 'apply', worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
    actorRef: { kind: 'tool', id: 'behavior-create-test' }, objectId: manifestId, documentType: 'behavior', sourcePath,
    content: '\uFEFF' + json(manifest).replaceAll('\n', '\r\n'), sceneObjectId: sceneId, sceneObjectRevision: scene.revision,
    sceneSourceRevision: scene.documentRefs[0].sourceRevision };
  return { root, input, documents, scenePath, scriptPath, sceneRecord, manifest, files: [sourcePath, `metadata/documents/${manifestId}.json`, sceneRecordPath],
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

export async function crashBehavior(fixture, point, index = '-', recovering = false) {
  const requestFile = path.join(fixture.root, '.behavior-request.json'); await fs.writeFile(requestFile, JSON.stringify(fixture.input));
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

export async function childBehavior(fixture, requestFile) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = fork(new URL('./world-behavior-create-worker.mjs', import.meta.url), [fixture.root, requestFile], { silent: true, execArgv: [], env });
  let stderr = '', result, failure; child.stderr.on('data', chunk => { stderr += chunk; }); child.on('message', message => { result = message.result; failure = message.failure; });
  const [exitCode] = await once(child, 'close'); return { exitCode, result, failure, stderr };
}
