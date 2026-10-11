// Independent current-source boundary probe, separate from prepared-copy acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const revision = content => `sha256:${sha(content)}`;
await import(pathToFileURL(path.join(root, 'scripts/adapters/node-studio-core.mjs')));
const files = ['engine/scene-composition-batch-layout.mjs', 'engine/scene-composition-layout.mjs', 'engine/scene-composition-overrides.mjs', 'engine/scene-composition.mjs', 'engine/scene-structure.mjs', 'engine/scene-layout.mjs', 'engine/studio-core.mjs', 'engine/json-source.mjs'];
const api = Object.assign({}, ...await Promise.all(files.map(file => import(pathToFileURL(path.join(root,file))))));
const examplePath = path.join(root, 'examples/scene-composition/recipe.json'), exampleBytes = await fs.readFile(examplePath);
const example = JSON.parse(exampleBytes), sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parse = text => JSON.parse(text.replace(/^\uFEFF/, ''));
function fixture(api, value = copy(example), dirty = false) {
  const content = typeof value === 'string' ? value : serialize(value), sourceRevision = revision(content), decoded = parse(content);
  const expanded = copy(api.expandSceneComposition(content));
  const source = { sourcePath: 'documents/prepared-batch-recipe.json', baseSourceRevision: dirty ? revision('saved baseline') : sourceRevision, content };
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2,
    scene: { objectId: sceneId, sourcePath: source.sourcePath, sourceRevision, viewport: expanded.scene.viewport, background: expanded.scene.background },
    actors: expanded.scene.actors.map(actor => ({ ...actor, name: actor.instanceId })),
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: sceneId, sourcePath: source.sourcePath,
      sourceRevision, fragmentCount: decoded.fragments.length, placementCount: decoded.placements.length },
    sourceLocations: { actors: expanded.sourceMap.actors.map((actor, index) => ({ instanceId: actor.instanceId, objectId: expanded.scene.actors[index].objectId,
      declaration: { objectId: sceneId, sourcePath: source.sourcePath, sourceRevision },
      composition: { fragmentId: actor.fragmentId, placementId: actor.placementId, localKey: actor.localKey } })) },
    sceneStructure: copy(api.createSceneStructure(expanded.scene)), ...(dirty ? { draft: { baseSourceRevision: source.baseSourceRevision, sourceRevision } } : {}) };
  return { source, model, ids: model.actors.map(actor => actor.instanceId) };
}
const positionInvalid = error => error?.errorCode === 'scene_layout_position_invalid';
const noChange = error => error?.errorCode === 'scene_composition_override_unchanged';
async function runCases(api) {
  const checks = [], digest = sha;
  assert.equal(api.supportsStudioCoreCompositionPositions(), true);
  for (const dirty of [false, true]) {
    const f = fixture(api, copy(example), dirty), original = copy(f);
    const draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      assert.equal(draft.setPositions(f.ids.map((objectId, index) => ({ objectId,
        position: [f.model.actors[index].position[0] + 17, f.model.actors[index].position[1] + 9] }))), true);
      const proposal = copy(draft.propose()), after = parse(proposal.afterContent);
      assert.equal(proposal.changes.length, 4);
      assert.deepEqual(proposal.changes.map(change => change.instanceId), f.ids);
      assert.deepEqual(proposal.changes.map(change => change.position), [[137,189],[217,189],[117,149],[217,189]]);
      assert.deepEqual(copy(await api.prepareSceneCompositionBatchLayoutApply(f.source, proposal, { digest })),
        { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
      assert.deepEqual(copy(api.expandSceneComposition(proposal.afterContent).scene.actors.map(actor => actor.position)),
        f.model.actors.map(actor => [actor.position[0] + 17, actor.position[1] + 9]));
      assert.deepEqual(after.fragments, example.fragments);
      assert.deepEqual(after.placements.map(placement => [placement.actorIds, placement.groupIds, placement.offset]),
        example.placements.map(placement => [placement.actorIds, placement.groupIds, placement.offset]));
      assert.deepEqual(after.placements[1].overrides[0].values,
        { position: [117,149], color: '#f1c46e', speed: 0, controls: 'none' });
      assert.equal(proposal.afterContent.startsWith('\uFEFF'), true);
      assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
      const beforeFragment = api.locateJsonSource(api.parseJsonSource(f.source.content), '/fragments');
      const afterFragment = api.locateJsonSource(api.parseJsonSource(proposal.afterContent), '/fragments');
      assert.equal(f.source.content.slice(beforeFragment.start, beforeFragment.end), proposal.afterContent.slice(afterFragment.start, afterFragment.end));
      assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false); assert.throws(() => draft.propose(), noChange);
      assert.equal(draft.redo(), true); assert.deepEqual(copy(draft.propose()), proposal);
      assert.deepEqual(f, original);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'saved-and-dirty-source-four-target-receipt', ok: true, sourceModes: 2, batchTargets: 4, oneAtomicHistoryStep: true,
    detachedAuthorSource: true, fragmentsStableIdsGroupsOffsetAndOtherValuesUnchanged: true });
  {
    for (const shape of ['absent', 'empty', 'existing']) {
      const value = copy(example); delete value.placements[0].overrides;
      if (shape === 'empty') value.placements[0].overrides = [];
      if (shape === 'existing') value.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 0 } }];
      const f = fixture(api, value), request = { protocolVersion: 1, operation: 'sceneComposition.patchPositions', content: f.source.content,
        changes: [{ placementId: value.placements[0].placementId, actorKey: 'companion', position: [231,198] },
          { placementId: value.placements[0].placementId, actorKey: 'leader', position: [141,198] }] };
      const receipt = copy(api.dispatchStudioCoreCompositionPositions(request));
      assert.deepEqual(copy(api.dispatchStudioCoreCompositionPositions({ ...request, changes: [...request.changes].reverse() })), receipt);
      const entries = parse(receipt.afterContent).placements[0].overrides;
      assert.deepEqual(entries.map(entry => entry.actorKey), ['leader','companion']);
      assert.deepEqual(entries[0].values, shape === 'existing' ? { speed: 0, position: [141,198] } : { position: [141,198] });
      assert.deepEqual(entries[1].values, { position: [231,198] });
    }
  }
  checks.push({ id: 'same-placement-atomic-append-and-order', ok: true, containerShapes: 3, requestOrderIndependent: true });
  {
    const f = fixture(api), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      draft.move([f.ids[0], f.ids[2]], [11,7]); draft.undo();
      const state = copy(draft.state()), actors = copy(draft.actors());
      const invalidBatches = [
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.ids[2], position: [-100000,220] }],
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.ids[2], position: [100001,220] }],
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.ids[0], position: [140,190] }],
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.model.actors[0].objectId, position: [140,190] }],
        [{ objectId: f.ids[0], position: [NaN,190] }],
        Array.from({ length: 129 }, () => ({ objectId: f.ids[0], position: [130,190] })),
      ];
      for (const input of invalidBatches) {
        assert.throws(() => draft.setPositions(input), positionInvalid);
        assert.deepEqual(copy(draft.state()), state); assert.deepEqual(copy(draft.actors()), actors);
      }
      assert.equal(draft.setPositions([]), false); assert.deepEqual(copy(draft.state()), state);
      draft.redo(); assert.deepEqual(copy(draft.currentPosition(f.ids[0])), [131,187]);
      assert.deepEqual(copy(draft.currentPosition(f.ids[2])), [471,227]);
      draft.reset(); draft.move([f.ids[0], f.ids[2]], [12,6], 32);
      const positions = copy([draft.currentPosition(f.ids[0]), draft.currentPosition(f.ids[2])]);
      assert.deepEqual(positions, [[128,192],[468,232]]);
      assert.deepEqual(positions[1].map((coordinate, axis) => coordinate - positions[0][axis]), [340,40]);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'all-local-bounds-before-history-atomic-move', ok: true, rejectedOperations: 6, redoAndUnselectedActorsUnchanged: true });
  {
    const value = copy(example); value.placements[1].offset = [0.2,0.2]; value.placements[1].overrides[0].values.position = [0.1,0.1];
    const f = fixture(api, value), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      const initial = copy(draft.currentPosition(f.ids[2])); assert.notEqual(initial[1] - 0.2, 0.1);
      assert.equal(draft.setPosition(f.ids[2], initial), false);
      draft.setPosition(f.ids[2], [initial[0] + 1, initial[1]]);
      assert.equal(draft.propose().changes[0].position[1], 0.1);
      draft.setPosition(f.ids[0], [140,190]); draft.setPosition(f.ids[2], initial);
      assert.deepEqual(copy(draft.propose().changes.map(change => change.instanceId)), [f.ids[0]]);
      draft.reset(); assert.equal(draft.state().dirty, false); assert.throws(() => draft.propose(), noChange);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'fractional-unchanged-axis-and-returned-target-noop', ok: true });
  {
    const f = fixture(api), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      for (const alignment of ['left','center','right','top','middle','bottom']) {
        const expected = copy(api.alignSceneSelection(f.model.actors, [f.ids[0],f.ids[3]], alignment));
        draft.align([f.ids[0],f.ids[3]], alignment);
        for (const { objectId, position } of expected) assert.deepEqual(copy(draft.currentPosition(objectId)), position);
        assert.deepEqual(copy(draft.currentPosition(f.ids[1])), f.model.actors[1].position);
        assert.deepEqual(copy(draft.currentPosition(f.ids[2])), f.model.actors[2].position);
        await api.prepareSceneCompositionBatchLayoutApply(f.source, draft.propose(), { digest });
        draft.undo(); assert.equal(draft.state().dirty, false); draft.reset();
      }
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'six-size-aware-alignments-one-history-step', ok: true, alignmentModes: 6 });
  {
    const value = copy(example); value.placements[0].overrides = [{ actorKey: 'leader', values: { position: [0,0] } },
      { actorKey: 'companion', values: { position: [99999.9999999,0] } }];
    const raw = serialize(value), content = raw + ' '.repeat(128 * 1024 - new TextEncoder().encode(raw).length);
    const f = fixture(api, content), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      assert.equal(new TextEncoder().encode(content).length, 128 * 1024);
      assert.throws(() => api.dispatchStudioCoreCompositionPositions({ protocolVersion: 1, operation: 'sceneComposition.patchPositions', content,
        changes: [{ placementId: value.placements[0].placementId, actorKey: 'leader', position: [100000,0] }] }),
      error => error?.errorCode === 'scene_composition_limit');
      draft.setPositions([{ objectId: f.ids[0], position: [100000,0] }, { objectId: f.ids[1], position: [1,0] }]);
      const proposal = draft.propose(); assert.ok(new TextEncoder().encode(proposal.afterContent).length < 128 * 1024);
      await api.prepareSceneCompositionBatchLayoutApply(f.source, proposal, { digest });
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'final-budget-shrink-offsets-growth-without-intermediate-commit', ok: true, exactSourceBytes: 131072 });
  {
    const f = fixture(api), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      draft.move([f.ids[0],f.ids[2]], [13,9]); const proposal = copy(draft.propose());
      for (const alter of [p => p.afterContent += ' ', p => p.changes[0].position[0]++, p => p.changes.reverse(),
        p => p.changes.push(copy(p.changes[0])), p => p.changes[0].instanceId = f.model.actors[0].objectId,
        p => p.changes[0].placementId = example.placements[1].placementId, p => p.changedPaths.reverse()]) {
        const wrong = copy(proposal); alter(wrong);
        await assert.rejects(api.prepareSceneCompositionBatchLayoutApply(f.source, wrong, { digest }));
      }
      await assert.rejects(api.prepareSceneCompositionBatchLayoutApply({ ...f.source, content: f.source.content + ' ' }, proposal, { digest }));
      assert.deepEqual(copy(draft.propose()), proposal);
      const wrongModel = copy(f.model); wrongModel.sourceLocations.actors[3].composition.placementId = example.placements[0].placementId;
      await assert.rejects(api.createSceneCompositionBatchLayoutDraft(wrongModel, f.source, { digest }));
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'canonical-identities-foreign-provenance-stale-and-forged-receipts', ok: true, rejectedOperations: 9 });
  {
    const f = fixture(api, copy(example), true), initial = copy(f); let resolve, captured;
    const gate = new Promise(done => { resolve = done; });
    const pending = api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: text => { captured = text; return gate; } });
    f.model.actors[2].position[0] = 999; f.source.content = '{}'; f.source.baseSourceRevision = revision('changed');
    resolve(sha(captured)); const draft = await pending;
    try {
      assert.deepEqual(copy(draft.actors()), initial.model.actors); draft.move([initial.ids[0],initial.ids[2]], [13,9]);
      const original = copy(draft.propose()), proposal = draft.propose(); proposal.changes[0].position[0] = 999;
      const actors = draft.actors(); actors[2].position[0] = 999;
      assert.deepEqual(copy(draft.propose()), original); await api.prepareSceneCompositionBatchLayoutApply(initial.source, original, { digest });
    } finally { draft.dispose(); }
    assert.throws(() => draft.propose(), error => error?.errorCode === 'scene_layout_draft_invalid');
    for (let index = 0; index < 36; index++) {
      const opened = await api.createSceneCompositionBatchLayoutDraft(initial.model, initial.source, { digest }); opened.dispose();
    }
    const history = await api.createSceneCompositionBatchLayoutDraft(initial.model, initial.source, { digest });
    try {
      const start = initial.model.actors[0].position;
      for (let index = 1; index <= 130; index++) history.setPosition(initial.ids[0], [start[0] + index,start[1]]);
      let undoCount = 0; while (history.undo()) undoCount++;
      assert.equal(undoCount,100); assert.deepEqual(copy(history.currentPosition(initial.ids[0])), [start[0] + 30,start[1]]);
      history.reset(); assert.equal(history.state().dirty, false); assert.deepEqual(copy(history.actors()), initial.model.actors);
    } finally { history.dispose(); }
    const legacy = await api.createSceneCompositionLayoutDraft(initial.model, initial.source, initial.ids[2], { digest });
    try {
      legacy.setPosition(initial.ids[2],[510,250]); const proposal = legacy.propose();
      assert.deepEqual(copy(proposal.values), { position: [150,170] });
      assert.equal(Object.hasOwn(proposal,'changes'), false);
      await api.prepareSceneCompositionOverrideApply(initial.source, proposal, { digest });
    } finally { legacy.dispose(); }
  }
  checks.push({ id: 'async-copy-ownership-disposal-100-history-and-legacy-single-contract', ok: true, disposedSessions: 36, historyLimit: 100 });
  return checks;
}

const checks = await runCases(api);
const sourceSha256 = Object.fromEntries(await Promise.all(files.map(async file => [file,sha(await fs.readFile(path.join(root,file)))])));
const report = { ok: true, recordedAt: new Date().toISOString(), scope: 'Independent read-only current-source batch geometry and Rust source-patch proof; no GUI, source persistence, prepared copies, installation or device acceptance.', runtime: { version: process.version, sha256: sha(await fs.readFile(process.execPath)) }, probeSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))), sourceSha256, wasmSha256: sha(await fs.readFile(path.join(root,'engine/studio-core.wasm'))), checks };
const output=path.join(evidence,'boundary-probe.json');
try { await fs.access(output); throw new Error('Refusing to overwrite final current-source boundary report'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ ok:true,cases:checks.length,runtime:report.runtime }));
