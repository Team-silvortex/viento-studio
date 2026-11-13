import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serve, request } from './helpers.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES } from '../../engine/project-scene-retry-diagnostics.mjs';
import { reviewScriptParameterRows } from '../../engine/script-parameter-interface.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { SCENE_BEHAVIOR_REFERENCE_DIRECTORY_API_PATH, sceneBehaviorReferenceValue } from '../../engine/scene-behavior-reference-directory.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const form = parameters => ({ backendId: 'org.viento.godot4', language: 'gdscript',
  parameters: Object.entries(parameters).map(([name, value]) => ({ name, type: typeof value, value: String(value) })) });
const defaults = { action_name: 'ui_accept', target_scene_id: '', state_values_json: DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES };

async function fixture(t, documents = 'documents') {
  const f = await projectAssemblyAuthor(t, { inputMap: { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'retry_game', keys: ['Enter'] }] } });
  const read = name => fs.readFile(path.join(f.author, name), 'utf8');
  const write = (name, value) => fs.writeFile(path.join(f.author, name), typeof value === 'string' ? value : json(value));
  const originalModel = JSON.parse(await read('documents/behaviors/demo.json'));
  originalModel.bindings[0].parameters = {}; originalModel.bindings[0].events = [];
  originalModel.bindings[1].parameters = { action_name: 'retry_game', target_scene_id: f.sceneIds[1], state_values_json: '{ "score":17,"health":3 }', untouched_extra: false };
  originalModel.bindings[1].events = [];
  await write('documents/behaviors/demo.json', '\ufeff' + json(originalModel).replaceAll('\n', '\r\n'));
  await write('documents/scripts/checkpoint.txt', '\ufeff' + GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('\n', '\r\n'));
  if (documents !== 'documents') {
    const workspace = JSON.parse(await read('workspace.json')); workspace.version = 2; workspace.paths.documents = documents; workspace.paths.templates = 'data-template';
    await write('workspace.json', workspace);
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) {
      const relative = 'metadata/documents/' + name, record = JSON.parse(await read(relative));
      record.sourcePath = record.sourcePath.replace(/^documents\//, documents + '/'); await write(relative, record);
    }
  }
  const sourcePath = documents + '/behaviors/demo.json', scriptPath = documents + '/scripts/checkpoint.txt';
  const original = await read(sourcePath), before = await fingerprint(f.author, { authorOnly: true });
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author });
  const call = async (route, payload) => { const result = await request(base, route, payload); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
  const sourceRead = await call('/api/doc?path=' + encodeURIComponent(sourcePath));
  const state = { document: {}, sourcePath, token: 'retry-defaults:1', content: original, baseline: original, version: sourceRead.version,
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, referencesAvailable: true, animationClipsAvailable: true, audioTracksAvailable: true };
  const writes = [], host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => hash(value),
    inspect: payload => call('/api/scene-behavior-authoring', payload),
    inspectReferenceDirectory: payload => call(SCENE_BEHAVIOR_REFERENCE_DIRECTORY_API_PATH, payload),
    writeDraft: content => { writes.push(content); state.content = content; } });
  return { ...f, sourcePath, scriptPath, sourceRead, state, writes, host, original, originalModel, before, read, write, call };
}
async function fillExplicitly(f) {
  const source = await f.host.getSource(), review = await f.call('/api/scene-behavior-authoring', { sourcePath: f.sourcePath, content: f.original });
  const contract = review.sources.find(row => row.objectId === f.scriptId).parameterContract;
  const checked = reviewScriptParameterRows(contract, form({}));
  assert.deepEqual(checked.missing.map(row => row.name), ['action_name', 'target_scene_id', 'state_values_json']);
  const values = Object.fromEntries(checked.missing.map(row => [row.name, row.defaultValue]));
  assert.deepEqual(values, defaults);
  const unscoped = await f.host.getReferences(source, { assemblyObjectId: null });
  assert.equal(unscoped.selectedAssembly, null, 'one available assembly still requires an explicit selection');
  assert.equal(sceneBehaviorReferenceValue(unscoped, { kind: 'scene', value: f.sceneIds[1] }), null);
  const selected = await f.host.getReferences(source, { assemblyObjectId: f.assemblyId });
  values.target_scene_id = sceneBehaviorReferenceValue(selected, { kind: 'scene', value: f.sceneIds[1] });
  values.action_name = sceneBehaviorReferenceValue(selected, { kind: 'action', value: 'retry_game' });
  assert.equal(values.target_scene_id, f.sceneIds[1]); assert.equal(values.action_name, 'retry_game');
  assert.equal(values.state_values_json, defaults.state_values_json);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), f.before);
  const model = structuredClone(f.originalModel); model.bindings[0].parameters = values;
  return { source, review, values, model, proposal: createSceneBehaviorProposal(source, { bindings: model.bindings }) };
}

