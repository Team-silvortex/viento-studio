import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createProjectEventReview, queryProjectEventReview } from '../../engine/project-event-review.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = (binding = 1) => ({ visitIndex: 1, sceneId: id(1), bindingId: id(10 + binding), instanceId: id(30 + binding), objectId: id(50 + binding),
  source: { objectId: id(70 + binding), sourcePath: `documents/behaviors/來源-${binding}.json`, sourceRevision: revision, propertyPath: '/bindings/0' } });
const delivery = (subscriptionId, status) => ({ subscriptionId, status, origin: origin(subscriptionId) });
const event = (sequence, deliveries) => ({ sequence, name: 'action', value: '<img src=x> / 風', origin: origin(9), deliveries });
function observation(protocolVersion = 10, { handled = false } = {}) {
  const entries = [event(1, [delivery(1, 'handled'), delivery(2, 'handled')]), event(2, [delivery(3, 'skipped'), delivery(4, handled ? 'handled' : 'pending')])];
  const stateEntries = [1, 4].map((subscriptionId, index) => ({ sequence: index + 1, origin: origin(subscriptionId),
    scriptSource: { objectId: id(90), sourcePath: 'documents/scripts/待機.txt', sourceRevision: revision, propertyPath: '' },
    timeSeconds: 0, commandSequence: 0, stateKey: 'idle', clipId: null,
    ...(protocolVersion === 10 ? { trigger: { kind: 'event', eventSequence: index + 1, subscriptionId } } : {}) }));
  return { format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: id(1), protocolVersion: 1, phase: 'ready', sequence: 1, actors: [],
    project: { protocolVersion, assemblyId: id(100), entrySceneId: id(1), activeSceneId: id(1), visits: [{ index: 1, sceneId: id(1), phase: 'ready', elapsedSeconds: 0 }],
      sharedState: { revision: 0, entries: [], lastChange: null }, events: { sequence: 2, entries },
      ...(protocolVersion >= 4 ? { audioCommands: { sequence: 0, entries: [] } } : {}),
      ...(protocolVersion >= 5 ? { animationCommands: { sequence: 0, entries: [] } } : {}),
      ...(protocolVersion >= 7 ? { animationCompletions: { sequence: 0, entries: [] } } : {}),
      ...(protocolVersion >= 8 ? { animationStates: { sequence: 0, entries: [] } } : {}),
      ...(protocolVersion >= 9 ? { animationStateEntries: { sequence: 2, entries: stateEntries } } : {}) } };
}
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], links = [], closed = [], context = { available: true, visible: true, sessionOwner: 'run-1', navigationOwner: 'visit-1', canOpenSource: true, canContinueSource: true };
  const h = await dialogHarness('app-project-event-review', { createProjectEventReview, queryProjectEventReview,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'eventReview'; container.isConnected = true; h.document.body.append(container);
  const review = h.runtime.setupProjectEventReview({ container, getContext: () => context,
    onOpen: async (origin, opts) => { calls.push({ origin, ...opts }); return options.onOpen ? options.onOpen(origin, opts) : true; },
    onReviewEntry: async (sequence, opts) => { links.push({ sequence, ...opts }); return options.onReviewEntry ? options.onReviewEntry(sequence, opts) : true; }, onClose: sequence => closed.push(sequence) });
  t.after(() => review.dispose());
  const el = suffix => h.element('projectEventReview' + suffix);
  return { ...h, container, review, context, calls, links, closed, el, set: value => review.setObservation(value), select: sequence => review.selectEvent(sequence),
    rows: () => el('Recipients').children, language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const source = (h, index = 0) => h.rows()[index].querySelector('.project-event-review-recipient-source');
const link = (h, index = 0) => h.rows()[index].querySelector('.project-event-review-animation-entry');

test('event review requires explicit selection and validates complete supported observations', async t => {
  const h = await fixture(t); assert.equal(h.el('Panel').hidden, true); assert.equal(h.set(observation()), true); assert.equal(h.el('Panel').hidden, true);
  assert.equal(h.select(1), true); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Panel').dataset.sequence, '1');
  assert.equal(h.select(99), false); assert.equal(h.select('1'), false); assert.equal(h.el('Panel').dataset.sequence, '1');
  h.set(null); assert.equal(h.el('Panel').hidden, true); assert.equal(h.select(1), false);
  for (const version of [1, 2, 12]) { const value = observation(); value.project.protocolVersion = version; assert.equal(h.set(value), false); }
  assert.equal(h.set({ project: observation().project }), false);
});

test('recipient links use exact captured event entries while handled without entry remains unclassified', async t => {
  const h = await fixture(t); h.set(observation()); h.select(1);
  assert.deepEqual(h.rows().map(row => row.dataset.animationStatus), ['recorded', 'not-recorded']);
  assert.equal(link(h).dataset.entrySequence, '1'); assert.equal(link(h, 1).hidden, true);
  assert.match(h.rows()[0].textContent, /已采集进入记录 1.*状态 idle/);
  assert.match(h.rows()[1].textContent, /已处理（回调成功）/); assert.match(h.rows()[1].textContent, /尚未采集此订阅/);
  assert.doesNotMatch(h.rows()[1].textContent, /条件失败|行为未执行|播放成功/);
  link(h).click(); await flushDialogs(); assert.equal(h.links.length, 1); assert.equal(h.links[0].sequence, 1);
  assert.equal(h.calls.length, 0); assert.equal(h.el('Panel').dataset.sequence, '1');
});

test('a pending callback can already own an entry, while skipped recipients never receive a guessed link', async t => {
  const h = await fixture(t); h.set(observation()); h.select(2);
  assert.deepEqual(h.rows().map(row => [row.dataset.status, row.dataset.animationStatus]), [['skipped', 'not-recorded'], ['pending', 'recorded']]);
  assert.equal(link(h).hidden, true); assert.equal(link(h, 1).dataset.entrySequence, '2');
  assert.match(h.rows()[1].textContent, /进入已记录.*回调结果尚未确认/); assert.doesNotMatch(h.rows()[1].textContent, /回调成功|条件失败/);
  assert.match(h.el('AssociationNote').textContent, /未采集进入记录不能说明条件失败/);
});

test('protocols3–9 retain event and delivery evidence but expose no animation association', async t => {
  const h = await fixture(t);
  for (const version of [3, 4, 5, 6, 7, 8, 9]) {
    assert.equal(h.set(observation(version)), true); assert.equal(h.select(1), true);
    assert.equal(h.el('Value').textContent, JSON.stringify('<img src=x> / 風'));
    assert.deepEqual(h.rows().map(row => row.dataset.animationStatus), ['unavailable-protocol', 'unavailable-protocol']);
    assert.equal(link(h).hidden, true); assert.equal(link(h, 1).hidden, true); assert.match(h.el('AssociationNote').textContent, /无法关联/);
    h.el('PublisherSource').click(); await flushDialogs(); assert.equal(h.calls.at(-1).origin.source.sourcePath, origin(9).source.sourcePath);
  }
});

test('empty recipients stay distinct from a missing event and closing returns selection identity', async t => {
  const h = await fixture(t), value = observation(3); value.project.events.entries[0].deliveries = [];
  h.set(value); h.select(1); assert.equal(h.el('Empty').hidden, false); assert.equal(h.el('Recipients').dataset.count, '0');
  h.el('Close').click(); assert.deepEqual(h.closed, [1]); assert.equal(h.el('Panel').hidden, true);
  assert.equal(h.select(1), true); h.el('Selection').value = '99'; h.el('Selection').dispatch('change'); assert.equal(h.el('Panel').hidden, true);
});

test('same-name publications select independently and locale updates keep literal values focus and recipient nodes', async t => {
  const h = await fixture(t); h.set(observation()); h.select(1);
  assert.deepEqual(h.el('Selection').children.map(option => option.value), ['1', '2']);
  h.el('Selection').value = '2'; h.el('Selection').dispatch('change'); assert.equal(h.el('Panel').dataset.sequence, '2');
  const selected = h.el('Selection'), row = h.rows()[1], button = link(h, 1); selected.focus();
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['事件投递回看'] || '事件投递回看');
    assert.equal(h.document.activeElement, selected); assert.equal(h.rows()[1], row); assert.equal(link(h, 1), button);
    assert.equal(h.el('Name').textContent, 'action'); assert.equal(h.el('Value').textContent, JSON.stringify('<img src=x> / 風'));
    assert.equal(h.container.querySelector('img'), null); assert.match(row.textContent, /來源-4.json/);
  }
});

test('polling and receipt updates retain selected controls while source authority follows only the selected recipient', async t => {
  for (const role of ['publisher', 'recipient']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(observation()); h.select(2);
    const button = role === 'publisher' ? h.el('PublisherSource') : source(h, 1); button.focus(); button.click();
    const row = h.rows()[1], option = h.el('Selection').children[1]; h.set(observation(10, { handled: true }));
    assert.equal(h.el('Panel').dataset.sequence, '2'); assert.equal(h.rows()[1], row); assert.equal(h.el('Selection').children[1], option); assert.equal(h.document.activeElement, button);
    assert.equal(h.calls[0].isCurrent(), role === 'publisher'); pending.resolve(true); await flushDialogs();
  }
});

test('unrelated recipient status updates and event appends preserve a frozen subscriber read', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(observation()); h.select(2); source(h, 1).click();
  const value = observation(); value.project.events.entries[1].deliveries[0].status = 'handled';
  value.project.events.sequence++; value.project.events.entries.push(event(3, [])); h.set(value);
  assert.equal(h.calls[0].isCurrent(), true); assert.equal(h.el('Panel').dataset.sequence, '2'); assert.equal(h.el('Selection').children.length, 3);
  pending.resolve(true); await flushDialogs();
});

