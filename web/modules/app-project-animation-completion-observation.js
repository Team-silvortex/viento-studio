import { validateProjectAnimationCompletionsSnapshot } from '../../engine/project-animation-completions.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// Completion history owns no playback, subscription or execution ports. Each
// source ticket belongs to its receipt (or delivery), current visit and run.
export function setupProjectAnimationCompletionObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAnimationCompletionsPanel" class="project-animation-completion-observation" hidden aria-labelledby="projectAnimationCompletionsTitle">
    <h3 id="projectAnimationCompletionsTitle"></h3><p id="projectAnimationCompletionsNote" class="build-hint"></p>
    <p id="projectAnimationCompletionsDeliveryNote" class="build-hint"></p>
    <p id="projectAnimationCompletionsSequence" role="status" aria-live="polite"></p>
    <label for="projectAnimationCompletionsSearch" id="projectAnimationCompletionsSearchLabel"></label>
    <input id="projectAnimationCompletionsSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <p id="projectAnimationCompletionsEmpty" class="build-hint"></p><ol id="projectAnimationCompletionsEntries"></ol>
    <p id="projectAnimationCompletionsNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAnimationCompletions' + suffix);
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
  function children(parent, next) {
    const previous = [...parent.children];
    if (previous.length <= next.length && previous.every((item, index) => item === next[index])) parent.append(...next.slice(previous.length));
    else parent.replaceChildren(...next);
  }
  function sourceButton(source, role, currentRecord) {
    const button = node('button', '', 'doc-btn doc-btn-ghost project-animation-completion-' + role + '-source'); button.type = 'button';
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
        const result = await onOpen(source, { isCurrent });
        if (isCurrent() && result === false) navigationMessage = '无法打开动画完成来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开动画完成来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  const completionSignature = entry => JSON.stringify([entry.sequence, entry.commandSequence, entry.visitIndex, entry.sceneId, entry.state, entry.animation, entry.clip]);
  function createRecord(entry) {
    const item = node('li', '', 'project-animation-completion');
    item.dataset.sequence = String(entry.sequence); item.dataset.animationId = entry.animation.objectId;
    const heading = node('h4'), sequence = node('p', '', 'project-animation-completion-sequence');
    const identity = node('p', '', 'project-animation-completion-identity'), state = node('p', '', 'project-animation-completion-state');
    const clip = node('p', '', 'project-animation-completion-clip'), declaration = node('p', '', 'project-animation-completion-origin');
    const empty = node('p', '', 'build-hint'), deliveries = node('ul', '', 'project-animation-completion-deliveries');
    const record = { entry, signature: completionSignature(entry), item, heading, sequence, identity, state, clip, declaration, empty, deliveries, recipients: new Map() };
    const owns = () => records.get(entry.sequence) === record && !item.hidden;
    record.animationSource = sourceButton(entry.animation.source, 'animation', owns);
    const actions = node('div', '', 'project-animation-completion-sources'); actions.append(record.animationSource);
    if (entry.clip) { record.clipSource = sourceButton(entry.clip.source, 'clip', owns); actions.append(record.clipSource); }
    item.append(heading, sequence, identity, state, clip, declaration, actions, empty, deliveries); return record;
  }
  function createDelivery(record, delivery) {
    const item = node('li', '', 'project-animation-completion-delivery');
    item.dataset.subscriptionId = String(delivery.subscriptionId); item.dataset.status = delivery.status;
    const status = node('p'), identity = node('p', '', 'project-animation-completion-identity'), origin = node('p', '', 'project-animation-completion-origin');
    const recipient = { delivery, signature: JSON.stringify(delivery), item, status, identity, origin };
    recipient.source = sourceButton(delivery.origin.source, 'subscriber', () => records.get(record.entry.sequence) === record
      && record.recipients.get(delivery.subscriptionId) === recipient && !record.item.hidden);
    item.append(status, identity, origin, recipient.source); return recipient;
  }
  function sourceState(button, key, current) {
    setText(button, t(key)); button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('动画自然完成记录'));
    setText(el('Note'), t('只读显示非循环动画自然到达末尾的记录。停止、跳转到末尾和循环边界不会产生完成通知；切换场景保留记录，重新运行后清空。'));
    setText(el('DeliveryNote'), t('回调已处理仅表示同步回调成功，不保证后续动画命令已经执行。已跳过可能由取消订阅、离开场景或新动画命令引起，不代表永久退订。'));
    setText(el('SearchLabel'), t('按场景、动画或片段筛选'));
    setText(el('Navigation'), opening ? t('正在打开动画完成来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Sequence'), ''); delete el('Sequence').dataset.sequence; setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), active = snapshot.entries.filter(entry => [entry.sceneId, entry.animation.objectId, entry.clip?.id || '', entry.clip?.name || ''].some(value => value.toLowerCase().includes(query)));
    setText(el('Sequence'), t('完成序号 {0} · 显示 {1} / {2} 条完成记录', snapshot.sequence, active.length, snapshot.entries.length));
    el('Sequence').dataset.sequence = String(snapshot.sequence);
    el('Empty').hidden = active.length > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的动画完成记录。' : '当前没有动画自然完成记录。'));
    const visible = new Set(active.map(entry => entry.sequence)), next = [];
    for (const entry of snapshot.entries) {
      let record = records.get(entry.sequence);
      if (!record || record.signature !== completionSignature(entry)) { record = createRecord(entry); records.set(entry.sequence, record); }
      record.item.hidden = !visible.has(entry.sequence);
      setText(record.heading, t('动画已自然完成'));
      setText(record.sequence, t('序号 {0} · 第 {1} 次访问 · 场景时间 {2} 秒', entry.sequence, entry.visitIndex, entry.state.timeSeconds));
      setText(record.identity, t('场景 {0} · 动画 {1}', entry.sceneId, entry.animation.objectId));
      setText(record.state, t('完成时播放头 {0} 秒 · 动画命令序号 {1}', entry.state.positionSeconds, entry.commandSequence));
      setText(record.clip, entry.clip ? t('片段：{0} · {1} · 原时间轴 {2}–{3} 秒', entry.clip.name, entry.clip.id, entry.clip.startSeconds, entry.clip.endSeconds) : t('完整动画'));
      setText(record.declaration, t('动画声明：{0} · {1}', entry.animation.source.sourcePath, entry.animation.source.propertyPath));
      sourceState(record.animationSource, '打开动画声明', current);
      if (record.clipSource) sourceState(record.clipSource, '打开动画片段声明', current);
      setText(record.empty, t('完成时没有订阅者。')); record.empty.hidden = entry.deliveries.length > 0;
      const recipients = [];
      for (const delivery of entry.deliveries) {
        let recipient = record.recipients.get(delivery.subscriptionId);
        if (!recipient || recipient.signature !== JSON.stringify(delivery)) { recipient = createDelivery(record, delivery); record.recipients.set(delivery.subscriptionId, recipient); }
        const status = t({ pending: '等待处理', handled: '已处理（同步回调成功）', skipped: '已跳过（本次未调用）' }[delivery.status]);
        setText(recipient.status, t('完成订阅 {0} · {1}', delivery.subscriptionId, status));
        setText(recipient.identity, t('订阅行为：{0} · 实例 {1} · 对象 {2}', delivery.origin.bindingId, delivery.origin.instanceId, delivery.origin.objectId));
        setText(recipient.origin, t('订阅来源：第 {0} 次访问 · {1} · {2}', delivery.origin.visitIndex, delivery.origin.source.sourcePath, delivery.origin.source.propertyPath));
        sourceState(recipient.source, '打开订阅来源', current); recipients.push(recipient.item);
      }
      for (const id of record.recipients.keys()) if (!entry.deliveries.some(delivery => delivery.subscriptionId === id)) record.recipients.delete(id);
      children(record.deliveries, recipients); next.push(record.item);
    }
    for (const sequence of records.keys()) if (!snapshot.entries.some(entry => entry.sequence === sequence)) records.delete(sequence);
    children(list, next);
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  const changed = () => { invalidate(); render(); };
  search.addEventListener('input', changed);
  const unsubscribe = onLanguageChange(render);
  render();
  return Object.freeze({
    setSnapshot(value, { protocolVersion = 7 } = {}) {
      if (disposed) return;
      updateContext();
      let admitted;
      try {
        if (![7, 8, 9, 10].includes(protocolVersion)) throw new TypeError('Unsupported animation completion observation.');
        admitted = value == null ? null : validateProjectAnimationCompletionsSnapshot(value);
      } catch { clear(); render(); return; }
      const next = admitted == null ? '' : JSON.stringify(admitted);
      if (next !== signature) {
        signature = next; snapshot = next ? JSON.parse(next) : null;
        if (!snapshot) { invalidate(); records.clear(); list.replaceChildren(); }
      }
      render();
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
