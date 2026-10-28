import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const origin = n => ({ visitIndex: n, sceneId: 'scene-' + n, bindingId: 'binding-' + n, instanceId: 'instance-' + n, objectId: 'object-' + n });
const place = (index, idle = index, physics = index - 1) => ({ executionFrameIndex: index, clock: { idleFrame: idle, physicsFrame: physics } });
const snapshot = () => ({ format: 'viento-project-event-positions', schemaVersion: 1, phase: 'recording',
  counts: { published: 3, settled: 2, pending: 1, deliveries: 3, handled: 1, skipped: 1, pendingDeliveries: 1 },
  retention: { limit: 32, total: 3, retained: 2, dropped: 1, pending: 1, settled: 1, firstSequence: 1, lastSequence: 3 },
  items: [{ sequence: 1, name: '<img src=x>', value: 'unshown', origin: origin(1), published: place(7, 10, 8), deliveries: [
    { subscriptionId: 1, origin: origin(2), status: 'handled', delivered: place(9, 11, 8) },
    { subscriptionId: 2, origin: origin(3), status: 'skipped', delivered: place(10, 11, 8) },
    { subscriptionId: 3, origin: origin(4), status: 'pending' },
  ] }, { sequence: 3, name: 'empty', value: null, origin: origin(1), published: place(8, 10, 8), deliveries: [] }] });
async function fixture(t) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const context = { available: true, visible: true, sessionOwner: 'run-1', navigationOwner: 'scene-1' };
  const h = await dialogHarness('app-project-event-positions-observation', {
    t: (key, ...args) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, n) => args[n] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { subscriptions--; languageChanged = () => {}; }; },
  });
  const container = h.document.createElement('div'); container.id = 'positions'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectEventPositionsObservation({ container, getContext: () => context });
  t.after(() => controller.dispose());
  return { ...h, container, controller, context, el: suffix => h.element('projectEventPositions' + suffix),
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
test('shows only admitted event and recipient positions, retention and missing evidence', async t => {
  const h = await fixture(t); h.controller.setSnapshot(null); assert.equal(h.el('Panel').hidden, true);
  h.controller.setSnapshot(snapshot()); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Phase').dataset.phase, 'recording');
  assert.match(h.el('Retention').textContent, /保留 2 \/ 共 3 条发布，已移出 1 条/);
  const [first, empty] = h.el('Entries').children; assert.equal(first.querySelector('code').textContent, '<img src=x>');
  assert.equal(h.container.querySelector('img'), null); assert.match(first.textContent, /业务帧 7 · 空闲帧 10 · 物理帧 8/);
  const rows = first.querySelectorAll('.project-event-position-delivery'); assert.deepEqual(rows.map(row => row.dataset.status), ['handled', 'skipped', 'pending']);
  assert.match(rows[0].textContent, /订阅 1.*绑定 binding-2.*实例 instance-2/); assert.match(rows[0].textContent, /投递回执 · 业务帧 9/);
  assert.match(rows[1].textContent, /已跳过/); assert.match(rows[2].textContent, /未确认/); assert.doesNotMatch(rows[2].textContent, /投递回执/);
  assert.match(h.el('Note').textContent, /可能已经执行/); assert.match(empty.textContent, /没有订阅者/); assert.doesNotMatch(empty.textContent, /已处理/);
  assert.equal(h.container.querySelector('button'), null);
});
test('live update, empty, incomplete, changed owner and hidden contexts', async t => {
  const h = await fixture(t), initial = snapshot(); h.controller.setSnapshot(initial); initial.items[0].name = 'mutated';
  h.controller.refresh(); assert.equal(h.el('Entries').children[0].querySelector('code').textContent, '<img src=x>');
  const updated = snapshot(); updated.phase = 'incomplete'; updated.items[0].deliveries[2].status = 'handled'; updated.items[0].deliveries[2].delivered = place(15);
  h.controller.setSnapshot(updated); assert.match(h.el('Phase').textContent, /未完成/); assert.match(h.el('Entries').children[0].textContent, /业务帧 15/);
  h.context.navigationOwner = 'scene-2'; h.controller.refresh(); assert.equal(h.el('Entries').children.length, 2);
  h.context.visible = false; h.controller.refresh(); assert.equal(h.el('Panel').hidden, true);
  h.context.visible = true; h.controller.refresh(); assert.equal(h.el('Panel').hidden, false);
  h.context.sessionOwner = 'run-2'; h.controller.refresh(); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Entries').children.length, 0);
  const empty = snapshot(); empty.phase = 'waiting'; empty.items = []; empty.retention = { limit: 32, total: 0, retained: 0, dropped: 0, pending: 0, settled: 0, firstSequence: null, lastSequence: null };
  h.controller.setSnapshot(empty); assert.match(h.el('Phase').textContent, /等待/); assert.match(h.el('Retention').textContent, /— \/ —/); assert.equal(h.el('Empty').hidden, false);
  h.controller.setSnapshot(snapshot()); h.controller.setSnapshot(null); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Entries').children.length, 0);
});
test('all panel messages translate and data is displayed literally in Chinese, English and Japanese', async t => {
  const h = await fixture(t), value = snapshot(); value.items[0].deliveries[0].origin.sceneId = '<script>bad</script>'; h.controller.setSnapshot(value);
  for (const dict of [{}, en, ja]) {
    h.language(dict); assert.equal(h.el('Title').textContent, dict['事件位置观察'] || '事件位置观察');
    assert.equal(h.el('Entries').children[0].querySelector('code').textContent, '<img src=x>');
    assert.match(h.el('Entries').children[0].textContent, /<script>bad<\/script>/); assert.equal(h.container.querySelector('script'), null);
    assert.equal(h.el('Entries').children[0].querySelectorAll('.project-event-position-status')[2].textContent, dict['未确认'] || '未确认');
  }
  h.controller.dispose(); assert.equal(h.subscriptions(), 0); assert.equal(h.container.children.length, 0);
});


test('English and Japanese cover every new message and preserve interpolation placeholders', () => {
  const keys = ['事件位置观察', '只读显示已确认的发布与投递回执位置。未确认只表示缺少回执，回调可能已经执行并产生影响。',
    '等待事件位置记录。', '正在记录事件位置。', '事件位置观察已结束。', '事件位置观察未完成，已保留收到的记录。',
    '保留 {0} / 共 {1} 条发布，已移出 {2} 条；已保留发布的首末序号：{3} / {4}。', '尚无事件发布位置。',
    '业务帧 {0} · 空闲帧 {1} · 物理帧 {2}', '发布序号 {0} · {1}', '订阅 {0} · 访问 {1} · 场景 {2} · 绑定 {3} · 实例 {4} · 对象 {5}',
    '未确认', '投递回执 · {0}', '发布时没有订阅者。', '已处理（回调成功）', '已跳过（已取消订阅）'];
  for (const dictionary of [en, ja]) for (const key of keys) {
    assert.equal(typeof dictionary[key], 'string', key);
    assert.deepEqual([...dictionary[key].matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), [...key.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), key);
  }
});
