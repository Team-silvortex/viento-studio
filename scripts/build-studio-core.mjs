import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCommand } from './lib/process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const crate = path.join(root, 'crates/viento-studio-core');
const output = path.join(root, 'engine/studio-core.wasm');
const record = path.join(root, 'engine/studio-core.build.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let preparation;

// Development/packaging step only. Installed editors consume the bundled WASM
// without invoking Cargo or downloading a toolchain.
export function prepareStudioCore() {
  preparation ||= prepare().catch(error => { preparation = null; throw error; });
  return preparation;
}
async function prepare() {
  const files = ['Cargo.toml', 'Cargo.lock', ...(await fs.readdir(path.join(crate, 'src'), { recursive: true }))
    .filter(name => name.endsWith('.rs')).map(name => `src/${name}`)].sort();
  const sources = Object.fromEntries(await Promise.all(files.map(async name => [name, hash(await fs.readFile(path.join(crate, name)))])));
  sources['build-script'] = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  const sourceHash = hash(JSON.stringify(sources));
  try {
    const previous = JSON.parse(await fs.readFile(record, 'utf8'));
    const bytes = await fs.readFile(output);
    if (previous.sourceHash === sourceHash && previous.wasmSha256 === hash(bytes) && WebAssembly.validate(bytes)) return previous;
  } catch { /* Missing/stale generated artifacts are rebuilt explicitly here. */ }
  const target = path.resolve(process.env.VIENTO_CORE_TARGET_DIR || path.join(crate, 'target'));
  try {
    await runCommand('cargo', ['build', '--locked', '--release', '--lib', '--target', 'wasm32-unknown-unknown', '--manifest-path', path.join(crate, 'Cargo.toml')], {
      cwd: root, env: { ...process.env, CARGO_TARGET_DIR: target },
    });
  } catch (error) {
    throw new Error(`Cannot build the Rust Studio core. Install Rust and run rustup target add wasm32-unknown-unknown, then retry npm run core:build.\n${error.message}`);
  }
  const bytes = await fs.readFile(path.join(target, 'wasm32-unknown-unknown/release/viento_studio_core.wasm'));
  if (!WebAssembly.validate(bytes)) throw new Error('Rust Studio core output is not valid WebAssembly');
  const rustcVersion = (await runCommand('rustc', ['--version'])).stdout;
  const built = { protocolVersion: 1, rustcVersion, sourceHash, wasmSha256: hash(bytes), bytes: bytes.length, sources };
  await fs.writeFile(output, bytes);
  await fs.writeFile(record, JSON.stringify(built, null, 2) + '\n');
  return built;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareStudioCore().then(result => console.log(`Rust Studio core ready: ${result.bytes} bytes (${result.wasmSha256})`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
