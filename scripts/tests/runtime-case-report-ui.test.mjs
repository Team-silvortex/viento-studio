import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parse } from 'acorn';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createRuntimeCaseReport, validateRuntimeCaseReport } from '../../engine/runtime-case-report.mjs';
import { summarizeRuntimeCaseSuite } from '../../engine/runtime-case-suite-contract.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
const revision = n => `sha256:${n.toString(16).padStart(64, '0')}`;
const sceneId = id(1), buildId = id(2), suiteId = id(3), documentId = id(4), sessionId = id(5), jobId = id(6);
const instanceId = id(20), objectId = id(30);
const clone = value => JSON.parse(JSON.stringify(value));
function receipt({ failure = false, executionStatus = 'succeeded', samples = 2, session = sessionId } = {}) {
  const definition = { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
      steps: [{ up: false, down: false, left: false, right: true }, { up: false, down: false, left: false, right: false }] },
    checks: [{ instanceId, stepIndex: 0, position: { value: [failure ? 11 : 10, 20], tolerance: 0.0001 }, state: 'moving' },
      { instanceId, stepIndex: 1, state: 'idle' }] };
  return createRuntimeCaseReport({ context: { sceneSourcePath: 'documents/scenes/frozen-original.json', sceneObjectId: sceneId, buildId,
    snapshotId: revision(1), backendId: 'org.viento.godot4', suiteDocumentId: suiteId, suiteSourceVersion: revision(2),
    documentId, sourceVersion: revision(3), sessionId: session }, executionStatus, targets: [{ instanceId, objectId }], definition,
    samples: Array.from({ length: samples }, (_, stepIndex) => ({ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2,
      event: 'sample', stepIndex, actors: [{ instanceId, objectId, position: [10, 20], state: stepIndex ? 'idle' : 'moving' }] })) });
}
function current(report = receipt()) {
  const evaluation = report.evaluation, row = { documentId, title: '<img onerror=window.bad>', sourceVersion: revision(3),
    state: evaluation.status, executionStatus: report.executionStatus, sessionId: report.context.sessionId, reportAvailable: true,
    checkCount: evaluation.checkCount, passedChecks: evaluation.passedChecks, failedChecks: evaluation.failedChecks, unavailableChecks: evaluation.unavailableChecks };
  return { available: true, visible: true, session: 1, sceneId, buildId, backendId: 'org.viento.godot4',
    // The live author source path is deliberately different from the receipt.
    sceneSourcePath: 'documents/renamed/live-source.json', dirty: true, offline: true, active: true,
    job: { id: jobId, kind: 'suite', sceneId, buildId, snapshotId: revision(1), backendId: 'org.viento.godot4', status: 'running',
      suite: { documentId: suiteId, sourceVersion: revision(2), sceneObjectId: sceneId, entries: [row], summary: summarizeRuntimeCaseSuite([row.state]) } } };
}
async function view(report = receipt()) {
  let state = current(report), responder = () => report, dictionary = {};
  const languages = [], calls = [], blobs = [], revoked = [], handoffs = [];
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-runtime-case-report', { t: translate, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    URL: { createObjectURL: blob => { blobs.push(blob); return `blob:report-${blobs.length}`; }, revokeObjectURL: url => revoked.push(url) } });
  const container = h.document.createElement('div'); h.document.body.append(container);
  const originalCreate = h.document.createElement;
  h.document.createElement = tag => { const node = originalCreate(tag); if (tag === 'a') node.click = () => handoffs.push({ href: node.href, download: node.download }); return node; };
  const controller = h.runtime.setupRuntimeCaseReport({ container, getState: () => state, request: async body => { calls.push(clone(body)); return await responder(body); } });
  return { ...h, controller, calls, blobs, revoked, handoffs,
    get state() { return state; }, setState(value) { state = value; controller.render(); },
    respond(value) { responder = typeof value === 'function' ? value : () => value; },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    async open(value = documentId) { await controller.open(value); await flushDialogs(); },
    async export() { h.element('projectBuildCaseReportExport').click(); await flushDialogs(); },
    revoke() { for (const [key, callback] of [...h.timers]) { h.timers.delete(key); callback(); } },
  };
}

