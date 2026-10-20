import { setupSceneBehaviorAnimationClips } from '../../web/modules/app-scene-behavior-animation-clips.js';
import { captureSceneBehaviorAnimationClips } from '../../engine/scene-animation-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { createSceneBehaviorProposal, isSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { captureSceneBehaviorAudioTracks, isSceneBehaviorAudioTracks, sceneBehaviorAudioTracksMatchSource, sceneBehaviorAudioTrackValue } from '../../engine/scene-audio-directory.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = content => 'sha256:' + createHash('sha256').update(content).digest('hex');
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
const binding = (number = 1) => ({ bindingId: id(100 + number), instanceId: id(200 + number),
  implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(301) },
  parameters: { title: 'east', amount: 10, enabled: true }, events: [{ signal: 'arrived', event: 'checkpoint' }] });
const model = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(2), bindings: [binding(1), binding(2)] });
const contextData = () => ({ format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: 'documents/behaviors/demo.json', objectId: id(1),
  scene: { objectId: id(2), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene'), instances: [1, 2].map(n => ({ instanceId: id(200 + n), objectId: id(3), name: 'Actor <b>' + n })) },
  sources: [1, 2].map(n => ({ objectId: id(300 + n), sourcePath: `documents/scripts/source${n}.txt`, sourceRevision: hash('source' + n), name: 'Script ' + n })), dependencyRevision: hash('dependencies') });
function audioDirectory(source, changes = {}) {
  const audio = { format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(2),
    tracks: [{ id: id(701), resourceId: id(801), role: 'music', volume: .2, loop: true },
      { id: id(702), resourceId: id(801), role: 'effect', volume: .4, loop: false }], cues: [] };
  const scene = { objectId: id(2), sourcePath: contextData().scene.sourcePath, sourceRevision: contextData().scene.sourceRevision };
  const content = JSON.stringify(audio);
  const raw = { format: 'viento-scene-audio-directory', schemaVersion: 1, status: 'ready', worldId: 'world:' + 'a'.repeat(64), revision: hash('directory'), scene,
    manifest: { objectId: id(901), sourcePath: 'documents/audio/demo.json', sourceRevision: hash(content), content }, ...changes };
  return captureSceneBehaviorAudioTracks(copy(source), raw, scene);
}
function animationDirectory(source, changes = {}) {
  const scene = { objectId: id(2), sourcePath: contextData().scene.sourcePath, sourceRevision: contextData().scene.sourceRevision };
  const document = { format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(2), durationSeconds: 2, loop: false,
    tracks: [{ id: id(700), instanceId: id(201), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }],
    clips: [1,2].map(n => ({ id: id(710+n), name: 'Same <b>', startSeconds: n === 1 ? 0 : .5, endSeconds: n === 1 ? 1 : 2, loop: n === 2 })), ...changes.document };
  const content = JSON.stringify(document), raw = { format: 'viento-scene-animation-directory', schemaVersion: 1, status: 'ready', worldId: 'world:' + 'a'.repeat(64), revision: hash('animation directory'), scene,
    manifest: { objectId: id(910), sourcePath: 'documents/animations/demo.json', sourceRevision: hash(content), content }, ...changes.raw };
  return captureSceneBehaviorAnimationClips(copy(source), raw, scene);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const original = settings.content ?? serialize(settings.model || model()); let content = original, language = 'zh', languageListener = () => {}, disposed = 0, ids = 0, loads = 0;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, behaviorSource: true, available: true,
    sourcePath: 'documents/behaviors/demo.json', sourceToken: 'load:1:draft:0', audioTracksAvailable: settings.audioAvailable === true, animationClipsAvailable: settings.animationAvailable === true };
  const calls = [], checks = [], proposals = [], confirms = [], focused = [], audioLoads = [], animationLoads = [], sourceClones = new WeakMap();
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, baseSourceRevision: hash(original), sourceRevision: hash(content), content });
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-behaviors', {
    setupSceneBehaviorAnimationClips: options => setupSceneBehaviorAnimationClips({ ...options, getContext: () => { const context = options.getContext(); if (context.source && !sourceClones.has(context.source)) sourceClones.set(context.source, copy(context.source)); return { ...context, source: context.source ? sourceClones.get(context.source) : undefined }; } }),
    inspectSceneBehaviors, isSceneBehaviorProposal, isSceneBehaviorAudioTracks, sceneBehaviorAudioTrackValue,
    sceneBehaviorAudioTracksMatchSource: (catalog, source) => sceneBehaviorAudioTracksMatchSource(catalog, copy(source)),
    createSceneBehaviorProposal: (source, edit) => { const proposal = createSceneBehaviorProposal(copy(source), copy(edit)); proposals.push(proposal); return settings.proposal ? settings.proposal(proposal) : proposal; },
    crypto: { randomUUID: () => { ids++; return settings.uuid || id(400 + ids); } },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { languageListener = listener; return () => { disposed++; languageListener = () => {}; }; },
  });
  h.runtime.window.confirm = value => { confirms.push(value); return settings.confirm?.() ?? true; };
  let controller;
  controller = h.runtime.setupSceneBehaviors({ getContext: () => context,
    getSource: async () => { loads++; return settings.source ? settings.source(snapshot()) : snapshot(); },
    ...(settings.audioPort === false ? {} : { getAudioTracks: async source => { audioLoads.push(copy(source)); return settings.audioTracks ? settings.audioTracks(copy(source), audioLoads.length) : audioDirectory(source); } }),
    ...(settings.animationPort === false ? {} : { getAnimationClips: async source => { animationLoads.push(copy(source)); return settings.animationClips ? settings.animationClips(copy(source), animationLoads.length) : animationDirectory(source); } }),
    inspect: async request => { checks.push(copy(request)); return settings.inspect ? settings.inspect(request, checks.length) : contextData(); },
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (settings.apply) return settings.apply(proposal, ports, { context, setContent: value => { content = value; }, refresh: () => controller.refresh() });
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied'; controller.refresh();
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: () => focused.push(true) };
    } });
  const el = suffix => h.element('sceneBehaviors' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); };
  const click = async suffix => { el(suffix).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, click, original, calls, checks, proposals, confirms, focused, snapshot, audioLoads, animationLoads,
    open: () => controller.open(), content: () => content, loads: () => loads, ids: () => ids, unsubscribed: () => disposed,
    language(value) { language = value; languageListener(); }, check: () => click('Check'), apply: () => click('Apply'),
    select: async value => { set('Binding', value, 'change'); await settle(); } };
}
const editTitle = h => h.set('Param0Value', 'changed');

