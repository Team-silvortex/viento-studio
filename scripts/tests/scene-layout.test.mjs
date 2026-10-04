import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLayoutDraft, moveSceneSelection, alignSceneSelection } from '../../engine/scene-layout.mjs';
import { dispatchStudioCore, dispatchStudioCoreDraft, dispatchStudioCoreSave, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
import { validateWorldCommand } from '../../engine/world-command-contract.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const revision = 'sha256:' + '1'.repeat(64);
const parse = value => JSON.parse(value.replace(/^\uFEFF/, ''));
function preview() {
  const value = { format: 'viento-scene2d', schemaVersion: 1, title: 'Keep this title', viewport: [640, 480], background: '#102030', actors: [
    { objectId: first, position: [100, 200], useProjectionDefaults: true, imageResourceId: null },
    { objectId: second, position: [300, 200], useProjectionDefaults: false, size: [80, 60], color: '#445566', speed: 120, controls: 'none' },
  ] };
  return { scene: { objectId: sceneId, sourcePath: 'documents/scenes/current.json', sourceRevision: revision },
    actors: value.actors.map(actor => ({ ...structuredClone(actor), size: [80, 60], color: '#445566', speed: 120, controls: 'none' })),
    sceneEditing: { worldId: 'world:example', baseRevision: revision, objectRevision: revision, sourceRevision: revision,
      content: '\uFEFF' + JSON.stringify(value, null, '\t').replace('120', '1.2e2').replaceAll('\n', '\r\n') + '\r\n' } };
}

test('scene layout generates fixed-version position-only commands without resolving inherited values into the source', t => {
  const payload = preview(), draft = createSceneLayoutDraft(payload), before = parse(payload.sceneEditing.content);
  t.after(() => draft.dispose());
  assert.ok(draft); assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false });
  assert.equal(draft.setPosition(first, [-100000, 100000]), true);
  const command = draft.command(); assert.deepEqual(validateWorldCommand(command), command);
  assert.equal(command.mode, 'preview'); assert.equal(draft.command('apply').mode, 'apply');
  assert.equal(command.worldId, payload.sceneEditing.worldId); assert.equal(command.objectId, sceneId);
  for (const field of ['baseRevision', 'objectRevision', 'sourceRevision']) assert.equal(command[field], payload.sceneEditing[field]);
  const after = parse(command.content), expected = structuredClone(before); expected.actors[0].position = [-100000, 100000];
  assert.deepEqual(after, expected); assert.equal(after.actors[0].imageResourceId, null);
  assert.equal(Object.hasOwn(after.actors[0], 'size'), false); assert.equal(after.actors[1].useProjectionDefaults, false);
  assert.equal(Object.hasOwn(after.actors[1], 'imageResourceId'), false);
  assert.deepEqual(draft.actors().map(actor => actor.position), [[-100000, 100000], [300, 200]]);
  assert.equal(draft.matches(JSON.stringify(after, null, 4)), true); assert.equal(draft.matches(payload.sceneEditing.content), false);
  assert.equal(draft.matches('{invalid'), false); assert.throws(() => draft.command('save'), TypeError);
});

test('scene layout undo and redo preserve other actors, discard redo on a new branch, and reset to exact source bytes', t => {
  const payload = preview(), draft = createSceneLayoutDraft(payload);
  t.after(() => draft.dispose());
  assert.equal(draft.command().content, payload.sceneEditing.content);
  assert.equal(draft.setPosition(first, [100, 200]), false); assert.equal(draft.undo(), false);
  draft.setPosition(first, [110, 210]); draft.setPosition(second, [310, 210]);
  assert.equal(draft.undo(), true); assert.deepEqual(draft.currentPosition(second), [300, 200]);
  assert.deepEqual(draft.currentPosition(first), [110, 210]);
  assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false);
  assert.equal(draft.command().content, payload.sceneEditing.content);
  assert.equal(draft.redo(), true); assert.equal(draft.state().canRedo, true);
  draft.setPosition(second, [500, 200]); assert.equal(draft.redo(), false);
  assert.equal(draft.state().canRedo, false);
  draft.reset(); assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false });
  assert.equal(draft.command().content, payload.sceneEditing.content);
});

