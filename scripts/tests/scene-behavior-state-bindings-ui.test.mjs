import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { setupSceneBehaviorStateBindings } from '../../web/modules/app-scene-behavior-state-bindings.js';
import { captureAnimationStateBindings } from '../../engine/animation-state-bindings.mjs';
import { captureSceneBehaviorAnimationClips } from '../../engine/scene-animation-directory.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const row = (name, value = '', type = 'string') => ({ name, type, value });
const declaration = () => captureAnimationStateBindings({ format: 'viento-animation-state-bindings', schemaVersion: 1, initialState: 'idle',
  states: [{ stateKey: 'idle', parameterName: 'clip_idle', hasCompletion: false }, { stateKey: 'action', parameterName: 'clip_action', hasCompletion: true }] });
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: hash('scene') });
function source() {
  const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(3), instanceId: id(8),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(9) }, parameters: {}, events: [] }] });
  return { sourcePath: 'documents/behaviors/main.json', token: 'source:1', baseSourceRevision: hash(content), sourceRevision: hash(content), content };
}
function directory(inputSource, { empty = false, change = () => {}, sourceChange = value => value, sceneChange = value => value } = {}) {
  const animation = { format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: true,
    tracks: [{ id: id(10), instanceId: id(8), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }],
    clips: [{ id: id(5), name: '待機 <b> / Idle', startSeconds: .25, endSeconds: 1, loop: true },
      { id: id(4), name: '攻撃 / Attack', startSeconds: .5, endSeconds: 2, loop: false }] };
  change(animation); const savedScene = sceneChange(scene()), content = JSON.stringify(animation);
  return captureSceneBehaviorAnimationClips(sourceChange(inputSource), { format: 'viento-scene-animation-directory', schemaVersion: 1,
    status: empty ? 'empty' : 'ready', worldId: 'world:' + 'a'.repeat(64), revision: hash('world'), scene: savedScene,
    manifest: empty ? null : { objectId: id(2), sourcePath: 'documents/animations/main.json', sourceRevision: hash(content), content } }, savedScene);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, options = {}) {
  const h = await dialogHarness('app-scene-behavior-parameters'), container = h.document.createElement('section'); h.document.body.append(container);
  let language = 'zh'; const reads = [], applied = [], guards = [];
  const state = { session: {}, source: source(), script: {}, declaration: declaration(), bindingId: id(3), instanceId: id(8), rows: [],
    parameters: structuredClone(options.parameters || [row('unrelated', 'keep')]), scene: scene(), current: true, available: true, pending: false,
    backendId: 'org.viento.godot4', language: 'gdscript', ...options.context };
  const controller = setupSceneBehaviorStateBindings({ container, getContext: () => state,
    ...(options.noPort ? {} : { getAnimationClips: async source => { reads.push(source); return options.read ? options.read(source, reads.length) : directory(source); } }),
    translate: (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? '')),
    onApply: (parameters, { isCurrent }) => {
      assert.equal(isCurrent(), true); applied.push(structuredClone(parameters)); guards.push(isCurrent);
      if (options.apply) options.apply(parameters, { isCurrent, state });
      else { state.parameters = structuredClone(parameters); state.rows = []; controller.refresh(); }
    } });
  t.after(() => controller.dispose());
  const settle = async () => { await flushDialogs(); await flushDialogs(); };
  const el = suffix => container.querySelector('#sceneBehaviorsStateBindings' + suffix), select = key => container.querySelector('#sceneBehaviorsStateBinding_' + key);
  return { ...h, state, controller, container, reads, applied, guards, settle, el, select,
    async load() { el('Load').click(); await settle(); },
    choose(key, value) { const picker = select(key); assert.ok(picker); picker.value = value; picker.dispatch('change'); },
    async apply() { el('Apply').click(); await settle(); },
    language(value) { language = value; controller.refresh(); } };
}

