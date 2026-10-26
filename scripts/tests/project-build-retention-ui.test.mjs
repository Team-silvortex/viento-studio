import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';
import { formatMessage } from '../../web/i18n/messages.js';

// Synthetic host DTOs exercise presentation only; these are not Godot runs.
const backendId = 'org.viento.godot4';
const backend = { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.2.0', label: 'Synthetic UI fixture',
  platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }], capabilities: ['scene2d'],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] };
const retention = (logs, events, logTotal = logs.length, eventTotal = events.length) => ({
  logs: { unit: 'utf16-code-units', limit: 32768, total: logTotal, retained: logs.length, dropped: logTotal - logs.length },
  events: { unit: 'records', limit: 128, total: eventTotal, retained: events.length, dropped: eventTotal - events.length },
});
function job(status = 'running') {
  const logs = 'Synthetic log 🌀', events = [{ event: 'state', fixture: 'synthetic' }];
  return { id: 'synthetic-run', kind: 'run', backendId, status, phase: status === 'running' ? 'running' : 'completed',
    sceneId: 'synthetic-scene', diagnostics: [], logs, events, retention: retention(logs, events, 40000, 1200) };
}
async function harness(firstJob = job()) {
  let currentJob = firstJob, language = 'zh-CN';
  const listeners = [];
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH,
    t: (key, ...values) => formatMessage(language, key, ...values),
    onLanguageChange: listener => { listeners.push(listener); },
    fetchJsonApiRequest: async () => ({ payload: { supported: true, available: true, reason: null, platform: 'linux', backend,
      scenes: [{ id: 'synthetic-scene', title: 'Synthetic UI fixture', sourcePath: 'synthetic.json' }], latestBuild: null, job: currentJob } }),
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => ({ editable: true, path: 'synthetic.json' }) });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, async update(value, poll = false) {
    currentJob = value;
    if (poll) {
      const [id, callback] = [...h.timers][0] || []; assert.ok(callback, 'poll scheduled'); h.timers.delete(id); callback();
    } else h.element('projectBuildRefresh').click();
    await flushDialogs();
  }, language(value) { language = value; listeners.forEach(listener => listener(value)); } };
}

