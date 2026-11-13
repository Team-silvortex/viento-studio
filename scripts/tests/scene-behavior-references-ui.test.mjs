import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { setupSceneBehaviorReferences } from '../../web/modules/app-scene-behavior-references.js';
import { captureSceneBehaviorReferences } from '../../engine/scene-behavior-reference-directory.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/level.json', sourceRevision: revision('scene') });
const named = (n, name, sourcePath) => ({ objectId: id(n), name, sourcePath, sourceRevision: revision(sourcePath) });
function source() {
  const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(3), instanceId: id(8),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(9) }, parameters: { arbitrary: 'old' }, events: [] }] });
  return { sourcePath: 'documents/behaviors/level.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content };
}
function directory(inputSource, assemblyObjectId = null, change = () => {}, sourceChange = value => value) {
  const assemblies = [named(20, '主线 / Main <b>', 'documents/projects/main.json'), named(21, '练习 / Practice', 'documents/projects/practice.json')];
  const raw = { format: 'viento-scene-behavior-reference-directory', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('directory'), scene: scene(),
    instances: [8, 10].map(instance => ({ instanceId: id(instance), ...named(11, '保存 {0} <b>', 'documents/definitions/player.md') })), assemblies,
    selectedAssembly: assemblyObjectId ? { ...assemblies.find(item => item.objectId === assemblyObjectId),
      members: [{ ...scene(), name: '当前关卡' }, named(2, '结果页 <b>', 'documents/scenes/result.json')],
      inputMap: { objectId: id(30), sourcePath: 'documents/inputs/keyboard.json', sourceRevision: revision('input') },
      actions: [{ name: 'start_retry', keys: ['Enter', 'Space'] }, { name: 'interact', keys: ['KeyE'] }] } : null };
  change(raw);
  return captureSceneBehaviorReferences(sourceChange(inputSource), raw, raw.scene);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, options = {}) {
  const h = await dialogHarness('app-scene-behavior-references'), container = h.document.createElement('section'); h.document.body.append(container);
  let language = 'zh', rowSequence = 0; const reads = [], applied = [];
  function row(name, value = 'old', type = 'string', index = 0) {
    const wrapper = h.document.createElement('div'), key = h.document.createElement('input'), typeInput = h.document.createElement('select'), input = h.document.createElement('textarea');
    key.value = name; typeInput.value = type; input.value = value; wrapper.append(key, typeInput, input); h.document.body.append(wrapper);
    return { wrapper, key, type: typeInput, value: input, identity: ++rowSequence, index, bindingId: id(3) };
  }
  const state = { available: true, current: true, pending: false, source: source(), scene: scene(), bindingId: id(3), sourceObjectId: id(9), instanceId: id(8),
    rows: [row('arbitrary'), row('incomplete', '1e-', 'number', 1), row('second_text', 'keep', 'string', 2)], ...options.context };
  const values = () => state.rows.map(item => ({ name: item.key.value, type: item.type.value, value: item.value.value }));
  const controller = setupSceneBehaviorReferences({ container, getContext: () => state,
    ...(options.noPort ? {} : { getReferences: async (inputSource, request) => {
      reads.push({ source: copy(inputSource), request: copy(request) });
      return options.read ? options.read(inputSource, request, reads.length) : directory(inputSource, request.assemblyObjectId);
    } }),
    translate: (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? '')),
    onUse: (target, value) => { applied.push({ target, value }); target.value.value = value; options.onUse?.(target, value); controller.refresh(); } });
  t.after(() => controller.dispose());
  const el = suffix => container.querySelector('#sceneBehaviorsReferences' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const select = (suffix, value) => { const element = el(suffix); element.value = value; element.dispatch('change'); };
  return { ...h, state, row, values, controller, container, el, reads, applied, settle, select,
    async load() { el('Load').click(); await settle(); },
    async assembly(value) { select('Assembly', value); await settle(); },
    choose(kind, value, name = 'arbitrary') {
      select('Kind', kind); select('Choice', value);
      const target = el('Parameter').children.find(option => option.textContent.endsWith(' · ' + name)); assert.ok(target, name); select('Parameter', target.value);
    },
    async use() { el('Use').click(); await settle(); },
    language(value) { language = value; controller.refresh(); } };
}

test('reference helper is optional and unavailable capability never affects ordinary parameter rows', async t => {
  for (const settings of [{ noPort: true }, { context: { available: false } }, { context: { current: false } }]) {
    const h = await fixture(t, settings), before = h.values(); assert.equal(h.container.hidden, true); assert.equal(h.container.children.length, 0);
    assert.equal(h.reads.length, 0); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before);
  }
});

