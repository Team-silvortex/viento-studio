import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { setupSceneBehaviorParameters } from '../../web/modules/app-scene-behavior-parameters.js';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const id = '00000000-0000-4000-8000-000000000001';
const contract = (status = 'ready', extra = {}) => captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1,
  backendId: 'org.viento.godot4', language: 'gdscript', status,
  parameters: status === 'ready' ? ['clip_idle', 'clip_strike', 'clip_walk'].map(name => ({ name, type: 'string', defaultValue: '', referenceKind: 'animation-clip' })) : [], ...extra });
async function fixture(t, parameters = [{ name: 'clip_idle', type: 'string', value: id }, { name: 'clip_attack', type: 'string', value: id }]) {
  const h = await dialogHarness('app-scene-behavior-parameters'); const container = h.document.createElement('section'); h.document.body.append(container);
  let sequence = 0, language = 'zh'; const added = [], renamed = [];
  const row = (value, index) => {
    const wrapper = h.document.createElement('div'), key = h.document.createElement('input'), type = h.document.createElement('select'), input = h.document.createElement('textarea');
    key.value = value.name; type.value = value.type; input.value = value.value; wrapper.append(key, type, input); h.document.body.append(wrapper);
    return { wrapper, key, type, value: input, identity: ++sequence, index, bindingId: 'binding-one' };
  };
  const state = { session: {}, source: {}, contract: contract(), current: true, pending: false, bindingId: 'binding-one', backendId: 'org.viento.godot4', language: 'gdscript', rows: parameters.map(row) };
  const values = () => state.rows.map(item => ({ name: item.key.value, type: item.type.value, value: item.value.value }));
  const controller = setupSceneBehaviorParameters({ container, getContext: () => ({ ...state, parameters: values() }),
    translate: (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')),
    onAddMissing: (declarations, { isCurrent }) => { assert.equal(isCurrent(), true); added.push(copy(declarations)); state.rows = [...state.rows, ...declarations.map((item, index) => row({ name: item.name, type: item.type, value: String(item.defaultValue) }, state.rows.length + index))]; controller.refresh(); },
    onRename: (item, declaration, { isCurrent }) => { assert.equal(isCurrent(), true); renamed.push([item.identity, declaration.name, item.value.value]); item.key.value = declaration.name; controller.refresh(); },
  });
  t.after(() => controller.dispose());
  return { ...h, state, container, controller, added, renamed, values, row, el: suffix => h.element('sceneBehaviors' + suffix),
    select(index, name) { const select = this.el('Param' + index + 'ContractTarget'); select.value = name; select.dispatch('change'); },
    language(value) { language = value; controller.refresh(); } };
}

test('interface only advises until an explicit rename or add; empty missing slots mean full animation', async t => {
  const h = await fixture(t); const before = h.values();
  assert.match(h.el('ParameterInterfaceStatus').textContent, /缺失 2.*未声明 1/); assert.match(h.el('ParameterInterfaceNote').textContent, /留空时播放完整动画/);
  h.select(1, 'clip_strike'); assert.deepEqual(h.values(), before); assert.equal(h.renamed.length, 0);
  h.el('Param1RenameParameter').click(); assert.equal(h.values()[1].name, 'clip_strike'); assert.equal(h.values()[1].value, id); assert.equal(h.renamed.length, 1);
  h.el('AddMissingParameters').click(); assert.deepEqual(h.values()[2], { name: 'clip_walk', type: 'string', value: '' });
  assert.deepEqual(h.added[0].map(item => item.name), ['clip_walk']); assert.match(h.el('ParameterInterfaceStatus').textContent, /缺失 0.*未声明 0/);
});

test('missing targets exclude incompatible types and never overwrite an existing parameter', async t => {
  const h = await fixture(t, [{ name: 'clip_idle', type: 'number', value: '1e-' }, { name: 'legacy', type: 'number', value: '12' }]);
  assert.match(h.el('ParameterIssues').textContent, /需要 文本/); assert.equal(h.el('Param1ContractTarget').children.length, 1);
  h.select(1, 'clip_strike'); h.el('Param1RenameParameter').disabled = false; h.el('Param1RenameParameter').click(); assert.equal(h.renamed.length, 0);
  h.state.rows[1].type.value = 'string'; h.controller.refresh(); h.select(1, 'clip_idle'); h.el('Param1RenameParameter').disabled = false; h.el('Param1RenameParameter').click();
  assert.equal(h.renamed.length, 0); assert.equal(h.values()[0].value, '1e-');
});

test('duplicate names block add and rename while values remain untouched', async t => {
  const h = await fixture(t, [{ name: 'legacy', type: 'string', value: id }, { name: 'legacy', type: 'string', value: '' }]);
  assert.match(h.el('ParameterIssues').textContent, /参数名重复/); assert.equal(h.el('AddMissingParameters').disabled, true);
  h.select(0, 'clip_strike'); h.el('Param0RenameParameter').disabled = false; h.el('Param0RenameParameter').click();
  h.el('AddMissingParameters').disabled = false; h.el('AddMissingParameters').click(); assert.equal(h.added.length, 0); assert.equal(h.renamed.length, 0);
  assert.equal(h.values()[0].value, id); assert.equal(h.values()[1].value, '');
});

test('invalid clip strings are hints and empty values remain valid without trimming or replacement', async t => {
  const h = await fixture(t, [{ name: 'clip_idle', type: 'string', value: ' ' + id }, { name: 'clip_strike', type: 'string', value: '' }]);
  assert.match(h.el('ParameterInterfaceStatus').textContent, /无效编号 1/); assert.match(h.el('ParameterIssues').textContent, /完整的小写片段 UUID/);
  assert.equal(h.values()[0].value, ' ' + id); assert.equal(h.values()[1].value, ''); assert.equal(h.added.length, 0);
});

test('unavailable, modified, unsupported, incompatible and absent interfaces preserve ordinary rows', async t => {
  const h = await fixture(t); const before = h.values();
  for (const status of ['modified', 'unsupported', 'unavailable']) {
    h.state.contract = contract(status); h.controller.refresh(); assert.equal(h.container.dataset.status, status);
    assert.match(h.el('ParameterInterfaceStatus').textContent, /普通参数编辑仍可使用/); assert.equal(h.el('AddMissingParameters').disabled, true); assert.deepEqual(h.values(), before);
  }
  h.state.contract = contract(); h.state.backendId = 'org.viento.bevy-rust'; h.state.language = 'rust'; h.controller.refresh(); assert.equal(h.container.dataset.status, 'incompatible');
  h.state.contract = undefined; h.controller.refresh(); assert.equal(h.container.hidden, true); assert.deepEqual(h.values(), before);
});

test('source, binding, row identity and contract withdrawal invalidate old action buttons', async t => {
  for (const change of [h => h.state.source = {}, h => h.state.bindingId = 'binding-two', h => h.state.rows = [...h.state.rows],
    h => { h.state.contract = undefined; h.controller.refresh(); h.state.contract = contract(); }, h => { h.state.current = false; h.controller.refresh(); h.state.current = true; }]) {
    const h = await fixture(t); h.select(1, 'clip_strike'); const oldAdd = h.el('AddMissingParameters'), oldRename = h.el('Param1RenameParameter');
    change(h); h.controller.refresh(); oldAdd.disabled = false; oldRename.disabled = false; oldAdd.click(); oldRename.click();
    assert.equal(h.added.length, 0); assert.equal(h.renamed.length, 0); assert.equal(h.values()[1].name, 'clip_attack');
  }
});

test('pending checks disable helper mutations; changing row names before click cannot reuse a stale selection', async t => {
  const h = await fixture(t); h.select(1, 'clip_strike'); const rename = h.el('Param1RenameParameter');
  h.state.pending = true; h.controller.refresh(); rename.disabled = false; rename.click(); assert.equal(h.renamed.length, 0);
  h.state.pending = false; h.controller.refresh(); h.state.rows[0].key.value = 'clip_strike'; rename.disabled = false; rename.click();
  assert.equal(h.renamed.length, 0); assert.equal(h.values()[1].value, id);
});

test('language refresh keeps values, pending selection, focused row and caret positions', async t => {
  const h = await fixture(t); h.select(1, 'clip_strike'); const value = h.state.rows[1].value, select = h.el('Param1ContractTarget');
  value.focus(); value.selectionStart = 2; value.selectionEnd = 12; const before = h.values();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.document.activeElement, value); assert.equal(value.selectionStart, 2); assert.equal(value.selectionEnd, 12);
    assert.equal(h.el('Param1ContractTarget'), select); assert.equal(select.value, 'clip_strike'); assert.deepEqual(h.values(), before);
  }
  assert.equal(h.added.length, 0); assert.equal(h.renamed.length, 0);
});

test('32-row budget keeps all existing values and disables bulk add', async t => {
  const parameters = Array.from({ length: 32 }, (_, index) => ({ name: 'legacy_' + index, type: 'string', value: String(index) }));
  const h = await fixture(t, parameters); assert.equal(h.el('AddMissingParameters').disabled, true); h.el('AddMissingParameters').disabled = false; h.el('AddMissingParameters').click();
  assert.equal(h.added.length, 0); assert.deepEqual(h.values(), parameters);
});

test('all parameter interface messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-behavior-parameters.js', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) { assert.ok(en[match[1]], `English: ${match[1]}`); assert.ok(ja[match[1]], `Japanese: ${match[1]}`); }
});
