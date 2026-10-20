import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, options = {}) {
  const h = await dialogHarness('app-scene-animation-track-copy'), container = h.document.createElement('section'); h.document.body.append(container);
  const context = { session: {}, sourcePath: 'animation.json', sourceToken: 'source:1', current: true, available: true, locked: false, form: 'reviewed', catalog: {}, catalogGeneration: 1, catalogToken: 'targets:1', targetsAvailable: true,
    tracks: [{ id: 'track:1', label: 'Offset · <img src=x> · instance:1 · track:1' }, { id: 'track:2', label: 'Sprite · instance:1 · track:2' }], targets: [{ instanceId: 'instance:1', label: 'Same name · instance:1' }, { instanceId: 'instance:2', label: 'Same name · instance:2' }] };
  let language = 'zh', commits = 0; const requests = [], translate = key => ({ en, ja }[language]?.[key] || key);
  const controller = h.runtime.setupSceneAnimationTrackCopy({ container, getContext: () => context, translate,
    prepare: async (source, target) => { requests.push([source, target]); if (options.prepare) return options.prepare(source, target, () => commits++); return () => { commits++; return true; }; } });
  t.after(() => controller.dispose());
  const el = part => container.querySelector('#sceneAnimationTrackCopy' + part), settle = async () => { await flushDialogs(); await flushDialogs(); };
  return { ...h, context, controller, el, requests, commits: () => commits, settle,
    select(part, value) { el(part).value = value; el(part).dispatch('change'); }, async click() { el('Apply').click(); await settle(); }, language(value) { language = value; controller.refresh(); } };
}
test('track copy requires explicit source and saved target choices and shows complete identities as text', async t => {
  const h = await fixture(t); assert.equal(h.el('Source').value, ''); assert.equal(h.el('Target').value, ''); assert.equal(h.el('Apply').disabled, true);
  h.select('Source', 'track:1'); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('SourceDetail').textContent, /<img src=x>/); assert.equal(h.el('SourceDetail').querySelector('img'), null);
  h.select('Target', 'instance:2'); assert.equal(h.el('TargetDetail').textContent, 'Same name · instance:2'); assert.deepEqual(h.requests, []); assert.equal(h.context.form, 'reviewed');
  await h.click(); assert.deepEqual(h.requests, [['track:1', 'instance:2']]); assert.equal(h.commits(), 1); assert.match(h.el('Status').textContent, /已复制/);
});
test('track choices and focused nodes survive translation without submitting a copy', async t => {
  const h = await fixture(t); h.select('Source', 'track:2'); h.select('Target', 'instance:2'); const control = h.el('Target'); control.focus();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Target'), control); assert.equal(h.document.activeElement, control); assert.equal(h.el('Source').value, 'track:2'); assert.equal(control.value, 'instance:2'); }
  assert.equal(h.requests.length, 0); assert.equal(h.context.form, 'reviewed');
});
test('copy failure preserves selected choices and exposes retry without altering parent form', async t => {
  const h = await fixture(t, { prepare: async () => { throw Error('same property'); } }); h.select('Source', 'track:1'); h.select('Target', 'instance:1'); await h.click();
  assert.equal(h.el('Source').value, 'track:1'); assert.equal(h.el('Target').value, 'instance:1'); assert.match(h.el('Status').textContent, /已保留/); assert.equal(h.el('Apply').disabled, false); assert.equal(h.commits(), 0); assert.equal(h.context.form, 'reviewed');
});
test('missing core or directory disables the helper and fabricated selections cannot prepare', async t => {
  for (const key of ['available', 'targetsAvailable']) { const h = await fixture(t); h.select('Source', 'track:1'); h.select('Target', 'instance:2'); h.context[key] = false; h.controller.refresh(); await h.click(); assert.equal(h.requests.length, 0); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /字段编辑/); }
  const h = await fixture(t); h.select('Source', 'track:1'); h.select('Target', 'foreign'); await h.click(); assert.equal(h.requests.length, 0); h.select('Source', 'foreign'); h.select('Target', 'instance:2'); await h.click(); assert.equal(h.requests.length, 0);
});
test('all form source session directory and capability identities revoke in-flight copies even after reverting', async t => {
  for (const [key, value] of [['session', {}], ['sourcePath', 'other.json'], ['sourceToken', 'source:2'], ['current', false], ['available', false], ['locked', true], ['form', 'edited'], ['catalog', {}], ['catalogGeneration', 2], ['catalogToken', 'targets:2'], ['targetsAvailable', false]]) {
    const gate = deferred(), h = await fixture(t, { prepare: async (_source, _target, commit) => { await gate.promise; return () => { commit(); return true; }; } }); h.select('Source', 'track:1'); h.select('Target', 'instance:2'); await h.click();
    const before = h.context[key]; h.context[key] = value; h.controller.refresh(); h.context[key] = before; h.controller.refresh(); gate.resolve(); await h.settle(); assert.equal(h.commits(), 0, key);
  }
});
test('selection changes revoke older requests without unlocking a newer pending copy', async t => {
  const first = deferred(), second = deferred(); let calls = 0;
  const h = await fixture(t, { prepare: async (_source, _target, commit) => { await (++calls === 1 ? first.promise : second.promise); return () => { commit(); return true; }; } }); h.select('Source', 'track:1'); h.select('Target', 'instance:2'); await h.click(); await h.click(); assert.equal(h.requests.length, 1);
  h.select('Source', 'track:2'); await h.click(); first.resolve(); await h.settle(); assert.equal(h.commits(), 0); assert.equal(h.el('Apply').disabled, true); second.resolve(); await h.settle(); assert.equal(h.commits(), 1);
});
test('reset disposal and vanished selections reject prepared copies and detached controls', async t => {
  for (const action of ['reset', 'dispose', 'removeSource', 'removeTarget']) {
    const gate = deferred(), h = await fixture(t, { prepare: async (_source, _target, commit) => { await gate.promise; return () => { commit(); return true; }; } }); h.select('Source', 'track:1'); h.select('Target', 'instance:2'); await h.click(); const button = h.el('Apply');
    if (action.startsWith('remove')) { h.context[action === 'removeSource' ? 'tracks' : 'targets'] = []; h.context.form += 'changed'; h.controller.refresh(); } else h.controller[action]();
    gate.resolve(); await h.settle(); assert.equal(h.commits(), 0); button.click(); await h.settle(); assert.equal(h.requests.length, 1);
  }
});
test('successful parent refresh keeps the result message and a rejected commit claims no success', async t => {
  let h; h = await fixture(t, { prepare: async (_source, _target, commit) => () => { commit(); h.context.form = 'copied'; h.controller.refresh(); return true; } }); h.select('Source', 'track:1'); h.select('Target', 'instance:2'); await h.click(); assert.match(h.el('Status').textContent, /已复制/);
  const rejected = await fixture(t, { prepare: async () => () => null }); rejected.select('Source', 'track:1'); rejected.select('Target', 'instance:2'); await rejected.click(); assert.equal(rejected.el('Status').textContent, '');
});
