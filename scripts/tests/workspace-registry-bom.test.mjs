import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readRegistry } from '../lib/workspace.mjs';
import { createSceneAnimationCreationService } from '../lib/scene-animation-creation-service.mjs';
import { animationFixture, fingerprint, sceneId } from './helpers/world-animation-create-fixture.mjs';

test('registry observes one leading UTF-8 BOM on document and asset records without rewriting their bytes or modes', async t => {
  const f = await animationFixture(t), assetId = '99999999-9999-4999-8999-999999999999';
  await fs.mkdir(path.join(f.root, 'metadata/assets'), { recursive: true });
  const assetFile = path.join(f.root, `metadata/assets/${assetId}.json`);
  await fs.copyFile(new URL(`../../examples/scene-audio/metadata/assets/${assetId}.json`, import.meta.url), assetFile);
  for (const file of [path.join(f.root, f.files[2]), assetFile]) {
    await fs.writeFile(file, '\uFEFF' + (await fs.readFile(file, 'utf8')).replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
    await fs.chmod(file, 0o640);
  }
  const before = await fingerprint(f.root), registry = await readRegistry(f.root);
  assert.equal(registry.documents.find(record => record.id === sceneId).sourcePath, f.scenePath);
  assert.equal(registry.assets.find(record => record.id === assetId).kind, 'audio');
  assert.equal((await createSceneAnimationCreationService(f.root).inspect({ sceneObjectId: sceneId })).status, 'empty');
  assert.deepEqual(await fingerprint(f.root), before);
  for (const file of [path.join(f.root, f.files[2]), assetFile]) assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
});

test('registry BOM compatibility does not accept repeated or displaced markers and retains malformed registrations', async t => {
  for (const prefix of ['\uFEFF\uFEFF', '\n\uFEFF']) {
    const f = await animationFixture(t); await fs.writeFile(path.join(f.root, f.files[2]), prefix + f.sceneRecord);
    const before = await fingerprint(f.root); await assert.rejects(readRegistry(f.root)); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('v9 retains its existing BOM journal rejection before any behavior files publish', async t => {
  const { behaviorFixture, targetContents } = await import('./helpers/world-behavior-create-fixture.mjs');
  const f = await behaviorFixture(t); f.sceneRecord = '\uFEFF' + f.sceneRecord; await fs.writeFile(path.join(f.root, f.files[2]), f.sceneRecord);
  const before = await fingerprint(f.root);
  await assert.rejects(f.execute(f.input), { errorCode: 'world_journal_invalid' });
  assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]); assert.deepEqual(await fingerprint(f.root), before);
});
