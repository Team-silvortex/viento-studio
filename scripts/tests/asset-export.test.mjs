import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, write, serve, request } from './helpers.mjs';
import { registerWorkspace, readRegistry, writeJson } from '../lib/workspace.mjs';
import { PROJECT_DEFAULTS } from '../lib/project-layout.mjs';
import { assetExportFileName, planExport, writeExportFile } from '../lib/export-package.mjs';
import { createExportService } from '../lib/export-service.mjs';
import { runCommand } from '../lib/process.mjs';
import { dialogHarness } from './dialog-harness.mjs';
import { API_PATHS } from '../lib/doc-api-contract.mjs';
import { fetchWithTimeout, makeRequestError, safeParseJsonResponse } from '../../web/modules/app-services.js';

const originals = new Map([
  ['立绘 #100%.png', Buffer.from('89504e470d0a1a0a0000010002ff00', 'hex')],
  ['片段%20空 格.mp4', Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')],
  ['主题曲.wav', Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex')],
  ['empty.txt', Buffer.alloc(0)],
]);
async function project(t, version = 3) {
  const root = await fixture(t), folder = version === 3 ? 'documents' : 'design-data';
  await write(root, 'workspace.json', JSON.stringify({ format: 'viento-workspace', version, id: randomUUID(), name: '单个素材导出', createdAt: 0,
    paths: { ...PROJECT_DEFAULTS.paths, documents: folder, templates: version === 3 ? 'templates' : 'data-template' }, assetStores: PROJECT_DEFAULTS.assetStores,
    ...(version === 3 ? { documentTypes: PROJECT_DEFAULTS.documentTypes } : {}) }));
  await write(root, `${folder}/角色.md`, '\uFEFF# 原文\r\n不参与单文件导出。\r\n');
  for (const [name, bytes] of originals) await write(root, `external/${name}`, bytes);
  await write(root, '.viento/local.json', JSON.stringify({ version: 1, assetStores: { main: path.join(root, 'external') } }));
  await registerWorkspace(root);
  // Unrelated incomplete draft files do not need parsing to export an asset.
  await write(root, `${folder}/未完成.json`, '{');
  return { root, assets: (await readRegistry(root)).assets };
}

for (const version of [2, 3]) test(`v${version} exports one external image/video/audio as exact original bytes`, async t => {
  const { root, assets } = await project(t, version), service = createExportService(root);
  const before = await fs.readFile(path.join(root, 'workspace.json'));
  for (const asset of assets) {
    const record = await fs.readFile(path.join(root, `metadata/assets/${asset.id}.json`));
    const job = await service.create({ kind: 'asset', assetId: asset.id });
    try {
      assert.equal(job.fileName, asset.location.path);
      assert.equal(job.assetCount, 1); assert.equal(job.documentCount, 0);
      assert.deepEqual(await fs.readFile(service.get(job.id).file), originals.get(asset.location.path));
      assert.deepEqual(await fs.readFile(path.join(root, `metadata/assets/${asset.id}.json`)), record);
    } finally { await service.release(job.id); }
    assert.deepEqual(await fs.readFile(path.join(root, 'external', asset.location.path)), originals.get(asset.location.path));
  }
  assert.deepEqual(await fs.readFile(path.join(root, 'workspace.json')), before);
  assert.deepEqual(await fs.readdir(path.join(root, '.viento/cache/exports')), []);
});

test('original filenames distinguish registry stems, uploaded names, repeated extensions and portable fallback', () => {
  for (const [name, location, expected] of [
    ['原图 #100%.PNG', 'media/images/uuid.png', '原图 #100%.PNG'],
    ['主题曲', '主题曲.wav', '主题曲.wav'],
    ['photo.png', 'photo.png.png', 'photo.png.png'],
    ['a%20b', 'a%20b.mp4', 'a%20b.mp4'],
    ['CON', 'safe.wav', 'asset.wav'],
    ['../输入"\n图', 'safe.png', '.._输入__图.png'],
    ['资料', 'no-extension', '资料'],
  ]) assert.equal(assetExportFileName({ name, location: { path: location } }), expected);
  const long = assetExportFileName({ name: '画'.repeat(120), location: { path: 'uuid.png' } });
  assert.ok(Buffer.byteLength(long) <= 240); assert.ok(long.endsWith('.png'));
});

test('UUID-named uploads keep the authored filename and reject unknown IDs or arbitrary paths', async t => {
  const { root, assets } = await project(t), asset = assets.find(a => a.kind === 'image');
  const target = `media/images/${asset.id}.png`;
  await write(root, `external/${target}`, originals.get(asset.location.path));
  asset.name = '原图 #100%.PNG'; asset.location.path = target;
  await writeJson(path.join(root, `metadata/assets/${asset.id}.json`), asset);
  const plan = await planExport(root, { kind: 'asset', assetId: asset.id });
  assert.equal(plan.fileName, asset.name);
  for (const assetId of [undefined, '../workspace.json', randomUUID(), assets[0].location.path]) {
    await assert.rejects(planExport(root, { kind: 'asset', assetId }), error => error.statusCode === 404);
  }
});

test('missing, changed and linked resources cannot publish a raw export; a repaired file can retry', async t => {
  const { root, assets } = await project(t), asset = assets.find(a => a.kind === 'audio'), service = createExportService(root);
  const file = path.join(root, 'external', asset.location.path), original = originals.get(asset.location.path);
  await fs.writeFile(file, Buffer.alloc(original.length, 0x7f));
  await assert.rejects(service.create({ kind: 'asset', assetId: asset.id }), /登记不一致/);
  assert.deepEqual(await fs.readdir(path.join(root, '.viento/cache/exports')), []);
  await fs.rm(file);
  await assert.rejects(service.create({ kind: 'asset', assetId: asset.id }), /缺失/);
  await fs.symlink(path.join(root, 'workspace.json'), file);
  await assert.rejects(service.create({ kind: 'asset', assetId: asset.id }), /link|链接|范围/);
  await fs.rm(file); await fs.writeFile(file, original);
  const job = await service.create({ kind: 'asset', assetId: asset.id });
  assert.deepEqual(await fs.readFile(service.get(job.id).file), original); await service.release(job.id);
});

test('raw export rejects source replacement and metadata changes between planning and publication', async t => {
  const { root, assets } = await project(t), asset = assets.find(a => a.kind === 'video');
  const file = path.join(root, 'external', asset.location.path);
  const plan = await planExport(root, { kind: 'asset', assetId: asset.id });
  await fs.rm(file); await fs.writeFile(file, originals.get(asset.location.path));
  await assert.rejects(writeExportFile(plan, path.join(root, 'never-publish')), /发生变化/);
  const fresh = await planExport(root, { kind: 'asset', assetId: asset.id });
  asset.name = 'renamed'; await writeJson(path.join(root, `metadata/assets/${asset.id}.json`), asset);
  await assert.rejects(writeExportFile(fresh, path.join(root, 'staged-only')), /登记信息发生变化/);
});

for (const script of ['doc-site-server.mjs', 'browse-server.mjs']) test(`${script}: authenticated raw downloads use their real MIME, names and ranges`, async t => {
  const { root, assets } = await project(t), base = await serve(t, root, { DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_TOKEN: 'asset-export-token' }, script);
  const send = body => fetch(`${base}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': 'asset-export-token' }, body: JSON.stringify(body) });
  const unauthorized = await request(base, '/api/export', { kind: 'asset', assetId: assets[0].id });
  assert.equal(unauthorized.status, 401);
  const client = await dialogHarness('app-doc-service', { API_PATHS, makeRequestError, safeParseJsonResponse,
    fetchWithTimeout: (url, ...args) => fetchWithTimeout(new URL(url, base).href, ...args) });
  for (const asset of assets) {
    const prepared = await send({ kind: 'asset', assetId: asset.id });
    assert.equal(prepared.status, 200); const { data: job } = await prepared.json();
    await client.runtime.checkExport(job.id);
    const response = await fetch(`${base}/api/export?id=${job.id}`);
    assert.equal(response.status, 200);
    const type = { image: 'image/png', video: 'video/mp4', audio: 'audio/wav', text: 'text/plain; charset=utf-8' }[asset.kind];
    assert.equal(response.headers.get('content-type'), type);
    assert.ok(response.headers.get('content-disposition').endsWith(`UTF-8''${encodeURIComponent(job.fileName)}`));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), originals.get(asset.location.path));
    if (asset.content.size) {
      const partial = await fetch(`${base}/api/export?id=${job.id}`, { headers: { Range: 'bytes=1-4' } });
      assert.equal(partial.status, 206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), originals.get(asset.location.path).subarray(1, 5));
    }
    assert.equal((await send({ action: 'release', id: job.id })).status, 200);
    assert.equal((await fetch(`${base}/api/export?id=${job.id}`)).status, 410);
  }
});

for (const stage of ['open', 'read', 'close']) test(`cancelling a raw export during ${stage} waits for file cleanup and keeps original bytes`, async t => {
  const { root, assets } = await project(t), asset = assets.find(a => a.kind === 'audio');
  await runCommand(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { createExportService } from './scripts/lib/export-service.mjs';
    const stage = ${JSON.stringify(stage)}, asset = ${JSON.stringify(asset)}, root = process.cwd();
    const file = path.join(root, 'external', asset.location.path), original = await fs.readFile(file);
    let resume, entered, closed = false, held = false;
    const ready = new Promise(resolve => entered = resolve), gate = new Promise(resolve => resume = resolve);
    const pause = async kind => { if (kind === stage && !held) { held = true; entered(); await gate; } };
    const open = fs.open;
    fs.open = async (name, ...args) => {
      const handle = await open(name, ...args);
      if (name === file) {
        const read = handle.read.bind(handle), close = handle.close.bind(handle);
        handle.read = async (...args) => { const result = await read(...args); await pause('read'); return result; };
        handle.close = async (...args) => { await pause('close'); const result = await close(...args); closed = true; return result; };
        await pause('open');
      }
      return handle;
    };
    const service = createExportService(root), controller = new AbortController(), reason = new Error('cancel raw');
    let settled = false;
    const task = service.create({ kind: 'asset', assetId: asset.id }, controller.signal).finally(() => settled = true);
    const rejected = assert.rejects(task, error => error === reason);
    await ready; controller.abort(reason); await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false); resume(); await rejected; assert.equal(closed, true);
    assert.deepEqual(await fs.readdir(path.join(root, '.viento/cache/exports')), []);
    fs.open = open;
    const retry = await service.create({ kind: 'asset', assetId: asset.id });
    assert.deepEqual(await fs.readFile(service.get(retry.id).file), original); await service.release(retry.id);
    assert.deepEqual(await fs.readFile(file), original);
  `], { cwd: root, timeoutMs: 20000 });
});
