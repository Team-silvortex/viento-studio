import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSceneSourceLayoutDraft, patchSceneSourcePositions, prepareSceneSourceLayoutApply } from '../../engine/scene-source-layout.mjs';
import { createSceneLayoutDraft } from '../../engine/scene-layout.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { buildSceneOutline } from '../../engine/scene-groups.mjs';
import { MAX_SCENE_DRAFT_BYTES } from '../../engine/scene-preview-contract.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const parent = '33333333-3333-4333-8333-333333333333', child = '44444444-4444-4444-8444-444444444444';
const hash = value => createHash('sha256').update(value).digest('hex'), digest = async value => hash(value);
const baseSourceRevision = 'sha256:' + '1'.repeat(64), sourcePath = 'documents/scenes/current.json';
const invalid = { errorCode: 'scene_source_layout_invalid' }, conflict = { errorCode: 'scene_source_layout_conflict' };
const parse = value => JSON.parse(value.replace(/^\uFEFF/, ''));
function fixture(version = 3) {
  const declaration = { format: 'viento-scene2d', schemaVersion: version, title: 'Draft: 町😀', viewport: [640, 480], background: '#123456',
    ...(version === 3 ? { groups: [{ groupId: parent, name: 'Town' }, { groupId: child, name: 'Square', parentGroupId: parent }] } : {}),
    actors: [
      { objectId: first, ...(version >= 2 ? { instanceId: first } : {}), ...(version === 3 ? { groupId: parent } : {}),
        position: [100, 0], useProjectionDefaults: true, imageResourceId: null },
      { objectId: version >= 2 ? first : second, ...(version >= 2 ? { instanceId: second } : {}), ...(version === 3 ? { groupId: child } : {}),
        position: [300, 200], useProjectionDefaults: false, size: [80, 60], color: '#445566', speed: 120, controls: 'none' },
    ] };
  const content = '\uFEFF' + JSON.stringify(declaration, null, '\t').replace('120,', '1.2e2,').replace('100,', '1e2,').replace('\t\t\t\t0\n', '\t\t\t\t-0\n').replaceAll('\n', '\r\n') + '\r\n';
  const source = { sourcePath, baseSourceRevision, content };
  const model = modelFor(content);
  return { model, source, declaration: parse(content) };
}
function modelFor(content) {
  const declaration = parse(content), sourceRevision = `sha256:${hash(content)}`;
  return { ok: true, format: 'viento-scene-preview', schemaVersion: declaration.schemaVersion === 1 ? 1 : 2,
    scene: { objectId: sceneId, sourcePath, sourceRevision, title: declaration.title, viewport: declaration.viewport, background: declaration.background },
    draft: { baseSourceRevision, sourceRevision }, actors: declaration.actors.map(actor => {
      const result = { ...structuredClone(actor), name: 'Resolved name', size: [80, 60], color: '#445566', speed: 120, controls: 'none' };
      delete result.groupId; return result;
    }), ...(declaration.schemaVersion === 3 ? { sceneStructure: createSceneStructure(declaration) } : {}) };
}
const open = async (t, version = 3) => {
  const fixtureValue = fixture(version), draft = await createSceneSourceLayoutDraft(fixtureValue.model, fixtureValue.source, { digest });
  t.after(() => draft.dispose()); return { ...fixtureValue, draft };
};

for (const version of [1, 2, 3]) test(`schema ${version} source layout changes only coordinate tokens and has no persistence capability`, async t => {
  const { source, draft, declaration } = await open(t, version);
  for (const forbidden of ['command', 'beginSave', 'saveState', 'base', 'draftId', 'finishSaveRefresh', 'resolveSave']) assert.equal(forbidden in draft, false);
  assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false });
  assert.equal(draft.propose().afterContent, source.content); assert.deepEqual(draft.propose().changes, []);
  draft.setPosition(second, [350.5, 200]);
  const proposal = draft.propose(), expected = source.content.replace('300,', '350.5,');
  assert.equal(proposal.afterContent, expected); assert.equal(proposal.sourcePath, sourcePath); assert.equal(proposal.sceneId, sceneId);
  assert.equal(proposal.sourceRevision, `sha256:${hash(source.content)}`); assert.equal(proposal.baseSourceRevision, baseSourceRevision);
  assert.deepEqual(proposal.changes, [{ objectId: second, position: [350.5, 200] }]);
  const prepared = await prepareSceneSourceLayoutApply(source, proposal, { digest });
  assert.deepEqual(prepared, { afterContent: expected, changedPaths: ['/actors/1/position/0'] });
  const changed = parse(prepared.afterContent); declaration.actors[1].position[0] = 350.5;
  assert.deepEqual(changed, declaration); assert.equal(Object.hasOwn(changed.actors[0], 'size'), false);
  assert.match(prepared.afterContent, /1e2,/); assert.match(prepared.afterContent, /-0\r\n/);
  assert.match(prepared.afterContent, /1.2e2,/); assert.ok(prepared.afterContent.startsWith('\uFEFF'));
});

