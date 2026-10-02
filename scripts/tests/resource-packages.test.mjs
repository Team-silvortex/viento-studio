import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';
import yauzl from 'yauzl';
import Ajv2020 from 'ajv/dist/2020.js';
import { fixture, write, serve, request } from './helpers.mjs';
import { registerWorkspace, readRegistry, writeJson } from '../lib/workspace.mjs';
import { PROJECT_DEFAULTS } from '../lib/project-layout.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { selectPackageEntries, RESOURCE_PACKAGE_API } from '../../engine/resource-package.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport, recoverPackageImport } from '../lib/resource-package-transaction.mjs';
import { createResourcePackageService } from '../lib/resource-package-service.mjs';

async function project(t, populated = false, version = 3) {
  const root = await fixture(t), documents = version === 3 ? 'documents' : 'design-data', templates = version === 3 ? 'templates' : 'data-template';
  const workspace = { format: 'viento-workspace', version, id: randomUUID(), name: '资源包验证', createdAt: 0,
    paths: { documents, templates, metadata: 'metadata' }, assetStores: { main: { path: 'assets' } }, documentTypes: structuredClone(PROJECT_DEFAULTS.documentTypes) };
  await write(root, 'workspace.json', JSON.stringify(workspace));
  await fs.mkdir(path.join(root, documents), { recursive: true });
  if (populated) {
    await write(root, `${documents}/characters/主角.md`, '# 主角\n\n姓名：小风\n');
    await write(root, `${documents}/stories/背景.md`, '# 背景\n\n大纲保持原样。\n');
    await write(root, `${documents}/places/城镇.md`, '# 城镇\n\n简介：出生地\n');
    await write(root, 'assets/立绘.png', Buffer.from('image bytes'));
    await write(root, 'assets/主题曲.wav', Buffer.from('audio bytes'));
    await write(root, 'assets/字体.woff2', Buffer.from('font bytes'));
    await write(root, 'assets/无关.bin', Buffer.from('unused bytes'));
  }
  await registerWorkspace(root);
  const registry = await readRegistry(root);
  if (!populated) return { root, workspace };
  const hero = registry.documents.find(item => item.sourcePath.includes('/characters/'));
  const story = registry.documents.find(item => item.sourcePath.includes('/stories/'));
  const place = registry.documents.find(item => item.sourcePath.includes('/places/'));
  const image = registry.assets.find(item => item.kind === 'image'), audio = registry.assets.find(item => item.kind === 'audio'), font = registry.assets.find(item => item.kind === 'font');
  hero.relations = [{ kind: 'reference', targetId: place.id, slot: '出生地' }];
  hero.assetBindings = [{ assetId: font.id, role: '字体' }];
  story.relations = [{ kind: 'part-of', targetId: hero.id, slot: '背景故事' }];
  await writeJson(path.join(root, `metadata/documents/${hero.id}.json`), hero);
  await writeJson(path.join(root, `metadata/documents/${story.id}.json`), story);
  await write(root, hero.sourcePath, `# 主角\n\n![立绘](asset:${image.id})\n\n\`\`\`text\nasset:00000000-0000-0000-0000-000000000001\n\`\`\`\n`);
  await write(root, story.sourcePath, `# 背景\n\n大纲保持原样。\n!audio[音乐](asset:${audio.id})\n`);
  return { root, workspace, hero, story, place, image, audio, font };
}

async function exported(t, source, ids, options = {}) {
  const catalog = await readPackageCatalog(source.root);
  const plan = await planExport(source.root, { kind: 'resources', revision: catalog.revision, ids, ...options });
  const output = path.join(source.root, `${randomUUID()}.zip`); await writeExportZip(plan, output);
  const staging = path.join(source.root, `.test-package-${randomUUID()}`); await fs.mkdir(staging);
  return { plan, output, pack: await unpackResourcePackage(output, staging) };
}

