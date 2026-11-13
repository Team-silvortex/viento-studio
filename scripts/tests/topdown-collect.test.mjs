import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry, validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { validatePcmWave } from '../lib/audio-wav.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';

// Copy the public author project, not a test fixture or generated Godot project.
// The override permits testing an unpromoted author draft with the same tests.
const sampleRoot = process.env.VIENTO_TOPDOWN_SOURCE ? path.resolve(process.env.VIENTO_TOPDOWN_SOURCE)
  : fileURLToPath(new URL('../../examples/topdown-collect/', import.meta.url));
const id = n => `c011ec70-2026-4113-8113-${String(n).padStart(12, '0')}`;
const assemblyId = id(100), sceneIds = [30, 31, 32, 33].map(id), guideId = id(2);
const json = value => JSON.stringify(value, null, 2) + '\n';
const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
const readJson = async (root, file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

async function inventory(root) {
  const files = {};
  async function visit(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name, file = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `author project contains a link: ${relative}`);
      if (entry.isDirectory()) await visit(file, relative + '/');
      else {
        assert.ok(entry.isFile(), relative);
        const content = await fs.readFile(file);
        files[relative] = { size: content.length, sha256: buildHash(content) };
      }
    }
  }
  await visit(root);
  return files;
}

async function sample(t) {
  const original = await inventory(sampleRoot), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-topdown-collect-'));
  const author = path.join(temporary, 'author');
  await fs.cp(sampleRoot, author, { recursive: true });
  const f = { original, temporary, author, currentAuthor: author, before: await inventory(author) };
  t.after(async () => {
    try {
      assert.deepEqual(await inventory(f.currentAuthor), f.before, 'all copied author bytes must stay unchanged');
      assert.deepEqual(await inventory(sampleRoot), original, 'the public sample must never be written by a test');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  });
  return f;
}

async function capture(root) {
  const result = await captureBuildSnapshot(root, assemblyId);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  return result;
}

// Paths and project revisions intentionally change on import. Gameplay values,
// identities, author scripts and declared media/physics/camera/HUD stay equal.
function semantics(plan) {
  return {
    entrySceneId: plan.entrySceneId, requiredCapabilities: plan.requiredCapabilities,
    input: plan.inputMap.document, resources: plan.resources.map(({ id, kind, size, sha256 }) => ({ id, kind, size, sha256 })),
    scenes: plan.scenes.map(scene => ({
      id: scene.scene.objectId, viewport: scene.scene.viewport, background: scene.scene.background,
      actors: scene.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId,
        position: actor.position, size: actor.size, color: actor.color, speed: actor.speed,
        controls: actor.controls, imageResourceId: actor.imageResourceId, originId: actor.origin?.objectId })),
      bindings: scene.behaviors.bindings.map(binding => ({ bindingId: binding.bindingId, instanceId: binding.instanceId,
        implementation: binding.implementation, parameters: binding.parameters, events: binding.events })),
      sources: scene.behaviors.sources.map(source => ({ id: source.objectId, content: source.content })),
      physics: scene.physics?.document, camera: scene.camera2d?.document, hud: scene.hud2d?.document,
      audio: scene.audio?.document, animation: scene.animation?.document,
    })),
  };
}

async function assertResourceBytes(root, captured) {
  const registry = await readRegistry(root);
  assert.equal(captured.resources.size, captured.plan.resources.length);
  for (const resource of captured.plan.resources) {
    const record = registry.assets.find(asset => asset.id === resource.id);
    assert.ok(record, resource.id);
    const source = await fs.readFile(path.join(root, 'assets', record.location.path));
    assert.deepEqual(captured.resources.get(resource.id), source, record.location.path);
    assert.deepEqual(record.content, { size: source.length, sha256: buildHash(source) });
    assert.equal(resource.size, source.length); assert.equal(resource.sha256, buildHash(source));
    if (resource.kind === 'audio') {
      const wave = validatePcmWave(source);
      assert.equal(wave.channels, 1); assert.equal(wave.sampleRate, 22050);
      assert.ok(wave.frames / wave.sampleRate <= .35);
    }
  }
}