test('own source loading can become busy while new and duplicate source clicks remain blocked', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(observation()); h.select(1);
  h.context.canOpenSource = false; h.el('PublisherSource').dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; source(h).click(); h.context.canOpenSource = false; h.review.refresh();
  assert.equal(h.calls[0].isCurrent(), true); h.el('PublisherSource').dispatch('click'); link(h).dispatch('click'); assert.equal(h.calls.length, 1); assert.equal(h.links.length, 0);
  pending.resolve(true); await flushDialogs();
});

test('selection task visit visibility authorization detachment and close revoke delayed source navigation', async t => {
  for (const change of ['selection', 'task', 'visit', 'visible', 'available', 'continue', 'detached', 'close']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(observation()); h.select(1); source(h).click();
    if (change === 'selection') h.select(2); else if (change === 'task') h.context.sessionOwner = 'new-run'; else if (change === 'visit') h.context.navigationOwner = 'visit-2';
    else if (change === 'visible' || change === 'available') h.context[change] = false; else if (change === 'continue') h.context.canContinueSource = false;
    else if (change === 'detached') h.container.isConnected = false; else h.el('Close').click();
    h.review.refresh(); assert.equal(h.calls[0].isCurrent(), false, change); pending.reject(Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
  }
});

test('publisher or recipient identity replacement and invalid observations clear selection, but visit changes keep historical review', async t => {
  const h = await fixture(t); h.set(observation()); h.select(2); h.context.navigationOwner = 'visit-2'; h.review.refresh(); assert.equal(h.el('Panel').dataset.sequence, '2');
  for (const mutate of [value => value.project.events.entries[1].value = 'changed', value => value.project.events.entries[1].origin = origin(8),
    value => value.project.events.entries[1].deliveries[0].origin = origin(7), value => value.project.events.sequence++]) {
    h.set(observation()); h.select(2); const value = observation(); mutate(value); h.set(value); assert.equal(h.el('Panel').hidden, true);
  }
});

test('animation links retain exact entry sequence and revoke stale selection or replaced callback context', async t => {
  for (const change of ['selection', 'receipt', 'hidden']) {
    const pending = deferred(), h = await fixture(t, { onReviewEntry: () => pending.promise }); h.set(observation()); h.select(2); link(h, 1).click();
    assert.equal(h.links[0].sequence, 2); assert.equal(h.links[0].isCurrent(), true);
    if (change === 'selection') h.select(1); else if (change === 'receipt') h.set(observation(10, { handled: true })); else { h.context.visible = false; h.review.refresh(); }
    assert.equal(h.links[0].isCurrent(), false); pending.reject(Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
  }
});

test('frozen publisher and subscriber sources cannot be redirected by caller mutation and errors preserve review', async t => {
  const h = await fixture(t, { onOpen: () => false, onReviewEntry: () => false }), value = observation(); h.set(value); h.select(1);
  value.project.events.entries[0].origin.source.sourcePath = 'changed.json'; value.project.events.entries[0].deliveries[0].origin.source.sourcePath = 'changed.json';
  h.el('PublisherSource').click(); await flushDialogs(); source(h).click(); await flushDialogs();
  assert.deepEqual(h.calls.map(call => call.origin), [origin(9), origin(1)]); assert.match(h.el('Navigation').textContent, /无法打开事件回看来源/);
  link(h).click(); await flushDialogs(); assert.match(h.el('Navigation').textContent, /无法打开关联控制器/); assert.equal(h.el('Panel').hidden, false);
});

test('accessors are rejected without execution, disposal revokes old controls and translations cover responsive read-only markup', async t => {
  const h = await fixture(t); let invoked = 0; const value = observation(); Object.defineProperty(value, 'project', { enumerable: true, get() { invoked++; return {}; } });
  assert.equal(h.set(value), false); assert.equal(invoked, 0); h.set(observation()); h.select(1); const button = source(h); h.review.dispose(); button.dispatch('click');
  assert.equal(h.calls.length, 0); assert.equal(h.subscriptions(), 0); assert.equal(h.container.children.length, 0);
  const sourceText = await fs.readFile(new URL('../../web/modules/app-project-event-review.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sourceText, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.publish_event\(|\.play_animation\(|requestAnimationFrame|setInterval|setTimeout/);
  for (const match of sourceText.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) { assert.ok(en[match[1]], match[1]); assert.ok(ja[match[1]], match[1]); }
  const css = await fs.readFile(new URL('../../web/project-event-review.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /flex-direction: column/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /white-space: pre-wrap/);
});


test('removed recipient controls cannot navigate a later event that reuses the same subscription identity', async t => {
  const h = await fixture(t); h.set(observation()); h.select(1); const oldSource = source(h), oldLink = link(h);
  h.select(2); h.select(1); assert.notEqual(source(h), oldSource); assert.notEqual(link(h), oldLink);
  oldSource.dispatch('click'); oldLink.dispatch('click'); await flushDialogs(); assert.equal(h.calls.length, 0); assert.equal(h.links.length, 0);
  source(h).click(); await flushDialogs(); assert.equal(h.calls.length, 1);
});
