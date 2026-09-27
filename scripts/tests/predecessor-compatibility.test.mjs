import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../lib/process.mjs';
import { readWorkspace, readRegistry } from '../lib/workspace.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const binary = process.env.VIENTO_TEST_ARCHIVE_BINARY;

for (const version of [1, 2, 3]) test(`predecessor v${version}: frozen source, identity and archive compatibility`, async (t) => {
  const fixture = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-predecessor-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source');
  for (const [name, content] of Object.entries(fixture.files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  }
  const manifest = readWorkspace(root), registry = await readRegistry(root);
  assert.equal(manifest.version, version);
  const env = { ...process.env, VIENTO_APP_ROOT: app, VIENTO_WORKSPACE_ROOT: root };
  for (const script of ['standardize-docs.mjs', 'build-static-doc-site.mjs']) {
    await runCommand(process.execPath, [path.join(app, 'scripts', script)], { cwd: temporary, env });
  }
  const indexFile = version === 1 ? 'web/data/index.json' : 'indexes/documents.json';
  const index = JSON.parse(await fs.readFile(path.join(root, '.viento/cache', indexFile)));
  assert.equal(index.count, 2);
  for (const [name, content] of Object.entries(fixture.files)) {
    assert.equal(await fs.readFile(path.join(root, name), 'utf8'), content, `${name} changed during indexing`);
  }
  const plan = await planExport(root, { kind: 'workspace' });
  const expected = new Map(await Promise.all(plan.entries.map(async entry => [entry.path, entry.buffer || await fs.readFile(entry.absolute)])));
  assert.equal(plan.archiveManifest.workspace.id, manifest.id);
  assert.equal(plan.archiveManifest.workspace.version, version);
  await t.test('native restore, re-export and second restore preserve every portable byte', {
    skip: !binary && 'Set VIENTO_TEST_ARCHIVE_BINARY for the native compatibility gate',
  }, async () => {
    const archive = path.join(temporary, 'node.viento.zip');
    await writeExportZip(plan, archive);
    let previous = archive;
    for (const iteration of [1, 2]) {
      const parent = path.join(temporary, `restore-${iteration}`);
      await fs.mkdir(parent);
      const restored = JSON.parse((await runCommand(binary, ['import', previous, parent])).stdout).root;
      assert.deepEqual(readWorkspace(restored), manifest);
      assert.deepEqual(await readRegistry(restored), registry);
      for (const [name, bytes] of expected) assert.deepEqual(await fs.readFile(path.join(restored, name)), bytes, name);
      if (iteration === 1) {
        previous = path.join(temporary, 'native.viento.zip');
        await runCommand(binary, ['export', restored, previous]);
      }
    }
  });
});
