import { captureSceneAnimationTargets, isSceneAnimationTargets, sceneAnimationTargetsMatchSource, sceneAnimationTargetValue, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, isSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { createSceneAnimationPlayer } from '../../web/modules/scene-animation-player.js';
import { renderSceneAnimationSample } from '../../web/modules/scene-animation-preview.js';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const model = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 2, value: [10, 20] }] }] });
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function catalog(source, { targets, savedContent, revision = '1' } = {}) {
  const content = savedContent ?? '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  return captureSceneAnimationTargets(copy(source), { format: 'viento-scene-animation-targets', schemaVersion: 1, worldId: 'world:' + '0'.repeat(64), revision: 'sha256:' + revision.repeat(64),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: 'sha256:' + '3'.repeat(64) },
    manifest: { objectId: id(9), sourcePath: source.sourcePath, sourceRevision: source.baseSourceRevision, content },
    targets: targets ?? [3, 4].map(n => ({ instanceId: id(n), objectId: id(5), name: '<img src=x> & Same name', sourcePath: 'documents/characters/demo.md' })) });
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const original = '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n'; let content = original, language = 'zh', listener = () => {}, allocated = 10;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, animationSource: true, available: true, sourcePath: 'documents/animations/demo.json', sourceToken: 'host:1', targetsAvailable: settings.targetsAvailable ?? Boolean(settings.targets), targetsToken: 1 };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const frames = [], calls = [], targetCalls = [], appliedTargets = [], confirmations = [], documentListeners = new Map(); let now = 0;
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-animation', {
    crypto: { randomUUID: () => id(++allocated) },
    readSceneAnimationDocument,
    createSceneAnimationProposal: async (source, edit) => { const value = await createSceneAnimationProposal(copy(source), copy(edit)); return settings.proposal ? settings.proposal(value) : value; },
    isSceneAnimationProposal, isSceneAnimationTargets, sceneAnimationTargetsMatchSource: (value, source) => sceneAnimationTargetsMatchSource(value, copy(source)),
    sceneAnimationTargetValue, validateSceneAnimationTargets: (value, document) => validateSceneAnimationTargets(value, copy(document)),
    createSceneAnimationPlayer: options => createSceneAnimationPlayer({ ...options, now: () => now, schedule: callback => { frames.push(callback); return frames.length; }, cancel() {} }),
    renderSceneAnimationSample, t: translate,
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  h.document.addEventListener = (type, callback) => documentListeners.set(type, callback); h.document.removeEventListener = type => documentListeners.delete(type);
  h.runtime.window.confirm = message => { confirmations.push(message); return settings.confirm?.() ?? true; };
  let controller; controller = h.runtime.setupSceneAnimation({ ...(settings.targets ? { getTargets: async source => { targetCalls.push(copy(source)); return typeof settings.targets === 'function' ? settings.targets(copy(source), targetCalls.length) : catalog(copy(source)); } } : {}), getContext: () => context, getSource: () => settings.source ? settings.source(snapshot()) : Promise.resolve(snapshot()),
    applyDraft: async (proposal, guards) => {
      calls.push(proposal); appliedTargets.push(guards.targets); if (settings.apply) return settings.apply(proposal, guards);
      assert.equal(guards.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':draft'; controller.refresh();
      return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken, focus() {} };
    } });
  const el = name => h.element('sceneAnimation' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, el, context, calls, targetCalls, appliedTargets, snapshot, original, content: () => content, confirmations, frames, settle, click, open: () => controller.open(),
    set(name, value, event = 'input') { el(name).value = value; el(name).dispatch(event); },
    language(value) { language = value; listener(); }, tick(milliseconds) { now = milliseconds; frames.at(-1)(); },
    hide() { h.document.hidden = true; documentListeners.get('visibilitychange')(); } };
}
test('animation entry recognizes only its editable ordinary source and independent availability', async t => {
  const h = await fixture(t); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh']);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['animationSource', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  for (const key of ['available', 'busy']) { const old = h.context[key]; h.context[key] = !old; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false); h.context[key] = old; }
  assert.equal(await h.open(), true); assert.equal(h.el('Dialog').dataset.vientoCloseGuard, 'true'); assert.equal(h.el('Play').disabled, false); assert.equal(h.calls.length, 0);
});
test('animation field check reviews full source and apply writes only the ordinary draft with BOM CRLF retained', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Key1X', '30'); h.set('Duration', '3');
  assert.equal(h.el('Play').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Before').textContent, h.original); assert.match(h.el('After').textContent, /30/);
  h.set('Position', '1'); assert.match(h.el('Values').textContent, /\[15,10\]/);
  await h.click('Apply'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 1); assert.equal(h.content().startsWith('\ufeff'), true);
  assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false); assert.equal((await readSceneAnimationDocument(h.content())).durationSeconds, 3);
});
test('incomplete values remain editable and cancelling a form never writes the source draft', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); await h.open(); h.set('Duration', '1e'); await h.click('Check');
  assert.equal(h.el('Duration').value, '1e'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Play').disabled, true);
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); allow = true; await h.click('Cancel'); assert.equal(h.el('Dialog').open, false);
  assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0); assert.equal(h.confirmations.length, 2);
});
test('adding a key at the duration endpoint inserts a valid midpoint and stable row callbacks cannot alter rebuilt rows', async t => {
  const h = await fixture(t); await h.open(); const oldAdd = h.el('Track0AddKey'); await h.click('Track0AddKey');
  assert.equal(h.el('Track0Key1Time').value, '1'); assert.equal(h.el('Track0Key2Time').value, '2'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  oldAdd.click(); await h.settle(); assert.equal(h.el('Track0Key3Time'), null); assert.equal(h.el('Apply').disabled, false);
  await h.click('Track0Key1Remove'); assert.equal(h.el('Track0Key1Time').value, '2'); await h.click('AddTrack');
  h.set('Track1Instance', id(5)); h.set('Track1Property', 'opacity', 'change'); assert.equal(h.el('Track1Key0X').value, '1');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); await h.click('Track0Remove'); assert.equal(h.el('Track0Property').value, 'opacity'); assert.equal(h.el('Track0Remove').disabled, true);
});
test('source replacement closes preview authority while retaining form values and rejects old approval', async t => {
  const h = await fixture(t); await h.open(); h.set('Duration', '3'); await h.click('Check'); await h.click('Play');
  const count = h.frames.length; h.context.sourceToken += ':changed'; h.controller.refresh(); h.tick(1000);
  assert.equal(h.el('Duration').value, '3'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Play').disabled, true); assert.equal(h.frames.length, count);
  await h.click('Apply'); assert.equal(h.calls.length, 0);
});
test('late source and validation callbacks cannot reopen cancelled or changed animation sessions', async t => {
  const sourceGate = deferred(), h = await fixture(t, { source: async value => { await sourceGate.promise; return value; } });
  const opening = h.open(); await h.click('Cancel'); sourceGate.resolve(); assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false);
  const gate = deferred(), other = await fixture(t, { proposal: async value => { await gate.promise; return value; } }); await other.open(); other.set('Duration', '3'); other.el('Check').click(); await other.settle();
  assert.equal(other.el('Dialog').getAttribute('aria-busy'), 'true'); await other.click('Cancel'); gate.resolve(); await other.settle(); assert.equal(other.el('Dialog').open, false); assert.equal(other.calls.length, 0);
});
test('play pause seek stop visibility and form changes share one checked model without source writes', async t => {
  const h = await fixture(t); await h.open(); await h.click('Play'); h.tick(1000); assert.match(h.el('Values').textContent, /\[5,10\]/);
  await h.click('Pause'); assert.equal(h.el('Play').disabled, false); h.set('Position', '1.5'); assert.match(h.el('Values').textContent, /\[7.5,15\]/);
  await h.click('Stop'); assert.equal(h.el('Position').value, '0'); await h.click('Play'); h.hide(); assert.equal(h.el('Play').disabled, false);
  h.set('Track0Key1X', '7'); assert.equal(h.el('Play').disabled, true); assert.equal(h.el('Values').textContent, ''); assert.equal(h.calls.length, 0);
});
test('locale changes preserve form nodes focus incomplete input approval and sampled time', async t => {
  const h = await fixture(t); await h.open(); h.set('Duration', '3'); await h.click('Check'); h.set('Position', '1');
  const input = h.el('Duration'); input.focus(); const before = h.el('After').textContent;
  for (const [lang, title] of [['en', 'Edit scene animation'], ['ja', 'シーンアニメーションを編集'], ['zh', '编辑场景动画']]) {
    h.language(lang); assert.equal(h.el('Duration'), input); assert.equal(h.document.activeElement, input); assert.equal(input.value, '3');
    assert.equal(h.el('Title').textContent, title); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Position').value, '1'); assert.equal(h.el('After').textContent, before);
  }
  h.set('Duration', '1e'); h.language('ja'); assert.equal(input.value, '1e'); assert.equal(h.el('Apply').disabled, true);
});
test('animation is an optional isolated Studio module with authoring and preview capabilities', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8'); const calls = [], registry = createStudioModuleRegistry(); let refreshes = 0;
  const sandbox = vm.createContext({ createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }),
    setupSettings: async () => {}, setupWorldBrowser: () => ({}), setupProjectBuild: () => ({}), setupProjectSettings: () => ({}), setupExport: () => ({}), setupMediaEditor: () => ({}),
    setupSceneAnimation: options => { calls.push(options); return { refresh: () => refreshes++ }; } });
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), sandbox);
  const ports = { getContext() {}, getSource() {}, applyDraft() {} }; const system = await sandbox.setupStudioSystem({ ports: { sceneAnimation: ports } });
  assert.equal(calls.length, 1); assert.equal(Object.isFrozen(calls[0]), true); assert.equal(calls[0].applyDraft, ports.applyDraft); assert.equal(calls[0].sceneAudio, undefined);
  system.refreshMedia(); assert.equal(refreshes, 1); const caps = system.snapshot().plan.capabilities; assert.equal(caps.filter(cap => cap.moduleId === 'org.viento.scene-animation').length, 2);
  await sandbox.setupStudioSystem({ features: { sceneAnimation: false }, ports: { sceneAnimation: ports } }); assert.equal(calls.length, 1);
});


