import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const documentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', copyId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const version = `sha256:${'1'.repeat(64)}`, nextVersion = `sha256:${'2'.repeat(64)}`, sceneVersion = `sha256:${'3'.repeat(64)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const definition = () => ({ format: 'viento-runtime-case', schemaVersion: 1,
  program: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25,
    steps: [{ left: false, right: false, up: false, down: false }] },
  checks: [{ instanceId, stepIndex: 0, position: { value: [10, 20], tolerance: 0.0001 }, state: 'idle' }] });
const envelope = () => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: definition() });
const originalContent = () => '\uFEFF' + JSON.stringify(envelope(), null, 3).replaceAll('\n', '\r\n') + '\r\n';
const saved = (changes = {}) => ({ id: documentId, path: 'content/verification/saved.json', title: '<Case>', version,
  sceneId, sceneVersion, content: originalContent(), definition: definition(), valid: true, diagnostics: [], ...changes });
const catalog = (documents = [saved()], changes = {}) => ({ sceneId, sceneVersion, documents,
  defaults: { documentsPath: 'content', documentType: 'oc', documentTypes: [{ id: 'oc', label: '角色' }, { id: 'note', label: '笔记' }] }, ...changes });
function status() {
  return { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.bevy', version: '0.3.0', label: 'Bevy', platforms: ['linux'],
    plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
    capabilities: ['scene2d', 'runtime.control-replay', 'runtime.control-replay.instances'],
    execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: sceneId, title: 'Scene', sourcePath: 'content/scenes/scene.json' }, { id: otherSceneId, title: 'Other', sourcePath: 'content/scenes/other.json' }],
    latestBuild: { id: 'owned-build', backendId: 'org.viento.bevy', sceneId, snapshotId: `sha256:${'4'.repeat(64)}`, planSchemaVersion: 2,
      actorCount: 1, controlTargets: [{ instanceId, objectId, name: 'Actor' }] }, job: null };
}
async function harness(initial = status()) {
  let payload = initial, responder = body => body.action === 'case-list' ? catalog() : body.action === 'case-load' ? saved()
    : saved({ id: body.documentId || copyId, path: body.sourcePath || saved().path, version: nextVersion, content: body.content,
      definition: JSON.parse(body.content.replace(/^\uFEFF/, '')).case });
  let dictionary = {};
  const languages = [], calls = [], jobs = [], context = { editable: true, dirty: false, busy: false, creating: false, path: 'content/scenes/scene.json' };
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build', t: translate, onLanguageChange: callback => languages.push(callback),
    validateSceneControlProgram: value => validateSceneControlProgram(clone(value)),
    validateSceneControlPlan: (plan, value) => validateSceneControlPlan(clone(plan), clone(value)),
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    requestProjectBuildDocument: async body => { calls.push(clone(body)); return await responder(body); },
    fetchJsonApiRequest: async (url, options) => { if (options.body) jobs.push(JSON.parse(options.body)); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, calls, jobs, context,
    respond(value) { responder = typeof value === 'function' ? value : () => value; },
    async click(suffix) { h.element(`projectBuildCaseDocument${suffix}`).click(); await flushDialogs(); },
    select(id = documentId) { const input = h.element('projectBuildCaseDocumentSelect'); input.value = id; input.dispatch('change'); },
    input(value = JSON.stringify(definition(), null, 2)) { const input = h.element('projectBuildCaseProgram'); input.value = value; input.dispatch('input'); return input; },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async close() { h.element('projectBuildClose').click(); await flushDialogs(); },
    async reopen() { h.element('projectBuildBtn').click(); await flushDialogs(); },
    scene(id) { const input = h.element('projectBuildScene'); input.value = id; input.dispatch('change'); },
  };
}

