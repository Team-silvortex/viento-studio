import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';

const original = await fs.readFile(new URL('../../examples/scene-behaviors/documents/behaviors/demo.json', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const dependencyRevision = 'sha256:' + 'e'.repeat(64), conflict = { errorCode: 'scene_behavior_authoring_conflict' };
function fixture() {
  const state = { document: {}, token: 'parameters:1', sourcePath: 'documents/behaviors/demo.json', content: original,
    baseline: original, version: 'sha256:' + hash(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true,
    animationClipsAvailable: true, audioTracksAvailable: true };
  const writes = []; let reviews = 0, dependency = dependencyRevision;
  const host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspect: async payload => { reviews++; return { format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: payload.sourcePath, dependencyRevision: dependency }; },
    writeDraft: value => { writes.push(value); state.content = value; } });
  return { state, writes, host, reviews: () => reviews, changedDependency: () => { dependency = 'sha256:' + 'f'.repeat(64); } };
}
async function proposal(h) {
  const source = await h.host.getSource(), model = JSON.parse(source.content);
  model.bindings[0].parameters.amount = 65;
  return createSceneBehaviorProposal(source, { bindings: model.bindings });
}

test('a synchronous caller guard cannot retarget behavior parameter application at any ownership checkpoint', async () => {
  for (const checkpoint of [1, 2, 3, 4, 5]) for (const key of ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceJSON']) {
    const h = fixture(), p = await proposal(h); let calls = 0;
    await assert.rejects(h.host.applyDraft(p, { dependencyRevision, isCurrent: () => {
      if (++calls === checkpoint) {
        if (key === 'document') h.state.document = {};
        else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key];
        else h.state[key] += ' ';
      }
      return true;
    } }), conflict);
    assert.equal(calls, checkpoint); assert.deepEqual(h.writes, [], `${checkpoint}:${key}`);
    assert.equal(h.reviews(), checkpoint === 5 ? 1 : 0, 'an obsolete guard must not reach a later dependency review');
  }
});

test('false caller guards at each checkpoint retain source bytes and ordinary save authority', async () => {
  for (const checkpoint of [1, 2, 3, 4, 5]) {
    const h = fixture(), p = await proposal(h); let calls = 0;
    await assert.rejects(h.host.applyDraft(p, { dependencyRevision, isCurrent: () => ++calls !== checkpoint }), conflict);
    assert.equal(calls, checkpoint); assert.deepEqual(h.writes, []); assert.equal(h.state.content, original);
    assert.equal(h.state.baseline, original); assert.equal(h.state.version, 'sha256:' + hash(original));
  }
});

test('a changed source dependency rejects an old parameter review while a fresh review can apply', async () => {
  const h = fixture(), p = await proposal(h); h.changedDependency();
  await assert.rejects(h.host.applyDraft(p, { dependencyRevision }), conflict);
  assert.deepEqual(h.writes, []); assert.equal(h.state.content, original);
  const result = await h.host.applyDraft(p, { dependencyRevision: 'sha256:' + 'f'.repeat(64) });
  assert.equal(result.applied, true); assert.deepEqual(h.writes, [p.afterContent]);
  assert.equal(h.state.baseline, original); assert.equal(h.state.version, 'sha256:' + hash(original));
});

test('optional picker withdrawal remains independent from a reviewed ordinary parameter edit', async () => {
  for (const key of ['animationClipsAvailable', 'audioTracksAvailable']) {
    const h = fixture(), p = await proposal(h); let calls = 0;
    const result = await h.host.applyDraft(p, { dependencyRevision, isCurrent: () => { if (++calls === 5) h.state[key] = false; return true; } });
    assert.equal(result.applied, true); assert.deepEqual(h.writes, [p.afterContent]);
    assert.equal(h.state.baseline, original);
  }
});