test('resource package closes object relationships, owned stories, inline media and non-media bindings', async t => {
  const source = await project(t, true);
  const { plan, pack } = await exported(t, source, [source.hero.id]);
  assert.match(plan.fileName, /\.viento-package\.zip$/);
  assert.equal(plan.documentCount, 3); assert.equal(plan.assetCount, 3);
  assert.deepEqual(new Set(pack.manifest.assets.map(item => item.id)), new Set([source.image.id, source.audio.id, source.font.id]));
  assert.ok(![...pack.files.keys()].some(file => /无关|workspace\.json|cache/.test(file)));
  assert.deepEqual(await fs.readFile(path.join(pack.content, source.story.sourcePath)), await fs.readFile(path.join(source.root, source.story.sourcePath)));
  assert.deepEqual(pack.records.get(source.story.id).record.relations, source.story.relations);
  const schema = JSON.parse(await fs.readFile(new URL('../../schemas/resource-package-v1.schema.json', import.meta.url)));
  const validate = new Ajv2020().compile(schema);
  assert.equal(validate(pack.manifest), true, JSON.stringify(validate.errors));
});

test('round trip into another project preserves identities and raw content, then reuses identical files', async t => {
  const source = await project(t, true), target = await project(t);
  const { pack } = await exported(t, source, [source.hero.id]);
  const before = await fs.readFile(path.join(target.root, 'workspace.json'));
  const preview = await planPackageImport(target.root, pack);
  assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target.root, pack, preview.revision)).status, 'imported');
  const registry = await readRegistry(target.root);
  assert.equal(registry.documents.length, 3); assert.equal(registry.assets.length, 3);
  assert.deepEqual(await fs.readFile(path.join(target.root, source.hero.sourcePath)), await fs.readFile(path.join(source.root, source.hero.sourcePath)));
  assert.deepEqual(await fs.readFile(path.join(target.root, 'workspace.json')), before);
  const again = await planPackageImport(target.root, pack);
  assert.equal(again.summary.newFiles, 0); assert.deepEqual(again.summary.conflicts, []);
  await applyPackageImport(target.root, pack, again.revision);
});

test('individual assets retain arbitrary binary bytes, metadata, paths and an external destination store', async t => {
  const source = await project(t, true), target = await project(t);
  const store = path.join(target.root, '外置素材'); await fs.mkdir(store);
  await write(target.root, '.viento/local.json', JSON.stringify({ version: 1, assetStores: { main: store } }));
  const { pack, plan } = await exported(t, source, [source.font.id, source.audio.id]);
  assert.equal(plan.documentCount, 0); assert.equal(plan.assetCount, 2);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  assert.equal((await readRegistry(target.root)).assets.length, 2);
  assert.deepEqual(await fs.readFile(path.join(store, source.audio.location.path)), await fs.readFile(path.join(source.root, 'assets', source.audio.location.path)));
});

test('deselecting dependencies records requirements and rejects incomplete imports', async t => {
  const source = await project(t, true), target = await project(t);
  const { pack } = await exported(t, source, [source.hero.id], { includeDependencies: false, includeChildren: false });
  assert.equal(pack.manifest.documents.length, 1); assert.equal(pack.manifest.assets.length, 0); assert.equal(pack.manifest.requirements.length, 3);
  const preview = await planPackageImport(target.root, pack);
  assert.ok(preview.summary.conflicts.some(item => item.reason === 'dependency'));
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突/);
  assert.equal((await readRegistry(target.root)).documents.length, 0);
});

test('stale catalogue, changed registered bytes, missing files and changed target reject without publishing', async t => {
  const source = await project(t, true), target = await project(t);
  const { pack } = await exported(t, source, [source.audio.id]);
  const preview = await planPackageImport(target.root, pack);
  await write(target.root, 'assets/another.bin', 'user file');
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /目标项目已变化/);
  assert.equal((await readRegistry(target.root)).assets.length, 0);
  const catalog = await readPackageCatalog(source.root);
  await write(source.root, source.hero.sourcePath, '# changed\n');
  await assert.rejects(planExport(source.root, { kind: 'resources', revision: catalog.revision, ids: [source.hero.id] }), /清单已变化/);
  await write(source.root, 'assets/主题曲.wav', 'changed!!!!');
  const newer = await readPackageCatalog(source.root);
  await assert.rejects(async () => {
    const plan = await planExport(source.root, { kind: 'resources', revision: newer.revision, ids: [source.audio.id] });
    await writeExportZip(plan, path.join(source.root, 'changed.zip'));
  }, /不可用|登记不一致/);
});

test('conflicting paths or changed identities never overwrite target data', async t => {
  const source = await project(t, true), target = await project(t);
  const { pack } = await exported(t, source, [source.audio.id]);
  await write(target.root, 'assets/主题曲.wav', 'keep these user bytes');
  const preview = await planPackageImport(target.root, pack);
  assert.ok(preview.summary.conflicts.length);
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突/);
  assert.equal(await fs.readFile(path.join(target.root, 'assets/主题曲.wav'), 'utf8'), 'keep these user bytes');
});

