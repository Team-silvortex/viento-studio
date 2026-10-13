import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAtlasHtml } from '../function-atlas-view.mjs';
import { dialogHarness } from './dialog-harness.mjs';

const dimensions = ['implementation', 'verification', 'decoupling', 'delivery'];
function catalog() {
  const feature = (id, label, delivery = 'source-release') => ({ id, label, delivery, group: '二维创作', entry: `${id} entry`,
    platforms: ['Linux'], boundary: [`${id} boundary`], next: `${id} next` });
  const bindings = [{ id: 'b1', architecture: 'core', function: 'setup', implementation: 'i1', role: 'Setup planner', evidence: ['e1'] },
    { id: 'b2', architecture: 'core', function: 'scene', implementation: 'i1', role: 'Scene planner', evidence: ['e1'] },
    { id: 'b3', architecture: 'ui', function: 'scene', implementation: 'i2', role: 'Scene UI', evidence: ['e2'] },
    { id: 'b4', architecture: 'ui', function: 'shipping', implementation: 'i3', role: 'Planned export', evidence: ['e2'] },
    { id: 'b5', architecture: 'core', function: 'outside', implementation: 'i1', role: 'Separate feature', evidence: ['e1'] }];
  return { schemaVersion: 1, meta: { date: '2026-10-13', version: '0.1.1', commit: 'abc123', scope: 'Reviewed mapping only' },
    axes: { architecture: [{ id: 'core', label: 'Rust core' }, { id: 'ui', label: 'Editor UI' }],
      function: [feature('setup', '设定'), feature('scene', '场景'), feature('shipping', '独立发行', 'planned'), feature('outside', '其他能力')],
      implementation: [{ id: 'i1', label: 'Planner', kind: 'product', language: ['Rust'], paths: ['engine/planner.mjs'] },
        { id: 'i2', label: 'View', kind: 'product', language: ['JavaScript'], paths: ['web/view.js'] },
        { id: 'i3', label: 'Future adapter', kind: 'planned', language: [], paths: [] }],
      maturity: dimensions.map(id => ({ id, label: id, levels: ['zero', 'one', 'two', 'three', 'four', 'five'] })) },
    bindings, cells: bindings.flatMap(binding => dimensions.map((dimension, index) => ({
      coordinates: [binding.architecture, binding.function, binding.implementation, dimension], value: [0, null, 4, 2][index], reason: `${binding.id} ${dimension} rationale` }))),
    evidence: [{ id: 'e1', kind: 'source', path: 'engine/planner.mjs', note: 'Source evidence' },
      { id: 'e2', kind: 'report', path: 'docs/test-results/scene/report.json', note: 'Historical scoped report' }],
    dependencies: [{ from: 'setup', to: 'scene', relation: 'requires', reason: 'Needs definitions' }],
    workflows: [{ id: 'two-d', label: '设定到交付', steps: ['setup', 'scene'], gaps: ['shipping'], boundary: 'Only authored source and generated project delivery' },
      { id: 'unreviewed', label: '旧工作流', steps: ['setup', 'scene'], boundary: 'No gap review recorded' },
      { id: 'no-extra', label: '已审查工作流', steps: ['setup', 'scene'], gaps: [], boundary: 'No additional gaps recorded' }],
    priorities: [{ label: 'Finish delivery', reason: 'Source is not a game binary', acceptance: 'Verify a standalone game', functions: ['shipping', 'outside'] }],
    legacyCoverage: [{ id: 'F01', label: 'Old chain', functions: ['setup'], note: 'Historical mapping' }],
  };
}