test('scene layout rejects malformed edits atomically and bounds history without losing the original dirty comparison', t => {
  const draft = createSceneLayoutDraft(preview());
  t.after(() => draft.dispose());
  for (const value of [[NaN, 0], [Infinity, 0], [-100001, 0], [0, 100001], [null, 0], ['', 0], ['12', 0], [1], [1, 2, 3], Array(2), null, {}]) {
    assert.throws(() => draft.setPosition(first, value), { errorCode: 'scene_layout_position_invalid' });
    assert.deepEqual(draft.state(), { dirty: false, canUndo: false, canRedo: false });
  }
  assert.throws(() => draft.setPosition(sceneId, [1, 2]), { errorCode: 'scene_layout_position_invalid' });
  for (let x = 1; x <= 101; x++) draft.setPosition(first, [x, 200]);
  let count = 0; while (draft.undo()) count++;
  assert.equal(count, 100); assert.deepEqual(draft.currentPosition(first), [1, 200]); assert.equal(draft.state().dirty, true);
  draft.reset(); assert.deepEqual(draft.currentPosition(first), [100, 200]); assert.equal(draft.state().dirty, false);
});

test('scene layout freezes preconditions and defensively copies source, actors, coordinate arrays and commands', t => {
  const payload = preview(), content = payload.sceneEditing.content, draft = createSceneLayoutDraft(payload);
  t.after(() => draft.dispose());
  const initial = draft.base; initial.worldId = 'other'; initial.content = '{}';
  payload.sceneEditing.content = '{}'; payload.sceneEditing.baseRevision = 'sha256:' + '2'.repeat(64);
  payload.scene.objectId = first; payload.scene.sourcePath = 'other'; payload.actors[0].size[0] = 900;
  assert.equal(draft.base.sceneId, sceneId); assert.equal(draft.base.sourcePath, 'documents/scenes/current.json');
  assert.equal(draft.command().content, content); assert.equal(draft.command().baseRevision, revision);
  const point = [120, 130]; draft.setPosition(first, point); point[0] = 999;
  draft.currentPosition(first)[0] = 888; draft.actors()[0].position[0] = 777; draft.actors()[0].size[0] = 1000;
  assert.deepEqual(draft.currentPosition(first), [120, 130]); assert.deepEqual(draft.actors()[0].size, [80, 60]);
  const command = draft.command(); command.actorRef.id = 'other'; assert.equal(draft.command().actorRef.id, 'local-ui');
});

test('legacy and inconsistent scene previews remain read-only instead of manufacturing editable preconditions', () => {
  for (const change of [payload => { delete payload.sceneEditing; }, payload => { payload.sceneEditing.content = '{invalid'; },
    payload => { payload.sceneEditing.worldId = ''; }, payload => { payload.sceneEditing.baseRevision = 'stale'; },
    payload => { payload.sceneEditing.sourceRevision = 'sha256:' + '2'.repeat(64); }, payload => { payload.scene.objectId = 'scene'; },
    payload => { payload.actors.reverse(); }, payload => { payload.actors[0].position[0]++; },
    payload => { const value = parse(payload.sceneEditing.content); value.actors[1].objectId = first; payload.sceneEditing.content = JSON.stringify(value); },
    payload => { payload.sceneEditing.content += ' '.repeat(262144); }]) {
    const payload = preview(); change(payload); assert.equal(createSceneLayoutDraft(payload), null);
  }
  assert.equal(createSceneLayoutDraft(null), null);
});

