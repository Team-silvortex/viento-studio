import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { createSceneBehaviorProposal, isSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
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
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const original = settings.content ?? serialize(settings.model || model()); let content = original, language = 'zh', languageListener = () => {}, disposed = 0, ids = 0, loads = 0;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, behaviorSource: true, available: true,
    sourcePath: 'documents/behaviors/demo.json', sourceToken: 'load:1:draft:0' };
  const calls = [], checks = [], proposals = [], confirms = [], focused = [];
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, baseSourceRevision: hash(original), sourceRevision: hash(content), content });
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-behaviors', {
    inspectSceneBehaviors, isSceneBehaviorProposal,
    createSceneBehaviorProposal: (source, edit) => { const proposal = createSceneBehaviorProposal(copy(source), copy(edit)); proposals.push(proposal); return settings.proposal ? settings.proposal(proposal) : proposal; },
    crypto: { randomUUID: () => { ids++; return settings.uuid || id(400 + ids); } },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { languageListener = listener; return () => { disposed++; languageListener = () => {}; }; },
  });
  h.runtime.window.confirm = value => { confirms.push(value); return settings.confirm?.() ?? true; };
  let controller;
  controller = h.runtime.setupSceneBehaviors({ getContext: () => context,
    getSource: async () => { loads++; return settings.source ? settings.source(snapshot()) : snapshot(); },
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
  return { ...h, controller, context, el, settle, set, click, original, calls, checks, proposals, confirms, focused, snapshot,
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
