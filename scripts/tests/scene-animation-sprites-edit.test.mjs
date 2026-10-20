import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, prepareSceneAnimationApply } from '../../engine/scene-animation-edit.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const legacy = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 1 }] }] });
const spriteTrack = () => ({ id: id(4), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 4, rows: 2 },
  keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 1, value: 7 }] });
const sprite = () => ({ ...legacy(), schemaVersion: 2, tracks: [spriteTrack()] });
const content = (model, newline = '\r\n') => '\ufeff' + JSON.stringify(model, null, '\t').replaceAll('\n', newline) + newline;
const digest = text => createHash('sha256').update(text).digest('hex');
const source = text => ({ sourcePath: 'documents/animations/sprite.json', token: 'source:1', content: text, sourceRevision: 'sha256:' + digest(text), baseSourceRevision: 'sha256:' + digest(text) });
const edit = model => ({ durationSeconds: model.durationSeconds, loop: model.loop, tracks: structuredClone(model.tracks) });

test('adding a sprite track upgrades schema only in the reviewed source and preserves old source bytes', async () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const text = content(legacy(), newline).replace('"schemaVersion"', '"schemaVersi\\u006fn"');
    const draft = edit(legacy()); draft.tracks.push(spriteTrack());
    const proposal = await createSceneAnimationProposal(source(text), draft), parsed = await readSceneAnimationDocument(proposal.afterContent);
    assert.equal(parsed.schemaVersion, 2); assert.deepEqual(parsed.tracks, draft.tracks); assert.equal(source(text).content, text);
    assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/tracks']);
    assert.equal(proposal.afterContent.slice(0, proposal.afterContent.indexOf('"tracks"')), text.slice(0, text.indexOf('"tracks"')).replace('"schemaVersi\\u006fn": 1', '"schemaVersi\\u006fn": 2'));
    assert.equal(proposal.afterContent.endsWith(newline + '}' + newline), true);
    if (newline !== '\n') assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false);
    assert.equal((await prepareSceneAnimationApply(source(text), proposal, { digest })).afterContent, proposal.afterContent);
  }
});

test('changing track shape replaces only that track and removing its grid never downgrades schema 2', async () => {
  const model = legacy(); model.tracks.push({ ...legacy().tracks[0], id: id(8), instanceId: id(9) });
  const text = content(model), draft = edit(model); draft.tracks[0] = { ...spriteTrack(), id: model.tracks[0].id };
  const proposal = await createSceneAnimationProposal(source(text), draft), parsed = await readSceneAnimationDocument(proposal.afterContent);
  assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/tracks/0']); assert.equal(parsed.schemaVersion, 2);
  assert.equal(proposal.afterContent.slice(proposal.afterContent.indexOf('"id": "' + id(8))), text.slice(text.indexOf('"id": "' + id(8))));
  const reverse = edit(parsed); reverse.tracks[0] = model.tracks[0];
  const restored = await createSceneAnimationProposal(source(proposal.afterContent), reverse);
  assert.deepEqual(restored.changedPaths, ['/tracks/0']); assert.equal((await readSceneAnimationDocument(restored.afterContent)).schemaVersion, 2);
  assert.deepEqual((await readSceneAnimationDocument(restored.afterContent)).tracks, model.tracks);
});

test('grid and frame leaf edits preserve BOM newline numeric spellings and unrelated track text', async () => {
  const text = content(sprite()).replace('"columns"', '"col\\u0075mns"').replace('"atSeconds": 0', '"atSeconds": 0e0');
  const draft = edit(sprite()); draft.tracks[0].grid.columns = 8; draft.tracks[0].keyframes[1].value = 15;
  const proposal = await createSceneAnimationProposal(source(text), draft);
  assert.deepEqual(proposal.changedPaths, ['/tracks/0/grid/columns', '/tracks/0/keyframes/1/value']);
  assert.equal(proposal.afterContent, text.replace('"col\\u0075mns": 4', '"col\\u0075mns": 8').replace('"value": 7', '"value": 15'));
  const pending = createSceneAnimationProposal(source(text), draft); draft.tracks[0].grid.columns = 32;
  assert.equal((await readSceneAnimationDocument((await pending).afterContent)).tracks[0].grid.columns, 8);
});

test('sprite proposals reject invalid grids frames and direct schema edits without bypassing source conflict checks', async () => {
  const text = content(sprite());
  for (const mutate of [d => d.tracks[0].grid.rows = 0, d => d.tracks[0].grid.columns = 65, d => d.tracks[0].grid.rows = 1.5,
    d => d.tracks[0].keyframes[0].value = .5, d => d.tracks[0].keyframes[1].value = 8, d => d.tracks[0].interpolation = 'linear',
    d => d.schemaVersion = 1]) { const draft = edit(sprite()); mutate(draft); await assert.rejects(createSceneAnimationProposal(source(text), draft)); }
  let calls = 0; const getter = edit(sprite()); Object.defineProperty(getter.tracks[0].grid, 'rows', { enumerable: true, get() { calls++; return 2; } });
  await assert.rejects(createSceneAnimationProposal(source(text), getter)); assert.equal(calls, 0);
  const draft = edit(sprite()); draft.loop = true; const proposal = await createSceneAnimationProposal(source(text), draft);
  await assert.rejects(prepareSceneAnimationApply(source(text + '\n'), proposal, { digest }), { errorCode: 'scene_animation_authoring_conflict' });
  await assert.rejects(prepareSceneAnimationApply(source(text), { ...proposal }, { digest }), { errorCode: 'scene_animation_authoring_conflict' });
});
