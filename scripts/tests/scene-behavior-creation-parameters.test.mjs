import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSceneBehaviorCreationService } from '../lib/scene-behavior-creation-service.mjs';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { GODOT_ACTION_SCENE_RESTART_SCRIPT } from '../../engine/godot-scene-restart-script.mjs';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from '../../engine/godot-project-pause-script.mjs';
import { GODOT_PROJECT_MENU_SCRIPT } from '../../engine/godot-project-menu-script.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';
import { behaviorFixture, fingerprint, sceneId, scriptId, json } from './helpers/world-behavior-create-fixture.mjs';
import { serve } from './helpers.mjs';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const serviceUrl = new URL('../lib/scene-behavior-creation-service.mjs', import.meta.url).href;
const coreUrl = new URL('../../engine/studio-core.mjs', import.meta.url).href;
const secondId = '77777777-7777-4777-8777-777777777777';
async function fixture(t, version = 3) {
  const f = await behaviorFixture(t, version), service = createSceneBehaviorCreationService(f.root);
  return { ...f, inspect: () => service.inspect({ sceneObjectId: sceneId }), write: source => fs.writeFile(path.join(f.root, f.scriptPath), source),
    async add(source) { const sourcePath = `${f.documents}/scripts/second.txt`, record = JSON.parse(await fs.readFile(path.join(f.root, `metadata/documents/${scriptId}.json`), 'utf8'));
      await fs.writeFile(path.join(f.root, sourcePath), source); await fs.writeFile(path.join(f.root, `metadata/documents/${secondId}.json`), json({ ...record, id: secondId, sourcePath })); return sourcePath; } };
}
const candidate = value => value.sources.find(source => source.objectId === scriptId);
const child = program => promisify(execFile)(process.execPath, ['--input-type=module', '-e', program], { cwd: appRoot });

test('ordinary TXT keeps the exact four-field shape and creation envelope, with no execution, source leak or author writes', async t => {
  const f = await fixture(t); const source = 'globalThis.__vientoCreationSourceExecuted = true; throw new Error("PRIVATE_SOURCE_NEVER_RUN");\n'; await f.write(source); const before = await fingerprint(f.root), result = await f.inspect();
  assert.equal(globalThis.__vientoCreationSourceExecuted, undefined); assert.equal(result.format, 'viento-behavior-creation-context'); assert.equal(result.schemaVersion, 1);
  assert.deepEqual(Object.keys(result).sort(), ['format', 'schemaVersion', 'worldId', 'baseRevision', 'documentRoot', 'documentTypes', 'scene', 'sources'].sort());
  assert.deepEqual(Object.keys(candidate(result)).sort(), ['objectId', 'sourcePath', 'sourceRevision', 'name'].sort()); assert.equal(candidate(result).sourceRevision, hash(source));
  assert.equal(Object.hasOwn(candidate(result), 'parameterContract'), false); assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE'), false); assert.equal(JSON.stringify(result).includes(f.root), false); assert.deepEqual(await fingerprint(f.root), before);
});

test('all four exact ordinary Godot providers expose bounded detached defaults with the revision of their captured TXT bytes', async t => {
  const cases = [[GODOT_ACTION_SCENE_RETRY_SCRIPT, ['action_name', 'target_scene_id', 'state_values_json']], [GODOT_ACTION_SCENE_RESTART_SCRIPT, ['action_name', 'state_values_json']],
    [GODOT_ACTION_PROJECT_PAUSE_SCRIPT, ['action_name', 'paused_text', 'resume_text']], [GODOT_PROJECT_MENU_SCRIPT, ['title', 'items_json', 'display_mode']]];
  for (const version of [2, 3]) {
    const f = await fixture(t, version), ordinary = await f.inspect();
    for (const [source, names] of cases) for (const content of [source, '\ufeff' + source.replaceAll('\n', '\r\n')]) {
      await f.write(content); const before = await fingerprint(f.root), result = await f.inspect(), row = candidate(result), contract = row.parameterContract;
      assert.equal(row.sourceRevision, hash(content)); assert.equal(contract.status, 'ready'); assert.equal(contract.backendId, 'org.viento.godot4'); assert.equal(contract.language, 'gdscript');
      assert.deepEqual(contract.parameters.map(value => value.name), names); assert.ok(contract.parameters.every(value => value.type === 'string' && value.referenceKind === ''));
      assert.deepEqual(captureScriptParameterContract(contract), contract); assert.ok(Object.isFrozen(contract)); assert.ok(Object.isFrozen(contract.parameters)); assert.ok(contract.parameters.every(Object.isFrozen));
      assert.deepEqual(Object.keys(row).sort(), ['objectId', 'sourcePath', 'sourceRevision', 'name', 'parameterContract'].sort()); assert.deepEqual(Object.keys(result).sort(), Object.keys(ordinary).sort());
      assert.equal(JSON.stringify(result).includes('extends Node'), false); assert.equal(JSON.stringify(result).includes(f.root), false); assert.deepEqual(await fingerprint(f.root), before);
    }
  }
});

