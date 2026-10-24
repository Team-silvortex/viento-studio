import { createProjectAnimationTargetReview, queryProjectAnimationTargetReview, findProjectAnimationTargetReview } from '../../engine/project-animation-target-review.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// Captured evidence owns no playback, execution or authoring ports. Navigation
// is scoped to the selected target and the exact source record being opened.
export function setupProjectAnimationTargetReview({ container, getContext = () => ({}), onOpen = async () => false, onClose = () => {} } = {}) {
  if (!container) return Object.freeze({ setObservation() { return false; }, selectRecord() { return false; }, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAnimationTargetReviewPanel" class="project-animation-target-review" hidden aria-labelledby="projectAnimationTargetReviewTitle">
    <div class="project-animation-target-review-heading"><h3 id="projectAnimationTargetReviewTitle"></h3><button id="projectAnimationTargetReviewClose" type="button" class="doc-btn doc-btn-ghost"></button></div>
    <p id="projectAnimationTargetReviewNote" class="build-hint"></p>
    <label id="projectAnimationTargetReviewSelectionLabel" for="projectAnimationTargetReviewSelection"></label><div class="project-animation-target-review-controls"><select id="projectAnimationTargetReviewSelection"></select></div>
    <p id="projectAnimationTargetReviewScope"></p><p id="projectAnimationTargetReviewCounts"></p><p id="projectAnimationTargetReviewSelected" role="status" aria-live="polite"></p>
    <p id="projectAnimationTargetReviewSequenceNote" class="build-hint"></p>
    <h4 id="projectAnimationTargetReviewCommandsTitle"></h4><p id="projectAnimationTargetReviewCommandsEmpty" class="build-hint"></p><ol id="projectAnimationTargetReviewCommands"></ol>
    <h4 id="projectAnimationTargetReviewCompletionsTitle"></h4><p id="projectAnimationTargetReviewCompletionsEmpty" class="build-hint"></p><ol id="projectAnimationTargetReviewCompletions"></ol>
    <p id="projectAnimationTargetReviewDeliveryNote" class="build-hint"></p><p id="projectAnimationTargetReviewNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAnimationTargetReview' + suffix), selection = el('Selection');
  const options = new Map(), commands = new Map(), completions = new Map();
  let model = null, view = null, selected = null, opener = null, disposed = false;
  let sessionOwner = '', navigationOwner = '', wasVisible = false, generation = 0, opening = null, navigationMessage = '';
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clearRows = () => { commands.clear(); completions.clear(); el('Commands').replaceChildren(); el('Completions').replaceChildren(); };
  const clearSelection = () => { invalidate(); view = null; selected = null; opener = null; options.clear(); selection.replaceChildren(); clearRows(); };
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
    const previous = [...parent.children];
    if (previous.length <= next.length && previous.every((item, index) => item === next[index])) parent.append(...next.slice(previous.length));
    else parent.replaceChildren(...next);
  };
  const action = command => t({ select: '选择片段', play: '播放', pause: '暂停', stop: '停止', seek: '跳转' }[command.command.action]);
  const completionSignature = entry => JSON.stringify([entry.sequence, entry.commandSequence, entry.visitIndex, entry.sceneId, entry.state, entry.animation, entry.clip, entry.target, entry.targetCommandSequence]);
  const signature = (kind, entry) => kind === 'command' ? JSON.stringify(entry) : completionSignature(entry);
  const record = (next, kind, sequence) => kind === 'command' ? next.commands.find(item => item.sequence === sequence)
    : next.completions.find(item => item.entry.sequence === sequence)?.entry;
  const targetLabel = target => target.kind === 'instance' ? t('实例 {0}', target.instanceId) : t('整场景');
  const groupLabel = group => t('第 {0} 次访问 · 场景 {1} · {2}', group.visitIndex, group.sceneId, targetLabel(group.target));
  function sourceButton(source, role, owns) {
    const button = node('button', 'doc-btn doc-btn-ghost project-animation-target-review-' + role + '-source'); button.type = 'button';
    button.addEventListener('click', async () => {
      const current = updateContext();
      if (!canUse(current) || current.canOpenSource !== true || opening || !view || !owns()) return;
      const ticket = { generation, sessionOwner, navigationOwner, groupKey: view.group.key };
      const isCurrent = () => {
        const latest = context();
        return canUse(latest) && latest.canContinueSource === true && latest.sessionOwner === ticket.sessionOwner
          && latest.navigationOwner === ticket.navigationOwner && generation === ticket.generation && opening === ticket
          && view?.group.key === ticket.groupKey && owns();
      };
      ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
      try { if (await onOpen(source, { isCurrent }) === false && isCurrent()) navigationMessage = '无法打开动画目标回看来源，请返回编辑器查找该文档。'; }
      catch { if (isCurrent()) navigationMessage = '无法打开动画目标回看来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  function sourceState(button, key, current) {
    if (!button) return;
    text(button, t(key)); button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
  }
  function createRow(entry, kind) {
    const item = node('li', 'project-animation-target-review-' + kind); item.dataset.sequence = String(entry.sequence); item.tabIndex = -1;
    const row = { item, signature: signature(kind, entry), summary: node('h5'), state: node('p'), clip: node('p'), declaration: node('p'), clipDeclaration: node('p') };
    const rows = kind === 'command' ? commands : completions, owns = () => rows.get(entry.sequence) === row && Boolean(view);
    row.animationSource = sourceButton(entry.animation.source, 'animation', owns);
    const sources = node('div', 'project-animation-target-review-sources');
    if (kind === 'command') {
      row.origin = node('p'); row.commandSource = sourceButton(entry.origin.source, 'command', owns); sources.append(row.commandSource);
      item.append(row.summary, row.state, row.clip, row.origin, row.declaration, row.clipDeclaration);
    } else {
      item.dataset.targetCommandSequence = String(entry.targetCommandSequence); item.dataset.commandSequence = String(entry.commandSequence);
      row.anchor = node('p', 'project-animation-target-review-anchor'); row.anchorSummary = node('p'); row.jump = node('button', 'doc-btn doc-btn-ghost project-animation-target-review-anchor-jump'); row.jump.type = 'button';
      row.jump.dataset.commandSequence = String(entry.targetCommandSequence);
      row.jump.addEventListener('click', () => {
        if (!owns() || !selectRecord('command', entry.targetCommandSequence, false)) return;
        const target = commands.get(entry.targetCommandSequence)?.item;
        target?.focus(); target?.scrollIntoView({ block: 'nearest' });
      });
      row.empty = node('p', 'build-hint'); row.deliveries = node('ul', 'project-animation-target-review-deliveries'); row.recipients = new Map();
      item.append(row.summary, row.anchor, row.anchorSummary, row.jump, row.state, row.clip, row.declaration, row.clipDeclaration);
    }
    sources.append(row.animationSource);
    if (entry.clip) { row.clipSource = sourceButton(entry.clip.source, 'clip', owns); sources.append(row.clipSource); }
    item.append(sources);
    if (kind === 'completion') item.append(row.empty, row.deliveries);
    return row;
  }
  function renderRow(row, entry, kind, current) {
    const chosen = selected?.kind === kind && selected.sequence === entry.sequence;
    row.item.dataset.selected = String(chosen); row.item.setAttribute('aria-current', String(chosen));
    text(row.summary, kind === 'command' ? t('已执行命令 {0} · {1} · 场景时间 {2} 秒', entry.sequence, action(entry), entry.state.timeSeconds)
      : t('自然完成 {0} · 场景时间 {1} 秒', entry.sequence, entry.state.timeSeconds));
    text(row.state, kind === 'command' ? t('执行后状态：{0} · 播放位置 {1} 秒', t({ playing: '播放', paused: '暂停', stopped: '停止', finished: '结束' }[entry.state.phase]), entry.state.positionSeconds)
      : t('完成时播放头 {0} 秒 · 动画命令序号 {1}', entry.state.positionSeconds, entry.commandSequence));
    text(row.clip, entry.clip ? t('片段：{0} · {1} · 原时间轴 {2}–{3} 秒', entry.clip.name, entry.clip.id, entry.clip.startSeconds, entry.clip.endSeconds) : t('完整动画'));
    text(row.declaration, t(kind === 'command' ? '动画声明：{0} · {1}' : '完成来源：{0} · {1}', entry.animation.source.sourcePath, entry.animation.source.propertyPath));
    row.clipDeclaration.hidden = !entry.clip;
    text(row.clipDeclaration, entry.clip ? t('片段声明：{0} · {1}', entry.clip.source.sourcePath, entry.clip.source.propertyPath) : '');
    if (row.origin) text(row.origin, t('命令来源：{0} · {1}', entry.origin.source.sourcePath, entry.origin.source.propertyPath));
    sourceState(row.commandSource, '打开命令来源', current); sourceState(row.animationSource, '打开动画声明', current); sourceState(row.clipSource, '打开动画片段声明', current);
  }
  function renderDeliveries(row, entry, current) {
    text(row.empty, t('完成时没有订阅者。')); row.empty.hidden = entry.deliveries.length > 0;
    const next = [];
    for (const delivery of entry.deliveries) {
      const fingerprint = JSON.stringify([delivery.subscriptionId, delivery.origin]); let recipient = row.recipients.get(delivery.subscriptionId);
      if (!recipient || recipient.signature !== fingerprint) {
        recipient = { signature: fingerprint, item: node('li'), status: node('p'), origin: node('p') };
        const ownRecipient = recipient;
        recipient.source = sourceButton(delivery.origin.source, 'subscriber', () => completions.get(entry.sequence) === row && row.recipients.get(delivery.subscriptionId) === ownRecipient && Boolean(view));
        recipient.item.dataset.subscriptionId = String(delivery.subscriptionId); recipient.item.append(recipient.status, recipient.origin, recipient.source); row.recipients.set(delivery.subscriptionId, recipient);
      }
      recipient.item.dataset.status = delivery.status;
      text(recipient.status, t('完成订阅 {0} · {1}', delivery.subscriptionId, t({ pending: '等待处理', handled: '已处理（同步回调成功）', skipped: '已跳过（本次未调用）' }[delivery.status])));
      text(recipient.origin, t('订阅来源：第 {0} 次访问 · {1} · {2}', delivery.origin.visitIndex, delivery.origin.source.sourcePath, delivery.origin.source.propertyPath));
      sourceState(recipient.source, '打开订阅来源', current); next.push(recipient.item);
    }
    for (const id of row.recipients.keys()) if (!entry.deliveries.some(delivery => delivery.subscriptionId === id)) row.recipients.delete(id);
    children(row.deliveries, next);
  }
  function render() {
    if (disposed) return;
    const current = updateContext(); el('Panel').hidden = !canUse(current) || !view;
    text(el('Title'), t('动画目标回看')); text(el('Close'), t('关闭回看'));
    text(el('Note'), t('仅回看此动画目标本次场景访问的已执行命令与自然完成记录；这里不会跳转运行时间或改变播放。'));
    text(el('SelectionLabel'), t('选择动画目标')); text(el('SequenceNote'), t('命令与完成分别使用各自的全局序号，不表示合并后的执行顺序。'));
    text(el('CommandsTitle'), t('此目标的已执行命令')); text(el('CompletionsTitle'), t('此目标的自然完成记录'));
    text(el('CommandsEmpty'), t('尚未采集此目标的已执行命令。')); text(el('CompletionsEmpty'), t('尚未采集此目标的自然完成记录。'));
    text(el('DeliveryNote'), t('回调已处理仅表示同步回调成功，不保证后续动画命令已经执行。已跳过可能由取消订阅、离开场景或新动画命令引起，不代表永久退订。'));
    text(el('Navigation'), opening ? t('正在打开动画目标回看来源…') : navigationMessage ? t(navigationMessage) : ''); el('Navigation').hidden = !opening && !navigationMessage;
    if (!view) {
      for (const key of ['groupKey', 'visitIndex', 'targetKind', 'targetInstanceId', 'selectedKind', 'selectedSequence']) delete el('Panel').dataset[key];
      el('Commands').dataset.count = '0'; el('Completions').dataset.count = '0'; return;
    }
    const group = view.group;
    Object.assign(el('Panel').dataset, { groupKey: group.key, visitIndex: String(group.visitIndex), targetKind: group.target.kind, targetInstanceId: group.target.instanceId || '', selectedKind: selected?.kind || '', selectedSequence: selected ? String(selected.sequence) : '' });
    text(el('Scope'), groupLabel(group)); text(el('Counts'), t('动画 {0} · 已执行命令 {1} 条 · 自然完成 {2} 条', group.animation.objectId, group.commandCount, group.completionCount));
    text(el('Selected'), selected ? t(selected.kind === 'command' ? '已选中命令 {0}' : '已选中自然完成 {0}', selected.sequence) : ''); el('Selected').hidden = !selected;
    const nextOptions = [];
    for (const item of model.groups) {
      let option = options.get(item.key); if (!option) { option = node('option'); option.value = item.key; options.set(item.key, option); }
      text(option, groupLabel(item)); nextOptions.push(option);
    }
    for (const key of options.keys()) if (!model.groups.some(item => item.key === key)) options.delete(key);
    children(selection, nextOptions); selection.value = group.key; selection.disabled = !canUse(current);
    const commandNodes = [];
    for (const entry of view.commands) {
      let row = commands.get(entry.sequence); if (!row || row.signature !== signature('command', entry)) { row = createRow(entry, 'command'); commands.set(entry.sequence, row); }
      renderRow(row, entry, 'command', current); commandNodes.push(row.item);
    }
    for (const sequence of commands.keys()) if (!view.commands.some(entry => entry.sequence === sequence)) commands.delete(sequence);
    children(el('Commands'), commandNodes); el('Commands').dataset.count = String(commandNodes.length); el('CommandsEmpty').hidden = commandNodes.length > 0;
    const completionNodes = [];
    for (const { entry, anchorCommand } of view.completions) {
      let row = completions.get(entry.sequence); if (!row || row.signature !== signature('completion', entry)) { row = createRow(entry, 'completion'); completions.set(entry.sequence, row); }
      renderRow(row, entry, 'completion', current);
      text(row.anchor, t('目标最后命令序号 {0} · 全部命令截止 {1}', entry.targetCommandSequence, entry.commandSequence));
      text(row.anchorSummary, anchorCommand ? t('目标锚点：已执行命令 {0} · {1} · 场景时间 {2} 秒', anchorCommand.sequence, action(anchorCommand), anchorCommand.state.timeSeconds) : t('整场景自动播放完成，没有目标锚点命令。'));
      text(row.jump, t('查看目标锚点命令 {0}', entry.targetCommandSequence)); row.jump.hidden = !anchorCommand; row.jump.disabled = !anchorCommand || !canUse(current);
      renderDeliveries(row, entry, current); completionNodes.push(row.item);
    }
    for (const sequence of completions.keys()) if (!view.completions.some(item => item.entry.sequence === sequence)) completions.delete(sequence);
    children(el('Completions'), completionNodes); el('Completions').dataset.count = String(completionNodes.length); el('CompletionsEmpty').hidden = completionNodes.length > 0;
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  function selectRecord(kind, sequence, focus = true) {
    if (!canUse(updateContext()) || !model) return false;
    let key, next;
    try { key = findProjectAnimationTargetReview(model, kind, sequence); next = key ? queryProjectAnimationTargetReview(model, key) : null; } catch { return false; }
    if (!next) return false;
    const entry = record(next, kind, sequence); if (!entry) return false;
    const fingerprint = signature(kind, entry);
    if (view?.group.key !== key || selected?.kind !== kind || selected?.sequence !== sequence || selected?.signature !== fingerprint) invalidate();
    if (view?.group.key !== key) clearRows();
    selected = { kind, sequence, signature: fingerprint }; view = next;
    if (focus) opener = { kind, sequence };
    render(); if (focus) selection.focus(); return true;
  }
  const changed = () => {
    if (!canUse(updateContext()) || !model || !view) return;
    let next; try { next = queryProjectAnimationTargetReview(model, selection.value); } catch { next = null; }
    if (!next) { clearSelection(); render(); return; }
    if (next.group.key !== view.group.key) { invalidate(); clearRows(); selected = null; view = next; } render();
  };
  const close = () => {
    if (!canUse(updateContext()) || !view) return;
    const selection = opener;
    clearSelection(); render(); onClose(selection);
  };
  selection.addEventListener('change', changed); el('Close').addEventListener('click', close);
  const unsubscribe = onLanguageChange(render); render();
  return Object.freeze({
    setObservation(value) {
      if (disposed) return false;
      updateContext();
      try { model = value == null ? null : createProjectAnimationTargetReview(value); }
      catch { clear(); render(); return false; }
      if (!model) clearSelection();
      else if (view) {
        const next = queryProjectAnimationTargetReview(model, view.group.key), entry = next && selected ? record(next, selected.kind, selected.sequence) : null;
        if (!next || selected && (!entry || signature(selected.kind, entry) !== selected.signature)) clearSelection(); else view = next;
      }
      render(); return Boolean(model);
    },
    selectRecord,
    refresh: render,
    dispose() {
      if (disposed) return;
      clear(); disposed = true; selection.removeEventListener('change', changed); el('Close').removeEventListener('click', close);
      if (typeof unsubscribe === 'function') unsubscribe(); container.replaceChildren();
    },
  });
}
