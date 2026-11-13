import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { setupSceneBehaviorParameters } from '../../web/modules/app-scene-behavior-parameters.js';
import { setupSceneBehaviorAnimationClips } from '../../web/modules/app-scene-behavior-animation-clips.js';
import { setupSceneBehaviorStateBindings } from '../../web/modules/app-scene-behavior-state-bindings.js';
import { setupSceneBehaviorMenuTargets } from '../../web/modules/app-scene-behavior-menu-targets.js';
import { captureSceneBehaviorReferences } from '../../engine/scene-behavior-reference-directory.mjs';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { discoverGodotProjectMenuParameterContract } from '../../engine/godot-project-menu-parameters.mjs';
import { GODOT_PROJECT_MENU_SCRIPT } from '../../engine/godot-project-menu-script.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { createSceneBehaviorProposal, isSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/start.json', sourceRevision: revision('start') });
const named = (n, name, sourcePath) => ({ objectId: id(n), name, sourcePath, sourceRevision: revision(sourcePath) });
const advisory = () => copy(discoverGodotProjectMenuParameterContract(GODOT_PROJECT_MENU_SCRIPT));
const menu = () => '[\r\n {"id":"go","label":"Go <b>","command":"scene","targetSceneId":"' + id(2) + '"},\r\n {"id":"again","label":"Retry","command":"retry","targetSceneId":"' + id(4) + '","values":{"progress":0e0,"health":3}},\r\n {"id":"exit","label":"Exit","command":"finish"}\r\n]';
function source(items = menu()) {
  const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(3), instanceId: id(8),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(9) }, parameters: { title: 'Menu', items_json: items, display_mode: 'scene' }, events: [] }] });
  return { sourcePath: 'documents/behaviors/start.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content };
}
function directory(inputSource, assemblyObjectId = null, mutate = () => {}, sourceChange = value => value) {
  const assemblies = [named(20, 'Main <b>', 'documents/projects/main.json'), named(21, 'Practice', 'documents/projects/practice.json')];
  const raw = { format: 'viento-scene-behavior-reference-directory', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('directory'), scene: scene(),
    instances: [{ instanceId: id(8), ...named(11, 'Controller', 'documents/definitions/controller.md') }], assemblies,
    selectedAssembly: assemblyObjectId ? { ...assemblies.find(value => value.objectId === assemblyObjectId), members: [{ ...scene(), name: 'Start' }, named(2, 'Game <b>', 'documents/scenes/game.json'), named(4, 'Result', 'documents/scenes/result.json')], inputMap: null, actions: [] } : null };
  mutate(raw); return captureSceneBehaviorReferences(sourceChange(inputSource), raw, raw.scene);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const h = await dialogHarness('app-scene-behavior-references'), container = h.document.createElement('section'); h.document.body.append(container);
  let serial = 0, language = 'zh'; const reads = [], applied = [];
  function row(name, value, type = 'string') {
    const wrapper = h.document.createElement('div'), key = h.document.createElement('input'), typeNode = h.document.createElement('select'), input = h.document.createElement('textarea');
    key.value = name; typeNode.value = type; input.value = value; wrapper.append(key, typeNode, input); h.document.body.append(wrapper);
    return { wrapper, key, type: typeNode, value: input, identity: ++serial, bindingId: id(3), rawValue: value, displayValue: input.value };
  }
  const items = settings.items ?? menu();
  const state = { available: true, current: true, pending: false, epoch: 1, editSignature: 'draft:1', source: source(items), scene: scene(), bindingId: id(3), sourceObjectId: id(9), instanceId: id(8),
    backendId: 'org.viento.godot4', language: 'gdscript', script: { ...named(9, 'Menu', 'documents/scripts/menu.txt'), parameterContract: advisory() },
    rows: [row('title', 'Title\r\nexact'), row('items_json', items), row('display_mode', 'scene'), row('unfinished', '1e-', 'number')], ...settings.context };
  const values = () => state.rows.map(value => ({ key: value.key.value, type: value.type.value, value: value.value.value, rawValue: value.rawValue, displayValue: value.displayValue }));
  let controller;
  controller = setupSceneBehaviorMenuTargets({ container, getContext: () => state,
    ...(settings.noPort ? {} : { getReferences: async (s, request) => { reads.push({ source: copy(s), request: copy(request) }); return settings.read ? settings.read(s, request, reads.length) : directory(s, request.assemblyObjectId); } }),
    translate: key => ({ en, ja }[language]?.[key] || key),
    onUse: (target, value) => { applied.push({ target, value }); target.value.value = value; target.rawValue = value; target.displayValue = target.value.value; settings.onUse?.(target, value); controller.refresh(); } });
  t.after(() => controller.dispose());
  const el = suffix => container.querySelector('#sceneBehaviorsMenuTargets' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const select = (suffix, value) => { el(suffix).value = value; el(suffix).dispatch('change'); };
  return { ...h, state, row, controller, container, values, reads, applied, el, select, settle,
    async load() { el('Load').click(); await settle(); }, async assembly(value = id(20)) { select('Assembly', value); await settle(); },
    async ready() { await this.load(); await this.assembly(); },
    choose(item = 'go', target = id(4)) { select('Item', item); select('Target', target); },
    newItem(command = 'retry', name = 'new_retry', label = 'Try again') { el('NewId').value = name; el('NewId').dispatch('input'); el('NewLabel').value = label; el('NewLabel').dispatch('input'); select('Command', command); },
    async use() { el('Use').click(); await settle(); }, async append() { el('Append').click(); await settle(); }, language(value) { language = value; controller.refresh(); } };
}

test('only the exact official Godot advisory and available reference port enable the helper', async t => {
  for (const settings of [{ noPort: true }, { context: { available: false } }, { context: { current: false } }, { context: { backendId: 'org.other' } }, { context: { language: 'rust' } },
    { context: { script: { ...named(9, 'Menu', 'documents/scripts/menu.txt'), parameterContract: { ...advisory(), status: 'unsupported' } } } },
    { context: { script: { ...named(9, 'Menu', 'documents/scripts/menu.txt'), parameterContract: { ...advisory(), extra: undefined } } } }]) {
    const h = await fixture(t, settings), before = h.values(); assert.equal(h.container.hidden, true); assert.equal(h.reads.length, 0); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before);
  }
});

