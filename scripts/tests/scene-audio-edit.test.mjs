import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { readSceneAudioDocument, createSceneAudioProposal, createSceneAudioCueProposal, createSceneAudioTimelineProposal, createSceneAudioTrackProposal, isSceneAudioProposal, prepareSceneAudioApply } from '../../engine/scene-audio-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { sampleSceneAudio } from '../../engine/scene-audio-core.mjs';
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
const cueEdit = (doc = model()) => ({ tracks: edit(doc).tracks, cues: doc.cues.map(row => ({ ...row })) });
const trackEdit = (doc = model()) => ({ tracks: doc.tracks.map(row => ({ ...row })), cues: doc.cues.map(row => ({ ...row })) });
const cue = (n, atSeconds = 0, action = 'play', trackId = id(2)) => ({ id: id(n), trackId, atSeconds, action });
function token(content, path) {
  const { start, end } = locateJsonSource(parseJsonSource(content), path);
  return content.slice(start, end);
}
function outsideCues(content) {
  const { start, end } = locateJsonSource(parseJsonSource(content), '/cues');
  return [content.slice(0, start), content.slice(end)];
}
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

test('cue authoring adds the first stable cue to empty compact and formatted arrays', async () => {
  const doc = model(); doc.cues = [];
  for (const content of [JSON.stringify(doc), JSON.stringify(doc, null, '  '), '\ufeff' + JSON.stringify(doc, null, '\t').replaceAll('\n', '\r\n') + '\r\n']) {
    const rows = cueEdit(doc); rows.cues.push(cue(20, 2.5, 'play', id(4)));
    const p = await createSceneAudioCueProposal(source(content), rows);
    assert.deepEqual((await readSceneAudioDocument(p.afterContent)).cues, rows.cues);
    assert.deepEqual(outsideCues(p.afterContent), outsideCues(content));
    assert.deepEqual(p.changedPaths, ['/cues']);
    assert.equal(p.kind, 'scene-audio'); assert.ok(isSceneAudioProposal(p));
    assert.equal((await prepareSceneAudioApply(source(content), p, { digest: hash })).afterContent, p.afterContent);
    if (content.includes('\r\n')) {
      assert.ok(token(p.afterContent, '/cues').startsWith('[\r\n\t\t{\r\n\t\t\t'));
      assert.ok(!p.afterContent.replaceAll('\r\n', '').includes('\n'));
    }
  }
});
test('cue authoring removes all cues without changing bytes outside the array or playback authority', async () => {
  const rows = cueEdit(); rows.cues = [];
  const p = await createSceneAudioCueProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.cues, []); assert.deepEqual(after.tracks, model().tracks);
  assert.deepEqual(outsideCues(p.afterContent), outsideCues(original));
  assert.equal(token(p.afterContent, '/cues'), '[\r\n\t]');
  assert.deepEqual(sampleSceneAudio(after, 60).commands, []);
  assert.deepEqual(p.changedPaths, ['/cues']);
});
test('mixed cue deletion addition and leaf changes preserve retained tokens and track patches', async () => {
  const doc = model(); doc.cues.push(cue(8, 3, 'play', id(4)));
  const content = '\ufeff' + JSON.stringify(doc, null, '\t').replaceAll('\n', '\r\n')
    .replace('"cues":', '"cu\\u0065s":').replaceAll('"atSeconds":', '"atSe\\u0063onds":')
    .replace('"atSe\\u0063onds": 0', '"atSe\\u0063onds": 0e0').replace('"action": "stop"', '"act\\u0069on": "stop"') + '\r\n';
  const rows = cueEdit(doc); rows.cues.splice(1, 1); rows.cues[0].atSeconds = 4.5;
  rows.cues.push(cue(20, 0, 'stop')); rows.tracks[1].volume = 0.25;
  const p = await createSceneAudioCueProposal(source(content), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.cues, rows.cues);
  assert.equal(token(p.afterContent, '/cues/0'), token(content, '/cues/0').replace(': 5', ': 4.5'));
  assert.equal(token(p.afterContent, '/cues/1'), token(content, '/cues/2'));
  assert.deepEqual(outsideCues(p.afterContent), outsideCues(content.replace('"volume": 1', '"volume": 0.25')));
  assert.deepEqual(p.changedPaths, ['/tracks/1/volume', '/cues']);
  assert.ok(p.afterContent.includes('"cu\\u0065s"')); assert.ok(p.afterContent.includes('"act\\u0069on"'));
});
test('retained cue escapes numeric spellings whitespace and nonuniform separators survive structure edits', async () => {
  const doc = model(); doc.cues.push(cue(8));
  let content = JSON.stringify(doc).replace('"atSeconds":0', '"atSe\\u0063onds":0e0').replace('"action":"play"', '"action":"pl\\u0061y"');
  const rawArray = token(content, '/cues'), chunks = doc.cues.map((_, index) => token(content, `/cues/${index}`));
  content = content.replace(rawArray, `[ \r\n  ${chunks[0]},\n\t${chunks[1]}, \r\n    ${chunks[2]}\r\n ]`);
  const rows = cueEdit(doc); rows.cues.shift(); rows.cues.push(cue(20));
  const p = await createSceneAudioCueProposal(source(content), rows);
  assert.equal(token(p.afterContent, '/cues/0'), chunks[1]);
  assert.equal(token(p.afterContent, '/cues/1'), chunks[2]);
  assert.ok(p.afterContent.includes(`${chunks[1]}, \r\n    ${chunks[2]}`));
  assert.deepEqual(outsideCues(p.afterContent), outsideCues(content));
});
test('cue transport keeps the original leaf-only byte patches when identities and order are unchanged', async () => {
  const rows = cueEdit(); rows.cues[0].action = 'play'; rows.cues[1].atSeconds = 1.5; rows.tracks[0].volume = 0.2;
  const cueProposal = await createSceneAudioCueProposal(source(), rows);
  const leafRows = { tracks: rows.tracks, cues: rows.cues.map(({ id, atSeconds, action }) => ({ id, atSeconds, action })) };
  const leafProposal = await createSceneAudioProposal(source(), leafRows);
  assert.equal(cueProposal.afterContent, leafProposal.afterContent); assert.deepEqual(cueProposal.changedPaths, leafProposal.changedPaths);
  await assert.rejects(createSceneAudioCueProposal(source(), cueEdit()), { errorCode: 'scene_audio_authoring_unchanged' });
  const empty = model(); empty.cues = [];
  await assert.rejects(createSceneAudioCueProposal(source(JSON.stringify(empty)), cueEdit(empty)), { errorCode: 'scene_audio_authoring_unchanged' });
  await assert.rejects(createSceneAudioProposal(source(), rows), invalid);
});
test('equal-time cue playback keeps retained author order and appends new commands after retained cues', async () => {
  const rows = cueEdit(); rows.cues.forEach(row => { row.atSeconds = 2; }); rows.cues.push(cue(20, 2, 'stop'));
  const p = await createSceneAudioCueProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.cues.map(row => row.id), [id(6), id(7), id(20)]);
  const sampled = sampleSceneAudio(after, 2);
  assert.deepEqual(sampled.commands.map(command => command.cueId), [id(6), id(7), id(20)]);
  assert.equal(sampled.states[0].status, 'stopped'); assert.equal(sampled.states[0].lastCueId, id(20));
});
test('cue authoring delegates the 64 cue time action and reference limits to Rust validation', async () => {
  const doc = model(); doc.cues = []; const rows = cueEdit(doc), content = JSON.stringify(doc);
  rows.cues = Array.from({ length: 64 }, (_, index) => cue(100 + index, index === 63 ? 60 : 0));
  const p = await createSceneAudioCueProposal(source(content), rows);
  assert.equal((await readSceneAudioDocument(p.afterContent)).cues.length, 64);
  for (const mutate of [value => value.cues.push(cue(200)), value => { value.cues[0].atSeconds = 60.01; },
    value => { value.cues[0].atSeconds = -1; }, value => { value.cues[0].action = 'pause'; },
    value => { value.cues[0].trackId = id(99); }, value => { value.cues[0].id = 'not-a-uuid'; },
    value => { value.cues[1].id = value.cues[0].id; }]) {
    const candidate = structuredClone(rows); mutate(candidate);
    await assert.rejects(createSceneAudioCueProposal(source(content), candidate), { errorCode: 'scene_audio_invalid' });
  }
});
test('new cue identities cannot collide with scene track or resource identities', async () => {
  for (const collision of [id(1), id(2), id(3), id(4), id(5)]) {
    const rows = cueEdit(); rows.cues.push({ ...cue(20), id: collision });
    await assert.rejects(createSceneAudioCueProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
});
test('cue structure edits reject rebinding reordering interleaved additions and changes to track identity', async () => {
  for (const mutate of [rows => { rows.cues[0].trackId = id(4); }, rows => rows.cues.reverse(),
    rows => rows.cues.unshift(cue(20)), rows => rows.cues.splice(1, 0, cue(20)), rows => rows.cues.push({ ...rows.cues[0] }),
    rows => rows.tracks.reverse(), rows => rows.tracks.pop(), rows => { rows.tracks[0].id = id(30); },
    rows => { rows.tracks[0].resourceId = id(3); }, rows => { delete rows.cues[0].trackId; },
    rows => { rows.cues[0].extra = true; }, rows => { rows.sceneObjectId = id(1); }]) {
    const rows = cueEdit(); mutate(rows);
    await assert.rejects(createSceneAudioCueProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
});
test('cue inputs reject getters inherited rows sparse arrays dangerous keys symbols and oversized data before use', async () => {
  let called = 0;
  for (const mutate of [rows => Object.defineProperty(rows.cues[0], 'action', { enumerable: true, get() { called++; return 'stop'; } }),
    rows => Object.setPrototypeOf(rows.cues[0], { inherited: true }), rows => { delete rows.cues[0]; },
    rows => { rows.cues.extra = true; }, rows => { rows.cues[0][Symbol('hidden')] = true; },
    rows => Object.defineProperty(rows.cues[0], '__proto__', { enumerable: true, value: {} }),
    rows => Object.defineProperty(rows.cues[0], 'toJSON', { enumerable: true, value() { called++; return {}; } }),
    rows => { rows.cues[0].action = 'x'.repeat(65537); }, rows => { rows.cues[0].action = '\ud800'; },
    rows => { rows.cues[0].atSeconds = Infinity; }, rows => { rows.cues[0].atSeconds = Array.from({ length: 4096 }, () => 1); },
    rows => { let nested = 1; for (let index = 0; index < 20; index++) nested = { nested }; rows.cues[0].atSeconds = nested; }]) {
    const rows = cueEdit(); mutate(rows); await assert.rejects(createSceneAudioCueProposal(source(), rows), invalid);
  }
  const maliciousSource = source(); Object.defineProperty(maliciousSource, 'content', { enumerable: true, get() { called++; return original; } });
  await assert.rejects(createSceneAudioCueProposal(maliciousSource, cueEdit()), invalid);
  assert.equal(called, 0);
});
test('cue proposals capture source and structural input before awaiting and freeze all reviewed rows', async () => {
  const inputSource = source(), rows = cueEdit(); rows.cues.pop(); rows.cues.push(cue(20, 3));
  const pending = createSceneAudioCueProposal(inputSource, rows);
  inputSource.content = '{}'; inputSource.token = 'changed'; rows.cues[1].id = id(21); rows.cues[1].trackId = id(4); rows.cues.splice(0, 1);
  const p = await pending;
  assert.equal(p.beforeContent, original); assert.equal(p.sourceToken, 'source:1');
  assert.deepEqual((await readSceneAudioDocument(p.afterContent)).cues.map(row => row.id), [id(6), id(20)]);
  assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.edit.cues)); assert.ok(Object.isFrozen(p.edit.cues[1]));
  assert.throws(() => { p.edit.cues[1].id = id(21); }, TypeError);
});
test('structural cue proposals cannot be forged replayed retargeted or applied with a false digest', async () => {
  const rows = cueEdit(); rows.cues.push(cue(20)); const p = await createSceneAudioCueProposal(source(), rows);
  for (const fake of [{ ...p }, structuredClone(p)]) {
    assert.equal(isSceneAudioProposal(fake), false); await assert.rejects(prepareSceneAudioApply(source(), fake, { digest: hash }), conflict);
  }
  for (const key of ['token', 'content', 'sourcePath', 'sourceRevision', 'baseSourceRevision']) {
    await assert.rejects(prepareSceneAudioApply({ ...source(), [key]: source()[key] + 'x' }, p, { digest: hash }), conflict);
  }
  await assert.rejects(prepareSceneAudioApply(source(), p, { digest: () => hash('wrong') }), conflict);
  await assert.rejects(prepareSceneAudioApply(source(), p), conflict);
});
async function hostCueProposal(h) {
  const rows = cueEdit(); rows.cues.shift(); rows.cues.push(cue(20));
  return createSceneAudioCueProposal(await h.host.getSource(), rows);
}
test('ordinary audio source host accepts reviewed cue structure proposals and preserves explicit Save authority', async () => {
  const h = hostFixture(), p = await hostCueProposal(h), result = await h.host.applyDraft(p);
  assert.equal(result.applied, true); assert.deepEqual(h.writes, [p.afterContent]);
  assert.equal(h.state.baseline, original); assert.equal(h.document.saved, original);
  result.focus(); assert.equal(h.focused(), 1);
  await assert.rejects(h.host.applyDraft(p), conflict);
});
test('cue structure proposals obey host ownership checks at every digest boundary and cancellation', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating']) {
    const h = hostFixture(), p = await hostCueProposal(h); h.block(offset); const pending = h.host.applyDraft(p); await h.blocked();
    if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
    h.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
  const h = hostFixture(); await assert.rejects(h.host.applyDraft(await hostCueProposal(h), { isCurrent: () => false }), conflict);
  assert.deepEqual(h.writes, []);
});

test('legacy audio APIs still reject existing cue rebinding and reordered cue identities', async () => {
  const rebound = cueEdit(); rebound.cues[0].trackId = id(4);
  const reordered = cueEdit(); reordered.cues.reverse();
  await assert.rejects(createSceneAudioCueProposal(source(), rebound), { errorCode: 'scene_audio_authoring_invalid' });
  await assert.rejects(createSceneAudioCueProposal(source(), reordered), { errorCode: 'scene_audio_authoring_invalid' });
  await assert.rejects(createSceneAudioProposal(source(), rebound), { errorCode: 'scene_audio_authoring_invalid' });
  const leaves = edit(); leaves.cues.reverse();
  await assert.rejects(createSceneAudioProposal(source(), leaves), { errorCode: 'scene_audio_authoring_invalid' });
});
test('timeline rebinding patches only the escaped trackId leaf and requested track fields', async () => {
  const content = original.replaceAll('"trackId":', '"track\\u0049d":').replace('"atSeconds": 0', '"atSeconds": 0e0');
  const rows = cueEdit(); rows.cues[0].trackId = id(4); rows.tracks[0].volume = 0.25;
  const p = await createSceneAudioTimelineProposal(source(content), rows);
  assert.equal(p.afterContent, content.replace('5e-1', '0.25').replace(`"track\\u0049d": "${id(2)}"`, `"track\\u0049d": "${id(4)}"`));
  assert.deepEqual(p.changedPaths, ['/tracks/0/volume', '/cues/0/trackId']);
  assert.deepEqual((await readSceneAudioDocument(p.afterContent)).cues.map(row => row.id), [id(6), id(7)]);
  assert.equal(token(p.afterContent, '/cues/1'), token(content, '/cues/1'));
  assert.equal((await prepareSceneAudioApply(source(content), p, { digest: hash })).afterContent, p.afterContent);
});
test('timeline reordering reuses complete cue source tokens and preserves bytes outside cues', async () => {
  const content = original.replace('"cues":', '"cu\\u0065s":').replace('"atSeconds": 0', '"atSe\\u0063onds": 0e0')
    .replace('"action": "play"', '"action": "pl\\u0061y"');
  const rows = cueEdit(); rows.cues.reverse();
  const p = await createSceneAudioTimelineProposal(source(content), rows);
  assert.deepEqual(p.changedPaths, ['/cues']);
  assert.equal(token(p.afterContent, '/cues/0'), token(content, '/cues/1'));
  assert.equal(token(p.afterContent, '/cues/1'), token(content, '/cues/0'));
  assert.deepEqual(outsideCues(p.afterContent), outsideCues(content));
  assert.ok(p.afterContent.startsWith('\ufeff')); assert.ok(!p.afterContent.replaceAll('\r\n', '').includes('\n'));
  const secondRows = cueEdit(await readSceneAudioDocument(p.afterContent)); secondRows.cues[0].trackId = id(4);
  const next = await createSceneAudioTimelineProposal(source(p.afterContent), secondRows);
  assert.deepEqual(next.changedPaths, ['/cues/0/trackId']);
  assert.equal((await readSceneAudioDocument(next.afterContent)).cues[0].id, id(7));
});
test('timeline can interleave new cues reorder rebind delete and edit retained fields in one reviewed patch', async () => {
  const doc = model(); doc.cues.push(cue(8, 3, 'play', id(4)));
  const content = '\ufeff' + JSON.stringify(doc, null, '\t').replaceAll('\n', '\r\n').replaceAll('"trackId":', '"tr\\u0061ckId":') + '\r\n';
  const rows = cueEdit(doc);
  rows.cues = [cue(20, 1, 'play', id(4)), { ...doc.cues[2], trackId: id(2), atSeconds: 4, action: 'stop' }, cue(21), doc.cues[0]];
  rows.tracks[1].loop = true;
  const p = await createSceneAudioTimelineProposal(source(content), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.cues, rows.cues); assert.deepEqual(after.cues.map(row => row.id), [id(20), id(8), id(21), id(6)]);
  assert.equal(token(p.afterContent, '/cues/1'), token(content, '/cues/2')
    .replace(`"${id(4)}"`, `"${id(2)}"`).replace('"atSeconds": 3', '"atSeconds": 4').replace('"play"', '"stop"'));
  assert.equal(token(p.afterContent, '/cues/3'), token(content, '/cues/0'));
  assert.deepEqual(outsideCues(p.afterContent), outsideCues(content.replace('"loop": false', '"loop": true')));
  assert.deepEqual(p.changedPaths, ['/tracks/1/loop', '/cues']);
  assert.equal((await prepareSceneAudioApply(source(content), p, { digest: hash })).afterContent, p.afterContent);
});
test('reordering equal-time play and stop changes the actual Rust sampled final state including signed zero', async () => {
  for (const time of [2, 0]) {
    const doc = model(); doc.cues = [cue(6, time, 'play'), cue(7, time === 0 ? -0 : time, 'stop')];
    const before = sampleSceneAudio(doc, time); assert.equal(before.states[0].status, 'stopped');
    const rows = cueEdit(doc); rows.cues.reverse();
    let content = JSON.stringify(doc);
    if (time === 0) {
      const { start, end } = locateJsonSource(parseJsonSource(content), '/cues/1/atSeconds');
      content = content.slice(0, start) + '-0' + content.slice(end);
    }
    const p = await createSceneAudioTimelineProposal(source(content), rows), after = await readSceneAudioDocument(p.afterContent);
    const sampled = sampleSceneAudio(after, time);
    assert.deepEqual(sampled.commands.map(row => row.cueId), [id(7), id(6)]);
    assert.equal(sampled.states[0].status, 'playing'); assert.equal(sampled.states[0].lastCueId, id(6));
    assert.equal(sampled.states[0].startedAtSeconds, time);
    if (time === 0) assert.equal(token(p.afterContent, '/cues/0/atSeconds'), '-0');
  }
});
test('different-time cue rearrangement retains author order while Rust still schedules commands by time', async () => {
  const rows = cueEdit(); rows.cues.reverse();
  const p = await createSceneAudioTimelineProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.cues.map(row => row.id), [id(7), id(6)]);
  assert.deepEqual(sampleSceneAudio(after, 60), sampleSceneAudio(model(), 60));
  assert.deepEqual(sampleSceneAudio(after, 60).commands.map(row => row.atSeconds), [0, 5]);
});
test('timeline rebinding updates the referenced voice without changing resource or track identities', async () => {
  const rows = cueEdit(); rows.cues[1].trackId = id(4);
  const p = await createSceneAudioTimelineProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
  const sampled = sampleSceneAudio(after, 0);
  assert.deepEqual(after.tracks, model().tracks); assert.equal(after.sceneObjectId, id(1));
  assert.equal(sampled.states[0].status, 'stopped'); assert.equal(sampled.states[1].status, 'playing');
  assert.equal(sampled.commands[0].resourceId, id(5)); assert.equal(sampled.commands[0].trackId, id(4));
});
test('timeline Rust validation rejects unknown or malformed tracks duplicate cues invalid times and excess count', async () => {
  for (const mutate of [rows => { rows.cues[0].trackId = id(99); }, rows => { rows.cues[0].trackId = 'invalid'; },
    rows => { rows.cues[0].trackId = id(3); }, rows => { rows.cues[0].trackId = null; }, rows => rows.cues.push({ ...rows.cues[0] }),
    rows => rows.cues.unshift(cue(20), cue(20)), rows => { rows.cues[0].atSeconds = -0.01; },
    rows => { rows.cues[0].atSeconds = 60.01; }, rows => { rows.cues[0].action = 'pause'; },
    rows => { rows.cues = Array.from({ length: 65 }, (_, index) => cue(100 + index)); }]) {
    const rows = cueEdit(); mutate(rows);
    await assert.rejects(createSceneAudioTimelineProposal(source(), rows), { errorCode: 'scene_audio_invalid' });
  }
  const rows = cueEdit(); rows.cues = Array.from({ length: 64 }, (_, index) => cue(100 + index, index % 2 ? 60 : 0));
  const p = await createSceneAudioTimelineProposal(source(), rows);
  assert.equal((await readSceneAudioDocument(p.afterContent)).cues.length, 64);
});
test('timeline input still fixes track identities resources order and transport shape and blocks cross-class cue identities', async () => {
  for (const mutate of [rows => rows.tracks.reverse(), rows => rows.tracks.pop(), rows => { rows.tracks[0].id = id(20); },
    rows => { rows.tracks[0].resourceId = id(3); }, rows => { delete rows.cues[0].trackId; },
    rows => { rows.cues[0].extra = true; }, rows => { rows.sceneObjectId = id(1); },
    ...[id(1), id(2), id(3), id(4), id(5)].map(identity => rows => rows.cues.unshift({ ...cue(20), id: identity }))]) {
    const rows = cueEdit(); mutate(rows);
    await assert.rejects(createSceneAudioTimelineProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
});
test('timeline noops are rejected and edits shared with older APIs have identical output bytes', async () => {
  await assert.rejects(createSceneAudioTimelineProposal(source(), cueEdit()), { errorCode: 'scene_audio_authoring_unchanged' });
  const rows = cueEdit(); rows.tracks[1].volume = 0.2; rows.cues[0].atSeconds = 3;
  const p = await createSceneAudioTimelineProposal(source(), rows), previous = await createSceneAudioCueProposal(source(), rows);
  assert.equal(p.afterContent, previous.afterContent); assert.deepEqual(p.changedPaths, previous.changedPaths);
  rows.cues = [];
  const empty = await createSceneAudioTimelineProposal(source(), rows), emptySource = source(empty.afterContent);
  const emptyRows = cueEdit(await readSceneAudioDocument(empty.afterContent));
  await assert.rejects(createSceneAudioTimelineProposal(emptySource, emptyRows), { errorCode: 'scene_audio_authoring_unchanged' });
  emptyRows.cues.push(cue(20, 1, 'play', id(4)));
  const added = await createSceneAudioTimelineProposal(emptySource, emptyRows);
  assert.deepEqual((await readSceneAudioDocument(added.afterContent)).cues, emptyRows.cues);
});
test('timeline captures caller-owned order and bindings before await and rejects executable or sparse input', async () => {
  const inputSource = source(), rows = cueEdit(); rows.cues.reverse(); rows.cues[0].trackId = id(4);
  const pending = createSceneAudioTimelineProposal(inputSource, rows);
  rows.cues.reverse(); rows.cues[1].trackId = id(2); inputSource.content = '{}'; inputSource.token = 'changed';
  const p = await pending, after = await readSceneAudioDocument(p.afterContent);
  assert.equal(p.beforeContent, original); assert.equal(p.sourceToken, 'source:1');
  assert.deepEqual(after.cues.map(row => [row.id, row.trackId]), [[id(7), id(4)], [id(6), id(2)]]);
  assert.ok(Object.isFrozen(p.edit.cues[0])); assert.ok(Object.isFrozen(p.edit.cues));
  let called = 0;
  for (const mutate of [value => Object.defineProperty(value.cues[0], 'trackId', { enumerable: true, get() { called++; return id(4); } }),
    value => { delete value.cues[0]; }, value => Object.setPrototypeOf(value.cues[0], { inherited: true }),
    value => { value.cues[0].trackId = 'x'.repeat(65537); },
    value => Object.defineProperty(value.cues[0], '__proto__', { enumerable: true, value: {} })]) {
    const value = cueEdit(); mutate(value); await assert.rejects(createSceneAudioTimelineProposal(source(), value), invalid);
  }
  assert.equal(called, 0);
});
test('timeline proposal brands and source ownership cannot be forged or changed during prepare', async () => {
  const rows = cueEdit(); rows.cues.reverse(); rows.cues[0].trackId = id(4);
  const p = await createSceneAudioTimelineProposal(source(), rows);
  assert.ok(isSceneAudioProposal(p)); assert.equal(p.kind, 'scene-audio');
  for (const fake of [{ ...p }, structuredClone(p)]) await assert.rejects(prepareSceneAudioApply(source(), fake, { digest: hash }), conflict);
  for (const key of ['token', 'content', 'sourcePath', 'sourceRevision', 'baseSourceRevision']) {
    await assert.rejects(prepareSceneAudioApply({ ...source(), [key]: source()[key] + 'x' }, p, { digest: hash }), conflict);
  }
  await assert.rejects(prepareSceneAudioApply(source(), p, { digest: () => hash('wrong') }), conflict);
  const input = source(); let release;
  const prepared = prepareSceneAudioApply(input, p, { digest: value => new Promise(resolve => { release = () => resolve(hash(value)); }) });
  input.content = '{}'; input.token = 'changed'; release();
  assert.equal((await prepared).afterContent, p.afterContent);
});
async function hostTimelineProposal(h) {
  const rows = cueEdit(); rows.cues.reverse(); rows.cues[0].trackId = id(4);
  return createSceneAudioTimelineProposal(await h.host.getSource(), rows);
}
test('existing audio source host applies timeline proposals only to the ordinary draft and rejects replay', async () => {
  const h = hostFixture(), p = await hostTimelineProposal(h), result = await h.host.applyDraft(p);
  assert.equal(result.applied, true); assert.deepEqual(h.writes, [p.afterContent]);
  assert.equal(h.state.baseline, original); assert.equal(h.document.saved, original);
  result.focus(); assert.equal(h.focused(), 1); await assert.rejects(h.host.applyDraft(p), conflict);
});
test('timeline proposals lose host authority after each digest boundary and caller cancellation', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating']) {
    const h = hostFixture(), p = await hostTimelineProposal(h); h.block(offset); const pending = h.host.applyDraft(p); await h.blocked();
    if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
    h.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
  const h = hostFixture(); await assert.rejects(h.host.applyDraft(await hostTimelineProposal(h), { isCurrent: () => false }), conflict);
  assert.deepEqual(h.writes, []);
});

test('track authoring appends an independent voice using an existing resource without copying cues', async () => {
  const rows = trackEdit(); rows.tracks.push({ ...rows.tracks[0], id: id(20), volume: 0.25, loop: false });
  const p = await createSceneAudioTrackProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.tracks, rows.tracks); assert.deepEqual(after.cues, model().cues);
  assert.deepEqual(p.changedPaths, ['/tracks']); assert.equal(token(p.afterContent, '/cues'), token(original, '/cues'));
  assert.equal(token(p.afterContent, '/tracks/0'), token(original, '/tracks/0'));
  assert.equal(token(p.afterContent, '/tracks/1'), token(original, '/tracks/1'));
  const sampled = sampleSceneAudio(after, 0);
  assert.equal(sampled.states[0].status, 'playing'); assert.equal(sampled.states[2].status, 'stopped');
  assert.equal(sampled.states[0].resourceId, sampled.states[2].resourceId);
  assert.equal(sampled.states[0].loop, true); assert.equal(sampled.states[2].loop, false);
});
test('removing the first middle or last unreferenced track preserves remaining source fragments and order', async () => {
  const doc = model(); doc.tracks.push({ ...doc.tracks[0], id: id(8) }); doc.cues = [];
  const content = '\ufeff' + JSON.stringify(doc, null, '\t').replaceAll('\n', '\r\n').replace('"volume": 0.5', '"vol\\u0075me": 5e-1') + '\r\n';
  const originalRange = locateJsonSource(parseJsonSource(content), '/tracks');
  for (const removed of [0, 1, 2]) {
    const rows = trackEdit(doc); rows.tracks.splice(removed, 1);
    const p = await createSceneAudioTrackProposal(source(content), rows), after = await readSceneAudioDocument(p.afterContent);
    assert.deepEqual(after.tracks.map(row => row.id), doc.tracks.filter((_, index) => index !== removed).map(row => row.id));
    for (const [index, row] of after.tracks.entries()) {
      assert.equal(token(p.afterContent, `/tracks/${index}`), token(content, `/tracks/${doc.tracks.findIndex(original => original.id === row.id)}`));
    }
    const afterRange = locateJsonSource(parseJsonSource(p.afterContent), '/tracks');
    assert.equal(p.afterContent.slice(0, afterRange.start), content.slice(0, originalRange.start));
    assert.equal(p.afterContent.slice(afterRange.end), content.slice(originalRange.end));
    assert.deepEqual(p.changedPaths, ['/tracks']);
  }
});
test('removing a referenced track is rejected without automatically deleting or rebinding any cue', async () => {
  const rows = trackEdit(); rows.tracks.shift(); const captured = structuredClone(rows);
  await assert.rejects(createSceneAudioTrackProposal(source(), rows), { errorCode: 'scene_audio_invalid' });
  assert.deepEqual(rows, captured); assert.deepEqual(rows.cues, model().cues);
});
test('track removal can share a proposal with explicit cue rebinding and rearrangement', async () => {
  for (const reordered of [false, true]) {
    const rows = trackEdit(), copied = { ...rows.tracks[0], id: id(20) };
    rows.tracks.shift(); rows.tracks.push(copied); rows.cues.forEach(row => { row.trackId = id(20); });
    if (reordered) rows.cues.reverse();
    const p = await createSceneAudioTrackProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
    assert.deepEqual(after.tracks.map(row => row.id), [id(4), id(20)]); assert.deepEqual(after.cues, rows.cues);
    assert.deepEqual(p.changedPaths, reordered ? ['/tracks', '/cues'] : ['/tracks', '/cues/0/trackId', '/cues/1/trackId']);
    assert.equal(sampleSceneAudio(after, 0).states[1].status, 'playing');
    assert.equal(sampleSceneAudio(after, 0).commands[0].resourceId, id(3));
    assert.equal((await prepareSceneAudioApply(source(), p, { digest: hash })).afterContent, p.afterContent);
  }
});
test('new cues can target the new voice while sharing a resource with another independently controlled voice', async () => {
  const rows = trackEdit(); rows.tracks.push({ ...rows.tracks[0], id: id(20), role: 'effect', volume: 0.1, loop: false });
  rows.cues.unshift(cue(21, 0, 'play', id(20))); rows.cues.push(cue(22, 0, 'stop', id(2)));
  const p = await createSceneAudioTrackProposal(source(), rows), after = await readSceneAudioDocument(p.afterContent);
  const sampled = sampleSceneAudio(after, 0);
  assert.equal(sampled.states[0].status, 'stopped'); assert.equal(sampled.states[2].status, 'playing');
  assert.equal(sampled.states[2].resourceId, id(3)); assert.equal(sampled.states[2].volume, 0.1);
  assert.deepEqual(sampled.commands.map(row => row.cueId), [id(21), id(7), id(22)]);
  assert.deepEqual(p.changedPaths, ['/tracks', '/cues']);
});
test('track resources stay within the original resource set and existing resource bindings remain fixed', async () => {
  for (const mutate of [rows => { rows.tracks[0].resourceId = id(5); }, rows => { rows.tracks[0].resourceId = id(99); },
    rows => rows.tracks.push({ ...rows.tracks[0], id: id(20), resourceId: id(99) }),
    rows => rows.tracks.push({ ...rows.tracks[0], id: id(20), resourceId: id(4) }),
    rows => rows.tracks.push({ ...rows.tracks[0], id: id(20), resourceId: 'assets/new.wav' })]) {
    const rows = trackEdit(); mutate(rows);
    await assert.rejects(createSceneAudioTrackProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
  const rows = trackEdit(); rows.tracks = [{ ...rows.tracks[0], id: id(20) }]; rows.cues.forEach(row => { row.trackId = id(20); });
  const p = await createSceneAudioTrackProposal(source(), rows);
  assert.deepEqual((await readSceneAudioDocument(p.afterContent)).tracks, rows.tracks);
});
test('track authoring cannot reorder retained identities or insert a new track before retained tracks', async () => {
  for (const mutate of [rows => rows.tracks.reverse(), rows => rows.tracks.unshift({ ...rows.tracks[0], id: id(20) }),
    rows => rows.tracks.splice(1, 0, { ...rows.tracks[0], id: id(20) }), rows => rows.tracks.push({ ...rows.tracks[0] })]) {
    const rows = trackEdit(); mutate(rows);
    await assert.rejects(createSceneAudioTrackProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
});
test('new track and cue identities cannot collide across original or candidate identity classes', async () => {
  for (const collision of [id(1), id(2), id(3), id(4), id(5), id(6), id(7)]) {
    const rows = trackEdit(); rows.tracks.push({ ...rows.tracks[0], id: collision }); rows.cues = [];
    await assert.rejects(createSceneAudioTrackProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
  for (const collision of [id(1), id(2), id(3), id(4), id(5), id(20)]) {
    const rows = trackEdit(); rows.tracks = [{ ...rows.tracks[0], id: id(20) }];
    rows.cues = [cue(30, 0, 'play', id(20)), { ...cue(31, 0, 'play', id(20)), id: collision }];
    await assert.rejects(createSceneAudioTrackProposal(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
  }
  const duplicates = trackEdit(); duplicates.tracks.push({ ...duplicates.tracks[0], id: id(20) }, { ...duplicates.tracks[0], id: id(20) });
  await assert.rejects(createSceneAudioTrackProposal(source(), duplicates), { errorCode: 'scene_audio_invalid' });
});
test('Rust enforces one to sixteen tracks alongside all unchanged audio domain limits', async () => {
  const one = trackEdit(); one.tracks.pop();
  assert.equal((await readSceneAudioDocument((await createSceneAudioTrackProposal(source(), one)).afterContent)).tracks.length, 1);
  const maximum = trackEdit(); maximum.tracks.push(...Array.from({ length: 14 }, (_, index) => ({ ...maximum.tracks[0], id: id(100 + index) })));
  const p = await createSceneAudioTrackProposal(source(), maximum);
  assert.equal((await readSceneAudioDocument(p.afterContent)).tracks.length, 16);
  for (const mutate of [rows => { rows.tracks = []; rows.cues = []; },
    rows => rows.tracks.push(...Array.from({ length: 15 }, (_, index) => ({ ...rows.tracks[0], id: id(100 + index) }))),
    rows => rows.tracks.push({ ...rows.tracks[0], id: 'not-a-uuid' }), rows => { rows.tracks[0].role = 'voice'; },
    rows => { rows.tracks[0].volume = 1.01; }, rows => { rows.tracks[0].loop = 1; },
    rows => { rows.cues[0].trackId = id(99); }, rows => { rows.cues[0].atSeconds = 61; },
    rows => { rows.cues = Array.from({ length: 65 }, (_, index) => cue(100 + index)); }]) {
    const rows = trackEdit(); mutate(rows);
    await assert.rejects(createSceneAudioTrackProposal(source(), rows), { errorCode: 'scene_audio_invalid' });
  }
});
test('generic track and cue array patches preserve escaped keys BOM CRLF numeric tokens and unrelated bytes', async () => {
  const doc = model(); doc.tracks.push({ ...doc.tracks[1], id: id(8) });
  const content = '\ufeff' + JSON.stringify(doc, null, '\t').replaceAll('\n', '\r\n')
    .replace('"tracks":', '"tr\\u0061cks":').replaceAll('"resourceId":', '"resource\\u0049d":')
    .replace('"volume": 0.5', '"vol\\u0075me": 5e-1').replace('"cues":', '"cu\\u0065s":') + '\r\n';
  const rows = trackEdit(doc); rows.tracks.splice(1, 1); rows.tracks.push({ ...doc.tracks[1], id: id(20), loop: true });
  rows.cues.reverse(); rows.cues[0].trackId = id(20);
  const p = await createSceneAudioTrackProposal(source(content), rows), after = await readSceneAudioDocument(p.afterContent);
  assert.deepEqual(after.tracks, rows.tracks); assert.deepEqual(after.cues, rows.cues);
  assert.equal(token(p.afterContent, '/tracks/0'), token(content, '/tracks/0'));
  assert.equal(token(p.afterContent, '/tracks/1'), token(content, '/tracks/2'));
  assert.equal(token(p.afterContent, '/cues/1'), token(content, '/cues/0'));
  const maskArrays = text => {
    const parsed = parseJsonSource(text), ranges = ['/tracks', '/cues'].map(path => locateJsonSource(parsed, path)).sort((a, b) => b.start - a.start);
    for (const { start, end } of ranges) text = text.slice(0, start) + '[]' + text.slice(end);
    return text;
  };
  assert.equal(maskArrays(p.afterContent), maskArrays(content));
  assert.ok(!p.afterContent.replaceAll('\r\n', '').includes('\n'));
  assert.deepEqual(p.changedPaths, ['/tracks', '/cues']);
});
test('track transport with no structural changes preserves exact leaf patch behavior and rejects noops', async () => {
  await assert.rejects(createSceneAudioTrackProposal(source(), trackEdit()), { errorCode: 'scene_audio_authoring_unchanged' });
  const rows = trackEdit(); rows.tracks[0].volume = 0.25; rows.cues[0].trackId = id(4);
  const p = await createSceneAudioTrackProposal(source(), rows);
  const olderRows = { tracks: rows.tracks.map(({ id, role, volume, loop }) => ({ id, role, volume, loop })), cues: rows.cues };
  const older = await createSceneAudioTimelineProposal(source(), olderRows);
  assert.equal(p.afterContent, older.afterContent); assert.deepEqual(p.changedPaths, ['/tracks/0/volume', '/cues/0/trackId']);
  assert.deepEqual(p.changedPaths, older.changedPaths);
});
test('all three older APIs retain their strict fixed-track transport and reject track structure edits', async () => {
  for (const factory of [createSceneAudioProposal, createSceneAudioCueProposal, createSceneAudioTimelineProposal]) {
    const fullRows = trackEdit(); fullRows.tracks[0].volume = 0.25;
    await assert.rejects(factory(source(), fullRows), { errorCode: 'scene_audio_authoring_invalid' });
    for (const mutate of [rows => rows.tracks.push({ ...rows.tracks[0], id: id(20) }), rows => rows.tracks.pop(), rows => rows.tracks.reverse()]) {
      const rows = factory === createSceneAudioProposal ? edit() : cueEdit(); mutate(rows);
      await assert.rejects(factory(source(), rows), { errorCode: 'scene_audio_authoring_invalid' });
    }
  }
});
test('track proposal capture rejects getters prototypes sparse arrays shape changes and over-budget input', async () => {
  let called = 0;
  for (const mutate of [rows => Object.defineProperty(rows.tracks[0], 'resourceId', { enumerable: true, get() { called++; return id(3); } }),
    rows => Object.setPrototypeOf(rows.tracks[0], { inherited: true }), rows => { delete rows.tracks[0]; },
    rows => { delete rows.tracks[0].resourceId; }, rows => { rows.tracks[0].extra = true; },
    rows => { rows.tracks[0].resourceId = 'x'.repeat(65537); }, rows => { rows.tracks[0][Symbol('hidden')] = true; },
    rows => Object.defineProperty(rows.tracks[0], '__proto__', { enumerable: true, value: {} })]) {
    const rows = trackEdit(); mutate(rows); await assert.rejects(createSceneAudioTrackProposal(source(), rows), invalid);
  }
  assert.equal(called, 0);
  const input = source(), rows = trackEdit(); rows.tracks.push({ ...rows.tracks[0], id: id(20) }); rows.cues[0].trackId = id(20);
  const pending = createSceneAudioTrackProposal(input, rows);
  input.content = '{}'; rows.tracks[2].resourceId = id(99); rows.tracks.reverse(); rows.cues[0].trackId = id(4);
  const p = await pending, after = await readSceneAudioDocument(p.afterContent);
  assert.equal(p.beforeContent, original); assert.equal(after.tracks[2].resourceId, id(3)); assert.equal(after.cues[0].trackId, id(20));
  assert.ok(Object.isFrozen(p.edit.tracks[2])); assert.ok(Object.isFrozen(p.edit.cues[0]));
});
test('track proposals preserve private mode during replay preparation and reject forged or retargeted objects', async () => {
  const rows = trackEdit(); rows.tracks.push({ ...rows.tracks[0], id: id(20) }); rows.cues[0].trackId = id(20);
  const p = await createSceneAudioTrackProposal(source(), rows);
  assert.ok(isSceneAudioProposal(p)); assert.equal(p.kind, 'scene-audio');
  assert.equal((await prepareSceneAudioApply(source(), p, { digest: hash })).afterContent, p.afterContent);
  for (const fake of [{ ...p }, structuredClone(p)]) await assert.rejects(prepareSceneAudioApply(source(), fake, { digest: hash }), conflict);
  for (const key of ['token', 'content', 'sourcePath', 'sourceRevision', 'baseSourceRevision']) {
    await assert.rejects(prepareSceneAudioApply({ ...source(), [key]: source()[key] + 'x' }, p, { digest: hash }), conflict);
  }
  await assert.rejects(prepareSceneAudioApply(source(), p, { digest: () => hash('wrong') }), conflict);
});
async function hostTrackProposal(h) {
  const rows = trackEdit(); rows.tracks.push({ ...rows.tracks[0], id: id(20) }); rows.cues[0].trackId = id(20);
  return createSceneAudioTrackProposal(await h.host.getSource(), rows);
}
test('the ordinary host applies reviewed track structure solely to its unsaved draft and rejects replay', async () => {
  const h = hostFixture(), p = await hostTrackProposal(h), result = await h.host.applyDraft(p);
  assert.equal(result.applied, true); assert.deepEqual(h.writes, [p.afterContent]);
  assert.equal(h.state.baseline, original); assert.equal(h.document.saved, original);
  result.focus(); assert.equal(h.focused(), 1); await assert.rejects(h.host.applyDraft(p), conflict);
});
test('track structure proposals revoke host authority at all digest boundaries and on caller cancellation', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating', 'sourceJSON']) {
    const h = hostFixture(), p = await hostTrackProposal(h); h.block(offset); const pending = h.host.applyDraft(p); await h.blocked();
    if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
    h.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
  const h = hostFixture(); await assert.rejects(h.host.applyDraft(await hostTrackProposal(h), { isCurrent: () => false }), conflict);
  assert.deepEqual(h.writes, []);
});
