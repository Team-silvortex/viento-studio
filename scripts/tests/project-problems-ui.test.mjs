import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createProjectProblemsSnapshot, filterProjectProblems } from '../../engine/project-problems.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const messageKey = '场景 JSON 格式有误，请打开原文检查。';
const makeRow = (changes = {}) => ({ code: 'build_scene_json', severity: 'error', messageKey,
  detail: 'Unexpected literal <img src=x onerror=alert(1)> / $&', sourcePath: 'scenes/forest.json',
  propertyPath: '/actors/0/speed', sourceRevision: 'sha256:' + 'a'.repeat(64),
  sourceRange: { encoding: 'utf-16', start: 12, end: 15, exact: true, propertyPath: '/actors/0/speed' }, ...changes });
const noSource = (changes = {}) => {
  const row = makeRow({ sourcePath: '', sourceRevision: '', propertyPath: '', ...changes }); delete row.sourceRange; return row;
};
const snapshot = (changes = {}, diagnostics = [makeRow(), noSource({ severity: 'warning', code: 'tool_warning', detail: '.* literal', messageKey: '任务已取消。' }),
  makeRow({ severity: 'info', code: 'info', detail: 'Ready', messageKey: '任务已结束。' })]) => createProjectProblemsSnapshot({
  task: { id: 'task-a', kind: 'build', status: 'failed', backendId: 'godot4', sceneId: 'scene-a', ...changes }, diagnostics,
});
async function fixture(t, settings = {}) {
  let language = 'zh', changed = () => {}, subscriptions = 0;
  const context = { available: true, token: 'session-1:godot4:task-a' }, calls = [];
  const h = await dialogHarness('app-project-problems', {
    filterProjectProblems,
    t: (key, ...values) => String(({ en, ja }[language]?.[key] || key)).replace(/\{(\d+)\}/g, (_, i) => values[i]),
    onLanguageChange(fn) { changed = fn; subscriptions++; return () => { changed = () => {}; subscriptions--; }; },
  });
  const document = h.document, container = document.createElement('section');
  container.id = 'projectBuildProblems'; container.isConnected = true;
  container.innerHTML = '<h3 id="projectBuildDiagnosticsTitle" data-i18n="构建诊断"></h3><ul id="projectBuildDiagnostics"></ul>';
  document.body.append(container);
  const controller = h.runtime.setupProjectProblems({ container, getContext: () => context,
    onOpen: async (row, options) => { calls.push({ row, ...options }); return settings.onOpen ? settings.onOpen(row, options) : true; } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('projectBuildProblems' + suffix), list = h.element('projectBuildDiagnostics');
  const fill = value => { el('Search').value = value; el('Search').dispatch('input'); };
  return { ...h, controller, context, calls, container, el, list, fill,
    set(value = snapshot(), options) { controller.setSnapshot(value, options); },
    severity(value) { el('Severity').value = value; el('Severity').dispatch('change'); },
    language(value) { language = value; changed(); }, subscriptions: () => subscriptions,
    rows: () => list.children.filter(row => !row.hidden), buttons: () => list.querySelectorAll('button'),
  };
}

test('current-task problems distinguish no task, no reports and no filter matches without starting work', async t => {
  const h = await fixture(t);
  assert.match(h.el('Empty').textContent, /尚无任务/); assert.equal(h.el('Search').disabled, true);
  h.set(snapshot({}, [])); assert.match(h.el('Empty').textContent, /没有报告问题/); assert.match(h.el('Empty').textContent, /不代表/);
  assert.equal(h.el('Summary').dataset.total, '0'); h.set(); h.fill('nothing');
  assert.match(h.el('Empty').textContent, /筛选条件/); assert.equal(h.el('Summary').dataset.total, '3');
  assert.equal(h.el('Summary').dataset.matched, '0'); assert.equal(h.calls.length, 0);
});

test('all task metadata and complete severity counts are visible independently of filters', async t => {
  const h = await fixture(t); h.set();
  assert.match(h.el('Task').textContent, /构建场景.*失败/s); assert.match(h.el('Task').textContent, /task-a/); assert.match(h.el('Task').textContent, /godot4/); assert.match(h.el('Task').textContent, /scene-a/);
  assert.match(h.el('Summary').textContent, /错误 1.*警告 1.*信息 1/);
  h.severity('warning'); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].dataset.code, 'tool_warning');
  assert.match(h.el('Summary').textContent, /显示 1 \/ 3.*错误 1.*警告 1.*信息 1/);
  assert.equal(h.el('Search').getAttribute('maxlength'), '512');
});

