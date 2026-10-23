import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serve, request } from './helpers.mjs';
import { animationPreviewFixture, fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { prepareAnimationStateScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import { createAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';
import { createAnimationStateScriptSourceHost } from '../../web/modules/app-animation-state-script-source.js';
import { readAnimationStateScriptSource, generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
import { createAnimationStateGraph, layoutAnimationStateGraph } from '../../engine/animation-state-graph.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const table = () => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'heavy' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'move', condition: { type: 'number', operator: 'gt', value: 0 } } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
] });
function view(value) {
  const original = structuredClone(value), graph = createAnimationStateGraph(value);
  assert.deepEqual(value, original);
  assert.deepEqual(graph.edges.map(edge => edge.trigger), value.transitions.map(edge => edge.trigger));
  assert.equal(layoutAnimationStateGraph(graph).routes.length, new Set(value.transitions.map(edge => edge.from + ':' + edge.to)).size);
  assert.deepEqual(graph.edges.map(edge => edge.index), value.transitions.map((_, index) => index));
  return graph;
}

for (const documents of ['documents', 'design-data']) test(`ordered branches v2 → reviewed v3 → Save → reorder → reopen → explicit v2 (${documents})`, async t => {
  const f = await animationPreviewFixture(t);
  if (documents !== 'documents') {
    await f.edit('workspace.json', value => { value.version = 2; value.paths.documents = documents; value.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.root, 'templates'), path.join(f.root, 'data-template'));
    await fs.rename(path.join(f.root, 'documents'), path.join(f.root, documents));
    for (const name of await fs.readdir(path.join(f.root, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, value => {
      value.sourcePath = value.sourcePath.replace(/^documents\//, documents + '/');
    });
  }
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root });
  const call = async payload => { const response = await request(base, '/api/doc', payload); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const workspace = JSON.parse(await f.read('workspace.json'));
  const context = { sourceToken: 'branches-create', documentRoot: documents, documentTypes: workspace.documentTypes.map(({ id, label }) => ({ id, label })) };
  const sourcePath = `${documents}/scripts/分支状态.txt`, selection = { starterId: 'godot-project-animation-state-table', documentType: 'character', sourcePath };
  const initialTable = table(), before = await fingerprint(f.root, { authorOnly: true });
  const proposal = prepareAnimationStateScriptDraft(context, selection, initialTable);
  assert.match(proposal.content, /godot-gdscript-v2/);
  assert.equal(prepareScriptDraftApply(context, proposal).content, proposal.content);
  const wrap = value => '\uFEFF' + value.replaceAll('\n', '\r\n');
  const original = wrap(proposal.content);
  let saved = await call({ path: sourcePath, content: original, documentType: selection.documentType, create: true });
  const record = (await readRegistry(f.root)).documents.find(row => row.sourcePath === sourcePath); assert.ok(record);
  const created = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(created).filter(name => created[name] !== before[name]).sort(), [sourcePath, `metadata/documents/${record.id}.json`].sort());
  for (const [name, value] of Object.entries(before)) assert.equal(created[name], value, name);
  const state = { document: {}, token: 'branches-reedit', sourcePath, content: original, baseline: original, version: saved.version,
    editable: true, sourceTXT: true, available: true, creating: false, busy: false };
  let writes = 0;
  const host = createAnimationStateScriptSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    writeDraft: value => { state.content = value; writes++; } });
  const source = await host.getSource(), changed = structuredClone(initialTable);
  changed.eventSelection = 'firstMatch';
  changed.transitions.unshift({ from: 'idle', to: 'heavy', trigger: { kind: 'event', name: 'move', condition: { type: 'number', operator: 'gte', value: 10 } } });
  changed.transitions.push({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'move' } });
  const reviewed = await createAnimationStateScriptProposal(source, changed);
  assert.match(reviewed.afterContent, /godot-gdscript-v3/);
  assert.deepEqual(reviewed.beforeParameters, reviewed.afterParameters, 'branch mode and order never become clip binding parameters');
  const expected = wrap(generateEditableGodotAnimationStateScript(changed).content);
  assert.equal(reviewed.afterContent, expected);
  assert.equal((await prepareAnimationStateScriptApply(source, reviewed, { digest: async value => hash(value) })).afterContent, expected);
  assert.deepEqual(view(changed).edges[0].trigger.condition, changed.transitions[0].trigger.condition);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), created); assert.equal(writes, 0);
  const invalid = structuredClone(changed); invalid.transitions.unshift(invalid.transitions.pop());
  await assert.rejects(() => createAnimationStateScriptProposal(source, invalid), { errorCode: 'animation_state_table_invalid' });
  assert.throws(() => view(invalid), { errorCode: 'animation_state_table_invalid' });
  await host.applyDraft(reviewed); assert.equal(writes, 1); assert.equal(state.content, expected);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), created, 'Apply changes only the draft');
  assert.deepEqual(readAnimationStateScriptSource((await host.getSource()).content).table, changed);
  saved = await call({ path: sourcePath, content: state.content, expectedVersion: state.version });
  state.baseline = state.content; state.version = saved.version;
  const after = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== created[name]), [sourcePath]);
  const parsed = readAnimationStateScriptSource(await f.read(sourcePath));
  assert.equal(parsed.bom, '\uFEFF'); assert.equal(parsed.newline, '\r\n'); assert.deepEqual(parsed.table, changed);
  assert.deepEqual((await readRegistry(f.root)).documents.find(row => row.id === record.id), record);
  assert.equal(discoverScriptParameterContract(expected).status, 'ready');
  assert.deepEqual(discoverScriptParameterContract(expected).parameters, discoverScriptParameterContract(original).parameters);
  // Reordering overlapping predicates is an author edit, but never a registration change.
  const reordered = structuredClone(changed);
  [reordered.transitions[0], reordered.transitions[1]] = [reordered.transitions[1], reordered.transitions[0]];
  const beforeReorder = await host.getSource();
  const reorderProposal = await createAnimationStateScriptProposal(beforeReorder, reordered);
  assert.notEqual(reorderProposal.afterContent, expected);
  assert.deepEqual(view(reordered).edges.map(edge => edge.trigger), reordered.transitions.map(edge => edge.trigger));
  await host.applyDraft(reorderProposal); assert.equal(writes, 2);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), after);
  await assert.rejects(() => host.applyDraft(reorderProposal));
  saved = await call({ path: sourcePath, content: state.content, expectedVersion: state.version });
  state.baseline = state.content; state.version = saved.version;
  assert.deepEqual(readAnimationStateScriptSource(await f.read(sourcePath)).table, reordered);
  const afterReorder = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterReorder).filter(name => afterReorder[name] !== after[name]), [sourcePath]);
  // Turning the explicit mode off never silently drops duplicate event branches.
  const invalidLegacy = structuredClone(reordered); delete invalidLegacy.eventSelection;
  await assert.rejects(async () => createAnimationStateScriptProposal(await host.getSource(), invalidLegacy), { errorCode: 'animation_state_table_invalid' });
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterReorder);
  const removing = await createAnimationStateScriptProposal(await host.getSource(), initialTable);
  assert.equal(removing.afterContent, original, 'explicitly removing duplicate branches and mode regenerates original v2 bytes');
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterReorder);
  await host.applyDraft(removing); assert.equal(writes, 3);
  saved = await call({ path: sourcePath, content: state.content, expectedVersion: state.version });
  state.baseline = state.content; state.version = saved.version;
  assert.equal(await f.read(sourcePath), original);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), created);
  assert.deepEqual(view(readAnimationStateScriptSource((await host.getSource()).content).table), view(initialTable));
  await assert.rejects(async () => createAnimationStateScriptProposal(await host.getSource(), initialTable), { errorCode: 'animation_state_script_authoring_unchanged' });
});