async function fixture({ data = catalog(), hash = '', narrow = false } = {}) {
  const html = renderAtlasHtml(data), h = await dialogHarness('app-source-search');
  const { document, runtime } = h;
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<script id="atlas-data"/)[1];
  // The shared fixture omits DOMStringMap cleanup when removing data attributes.
  const detail = document.getElementById('detail'), removeAttribute = detail.removeAttribute.bind(detail);
  detail.removeAttribute = name => {
    removeAttribute(name);
    if (name.startsWith('data-')) delete detail.dataset[name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())];
  };
  const embedded = document.createElement('script'); embedded.id = 'atlas-data';
  embedded.textContent = html.match(/<script id="atlas-data" type="application\/json">([\s\S]*?)<\/script>/)[1]; document.body.append(embedded);
  const location = { hash, pathname: '/fixture/docs/function-atlas.html', search: '' };
  let historyIndex = 0; const history = [location.pathname + hash];
  const move = (url, event = '') => { const parsed = new URL(url, 'file:///fixture/docs/function-atlas.html'); location.hash = parsed.hash; location.pathname = parsed.pathname; location.search = parsed.search; if (event) runtime.window.dispatch(event); };
  const storage = new Map();
  Object.assign(runtime, { URLSearchParams, location, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    history: { pushState(_state, _title, url) { history.splice(++historyIndex); history.push(url); move(url); }, replaceState(_state, _title, url) { history[historyIndex] = url; move(url); } } });
  runtime.window.matchMedia = () => ({ matches: narrow });
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1]; vm.runInContext(script, runtime);
  const el = id => document.getElementById(id);
  return { html, data, document, runtime, el, location, history, storage,
    choose(id, value) { el(id).value = value; el(id).dispatch(id === 'search' ? 'input' : 'change'); },
    setHash(value) { location.hash = value; runtime.window.dispatch('hashchange'); },
    back() { if (historyIndex > 0) { move(history[--historyIndex], 'popstate'); runtime.window.dispatch('hashchange'); } },
    forward() { if (historyIndex < history.length - 1) { move(history[++historyIndex], 'popstate'); runtime.window.dispatch('hashchange'); } },
    rows() { return el('list').querySelectorAll('.binding-row'); },
    step(id) { return el('workflow-stages').querySelector(`a[data-feature="${id}"]`); },
    gap(id) { return el('workflow-gaps').querySelector(`a[data-feature="${id}"]`); },
  };
}

test('workflow cards preserve step order and expose each binding original scores without aggregation', async () => {
  const data = catalog(), before = structuredClone(data), h = await fixture({ data, hash: '#workflow=two-d' });
  assert.deepEqual(h.el('workflow-stages').children.map(item => item.dataset.feature), ['setup', 'scene']);
  assert.deepEqual(h.el('workflow-gaps').children.map(item => item.dataset.feature), ['shipping']);
  assert.deepEqual(h.rows().map(row => row.dataset.binding), ['b1', 'b2', 'b3']);
  const binding = h.el('workflow-stages').querySelector('[data-binding="b3"]');
  assert.deepEqual(binding.querySelectorAll('.score-value').map(item => item.textContent), ['0', '—', '4', '2']);
  assert.match(binding.textContent, /Editor UI.*View/); assert.equal(binding.href, '#workflow=two-d&feature=scene&binding=b3');
  assert.deepEqual(data, before); assert.doesNotMatch(h.el('workflow-note').textContent, /完成率|平均分/);
});

test('gap navigation keeps workflow context and exposes planned feature bindings outside the normal steps', async () => {
  const h = await fixture({ hash: '#workflow=two-d' }); h.choose('architecture', 'core'); h.choose('search', 'unmatched');
  assert.equal(h.rows().length, 0); h.gap('shipping').click();
  assert.equal(h.el('workflow').value, 'two-d'); assert.equal(h.el('feature').value, 'shipping'); assert.equal(h.el('architecture').value, ''); assert.equal(h.el('search').value, '');
  assert.deepEqual(h.rows().map(item => item.dataset.binding), ['b4']); assert.equal(h.document.activeElement, h.rows()[0]);
  assert.equal(h.location.hash, '#workflow=two-d&feature=shipping'); assert.match(h.rows()[0].textContent, /规划中/);
});