test('duplicate definitions remain independent and grouped descendants use the existing Rust undo history', async t => {
  const { model, source, draft, declaration } = await open(t);
  const outline = buildSceneOutline({ groups: model.sceneStructure.groups, actors: model.actors, memberships: model.sceneStructure.memberships });
  assert.deepEqual(outline[0].instanceIds, [first, second]);
  draft.move(outline[0].instanceIds, [10, 20]);
  assert.deepEqual(draft.actors().map(actor => actor.position), [[110, 20], [310, 220]]);
  assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false); assert.equal(draft.propose().afterContent, source.content);
  assert.equal(draft.redo(), true); assert.deepEqual(draft.propose().changes.map(value => value.objectId), [first, second]);
  draft.align([first, second], 'left'); assert.deepEqual(draft.actors().map(actor => actor.position), [[110, 20], [110, 220]]);
  assert.equal(draft.undo(), true); assert.deepEqual(draft.currentPosition(second), [310, 220]);
  draft.setPosition(second, [400, 500]); assert.equal(draft.redo(), false); assert.equal(draft.currentPosition(sceneId), null);
  assert.deepEqual(parse(draft.propose().afterContent).groups, declaration.groups);
  draft.reset(); assert.equal(draft.propose().afterContent, source.content); assert.equal(draft.state().dirty, false);
});

test('source patch handles scalar offsets after escaped keys and non-BMP text without normalizing untouched data', () => {
  const { source } = fixture();
  const content = source.content.replace('"position"', '"posit\\u0069on"');
  const expected = content.replace('1e2,', '-42.75,').replace('300,', '100000,').replace('200\r\n', '-100000\r\n');
  const patch = patchSceneSourcePositions(content, [{ objectId: second, position: [100000, -100000] }, { objectId: first, position: [-42.75, -0] }]);
  assert.equal(patch.afterContent, expected);
  assert.deepEqual(patch.changedPaths, ['/actors/0/position/0', '/actors/1/position/0', '/actors/1/position/1']);
  assert.deepEqual(patchSceneSourcePositions(content, [{ objectId: first, position: [100, 0] }]), { afterContent: content, changedPaths: [] });
});

test('source patch rejects duplicate keys, malformed declarations, identities and group topology', () => {
  const { source } = fixture();
  for (const content of ['{invalid', 'null', source.content.replace('"title":', '"title":"duplicate", "title":'),
    source.content.replace('"title":', '"ti\\u0074le":"duplicate", "title":')]) assert.throws(() => patchSceneSourcePositions(content, []), invalid);
  for (const mutate of [scene => { scene.format = 'other'; }, scene => { scene.schemaVersion = 4; }, scene => { scene.actors = []; },
    scene => { scene.actors[0].objectId = 'not-an-id'; }, scene => { delete scene.actors[0].instanceId; },
    scene => { scene.actors[1].instanceId = first; }, scene => { scene.actors[0].position = [1, 2, 3]; },
    scene => { scene.actors[0].position = ['1', 2]; }, scene => { scene.actors[0].position = [100001, 2]; },
    scene => { scene.groups[0].parentGroupId = child; }, scene => { scene.actors[0].groupId = sceneId; },
    scene => { scene.groups[0].groupId = first; }, scene => { delete scene.groups; }]) {
    const scene = parse(source.content); mutate(scene); assert.throws(() => patchSceneSourcePositions(JSON.stringify(scene), []), invalid);
  }
  const legacy = fixture(1); assert.throws(() => patchSceneSourcePositions(legacy.source.content.replace('"objectId":', '"instanceId":"' + first + '","objectId":'), []), invalid);
});

