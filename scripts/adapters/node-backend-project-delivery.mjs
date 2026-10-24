// Read-only delivery planning and verification. Never adopts or executes a package.
import fs from 'node:fs/promises';
import { constants, open as openFile, close as closeFile, fstat as statFile } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { createBackendProjectDeliveryReview, validateBackendProjectDeliveryReview } from '../../engine/backend-project-delivery.mjs';
import { BACKEND_PROJECT_MANIFEST_MAX_BYTES } from '../../engine/backend-project.mjs';
import { portablePath, assertPortableFileTree } from '../lib/workspace.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

const MANIFEST_BYTES = 8 * 1024 * 1024, README_BYTES = 16 * 1024;
const FILE_BYTES = 32 * 1024 * 1024, TOTAL_BYTES = 256 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const identity = stat => `${stat.dev}:${stat.ino}`;
const fail = (code = 'backend_project_delivery_invalid') => { throw Object.assign(new Error('The backend project delivery is invalid or changed.'), { errorCode: code, statusCode: 409 }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const openFd = promisify(openFile), closeFd = promisify(closeFile), statFd = promisify(statFile);
// ZIP CRC is independent of the provenance SHA-256: ordinary extractors must
// accept the same bytes. Keep the incremental implementation usable on Node 18.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes, previous = 0) {
  let crc = previous ^ 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readme(review) {
  const p = review.project, rust = p.project.kind === 'bevy-rust-project';
  return Buffer.from(`# Viento backend project delivery / 后端工程交付 / バックエンドプロジェクト配布\n\n`
    + `Backend: ${p.backend.id}\nProject kind: ${p.project.kind}\nEntry: ${p.project.entry}\n`
    + (p.schemaVersion === 2 ? `Assembly / 组装 / 組立: ${p.source.assemblyId}\nEntry scene / 启动场景 / 起動シーン: ${p.source.entrySceneId}\nScenes / 场景 / シーン: ${p.source.scenes.length}\nInventory / 清单 / 一覧: project/assembly.json\n` : '')
    + `Build: ${p.buildId}\nTool: ${p.tool.version}\nTool SHA-256: ${p.tool.sha256}\nTool platform: ${p.tool.platform}/${p.tool.arch}\n\n`
    + `中文\n这是由已保存作者输入生成的派生工程，不是独立可执行程序。解压后从上述入口打开；Godot 工程需要兼容的 Godot，${rust ? 'Bevy Rust 工程包含 Cargo.toml、Cargo.lock 和作者 Rust 源码副本；Studio 使用 Cargo/rustc 1.95.0 与 Bevy 0.19.1。请在 project 目录执行 cargo build --locked --offline（需要预先缓存依赖），再运行 target/debug/viento-bevy-behaviors --scene /绝对路径/project/scene-data.json --smoke。' : 'Bevy 场景数据需要对应的可信运行程序，不是 Cargo 源工程。'}工具程序未包含。包内仅有登记的生成文件、素材副本和构建所需脚本副本。原始作者输入、完整快照、运行日志、缓存和本机配置未打包；清单中的来源与证据仅为审计引用。需要继续作者编辑或完整迁移，请另行使用 .viento.zip 源项目包。修改派生工程不会回写作者工程。校验包内容不等于授予运行权限，运行脚本前应审阅来源。\n\n`
    + `English\nThis is a derived project generated from saved author inputs, not a standalone executable. After extraction, open the entry above. Godot projects require compatible Godot; ${rust ? 'The Bevy Rust project includes Cargo.toml, Cargo.lock and author Rust source copies; Studio uses Cargo/rustc 1.95.0 and Bevy 0.19.1. In the project directory, run cargo build --locked --offline (dependencies must already be cached), then target/debug/viento-bevy-behaviors --scene /absolute/path/project/scene-data.json --smoke.' : 'Bevy scene data requires the corresponding trusted runtime and is not a Cargo source project.'} No tool executable is bundled. Only registered generated files, resource copies and required script copies are included. Original author inputs, the complete snapshot, runtime logs, caches and local configuration are excluded; provenance and evidence entries are audit references only. Use a separate .viento.zip source project package for author editing or full migration. Changes to this derived project do not update author inputs. Content verification grants no execution permission; review script origins before running.\n\n`
    + `日本語\nこれは保存済みの作者データから生成した派生プロジェクトであり、単独実行形式ではありません。展開後は上記の入口を開いてください。Godot プロジェクトには互換性のある Godot が必要です。${rust ? 'Bevy Rust プロジェクトには Cargo.toml、Cargo.lock、作者の Rust ソースのコピーが含まれます。Studio は Cargo/rustc 1.95.0 と Bevy 0.19.1 を使用します。依存関係をキャッシュした上で project ディレクトリ内から cargo build --locked --offline を実行し、target/debug/viento-bevy-behaviors --scene /absolute/path/project/scene-data.json --smoke で起動してください。' : 'Bevy のシーンデータには対応する信頼済みランタイムが必要で、Cargo ソースプロジェクトではありません。'}実行ツールは同梱しません。登録された生成ファイル、素材のコピー、必要なスクリプトのコピーのみを含みます。作者の元データ、完全なスナップショット、実行ログ、キャッシュ、ローカル設定は含みません。来歴と証拠の項目は監査用の参照です。作者データの編集や完全な移行には別途 .viento.zip を使用してください。派生プロジェクトの変更は作者データへ反映されません。内容の検証は実行権限を付与しません。スクリプトは出所を確認してから実行してください。\n`);
}

async function checkedRoot(directory, rootIdentity) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory
    || rootIdentity && identity(stat) !== rootIdentity) fail('backend_project_delivery_changed');
  return identity(stat);
}