test('literal case-insensitive search combines with severity over code, detail and source location', async t => {
  const h = await fixture(t); h.set();
  for (const value of ['BUILD_SCENE_JSON', 'FOREST.JSON', '/ACTORS/0/SPEED', '$&']) { h.fill(value); assert.equal(h.rows().length, value === '$&' || value === 'BUILD_SCENE_JSON' ? 1 : 2); }
  h.fill('.*'); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].dataset.code, 'tool_warning');
  h.severity('error'); assert.equal(h.rows().length, 0); h.fill(''); assert.equal(h.rows().length, 1);
});

test('localized message search is recomputed on language changes without resetting query or severity', async t => {
  const h = await fixture(t); h.set(); h.language('en'); h.fill(en[messageKey]);
  assert.equal(h.rows().length, 1); const query = h.el('Search').value;
  h.language('ja'); assert.equal(h.rows().length, 0); assert.equal(h.el('Search').value, query);
  h.fill(ja[messageKey]); assert.equal(h.rows().length, 1); h.severity('warning'); assert.equal(h.rows().length, 0);
  h.language('zh'); assert.equal(h.el('Severity').value, 'warning');
});

test('raw diagnostic content is rendered as text and rows without a source expose no navigation button', async t => {
  const h = await fixture(t); h.set();
  assert.equal(h.buttons().length, 2); assert.equal(h.list.children[1].querySelector('button'), null);
  const raw = h.list.children[0].querySelector('pre'); assert.match(raw.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(h.list.querySelector('img'), null); assert.equal(raw.tabIndex, 0);
  assert.deepEqual(JSON.parse(raw.textContent).sourceRange, makeRow().sourceRange);
});

test('equivalent polls preserve query element, focus, caret and expanded row while status updates preserve same-task filters', async t => {
  const h = await fixture(t); const value = snapshot(); h.set(value); h.fill('forest');
  const search = h.el('Search'), first = h.list.children[0], detail = first.querySelector('details');
  search.focus(); search.selectionStart = 1; search.selectionEnd = 4; detail.open = true;
  h.set(structuredClone(value)); h.controller.refresh();
  assert.equal(h.el('Search'), search); assert.equal(h.document.activeElement, search); assert.deepEqual([search.selectionStart, search.selectionEnd], [1, 4]);
  assert.equal(h.list.children[0], first); assert.equal(first.querySelector('details'), detail); assert.equal(detail.open, true);
  h.set(snapshot({ status: 'succeeded' })); assert.equal(search.value, 'forest'); assert.equal(detail.open, true); assert.match(h.el('Task').textContent, /已完成/);
});

test('hiding a row and changing languages retain its disclosure DOM and input composition state', async t => {
  const h = await fixture(t); h.set();
  const first = h.list.children[0], details = first.querySelector('details'), query = h.el('Search'); details.open = true;
  query.focus(); query.selectionStart = query.selectionEnd = 0; query.dispatch('compositionstart');
  h.severity('warning'); assert.equal(first.hidden, true); h.language('ja');
  assert.equal(h.document.activeElement, query); assert.equal(query.disabled, false); h.severity('all');
  assert.equal(h.list.children[0], first); assert.equal(details.open, true); assert.equal(first.hidden, false);
  assert.equal(first.querySelector('summary').textContent, ja['问题定位详情']);
});

test('new task or backend resets filters and disclosures, while context session reset clears the old task', async t => {
  const h = await fixture(t); h.set(); h.fill('forest'); h.severity('error'); h.list.children[0].querySelector('details').open = true;
  const old = h.buttons()[0]; h.set(snapshot({ id: 'task-b' }));
  assert.equal(h.el('Search').value, ''); assert.equal(h.el('Severity').value, 'all'); assert.notEqual(h.list.children[0].querySelector('details').open, true);
  old.dispatch('click'); assert.equal(h.calls.length, 0); h.fill('forest'); h.set(snapshot({ id: 'task-b', backendId: 'bevy' }));
  assert.equal(h.el('Search').value, ''); h.context.token = 'session-2'; h.controller.refresh();
  assert.match(h.el('Empty').textContent, /尚无任务/); assert.equal(h.list.children.length, 0); assert.equal(h.el('Task').hidden, true);
});

test('source navigation forwards the original diagnostic without edits and prevents double opens', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set();
  const button = h.buttons()[0]; button.click(); button.dispatch('click');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].isCurrent(), true); assert.deepEqual(h.calls[0].row, snapshot().rows[0]);
  assert.equal(button.disabled, true); assert.match(h.el('NavigationStatus').textContent, /正在打开/);
  pending.resolve(true); await flushDialogs(); assert.equal(button.disabled, false); assert.equal(h.el('NavigationStatus').hidden, true);
});

