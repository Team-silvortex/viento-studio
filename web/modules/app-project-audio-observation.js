import { t, onLanguageChange } from '../i18n/index.js';

// Only executed commands from an admitted observation reach this view. There
// is no control port and no inference of current playback or audible output.
export function setupProjectAudioObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectAudioCommandsPanel" class="project-audio-observation" hidden aria-labelledby="projectAudioCommandsTitle">
    <h3 id="projectAudioCommandsTitle"></h3><p id="projectAudioCommandsNote" class="build-hint"></p>
    <p id="projectAudioCommandsSequence" role="status" aria-live="polite"></p>
    <label for="projectAudioCommandsSearch" id="projectAudioCommandsSearchLabel"></label>
    <input id="projectAudioCommandsSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <p id="projectAudioCommandsEmpty" class="build-hint"></p><ol id="projectAudioCommandsEntries"></ol>
    <p id="projectAudioCommandsNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectAudioCommands' + suffix);
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
  function sourceButton(record, source, kind) {
    const button = node('button', '', 'doc-btn doc-btn-ghost project-audio-' + kind + '-source'); button.type = 'button';
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
        if (isCurrent() && result === false) navigationMessage = '无法打开声音控制来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开声音控制来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return button;
  }
  function createRecord(entry) {
    const item = node('li', '', 'project-audio-command');
    item.dataset.sequence = String(entry.sequence); item.dataset.action = entry.action; item.dataset.trackId = entry.track.trackId;
    const heading = node('h4'), sequence = node('p', '', 'project-audio-sequence'), track = node('p', '', 'project-audio-identity');
    const origin = node('p', '', 'project-audio-origin'), declaration = node('p', '', 'project-audio-origin');
    const record = { entry, signature: JSON.stringify(entry), item, heading, sequence, track, origin, declaration };
    record.behaviorSource = sourceButton(record, entry.origin.source, 'behavior');
    record.trackSource = sourceButton(record, entry.track.source, 'track');
    const actions = node('div', '', 'project-audio-sources'); actions.append(record.behaviorSource, record.trackSource);
    item.append(heading, sequence, track, origin, declaration, actions); return record;
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('声音控制记录'));
    setText(el('Note'), t('只读显示实际执行的声音命令，不代表当前播放状态或可听见的声音。切换场景时保留记录，重新运行后清空。'));
    setText(el('SearchLabel'), t('按音轨或资源标识筛选'));
    setText(el('Navigation'), opening ? t('正在打开声音控制来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Sequence'), ''); delete el('Sequence').dataset.sequence; setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), active = snapshot.entries.filter(entry => [entry.track.trackId, entry.track.resourceId].some(value => value.toLowerCase().includes(query)));
    setText(el('Sequence'), t('命令序号 {0} · 显示 {1} / {2} 条声音命令', snapshot.sequence, active.length, snapshot.entries.length));
    el('Sequence').dataset.sequence = String(snapshot.sequence);
    el('Empty').hidden = active.length > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的声音命令。' : '当前没有已执行的声音命令。'));
    const visible = new Set(active.map(entry => entry.sequence)), next = [];
    for (const entry of snapshot.entries) {
      let record = records.get(entry.sequence);
      if (!record || record.signature !== JSON.stringify(entry)) { record = createRecord(entry); records.set(entry.sequence, record); }
      record.item.hidden = !visible.has(entry.sequence);
      setText(record.heading, t(entry.action === 'play' ? '已执行播放命令' : '已执行停止命令'));
      setText(record.sequence, t('序号 {0} · 第 {1} 次访问 · 场景时间 {2} 秒', entry.sequence, entry.origin.visitIndex, entry.timeSeconds));
      setText(record.track, t('轨道 {0} · 资源 {1}', entry.track.trackId, entry.track.resourceId));
      setText(record.origin, t('控制来源：{0} · {1}', entry.origin.source.sourcePath, entry.origin.source.propertyPath));
      setText(record.declaration, t('音轨声明：{0} · {1}', entry.track.source.sourcePath, entry.track.source.propertyPath));
      setText(record.behaviorSource, t('打开控制来源')); setText(record.trackSource, t('打开音轨声明'));
      for (const button of [record.behaviorSource, record.trackSource]) button.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
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
    setSnapshot(value) {
      if (disposed) return;
      updateContext();
      // The core admitted this data; detaching prevents future host mutations
      // from redirecting a visible source action without a new snapshot.
      const next = value == null ? '' : JSON.stringify(value);
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
