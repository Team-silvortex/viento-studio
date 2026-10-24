import { t, onLanguageChange } from '../i18n/index.js';

// The host supplies admitted bounded event history. This view has no publishing,
// subscription or state ports, and never derives delivery success from logs.
export function setupProjectEventObservation({ container, getContext = () => ({}), onOpen = async () => false, onReviewEvent = null } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, focusEvent() { return false; }, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectEventTracePanel" class="project-event-observation" hidden aria-labelledby="projectEventTraceTitle">
    <h3 id="projectEventTraceTitle"></h3><p id="projectEventTraceNote" class="build-hint"></p>
    <p id="projectEventTraceSequence" role="status" aria-live="polite"></p>
    <label for="projectEventTraceSearch" id="projectEventTraceSearchLabel"></label>
    <input id="projectEventTraceSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <p id="projectEventTraceEmpty" class="build-hint"></p><ol id="projectEventTraceEntries"></ol>
    <p id="projectEventTraceNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectEventTrace' + suffix);
  const search = el('Search'), list = el('Entries'), records = new Map();
  let disposed = false, snapshot = null, signature = '', sessionOwner = '', navigationOwner = '', wasVisible = false;
  let opening = null, generation = 0, navigationMessage = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clear = () => { invalidate(); snapshot = null; signature = ''; search.value = ''; records.clear(); list.replaceChildren(); };
  function updateContext() {
    const current = context();
    if (current.sessionOwner !== sessionOwner) { clear(); sessionOwner = current.sessionOwner || ''; }
    if (current.navigationOwner !== navigationOwner) { invalidate(); navigationOwner = current.navigationOwner || ''; }
    if (wasVisible && !canUse(current)) invalidate();
    wasVisible = canUse(current);
    return current;
  }
  const node = (tag, text = '', className = '') => { const result = document.createElement(tag); result.textContent = text; result.className = className; return result; };
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  // Appending history must not detach an existing focused source button.
  function children(parent, next) {
    const previous = [...parent.children];
    if (previous.length <= next.length && previous.every((item, index) => item === next[index])) parent.append(...next.slice(previous.length));
    else parent.replaceChildren(...next);
  }
  function sourceButton(origin, role, currentRecord) {
    const button = node('button', '', 'doc-btn doc-btn-ghost project-event-' + role + '-source'); button.type = 'button';
    button.addEventListener('click', async () => {
      const current = updateContext();
      if (!canUse(current) || current.canOpenSource !== true || opening || !snapshot || !currentRecord()) return;
      const ticket = { generation, sessionOwner, navigationOwner };
      const isCurrent = () => {
        const latest = context();
        return canUse(latest) && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
          && generation === ticket.generation && opening === ticket && Boolean(snapshot) && currentRecord();
      };
      ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
      try {
        const result = await onOpen(origin, { isCurrent });
        if (isCurrent() && result === false) navigationMessage = '无法打开事件来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开事件来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  const publisherSignature = entry => JSON.stringify([entry.sequence, entry.name, entry.value, entry.origin]);
  function createRecord(entry) {
    const item = node('li', '', 'project-event-record'); item.dataset.sequence = String(entry.sequence); item.dataset.name = entry.name;
    const heading = node('h4'), name = node('code', entry.name); heading.append(name);
    const sequence = node('p', '', 'project-event-sequence'), value = node('pre', JSON.stringify(entry.value), 'project-event-value'); value.tabIndex = 0;
    const origin = node('p', '', 'project-event-origin'), empty = node('p', '', 'build-hint'), deliveries = node('ul', '', 'project-event-deliveries');
    const record = { entry, signature: publisherSignature(entry), item, sequence, origin, empty, deliveries, recipients: new Map() };
    record.source = sourceButton(entry.origin, 'publisher', () => records.get(entry.sequence) === record && !item.hidden);
    record.review = node('button', '', 'doc-btn project-event-review-open'); record.review.type = 'button'; record.review.dataset.sequence = String(entry.sequence);
    record.review.addEventListener('click', () => {
      const current = updateContext();
      if (!canUse(current) || !snapshot || typeof onReviewEvent !== 'function' || records.get(entry.sequence) !== record || item.hidden) return;
      const ticket = { generation, sessionOwner, navigationOwner };
      const isCurrent = () => { const latest = context(); return canUse(latest) && latest.sessionOwner === ticket.sessionOwner
        && latest.navigationOwner === ticket.navigationOwner && generation === ticket.generation && Boolean(snapshot) && records.get(entry.sequence) === record && !item.hidden; };
      onReviewEvent(entry.sequence, { isCurrent });
    });
    item.append(heading, sequence, value, origin, record.source, record.review, empty, deliveries); return record;
  }
  function createDelivery(record, delivery) {
    const item = node('li', '', 'project-event-delivery'); item.dataset.subscriptionId = String(delivery.subscriptionId); item.dataset.status = delivery.status;
    const status = node('p', '', 'project-event-status'), origin = node('p', '', 'project-event-origin');
    const recipient = { delivery, signature: JSON.stringify(delivery), item, status, origin };
    recipient.source = sourceButton(delivery.origin, 'subscriber', () => records.get(record.entry.sequence) === record
      && record.recipients.get(delivery.subscriptionId) === recipient && !record.item.hidden);
    item.append(status, origin, recipient.source); return recipient;
  }
  function sourceState(button, current, publisher) {
    setText(button, t(publisher ? '打开发布来源' : '打开订阅来源'));
    button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('项目事件记录'));
    setText(el('Note'), t('只读查看本次运行的事件发布和处理记录。切换场景时保留记录，重新运行后清空；此处不会发布事件。'));
    setText(el('SearchLabel'), t('按事件名称筛选'));
    setText(el('Navigation'), opening ? t('正在打开事件来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Sequence'), ''); delete el('Sequence').dataset.sequence; setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), active = snapshot.entries.filter(entry => entry.name.toLowerCase().includes(query));
    setText(el('Sequence'), t('发布序号 {0} · 显示 {1} / {2} 条事件', snapshot.sequence, active.length, snapshot.entries.length));
    el('Sequence').dataset.sequence = String(snapshot.sequence);
    el('Empty').hidden = active.length > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的事件。' : '当前没有项目事件。'));
    const visible = new Set(active.map(entry => entry.sequence)), next = [];
    for (const entry of snapshot.entries) {
      let record = records.get(entry.sequence);
      if (!record || record.signature !== publisherSignature(entry)) { record = createRecord(entry); records.set(entry.sequence, record); }
      record.item.hidden = !visible.has(entry.sequence);
      setText(record.sequence, t('已发布 · 序号 {0}', entry.sequence));
      setText(record.origin, t('发布来源：第 {0} 次访问 · {1} · {2}', entry.origin.visitIndex, entry.origin.source.sourcePath, entry.origin.source.propertyPath));
      sourceState(record.source, current, true);
      setText(record.review, t('回看此事件')); record.review.hidden = typeof onReviewEvent !== 'function'; record.review.disabled = !canUse(current);
      setText(record.empty, t('发布时没有订阅者。')); record.empty.hidden = entry.deliveries.length > 0;
      const recipients = [];
      for (const delivery of entry.deliveries) {
        let recipient = record.recipients.get(delivery.subscriptionId);
        if (!recipient || recipient.signature !== JSON.stringify(delivery)) { recipient = createDelivery(record, delivery); record.recipients.set(delivery.subscriptionId, recipient); }
        setText(recipient.status, t(delivery.status === 'handled' ? '已处理（回调成功）' : delivery.status === 'skipped' ? '已跳过（已取消订阅）' : '等待处理'));
        setText(recipient.origin, t('订阅来源：第 {0} 次访问 · {1} · {2}', delivery.origin.visitIndex, delivery.origin.source.sourcePath, delivery.origin.source.propertyPath));
        sourceState(recipient.source, current, false); recipients.push(recipient.item);
      }
      for (const id of record.recipients.keys()) if (!entry.deliveries.some(delivery => delivery.subscriptionId === id)) record.recipients.delete(id);
      children(record.deliveries, recipients); next.push(record.item);
    }
    for (const sequence of records.keys()) if (!snapshot.entries.some(entry => entry.sequence === sequence)) records.delete(sequence);
    children(list, next);
    // Appends leave publisher tickets valid; changing the selected recipient's
    // delivery status revokes only that recipient ticket, even at the same sequence.
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  const changed = () => { invalidate(); render(); };
  search.addEventListener('input', changed);
  const unsubscribe = onLanguageChange(render);
  render();
  return Object.freeze({
    setSnapshot(value) {
      if (disposed) return;
      updateContext();
      // Copy admitted data; pure core validation remains the host's responsibility.
      const next = value == null ? '' : JSON.stringify(value);
      if (next !== signature) {
        signature = next; snapshot = next ? JSON.parse(next) : null;
        if (!snapshot) { invalidate(); records.clear(); list.replaceChildren(); }
      }
      render();
    },
    focusEvent(sequence) {
      const current = updateContext(); if (!canUse(current) || !snapshot) return false;
      const record = records.get(sequence);
      if (record && !record.item.hidden && !record.review.hidden && !record.review.disabled && list.contains(record.review)) record.review.focus(); else search.focus();
      return true;
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true; clear(); search.removeEventListener('input', changed);
      if (typeof unsubscribe === 'function') unsubscribe();
      container.replaceChildren();
    },
  });
}
