import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hasScriptParameterDeclaration, requiresScriptParameterCore, discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
import { DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/godot-animation-state-script.mjs';
const exec = promisify(execFile);
const table = { initialState: 'idle', states: [{ key: 'idle' }, { key: 'constructor' }], transitions: [{ from: 'idle', to: 'constructor', trigger: { kind: 'event', name: 'go' } }] };
const generated = () => generateEditableGodotAnimationStateScript(table).content;
const prefix = '# Viento animation state script\n#@viento-animation-state-script ';
function header(content, change) { const end = content.indexOf('\n', prefix.length), parsed = JSON.parse(content.slice(prefix.length, end)); change(parsed); return prefix + JSON.stringify(parsed) + content.slice(end); }

test('discovery only recognizes complete fixed-body same-source declarations', () => {
  const source = generated();
  for (const content of [source, '\ufeff' + source, source.replaceAll('\n', '\r\n')]) {
    const result = discoverScriptParameterContract(content); assert.equal(result.status, 'ready');
    assert.equal(result.backendId, 'org.viento.godot4'); assert.equal(result.language, 'gdscript');
    assert.deepEqual(result.parameters, ['clip_idle', 'clip_constructor'].map(name => ({ name, type: 'string', defaultValue: '', referenceKind: 'animation-clip' })));
    assert.ok(Object.isFrozen(result.parameters[0])); assert.equal(JSON.stringify(result).includes('extends Node'), false);
  }
  for (const content of [DEFAULT_GODOT_ANIMATION_STATE_SCRIPT, '@export var clip_idle: String = ""\n', 'pub struct MyParameters {}', '# no known declaration', 'unrelated\n' + source, null]) assert.equal(discoverScriptParameterContract(content), null);
});
test('modified malformed and unsupported sources give non-actionable statuses without exposing code', () => {
  const source = generated();
  for (const content of [source + '\n# handwritten secret\n', source.replace('@export var clip_idle', '@export var clip_changed'), source.replace('"initialState":"idle"', '"initialState":"absent"'), prefix + '{}\n']) {
    const result = discoverScriptParameterContract(content); assert.equal(result.status, 'modified'); assert.deepEqual(result.parameters, []); assert.equal(JSON.stringify(result).includes('handwritten'), false);
  }
  for (const change of [value => { value.schemaVersion = 2; }, value => { value.generator = 'future-generator'; }]) {
    const result = discoverScriptParameterContract(header(source, change)); assert.equal(result.status, 'unsupported'); assert.deepEqual(result.parameters, []);
  }
});
test('optional core absence never falls back to textual export inference', async () => {
  const discovery = new URL('../../engine/script-parameter-discovery.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';import {discoverScriptParameterContract} from ${JSON.stringify(discovery)};const value=discoverScriptParameterContract(${JSON.stringify(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT)});assert.equal(value.status,'unavailable');assert.deepEqual(value.parameters,[]);assert.equal(discoverScriptParameterContract('@export var clip_idle: String = ""'),null);`;
  await exec(process.execPath, ['--input-type=module', '-e', script]);
});
test('retry source participates in discovery without scheduling the optional animation core', () => {
  for (const content of [GODOT_ACTION_SCENE_RETRY_SCRIPT, '\uFEFF' + GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('\n', '\r\n')]) {
    assert.equal(hasScriptParameterDeclaration(content), true); assert.equal(requiresScriptParameterCore(content), false);
    const contract = discoverScriptParameterContract(content); assert.equal(contract.status, 'ready');
    assert.deepEqual(contract.parameters, [
      { name: 'action_name', type: 'string', defaultValue: 'ui_accept', referenceKind: '' },
      { name: 'target_scene_id', type: 'string', defaultValue: '', referenceKind: '' },
      { name: 'state_values_json', type: 'string', defaultValue: '{"score":0,"health":100}', referenceKind: '' },
    ]);
  }
  const animation = generated(); assert.equal(hasScriptParameterDeclaration(animation), true); assert.equal(requiresScriptParameterCore(animation), true);
  assert.equal(requiresScriptParameterCore(prefix + '{}\n'), true, 'malformed animation candidates keep their established status path');
  for (const content of [null, GODOT_ACTION_SCENE_RETRY_SCRIPT + '\n# own source\n', GODOT_ACTION_SCENE_RETRY_SCRIPT.replace('"health":100', '"health":3'),
    '@export var action_name: String = "ui_accept"', '#@viento-retry-parameters {"schemaVersion":2}\n' + GODOT_ACTION_SCENE_RETRY_SCRIPT]) {
    assert.equal(hasScriptParameterDeclaration(content), false); assert.equal(requiresScriptParameterCore(content), false); assert.equal(discoverScriptParameterContract(content), null);
  }
});
test('fresh discovery keeps retry ready with no core while animation remains unavailable without textual inference', async () => {
  const discovery = new URL('../../engine/script-parameter-discovery.mjs', import.meta.url).href;
  const retry = new URL('../../engine/godot-scene-retry-script.mjs', import.meta.url).href;
  const animation = new URL('../../engine/animation-state-script-source.mjs', import.meta.url).href;
  const core = new URL('../../engine/studio-core.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';
    let attempted=0; WebAssembly.instantiate=()=>{attempted++;throw Error('No optional core in this child.');};
    globalThis.fetch=()=>{attempted++;throw Error('No network loader in this child.');};
    const {getStudioCoreMetadata}=await import(${JSON.stringify(core)});
    const {hasScriptParameterDeclaration,requiresScriptParameterCore,discoverScriptParameterContract}=await import(${JSON.stringify(discovery)});
    const {GODOT_ACTION_SCENE_RETRY_SCRIPT:retry}=await import(${JSON.stringify(retry)});
    const {DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT:animation}=await import(${JSON.stringify(animation)});
    assert.equal(getStudioCoreMetadata().ready,false);
    for(const content of [retry,'\\uFEFF'+retry.replaceAll('\\n','\\r\\n')]){
      assert.equal(hasScriptParameterDeclaration(content),true);assert.equal(requiresScriptParameterCore(content),false);
      const result=discoverScriptParameterContract(content);assert.equal(result.status,'ready');assert.equal(result.parameters.length,3);
      assert.equal(result.parameters[2].defaultValue,'{"score":0,"health":100}');
    }
    assert.equal(requiresScriptParameterCore(animation),true);assert.equal(discoverScriptParameterContract(animation).status,'unavailable');
    assert.equal(discoverScriptParameterContract('@export var action_name: String = "ui_accept"'),null);
    assert.equal(getStudioCoreMetadata().ready,false);assert.equal(attempted,0);`;
  await exec(process.execPath, ['--input-type=module', '-e', script]);
});
