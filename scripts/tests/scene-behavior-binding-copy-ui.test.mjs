import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { createSceneBehaviorProposal, isSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
const noop = () => ({ refresh() {}, reset() {}, dispose() {} });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const binding = (number = 1) => ({ bindingId: id(100 + number), instanceId: id(200 + (number % 2 ? 1 : 2)),
  implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(301) },
  parameters: { text: '  authored\r\nline\rthird\n  ', amount: 10, enabled: true, empty: '', target_instance_id: id(201), zero: 2, negative_zero: 0 },
  events: [{ signal: 'arrived', event: 'checkpoint' }, { signal: 'departed', event: 'leave' }] });
const model = (count = 2) => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(2), bindings: Array.from({ length: count }, (_, i) => binding(i + 1)) });
function catalog() {
  return { format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: 'documents/behaviors/demo.json', objectId: id(1),
    scene: { objectId: id(2), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('saved scene'), instances: [
      { instanceId: id(201), objectId: id(3), name: 'Same <b>actor</b>' },
      { instanceId: id(202), objectId: id(3), name: 'Same <b>actor</b>' },
      { instanceId: id(203), objectId: id(4), name: 'Third actor' },
    ] }, sources: [1, 2].map(number => ({ objectId: id(300 + number), sourcePath: `documents/scripts/source${number}.txt`, sourceRevision: hash('source ' + number), name: 'Script ' + number })),
    dependencyRevision: hash('saved ordinary dependencies') };
}
async function fixture(t, settings = {}) {
  const initialModel = settings.model || model(), original = settings.content ?? serialize(initialModel);
  let content = original, language = 'zh', languageListener = () => {}, allocations = 0, referenceHelper;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, behaviorSource: true, available: true,
    sourcePath: 'documents/behaviors/demo.json', sourceToken: 'binding-copy:1', referencesAvailable: true, audioTracksAvailable: false, animationClipsAvailable: false };
  const proposals = [], checks = [], writes = [], generatedIds = [], confirmations = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-behaviors', {
    inspectSceneBehaviors, isSceneBehaviorProposal,
    createSceneBehaviorProposal: (source, edit) => { const proposal = createSceneBehaviorProposal(clone(source), clone(edit)); proposals.push(proposal); return proposal; },
    setupSceneBehaviorParameters: noop, setupSceneBehaviorStateBindings: noop, setupSceneBehaviorAnimationClips: noop,
    setupSceneBehaviorReferences: options => { referenceHelper = options; return noop(); },
    crypto: { randomUUID: () => { allocations++; const value = typeof settings.uuid === 'function' ? settings.uuid(allocations) : settings.uuid ?? id(400 + allocations); generatedIds.push(value); return value; } },
    t: translate, translatePage: root => { for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = translate(element.dataset.i18n); },
    onLanguageChange: listener => { languageListener = listener; return () => { languageListener = () => {}; }; },
  });
  h.runtime.window.confirm = message => { confirmations.push(message); return settings.confirm ?? true; };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, baseSourceRevision: hash(original), sourceRevision: hash(content), content });
  let controller;
  controller = h.runtime.setupSceneBehaviors({ getContext: () => context,
    getSource: async () => settings.source ? settings.source(snapshot()) : snapshot(),
    inspect: async request => { checks.push(clone(request)); return settings.inspect ? settings.inspect(request, checks.length) : catalog(); },
    applyDraft: async (proposal, ports) => {
      assert.equal(ports.isCurrent(), true); writes.push(proposal); content = proposal.afterContent; context.sourceToken += ':applied'; controller.refresh();
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus() {} };
    } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('sceneBehaviors' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); };
  const click = async suffix => { el(suffix).click(); await settle(); };
  const rows = () => el('Parameters').children.map((_, index) => ({ name: el(`Param${index}Name`).value, type: el(`Param${index}Type`).value, value: el(`Param${index}Value`).value }));
  const events = () => el('Events').children.map((_, index) => ({ signal: el(`Event${index}Signal`).value, event: el(`Event${index}Name`).value }));
  const select = async value => { set('Binding', value, 'change'); await settle(); };
  const target = value => set('CopyTarget', value, 'change');
  return { ...h, context, controller, initialModel, original, proposals, checks, writes, generatedIds, confirmations, snapshot, el, set, click, rows, events, select, target, settle,
    open: () => controller.open(), content: () => content, language: value => { language = value; languageListener(); },
    helperRows: () => referenceHelper.getContext().rows, useOldReference: (row, value) => referenceHelper.onUse(row, value) };
}

function rawBinding(content, index) { const range = locateJsonSource(parseJsonSource(content), `/bindings/${index}`); assert.equal(range.exact, true); return content.slice(range.start, range.end); }
function review(h) { return { before: h.el('Before').textContent, after: h.el('After').textContent, hidden: h.el('Review').hidden, disabled: h.el('Apply').disabled }; }