test('advisory capture rejects getters and serializers without invoking them', async t => {
  let calls = 0;
  for (const make of [() => Object.defineProperty(advisory(), 'parameters', { enumerable: true, get() { calls++; return advisory().parameters; } }),
    () => Object.assign(advisory(), { toJSON() { calls++; return advisory(); } }), () => Object.assign(advisory(), { [Symbol('extra')]: 1 })]) {
    const h = await fixture(t, { context: { script: { ...named(9, 'Menu', 'documents/scripts/menu.txt'), parameterContract: make() } } }); assert.equal(h.container.hidden, true);
  }
  assert.equal(calls, 0);
});

test('missing, duplicate, renamed, mistyped or paused rows leave manual editing intact and never read a directory', async t => {
  for (const change of [h => { h.state.rows.splice(1, 1); }, h => { h.state.rows.push(h.row('items_json', menu())); }, h => { h.state.rows[1].type.value = 'number'; },
    h => { h.state.rows[1].key.value = 'other'; }, h => { h.state.rows[2].value.value = 'paused'; }, h => { h.state.rows.push(h.row('display_mode', 'scene')); }]) {
    const h = await fixture(t); change(h); h.controller.refresh(); const before = h.values(); assert.equal(h.container.hidden, false); assert.equal(h.el('Load').disabled, true);
    assert.match(h.el('Status').textContent, /唯一|手动/); await h.load(); assert.equal(h.reads.length, 0); assert.deepEqual(h.values(), before); assert.equal(h.state.rows[0].value.disabled, false);
  }
});

test('load and explicit assembly selection show human names safely without writing or choosing an assembly implicitly', async t => {
  for (const count of [0, 1, 2]) {
    const h = await fixture(t, { read: (s, request) => directory(s, request.assemblyObjectId, raw => { raw.assemblies = raw.assemblies.slice(0, count); }) }), before = h.values();
    await h.load(); assert.deepEqual(h.reads[0].request, { assemblyObjectId: null }); assert.equal(h.el('Assembly').value, ''); assert.equal(h.el('Assembly').children.length, count + 1); assert.equal(h.el('Use').disabled, true);
    assert.deepEqual(h.values(), before); if (!count) continue;
    await h.assembly(); assert.deepEqual(h.el('Target').children.map(option => option.value), ['', id(2), id(4)]); assert.deepEqual(h.el('Item').children.map(option => option.value), ['', 'go', 'again']);
    assert.ok(h.el('Target').children[1].textContent.includes('Game <b>')); assert.ok(h.el('Target').children[1].textContent.includes(id(2))); assert.equal(h.container.querySelector('b'), null);
    h.choose(); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before);
  }
});

