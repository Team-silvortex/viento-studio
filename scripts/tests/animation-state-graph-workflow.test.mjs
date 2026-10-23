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
import { createAnimationStateGraph, layoutAnimationStateGraph } from '../../engine/animation-state-graph.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const table = () => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'isolated' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'attack' } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
  { from: 'attack', to: 'attack', trigger: { kind: 'event', name: 'again' } },
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'alternate' } },
  { from: 'idle', to: 'attack', trigger: { kind: 'completed' } },
] });
function view(value) {
  const before = structuredClone(value), graph = createAnimationStateGraph(value), layout = layoutAnimationStateGraph(graph);
  assert.deepEqual(value, before, 'preview never normalizes or writes the local author table');
  assert.equal(graph.nodes.length, 3); assert.equal(graph.edges.length, 5);
  assert.deepEqual(layout.routes[0].transitionIndices, [0, 3, 4]);
  assert.match(layout.routes[2].path, / C /, 'self-loop remains in the preview');
  assert.deepEqual(layoutAnimationStateGraph(graph), layout);
  return graph;
}

for (const documents of ['documents', 'design-data']) test(`read-only graph → source review → ordinary Save → re-edit → reopen (${documents})`, async t => {
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
  const call = async (route, payload) => { const response = await request(base, route, payload); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const workspace = JSON.parse(await f.read('workspace.json'));
  const context = { sourceToken: 'graph-create', documentRoot: documents, documentTypes: workspace.documentTypes.map(({ id, label }) => ({ id, label })) };
  const sourcePath = `${documents}/scripts/状态图.txt`, selection = { starterId: 'godot-project-animation-state-table', documentType: 'character', sourcePath };
  const originalTable = table(), before = await fingerprint(f.root, { authorOnly: true });
  const proposal = prepareAnimationStateScriptDraft(context, selection, originalTable), generated = generateEditableGodotAnimationStateScript(originalTable).content;
  assert.equal(proposal.content, generated);
  for (let repeat = 0; repeat < 3; repeat++) view(originalTable);
  assert.equal(prepareAnimationStateScriptDraft(context, selection, originalTable).content, proposal.content, 'graph projection does not enter generated source');
  assert.equal(prepareScriptDraftApply(context, proposal).content, generated, 'review remains applicable after projection');
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
  const content = '\uFEFF' + generated.replaceAll('\n', '\r\n');
  const saved = await call('/api/doc', { path: sourcePath, content, documentType: selection.documentType, create: true });
  const record = (await readRegistry(f.root)).documents.find(row => row.sourcePath === sourcePath); assert.ok(record);
  const afterCreate = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterCreate).filter(name => afterCreate[name] !== before[name]).sort(), [sourcePath, `metadata/documents/${record.id}.json`].sort());
  for (const [name, value] of Object.entries(before)) assert.equal(afterCreate[name], value, name);
  const state = { document: {}, token: 'graph-reedit', sourcePath, content, baseline: content, version: saved.version,
    editable: true, sourceTXT: true, available: true, creating: false, busy: false };
  let writes = 0;
  const host = createAnimationStateScriptSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    writeDraft: value => { state.content = value; writes++; } });
  const source = await host.getSource(), reopened = readAnimationStateScriptSource(source.content);
  assert.equal(reopened.bom, '\uFEFF'); assert.equal(reopened.newline, '\r\n');
  assert.deepEqual(view(reopened.table), createAnimationStateGraph(originalTable));
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterCreate);
  assert.equal(writes, 0); assert.equal(state.content, content);
  const changed = structuredClone(reopened.table); changed.states[1].key = 'strike';
  for (const edge of changed.transitions) { if (edge.from === 'attack') edge.from = 'strike'; if (edge.to === 'attack') edge.to = 'strike'; }
  changed.transitions[0].trigger.name = 'hit';
  const edited = await createAnimationStateScriptProposal(source, changed);
  assert.ok(edited.beforeParameters.some(row => row.name === 'clip_attack'));
  assert.ok(edited.afterParameters.some(row => row.name === 'clip_strike'));
  const expected = '\uFEFF' + generateEditableGodotAnimationStateScript(changed).content.replaceAll('\n', '\r\n');
  assert.equal(edited.afterContent, expected);
  for (let repeat = 0; repeat < 3; repeat++) view(changed);
  assert.equal((await prepareAnimationStateScriptApply(source, edited, { digest: async value => hash(value) })).afterContent, expected, 'existing source review survives read-only graph projection');
  const invalid = structuredClone(changed); invalid.states[1].key = '';
  assert.throws(() => createAnimationStateGraph(invalid), { errorCode: 'animation_state_table_invalid' });
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterCreate); assert.equal(writes, 0);
  assert.equal(state.content, content, 'cancelled local table and rejected invalid graph do not mutate the draft');
  await host.applyDraft(edited); assert.equal(writes, 1); assert.equal(state.content, expected);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterCreate, 'Apply is still only an in-memory draft');
  assert.deepEqual(view(readAnimationStateScriptSource((await host.getSource()).content).table), createAnimationStateGraph(changed), 'dirty source can reopen the graph before saving');
  const savedEdit = await call('/api/doc', { path: sourcePath, content: state.content, expectedVersion: state.version });
  state.baseline = state.content; state.version = savedEdit.version;
  const afterSave = await fingerprint(f.root, { authorOnly: true });
  assert.deepEqual(Object.keys(afterSave).filter(name => afterSave[name] !== afterCreate[name]), [sourcePath]);
  assert.deepEqual((await readRegistry(f.root)).documents.find(row => row.id === record.id), record, 'same source path, object identity and relations');
  assert.equal(await f.read(sourcePath), expected);
  const finalSource = await host.getSource(); assert.equal(finalSource.content, expected);
  assert.deepEqual(view(readAnimationStateScriptSource(finalSource.content).table), createAnimationStateGraph(changed));
  await assert.rejects(() => createAnimationStateScriptProposal(finalSource, changed), { errorCode: 'animation_state_script_authoring_unchanged' });
  assert.equal(writes, 1); assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), afterSave);
});
