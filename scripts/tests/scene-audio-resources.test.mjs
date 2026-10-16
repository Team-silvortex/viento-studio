import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { captureSceneAudioResources, isSceneAudioResources, sceneAudioResourcesMatchSource, sceneAudioResourcesEqual, sceneAudioResourceIdentityIds } from '../../engine/scene-audio-resources.mjs';
import { createSceneAudioProposal, createSceneAudioCueProposal, createSceneAudioTimelineProposal, createSceneAudioTrackProposal,
  createSceneAudioResourceProposal, isSceneAudioProposal, sceneAudioProposalNeedsResources, prepareSceneAudioApply, readSceneAudioDocument } from '../../engine/scene-audio-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const revision = text => 'sha256:' + hash(text);
const model = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
  tracks: [{ id: id(2), resourceId: id(3), role: 'music', volume: .5, loop: true }],
  cues: [{ id: id(6), trackId: id(2), atSeconds: 0, action: 'play' }] });
const original = '\ufeff' + JSON.stringify(model(), null, '\t').replaceAll('\n', '\r\n')
  .replace('"resourceId"', '"resource\\u0049d"').replace('"volume": 0.5', '"volume": 5e-1') + '\r\n';
const source = (content = original) => ({ sourcePath: 'documents/audio/demo.json', token: 'source:1', content,
  baseSourceRevision: revision(original), sourceRevision: revision(content) });
const resource = n => ({ resourceId: id(n), resourceRevision: revision('resource-' + n), name: `Sound ${n}`,
  sourcePath: `tone-${n}.wav`, sha256: hash('bytes-' + n), size: 512, availability: 'unverified' });