test('existing target insertion re-reads the entire scoped directory and changes only its String token', async t => {
  const h = await fixture(t), before = h.values(), original = menu(); await h.ready(); h.choose(); assert.equal(h.el('Use').disabled, false); await h.use();
  assert.equal(h.reads.length, 3); assert.deepEqual(h.reads.at(-1).request, { assemblyObjectId: id(20) }); assert.equal(h.applied.length, 1); assert.equal(h.applied[0].target, h.state.rows[1]);
  assert.equal(h.applied[0].value, original.replace('"targetSceneId":"' + id(2) + '"', '"targetSceneId":"' + id(4) + '"'));
  assert.deepEqual(h.values().filter((_, n) => n !== 1), before.filter((_, n) => n !== 1)); assert.match(h.applied[0].value, /"progress":0e0/); assert.ok(h.applied[0].value.includes('\r\n'));
});

test('selecting an already assigned target leaves the original String and ordinary review unchanged', async t => {
  const h = await fixture(t), before = h.values(); await h.ready(); h.choose('go', id(2)); await h.use(); assert.equal(h.reads.length, 3); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before); assert.match(h.el('Status').textContent, /未变化/);
});

test('append requires explicit id, label, command and target; retry gets an empty explicit override while old values remain byte exact', async t => {
  for (const command of ['scene', 'retry']) {
    const h = await fixture(t), before = h.values(), original = menu(); await h.ready(); assert.equal(h.el('Append').disabled, true); h.select('Target', id(2)); h.newItem(command); assert.equal(h.el('Append').disabled, false); assert.equal(h.applied.length, 0);
    await h.append(); assert.equal(h.applied.length, 1); const value = h.applied[0].value, parsed = JSON.parse(value), added = parsed.at(-1);
    assert.deepEqual(added, { id: 'new_retry', label: 'Try again', command, targetSceneId: id(2), ...(command === 'retry' ? { values: {} } : {}) });
    assert.ok(value.startsWith(original.slice(0, original.lastIndexOf('}') + 1))); assert.match(value, /"progress":0e0/); assert.deepEqual(h.values().filter((_, n) => n !== 1), before.filter((_, n) => n !== 1));
  }
});

test('invalid ids, duplicate items, nonmembers, malformed old JSON and String budget fail without repairing or mutating text', async t => {
  for (const [name, label] of [['go', 'duplicate'], ['not valid', 'name'], ['new', '\u0000bad']]) {
    const h = await fixture(t), before = h.values(); await h.ready(); h.select('Target', id(2)); h.newItem('retry', name, label); await h.append(); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before); assert.match(h.el('Status').textContent, /未填入/);
  }
  const long = JSON.stringify([{ id: 'go', label: 'Go', command: 'scene', targetSceneId: id(2) }]).replace('[', '[' + ' '.repeat(4000));
  const h = await fixture(t, { items: long }), before = h.values(); await h.ready(); h.select('Target', id(2)); h.newItem(); await h.append(); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before);
  for (const items of ['[invalid]', JSON.stringify([{ id: 'go', label: 'Go', command: 'scene', targetSceneId: id(88) }])]) {
    const broken = await fixture(t, { items }), original = broken.values(); await broken.ready(); assert.equal(broken.el('Use').disabled, true); assert.equal(broken.el('Append').disabled, true); assert.match(broken.el('Status').textContent, /原参数/); assert.deepEqual(broken.values(), original);
  }
});

test('eight items disable append but still permit an existing navigation target edit', async t => {
  const items = JSON.stringify([{ id: 'go', label: 'Go', command: 'scene', targetSceneId: id(2) }, ...Array.from({ length: 7 }, (_, n) => ({ id: 'exit' + n, label: 'Exit', command: 'finish' }))]);
  const h = await fixture(t, { items }); await h.ready(); h.choose(); h.newItem(); assert.equal(h.el('Append').disabled, true); assert.equal(h.el('Use').disabled, false); assert.match(h.el('Status').textContent, /8个/); await h.use(); assert.equal(h.applied.length, 1);
});

