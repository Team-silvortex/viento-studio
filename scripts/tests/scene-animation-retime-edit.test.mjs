import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { retimeSceneAnimationDraft, createSceneAnimationProposal, prepareSceneAnimationApply, isSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
const id = n => `70707070-7070-4070-8070-${String(n).padStart(12, '0')}`;
const model = (version = 3) => ({ format: 'viento-scene-animation', schemaVersion: version, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(2), instanceId: id(3), property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0,0] }, { atSeconds: .5, value: [3,4] }, { atSeconds: 2, value: [10,20] }] },
    ...(version >= 2 ? [{ id: id(4), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 2, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 1, value: 2 }] }] : [])],
  ...(version === 3 ? { clips: [{ id: id(5), name: '攻撃 / Attack', startSeconds: .5, endSeconds: 2, loop: false }] } : {}) });
const fields = d => ({ durationSeconds: d.durationSeconds, loop: d.loop, tracks: structuredClone(d.tracks), ...(d.schemaVersion === 3 ? { clips: structuredClone(d.clips) } : {}) });
const digest = value => createHash('sha256').update(value).digest('hex');
const source = content => ({ sourcePath: 'documents/animations/retime.json', token: 'retime:1', content, baseSourceRevision: 'sha256:' + digest(content), sourceRevision: 'sha256:' + digest(content) });
const encoded = d => '\ufeff' + JSON.stringify(d, null, '\t').replaceAll('\n', '\r\n') + '\r\n';

for (const version of [1,2,3]) test(`retiming v${version} produces local data then a branded ordinary leaf proposal`, async () => {
  const doc = model(version), content = encoded(doc).replace('"durationSeconds": 2', '"durationSeconds": 2e0').replace('"value": [', '"va\\u006cue": [');
  const input = fields(doc), before = structuredClone(input), result = await retimeSceneAnimationDraft(content, input, 1);
  assert.equal(result.schemaVersion, version); assert.equal(result.durationSeconds, 1);
  assert.deepEqual(result.tracks[0].keyframes.map(frame => frame.atSeconds), [0,.25,1]);
  assert.deepEqual(input, before); assert.equal(isSceneAnimationProposal(result), false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.tracks[0].keyframes));
  const proposal = await createSceneAnimationProposal(source(content), fields(result));
  const changed = ['/durationSeconds','/tracks/0/keyframes/1/atSeconds','/tracks/0/keyframes/2/atSeconds', ...(version >= 2 ? ['/tracks/1/keyframes/1/atSeconds'] : []), ...(version === 3 ? ['/clips/0/startSeconds','/clips/0/endSeconds'] : [])];
  assert.deepEqual(proposal.changedPaths, changed);
  assert.ok(proposal.afterContent.startsWith('\ufeff')); assert.equal(proposal.afterContent.replaceAll('\r\n','').includes('\n'), false);
  assert.ok(proposal.afterContent.includes('"va\\u006cue"'));
  assert.equal((await prepareSceneAnimationApply(source(content), proposal, { digest })).afterContent, proposal.afterContent);
  await assert.rejects(prepareSceneAnimationApply(source(content + '\r\n'), proposal, { digest }), { errorCode: 'scene_animation_authoring_conflict' });
});

test('current unsaved form values and authored clip edits survive retime instead of reverting to the saved model', async () => {
  const doc = model(), input = fields(doc);
  input.tracks[0].keyframes[1].value = [8,9]; input.tracks[0].keyframes[1].atSeconds = 1;
  input.clips[0].name = '未保存の名前'; input.clips[0].startSeconds = 1; input.clips[0].loop = true; input.loop = false;
  const result = await retimeSceneAnimationDraft(encoded(doc), input, 4);
  assert.deepEqual(result.tracks[0].keyframes[1], { atSeconds: 2, value: [8,9] });
  assert.deepEqual(result.clips[0], { ...input.clips[0], startSeconds: 2, endSeconds: 4 });
  assert.equal(result.loop, false); assert.equal(result.sceneObjectId, doc.sceneObjectId);
});

test('retime shares normal candidate schema promotion and preserves existing clips when omitted', async () => {
  const old = model(1), sprites = fields(model(2)), result = await retimeSceneAnimationDraft(encoded(old), sprites, 1);
  assert.equal(result.schemaVersion, 2); assert.equal(result.tracks[1].grid.columns, 2);
  const withClips = await retimeSceneAnimationDraft(encoded(old), fields(model(3)), 1);
  assert.equal(withClips.schemaVersion, 3); assert.equal(withClips.clips[0].endSeconds, 1);
  const omitted = fields(model()); delete omitted.clips;
  const kept = await retimeSceneAnimationDraft(encoded(model()), omitted, 1);
  assert.deepEqual(kept.clips, [{ ...model().clips[0], startSeconds: .25, endSeconds: 1 }]);
});

test('same duration keeps numeric values exact and creates no ordinary edit by itself', async () => {
  const doc = model(); doc.tracks[0].keyframes[1].atSeconds = .3333333333333333;
  const result = await retimeSceneAnimationDraft(encoded(doc), fields(doc), 2);
  assert.deepEqual(result, doc);
  await assert.rejects(createSceneAnimationProposal(source(encoded(doc)), fields(result)), { errorCode: 'scene_animation_authoring_unchanged' });
});

test('invalid form and collapsed result fail without modifying the source or partially transforming inputs', async () => {
  const doc = model(), content = encoded(doc);
  for (const mutate of [v => v.durationSeconds = .25, v => v.tracks[0].keyframes[1].atSeconds = 0, v => v.clips[0].endSeconds = 3, v => v.tracks[0].keyframes[1].value[0] = NaN]) {
    const input = fields(doc); mutate(input); const before = structuredClone(input);
    await assert.rejects(retimeSceneAnimationDraft(content, input, 1)); assert.deepEqual(input, before);
  }
  const tiny = fields(doc); tiny.tracks[0].keyframes[1].atSeconds = Number.MIN_VALUE;
  const before = structuredClone(tiny); await assert.rejects(retimeSceneAnimationDraft(content, tiny, Number.MIN_VALUE)); assert.deepEqual(tiny, before);
  for (const value of [0,-1,61,Infinity,NaN,'1',null,{},[]]) await assert.rejects(retimeSceneAnimationDraft(content, fields(doc), value));
  assert.equal(content, encoded(doc));
});

test('draft transformation rejects accessors and extra fields without executing caller hooks', async () => {
  let calls = 0; const input = fields(model()); Object.defineProperty(input.tracks[0].keyframes[1], 'value', { enumerable: true, get() { calls++; return [1,1]; } });
  await assert.rejects(retimeSceneAnimationDraft(encoded(model()), input, 1)); assert.equal(calls, 0);
  const inherited = Object.create(fields(model())); await assert.rejects(retimeSceneAnimationDraft(encoded(model()), inherited, 1));
  await assert.rejects(retimeSceneAnimationDraft(encoded(model()), { ...fields(model()), extra: true }, 1));
});

test('current edit data is captured before the first await', async () => {
  const doc = model(), input = fields(doc), pending = retimeSceneAnimationDraft(encoded(doc), input, 1);
  input.tracks[0].keyframes[1].value[0] = 999; input.clips[0].name = 'late external mutation';
  const result = await pending;
  assert.equal(result.tracks[0].keyframes[1].value[0], 3); assert.equal(result.clips[0].name, doc.clips[0].name);
});