test('topdown public author project freezes four scenes with real projection, collision, media, HUD and input dependencies', async t => {
  const f = await sample(t), captured = await capture(f.author), { plan } = captured;
  assert.equal(plan.kind, 'project'); assert.equal(plan.assembly.objectId, assemblyId);
  assert.equal(plan.entrySceneId, sceneIds[0]); assert.deepEqual(plan.scenes.map(scene => scene.scene.objectId), sceneIds);
  assert.deepEqual(plan.inputMap.document.actions, [{ name: 'start_retry', keys: ['Enter', 'Space'] }]);
  const [start, level, win, fail] = plan.scenes, player = level.actors.find(actor => actor.instanceId === id(301));
  assert.ok(player); assert.equal(player.objectId, id(11)); assert.equal(player.origin.objectId, id(10));
  assert.equal(player.origin.sourcePath, 'documents/definitions/traveler.md');
  assert.deepEqual(player.size, [40, 40]); assert.equal(player.speed, 260); assert.equal(player.controls, 'arrows');
  assert.equal(player.fieldSources.speed.objectId, id(11)); assert.equal(player.imageResourceId, id(200));
  const bodies = new Map(level.physics.document.bodies.map(body => [body.instanceId, body]));
  assert.equal(bodies.get(player.instanceId).kind, 'character');
  assert.equal(bodies.get(player.instanceId).collisionResponse, 'slide');
  const collection = level.behaviors.bindings.filter(binding => binding.parameters.kind === 'collect');
  assert.equal(collection.length, 3); assert.equal(new Set(collection.map(binding => binding.instanceId)).size, 3);
  for (const binding of collection) {
    assert.equal(bodies.get(binding.instanceId).kind, 'sensor');
    assert.equal(binding.parameters.player_instance_id, player.instanceId);
    assert.equal(level.actors.find(actor => actor.instanceId === binding.instanceId).objectId, id(12));
  }
  assert.equal(bodies.get(id(306)).kind, 'static', 'the locked gate has a physical obstacle');
  assert.equal(bodies.get(id(305)).kind, 'sensor'); assert.equal(bodies.get(id(307)).kind, 'sensor');
  assert.equal(level.camera2d.document.camera.targetInstanceId, player.instanceId);
  assert.equal(level.camera2d.document.camera.mode, 'follow');
  assert.ok(level.camera2d.document.camera.limits.right > level.scene.viewport[0], 'the level extends beyond the viewport');
  const health = level.hud2d.document.elements.find(element => element.kind === 'bar' && element.key === 'health');
  assert.equal(health.max, 3); assert.equal(health.min, 0);
  const stateKeys = new Set(level.hud2d.document.elements.flatMap(element => element.content?.kind === 'state' ? [element.content.key] : []));
  for (const key of ['score', 'health', 'door_open']) assert.ok(stateKeys.has(key));
  assert.deepEqual(new Set(level.animation.document.tracks.map(track => track.instanceId)), new Set(collection.map(binding => binding.instanceId)));
  const tracks = new Map(level.audio.document.tracks.map(track => [track.id, track]));
  for (const event of ['game.collect', 'game.hazard']) {
    const listener = level.behaviors.bindings.find(binding => binding.parameters.event_name === event);
    assert.ok(listener); assert.ok(tracks.has(listener.parameters.track_id));
  }
  assert.equal(win.audio.document.cues[0].trackId, win.audio.document.tracks[0].id);
  for (const result of [start, win, fail]) {
    const retry = result.behaviors.bindings.find(binding => binding.parameters.target_scene_id === level.scene.objectId);
    assert.ok(retry); assert.equal(retry.parameters.action_name, 'start_retry');
    assert.deepEqual(JSON.parse(retry.parameters.state_values_json), { score: 0, health: 3, door_open: false });
  }
  const nav = level.behaviors.bindings.filter(binding => ['game.complete', 'game.failed'].includes(binding.parameters.event_name));
  assert.deepEqual(nav.map(binding => [binding.parameters.event_name, binding.parameters.target_scene_id]), [
    ['game.complete', win.scene.objectId], ['game.failed', fail.scene.objectId],
  ]);
  for (const scene of plan.scenes) assert.equal(scene.hud2d.document.sceneObjectId, scene.scene.objectId);
  for (const capability of ['physics.character-slide2d', 'scene.camera2d.limits2d', 'scene.hud2d', 'audio.timeline', 'animation.visual2d', 'project.input-map']) {
    assert.ok(plan.requiredCapabilities.includes(capability), capability);
  }
  await assertResourceBytes(f.author, captured);
});