test('load offers named local instances but requires an explicit assembly even when there is only one', async t => {
  for (const count of [0, 1, 2]) {
    const h = await fixture(t, { read: (s, request) => directory(s, request.assemblyObjectId, raw => { raw.assemblies = raw.assemblies.slice(0, count); }) }), before = h.values();
    await h.load(); assert.deepEqual(h.reads[0].request, { assemblyObjectId: null }); assert.equal(h.el('Assembly').value, '');
    assert.equal(h.el('Assembly').children.length, count + 1); assert.equal(h.el('Choice').children.length, 3);
    assert.ok(h.el('Choice').children[1].textContent.includes('保存 {0} <b>')); assert.equal(h.container.querySelector('b'), null);
    assert.ok(h.el('Choice').children[1].textContent.includes(id(8))); h.select('Choice', id(8)); assert.ok(h.el('Detail').textContent.includes(id(11))); assert.ok(h.el('Detail').textContent.includes('documents/definitions/player.md')); assert.ok(h.el('Choice').children[2].textContent.includes(id(10)));
    assert.equal(h.el('Parameter').children.length, 3, 'only two String rows, never the unfinished number');
    assert.equal(h.el('Use').disabled, true); assert.deepEqual(h.values(), before); assert.equal(h.applied.length, 0);
  }
});

test('members and actions are scoped to the explicitly loaded assembly and selection alone never inserts', async t => {
  const h = await fixture(t), before = h.values(); await h.load();
  for (const kind of ['scene', 'action']) { h.select('Kind', kind); assert.equal(h.el('Choice').children.length, 1); assert.match(h.el('Status').textContent, /请选择项目组装/); }
  await h.assembly(id(20)); assert.deepEqual(h.reads[1].request, { assemblyObjectId: id(20) }); assert.equal(h.el('Assembly').value, id(20));
  h.select('Kind', 'scene'); assert.deepEqual(h.el('Choice').children.map(option => option.value), ['', id(1), id(2)]);
  h.select('Choice', id(2)); assert.ok(h.el('Detail').textContent.includes('documents/scenes/result.json'));
  h.select('Kind', 'action'); assert.deepEqual(h.el('Choice').children.map(option => option.value), ['', 'start_retry', 'interact']);
  assert.ok(h.el('Choice').children[1].textContent.includes('Enter / Space')); assert.ok(!h.el('Choice').children.some(option => option.value.startsWith('ui_')));
  h.select('Choice', 'start_retry'); assert.ok(h.el('Detail').textContent.includes('documents/inputs/keyboard.json'));
  assert.deepEqual(h.values(), before); assert.equal(h.applied.length, 0);
});

test('explicit insertion re-reads the scoped catalog and changes only the chosen String row', async t => {
  for (const [kind, value, assembly] of [['instance', id(8), null], ['scene', id(2), id(20)], ['action', 'start_retry', id(20)]]) {
    const h = await fixture(t), before = h.values(); await h.load(); if (assembly) await h.assembly(assembly);
    h.choose(kind, value, 'second_text'); assert.equal(h.el('Use').disabled, false); const beforeReads = h.reads.length;
    await h.use(); assert.equal(h.reads.length, beforeReads + 1); assert.deepEqual(h.reads.at(-1).request, { assemblyObjectId: assembly });
    assert.equal(h.applied.length, 1); assert.equal(h.applied[0].target, h.state.rows[2]); assert.equal(h.applied[0].value, value);
    assert.deepEqual(h.values(), [before[0], before[1], { ...before[2], value }]);
  }
});

test('a missing input map gives an explicit empty action view while manual text and local instances stay usable', async t => {
  const h = await fixture(t, { read: (s, request) => directory(s, request.assemblyObjectId, raw => {
    if (raw.selectedAssembly) { raw.selectedAssembly.inputMap = null; raw.selectedAssembly.actions = []; }
  }) });
  await h.load(); await h.assembly(id(20)); h.select('Kind', 'action');
  assert.equal(h.el('Choice').children.length, 1); assert.match(h.el('Status').textContent, /未声明输入映射/);
  h.state.rows[0].value.value = 'ui_accept'; h.controller.refresh(); assert.equal(h.state.rows[0].value.value, 'ui_accept');
  h.choose('instance', id(8)); await h.use(); assert.equal(h.applied.length, 1);
});

