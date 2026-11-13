import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { setupSceneBehaviorParameters } from '../../web/modules/app-scene-behavior-parameters.js';
import { setupSceneBehaviorReferences } from '../../web/modules/app-scene-behavior-references.js';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { discoverGodotSceneRetryParameterContract } from '../../engine/godot-scene-retry-parameters.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES } from '../../engine/project-scene-retry-diagnostics.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { createSceneBehaviorProposal, isSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { captureSceneBehaviorReferences } from '../../engine/scene-behavior-reference-directory.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const defaults = { action_name: 'ui_accept', target_scene_id: '', state_values_json: DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES };
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
const retryContract = () => discoverGodotSceneRetryParameterContract(GODOT_ACTION_SCENE_RETRY_SCRIPT);
const noop = () => ({ refresh() {}, reset() {}, dispose() {} });
function model(parameters = {}) {
  return { format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(2), bindings: [
    { bindingId: id(101), instanceId: id(201), implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(301) }, parameters, events: [] },
    { bindingId: id(102), instanceId: id(202), implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(301) },
      parameters: { action_name: 'other_action', target_scene_id: id(4), state_values_json: '{ "score":19,"health":3 }', other_binding: false }, events: [] },
  ] };
}
function catalog(contract = retryContract()) {
  return { format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: 'documents/behaviors/demo.json', objectId: id(1),
    scene: { objectId: id(2), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('saved scene'),
      instances: [1, 2].map(n => ({ instanceId: id(200 + n), objectId: id(3), name: '同一定义 / Actor ' + n })) },
    sources: [{ objectId: id(301), sourcePath: 'documents/scripts/retry.txt', sourceRevision: hash(GODOT_ACTION_SCENE_RETRY_SCRIPT), name: 'retry.txt',
      ...(contract ? { parameterContract: contract } : {}) },
    { objectId: id(302), sourcePath: 'documents/scripts/custom.txt', sourceRevision: hash('ordinary author script'), name: 'custom.txt' }],
    dependencyRevision: hash('unchanged ordinary dependency snapshot') };
}
function directory(source, assemblyObjectId) {
  const scene = { objectId: id(2), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('saved scene') };
  const assembly = { objectId: id(501), name: '唯一组装 / Single assembly', sourcePath: 'documents/projects/game.json', sourceRevision: hash('saved assembly') };
  const raw = { format: 'viento-scene-behavior-reference-directory', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('saved reference world'),
    scene, instances: [1, 2].map(n => ({ instanceId: id(200 + n), objectId: id(3), name: 'Same actor definition', sourcePath: 'documents/definitions/actor.md', sourceRevision: hash('definition') })),
    assemblies: [assembly], selectedAssembly: assemblyObjectId ? { ...assembly,
      members: [{ ...scene, name: '当前场景' }, { objectId: id(4), name: '关卡 / Level', sourcePath: 'documents/scenes/level.json', sourceRevision: hash('level') }],
      inputMap: { objectId: id(502), sourcePath: 'documents/inputs/keyboard.json', sourceRevision: hash('saved input') }, actions: [{ name: 'retry_game', keys: ['Enter'] }] } : null };
  return captureSceneBehaviorReferences(copy(source), raw, scene);
}
async function fixture(t, settings = {}) {
  const initialModel = settings.model || model(), original = serialize(initialModel);
  let content = original, language = 'zh', listener = () => {};
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, behaviorSource: true, available: true,
    sourcePath: 'documents/behaviors/demo.json', sourceToken: 'retry-editor:1', referencesAvailable: settings.references !== false,
    audioTracksAvailable: false, animationClipsAvailable: false };
  const sourceClones = new WeakMap(), contractClones = new WeakMap(), checks = [], proposals = [], writes = [], reads = [];
  const cloneSource = source => { if (source && !sourceClones.has(source)) sourceClones.set(source, copy(source)); return source ? sourceClones.get(source) : source; };
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-behaviors', {
    setupSceneBehaviorStateBindings: noop, setupSceneBehaviorAnimationClips: noop,
    setupSceneBehaviorParameters: options => setupSceneBehaviorParameters({ ...options, getContext: () => {
      const value = options.getContext();
      if (value.contract && !contractClones.has(value.contract)) contractClones.set(value.contract, copy(value.contract));
      return { ...value, contract: value.contract ? contractClones.get(value.contract) : undefined, parameters: copy(value.parameters) };
    } }),
    setupSceneBehaviorReferences: options => setupSceneBehaviorReferences({ ...options, getContext: () => {
      const value = options.getContext(); return { ...value, source: cloneSource(value.source) };
    } }),
    captureScriptParameterContract: value => captureScriptParameterContract(copy(value)),
    inspectSceneBehaviors, isSceneBehaviorProposal,
    createSceneBehaviorProposal: (source, edit) => { const value = createSceneBehaviorProposal(copy(source), copy(edit)); proposals.push(value); return value; },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, baseSourceRevision: hash(original), sourceRevision: hash(content), content });
  let controller;
  controller = h.runtime.setupSceneBehaviors({ getContext: () => ({ ...context }), getSource: async () => snapshot(),
    inspect: async payload => { checks.push(copy(payload)); return settings.catalog ? settings.catalog(checks.length) : catalog(); },
    getReferences: async (source, options) => { reads.push(copy(options)); return directory(source, options.assemblyObjectId); },
    applyDraft: async (proposal, ports) => {
      assert.equal(ports.isCurrent(), true); writes.push(proposal); content = proposal.afterContent; context.sourceToken += ':applied'; controller.refresh();
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus() {} };
    } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('sceneBehaviors' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); };
  const click = async suffix => { el(suffix).click(); await settle(); };
  const rows = () => el('Parameters').querySelectorAll('.scene-behaviors-parameter').map((_, index) => ({ name: el('Param' + index + 'Name').value,
    type: el('Param' + index + 'Type').value, value: el('Param' + index + 'Value').value }));
  return { ...h, controller, context, original, initialModel, checks, proposals, writes, reads, el, rows, set, click, settle, snapshot,
    open: () => controller.open(), content: () => content,
    language: value => { language = value; listener(); },
    select: value => { set('Binding', value, 'change'); },
    parameter: name => { const option = el('ReferencesParameter').children.find(node => node.textContent.includes(name)); assert.ok(option); set('ReferencesParameter', option.value, 'change'); } };
}