for (const phase of ['prepared', 'file', 'manifest']) test(`interrupted import at ${phase} fences readers and resumes from durable verified payload`, async t => {
  const source = await project(t, true), target = await project(t), { pack } = await exported(t, source, [source.hero.id]);
  const preview = await planPackageImport(target.root, pack);
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision, undefined, { checkpoint: state => { if (state.phase === phase) throw new Error('interrupted'); } }), /interrupted/);
  await assert.rejects(readRegistry(target.root), /恢复导入/);
  await fs.rm(pack.content, { recursive: true });
  assert.equal((await recoverPackageImport(target.root)).status, 'imported');
  assert.equal((await readRegistry(target.root)).documents.length, 3);
  assert.equal((await recoverPackageImport(target.root)).status, 'idle');
});

test('v2 to v3 maps source roots while preserving metadata extensions and ownership identities', async t => {
  const source = await project(t, true, 2), target = await project(t);
  const metadata = `metadata/documents/${source.hero.id}.json`;
  const raw = (await fs.readFile(path.join(source.root, metadata), 'utf8')).replace('"version": 1', '"extension": 9007199254740993123, "version": 1');
  await write(source.root, metadata, raw);
  const { pack } = await exported(t, source, [source.hero.id]);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  const bytes = await fs.readFile(path.join(target.root, metadata), 'utf8');
  assert.ok(bytes.includes('9007199254740993123')); assert.match(bytes, /documents\/characters/);
  assert.equal((await readRegistry(target.root)).documents.length, 3);
});

test('service expires previews and cancellation removes its private staging files', async t => {
  const source = await project(t, true), target = await project(t), { output } = await exported(t, source, [source.font.id]);
  const service = createResourcePackageService(target.root);
  const preview = await service.inspect(Readable.from(await fs.readFile(output)));
  assert.equal(preview.assetCount, 1); await service.release(preview.id);
  await assert.rejects(service.command({ action: 'import', id: preview.id, revision: preview.revision }), { statusCode: 410 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.inspect(Readable.from(''), controller.signal), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(path.join(target.root, '.viento/cache/resource-packages')), []);
});

test('dependency graph handles reference cycles, duplicate roots and missing identities', () => {
  const entries = [{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }];
  assert.equal(selectPackageEntries(entries, ['a']).selected.length, 2);
  assert.throws(() => selectPackageEntries(entries, ['a', 'a']), /不要重复/);
  assert.throws(() => selectPackageEntries(entries, ['missing']), /清单已变化/);
});

test('custom parsing rules and template dependencies travel with an object, preserving target configuration extensions', async t => {
  const source = await project(t, true), target = await project(t);
  const type = { id: 'species', label: '物种', directory: 'species', parserProfile: 'structured', template: 'species.yaml',
    parserOptions: { titleField: '名字', multilineFieldKeys: ['描述'] }, fieldGroups: [{ title: '设定', fields: ['名字', '描述'] }] };
  source.workspace.documentTypes.push(type); await write(source.root, 'workspace.json', JSON.stringify(source.workspace));
  await write(source.root, 'templates/species.yaml', `名字: 新物种\n插图: asset:${source.image.id}\n`);
  await write(source.root, 'documents/species/bird.yaml', '名字: 鸟\n描述: 保留自定义字段\n');
  await registerWorkspace(source.root);
  const record = (await readRegistry(source.root)).documents.find(item => item.documentType === 'species');
  const targetConfig = (await fs.readFile(path.join(target.root, 'workspace.json'), 'utf8')).replace(/"createdAt":\s*0/, '"extension":9007199254740993123,"createdAt":0');
  await write(target.root, 'workspace.json', targetConfig); await fs.chmod(path.join(target.root, 'workspace.json'), 0o600);
  const { pack } = await exported(t, source, [record.id]);
  assert.deepEqual(pack.manifest.assets.map(asset => asset.id), [source.image.id]);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  const text = await fs.readFile(path.join(target.root, 'workspace.json'), 'utf8');
  assert.ok(text.includes('9007199254740993123'));
  assert.deepEqual(JSON.parse(text).documentTypes.at(-1), type);
  assert.equal((await fs.stat(path.join(target.root, 'workspace.json'))).mode & 0o777, 0o600);
});

test('a package without dependencies imports after matching dependencies are supplied', async t => {
  const source = await project(t, true), target = await project(t);
  const { pack: dependencies } = await exported(t, source, [source.place.id, source.image.id, source.font.id]);
  const dependencyPreview = await planPackageImport(target.root, dependencies);
  await applyPackageImport(target.root, dependencies, dependencyPreview.revision);
  const { pack } = await exported(t, source, [source.hero.id], { includeChildren: false, includeDependencies: false });
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  assert.equal((await readRegistry(target.root)).documents.length, 2);
});

test('registered and unregistered case aliases, occupied identity and symlink destinations are rejected', async t => {
  const source = await project(t, true);
  const { pack } = await exported(t, source, [source.audio.id]);
  for (const conflict of ['identity', 'link', 'case']) {
    const target = await project(t);
    if (conflict === 'identity') {
      await write(target.root, 'assets/主题曲.wav', 'other asset'); await registerWorkspace(target.root);
    } else if (conflict === 'link') {
      await write(target.root, 'keep.txt', 'must survive'); await fs.symlink(path.join(target.root, 'keep.txt'), path.join(target.root, 'assets/主题曲.wav'));
    } else await write(target.root, 'assets/主题曲.WAV', 'case-sensitive name');
    if (conflict === 'link') await assert.rejects(planPackageImport(target.root, pack), /链接|symbolic/);
    else {
      const preview = await planPackageImport(target.root, pack); assert.ok(preview.summary.conflicts.length);
      await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突/);
    }
  }
});