test('load and choices are local until explicit Apply revalidates the saved directory then returns merged rows', async t => {
  const h = await fixture(t); const original = structuredClone(h.state.parameters); assert.equal(h.select('idle'), null);
  await h.load(); assert.equal(h.reads.length, 1); assert.deepEqual(h.state.parameters, original); assert.equal(h.applied.length, 0);
  h.choose('idle', id(5)); h.choose('action', id(4)); assert.deepEqual(h.state.parameters, original); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.container.querySelectorAll('b').length, 0); assert.match(h.select('idle').textContent, /<b>/);
  await h.apply(); assert.equal(h.reads.length, 2); assert.equal(h.applied.length, 1);
  assert.deepEqual(h.applied[0], [...original, row('clip_idle', id(5)), row('clip_action', id(4))]); assert.equal(h.guards[0](), false);
});
test('reset choices restores current parameter values without applying or reading again', async t => {
  const parameters = [row('clip_idle', id(5)), row('clip_action', id(4))], h = await fixture(t, { parameters });
  await h.load(); assert.equal(h.el('Apply').disabled, true); h.choose('action', ''); assert.equal(h.el('Apply').disabled, false);
  h.el('Reset').click(); assert.equal(h.select('action').value, id(4)); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0); assert.deepEqual(h.state.parameters, parameters);
});
test('Apply checks new source revision and refuses changed, unavailable, forged or wrong-source catalogs atomically', async t => {
  for (const mode of ['changed', 'empty', 'forged', 'source', 'scene']) {
    const h = await fixture(t, { read: (source, count) => {
      if (count === 1) return directory(source);
      if (mode === 'changed') return directory(source, { change: value => { value.clips[0].name = 'renamed'; } });
      if (mode === 'empty') return directory(source, { empty: true });
      if (mode === 'forged') return structuredClone(directory(source));
      if (mode === 'source') return directory(source, { sourceChange: value => ({ ...value, token: 'another-source' }) });
      return directory(source, { sceneChange: value => ({ ...value, sourceRevision: hash('other scene') }) });
    } });
    await h.load(); h.choose('idle', id(5)); const before = structuredClone(h.state.parameters); await h.apply();
    assert.equal(h.applied.length, 0, mode); assert.deepEqual(h.state.parameters, before, mode); assert.equal(h.select('idle'), null, mode);
    assert.match(h.el('Status').textContent, /已变化/, mode); assert.equal(h.container.getAttribute('aria-busy'), 'false');
  }
});
test('failed Apply read preserves local selections and original rows for explicit retry', async t => {
  const h = await fixture(t, { read: (source, count) => { if (count === 2) throw Error('read failed'); return directory(source); } });
  await h.load(); h.choose('idle', id(5)); h.choose('action', id(4)); const original = structuredClone(h.state.parameters); await h.apply();
  assert.equal(h.applied.length, 0); assert.deepEqual(h.state.parameters, original); assert.equal(h.select('idle').value, id(5)); assert.equal(h.el('Apply').disabled, false);
  assert.match(h.el('Status').textContent, /无法复核/); await h.apply(); assert.equal(h.applied.length, 1); assert.equal(h.reads.length, 3);
});
test('loading locks Apply and selection actions, and duplicate forced clicks cannot start a second request', async t => {
  const gate = deferred(), h = await fixture(t, { read: (source, count) => count === 1 ? directory(source) : gate.promise });
  await h.load(); h.choose('idle', id(5)); const apply = h.el('Apply'), picker = h.select('idle'); apply.click(); await h.settle();
  assert.equal(h.reads.length, 2); assert.equal(apply.disabled, true); assert.equal(picker.disabled, true); apply.dispatch('click');
  picker.value = id(4); picker.dispatch('change'); assert.equal(h.reads.length, 2); gate.resolve(directory(h.reads[1])); await h.settle();
  assert.equal(h.applied.length, 1); assert.equal(h.applied[0].find(row => row.name === 'clip_idle').value, id(5));
});
test('all binding owner changes invalidate a late Apply and old buttons without applying to another form', async t => {
  const changes = { binding: h => { h.state.bindingId = id(99); }, instance: h => { h.state.instanceId = id(99); },
    script: h => { h.state.script = {}; }, declaration: h => { h.state.declaration = declaration(); }, rows: h => { h.state.rows = []; },
    parameters: h => { h.state.parameters[0].value = 'new text'; }, source: h => { h.state.source = { ...h.state.source, token: 'new' }; },
    session: h => { h.state.session = {}; }, current: h => { h.state.current = false; }, available: h => { h.state.available = false; } };
  for (const [name, change] of Object.entries(changes)) {
    const gate = deferred(), h = await fixture(t, { read: (source, count) => count === 1 ? directory(source) : gate.promise });
    await h.load(); h.choose('idle', id(5)); const oldApply = h.el('Apply'); oldApply.click(); await h.settle();
    change(h); const before = structuredClone(h.state.parameters); h.controller.refresh(); oldApply.dispatch('click');
    gate.resolve(directory(h.reads[1])); await h.settle(); assert.equal(h.applied.length, 0, name); assert.deepEqual(h.state.parameters, before, name);
  }
});
test('late first directory reads cannot enter a replaced binding or survive reset/dispose', async t => {
  for (const mode of ['binding', 'reset', 'dispose']) {
    const gate = deferred(), h = await fixture(t, { read: () => gate.promise }); h.el('Load').click(); await h.settle();
    if (mode === 'binding') { h.state.bindingId = id(99); h.controller.refresh(); }
    if (mode === 'reset') { h.controller.reset(); h.controller.refresh(); }
    if (mode === 'dispose') h.controller.dispose();
    gate.resolve(directory(h.reads[0])); await h.settle(); assert.equal(h.select('idle'), null, mode); assert.equal(h.applied.length, 0, mode);
  }
});
test('observed pending during Apply permanently cancels that request even after pending clears', async t => {
  const gate = deferred(), h = await fixture(t, { read: (source, count) => count === 1 ? directory(source) : gate.promise });
  await h.load(); h.choose('idle', id(5)); h.el('Apply').click(); await h.settle();
  h.state.pending = true; h.controller.refresh(); h.state.pending = false; h.controller.refresh();
  gate.resolve(directory(h.reads[1])); await h.settle(); assert.equal(h.applied.length, 0);
});
test('an old action observing withdrawn authority cannot revive when the same context identities return', async t => {
  for (const key of ['current', 'available', 'source']) {
    const h = await fixture(t); await h.load(); h.choose('idle', id(5)); const old = h.el('Apply'), previous = h.state[key];
    h.state[key] = key === 'source' ? { ...previous, token: 'withdrawn' } : false; old.dispatch('click');
    h.state[key] = previous; old.dispatch('click'); await h.settle(); assert.equal(h.applied.length, 0, key); assert.equal(h.reads.length, 1, key);
  }
});
test('pending blocks forced actions and incomplete or unavailable host contexts hide the helper', async t => {
  for (const options of [{ noPort: true }, { context: { declaration: null } }, { context: { current: false } }, { context: { available: false } },
    { context: { backendId: 'org.viento.bevy-rust', language: 'rust' } }]) {
    const h = await fixture(t, options); assert.equal(h.container.hidden, true); assert.equal(h.applied.length, 0);
  }
  const h = await fixture(t); await h.load(); const old = h.el('Apply'); h.state.pending = true; h.controller.refresh(); old.dispatch('click'); await h.settle();
  assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0);
});
test('looped completion only warns, full animation is an explicit empty choice, and no-op Apply remains disabled', async t => {
  const h = await fixture(t, { parameters: [row('clip_idle'), row('clip_action')] }); await h.load(); assert.equal(h.el('Apply').disabled, true);
  assert.match(h.container.textContent, /完整动画使用空值.*循环设置/); h.choose('action', id(5)); assert.match(h.select('action').parentElement.parentElement.textContent, /不会自然完成/);
  assert.equal(h.el('Apply').disabled, false); h.choose('action', ''); assert.equal(h.el('Apply').disabled, true); assert.doesNotMatch(h.container.textContent, /不会自然完成/);
});
test('missing clips stay visible and invalid until explicitly repaired; no saved animation cannot be configured', async t => {
  const h = await fixture(t, { parameters: [row('clip_idle', id(999)), row('clip_action', 'malformed')] }); await h.load();
  assert.equal(h.select('idle').value, id(999)); assert.match(h.select('idle').textContent, /不可用的当前值/); assert.equal(h.el('Apply').disabled, true);
  h.choose('idle', id(5)); h.choose('action', id(4)); assert.equal(h.el('Apply').disabled, false); await h.apply(); assert.equal(h.applied.length, 1);
  const empty = await fixture(t, { read: source => directory(source, { empty: true }) }); await empty.load(); assert.equal(empty.el('Apply').disabled, true); assert.match(empty.container.textContent, /没有已保存动画/);
});
test('duplicate target or wrong-type rows disable helper application and preserve ordinary fields', async t => {
  for (const parameters of [[row('clip_idle'), row('clip_idle')], [row('clip_action', '1e-', 'number')]]) {
    const h = await fixture(t, { parameters }); await h.load(); h.choose('idle', id(5)); h.choose('action', id(4));
    assert.equal(h.el('Apply').disabled, true); h.el('Apply').dispatch('click'); await h.settle(); assert.equal(h.applied.length, 0); assert.deepEqual(h.state.parameters, parameters);
  }
});
test('language refresh retains local choices, select nodes, focus and raw parameter inputs', async t => {
  const h = await fixture(t); await h.load(); h.choose('idle', id(5)); const picker = h.select('idle'); picker.focus();
  const original = structuredClone(h.state.parameters);
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.select('idle'), picker); assert.equal(h.document.activeElement, picker); assert.equal(picker.value, id(5));
    assert.deepEqual(h.state.parameters, original); assert.equal(h.applied.length, 0); assert.equal(h.reads.length, 1);
  }
});
test('reset and disposal revoke detached buttons and do not mutate the ordinary form', async t => {
  const h = await fixture(t); await h.load(); h.choose('idle', id(5)); const old = h.el('Apply'), original = structuredClone(h.state.parameters);
  h.controller.reset(); h.controller.refresh(); old.dispatch('click'); await h.settle(); assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0);
  await h.load(); const next = h.el('Apply'); h.controller.dispose(); next.dispatch('click'); await h.settle(); assert.equal(h.applied.length, 0); assert.deepEqual(h.state.parameters, original);
});
test('all new state binding messages have English and Japanese translations', async () => {
  const content = await fs.readFile(new URL('../../web/modules/app-scene-behavior-state-bindings.js', import.meta.url), 'utf8');
  for (const match of content.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) { assert.ok(en[match[1]], 'English: ' + match[1]); assert.ok(ja[match[1]], 'Japanese: ' + match[1]); }
});