test('an empty retry binding stays empty until explicit defaults, then named choices use the existing review and draft path', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true);
  assert.deepEqual(h.rows(), []); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.content(), h.original);
  assert.match(h.el('ParameterInterfaceStatus').textContent, /缺失 3/);
  for (const language of ['zh', 'en', 'ja', 'zh']) {
    h.language(language); assert.ok(h.el('ParameterInterfaceNote').textContent); assert.doesNotMatch(h.el('ParameterInterfaceNote').textContent, /完整动画|whole animation|アニメーション全体/);
    assert.deepEqual(h.rows(), []);
  }
  await h.click('AddMissingParameters');
  assert.deepEqual(h.rows(), Object.entries(defaults).map(([name, value]) => ({ name, type: 'string', value })));
  assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  await h.click('ReferencesLoad'); assert.equal(h.el('ReferencesAssembly').value, ''); assert.deepEqual(h.reads, [{ assemblyObjectId: null }]);
  h.set('ReferencesAssembly', id(501), 'change'); await h.settle();
  h.set('ReferencesKind', 'scene', 'change'); h.set('ReferencesChoice', id(4), 'change'); h.parameter('target_scene_id');
  assert.equal(h.el('Param1Value').value, '');
  assert.equal(h.el('ReferencesUse').disabled, false, JSON.stringify({ reads: h.reads, status: h.el('ReferencesStatus').textContent,
    assembly: h.el('ReferencesAssembly').value, kind: h.el('ReferencesKind').value, choice: h.el('ReferencesChoice').value, parameter: h.el('ReferencesParameter').value }));
  await h.click('ReferencesUse'); assert.equal(h.el('Param1Value').value, id(4), h.el('ReferencesStatus').textContent);
  h.set('ReferencesKind', 'action', 'change'); h.set('ReferencesChoice', 'retry_game', 'change'); h.parameter('action_name');
  assert.equal(h.el('Param0Value').value, 'ui_accept'); await h.click('ReferencesUse'); assert.equal(h.el('Param0Value').value, 'retry_game');
  assert.equal(h.el('Param2Value').value, defaults.state_values_json); assert.equal(h.content(), h.original);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  assert.deepEqual(h.proposals.at(-1).bindings[0].parameters, { ...defaults, action_name: 'retry_game', target_scene_id: id(4) });
  assert.deepEqual(h.proposals.at(-1).bindings[1], h.initialModel.bindings[1]);
  await h.click('Apply'); assert.equal(h.writes.length, 1);
  assert.ok(h.content().startsWith('\ufeff')); assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false);
  assert.deepEqual(JSON.parse(h.content().slice(1)).bindings[1], h.initialModel.bindings[1]);
});