async function mutatedZip(source, pack, mutate) {
  const files = new Map();
  for (const file of pack.files.keys()) files.set(file, { buffer: await fs.readFile(path.join(pack.content, file)) });
  files.set('manifest.json', { buffer: Buffer.from(JSON.stringify(pack.manifest)) });
  mutate(files);
  const file = path.join(source.root, `${randomUUID()}.zip`), zip = new yazl.ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(file, { flags: 'wx' }));
  for (const [name, item] of files) zip.addBuffer(item.buffer, name, { ...(item.mode ? { mode: item.mode } : {}) });
  zip.end(); await done;
  const directory = path.join(source.root, `.inspect-${randomUUID()}`); await fs.mkdir(directory);
  return { file, directory };
}

for (const alteration of ['content', 'missing', 'extra', 'symlink', 'format', 'duplicate-id', 'fingerprint']) test(`package inspection rejects ${alteration} corruption`, async t => {
  const source = await project(t, true), { pack } = await exported(t, source, [source.image.id]);
  const { file, directory } = await mutatedZip(source, pack, files => {
    const assetPath = `assets/${source.image.location.path}`;
    if (alteration === 'content') files.set(assetPath, { buffer: Buffer.alloc(files.get(assetPath).buffer.length, 33) });
    if (alteration === 'missing') files.delete(assetPath);
    if (alteration === 'extra') files.set('extra.txt', { buffer: Buffer.from('unknown') });
    if (alteration === 'symlink') files.get(assetPath).mode = 0o120777;
    if (['format', 'duplicate-id', 'fingerprint'].includes(alteration)) {
      const manifest = structuredClone(pack.manifest);
      if (alteration === 'format') manifest.format = 'viento-archive';
      if (alteration === 'duplicate-id') manifest.assets.push(manifest.assets[0]);
      if (alteration === 'fingerprint') manifest.files[0].sha256 = '0'.repeat(64);
      files.set('manifest.json', { buffer: Buffer.from(JSON.stringify(manifest)) });
    }
  });
  await assert.rejects(unpackResourcePackage(file, directory), /无效|损坏/);
});

test('recovery preserves an unexpectedly edited destination and leaves the journal intact', async t => {
  const source = await project(t, true), target = await project(t), { pack } = await exported(t, source, [source.audio.id]);
  const preview = await planPackageImport(target.root, pack);
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision, undefined, { checkpoint: state => { if (state.phase === 'file') throw new Error('stop'); } }), /stop/);
  const active = JSON.parse(await fs.readFile(path.join(target.root, '.viento/package-import/active/intent.json')));
  const first = active.files[0]; const destination = path.join(target.root, first.store === 'assets' ? 'assets' : '', first.path);
  await fs.writeFile(destination, 'manually repaired bytes');
  await assert.rejects(recoverPackageImport(target.root), /恢复导入/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'manually repaired bytes');
  await fs.access(path.join(target.root, '.viento/package-import/active/intent.json'));
});

