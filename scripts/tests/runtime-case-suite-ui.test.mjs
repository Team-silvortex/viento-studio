import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parse } from 'acorn';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { summarizeRuntimeCaseSuite } from '../../engine/runtime-case-suite-contract.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { createSceneRuntimeObservation, querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const suiteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', copyId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const caseIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'];
const instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const version = `sha256:${'1'.repeat(64)}`, nextVersion = `sha256:${'2'.repeat(64)}`, sceneVersion = `sha256:${'3'.repeat(64)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const definition = () => ({ format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: sceneId, documentIds: [...caseIds].reverse() });
const original = () => '\uFEFF' + JSON.stringify(definition(), null, 3).replaceAll('\n', '\r\n') + '\r\n';
const saved = (changes = {}) => ({ id: suiteId, path: 'documents/runtime-suites/dddddddd-suite.json', title: '<Group>', version,
  sceneId, sceneVersion, definition: definition(), content: original(), valid: true, diagnostics: [], ...changes });
const cases = () => caseIds.map((id, index) => ({ id, path: `documents/cases/${index}.json`, title: `Case ${index + 1}`, version, sceneId, valid: true, diagnostics: [] }));
const catalog = (changes = {}) => ({ sceneId, sceneVersion, documents: [saved()], cases: cases(),
  defaults: { documentsPath: 'documents', documentType: 'document', documentTypes: [{ id: 'document', label: '作品说明' }, { id: 'note', label: '笔记' }] }, ...changes });
function status() {
  return { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.bevy', version: '0.3.0', label: 'Bevy', platforms: ['linux'],
    plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
    capabilities: ['scene2d', 'runtime.control-replay', 'runtime.control-replay.instances'],
    execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: sceneId, title: 'Scene', sourcePath: 'documents/scenes/scene.json' }, { id: otherSceneId, title: 'Other', sourcePath: 'documents/scenes/other.json' }],
    latestBuild: { id: 'owned-build', backendId: 'org.viento.bevy', sceneId, snapshotId: `sha256:${'4'.repeat(64)}`, planSchemaVersion: 2,
      actorCount: 1, controlTargets: [{ instanceId, objectId, name: 'Actor' }] }, job: null };
}
async function harness(initial = status()) {
  let payload = initial, dictionary = {};
  let responder = body => body.action === 'suite-list' ? catalog() : body.action === 'suite-load' ? saved()
    : body.action === 'suite-run' ? payload : saved({ id: body.documentId || copyId, path: body.sourcePath || saved().path,
      version: nextVersion, content: body.content, definition: JSON.parse(body.content.replace(/^\uFEFF/, '')) });
  const languages = [], calls = [], ordinary = [], context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/scenes/scene.json' };
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build', t: translate, onLanguageChange: callback => languages.push(callback), querySceneRuntimeObservation,
    validateSceneControlProgram: value => validateSceneControlProgram(clone(value)), validateSceneControlPlan: (plan, value) => validateSceneControlPlan(clone(plan), clone(value)),
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    requestProjectBuildDocument: async body => { calls.push(clone(body)); return await responder(body); },
    fetchJsonApiRequest: async (url, options) => { ordinary.push({ url, body: options.body ? JSON.parse(options.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context }); controller.setAvailable(true);
  h.element('projectBuildBtn').click(); await flushDialogs();
  const checkboxes = () => h.element('projectBuildSuiteCases').querySelectorAll('input');
  return { ...h, controller, calls, ordinary, context,
    respond(value) { responder = typeof value === 'function' ? value : () => value; },
    async click(suffix) { h.element(`projectBuildSuite${suffix}`).click(); await flushDialogs(); },
    select(id = suiteId) { const input = h.element('projectBuildSuiteSelect'); input.value = id; input.dispatch('change'); },
    member(id, checked = true) { const input = checkboxes().find(item => item.dataset.documentId === id); assert.ok(input); input.checked = checked; input.dispatch('change'); return input; },
    selected() { return checkboxes().filter(input => input.checked).map(input => input.dataset.documentId); },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async tick(value = payload) { payload = value; const [id, callback] = [...h.timers][0] || []; assert.ok(callback); h.timers.delete(id); callback(); await flushDialogs(); },
    async close() { h.element('projectBuildClose').click(); await flushDialogs(); },
    async reopen() { h.element('projectBuildBtn').click(); await flushDialogs(); },
    scene(id) { const input = h.element('projectBuildScene'); input.value = id; input.dispatch('change'); },
  };
}
async function loaded(initial) { const h = await harness(initial); await h.click('Refresh'); h.select(); await h.click('Load'); return h; }
function batch(states, executionStatus = 'succeeded') {
  const value = status(), entries = states.map((state, index) => ({ documentId: caseIds[index], title: index ? '<img onerror=window.bad>' : 'First', sourceVersion: version,
    state, executionStatus: ['queued', 'running', 'not-run'].includes(state) ? null : state === 'incomplete' ? 'cancelled' : 'succeeded',
    sessionId: ['queued', 'not-run'].includes(state) ? null : `99999999-9999-4999-8999-99999999999${index}`,
    checkCount: 1, passedChecks: state === 'passed' ? 1 : 0, failedChecks: state === 'failed' ? 1 : 0, unavailableChecks: state === 'incomplete' ? 1 : 0 }));
  value.job = { id: 'owned-suite-task', kind: 'suite', status: executionStatus, sceneId, backendId: value.backend.id,
    buildId: value.latestBuild.id, snapshotId: value.latestBuild.snapshotId, diagnostics: [], events: [], logs: '',
    suite: { documentId: suiteId, sourceVersion: version, sceneObjectId: sceneId, entries, summary: summarizeRuntimeCaseSuite(states) } };
  return value;
}

test('suite authoring is explicit, saves ordered membership without a build tool, and does not edit any core case/program', async () => {
  const state = status(); state.available = false; state.latestBuild = null;
  const h = await harness(state), input = h.element('projectBuildCaseProgram'); input.value = '{ independent case draft';
  const control = h.element('projectBuildControlProgram').value; assert.equal(h.calls.length, 0);
  await h.click('Refresh'); h.member(caseIds[1]); h.member(caseIds[0]); assert.deepEqual(h.selected(), definition().documentIds);
  assert.equal(h.element('projectBuildSuiteRun').disabled, true); await h.click('Save');
  const body = h.calls.at(-1); assert.equal(body.action, 'suite-save'); assert.equal(body.documentType, 'document');
  assert.deepEqual(JSON.parse(body.content), definition()); assert.equal(body.documentId, undefined); assert.equal(body.expectedVersion, undefined);
  assert.equal(body.sourcePath, 'documents/runtime-suites/dddddddd-suite-2.json');
  assert.equal(input.value, '{ independent case draft'); assert.equal(h.element('projectBuildControlProgram').value, control);
  assert.equal(h.calls.filter(body => body.action === 'suite-run').length, 0);
});

test('loaded order and raw BOM/CRLF/indentation are preserved; a run submits only saved group identity and its captured revision', async () => {
  const h = await loaded(); assert.deepEqual(h.selected(), definition().documentIds);
  await h.click('Save'); assert.equal(h.calls.at(-1).content, original()); assert.equal(h.calls.at(-1).expectedVersion, version);
  assert.equal(h.calls.at(-1).sourcePath, undefined); await h.click('Run');
  assert.deepEqual(h.calls.at(-1), { action: 'suite-run', buildId: 'owned-build', suiteDocumentId: suiteId, expectedVersion: nextVersion });
  assert.equal(h.calls.at(-1).documentIds, undefined); assert.equal(h.calls.at(-1).runtimeCase, undefined);
});

test('membership edits disable running and declined loading protects both nonempty and cleared drafts', async () => {
  const h = await loaded(); h.member(caseIds[0], false); assert.equal(h.element('projectBuildSuiteRun').disabled, true);
  h.runtime.window.confirm = () => false; const before = h.calls.length; await h.click('Load');
  assert.equal(h.calls.length, before); assert.deepEqual(h.selected(), [caseIds[1]]);
  h.member(caseIds[1], false); await h.click('Load'); assert.equal(h.calls.length, before); assert.deepEqual(h.selected(), []);
  h.runtime.window.confirm = () => true; await h.click('Load'); assert.deepEqual(h.selected(), definition().documentIds);
  h.member(caseIds[0], false); h.member(caseIds[0], true); assert.deepEqual(h.selected(), definition().documentIds);
  assert.equal(h.element('projectBuildSuiteRun').disabled, false, 'returning to exact baseline order clears dirty');
});

test('selection order remains visible and stable through explicit refresh, polling, language changes and close/reopen', async () => {
  const h = await loaded(); h.member(caseIds[1], false); h.member(caseIds[1], true); const order = [caseIds[0], caseIds[1]];
  const path = h.element('projectBuildSuitePath'); path.value = 'documents/groups/my-suite.json'; path.dispatch('input'); path.focus(); path.selectionStart = 3; path.selectionEnd = 11;
  const before = h.calls.length;
  for (const [dictionary, label] of [[{}, '保存验收组'], [en, 'Save suite'], [ja, 'グループを保存']]) {
    h.language(dictionary); await h.refresh(); assert.deepEqual(h.selected(), order); assert.equal(h.element('projectBuildSuiteSave').textContent, label);
    assert.equal(path.value, 'documents/groups/my-suite.json'); assert.equal(path.selectionStart, 3); assert.equal(path.selectionEnd, 11);
  }
  await h.close(); await h.reopen(); assert.deepEqual(h.selected(), order); assert.equal(h.calls.length, before);
  await h.click('Refresh'); assert.deepEqual(h.selected(), order, 'author list sorting never sorts the local selected IDs');
});

test('document and scene CAS conflicts preserve selection and old baselines; save-as uses fresh scene revision and a distinct source', async () => {
  const h = await loaded(); h.member(caseIds[0], false);
  for (const code of ['runtime_suite_document_conflict', 'runtime_suite_scene_conflict']) {
    h.respond(async () => { throw Object.assign(new Error('Conflict'), { code, status: 409 }); }); await h.click('Save');
    assert.match(h.element('projectBuildSuiteError').textContent, /原文已变化/); assert.deepEqual(h.selected(), [caseIds[1]]);
  }
  h.respond(catalog({ sceneVersion: nextVersion, documents: [saved({ version: nextVersion })] })); await h.click('Refresh');
  h.respond(async () => { throw Object.assign(new Error('Conflict'), { code: 'runtime_suite_scene_conflict', status: 409 }); }); await h.click('Save');
  assert.equal(h.calls.at(-1).sceneVersion, sceneVersion); assert.equal(h.calls.at(-1).expectedVersion, version);
  h.respond(body => saved({ id: copyId, path: body.sourcePath, version: nextVersion, sceneVersion: nextVersion, content: body.content })); await h.click('SaveAs');
  const body = h.calls.at(-1); assert.equal(body.sceneVersion, nextVersion); assert.equal(body.documentId, undefined); assert.equal(body.expectedVersion, undefined);
  assert.notEqual(body.sourcePath, saved().path); assert.deepEqual(JSON.parse(body.content).documentIds, [caseIds[1]]);
});

test('late author reads cannot replace another scene or a reopened group draft', async () => {
  for (const action of ['scene', 'reopen']) {
    const h = await loaded(); h.member(caseIds[0], false); const wait = deferred(); h.respond(() => wait.promise);
    h.element('projectBuildSuiteLoad').click();
    if (action === 'scene') { h.scene(otherSceneId); h.scene(sceneId); }
    else { await h.close(); await h.reopen(); await h.click('New'); h.member(caseIds[0]); }
    const members = h.selected(); wait.resolve(saved()); await flushDialogs(); assert.deepEqual(h.selected(), members, action);
  }
});

test('pending save close and lost or invalid responses block duplicate writes until explicit read reconciliation', async () => {
  const h = await loaded(), wait = deferred(); h.respond(() => wait.promise); h.element('projectBuildSuiteSave').click();
  const submitted = h.calls.at(-1); await h.close(); await h.reopen();
  for (const action of ['Save', 'SaveAs', 'New', 'Run']) assert.equal(h.element(`projectBuildSuite${action}`).disabled, true);
  const before = h.calls.length; await h.click('Save'); assert.equal(h.calls.length, before);
  wait.resolve(saved({ version: nextVersion, content: submitted.content })); await flushDialogs(); assert.equal(h.element('projectBuildSuiteSave').disabled, true);
  h.respond(saved({ version: nextVersion })); await h.click('Load'); assert.equal(h.element('projectBuildSuiteSave').disabled, false);
  for (const status of [undefined, 200, 500]) {
    h.respond(async () => { throw Object.assign(new Error('Response unknown'), { status }); }); await h.click('Save');
    assert.equal(h.element('projectBuildSuiteSaveAs').disabled, true); const count = h.calls.length; await h.refresh(); assert.equal(h.calls.length, count);
    h.respond(saved()); await h.click('Load'); assert.equal(h.element('projectBuildSuiteSave').disabled, false);
  }
});

test('foreign-scene membership is preserved but cannot run or update; explicit New binds the same selection to the selected scene', async () => {
  const h = await loaded(); h.scene(otherSceneId); const other = status(); other.latestBuild.sceneId = otherSceneId; await h.refresh(other);
  assert.deepEqual(h.selected(), definition().documentIds); assert.equal(h.element('projectBuildSuiteRun').disabled, true); assert.equal(h.element('projectBuildSuiteSave').disabled, true);
  await h.click('New'); assert.deepEqual(h.selected(), definition().documentIds); assert.equal(h.element('projectBuildSuiteRun').disabled, true);
  h.respond(catalog({ sceneId: otherSceneId, documents: [], cases: cases().map(item => ({ ...item, sceneId: otherSceneId })) })); await h.click('Refresh');
  h.respond(body => saved({ id: copyId, sceneId: otherSceneId, version: nextVersion, content: body.content })); await h.click('Save');
  assert.equal(JSON.parse(h.calls.at(-1).content).sceneObjectId, otherSceneId); assert.equal(h.calls.at(-1).documentId, undefined);
});

test('member limits and missing members stay visible for deliberate repair without importing expectations or a frontend queue', async () => {
  const many = Array.from({ length: 17 }, (_, index) => ({ ...cases()[0], id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, title: `Case ${index}` }));
  const h = await harness(); h.respond(catalog({ cases: many })); await h.click('Refresh');
  for (const item of many.slice(0, 16)) h.member(item.id); const seventeenth = h.element('projectBuildSuiteCases').querySelectorAll('input').find(input => input.dataset.documentId === many[16].id);
  assert.equal(seventeenth.disabled, true); h.member(many[16].id); assert.equal(h.selected().length, 16); assert.match(h.element('projectBuildSuiteError').textContent, /16/);
  const stale = saved({ valid: false, diagnostics: [{ code: 'runtime_suite_member_missing' }] });
  h.respond(body => body.action === 'suite-list' ? catalog({ cases: cases().slice(0, 1), documents: [stale] }) : stale);
  await h.click('Refresh'); h.select(); await h.click('Load'); assert.deepEqual(h.selected(), definition().documentIds);
  assert.match(h.element('projectBuildSuiteCases').textContent, /需要修复/); assert.equal(h.element('projectBuildSuiteRun').disabled, true);
  h.member(caseIds[1], false); assert.deepEqual(h.selected(), [caseIds[0]]); assert.equal(h.element('projectBuildSuiteSave').disabled, false);
});

test('author drafts, missing tools, plan 1/3, capabilities, backend ownership and offline source all prevent batch admission', async () => {
  const h = await loaded();
  for (const field of ['dirty', 'creating', 'busy', 'editable']) {
    h.context[field] = field !== 'editable'; const before = h.calls.length; await h.click('Run'); await h.click('Save'); assert.equal(h.calls.length, before);
    h.context[field] = field === 'editable'; h.controller.setAvailable(true);
  }
  for (const variant of [{ ...status(), available: false }, { ...status(), latestBuild: { ...status().latestBuild, planSchemaVersion: 1 } },
    { ...status(), latestBuild: { ...status().latestBuild, planSchemaVersion: 3 } },
    { ...status(), backend: { ...status().backend, capabilities: ['scene2d'] } },
    { ...status(), latestBuild: { ...status().latestBuild, backendId: 'other.backend' } },
    { ...status(), catalogDiagnostic: { code: 'build_catalog_unavailable' } }]) {
    await h.refresh(variant); assert.equal(h.element('projectBuildSuiteRun').disabled, true); const before = h.calls.length; await h.click('Run'); assert.equal(h.calls.length, before);
  }
});

test('host progress distinguishes assertion failures from execution, displays safe member titles and uses existing task cancellation', async () => {
  const h = await loaded(), active = batch(['running', 'queued'], 'running'); h.respond(active); await h.click('Run');
  assert.equal(h.element('projectBuildSuiteResult').hidden, false); assert.match(h.element('projectBuildSuiteSummary').textContent, /进行中/);
  assert.equal(h.element('projectBuildSuiteRun').disabled, true); assert.equal(h.element('projectBuildCaseRun').disabled, true);
  h.element('projectBuildCancel').click(); await flushDialogs(); assert.deepEqual(h.ordinary.at(-1).body, { action: 'cancel', jobId: 'owned-suite-task' });
  for (const [states, jobStatus, expected] of [[['passed', 'failed'], 'succeeded', '未通过'], [['incomplete', 'not-run'], 'cancelled', '未完成'], [['passed', 'passed'], 'succeeded', '通过']]) {
    await h.refresh(batch(states, jobStatus)); assert.match(h.element('projectBuildSuiteSummary').textContent, new RegExp(expected));
    assert.equal(h.element('projectBuildSuiteEntries').children.length, 2); const row = h.element('projectBuildSuiteEntries').children[1];
    assert.ok(row.textContent.includes('<img onerror=window.bad>')); assert.equal(row.querySelectorAll('img').length, 0);
  }
  const malformed = clone(batch(['passed', 'failed'])); malformed.job.suite.summary.status = 'passed'; await h.refresh(malformed);
  assert.equal(h.element('projectBuildSuiteEntries').children.length, 0); assert.match(h.element('projectBuildSuiteSummary').textContent, /不可读取/);
  await h.refresh(batch(['passed', 'passed'])); assert.equal(h.element('projectBuildSuiteEntries').children.length, 2);
});

test('suite runtime observations stay available but never authorize generating a single-case baseline or showing its result', async () => {
  const h = await loaded(), state = batch(['passed', 'passed']);
  const plan = { format: 'viento-build-plan', kind: 'scene2d', schemaVersion: 2, scene: { objectId: sceneId, sourcePath: 'documents/scenes/scene.json' },
    actors: [{ instanceId, objectId, name: 'Actor', sourcePath: 'documents/characters/actor.md' }] };
  const program = { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [{ left: false, right: false, up: false, down: false }] };
  const actors = [{ instanceId, objectId, position: [10, 20], state: 'idle' }], observer = createSceneRuntimeObservation(plan, { controlProgram: program });
  observer.push({ event: 'ready', protocol: 2, sceneObjectId: sceneId, actors });
  const sample = { format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2, event: 'sample', stepIndex: 0, actors };
  observer.pushSample(sample); observer.push({ event: 'finished', protocol: 2, actors, fixedDelta: 0.125 });
  state.job.runtime = observer.snapshot(); state.job.control = { program, samples: [sample] }; state.job.verification = { definition: {}, evaluation: {} };
  await h.refresh(state); assert.equal(h.element('projectBuildRuntimeObjects').hidden, false);
  assert.equal(h.element('projectBuildCaseGenerate').disabled, true); assert.equal(h.element('projectBuildCaseResult').hidden, true);
});

test('a lost suite-run response is reconciled by ordinary GET polling without requeuing the batch', async () => {
  const h = await loaded(); h.respond(async () => { throw new Error('Lost startup response'); }); await h.click('Run');
  const count = h.calls.length; assert.equal(h.element('projectBuildSuiteRun').disabled, true); await h.tick(batch(['running', 'queued'], 'running'));
  assert.equal(h.calls.length, count); assert.equal(h.element('projectBuildCancel').hidden, false);
});


test('suite GUI imports only its browser-pure contract; the portable closure has no author parser, installed dependency or host globals', async () => {
  const ui = await fs.readFile(new URL('../../web/modules/app-runtime-case-suites.js', import.meta.url), 'utf8');
  assert.match(ui, /from ['"]\.\.\/\.\.\/engine\/runtime-case-suite-contract\.mjs['"]/);
  assert.doesNotMatch(ui, /from ['"]\.\.\/\.\.\/engine\/runtime-case-suite\.mjs['"]/);
  const engineRoot = new URL('../../engine/', import.meta.url), pending = [new URL('runtime-case-suite-contract.mjs', engineRoot)], visited = new Set();
  const forbiddenGlobals = new Set(['process', 'require', '__dirname', '__filename', 'document', 'window', 'navigator', 'fetch', 'WebSocket', 'XMLHttpRequest']);
  while (pending.length) {
    const file = pending.pop(); if (visited.has(file.href)) continue; visited.add(file.href);
    assert.ok(file.href.startsWith(engineRoot.href), `portable contract dependency escaped engine: ${file.href}`);
    const source = await fs.readFile(file, 'utf8'), ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      assert.notEqual(node.type, 'ImportExpression', 'the small suite contract needs no dynamic dependency');
      if (node.type === 'Identifier') assert.ok(!forbiddenGlobals.has(node.name), `host or DOM global in contract: ${node.name}`);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
    };
    walk(ast);
    for (const node of ast.body) {
      if (!/^(ImportDeclaration|ExportAllDeclaration|ExportNamedDeclaration)$/.test(node.type) || !node.source) continue;
      assert.match(node.source.value, /^\.{1,2}\//, 'contract imports an explicit portable path');
      assert.doesNotMatch(node.source.value, /node_modules|yaml|node:|json-source|runtime-case-document/, 'author parsers stay outside GUI contract');
      pending.push(new URL(node.source.value, file));
    }
  }
  assert.ok(visited.size >= 1);
});