test('adding missing retry defaults preserves existing values, unknown rows and unfinished numeric text', async t => {
  const h = await fixture(t, { model: model({ action_name: 0, legacy_text: '  authored\r\nvalue  ', amount: 2, state_values_json: '{ "health":3 }' }) });
  await h.open(); h.set('Param2Value', '1e-'); const originalRows = h.rows();
  assert.match(h.el('ParameterInterfaceStatus').textContent, /类型不匹配 1/);
  await h.click('AddMissingParameters');
  assert.deepEqual(h.rows().slice(0, 4), originalRows);
  assert.deepEqual(h.rows()[4], { name: 'target_scene_id', type: 'string', value: '' });
  assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.proposals.length, 0);
  assert.equal(h.el('Param2Value').value, '1e-');
  h.select(id(102)); h.select(id(101)); assert.equal(h.el('Param2Value').value, '1e-');
  h.set('Param2Value', '2'); await h.click('Check');
  assert.equal(h.proposals.at(-1).bindings[0].parameters.legacy_text, h.initialModel.bindings[0].parameters.legacy_text);
  await h.click('Cancel'); await h.open();
  assert.deepEqual(h.rows(), Object.entries(h.initialModel.bindings[0].parameters).map(([name, value]) => ({ name, type: typeof value, value: String(value).replaceAll('\r\n', '\n').replaceAll('\r', '\n') })));
  assert.equal(h.writes.length, 0);
});

test('old Add and Rename controls cannot follow a different binding, source or reopened dialog', async t => {
  for (const change of [h => h.select(id(102)), h => h.set('Source', id(302), 'change'), async h => { await h.click('Cancel'); await h.open(); }]) {
    const h = await fixture(t, { model: model({ old_action: ' keep authored ' }) }); await h.open();
    h.set('Param0ContractTarget', 'action_name', 'change'); const add = h.el('AddMissingParameters'), rename = h.el('Param0RenameParameter');
    await change(h); const before = h.rows();
    add.disabled = false; rename.disabled = false; add.click(); rename.click();
    assert.deepEqual(h.rows(), before); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  }
});

test('withdrawing reference, sound and animation helpers leaves retry defaults and ordinary review available', async t => {
  const h = await fixture(t); await h.open();
  h.context.referencesAvailable = false; h.context.animationClipsAvailable = false; h.context.audioTracksAvailable = false; h.controller.refresh();
  assert.equal(h.el('ReferencesTools').hidden, true); assert.equal(h.el('ParameterInterface').hidden, false);
  await h.click('AddMissingParameters'); assert.equal(h.rows().length, 3);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  await h.click('Apply'); assert.equal(h.writes.length, 1); assert.deepEqual(JSON.parse(h.content().slice(1)).bindings[0].parameters, defaults);
});

