import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'project'); await fs.mkdir(directory);
  return { root, directory };
}

test('Godot project cache: staged script and image sidecars are cleaned, unrelated files stay untouched', async t => {
  const { directory } = await fixture(t);
  const files = ['runtime.gd', 'runtime.gd.uid', 'images/a.svg', 'images/a.svg.import', 'manual.gd.uid', 'notes.txt'];
  for (const file of files) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), file); }
  await fs.mkdir(path.join(directory, '.godot')); await fs.writeFile(path.join(directory, '.godot/cache'), 'cache');
  await GODOT4_EXECUTION_ADAPTER.cleanupProject(directory, { generatedFiles: ['runtime.gd', 'images/a.svg'], resourceFiles: ['images/a.svg'] });
  for (const name of ['runtime.gd.uid', 'images/a.svg.import', '.godot']) await assert.rejects(fs.stat(path.join(directory, name)), { code: 'ENOENT' });
  for (const name of ['runtime.gd', 'images/a.svg', 'manual.gd.uid', 'notes.txt']) assert.equal(await fs.readFile(path.join(directory, name), 'utf8'), name);
  await GODOT4_EXECUTION_ADAPTER.cleanupProject(directory, { generatedFiles: ['runtime.gd'], resourceFiles: ['images/a.svg'] });
});

test('Godot project cache: link sidecars and outside input declarations never delete outside files', async t => {
  const { root, directory } = await fixture(t), outside = path.join(root, 'outside');
  await fs.writeFile(outside, 'author-owned'); await fs.symlink(outside, path.join(directory, 'runtime.gd.uid'));
  await assert.rejects(GODOT4_EXECUTION_ADAPTER.cleanupProject(directory, { generatedFiles: ['runtime.gd'] }), { errorCode: 'path_forbidden' });
  assert.equal(await fs.readFile(outside, 'utf8'), 'author-owned');
  await assert.rejects(GODOT4_EXECUTION_ADAPTER.cleanupProject(directory, { generatedFiles: ['../outside.gd'] }), { errorCode: 'path_forbidden' });
  assert.equal(await fs.readFile(outside, 'utf8'), 'author-owned');
});

test('Godot project cache: a user directory with a sidecar name is preserved', async t => {
  const { directory } = await fixture(t);
  await fs.mkdir(path.join(directory, 'runtime.gd.uid')); await fs.writeFile(path.join(directory, 'runtime.gd.uid/notes'), 'keep');
  await assert.rejects(GODOT4_EXECUTION_ADAPTER.cleanupProject(directory, { generatedFiles: ['runtime.gd'] }));
  assert.equal(await fs.readFile(path.join(directory, 'runtime.gd.uid/notes'), 'utf8'), 'keep');
});