test('current completed members expose only explicit read-only detail, including offline sources, dirty authors and another running member', async () => {
  const h = await view(); assert.equal(h.calls.length, 0); await h.open();
  assert.deepEqual(h.calls, [{ action: 'suite-report', jobId, documentId }]); assert.equal(h.blobs.length, 0);
  assert.equal(h.element('projectBuildCaseReportExport').disabled, false);
  assert.match(h.element('projectBuildCaseReportContext').textContent, /frozen-original.json/);
  assert.doesNotMatch(h.element('projectBuildCaseReportContext').textContent, /renamed/);
  assert.match(h.element('projectBuildCaseReportChecks').textContent, /第 1 步/);
  assert.match(h.element('projectBuildCaseReportChecks').textContent, /每轴容差：0.0001/);
  assert.match(h.element('projectBuildCaseReportChecks').textContent, /实际位置：\(10, 20\)/);
});

test('execution completion is separate from passed, failed and incomplete assertions with visible actual and expected checks in three languages', async () => {
  for (const [options, expected] of [[{}, '验收通过'], [{ failure: true }, '验收未通过'], [{ executionStatus: 'cancelled', samples: 1 }, '验收未完成']]) {
    const report = receipt(options), h = await view(report); await h.open();
    assert.match(h.element('projectBuildCaseReportStatus').textContent, new RegExp(expected));
    assert.equal(h.element('projectBuildCaseReportChecks').children.length, 2);
    for (const [dictionary, result] of [[en, expected === '验收通过' ? 'Verification passed' : expected === '验收未通过' ? 'Verification failed' : 'Verification incomplete'],
      [ja, expected === '验收通过' ? '検証に合格' : expected === '验收未通过' ? '検証に不合格' : '検証未完了']]) {
      h.language(dictionary); assert.ok(h.element('projectBuildCaseReportStatus').textContent.includes(result));
      assert.notEqual(h.element('projectBuildCaseReportExport').textContent, '导出用例报告 JSON');
    }
    if (options.executionStatus) assert.match(h.element('projectBuildCaseReportChecks').textContent, /有効なサンプルがありません/);
  }
});

test('explicit JSON export preserves the validated frozen report, uses a safe name and releases its local Blob URL', async () => {
  const original = clone(receipt({ failure: true })), h = await view(original); await h.open();
  original.definition.checks[0].position.value[0] = 999; original.context.sceneSourcePath = '/private/host';
  await h.export(); assert.equal(h.calls.length, 1); assert.equal(h.blobs.length, 1);
  const text = await h.blobs[0].text(), exported = JSON.parse(text);
  assert.equal(text, JSON.stringify(exported) + '\n'); assert.equal(h.blobs[0].type, 'application/json;charset=utf-8');
  assert.equal(exported.definition.checks[0].position.value[0], 11); assert.equal(exported.evaluation.status, 'failed');
  assert.deepEqual(validateRuntimeCaseReport(exported), receipt({ failure: true }));
  assert.deepEqual(h.handoffs, [{ href: 'blob:report-1', download: `runtime-case-report-${documentId}.json` }]);
  assert.equal(h.document.body.querySelectorAll('a').some(anchor => anchor.href === 'blob:report-1'), false); h.revoke(); assert.deepEqual(h.revoked, ['blob:report-1']);
  assert.equal(h.calls.some(body => body.action === 'run' || body.action === 'suite-run'), false);
});

test('queued, running, not-run, missing and legacy members cannot request or export a report', async () => {
  for (const patch of [{ state: 'queued' }, { state: 'running' }, { state: 'not-run' }, { reportAvailable: false }, { reportAvailable: undefined }]) {
    const h = await view(); Object.assign(h.state.job.suite.entries[0], patch); await h.open(); await h.export();
    assert.equal(h.calls.length, 0); assert.equal(h.blobs.length, 0); assert.equal(h.element('projectBuildCaseReportPanel').hidden, true);
  }
  const h = await view(); await h.open(id(99)); assert.equal(h.calls.length, 0);
});

