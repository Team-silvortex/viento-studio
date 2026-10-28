import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const tool = process.env.VIENTO_BEVY_BIN;
const backendId = 'org.viento.bevy';
async function author(t) {
  const fixture = await projectAssemblyAuthor(t, { entry: 'audio' });
  for (const [index, id] of fixture.sceneIds.entries()) {
    const metaPath = path.join(fixture.author, `metadata/documents/${id}.json`);
    const metadata = JSON.parse(await fs.readFile(metaPath));
    metadata.relations = metadata.relations.filter(item => item.kind === 'reference');
    await fs.writeFile(metaPath, JSON.stringify(metadata));
    const scenePath = path.join(fixture.author, metadata.sourcePath);
    const scene = JSON.parse(await fs.readFile(scenePath));
    for (const actor of scene.actors) delete actor.imageResourceId;
    scene.title = `Bevy project scene ${index + 1}`;
    await fs.writeFile(scenePath, JSON.stringify(scene));
  }
  await fs.rm(path.join(fixture.author, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(fixture.author, 'metadata/documents/88888888-8888-4888-8888-888888888888.json'));
  return fixture;
}
async function tree(root) {
  const files = [];
  async function walk(dir, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name, name = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(name, relative);
      else if (entry.isFile()) files.push([relative, createHash('sha256').update(await fs.readFile(name)).digest('hex')]);
      else throw new Error(`Unexpected non-file in author fixture: ${relative}`);
    }
  }
  await walk(root); return files;
}

test('Bevy project preserves author data and refuses altered entry inventories while retaining offline delivery', { skip: !tool }, async t => {
  const f = await author(t), before = await tree(f.author);
  const built = await buildProject({ root: f.author, scene: f.assemblyId, backendId, tool,
    output: path.join(f.temporary, 'build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const directory = built.buildDirectory;
  const run = await runProjectBuild({ buildDirectory: directory, backendId, tool, timeoutMs: 60000 });
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics || run.record?.diagnostics));
  assert.equal(run.record.events.find(value => value.event === 'scene-enter').sceneId, f.entrySceneId);
  assert.equal(run.record.events.at(-1).event, 'finished');
  const inspect = () => inspectBackendProject({ buildDirectory: directory, backendId });
  assert.equal((await inspect()).inspection.complete, false, 'runtime sessions are retained separately');
  assert.deepEqual(await tree(f.author), before, 'build and run must not modify author files');
  for (const relative of ['assembly.json', `scenes/${f.sceneIds.find(id => id !== f.entrySceneId)}/scene-data.json`]) {
    const file = path.join(directory, 'project', relative), original = await fs.readFile(file);
    try {
      await fs.writeFile(file, Buffer.concat([original, Buffer.from(' ')]));
      await assert.rejects(inspect(), error => ['backend_project_changed', 'backend_project_invalid'].includes(error.errorCode));
      const rejected = await runProjectBuild({ buildDirectory: directory, backendId, tool, timeoutMs: 60000 });
      assert.equal(rejected.ok, false);
      assert.ok(rejected.diagnostics?.some(item => ['runtime_artifact_changed', 'build_artifact_changed'].includes(item.code))
        || rejected.record?.diagnostics?.some(item => ['runtime_artifact_changed', 'build_artifact_changed'].includes(item.code)), JSON.stringify(rejected));
    } finally { await fs.writeFile(file, original); }
  }
  assert.deepEqual(await tree(f.author), before, 'inspection and rejected runs must not modify author files');
  // Use a separate untouched build so runtime-session evidence does not contaminate delivery.
  const offline = await buildProject({ root: f.author, scene: f.assemblyId, backendId, tool,
    output: path.join(f.temporary, 'offline'), timeoutMs: 60000 });
  assert.equal(offline.ok, true, JSON.stringify(offline.diagnostics || offline.record?.diagnostics));
  assert.deepEqual(await tree(f.author), before);
  const inspectOffline = () => inspectBackendProject({ buildDirectory: offline.buildDirectory, backendId });
  await fs.rename(f.author, `${f.author}-relocated`);
  const delivery = await planBackendProjectDelivery({ inspection: await inspectOffline(), assertCurrent: inspectOffline });
  const zip = path.join(f.temporary, 'delivery.zip'); await writeExportZip(delivery, zip);
  const verified = await verifyBackendProjectDelivery(zip);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  let readme;
  try {
    for await (const entry of archive.eachEntry()) if (entry.fileName === 'README.md') {
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      readme = Buffer.concat(chunks).toString('utf8');
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.equal(typeof readme, 'string');
  assert.equal(readme.split('"<runtime-path>" --scene "<absolute-path>/project/scene-data.json" --smoke').length - 1, 3);
  for (const phrase of ['运行入口场景', '当前不支持场景切换', '运行程序需另备',
    'Run the entry scene', 'scene switching is not supported', 'runtime must be supplied separately',
    '入口シーンを実行', 'シーン切り替えには対応せず', 'ランタイムは別途必要']) assert.ok(readme.includes(phrase), phrase);
  assert.equal(verified.delivery.project.source.entrySceneId, f.entrySceneId);
  assert.deepEqual(verified.delivery.project.source.scenes.map(value => value.sceneId), f.sceneIds);
  assert.deepEqual(await tree(`${f.author}-relocated`), before);
});

test('Bevy single-scene build retains scene identity and runtime behavior', { skip: !tool }, async t => {
  const f = await author(t), before = await tree(f.author);
  const built = await buildProject({ root: f.author, scene: f.sceneIds[0], backendId, tool,
    output: path.join(f.temporary, 'scene-build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const run = await runProjectBuild({ buildDirectory: built.buildDirectory, backendId, tool, timeoutMs: 60000 });
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics || run.record?.diagnostics));
  assert.equal(run.record.events.at(-1).event, 'finished');
  assert.equal(Object.hasOwn(run.record, 'target'), false);
  assert.deepEqual(await tree(f.author), before);
});