test('stale, forged, mismatched and failed revalidation never inserts or modifies existing values', async t => {
  for (const mode of ['revision', 'content', 'missing', 'forged', 'source', 'scene', 'failure']) {
    const h = await fixture(t, { read: (s, request, count) => {
      if (count === 1) return directory(s, request.assemblyObjectId);
      if (mode === 'failure') throw Error('offline');
      if (mode === 'forged') return copy(directory(s, request.assemblyObjectId));
      return directory(s, request.assemblyObjectId, raw => {
        if (mode === 'revision') raw.revision = revision('changed');
        if (mode === 'content') raw.instances[0].name = raw.instances[1].name = 'renamed with same revision';
        if (mode === 'missing') raw.instances = raw.instances.slice(1);
        if (mode === 'scene') raw.scene.sourceRevision = revision('another scene');
      }, value => mode === 'source' ? { ...value, token: 'another-source' } : value);
    } });
    const before = h.values(); await h.load(); h.choose('instance', id(8)); await h.use();
    assert.equal(h.applied.length, 0, mode); assert.deepEqual(h.values(), before, mode); assert.equal(h.el('Use').disabled, true, mode);
    assert.match(h.el('Status').textContent, /重新读取|无法读取/, mode);
  }
});

test('every source, binding, row and value change during insertion revokes the pending operation', async t => {
  const changes = [
    h => { h.state.source = { ...h.state.source }; }, h => { h.state.source = { ...h.state.source, token: 'next-source' }; },
    h => { h.state.scene = { ...h.state.scene, sourceRevision: revision('new scene') }; },
    h => { h.state.bindingId = id(99); }, h => { h.state.sourceObjectId = id(98); }, h => { h.state.instanceId = id(97); },
    h => { h.state.rows = [...h.state.rows]; }, h => { h.state.rows[0] = h.row('replacement'); },
    h => { h.state.rows[0].identity++; }, h => { h.state.rows[0].bindingId = id(96); },
    h => { h.state.rows[0].key.value = 'renamed'; }, h => { h.state.rows[0].value.value = 'typed while loading'; },
    h => { h.state.rows[0].type.value = 'number'; }, h => { h.state.rows[0].wrapper.remove(); },
    h => { h.state.available = false; }, h => { h.state.current = false; }, h => { h.state.pending = true; },
  ];
  for (const [index, change] of changes.entries()) {
    const wait = deferred(); let saved;
    const h = await fixture(t, { read: (s, request, count) => {
      const result = directory(s, request.assemblyObjectId); if (count === 1) return result; saved = result; return wait.promise;
    } });
    await h.load(); h.choose('instance', id(8)); h.el('Use').click(); await h.settle(); assert.ok(saved);
    change(h); const afterChange = h.values(); h.controller.refresh(); wait.resolve(saved); await h.settle();
    assert.equal(h.applied.length, 0, String(index)); assert.deepEqual(h.values(), afterChange, String(index));
    if (h.el('Status')) assert.ok(!h.el('Status').textContent.includes('正在重新核对'), String(index));
  }
});

test('observing an ordinary check pending and then ready cancels earlier helper reads and insertion', async t => {
  for (const phase of ['load', 'insert']) {
    const wait = deferred(); let saved;
    const h = await fixture(t, { read: (s, request, count) => {
      const result = directory(s, request.assemblyObjectId);
      if (phase === 'insert' && count === 1) return result;
      saved = result; return wait.promise;
    } });
    if (phase === 'load') h.el('Load').click();
    else { await h.load(); h.choose('instance', id(8)); h.el('Use').click(); }
    await h.settle(); assert.ok(saved); const before = h.values();
    h.state.pending = true; h.controller.refresh(); h.state.pending = false; h.controller.refresh();
    wait.resolve(saved); await h.settle();
    assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before); assert.equal(h.container.getAttribute('aria-busy'), 'false');
    assert.match(h.el('Status').textContent, /已失效/); assert.ok(!h.el('Status').textContent.includes('正在'));
    if (phase === 'load') assert.equal(h.el('Choice').children.length, 1);
  }
});

