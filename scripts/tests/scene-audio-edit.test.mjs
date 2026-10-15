import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { readSceneAudioDocument, createSceneAudioProposal, isSceneAudioProposal, prepareSceneAudioApply } from '../../engine/scene-audio-edit.mjs';
import { createSceneAudioSourceHost } from '../../web/modules/app-scene-audio-source.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const model = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1), tracks: [
  { id: id(2), resourceId: id(3), role: 'music', volume: 0.5, loop: true },
  { id: id(4), resourceId: id(5), role: 'effect', volume: 1, loop: false },
], cues: [{ id: id(6), trackId: id(2), atSeconds: 5, action: 'stop' }, { id: id(7), trackId: id(2), atSeconds: 0, action: 'play' }] });
const original = '\ufeff' + JSON.stringify(model(), null, '\t').replaceAll('\n', '\r\n').replace('"volume": 0.5', '"vol\\u0075me": 5e-1') + '\r\n';
const source = (content = original) => ({ sourcePath: 'documents/audio/demo.json', token: 'source:1', content,
  sourceRevision: 'sha256:' + hash(content), baseSourceRevision: 'sha256:' + hash(original) });
const edit = (doc = model()) => ({ tracks: doc.tracks.map(({ id, role, volume, loop }) => ({ id, role, volume, loop })), cues: doc.cues.map(({ id, atSeconds, action }) => ({ id, atSeconds, action })) });
const invalid = error => ['scene_audio_authoring_invalid', 'scene_audio_invalid', 'studio_core_request_invalid'].includes(error?.errorCode);
const conflict = { errorCode: 'scene_audio_authoring_conflict' };

