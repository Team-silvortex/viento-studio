import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve, request } from './helpers.mjs';
import { readRegistry, verifyWorkspace } from '../lib/workspace.mjs';
import { mediaMarkup } from '../lib/media-format.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const binary = process.env.VIENTO_TEST_ARCHIVE_BINARY;
const ffmpeg = process.env.VIENTO_FFMPEG_BIN || '/usr/bin/ffmpeg';
const execute = promisify(execFile), digest = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['scripts/lib/project-templates.json', 'scripts/lib/project-layout.mjs', 'engine/project.mjs',
  'engine/document-store.mjs', 'engine/media-format.mjs', 'engine/media-insertion.mjs', 'scripts/lib/media-assets.mjs',
  'scripts/lib/media-insertion.mjs', 'scripts/lib/project-documents.mjs', 'scripts/lib/workspace.mjs',
  'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs', 'scripts/adapters/node-document-storage.mjs',
  'scripts/standardize-docs/doc-factory.mjs', 'src-tauri/src/workspace.rs', 'src-tauri/src/project_templates.rs',
  'src-tauri/examples/workspace-archive.rs', 'scripts/tests/film-template-workflow.test.mjs'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, digest(await fs.readFile(path.join(app, name)))])));
async function authorInventory(root) {
  const result = {};
  for (const row of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!row.isFile()) continue;
    const file = path.join(row.parentPath || row.path, row.name), name = path.relative(root, file).split(path.sep).join('/');
    if (name.startsWith('.viento/') && name !== '.viento/workspace.json') continue;
    result[name] = digest(await fs.readFile(file));
  }
  return Object.fromEntries(Object.entries(result).sort());
}
const pcm = () => {
  const bytes = Buffer.alloc(44 + 800, 128); bytes.fill(0, 0, 44);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(8000, 28); bytes.writeUInt16LE(1, 32); bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
};

