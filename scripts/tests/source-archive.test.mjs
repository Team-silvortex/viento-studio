import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const application = fileURLToPath(new URL('../../', import.meta.url));
const archiveScript = path.join(application, 'desktop/package-source.py');
const pythonOptions = { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 15000, maxBuffer: 1024 * 1024 };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('source archives retain the standalone Rust core and lock while excluding generated WASM and build caches', async t => {
  let inputs;
  try {
    const result = await run('python3', ['-B', '-c', 'import json, runpy, sys; print(json.dumps(runpy.run_path(sys.argv[1])["INPUTS"]))', archiveScript], pythonOptions);
    inputs = JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === 'ENOENT') { t.skip('Python is required only for source archive verification'); return; }
    throw error;
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-source-archive-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'application');
  await fs.mkdir(root);
  async function write(relative, content) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  // Make only a small temporary application. No existing dist, build caches,
  // workspace files, or source checkout is changed by this regression.
  for (const relative of inputs) {
    const source = path.join(application, relative);
    if ((await fs.stat(source)).isDirectory()) {
      await fs.mkdir(path.join(root, relative), { recursive: true });
    } else {
      await write(relative, await fs.readFile(source));
    }
  }
  await write('desktop/package-source.py', await fs.readFile(archiveScript));
  const core = 'crates/viento-studio-core';
  const required = new Map();
  for (const relative of ['Cargo.toml', 'Cargo.lock', ...(await fs.readdir(path.join(application, core, 'src'), { recursive: true }))
    .filter(file => file.endsWith('.rs')).map(file => `src/${file}`), ...(await fs.readdir(path.join(application, core, 'tests'), { recursive: true }))
    .filter(file => file.endsWith('.rs')).map(file => `tests/${file}`)]) {
    const name = `${core}/${relative.replaceAll(path.sep, '/')}`;
    const bytes = await fs.readFile(path.join(application, name));
    required.set(name, { size: bytes.length, sha256: digest(bytes) });
    await write(name, bytes);
  }
  const excluded = [
    `${core}/target/debug/viento-core`, `${core}/target/wasm32-unknown-unknown/release/viento_studio_core.wasm`,
    'engine/studio-core.wasm', 'engine/studio-core.build.json', 'crates/scratch/notes.txt',
    'workspaces/story/documents/private.md', 'src-tauri/target/debug/cache', 'desktop/resources/engine/studio-core.wasm',
  ];
  for (const name of excluded) await write(name, `generated or private: ${name}`);
  await write('engine/studio-core.mjs', '// Authoritative JavaScript bridge stays in the source package.\n');
  const list = await run('python3', ['-B', '-c', `import json, runpy, sys
p = runpy.run_path(sys.argv[1])
print(json.dumps(sorted(file.relative_to(p['ROOT']).as_posix() for entry in p['INPUTS'] for file in p['source_files'](p['ROOT'] / entry))))
`, path.join(root, 'desktop/package-source.py')], pythonOptions);
  const sourceFiles = JSON.parse(list.stdout);
  for (const name of required.keys()) assert.ok(sourceFiles.includes(name), `missing source: ${name}`);
  for (const name of excluded) assert.ok(!sourceFiles.includes(name), `included generated/private file: ${name}`);

  const output = path.join(root, 'dist/source-regression.tar.gz');
  const packaged = JSON.parse((await run('python3', ['-B', path.join(root, 'desktop/package-source.py'), output], pythonOptions)).stdout);
  assert.equal(packaged.archive, output);
  assert.ok(packaged.bytes > 0);
  const inspected = await run('python3', ['-B', '-c', `import hashlib, json, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    assert all(member.isfile() for member in members)
    roots = {member.name.split('/', 1)[0] for member in members}
    assert len(roots) == 1
    root = roots.pop()
    manifest = json.load(archive.extractfile(root + '/SOURCE_MANIFEST.json'))
    files = {}
    for member in members:
        relative = member.name.split('/', 1)[1]
        if relative == 'SOURCE_MANIFEST.json':
            continue
        content = archive.extractfile(member).read()
        files[relative] = {'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
    assert len(files) + 1 == len(members)
    assert files == manifest
    print(json.dumps(files))
`, output], pythonOptions);
  const archived = JSON.parse(inspected.stdout);
  assert.deepEqual(Object.keys(archived).sort(), sourceFiles);
  assert.equal(packaged.files, sourceFiles.length);
  for (const [name, expected] of required) assert.deepEqual(archived[name], expected, `source bytes changed: ${name}`);
  for (const name of excluded) assert.ok(!Object.hasOwn(archived, name), `archived generated/private file: ${name}`);
  assert.ok(Object.hasOwn(archived, 'engine/studio-core.mjs'));
  for (const name of excluded) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), `generated or private: ${name}`);
});