test('stage and binding links retain the workflow and open existing detail rationale, boundary and evidence', async () => {
  const h = await fixture({ hash: '#workflow=two-d', narrow: true }); h.step('scene').click();
  assert.equal(h.location.hash, '#workflow=two-d&feature=scene'); assert.equal(h.el('workflow').value, 'two-d');
  h.el('workflow-stages').querySelector('[data-binding="b3"]').click();
  assert.equal(h.location.hash, '#workflow=two-d&feature=scene&binding=b3'); assert.equal(h.document.activeElement, h.el('detail'));
  assert.match(h.el('detail').textContent, /b3 verification rationale/); assert.match(h.el('detail').textContent, /scene boundary/); assert.match(h.el('detail').textContent, /scene next/);
  assert.equal(h.el('detail').querySelectorAll('a').some(link => link.href === '../docs/test-results/scene/report.json'), true);
  assert.equal(h.el('workflow-stages').querySelector('[data-binding="b3"]').getAttribute('aria-current'), 'true');
});

test('the worklow overview clears feature and intersecting filters while retaining only the workflow deep link', async () => {
  const h = await fixture({ hash: '#workflow=two-d&feature=shipping&binding=b4' });
  h.choose('language', 'Rust'); assert.equal(h.rows().length, 0); h.el('workflow-overview-reset').click();
  assert.equal(h.el('workflow').value, 'two-d'); assert.equal(h.el('feature').value, ''); assert.equal(h.el('language').value, '');
  assert.equal(h.location.hash, '#workflow=two-d'); assert.deepEqual(h.rows().map(item => item.dataset.binding), ['b1', 'b2', 'b3']); assert.equal(h.document.activeElement, h.el('workflow'));
});

test('absent and explicit empty gap declarations remain distinct and never claim completion', async () => {
  const h = await fixture({ hash: '#workflow=unreviewed' }); assert.match(h.el('workflow-gap-status').textContent, /缺口尚未梳理/);
  assert.match(h.el('workflow-gap-status').textContent, /不代表/); h.choose('workflow', 'no-extra');
  assert.match(h.el('workflow-gap-status').textContent, /本次未登记额外缺口（不表示完成）/); assert.equal(h.el('workflow-gaps').children.length, 0);
});

test('priorities render original reasons and acceptance with direct feature navigation', async () => {
  const h = await fixture({ hash: '#workflow=two-d' }); const card = h.el('priorities').children[0];
  assert.match(card.textContent, /Source is not a game binary/); assert.match(card.textContent, /Verify a standalone game/);
  card.querySelector('a[data-feature="outside"]').click(); assert.equal(h.el('workflow').value, ''); assert.equal(h.el('feature').value, 'outside');
  assert.deepEqual(h.rows().map(item => item.dataset.binding), ['b5']); assert.equal(h.location.hash, '#feature=outside');
});

test('initial, external hash and binding-only deep links select exact existing data', async () => {
  const h = await fixture({ hash: '#workflow=two-d&feature=shipping&binding=b4' });
  assert.equal(h.el('feature').value, 'shipping'); assert.match(h.el('detail').textContent, /b4 verification rationale/);
  h.setHash('#binding=b2'); assert.equal(h.el('workflow').value, ''); assert.equal(h.el('feature').value, 'scene'); assert.match(h.el('detail').textContent, /b2 verification rationale/);
  h.setHash('#workflow=two-d'); assert.equal(h.el('feature').value, ''); assert.equal(h.rows().length, 3); assert.equal(h.el('detail').getAttribute('data-selected'), null);
  assert.doesNotMatch(h.el('detail').textContent, /b2 verification rationale/);
});

