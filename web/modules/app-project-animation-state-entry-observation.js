import { describeProjectAnimationStateEntryTrigger } from './app-project-animation-state-trigger.js';
import { validateProjectAnimationStateTriggeredEntriesSnapshot } from '../../engine/project-animation-state-entry-triggers.mjs';
import { setupProjectAnimationStateReview } from './app-project-animation-state-review.js';
import { createProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import { validateProjectAnimationStateEntriesSnapshot } from '../../engine/project-animation-state-entries.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// Accepted state entries are observations of generated scripts, not playback
// receipts or inferred transition causes. Navigation is the only outward port.
export function setupProjectAnimationStateEntryObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, setObservation() {}, selectEntry() { return false; }, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAnimationStateEntriesPanel" class="project-animation-state-entry-observation" hidden aria-labelledby="projectAnimationStateEntriesTitle">
    <h3 id="projectAnimationStateEntriesTitle"></h3><p id="projectAnimationStateEntriesNote" class="build-hint"></p>
    <p id="projectAnimationStateEntriesSequence" role="status" aria-live="polite"></p>
    <label for="projectAnimationStateEntriesSearch" id="projectAnimationStateEntriesSearchLabel"></label>
    <input id="projectAnimationStateEntriesSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <div id="projectAnimationStateReview"></div>
    <p id="projectAnimationStateEntriesEmpty" class="build-hint"></p><ol id="projectAnimationStateEntriesEntries"></ol>
    <p id="projectAnimationStateEntriesNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAnimationStateEntries' + suffix);
  const search = el('Search'), list = el('Entries'), records = new Map();
  const review = typeof setupProjectAnimationStateReview === 'function' ? setupProjectAnimationStateReview({
    container: container.querySelector('#projectAnimationStateReview'), getContext, onOpen,
    onClose: sequence => {
      if (!canUse(context())) return;
      const record = records.get(sequence);
      if (record && !record.item.hidden && list.contains(record.review)) record.review.focus(); else search.focus();
    },
  }) : { setSnapshot() { return false; }, selectEntry() { return false; }, refresh() {}, dispose() {} };
  let reviewAvailable = false;
  let disposed = false, snapshot = null, signature = '', sessionOwner = '', navigationOwner = '', wasVisible = false;
  let opening = null, generation = 0, navigationMessage = '', snapshotProtocol = 9;
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clear = () => { reviewAvailable = false; review.setSnapshot(null); invalidate(); snapshot = null; signature = ''; snapshotProtocol = 9; search.value = ''; records.clear(); list.replaceChildren(); };
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
  function sourceButton(source, role, owns) {
    const button = node('button', '', 'doc-btn doc-btn-ghost project-animation-state-entry-' + role + '-source'); button.type = 'button';
    button.addEventListener('click', async () => {
      const current = updateContext();
      if (!canUse(current) || current.canOpenSource !== true || opening || !snapshot || !owns()) return;
      const ticket = { generation, sessionOwner, navigationOwner };
      const isCurrent = () => {
        const latest = context();
        return canUse(latest) && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
          && generation === ticket.generation && opening === ticket && Boolean(snapshot) && owns();
      };
      ticket.isCurrent = isCurrent; opening = ticket; navigationMessage = ''; render();
      try {
        const result = await onOpen(source, { isCurrent });
        if (isCurrent() && result === false) navigationMessage = '无法打开动画状态进入来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开动画状态进入来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  function createRecord(entry, entrySignature) {
    const item = node('li', '', 'project-animation-state-entry');
    item.dataset.sequence = String(entry.sequence); item.dataset.visitIndex = String(entry.origin.visitIndex);
    item.dataset.bindingId = entry.origin.bindingId; item.dataset.stateKey = entry.stateKey;
    const heading = node('h4', '', 'project-animation-state-entry-accepted');
    const sequence = node('p', '', 'project-animation-state-entry-sequence'), command = node('p', '', 'project-animation-state-entry-command');
    const trigger = node('p', '', 'project-animation-state-entry-trigger');
    const clip = node('p', '', 'project-animation-state-entry-clip'), identity = node('p', '', 'project-animation-state-entry-identity');
    const binding = node('p', '', 'project-animation-state-entry-origin'), script = node('p', '', 'project-animation-state-entry-origin');
    const record = { signature: entrySignature, item, heading, sequence, command, trigger, clip, identity, binding, script };
    const owns = () => records.get(entry.sequence) === record && !item.hidden;
    record.bindingSource = sourceButton(entry.origin.source, 'binding', owns);
    record.scriptSource = sourceButton(entry.scriptSource, 'script', owns);
    record.review = node('button', '', 'doc-btn project-animation-state-entry-review'); record.review.type = 'button'; record.review.dataset.sequence = String(entry.sequence);
    record.review.addEventListener('click', () => { const current = updateContext(); if (canUse(current) && reviewAvailable && owns()) review.selectEntry(entry.sequence); });
    const actions = node('div', '', 'project-animation-state-entry-sources'); actions.append(record.review, record.bindingSource, record.scriptSource);
    item.append(heading, sequence, trigger, command, clip, identity, binding, script, actions); return record;
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    review.refresh();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('动画状态进入记录'));
    setText(el('Note'), t(snapshotProtocol === 10
      ? '记录脚本每次接受进入状态及当时的回调来源。重复记录独立保留；不包含分支命中或条件求值过程，也不表示动画命令已经执行。强制取消可能留下不完整记录。'
      : '记录脚本每次接受进入状态，包括初始进入和同状态重启；重复记录独立保留。不推测触发原因，也不表示动画命令已经执行。强制取消可能留下不完整记录。'));
    setText(el('SearchLabel'), t('按场景、行为绑定、脚本或状态筛选'));
    setText(el('Navigation'), opening ? t('正在打开动画状态进入来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Sequence'), ''); delete el('Sequence').dataset.sequence; setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), next = [];
    let shown = 0;
    for (const entry of snapshot.entries) {
      const entrySignature = JSON.stringify(entry);
      let record = records.get(entry.sequence);
      if (!record || record.signature !== entrySignature) { record = createRecord(entry, entrySignature); records.set(entry.sequence, record); }
      record.item.hidden = ![entry.origin.sceneId, entry.origin.bindingId, entry.scriptSource.objectId,
        entry.scriptSource.sourcePath, entry.stateKey].some(value => value.toLowerCase().includes(query));
      if (!record.item.hidden) shown++;
      setText(record.heading, t('脚本接受进入状态：{0}', entry.stateKey));
      setText(record.sequence, t('进入记录 {0} · 第 {1} 次访问 · 场景 {2} · 场景时间 {3} 秒', entry.sequence, entry.origin.visitIndex, entry.origin.sceneId, entry.timeSeconds));
      setText(record.trigger, describeProjectAnimationStateEntryTrigger(entry, t));
      record.trigger.dataset.kind = entry.trigger?.kind || 'unrecorded';
      setText(record.command, t('进入时已执行动画命令序号：{0}', entry.commandSequence));
      setText(record.clip, entry.clipId ? t('状态选择的片段：{0}', entry.clipId) : t('状态选择：完整动画'));
      setText(record.identity, t('行为绑定 {0} · 实例 {1} · 对象 {2}', entry.origin.bindingId, entry.origin.instanceId, entry.origin.objectId));
      setText(record.binding, t('绑定来源：{0} · {1}', entry.origin.source.sourcePath, entry.origin.source.propertyPath));
      setText(record.script, t('脚本来源：{0}', entry.scriptSource.sourcePath));
      setText(record.review, t('回看此控制器')); record.review.hidden = !reviewAvailable; record.review.disabled = !canUse(current);
      setText(record.bindingSource, t('打开行为绑定')); setText(record.scriptSource, t('打开状态脚本'));
      for (const button of [record.bindingSource, record.scriptSource]) button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
      next.push(record.item);
    }
    for (const sequence of records.keys()) if (!snapshot.entries.some(entry => entry.sequence === sequence)) records.delete(sequence);
    children(list, next);
    setText(el('Sequence'), t('进入序号 {0} · 显示 {1} / {2} 条记录', snapshot.sequence, shown, snapshot.entries.length));
    el('Sequence').dataset.sequence = String(snapshot.sequence);
    el('Empty').hidden = shown > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的动画状态进入记录。' : '尚未采集动画状态进入记录。'));
    if (opening && !opening.isCurrent()) { invalidate(); render(); }
  }
  const changed = () => { invalidate(); render(); };
  search.addEventListener('input', changed);
  const unsubscribe = onLanguageChange(render);
  render();
  function applySnapshot(value, { protocolVersion = 9 } = {}, observation = null) {
      if (disposed) return;
      updateContext();
      let admitted;
      try {
        if (![9, 10].includes(protocolVersion)) throw new TypeError('Unsupported animation state entry observation.');
        admitted = value == null ? null : protocolVersion === 10
          ? validateProjectAnimationStateTriggeredEntriesSnapshot(value) : validateProjectAnimationStateEntriesSnapshot(value);
        if (snapshotProtocol !== protocolVersion) { clear(); snapshotProtocol = protocolVersion; }
      } catch { clear(); render(); return; }
      const next = admitted == null ? '' : JSON.stringify(admitted);
      if (next !== signature) {
        signature = next; snapshot = next ? JSON.parse(next) : null;
        if (!snapshot) { invalidate(); records.clear(); list.replaceChildren(); }
      }
      reviewAvailable = review.setSnapshot(observation) === true;
      render();
  }
  return Object.freeze({
    setSnapshot: applySnapshot,
    setObservation(value) {
      let entries;
      try { entries = value == null ? null : createProjectAnimationStateReview(value).entries; }
      catch { clear(); render(); return; }
      applySnapshot(entries && { sequence: entries.length, entries }, { protocolVersion: value?.project?.protocolVersion ?? 9 }, value);
    },
    selectEntry(sequence) {
      const current = updateContext();
      return canUse(current) && reviewAvailable && Boolean(snapshot) ? review.selectEntry(sequence) === true : false;
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true; clear(); review.dispose(); search.removeEventListener('input', changed);
      if (typeof unsubscribe === 'function') unsubscribe();
      container.replaceChildren();
    },
  });
}