test('binding copy lists stable scene instance identities with no inferred target or document change', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true);
  assert.equal(h.el('CopyTools').hidden, false); assert.equal(h.el('CopyTarget').value, ''); assert.equal(h.el('CopyBinding').disabled, true);
  assert.deepEqual(h.el('CopyTarget').children.map(option => option.value), ['', id(201), id(202), id(203)]);
  for (const [index, item] of catalog().scene.instances.entries()) {
    const label = h.el('CopyTarget').children[index + 1];
    assert.ok(label.textContent.includes(String(index + 1))); assert.ok(label.textContent.includes(item.name));
    assert.ok(label.textContent.includes(item.objectId)); assert.ok(label.textContent.includes(item.instanceId)); assert.equal(label.querySelector('b'), null);
  }
  h.target(id(202)); assert.equal(h.el('CopyBinding').disabled, false);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Binding').children.length, 2);
  assert.deepEqual(h.generatedIds, []); assert.equal(h.proposals.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('choosing and translating a copy target preserves existing form focus selection and approved review', async t => {
  const h = await fixture(t); await h.open(); h.set('Param1Value', '30'); await h.click('Check');
  const approved = review(h), input = h.el('Param0Value'); input.focus(); input.selectionStart = 2; input.selectionEnd = 5;
  for (const target of [id(202), id(203), id(201)]) {
    h.target(target); assert.deepEqual(review(h), approved);
    for (const language of ['en', 'ja', 'zh']) {
      h.language(language); assert.equal(h.el('CopyTarget').value, target); assert.equal(h.el('Param0Value'), input);
      assert.equal(h.document.activeElement, input); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5);
      assert.equal(h.el('Param1Value').value, '30'); assert.deepEqual(review(h), approved);
    }
  }
  assert.equal(h.generatedIds.length, 0); assert.equal(h.proposals.length, 1); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('explicit copy duplicates the current raw form for one chosen instance and leaves references literal', async t => {
  const h = await fixture(t); await h.open(); h.set('Source', id(302), 'change'); h.set('Param1Value', '0'); h.set('Param2Value', 'false', 'change');
  h.set('Param6Value', '-0'); h.set('Event0Signal', 'finished_custom'); h.set('Event0Name', 'run_action');
  const sourceRows = h.rows(), sourceEvents = h.events(), sourceIdentity = h.helperRows().map(row => row.identity);
  h.target(id(203)); await h.click('CopyBinding');
  assert.deepEqual(h.generatedIds, [id(401)]); assert.equal(h.el('Binding').value, id(401)); assert.equal(h.el('Binding').children.length, 3);
  assert.equal(h.el('Instance').value, id(203)); assert.equal(h.el('Source').value, id(302)); assert.equal(h.el('CopyTarget').value, ''); assert.equal(h.el('CopyBinding').disabled, true);
  assert.deepEqual(h.rows(), sourceRows); assert.deepEqual(h.events(), sourceEvents);
  assert.equal(h.el('Param4Value').value, id(201)); assert.equal(h.el('Param3Value').value, '');
  for (const [index, row] of h.helperRows().entries()) assert.notEqual(row.identity, sourceIdentity[index]);
  assert.equal(h.writes.length, 0); assert.equal(h.proposals.length, 0); assert.equal(h.content(), h.original);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const candidate = h.proposals.at(-1), source = candidate.bindings[0], copied = candidate.bindings[2];
  assert.equal(source.bindingId, id(101)); assert.equal(source.instanceId, id(201)); assert.equal(copied.bindingId, id(401)); assert.equal(copied.instanceId, id(203));
  assert.deepEqual(copied.implementation, source.implementation); assert.deepEqual(copied.events, source.events); assert.deepEqual(copied.parameters, source.parameters);
  assert.equal(copied.parameters.text, h.initialModel.bindings[0].parameters.text); assert.equal(copied.parameters.amount, 0); assert.equal(copied.parameters.enabled, false);
  assert.equal(h.el('Param6Value').value, '-0');
  // Draft copying keeps exact unfinished/raw text. Ordinary JSON serialization
  // for an inserted binding retains its existing documented zero conversion.
  assert.ok(Object.is(copied.parameters.negative_zero, 0)); assert.equal(copied.parameters.target_instance_id, id(201));
  assert.deepEqual(candidate.bindings[1], h.initialModel.bindings[1]); assert.equal(rawBinding(candidate.afterContent, 1), rawBinding(h.original, 1));
  await h.click('Apply'); assert.equal(h.writes.length, 1); assert.equal(h.el('Dialog').open, false);
  assert.ok(h.content().startsWith('\ufeff')); assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false);
});

test('copied and original forms remain independent across later parameter event and script edits', async t => {
  const h = await fixture(t); await h.open(); h.target(id(202)); await h.click('CopyBinding');
  h.set('Param0Value', 'copy only'); h.set('Event0Name', 'copy_event'); h.set('Source', id(302), 'change');
  await h.select(id(101)); assert.equal(h.el('Param0Value').value, h.initialModel.bindings[0].parameters.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'));
  assert.equal(h.el('Event0Name').value, 'checkpoint'); assert.equal(h.el('Source').value, id(301)); h.set('Param1Value', '55');
  await h.select(id(401)); assert.equal(h.el('Param0Value').value, 'copy only'); assert.equal(h.el('Param1Value').value, '10');
  assert.equal(h.el('Event0Name').value, 'copy_event'); assert.equal(h.el('Source').value, id(302)); await h.click('Check');
  const [source, other, copied] = h.proposals.at(-1).bindings;
  assert.equal(source.parameters.amount, 55); assert.equal(copied.parameters.amount, 10); assert.equal(source.events[0].event, 'checkpoint');
  assert.equal(copied.events[0].event, 'copy_event'); assert.deepEqual(other, h.initialModel.bindings[1]);
  await h.click('Cancel'); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('copying unfinished numeric text does not parse repair or approve the form', async t => {
  const h = await fixture(t); await h.open(); h.set('Param1Value', '1e-'); h.set('Param3Value', '');
  const sourceRows = h.rows(); h.target(id(203)); await h.click('CopyBinding');
  assert.deepEqual(h.rows(), sourceRows); assert.equal(h.el('Param1Value').value, '1e-'); assert.equal(h.el('Apply').disabled, true);
  await h.click('Check'); assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Param1Value').value, '1e-');
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Param1Value').value, '1e-'); }
  await h.select(id(101)); assert.deepEqual(h.rows(), sourceRows); await h.select(id(401)); assert.deepEqual(h.rows(), sourceRows);
  await h.click('Cancel'); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('an explicit copy to the same instance is distinct and still needs ordinary candidate review', async t => {
  const h = await fixture(t); await h.open(); h.target(id(201)); await h.click('CopyBinding');
  assert.equal(h.el('Binding').value, id(401)); assert.equal(h.el('Instance').value, id(201)); assert.equal(h.el('Apply').disabled, true);
  await h.click('Check'); assert.equal(h.proposals.at(-1).bindings[2].instanceId, id(201)); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('empty forged and silently replaced targets cannot allocate an identity or mutate an approved form', async t => {
  for (const choice of ['', id(999), id(3), 'not-an-instance', 'silent-replacement']) {
    const h = await fixture(t); await h.open(); h.set('Param1Value', '20'); await h.click('Check'); const approved = review(h), rows = h.rows();
    if (choice === 'silent-replacement') { h.target(id(202)); h.set('CopyTarget', id(203), false); }
    else h.target(choice);
    h.el('CopyBinding').dispatch('click'); await h.settle();
    assert.equal(h.el('Binding').children.length, 2, choice); assert.equal(h.el('Binding').value, id(101), choice);
    assert.deepEqual(h.rows(), rows, choice); assert.deepEqual(review(h), approved, choice); assert.equal(h.generatedIds.length, 0, choice);
    assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  }
});

test('UUID allocation failures preserve the selected form and an already approved ordinary proposal', async t => {
  for (const uuid of ['bad-id', id(101), id(102)]) {
    const h = await fixture(t, { uuid }); await h.open(); h.set('Param1Value', '21'); await h.click('Check'); h.target(id(203));
    const approved = review(h), rows = h.rows(), events = h.events(); await h.click('CopyBinding');
    assert.equal(h.el('Binding').children.length, 2); assert.equal(h.el('Binding').value, id(101)); assert.equal(h.el('CopyTarget').value, id(203));
    assert.deepEqual(h.rows(), rows); assert.deepEqual(h.events(), events); assert.deepEqual(review(h), approved);
    assert.equal(h.generatedIds.length, 1); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
    await h.click('Apply'); assert.equal(h.writes.length, 1); assert.equal(h.writes[0].bindings.length, 2);
  }
});

test('the 32 binding limit blocks copy even when disabled controls receive a direct event', async t => {
  const h = await fixture(t, { model: model(32) }); await h.open(); h.set('Param1Value', '22'); await h.click('Check'); h.target(id(203));
  const approved = review(h), rows = h.rows(); assert.equal(h.el('CopyBinding').disabled, true); h.el('CopyBinding').dispatch('click'); await h.settle();
  assert.equal(h.el('Binding').children.length, 32); assert.deepEqual(h.rows(), rows); assert.deepEqual(review(h), approved); assert.equal(h.generatedIds.length, 0);
  assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('copy is locked while the source opens or an ordinary candidate check is pending', async t => {
  const opening = deferred(), first = await fixture(t, { source: () => opening.promise }); const operation = first.open(); await first.settle();
  assert.equal(first.el('CopyBinding').disabled, true); first.el('CopyBinding').dispatch('click'); assert.equal(first.generatedIds.length, 0);
  opening.resolve(first.snapshot()); assert.equal(await operation, true); assert.equal(first.el('Binding').children.length, 2);
  const checking = deferred(), h = await fixture(t, { inspect: (_request, count) => count === 2 ? checking.promise : catalog() });
  await h.open(); h.set('Param1Value', '23'); h.target(id(203)); h.el('Check').click(); await h.settle();
  assert.equal(h.el('CopyBinding').disabled, true); h.el('CopyBinding').dispatch('click'); await h.settle();
  assert.equal(h.generatedIds.length, 0); assert.equal(h.el('Binding').children.length, 2); assert.equal(h.el('Param1Value').value, '23');
  checking.resolve(catalog()); await h.settle(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('CopyTarget').value, id(203));
  assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('changed source ownership and withdrawn host availability cannot copy a stale form', async t => {
  for (const [key, value] of [['sourceToken', 'replaced-source'], ['sourcePath', 'documents/other.json'], ['busy', true], ['available', false], ['editable', false]]) {
    const h = await fixture(t); await h.open(); h.set('Param1Value', '24'); h.target(id(203)); const rows = h.rows();
    h.context[key] = value; h.el('CopyBinding').dispatch('click'); await h.settle();
    assert.equal(h.el('Binding').children.length, 2, key); assert.deepEqual(h.rows(), rows, key); assert.equal(h.generatedIds.length, 0, key);
    assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  }
});

test('copy resets target selection and allocates each subsequent copy its own stable binding identity', async t => {
  const h = await fixture(t); await h.open(); h.target(id(203)); await h.click('CopyBinding');
  h.el('CopyBinding').dispatch('click'); await h.settle(); assert.deepEqual(h.generatedIds, [id(401)]); assert.equal(h.el('Binding').children.length, 3);
  h.target(id(202)); await h.click('CopyBinding'); assert.deepEqual(h.generatedIds, [id(401), id(402)]); assert.equal(h.el('Binding').value, id(402));
  for (const language of ['ja', 'en', 'zh']) h.language(language);
  await h.select(id(401)); assert.equal(h.el('Instance').value, id(203)); await h.select(id(402)); assert.equal(h.el('Instance').value, id(202));
  await h.click('Check'); const bindings = h.proposals.at(-1).bindings;
  assert.equal(new Set(bindings.map(item => item.bindingId)).size, 4); assert.equal(h.generatedIds.length, 2); assert.equal(h.writes.length, 0);
});

test('source helper callbacks and detached ordinary row controls cannot target copied rows or revoke their review', async t => {
  const h = await fixture(t); await h.open(); const oldRows = [...h.helperRows()];
  const stale = { input: h.el('Param0Value'), type: h.el('Param0Type'), parameterRemove: h.el('Param0Remove'), eventInput: h.el('Event0Name'), eventRemove: h.el('Event0Remove') };
  h.target(id(203)); await h.click('CopyBinding'); await h.click('Check'); const approved = review(h), rows = h.rows(), events = h.events();
  for (const row of oldRows) h.useOldReference(row, id(999));
  stale.input.value = 'detached'; stale.input.dispatch('input'); stale.type.value = 'number'; stale.type.dispatch('change');
  stale.eventInput.value = 'detached_event'; stale.eventInput.dispatch('input'); stale.parameterRemove.dispatch('click'); stale.eventRemove.dispatch('click');
  await h.settle(); assert.equal(h.el('Binding').value, id(401)); assert.deepEqual(h.rows(), rows); assert.deepEqual(h.events(), events); assert.deepEqual(review(h), approved);
  await h.select(id(101)); assert.deepEqual(h.rows(), rows); assert.deepEqual(h.events(), events); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('cancel and reopen discard copied forms without applying or changing the original source bytes', async t => {
  const h = await fixture(t); await h.open(); h.target(id(203)); await h.click('CopyBinding'); h.set('Param1Value', '1e-'); await h.click('Cancel');
  assert.equal(h.el('Dialog').open, false); assert.equal(h.confirmations.length, 1); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  await h.open(); assert.equal(h.el('Binding').children.length, 2); assert.equal(h.el('Binding').value, id(101)); assert.equal(h.el('CopyTarget').value, '');
  assert.equal(h.el('Param1Value').value, '10'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.proposals.length, 0); assert.equal(h.content(), h.original);
});