test('stale, forged, wrong-source and failed scoped revalidation never changes a row or helper free text', async t => {
  for (const mode of ['revision', 'name', 'member', 'source', 'scene', 'forged', 'failure']) {
    const h = await fixture(t, { read: (s, request, count) => {
      if (count < 3) return directory(s, request.assemblyObjectId);
      if (mode === 'failure') throw Error('offline');
      if (mode === 'forged') return copy(directory(s, request.assemblyObjectId));
      return directory(s, request.assemblyObjectId, raw => {
        if (mode === 'revision') raw.revision = revision('changed'); if (mode === 'name') raw.selectedAssembly.members[1].name = 'same revision different label';
        if (mode === 'member') raw.selectedAssembly.members = raw.selectedAssembly.members.slice(0, 2);
        if (mode === 'scene') { raw.scene.sourceRevision = revision('next scene'); raw.selectedAssembly.members[0].sourceRevision = raw.scene.sourceRevision; }
      }, source => mode === 'source' ? { ...source, token: 'other' } : source);
    } });
    const before = h.values(); await h.ready(); h.choose(); h.newItem('retry', 'preserve', 'free text'); await h.use(); assert.equal(h.applied.length, 0, mode); assert.deepEqual(h.values(), before, mode); assert.equal(h.el('NewLabel').value, 'free text', mode); assert.equal(h.container.getAttribute('aria-busy'), 'false');
  }
});

test('every binding, source, script, row, parameter and session change revokes a pending insertion without overwriting it', async t => {
  const changes = [h => { h.state.source = { ...h.state.source }; }, h => { h.state.source.token = 'source:2'; }, h => { h.state.source.baseSourceRevision = revision('base'); },
    h => { h.state.scene.sourceRevision = revision('new scene'); }, h => { h.state.bindingId = id(99); }, h => { h.state.sourceObjectId = id(98); }, h => { h.state.instanceId = id(97); },
    h => { h.state.script = { ...h.state.script }; }, h => { h.state.script.sourceRevision = revision('new script'); }, h => { h.state.script.parameterContract.parameters[0].defaultValue = 'different'; },
    h => { h.state.rows = [...h.state.rows]; }, h => { h.state.rows[1] = h.row('items_json', menu()); }, h => { h.state.rows[1].identity++; }, h => { h.state.rows[1].bindingId = id(96); },
    h => { h.state.rows[1].key.value = 'renamed'; }, h => { h.state.rows[1].type.value = 'number'; }, h => { h.state.rows[1].value.value = 'manual newer JSON'; },
    h => { h.state.rows[1].rawValue = 'silent raw'; }, h => { h.state.rows[1].displayValue = 'silent display'; }, h => { h.state.rows[1].wrapper.remove(); },
    h => { h.state.epoch++; }, h => { h.state.editSignature = 'changed'; }, h => { h.state.available = false; }, h => { h.state.current = false; }, h => { h.state.pending = true; }];
  for (const [index, change] of changes.entries()) {
    const wait = deferred(); let saved; const h = await fixture(t, { read: (s, request, count) => { const value = directory(s, request.assemblyObjectId); if (count < 3) return value; saved = value; return wait.promise; } });
    await h.ready(); h.choose(); h.el('Use').click(); await h.settle(); assert.ok(saved); change(h); const after = h.values(); h.controller.refresh(); wait.resolve(saved); await h.settle();
    assert.equal(h.applied.length, 0, String(index)); assert.deepEqual(h.values(), after, String(index)); assert.equal(h.container.getAttribute('aria-busy'), 'false', String(index));
  }
});

test('a silent row edit or helper free-text edit during revalidation is preserved and cancels insertion', async t => {
  for (const field of ['row', 'helper']) {
    const wait = deferred(); let saved; const h = await fixture(t, { read: (s, request, count) => { const value = directory(s, request.assemblyObjectId); if (count < 3) return value; saved = value; return wait.promise; } });
    await h.ready(); h.choose(); h.newItem(); h.el('Use').click(); await h.settle();
    if (field === 'row') h.state.rows[1].value.value = 'manual new text'; else h.el('NewLabel').value = 'typed meanwhile';
    wait.resolve(saved); await h.settle(); assert.equal(h.applied.length, 0); assert.equal(h.container.getAttribute('aria-busy'), 'false');
    if (field === 'row') assert.equal(h.state.rows[1].value.value, 'manual new text'); else assert.equal(h.el('NewLabel').value, 'typed meanwhile');
  }
});

