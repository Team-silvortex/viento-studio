import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSceneBehaviorAuthoringService } from '../lib/scene-behavior-authoring-service.mjs';
import { captureAnimationStateBindings } from '../../engine/animation-state-bindings.mjs';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../engine/godot-animation-state-script.mjs';
import { serve } from './helpers.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url)), sourcePath = 'documents/behaviors/demo.json', scriptPath = 'documents/scripts/checkpoint.txt';
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-state-bindings-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true });
  const content = await fs.readFile(path.join(root, sourcePath), 'utf8'), service = createSceneBehaviorAuthoringService(root);
  return { root, content, inspect: (value = content) => service.inspect({ sourcePath, content: value }), write: value => fs.writeFile(path.join(root, scriptPath), value) };
}
async function tree(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath || entry.path, entry.name); files[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return files;
}
const descriptor = () => ({ format: 'viento-animation-state-bindings', schemaVersion: 1, initialState: 'idle', states: [
  { stateKey: 'idle', parameterName: 'clip_idle', hasCompletion: false }, { stateKey: 'action', parameterName: 'clip_action', hasCompletion: true }] });
function versionTable(version) {
  const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE), scalar = { type: 'boolean', operator: 'eq', value: true };
  if (version === 2 || version === 3) table.transitions[0].trigger.condition = scalar;
  if (version === 3) table.eventSelection = 'firstMatch';
  if (version === 4) table.transitions[0].trigger.condition = { ...scalar, selector: { kind: 'projectState', key: 'combat.enabled' } };
  if (version === 5) table.transitions[0].trigger.condition = { combine: 'all', conditions: [scalar, { ...scalar, selector: { kind: 'projectState', key: 'combat.enabled' } }] };
  return table;
}
test('ordinary sources keep their legacy shape and all strict v1-v5 sources get only optional frozen metadata', async t => {
  const f = await fixture(t), plain = await f.inspect();
  assert.deepEqual(Object.keys(plain.sources[0]).sort(), ['name', 'objectId', 'sourcePath', 'sourceRevision']);
  for (const version of [1, 2, 3, 4, 5]) {
    const source = generateEditableGodotAnimationStateScript(versionTable(version)).content; await f.write('\ufeff' + source.replaceAll('\n', '\r\n'));
    const before = await tree(f.root), value = await f.inspect(), item = value.sources[0];
    assert.deepEqual(Object.keys(item).sort(), ['animationStateBindings', 'name', 'objectId', 'parameterContract', 'sourcePath', 'sourceRevision']);
    assert.deepEqual(item.animationStateBindings, descriptor()); assert.deepEqual(item.parameterContract, discoverScriptParameterContract(source));
    assert.ok(Object.isFrozen(item.animationStateBindings.states[0])); assert.deepEqual(captureAnimationStateBindings(item.animationStateBindings), descriptor());
    assert.notEqual(value.dependencyRevision, plain.dependencyRevision); assert.equal(JSON.stringify(value).includes('extends Node'), false); assert.equal(JSON.stringify(value).includes(f.root), false);
    assert.deepEqual(await tree(f.root), before);
  }
});
test('modified and unsupported declarations omit mapping metadata without breaking ordinary behavior authoring or existing parameter status', async t => {
  const f = await fixture(t);
  for (const [source, status] of [[DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT + '# edited\n', 'modified'],
    [DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replace('"schemaVersion":1', '"schemaVersion":99'), 'unsupported']]) {
    await f.write(source); const before = await tree(f.root), result = await f.inspect();
    assert.equal(Object.hasOwn(result.sources[0], 'animationStateBindings'), false); assert.equal(result.sources[0].parameterContract.status, status);
    assert.deepEqual(await tree(f.root), before);
  }
});
test('current unsaved binding parameters remain independent and source edits change the existing dependency revision', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const before = await f.inspect();
  const content = JSON.parse(f.content); content.bindings[0].parameters = { clip_idle: false, old_clip: 'raw author value' };
  const reviewed = await f.inspect(json(content)); assert.equal(reviewed.dependencyRevision, before.dependencyRevision); assert.deepEqual(reviewed.sources, before.sources);
  const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); table.transitions = table.transitions.filter(edge => edge.trigger.kind !== 'completed');
  await f.write(generateEditableGodotAnimationStateScript(table).content); const after = await f.inspect(json(content));
  assert.notEqual(after.dependencyRevision, before.dependencyRevision); assert.equal(after.sources[0].animationStateBindings.states[1].hasCompletion, false);
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content);
});
test('missing core omits only optional mapping metadata and keeps the identical dependency identity', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const ready = await f.inspect(), before = await tree(f.root);
  const core = new URL('../../engine/studio-core.mjs', import.meta.url).href, service = new URL('../lib/scene-behavior-authoring-service.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';import {initializeStudioCore} from ${JSON.stringify(core)};await initializeStudioCore(async()=>new Uint8Array());const {createSceneBehaviorAuthoringService}=await import(${JSON.stringify(service)});const value=await createSceneBehaviorAuthoringService(${JSON.stringify(f.root)}).inspect(${JSON.stringify({ sourcePath, content: f.content })});assert.equal(value.sources[0].parameterContract.status,'unavailable');assert.equal(Object.hasOwn(value.sources[0],'animationStateBindings'),false);assert.equal(value.dependencyRevision,${JSON.stringify(ready.dependencyRevision)});`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]); assert.deepEqual(await tree(f.root), before);
});
test('new metadata travels through the authenticated existing endpoint without exposing source bytes or granting writes', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const before = await tree(f.root);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root, DOC_API_TOKEN: 'state-binding-test', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  const post = authenticated => fetch(base + '/api/scene-behavior-authoring', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer state-binding-test' } : {}) }, body: json({ sourcePath, content: f.content }) });
  assert.equal((await post(false)).status, 401); const response = await post(true); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const envelope = await response.json(), value = envelope.data || envelope; assert.deepEqual(value.sources[0].animationStateBindings, descriptor());
  assert.equal(JSON.stringify(value).includes('extends Node'), false); assert.deepEqual(await tree(f.root), before);
});