for (const status of ['running', 'succeeded', 'failed', 'cancelled', 'timeout']) {
  test(`raw retention remains visible for ${status} without changing task outcome`, async () => {
    const value = job(status), h = await harness(value);
    assert.equal(h.element('projectBuildRaw').open, false);
    for (const id of ['projectBuildLogRetention', 'projectBuildEventRetention']) assert.equal(h.element(id).hidden, false);
    assert.match(h.element('projectBuildLogRetention').textContent, /UTF-16.*较早部分已移出/);
    assert.match(h.element('projectBuildEventRetention').textContent, /保留 1 \/ 共 1200.*已移出 1199.*不是项目事件账本/);
    assert.doesNotMatch(h.element('projectBuildEvents').textContent, /完整/);
    assert.equal(h.element('projectBuildError').hidden, true);
    assert.match(h.element('projectBuildStatus').textContent, new RegExp({ running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时' }[status]));
  });
}

test('UTF-16 and zero counters describe raw buffers without claiming complete project observation', async () => {
  const value = job('succeeded'); value.logs = '🌀'; value.events = [];
  value.retention = retention(value.logs, value.events);
  const h = await harness(value);
  assert.match(h.element('projectBuildLogRetention').textContent, /保留 2 \/ 共 2.*UTF-16.*已移出 0/);
  assert.match(h.element('projectBuildEventRetention').textContent, /保留 0 \/ 共 0.*已移出 0.*不是项目事件账本/);
  value.logs = ''; value.retention = retention(value.logs, value.events); await h.update(value);
  assert.match(h.element('projectBuildLogRetention').textContent, /保留 0 \/ 共 0/);
  assert.doesNotMatch(h.element('projectBuildLogRetention').textContent, /完整|成功|失败/);
});

test('legacy hosts and missing retention fields never invent counts', async () => {
  const value = job(), h = await harness(value);
  for (const metadata of [undefined, null, {}, { logs: null, events: null }, '<img src=x onerror=alert(1)>']) {
    await h.update({ ...value, retention: metadata });
    assert.equal(h.element('projectBuildLogRetention').textContent, '日志：留存信息不可用。');
    assert.equal(h.element('projectBuildEventRetention').textContent, '原始事件摘要：留存信息不可用。此处不是项目事件账本。');
    assert.doesNotMatch(h.element('projectBuildEvents').textContent, /完整|共 1200/);
  }
  await h.update(null);
  assert.equal(h.element('projectBuildLogRetention').hidden, true);
  assert.equal(h.element('projectBuildEventRetention').hidden, true);
});

test('malformed units, limits, counters and buffer mismatches fall back independently', async () => {
  const value = job(), h = await harness(value);
  const invalid = [null, [], '<svg onload=alert(1)>',
    ...['total', 'retained', 'dropped'].flatMap(key => [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1200', '<img src=x>'].map(number => ({ ...value.retention.events, [key]: number }))),
    { ...value.retention.events, unit: 'utf16-code-units' }, { ...value.retention.events, limit: 127 },
    { ...value.retention.events, total: 0 }, { ...value.retention.events, retained: 2 }, { ...value.retention.events, dropped: 0 },
  ];
  for (const events of invalid) {
    await h.update({ ...value, retention: { ...value.retention, events } });
    assert.match(h.element('projectBuildEventRetention').textContent, /留存信息不可用/);
    assert.doesNotMatch(h.element('projectBuildLogRetention').textContent, /不可用/);
    assert.equal(h.element('projectBuildEventRetention').children.length, 0);
  }
  for (const logs of [{ ...value.retention.logs, unit: 'bytes' }, { ...value.retention.logs, limit: 32769 },
    { ...value.retention.logs, retained: value.logs.length - 1 }, { ...value.retention.logs, total: Number.MAX_SAFE_INTEGER + 1 }]) {
    await h.update({ ...value, retention: { ...value.retention, logs } });
    assert.match(h.element('projectBuildLogRetention').textContent, /留存信息不可用/);
    assert.doesNotMatch(h.element('projectBuildEventRetention').textContent, /不可用/);
  }
  await h.update({ ...value, logs: null, events: undefined, retention: retention('', []) });
  assert.match(h.element('projectBuildLogRetention').textContent, /留存信息不可用/);
  assert.match(h.element('projectBuildEventRetention').textContent, /留存信息不可用/);
});

test('1200 synthetic raw events present bounded buffers and literal untrusted text', async () => {
  const frames = Array.from({ length: 1200 }, (_, index) => ({ event: 'fixture', sequence: index + 1, text: '<img src=x onerror=window.injected=true>' }));
  const fullLog = frames.map(frame => `synthetic ${frame.sequence} 🌀 <script>window.injected=true</script>\n`).join('');
  const value = job('succeeded'); value.events = frames.slice(-128); value.logs = fullLog.slice(-32768);
  value.retention = retention(value.logs, value.events, fullLog.length, frames.length);
  const h = await harness(value);
  assert.match(h.element('projectBuildEventRetention').textContent, /保留 128 \/ 共 1200.*已移出 1072/);
  assert.match(h.element('projectBuildLogRetention').textContent, /保留 32768/);
  assert.equal(h.element('projectBuildLogs').children.length, 0);
  assert.ok(h.element('projectBuildLogs').textContent.includes('<script>window.injected=true</script>'));
  assert.ok(h.element('projectBuildLogs').textContent.includes('"sequence":1073'));
  assert.ok(h.element('projectBuildLogs').textContent.includes('"sequence":1200'));
  assert.ok(!h.element('projectBuildLogs').textContent.includes('"sequence":1072'));
  assert.equal(h.element('projectBuildError').hidden, true);
});

test('polling and three-language changes preserve log focus, expanded details and nodes', async () => {
  const value = job(), h = await harness(value);
  const logs = h.element('projectBuildLogs'), details = h.element('projectBuildRaw'); details.open = true; logs.focus();
  const expected = { 'zh-CN': /原始事件摘要.*不是项目事件账本/, en: /Raw event summaries.*not the project event ledger/, ja: /元のイベント要約.*プロジェクトイベント台帳とは別/ };
  for (const language of ['zh-CN', 'en', 'ja']) {
    h.language(language);
    assert.match(h.element('projectBuildEventRetention').textContent, expected[language]);
    assert.doesNotMatch(h.element('projectBuildLogRetention').textContent, /\{\d+\}/);
    await h.update(value, true);
    assert.equal(h.document.activeElement, logs);
    assert.equal(h.element('projectBuildLogs'), logs);
    assert.equal(h.element('projectBuildRaw'), details);
    assert.equal(details.open, true);
  }
  await h.update({ ...value, status: 'cancelled', phase: 'completed' }, true);
  assert.equal(h.document.activeElement, logs);
  assert.equal(details.open, true);
});