test('the standard Godot adapter generates the sample without altering saved scripts, resources or author data', async t => {
  const f = await sample(t), captured = await capture(f.author), adapter = createExecutionBackendRegistry().resolve('org.viento.godot4');
  const generate = async () => validateGeneratedExecutionProject(adapter, captured.plan, await adapter.generate(captured.plan));
  const generated = await generate(), again = await generate();
  const signatures = files => [...files].map(([name, content]) => [name, buildHash(bytes(content))]).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(signatures(generated.files), signatures(again.files));
  assert.equal(generated.artifact.entry, 'project.godot'); assert.equal(generated.artifact.requiresTool, true);
  assert.ok(generated.backend.capabilities.includes('project.scene-retry'));
  assert.deepEqual(generated.sourceMap.scenes.map(scene => scene.sceneId), sceneIds);
  const registered = await readRegistry(f.author), sources = new Map(captured.plan.scenes.flatMap(scene => scene.behaviors.sources.map(source => [source.objectId, source])));
  const emitted = new Set();
  for (const mapping of generated.sourceMap.behaviors) {
    const source = sources.get(mapping.sourceObjectId);
    assert.ok(source, mapping.sourceObjectId);
    const record = registered.documents.find(document => document.id === source.objectId);
    const original = await fs.readFile(path.join(f.author, record.sourcePath));
    assert.deepEqual(bytes(generated.files.get(mapping.generatedPath)), original, 'ordinary TXT must be copied unchanged into the generated behavior');
    emitted.add(source.objectId);
  }
  assert.deepEqual(emitted, new Set(sources.keys()));
  assert.deepEqual(new Set(generated.resourceFiles.keys()), new Set(captured.resources.keys()));
  for (const [resourceId, output] of generated.resourceFiles) {
    assert.ok(generated.sourceMap.resources.some(mapping => mapping.resourceId === resourceId && mapping.generatedPath === output));
    assert.equal(buildHash(captured.resources.get(resourceId)), captured.plan.resources.find(resource => resource.id === resourceId).sha256);
  }
  const after = await capture(f.author);
  assert.equal(after.snapshotId, captured.snapshotId); assert.deepEqual(semantics(after.plan), semantics(captured.plan));
});

test('selecting the sample assembly exports a complete author closure that rebuilds at a different document root with its source offline', async t => {
  const f = await sample(t), captured = await capture(f.author), catalog = await readPackageCatalog(f.author), registry = await readRegistry(f.author);
  assert.deepEqual(catalog.entries.flatMap(entry => entry.problems), []);
  const review = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [assemblyId], includeDependencies: true, includeChildren: false });
  const archive = path.join(f.temporary, 'topdown.viento-package.zip'); await writeExportZip(review, archive);
  const stage = path.join(f.temporary, 'unpacked'); await fs.mkdir(stage);
  const pack = await unpackResourcePackage(archive, stage);
  assert.equal(pack.manifest.format, 'viento-resource-package'); assert.deepEqual(pack.manifest.roots, [assemblyId]);
  assert.deepEqual(pack.manifest.requirements, []);
  assert.deepEqual(new Set(pack.manifest.documents.map(document => document.id)), new Set(registry.documents.map(document => document.id)));
  assert.deepEqual(new Set(pack.manifest.assets.map(asset => asset.id)), new Set(registry.assets.map(asset => asset.id)));
  assert.ok(pack.manifest.documents.some(document => document.id === guideId), 'the instructions travel with an assembly selected for reuse');
  const target = path.join(f.temporary, 'restored'), workspace = await readJson(f.author, 'workspace.json');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'workspace.json'), json({ ...workspace, version: 2, id: randomUUID(),
    paths: { documents: 'design-data', templates: 'data-template', metadata: 'metadata' } }));
  for (const folder of ['design-data', 'data-template', 'assets', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(target, folder), { recursive: true });
  const preview = await planPackageImport(target, pack);
  assert.deepEqual(preview.summary.conflicts, [], JSON.stringify(preview.summary));
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  for (const document of pack.manifest.documents) {
    const relative = document.sourcePath.slice('documents/'.length);
    assert.deepEqual(await fs.readFile(path.join(target, 'design-data', relative)), await fs.readFile(path.join(f.author, document.sourcePath)), relative);
    const before = await readJson(f.author, `metadata/documents/${document.id}.json`), after = await readJson(target, `metadata/documents/${document.id}.json`);
    assert.deepEqual(after, { ...before, sourcePath: 'design-data/' + relative });
  }
  for (const asset of pack.manifest.assets) {
    assert.deepEqual(await fs.readFile(path.join(target, asset.path)), await fs.readFile(path.join(f.author, asset.path)), asset.path);
    assert.deepEqual(await readJson(target, `metadata/assets/${asset.id}.json`), await readJson(f.author, `metadata/assets/${asset.id}.json`));
  }
  for (const type of pack.manifest.types) if (type.template) {
    assert.deepEqual(await fs.readFile(path.join(target, 'data-template', type.template)), await fs.readFile(path.join(f.author, 'templates', type.template)));
  }
  await fs.rename(f.author, f.author + '-offline'); f.currentAuthor = f.author + '-offline';
  const rebuilt = await capture(target);
  assert.equal(rebuilt.plan.assembly.sourcePath, 'design-data/projects/game.json');
  assert.deepEqual(semantics(rebuilt.plan), semantics(captured.plan));
  await assertResourceBytes(target, rebuilt);
  const adapter = createExecutionBackendRegistry().resolve('org.viento.godot4');
  assert.ok(validateGeneratedExecutionProject(adapter, rebuilt.plan, await adapter.generate(rebuilt.plan)).files.size > 0);
});

