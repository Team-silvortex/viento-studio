import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { captureScenePreviewSnapshot } from '../adapters/node-build-snapshot.mjs';
import { animationPreviewFixture, fingerprint, sceneId, manifestId, imageId, scenePath, animationPath, recordPath, json, revision } from './helpers/scene-animation-scene-preview-fixture.mjs';

function service(t, root, options = {}) {
  const instance = createScenePreviewService(root, { enabled: true, ...options });
  t.after(() => instance.close()); return instance;
}
function comparable(value) {
  const result = structuredClone(value); delete result.previewId; delete result.animationPreview;
  result.resources = result.resources.map(({ url, ...resource }) => resource); return result;
}

for (const version of [2, 3]) test(`saved scene v${version} shares one frozen scene/image snapshot and preserves old static response shape`, async t => {
  const f = await animationPreviewFixture(t, { version }), s = service(t, f.root);
  const raw = '\uFEFF' + (await f.read(animationPath)).replaceAll('\n', '\r\n'); await f.write(animationPath, raw);
  const before = await fingerprint(f.root), old = await s.create({ sceneId }), animated = await s.create({ sceneId, includeAnimation: true });
  assert.equal(old.ok, true); assert.equal(Object.hasOwn(old, 'animationPreview'), false);
  assert.equal(animated.ok, true); assert.deepEqual(comparable(animated), comparable(old));
  assert.deepEqual(Object.keys(animated).sort(), [...Object.keys(old), 'animationPreview'].sort());
  assert.equal(animated.schemaVersion, 2); assert.equal(animated.animationPreview.status, 'ready');
  assert.equal(animated.animationPreview.snapshotId, animated.snapshotId);
  assert.deepEqual(animated.animationPreview.scene, Object.fromEntries(['objectId', 'sourcePath', 'sourceRevision'].map(key => [key, animated.scene[key]])));
  assert.deepEqual(animated.animationPreview.manifest, { objectId: manifestId, sourcePath: animationPath, sourceRevision: revision(raw) });
  assert.equal(animated.animationPreview.document.tracks.length, 4); assert.deepEqual(animated.animationPreview.diagnostics, []);
  assert.equal(animated.actors.length, 2); assert.equal(animated.resources.length, 1);
  assert.deepEqual(s.resource(animated.previewId, imageId).bytes, await fs.readFile(path.join(f.root, 'assets/traveler.svg')));
  assert.equal(JSON.stringify(animated).includes(f.root), false);
  if (version === 3) assert.equal(animated.sceneStructure.sourceSchemaVersion, 3);
  assert.deepEqual(await fingerprint(f.root), before);
});