test('HTTP catalogue, authenticated preview/import, download and read-only viewer use the same package contract', async t => {
  const source = await project(t, true), target = await project(t);
  const sourceServer = await serve(t, source.root), targetServer = await serve(t, target.root, { DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_TOKEN: 'package-test-token' });
  const catalogue = await request(sourceServer, RESOURCE_PACKAGE_API); assert.equal(catalogue.status, 200);
  const prepared = await request(sourceServer, '/api/export', { kind: 'resources', ids: [source.hero.id], revision: catalogue.data.revision });
  assert.equal(prepared.status, 200);
  const downloaded = await fetch(`${sourceServer}/api/export?id=${prepared.data.id}`); assert.equal(downloaded.status, 200);
  const zip = Buffer.from(await downloaded.arrayBuffer());
  const anonymous = await fetch(`${targetServer}${RESOURCE_PACKAGE_API}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: zip });
  assert.equal(anonymous.status, 401);
  const uploaded = await fetch(`${targetServer}${RESOURCE_PACKAGE_API}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer package-test-token' }, body: zip });
  assert.equal(uploaded.status, 200); const payload = await uploaded.json(), preview = payload.data || payload;
  const imported = await fetch(`${targetServer}${RESOURCE_PACKAGE_API}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer package-test-token' }, body: JSON.stringify({ action: 'import', id: preview.id, revision: preview.revision }) });
  assert.equal(imported.status, 200); assert.equal((await readRegistry(target.root)).documents.length, 3);
  const browse = await serve(t, source.root, {}, 'browse-server.mjs');
  assert.equal((await request(browse, RESOURCE_PACKAGE_API)).status, 200);
  assert.equal((await fetch(`${browse}${RESOURCE_PACKAGE_API}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
});

test('all six registered asset kinds import without format conversion', async t => {
  const source = await project(t, true), target = await project(t);
  await write(source.root, 'assets/preview.mp4', Buffer.from([0, 1, 2, 3, 255]));
  await write(source.root, 'assets/notes.txt', '\uFEFF原始文本\r\n');
  await registerWorkspace(source.root);
  const assets = (await readRegistry(source.root)).assets;
  assert.equal(new Set(assets.map(item => item.kind)).size, 6);
  const { pack } = await exported(t, source, assets.map(item => item.id));
  const preview = await planPackageImport(target.root, pack); await applyPackageImport(target.root, pack, preview.revision);
  for (const asset of assets) assert.deepEqual(await fs.readFile(path.join(target.root, 'assets', asset.location.path)), await fs.readFile(path.join(source.root, 'assets', asset.location.path)));
});

test('a resource package imported into a project remains compatible with native full-project migration', { skip: !process.env.VIENTO_TEST_ARCHIVE_BINARY }, async t => {
  const source = await project(t, true), target = await project(t), { pack } = await exported(t, source, [source.hero.id]);
  const preview = await planPackageImport(target.root, pack); await applyPackageImport(target.root, pack, preview.revision);
  const binary = process.env.VIENTO_TEST_ARCHIVE_BINARY, archive = path.join(target.root, 'after-import.viento.zip');
  const run = promisify(execFile);
  await run(binary, ['export', target.root, archive]);
  const parent = path.join(target.root, 'restored'); await fs.mkdir(parent);
  const restored = JSON.parse((await run(binary, ['import', archive, parent])).stdout).root;
  assert.deepEqual(await readRegistry(restored), await readRegistry(target.root));
  await assert.rejects(fs.stat(path.join(restored, '.viento/package-import')), { code: 'ENOENT' });
});

test('cancelling during a late ZIP open closes its file before staging is released', async t => {
  const source = await project(t, true), { output } = await exported(t, source, [source.font.id]);
  const directory = path.join(source.root, 'cancel-inspection'); await fs.mkdir(directory);
  const original = yauzl.openPromise, controller = new AbortController();
  let opened, closed = false, resume;
  const ready = new Promise(resolve => { opened = resolve; });
  yauzl.openPromise = async (...args) => {
    const zip = await original(...args); zip.once('close', () => { closed = true; });
    await new Promise(resolve => { resume = resolve; opened(); }); return zip;
  };
  t.after(() => { yauzl.openPromise = original; });
  const result = unpackResourcePackage(output, directory, controller.signal);
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await ready; controller.abort(); resume(); await rejected;
  assert.equal(closed, true); assert.deepEqual(await fs.readdir(directory), []);
});