const context = () => ({ format: 'viento-audio-creation-context', schemaVersion: 1, status: 'ready', worldId: 'world:' + hash('world'),
  baseRevision: revision('world-state'), documentRoot: 'documents', documentTypes: [{ id: 'audio', label: 'Audio' }],
  scene: { objectId: id(1), objectRevision: revision('scene'), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene-source') },
  manifest: { objectId: id(8), objectRevision: revision('audio-metadata'), sourcePath: source().sourcePath, sourceRevision: revision(original),
    documentType: 'audio', parserProfile: 'structured', content: original,
    relations: [{ kind: 'reference', targetId: id(1), slot: 'scene' }], assetBindings: [{ assetId: id(3), role: 'audio' }, { assetId: id(4), role: 'audio' }], trackCount: 1 },
  resources: [resource(3), resource(4), resource(5)] });
const edit = (doc = model()) => ({ tracks: doc.tracks.map(row => ({ ...row })), cues: doc.cues.map(row => ({ ...row })) });
const changed = () => { const value = edit(); value.tracks[0].resourceId = id(4); return value; };
const invalid = error => ['scene_audio_resources_invalid', 'scene_audio_creation_invalid', 'scene_audio_authoring_invalid', 'scene_audio_invalid'].includes(error?.errorCode);
const conflict = { errorCode: 'scene_audio_authoring_conflict' };
const token = (content, path) => { const { start, end } = locateJsonSource(parseJsonSource(content), path); return content.slice(start, end); };

test('resource capture exposes only bound available WAV choices and freezes a detached branded catalog', () => {
  const raw = context(), s = source(), catalog = captureSceneAudioResources(s, raw);
  assert.ok(isSceneAudioResources(catalog)); assert.equal(catalog instanceof Promise, false);
  assert.deepEqual(catalog.resources.map(row => row.resourceId), [id(3), id(4)]);
  assert.deepEqual(sceneAudioResourceIdentityIds(catalog), [id(3), id(4), id(5)]);
  for (const key of ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision']) assert.equal(catalog[key], s[key]);
  assert.equal(catalog.sceneObjectId, id(1)); assert.equal(catalog.worldId, raw.worldId); assert.equal(catalog.worldRevision, raw.baseRevision);
  assert.equal(catalog.objectId, id(8)); assert.equal(catalog.objectRevision, raw.manifest.objectRevision); assert.equal(catalog.savedContent, original);
  assert.ok(Object.isFrozen(catalog)); assert.ok(Object.isFrozen(catalog.resources)); assert.ok(Object.isFrozen(catalog.resources[0]));
  raw.resources[0].name = 'Changed'; s.content = '{}';
  assert.equal(catalog.resources[0].name, 'Sound 3'); assert.ok(sceneAudioResourcesMatchSource(catalog, source()));
  for (const fake of [{ ...catalog }, structuredClone(catalog)]) {
    assert.equal(isSceneAudioResources(fake), false); assert.equal(sceneAudioResourcesEqual(catalog, fake), false);
    assert.equal(sceneAudioResourcesMatchSource(fake, source()), false);
  }
});
test('resource capture binds saved manifest and exact draft source while permitting unsaved leaf edits', () => {
  const draft = original.replace('5e-1', '0.25'), catalog = captureSceneAudioResources(source(draft), context());
  assert.equal(catalog.savedContent, original); assert.equal(catalog.sourceRevision, revision(draft));
  assert.ok(sceneAudioResourcesMatchSource(catalog, source(draft))); assert.equal(sceneAudioResourcesMatchSource(catalog, source()), false);
  for (const mutate of [raw => { raw.status = 'empty'; raw.manifest = null; }, raw => { raw.scene.objectId = id(90); },
    raw => { raw.manifest.sourcePath = 'documents/audio/other.json'; }, raw => { raw.manifest.sourceRevision = revision('other'); },
    raw => { raw.manifest.trackCount = 2; }, raw => { raw.manifest.assetBindings = []; }]) {
    const raw = context(); mutate(raw); assert.throws(() => captureSceneAudioResources(source(), raw), invalid);
  }
});
test('source capture rejects accessors hidden fields prototypes invalid paths and invalid source JSON', () => {
  let calls = 0;
  for (const mutate of [s => Object.defineProperty(s, 'content', { enumerable: true, get() { calls++; return original; } }),
    s => Object.setPrototypeOf(s, { inherited: true }), s => { s.extra = true; }, s => { s.sourcePath = '../audio.json'; },
    s => { s.content = '{}'; }, s => { s.content = original.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'); },
    s => { s.content = 'x'.repeat(65537); }, s => { s.token = '\ud800'; }, s => { s.sourceRevision = 'invalid'; }]) {
    const s = source(); mutate(s); assert.throws(() => captureSceneAudioResources(s, context()), invalid);
  }
  assert.equal(calls, 0);
});
test('creation context capture rejects getters sparse arrays prototypes invalid registration and resource budgets', () => {
  let calls = 0;
  for (const mutate of [raw => Object.defineProperty(raw.resources[0], 'name', { enumerable: true, get() { calls++; return 'bad'; } }),
    raw => Object.setPrototypeOf(raw.resources[0], { inherited: true }), raw => { delete raw.resources[0]; },
    raw => { raw.resources = Array.from({ length: 257 }, (_, index) => resource(100 + index)); },
    raw => { raw.resources[0].sourcePath = '../else.wav'; }, raw => { raw.resources[0].sourcePath = 'tone.mp3'; },
    raw => { raw.resources[0].availability = 'verified'; }, raw => { raw.resources[0].resourceRevision = 'invalid'; },
    raw => { raw.resources[0].name = 'x'.repeat(32769); }, raw => { raw.resources.push({ ...raw.resources[0] }); }]) {
    const raw = context(); mutate(raw); assert.throws(() => captureSceneAudioResources(source(), raw), invalid);
  }
  assert.equal(calls, 0);
  const maximum = context(); maximum.resources.push(...Array.from({ length: 253 }, (_, index) => resource(100 + index)));
  const catalog = captureSceneAudioResources(source(), maximum);
  assert.equal(sceneAudioResourceIdentityIds(catalog).length, 256); assert.equal(catalog.resources.length, 2);
});
test('missing available resources are not fabricated and binding annotations remain eligible', async () => {
  const raw = context(); raw.resources = [resource(4)]; raw.manifest.assetBindings[1].role = '';
  raw.manifest.assetBindings[1].note = { text: 'Author annotation' };
  const catalog = captureSceneAudioResources(source(), raw);
  assert.deepEqual(catalog.resources.map(row => row.resourceId), [id(4)]);
  await assert.rejects(createSceneAudioResourceProposal(source(), edit(), catalog), invalid);
  const p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  assert.equal((await readSceneAudioDocument(p.afterContent)).tracks[0].resourceId, id(4));
});
test('catalog equality covers full source context metadata and all available resource registration revisions', () => {
  const a = captureSceneAudioResources(source(), context()), b = captureSceneAudioResources(source(), context());
  assert.notEqual(a, b); assert.ok(sceneAudioResourcesEqual(a, b));
  for (const mutate of [raw => { raw.baseRevision = revision('next-world'); }, raw => { raw.manifest.objectRevision = revision('next-object'); },
    raw => { raw.scene.objectRevision = revision('next-scene'); }, raw => { raw.resources[1].resourceRevision = revision('next-resource'); },
    raw => { raw.resources[2].resourceRevision = revision('next-unbound-resource'); }, raw => { raw.resources[1].sha256 = hash('new-bytes'); },
    raw => { raw.resources[1].sourcePath = 'moved.wav'; }, raw => { raw.manifest.assetBindings[1].role = 'different'; },
    raw => { raw.manifest.relations[0].note = 'New author note'; }, raw => { raw.resources.reverse(); }]) {
    const raw = context(); mutate(raw); const current = captureSceneAudioResources(source(), raw);
    assert.equal(sceneAudioResourcesEqual(a, current), false);
  }
});
test('resource replacement edits only its escaped source leaf and preserves BOM CRLF untouched fields and identity', async () => {
  const catalog = captureSceneAudioResources(source(), context());
  const p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  assert.equal(p.afterContent, original.replace(`"resource\\u0049d": "${id(3)}"`, `"resource\\u0049d": "${id(4)}"`));
  assert.deepEqual(p.changedPaths, ['/tracks/0/resourceId']);
  assert.equal(token(p.afterContent, '/cues'), token(original, '/cues'));
  assert.ok(sceneAudioProposalNeedsResources(p)); assert.ok(isSceneAudioProposal(p)); assert.equal(p.kind, 'scene-audio');
  assert.equal(Object.hasOwn(p, 'resources'), false); assert.equal(Object.hasOwn(p, 'catalog'), false);
});
test('resource proposals combine replacements new tracks and cue changes while keeping the original track order', async () => {
  const rows = changed(); rows.tracks.push({ ...rows.tracks[0], id: id(20), volume: .2, loop: false });
  rows.cues.unshift({ ...rows.cues[0], id: id(21), trackId: id(20), action: 'stop' });
  const catalog = captureSceneAudioResources(source(), context()), p = await createSceneAudioResourceProposal(source(), rows, catalog);
  const after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.tracks, rows.tracks); assert.deepEqual(after.cues, rows.cues); assert.deepEqual(p.changedPaths, ['/tracks', '/cues']);
  assert.equal(token(p.afterContent, '/tracks/0'), token(original, '/tracks/0').replace(id(3), id(4)));
  assert.equal(token(p.afterContent, '/cues/1'), token(original, '/cues/0'));
});
test('resource proposal rejects unbound unknown unavailable or forged choices for every candidate track', async () => {
  for (const resourceId of [id(5), id(99)]) {
    const rows = changed(); rows.tracks[0].resourceId = resourceId;
    await assert.rejects(createSceneAudioResourceProposal(source(), rows, captureSceneAudioResources(source(), context())), invalid);
  }
  const catalog = captureSceneAudioResources(source(), context());
  for (const invalidCatalog of [null, { ...catalog }, structuredClone(catalog)]) {
    await assert.rejects(createSceneAudioResourceProposal(source(), changed(), invalidCatalog), invalid);
  }
  const rows = edit(); rows.tracks.push({ ...rows.tracks[0], id: id(20), resourceId: id(5) });
  await assert.rejects(createSceneAudioResourceProposal(source(), rows, catalog), invalid);
});
test('new track and cue identities avoid both bound and unbound registered resource IDs', async () => {
  const catalog = captureSceneAudioResources(source(), context());
  for (const identity of [id(3), id(4), id(5)]) for (const kind of ['tracks', 'cues']) {
    const rows = changed(); rows[kind].push({ ...rows[kind][0], id: identity });
    await assert.rejects(createSceneAudioResourceProposal(source(), rows, catalog), invalid);
  }
});
test('resource proposal preserves all prior structural domain limits and reports unchanged input', async () => {
  const catalog = captureSceneAudioResources(source(), context());
  await assert.rejects(createSceneAudioResourceProposal(source(), edit(), catalog), { errorCode: 'scene_audio_authoring_unchanged' });
  for (const mutate of [rows => { rows.tracks = []; rows.cues = []; }, rows => { rows.cues[0].trackId = id(99); },
    rows => { rows.tracks[0].volume = 2; }, rows => rows.tracks.unshift({ ...rows.tracks[0], id: id(20) }),
    rows => { rows.tracks = Array.from({ length: 17 }, (_, index) => ({ ...rows.tracks[0], id: id(100 + index) })); rows.cues = []; }]) {
    const rows = changed(); mutate(rows); await assert.rejects(createSceneAudioResourceProposal(source(), rows, catalog), invalid);
  }
});
test('all four older APIs keep their resource authority unchanged and require no resource catalog', async () => {
  const rows = changed();
  for (const factory of [createSceneAudioProposal, createSceneAudioCueProposal, createSceneAudioTimelineProposal, createSceneAudioTrackProposal]) {
    await assert.rejects(factory(source(), rows), invalid);
  }
  const older = edit(); older.tracks[0].volume = .2;
  const p = await createSceneAudioTrackProposal(source(), older);
  assert.equal(sceneAudioProposalNeedsResources(p), false); assert.equal(sceneAudioProposalNeedsResources({ ...p }), false);
  assert.equal((await prepareSceneAudioApply(source(), p, { digest: hash })).afterContent, p.afterContent);
});
test('resource factories capture input before awaiting and never invoke edit accessors', async () => {
  const input = source(), rows = changed(), raw = context(), catalog = captureSceneAudioResources(input, raw);
  const pending = createSceneAudioResourceProposal(input, rows, catalog);
  input.content = '{}'; rows.tracks[0].resourceId = id(5); raw.resources[1].resourceId = id(99);
  const p = await pending; assert.equal((await readSceneAudioDocument(p.afterContent)).tracks[0].resourceId, id(4));
  assert.equal(p.beforeContent, original); assert.ok(Object.isFrozen(p.edit.tracks[0]));
  let calls = 0; const unsafe = changed();
  Object.defineProperty(unsafe.tracks[0], 'resourceId', { enumerable: true, get() { calls++; return id(4); } });
  await assert.rejects(createSceneAudioResourceProposal(source(), unsafe, catalog), invalid); assert.equal(calls, 0);
});
test('resource apply requires a separately captured branded catalog and repeats the reviewed patch', async () => {
  const catalog = captureSceneAudioResources(source(), context()), p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  for (const resources of [undefined, catalog, { ...catalog }, structuredClone(catalog)]) {
    await assert.rejects(prepareSceneAudioApply(source(), p, { digest: hash, resources }), conflict);
  }
  const fresh = captureSceneAudioResources(source(), context());
  assert.equal((await prepareSceneAudioApply(source(), p, { digest: hash, resources: fresh })).afterContent, p.afterContent);
  for (const fake of [{ ...p }, structuredClone(p)]) {
    assert.equal(sceneAudioProposalNeedsResources(fake), false);
    await assert.rejects(prepareSceneAudioApply(source(), fake, { digest: hash, resources: fresh }), conflict);
  }
});
test('resource apply rejects world object source metadata resource-registration and candidate-list changes', async () => {
  const catalog = captureSceneAudioResources(source(), context()), p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  for (const mutate of [raw => { raw.baseRevision = revision('next-world'); }, raw => { raw.manifest.objectRevision = revision('next-object'); },
    raw => { raw.scene.sourceRevision = revision('next-scene'); }, raw => { raw.resources[1].resourceRevision = revision('next-resource'); },
    raw => { raw.resources[2].name = 'Unbound resource changed'; }, raw => { raw.manifest.assetBindings.pop(); },
    raw => { raw.resources.pop(); }, raw => { raw.resources[1].size++; }, raw => { raw.manifest.relations[0].note = 'edited'; }]) {
    const raw = context(); mutate(raw);
    await assert.rejects(prepareSceneAudioApply(source(), p, { digest: hash, resources: captureSceneAudioResources(source(), raw) }), conflict);
  }
});
test('resource catalogs and proposals match every source field including content', async () => {
  const catalog = captureSceneAudioResources(source(), context()), p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  for (const key of ['token', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'content']) {
    const s = { ...source(), [key]: source()[key] + 'x' };
    assert.equal(sceneAudioResourcesMatchSource(catalog, s), false);
    await assert.rejects(createSceneAudioResourceProposal(s, changed(), catalog), invalid);
    await assert.rejects(prepareSceneAudioApply(s, p, { digest: hash, resources: captureSceneAudioResources(source(), context()) }), conflict);
  }
  const differentToken = { ...source(), token: 'source:2' };
  await assert.rejects(prepareSceneAudioApply(source(), p, { digest: hash, resources: captureSceneAudioResources(differentToken, context()) }), conflict);
});
test('apply verifies the saved manifest hash instead of trusting its claimed base revision', async () => {
  const raw = context(); raw.manifest.content += ' ';
  const catalog = captureSceneAudioResources(source(), raw), p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  await assert.rejects(prepareSceneAudioApply(source(), p, { digest: hash, resources: captureSceneAudioResources(source(), raw) }), conflict);
  const good = context(), draft = original.replace('5e-1', '0.25'), s = source(draft), rows = changed(); rows.tracks[0].volume = .25;
  const valid = await createSceneAudioResourceProposal(s, rows, captureSceneAudioResources(s, good));
  const seen = [];
  assert.equal((await prepareSceneAudioApply(s, valid, { digest: value => { seen.push(value); return hash(value); }, resources: captureSceneAudioResources(s, good) })).afterContent, valid.afterContent);
  assert.deepEqual(seen, [draft, original]);
});
test('fresh catalogs remain immutable during asynchronous digest boundaries and preparation snapshots its source', async () => {
  const catalog = captureSceneAudioResources(source(), context()), p = await createSceneAudioResourceProposal(source(), changed(), catalog);
  const input = source(), fresh = captureSceneAudioResources(input, context()); let release;
  const pending = prepareSceneAudioApply(input, p, { resources: fresh, digest: value => new Promise(resolve => { release = () => resolve(hash(value)); }) });
  input.content = '{}'; input.token = 'changed'; release();
  await Promise.resolve(); await Promise.resolve(); release();
  const result = await pending; assert.equal(result.afterContent, p.afterContent);
  assert.throws(() => { fresh.resources[1].resourceRevision = revision('changed'); }, TypeError);
});
