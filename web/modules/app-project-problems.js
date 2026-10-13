import { filterProjectProblems } from '../../engine/project-problems.mjs';
import { t, onLanguageChange } from '../i18n/index.js';

const problemSeverities = { all: '全部级别', error: '错误', warning: '警告', info: '信息' };
const problemKinds = { plan: '检查计划', build: '构建场景', run: '运行场景', suite: '批量运行验收' };
const problemStatuses = { running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时' };

// This view owns filters and disclosure state only. The host supplies a bounded
// immutable snapshot and owns source navigation, including unsaved draft guards.
export function setupProjectProblems({ container, getContext = () => ({}), onOpen = async () => false } = {}) {
  const noop = Object.freeze({ setSnapshot() {}, refresh() {}, dispose() {} });
  if (!container) return noop;
  const document = container.ownerDocument;
  const title = container.querySelector('#projectBuildDiagnosticsTitle');
  const list = container.querySelector('#projectBuildDiagnostics');
  if (!title || !list) return noop;
  if (!document.getElementById('projectProblemsStyle')) {
    const style = document.createElement('link');
    style.id = 'projectProblemsStyle'; style.rel = 'stylesheet'; style.href = '/web/project-problems.css';
    (document.head || document.body).append(style);
  }
  container.classList.add('project-problems');
  title.setAttribute('data-i18n', '当前任务问题');
  const node = (tag, id, className = '') => {
    const result = document.createElement(tag);
    if (id) result.id = id;
    if (className) result.className = className;
    return result;
  };
  const controls = node('div', 'projectBuildProblemsFilters', 'project-problems-filters');
  controls.innerHTML = '<label for="projectBuildProblemsSeverity" id="projectBuildProblemsSeverityLabel"></label><select id="projectBuildProblemsSeverity"><option value="all"></option><option value="error"></option><option value="warning"></option><option value="info"></option></select><label for="projectBuildProblemsSearch" id="projectBuildProblemsSearchLabel"></label><input id="projectBuildProblemsSearch" type="search" maxlength="512" autocomplete="off" spellcheck="false">';
  const el = suffix => controls.querySelector('#projectBuildProblems' + suffix);
  const search = el('Search'), severity = el('Severity');
  const task = node('div', 'projectBuildProblemsTask', 'project-problems-task');
  const taskLabel = node('p'), taskDetails = node('details', '', 'project-problem-details');
  const taskDisclosure = node('summary'), taskRaw = node('pre'); taskRaw.tabIndex = 0;
  taskDetails.append(taskDisclosure, taskRaw); task.append(taskLabel, taskDetails);
  const summary = node('p', 'projectBuildProblemsSummary', 'project-problems-summary');
  summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const empty = node('p', 'projectBuildProblemsEmpty', 'build-hint');
  const navigationStatus = node('p', 'projectBuildProblemsNavigationStatus');
  navigationStatus.setAttribute('role', 'status'); navigationStatus.setAttribute('aria-live', 'polite');
  container.replaceChildren(title, task, controls, summary, empty, navigationStatus, list);
  let disposed = false, snapshot = null, signature = '', invalid = false, ownerToken;
  let generation = 0, opening = null, navigationMessage = '', wasAvailable = false, backendLabel = '', sceneLabel = '';
  const records = new Map();
  const context = () => { try { return getContext() || {}; } catch { return {}; } };
  const invalidateNavigation = () => { generation++; opening = null; navigationMessage = ''; };
  const reset = () => {
    invalidateNavigation(); snapshot = null; signature = ''; invalid = false;
    search.value = ''; severity.value = 'all'; taskDetails.open = false; records.clear(); list.replaceChildren();
  };
  const updateContext = () => {
    const current = context();
    if (current.token !== ownerToken) { ownerToken = current.token; reset(); }
    if (wasAvailable && !current.available) invalidateNavigation();
    wasAvailable = Boolean(current.available);
    return current;
  };
  const canUse = current => !disposed && current.available === true && typeof current.token === 'string'
    && current.token.length > 0 && container.isConnected !== false;
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  function createRow(row) {
    const item = node('li', '', 'build-diagnostic project-problem');
    item.dataset.index = String(row.index); item.dataset.code = row.code; item.dataset.severity = row.severity;
    const heading = node('p', '', 'project-problem-heading');
    const level = node('span', '', 'project-problem-severity');
    const code = node('code'); code.textContent = row.code; heading.append(level, code);
    const message = node('p', '', 'project-problem-message'); item.append(heading, message);
    let button = null;
    if (row.sourcePath) {
      button = node('button', '', 'doc-btn doc-btn-ghost project-problem-source'); button.type = 'button'; item.append(button);
    }
    const details = node('details', '', 'project-problem-details'), disclosure = node('summary'), raw = node('pre');
    raw.tabIndex = 0; raw.textContent = JSON.stringify(row, null, 2); details.append(disclosure, raw); item.append(details);
    const record = { row, key: JSON.stringify(row), item, level, message, button, disclosure };
    if (button) button.addEventListener('click', async () => {
      const current = updateContext();
      if (!canUse(current) || opening || !snapshot || records.get(row.index) !== record || item.hidden || !list.contains(button)) return;
      const ticket = { generation, token: ownerToken, record };
      const isCurrent = () => {
        const latest = context();
        return canUse(latest) && latest.token === ticket.token && generation === ticket.generation
          && opening === ticket && records.get(row.index) === record && !item.hidden && list.contains(button);
      };
      opening = ticket; navigationMessage = ''; render();
      try {
        const result = await onOpen(row, { isCurrent });
        if (isCurrent() && result === false) navigationMessage = '无法打开原文，请返回编辑器查找该文档。';
      } catch {
        if (isCurrent()) navigationMessage = '无法打开原文，请返回编辑器查找该文档。';
      } finally {
        if (opening === ticket) { opening = null; render(); }
      }
    });
    return record;
  }
  function render() {
    if (disposed) return;
    const current = updateContext();
    setText(title, t('当前任务问题'));
    setText(el('SeverityLabel'), t('问题级别')); setText(el('SearchLabel'), t('筛选当前任务问题'));
    for (const option of severity.children) setText(option, t(problemSeverities[option.value]));
    search.setAttribute('placeholder', t('按说明、错误码或原文位置查找'));
    search.disabled = severity.disabled = !canUse(current) || !snapshot || invalid;
    let view = null;
    if (snapshot && !invalid) {
      try {
        view = filterProjectProblems(snapshot, { severity: severity.value, query: search.value,
          messages: snapshot.rows.map(row => t(row.messageKey)) });
      } catch { invalid = true; invalidateNavigation(); records.clear(); list.replaceChildren(); }
    }
    container.dataset.invalid = String(invalid);
    task.hidden = !snapshot || invalid;
    if (snapshot && !invalid) {
      const value = snapshot.task;
      setText(taskLabel, t('当前任务：{0} · {1}\n后端：{2}\n场景：{3}',
        t(problemKinds[value.kind] || value.kind), t(problemStatuses[value.status] || value.status), backendLabel || value.backendId,
        sceneLabel || t(value.sceneId ? '未提供场景名称' : '未关联场景')));
      setText(taskDisclosure, t('任务身份详情')); setText(taskRaw, JSON.stringify(value, null, 2));
    } else { setText(taskLabel, ''); setText(taskRaw, ''); }
    summary.hidden = !view;
    setText(summary, view ? t('显示 {0} / {1} 条 · 错误 {2} · 警告 {3} · 信息 {4}', view.matched, view.total,
      view.counts.error, view.counts.warning, view.counts.info) : '');
    summary.dataset.total = String(view?.total || 0); summary.dataset.matched = String(view?.matched || 0);
    empty.hidden = Boolean(view?.matched);
    setText(empty, t(invalid ? '无法读取当前任务的问题列表，请刷新任务状态。' : !snapshot
      ? '尚无任务问题。请先检查计划、构建或运行。' : !view?.total
        ? '当前任务没有报告问题。这不代表已完成全部验证。' : '没有符合当前筛选条件的问题。'));
    setText(navigationStatus, opening ? t('正在打开问题原文…') : navigationMessage ? t(navigationMessage) : '');
    navigationStatus.hidden = !opening && !navigationMessage;
    if (!view) { search.disabled = severity.disabled = true; return; }
    const active = new Set(view.rows.map(row => row.index));
    const next = [];
    for (const row of snapshot.rows) {
      let record = records.get(row.index);
      const key = JSON.stringify(row);
      if (!record || record.key !== key) { record = createRow(row); records.set(row.index, record); }
      record.item.hidden = !active.has(row.index);
      setText(record.level, t(problemSeverities[row.severity])); setText(record.message, t(row.messageKey));
      setText(record.disclosure, t('问题定位详情'));
      if (record.button) {
        setText(record.button, `${t('打开原文')} · ${row.sourcePath}${row.propertyPath || ''}`);
        record.button.disabled = !canUse(current) || Boolean(opening);
      }
      next.push(record.item);
    }
    for (const index of records.keys()) if (!snapshot.rows.some(row => row.index === index)) records.delete(index);
    if (next.length !== list.children.length || next.some((item, index) => item !== list.children[index])) list.replaceChildren(...next);
  }
  const changed = () => { invalidateNavigation(); render(); };
  search.addEventListener('input', changed); severity.addEventListener('change', changed);
  const unsubscribe = onLanguageChange(render);
  render();
  return Object.freeze({
    setSnapshot(value, options = {}) {
      if (disposed) return;
      updateContext();
      const displayLabel = value => typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
      backendLabel = displayLabel(options.backendLabel); sceneLabel = displayLabel(options.sceneLabel);
      const nextInvalid = options.invalid === true;
      let nextSignature;
      try { nextSignature = value ? JSON.stringify(value) : ''; } catch { value = null; nextSignature = ''; options = { invalid: true }; }
      if (nextSignature !== signature || nextInvalid !== invalid || options.invalid === true) {
        const oldTask = snapshot ? JSON.stringify(snapshot.task && { id: snapshot.task.id, kind: snapshot.task.kind,
          backendId: snapshot.task.backendId, sceneId: snapshot.task.sceneId }) : '';
        const newTask = value ? JSON.stringify(value.task && { id: value.task.id, kind: value.task.kind,
          backendId: value.task.backendId, sceneId: value.task.sceneId }) : '';
        if (oldTask !== newTask) reset(); else invalidateNavigation();
        snapshot = value; signature = nextSignature; invalid = options.invalid === true;
      }
      render();
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true; invalidateNavigation(); records.clear();
      search.removeEventListener('input', changed); severity.removeEventListener('change', changed);
      if (typeof unsubscribe === 'function') unsubscribe();
      container.replaceChildren(title, list); list.replaceChildren(); container.classList.remove('project-problems');
    },
  });
}