test('selection movement applies one integer or anchor-snapped displacement and keeps the caller data and order intact', () => {
  const actors = [{ objectId: 'first', position: [101.25, 205.5], size: [80, 60] },
    { objectId: 'second', position: [310.75, 300.25], size: [40, 20] }, { objectId: 'outside', position: [20, 20], size: [10, 10] }];
  const before = structuredClone(actors), ids = ['first', 'second'];
  assert.deepEqual(moveSceneSelection(actors, ids, [10.4, -4.6]), [
    { objectId: 'first', position: [111.25, 200.5] }, { objectId: 'second', position: [320.75, 295.25] },
  ]);
  assert.deepEqual(moveSceneSelection(actors, ids, [10.4, -4.6], 32), [
    { objectId: 'first', position: [96, 192] }, { objectId: 'second', position: [305.5, 286.75] },
  ]);
  assert.deepEqual(moveSceneSelection(actors, [...ids].reverse(), [10.4, -4.6], 32), [
    { objectId: 'second', position: [320, 288] }, { objectId: 'first', position: [110.5, 193.25] },
  ]);
  assert.deepEqual(actors, before); assert.deepEqual(ids, ['first', 'second']);
  assert.deepEqual(moveSceneSelection(actors, [], [1, 2]), []);
  const detached = moveSceneSelection(actors, ids, [0, 0]); detached[0].position[0] = 0; assert.deepEqual(actors, before);
});

test('selection movement clamps the complete group, including floating boundary cancellation, without compressing spacing', () => {
  const actors = [{ objectId: 'a', position: [-90000, 90000], size: [80, 60] }, { objectId: 'b', position: [90000, -90000], size: [40, 20] }];
  const moved = moveSceneSelection(actors, ['a', 'b'], [Number.MAX_VALUE, -Number.MAX_VALUE]);
  assert.deepEqual(moved.map(item => item.position), [[-80000, 80000], [100000, -100000]]);
  assert.deepEqual(moveSceneSelection(actors, ['a', 'b'], [1000000, -1000000], 32), moved);
  const fractional = [{ objectId: 'a', position: [-90690.61234776235, 0], size: [80, 60] },
    { objectId: 'b', position: [-77737.83179106213, 0], size: [40, 20] }];
  const bounded = moveSceneSelection(fractional, ['a', 'b'], [1000000, 0]);
  assert.ok(bounded.every(item => item.position.every(value => Math.abs(value) <= 100000)));
  assert.ok(Math.abs((bounded[1].position[0] - bounded[0].position[0]) - (fractional[1].position[0] - fractional[0].position[0])) < 1e-9);
  assert.deepEqual(moveSceneSelection(actors, ['a', 'b'], [1, 1], Number.MIN_VALUE).map(item => item.position), [[-89999, 90001], [90001, -89999]]);
});

test('all six alignment modes use resolved size and the selection bounding box, independent of declaration inheritance', () => {
  const actors = [{ objectId: 'a', position: [100, 200], size: [80, 60], useProjectionDefaults: true },
    { objectId: 'b', position: [300, 250], size: [40, 100] }, { objectId: 'unselected', position: [900, 900], size: [100, 100] }];
  const before = structuredClone(actors);
  const expected = { left: [[100, 200], [80, 250]], center: [[190, 200], [190, 250]], right: [[280, 200], [300, 250]],
    top: [[100, 200], [300, 220]], middle: [[100, 235], [300, 235]], bottom: [[100, 270], [300, 250]] };
  for (const [mode, positions] of Object.entries(expected)) {
    assert.deepEqual(alignSceneSelection(actors, ['a', 'b'], mode).map(item => item.position), positions, mode);
    assert.deepEqual(alignSceneSelection(actors, ['b', 'a'], mode).map(item => item.position), [...positions].reverse(), `${mode}: order`);
  }
  assert.deepEqual(alignSceneSelection(actors, ['a'], 'center'), [{ objectId: 'a', position: [100, 200] }]);
  assert.deepEqual(alignSceneSelection(actors, [], 'left'), []); assert.deepEqual(actors, before);
});