test('changing current job, scene, backend, build or member identity clears a loaded report and prevents exporting stale data', async () => {
  for (const mutate of [state => { state.job.id = id(99); }, state => { state.sceneId = id(99); }, state => { state.backendId = 'org.viento.bevy'; },
    state => { state.buildId = id(99); }, state => { state.job.snapshotId = revision(99); }, state => { state.job.suite.sourceVersion = revision(99); },
    state => { state.job.suite.entries[0].sourceVersion = revision(99); }, state => { state.job.suite.entries[0].sessionId = id(99); },
    state => { state.job.suite.entries[0].executionStatus = 'failed'; }, state => { state.job.suite.entries[0].passedChecks = 0; },
    state => { state.job.suite.entries[0].state = 'failed'; }, state => { state.available = false; }]) {
    const h = await view(); await h.open(); const changed = clone(h.state); mutate(changed); h.setState(changed); await h.export();
    assert.equal(h.element('projectBuildCaseReportPanel').hidden, true); assert.equal(h.blobs.length, 0);
  }
});

test('late responses cannot survive a replaced member, new task, context change or closed and reopened workbench', async () => {
  for (const change of [h => { const state = clone(h.state); state.job.id = id(99); h.setState(state); },
    h => { h.state.visible = false; h.controller.closed(); h.state.visible = true; h.state.session++; h.controller.render(); }]) {
    const h = await view(), pending = deferred(); h.respond(() => pending.promise); const reading = h.controller.open(documentId);
    change(h); pending.resolve(receipt()); await reading; await h.export(); assert.equal(h.blobs.length, 0); assert.equal(h.element('projectBuildCaseReportPanel').hidden, true);
  }
  const h = await view(), old = deferred(); h.respond(() => old.promise); const first = h.controller.open(documentId);
  const second = clone(receipt()); second.context.documentId = id(44); second.context.sourceVersion = revision(44);
  h.state.job.suite.entries.push({ ...h.state.job.suite.entries[0], documentId: id(44), sourceVersion: revision(44) });
  h.respond(second); await h.open(id(44)); old.resolve(receipt()); await first; await h.export();
  assert.equal(JSON.parse(await h.blobs[0].text()).context.documentId, id(44));
});

test('response context and evaluation are validated before rendering; accessors do not run and hostile error text is not displayed', async () => {
  const variants = [value => { value.evaluation.status = 'failed'; }, value => { value.context.buildId = id(99); },
    value => { value.context.sourceVersion = revision(99); }, value => { value.context.sessionId = id(99); }, value => { value.rawLogs = '<img onerror=window.bad>'; }];
  for (const mutate of variants) {
    const value = clone(receipt()); mutate(value); const h = await view(); h.respond(value); await h.open(); await h.export();
    assert.equal(h.element('projectBuildCaseReportExport').disabled, true); assert.equal(h.blobs.length, 0);
    assert.equal(h.element('projectBuildCaseReportChecks').children.length, 0);
  }
  let reads = 0; const value = clone(receipt()); Object.defineProperty(value, 'evaluation', { enumerable: true, get() { reads++; return receipt().evaluation; } });
  const h = await view(); h.respond(value); await h.open(); assert.equal(reads, 0); assert.equal(h.element('projectBuildCaseReportExport').disabled, true);
  h.respond(() => { throw Object.assign(new Error('<img onerror=window.bad>'), { code: 'runtime_report_not_ready' }); }); await h.open();
  assert.match(h.element('projectBuildCaseReportError').textContent, /尚未就绪/); assert.doesNotMatch(h.element('projectBuildCaseReportError').textContent, /onerror/);
  h.respond(receipt()); await h.open(); assert.equal(h.element('projectBuildCaseReportExport').disabled, false);
});

test('polling, language changes and readonly report closing preserve independent author and core-case draft text and caret', async () => {
  const h = await view(), input = h.element('docSourceEditor'); input.value = 'independent unsaved author'; input.setSelectionRange(3, 9);
  await h.open(); for (const language of [en, ja, {}]) { h.language(language); h.controller.render(); }
  h.element('projectBuildCaseReportClose').click(); assert.equal(h.element('projectBuildCaseReportPanel').hidden, true);
  assert.deepEqual({ value: input.value, start: input.selectionStart, end: input.selectionEnd }, { value: 'independent unsaved author', start: 3, end: 9 });
  assert.equal(h.calls.length, 1); assert.equal(h.blobs.length, 0);
});