for (const documents of ['documents', 'design-data']) test('explicit retry defaults → named references → review → ordinary Save → frozen assembly (' + documents + ')', async t => {
  const f = await fixture(t, documents), edit = await fillExplicitly(f);
  assert.equal(await f.read(f.sourcePath), f.original); assert.deepEqual(f.writes, []);
  const fresh = await f.call('/api/scene-behavior-authoring', { sourcePath: f.sourcePath, content: edit.proposal.afterContent });
  const applied = await f.host.applyDraft(edit.proposal, { dependencyRevision: fresh.dependencyRevision });
  assert.equal(applied.applied, true); assert.deepEqual(f.writes, [edit.proposal.afterContent]);
  assert.equal(f.state.baseline, f.original); assert.equal(f.state.version, f.sourceRead.version);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), f.before, 'Apply still changes only the editor draft');
  assert.ok(f.state.content.startsWith('\ufeff')); assert.equal(f.state.content.replaceAll('\r\n', '').includes('\n'), false);
  const candidate = JSON.parse(f.state.content.slice(1));
  assert.deepEqual(candidate.bindings[1], f.originalModel.bindings[1]);
  assert.deepEqual(candidate.bindings[0].events, f.originalModel.bindings[0].events);
  await f.call('/api/doc', { path: f.sourcePath, content: f.state.content, expectedVersion: f.sourceRead.version });
  const saved = await fingerprint(f.author, { authorOnly: true });
  assert.deepEqual(Object.keys(saved).filter(name => saved[name] !== f.before[name]), [f.sourcePath]);
  const reopened = await f.call('/api/doc?path=' + encodeURIComponent(f.sourcePath));
  assert.equal(reopened.content, f.state.content);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const behavior = captured.plan.scenes.find(scene => scene.scene.objectId === f.sceneIds[0]).behaviors;
  assert.deepEqual(behavior.bindings[0].parameters, edit.values);
  assert.deepEqual(Object.fromEntries(Object.keys(f.originalModel.bindings[1]).map(key => [key, behavior.bindings[1][key]])), f.originalModel.bindings[1]);
  assert.equal(behavior.bindings[1].declaration.sourcePath, f.sourcePath);
  assert.equal(behavior.bindings[1].declaration.propertyPath, '/bindings/1');
  assert.equal(behavior.sources.find(row => row.objectId === f.scriptId).content, await f.read(f.scriptPath));
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), saved);
});

test('a saved retry source edit rejects an old proposal; ordinary manual parameters remain applicable without any optional picker', async t => {
  const f = await fixture(t), edit = await fillExplicitly(f);
  const scriptRead = await f.call('/api/doc?path=' + encodeURIComponent(f.scriptPath));
  await f.call('/api/doc', { path: f.scriptPath, content: scriptRead.content + '\r\n# author-owned edit\r\n', expectedVersion: scriptRead.version });
  const beforeApply = await fingerprint(f.author, { authorOnly: true });
  await assert.rejects(f.host.applyDraft(edit.proposal, { dependencyRevision: edit.review.dependencyRevision }), { errorCode: 'scene_behavior_authoring_conflict' });
  assert.deepEqual(f.writes, []); assert.equal(f.state.content, f.original); assert.equal(await f.read(f.sourcePath), f.original);
  const fresh = await f.call('/api/scene-behavior-authoring', { sourcePath: f.sourcePath, content: edit.proposal.afterContent });
  assert.notEqual(fresh.dependencyRevision, edit.review.dependencyRevision);
  assert.equal(Object.hasOwn(fresh.sources.find(row => row.objectId === f.scriptId), 'parameterContract'), false);
  f.state.referencesAvailable = false; f.state.animationClipsAvailable = false; f.state.audioTracksAvailable = false;
  const applied = await f.host.applyDraft(edit.proposal, { dependencyRevision: fresh.dependencyRevision });
  assert.equal(applied.applied, true); assert.deepEqual(f.writes, [edit.proposal.afterContent]);
  assert.deepEqual(JSON.parse(f.state.content.slice(1)).bindings[1], f.originalModel.bindings[1]);
  assert.deepEqual(await fingerprint(f.author, { authorOnly: true }), beforeApply);
});