test('selection helpers reject duplicate or missing identities, invalid geometry and overflowing alignments atomically', () => {
  const actors = [{ objectId: 'a', position: [-99990, 0], size: [100, 60] }, { objectId: 'b', position: [0, 0], size: [20, 20] }];
  const before = structuredClone(actors);
  for (const ids of [['a', 'a'], ['missing'], [null], Array(1), null]) {
    assert.throws(() => moveSceneSelection(actors, ids, [0, 0]), { errorCode: 'scene_layout_position_invalid' });
    assert.throws(() => alignSceneSelection(actors, ids, 'left'), { errorCode: 'scene_layout_position_invalid' });
  }
  for (const delta of [[Infinity, 0], [NaN, 0], [null, 0], ['1', 0], [1], Array(2)]) {
    assert.throws(() => moveSceneSelection(actors, ['a'], delta), { errorCode: 'scene_layout_position_invalid' });
  }
  for (const snap of [-1, NaN, Infinity, '32', 100001]) assert.throws(() => moveSceneSelection(actors, ['a'], [1, 2], snap), { errorCode: 'scene_layout_position_invalid' });
  for (const change of [items => { items.push(items[0]); }, items => { items[0].position[0] = 100001; },
    items => { items[0].size = [NaN, 10]; }, items => { items[0].size = [0, 10]; }, items => { items[0].size = [-10, 10]; }]) {
    const malformed = structuredClone(actors); change(malformed);
    assert.throws(() => moveSceneSelection(malformed, ['a'], [1, 2]), { errorCode: 'scene_layout_position_invalid' });
  }
  assert.throws(() => alignSceneSelection(actors, ['a', 'b'], 'left'), { errorCode: 'scene_layout_position_invalid' });
  assert.throws(() => alignSceneSelection(actors, ['a', 'b'], 'distribute'), { errorCode: 'scene_layout_alignment_invalid' });
  assert.deepEqual(actors, before);
});

test('selection geometry ignores unselected non-JSON fields while preserving global identity checks', () => {
  const selected = { objectId: 'selected', position: [100, 200], size: [80, 60] };
  for (const geometry of [{ position: [NaN, 0], size: undefined }, { position: undefined, size: [Infinity, 0] },
    { position: Array(2), size: [1n, 0] }, { position: null, size: null }, {}]) {
    const actors = [selected, { objectId: 'outside', ...geometry }];
    assert.deepEqual(moveSceneSelection(actors, ['selected'], [10, -4]), [{ objectId: 'selected', position: [110, 196] }]);
    assert.deepEqual(alignSceneSelection(actors, ['selected'], 'left'), [{ objectId: 'selected', position: [100, 200] }]);
    assert.deepEqual(moveSceneSelection(actors, [], [10, 0]), []);
    assert.deepEqual(alignSceneSelection(actors, [], 'left'), []);
    assert.throws(() => moveSceneSelection(actors, ['outside'], [10, 0]), { errorCode: 'scene_layout_position_invalid' });
    assert.throws(() => alignSceneSelection(actors, ['outside'], 'left'), { errorCode: 'scene_layout_position_invalid' });
  }
  const deferred = { objectId: 'outside', get position() { throw new Error('Unselected geometry must not be read.'); },
    get size() { throw new Error('Unselected geometry must not be read.'); } };
  assert.deepEqual(moveSceneSelection([selected, deferred], ['selected'], [1, 0]), [{ objectId: 'selected', position: [101, 200] }]);
  assert.deepEqual(alignSceneSelection([selected, deferred], [], 'left'), []);
  for (const outside of [{ objectId: 'selected', position: [NaN, 0] }, { objectId: '', position: [NaN, 0] },
    { objectId: undefined }, {}, null]) {
    for (const ids of [['selected'], []]) {
      assert.throws(() => moveSceneSelection([selected, outside], ids, [1, 0]), { errorCode: 'scene_layout_position_invalid' });
      assert.throws(() => alignSceneSelection([selected, outside], ids, 'left'), { errorCode: 'scene_layout_position_invalid' });
    }
  }
  assert.deepEqual(selected.position, [100, 200]);
});

test('position batches validate every actor before any edit and form one undo step without discarding redo on a no-op', t => {
  const draft = createSceneLayoutDraft(preview()), initial = draft.command().content;
  t.after(() => draft.dispose());
  const changes = [{ objectId: first, position: [120, 220] }, { objectId: second, position: [320, 220] }];
  assert.equal(draft.setPositions(changes), true); changes[0].position[0] = 900;
  assert.deepEqual(draft.currentPosition(first), [120, 220]); assert.equal(draft.undo(), true);
  assert.equal(draft.state().dirty, false); assert.equal(draft.command().content, initial); assert.equal(draft.undo(), false);
  assert.equal(draft.setPositions([]), false); assert.equal(draft.setPositions([{ objectId: first, position: [100, 200] }]), false);
  assert.equal(draft.state().canRedo, true);
  for (const bad of [[{ objectId: first, position: [1, 2] }, { objectId: second, position: [NaN, 2] }],
    [{ objectId: first, position: [1, 2] }, { objectId: first, position: [2, 3] }],
    [{ objectId: first, position: [1, 2], size: [10, 10] }], [{ objectId: sceneId, position: [1, 2] }], Array(1), null]) {
    assert.throws(() => draft.setPositions(bad), { errorCode: 'scene_layout_position_invalid' });
    assert.equal(draft.command().content, initial); assert.equal(draft.state().canRedo, true);
  }
  assert.equal(draft.redo(), true); assert.deepEqual(draft.actors().map(actor => actor.position), [[120, 220], [320, 220]]);
  draft.undo(); draft.setPosition(first, [101, 200]); assert.equal(draft.state().canRedo, false);
});

