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
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES } from '../../engine/project-scene-retry-diagnostics.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = 'documents/behaviors/demo.json', scriptPath = 'documents/scripts/checkpoint.txt';
const scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const json = value => JSON.stringify(value, null, 2) + '\n';
const expected = [
  { name: 'action_name', type: 'string', defaultValue: 'ui_accept', referenceKind: '' },
  { name: 'target_scene_id', type: 'string', defaultValue: '', referenceKind: '' },
  { name: 'state_values_json', type: 'string', defaultValue: DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES, referenceKind: '' },
];
async function inventory(root) {
  const rows = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const absolute = path.join(entry.parentPath || entry.path, entry.name);
    rows[path.relative(root, absolute)] = createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
  }
  return rows;
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-retry-parameter-service-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'author');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true });
  // This directory test needs no resources or native runtime. Remove the
  // example's image binding rather than relying on a local asset cache.
  const sceneFile = path.join(root, 'documents/scenes/demo.json');
  const scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
  for (const actor of scene.actors) delete actor.imageResourceId;
  await fs.writeFile(sceneFile, json(scene));
  const recordFile = path.join(root, 'metadata/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json');
  const record = JSON.parse(await fs.readFile(recordFile, 'utf8')); record.assetBindings = [];
  await fs.writeFile(recordFile, json(record));
  await fs.rm(path.join(root, 'assets'), { recursive: true, force: true });
  await fs.rm(path.join(root, 'metadata/assets'), { recursive: true, force: true });
  const content = await fs.readFile(path.join(root, sourcePath), 'utf8');
  const service = createSceneBehaviorAuthoringService(root);
  return { root, temporary, content, inspect: (value = content) => service.inspect({ sourcePath, content: value }),
    write: content => fs.writeFile(path.join(root, scriptPath), content) };
}

test('saved exact retry sources offer bounded defaults without source text, mutation, or a manifest migration', async t => {
  const f = await fixture(t), plain = await f.inspect();
  assert.equal(Object.hasOwn(plain.sources[0], 'parameterContract'), false);
  const changed = JSON.parse(f.content); changed.bindings[0].parameters = {};
  changed.bindings[1].parameters = { action_name: 'keep_custom', target_scene_id: 'typed target', state_values_json: '{ "health":3 }', legacy_count: 0 };
  for (const source of [GODOT_ACTION_SCENE_RETRY_SCRIPT, '\ufeff' + GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('\n', '\r\n')]) {
    await f.write(source); const before = await inventory(f.root);
    const result = await f.inspect(json(changed)), candidate = result.sources.find(row => row.objectId === scriptId);
    assert.deepEqual(candidate.parameterContract.parameters, expected);
    assert.equal(candidate.parameterContract.status, 'ready');
    assert.ok(Object.isFrozen(candidate.parameterContract.parameters[0]));
    assert.deepEqual(Object.keys(result).sort(), Object.keys(plain).sort());
    assert.deepEqual(Object.keys(candidate).sort(), ['name', 'objectId', 'parameterContract', 'sourcePath', 'sourceRevision']);
    assert.equal(JSON.stringify(result).includes('extends Node'), false);
    assert.equal(JSON.stringify(result).includes(f.root), false);
    assert.deepEqual(await inventory(f.root), before, 'inspection is read-only even for an empty binding');
    assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content);
  }
});

test('ordinary edits and lookalike exports have no retry contract; saved source edits still revoke the dependency revision', async t => {
  const f = await fixture(t); await f.write(GODOT_ACTION_SCENE_RETRY_SCRIPT);
  const ready = await f.inspect();
  const edits = [GODOT_ACTION_SCENE_RETRY_SCRIPT + '# authored comment\n',
    GODOT_ACTION_SCENE_RETRY_SCRIPT.replace('health\":100', 'health\":3'),
    'extends Node\n@export var action_name: String = "ui_accept"\n@export var target_scene_id: String = ""\n'];
  for (const source of edits) {
    await f.write(source); const before = await inventory(f.root), result = await f.inspect();
    assert.equal(Object.hasOwn(result.sources[0], 'parameterContract'), false, 'unrecognized code remains ordinary editable source');
    assert.notEqual(result.dependencyRevision, ready.dependencyRevision);
    assert.deepEqual(await inventory(f.root), before);
  }
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content);
});

test('a fresh retry-only service never loads the optional core adapter, while unavailable animation contracts do not remove retry defaults', async t => {
  const f = await fixture(t); await f.write(GODOT_ACTION_SCENE_RETRY_SCRIPT);
  const before = await inventory(f.root), loader = path.join(f.temporary, 'deny-optional-core.mjs');
  await fs.writeFile(loader, "export async function resolve(s,c,n){if(s.endsWith('/node-studio-core.mjs'))throw Error('Optional core must not load for retry');return n(s,c);}\n");
  const core = new URL('../../engine/studio-core.mjs', import.meta.url).href;
  const service = new URL('../lib/scene-behavior-authoring-service.mjs', import.meta.url).href;
  const program = "import assert from 'node:assert/strict';import {getStudioCoreMetadata} from " + JSON.stringify(core)
    + ";const {createSceneBehaviorAuthoringService}=await import(" + JSON.stringify(service) + ");"
    + 'const result=await createSceneBehaviorAuthoringService(' + JSON.stringify(f.root) + ').inspect('
    + JSON.stringify({ sourcePath, content: f.content }) + ');'
    + "assert.equal(getStudioCoreMetadata().ready,false);assert.equal(result.sources[0].parameterContract.status,'ready');"
    + 'assert.deepEqual(result.sources[0].parameterContract.parameters,' + JSON.stringify(expected) + ');';
  await promisify(execFile)(process.execPath, ['--experimental-loader', loader, '--input-type=module', '-e', program]);

  const metadataFile = path.join(f.root, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8')), secondId = '11111111-1111-4111-8111-111111111111';
  metadata.relations.push({ kind: 'reference', targetId: secondId, slot: 'unused animation source' });
  await fs.writeFile(metadataFile, json(metadata));
  await fs.writeFile(path.join(f.root, 'documents/scripts/second.txt'), DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  const sourceRecord = JSON.parse(await fs.readFile(path.join(f.root, 'metadata/documents/' + scriptId + '.json'), 'utf8'));
  await fs.writeFile(path.join(f.root, 'metadata/documents/' + secondId + '.json'), json({ ...sourceRecord, id: secondId, sourcePath: 'documents/scripts/second.txt' }));
  const mixedBefore = await inventory(f.root);
  const mixedProgram = "import assert from 'node:assert/strict';import {initializeStudioCore} from " + JSON.stringify(core)
    + ";await initializeStudioCore(async()=>new Uint8Array());const {createSceneBehaviorAuthoringService}=await import(" + JSON.stringify(service)
    + ');const result=await createSceneBehaviorAuthoringService(' + JSON.stringify(f.root) + ').inspect('
    + JSON.stringify({ sourcePath, content: f.content }) + ');'
    + 'assert.equal(result.sources.find(x=>x.objectId===' + JSON.stringify(scriptId) + ").parameterContract.status,'ready');"
    + 'assert.equal(result.sources.find(x=>x.objectId===' + JSON.stringify(secondId) + ").parameterContract.status,'unavailable');";
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', mixedProgram]);
  assert.deepEqual(await inventory(f.root), mixedBefore);
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content);
  assert.equal(before[sourcePath], mixedBefore[sourcePath]);
});