test('an observed ordinary review pending period cancels old reads even after readiness returns', async t => {
  for (const phase of ['load', 'insert']) {
    const wait = deferred(); let saved; const h = await fixture(t, { read: (s, request, count) => { const value = directory(s, request.assemblyObjectId); if (phase === 'insert' && count < 3) return value; saved = value; return wait.promise; } });
    if (phase === 'load') h.el('Load').click(); else { await h.ready(); h.choose(); h.el('Use').click(); } await h.settle(); const before = h.values();
    h.state.pending = true; h.controller.refresh(); h.state.pending = false; h.controller.refresh(); wait.resolve(saved); await h.settle(); assert.equal(h.applied.length, 0); assert.deepEqual(h.values(), before); assert.match(h.el('Status').textContent, /已失效/); assert.equal(h.container.getAttribute('aria-busy'), 'false');
  }
});

test('reset, close, switched binding and disposal discard late loads and detached old controls', async t => {
  for (const mode of ['reset', 'close', 'binding', 'dispose']) {
    const wait = deferred(); let saved; const h = await fixture(t, { read: (s, request) => { saved = directory(s, request.assemblyObjectId); return wait.promise; } });
    const old = h.el('Load'); old.click(); await h.settle(); if (mode === 'reset') { h.controller.reset(); h.controller.refresh(); } if (mode === 'close') { h.state.current = false; h.controller.refresh(); h.state.current = true; h.controller.refresh(); }
    if (mode === 'binding') { h.state.bindingId = id(99); h.controller.refresh(); } if (mode === 'dispose') h.controller.dispose(); wait.resolve(saved); await h.settle(); assert.equal(h.applied.length, 0);
    if (mode !== 'dispose') assert.equal(h.el('Assembly').children.length, 1); const count = h.reads.length; old.disabled = false; old.click(); await h.settle(); assert.equal(h.reads.length, count);
  }
});

test('failed directory refresh retains all text and allows a fresh read; language refresh preserves selection and focused unfinished input', async t => {
  const h = await fixture(t, { read: (s, request, count) => { if (count === 3) throw Error('offline'); return directory(s, request.assemblyObjectId); } });
  await h.ready(); h.choose(); h.newItem(); const before = h.values(); await h.load(); assert.equal(h.el('Use').disabled, true); assert.equal(h.el('NewLabel').value, 'Try again'); assert.deepEqual(h.values(), before);
  await h.ready(); h.choose(); const input = h.state.rows[3].value; input.focus(); input.selectionStart = 1; input.selectionEnd = 3; const controls = ['Assembly', 'Item', 'Target', 'NewId', 'NewLabel', 'Command'].map(name => h.el(name));
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Item').value, 'go'); assert.equal(h.el('Target').value, id(4)); assert.equal(h.document.activeElement, input); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 3); assert.deepEqual(h.values(), before); assert.deepEqual(['Assembly', 'Item', 'Target', 'NewId', 'NewLabel', 'Command'].map(name => h.el(name)), controls); }
});

