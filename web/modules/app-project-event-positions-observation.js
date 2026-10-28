import { t, onLanguageChange } from '../i18n/index.js';

// The host supplies a validated snapshot owned by the current run. This view
// exposes no execution or navigation ports and never infers missing outcomes.
export function setupProjectEventPositionsObservation({ container, getContext = () => ({}) } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectEventPositionsPanel" class="project-event-observation" hidden aria-labelledby="projectEventPositionsTitle">
    <h3 id="projectEventPositionsTitle"></h3><p id="projectEventPositionsNote" class="build-hint"></p>
    <p id="projectEventPositionsPhase" role="status" aria-live="polite"></p><p id="projectEventPositionsRetention" class="build-hint"></p>
    <p id="projectEventPositionsEmpty" class="build-hint"></p><ol id="projectEventPositionsEntries"></ol></section>`;
  const el = suffix => container.querySelector('#projectEventPositions' + suffix);
  const node = (tag, value = '', className = '') => { const item = document.createElement(tag); item.textContent = value; item.className = className; return item; };
  let disposed = false, snapshot = null, signature = '', sessionOwner = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = state => !disposed && state.available === true && state.visible === true && container.isConnected !== false
    && typeof state.sessionOwner === 'string' && Boolean(state.sessionOwner)
    && typeof state.navigationOwner === 'string' && Boolean(state.navigationOwner);
  function clear() { snapshot = null; signature = ''; el('Entries').replaceChildren(); }
  function updateContext() {
    const state = context();
    if (state.sessionOwner !== sessionOwner) { clear(); sessionOwner = state.sessionOwner || ''; }
    return state;
  }
  const position = value => t('业务帧 {0} · 空闲帧 {1} · 物理帧 {2}', value.executionFrameIndex, value.clock.idleFrame, value.clock.physicsFrame);
  function render() {
    if (disposed) return;
    const state = updateContext();
    el('Panel').hidden = !canUse(state) || !snapshot;
    el('Title').textContent = t('事件位置观察');
    el('Note').textContent = t('只读显示已确认的发布与投递回执位置。未确认只表示缺少回执，回调可能已经执行并产生影响。');
    if (!snapshot) { el('Phase').textContent = ''; delete el('Phase').dataset.phase; el('Retention').textContent = ''; el('Empty').textContent = ''; return; }
    const phases = { waiting: '等待事件位置记录。', recording: '正在记录事件位置。', finished: '事件位置观察已结束。', incomplete: '事件位置观察未完成，已保留收到的记录。' };
    el('Phase').textContent = t(phases[snapshot.phase]); el('Phase').dataset.phase = snapshot.phase;
    const retention = snapshot.retention;
    el('Retention').textContent = t('保留 {0} / 共 {1} 条发布，已移出 {2} 条；已保留发布的首末序号：{3} / {4}。', retention.retained, retention.total, retention.dropped,
      retention.firstSequence ?? '—', retention.lastSequence ?? '—');
    el('Empty').hidden = snapshot.items.length > 0;
    el('Empty').textContent = t('尚无事件发布位置。');
    const entries = snapshot.items.map(entry => {
      const item = node('li', '', 'project-event-position project-event-record'); item.dataset.sequence = String(entry.sequence);
      const heading = node('h4'); heading.append(node('code', entry.name));
      const published = node('p', t('发布序号 {0} · {1}', entry.sequence, position(entry.published)));
      const deliveries = node('ul', '', 'project-event-deliveries');
      if (!entry.deliveries.length) item.append(heading, published, node('p', t('发布时没有订阅者。'), 'build-hint'));
      else {
        item.append(heading, published);
        for (const delivery of entry.deliveries) {
          const row = node('li', '', 'project-event-position-delivery project-event-delivery'); row.dataset.subscriptionId = String(delivery.subscriptionId); row.dataset.status = delivery.status;
          const origin = delivery.origin;
          row.append(node('p', t('订阅 {0} · 访问 {1} · 场景 {2} · 绑定 {3} · 实例 {4} · 对象 {5}', delivery.subscriptionId, origin.visitIndex, origin.sceneId, origin.bindingId, origin.instanceId, origin.objectId)));
          const labels = { pending: '未确认', handled: '已处理（回调成功）', skipped: '已跳过（已取消订阅）' };
          row.append(node('p', t(labels[delivery.status]), 'project-event-position-status'));
          if (delivery.delivered) row.append(node('p', t('投递回执 · {0}', position(delivery.delivered))));
          deliveries.append(row);
        }
        item.append(deliveries);
      }
      return item;
    });
    el('Entries').replaceChildren(...entries);
  }
  const unsubscribe = onLanguageChange(render); render();
  return Object.freeze({
    setSnapshot(value) {
      if (disposed) return;
      updateContext();
      const next = value == null ? '' : JSON.stringify(value);
      if (next !== signature) { if (next) { signature = next; snapshot = JSON.parse(next); } else clear(); }
      render();
    },
    refresh: render,
    dispose() { if (disposed) return; disposed = true; clear(); if (typeof unsubscribe === 'function') unsubscribe(); container.replaceChildren(); },
  });
}