// Independent ZIP reading verifies the standard full-project archive inventory.
// Extraction is limited to the verified regular-file paths from our own export.
async function verifiedFullArchive(file) {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true });
  const contents = new Map();
  try {
    for await (const entry of zip.eachEntry()) {
      assert.ok(!entry.isEncrypted()); assert.ok(!contents.has(entry.fileName));
      assert.ok(!path.posix.isAbsolute(entry.fileName) && !entry.fileName.includes('\\') && entry.fileName.split('/').every(part => part && part !== '.' && part !== '..'));
      const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
      assert.ok(kind === 0 || kind === 0o100000); assert.ok(entry.uncompressedSize < 1024 * 1024);
      const chunks = []; let total = 0;
      for await (const chunk of await zip.openReadStreamPromise(entry)) { total += chunk.length; assert.ok(total <= entry.uncompressedSize); chunks.push(chunk); }
      assert.equal(total, entry.uncompressedSize); contents.set(entry.fileName, Buffer.concat(chunks));
    }
  } finally { zip.close(); }
  const manifest = JSON.parse(contents.get('manifest.json'));
  assert.equal(manifest.format, 'viento-archive'); assert.equal(manifest.version, 3);
  assert.equal(manifest.workspace.id, id(1));
  assert.equal(new Set(manifest.files.map(file => file.path)).size, manifest.files.length);
  assert.deepEqual(new Set(contents.keys()), new Set(['manifest.json', ...manifest.files.map(file => file.path)]));
  for (const file of manifest.files) {
    const content = contents.get(file.path);
    assert.deepEqual({ size: content.length, sha256: buildHash(content) }, { size: file.size, sha256: file.sha256 }, file.path);
  }
  contents.delete('manifest.json');
  return { manifest, contents };
}

test('a full standard workspace ZIP preserves all author bytes and restores a buildable standalone author project', async t => {
  const f = await sample(t), captured = await capture(f.author), plan = await planExport(f.author, { kind: 'workspace' });
  const archive = path.join(f.temporary, 'topdown.viento.zip'); await writeExportZip(plan, archive);
  const { contents } = await verifiedFullArchive(archive);
  const expected = Object.keys(f.before).filter(name => name === 'workspace.json' || name === '.viento/workspace.json' || /^(documents|templates|metadata|assets)\//.test(name));
  assert.deepEqual(new Set(contents.keys()), new Set(expected));
  for (const name of expected) assert.deepEqual(contents.get(name), await fs.readFile(path.join(f.author, name)), name);
  const target = path.join(f.temporary, 'full-restored'); await fs.mkdir(target);
  for (const [name, content] of contents) {
    const destination = path.join(target, name); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, content, { flag: 'wx' });
  }
  await fs.rename(f.author, f.author + '-offline'); f.currentAuthor = f.author + '-offline';
  assert.deepEqual(await readRegistry(target), await readRegistry(f.currentAuthor));
  const rebuilt = await capture(target);
  assert.equal(rebuilt.snapshotId, captured.snapshotId); assert.deepEqual(semantics(rebuilt.plan), semantics(captured.plan));
  await assertResourceBytes(target, rebuilt);
  for (const [name, content] of contents) assert.deepEqual(await fs.readFile(path.join(target, name)), content, name);
});