test('author case registration is explicit and works without a configured build tool or artifact', async () => {
  const state = status(); state.available = false; state.latestBuild = null;
  const h = await harness(state); h.input(); assert.equal(h.calls.length, 0);
  h.respond(body => body.action === 'case-list' ? catalog([]) : saved({ id: copyId, version: nextVersion, path: body.sourcePath, content: body.content }));
  await h.click('Refresh'); assert.equal(h.element('projectBuildCaseDocumentPath').value, 'content/runtime-cases/dddddddd-case.json');
  assert.equal(h.element('projectBuildCaseDocumentType').value, 'oc');
  assert.equal(h.element('projectBuildCaseDocumentSave').disabled, false);
  await h.click('Save'); const body = h.calls.at(-1);
  assert.deepEqual(Object.keys(body).sort(), ['action', 'sceneId', 'sceneVersion', 'content', 'sourcePath', 'documentType'].sort());
  assert.equal(body.sceneId, sceneId); assert.equal(body.sceneVersion, sceneVersion); assert.equal(body.documentType, 'oc');
  assert.deepEqual(JSON.parse(body.content), envelope()); assert.equal(h.jobs.length, 0);
  assert.match(h.element('projectBuildCaseDocumentStatus').textContent, /已载入/);
});

test('selecting never overwrites the case; declined load preserves text/caret and clean save preserves original BOM and CRLF bytes', async () => {
  const h = await harness(); await h.click('Refresh');
  const input = h.input('{ local unfinished draft'); input.focus(); input.selectionStart = 2; input.selectionEnd = 7;
  const controlText = h.element('projectBuildControlProgram').value; h.select(); const before = h.calls.length;
  h.runtime.window.confirm = () => false; await h.click('Load');
  assert.equal(h.calls.length, before); assert.equal(input.value, '{ local unfinished draft'); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 7);
  h.runtime.window.confirm = () => true; await h.click('Load'); assert.deepEqual(JSON.parse(input.value), definition());
  assert.equal(h.element('projectBuildControlProgram').value, controlText);
  await h.click('Save'); const body = h.calls.at(-1);
  assert.equal(body.content, originalContent()); assert.equal(body.expectedVersion, version); assert.equal(body.documentId, documentId);
  assert.equal(body.sourcePath, undefined); assert.equal(body.documentType, undefined);
  h.element('projectBuildCaseRun').click(); await flushDialogs();
  assert.equal(h.jobs.at(-1).runtimeCaseSceneId, sceneId); assert.deepEqual(h.jobs.at(-1).runtimeCase, definition());
});

test('HTTP document conflicts preserve local edits and the loaded revision; save-as creates a distinct registered source', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load');
  const changed = definition(); changed.checks[0].position.value[0] = 99; const input = h.input(JSON.stringify(changed));
  h.respond(async () => { throw Object.assign(new Error('Conflict'), { code: 'runtime_case_document_conflict', status: 409 }); });
  await h.click('Save'); assert.equal(input.value, JSON.stringify(changed)); assert.match(h.element('projectBuildCaseDocumentError').textContent, /原文已变化/);
  h.respond(catalog([saved({ version: nextVersion })])); await h.click('Refresh');
  h.respond(async () => { throw Object.assign(new Error('Conflict'), { code: 'runtime_case_document_conflict', status: 409 }); });
  await h.click('Save'); assert.equal(h.calls.at(-1).expectedVersion, version, 'refresh never silently accepts an external document revision');
  h.respond(body => saved({ id: copyId, path: body.sourcePath, content: body.content, version: nextVersion, definition: changed }));
  await h.click('SaveAs'); const body = h.calls.at(-1);
  assert.equal(body.documentId, undefined); assert.equal(body.expectedVersion, undefined); assert.notEqual(body.sourcePath, saved().path);
  assert.deepEqual(JSON.parse(body.content).case, changed); assert.equal(input.value, JSON.stringify(changed));
});