test('audio patches preserve source order BOM CRLF escaped keys identities resources and unrelated bytes', async () => {
  const rows = edit(); rows.tracks[1].volume = 0; rows.tracks[1].loop = true; rows.cues[0].atSeconds = 4.5;
  const p = await createSceneAudioProposal(source(), rows);
  assert.equal(p.afterContent, original.replace('"volume": 1', '"volume": 0').replace('"loop": false', '"loop": true').replace('"atSeconds": 5', '"atSeconds": 4.5'));
  assert.deepEqual(p.changedPaths, ['/tracks/1/volume', '/tracks/1/loop', '/cues/0/atSeconds']);
  const document = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(document.cues.map(row => row.id), model().cues.map(row => row.id));
  assert.equal(document.tracks[0].volume, 0.5); assert.equal(document.sceneObjectId, id(1));
  assert.equal((await prepareSceneAudioApply(source(), p, { digest: hash })).afterContent, p.afterContent);
  assert.ok(isSceneAudioProposal(p)); assert.ok(Object.isFrozen(p.edit.tracks[0]));
});
test('editing audio role action and escaped volume uses existing leaf tokens only', async () => {
  const rows = edit(); rows.tracks[0].role = 'effect'; rows.tracks[0].volume = 0.25; rows.cues[1].action = 'stop';
  const p = await createSceneAudioProposal(source(), rows);
  assert.equal(p.afterContent, original.replace('"role": "music"', '"role": "effect"').replace('5e-1', '0.25').replace('"action": "play"', '"action": "stop"'));
  assert.ok(p.afterContent.includes('"vol\\u0075me"'));
  await assert.rejects(createSceneAudioProposal(source(), edit()), { errorCode: 'scene_audio_authoring_unchanged' });
});
test('audio edit transport rejects identities count reorder unknown fields and getter execution', async () => {
  for (const mutate of [v => { v.tracks[0].id = id(90); }, v => { v.tracks.reverse(); }, v => { v.cues.reverse(); },
    v => { v.cues.pop(); }, v => { v.tracks[0].resourceId = id(90); }, v => { v.sceneObjectId = id(90); }]) {
    const rows = edit(); mutate(rows); await assert.rejects(createSceneAudioProposal(source(), rows), invalid);
  }
  let calls = 0; const rows = edit(); Object.defineProperty(rows.tracks[0], 'volume', { enumerable: true, get() { calls++; return 0.2; } });
  await assert.rejects(createSceneAudioProposal(source(), rows), invalid); assert.equal(calls, 0);
});
test('audio domain limits and enums are enforced by the Rust core', async () => {
  for (const [kind, key, value] of [['tracks', 'volume', -0.1], ['tracks', 'volume', 1.1], ['tracks', 'volume', '0.5'], ['tracks', 'role', 'unknown'],
    ['tracks', 'loop', 1], ['cues', 'atSeconds', -1], ['cues', 'atSeconds', 61], ['cues', 'action', 'pause']]) {
    const rows = edit(); rows[kind][0][key] = value; await assert.rejects(createSceneAudioProposal(source(), rows), { errorCode: 'scene_audio_invalid' });
  }
});
test('duplicate keys unknown formats and invalid original sources never produce an audio proposal', async () => {
  for (const content of [original.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'), '{}', '{', original.replace('viento-scene-audio', 'other')]) {
    await assert.rejects(createSceneAudioProposal(source(content), edit()), invalid);
  }
});
test('audio proposals cannot be forged replayed cross-source or prepared with changed digest', async () => {
  const rows = edit(); rows.tracks[0].volume = 0.2; const p = await createSceneAudioProposal(source(), rows);
  for (const fake of [{ ...p }, structuredClone(p)]) { assert.equal(isSceneAudioProposal(fake), false); await assert.rejects(prepareSceneAudioApply(source(), fake, { digest: hash }), conflict); }
  for (const key of ['token', 'content', 'sourcePath', 'sourceRevision', 'baseSourceRevision']) {
    await assert.rejects(prepareSceneAudioApply({ ...source(), [key]: source()[key] + 'x' }, p, { digest: hash }), conflict);
  }
  await assert.rejects(prepareSceneAudioApply(source(), p, { digest: () => hash('wrong') }), conflict);
});
test('caller mutation after asynchronous proposal starts cannot replace reviewed edit fields', async () => {
  const rows = edit(); rows.tracks[0].volume = 0.2; const pending = createSceneAudioProposal(source(), rows); rows.tracks[0].volume = 0.9;
  assert.equal((await readSceneAudioDocument((await pending).afterContent)).tracks[0].volume, 0.2);
});
function hostFixture() {
  const document = { saved: original }, state = { document, token: 'host:1', sourcePath: source().sourcePath, content: original,
    baseline: original, version: source().baseSourceRevision, editable: true, creating: false, busy: false, available: true, sourceJSON: true };
  const writes = []; let calls = 0, at = 0, release, focused = 0;
  const host = createSceneAudioSourceHost({ getState: () => ({ ...state }),
    digest: async value => { if (++calls === at) await new Promise(r => { release = r; }); return hash(value); },
    writeDraft: content => { writes.push(content); state.content = content; state.token += ':draft'; }, focus: () => focused++ });
  return { host, state, document, writes, focused: () => focused,
    block(offset) { at = calls + offset; release = null; }, async blocked() { for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 1)); assert.ok(release); }, release: () => release() };
}
async function hostProposal(h) { const rows = edit(); rows.tracks[0].volume = 0.25; return createSceneAudioProposal(await h.host.getSource(), rows); }
test('isolated audio source host updates the ordinary draft without changing saved document authority', async () => {
  const h = hostFixture(), p = await hostProposal(h), result = await h.host.applyDraft(p);
  assert.equal(result.applied, true); assert.deepEqual(h.writes, [p.afterContent]); assert.equal(h.state.baseline, original); assert.equal(h.document.saved, original);
  result.focus(); assert.equal(h.focused(), 1); h.state.content += ' '; result.focus(); assert.equal(h.focused(), 1);
  await assert.rejects(h.host.applyDraft(p), conflict);
});
test('audio source revokes authority after every digest boundary and on caller cancellation', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating']) {
    const h = hostFixture(), p = await hostProposal(h); h.block(offset); const pending = h.host.applyDraft(p); await h.blocked();
    if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
    h.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
  const h = hostFixture(); await assert.rejects(h.host.applyDraft(await hostProposal(h), { isCurrent: () => false }), conflict); assert.deepEqual(h.writes, []);
});
test('audio recognition is format-specific and responds to JSON capability and source changes', async () => {
  const h = hostFixture(); assert.equal(h.host.getContext().audioSource, true);
  h.state.sourceJSON = false; assert.equal(h.host.getContext().audioSource, false); assert.equal(await h.host.getSource(), null);
  h.state.sourceJSON = true; assert.equal(h.host.getContext().audioSource, true);
  h.state.content = '{}'; assert.equal(h.host.getContext().audioSource, false); assert.equal(await h.host.getSource(), null);
});
