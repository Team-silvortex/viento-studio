import { createProjectEventReview, queryProjectEventReview } from '../../engine/project-event-review.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// The core owns event/entry joins. This view only selects captured evidence and
// delegates navigation; neither a callback receipt nor absent evidence is a guard result.
export function setupProjectEventReview({ container, getContext = () => ({}), onOpen = async () => false, onReviewEntry = async () => false, onClose = () => {} } = {}) {
  if (!container) return Object.freeze({ setObservation() { return false; }, selectEvent() { return false; }, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectEventReviewPanel" class="project-event-review" hidden aria-labelledby="projectEventReviewTitle">
    <div class="project-event-review-heading"><h3 id="projectEventReviewTitle"></h3><button id="projectEventReviewClose" type="button" class="doc-btn doc-btn-ghost"></button></div>
    <p id="projectEventReviewNote" class="build-hint"></p><label id="projectEventReviewSelectionLabel" for="projectEventReviewSelection"></label><select id="projectEventReviewSelection"></select>
    <p id="projectEventReviewScope"></p><h4 id="projectEventReviewName"></h4><pre id="projectEventReviewValue" tabindex="0"></pre>
    <p id="projectEventReviewPublisher"></p><button id="projectEventReviewPublisherSource" type="button" class="doc-btn doc-btn-ghost"></button>
    <h4 id="projectEventReviewRecipientsTitle"></h4><p id="projectEventReviewAssociationNote" class="build-hint"></p><p id="projectEventReviewEmpty" class="build-hint"></p><ol id="projectEventReviewRecipients"></ol>
    <p id="projectEventReviewNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectEventReview' + suffix), selection = el('Selection');
  const options = new Map(), recipients = new Map();
  let disposed = false, model = null, view = null, selectedSequence = null, selectedSignature = '';
  let sessionOwner = '', navigationOwner = '', wasVisible = false, generation = 0, opening = null, navigationMessage = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const eventSignature = event => JSON.stringify([event.sequence, event.name, event.value, event.origin,
    event.deliveries.map(delivery => [delivery.subscriptionId, delivery.origin])]);
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clearSelection = () => { invalidate(); view = null; selectedSequence = null; selectedSignature = ''; options.clear(); recipients.clear(); selection.replaceChildren(); el('Recipients').replaceChildren(); };
  const clear = () => { clearSelection(); model = null; };
  function updateContext() {
    const current = context();
    if (current.sessionOwner !== sessionOwner) { clear(); sessionOwner = current.sessionOwner || ''; }
    if (current.navigationOwner !== navigationOwner) { invalidate(); navigationOwner = current.navigationOwner || ''; }
    if (wasVisible && !canUse(current)) invalidate();
    wasVisible = canUse(current); return current;
  }
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const node = (tag, className = '') => { const result = document.createElement(tag); result.className = className; return result; };
  const children = (parent, next) => {
    const old = [...parent.children];
    if (old.length <= next.length && old.every((item, index) => item === next[index])) parent.append(...next.slice(old.length)); else parent.replaceChildren(...next);
  };
  function createRecipient(subscriptionId) {
    const item = node('li', 'project-event-review-recipient'); item.dataset.subscriptionId = String(subscriptionId);
    const record = { item, status: node('p'), identity: node('p'), origin: node('p'), animation: node('p'), callback: node('p', 'build-hint'),
      source: node('button', 'doc-btn doc-btn-ghost project-event-review-recipient-source'),
      entry: node('button', 'doc-btn project-event-review-animation-entry'), signature: '', entrySignature: '', row: null };
    record.source.type = record.entry.type = 'button';
    record.source.addEventListener('click', () => void navigate('recipient', subscriptionId, record));
    record.entry.addEventListener('click', () => void navigate('entry', subscriptionId, record));
    const actions = node('div', 'project-event-review-actions'); actions.append(record.source, record.entry);
    item.append(record.status, record.identity, record.origin, record.animation, record.callback, actions); return record;
  }
  function render() {
    if (disposed) return;
    const current = updateContext(); el('Panel').hidden = !canUse(current) || !view;
    text(el('Title'), t('事件投递回看')); text(el('Close'), t('关闭事件回看'));
    text(el('Note'), t('查看所选事件的发布与各订阅投递记录，不受事件列表筛选影响。这里不会发布事件或改变运行。'));
    text(el('SelectionLabel'), t('选择事件记录')); text(el('PublisherSource'), t('打开发布来源'));
    text(el('RecipientsTitle'), t('订阅投递与动画进入')); text(el('Empty'), t('发布时没有订阅者。'));
    text(el('Navigation'), opening ? t(opening.role === 'entry' ? '正在打开关联控制器…' : '正在打开事件回看来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    if (!view) { delete el('Panel').dataset.sequence; delete el('Panel').dataset.visitIndex; el('Recipients').dataset.count = '0'; return; }
    const event = view.event;
    el('Panel').dataset.sequence = String(event.sequence); el('Panel').dataset.visitIndex = String(event.origin.visitIndex);
    const nextOptions = [];
    for (const item of model.entries) {
      let option = options.get(item.sequence);
      if (!option) { option = node('option'); option.value = String(item.sequence); options.set(item.sequence, option); }
      text(option, t('事件 {0} · {1}', item.sequence, item.name)); nextOptions.push(option);
    }
    for (const sequence of options.keys()) if (!model.entries.some(item => item.sequence === sequence)) options.delete(sequence);
    children(selection, nextOptions); selection.value = String(event.sequence); selection.disabled = !canUse(current);
    text(el('Scope'), t('事件 {0} · 第 {1} 次访问 · 场景 {2}', event.sequence, event.origin.visitIndex, event.origin.sceneId));
    text(el('Name'), event.name); text(el('Value'), JSON.stringify(event.value));
    text(el('Publisher'), t('发布来源：{0} · {1}', event.origin.source.sourcePath, event.origin.source.propertyPath));
    el('PublisherSource').disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
    text(el('AssociationNote'), t(model.protocolVersion === 10
      ? '仅关联本事件和本订阅确证的动画进入。未采集进入记录不能说明条件失败或行为没有执行；回调成功也不保证后续动画命令已执行。'
      : '此运行协议未记录动画进入来源，无法关联；事件及投递记录仍可查看。'));
    const next = [];
    for (const row of view.deliveries) {
      const delivery = row.delivery; let record = recipients.get(delivery.subscriptionId);
      if (!record) { record = createRecipient(delivery.subscriptionId); recipients.set(delivery.subscriptionId, record); }
      record.row = row; record.signature = JSON.stringify(delivery);
      record.entrySignature = row.animation.status === 'recorded' ? JSON.stringify(row.animation.entry) : '';
      record.item.dataset.status = delivery.status; record.item.dataset.animationStatus = row.animation.status;
      text(record.status, t('订阅 {0} · {1}', delivery.subscriptionId, t({ pending: '等待处理', handled: '已处理（回调成功）', skipped: '已跳过（已取消订阅）' }[delivery.status])));
      text(record.identity, t('订阅行为：{0} · 实例 {1} · 对象 {2}', delivery.origin.bindingId, delivery.origin.instanceId, delivery.origin.objectId));
      text(record.origin, t('订阅来源：{0} · {1}', delivery.origin.source.sourcePath, delivery.origin.source.propertyPath));
      text(record.animation, row.animation.status === 'recorded'
        ? t('已采集进入记录 {0} · 状态 {1} · 场景时间 {2} 秒', row.animation.entry.sequence, row.animation.entry.stateKey, row.animation.entry.timeSeconds)
        : t(row.animation.status === 'unavailable-protocol' ? '此协议无法关联动画进入记录。' : '尚未采集此订阅的动画进入记录。'));
      text(record.callback, row.animation.status === 'recorded' && delivery.status === 'pending' ? t('进入已记录；此订阅的回调结果尚未确认。') : ''); record.callback.hidden = !record.callback.textContent;
      text(record.source, t('打开订阅来源')); text(record.entry, t('回看关联控制器'));
      record.source.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
      record.entry.hidden = row.animation.status !== 'recorded'; record.entry.disabled = !canUse(current) || Boolean(opening);
      if (row.animation.status === 'recorded') record.entry.dataset.entrySequence = String(row.animation.entry.sequence); else delete record.entry.dataset.entrySequence;
      next.push(record.item);
    }
    for (const subscriptionId of recipients.keys()) if (!view.deliveries.some(row => row.delivery.subscriptionId === subscriptionId)) recipients.delete(subscriptionId);
    children(el('Recipients'), next); el('Recipients').dataset.count = String(next.length); el('Empty').hidden = next.length > 0;
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  function selectEvent(sequence, focus = true) {
    const current = updateContext(); if (!canUse(current) || !model) return false;
    let next; try { next = queryProjectEventReview(model, sequence); } catch { return false; }
    if (!next) return false;
    const signature = eventSignature(next.event);
    if (selectedSequence !== sequence || selectedSignature !== signature) invalidate();
    selectedSequence = sequence; selectedSignature = signature; view = next; render(); if (focus) selection.focus(); return true;
  }
  async function navigate(role, subscriptionId = null, expectedRecord = null) {
    const current = updateContext(), record = subscriptionId === null ? null : recipients.get(subscriptionId);
    if (!canUse(current) || !view || opening || role !== 'entry' && current.canOpenSource !== true
      || role !== 'publisher' && (!record || record !== expectedRecord) || role === 'entry' && record.row.animation.status !== 'recorded') return;
    const ticket = { role, generation, sessionOwner, navigationOwner, sequence: selectedSequence, signature: selectedSignature,
      recipientSignature: record?.signature, entrySignature: record?.entrySignature };
    const isCurrent = () => {
      const latest = context(), live = subscriptionId === null ? null : recipients.get(subscriptionId);
      return canUse(latest) && (role === 'entry' || latest.canContinueSource === true)
        && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
        && generation === ticket.generation && opening === ticket && Boolean(view) && selectedSequence === ticket.sequence && selectedSignature === ticket.signature
        && (role === 'publisher' || live === record && live.signature === ticket.recipientSignature
          && (role !== 'entry' || live.entrySignature === ticket.entrySignature));
    };
    ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
    try {
      const result = role === 'entry' ? await onReviewEntry(record.row.animation.entry.sequence, { isCurrent })
        : await onOpen(role === 'publisher' ? view.event.origin : record.row.delivery.origin, { isCurrent });
      if (isCurrent() && result === false) navigationMessage = role === 'entry' ? '无法打开关联控制器，请重新选择事件记录。' : '无法打开事件回看来源，请返回编辑器查找该文档。';
    } catch { if (isCurrent()) navigationMessage = role === 'entry' ? '无法打开关联控制器，请重新选择事件记录。' : '无法打开事件回看来源，请返回编辑器查找该文档。'; }
    finally { if (opening === ticket) { opening = null; render(); } }
  }
  const changed = () => { if (!selectEvent(Number(selection.value), false)) { clearSelection(); render(); } };
  const close = () => { if (!canUse(updateContext()) || !view) return; const sequence = selectedSequence; clearSelection(); render(); onClose(sequence); };
  const publisher = () => void navigate('publisher');
  selection.addEventListener('change', changed); el('Close').addEventListener('click', close); el('PublisherSource').addEventListener('click', publisher);
  const unsubscribe = onLanguageChange(render); render();
  return Object.freeze({
    setObservation(input) {
      if (disposed) return false; updateContext();
      try { model = input == null ? null : createProjectEventReview(input); } catch { clear(); render(); return false; }
      if (!model) clearSelection();
      else if (selectedSequence !== null) { const next = queryProjectEventReview(model, selectedSequence); if (!next || eventSignature(next.event) !== selectedSignature) clearSelection(); else view = next; }
      render(); return Boolean(model);
    }, selectEvent, refresh: render,
    dispose() {
      if (disposed) return; clear(); disposed = true; selection.removeEventListener('change', changed); el('Close').removeEventListener('click', close); el('PublisherSource').removeEventListener('click', publisher);
      if (typeof unsubscribe === 'function') unsubscribe(); container.replaceChildren();
    },
  });
}
