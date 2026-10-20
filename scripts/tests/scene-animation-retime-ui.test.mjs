import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, options = {}) {
  const h = await dialogHarness('app-scene-animation-retime'), container = h.document.createElement('section'); h.document.body.append(container);
  const context = { session: {}, sourcePath: 'documents/animation.json', sourceToken: 'source:1', current: true, available: true, locked: false, form: 'reviewed form' };
  let language = 'zh', commits = 0; const requests = [];
  const translate = key => ({ en, ja }[language]?.[key] || key);
  const controller = h.runtime.setupSceneAnimationRetime({ container, translate, getContext: () => context,
    prepare: async duration => { requests.push(duration); if (options.prepare) return options.prepare(duration, () => commits++); return () => { commits++; return options.changed !== false; }; } });
  t.after(() => controller.dispose()); controller.reset('2');
  const el = part => container.querySelector('#sceneAnimationRetime' + part), settle = async () => { await flushDialogs(); await flushDialogs(); };
  return { ...h, controller, context, requests, commits: () => commits, el, settle,
    target(value) { el('Duration').value = value; el('Duration').dispatch('input'); }, async click() { el('Apply').click(); await settle(); },
    language(value) { language = value; controller.refresh(); } };
}
test('retime target is independent incomplete text and three-language refresh preserves focus and selection', async t => {
  const h = await fixture(t); h.target('1e'); const input = h.el('Duration'); input.focus(); input.selectionStart = 1; input.selectionEnd = 2;
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Duration'), input); assert.equal(h.document.activeElement, input); assert.equal(input.value, '1e'); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 2); }
  assert.equal(h.requests.length, 0); assert.equal(h.context.form, 'reviewed form'); await h.click(); assert.equal(h.requests.length, 0); assert.match(h.el('Status').textContent, /无法/); assert.equal(input.value, '1e');
});
test('retime only commits prepared transforms and reports no change separately from failures', async t => {
  for (const changed of [true, false]) { const h = await fixture(t, { changed }); h.target('4'); await h.click(); assert.deepEqual(h.requests, [4]); assert.equal(h.commits(), 1); assert.match(h.el('Status').textContent, changed ? /已按比例/ : /相同/); }
  const h = await fixture(t, { prepare: async () => { throw Error('invalid animation'); } }); h.target('61'); await h.click(); assert.equal(h.commits(), 0); assert.match(h.el('Status').textContent, /已保留/); assert.equal(h.context.form, 'reviewed form'); assert.equal(h.el('Apply').disabled, false);
});
test('retime capability absence disables only this component and target survives capability changes', async t => {
  const h = await fixture(t); h.target('3.5'); h.context.available = false; h.controller.refresh(); await h.click(); assert.equal(h.requests.length, 0); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /原有字段编辑/);
  h.context.available = true; h.controller.refresh(); assert.equal(h.el('Duration').value, '3.5'); await h.click(); assert.equal(h.commits(), 1);
});
test('late retime transforms are revoked by every source form capability or dialog ownership change', async t => {
  for (const [key, value] of [['session', {}], ['sourcePath', 'other.json'], ['sourceToken', 'source:2'], ['current', false], ['available', false], ['locked', true], ['form', 'edited form']]) {
    const gate = deferred(), h = await fixture(t, { prepare: async (_duration, commit) => { await gate.promise; return () => { commit(); return true; }; } });
    h.target('4'); await h.click(); assert.equal(h.el('Apply').disabled, true); const before = h.context[key]; h.context[key] = value; h.controller.refresh(); h.context[key] = before; h.controller.refresh(); gate.resolve(); await h.settle(); assert.equal(h.commits(), 0, key); assert.equal(h.el('Duration').value, '4');
  }
});
test('changing target revokes an older request without unlocking a newer pending operation', async t => {
  const first = deferred(), second = deferred(); let calls = 0;
  const h = await fixture(t, { prepare: async (_duration, commit) => { await (++calls === 1 ? first.promise : second.promise); return () => { commit(); return true; }; } });
  h.target('4'); await h.click(); await h.click(); assert.deepEqual(h.requests, [4]);
  h.target('8'); await h.click(); assert.deepEqual(h.requests, [4, 8]); first.resolve(); await h.settle(); assert.equal(h.commits(), 0); assert.equal(h.el('Apply').disabled, true);
  second.resolve(); await h.settle(); assert.equal(h.commits(), 1); assert.equal(h.el('Apply').disabled, false);
});
test('reset and disposal revoke pending work and detached callbacks', async t => {
  for (const action of ['reset', 'dispose']) { const gate = deferred(), h = await fixture(t, { prepare: async (_duration, commit) => { await gate.promise; return () => { commit(); return true; }; } }); h.target('4'); await h.click(); const button = h.el('Apply'); h.controller[action](); gate.resolve(); await h.settle(); assert.equal(h.commits(), 0); if (action === 'dispose') { button.click(); await h.settle(); assert.deepEqual(h.requests, [4]); } }
});
test('a successful local commit can refresh its parent identity before reporting completion', async t => {
  let h; h = await fixture(t, { prepare: async (_duration, commit) => () => { commit(); h.context.form = 'retimed form'; h.controller.refresh(); return true; } }); h.target('4'); await h.click(); assert.equal(h.commits(), 1); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Status').textContent, /已按比例/);
});

test('a parent-rejected stale commit does not claim an unchanged duration', async t => {
  const h = await fixture(t, { prepare: async () => () => null }); h.target('4'); await h.click(); assert.equal(h.el('Status').textContent, ''); assert.equal(h.el('Apply').disabled, false);
});
