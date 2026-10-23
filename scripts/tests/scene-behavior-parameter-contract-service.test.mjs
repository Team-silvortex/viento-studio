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
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { serve } from './helpers.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url)), sourcePath = 'documents/behaviors/demo.json', scriptPath = 'documents/scripts/checkpoint.txt';
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-parameter-contract-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
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

test('ordinary source catalogs preserve exact legacy shape while generated source gets a read-only contract', async t => {
  const f = await fixture(t), plain = await f.inspect();
  assert.deepEqual(Object.keys(plain.sources[0]).sort(), ['name', 'objectId', 'sourcePath', 'sourceRevision']);
  await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const before = await tree(f.root), result = await f.inspect();
  assert.equal(result.schemaVersion, 1); assert.deepEqual(Object.keys(result).sort(), Object.keys(plain).sort());
  const source = result.sources[0]; assert.equal(source.parameterContract.status, 'ready');
  assert.deepEqual(source.parameterContract.parameters.map(value => value.name), ['clip_idle', 'clip_action']);
  assert.ok(Object.isFrozen(source.parameterContract.parameters[0])); assert.notEqual(result.dependencyRevision, plain.dependencyRevision);
  assert.equal(JSON.stringify(result).includes('extends Node'), false); assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.deepEqual(await tree(f.root), before);
});
test('saved declaration edits alter the existing dependency revision and stale parameters remain editable data', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const ready = await f.inspect();
  const model = JSON.parse(f.content); model.bindings[0].parameters = { old_clip: '00000000-0000-4000-8000-000000000001', clip_idle: 12 };
  const withStale = await f.inspect(json(model)); assert.equal(withStale.dependencyRevision, ready.dependencyRevision); assert.equal(withStale.sources[0].parameterContract.status, 'ready');
  for (const [content, status] of [[DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT + '\n# User code\n', 'modified'],
    [DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replace('"schemaVersion":1', '"schemaVersion":2'), 'unsupported']]) {
    await f.write(content); const before = await tree(f.root), result = await f.inspect(json(model));
    assert.equal(result.sources[0].parameterContract.status, status); assert.deepEqual(result.sources[0].parameterContract.parameters, []);
    assert.notEqual(result.dependencyRevision, ready.dependencyRevision); assert.deepEqual(await tree(f.root), before);
  }
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content);
});
test('behavior source size limit remains 64 KiB even when an editable declaration allows larger text', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT + '#'.repeat(65536));
  await assert.rejects(f.inspect(), error => error.statusCode === 400 && error.errorCode === 'scene_behavior_authoring_invalid' && error.payload.diagnostics.some(row => row.code === 'build_behavior_source_invalid'));
});
test('HTTP returns the same bounded optional contract through existing authentication without granting source or save authority', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root, DOC_API_TOKEN: 'parameter-test', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  const post = auth => fetch(base + '/api/scene-behavior-authoring', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer parameter-test' } : {}) }, body: json({ sourcePath, content: f.content }) });
  assert.equal((await post(false)).status, 401); const response = await post(true); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/); const envelope = await response.json(), result = envelope.data || envelope;
  assert.equal(result.sources[0].parameterContract.status, 'ready'); assert.equal(result.sources[0].parameterContract.parameters.length, 2);
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content); assert.equal(JSON.stringify(result).includes('extends Node'), false);
});

test('unavailable optional core preserves ordinary authoring and returns a non-actionable marker status', async t => {
  const f = await fixture(t); await f.write(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const before = await tree(f.root);
  const core = new URL('../../engine/studio-core.mjs', import.meta.url).href, service = new URL('../lib/scene-behavior-authoring-service.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';import {initializeStudioCore} from ${JSON.stringify(core)};await initializeStudioCore(async()=>new Uint8Array());const {createSceneBehaviorAuthoringService}=await import(${JSON.stringify(service)});const value=await createSceneBehaviorAuthoringService(${JSON.stringify(f.root)}).inspect(${JSON.stringify({ sourcePath, content: f.content })});assert.equal(value.sources[0].parameterContract.status,'unavailable');assert.deepEqual(value.sources[0].parameterContract.parameters,[]);`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]); assert.deepEqual(await tree(f.root), before);
});
