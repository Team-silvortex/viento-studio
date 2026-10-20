import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, prepareSceneAnimationApply } from '../../engine/scene-animation-edit.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const old = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 1 }] }] });
const clip = (n = 4) => ({ id: id(n), name: '待機', startSeconds: .5, endSeconds: 2, loop: false });
const document = () => ({ ...old(), schemaVersion: 3, clips: [clip()] });
const digest = text => createHash('sha256').update(text).digest('hex');
const source = content => ({ sourcePath: 'documents/animations/clips.json', token: 'source:1', content, sourceRevision: 'sha256:' + digest(content), baseSourceRevision: 'sha256:' + digest(content) });
const fields = d => ({ durationSeconds: d.durationSeconds, loop: d.loop, tracks: structuredClone(d.tracks) });
const content = (d, newline = '\r\n') => '\ufeff' + JSON.stringify(d, null, '\t').replaceAll('\n', newline) + newline;

test('adding clips upgrades only reviewed schema and inserts one property preserving BOM newline escaped spelling and all existing fields', async () => {
  for (const newline of ['\n', '\r\n', '\r', '']) {
    const text = newline ? content(old(), newline).replace('"schemaVersion"', '"schemaVersi\\u006fn"') : '\ufeff' + JSON.stringify(old());
    const edit = { ...fields(old()), clips: [clip()] }, p = await createSceneAnimationProposal(source(text), edit), parsed = await readSceneAnimationDocument(p.afterContent);
    assert.equal(parsed.schemaVersion, 3); assert.deepEqual(parsed.clips, edit.clips); assert.deepEqual(p.changedPaths, ['/schemaVersion', '/clips']);
    assert.equal(p.afterContent.charCodeAt(0), 0xfeff); assert.equal(p.afterContent.includes('"atSeconds": 0'), text.includes('"atSeconds": 0'));
    if (newline && newline !== '\n') assert.equal(p.afterContent.replaceAll(newline, '').includes('\n'), false);
    const at = p.afterContent.lastIndexOf(','); assert.ok(at > 0);
    assert.equal((await prepareSceneAnimationApply(source(text), p, { digest })).afterContent, p.afterContent);
  }
});

test('three-field edits retain v3 clips and stable clip edits patch only leaves', async () => {
  const text = content(document()).replace('"startSeconds": 0.5', '"startSeconds": 5e-1').replace('"name"', '"na\\u006de"');
  const edit = { ...fields(document()), clips: [ { ...clip(), name: 'Attack', loop: true } ] }, p = await createSceneAnimationProposal(source(text), edit);
  assert.deepEqual(p.changedPaths, ['/clips/0/name', '/clips/0/loop']);
  assert.equal(p.afterContent, text.replace('"na\\u006de": "待機"', '"na\\u006de": "Attack"').replace('"loop": false', '"loop": true'));
  const ordinary = fields(document()); ordinary.tracks[0].keyframes[0].value = .5;
  const q = await createSceneAnimationProposal(source(text), ordinary), d = await readSceneAnimationDocument(q.afterContent);
  assert.equal(d.schemaVersion, 3); assert.deepEqual(d.clips, document().clips); assert.deepEqual(q.changedPaths, ['/tracks/0/keyframes/0/value']);
});

test('explicit empty clips upgrades once and list removal never downgrades v3', async () => {
  const p = await createSceneAnimationProposal(source(content(old())), { ...fields(old()), clips: [] });
  assert.equal((await readSceneAnimationDocument(p.afterContent)).schemaVersion, 3);
  const text = content(document()), p2 = await createSceneAnimationProposal(source(text), { ...fields(document()), clips: [clip(), clip(5)] });
  assert.deepEqual(p2.changedPaths, ['/clips']);
  const removed = await createSceneAnimationProposal(source(p2.afterContent), { ...fields(document()), clips: [] });
  assert.deepEqual(removed.changedPaths, ['/clips']); assert.equal((await readSceneAnimationDocument(removed.afterContent)).schemaVersion, 3);
});

test('duration and clips are validated atomically and ordinary shrink cannot strand existing clips', async () => {
  const text = content(document()), ordinary = fields(document()); ordinary.durationSeconds = 1;
  await assert.rejects(createSceneAnimationProposal(source(text), ordinary), { errorCode: 'scene_animation_invalid' });
  const p = await createSceneAnimationProposal(source(text), { ...ordinary, clips: [{ ...clip(), endSeconds: 1 }] });
  assert.deepEqual(p.changedPaths, ['/durationSeconds', '/clips/0/endSeconds']);
  let calls = 0; const edit = { ...fields(document()), clips: [clip()] }; Object.defineProperty(edit.clips[0], 'name', { enumerable: true, get() { calls++; return 'x'; } });
  await assert.rejects(createSceneAnimationProposal(source(text), edit)); assert.equal(calls, 0);
  await assert.rejects(prepareSceneAnimationApply(source(text + '\n'), p, { digest }), { errorCode: 'scene_animation_authoring_conflict' });
});