test('source patch validates the entire change batch before producing output', () => {
  const { source } = fixture();
  for (const changes of [null, {}, Array(1), [{ objectId: sceneId, position: [1, 2] }],
    [{ objectId: first, position: [1, 2] }, { objectId: first, position: [3, 4] }],
    [{ objectId: first, position: [1, 2], size: [20, 20] }], [{ objectId: first, position: [NaN, 2] }],
    [{ objectId: first, position: [Infinity, 2] }], [{ objectId: first, position: Array(2) }],
    [{ objectId: first, position: [1, 2] }, { objectId: second, position: [100001, 0] }]]) {
    assert.throws(() => patchSceneSourcePositions(source.content, changes), invalid);
  }
});

test('source byte limits reject lone surrogates, multibyte overflow and coordinate growth across 128 KiB', async () => {
  const { source } = fixture();
  const bytes = Buffer.byteLength(source.content), exact = source.content + ' '.repeat(MAX_SCENE_DRAFT_BYTES - bytes);
  assert.equal(Buffer.byteLength(exact), MAX_SCENE_DRAFT_BYTES);
  assert.equal(patchSceneSourcePositions(exact, []).afterContent, exact);
  const limit = { errorCode: 'scene_source_layout_content_limit' };
  assert.throws(() => patchSceneSourcePositions(exact + ' ', []), limit);
  assert.throws(() => patchSceneSourcePositions(source.content + '町'.repeat(MAX_SCENE_DRAFT_BYTES / 3), []), limit);
  assert.throws(() => patchSceneSourcePositions(exact, [{ objectId: second, position: [100000, 200] }]), limit);
  assert.throws(() => patchSceneSourcePositions(source.content.replace('Draft', '\ud800'), []), invalid);
  assert.throws(() => patchSceneSourcePositions(source.content.replace('Draft', '\udfff'), []), invalid);
  const model = modelFor(exact), draft = await createSceneSourceLayoutDraft(model, { ...source, content: exact }, { digest });
  try {
    draft.setPosition(second, [100000, 200]); assert.throws(() => draft.propose(), limit);
    assert.equal(draft.undo(), true); assert.equal(draft.propose().afterContent, exact);
  } finally { draft.dispose(); }
});

test('source factory refuses changed preview identities, schema, positions, grouping and saved editing provenance', async () => {
  for (const mutate of [model => { model.scene.objectId = 'wrong'; }, model => { model.schemaVersion = 3; },
    model => { model.format = 'other'; }, model => { model.ok = false; }, model => { model.sceneEditing = {}; },
    model => { delete model.draft; }, model => { model.draft.extra = true; }, model => { model.actors.reverse(); },
    model => { model.actors[0].position[0]++; }, model => { model.actors[0].instanceId = second; },
    model => { model.actors[0].objectId = second; }, model => { delete model.sceneStructure; },
    model => { model.sceneStructure.groups[0].name = 'Other'; }, model => { model.sceneStructure.memberships.pop(); }]) {
    const { model, source } = fixture(); mutate(model); await assert.rejects(createSceneSourceLayoutDraft(model, source, { digest }), invalid);
  }
  for (const mutate of [model => { model.scene.sourcePath = 'other.json'; }, model => { model.scene.sourceRevision = baseSourceRevision; },
    model => { model.draft.baseSourceRevision = 'sha256:' + '2'.repeat(64); },
    model => { model.draft.sourceRevision = baseSourceRevision; model.scene.sourceRevision = baseSourceRevision; }]) {
    const { model, source } = fixture(); mutate(model); await assert.rejects(createSceneSourceLayoutDraft(model, source, { digest }), conflict);
  }
  for (const version of [1, 2]) {
    const { model, source } = fixture(version); model.sceneStructure = fixture().model.sceneStructure;
    await assert.rejects(createSceneSourceLayoutDraft(model, source, { digest }), invalid);
  }
  const { model, source } = fixture();
  for (const value of [null, {}, { ...source, extra: true }, { ...source, baseSourceRevision: 'old' }, { ...source, sourcePath: 'not-json.txt' }]) {
    await assert.rejects(createSceneSourceLayoutDraft(model, value, { digest }), invalid);
  }
  await assert.rejects(createSceneSourceLayoutDraft(model, source), invalid);
  await assert.rejects(createSceneSourceLayoutDraft(model, source, { digest: () => 'not-a-hash' }), invalid);
});