async function checkedFile(base, relative, expected, signal, previous, collect = false) {
  signal?.throwIfAborted();
  const file = await resolveContainedPath(base, path.join(base, relative));
  const input = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let reader;
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== expected.size || previous && signature(stat) !== signature(previous)) fail('backend_project_delivery_changed');
    const digest = createHash('sha256'), chunks = []; let size = 0;
    reader = input.createReadStream({ autoClose: false });
    if (signal) addAbortSignal(signal, reader);
    for await (const chunk of reader) {
      signal?.throwIfAborted(); size += chunk.length;
      if (size > expected.size) fail('backend_project_delivery_changed');
      digest.update(chunk); if (collect) chunks.push(chunk);
    }
    if (size !== expected.size || digest.digest('hex') !== expected.sha256 || signature(await input.stat()) !== signature(stat)
      || signature(await fs.lstat(await resolveContainedPath(base, file))) !== signature(stat)) fail('backend_project_delivery_changed');
    return { stat, ...(collect ? { bytes: Buffer.concat(chunks) } : {}) };
  } finally { reader?.destroy(); await input.close(); }
}

export async function planBackendProjectDelivery({ inspection, assertCurrent, signal } = {}) {
  signal?.throwIfAborted();
  if (typeof assertCurrent !== 'function' || inspection?.inspection?.recorded !== true
    || typeof inspection.buildDirectory !== 'string' || !path.isAbsolute(inspection.buildDirectory)) fail();
  const review = createBackendProjectDeliveryReview(inspection.project, inspection.inspection.manifestSha256);
  const base = inspection.buildDirectory, original = canonicalJson(review), rootIdentity = await checkedRoot(base);
  const allowed = [...review.project.files.map(file => file.path), 'README.md', 'manifest.json'];
  if (allowed.some(name => !portablePath(name))) fail();
  try { assertPortableFileTree(allowed); } catch { fail(); }
  const manifestPath = path.join(base, 'backend-project.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (manifestStat.size > BACKEND_PROJECT_MANIFEST_MAX_BYTES) fail();
  const manifestExpected = { size: manifestStat.size, sha256: review.manifestSha256 };
  const checkManifest = async checkSignal => {
    const { bytes } = await checkedFile(base, 'backend-project.json', manifestExpected, checkSignal, manifestStat, true);
    let parsed; try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(); }
    if (canonicalJson(createBackendProjectDeliveryReview(parsed, review.manifestSha256)) !== original) fail('backend_project_delivery_changed');
  };
  await checkManifest(signal);
  const entries = [];
  for (const file of review.project.files) {
    const expected = { size: file.size, sha256: file.sha256 };
    const { stat } = await checkedFile(base, file.path, expected, signal);
    entries.push({ path: file.path, base, relative: file.path, stat, expected });
  }
  const buffer = readme(review);
  if (buffer.length > README_BYTES) fail();
  entries.push({ path: 'README.md', buffer });
  const archiveManifest = { format: 'viento-build-delivery', schemaVersion: 1, provenance: review };
  const inventory = entries.map(entry => ({ path: entry.path, ...(entry.buffer
    ? { size: entry.buffer.length, sha256: hash(entry.buffer) } : entry.expected) }));
  if (Buffer.byteLength(JSON.stringify({ ...archiveManifest, files: inventory }, null, 2) + '\n') > MANIFEST_BYTES) fail();
  const validateSnapshot = async checkSignal => {
    checkSignal?.throwIfAborted();
    await assertCurrent(checkSignal);
    checkSignal?.throwIfAborted();
    if (inspection.inspection.recorded !== true || inspection.buildDirectory !== base
      || canonicalJson(createBackendProjectDeliveryReview(inspection.project, inspection.inspection.manifestSha256)) !== original) fail('backend_project_delivery_changed');
    await checkedRoot(base, rootIdentity); await checkManifest(checkSignal);
    for (const entry of entries) if (!entry.buffer) await checkedFile(base, entry.relative, entry.expected, checkSignal, entry.stat);
    await checkedRoot(base, rootIdentity); checkSignal?.throwIfAborted();
  };
  await validateSnapshot(signal);
  return { fileName: review.fileName, documentCount: 0, assetCount: review.project.resources.length, entries,
    archiveManifest, validateSnapshot, delivery: review };
}