test('unchanged task polling and locale changes keep a pending source navigation valid', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); const value = snapshot(); h.set(value); h.buttons()[0].click();
  h.set(structuredClone(value)); h.language('en'); h.controller.refresh(); assert.equal(h.calls[0].isCurrent(), true);
  pending.resolve(true); await flushDialogs(); assert.equal(h.el('NavigationStatus').hidden, true);
});

test('display labels remain plain text and can refresh without invalidating task identity or pending navigation', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); const value = snapshot();
  h.set(value, { backendLabel: 'Godot 4', sceneLabel: 'Harbor' });
  assert.match(h.el('Task').querySelector('p').textContent, /Godot 4.*Harbor/s);
  assert.doesNotMatch(h.el('Task').querySelector('p').textContent, /task-a|scene-a/);
  const details = h.el('Task').querySelector('details'); details.open = true; h.buttons()[0].click();
  h.set(value, { backendLabel: 'Godot 4', sceneLabel: '<img src=x> New harbor' });
  assert.equal(h.calls[0].isCurrent(), true); assert.equal(details.open, true); assert.equal(h.el('Task').querySelector('img'), null);
  assert.match(h.el('Task').querySelector('p').textContent, /<img src=x>/);
  h.set(value, { backendLabel: 'x'.repeat(257), sceneLabel: 'injected\nlabel' });
  assert.equal(h.calls[0].isCurrent(), true); assert.match(h.el('Task').querySelector('p').textContent, /未提供场景名称/);
  pending.resolve(true); await flushDialogs();
});

test('semantic snapshot replacement invalidates pending source navigation even if its row is unchanged', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(); h.buttons()[0].click();
  h.set(snapshot({ status: 'succeeded' })); assert.equal(h.calls[0].isCurrent(), false);
  pending.reject(new Error('old failure')); await flushDialogs(); assert.equal(h.el('NavigationStatus').hidden, true); assert.equal(h.buttons()[0].disabled, false);
});

test('filter, session, backend and availability changes invalidate pending navigation and ignore late failures', async t => {
  const cases = [h => h.fill('missing'), h => { h.context.token = 'new-session'; h.controller.refresh(); },
    h => h.set(snapshot({ backendId: 'bevy' })), h => { h.context.available = false; h.controller.refresh(); h.context.available = true; h.controller.refresh(); }];
  for (const change of cases) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(); h.buttons()[0].click(); change(h);
    assert.equal(h.calls[0].isCurrent(), false); pending.reject(new Error('old error')); await flushDialogs(); assert.equal(h.el('NavigationStatus').hidden, true);
  }
});

