import { validateProjectAnimationCommandsSnapshot } from '../../engine/project-animation-commands.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

// Executed animation receipts remain a read-only view with source-navigation
// ports only. The runtime owns time, playback and scene lifetime.
export function setupProjectAnimationObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAnimationCommandsPanel" class="project-animation-observation" hidden aria-labelledby="projectAnimationCommandsTitle">
    <h3 id="projectAnimationCommandsTitle"></h3><p id="projectAnimationCommandsNote" class="build-hint"></p>
    <p id="projectAnimationCommandsSequence" role="status" aria-live="polite"></p>
    <label for="projectAnimationCommandsSearch" id="projectAnimationCommandsSearchLabel"></label>
    <input id="projectAnimationCommandsSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <p id="projectAnimationCommandsEmpty" class="build-hint"></p><ol id="projectAnimationCommandsEntries"></ol>
    <p id="projectAnimationCommandsNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAnimationCommands' + suffix);
  const search = el('Search'), list = el('Entries'), records = new Map();
  let disposed = false, snapshot = null, signature = '', sessionOwner = '', navigationOwner = '', wasVisible = false;
  let opening = null, generation = 0, navigationMessage = '', protocolVersion = 5;
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
  function sourceButton(record, source, kind) {
    const button = node('button', '', 'doc-btn doc-btn-ghost project-animation-' + kind + '-source'); button.type = 'button';
    const currentRecord = () => records.get(record.entry.sequence) === record && !record.item.hidden;
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
        if (isCurrent() && result === false) navigationMessage = '无法打开动画控制来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开动画控制来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  function createRecord(entry) {
    const item = node('li', '', 'project-animation-command');
    item.dataset.sequence = String(entry.sequence); item.dataset.action = entry.command.action; item.dataset.animationId = entry.animation.objectId;
    const heading = node('h4'), sequence = node('p', '', 'project-animation-sequence'), animation = node('p', '', 'project-animation-identity'), state = node('p', '', 'project-animation-state');
    const origin = node('p', '', 'project-animation-origin'), declaration = node('p', '', 'project-animation-origin');
    const clip = node('p', '', 'project-animation-clip');
    const record = { entry, signature: JSON.stringify(entry), item, heading, sequence, animation, state, origin, declaration, clip };
    record.behaviorSource = sourceButton(record, entry.origin.source, 'behavior');
    record.animationSource = sourceButton(record, entry.animation.source, 'animation');
    const actions = node('div', '', 'project-animation-sources'); actions.append(record.behaviorSource, record.animationSource);
    if (entry.clip) { record.clipSource = sourceButton(record, entry.clip.source, 'clip'); actions.append(record.clipSource); }
    item.append(heading, sequence, animation, state, clip, origin, declaration, actions); return record;
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('动画控制记录'));
    setText(el('Note'), t('只读显示动画命令执行时的状态和播放头，不代表当前画面。切换场景时保留记录，重新运行后清空。'));
    setText(el('SearchLabel'), t(protocolVersion === 6 ? '按场景、动画或片段筛选' : '按场景或动画标识筛选'));
    setText(el('Navigation'), opening ? t('正在打开动画控制来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Sequence'), ''); delete el('Sequence').dataset.sequence; setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), active = snapshot.entries.filter(entry => [entry.origin.sceneId, entry.animation.objectId, entry.clip?.id || '', entry.clip?.name || ''].some(value => value.toLowerCase().includes(query)));
    setText(el('Sequence'), t('命令序号 {0} · 显示 {1} / {2} 条动画命令', snapshot.sequence, active.length, snapshot.entries.length));
    el('Sequence').dataset.sequence = String(snapshot.sequence);
    el('Empty').hidden = active.length > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的动画命令。' : '当前没有已执行的动画命令。'));
    const visible = new Set(active.map(entry => entry.sequence)), next = [];
    for (const entry of snapshot.entries) {
      let record = records.get(entry.sequence);
      if (!record || record.signature !== JSON.stringify(entry)) { record = createRecord(entry); records.set(entry.sequence, record); }
      record.item.hidden = !visible.has(entry.sequence);
      setText(record.heading, t({ play: '已执行播放命令', pause: '已执行暂停命令', stop: '已执行停止命令', seek: '已执行跳转命令', select: '已执行选择片段命令' }[entry.command.action]));
      setText(record.sequence, t('序号 {0} · 第 {1} 次访问 · 场景时间 {2} 秒', entry.sequence, entry.origin.visitIndex, entry.state.timeSeconds));
      setText(record.animation, t('场景 {0} · 动画 {1}', entry.origin.sceneId, entry.animation.objectId));
      const phase = t({ playing: '播放', paused: '暂停', stopped: '停止', finished: '结束' }[entry.state.phase]);
      setText(record.state, t('执行后状态：{0} · 播放头 {1} 秒', phase, entry.state.positionSeconds));
      record.clip.hidden = protocolVersion !== 6;
      setText(record.clip, entry.clip ? t('片段：{0} · {1} · 原时间轴 {2}–{3} 秒', entry.clip.name, entry.clip.id, entry.clip.startSeconds, entry.clip.endSeconds) : t('完整动画'));
      if (record.clipSource) setText(record.clipSource, t('打开动画片段声明'));
      setText(record.origin, t('控制来源：{0} · {1}', entry.origin.source.sourcePath, entry.origin.source.propertyPath));
      setText(record.declaration, t('动画声明：{0} · {1}', entry.animation.source.sourcePath, entry.animation.source.propertyPath));
      setText(record.behaviorSource, t('打开控制来源')); setText(record.animationSource, t('打开动画声明'));
      for (const button of [record.behaviorSource, record.animationSource, record.clipSource].filter(Boolean)) button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
      next.push(record.item);
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
    setSnapshot(value, options = {}) {
      if (disposed) return;
      updateContext();
      // Admission also detaches data before serialization, so accessors or
      // malformed receipts cannot redirect an existing source action.
      let admitted;
      try {
        const nextProtocol = options.protocolVersion ?? 5;
        if (![5, 6].includes(nextProtocol)) throw new TypeError('Unsupported animation observation.');
        admitted = value == null ? null : validateProjectAnimationCommandsSnapshot(value, { protocolVersion: nextProtocol });
        if (protocolVersion !== nextProtocol) { clear(); protocolVersion = nextProtocol; }
      }
      catch { clear(); render(); return; }
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