test('late loads cannot overwrite edits, another scene, a reopened dialog or a replacement selection', async () => {
  for (const intervention of ['edit', 'scene', 'reopen', 'selection']) {
    const h = await harness(); await h.click('Refresh'); h.select();
    const wait = deferred(); h.respond(() => wait.promise); h.element('projectBuildCaseDocumentLoad').click();
    if (intervention === 'edit') h.input('{ edited while loading');
    if (intervention === 'scene') h.scene(otherSceneId);
    if (intervention === 'reopen') { await h.close(); await h.reopen(); }
    if (intervention === 'selection') { h.scene(otherSceneId); h.scene(sceneId); }
    const text = h.element('projectBuildCaseProgram').value; wait.resolve(saved()); await flushDialogs();
    assert.equal(h.element('projectBuildCaseProgram').value, text, intervention);
  }
});

test('editing during save keeps the newer local draft and uses the committed revision on the next explicit save', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load');
  const wait = deferred(); h.respond(() => wait.promise); h.element('projectBuildCaseDocumentSave').click();
  const submitted = h.calls.at(-1), changed = definition(); changed.checks[0].position.value[1] = 75;
  const input = h.input(JSON.stringify(changed)); input.focus(); input.selectionStart = 5; input.selectionEnd = 9;
  wait.resolve(saved({ version: nextVersion, content: submitted.content })); await flushDialogs();
  assert.equal(input.value, JSON.stringify(changed)); assert.equal(input.selectionStart, 5); assert.equal(input.selectionEnd, 9);
  assert.match(h.element('projectBuildCaseDocumentStatus').textContent, /未保存修改/);
  h.respond(body => saved({ version: sceneVersion, content: body.content, definition: changed })); await h.click('Save');
  assert.equal(h.calls.at(-1).expectedVersion, nextVersion); assert.deepEqual(JSON.parse(h.calls.at(-1).content).case, changed);
});

test('closing an in-flight save immediately blocks duplicate writes until explicit loading reconciles it', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load');
  const wait = deferred(); h.respond(() => wait.promise); h.element('projectBuildCaseDocumentSave').click();
  const submitted = h.calls.at(-1); await h.close(); await h.reopen();
  assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true); assert.equal(h.element('projectBuildCaseDocumentSaveAs').disabled, true);
  assert.equal(h.element('projectBuildCaseDocumentNew').disabled, true); assert.match(h.element('projectBuildCaseDocumentStatus').textContent, /尚未确认/);
  const before = h.calls.length; await h.click('Save'); await h.click('SaveAs'); assert.equal(h.calls.length, before);
  wait.resolve(saved({ version: nextVersion, content: submitted.content })); await flushDialogs();
  assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true);
  h.respond(saved({ version: nextVersion, content: submitted.content })); await h.click('Load');
  assert.equal(h.element('projectBuildCaseDocumentSave').disabled, false);
});

test('a lost save response is never retried by polling and a read-only close does not create save uncertainty', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load');
  h.respond(async () => { throw new Error('Connection interrupted'); }); await h.click('Save');
  const before = h.calls.length; await h.refresh(); h.language(en); assert.equal(h.calls.length, before);
  assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true);
  const reader = await harness(); const wait = deferred(); reader.respond(() => wait.promise);
  reader.element('projectBuildCaseDocumentRefresh').click(); await reader.close(); await reader.reopen();
  assert.doesNotMatch(reader.element('projectBuildCaseDocumentStatus').textContent, /尚未确认/);
  wait.resolve(catalog()); await flushDialogs(); assert.equal(reader.element('projectBuildCaseDocumentSelect').children.length, 1);
});