test('apply rejects stale source/baseline/path and forged non-position or non-exact proposals', async t => {
  const { source, draft } = await open(t); draft.setPosition(second, [321, 222]); const proposal = draft.propose();
  for (const current of [{ ...source, content: source.content.replace('Draft', 'Changed') },
    { ...source, sourcePath: 'other.json' }, { ...source, baseSourceRevision: 'sha256:' + '2'.repeat(64) }]) {
    await assert.rejects(prepareSceneSourceLayoutApply(current, proposal, { digest }), conflict);
  }
  for (const mutate of [value => { value.afterContent = value.afterContent.replace('Draft', 'Other'); },
    value => { value.afterContent = JSON.stringify(parse(value.afterContent)); }, value => { value.changes[0].objectId = sceneId; },
    value => { value.changes[0].groupId = parent; }, value => { value.extra = true; }, value => { value.sceneId = 'unknown'; }]) {
    const changed = structuredClone(proposal); mutate(changed);
    await assert.rejects(prepareSceneSourceLayoutApply(source, changed, { digest }), invalid);
  }
  assert.equal(source.content.includes('321'), false);
});

test('factory and apply detach mutable inputs before awaiting their injected digest', async t => {
  const { model, source } = fixture(), original = source.content;
  let resolve;
  const pending = createSceneSourceLayoutDraft(model, source, { digest: () => new Promise(done => { resolve = done; }) });
  model.scene.objectId = first; model.actors[0].position[0] = 1000; source.content = '{}';
  resolve(hash(original)); const draft = await pending; t.after(() => draft.dispose());
  assert.deepEqual(draft.currentPosition(first), [100, 0]); assert.equal(draft.propose().sceneId, sceneId);
  draft.setPosition(second, [321, 222]); const proposal = draft.propose(), current = { ...source, content: original };
  const apply = prepareSceneSourceLayoutApply(current, proposal, { digest: () => new Promise(done => { resolve = done; }) });
  current.content = '{}'; proposal.afterContent = '{}'; proposal.changes[0].position[0] = 999;
  resolve(hash(original)); const prepared = await apply;
  assert.deepEqual(parse(prepared.afterContent).actors[1].position, [321, 222]);
  const detached = draft.actors(); detached[0].position[0] = 333; detached[0].size[0] = 333;
  draft.currentPosition(first)[0] = 444; const next = draft.propose(); next.changes[0].position[0] = 555;
  assert.deepEqual(draft.currentPosition(first), [100, 0]); assert.deepEqual(draft.currentPosition(second), [321, 222]);
});

test('source history rejects invalid batches atomically and shares bounded Rust history semantics', async t => {
  const { source, draft } = await open(t);
  assert.throws(() => draft.setPositions([{ objectId: first, position: [1, 2] }, { objectId: second, position: [100001, 0] }]), { errorCode: 'scene_layout_position_invalid' });
  assert.equal(draft.propose().afterContent, source.content);
  for (let x = 1; x <= 101; x++) draft.setPosition(first, [x, 0]);
  let count = 0; while (draft.undo()) count++;
  assert.equal(count, 100); assert.equal(draft.state().dirty, true); draft.reset(); assert.equal(draft.propose().afterContent, source.content);
});

test('source and saved drafts keep separate histories and release all 32 Rust session slots', async t => {
  const sessions = [], { source, model } = fixture();
  t.after(() => { for (const value of sessions) value.dispose(); });
  for (let index = 0; index < 32; index++) sessions.push(await createSceneSourceLayoutDraft(model, source, { digest }));
  await assert.rejects(createSceneSourceLayoutDraft(model, source, { digest }), { errorCode: 'scene_layout_draft_limit' });
  sessions[0].setPosition(first, [12, 34]); assert.deepEqual(sessions[1].currentPosition(first), [100, 0]);
  sessions[0].dispose(); sessions[0].dispose();
  assert.throws(() => sessions[0].propose(), { errorCode: 'scene_layout_draft_invalid' });
  const saved = createSceneLayoutDraft({ ...model, scene: { ...model.scene, sourceRevision: baseSourceRevision },
    sceneEditing: { worldId: 'world:example', baseRevision: baseSourceRevision, objectRevision: baseSourceRevision, sourceRevision: baseSourceRevision, content: source.content } });
  assert.ok(saved); sessions.push(saved); saved.setPosition(second, [800, 900]);
  assert.equal(saved.command().command, 'scene.update'); assert.deepEqual(sessions[1].currentPosition(second), [300, 200]);
  for (const value of sessions) value.dispose();
  for (let index = 0; index < 40; index++) {
    const fresh = await createSceneSourceLayoutDraft(model, source, { digest }); fresh.dispose();
  }
});
