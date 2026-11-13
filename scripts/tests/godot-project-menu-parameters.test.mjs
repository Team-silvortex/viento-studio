import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GODOT_PROJECT_MENU_SCRIPT as source } from '../../engine/godot-project-menu-script.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT as retry } from '../../engine/godot-scene-retry-script.mjs';
import { hasGodotProjectMenuParameterDeclaration as has, discoverGodotProjectMenuParameterContract as discover } from '../../engine/godot-project-menu-parameters.mjs';
import { hasScriptParameterDeclaration, requiresScriptParameterCore, discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
import { reviewScriptParameterRows } from '../../engine/script-parameter-interface.mjs';
const rows = [
  { name: 'title', type: 'string', defaultValue: 'Menu', referenceKind: '' },
  { name: 'items_json', type: 'string', defaultValue: '[{"id":"finish","label":"Exit","command":"finish"}]', referenceKind: '' },
  { name: 'display_mode', type: 'string', defaultValue: 'scene', referenceKind: '' },
];
const forms = [source, '\uFEFF' + source, source.replaceAll('\n', '\r\n'), '\uFEFF' + source.replaceAll('\n', '\r\n')];

test('exact menu advisory representations expose only three immutable actual String defaults without core', () => {
  for (const text of forms) {
    assert.equal(has(text), true); assert.equal(hasScriptParameterDeclaration(text), true); assert.equal(requiresScriptParameterCore(text), false);
    const contract = discover(text); assert.equal(contract.status, 'ready'); assert.equal(contract.schemaVersion, 1); assert.deepEqual(contract.parameters, rows);
    assert.equal(contract.backendId, 'org.viento.godot4'); assert.equal(contract.language, 'gdscript');
    assert.deepEqual(discoverScriptParameterContract(text), contract);
    assert.ok(Object.isFrozen(contract)); assert.ok(Object.isFrozen(contract.parameters)); assert.ok(contract.parameters.every(Object.isFrozen));
    assert.equal(JSON.stringify(contract).includes('extends Node'), false); assert.equal(JSON.stringify(contract).includes('target_scene_id'), false);
  }
});
test('menu edits, counterfeit declarations, mixed encodings, and caller coercion cannot acquire a contract', () => {
  let calls = 0; const object = { toString() { calls++; return source; }, get content() { calls++; return source; } };
  for (const text of [source + '\n', source + '# own edit\n', source.slice(0, -1), '\uFEFF\uFEFF' + source,
    source.replace('\n', '\r\n'), source.replaceAll('\n', '\r'), source.replace('Menu', '停止中'),
    source.replace('configure(title, items_json, display_mode)', 'configure(title, display_mode, items_json)'), '#@viento-menu-parameters {}\n' + source,
    '@export var action_name: String = "ui_accept"', retry, null, undefined, false, {}, [], object, new String(source), 'x'.repeat(65537)]) {
    assert.equal(has(text), false); assert.equal(discover(text), null);
  }
  assert.equal(calls, 0);
});
test('existing row review offers only missing menu defaults and preserves unknown or authored values', () => {
  const contract = discover(source), form = parameters => ({ backendId: contract.backendId, language: contract.language, parameters });
  assert.deepEqual(reviewScriptParameterRows(contract, form([])).missing, rows);
  const parameters = [{ name: 'title', type: 'string', value: '暂停菜单' }, { name: 'items_json', type: 'string', value: 'author JSON' },
    { name: 'display_mode', type: 'string', value: 'paused' }, { name: 'target_scene_id', type: 'string', value: 'keep ordinary extra' }], before = structuredClone(parameters);
  const reviewed = reviewScriptParameterRows(contract, form(parameters)); assert.deepEqual(reviewed.missing, []); assert.equal(reviewed.canAddMissing, false);
  assert.deepEqual(reviewed.unknown, [{ index: 3, name: 'target_scene_id' }]); assert.deepEqual(parameters, before);
});
test('fresh menu discovery does not instantiate WASM or fetch and preserves retry discovery', async () => {
  const discovery = new URL('../../engine/script-parameter-discovery.mjs', import.meta.url).href;
  const core = new URL('../../engine/studio-core.mjs', import.meta.url).href;
  const program = `import assert from 'node:assert/strict';let attempts=0;WebAssembly.instantiate=()=>{attempts++;throw Error('No core');};globalThis.fetch=()=>{attempts++;throw Error('No fetch');};
    const {getStudioCoreMetadata}=await import(${JSON.stringify(core)});
    const {discoverScriptParameterContract,requiresScriptParameterCore}=await import(${JSON.stringify(discovery)});
    for(const text of ${JSON.stringify(forms)}){assert.equal(requiresScriptParameterCore(text),false);assert.equal(discoverScriptParameterContract(text).parameters.length,3);}
    assert.equal(discoverScriptParameterContract(${JSON.stringify(retry)}).parameters.length,3);
    assert.equal(getStudioCoreMetadata().ready,false);assert.equal(attempts,0);`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', program]);
});
