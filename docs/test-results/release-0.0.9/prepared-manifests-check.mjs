import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(process.version, 'v24.20.0');
assert.equal((await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim(), '0.0.9');
const proofPath = path.join(evidence, 'packaged-resources.json');
const proofBytes = await fs.readFile(proofPath), proof = JSON.parse(proofBytes);
assert.equal(proof.ok, true); assert.equal(proof.version, '0.0.9');
assert.equal(proof.frozenSourceManifest.files, 527);
assert.equal(sha256(await fs.readFile(path.join(evidence, 'packaged-check.mjs'))), proof.proofSourceSha256);

async function inventory(directory) {
  const manifest = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    assert.ok(entry.isFile(), 'Prepared inventories contain only regular files');
    const file = path.join(entry.parentPath, entry.name), bytes = await fs.readFile(file);
    const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
    assert.ok(![0x7f454c46, 0xcafebabe, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(signature)
      && !(bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a), 'No native engine tools in prepared resource trees');
    manifest[path.relative(directory, file)] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

const artifacts = {};
for (const [name, expectedCount] of [['desktop/resources', 511], ['mobile/dist', 201]]) {
  const manifest = await inventory(path.join(root, name));
  assert.equal(Object.keys(manifest).length, expectedCount);
  assert.deepEqual(manifest, proof.artifacts[name].manifest);
  assert.equal(sha256(JSON.stringify(manifest)), proof.artifacts[name].manifestSha256);
  artifacts[name] = { files: expectedCount,
    bytes: Object.values(manifest).reduce((sum, file) => sum + file.bytes, 0),
    sha256: sha256(JSON.stringify(manifest)), manifest,
    allSourceCopiesValidatedBy: 'packaged-resources.json',
    currentInventoryMatchesExecutedPreparedResources: true };
}
const library = await inventory(path.join(root, 'desktop/ui'));
const translations = (await fs.readdir(path.join(root, 'web/i18n'))).sort();
assert.equal(translations.length, 8);
assert.deepEqual(Object.keys(library).sort(), ['app.js', 'index.html', 'style.css', ...translations.map(file => `i18n/${file}`)].sort());
assert.equal(Object.keys(library).length, 11);
const librarySourceCopies = {};
for (const [file, entry] of Object.entries(library)) {
  const source = file.startsWith('i18n/') ? `web/${file}` : `desktop/ui/${file}`;
  assert.equal(entry.sha256, sha256(await fs.readFile(path.join(root, source))));
  librarySourceCopies[file] = { source, sha256: entry.sha256 };
}
const index = await fs.readFile(path.join(root, 'desktop/ui/index.html'), 'utf8');
assert.equal(/<span id="appVersion">([^<]+)<\/span>/.exec(index)?.[1], '0.0.9');
assert.ok(!Object.keys(library).some(file => /^(?:engine|scripts|backends|crates|workspaces|works)\//.test(file)
  || /(?:viento-node|viento-bevy-runtime|Cargo\.lock)/.test(file)));
artifacts['desktop/ui'] = { files: 11,
  bytes: Object.values(library).reduce((sum, file) => sum + file.bytes, 0),
  sha256: sha256(JSON.stringify(library)), manifest: library,
  fullSourceCopies: librarySourceCopies, visibleIndexVersion: '0.0.9',
  noHostEngineNativeToolsOrUserWorks: true };
const report = { ok: true, recordedAt: new Date().toISOString(), version: '0.0.9',
  scope: 'Final full prepared desktop/editor, mobile and desktop-library inventories. Runtime behavior uses the independently recorded prepared-resources proof; this additional snapshot introduces no additional engine, installed Tauri or Android-device acceptance claim.',
  embeddedNodeVersion: process.version,
  proofSourceSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
  packagedRuntimeProof: { path: 'packaged-resources.json', sha256: sha256(proofBytes), proofSourceSha256: proof.proofSourceSha256 },
  frozenSourceManifest: { files: proof.frozenSourceManifest.files, sha256: proof.frozenSourceManifest.sha256 },
  artifacts, allInventoriesContainOnlyRegularFilesAndNoNativeExecutables: true,
  noAdditionalRuntimeOrInstalledArtifactAcceptanceClaimed: true };
await fs.writeFile(path.join(evidence, 'prepared-manifests.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, version: '0.0.9', artifacts: Object.fromEntries(Object.entries(artifacts)
  .map(([name, value]) => [name, { files: value.files, bytes: value.bytes, sha256: value.sha256 }])) }));
