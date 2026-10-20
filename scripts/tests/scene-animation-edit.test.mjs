import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, isSceneAnimationProposal, prepareSceneAnimationApply } from '../../engine/scene-animation-edit.mjs';
import { createSceneAnimationSourceHost } from '../../web/modules/app-scene-animation-source.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const model = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 2, value: [10, 20] }] }] });
const hash = value => createHash('sha256').update(value).digest('hex');
const original = '\ufeff' + JSON.stringify(model(), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const source = (content = original) => ({ sourcePath: 'documents/animations/demo.json', token: 'source:1', content,
  sourceRevision: 'sha256:' + hash(content), baseSourceRevision: 'sha256:' + hash(content) });
const edit = (document = model()) => ({ durationSeconds: document.durationSeconds, loop: document.loop, tracks: structuredClone(document.tracks) });
const conflict = error => error.errorCode === 'scene_animation_authoring_conflict';
test('animation leaf editing preserves BOM CRLF escaped field spelling and unrelated author bytes', async () => {
  const content = original.replace('"durationSeconds"', '"durationSec\\u006fnds"').replace('"atSeconds": 0', '"atSeconds": 0e0');
  const value = edit(); value.durationSeconds = 3;
  const proposal = await createSceneAnimationProposal(source(content), value);
  assert.equal(proposal.afterContent, content.replace('"durationSec\\u006fnds": 2', '"durationSec\\u006fnds": 3'));
  assert.deepEqual(proposal.changedPaths, ['/durationSeconds']); assert.equal(isSceneAnimationProposal(proposal), true); assert.equal(Object.isFrozen(proposal.edit.tracks[0]), true);
  assert.equal((await prepareSceneAnimationApply(source(content), proposal, { digest: hash })).afterContent, proposal.afterContent);
});
test('animation structural edits preserve outer source bytes and the author newline style', async () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const content = '\ufeff' + JSON.stringify(model(), null, '  ').replaceAll('\n', newline) + newline;
    const value = edit(); value.tracks.push({ ...structuredClone(value.tracks[0]), id: id(4), property: 'opacity', keyframes: [{ atSeconds: 0, value: 1 }] });
    const proposal = await createSceneAnimationProposal(source(content), value), after = await readSceneAnimationDocument(proposal.afterContent);
    assert.deepEqual(after.tracks, value.tracks); assert.equal(proposal.afterContent.slice(0, proposal.afterContent.indexOf('"tracks"')), content.slice(0, content.indexOf('"tracks"')));
    assert.equal(proposal.afterContent.endsWith(newline + '}' + newline), true);
    if (newline !== '\n') assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false);
    const second = edit(after); second.tracks[0].keyframes.splice(1, 0, { atSeconds: 1, value: [5, 10] });
    assert.deepEqual((await createSceneAnimationProposal(source(proposal.afterContent), second)).changedPaths, ['/tracks/0/keyframes']);
  }
});
test('animation rejects forged proposals, source mutation, wrong scene fields and invalid Rust semantics', async () => {
  const value = edit(); value.loop = true; const proposal = await createSceneAnimationProposal(source(), value);
  assert.equal(isSceneAnimationProposal({ ...proposal }), false);
  await assert.rejects(prepareSceneAnimationApply(source(), { ...proposal }, { digest: hash }), conflict);
  for (const key of ['sourcePath', 'token', 'content', 'sourceRevision', 'baseSourceRevision']) await assert.rejects(prepareSceneAnimationApply({ ...source(), [key]: source()[key] + 'x' }, proposal, { digest: hash }), conflict);
  await assert.rejects(createSceneAnimationProposal(source(), { ...value, sceneObjectId: id(9) }));
  for (const change of [v => v.tracks[0].keyframes[0].atSeconds = 1, v => v.tracks[0].keyframes[1].atSeconds = 0,
    v => v.durationSeconds = 0, v => v.tracks[0].keyframes[1].value = [Infinity, 0], v => v.tracks.push(structuredClone(v.tracks[0])), v => v.tracks = []]) {
    const invalid = edit(); change(invalid); await assert.rejects(createSceneAnimationProposal(source(), invalid));
  }
});
test('animation edit snapshots data before async validation without invoking getters or toJSON', async () => {
  let calls = 0;
  for (const value of [{ get durationSeconds() { calls++; return 3; }, loop: false, tracks: model().tracks },
    { ...edit(), toJSON() { calls++; return edit(); } }, { ...edit(), tracks: [{ ...model().tracks[0], get keyframes() { calls++; return []; } }] }]) {
    const before = calls; await assert.rejects(createSceneAnimationProposal(source(), value)); assert.equal(calls, before);
  }
  const value = edit(); value.durationSeconds = 3; const pending = createSceneAnimationProposal(source(), value); value.durationSeconds = 4;
  assert.equal((await readSceneAnimationDocument((await pending).afterContent)).durationSeconds, 3);
});
function fixture() {
  const state = { document: {}, token: 'host:1', sourcePath: source().sourcePath, content: original, baseline: original, version: source().baseSourceRevision,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true };
  let calls = 0, at = 0, release, focuses = 0; const writes = [];
  const host = createSceneAnimationSourceHost({ getState: () => ({ ...state }), digest: async value => { if (++calls === at) await new Promise(r => { release = r; }); return hash(value); },
    writeDraft: content => { writes.push(content); state.content = content; state.token += ':draft'; }, focus: () => focuses++ });
  return { host, state, writes, focuses: () => focuses, block(offset) { at = calls + offset; },
    async blocked() { for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 1)); assert.ok(release); }, release: () => release() };
}
async function proposalFor(h) { const value = edit(); value.durationSeconds = 3; return createSceneAnimationProposal(await h.host.getSource(), value); }
test('animation host only writes its reviewed ordinary draft and focus is source guarded', async () => {
  const h = fixture(), proposal = await proposalFor(h), result = await h.host.applyDraft(proposal);
  assert.deepEqual(Object.keys(h.host).sort(), ['applyDraft', 'getContext', 'getSource', 'getTargets', 'getUsage']); assert.deepEqual(h.writes, [proposal.afterContent]); assert.equal(h.state.baseline, original);
  result.focus(); assert.equal(h.focuses(), 1); h.state.content += ' '; result.focus(); assert.equal(h.focuses(), 1);
  await assert.rejects(h.host.applyDraft(proposal), conflict);
});
test('animation host revokes stale proposals across every digest and caller cancellation', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating', 'sourceJSON']) {
    const h = fixture(), proposal = await proposalFor(h); h.block(offset); const pending = h.host.applyDraft(proposal); await h.blocked();
    if (key === 'document') h.state[key] = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
    h.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
  const h = fixture(); await assert.rejects(h.host.applyDraft(await proposalFor(h), { isCurrent: () => false }), conflict); assert.deepEqual(h.writes, []);
});
test('animation host recognizes only its format and observes capability transitions', async () => {
  const h = fixture(); assert.equal(h.host.getContext().animationSource, true); h.state.sourceJSON = false; assert.equal(await h.host.getSource(), null);
  h.state.sourceJSON = true; h.state.content = original.replace('viento-scene-animation', 'viento-scene-audio'); assert.equal(h.host.getContext().animationSource, false);
  h.state.content = original; h.state.available = false; assert.equal(await h.host.getSource(), null);
});
