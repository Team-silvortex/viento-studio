import { setupSceneAnimationTrackCopy } from '../../web/modules/app-scene-animation-track-copy.js';
import { setupSceneAnimationRetime } from '../../web/modules/app-scene-animation-retime.js';
import { setupSceneAnimationUsage } from '../../web/modules/app-scene-animation-usage.js';
import { captureSceneAnimationUsage } from '../../engine/scene-animation-usage.mjs';
import { setupSceneAnimationClips } from '../../web/modules/app-scene-animation-clips.js';
import { captureSceneAnimationTargets, isSceneAnimationTargets, sceneAnimationTargetsMatchSource, sceneAnimationTargetValue, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readSceneAnimationDocument, createSceneAnimationProposal, isSceneAnimationProposal, retimeSceneAnimationDraft, copySceneAnimationTrackDraft } from '../../engine/scene-animation-edit.mjs';
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
  const original = '\ufeff' + JSON.stringify(settings.model ?? model(), null, 2).replaceAll('\n', '\r\n') + '\r\n'; let content = original, language = 'zh', listener = () => {}, allocated = 10;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, animationSource: true, available: true, sourcePath: 'documents/animations/demo.json', sourceToken: 'host:1', targetsAvailable: settings.targetsAvailable ?? Boolean(settings.targets), targetsToken: 1, usageAvailable: settings.usageAvailable ?? Boolean(settings.usage), usageToken: 'usage:1' };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const usageCalls = [], sourceClones = new WeakMap();
  const copyCalls = [], retimeCalls = [], frames = [], calls = [], targetCalls = [], appliedTargets = [], confirmations = [], documentListeners = new Map(); let now = 0;
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-animation', {
    setupSceneAnimationTrackCopy, supportsStudioCoreSceneAnimationTrackCopy: () => settings.copyAvailable !== false,
    copySceneAnimationTrackDraft: async (content, edit, sourceTrackId, targetInstanceId, newTrackId) => { copyCalls.push({ content, edit: copy(edit), sourceTrackId, targetInstanceId, newTrackId }); const result = await copySceneAnimationTrackDraft(content, copy(edit), sourceTrackId, targetInstanceId, newTrackId); return settings.copyTrack ? settings.copyTrack(result) : result; },
    setupSceneAnimationRetime, supportsStudioCoreSceneAnimationRetime: () => settings.retimeAvailable !== false,
    retimeSceneAnimationDraft: async (content, edit, duration) => { retimeCalls.push({ content, edit: copy(edit), duration }); const result = await retimeSceneAnimationDraft(content, copy(edit), duration); return settings.retime ? settings.retime(result) : result; },
    setupSceneAnimationUsage: options => setupSceneAnimationUsage({ ...options, getContext: () => { const context = options.getContext(); if (context.source && !sourceClones.has(context.source)) sourceClones.set(context.source, copy(context.source)); return { ...context, source: context.source ? sourceClones.get(context.source) : undefined }; } }),
    crypto: { randomUUID: settings.uuid || (() => id(++allocated)) },
    supportsStudioCoreSceneAnimationSprites: () => settings.sprites !== false,
    supportsStudioCoreSceneAnimationClips: () => settings.clips !== false, setupSceneAnimationClips,
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
  let controller; controller = h.runtime.setupSceneAnimation({ ...(settings.usage ? { getUsage: async source => { usageCalls.push(copy(source)); return typeof settings.usage === 'function' ? settings.usage(copy(source), usageCalls.length) : usageCatalog(copy(source)); } } : {}), ...(settings.targets ? { getTargets: async source => { targetCalls.push(copy(source)); return typeof settings.targets === 'function' ? settings.targets(copy(source), targetCalls.length) : catalog(copy(source)); } } : {}), getContext: () => context, getSource: () => settings.source ? settings.source(snapshot()) : Promise.resolve(snapshot()),
    applyDraft: async (proposal, guards) => {
      calls.push(proposal); appliedTargets.push(guards.targets); if (settings.apply) return settings.apply(proposal, guards);
      assert.equal(guards.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':draft'; controller.refresh();
      return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken, focus() {} };
    } });
  const el = name => h.element('sceneAnimation' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, el, context, calls, copyCalls, retimeCalls, targetCalls, appliedTargets, usageCalls, snapshot, original, content: () => content, confirmations, frames, settle, click, open: () => controller.open(),
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


test('sprite track fields review the schema upgrade and grid, then apply only the existing draft', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle();
  h.set('Track0Property', 'spriteFrame2d', 'change');
  assert.equal(h.el('Track0Interpolation').value, 'step'); assert.equal(h.el('Track0Interpolation').disabled, true);
  assert.equal(h.el('Track0Columns').value, '2'); assert.equal(h.el('Track0Rows').value, '2');
  assert.equal(h.el('Track0Key0X').value, '0'); assert.equal(h.el('Track0Key1X').value, '0');
  assert.equal(h.el('Track0Key0Y'), null); assert.equal(h.el('Track0Key1X').inputMode, 'numeric');
  h.set('Track0Columns', '3'); h.set('Track0Key1X', '5'); await h.click('Check');
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Before').textContent, h.original);
  const proposal = await readSceneAnimationDocument(h.el('After').textContent);
  assert.equal(proposal.schemaVersion, 2); assert.deepEqual(proposal.tracks[0].grid, { columns: 3, rows: 2 });
  assert.deepEqual(proposal.tracks[0].keyframes.map(row => row.value), [0, 5]);
  h.set('Position', '1'); assert.equal(h.el('Stage').children[0].textContent, '0');
  h.set('Position', '2'); assert.equal(h.el('Stage').children[0].textContent, '5');
  assert.equal(h.el('Stage').children[0].dataset.frameIndex, '5'); assert.match(h.el('Stage').children[0].getAttribute('aria-label'), /帧索引 5/);
  assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(isSceneAnimationTargets(h.appliedTargets[0]), true);
  assert.equal(h.content().startsWith('\ufeff'), true); assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false);
  assert.equal((await readSceneAnimationDocument(h.content())).schemaVersion, 2);
});
test('sprite grid and frame input errors stay editable without silently clamping authored values', async t => {
  const h = await fixture(t); await h.open(); h.set('Track0Property', 'spriteFrame2d', 'change');
  for (const [field, value] of [['Track0Columns', '1e'], ['Track0Columns', '65'], ['Track0Rows', '0'], ['Track0Key1X', '4'], ['Track0Key1X', '1.5'], ['Track0Key1X', '-1']]) {
    h.set(field, value); await h.click('Check');
    assert.equal(h.el(field).value, value); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Play').disabled, true);
    h.set(field, field.endsWith('X') ? '0' : '2');
  }
  h.set('Track0Key1X', '3'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  h.set('Track0Rows', '1'); assert.equal(h.el('Apply').disabled, true); await h.click('Check'); assert.equal(h.el('Apply').disabled, true);
  await h.click('Cancel'); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('changing a sprite property discards its grid and initializes safe scalar or vector values', async t => {
  for (const [property, expected] of [['opacity', 1], ['rotation2d', 0], ['scale2d', [1, 1]], ['offset2d', [0, 0]]]) {
    const h = await fixture(t); await h.open(); h.set('Track0Property', 'spriteFrame2d', 'change'); h.set('Track0Key1X', '3');
    h.set('Track0Property', property, 'change'); assert.equal(h.el('Track0Columns'), null); assert.equal(h.el('Track0Rows'), null);
    assert.equal(h.el('Track0Interpolation').disabled, false); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
    const result = await readSceneAnimationDocument(h.el('After').textContent);
    assert.equal(result.schemaVersion, 1); assert.equal(Object.hasOwn(result.tracks[0], 'grid'), false);
    assert.deepEqual(result.tracks[0].keyframes.map(row => row.value), [expected, expected]);
  }
});
test('saved sprite documents retain their grid and frame focus through translation, checks and new keys', async t => {
  const document = model(); document.schemaVersion = 2; document.tracks[0] = { ...document.tracks[0], property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 4, rows: 2 }, keyframes: [{ atSeconds: 0, value: 2 }, { atSeconds: 2, value: 6 }] };
  const h = await fixture(t, { model: document }); assert.equal(await h.open(), true);
  assert.equal(h.el('Track0Columns').value, '4'); assert.equal(h.el('Track0Rows').value, '2');
  h.set('Track0Key1X', '7'); await h.click('Check'); h.set('Position', '2');
  const input = h.el('Track0Columns'), frame = h.el('Track0Key1X'), preview = h.el('After').textContent; input.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Track0Columns'), input); assert.equal(h.el('Track0Key1X'), frame);
    assert.equal(h.document.activeElement, input); assert.equal(h.el('After').textContent, preview); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.el('Stage').children[0].textContent, '7'); assert.equal(h.el('Position').value, '2');
  }
  h.set('Track0Columns', '1e'); h.language('ja'); assert.equal(input.value, '1e'); assert.equal(h.el('Apply').disabled, true);
  h.set('Track0Columns', '4'); await h.click('Track0AddKey'); assert.equal(h.el('Track0Key1Time').value, '1');
  assert.equal(h.el('Track0Key1X').value, '2'); assert.equal(h.el('Track0Columns').value, '4'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
});
test('legacy core capability keeps v1 authoring available without advertising sprite frames', async t => {
  const h = await fixture(t, { sprites: false }); assert.equal(await h.open(), true);
  assert.equal(h.el('Track0Property').querySelectorAll('option').some(option => option.value === 'spriteFrame2d'), false);
  assert.equal(h.el('Play').disabled, false); h.set('Track0Key1X', '12'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  assert.equal((await readSceneAnimationDocument(h.el('After').textContent)).schemaVersion, 1);
});

const clipModel = () => ({ ...model(), schemaVersion: 3, clips: [{ id: id(20), name: 'Attack <b>', startSeconds: .5, endSeconds: 1.5, loop: false }] });
test('named clips remain a separate form but share exact source review and ordinary draft application', async t => {
  const h = await fixture(t); await h.open(); await h.click('AddClip');
  const clipId = h.el('Clips').querySelector('.scene-animation-clip').dataset.clipId;
  h.set('Clip0Name', 'Attack'); h.set('Clip0Start', '.5'); h.set('Clip0End', '1.5');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, true, 'numeric source spelling is strict');
  h.set('Clip0Start', '0.5'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const reviewed = JSON.parse(h.el('After').textContent.replace(/^\ufeff/, ''));
  assert.equal(reviewed.schemaVersion, 3); assert.deepEqual(reviewed.clips, [{id:clipId,name:'Attack',startSeconds:.5,endSeconds:1.5,loop:false}]);
  h.set('PreviewClip', clipId, 'change'); assert.equal(h.el('Position').max, '1'); assert.equal(h.el('Position').value, '0');
  assert.match(h.el('Values').textContent, /\[2.5,5\]/); assert.match(h.el('ClipRange').textContent, /0.5–1.5/);
  assert.equal(h.el('Pause').disabled, true); h.set('Position','0.5'); assert.match(h.el('Values').textContent,/\[5,10\]/);
  assert.equal(h.content(), h.original); await h.click('Apply'); assert.equal(h.calls.length,1); assert.equal((await readSceneAnimationDocument(h.content())).clips[0].id,clipId);
});
test('clip names invalid time input and current selection retain identity and focus across languages', async t => {
  const h = await fixture(t,{model:clipModel()}); await h.open(); h.set('PreviewClip',id(20),'change');
  const field=h.el('Clip0Name');field.focus();field.selectionStart=2;field.selectionEnd=4;
  for(const language of ['en','ja','zh']){h.language(language);assert.equal(h.el('Clip0Name'),field);assert.equal(h.document.activeElement,field);assert.equal(field.value,'Attack <b>');assert.equal(h.el('PreviewClip').value,id(20));assert.equal(h.el('Clips').querySelector('b'),null);}
  h.set('Clip0End','1e');await h.click('Check');assert.equal(h.el('Clip0End').value,'1e');assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Play').disabled,true);
  await h.click('Cancel');assert.equal(h.content(),h.original);
});
test('clip removal and source changes revoke the old selection without replacing tracks or saved source', async t => {
  const h=await fixture(t,{model:clipModel()});await h.open();h.set('PreviewClip',id(20),'change');await h.click('Play');const stale=h.frames.at(-1);
  await h.click('Clip0Remove');const count=h.el('Values').textContent;stale();assert.equal(h.el('Values').textContent,count);assert.equal(h.el('Play').disabled,true);
  await h.click('Check');const reviewed=JSON.parse(h.el('After').textContent.replace(/^\ufeff/,''));assert.equal(reviewed.schemaVersion,3);assert.deepEqual(reviewed.clips,[]);assert.deepEqual(reviewed.tracks,model().tracks);
  assert.equal(h.el('ClipSelection').hidden,true);h.context.sourceToken='other';h.controller.refresh();assert.equal(h.el('Apply').disabled,true);assert.equal(h.content(),h.original);
});
test('old cores hide clip creation while legacy track editing stays available', async t=>{
 const h=await fixture(t,{clips:false});await h.open();assert.equal(h.el('Clips').hidden,true);assert.equal(h.el('AddClip').disabled,true);h.set('Track0Key1X','20');await h.click('Check');assert.equal(h.el('Apply').disabled,false);assert.equal(JSON.parse(h.el('After').textContent.replace(/^\ufeff/,'')).schemaVersion,1);
});

function usageCatalog(source, options = {}) {
  const behavior = { format:'viento-scene-behaviors',schemaVersion:1,sceneObjectId:id(1),bindings:[1,2].map(n=>({bindingId:id(100+n),instanceId:id(3+n),implementation:{backendId:'org.viento.godot4',language:'gdscript',sourceObjectId:id(90)},parameters:{note:'中文🙂 prefix '+id(20),arbitrary:id(20),other:id(21)},events:[]})) };
  const content=options.content??'\ufeff'+JSON.stringify(behavior,null,2).replaceAll('\n','\r\n')+'\r\n';
  const raw={format:'viento-scene-animation-usage',schemaVersion:1,worldId:'world:'+'a'.repeat(64),revision:hash('world'),
    scene:{objectId:id(1),sourcePath:'documents/scenes/demo.json',sourceRevision:hash('scene')},
    animation:{objectId:id(9),sourcePath:source.sourcePath,sourceRevision:source.baseSourceRevision,content:options.saved??source.content},
    behavior:options.none?null:{objectId:id(80),sourcePath:'documents/behaviors/demo.json',sourceRevision:hash(content),content}};
  return captureSceneAnimationUsage(copy(source),raw);
}
test('clip usage is an optional read-only component with no reads until explicit selection',async t=>{
  for(const settings of [{},{usageAvailable:true},{usage:true,usageAvailable:false}]){const h=await fixture(t,{model:clipModel(),...settings});await h.open();assert.equal(h.el('Clip0Usage').hidden,true);h.el('Clip0Usage').dispatch('click');await h.settle();assert.equal(h.usageCalls.length,0);assert.equal(h.el('Usage').hidden,true);h.set('Clip0Name','New');await h.click('Check');assert.equal(h.el('Apply').disabled,false);}
  const h=await fixture(t,{model:clipModel(),usage:true});await h.open();assert.equal(h.el('Clip0Usage').hidden,false);assert.equal(h.usageCalls.length,0);await h.click('Clip0Usage');
  assert.deepEqual(h.usageCalls,[h.snapshot()]);assert.equal(h.el('UsageStatus').dataset.status,'ready');assert.equal(h.el('UsageMatches').children.length,2);assert.match(h.el('UsageMatches').textContent,/arbitrary/);assert.match(h.el('UsageMatches').textContent,new RegExp(id(101)));assert.match(h.el('UsageClip').textContent,/Attack <b>/);assert.equal(h.el('UsageClip').querySelector('b'),null);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.content(),h.original);
});
test('usage queries and failures keep reviewed animation, playing clock, focused incomplete text and three-language selection',async t=>{
  const gate=deferred(),h=await fixture(t,{model:clipModel(),usage:(source,count)=>count===1?gate.promise:Promise.reject(Error('offline'))});await h.open();h.set('Clip0Name','Renamed');await h.click('Check');const reviewed=h.el('After').textContent;await h.click('Play');
  h.el('Clip0Usage').click();await h.settle();const field=h.el('Clip0Name');field.focus();field.selectionStart=1;field.selectionEnd=4;h.tick(250);gate.resolve(usageCatalog(h.usageCalls[0]));await h.settle();
  assert.equal(h.el('After').textContent,reviewed);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('Pause').disabled,false);assert.equal(h.document.activeElement,field);assert.equal(field.selectionEnd,4);
  const sourceButton=h.el('UsageMatch0Source');for(const locale of ['en','ja','zh']){h.language(locale);assert.equal(h.el('Clip0Name'),field);assert.equal(h.document.activeElement,field);assert.equal(field.selectionStart,1);assert.equal(h.el('UsageMatch0Source'),sourceButton);assert.equal(h.el('After').textContent,reviewed);}
  await h.click('UsageRefresh');assert.equal(h.el('UsageStatus').dataset.status,'failed');assert.equal(h.el('After').textContent,reviewed);assert.equal(h.el('Pause').disabled,false);h.tick(500);assert.equal(h.el('Position').value,'0.5');
  h.set('Clip0Start','1e-');await h.click('UsageRefresh');assert.equal(h.el('Clip0Start').value,'1e-');assert.equal(h.document.activeElement,field);assert.equal(h.calls.length,0);
});
test('saved usage source is readonly exact parameter text, retaining source nodes caret and viewport across translation',async t=>{
  const h=await fixture(t,{model:clipModel(),usage:true});await h.open();await h.click('Clip0Usage');await h.click('UsageMatch1Source');const text=h.el('UsageSourceText'),start=text.selectionStart,end=text.selectionEnd;
  assert.equal(text.value.slice(start,end),JSON.stringify(id(20)));assert.ok(text.value.slice(0,start).includes(id(20)));assert.equal(h.document.activeElement,text);assert.match(h.el('UsageSourceField').textContent,/bindings\/1\/parameters\/arbitrary/);assert.match(h.el('UsageSourcePath').textContent,/documents\/behaviors\/demo.json/);assert.equal(text.getAttribute('lang'),'');assert.ok(text.getAttribute('readonly')!==null);text.scrollTop=41;text.scrollLeft=3;
  for(const language of ['en','ja','zh']){h.language(language);assert.equal(h.el('UsageSourceText'),text);assert.equal(h.document.activeElement,text);assert.equal(text.selectionStart,start);assert.equal(text.selectionEnd,end);assert.equal(text.scrollTop,41);assert.equal(text.scrollLeft,3);}
  text.selectionStart=0;text.selectionEnd=0;await h.click('UsageSourceLocate');assert.equal(text.selectionStart,start);assert.equal(text.selectionEnd,end);await h.click('UsageSourceDismiss');assert.equal(h.el('UsageSource').hidden,true);assert.equal(h.document.activeElement,h.el('UsageRefresh'));await h.click('UsageDismiss');assert.equal(h.el('Usage').hidden,true);assert.equal(h.document.activeElement,h.el('Clip0Usage'));assert.equal(h.content(),h.original);assert.equal(h.calls.length,0);
});
test('current unsaved clip identities can be queried and usage never prevents removing a referenced clip',async t=>{
  let h;h=await fixture(t,{model:clipModel(),usage:source=>{const future=h.el('Clip1Name')?.parentElement?.parentElement?.parentElement?.dataset.clipId;return usageCatalog(source,{content:JSON.stringify({format:'viento-scene-behaviors',schemaVersion:1,sceneObjectId:id(1),bindings:[{bindingId:id(100),instanceId:id(3),implementation:{backendId:'org.viento.godot4',language:'gdscript',sourceObjectId:id(90)},parameters:{future:future||id(20),saved:id(20)},events:[]}]})});}});await h.open();await h.click('AddClip');await h.click('Clip1Usage');assert.equal(h.el('UsageMatches').children.length,1);assert.match(h.el('UsageMatches').textContent,/future/);assert.equal(h.content(),h.original);await h.click('Clip0Usage');assert.equal(h.el('UsageMatches').children.length,1);const stale=h.el('UsageMatch0Source');await h.click('Clip0Remove');assert.equal(h.el('Usage').hidden,true);stale.dispatch('click');assert.equal(h.el('UsageSource').hidden,true);await h.click('Check');assert.equal(h.el('Apply').disabled,false);assert.equal(JSON.parse(h.el('After').textContent.replace(/^\ufeff/,'')).clips.length,1);
});
test('late usage results and old source controls lose authority after close source capability token or clip removal',async t=>{
  for(const action of ['close','source','capability','token','remove','dismiss']){
    const gate=deferred(),h=await fixture(t,{model:clipModel(),usage:(source,count)=>count===1?usageCatalog(source):gate.promise});await h.open();await h.click('Clip0Usage');const stale=h.el('UsageMatch0Source');await h.click('UsageMatch0Source');h.el('UsageRefresh').click();await h.settle();const source=h.usageCalls[1];
    if(action==='close'){await h.click('Cancel');await h.open();}if(action==='source'){h.context.sourceToken+='changed';h.controller.refresh();}if(action==='capability'){h.context.usageAvailable=false;h.controller.refresh();}if(action==='token'){h.context.usageToken+=':next';h.controller.refresh();}if(action==='remove')await h.click('Clip0Remove');if(action==='dismiss')await h.click('UsageDismiss');
    gate.resolve(usageCatalog(source));await h.settle();stale.dispatch('click');assert.equal(h.el('Usage').hidden,true,action);assert.equal(h.el('UsageSource').hidden,true,action);assert.equal(h.calls.length,0);assert.equal(h.content(),h.original);
  }
});
test('switching selected clip rejects the previous in-flight response and preserves unrelated inputs',async t=>{
  const first=deferred(),second=deferred(),document=clipModel();document.clips.push({...document.clips[0],id:id(21),name:'Other'});
  const h=await fixture(t,{model:document,usage:(_source,count)=>count===1?first.promise:second.promise});await h.open();h.el('Clip0Usage').click();await h.settle();h.el('Clip1Usage').click();await h.settle();assert.equal(h.usageCalls.length,2);h.set('Track0Key1X','1e-');first.resolve(usageCatalog(h.usageCalls[0]));await h.settle();assert.equal(h.el('UsageStatus').dataset.status,'loading');second.resolve(usageCatalog(h.usageCalls[1]));await h.settle();assert.equal(h.el('Usage').dataset.clipId,id(21));assert.equal(h.el('UsageMatches').children.length,2);assert.match(h.el('UsageMatches').textContent,/other/);assert.equal(h.el('Track0Key1X').value,'1e-');
});
test('usage differentiates no behavior no match and rejected catalog without changing review',async t=>{
  for(const mode of ['none','no-match','forged','wrong-source','error']){
    const h=await fixture(t,{model:clipModel(),usage:source=>{if(mode==='error')throw Error('no');if(mode==='none')return usageCatalog(source,{none:true});if(mode==='forged')return copy(usageCatalog(source));if(mode==='wrong-source')return usageCatalog({...source,token:'elsewhere'});return usageCatalog(source,{content:JSON.stringify({format:'viento-scene-behaviors',schemaVersion:1,sceneObjectId:id(1),bindings:[{bindingId:id(101),instanceId:id(3),implementation:{backendId:'org.viento.godot4',language:'gdscript',sourceObjectId:id(90)},parameters:{message:'embedded '+id(20)},events:[]}]})});}});
    await h.open();h.set('Clip0Name','Reviewed');await h.click('Check');const reviewed=h.el('After').textContent;await h.click('Clip0Usage');assert.equal(h.el('UsageMatches').children.length,0);assert.equal(h.el('After').textContent,reviewed);assert.equal(h.el('Apply').disabled,false);assert.equal(h.el('UsageStatus').dataset.status,['none','no-match'].includes(mode)?'ready':'failed');if(mode==='none')assert.match(h.el('UsageStatus').textContent,/没有关联/);if(mode==='no-match')assert.match(h.el('UsageStatus').textContent,/未在/);
  }
});
test('usage module remains readonly and all new messages have English and Japanese translations',async()=>{
  const source=await fs.readFile(new URL('../../web/modules/app-scene-animation-usage.js',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\(|applyDraft|createSceneAnimationProposal|requestAnimationFrame|app-state|\.write/);
  for(const key of [...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match=>match[1])){assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);}
});


test('retime transforms current unsaved sprite and clip times then follows full review and ordinary draft apply', async t => {
  const source = model(); source.schemaVersion = 3; source.clips = [{ id: id(80), name: 'Attack', startSeconds: 0.5, endSeconds: 2, loop: true }];
  source.tracks.push({ id: id(81), instanceId: id(3), property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 2, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 1, value: 2 }, { atSeconds: 2, value: 3 }] });
  const h = await fixture(t, { model: source }); await h.open(); h.set('Track0Key1X', '30'); h.set('Clip0Name', 'Unsaved attack'); h.set('RetimeDuration', '1');
  assert.equal(h.el('Duration').value, '2'); await h.click('RetimeApply');
  assert.equal(h.el('Duration').value, '1'); assert.equal(h.el('Track0Key1Time').value, '1'); assert.equal(h.el('Track0Key1X').value, '30');
  assert.equal(h.el('Track1Key1Time').value, '0.5'); assert.equal(h.el('Track1Key2X').value, '3'); assert.equal(h.el('Clip0Start').value, '0.25'); assert.equal(h.el('Clip0End').value, '1'); assert.equal(h.el('Clip0Name').value, 'Unsaved attack');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Play').disabled, true); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); const after = JSON.parse(h.el('After').textContent.replace(/^\ufeff/, ''));
  assert.equal(after.schemaVersion, 3); assert.equal(after.clips[0].id, id(80)); assert.equal(after.clips[0].loop, true); assert.deepEqual(after.tracks[1].grid, source.tracks[1].grid);
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.content().startsWith('\ufeff'), true); assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false); assert.deepEqual(await readSceneAnimationDocument(h.content()), after);
});
test('retime prepares the upgraded schema for unsaved sprite and clip additions', async t => {
  for (const kind of ['sprite', 'clip', 'both']) {
    const h = await fixture(t); await h.open();
    if (kind !== 'clip') h.set('Track0Property', 'spriteFrame2d', 'change');
    if (kind !== 'sprite') await h.click('AddClip');
    h.set('RetimeDuration', '4'); await h.click('RetimeApply'); assert.equal(h.el('Duration').value, '4', kind); assert.equal(h.el('Track0Key1Time').value, '4');
    await h.click('Check'); const after = JSON.parse(h.el('After').textContent.replace(/^\ufeff/, '')); assert.equal(after.schemaVersion, kind === 'sprite' ? 2 : 3); assert.equal(h.content(), h.original);
  }
});
test('invalid and unchanged retime retain reviewed bytes running preview and focused target input', async t => {
  const h = await fixture(t); await h.open(); h.set('Duration', '3'); await h.click('Check'); const review = h.el('After').textContent;
  await h.click('Play'); h.tick(1000); const preview = h.el('Values').textContent, position = h.el('Position').value, field = h.el('Track0Key1X');
  for (const target of ['61', '0', '1e', '3.0']) {
    h.set('RetimeDuration', target); const input = h.el('RetimeDuration'); input.focus(); input.selectionStart = 1; input.selectionEnd = target.length;
    assert.equal(h.el('After').textContent, review); await h.click('RetimeApply');
    assert.equal(h.el('Track0Key1X'), field); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Play').disabled, true); assert.equal(h.el('Pause').disabled, false);
    assert.equal(h.el('Values').textContent, preview); assert.equal(h.el('Position').value, position); assert.equal(h.document.activeElement, input); assert.equal(input.selectionStart, 1); assert.equal(input.value, target);
    assert.match(h.el('RetimeStatus').textContent, target === '3.0' ? /相同/ : /保留/);
  }
  assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('retime uses the raw duration meaning and does not repair invalid current keyframes', async t => {
  const h = await fixture(t); await h.open(); h.set('Duration', '1'); h.set('RetimeDuration', '4'); await h.click('RetimeApply');
  assert.equal(h.el('Duration').value, '1'); assert.equal(h.el('Track0Key1Time').value, '2'); assert.match(h.el('RetimeStatus').textContent, /无法/); assert.equal(h.content(), h.original);
  h.set('Duration', '4'); await h.click('RetimeApply'); assert.equal(h.el('Track0Key1Time').value, '2'); assert.match(h.el('RetimeStatus').textContent, /相同/);
});
test('retime awaits independently and discards results after form changes close reopen or capability withdrawal', async t => {
  for (const change of ['form', 'session', 'capability', 'source']) {
    const gate = deferred(), settings = { retime: async result => { await gate.promise; return result; } }, h = await fixture(t, settings); await h.open(); h.set('RetimeDuration', '4'); await h.click('RetimeApply');
    assert.equal(h.el('Track0Key1X').disabled, false); assert.equal(h.el('Check').disabled, false);
    if (change === 'form') h.set('Track0Key1X', '37');
    if (change === 'session') { await h.click('Cancel'); await h.open(); }
    if (change === 'capability') { settings.retimeAvailable = false; h.controller.refresh(); settings.retimeAvailable = true; h.controller.refresh(); }
    if (change === 'source') { h.context.sourceToken += ':new'; h.controller.refresh(); }
    gate.resolve(); await h.settle(); assert.equal(h.el('Duration').value, '2', change); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
    if (change === 'form') assert.equal(h.el('Track0Key1X').value, '37');
  }
});
test('retime legacy-core guard leaves ordinary edit check and apply available', async t => {
  const h = await fixture(t, { retimeAvailable: false }); await h.open(); assert.equal(h.el('RetimeApply').disabled, true); assert.equal(h.el('Track0Key1X').disabled, false);
  assert.match(h.el('RetimeStatus').textContent, /原有字段编辑/); h.set('Track0Key1X', '25'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.retimeCalls.length, 0);
});


test('copying a current unsaved track to an explicit saved instance creates one fresh track through ordinary review and draft apply', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle();
  assert.equal(h.el('TrackCopySource').value, ''); assert.equal(h.el('TrackCopyTarget').value, ''); assert.equal(h.el('TrackCopyApply').disabled, true);
  h.set('Track0Key1X', '38'); h.set('Duration', '3'); h.set('TrackCopySource', id(2), 'change'); h.set('TrackCopyTarget', id(4), 'change');
  assert.equal(h.copyCalls.length, 0); await h.click('TrackCopyApply'); assert.equal(h.copyCalls.length, 1); assert.equal(h.el('Track1Instance').value, id(4)); assert.equal(h.el('Track1Key1X').value, '38'); assert.equal(h.el('Track1Key1Time').value, '2');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Play').disabled, true); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  await h.click('Check'); const reviewed = await readSceneAnimationDocument(h.el('After').textContent); assert.equal(reviewed.durationSeconds, 3); assert.equal(reviewed.tracks[1].id, id(11)); assert.notEqual(reviewed.tracks[1].id, reviewed.tracks[0].id);
  assert.deepEqual({ ...reviewed.tracks[1], id: reviewed.tracks[0].id, instanceId: reviewed.tracks[0].instanceId }, reviewed.tracks[0]); assert.equal(reviewed.tracks[0].keyframes[1].value[0], 38);
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.content().startsWith('\ufeff'), true); assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false);
});
test('copying unsaved sprite and named clip additions preserves schema upgrades with the full current form', async t => {
  for (const kind of ['sprite', 'clip', 'both']) {
    const h = await fixture(t, { targets: true }); await h.open(); await h.settle();
    if (kind !== 'clip') { h.set('Track0Property', 'spriteFrame2d', 'change'); h.set('Track0Key1X', '3'); }
    if (kind !== 'sprite') await h.click('AddClip');
    h.set('TrackCopySource', id(2), 'change'); h.set('TrackCopyTarget', id(4), 'change'); await h.click('TrackCopyApply'); await h.click('Check');
    const after = await readSceneAnimationDocument(h.el('After').textContent); assert.equal(after.schemaVersion, kind === 'sprite' ? 2 : 3); assert.equal(after.tracks.length, 2); assert.deepEqual(after.tracks[1].keyframes, after.tracks[0].keyframes); assert.deepEqual(after.tracks[1].grid, after.tracks[0].grid);
    if (kind !== 'sprite') assert.equal(after.clips.length, 1); assert.equal(h.content(), h.original);
  }
});
test('track copy conflict and UUID exhaustion keep the previous review preview and selected controls', async t => {
  for (const settings of [{ targets: true }, { targets: true, uuid: () => id(2) }]) {
    const h = await fixture(t, settings); await h.open(); await h.settle(); h.set('Track0Key1X', '35'); await h.click('Check'); const review = h.el('After').textContent;
    await h.click('Play'); h.tick(1000); const sample = h.el('Values').textContent, field = h.el('Track0Key1X');
    h.set('TrackCopySource', id(2), 'change'); h.set('TrackCopyTarget', settings.uuid ? id(4) : id(3), 'change'); const target = h.el('TrackCopyTarget'); target.focus(); await h.click('TrackCopyApply');
    assert.equal(h.el('Track0Key1X'), field); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Pause').disabled, false); assert.equal(h.el('Values').textContent, sample); assert.equal(h.el('Track1Instance'), null); assert.equal(h.document.activeElement, target); assert.match(h.el('TrackCopyStatus').textContent, /已保留/);
    for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('TrackCopyTarget'), target); assert.equal(h.document.activeElement, target); assert.equal(h.el('TrackCopySource').value, id(2)); assert.equal(h.el('After').textContent, review); }
    assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  }
});
test('copy never accepts arbitrary target text or bypasses unavailable directories and old core', async t => {
  for (const settings of [{}, { targets: true, targetsAvailable: false }, { targets: async () => { throw Error('offline'); } }, { targets: true, copyAvailable: false }]) {
    const h = await fixture(t, settings); await h.open(); await h.settle(); assert.equal(h.el('TrackCopyApply').disabled, true); assert.equal(h.el('Track0Key1X').disabled, false);
    h.set('Track0Key1X', '26'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.copyCalls.length, 0);
  }
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle(); h.set('TrackCopySource', id(2), 'change'); h.set('TrackCopyTarget', id(88), 'change'); await h.click('TrackCopyApply'); assert.equal(h.copyCalls.length, 0); assert.equal(h.el('Track1Instance'), null);
});
test('late copies cannot replace edits after form source session directory or feature changes', async t => {
  for (const change of ['form', 'source', 'session', 'directory', 'directoryToken', 'capability']) {
    const gate = deferred(), settings = { targets: true, copyTrack: async result => { await gate.promise; return result; } }, h = await fixture(t, settings); await h.open(); await h.settle();
    h.set('TrackCopySource', id(2), 'change'); h.set('TrackCopyTarget', id(4), 'change'); await h.click('TrackCopyApply'); assert.equal(h.el('Check').disabled, false); assert.equal(h.el('Track0Key1X').disabled, false);
    if (change === 'form') h.set('Track0Key1X', '57');
    if (change === 'source') { h.context.sourceToken += ':other'; h.controller.refresh(); }
    if (change === 'session') { await h.click('Cancel'); await h.open(); await h.settle(); }
    if (change === 'directory') await h.click('TargetsRefresh');
    if (change === 'directoryToken') { h.context.targetsToken++; h.controller.refresh(); }
    if (change === 'capability') { settings.copyAvailable = false; h.controller.refresh(); settings.copyAvailable = true; h.controller.refresh(); }
    gate.resolve(); await h.settle(); assert.equal(h.el('Track1Instance'), null, change); if (change === 'form') assert.equal(h.el('Track0Key1X').value, '57'); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  }
});
