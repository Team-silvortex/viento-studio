import { t, onLanguageChange } from '../i18n/index.js';

// The host supplies an admitted, bounded shared-state snapshot. This view owns
// filtering and source-link tickets only; it cannot read or mutate game state.
export function setupProjectStateObservation({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  if (!container) return Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  const document = container.ownerDocument;
  container.innerHTML = `<section id="projectSharedStatePanel" class="project-state-observation" hidden aria-labelledby="projectSharedStateTitle">
    <h3 id="projectSharedStateTitle"></h3><p id="projectSharedStateNote" class="build-hint"></p>
    <p id="projectSharedStateRevision" role="status" aria-live="polite"></p>
    <label for="projectSharedStateSearch" id="projectSharedStateSearchLabel"></label>
    <input id="projectSharedStateSearch" type="search" maxlength="256" autocomplete="off" spellcheck="false">
    <p id="projectSharedStateEmpty" class="build-hint"></p><ul id="projectSharedStateEntries"></ul>
    <section id="projectSharedStateLastChange" aria-labelledby="projectSharedStateLastChangeTitle">
      <h4 id="projectSharedStateLastChangeTitle"></h4><div id="projectSharedStateLastChangeBody"></div></section>
    <p id="projectSharedStateNavigation" role="status" aria-live="polite" hidden></p></section>`;
  const el = suffix => container.querySelector('#projectSharedState' + suffix);
  const search = el('Search'), list = el('Entries'), records = new Map();
  let disposed = false, snapshot = null, signature = '', sessionOwner = '', navigationOwner = '', wasVisible = false;
  let opening = null, generation = 0, navigationMessage = '', lastRecord = null;
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const canUse = current => !disposed && current.available === true && current.visible === true
    && typeof current.sessionOwner === 'string' && Boolean(current.sessionOwner)
    && typeof current.navigationOwner === 'string' && Boolean(current.navigationOwner) && container.isConnected !== false;
  const invalidate = () => { generation++; opening = null; navigationMessage = ''; };
  const clear = () => { invalidate(); snapshot = null; signature = ''; search.value = ''; records.clear(); lastRecord = null; list.replaceChildren(); el('LastChangeBody').replaceChildren(); };
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
  function createRecord(value, last = false) {
    const item = node(last ? 'div' : 'li', '', 'project-state-record'); item.dataset.key = value.key; item.dataset.revision = String(value.revision);
    const heading = node('h4'), key = node('code', value.key); heading.append(key); item.append(heading);
    const content = last ? null : node('pre', JSON.stringify(value.value), 'project-state-value');
    if (content) { content.tabIndex = 0; item.append(content); }
    const revision = node('p', '', 'project-state-revision'), origin = node('p', '', 'project-state-origin');
    const source = node('button', '', 'doc-btn doc-btn-ghost project-state-source'); source.type = 'button';
    item.append(revision, origin, source);
    const record = { value, signature: JSON.stringify(value), item, revision, origin, source, last };
    source.addEventListener('click', async () => {
      const current = updateContext();
      const currentRecord = () => last ? lastRecord : records.get(value.key);
      if (!canUse(current) || current.canOpenSource !== true || opening || !snapshot || currentRecord() !== record || item.hidden) return;
      const ticket = { generation, sessionOwner, navigationOwner, revision: snapshot.revision, record };
      const isCurrent = () => {
        const latest = context();
        return canUse(latest) && latest.sessionOwner === ticket.sessionOwner && latest.navigationOwner === ticket.navigationOwner
          && generation === ticket.generation && opening === ticket && snapshot?.revision === ticket.revision
          && currentRecord() === record && !item.hidden;
      };
      opening = ticket; navigationMessage = ''; render();
      try {
        const result = await onOpen(value.origin, { isCurrent });
        if (isCurrent() && result === false) navigationMessage = '无法打开状态来源，请返回编辑器查找该文档。';
      } catch { if (isCurrent()) navigationMessage = '无法打开状态来源，请返回编辑器查找该文档。'; }
      finally { if (opening === ticket) { opening = null; render(); } }
    });
    return record;
  }
  function updateRecord(record, current) {
    const value = record.value;
    setText(record.revision, record.last ? t(value.operation === 'delete' ? '删除键 · 修订 {0}' : '写入键 · 修订 {0}', value.revision) : t('键修订：{0}', value.revision));
    setText(record.origin, t('最后来源：第 {0} 次访问 · {1}', value.origin.visitIndex, value.origin.source.sourcePath));
    setText(record.source, t('打开状态来源'));
    record.source.disabled = !canUse(current) || current.canOpenSource !== true || Boolean(opening);
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    el('Panel').hidden = !canUse(current) || !snapshot;
    setText(el('Title'), t('会话共享状态'));
    setText(el('Note'), t('只读查看本次项目运行的共享状态。切换场景时保留，重新运行后清空；此处不会修改游戏状态。'));
    setText(el('SearchLabel'), t('按状态键筛选'));
    setText(el('LastChangeTitle'), t('最后一次状态修改'));
    setText(el('Navigation'), opening ? t('正在打开状态来源…') : navigationMessage ? t(navigationMessage) : '');
    el('Navigation').hidden = !opening && !navigationMessage;
    search.disabled = !canUse(current) || !snapshot;
    if (!snapshot) { setText(el('Revision'), ''); setText(el('Empty'), ''); return; }
    const query = search.value.trim().toLowerCase(), active = snapshot.entries.filter(entry => entry.key.toLowerCase().includes(query));
    setText(el('Revision'), t('状态修订 {0} · 显示 {1} / {2} 个键', snapshot.revision, active.length, snapshot.entries.length));
    el('Revision').dataset.revision = String(snapshot.revision);
    el('Empty').hidden = active.length > 0;
    setText(el('Empty'), t(snapshot.entries.length ? '没有匹配的状态键。' : '当前没有共享状态键。'));
    const visible = new Set(active.map(entry => entry.key)), next = [];
    for (const entry of snapshot.entries) {
      let record = records.get(entry.key);
      if (!record || record.signature !== JSON.stringify(entry)) { record = createRecord(entry); records.set(entry.key, record); }
      record.item.hidden = !visible.has(entry.key); updateRecord(record, current); next.push(record.item);
    }
    for (const key of records.keys()) if (!snapshot.entries.some(entry => entry.key === key)) records.delete(key);
    if (next.length !== list.children.length || next.some((item, index) => item !== list.children[index])) list.replaceChildren(...next);
    const change = snapshot.lastChange;
    el('LastChange').hidden = !change;
    if (change) {
      if (!lastRecord || lastRecord.signature !== JSON.stringify(change)) {
        lastRecord = createRecord(change, true); el('LastChangeBody').replaceChildren(lastRecord.item);
      }
      updateRecord(lastRecord, current);
    } else { lastRecord = null; el('LastChangeBody').replaceChildren(); }
  }
  const changed = () => { invalidate(); render(); };
  search.addEventListener('input', changed);
  const unsubscribe = onLanguageChange(render);
  render();
  return Object.freeze({
    setSnapshot(value) {
      if (disposed) return;
      updateContext();
      // Detach an already-admitted snapshot so later host polling cannot alter
      // a displayed row or its source ticket in place. No rules are re-parsed.
      const next = value == null ? '' : JSON.stringify(value);
      if (next !== signature) {
        invalidate(); signature = next; snapshot = next ? JSON.parse(next) : null;
        if (!snapshot) { records.clear(); lastRecord = null; list.replaceChildren(); el('LastChangeBody').replaceChildren(); }
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