export async function verifyBackendProjectDelivery(file, { signal } = {}) {
  signal?.throwIfAborted();
  let zip, fd;
  try {
    fd = await openFd(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await statFd(fd);
    if (!before.isFile() || before.size > TOTAL_BYTES + MANIFEST_BYTES + README_BYTES + 1024 * 1024) fail();
    zip = await new Promise((resolve, reject) => yauzl.fromFd(fd, { lazyEntries: true, autoClose: false,
      strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
    let zipFailure; zip.on('error', error => { zipFailure = error; });
    const entries = new Map(); let total = 0;
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (entries.size >= 1154 || !portablePath(entry.fileName) || entries.has(entry.fileName)
        || mode && mode !== 0o100000 || entry.externalFileAttributes & 0x10 || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)
        || entry.uncompressedSize > (entry.fileName === 'manifest.json' ? MANIFEST_BYTES : entry.fileName === 'README.md' ? README_BYTES : FILE_BYTES)) fail();
      total += entry.uncompressedSize;
      if (total > TOTAL_BYTES + MANIFEST_BYTES + README_BYTES) fail();
      entries.set(entry.fileName, entry);
    }
    assertPortableFileTree(entries.keys());
    const consume = async (entry, expected, collect = false) => {
      if (!entry) fail();
      const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
      if (!entry.fileNameRaw.equals(Buffer.from(entry.fileName, 'utf8')) || !local.fileName.equals(entry.fileNameRaw)
        || local.compressionMethod !== entry.compressionMethod || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag
        || yauzl.getFileNameLowLevel(local.generalPurposeBitFlag, local.fileName, yauzl.parseExtraFields(local.extraField), true) !== entry.fileName) fail();
      if (!(entry.generalPurposeBitFlag & 8) && (local.crc32 !== entry.crc32
        || local.compressedSize !== entry.compressedSize || local.uncompressedSize !== entry.uncompressedSize)) fail();
      const stream = await zip.openReadStreamPromise(entry), digest = createHash('sha256'), chunks = []; let size = 0, crc = 0;
      if (signal) addAbortSignal(signal, stream);
      try {
        for await (const chunk of stream) {
          signal?.throwIfAborted(); size += chunk.length;
          if (size > entry.uncompressedSize) fail();
          digest.update(chunk); crc = crc32(chunk, crc); if (collect) chunks.push(chunk);
        }
        const sha256 = digest.digest('hex');
        if (size !== entry.uncompressedSize || crc !== entry.crc32 || expected && (size !== expected.size || sha256 !== expected.sha256)) fail();
        return { size, sha256, ...(collect ? { bytes: Buffer.concat(chunks) } : {}) };
      } finally { stream.destroy(); }
    };
    const { bytes } = await consume(entries.get('manifest.json'), null, true);
    let manifest; try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(); }
    if (!exact(manifest, ['format', 'schemaVersion', 'provenance', 'files']) || manifest.format !== 'viento-build-delivery' || manifest.schemaVersion !== 1) fail();
    const review = validateBackendProjectDeliveryReview(manifest.provenance);
    // The pre-manifest ceiling admits new generated controller wrappers. Only
    // validated protocol 9 Godot assemblies gain the larger delivery inventory.
    const expandedInventory = review.project.schemaVersion === 2 && review.project.backend.id === 'org.viento.godot4'
      && [9, 10, 11].includes(review.project.backend.protocolVersion) && review.project.project.kind === 'godot-project';
    if (entries.size > (expandedInventory ? 1154 : 642)) fail();
    const expected = new Map(review.project.files.map(row => [row.path, { size: row.size, sha256: row.sha256 }]));
    const readmeBytes = readme(review); expected.set('README.md', { size: readmeBytes.length, sha256: hash(readmeBytes) });
    if (!Array.isArray(manifest.files) || manifest.files.length !== expected.size || entries.size !== expected.size + 1) fail();
    const seen = new Set();
    for (const row of manifest.files) {
      const item = expected.get(row?.path);
      if (!exact(row, ['path', 'size', 'sha256']) || !item || seen.has(row.path) || row.size !== item.size || row.sha256 !== item.sha256) fail();
      seen.add(row.path);
      if (entries.get(row.path)?.uncompressedSize !== row.size) fail();
      await consume(entries.get(row.path), row);
    }
    if (zipFailure || signature(await statFd(fd)) !== signature(before) || signature(await fs.lstat(file)) !== signature(before)) fail();
    signal?.throwIfAborted();
    return Object.freeze({ delivery: review, fileCount: expected.size, assetCount: review.project.resources.length, bytes: before.size });
  } catch (error) {
    signal?.throwIfAborted();
    if (error.errorCode?.startsWith('backend_project_delivery_')) throw error;
    fail();
  } finally {
    if (zip) await new Promise(resolve => { zip.reader.once('close', resolve); zip.reader.once('error', resolve); zip.close(); });
    else if (fd !== undefined) await closeFd(fd);
  }
}