test('an empty film workspace preserves typed scenes, shots and uploaded PNG/WAV/MP4 identities through real Rust ZIP relocation', {
  skip: !binary && 'Set VIENTO_TEST_ARCHIVE_BINARY to a freshly compiled unmodified workspace archive wrapper', timeout: 180000,
}, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-film-media-')), shutdown = [];
  const output = process.env.VIENTO_FILM_MEDIA_EVIDENCE_DIR && path.resolve(process.env.VIENTO_FILM_MEDIA_EVIDENCE_DIR);
  if (output) { assert.ok(output.startsWith('/tmp/'), 'Collect fresh media evidence in /tmp only.'); await fs.mkdir(output, { recursive: true }); assert.deepEqual(await fs.readdir(output), []); }
  const report = { format: 'viento-film-template-media-workflow', schemaVersion: 1, startedAt: new Date().toISOString(), commands: [], http: [], limitations: [
    'Actual Rust workspace creation/export/import and HTTP editing/uploads on an empty temporary film project; no installed-app, Android-media, timeline editing or video rendering claim.',
    'The tiny PNG/MP4 are generated locally and PNG/WAV/MP4 are decoded by ffmpeg only to establish valid input bytes. Studio uploads, references, indexes and delivers them without transcoding.'
  ] };
  const run = async (command, args, options = {}) => {
    const result = await execute(command, args, { cwd: app, maxBuffer: 8 * 1024 * 1024, ...options });
    report.commands.push({ command, args, exitCode: 0, stdout: result.stdout, stderr: result.stderr }); return result;
  };
  const native = async args => JSON.parse((await run(binary, args)).stdout);
  const envFor = root => ({ ...process.env, VIENTO_APP_ROOT: app, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temp, 'xdg/cache'), XDG_CONFIG_HOME: path.join(temp, 'xdg/config'), XDG_DATA_HOME: path.join(temp, 'xdg/data') });
  const start = async root => {
    await run(process.execPath, [path.join(app, 'scripts/ops/rebuild.mjs')], { env: envFor(root) });
    const callbacks = [], base = await serve({ after: fn => callbacks.push(fn) }, app, envFor(root));
    shutdown.push(...callbacks); return { base, close: async () => { for (const fn of callbacks) await fn(); } };
  };
  const api = async (base, url, body) => { const result = await request(base, url, body); report.http.push({ method: body === undefined ? 'GET' : 'POST', path: url, status: result.status }); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  try {
    report.sourcesBefore = await sourceHashes(); report.tool = { archive: { binary, sha256: digest(await fs.readFile(binary)) }, node: { binary: process.execPath, version: process.version } };
    const templates = await native(['templates']); assert.ok(JSON.stringify(templates).includes('org.viento.oc-film'));
    const parent = path.join(temp, 'original'); await fs.mkdir(parent);
    const root = (await native(['create', parent, 'Film Media Roundtrip', 'org.viento.oc-film'])).root;
    const createdManifestBytes = await fs.readFile(path.join(root, 'workspace.json')), manifest = JSON.parse(createdManifestBytes);
    assert.equal(manifest.projectTemplate.packageId, 'org.viento.oc-film');
    assert.deepEqual(manifest.documentTypes.map(row => row.id), ['document', 'character', 'outline', 'scene', 'shot', 'location', 'production-plan', 'prop']);
    assert.deepEqual(manifest.documentTypes.filter(row => row.parserProfile === 'prose').map(row => row.id), ['outline', 'scene']);
    const emptyRegistry = await readRegistry(root); assert.equal(emptyRegistry.documents.length, 0); assert.equal(emptyRegistry.assets.length, 0);
    report.emptyAuthor = await authorInventory(root); const templateHashes = Object.fromEntries(Object.entries(report.emptyAuthor).filter(([name]) => name.startsWith('templates/'))); assert.equal(Object.keys(templateHashes).length, 8);
    const original = await start(root), base = original.base;
    const manifestBytes = await fs.readFile(path.join(root, 'workspace.json'));
    assert.deepEqual(JSON.parse(manifestBytes), manifest, 'initial indexing must preserve all manifest values');
    report.initialManifest = { createdSha256: digest(createdManifestBytes), indexedSha256: digest(manifestBytes), semanticallyEqual: true, note: 'Existing Node registration canonicalizes layout object key ordering at first indexing. The authored/export baseline below includes that explicit index operation.' };
    const scenePath = 'documents/scenes/S01.md', shotPath = 'documents/shots/S01-01.json';
    const scene = '\uFEFF# 场次01 雨夜站台\r\n\r\n场次编号：01\r\n时间与地点：雨夜，站台\r\n\r\n人物甲：你听见了吗？\r\n\r\n人物乙：火车还没有来。\r\n';
    const shot = '\uFEFF{ "title": "分镜01", "镜头号": "S01-01", "景别": "中景", "运镜": "缓慢推进", "预计时长": 0, "需要补拍": false, "媒体": [] }\r\n';
    await api(base, '/api/doc', { path: scenePath, content: scene, documentType: 'scene', create: true });
    await api(base, '/api/doc', { path: shotPath, content: shot, documentType: 'shot', create: true });
    const registered = await readRegistry(root), sceneRecord = registered.documents.find(row => row.sourcePath === scenePath), shotRecord = registered.documents.find(row => row.sourcePath === shotPath);
    assert.equal(sceneRecord.parserProfile, 'prose'); assert.equal(shotRecord.parserProfile, 'structured');
    const recordsBefore = Object.fromEntries(await Promise.all([sceneRecord, shotRecord].map(async row => [row.id, digest(await fs.readFile(path.join(root, 'metadata/documents', row.id + '.json')))])));
    const clip = path.join(temp, 'reference.mp4'), picture = path.join(temp, 'reference.png'), sound = path.join(temp, 'reference.wav');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x88ccff:s=32x24', '-frames:v', '1', '-threads', '1', '-y', picture]);
    await fs.writeFile(sound, pcm());
    for (const source of [picture, sound]) await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source, '-f', 'null', '-']);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x88ccff:s=32x24:r=5', '-t', '0.4', '-an', '-c:v', 'mpeg4', '-q:v', '8', '-movflags', '+faststart', '-y', clip]);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', clip, '-f', 'null', '-']);
    report.fixtureDecoding = { image: true, audio: true, video: true, tool: ffmpeg, scope: 'Input validation by ffmpeg only; no Studio playback, editing or rendering claim.' };
    const media = [['分镜参考.png', 'image', await fs.readFile(picture)], ['对白参考.wav', 'audio', await fs.readFile(sound)], ['运动参考.mp4', 'video', await fs.readFile(clip)]];
    const uploaded = [];
    for (const [name, kind, bytes] of media) {
      const upload = async filename => { const response = await fetch(`${base}/api/assets?name=${encodeURIComponent(filename)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }); report.http.push({ method: 'POST', path: '/api/assets', name: filename, status: response.status }); assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).data; };
      const first = await upload(name), repeated = await upload('重复-' + name); assert.equal(repeated.reused, true); assert.equal(repeated.asset.id, first.asset.id); assert.equal(first.asset.kind, kind);
      uploaded.push({ asset: first.asset, bytes, sha256: digest(bytes) });
    }
    const expectedAssetRecords = (await readRegistry(root)).assets;
    report.assetRecords = expectedAssetRecords;
    report.uploads = uploaded.map(({ asset, bytes, sha256 }) => ({ asset, bytes: bytes.length, sha256, reusedIdentity: true }));
    const withReferences = scene + '\r\n## 参考素材\r\n\r\n' + uploaded.map(({ asset }) => mediaMarkup({ id: asset.id, kind: asset.kind, name: asset.name })).join('\r\n\r\n') + '\r\n';
    const sceneRead = await api(base, `/api/doc?path=${encodeURIComponent(scenePath)}`); await api(base, '/api/doc', { path: scenePath, content: withReferences, expectedVersion: sceneRead.version });
    const inserted = await api(base, '/api/assets/insert', { content: shot, sourcePath: shotPath, assetIds: uploaded.map(({ asset }) => asset.id) });
    assert.equal(await fs.readFile(path.join(root, shotPath), 'utf8'), shot, 'media preparation must not save');
    assert.ok(inserted.content.startsWith(shot.slice(0, shot.indexOf('[]')))); assert.ok(inserted.content.endsWith(' }\r\n'));
    const parsedShot = JSON.parse(inserted.content.slice(1)); assert.equal(parsedShot['预计时长'], 0); assert.equal(parsedShot['需要补拍'], false);
    const shotRead = await api(base, `/api/doc?path=${encodeURIComponent(shotPath)}`); await api(base, '/api/doc', { path: shotPath, content: inserted.content, expectedVersion: shotRead.version });
    await api(base, '/api/rebuild', {});
    const expectedSources = { [scenePath]: withReferences, [shotPath]: inserted.content };
    const inspect = async (selectedRoot, selectedBase) => {
      const registry = await readRegistry(selectedRoot); assert.deepEqual(registry.documents, registered.documents); assert.equal(registry.assets.length, 3);
      const index = JSON.parse(await fs.readFile(path.join(selectedRoot, '.viento/cache/indexes/documents.json'), 'utf8')); assert.equal(index.docs.length, 2);
      assert.deepEqual(new Set(index.docs.map(row => row.id)), new Set(registered.documents.map(row => row.id)));
      for (const [sourcePath, expected] of Object.entries(expectedSources)) {
        assert.equal((await api(selectedBase, `/api/doc?path=${encodeURIComponent(sourcePath)}`)).content, expected);
        const preview = await api(selectedBase, '/api/assets/insert', { content: expected, sourcePath }); assert.deepEqual(new Set(preview.media.map(row => row.type)), new Set(['image', 'audio', 'video']));
        const doc = index.docs.find(row => row.source.path.endsWith(sourcePath)); assert.ok(doc); assert.deepEqual(new Set(doc.assetRefs), new Set(uploaded.map(({ asset }) => asset.id)));
      }
      for (const { asset, bytes } of uploaded) {
        const record = registry.assets.find(row => row.id === asset.id);
        assert.deepEqual(record, expectedAssetRecords.find(row => row.id === asset.id));
        assert.equal(record.kind, asset.kind); assert.equal(record.name, asset.name);
        assert.equal(record.content.sha256, digest(bytes)); assert.equal(record.content.size, bytes.length);
        const response = await fetch(`${selectedBase}/asset-files/${asset.id}`); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
      for (const [id, before] of Object.entries(recordsBefore)) assert.equal(digest(await fs.readFile(path.join(selectedRoot, 'metadata/documents', id + '.json'))), before);
      assert.equal((await verifyWorkspace(selectedRoot)).ok, true); return { registry, index };
    };
    const beforeInspect = await inspect(root, base); report.authorBeforeExport = await authorInventory(root);
    for (const [name, before] of Object.entries(templateHashes)) assert.equal(report.authorBeforeExport[name], before);
    const archive = path.join(temp, 'film-media.viento.zip'); report.export = await native(['export', root, archive]); report.archive = { bytes: (await fs.stat(archive)).size, sha256: digest(await fs.readFile(archive)) }; report.verify = await native(['verify', archive]);
    assert.deepEqual(await authorInventory(root), report.authorBeforeExport);
    await original.close(); const moved = root + '.offline'; await fs.rename(root, moved); await assert.rejects(fs.access(root), { code: 'ENOENT' }); report.originalUnavailable = true;
    const restoredParent = path.join(temp, 'relocated'); await fs.mkdir(restoredParent); const restored = (await native(['import', archive, restoredParent])).root;
    assert.deepEqual(await authorInventory(restored), report.authorBeforeExport);
    const relocated = await start(restored), afterInspect = await inspect(restored, relocated.base); assert.deepEqual(afterInspect.registry, beforeInspect.registry);
    report.authorAfterImport = await authorInventory(restored); assert.deepEqual(report.authorAfterImport, report.authorBeforeExport); assert.deepEqual(await authorInventory(moved), report.authorBeforeExport);
    assert.deepEqual(await fs.readFile(path.join(restored, 'workspace.json')), manifestBytes); assert.equal(digest(await fs.readFile(archive)), report.archive.sha256);
    report.indexEvidence = { before: beforeInspect.index.docs.map(row => ({ id: row.id, sourcePath: row.source.path, assetRefs: row.assetRefs })), after: afterInspect.index.docs.map(row => ({ id: row.id, sourcePath: row.source.path, assetRefs: row.assetRefs })) };
    report.documentIds = registered.documents.map(({ id, documentType, sourcePath, parserProfile }) => ({ id, documentType, sourcePath, parserProfile })); report.projectId = manifest.id; report.template = manifest.projectTemplate; report.templateHashes = templateHashes;
    report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); report.ok = true;
    if (output) {
      await fs.copyFile(archive, path.join(output, 'film-media.viento.zip'));
      const retained = path.join(output, 'author-final');
      for (const name of Object.keys(report.authorAfterImport)) { const file = path.join(retained, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(path.join(restored, name), file); }
      assert.deepEqual(await authorInventory(retained), report.authorAfterImport);
    }
  } catch (error) { report.ok = false; report.failure = error.stack || String(error); throw error; }
  finally {
    for (const close of shutdown.reverse()) await close(); report.finishedAt = new Date().toISOString();
    if (output) await fs.writeFile(path.join(output, 'workflow.json'), JSON.stringify(report, null, 2) + '\n');
    await fs.rm(temp, { recursive: true, force: true });
  }
});