test('fresh advisory contract withdrawal, revival and changed defaults revoke old helper controls without revoking an ordinary proposal', async t => {
  let currentContract = retryContract();
  const h = await fixture(t, { model: model({ legacy_action: 'original' }), catalog: () => catalog(currentContract) });
  await h.open(); const initialField = h.el('Param0Value');
  h.set('Param0ContractTarget', 'action_name', 'change'); const originalAdd = h.el('AddMissingParameters'), originalRename = h.el('Param0RenameParameter');
  const modified = captureScriptParameterContract({ ...copy(retryContract()), status: 'modified', parameters: [] });
  for (const [index, next] of [null, modified, retryContract()].entries()) {
    currentContract = next; h.set('Param0Value', 'ordinary manual edit ' + index); await h.click('Check');
    assert.equal(h.el('Apply').disabled, false, 'optional interface changes do not invalidate the ordinary dependency review');
    assert.equal(h.el('Param0Value'), initialField, 'provider refresh must not rebuild authored form rows');
    const before = h.rows(), afterText = h.el('After').textContent;
    originalAdd.disabled = false; originalRename.disabled = false; originalAdd.click(); originalRename.click();
    assert.deepEqual(h.rows(), before); assert.equal(h.el('After').textContent, afterText); assert.equal(h.el('Apply').disabled, false);
  }
  assert.equal(h.el('ParameterInterface').hidden, false);
  h.set('Param0ContractTarget', 'action_name', 'change'); const revivedAdd = h.el('AddMissingParameters'), revivedRename = h.el('Param0RenameParameter');
  const changed = copy(retryContract()); changed.parameters[0].defaultValue = 'fresh_provider_default'; currentContract = captureScriptParameterContract(changed);
  h.set('Param0Value', 'fresh ordinary proposal'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const before = h.rows(); revivedAdd.disabled = false; revivedRename.disabled = false; revivedAdd.click(); revivedRename.click();
  assert.deepEqual(h.rows(), before); assert.equal(h.el('Apply').disabled, false);
  await h.click('Apply'); assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(h.content().slice(1)).bindings[0].parameters, { legacy_action: 'fresh ordinary proposal' });
  assert.deepEqual(JSON.parse(h.content().slice(1)).bindings[1], h.initialModel.bindings[1]);
});

test('only current refreshed defaults may be explicitly added, and all-animation contracts retain their existing note', async t => {
  let currentContract = retryContract(); const h = await fixture(t, { model: model({ legacy: 'keep' }), catalog: () => catalog(currentContract) });
  await h.open(); const old = h.el('AddMissingParameters');
  const changed = copy(retryContract()); changed.parameters[0].defaultValue = 'latest_default'; currentContract = captureScriptParameterContract(changed);
  h.set('Param0Value', 'manual'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  old.disabled = false; old.click(); assert.equal(h.rows().length, 1);
  await h.click('AddMissingParameters'); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.rows().map(row => [row.name, row.value]), [['legacy', 'manual'], ['action_name', 'latest_default'], ['target_scene_id', ''], ['state_values_json', defaults.state_values_json]]);
  const clipContract = captureScriptParameterContract({ format: 'viento-script-parameters', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready',
    parameters: [{ name: 'clip_idle', type: 'string', defaultValue: '', referenceKind: 'animation-clip' }] });
  const animation = await fixture(t, { catalog: () => catalog(clipContract) }); await animation.open();
  assert.match(animation.el('ParameterInterfaceNote').textContent, /完整动画/); assert.deepEqual(animation.rows(), []);
});

test('an advisory change on another source preserves the active source helper and its pending rename choice', async t => {
  let changedOtherSource = false;
  const h = await fixture(t, { model: model({ legacy_action: 'keep' }), catalog: () => {
    const value = catalog(); if (changedOtherSource) value.sources[1].parameterContract = retryContract(); return value;
  } });
  await h.open(); h.set('Param0ContractTarget', 'action_name', 'change');
  const add = h.el('AddMissingParameters'), rename = h.el('Param0RenameParameter'), field = h.el('Param0Value');
  changedOtherSource = true; h.set('Param0Value', 'manual'); await h.click('Check');
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('AddMissingParameters'), add);
  assert.equal(h.el('Param0RenameParameter'), rename); assert.equal(h.el('Param0ContractTarget').value, 'action_name');
  assert.equal(h.el('Param0Value'), field); assert.equal(field.value, 'manual');
  await h.click('Param0RenameParameter'); assert.equal(h.el('Param0Name').value, 'action_name');
  assert.equal(h.el('Param0Value').value, 'manual'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
});
