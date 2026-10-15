import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readSceneAudioDocument, createSceneAudioProposal, isSceneAudioProposal } from '../../engine/scene-audio-edit.mjs';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const model = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1), tracks: [{ id: id(2), resourceId: id(3), role: 'music', volume: 0.5, loop: true }],
  cues: [{ id: id(4), trackId: id(2), atSeconds: 10, action: 'stop' }, { id: id(5), trackId: id(2), atSeconds: 0, action: 'play' }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const original = settings.content ?? '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  let content = original, language = 'zh', listener = () => {}, disposed = 0;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, audioSource: true, available: true,
    sourcePath: 'documents/audio/demo.json', sourceToken: 'load:1' };
  const calls = [], proposals = [], confirms = [], focused = [], loads = [];
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-audio', {
    readSceneAudioDocument: async content => { loads.push(content); return settings.read ? settings.read(content) : readSceneAudioDocument(content); },
    createSceneAudioProposal: async (source, edit) => { const value = await createSceneAudioProposal(copy(source), copy(edit)); proposals.push(value); return settings.proposal ? settings.proposal(value) : value; },
    isSceneAudioProposal, t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: value => { listener = value; return () => { disposed++; listener = () => {}; }; },
  });
  h.runtime.window.confirm = message => { confirms.push(message); return settings.confirm?.() ?? true; };
  let controller;
  controller = h.runtime.setupSceneAudio({ getContext: () => context, getSource: async () => settings.source ? settings.source(snapshot()) : snapshot(),
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (settings.apply) return settings.apply(proposal, ports, context);
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied'; controller.refresh();
      return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken, focus: () => focused.push(true) };
    } });
  const el = suffix => h.element('sceneAudio' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); };
  const click = async suffix => { el(suffix).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, click, original, calls, proposals, confirms, focused, loads, content: () => content,
    open: () => controller.open(), check: () => click('Check'), apply: () => click('Apply'), language(value) { language = value; listener(); }, disposed: () => disposed };
}
test('audio entry needs its own existing JSON context and never opens in creation or read-only mode', async t => {
  const h = await fixture(t); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh']);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['audioSource', false], ['sourcePath', '']]) {
    const previous = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = previous;
  }
  for (const [key, value] of [['available', false], ['busy', true]]) { const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false); h.context[key] = old; }
  assert.equal(h.loads.length, 0); assert.equal(h.calls.length, 0); assert.equal(await h.open(), true);
});
test('audio editor preserves authored cue order and shows fixed scene and resource identities', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Cue0Time').value, '10'); assert.equal(h.el('Cue1Time').value, '0');
  assert.match(h.el('Scene').textContent, new RegExp(id(1))); assert.match(h.el('Tracks').children[0].children[0].textContent, new RegExp(id(3)));
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original);
});
test('zero volume false looping and cue action changes require review then update only the unsaved source', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '0'); h.set('Track0Loop', 'false', 'change'); h.set('Cue0Action', 'play', 'change'); h.set('Cue1Time', '0.25');
  await h.check(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0); assert.equal(h.el('Before').textContent, h.original);
  assert.equal(h.el('After').textContent, h.proposals[0].afterContent); assert.equal(h.proposals[0].edit.tracks[0].volume, 0); assert.equal(h.proposals[0].edit.tracks[0].loop, false);
  await h.apply(); assert.equal(h.calls.length, 1); assert.equal(h.content(), h.proposals[0].afterContent); assert.equal(h.el('Dialog').open, false); assert.equal(h.focused.length, 1);
});
test('unfinished numbers and domain-invalid values stay visible and never gain apply authority', async t => {
  for (const [field, value] of [['Track0Volume', '1e-'], ['Track0Volume', ''], ['Track0Volume', '-0.1'], ['Track0Volume', '2'], ['Cue0Time', '61'], ['Cue0Time', '-1']]) {
    const h = await fixture(t); await h.open(); h.set(field, value); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el(field).value, value); assert.equal(h.calls.length, 0);
  }
});
test('language changes retain unfinished values and checked proposals across Chinese English and Japanese', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Volume', '1e-');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Track0Volume').value, '1e-'); }
  h.set('Track0Volume', '0.2'); await h.check();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Track0Volume').value, '0.2'); }
});
test('silent or eventful form edits revoke prior audio approval', async t => {
  for (const mode of ['event', 'silent', 'language']) {
    const h = await fixture(t); await h.open(); h.set('Track0Volume', '0.2'); await h.check(); h.set('Track0Volume', '0.3', mode === 'event' ? 'input' : false);
    if (mode === 'language') h.language('ja'); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
  }
});
test('cancel and Escape honor dirty confirmation and preserve ordinary source', async t => {
  let accept = false; const h = await fixture(t, { confirm: () => accept }); await h.open(); h.set('Track0Volume', '0.2');
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.confirms.length, 1); accept = true;
  h.el('Dialog').dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }); await h.settle();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('late source loads are discarded after closing or switching the document', async t => {
  for (const mode of ['close', 'source']) {
    const gate = deferred(), h = await fixture(t, { source: async value => { await gate.promise; return value; } }), pending = h.open();
    if (mode === 'close') await h.click('Close'); else { h.context.sourceToken += ':other'; h.controller.refresh(); }
    gate.resolve(); assert.equal(await pending, false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.calls.length, 0);
  }
});
test('source changes while Rust checking is pending cannot approve a stale audio patch', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async value => { await gate.promise; return value; } });
  await h.open(); h.set('Track0Volume', '0.2'); h.el('Check').click(); await h.settle(); h.context.sourceToken += ':changed'; gate.resolve(); await h.settle();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0); assert.equal(h.el('Track0Volume').value, '0.2');
});
test('pending apply can be cancelled before host commit and errors keep draft input', async t => {
  const gate = deferred(); let current;
  const h = await fixture(t, { apply: async (proposal, ports) => { await gate.promise; current = ports.isCurrent(); throw Error('cancelled'); } });
  await h.open(); h.set('Track0Volume', '0.2'); await h.check(); h.el('Apply').click(); await h.settle(); await h.click('Cancel'); gate.resolve(); await h.settle();
  assert.equal(current, false); assert.equal(h.content(), h.original); assert.equal(h.el('Dialog').open, false);
});
test('malformed duplicate-key nonaudio documents and mismatched snapshots fail closed', async t => {
  for (const content of ['{}', '{', JSON.stringify(model()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')]) {
    const h = await fixture(t, { content }); assert.equal(await h.open(), false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.calls.length, 0);
  }
  const h = await fixture(t, { source: value => ({ ...value, token: 'stale' }) }); assert.equal(await h.open(), false); assert.equal(h.loads.length, 0);
});
test('missing Rust core errors remain explicit without inventing a JavaScript validation result', async t => {
  const h = await fixture(t, { read: () => { throw Object.assign(Error('Rust core unavailable'), { errorCode: 'studio_core_unavailable' }); } });
  assert.equal(await h.open(), false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Diagnostic').textContent, /Rust core/);
});
test('disposing removes only the audio panel and ignores pending language callbacks', async t => {
  const h = await fixture(t); await h.open(); h.controller.dispose(); assert.equal(h.disposed(), 1); h.language('ja'); assert.equal(await h.open(), false);
});
test('audio module receives only its own frozen ports and disabling it leaves siblings untouched', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
  for (const enabled of [true, false]) {
    const calls = [], refreshes = [], registry = createStudioModuleRegistry(), own = () => 'source';
    const context = vm.createContext({ createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }),
      setupSettings: async () => {}, setupSceneAudio: ports => { calls.push(ports); return { refresh: () => refreshes.push(true) }; },
      setupWorldBrowser: () => ({}), setupProjectBuild: () => ({}), setupProjectSettings: () => ({}), setupExport: () => ({}), setupMediaEditor: () => ({}) });
    vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
    const system = await context.setupStudioSystem({ features: { sceneAudio: enabled }, ports: { sceneAudio: { getSource: own }, sceneBehaviors: { marker: 'forbidden' } } });
    assert.equal(calls.length, enabled ? 1 : 0); if (enabled) { assert.equal(calls[0].getSource, own); assert.equal(Object.keys(calls[0]).join(','), 'getSource'); assert.ok(Object.isFrozen(calls[0])); }
    system.refreshMedia(); assert.equal(refreshes.length, enabled ? 1 : 0);
    const snapshot = copy(system.snapshot()); assert.equal(snapshot.plan.modules.find(row => row.id === 'org.viento.scene-audio').active, enabled);
    assert.equal(snapshot.plan.modules.find(row => row.id === 'org.viento.scene-behaviors').active, true);
  }
});
test('audio labels have English and Japanese translations and the panel has a narrow-screen layout', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-audio.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
  for (const key of keys) { assert.equal(typeof en[key], 'string', `en:${key}`); assert.equal(typeof ja[key], 'string', `ja:${key}`); }
  const css = await fs.readFile(new URL('../../web/scene-audio.css', import.meta.url), 'utf8'); assert.match(css, /@media\(max-width:600px\)/); assert.match(css, /overflow:auto/);
  assert.doesNotMatch(source, /\.play\(|new Audio|fetch\(|getCurrentEditContent|app-scene-behaviors/);
});