test('source diagnostics stay specific in every language and ambiguous successful or server-error save responses require reconciliation', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load');
  const diagnostics = ['runtime_case_document_limit', 'runtime_case_document_unlinked', 'runtime_case_dependency_unavailable', 'runtime_case_document_exists'];
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary);
    for (const code of diagnostics) {
      h.respond(async () => { throw Object.assign(new Error('Controlled source diagnostic'), { code, status: 422 }); });
      await h.click('Save'); const text = h.element('projectBuildCaseDocumentError').textContent;
      assert.ok(text); assert.ok(!text.includes('Controlled source diagnostic'));
      assert.notEqual(text, dictionary['无法读取或保存用例，请重试；当前草稿已保留。'] || '无法读取或保存用例，请重试；当前草稿已保留。');
      assert.equal(h.element('projectBuildCaseDocumentSave').disabled, false, 'an explicit source rejection is safe to repair');
    }
  }
  for (const status of [200, 500]) {
    h.respond(async () => { throw Object.assign(new Error('Unconfirmed response'), { status }); }); await h.click('Save');
    assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true);
    h.respond(saved()); await h.click('Load'); assert.equal(h.element('projectBuildCaseDocumentSave').disabled, false);
  }
});

test('scene-bound documents cannot execute or update after switching scenes until explicit new-case detachment', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load'); const text = h.element('projectBuildCaseProgram').value;
  h.scene(otherSceneId); const other = status(); other.latestBuild.sceneId = otherSceneId; await h.refresh(other);
  assert.equal(h.element('projectBuildCaseRun').disabled, true); assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true);
  assert.match(h.element('projectBuildCaseDocumentStatus').textContent, /另一个场景/);
  await h.click('New'); assert.equal(h.element('projectBuildCaseProgram').value, text);
  assert.equal(h.element('projectBuildCaseRun').disabled, false);
  h.element('projectBuildCaseRun').click(); await flushDialogs(); assert.equal(h.jobs.at(-1).runtimeCaseSceneId, otherSceneId);
});

test('explicit generation from another scene uses its complete frozen samples and detaches the old saved document', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load'); h.scene(otherSceneId);
  const state = status(); state.latestBuild.sceneId = otherSceneId;
  state.job = { id: 'controlled-other', kind: 'run', status: 'succeeded', backendId: state.backend.id, buildId: state.latestBuild.id,
    snapshotId: state.latestBuild.snapshotId, sceneId: otherSceneId, runtime: { phase: 'finished' },
    control: { program: definition().program, samples: [{ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2, event: 'sample',
      stepIndex: 0, actors: [{ instanceId, objectId, position: [35, 45], state: 'idle' }] }] } };
  await h.refresh(state); assert.equal(h.element('projectBuildCaseRun').disabled, true);
  assert.equal(h.element('projectBuildCaseGenerate').disabled, false); h.element('projectBuildCaseGenerate').click();
  assert.deepEqual(JSON.parse(h.element('projectBuildCaseProgram').value).checks[0].position.value, [35, 45]);
  assert.equal(h.element('projectBuildCaseRun').disabled, false); assert.doesNotMatch(h.element('projectBuildCaseDocumentStatus').textContent, /已载入/);
  h.respond(catalog([], { sceneId: otherSceneId })); await h.click('Refresh');
  h.respond(body => saved({ id: copyId, sceneId: otherSceneId, version: nextVersion, path: body.sourcePath, content: body.content })); await h.click('Save');
  assert.equal(h.calls.at(-1).documentId, undefined); assert.equal(JSON.parse(h.calls.at(-1).content).sceneObjectId, otherSceneId);
});

test('author dirty, creation, busy and offline guards block writes while loaded frozen cases can run offline', async () => {
  const h = await harness(); await h.click('Refresh'); h.select(); await h.click('Load');
  for (const field of ['dirty', 'creating', 'busy', 'editable']) {
    h.context[field] = field !== 'editable'; h.controller.setAvailable(true); const before = h.calls.length;
    assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true); await h.click('Save'); assert.equal(h.calls.length, before);
    h.context[field] = field === 'editable'; h.controller.setAvailable(true);
  }
  h.context.dirty = true; h.controller.setAvailable(true);
  assert.equal(h.element('projectBuildCaseDocumentLoad').disabled, false, 'a read-only load does not replace the independent author editor draft');
  h.context.dirty = false; await h.refresh({ ...status(), catalogDiagnostic: { code: 'build_catalog_unavailable' } });
  for (const button of ['Load', 'Save', 'SaveAs', 'Refresh']) assert.equal(h.element(`projectBuildCaseDocument${button}`).disabled, true);
  assert.equal(h.element('projectBuildCaseRun').disabled, false); const before = h.calls.length;
  h.element('projectBuildCaseRun').click(); await flushDialogs(); assert.equal(h.calls.length, before); assert.equal(h.jobs.at(-1).runtimeCaseSceneId, sceneId);
});