test('batch move and align convenience methods preserve inherited fields and keep each full selection operation in bounded history', t => {
  const payload = preview(), declaration = parse(payload.sceneEditing.content);
  payload.actors[1].size = [40, 100];
  const draft = createSceneLayoutDraft(payload), ids = [first, second];
  t.after(() => draft.dispose());
  assert.equal(draft.move(ids, [10, 20]), true); assert.deepEqual(draft.actors().map(actor => actor.position), [[110, 220], [310, 220]]);
  assert.equal(draft.align(ids, 'left'), true); assert.deepEqual(draft.actors().map(actor => actor.position), [[110, 220], [90, 220]]);
  assert.equal(draft.undo(), true); assert.deepEqual(draft.actors().map(actor => actor.position), [[110, 220], [310, 220]]);
  assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false); assert.equal(draft.command().content, payload.sceneEditing.content);
  draft.redo(); draft.redo();
  const saved = parse(draft.command().content); const expected = structuredClone(declaration);
  expected.actors[0].position = [110, 220]; expected.actors[1].position = [90, 220]; assert.deepEqual(saved, expected);
  draft.reset();
  for (let count = 0; count < 101; count++) draft.move(ids, [1, 0]);
  let undone = 0; while (draft.undo()) undone++;
  assert.equal(undone, 100); assert.deepEqual(draft.actors().map(actor => actor.position), [[101, 200], [301, 200]]);
  draft.reset(); assert.equal(draft.state().dirty, false);
});

test('Rust drafts isolate histories and disposal releases bounded sessions without recycling a live draft', t => {
  const firstDraft = createSceneLayoutDraft(preview()), secondDraft = createSceneLayoutDraft(preview());
  t.after(() => firstDraft.dispose()); t.after(() => secondDraft.dispose());
  firstDraft.setPosition(first, [10, 20]); secondDraft.setPosition(first, [30, 40]);
  firstDraft.undo(); assert.deepEqual(secondDraft.currentPosition(first), [30, 40]);
  assert.equal(firstDraft.state().canRedo, true); assert.equal(secondDraft.state().canRedo, false);
  const state = secondDraft.state(); state.dirty = false; assert.equal(secondDraft.state().dirty, true);
  firstDraft.dispose(); firstDraft.dispose();
  for (const operation of [() => firstDraft.base, () => firstDraft.state(), () => firstDraft.actors(),
    () => firstDraft.currentPosition(first), () => firstDraft.setPosition(first, [0, 0]), () => firstDraft.setPositions([]),
    () => firstDraft.move([], [0, 0]), () => firstDraft.align([], 'left'), () => firstDraft.undo(), () => firstDraft.redo(),
    () => firstDraft.reset(), () => firstDraft.command(), () => firstDraft.matches('{}'), () => firstDraft.saveState(),
    () => firstDraft.beginSave('preview'), () => firstDraft.resolveSave('1', 'accepted'), () => firstDraft.finishSaveRefresh('1'), () => firstDraft.invalidateSave()]) {
    assert.throws(operation, { errorCode: 'scene_layout_draft_invalid' });
  }
  for (let cycle = 0; cycle < 80; cycle++) {
    const draft = createSceneLayoutDraft(preview());
    try { draft.setPosition(first, [cycle, cycle]); assert.equal(draft.state().canUndo, true); }
    finally { draft.dispose(); }
  }
  assert.deepEqual(secondDraft.currentPosition(first), [30, 40]); secondDraft.undo();
  assert.deepEqual(secondDraft.state(), { dirty: false, canUndo: false, canRedo: true });
});