test('authored edits and export lookalikes withdraw only optional advice and change saved revision without changing scene or registration', async t => {
  const f = await fixture(t); await f.write(GODOT_PROJECT_MENU_SCRIPT); const ready = await f.inspect(), original = await fingerprint(f.root);
  for (const source of [GODOT_PROJECT_MENU_SCRIPT + '\n# author extension\n', 'extends Node\n@export var title: String = "Menu"\n@export var items_json: String = "[]"\n', GODOT_ACTION_SCENE_RETRY_SCRIPT + '# changed\n']) {
    await f.write(source); const before = await fingerprint(f.root), result = await f.inspect(); assert.equal(Object.hasOwn(candidate(result), 'parameterContract'), false); assert.equal(candidate(result).sourceRevision, hash(source));
    assert.notEqual(candidate(result).sourceRevision, candidate(ready).sourceRevision); assert.notEqual(result.baseRevision, ready.baseRevision); assert.deepEqual(result.scene, ready.scene); assert.deepEqual(result.documentTypes, ready.documentTypes); assert.deepEqual(await fingerprint(f.root), before);
    for (const [file, digest] of Object.entries(original)) if (file !== f.scriptPath) assert.equal(before[file], digest, file);
  }
});

test('editable animation providers retain ready, modified and unsupported statuses without executable source or metadata changes', async t => {
  const f = await fixture(t);
  for (const [source, status] of [[DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, 'ready'], [DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT + '\n# author extension\n', 'modified'],
    [DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT.replace('"schemaVersion":1', '"schemaVersion":2'), 'unsupported']]) {
    await f.write(source); const before = await fingerprint(f.root), row = candidate(await f.inspect()); assert.equal(row.parameterContract.status, status); assert.equal(row.sourceRevision, hash(source));
    assert.deepEqual(row.parameterContract.parameters.map(value => value.name), status === 'ready' ? ['clip_idle', 'clip_action'] : []); assert.deepEqual(captureScriptParameterContract(row.parameterContract), row.parameterContract); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('a fresh pure-provider creation catalog never loads the optional Rust core adapter', async t => {
  const f = await fixture(t); await f.write(GODOT_PROJECT_MENU_SCRIPT); const before = await fingerprint(f.root), loader = path.join(path.dirname(f.root), path.basename(f.root) + '-deny-core.mjs'); t.after(() => fs.rm(loader, { force: true }));
  await fs.writeFile(loader, "export async function resolve(s,c,n){if(s.endsWith('/node-studio-core.mjs'))throw Error('Pure menu inspection must not load optional core');return n(s,c);}\n");
  const program = `import assert from 'node:assert/strict'; import {getStudioCoreMetadata} from ${JSON.stringify(coreUrl)}; const {createSceneBehaviorCreationService}=await import(${JSON.stringify(serviceUrl)}); const result=await createSceneBehaviorCreationService(${JSON.stringify(f.root)}).inspect({sceneObjectId:${JSON.stringify(sceneId)}}); assert.equal(getStudioCoreMetadata().ready,false); assert.equal(result.sources[0].parameterContract.status,'ready'); assert.deepEqual(result.sources[0].parameterContract.parameters.map(x=>x.name),['title','items_json','display_mode']);`;
  await promisify(execFile)(process.execPath, ['--experimental-loader', loader, '--input-type=module', '-e', program], { cwd: appRoot }); assert.deepEqual(await fingerprint(f.root), before);
});

test('unavailable optional animation core leaves pure advice ready and all legacy creation candidates selectable', async t => {
  const f = await fixture(t); await f.write(GODOT_ACTION_SCENE_RETRY_SCRIPT); await f.add(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT); const before = await fingerprint(f.root);
  const program = `import assert from 'node:assert/strict'; import {initializeStudioCore} from ${JSON.stringify(coreUrl)}; await initializeStudioCore(async()=>new Uint8Array()); const {createSceneBehaviorCreationService}=await import(${JSON.stringify(serviceUrl)}); const result=await createSceneBehaviorCreationService(${JSON.stringify(f.root)}).inspect({sceneObjectId:${JSON.stringify(sceneId)}}); assert.equal(result.sources.length,2); assert.equal(result.sources.find(x=>x.objectId===${JSON.stringify(scriptId)}).parameterContract.status,'ready'); const animation=result.sources.find(x=>x.objectId===${JSON.stringify(secondId)}).parameterContract; assert.equal(animation.status,'unavailable'); assert.deepEqual(animation.parameters,[]);`;
  await child(program); assert.deepEqual(await fingerprint(f.root), before);
});

test('optional core loading cannot pair a later file edit with the earlier captured source revision or defaults', async t => {
  const f = await fixture(t), original = DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, changed = original + '\n# concurrent author edit\n'; await f.write(original);
  const before = await fingerprint(f.root), loader = path.join(path.dirname(f.root), path.basename(f.root) + '-edit-on-core.mjs'); t.after(() => fs.rm(loader, { force: true }));
  await fs.writeFile(loader, `import {writeFile} from 'node:fs/promises'; let changed=false; export async function resolve(s,c,n){if(!changed&&s.endsWith('/node-studio-core.mjs')){changed=true;await writeFile(${JSON.stringify(path.join(f.root, f.scriptPath))},${JSON.stringify(changed)});}return n(s,c);}\n`);
  const program = `import assert from 'node:assert/strict'; const {createSceneBehaviorCreationService}=await import(${JSON.stringify(serviceUrl)}); const service=createSceneBehaviorCreationService(${JSON.stringify(f.root)}); const captured=await service.inspect({sceneObjectId:${JSON.stringify(sceneId)}}); assert.equal(captured.sources[0].sourceRevision,${JSON.stringify(hash(original))}); assert.equal(captured.sources[0].parameterContract.status,'ready'); const fresh=await service.inspect({sceneObjectId:${JSON.stringify(sceneId)}}); assert.equal(fresh.sources[0].sourceRevision,${JSON.stringify(hash(changed))}); assert.equal(fresh.sources[0].parameterContract.status,'modified'); assert.notEqual(fresh.baseRevision,captured.baseRevision);`;
  await promisify(execFile)(process.execPath, ['--experimental-loader', loader, '--input-type=module', '-e', program], { cwd: appRoot });
  const after = await fingerprint(f.root); assert.equal(after[f.scriptPath], hash(changed)); for (const [file, digest] of Object.entries(before)) if (file !== f.scriptPath) assert.equal(after[file], digest, file);
});

test('HTTP creation inspection returns only the optional bounded data through the original authenticated no-store route', async t => {
  const f = await fixture(t); await f.write(GODOT_PROJECT_MENU_SCRIPT); const before = await fingerprint(f.root);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root, DOC_API_TOKEN: 'creation-parameters-test', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  const post = auth => fetch(base + '/api/scene-behavior-creation', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer creation-parameters-test' } : {}) }, body: JSON.stringify({ sceneObjectId: sceneId }) });
  assert.equal((await post(false)).status, 401); const response = await post(true); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json(), result = body.data || body; assert.equal(candidate(result).sourceRevision, hash(GODOT_PROJECT_MENU_SCRIPT)); assert.equal(candidate(result).parameterContract.status, 'ready'); assert.deepEqual(candidate(result).parameterContract.parameters.map(row => row.name), ['title', 'items_json', 'display_mode']);
  assert.equal(JSON.stringify(result).includes('extends Node'), false); assert.equal(JSON.stringify(result).includes(f.root), false); assert.deepEqual(await fingerprint(f.root), before);
});