test('entry is specific to existing behavior JSON and semantic-host availability, without execution-tool dependencies', async t => {
  const h = await fixture(t); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh']);
  assert.equal(h.el('Btn').hidden, false); assert.equal(h.el('Btn').disabled, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['behaviorSource', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  for (const [key, value] of [['available', false], ['busy', true]]) { const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false); h.context[key] = old; }
  assert.equal(h.loads(), 0); assert.equal(await h.open(), true); assert.equal(h.checks.length, 1); assert.equal(h.calls.length, 0);
});
test('opening shows fixed scene/backend/language and preserves the exact source and untouched draft', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true);
  assert.match(h.el('Fixed').textContent, /org.viento.godot4/); assert.match(h.el('Fixed').textContent, /gdscript/);
  assert.equal(h.el('Binding').children.length, 2); assert.equal(h.el('Source').children.length, 2); assert.equal(h.el('Instance').children.length, 2);
  assert.equal(h.el('Param0Value').value, 'east'); assert.equal(h.el('Param1Type').value, 'number'); assert.equal(h.el('Param2Value').value, 'true');
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original);
  assert.deepEqual(h.checks, [{ sourcePath: h.context.sourcePath, content: h.original }]);
});
test('typed false, zero and empty text survive review and apply only to the current unsaved source', async t => {
  const h = await fixture(t); await h.open(); h.set('Param0Value', ''); h.set('Param1Value', '0'); h.set('Param2Value', 'false', 'change');
  await h.check(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.checks.length, 2); assert.equal(h.calls.length, 0);
  assert.deepEqual(h.proposals[0].bindings[0].parameters, { title: '', amount: 0, enabled: false });
  assert.equal(h.el('Before').textContent, h.original); assert.equal(h.el('After').textContent, h.proposals[0].afterContent);
  await h.apply(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].ports.dependencyRevision, contextData().dependencyRevision);
  assert.equal(h.content(), h.proposals[0].afterContent); assert.equal(h.el('Dialog').open, false); assert.equal(h.focused.length, 1);
});
test('unfinished input survives binding changes and three-language rerender without a proposal or write', async t => {
  const h = await fixture(t); await h.open(); h.set('Param1Value', '1e-'); await h.select(id(102));
  assert.equal(h.el('Param1Value').value, '10'); h.set('Param0Value', 'second draft');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Param0Value').value, 'second draft'); }
  await h.select(id(101)); assert.equal(h.el('Param1Value').value, '1e-'); await h.check();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  assert.match(h.el('Diagnostic').textContent, /数字/);
});
test('text parameter CRLF and carriage returns stay exact across open, language changes and unrelated edits', async t => {
  const value = model(); value.bindings[0].parameters.title = 'one\r\ntwo\rthree\n'; const h = await fixture(t, { model: value }); await h.open();
  for (const language of ['en', 'ja', 'zh']) h.language(language);
  h.set('Param1Value', '0'); await h.check(); assert.equal(h.proposals[0].bindings[0].parameters.title, value.bindings[0].parameters.title);
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.content(), h.original);
});
test('valid alternate JSON key order retains exact untouched source while allowing a leaf edit', async t => {
  const value = model(); value.bindings = value.bindings.map(item => ({ events: item.events, parameters: item.parameters,
    implementation: { sourceObjectId: item.implementation.sourceObjectId, language: item.implementation.language, backendId: item.implementation.backendId },
    instanceId: item.instanceId, bindingId: item.bindingId }));
  const h = await fixture(t, { model: value }); await h.open(); h.set('Param1Value', '65'); await h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals[0].afterContent, h.original.replace('\"amount\": 10', '\"amount\": 65'));
});
test('one script remains independently bound to multiple instances and changing a source or instance is explicit', async t => {
  const h = await fixture(t); await h.open(); h.set('Instance', id(202), 'change'); h.set('Source', id(302), 'change'); await h.check();
  assert.equal(h.proposals[0].bindings[0].instanceId, id(202)); assert.equal(h.proposals[0].bindings[0].implementation.sourceObjectId, id(302));
  assert.deepEqual(h.proposals[0].bindings[1], model().bindings[1]);
});
test('adding a binding allocates one stable identity and removing preserves surviving identities and last-binding minimum', async t => {
  const h = await fixture(t); await h.open(); await h.click('AddBinding'); assert.equal(h.ids(), 1); const added = h.el('Binding').value;
  assert.equal(added, id(401)); assert.equal(h.el('Parameters').children.length, 0); assert.equal(h.el('Events').children.length, 0);
  for (const language of ['en', 'ja']) h.language(language); await h.select(id(101)); await h.select(added); assert.equal(h.ids(), 1);
  await h.check(); assert.equal(h.proposals[0].bindings[2].bindingId, added); assert.deepEqual(h.proposals[0].bindings[2].parameters, {});
  await h.click('RemoveBinding'); await h.click('RemoveBinding'); assert.equal(h.el('Binding').children.length, 1); assert.equal(h.el('RemoveBinding').disabled, true);
  h.el('RemoveBinding').dispatch('click'); assert.equal(h.el('Binding').children.length, 1); await h.check(); assert.equal(h.proposals.at(-1).bindings.length, 1);
});
test('new parameter and signal rows permit typed editing and removal without losing sibling data', async t => {
  const h = await fixture(t); await h.open(); await h.click('AddParameter'); h.set('Param3Name', 'ready'); h.set('Param3Type', 'boolean', 'change');
  assert.equal(h.el('Param3Value').value, ''); h.set('Param3Value', 'false', 'change'); await h.click('AddEvent');
  h.set('Event1Signal', 'stopped'); h.set('Event1Name', 'checkpoint'); await h.check();
  assert.equal(h.proposals[0].bindings[0].parameters.ready, false); assert.equal(h.proposals[0].bindings[0].events[1].event, 'checkpoint');
  await h.click('Param1Remove'); await h.click('Event0Remove'); await h.check();
  assert.equal(Object.hasOwn(h.proposals.at(-1).bindings[0].parameters, 'amount'), false);
  assert.deepEqual(h.proposals.at(-1).bindings[0].events, [{ signal: 'stopped', event: 'checkpoint' }]);
});
test('duplicate or reserved parameter names, incomplete numbers and duplicate signals cannot be approved', async t => {
  for (const [field, value] of [['Param1Name', 'title'], ['Param1Name', '__proto__'], ['Param1Name', 'constructor'], ['Param1Value', ''], ['Param1Value', '1e309'], ['Param1Value', '9007199254740992'], ['Param1Value', '0x10'], ['Param1Value', '01']]) {
    const h = await fixture(t); await h.open(); h.set(field, value); await h.check(); assert.equal(h.el('Apply').disabled, true, field + ':' + value); assert.equal(h.el(field).value, value); assert.equal(h.calls.length, 0);
  }
  const h = await fixture(t); await h.open(); await h.click('AddEvent'); h.set('Event1Signal', 'arrived'); h.set('Event1Name', 'other'); await h.check(); assert.equal(h.el('Apply').disabled, true);
});
test('input changes and silent DOM changes revoke approval including after language changes', async t => {
  for (const operation of ['event', 'silent-apply', 'silent-refresh', 'silent-language']) {
    const h = await fixture(t); await h.open(); editTitle(h); await h.check(); assert.equal(h.el('Apply').disabled, false);
    h.set('Param0Value', 'later', operation === 'event' ? 'input' : false);
    if (operation === 'silent-refresh') h.controller.refresh(); if (operation === 'silent-language') h.language('ja');
    await h.apply(); assert.equal(h.calls.length, 0, operation); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Param0Value').value, 'later');
  }
});
test('dependency changes and forged same-revision catalogs reject candidate approval without dropping edits', async t => {
  for (const change of ['revision', 'source', 'instance', 'object']) {
    const h = await fixture(t, { inspect: (request, count) => { const value = contextData(); if (count === 2) {
      if (change === 'revision') value.dependencyRevision = hash('changed'); if (change === 'source') value.sources[0].sourceRevision = hash('changed');
      if (change === 'instance') value.scene.instances[0].name = 'new name'; if (change === 'object') value.objectId = id(77);
    } return value; } }); await h.open(); editTitle(h); await h.check(); assert.equal(h.el('Apply').disabled, true, change); assert.equal(h.el('Param0Value').value, 'changed'); assert.equal(h.calls.length, 0);
  }
});
test('unknown catalog versions, missing dependencies and malformed source snapshots fail closed', async t => {
  for (const mutate of [v => { v.schemaVersion = 2; }, v => { v.format = 'unknown'; }, v => { v.extra = true; }, v => { v.sources = []; },
    v => { v.scene.instances[0].instanceId = id(999); }, v => { v.sources.push(copy(v.sources[0])); }, v => { v.scene.objectId = id(99); }, v => { v.dependencyRevision = 'fake'; }]) {
    const h = await fixture(t, { inspect: () => { const value = contextData(); mutate(value); return value; } }); assert.equal(await h.open(), false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.calls.length, 0);
  }
  const h = await fixture(t, { source: value => ({ ...value, token: 'old' }) }); assert.equal(await h.open(), false); assert.equal(h.checks.length, 0);
});
test('a normal JSON, unknown behavior schema or duplicate JSON keys cannot be rewritten through an accidentally enabled entry', async t => {
  for (const content of ['{"hello":1}', serialize({ ...model(), schemaVersion: 2 }), serialize(model()).replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,')]) {
    const h = await fixture(t, { content }); assert.equal(await h.open(), false); assert.equal(h.checks.length, 0); assert.equal(h.calls.length, 0);
  }
});
test('cloned proposals never become an approved review', async t => {
  const h = await fixture(t, { proposal: value => copy(value) }); await h.open(); editTitle(h); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.checks.length, 1);
});
test('late source reads cannot enter a closed, changed or disposed session', async t => {
  for (const change of ['close', 'token', 'path', 'capability', 'dispose']) {
    const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const snapshot = h.snapshot(), pending = h.open(); await h.settle();
    if (change === 'close') await h.click('Close'); if (change === 'token') h.context.sourceToken += ':new'; if (change === 'path') h.context.sourcePath = 'documents/other.json';
    if (change === 'capability') h.context.available = false; if (change === 'dispose') h.controller.dispose();
    gate.resolve(snapshot); assert.equal(await pending, false); assert.equal(h.checks.length, 0); assert.equal(h.calls.length, 0);
  }
});
test('late dependency checks cannot approve a changed form, source, capability, closed session or newer opening', async t => {
  for (const change of ['form', 'token', 'path', 'capability', 'busy', 'close', 'reopen', 'dispose']) {
    const gate = deferred(), h = await fixture(t, { inspect: (request, count) => count === 2 ? gate.promise : contextData() }); await h.open(); editTitle(h); h.el('Check').click(); await h.settle();
    assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true');
    if (change === 'form') h.set('Param0Value', 'silent late value', false);
    if (change === 'token') h.context.sourceToken += ':new'; if (change === 'path') h.context.sourcePath = 'documents/other.json'; if (change === 'capability') h.context.available = false; if (change === 'busy') h.context.busy = true;
    if (['close', 'reopen'].includes(change)) await h.click('Close'); if (change === 'reopen') await h.open(); if (change === 'dispose') h.controller.dispose();
    gate.resolve(contextData()); await h.settle(); assert.equal(h.calls.length, 0);
    if (change !== 'dispose') assert.equal(h.el('Apply').disabled, true, change);
  }
});
test('apply passes a live source/form guard that rejects edits or closing while the host waits', async t => {
  for (const change of ['form', 'token', 'available', 'close', 'dispose']) {
    const gate = deferred(), h = await fixture(t, { apply: async (proposal, ports) => { await gate.promise; assert.equal(ports.isCurrent(), false); return { applied: false }; } });
    await h.open(); editTitle(h); await h.check(); h.el('Apply').click(); await h.settle();
    if (change === 'form') h.set('Param0Value', 'silent changed', false); if (change === 'token') h.context.sourceToken += ':new'; if (change === 'available') h.context.available = false;
    if (change === 'close') await h.click('Close'); if (change === 'dispose') h.controller.dispose(); gate.resolve(); await h.settle(); assert.equal(h.content(), h.original);
  }
});
test('failed or mismatched application receipts retain the form and never report successful application', async t => {
  for (const receipt of [{ applied: false }, { applied: true, sourcePath: 'documents/other.json', sourceToken: 'later', content: 'fake' }]) {
    const h = await fixture(t, { apply: () => receipt }); await h.open(); editTitle(h); await h.check(); await h.apply();
    assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Param0Value').value, 'changed'); assert.equal(h.content(), h.original); assert.equal(h.focused.length, 0);
  }
});
test('close and Escape require explicit discard for a dirty form and never write the author source', async t => {
  let accept = false; const h = await fixture(t, { confirm: () => accept }); await h.open(); editTitle(h); await h.click('Close');
  assert.equal(h.el('Dialog').open, true); assert.equal(h.confirms.length, 1);
  h.el('Dialog').dispatch('keydown', { key: 'Escape', isComposing: true }); assert.equal(h.confirms.length, 1);
  h.el('Dialog').dispatch('keydown', { key: 'Escape', repeat: true }); assert.equal(h.confirms.length, 1);
  h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(h.el('Dialog').open, true); accept = true;
  h.el('Dialog').dispatch('cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('busy state disables all mutations and explicit handlers also refuse synthetic clicks', async t => {
  const h = await fixture(t); await h.open(); editTitle(h); await h.check(); h.context.busy = true; h.controller.refresh();
  const count = h.el('Binding').children.length; for (const action of ['AddBinding', 'RemoveBinding', 'AddParameter', 'AddEvent', 'Check', 'Apply']) { assert.equal(h.el(action).disabled, true); h.el(action).dispatch('click'); }
  await h.settle(); assert.equal(h.el('Binding').children.length, count); assert.equal(h.calls.length, 0); assert.equal(h.ids(), 0);
});
test('binding and row budgets disable additions while preserving current content', async t => {
  const value = model(); value.bindings = Array.from({ length: 32 }, (_, n) => ({ ...binding(1), bindingId: id(500 + n) }));
  value.bindings[0].parameters = Object.fromEntries(Array.from({ length: 32 }, (_, n) => ['p' + n, n]));
  value.bindings[0].events = Array.from({ length: 8 }, (_, n) => ({ signal: 's' + n, event: 'e' + n }));
  const h = await fixture(t, { model: value }); await h.open();
  for (const action of ['AddBinding', 'AddParameter', 'AddEvent']) { assert.equal(h.el(action).disabled, true); h.el(action).dispatch('click'); }
  assert.equal(h.ids(), 0); assert.equal(h.el('Parameters').children.length, 32); assert.equal(h.el('Events').children.length, 8);
});
test('dynamic source text is displayed literally and every new fixed message has both translations', async t => {
  const h = await fixture(t); await h.open(); h.set('Param0Value', '<script>not executable</script>'); await h.check();
  assert.ok(h.el('After').textContent.includes('<script>')); assert.equal(h.el('After').querySelector('script'), null); assert.equal(h.el('Instance').querySelector('b'), null);
  const source = await fs.readFile(new URL('../../web/modules/app-scene-behaviors.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^\"]+)"/g)].map(match => match[1]));
  for (const key of ['编辑场景行为', '检查行为修改', '请选择布尔值', '核对行为依赖', '行为修改已应用到原文草稿；尚未保存。', '行为修改已应用；文本与已保存版本一致。']) keys.add(key);
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Btn').textContent, ({ en, ja }[language]?.['编辑场景行为'] || '编辑场景行为')); assert.equal(h.el('Param0Value').value, '<script>not executable</script>'); }
  h.controller.dispose(); assert.equal(h.unsubscribed(), 1);
});


test('audio ID picker is opt-in and does not affect ordinary editing when its capability or port is missing', async t => {
  for (const settings of [{}, { audioAvailable: true, audioPort: false }, { audioAvailable: false }]) {
    const h = await fixture(t, settings); await h.open(); assert.equal(h.el('AudioTracksTools').hidden, true);
    h.el('LoadAudioTracks').dispatch('click'); await h.settle(); assert.equal(h.audioLoads.length, 0);
    editTitle(h); await h.check(); assert.equal(h.el('Apply').disabled, false); await h.apply(); assert.equal(h.calls.length, 1);
  }
});
test('loading tracks exposes authored ordering, roles, full IDs and source without changing text, dirty state or review', async t => {
  const h = await fixture(t, { audioAvailable: true }); await h.open(); assert.equal(h.el('AudioTracksTools').hidden, false);
  assert.equal(h.el('Param0AudioTrack'), null); await h.click('LoadAudioTracks');
  assert.equal(h.audioLoads.length, 1); assert.deepEqual(h.audioLoads[0], h.snapshot());
  assert.equal(h.el('AudioTracksStatus').dataset.status, 'ready'); assert.match(h.el('AudioTracksPath').textContent, /documents\/audio\/demo\.json/);
  assert.deepEqual(h.el('Param0AudioTrack').children.map(item => item.value), ['', id(701), id(702)]);
  assert.match(h.el('Param0AudioTrack').children[1].textContent, new RegExp('1.*音乐.*' + id(701)));
  assert.match(h.el('Param0AudioTrack').children[2].textContent, new RegExp('2.*音效.*' + id(702)));
  assert.equal(h.el('Param1AudioTrack'), null); assert.equal(h.el('Param2AudioTrack'), null);
  assert.equal(h.el('Param0AudioTrack').value, ''); assert.equal(h.el('Param0UseAudioTrack').disabled, true);
  assert.equal(h.el('Param0Value').value, 'east'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true);
  assert.equal(h.calls.length, 0); assert.equal(h.proposals.length, 0); assert.equal(h.content(), h.original);
});
test('any string name accepts explicit insertion while selecting alone preserves an approved review', async t => {
  const h = await fixture(t, { audioAvailable: true }); await h.open(); h.set('Param0Name', 'arbitrary_description'); h.set('Param0Value', 'original text'); await h.check();
  const approved = h.el('After').textContent; await h.click('LoadAudioTracks'); h.set('Param0AudioTrack', id(702), 'change');
  assert.equal(h.el('Param0Value').value, 'original text'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('After').textContent, approved);
  await h.click('Param0UseAudioTrack'); assert.equal(h.el('Param0Value').value, id(702)); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  assert.equal(h.document.activeElement, h.el('Param0Value')); assert.equal(h.calls.length, 0); await h.check();
  assert.equal(h.proposals.at(-1).bindings[0].parameters.arbitrary_description, id(702)); await h.apply(); assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(h.content().replace(/^\ufeff/, '')).bindings[0].parameters.arbitrary_description, id(702));
});
test('audio selections and unfinished text survive language changes and binding switches without guessing a default', async t => {
  const h = await fixture(t, { audioAvailable: true }); await h.open(); await h.click('LoadAudioTracks');
  h.set('Param0AudioTrack', id(701), 'change'); h.set('Param1Value', '1e-'); h.set('Param0Value', 'unfinished first');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Param0AudioTrack').value, id(701)); assert.equal(h.el('Param1Value').value, '1e-'); }
  await h.select(id(102)); assert.equal(h.el('Param0AudioTrack').value, ''); h.set('Param0AudioTrack', id(702), 'change'); h.set('Param0Value', 'unfinished second');
  await h.select(id(101)); assert.equal(h.el('Param0AudioTrack').value, id(701)); assert.equal(h.el('Param0Value').value, 'unfinished first'); assert.equal(h.el('Param1Value').value, '1e-');
  await h.select(id(102)); assert.equal(h.el('Param0AudioTrack').value, id(702)); assert.equal(h.el('Param0Value').value, 'unfinished second');
  assert.equal(h.audioLoads.length, 1); assert.equal(h.proposals.length, 0); assert.equal(h.content(), h.original);
});
test('empty, forged and failed track directories preserve form and review and permit an explicit retry', async t => {
  for (const scenario of ['empty', 'forged', 'failure', 'wrong-source', 'wrong-scene-revision']) {
    const h = await fixture(t, { audioAvailable: true, audioTracks: (source, count) => {
      if (count > 1) return audioDirectory(source);
      if (scenario === 'empty') return audioDirectory(source, { status: 'empty', manifest: null });
      if (scenario === 'forged') return copy(audioDirectory(source));
      if (scenario === 'failure') throw Error('Unavailable');
      if (scenario === 'wrong-source') return audioDirectory({ ...source, token: source.token + ':old' });
      const catalog = audioDirectory(source); return { ...catalog, scene: { ...catalog.scene, sourceRevision: hash('other scene') } };
    } });
    await h.open(); editTitle(h); await h.check(); const approved = h.el('After').textContent; await h.click('LoadAudioTracks');
    assert.equal(h.el('AudioTracksStatus').dataset.status, scenario === 'empty' ? 'empty' : 'error', scenario);
    assert.equal(h.el('Param0AudioTrack'), null); assert.equal(h.el('Param0Value').value, 'changed'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('After').textContent, approved);
    await h.click('LoadAudioTracks'); assert.equal(h.el('AudioTracksStatus').dataset.status, 'ready'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.audioLoads.length, 2);
    assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  }
});
test('track loading only locks its controls, prevents duplicate reads and permits checking or applying ordinary edits', async t => {
  for (const action of ['check', 'apply']) {
    const gate = deferred(), h = await fixture(t, { audioAvailable: true, audioTracks: () => gate.promise }); await h.open(); editTitle(h);
    if (action === 'apply') await h.check(); h.el('LoadAudioTracks').click(); await h.settle(); const requested = h.audioLoads[0];
    assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'false'); assert.equal(h.el('AudioTracksTools').getAttribute('aria-busy'), 'true'); assert.equal(h.el('LoadAudioTracks').disabled, true);
    assert.equal(h.el('Param0Value').disabled, false); assert.equal(h.el('Binding').disabled, false); assert.equal(h.el(action === 'check' ? 'Check' : 'Apply').disabled, false);
    h.el('LoadAudioTracks').dispatch('click'); await h.settle(); assert.equal(h.audioLoads.length, 1);
    await h[action](); gate.resolve(audioDirectory(requested)); await h.settle();
    if (action === 'check') { assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('AudioTracksStatus').dataset.status, 'ready'); }
    else { assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').open, false); }
  }
});
test('late directory reads never populate a closed, reopened, disposed or differently owned source', async t => {
  for (const mutation of ['close', 'reopen', 'dispose', 'path', 'token', 'capability', 'busy']) {
    const gate = deferred(), h = await fixture(t, { audioAvailable: true, audioTracks: () => gate.promise }); await h.open(); h.el('LoadAudioTracks').click(); await h.settle();
    const requested = h.audioLoads[0];
    if (mutation === 'close' || mutation === 'reopen') await h.click('Close'); if (mutation === 'reopen') await h.open();
    if (mutation === 'dispose') h.controller.dispose(); if (mutation === 'path') h.context.sourcePath = 'documents/other.json';
    if (mutation === 'token') h.context.sourceToken += ':changed'; if (mutation === 'capability') h.context.audioTracksAvailable = false; if (mutation === 'busy') h.context.busy = true;
    if (mutation !== 'dispose') h.controller.refresh(); gate.resolve(audioDirectory(requested)); await h.settle();
    if (mutation !== 'dispose') { assert.notEqual(h.el('AudioTracksStatus').dataset.status, 'ready', mutation); assert.equal(h.el('Param0AudioTrack'), null); }
    assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
  }
});
test('loading across form edits or a binding change only offers choices in the current row and retains all entered text', async t => {
  const gate = deferred(), h = await fixture(t, { audioAvailable: true, audioTracks: () => gate.promise }); await h.open(); h.el('LoadAudioTracks').click(); await h.settle();
  h.set('Param0Value', 'first waiting'); await h.select(id(102)); h.set('Param0Value', 'second waiting'); const input = h.el('Param0Value'); input.focus();
  gate.resolve(audioDirectory(h.audioLoads[0])); await h.settle(); assert.equal(h.el('Param0Value'), input); assert.equal(h.document.activeElement, input);
  assert.equal(h.el('Param0Value').value, 'second waiting'); assert.equal(h.el('Param0AudioTrack').value, '');
  h.set('Param0AudioTrack', id(702), 'change'); await h.click('Param0UseAudioTrack'); await h.select(id(101)); assert.equal(h.el('Param0Value').value, 'first waiting');
  assert.equal(h.el('Param0AudioTrack').value, ''); await h.select(id(102)); assert.equal(h.el('Param0Value').value, id(702));
});
test('parameter identity prevents detached row controls from filling another row after removal, type change or binding change', async t => {
  for (const mutation of ['remove', 'type', 'binding']) {
    const h = await fixture(t, { audioAvailable: true }); await h.open(); await h.click('AddParameter'); h.set('Param3Name', 'next'); h.set('Param3Value', 'survivor');
    await h.click('LoadAudioTracks'); h.set('Param0AudioTrack', id(701), 'change'); h.set('Param3AudioTrack', id(702), 'change'); const stale = h.el('Param0UseAudioTrack');
    if (mutation === 'remove') await h.click('Param0Remove'); if (mutation === 'type') h.set('Param0Type', 'number', 'change');
    if (mutation === 'binding') await h.select(id(102));
    stale.dispatch('click'); await h.settle(); assert.notEqual(h.el('Param0Value').value, id(701), mutation);
    if (mutation === 'remove') { assert.equal(h.el('Param2AudioTrack').value, id(702)); await h.click('Param2UseAudioTrack'); assert.equal(h.el('Param2Value').value, id(702)); }
    if (mutation === 'type') assert.equal(h.el('Param0AudioTrack'), null);
    assert.equal(h.calls.length, 0);
  }
});
test('reloading does not write selected values and failure disables old choices without dropping approved edits', async t => {
  const h = await fixture(t, { audioAvailable: true, audioTracks: (source, count) => { if (count === 2) throw Error('retry'); return audioDirectory(source); } });
  await h.open(); editTitle(h); await h.check(); await h.click('LoadAudioTracks'); h.set('Param0AudioTrack', id(701), 'change'); const stale = h.el('Param0UseAudioTrack');
  await h.click('LoadAudioTracks'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Param0Value').value, 'changed');
  assert.equal(h.el('Param0AudioTrack').disabled, true); stale.dispatch('click'); assert.equal(h.el('Param0Value').value, 'changed');
  await h.click('LoadAudioTracks'); assert.equal(h.el('Param0AudioTrack').value, id(701)); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.el('Param0Value').value, 'changed'); await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('forged option values and silently replaced choices cannot write arbitrary text through the track picker', async t => {
  const h = await fixture(t, { audioAvailable: true }); await h.open(); await h.click('LoadAudioTracks');
  h.set('Param0AudioTrack', id(999), 'change'); h.el('Param0UseAudioTrack').dispatch('click'); assert.equal(h.el('Param0Value').value, 'east');
  await h.click('LoadAudioTracks'); h.set('Param0AudioTrack', id(701), 'change'); h.set('Param0AudioTrack', id(702), false); h.el('Param0UseAudioTrack').dispatch('click');
  assert.equal(h.el('Param0Value').value, 'east'); assert.equal(h.calls.length, 0);
});
test('audio ID picker strings and status remain translated while current text and selection survive', async t => {
  const h = await fixture(t, { audioAvailable: true }); await h.open(); await h.click('LoadAudioTracks'); h.set('Param0AudioTrack', id(701), 'change'); h.set('Param0Value', '中 English 日本語');
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); const dictionary = { en, ja }[language];
    for (const [suffix, key] of [['LoadAudioTracks', '读取场景音轨'], ['Param0UseAudioTrack', '填入音轨编号']]) assert.equal(h.el(suffix).textContent, dictionary?.[key] || key);
    assert.equal(h.el('Param0AudioTrack').value, id(701)); assert.equal(h.el('Param0Value').value, '中 English 日本語');
    assert.ok(h.el('Param0AudioTrack').children[1].textContent.includes(dictionary?.['音乐'] || '音乐'));
  }
  const source = await fs.readFile(new URL('../../web/modules/app-scene-behaviors.js', import.meta.url), 'utf8');
  for (const key of [...source.matchAll(/(?:t|removeButton|field)\('([^']+)'/g)].map(match => match[1]).filter(key => /音轨|声音来源/.test(key))) {
    assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key);
  }
});

test('animation clip discovery is opt-in and lists duplicate names with source range and full IDs only for string parameters',async t=>{
  for(const settings of [{},{animationAvailable:true,animationPort:false}]){const h=await fixture(t,settings);await h.open();assert.equal(h.el('AnimationClipsTools').hidden,true);h.el('LoadAnimationClips').dispatch('click');await h.settle();assert.equal(h.animationLoads.length,0);}
  const h=await fixture(t,{animationAvailable:true});await h.open();assert.equal(h.el('Param0AnimationClip'),null);await h.click('LoadAnimationClips');
  assert.deepEqual(h.animationLoads,[h.snapshot()]);assert.equal(h.el('AnimationClipsStatus').dataset.status,'ready');assert.match(h.el('AnimationClipsPath').textContent,/documents\/animations\/demo.json/);
  assert.deepEqual(h.el('Param0AnimationClip').children.map(item=>item.value),['',id(711),id(712)]);assert.match(h.el('Param0AnimationClip').children[2].textContent,new RegExp('Same <b>.*0.5.*2.*'+id(712)));
  assert.equal(h.el('Param0AnimationClip').querySelector('b'),null);assert.equal(h.el('Param1AnimationClip'),null);assert.equal(h.el('Param2AnimationClip'),null);assert.equal(h.el('Dialog').dataset.dirty,'false');
});
test('only explicit clip insertion changes an arbitrary text parameter and ordinary review applies an unsaved draft',async t=>{
  const h=await fixture(t,{animationAvailable:true});await h.open();h.set('Param0Name','arbitrary_description');h.set('Param0Value','original text');await h.check();const approved=h.el('After').textContent;
  await h.click('LoadAnimationClips');h.set('Param0AnimationClip',id(712),'change');assert.equal(h.el('Param0Value').value,'original text');assert.equal(h.el('After').textContent,approved);assert.equal(h.el('Apply').disabled,false);
  await h.click('Param0UseAnimationClip');assert.equal(h.el('Param0Value').value,id(712));assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Review').hidden,true);assert.equal(h.document.activeElement,h.el('Param0Value'));
  await h.check();await h.apply();assert.equal(h.calls.length,1);assert.equal(JSON.parse(h.content().replace(/^\ufeff/,'')).bindings[0].parameters.arbitrary_description,id(712));assert.ok(h.content().startsWith('\ufeff'));assert.equal(h.content().replaceAll('\r\n','').includes('\n'),false);
});
test('clip reads selections errors and translations preserve focused incomplete input and an unrelated approved review',async t=>{
  const h=await fixture(t,{animationAvailable:true,audioAvailable:true,animationClips:(source,count)=>{if(count===2)throw Error('offline');return animationDirectory(source);}});await h.open();editTitle(h);await h.check();const approved=h.el('After').textContent;
  await h.click('LoadAnimationClips');await h.click('LoadAudioTracks');h.set('Param0AnimationClip',id(711),'change');h.set('Param0AudioTrack',id(701),'change');const value=h.el('Param0Value'),selector=h.el('Param0AnimationClip');value.focus();value.selectionStart=1;value.selectionEnd=3;
  for(const language of ['en','ja','zh']){h.language(language);assert.equal(h.el('Param0Value'),value);assert.equal(h.document.activeElement,value);assert.equal(value.selectionStart,1);assert.equal(value.selectionEnd,3);assert.equal(h.el('Param0AnimationClip'),selector);assert.equal(selector.value,id(711));assert.equal(h.el('Param0AudioTrack').value,id(701));assert.equal(h.el('After').textContent,approved);assert.equal(h.el('Apply').disabled,false);}
  await h.click('LoadAnimationClips');assert.equal(h.el('AnimationClipsStatus').dataset.status,'error');assert.equal(h.el('After').textContent,approved);assert.equal(h.document.activeElement,value);assert.equal(value.selectionEnd,3);
  await h.click('LoadAnimationClips');h.set('Param1Value','1e-');const incomplete=h.el('Param1Value');incomplete.focus();incomplete.selectionStart=1;incomplete.selectionEnd=2;await h.click('LoadAnimationClips');h.language('ja');assert.equal(h.el('Param1Value'),incomplete);assert.equal(incomplete.value,'1e-');assert.equal(h.document.activeElement,incomplete);assert.equal(incomplete.selectionEnd,2);assert.equal(h.calls.length,0);
});
test('missing animation and empty legacy clip catalog have distinct messages without touching an approved review',async t=>{
  for(const mode of ['empty','legacy1','legacy2','clips-empty','forged','wrong-source','error']){
    const h=await fixture(t,{animationAvailable:true,animationClips:source=>{
      if(mode==='error')throw Error('no');if(mode==='forged')return copy(animationDirectory(source));if(mode==='wrong-source')return animationDirectory({...source,token:'other'});
      if(mode==='empty')return animationDirectory(source,{raw:{status:'empty',manifest:null}});
      if(mode.startsWith('legacy')){const doc={schemaVersion:Number(mode.at(-1)),clips:undefined};return animationDirectory(source,{document:doc});}
      return animationDirectory(source,{document:{clips:[]}});
    }});await h.open();editTitle(h);await h.check();const approved=h.el('After').textContent;await h.click('LoadAnimationClips');assert.equal(h.el('Param0AnimationClip'),null,mode);assert.equal(h.el('After').textContent,approved);assert.equal(h.el('Apply').disabled,false);
    if(mode==='empty')assert.match(h.el('AnimationClipsStatus').textContent,/未关联/);else if(mode.startsWith('legacy')||mode==='clips-empty')assert.match(h.el('AnimationClipsStatus').textContent,/没有命名片段/);else assert.equal(h.el('AnimationClipsStatus').dataset.status,'error');
  }
});
test('old clip responses and detached insertion buttons cannot target another row binding source or reopened session',async t=>{
  for(const mutation of ['remove','type','binding','source','capability','close']){
    const gate=deferred(),h=await fixture(t,{animationAvailable:true,animationClips:(source,count)=>count===1?animationDirectory(source):gate.promise});await h.open();await h.click('AddParameter');h.set('Param3Name','remaining');h.set('Param3Value','untouched');await h.click('LoadAnimationClips');h.set('Param0AnimationClip',id(711),'change');const old=h.el('Param0UseAnimationClip');h.el('LoadAnimationClips').click();await h.settle();const source=h.animationLoads[1];
    if(mutation==='remove')await h.click('Param0Remove');if(mutation==='type')h.set('Param0Type','number','change');if(mutation==='binding')await h.select(id(102));if(mutation==='source'){h.context.sourceToken+=':other';h.controller.refresh();}if(mutation==='capability'){h.context.animationClipsAvailable=false;h.controller.refresh();}if(mutation==='close'){await h.click('Cancel');await h.open();}
    old.dispatch('click');gate.resolve(animationDirectory(source));await h.settle();assert.notEqual(h.el('Param0Value').value,id(711),mutation);assert.equal(h.calls.length,0);assert.equal(h.el('AnimationClipsTools').getAttribute('aria-busy'),'false');
    if(['close','source','capability'].includes(mutation))assert.equal(h.el('Param0AnimationClip'),null);
  }
});
test('a changed clip list revokes selection without writing and silent or forged choice never inserts',async t=>{
  const h=await fixture(t,{animationAvailable:true,animationClips:(source,count)=>count===1?animationDirectory(source):animationDirectory(source,{document:{clips:[{id:id(713),name:'Replacement',startSeconds:0,endSeconds:1,loop:false}]}})});await h.open();await h.click('LoadAnimationClips');h.set('Param0AnimationClip',id(711),'change');h.set('Param0AnimationClip',id(712),false);h.el('Param0UseAnimationClip').dispatch('click');assert.equal(h.el('Param0Value').value,'east');
  await h.click('LoadAnimationClips');assert.equal(h.el('Param0AnimationClip').value,'');assert.equal(h.el('Param0UseAnimationClip').disabled,true);h.set('Param0AnimationClip',id(999),'change');h.el('Param0UseAnimationClip').dispatch('click');assert.equal(h.el('Param0Value').value,'east');assert.equal(h.content(),h.original);
});
test('all fixed animation clip picker messages have unambiguous English and Japanese keys',async()=>{
  const source=await fs.readFile(new URL('../../web/modules/app-scene-behavior-animation-clips.js',import.meta.url),'utf8');
  const keys=new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match=>match[1]));keys.add('读取场景动画片段');for(const key of keys){assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);}
  assert.doesNotMatch(source,/fetch\(|applyDraft|app-state|window\.|getCurrentEditContent|scene-preview/);
});