test('silently editing a target value during revalidation ends with a stale hint and keeps that text', async t => {
  const wait = deferred(); let saved;
  const h = await fixture(t, { read: (s, request, count) => {
    const result = directory(s, request.assemblyObjectId); if (count === 1) return result; saved = result; return wait.promise;
  } });
  await h.load(); h.choose('instance', id(8)); h.el('Use').click(); await h.settle();
  h.state.rows[0].value.value = 'new manual text'; wait.resolve(saved); await h.settle();
  assert.equal(h.applied.length, 0); assert.equal(h.state.rows[0].value.value, 'new manual text');
  assert.match(h.el('Status').textContent, /已失效/); assert.equal(h.container.getAttribute('aria-busy'), 'false');
});

test('late loads cannot populate a reset, closed, changed binding or disposed panel', async t => {
  for (const mode of ['reset', 'closed', 'binding', 'disposed']) {
    const wait = deferred(); let saved;
    const h = await fixture(t, { read: (s, request) => { saved = directory(s, request.assemblyObjectId); return wait.promise; } });
    const oldLoad = h.el('Load'); oldLoad.click(); await h.settle();
    if (mode === 'reset') { h.controller.reset(); h.controller.refresh(); }
    if (mode === 'closed') { h.state.current = false; h.controller.refresh(); h.state.current = true; h.controller.refresh(); }
    if (mode === 'binding') { h.state.bindingId = id(99); h.controller.refresh(); }
    if (mode === 'disposed') h.controller.dispose();
    wait.resolve(saved); await h.settle(); assert.equal(h.applied.length, 0);
    if (mode !== 'disposed') { assert.equal(h.el('Choice').children.length, 1); assert.equal(h.el('Assembly').children.length, 1); }
    if (mode === 'reset' || mode === 'closed' || mode === 'disposed') { const count = h.reads.length; oldLoad.disabled = false; oldLoad.click(); await h.settle(); assert.equal(h.reads.length, count); }
  }
});

test('silent or forged selections cannot insert values and pending reads do not disable ordinary row editing', async t => {
  for (const field of ['Assembly', 'Kind', 'Choice', 'Parameter']) {
    const h = await fixture(t); await h.load(); h.choose('instance', id(8));
    h.el(field).value = field === 'Choice' ? id(10) : 'forged'; h.el('Use').disabled = false; await h.use();
    assert.equal(h.applied.length, 0); assert.equal(h.reads.length, 1);
  }
  const wait = deferred(); const h = await fixture(t, { read: (s, request) => wait.promise }); h.el('Load').click(); await h.settle();
  assert.equal(h.state.rows[0].value.disabled, false); h.state.rows[0].value.value = 'still editable';
  h.el('Load').disabled = false; h.el('Load').click(); await h.settle(); assert.equal(h.reads.length, 1);
  wait.resolve(directory(h.state.source)); await h.settle(); assert.equal(h.state.rows[0].value.value, 'still editable');
});

test('failed refresh disables old choices and permits retry without touching text or review', async t => {
  const h = await fixture(t, { read: (s, request, count) => { if (count === 2) throw Error('offline'); return directory(s, request.assemblyObjectId); } });
  await h.load(); h.choose('instance', id(8)); const before = h.values(); await h.load();
  assert.equal(h.el('Choice').children.length, 1); assert.equal(h.el('Use').disabled, true); assert.deepEqual(h.values(), before);
  await h.load(); h.choose('instance', id(8)); await h.use(); assert.equal(h.applied.length, 1);
});

test('language refresh preserves names, references, destination, incomplete input and focus', async t => {
  const h = await fixture(t); await h.load(); await h.assembly(id(20)); h.choose('action', 'start_retry');
  const input = h.state.rows[1].value; input.focus(); input.selectionStart = 1; input.selectionEnd = 3;
  const parameter = h.el('Parameter').value, controls = ['Assembly', 'Kind', 'Choice', 'Parameter'].map(key => h.el(key)), before = h.values();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.deepEqual(h.values(), before); assert.equal(h.document.activeElement, input);
    assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 3); assert.equal(h.el('Parameter').value, parameter);
    assert.equal(h.el('Choice').value, 'start_retry'); assert.deepEqual(['Assembly', 'Kind', 'Choice', 'Parameter'].map(key => h.el(key)), controls);
    assert.ok(h.el('Assembly').children[1].textContent.includes('主线 / Main <b>')); assert.equal(h.container.querySelector('b'), null);
  }
  assert.equal(h.applied.length, 0); assert.equal(h.reads.length, 2);
});

test('all fixed reference helper messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-behavior-references.js', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) {
    assert.equal(typeof en[match[1]], 'string', 'English: ' + match[1]); assert.equal(typeof ja[match[1]], 'string', 'Japanese: ' + match[1]);
  }
});