test('unknown, duplicate and inconsistent routes fail closed to the complete unselected catalog', async () => {
  const routes = ['#workflow=missing', '#feature=missing', '#binding=missing', '#workflow=two-d&feature=outside', '#feature=setup&binding=b3',
    '#workflow=two-d&workflow=unreviewed', '#feature=', '#feature=scene&evil=javascript%3Aalert(1)', '#feature=%3Cimg%3E', '#workflow=two-d&binding=b5'];
  const h = await fixture({ hash: '#workflow=two-d' });
  for (const hash of routes) {
    h.setHash(hash); assert.equal(h.el('workflow').value, '', hash); assert.equal(h.el('feature').value, '', hash);
    assert.equal(h.rows().length, 5, hash); assert.equal(h.el('route-note').hidden, false, hash); assert.equal(h.el('detail').getAttribute('data-selected'), null, hash);
  }
  h.setHash('#workflow=two-d'); assert.equal(h.el('route-note').hidden, true); assert.equal(h.rows().length, 3);
});

test('browser back and forward restore workflow, feature and binding without stale intersecting filters', async () => {
  const h = await fixture(); h.choose('workflow', 'two-d'); h.step('scene').click(); h.el('workflow-stages').querySelector('[data-binding="b3"]').click();
  h.gap('shipping').click(); assert.equal(h.location.hash, '#workflow=two-d&feature=shipping'); h.back();
  assert.equal(h.el('feature').value, 'scene'); assert.match(h.el('detail').textContent, /b3 verification rationale/);
  h.back(); assert.equal(h.el('feature').value, 'scene'); assert.equal(h.el('detail').getAttribute('data-selected'), null);
  h.forward(); assert.match(h.el('detail').textContent, /b3 verification rationale/); h.forward(); assert.equal(h.el('feature').value, 'shipping');
});

test('manual feature selection accepts gaps, unrelated functions exit the workflow, and reset clears route state', async () => {
  const h = await fixture({ hash: '#workflow=two-d' }); h.choose('feature', 'shipping'); assert.equal(h.el('workflow').value, 'two-d'); assert.equal(h.rows().length, 1);
  h.choose('feature', 'outside'); assert.equal(h.el('workflow').value, ''); assert.equal(h.rows()[0].dataset.binding, 'b5');
  h.el('reset').click(); assert.equal(h.location.hash, ''); assert.equal(h.rows().length, 5); assert.equal(h.document.activeElement, h.el('search'));
});

test('modified stage links remain ordinary shareable links and retain the native browser action', async () => {
  const h = await fixture({ hash: '#workflow=two-d' }); const link = h.step('scene');
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    const result = link.dispatch('click', event); assert.notEqual(result.defaultPrevented, true); assert.equal(h.el('feature').value, '');
  }
  assert.equal(link.href, '#workflow=two-d&feature=scene');
});

test('embedded hostile labels and paths stay inert without external dependencies', async () => {
  const data = catalog(); const payload = '</script><img src=x onerror=alert(1)>&\u2028';
  data.axes.function[1].label = payload; data.workflows[0].label = payload; data.priorities[0].reason = payload;
  data.evidence[0].path = 'javascript:alert(1)'; data.evidence[0].note = payload;
  const h = await fixture({ data, hash: '#workflow=two-d&feature=scene&binding=b2' });
  assert.equal(h.html.includes('<img src=x'), false); assert.equal(h.document.querySelectorAll('img').length, 0);
  assert.equal(h.el('detail').textContent.includes(payload), true); const invalid = h.el('detail').querySelectorAll('a').find(link => link.textContent.includes('javascript:'));
  assert.equal(invalid.getAttribute('href'), null); assert.equal(h.document.querySelectorAll('script[src]').length, 0);
  assert.equal(h.el('priorities').textContent.includes(payload), true);
});

test('restricted file readers with unavailable history keep interactive browsing and local theme controls usable', async () => {
  const h = await fixture({ hash: '#workflow=two-d' });
  h.runtime.history.pushState = h.runtime.history.replaceState = () => { throw new Error('History unavailable'); };
  h.step('scene').click(); assert.equal(h.el('feature').value, 'scene'); h.choose('theme', 'dark');
  assert.equal(h.document.documentElement.dataset.theme, 'dark'); assert.equal(h.storage.get('viento-atlas-theme'), 'dark');
});