test('stale, hidden, removed and disconnected navigation controls cannot open a source', async t => {
  const h = await fixture(t); h.set(); const old = h.buttons()[0];
  h.set(snapshot({}, [makeRow({ detail: 'changed' })])); old.dispatch('click'); assert.equal(h.calls.length, 0);
  const button = h.buttons()[0]; h.fill('missing'); button.dispatch('click'); assert.equal(h.calls.length, 0);
  h.fill(''); button.remove(); button.dispatch('click'); assert.equal(h.calls.length, 0);
  h.set(snapshot({}, [makeRow({ detail: 'changed again' })])); h.container.isConnected = false; h.buttons()[0].dispatch('click'); assert.equal(h.calls.length, 0);
});

test('failed and cancelled navigation stays in the component, localizes and allows retry', async t => {
  for (const onOpen of [async () => false, async () => { throw new Error('read failed'); }]) {
    const h = await fixture(t, { onOpen }); h.set(); h.buttons()[0].click(); await flushDialogs();
    assert.match(h.el('NavigationStatus').textContent, /无法打开原文/); assert.equal(h.buttons()[0].disabled, false);
    h.language('en'); assert.equal(h.el('NavigationStatus').textContent, en['无法打开原文，请返回编辑器查找该文档。']);
    h.buttons()[0].click(); await flushDialogs(); assert.equal(h.calls.length, 2);
  }
});

test('malformed observations and explicit invalid state reject all navigation without reporting a clean task', async t => {
  const h = await fixture(t); h.set(); const old = h.buttons()[0];
  h.set({ task: snapshot().task, rows: [makeRow({ sourcePath: '../outside' })] });
  assert.equal(h.container.dataset.invalid, 'true'); assert.match(h.el('Empty').textContent, /无法读取/); assert.equal(h.buttons().length, 0);
  old.dispatch('click'); assert.equal(h.calls.length, 0);
  h.set(null, { invalid: true }); assert.match(h.el('Empty').textContent, /无法读取/); assert.equal(h.el('Summary').hidden, true);
  h.set(); assert.equal(h.container.dataset.invalid, 'false'); assert.equal(h.rows().length, 3);
});

test('null snapshots clear task state and cannot revive old controls', async t => {
  const h = await fixture(t); h.set(); h.fill('forest'); const old = h.buttons()[0]; h.set(null);
  assert.equal(h.list.children.length, 0); assert.equal(h.el('Search').value, ''); assert.equal(h.el('Summary').hidden, true);
  old.dispatch('click'); assert.equal(h.calls.length, 0);
});

test('dispose invalidates callbacks, removes listeners and leaves legacy list and title available', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(); const button = h.buttons()[0]; button.click();
  h.controller.dispose(); assert.equal(h.calls[0].isCurrent(), false); assert.equal(h.subscriptions(), 0); assert.equal(h.list.children.length, 0);
  button.dispatch('click'); assert.equal(h.calls.length, 1); h.set(); h.controller.refresh(); h.language('ja'); assert.equal(h.list.children.length, 0);
  pending.reject(new Error('late')); await flushDialogs(); assert.equal(h.container.children.length, 2);
  assert.equal(h.container.children[1].id, 'projectBuildDiagnostics');
});

test('all three languages translate controls and task metadata without duplicating style resources', async t => {
  const h = await fixture(t); h.set();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); const dictionary = { en, ja }[language];
    assert.equal(h.element('projectBuildDiagnosticsTitle').textContent, dictionary?.['当前任务问题'] || '当前任务问题');
    assert.equal(h.el('SearchLabel').textContent, dictionary?.['筛选当前任务问题'] || '筛选当前任务问题');
    assert.equal(h.list.children[0].querySelector('.project-problem-severity').textContent, dictionary?.['错误'] || '错误');
  }
  assert.equal(h.document.querySelectorAll('#projectProblemsStyle').length, 1);
  assert.equal(h.element('projectProblemsStyle').href, '/web/project-problems.css');
});