test('cross-domain dispatch is rejected before it can allocate, mutate or close a Rust draft', t => {
  const request = (operation, fields = {}) => ({ protocolVersion: 1, operation, ...fields });
  const actors = [{ objectId: 'actor', position: [1, 2] }];
  const draft = dispatchStudioCoreDraft(request('layoutDraft.create', { actors }));
  t.after(() => dispatchStudioCoreDraft(request('layoutDraft.close', { draftId: draft.draftId })));
  for (const operation of ['create', 'setPositions', 'undo', 'redo', 'reset', 'read', 'close']) {
    assert.throws(() => dispatchStudioCore(request(`layoutDraft.${operation}`, {
      draftId: draft.draftId, actors, changes: [{ objectId: 'actor', position: [8, 9] }],
    })), { errorCode: 'studio_core_request_invalid' });
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    assert.throws(() => dispatchStudioCore(request('layoutDraft.create', { actors })), { errorCode: 'studio_core_request_invalid' });
  }
  for (const operation of ['move', 'align', 'validateBatch', 'layoutDraft.unknown']) {
    assert.throws(() => dispatchStudioCoreDraft(request(operation, { actors, ids: ['actor'], delta: [4, 5], alignment: 'left', changes: [] })),
      { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(getStudioCoreMetadata().ready, true);
  const current = dispatchStudioCoreDraft(request('layoutDraft.read', { draftId: draft.draftId }));
  assert.deepEqual(current.positions, actors); assert.deepEqual(current.state, { dirty: false, canUndo: false, canRedo: false });
  assert.deepEqual(dispatchStudioCore(request('move', { actors: actors.map(actor => ({ ...actor, size: [10, 10] })), ids: ['actor'], delta: [4, 5] })), [{ objectId: 'actor', position: [5, 7] }]);
});


test('layout draft save snapshots use the Rust workflow, preserve no-op reviews and protect pending positions', t => {
  const draft = createSceneLayoutDraft(preview()); t.after(() => draft.dispose());
  assert.equal(draft.saveState().phase, 'editing');
  const detached = draft.saveState(); detached.editable = false; assert.equal(draft.saveState().editable, true);
  assert.throws(() => draft.beginSave('preview'), { errorCode: 'scene_layout_save_invalid' });
  draft.setPosition(first, [1, 2]);
  const checking = draft.beginSave('preview'); assert.equal(checking.phase, 'checking');
  const checkedContent = draft.command().content;
  for (const mutation of [() => draft.setPosition(first, [3, 4]), () => draft.undo(), () => draft.redo(), () => draft.reset()]) {
    assert.throws(mutation, { errorCode: 'scene_layout_save_invalid' }); assert.equal(draft.command().content, checkedContent);
  }
  assert.equal(draft.resolveSave(checking.requestId, 'accepted').phase, 'reviewed');
  assert.equal(draft.setPosition(first, [1, 2]), false); assert.equal(draft.saveState().reviewed, true);
  assert.throws(() => draft.setPosition(first, [100001, 0]), { errorCode: 'scene_layout_position_invalid' });
  assert.equal(draft.saveState().reviewed, true);
  draft.setPosition(first, [3, 4]); assert.equal(draft.saveState().phase, 'editing');
  const recheck = draft.beginSave('preview'); draft.resolveSave(recheck.requestId, 'accepted');
  draft.invalidateSave(); assert.equal(draft.saveState().phase, 'editing');
  const review = draft.beginSave('preview'); draft.resolveSave(review.requestId, 'accepted');
  const applying = draft.beginSave('apply'); draft.resolveSave(applying.requestId, 'accepted');
  assert.equal(draft.saveState().phase, 'refreshing'); assert.equal(draft.saveState().saved, true);
  assert.equal(draft.finishSaveRefresh(applying.requestId).phase, 'saved');
  assert.throws(() => draft.beginSave('apply'), { errorCode: 'scene_layout_save_invalid' });
});

test('save dispatch cannot be used through geometry or draft interfaces and preserves the current request', t => {
  const created = dispatchStudioCoreDraft({ protocolVersion: 1, operation: 'layoutDraft.create', actors: [{ objectId: 'a', position: [0, 0] }] });
  t.after(() => dispatchStudioCoreDraft({ protocolVersion: 1, operation: 'layoutDraft.close', draftId: created.draftId }));
  const request = operation => ({ protocolVersion: 1, operation, draftId: created.draftId, action: 'preview', editable: true, inputPending: false });
  for (const operation of ['read', 'invalidate', 'begin', 'resolve', 'refreshed']) {
    for (const dispatcher of [dispatchStudioCore, dispatchStudioCoreDraft]) {
      assert.throws(() => dispatcher(request(`layoutSave.${operation}`)), { errorCode: 'studio_core_request_invalid' });
    }
  }
  for (const operation of ['move', 'layoutDraft.close', 'layoutDraft.create']) {
    assert.throws(() => dispatchStudioCoreSave(request(operation)), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(dispatchStudioCoreSave(request('layoutSave.read')).state.phase, 'editing');
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('v2 layout isolates repeated definitions by stable instance identity through history and source commands', t => {
  const payload = preview(), declaration = parse(payload.sceneEditing.content);
  declaration.schemaVersion = 2;
  declaration.actors.forEach((actor, index) => { actor.instanceId = index ? second : first; actor.objectId = sceneId; });
  payload.sceneEditing.content = '\uFEFF' + JSON.stringify(declaration, null, '\t').replaceAll('\n', '\r\n');
  payload.actors = declaration.actors.map(actor => ({ ...structuredClone(actor), size: [80, 60] }));
  const draft = createSceneLayoutDraft(payload); assert.ok(draft); t.after(() => draft.dispose());
  const original = draft.command().content;
  assert.equal(draft.currentPosition(sceneId), null, 'definition IDs do not address v2 instances');
  draft.setPosition(second, [321, 222]);
  assert.deepEqual(draft.currentPosition(first), [100, 200]);
  const next = parse(draft.command().content);
  assert.equal(next.schemaVersion, 2); assert.deepEqual(next.actors.map(actor => actor.instanceId), [first, second]);
  assert.deepEqual(next.actors.map(actor => actor.objectId), [sceneId, sceneId]);
  assert.deepEqual(next.actors.map(actor => actor.position), [[100, 200], [321, 222]]);
  draft.undo(); assert.equal(draft.command().content, original); draft.redo();
  assert.deepEqual(draft.currentPosition(second), [321, 222]);
  draft.move([first, second], [10, -10]);
  assert.deepEqual(draft.actors().map(actor => actor.position), [[110, 190], [331, 212]]);
  draft.undo(); assert.deepEqual(draft.actors().map(actor => actor.position), [[100, 200], [321, 222]]);
  assert.throws(() => draft.setPosition(sceneId, [0, 0]), { errorCode: 'scene_layout_position_invalid' });
});

test('instance geometry maps only opaque instance keys to Rust and never evaluates identity accessors', () => {
  const actors = [{ objectId: 'definition', instanceId: 'left', position: [10, 20], size: [10, 10] },
    { objectId: 'definition', instanceId: 'right', position: [30, 20], size: [20, 10] }];
  assert.deepEqual(moveSceneSelection(actors, ['right'], [5, 0]), [{ objectId: 'right', position: [35, 20] }]);
  assert.deepEqual(alignSceneSelection(actors, ['left', 'right'], 'left'), [
    { objectId: 'left', position: [10, 20] }, { objectId: 'right', position: [15, 20] }]);
  assert.throws(() => moveSceneSelection(actors, ['definition'], [1, 0]), { errorCode: 'scene_layout_position_invalid' });
  let reads = 0;
  const bad = { ...actors[0], get instanceId() { reads++; return 'left'; } };
  assert.throws(() => moveSceneSelection([bad], ['left'], [1, 0]), { errorCode: 'scene_layout_position_invalid' });
  assert.equal(reads, 0);
});

test('v2 layout refuses duplicate, missing, mismatched or swapped instance identities without manufacturing a draft', () => {
  const make = () => {
    const payload = preview(), declaration = parse(payload.sceneEditing.content); declaration.schemaVersion = 2;
    declaration.actors.forEach((actor, index) => { actor.instanceId = index ? second : first; actor.objectId = sceneId; });
    payload.sceneEditing.content = JSON.stringify(declaration);
    payload.actors = declaration.actors.map(actor => ({ ...structuredClone(actor), size: [80, 60] }));
    return payload;
  };
  for (const mutate of [p => { delete p.actors[1].instanceId; }, p => { p.actors[1].instanceId = first; },
    p => { p.actors.reverse(); }, p => { p.actors[1].objectId = first; },
    p => { const d = parse(p.sceneEditing.content); d.actors[1].instanceId = first; p.sceneEditing.content = JSON.stringify(d); },
    p => { const d = parse(p.sceneEditing.content); delete d.actors[1].instanceId; p.sceneEditing.content = JSON.stringify(d); },
    p => { const d = parse(p.sceneEditing.content); d.schemaVersion = 1; p.sceneEditing.content = JSON.stringify(d); }]) {
    const payload = make(); mutate(payload); assert.equal(createSceneLayoutDraft(payload), null);
  }
});

test('schema3 layout changes only positions, retaining nested groups and exact untouched source on undo', t => {
  const payload = preview(), declaration = parse(payload.sceneEditing.content);
  const parent = '33333333-3333-4333-8333-333333333333', child = '44444444-4444-4444-8444-444444444444';
  declaration.schemaVersion = 3; declaration.groups = [{ groupId: parent, name: 'Parent' }, { groupId: child, name: 'Child', parentGroupId: parent }];
  declaration.actors.forEach((actor, index) => { actor.instanceId = [first, second][index]; actor.groupId = index ? child : parent; });
  payload.actors.forEach((actor, index) => { actor.instanceId = [first, second][index]; });
  payload.sceneEditing.content = '\uFEFF' + JSON.stringify(declaration, null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const draft = createSceneLayoutDraft(payload); assert.ok(draft); t.after(() => draft.dispose());
  draft.move([first, second], [10, -5]);
  const changed = JSON.parse(draft.command().content), expected = structuredClone(declaration);
  expected.actors.forEach(actor => { actor.position = [actor.position[0] + 10, actor.position[1] - 5]; });
  assert.deepEqual(changed, expected); assert.equal(draft.actors().some(actor => Object.hasOwn(actor, 'groupId')), false, 'runtime actors remain flat');
  draft.undo(); assert.equal(draft.command().content, payload.sceneEditing.content); draft.redo(); assert.deepEqual(JSON.parse(draft.command().content), expected);
  draft.reset(); assert.equal(draft.command().content, payload.sceneEditing.content);
});

test('schema3 layout checks sidecar against the exact saved grouping and rejects cycles or drift before opening', async t => {
  const { createSceneStructure } = await import('../../engine/scene-structure.mjs');
  const payload = preview(), declaration = parse(payload.sceneEditing.content), groupId = '33333333-3333-4333-8333-333333333333';
  declaration.schemaVersion = 3; declaration.groups = [{ groupId, name: 'Actors' }];
  declaration.actors.forEach((actor, index) => { actor.instanceId = [first, second][index]; actor.groupId = groupId; });
  payload.actors.forEach((actor, index) => { actor.instanceId = [first, second][index]; });
  payload.sceneEditing.content = JSON.stringify(declaration); payload.sceneStructure = createSceneStructure(declaration);
  const draft = createSceneLayoutDraft(payload); assert.ok(draft); t.after(() => draft.dispose());
  for (const alter of [value => { value.sceneStructure.memberships.pop(); }, value => { value.sceneStructure.groups[0].name = 'Other'; },
    value => { value.sceneStructure.extra = true; }, value => { const raw = parse(value.sceneEditing.content); raw.groups[0].parentGroupId = groupId; value.sceneEditing.content = JSON.stringify(raw); }]) {
    const changed = structuredClone(payload); alter(changed); assert.equal(createSceneLayoutDraft(changed), null);
  }
  const legacy = preview(); legacy.sceneStructure = structuredClone(payload.sceneStructure); assert.equal(createSceneLayoutDraft(legacy), null);
});
