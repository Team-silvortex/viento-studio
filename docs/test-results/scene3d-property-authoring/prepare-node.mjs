// Prepare only the declared sidecar, while the core owner edits Rust/WASM.
// Final copied application resources use the ordinary desktop preparation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const configuration = await fs.readFile(path.join(root, 'desktop/node-runtime.json'));
const runtime = JSON.parse(configuration), triple = 'x86_64-unknown-linux-gnu', target = runtime.targets[triple];
const archive = path.join(root, 'desktop/.cache', `${runtime.version}-${target.file}`);
const node = path.join(root, 'src-tauri/binaries', `viento-node-${triple}`);
const license = path.join(root, 'desktop/.cache', `${runtime.version}-LICENSE`);
async function download(url, destination, digest) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Cannot prepare declared runtime: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== digest) throw new Error('Declared runtime checksum mismatch.');
  await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes);
}
await download(`https://nodejs.org/dist/${runtime.version}/${target.file}`, archive, target.sha256);
await download(`https://raw.githubusercontent.com/nodejs/node/${runtime.version}/LICENSE`, license, runtime.licenseSha256);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene3d-property-sidecar-'));
try {
  await promisify(execFile)('tar', ['-xf', archive, '-C', temporary, target.node]);
  await fs.mkdir(path.dirname(node), { recursive: true });
  await fs.copyFile(path.join(temporary, target.node), node); await fs.chmod(node, 0o755);
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
const bytes = await fs.readFile(node), version = (await promisify(execFile)(node, ['--version'])).stdout.trim();
if (version !== runtime.version) throw new Error('Prepared runtime version mismatch.');
const report = { scope: 'Declared sidecar archive and license prepared separately to avoid concurrent core builds. Final actual desktop resource preparation is separately recorded; no installed application acceptance.',
  version, archive, archiveSHA256: target.sha256, node, nodeSHA256: hash(bytes), bytes: bytes.length,
  runtimeConfigurationSHA256: hash(configuration), licenseSHA256: hash(await fs.readFile(license)),
  preparationSHA256: hash(await fs.readFile(fileURLToPath(import.meta.url))) };
await fs.writeFile(path.join(evidence, 'fixed-node.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ version, bytes: bytes.length, nodeSHA256: report.nodeSHA256 }));