test('target directory retains duplicate names with full instance identities and only explicit selection changes the form', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle();
  const selector = h.el('Track0Target'), options = selector.querySelectorAll('option');
  assert.equal(selector.disabled, false); assert.equal(options.length, 3); assert.ok(options[1].textContent.includes('<img src=x> & Same name')); assert.ok(options[1].textContent.includes(id(3))); assert.ok(options[2].textContent.includes(id(4)));
  assert.equal(selector.querySelector('img'), null); assert.equal(h.el('Track0Instance').value, id(3)); assert.equal(h.content(), h.original);
  h.set('Track0Target', id(4), 'change'); assert.equal(h.el('Track0Instance').value, id(4)); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Play').disabled, true);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); await h.click('Apply');
  assert.equal(h.calls.length, 1); assert.equal(isSceneAnimationTargets(h.appliedTargets[0]), true); assert.equal((await readSceneAnimationDocument(h.content())).tracks[0].instanceId, id(4));
});
test('late directory arrival preserves focused incomplete input and keeps Rust sampling separate', async t => {
  const gate = deferred(), h = await fixture(t, { targets: async source => { await gate.promise; return catalog(source); } }); await h.open();
  assert.equal(h.el('Play').disabled, false); const input = h.el('Duration'); input.focus(); h.set('Duration', '1e');
  gate.resolve(); await h.settle(); assert.equal(h.el('Duration'), input); assert.equal(h.document.activeElement, input); assert.equal(input.value, '1e');
  assert.equal(h.el('Track0Target').disabled, false); assert.equal(h.el('Play').disabled, true); assert.equal(h.calls.length, 0);
  h.set('Duration', '3'); await h.click('Check'); await h.click('Play'); const frameCount = h.frames.length;
  await h.click('TargetsRefresh'); assert.equal(h.frames.length, frameCount); assert.equal(h.el('Pause').disabled, false); assert.equal(h.el('Apply').disabled, true); h.tick(1000);
  assert.match(h.el('Values').textContent, /\[5,10\]/);
});
test('missing saved targets remain visible and cannot pass Check until explicitly repaired', async t => {
  const h = await fixture(t, { targets: source => catalog(source, { targets: [{ instanceId: id(4), objectId: id(5), name: 'Replacement', sourcePath: 'documents/characters/demo.md' }] }) });
  await h.open(); await h.settle(); assert.equal(h.el('Track0Instance').value, id(3)); assert.equal(h.el('Track0Target').value, ''); assert.equal(h.el('Track0TargetHint').hidden, false);
  h.set('Duration', '3'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Diagnostic').textContent, 'scene_animation_target_missing');
  h.set('Track0Target', id(4), 'change'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Track0TargetHint').hidden, true);
  h.set('Track0Target', id(50), 'change'); assert.equal(h.el('Track0Instance').value, id(4)); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Track0Target').value, id(4));
});
test('failed or absent directory explicitly preserves manual mode without claiming target validation', async t => {
  for (const settings of [{}, { targets: async () => { throw Error('offline'); } }, { targets: true, targetsAvailable: false }]) {
    const h = await fixture(t, settings); await h.open(); await h.settle();
    assert.equal(h.el('Track0Instance').disabled, false); assert.equal(h.el('Play').disabled, false); assert.match(h.el('TargetsStatus').textContent, /未验证/);
    h.set('Track0Instance', id(50)); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Status').textContent, /目标尚未验证/);
    await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.appliedTargets[0], undefined);
  }
});
test('directory refresh failure revokes catalog approval while preserving fields and checked schematic preview', async t => {
  const h = await fixture(t, { targets: (source, count) => { if (count > 1) throw Error('deleted scene'); return catalog(source); } });
  await h.open(); await h.settle(); h.set('Duration', '3'); await h.click('Check'); const input = h.el('Track0Instance'); input.focus();
  assert.equal(h.el('Apply').disabled, false); await h.click('TargetsRefresh'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Track0Instance'), input); assert.equal(h.document.activeElement, input);
  assert.equal(h.el('Duration').value, '3'); assert.equal(h.el('Play').disabled, false); assert.match(h.el('TargetsStatus').textContent, /无法读取/);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Status').textContent, /目标尚未验证/);
});
test('catalog branding wrong-source responses and ability generations revoke stale reads without locking manual editing', async t => {
  for (const change of [h => h.context.targetsToken++, h => h.context.targetsAvailable = false, h => h.context.sourceToken += ':new']) {
    const gate = deferred(), h = await fixture(t, { targets: async source => { await gate.promise; return catalog(source); } }); await h.open(); change(h); h.controller.refresh(); gate.resolve(); await h.settle();
    assert.equal(h.el('Track0Target').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Track0Instance').value, id(3));
    if (h.context.sourceToken === 'host:1') assert.equal(h.el('Track0Instance').disabled, false);
  }
  const h = await fixture(t, { targets: source => ({ ...catalog(source) }) }); await h.open(); await h.settle(); assert.match(h.el('TargetsStatus').textContent, /无法读取/);
  const other = await fixture(t, { targets: source => catalog({ ...source, token: 'another-source' }) }); await other.open(); await other.settle(); assert.match(other.el('TargetsStatus').textContent, /无法读取/);
});
test('cancelled reads and detached old dropdowns cannot mutate a reopened or rebuilt animation form', async t => {
  const gate = deferred(), h = await fixture(t, { targets: async (source, count) => { if (count === 1) await gate.promise; return catalog(source, { revision: String(count) }); } });
  await h.open(); const oldSelect = h.el('Track0Target'); await h.click('Cancel'); await h.open(); await h.settle(); h.set('Track0Target', id(4), 'change');
  oldSelect.value = id(3); oldSelect.dispatch('change'); gate.resolve(); await h.settle(); assert.equal(h.el('Track0Instance').value, id(4)); assert.equal(h.targetCalls.length, 2);
  const detached = h.el('Track0Target'); await h.click('Track0AddKey'); detached.value = id(3); detached.dispatch('change'); assert.equal(h.el('Track0Instance').value, id(4));
});
test('directory arriving during an asynchronous manual check cannot leave an unchecked target approval', async t => {
  const directoryGate = deferred(), proposalGate = deferred(), h = await fixture(t, {
    targets: async source => { await directoryGate.promise; return catalog(source); }, proposal: async value => { await proposalGate.promise; return value; },
  });
  await h.open(); h.set('Duration', '3'); h.el('Check').click(); await h.settle(); directoryGate.resolve(); await h.settle(); proposalGate.resolve(); await h.settle();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Duration').value, '3'); assert.equal(h.el('Track0Target').disabled, false);
  assert.equal(h.el('Status').textContent.includes('正在检查'), false); assert.match(h.el('Status').textContent, /目录已变化/);
});
test('target labels localize without replacing form nodes or changing the selected identity and reviewed draft', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle(); h.set('Track0Target', id(4), 'change'); await h.click('Check');
  const input = h.el('Track0Instance'), selector = h.el('Track0Target'), before = h.el('After').textContent; input.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Track0Instance'), input); assert.equal(h.el('Track0Target'), selector); assert.equal(h.document.activeElement, input);
    assert.equal(selector.value, id(4)); assert.equal(input.value, id(4)); assert.equal(h.el('After').textContent, before); assert.equal(h.el('Apply').disabled, false);
    assert.ok(selector.querySelectorAll('option').every(option => !option.value || option.textContent.includes(option.value)));
  }
});
