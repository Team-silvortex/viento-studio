import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
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