test('self-consistent alternative reports must still match the current public member assertion state and counts', async () => {
  const h = await view(); h.respond(receipt({ failure: true })); await h.open();
  assert.equal(h.element('projectBuildCaseReportExport').disabled, true); assert.match(h.element('projectBuildCaseReportError').textContent, /已变化/);
  const firstFailure = receipt({ failure: true }), other = clone(firstFailure);
  other.definition.checks[1].state = 'moving';
  const { context, executionStatus, targets, definition, samples } = other;
  const moreFailures = createRuntimeCaseReport({ context, executionStatus, targets, definition, samples });
  assert.equal(moreFailures.evaluation.failedChecks, 2);
  const second = await view(firstFailure); second.respond(moreFailures); await second.open();
  assert.equal(second.element('projectBuildCaseReportExport').disabled, true); assert.match(second.element('projectBuildCaseReportError').textContent, /已变化/);
});

test('main suite member detail uses the authenticated readonly hook and replaces inspect callbacks when the same group runs again', async () => {
  let payload = current(), responder = () => receipt(), calls = [];
  payload = { supported: true, available: true, platform: 'linux', backend: { format: 'viento-execution-backend', schemaVersion: 1,
    id: payload.backendId, label: 'Godot', version: '0.5.0', platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
    capabilities: ['scene2d', 'runtime.control-replay'], execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: sceneId, sourcePath: 'documents/scenes/current-author.json', title: 'Scene' }], latestBuild: { id: buildId, sceneId, backendId: payload.backendId,
      snapshotId: revision(1), planSchemaVersion: 2, actorCount: 1, controlTargets: [{ instanceId, objectId }] }, job: { ...payload.job, status: 'succeeded' } };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', fetchJsonApiRequest: async () => ({ payload }),
    requestProjectBuildDocument: async body => { calls.push(clone(body)); return await responder(); } });
  const controller = h.runtime.setupProjectBuild({ getContext: () => ({ editable: true, dirty: true, path: 'documents/scenes/current-author.json' }) });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  const core = h.element('projectBuildCaseProgram'); core.value = '{ local case draft'; core.setSelectionRange(2, 7);
  const inspect = () => h.element('projectBuildSuiteEntries').querySelectorAll('button').find(button => button.dataset.caseReport === 'true');
  assert.ok(inspect(), JSON.stringify({ summary: h.element('projectBuildSuiteSummary').textContent, hidden: h.element('projectBuildSuiteResult').hidden, error: h.element('projectBuildError').textContent, logs: h.element('projectBuildLogs').textContent }));
  assert.equal(inspect().disabled, false); inspect().click(); await flushDialogs(); assert.deepEqual(calls.at(-1), { action: 'suite-report', jobId, documentId });
  assert.equal(h.element('projectBuildCaseReportExport').disabled, false); assert.equal(h.element('projectBuildCaseGenerate').disabled, true);
  assert.deepEqual({ value: core.value, start: core.selectionStart, end: core.selectionEnd }, { value: '{ local case draft', start: 2, end: 7 });
  payload.job = { ...payload.job, id: id(77) }; h.element('projectBuildRefresh').click(); await flushDialogs();
  assert.equal(h.element('projectBuildCaseReportExport').disabled, true); inspect().click(); await flushDialogs(); assert.equal(calls.at(-1).jobId, id(77));
});

test('the report GUI contract closure remains portable without author parsers, installed dependencies, DOM or host IO', async () => {
  const engineRoot = new URL('../../engine/', import.meta.url), pending = [new URL('runtime-case-report.mjs', engineRoot)], visited = new Set();
  while (pending.length) {
    const file = pending.pop(); if (visited.has(file.href)) continue; visited.add(file.href);
    assert.ok(file.href.startsWith(engineRoot.href)); const source = await fs.readFile(file, 'utf8'), ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
    const scan = node => { if (!node || typeof node !== 'object') return;
      assert.notEqual(node.type, 'ImportExpression');
      if (node.type === 'Identifier') assert.ok(!['process', 'require', '__dirname', 'document', 'window', 'navigator', 'fetch', 'WebSocket'].includes(node.name), node.name);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(scan); else if (value && typeof value === 'object') scan(value);
    }; scan(ast);
    for (const node of ast.body) if (/^(ImportDeclaration|ExportAllDeclaration|ExportNamedDeclaration)$/.test(node.type) && node.source) {
      assert.match(node.source.value, /^\.{1,2}\//); assert.doesNotMatch(node.source.value, /node_modules|yaml|json-source|runtime-case-document|node:/);
      pending.push(new URL(node.source.value, file));
    }
  }
  assert.ok(visited.size >= 3);
});
