import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildHash, captureBuildSnapshot, captureSceneDraftPreview } from '../adapters/node-build-snapshot.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { overlaySceneDraftPreview, validateSceneDraftRequest } from '../../engine/scene-draft-preview.mjs';
import { MAX_SCENE_DRAFT_BYTES } from '../../engine/scene-preview-contract.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const instanceId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const sourcePath = 'documents/scenes/demo.json';
const hash = text => `sha256:${buildHash(text)}`;

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-draft-'));
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const content = await fs.readFile(path.join(root, sourcePath), 'utf8');
  const service = createScenePreviewService(root, { enabled: true, ...options });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, service, content, draft: { sourcePath, baseSourceRevision: hash(content), content } };
}
async function fingerprint(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath || entry.path, entry.name);
    hashes[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
const revise = (draft, update) => {
  const value = JSON.parse(draft.content.replace(/^\uFEFF/, '')); update(value);
  return { ...draft, content: `\uFEFF${JSON.stringify(value, null, 2).replaceAll('\n', '\r\n')}\r\n` };
};

test('draft preview overlays exact BOM/CRLF bytes with deterministic identity and no authored, metadata, cache or task writes', async t => {
  const { root, service, draft } = await fixture(t), before = await fingerprint(root);
  const changed = revise(draft, scene => { scene.title = '草稿 🎭'; scene.actors[0].position = [314, 159]; });
  const saved = await captureBuildSnapshot(root, sceneId), captured = await captureSceneDraftPreview(root, sceneId, changed);
  const preview = await service.create({ sceneId, draft: changed });
  assert.equal(preview.ok, true); assert.equal(preview.scene.title, '草稿 🎭');
  assert.deepEqual(preview.actors[0].position, [314, 159]);
  assert.deepEqual(preview.draft, { baseSourceRevision: draft.baseSourceRevision, sourceRevision: hash(changed.content) });
  assert.equal(captured.snapshot, undefined); assert.equal(captured.sceneEditing, undefined);
  assert.equal(preview.snapshot, undefined); assert.equal(preview.sceneEditing, undefined);
  assert.equal(preview.scene.sourceRevision, preview.draft.sourceRevision);
  assert.equal(preview.sourceLocations.scene.sourceRevision, preview.draft.sourceRevision);
  assert.equal(preview.snapshotId, captured.snapshotId); assert.notEqual(preview.snapshotId, saved.snapshotId);
  assert.equal((await captureSceneDraftPreview(root, sceneId, changed)).snapshotId, preview.snapshotId);
  const location = preview.sourceLocations.actors[0].fields.position;
  assert.equal(location.sourceRevision, preview.draft.sourceRevision); assert.equal(location.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(changed.content.slice(location.sourceRange.start, location.sourceRange.end)), [314, 159]);
  assert.equal(preview.sourceLocations.actors[0].definition.sourceRevision, saved.sourceLocations.actors[0].definition.sourceRevision);
  assert.equal(buildHash(service.resource(preview.previewId, imageId).bytes), preview.resources[0].sha256);
  const identical = await captureSceneDraftPreview(root, sceneId, draft);
  assert.deepEqual(identical.plan, saved.plan); assert.notEqual(identical.snapshotId, saved.snapshotId, 'same content still has a separate preview identity domain');
  assert.deepEqual(await captureBuildSnapshot(root, sceneId, { draft: changed }), saved, 'build capture cannot accept draft bytes');
  assert.deepEqual(await fingerprint(root), before);
});

test('portable draft overlay clones the observation, derives current diagnostics and preserves registered relations', async t => {
  const { root, draft } = await fixture(t), observed = await readWorldSnapshot(root), frozen = structuredClone(observed);
  const changed = revise(draft, scene => { scene.title = 'Derived draft'; });
  const overlaid = await overlaySceneDraftPreview(observed, sceneId, changed, { digest: buildHash });
  assert.notEqual(overlaid.projection.world.revision, observed.projection.world.revision);
  assert.deepEqual(overlaid.projection.relations, observed.projection.relations);
  assert.deepEqual(overlaid.projection.resourceBindings, observed.projection.resourceBindings);
  assert.deepEqual(overlaid.source.documents.map(item => item.record), observed.source.documents.map(item => item.record));
  assert.deepEqual(observed, frozen);
  overlaid.source.documents.find(item => item.record?.id === sceneId).record.relations.length = 0;
  assert.deepEqual(observed, frozen, 'no registered record aliases escape the overlay');
  const broken = '{broken'; await fs.writeFile(path.join(root, sourcePath), broken);
  const repaired = await captureSceneDraftPreview(root, sceneId, { ...changed, baseSourceRevision: hash(broken) });
  assert.equal(repaired.ok, true, 'a valid draft can repair saved syntax errors without stale projection diagnostics');
  assert.equal(await fs.readFile(path.join(root, sourcePath), 'utf8'), broken);
});

test('draft validation uses exact request keys, lowercase identities, SHA-256, UTF-8 bytes and bounded paths', async t => {
  const { root, service, draft } = await fixture(t), before = await fingerprint(root);
  for (const value of [null, [], {}, { ...draft, extra: true }, { ...draft, sourcePath: 2 }, { ...draft, sourcePath: '' },
    { ...draft, sourcePath: 'x'.repeat(4097) }, { ...draft, content: null }, { ...draft, content: '\ud800' },
    { ...draft, content: '\udfff' }, { ...draft, baseSourceRevision: 'sha256:' + 'A'.repeat(64) },
    { ...draft, baseSourceRevision: '0'.repeat(64) }, { ...draft, content: 'x'.repeat(MAX_SCENE_DRAFT_BYTES + 1) },
    { ...draft, content: '界'.repeat(Math.floor(MAX_SCENE_DRAFT_BYTES / 3) + 1) }]) {
    await assert.rejects(service.create({ sceneId, draft: value }), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  }
  for (const payload of [{ sceneId, draft, extra: true }, { sceneId: sceneId.toUpperCase(), draft }, { sceneId, draft: undefined }]) {
    await assert.rejects(service.create(payload), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  }
  assert.doesNotThrow(() => validateSceneDraftRequest(sceneId, { ...draft, content: 'x'.repeat(MAX_SCENE_DRAFT_BYTES) }));
  assert.doesNotThrow(() => validateSceneDraftRequest(sceneId, { ...draft, content: '\u0000'.repeat(MAX_SCENE_DRAFT_BYTES) }));
  const worstEnvelope = JSON.stringify({ sceneId, draft: { ...draft, sourcePath: '\u0000'.repeat(4096), content: '\u0000'.repeat(MAX_SCENE_DRAFT_BYTES) } });
  assert.ok(Buffer.byteLength(worstEnvelope) < 1024 * 1024, 'every allowed payload fits within the default HTTP total limit');
  assert.deepEqual(await fingerprint(root), before);
});

test('draft cannot address a different document, unregistered source, arbitrary path or stale disk baseline', async t => {
  const { root, service, draft } = await fixture(t), before = await fingerprint(root);
  for (const source of ['../scene.json', '/tmp/scene.json', 'documents/scenes/../scenes/demo.json', 'documents/actors/traveler.json']) {
    await assert.rejects(service.create({ sceneId, draft: { ...draft, sourcePath: source } }), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  }
  await assert.rejects(service.create({ sceneId: actorId, draft }), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  await assert.rejects(service.create({ sceneId: otherId, draft }), { errorCode: 'scene_preview_request_invalid', statusCode: 400 });
  await assert.rejects(service.create({ sceneId, draft: { ...draft, baseSourceRevision: 'sha256:' + '0'.repeat(64) } }),
    { errorCode: 'scene_preview_draft_conflict', statusCode: 409 });
  assert.deepEqual(await fingerprint(root), before);
  await fs.writeFile(path.join(root, sourcePath), draft.content.replace('Viento Scene2D', 'External edit'));
  await assert.rejects(service.create({ sceneId, draft }), { errorCode: 'scene_preview_draft_conflict', statusCode: 409 });
  assert.match(await fs.readFile(path.join(root, sourcePath), 'utf8'), /External edit/);
});

test('invalid syntax, duplicate keys, unsupported schemas and unregistered references return revision-bound diagnostics without writes', async t => {
  const { root, service, draft } = await fixture(t), before = await fingerprint(root), usable = await service.create({ sceneId });
  const values = [
    ['\uFEFF{ "title":\r\n', 'build_scene_json'],
    [draft.content.replace('"format":', '"title":"Duplicate", "format":'), 'build_scene_json'],
    [revise(draft, scene => { scene.schemaVersion = 4; }).content, 'build_scene_format'],
    [revise(draft, scene => { scene.actors[0].objectId = otherId; }).content, 'build_actor_missing'],
    [revise(draft, scene => { scene.actors[0].imageResourceId = otherId; }).content, 'build_image_unsupported'],
  ];
  for (const [content, code] of values) {
    const rejected = await service.create({ sceneId, draft: { ...draft, content } });
    assert.equal(rejected.ok, false); assert.equal(rejected.previewId, null); assert.equal(rejected.sceneEditing, undefined);
    assert.equal(rejected.draft.sourceRevision, hash(content));
    assert.ok(rejected.diagnostics.some(item => item.code === code), JSON.stringify(rejected.diagnostics));
    assert.ok(rejected.diagnostics.every(item => item.objectId !== sceneId || item.sourceRevision === hash(content)));
    assert.equal(service.resource(usable.previewId, imageId).bytes.length, 231);
  }
  assert.deepEqual(await fingerprint(root), before);
});

test('a registered but unlinked actor still requires metadata registration and is not silently promoted by preview', async t => {
  const { root, service, draft } = await fixture(t);
  const original = JSON.parse(await fs.readFile(path.join(root, `metadata/documents/${actorId}.json`), 'utf8'));
  const actorContent = await fs.readFile(path.join(root, original.sourcePath), 'utf8');
  const next = { ...original, id: otherId, sourcePath: 'documents/characters/other.md' };
  await fs.mkdir(path.join(root, 'documents/characters'), { recursive: true });
  await fs.writeFile(path.join(root, next.sourcePath), actorContent);
  await fs.writeFile(path.join(root, `metadata/documents/${otherId}.json`), JSON.stringify(next));
  const before = await fingerprint(root), changed = revise(draft, scene => { scene.actors[0].objectId = otherId; });
  const result = await service.create({ sceneId, draft: changed });
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.code === 'build_actor_unlinked'));
  assert.deepEqual(await fingerprint(root), before);
});

test('draft v3 groups travel only in the validated preview sidecar and preserve exact draft group ranges', async t => {
  const { root, service, draft } = await fixture(t), before = await fingerprint(root);
  const changed = revise(draft, scene => {
    scene.schemaVersion = 3; scene.groups = [{ groupId, name: '主角 🎭' }];
    scene.actors[0].instanceId = instanceId; scene.actors[0].groupId = groupId;
  });
  const result = await service.create({ sceneId, draft: changed });
  assert.equal(result.ok, true); assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.sceneStructure.groups, [{ groupId, name: '主角 🎭' }]);
  assert.deepEqual(result.sceneStructure.memberships, [{ instanceId, groupId }]);
  assert.equal(result.actors[0].groupId, undefined); assert.equal(result.sceneEditing, undefined);
  const location = result.sourceLocations.groups[0].fields.name;
  assert.equal(location.sourceRevision, hash(changed.content));
  assert.equal(JSON.parse(changed.content.slice(location.sourceRange.start, location.sourceRange.end)), '主角 🎭');
  assert.deepEqual(await fingerprint(root), before);
});

test('draft image validation keeps earlier verified bytes and locates failures in the exact draft', async t => {
  const { root, service, draft } = await fixture(t), previous = await service.create({ sceneId });
  const frozen = Buffer.from(service.resource(previous.previewId, imageId).bytes);
  const changed = revise(draft, scene => { scene.title = 'New draft'; });
  await fs.writeFile(path.join(root, 'assets/traveler.svg'), '<svg>changed image</svg>');
  const before = await fingerprint(root), result = await service.create({ sceneId, draft: changed });
  assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'build_resource_changed');
  assert.equal(result.diagnostics[0].sourceRevision, hash(changed.content));
  assert.equal(result.diagnostics[0].propertyPath, '/actors/0/imageResourceId');
  assert.deepEqual(service.resource(previous.previewId, imageId).bytes, frozen);
  assert.deepEqual(await fingerprint(root), before);
});

test('draft capture observes cancellation before filesystem access and never exposes a mutable build envelope', async t => {
  const { root, draft } = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(captureSceneDraftPreview(root, sceneId, draft, { signal: controller.signal }), { name: 'AbortError' });
  const observed = await readWorldSnapshot(root);
  const result = await overlaySceneDraftPreview(observed, sceneId, draft, { digest: async bytes => buildHash(bytes) });
  assert.equal(result.draft.sourceRevision, draft.baseSourceRevision);
  await assert.rejects(overlaySceneDraftPreview(observed, sceneId, draft, { digest: () => 'bad-hash' }), TypeError);
  assert.equal(canonicalJson(observed.source), canonicalJson(result.source));
});

test('disconnect and superseding saved capture cancel draft work while preserving the previous images', async t => {
  let started, signalSeen, unblock;
  const entered = new Promise(resolve => { started = resolve; });
  const { root, service, draft } = await fixture(t, { captureDraft: async (...args) => {
    signalSeen = args[3].signal; started();
    await new Promise(resolve => { unblock = resolve; signalSeen.addEventListener('abort', resolve, { once: true }); });
    return captureSceneDraftPreview(...args);
  } });
  const saved = await service.create({ sceneId }), controller = new AbortController();
  const pending = service.create({ sceneId, draft }, { signal: controller.signal });
  const rejected = assert.rejects(pending, { errorCode: 'scene_preview_superseded', statusCode: 409 });
  await entered; controller.abort(); await rejected; assert.equal(signalSeen.aborted, true);
  assert.equal(service.resource(saved.previewId, imageId).bytes.length, 231);
  const another = service.create({ sceneId, draft }), superseded = assert.rejects(another, { errorCode: 'scene_preview_superseded' });
  const latest = await service.create({ sceneId }); await superseded; unblock();
  assert.equal(latest.ok, true); assert.equal(latest.draft, undefined);
  assert.equal(latest.snapshotId, (await captureBuildSnapshot(root, sceneId)).snapshotId);
});

test('closing and disabled services apply equally to drafts and never publish late results', async t => {
  let aborted = false;
  const { service, draft } = await fixture(t, { captureDraft: async (_root, _id, _draft, { signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    return { ok: false, diagnostics: [] };
  } });
  const pending = service.create({ sceneId, draft }), rejected = assert.rejects(pending, { errorCode: 'scene_preview_closed' });
  await service.close(); await rejected; assert.equal(aborted, true);
  const disabled = createScenePreviewService('/does-not-exist', { enabled: false, captureDraft: () => assert.fail('No capture on disabled host') });
  await assert.rejects(disabled.create({ sceneId, draft }), { errorCode: 'scene_preview_unavailable' }); await disabled.close();
});

test('a saved source change during image freezing rejects the draft baseline without overwriting the external edit', async t => {
  const { root, service, draft } = await fixture(t), open = fs.open;
  const external = draft.content.replace('Viento Scene2D', 'External during freeze');
  let changed = false;
  fs.open = async (file, ...args) => {
    const handle = await open(file, ...args);
    if (!changed && file === path.join(root, 'assets/traveler.svg')) {
      changed = true; await fs.writeFile(path.join(root, sourcePath), external);
    }
    return handle;
  };
  try {
    await assert.rejects(service.create({ sceneId, draft }), { errorCode: 'scene_preview_draft_conflict', statusCode: 409 });
    assert.equal(changed, true); assert.equal(await fs.readFile(path.join(root, sourcePath), 'utf8'), external);
  } finally { fs.open = open; }
});
