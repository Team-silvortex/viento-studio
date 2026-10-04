import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const groupIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const ids = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const objectId = '66666666-6666-4666-8666-666666666666';
const groups = [{ groupId: groupIds[0], name: 'Party <script>' }, { groupId: groupIds[1], name: 'Front', parentGroupId: groupIds[0] }];
const actors = [{ instanceId: ids[0], objectId, name: 'Scout', groupId: groupIds[1] }, { instanceId: ids[1], objectId, name: 'Medic', groupId: groupIds[0] }, { instanceId: ids[2], objectId, name: 'Visitor' }];
async function fixture() {
  let locale = 'zh'; const selections = [];
  const h = await dialogHarness('app-scene-outline', { t: (key, ...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_, i) => String(args[i])) });
  const root = h.document.createElement('ol'), search = h.document.createElement('input'); h.document.body.append(search, root);
  const outline = h.runtime.createSceneOutline({ root, search, multi: true, onActorSelect: (...args) => selections.push(args), onGroupSelect: (...args) => selections.push(args) });
  outline.setModel({ groups, actors });
  const query = value => { search.value = value; search.dispatch('input'); };
  return { ...h, root, search, outline, selections, query, language(value) { locale = value; outline.refresh(); } };
}

test('scene outline search retains ancestor paths and original descendant selection order without altering draw order', async () => {
  const h = await fixture(); h.query('Scout');
  assert.equal(h.root.querySelectorAll('button[data-group-toggle]').length, 2);
  assert.deepEqual(h.root.querySelectorAll('button[data-actor-id]').map(item => item.dataset.actorId), [ids[0]]);
  h.root.querySelector(`button[data-group-id="${groupIds[0]}"]`).click();
  assert.deepEqual(Array.from(h.selections[0][0]), [ids[0], ids[1]], 'filter does not shrink group selection');
  h.query('Party'); assert.equal(h.root.querySelectorAll('button[data-actor-id]').length, 2);
  h.query(ids[2]); assert.equal(h.root.querySelectorAll('button[data-group-toggle]').length, 0);
  h.query('missing'); assert.match(h.root.textContent, /没有匹配/);
  assert.deepEqual(actors.map(actor => actor.instanceId), ids);
  assert.equal(h.root.querySelectorAll('script').length, 0);
});

test('collapsed scene groups and search survive language changes and clearing a filter restores collapsed state', async () => {
  const h = await fixture(), selector = `button[data-group-toggle="${groupIds[0]}"]`;
  h.root.querySelector(selector).click(); assert.equal(h.root.querySelector(selector).getAttribute('aria-expanded'), 'false');
  h.query('Scout'); assert.equal(h.root.querySelector(selector).getAttribute('aria-expanded'), 'true');
  h.language('en'); assert.equal(h.search.value, 'Scout'); assert.match(h.root.querySelector(selector).getAttribute('aria-label'), /Collapse/);
  h.language('ja'); assert.equal(h.search.value, 'Scout'); assert.match(h.root.querySelector(selector).getAttribute('aria-label'), /折りたたむ/);
  h.query(''); assert.equal(h.root.querySelector(selector).getAttribute('aria-expanded'), 'false');
  h.outline.reset(); assert.equal(h.search.value, ''); h.outline.setModel({ groups, actors }); assert.equal(h.root.querySelector(selector).getAttribute('aria-expanded'), 'true');
});

test('scene group checkbox reports partial selection and respects input locks', async () => {
  const h = await fixture(), selector = `input[data-group-id="${groupIds[0]}"]`;
  h.outline.setSelection([ids[0]]); assert.equal(h.root.querySelector(selector).indeterminate, true); assert.equal(h.root.querySelector(selector).checked, false);
  h.outline.setSelection([ids[0], ids[1]], { disabled: true }); assert.equal(h.root.querySelector(selector).indeterminate, false); assert.equal(h.root.querySelector(selector).checked, true);
  const select = h.root.querySelector(`button[data-group-id="${groupIds[0]}"]`); select.click(); assert.equal(h.selections.length, 0);
  h.outline.setSelection([]); h.root.querySelector(selector).dispatch('change'); assert.equal(h.selections[0][1].toggle, true);
});