test('ordinary parent review is untouched by directory reads and revoked only by a real one-row insertion; cancel and reopen preserve author bytes', async t => {
  const originalValue = JSON.parse(source().content), second = copy(originalValue.bindings[0]); second.bindingId = id(33); second.parameters = { untouched: 'keep\r\nexact', amount: 13 }; originalValue.bindings.push(second);
  const original = '\ufeff' + JSON.stringify(originalValue, null, 2).replaceAll('\n', '\r\n') + '\r\n'; let content = original; const proposals = [], reads = [], applied = [], sourceClones = new WeakMap(), scriptClones = new WeakMap();
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, behaviorSource: true, available: true, referencesAvailable: true, sourcePath: 'documents/behaviors/start.json', sourceToken: 'load:1' };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, baseSourceRevision: revision(original), sourceRevision: revision(content), content });
  const catalog = () => ({ format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: context.sourcePath, objectId: id(50), scene: { ...scene(), instances: [{ instanceId: id(8), objectId: id(11), name: 'Controller' }] }, sources: [{ ...named(9, 'Menu', 'documents/scripts/menu.txt'), parameterContract: advisory() }], dependencyRevision: revision('dependencies') });
  const h = await dialogHarness('app-scene-behaviors', { inspectSceneBehaviors, isSceneBehaviorProposal, setupSceneBehaviorAnimationClips, setupSceneBehaviorStateBindings, setupSceneBehaviorParameters, captureScriptParameterContract: value => captureScriptParameterContract(copy(value)),
    setupSceneBehaviorMenuTargets: options => setupSceneBehaviorMenuTargets({ ...options, getContext: () => { const value = options.getContext(); if (value.source && !sourceClones.has(value.source)) sourceClones.set(value.source, copy(value.source)); if (value.script && !scriptClones.has(value.script)) scriptClones.set(value.script, copy(value.script)); return { ...value, source: value.source && sourceClones.get(value.source), script: value.script && scriptClones.get(value.script) }; } }),
    createSceneBehaviorProposal: (s, edit) => { const value = createSceneBehaviorProposal(copy(s), copy(edit)); proposals.push(value); return value; } });
  const controller = h.runtime.setupSceneBehaviors({ getContext: () => context, getSource: async () => snapshot(), inspect: async () => catalog(), getReferences: async (s, request) => { reads.push(request); return directory(copy(s), request.assemblyObjectId); },
    applyDraft: async (proposal, ports) => { assert.equal(ports.isCurrent(), true); applied.push(proposal); content = proposal.afterContent; context.sourceToken += ':apply'; return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content }; } });
  t.after(() => controller.dispose()); const el = suffix => h.element('sceneBehaviors' + suffix), menuEl = suffix => h.element('sceneBehaviorsMenuTargets' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); }, click = async suffix => { el(suffix).click(); await settle(); }, select = async (suffix, value) => { menuEl(suffix).value = value; menuEl(suffix).dispatch('change'); await settle(); };
  assert.equal(await controller.open(), true); assert.equal(el('MenuTargetsTools').hidden, false); el('Param0Value').value = 'Changed title'; el('Param0Value').dispatch('input'); await click('Check'); assert.equal(el('Apply').disabled, false); const prior = el('After').textContent;
  await click('MenuTargetsLoad'); await select('Assembly', id(20)); await select('Item', 'go'); await select('Target', id(4)); assert.equal(el('Apply').disabled, false); assert.equal(el('After').textContent, prior); assert.equal(content, original); assert.equal(applied.length, 0);
  await click('MenuTargetsUse'); assert.equal(el('Apply').disabled, true); assert.equal(el('Param0Value').value, 'Changed title'); assert.equal(el('Param2Value').value, 'scene'); assert.equal(content, original); await click('Check'); assert.equal(el('Apply').disabled, false);
  const proposal = proposals.at(-1), nextItems = originalValue.bindings[0].parameters.items_json.replace('"targetSceneId":"' + id(2) + '"', '"targetSceneId":"' + id(4) + '"'); assert.equal(proposal.bindings[0].parameters.items_json, nextItems); assert.deepEqual(proposal.bindings[1], originalValue.bindings[1]); assert.ok(proposal.afterContent.startsWith('\ufeff')); assert.ok(proposal.afterContent.endsWith('\r\n'));
  const expected = original.replace(JSON.stringify(originalValue.bindings[0].parameters.title), JSON.stringify('Changed title')).replace(JSON.stringify(originalValue.bindings[0].parameters.items_json), JSON.stringify(nextItems)); assert.equal(proposal.afterContent, expected);
  await click('Close'); assert.equal(content, original); assert.equal(applied.length, 0); assert.equal(await controller.open(), true); assert.equal(el('Param1Value').value, menu().replaceAll('\r\n', '\n')); assert.equal(el('Param0Value').value, 'Menu'); assert.equal(reads.length, 3);
});

test('every fixed menu helper message has English and Japanese text', async () => {
  const text = await fs.readFile(new URL('../../web/modules/app-scene-behavior-menu-targets.js', import.meta.url), 'utf8');
  for (const match of text.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) { assert.equal(typeof en[match[1]], 'string', 'English: ' + match[1]); assert.equal(typeof ja[match[1]], 'string', 'Japanese: ' + match[1]); }
});