test('dependency-stale and invalid inner cases remain visible and can be explicitly loaded for repair without rewriting their source', async () => {
  const stale = saved({ valid: false, diagnostics: [{ code: 'runtime_case_target_missing' }] });
  const h = await harness(); h.respond(body => body.action === 'case-list' ? catalog([stale]) : stale);
  await h.click('Refresh'); assert.match(h.element('projectBuildCaseDocumentSelect').textContent, /需要修复/); h.select(); await h.click('Load');
  assert.match(h.element('projectBuildCaseDocumentStatus').textContent, /需要修复/); assert.equal(h.calls.filter(body => body.action === 'case-save').length, 0);
  const invalid = envelope(); invalid.case.checks[0].position.tolerance = -1;
  h.respond(saved({ valid: false, definition: null, content: '\uFEFF' + JSON.stringify(invalid), diagnostics: [{ code: 'runtime_case_invalid' }] }));
  await h.click('Load'); assert.equal(JSON.parse(h.element('projectBuildCaseProgram').value).checks[0].position.tolerance, -1);
  assert.equal(h.element('projectBuildCaseDocumentSave').disabled, true); assert.equal(h.calls.filter(body => body.action === 'case-save').length, 0);
});

test('polling, language changes, close and untrusted titles preserve local case text and expose three-language document controls as text', async () => {
  const h = await harness(); h.respond(catalog([saved({ title: '<img onerror=window.bad>' })])); await h.click('Refresh');
  const input = h.input('{ keep local draft'); input.focus(); input.selectionStart = 3; input.selectionEnd = 8;
  const count = h.calls.length;
  for (const [dictionary, expected] of [[{}, '保存用例'], [en, 'Save case'], [ja, '用例を保存']]) {
    h.language(dictionary); await h.refresh(); assert.equal(h.element('projectBuildCaseDocumentSave').textContent, expected);
    assert.equal(input.value, '{ keep local draft'); assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 8);
  }
  await h.close(); await h.reopen(); assert.equal(input.value, '{ keep local draft'); assert.equal(h.calls.length, count);
  const title = h.element('projectBuildCaseDocumentSelect').children[1]; assert.equal(title.textContent, '<img onerror=window.bad>'); assert.equal(title.children.length, 0);
});

test('the author-document transport uses the existing API token in headers only and leaves envelope bytes intact', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], returned = { id: documentId, version }; let token = '  secret\r\n-token  ';
  const storage = { getItem(key) { assert.equal(key, 'doc-api-token'); return token; } };
  const context = vm.createContext({ window: { localStorage: storage }, localStorage: storage, PROJECT_BUILD_API_PATH: '/api/project-build', t: key => key,
    fetchJsonApiRequest: async (url, options, timeout, label) => { calls.push({ url, options, timeout, label }); return { payload: returned }; } });
  vm.runInContext(source, context);
  const body = { action: 'case-save', sceneId, sceneVersion, content: originalContent(), sourcePath: 'content/case.json', documentType: 'oc' };
  assert.equal(await context.requestProjectBuildDocument(body), returned);
  assert.equal(calls[0].url, '/api/project-build'); assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), body); assert.ok(!calls[0].options.body.includes('secret-token'));
  token = ''; await context.requestProjectBuildDocument({ action: 'case-load', documentId });
  assert.equal(calls[1].options.headers.Authorization, undefined); assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
});