test('animation-free scenes return none including legacy scene schema1 without changing static eligibility', async t => {
  const f = await animationPreviewFixture(t), s = service(t, f.root);
  await f.edit(recordPath, value => { value.relations = value.relations.filter(relation => relation.kind !== 'animation'); });
  for (const legacy of [false, true]) {
    if (legacy) await f.edit(scenePath, value => { value.schemaVersion = 1; value.actors = value.actors.slice(0, 1); delete value.actors[0].instanceId; });
    const before = await fingerprint(f.root), result = await s.create({ sceneId, includeAnimation: true });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); assert.equal(result.animationPreview.status, 'none');
    assert.equal(result.animationPreview.manifest, null); assert.equal(result.animationPreview.document, null); assert.deepEqual(result.animationPreview.diagnostics, []);
    assert.equal(result.schemaVersion, legacy ? 1 : 2); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('malformed, mismatched and orphaned animation declarations remain isolated from static scenes and images', async t => {
  const f = await animationPreviewFixture(t), s = service(t, f.root), original = JSON.parse(await f.read(animationPath));
  const wrongScene = structuredClone(original); wrongScene.sceneObjectId = '99999999-9999-4999-8999-999999999999';
  const missingActor = structuredClone(original); missingActor.tracks[0].instanceId = '99999999-9999-4999-8999-999999999999';
  for (const content of ['{broken animation', json(wrongScene), json(missingActor)]) {
    await f.write(animationPath, content); const before = await fingerprint(f.root), result = await s.create({ sceneId, includeAnimation: true });
    assert.equal(result.ok, true); assert.deepEqual(result.diagnostics, []); assert.equal(result.animationPreview.status, 'invalid');
    assert.equal(result.animationPreview.document, null); assert.ok(result.animationPreview.diagnostics.length);
    assert.equal(result.animationPreview.manifest.sourceRevision, revision(content));
    assert.equal(s.resource(result.previewId, imageId).bytes.length, 231); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('saved animation preview does not inspect executable audio/behavior declarations or load their resources', async t => {
  const f = await animationPreviewFixture(t), s = service(t, f.root);
  for (const [index, kind] of ['audio', 'behavior'].entries()) {
    const objectId = `99999999-9999-4999-8999-99999999999${index}`, sourcePath = `documents/${kind}/broken.json`;
    await f.write(sourcePath, '{invalid executable declaration');
    await f.write(`metadata/documents/${objectId}.json`, json({ format: 'viento-document', version: 1, id: objectId, sourcePath,
      documentType: 'animation', parserProfile: 'structured', relations: [{ kind: 'reference', targetId: sceneId, slot: 'scene' }], assetBindings: [] }));
    await f.edit(recordPath, record => { record.relations.push({ kind, targetId: objectId, slot: kind }); });
  }
  const before = await fingerprint(f.root), result = await s.create({ sceneId, includeAnimation: true });
  assert.equal(result.ok, true); assert.equal(result.animationPreview.status, 'ready'); assert.deepEqual(result.diagnostics, []);
  assert.equal(result.resources.length, 1); assert.equal(Object.hasOwn(result, 'audio'), false); assert.equal(Object.hasOwn(result, 'behavior'), false);
  assert.deepEqual(await fingerprint(f.root), before);
});

test('animation identity and content come from the captured World even if live manifest changes immediately afterward', async t => {
  const f = await animationPreviewFixture(t), original = await f.read(animationPath);
  const changed = JSON.parse(original); changed.loop = !changed.loop; const changedRaw = json(changed);
  let captures = 0;
  const s = service(t, f.root, { capture: async (...args) => {
    const captured = await captureScenePreviewSnapshot(...args);
    if (++captures === 1) await f.write(animationPath, changedRaw);
    return captured;
  } });
  const first = await s.create({ sceneId, includeAnimation: true });
  assert.equal(first.animationPreview.status, 'ready'); assert.equal(first.animationPreview.manifest.sourceRevision, revision(original));
  assert.equal(first.animationPreview.document.loop, JSON.parse(original).loop); assert.equal(await f.read(animationPath), changedRaw);
  const second = await s.create({ sceneId, includeAnimation: true });
  assert.equal(second.animationPreview.manifest.sourceRevision, revision(changedRaw)); assert.equal(second.animationPreview.document.loop, changed.loop);
  assert.notEqual(first.snapshotId, second.snapshotId); assert.equal(captures, 2);
});

test('only explicit true requests animation and drafts cannot combine it before any capture or lease changes', async t => {
  const f = await animationPreviewFixture(t); let captures = 0, drafts = 0;
  const s = service(t, f.root, { capture: async (...args) => { captures++; return captureScenePreviewSnapshot(...args); },
    captureDraft: async () => { drafts++; throw Error('must not capture'); } });
  const first = await s.create({ sceneId, includeAnimation: true });
  for (const includeAnimation of [false, undefined, null, 0, 1, 'true', {}, []])
    await assert.rejects(s.create({ sceneId, includeAnimation }), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  for (const draft of [null, {}, { sourcePath: scenePath, baseSourceRevision: revision(await f.read(scenePath)), content: await f.read(scenePath) }])
    await assert.rejects(s.create({ sceneId, includeAnimation: true, draft }), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  assert.equal(captures, 1); assert.equal(drafts, 0); assert.equal(s.resource(first.previewId, imageId).bytes.length, 231);
});

test('ordinary drafts and saved compositions keep their static contracts without animation authority', async t => {
  const f = await animationPreviewFixture(t), s = service(t, f.root), content = await f.read(scenePath);
  const draft = await s.create({ sceneId, draft: { sourcePath: scenePath, baseSourceRevision: revision(content), content } });
  assert.equal(draft.ok, true); assert.ok(draft.draft); assert.equal(Object.hasOwn(draft, 'animationPreview'), false);
  const recipe = await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'); await f.write(scenePath, recipe);
  const before = await fingerprint(f.root), old = await s.create({ sceneId }), requested = await s.create({ sceneId, includeAnimation: true });
  assert.equal(requested.ok, true, JSON.stringify(requested.diagnostics)); assert.ok(requested.composition);
  assert.equal(Object.hasOwn(requested, 'animationPreview'), false); assert.deepEqual(comparable(requested), comparable(old));
  assert.deepEqual(await fingerprint(f.root), before);
});

test('saved animation previews share existing image lease eviction, explicit release and expiration', async t => {
  const f = await animationPreviewFixture(t), s = service(t, f.root, { ttlMs: 1000 });
  const first = await s.create({ sceneId }), second = await s.create({ sceneId, includeAnimation: true }), third = await s.create({ sceneId, includeAnimation: true });
  assert.throws(() => s.resource(first.previewId, imageId), { errorCode: 'scene_preview_expired' });
  assert.equal(s.resource(second.previewId, imageId).bytes.length, 231);
  assert.deepEqual(s.release(third.previewId), { released: true }); assert.deepEqual(s.release(third.previewId), { released: false });
  assert.throws(() => s.resource(third.previewId, imageId), { errorCode: 'scene_preview_expired' });
  const expiring = service(t, f.root, { ttlMs: 25 }), last = await expiring.create({ sceneId, includeAnimation: true });
  await delay(60); assert.throws(() => expiring.resource(last.previewId, imageId), { errorCode: 'scene_preview_expired' });
  await s.close(); assert.throws(() => s.resource(second.previewId, imageId), { errorCode: 'scene_preview_closed' });
});

test('aborted and superseded animated capture requests cannot create leases or invalidate the last visible image', async t => {
  const f = await animationPreviewFixture(t); let hold = false, entered, finish;
  const s = service(t, f.root, { capture: async (...args) => {
    const captured = await captureScenePreviewSnapshot(...args);
    if (hold) { hold = false; entered(); await new Promise(resolve => { finish = resolve; }); }
    return captured;
  } });
  const visible = await s.create({ sceneId, includeAnimation: true });
  for (const callerAbort of [true, false]) {
    const started = new Promise(resolve => { entered = resolve; }); hold = true;
    const controller = new AbortController(), pending = s.create({ sceneId, includeAnimation: true }, { signal: controller.signal });
    await started; let newer;
    if (callerAbort) controller.abort(); else newer = s.create({ sceneId, includeAnimation: true });
    const rejected = assert.rejects(pending, { errorCode: 'scene_preview_superseded' }); finish(); await rejected;
    assert.equal(s.resource(visible.previewId, imageId).bytes.length, 231);
    if (newer) { const result = await newer; assert.equal(result.animationPreview.status, 'ready'); s.release(result.previewId); }
  }
});

test('static capture failures omit animation without consuming the visible image lease', async t => {
  const f = await animationPreviewFixture(t), s = service(t, f.root), old = await s.create({ sceneId, includeAnimation: true });
  await f.write('assets/traveler.svg', '<svg>changed independently</svg>');
  const before = await fingerprint(f.root), failed = await s.create({ sceneId, includeAnimation: true });
  assert.equal(failed.ok, false); assert.equal(failed.previewId, null); assert.equal(Object.hasOwn(failed, 'animationPreview'), false);
  assert.ok(failed.diagnostics.some(item => item.code === 'build_resource_changed'));
  assert.equal(s.resource(old.previewId, imageId).bytes.length, 231); assert.deepEqual(await fingerprint(f.root), before);
});
