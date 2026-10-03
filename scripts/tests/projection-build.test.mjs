import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fork, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { generateGodotProject, godotDiagnostics, readRuntimeEvents } from '../backends/godot4.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const scenePath = 'documents/scenes/two-projections.json';
const archiveBinary = process.env.VIENTO_TEST_ARCHIVE_BINARY, mobileBinary = process.env.VIENTO_MOBILE_STORE_BIN;
const godot = process.env.VIENTO_GODOT_BIN, nativeRun = promisify(execFile);
const background = '\uFEFF# 原始 OC\r\n\r\n背景：共同身份，只保存一份。  \r\n';
const write = async (root, relative, content) => {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
};
async function blank(root) {
  const template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  await write(root, 'workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Projection test', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(template.documentTypes) }));
  for (const [name, content] of Object.entries(template.templates)) await write(root, `templates/${name}`, content);
  await registerWorkspace(root);
}
async function input(root, patch) {
  const view = await readWorldProjection(root);
  return { command: 'object.create', mode: 'apply', objectId: randomUUID(), documentType: 'document', actorRef: { kind: 'tool', id: 'projection-build-test' },
    worldId: view.world.id, baseRevision: view.world.revision, ...patch };
}
async function fingerprint(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name); files[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return files;
}
async function fixture(t, { createScene = true } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-projection-build-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'blank'); await blank(root);
  const execute = createWorldCommandService(root), core = await input(root, { sourcePath: 'documents/core.md', content: background });
  await execute(core);
  const images = [];
  for (const color of ['#5577aa', '#77aa55', '#aa5577']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`);
    images.push({ bytes, ...(await readRegistry(root)).assets.find(item => item.id === imported.asset.id) });
  }
  const projections = [];
  for (let index = 0; index < 3; index++) {
    const template = getProjectionTemplates().find(item => item.id.endsWith(index === 0 ? '.rpg-player' : '.rpg-npc'));
    const locked = await lockProjectionTemplate(template, { digest: buildHash });
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: `同一 OC 的投影 ${index + 1}`, sourceObjectId: core.objectId,
      template: locked, configuration: { ...Object.fromEntries(template.fields.map(field => [field.id, field.default])), image: images[index].id } };
    const request = await input(root, { command: 'projection.create', sourcePath: `documents/projections/p${index + 1}.json`, content: json(declaration) });
    await execute(request); projections.push({ ...request, declaration });
  }
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: '同一 OC，两种投影', viewport: [640, 480], background: '#101827',
    actors: projections.slice(0, 2).map((item, index) => ({ objectId: item.objectId, position: [100 + index * 100, 150], useProjectionDefaults: true })) };
  const scene = await input(root, { command: 'scene.create', sourcePath: scenePath, content: json(declaration) });
  if (createScene) await execute(scene);
  return { root, temporary, core, images, projections, scene, declaration, execute };
}
async function changeProjection(f, index, mutate) {
  const item = f.projections[index], value = JSON.parse(await fs.readFile(path.join(f.root, item.sourcePath)));
  mutate(value); await write(f.root, item.sourcePath, json(value)); return value;
}
async function selected(f, ids, name = 'selected') {
  const catalog = await readPackageCatalog(f.root);
  const plan = await planExport(f.root, { kind: 'resources', ids, revision: catalog.revision });
  const file = path.join(f.temporary, `${name}.zip`); await writeExportZip(plan, file);
  const stage = path.join(f.temporary, name); await fs.mkdir(stage);
  return unpackResourcePackage(file, stage);
}

test('two projections share one OC but preserve distinct runtime identities, inherited fields, image origins and cold snapshot revisions', async t => {
  const f = await fixture(t), before = await fingerprint(f.root), captured = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.actors.map(actor => actor.objectId), f.projections.slice(0, 2).map(item => item.objectId));
  assert.deepEqual(captured.plan.actors.map(actor => actor.origin.objectId), [f.core.objectId, f.core.objectId]);
  assert.deepEqual(captured.plan.actors.map(actor => [actor.speed, actor.controls]), [[160, 'arrows'], [0, 'none']]);
  for (const [index, actor] of captured.plan.actors.entries()) {
    assert.equal(actor.origin.sourcePath, f.core.sourcePath); assert.match(actor.origin.sourceRevision, /^sha256:/);
    assert.deepEqual(actor.fieldSources.imageResourceId, { objectId: actor.objectId, sourcePath: f.projections[index].sourcePath, propertyPath: '/configuration/image' });
    assert.deepEqual(captured.resources.get(f.images[index].id), f.images[index].bytes);
  }
  const generated = await generateGodotProject(captured.plan);
  assert.equal(new Set(generated.sourceMap.objects.map(item => item.nodePath)).size, 2);
  assert.deepEqual(generated.sourceMap.objects.map(item => item.origin), captured.plan.actors.map(item => item.origin));
  const next = await changeProjection(f, 0, value => { value.configuration.speed = 240; value.configuration.width = 96; });
  const changed = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.equal(changed.ok, true, JSON.stringify(changed.diagnostics)); assert.notEqual(changed.snapshotId, captured.snapshotId);
  assert.equal(changed.plan.actors[0].speed, 240); assert.deepEqual(changed.plan.actors[0].size, [96, 80]);
  assert.deepEqual(changed.plan.actors[1], captured.plan.actors[1]);
  const after = await fingerprint(f.root);
  for (const [file, digest] of Object.entries(before)) if (file !== f.projections[0].sourcePath) assert.equal(after[file], digest, file);
  assert.equal(await fs.readFile(path.join(f.root, f.core.sourcePath), 'utf8'), background);
  assert.ok(!json(next).includes('共同身份'), 'background is referenced, never copied into a projection');
  assert.equal(captured.plan.actors[0].speed, 160, 'prior snapshot stays frozen');
});

test('scene overrides and explicit null images take precedence; old explicit actors remain supported and projections require valid OC dependencies', async t => {
  const f = await fixture(t), declaration = structuredClone(f.declaration);
  declaration.actors[0] = { ...declaration.actors[0], size: [30, 40], speed: 80, color: '#112233', controls: 'none', imageResourceId: null };
  declaration.actors[1] = { objectId: f.projections[1].objectId, position: [200, 150], size: [70, 60], speed: 15, color: '#ffffff', controls: 'arrows' };
  await write(f.root, scenePath, json(declaration));
  const captured = await captureBuildSnapshot(f.root, f.scene.objectId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.resources, []); assert.equal(captured.plan.actors[0].imageResourceId, undefined);
  assert.equal(captured.plan.actors[1].speed, 15); assert.equal(captured.plan.actors[1].origin.objectId, f.core.objectId);
  await fs.rm(path.join(f.root, f.core.sourcePath));
  const broken = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.equal(broken.ok, false); assert.ok(broken.diagnostics.some(item => item.propertyPath === '/sourceObjectId' && item.objectId === f.projections[1].objectId));
});

test('inherited configuration and image failures point to projection fields; position errors still point to the scene', async t => {
  const f = await fixture(t);
  await changeProjection(f, 0, value => { value.configuration.speed = -1; });
  let failed = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.equal(failed.ok, false); assert.ok(failed.diagnostics.some(item => item.objectId === f.projections[0].objectId && item.propertyPath === '/configuration/speed'));
  await write(f.root, f.projections[0].sourcePath, f.projections[0].content);
  const captured = await captureBuildSnapshot(f.root, f.scene.objectId), image = f.images[0];
  const processError = godotDiagnostics({ status: 'failed', stdout: `ERROR: Cannot import ${image.id}`, stderr: '' }, captured.plan)[0];
  assert.equal(processError.objectId, f.projections[0].objectId); assert.equal(processError.propertyPath, '/configuration/image');
  const frame = { protocol: 1, event: 'diagnostic', severity: 'error', code: 'runtime_image_failed', message: 'image failed', objectId: f.projections[0].objectId, resourceId: image.id };
  assert.equal(readRuntimeEvents({ stdout: `VIENTO_RUNTIME:${JSON.stringify(frame)}\n` }, captured.plan).diagnostics[0].propertyPath, '/configuration/image');
  await fs.writeFile(path.join(f.root, 'assets', image.location.path), Buffer.from('changed image'));
  failed = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.equal(failed.ok, false); assert.equal(failed.diagnostics[0].objectId, f.projections[0].objectId); assert.equal(failed.diagnostics[0].propertyPath, '/configuration/image');
  await write(f.root, `assets/${image.location.path}`, image.bytes);
  const invalid = structuredClone(f.declaration); invalid.actors[0].position = ['bad', 10]; await write(f.root, scenePath, json(invalid));
  failed = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.ok(failed.diagnostics.some(item => item.objectId === f.scene.objectId && item.propertyPath === '/actors/0/position'));
});

test('non-runtime projections cannot bypass Scene2D compatibility with explicit actor values; locked digest diagnostics retain their source pointer', async t => {
  const f = await fixture(t, { createScene: false });
  for (const suffix of ['visual-novel', 'literature', 'drama']) {
    const template = getProjectionTemplates().find(item => item.id.endsWith(`.${suffix}`));
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: suffix, sourceObjectId: f.core.objectId,
      template: await lockProjectionTemplate(template, { digest: buildHash }), configuration: Object.fromEntries(template.fields.map(field => [field.id, field.default])) };
    const projection = await input(f.root, { command: 'projection.create', sourcePath: `documents/projections/${suffix}.json`, content: json(declaration) });
    await f.execute(projection);
    const scene = { ...f.declaration, actors: [{ objectId: projection.objectId, position: [100, 100], size: [80, 80], speed: 0, controls: 'none', color: '#ffffff' }] };
    const request = await input(f.root, { ...f.scene, mode: 'preview', baseRevision: (await readWorldProjection(f.root)).world.revision, content: json(scene) });
    await assert.rejects(f.execute(request), error => error.payload?.diagnostics.some(item => item.code === 'build_projection_runtime'
      && item.objectId === projection.objectId && item.propertyPath === '/template/snapshot/runtime'));
  }
  await f.execute(await input(f.root, { ...f.scene, baseRevision: (await readWorldProjection(f.root)).world.revision }));
  await changeProjection(f, 0, value => { value.template.digest = `sha256:${'0'.repeat(64)}`; });
  const captured = await captureBuildSnapshot(f.root, f.scene.objectId);
  assert.equal(captured.ok, false);
  assert.ok(captured.diagnostics.some(item => item.code === 'object-projection-invalid' && item.objectId === f.projections[0].objectId && item.propertyPath === '/template/digest'));
});

test('selecting one projection keeps its OC, locked child template and image without siblings; the full scene package remains buildable after import', async t => {
  const f = await fixture(t), one = await selected(f, [f.projections[0].objectId], 'one');
  assert.deepEqual(new Set(one.manifest.documents.map(item => item.id)), new Set([f.projections[0].objectId, f.core.objectId]));
  assert.deepEqual(one.manifest.assets.map(item => item.id), [f.images[0].id]);
  const pack = await selected(f, [f.scene.objectId], 'scene');
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([f.scene.objectId, f.core.objectId, ...f.projections.slice(0, 2).map(item => item.objectId)]));
  assert.equal(pack.manifest.assets.length, 2);
  const target = path.join(f.temporary, 'imported'); await blank(target);
  const plan = await planPackageImport(target, pack); assert.deepEqual(plan.summary.conflicts, []); await applyPackageImport(target, pack, plan.revision);
  const restored = await captureBuildSnapshot(target, f.scene.objectId); assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
  for (const item of [f.core, ...f.projections.slice(0, 2)]) assert.equal(await fs.readFile(path.join(target, item.sourcePath), 'utf8'), item.content);
  assert.deepEqual(restored.plan.actors.map(actor => actor.origin.objectId), [f.core.objectId, f.core.objectId]);
});

test('selective packages reject edited projection identities, missing image bindings and forged template locks; full backups preserve damaged source for repair', async t => {
  const f = await fixture(t), projection = f.projections[0], originalMetadata = await fs.readFile(path.join(f.root, `metadata/documents/${projection.objectId}.json`));
  for (const mutate of [
    value => { value.sourceObjectId = f.projections[1].objectId; },
    value => { value.sourceObjectId = randomUUID(); },
    value => { value.configuration.image = f.images[2].id; },
    value => { value.template.digest = `sha256:${'0'.repeat(64)}`; },
    value => { value.format = 'invalid-projection'; },
  ]) {
    await write(f.root, projection.sourcePath, projection.content); await changeProjection(f, 0, mutate);
    const before = await fingerprint(f.root), catalog = await readPackageCatalog(f.root);
    assert.ok(catalog.entries.find(item => item.id === projection.objectId).problems.length);
    await assert.rejects(planExport(f.root, { kind: 'resources', ids: [projection.objectId], revision: catalog.revision }));
    await planExport(f.root, { kind: 'workspace' });
    assert.deepEqual(await fingerprint(f.root), before, 'rejection and backup planning never repair or overwrite author bytes');
    assert.deepEqual(await fs.readFile(path.join(f.root, `metadata/documents/${projection.objectId}.json`)), originalMetadata);
  }
});

test('selective import rejects projection semantic changes even when the entire package has valid recomputed hashes', async t => {
  const f = await fixture(t), pack = await selected(f, [f.scene.objectId], 'valid');
  const target = path.join(f.temporary, 'target'); await blank(target); const before = await fingerprint(target);
  for (const [label, mutate] of [
    ['source', value => { value.sourceObjectId = f.projections[1].objectId; }],
    ['image', value => { value.configuration.image = f.images[1].id; }],
    ['digest', value => { value.template.digest = `sha256:${'0'.repeat(64)}`; }],
  ]) {
    const files = new Map();
    for (const file of pack.files.keys()) files.set(file, await fs.readFile(path.join(pack.content, file)));
    const declaration = JSON.parse(files.get(f.projections[0].sourcePath)); mutate(declaration);
    files.set(f.projections[0].sourcePath, Buffer.from(json(declaration)));
    const manifest = structuredClone(pack.manifest);
    manifest.files = [...files].map(([path, bytes]) => ({ path, size: bytes.length, sha256: buildHash(bytes) }));
    files.set('manifest.json', Buffer.from(json(manifest)));
    const zipFile = path.join(f.temporary, `${label}.zip`), zip = new yazl.ZipFile();
    const writing = pipeline(zip.outputStream, createWriteStream(zipFile));
    for (const [name, bytes] of files) zip.addBuffer(bytes, name); zip.end(); await writing;
    const stage = path.join(f.temporary, `inspect-${label}`); await fs.mkdir(stage);
    const tampered = await unpackResourcePackage(zipFile, stage), plan = await planPackageImport(target, tampered);
    assert.ok(plan.summary.conflicts.some(item => item.path === f.projections[0].sourcePath && item.reason === 'dependency'), label);
    await assert.rejects(applyPackageImport(target, tampered, plan.revision));
    assert.deepEqual(await fingerprint(target), before, label);
  }
});

for (const committed of [false, true]) test(`Scene2D projection recovery ${committed ? 'commits' : 'rolls back'} without rereading or overwriting changed projection sources`, async t => {
  const f = await fixture(t, { createScene: false }), request = path.join(f.temporary, 'command.json'); await fs.writeFile(request, json(f.scene));
  const child = fork(new URL('./world-transaction-crash-worker.mjs', import.meta.url), [f.root, request, committed ? 'commit' : 'data', committed ? '-' : '0'], { silent: true, execArgv: [] });
  const exited = once(child, 'exit'); let timer, stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const [event] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr || 'Worker exited'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(stderr || 'Crash worker timeout')), 15000); })]);
    assert.equal(event.stage, committed ? 'commit' : 'data');
  } finally { clearTimeout(timer); child.kill('SIGKILL'); await exited; }
  const external = '{ external unfinished edit'; await write(f.root, f.projections[0].sourcePath, external);
  const originalCore = await fs.readFile(path.join(f.root, f.core.sourcePath));
  const result = await recoverWorldTransaction(f.root); assert.equal(result.status, committed ? 'committed' : 'rolled-back');
  assert.equal(await fs.readFile(path.join(f.root, f.projections[0].sourcePath), 'utf8'), external);
  assert.deepEqual(await fs.readFile(path.join(f.root, f.core.sourcePath)), originalCore);
  if (committed) {
    assert.equal(await fs.readFile(path.join(f.root, scenePath), 'utf8'), f.scene.content);
    assert.equal((await captureBuildSnapshot(f.root, f.scene.objectId)).ok, false, 'new Build diagnoses the current projection after safe recovery');
  } else await assert.rejects(fs.stat(path.join(f.root, scenePath)), { code: 'ENOENT' });
  assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
});

test('native desktop and mobile full archive round-trip keeps projection/core identities; editing P1 changes no other source', {
  skip: (!archiveBinary || !mobileBinary) && 'Set VIENTO_TEST_ARCHIVE_BINARY and VIENTO_MOBILE_STORE_BIN for native migration',
}, async t => {
  const f = await fixture(t), originals = await fingerprint(f.root), native = async (...args) => JSON.parse((await nativeRun(archiveBinary, args, { timeout: 15000 })).stdout);
  const incoming = path.join(f.temporary, 'in.zip'); await writeExportZip(await planExport(f.root, { kind: 'workspace' }), incoming);
  const library = await nativeMobileLibrary(mobileBinary, path.join(f.temporary, 'mobile')); t.after(() => library.close());
  const call = (action, args = {}) => library.invoke('mobile_storage', { action, ...args });
  const work = await call('importArchive', { path: incoming }), projection = f.projections[0];
  const before = await call('read', { workspaceId: work.id, path: projection.sourcePath }), changed = JSON.parse(before.content); changed.configuration.speed = 320;
  await call('save', { workspaceId: work.id, payload: { path: projection.sourcePath, content: json(changed), expectedVersion: before.version } });
  const outgoing = path.join(f.temporary, 'out.zip'); await call('exportArchive', { workspaceId: work.id, path: outgoing });
  const parent = path.join(f.temporary, 'restored'); await fs.mkdir(parent);
  const { root } = await native('import', outgoing, parent), restored = await captureBuildSnapshot(root, f.scene.objectId);
  assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics)); assert.equal(restored.plan.actors[0].speed, 320); assert.equal(restored.plan.actors[1].speed, 0);
  assert.deepEqual(await readRegistry(root), await readRegistry(f.root));
  for (const [file, hash] of Object.entries(originals)) {
    if (file.startsWith('.viento/') || file === projection.sourcePath) continue;
    assert.equal(buildHash(await fs.readFile(path.join(root, file))), hash, file);
  }
  assert.equal(await fs.readFile(path.join(root, projection.sourcePath), 'utf8'), json(changed));
  assert.deepEqual(await fingerprint(f.root), originals);
});

test('real Godot independently runs two inherited projections sharing one OC and emits distinct runtime identities', {
  skip: !godot && 'Set VIENTO_GODOT_BIN for real Godot projection runtime', timeout: 90000,
}, async t => {
  const f = await fixture(t), before = await fingerprint(f.root);
  const built = await buildProject({ root: f.root, scene: f.scene.objectId, output: path.join(f.temporary, 'build'), godot });
  assert.equal(built.ok, true, JSON.stringify(built));
  const result = await runProjectBuild({ buildDirectory: built.buildDirectory, godot }); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.record.events.at(-1).actors, [
    { objectId: f.projections[0].objectId, position: [140, 150], state: 'idle' },
    { objectId: f.projections[1].objectId, position: [200, 150], state: 'idle' },
  ]);
  assert.deepEqual(await fingerprint(f.root), before);
});
