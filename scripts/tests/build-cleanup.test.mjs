import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanBuilds } from '../../desktop/clean.mjs';

test('build cleanup preserves source, releases and every workspace state file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-clean-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const keep = ['src-tauri/src/lib.rs', 'desktop/ui/app.js', 'dist/project.viento.zip',
    '.git/objects/saved', 'crates/viento-bevy-runtime/Cargo.toml', 'crates/viento-bevy-runtime/src/main.rs',
    'scripts/backends/bevy-rust/Cargo.toml', 'scripts/backends/bevy-rust/src/main.rs',
    'custom-target/debug/keep', 'workspaces/story/design-data/正文.md', 'workspaces/story/assets/image.png',
    'workspaces/story/metadata/assets/id.json', 'workspaces/story/.viento/workspace.json',
    'workspaces/story/.viento/local.json', 'workspaces/story/.viento/cache/indexes/documents.json'];
  const remove = ['src-tauri/target/debug/cache', 'src-tauri/binaries/runtime',
    'src-tauri/gen/schemas/schema.json', 'desktop/resources/web/app.js', 'desktop/.cache/download',
    'crates/viento-bevy-runtime/target/debug/deps/cache', 'scripts/backends/bevy-rust/target/debug/cache'];
  for (const name of [...keep, ...remove]) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), name);
  }
  assert.equal((await cleanBuilds(root, { dryRun: true })).length, 7);
  for (const name of remove) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), name);
  assert.equal((await cleanBuilds(root)).length, 7);
  for (const name of keep) assert.equal(await fs.readFile(path.join(root, name), 'utf8'), name);
  for (const name of remove) await assert.rejects(fs.stat(path.join(root, name)), { code: 'ENOENT' });
  assert.deepEqual(await cleanBuilds(root), []);
});

test('build cleanup does not follow symlinks into other data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-clean-links-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const outside = path.join(root, 'outside');
  await fs.mkdir(path.join(app, 'src-tauri'), { recursive: true });
  await fs.mkdir(path.join(outside, 'resources'), { recursive: true });
  await fs.writeFile(path.join(outside, 'resources/keep'), 'data');
  await fs.symlink(outside, path.join(app, 'src-tauri/target'), 'junction');
  await fs.symlink(outside, path.join(app, 'desktop'), 'junction');
  await assert.rejects(cleanBuilds(app), /父路径/);
  assert.ok((await fs.lstat(path.join(app, 'src-tauri/target'))).isSymbolicLink());
  await fs.unlink(path.join(app, 'desktop'));
  await cleanBuilds(app);
  assert.equal(await fs.readFile(path.join(outside, 'resources/keep'), 'utf8'), 'data');
});

test('build cleanup refuses a configured workspace or asset store inside generated directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-clean-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = 'src-tauri/target/story';
  await fs.mkdir(path.join(root, workspace), { recursive: true });
  await fs.writeFile(path.join(root, 'viento.config.json'), JSON.stringify({ version: 1, workspace }));
  await assert.rejects(cleanBuilds(root), /重叠/);
  await fs.writeFile(path.join(root, 'viento.config.json'), JSON.stringify({ version: 1, workspace: 'workspaces/story' }));
  await fs.mkdir(path.join(root, 'workspaces/story/.viento'), { recursive: true });
  await fs.mkdir(path.join(root, 'desktop/.cache/assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'workspaces/story/.viento/local.json'), JSON.stringify({
    version: 1, assetStores: { main: path.join(root, 'desktop/.cache/assets') },
  }));
  await assert.rejects(cleanBuilds(root), /重叠/);
  assert.ok((await fs.stat(path.join(root, workspace))).isDirectory());
});


for (const relative of ['crates/viento-bevy-runtime/target', 'scripts/backends/bevy-rust/target']) {
  test(`build cleanup refuses linked parents of ${relative} before removing any output`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-clean-bevy-links-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const app = path.join(root, 'app');
    const outside = path.join(root, 'outside');
    const linkedParent = path.join(app, path.dirname(relative));
    const earlierOutput = path.join(app, 'crates/viento-studio-core/target/keep');
    await fs.mkdir(path.dirname(earlierOutput), { recursive: true });
    await fs.writeFile(earlierOutput, 'unremoved output');
    await fs.mkdir(path.join(outside, 'target'), { recursive: true });
    await fs.writeFile(path.join(outside, 'target/keep'), 'outside data');
    await fs.mkdir(path.dirname(linkedParent), { recursive: true });
    await fs.symlink(outside, linkedParent, 'junction');
    for (const dryRun of [true, false]) {
      await assert.rejects(cleanBuilds(app, { dryRun }), /父路径/);
      assert.equal(await fs.readFile(earlierOutput, 'utf8'), 'unremoved output');
      assert.equal(await fs.readFile(path.join(outside, 'target/keep'), 'utf8'), 'outside data');
      assert.ok((await fs.lstat(linkedParent)).isSymbolicLink());
    }
  });

  test(`build cleanup protects workspace and external assets inside ${relative}`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-clean-bevy-config-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const earlierOutput = path.join(root, 'crates/viento-studio-core/target/keep');
    await fs.mkdir(path.dirname(earlierOutput), { recursive: true });
    await fs.writeFile(earlierOutput, 'unremoved output');
    const workspace = `${relative}/story`;
    const authorFile = path.join(root, workspace, '正文.md');
    await fs.mkdir(path.dirname(authorFile), { recursive: true });
    await fs.writeFile(authorFile, 'author data');
    const configFile = path.join(root, 'viento.config.json');
    await fs.writeFile(configFile, JSON.stringify({ version: 1, workspace }));
    for (const dryRun of [true, false]) {
      await assert.rejects(cleanBuilds(root, { dryRun }), /重叠/);
      assert.equal(await fs.readFile(earlierOutput, 'utf8'), 'unremoved output');
      assert.equal(await fs.readFile(authorFile, 'utf8'), 'author data');
    }
    const assets = path.join(root, relative, 'assets');
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(assets, 'image.png'), 'asset bytes');
    await fs.mkdir(path.join(root, 'workspaces/story/.viento'), { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({ version: 1, workspace: 'workspaces/story' }));
    await fs.writeFile(path.join(root, 'workspaces/story/.viento/local.json'), JSON.stringify({
      version: 1, assetStores: { main: assets },
    }));
    for (const dryRun of [true, false]) {
      await assert.rejects(cleanBuilds(root, { dryRun }), /重叠/);
      assert.equal(await fs.readFile(earlierOutput, 'utf8'), 'unremoved output');
      assert.equal(await fs.readFile(path.join(assets, 'image.png'), 'utf8'), 'asset bytes');
    }
  });
}
