import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { validateRuntimeCaseReport } from '../../engine/runtime-case-report.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

// Reports are read-only receipts for a completed member of the current batch.
// The host owns execution; this view neither replays inputs nor edits a case.
export function setupRuntimeCaseReport({ container, request, getState, onChange = () => {} }) {
  container.innerHTML = `<section id="projectBuildCaseReportPanel" class="build-case-report" hidden aria-labelledby="projectBuildCaseReportTitle">
    <div class="build-actions"><h3 id="projectBuildCaseReportTitle" data-i18n="用例验收详情"></h3>
    <button id="projectBuildCaseReportClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="关闭用例详情"></button></div>
    <p class="build-hint" data-i18n="这是本批次已完成成员的只读报告。导出保留捕获的定义和采样，不会更新用例或生成新的预期。"></p>
    <p id="projectBuildCaseReportStatus" role="status" aria-live="polite"></p><p id="projectBuildCaseReportError" role="alert" hidden></p>
    <div id="projectBuildCaseReportContext" class="build-monospace"></div><ol id="projectBuildCaseReportChecks"></ol>
    <button id="projectBuildCaseReportExport" type="button" class="doc-btn" data-i18n="导出用例报告 JSON" disabled></button></section>`;
  const el = suffix => container.querySelector(`#projectBuildCaseReport${suffix}`);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const errors = {
    runtime_report_job_missing: '此批次已不是当前任务，请查看当前批次成员。',
    runtime_report_not_ready: '此用例报告尚未就绪，请等待成员完成后重试。',
    runtime_report_changed: '此用例报告已变化，请刷新状态后重新查看。',
    runtime_report_unavailable: '此用例报告不可读取，请刷新状态后重试。',
    runtime_report_io: '此用例报告不可读取，请刷新状态后重试。',
    runtime_report_invalid: '用例报告格式或评价不一致，无法显示或导出。',
    runtime_report_limit: '用例报告超出读取限制，无法显示或导出。',
    runtime_case_report_invalid: '用例报告格式或评价不一致，无法显示或导出。',
    runtime_case_report_limit: '用例报告超出读取限制，无法显示或导出。',
  };
  let selected = '', origin = null, report = null, busy = false, epoch = 0, errorKey = '';
  function member(documentId = selected) {
    const state = getState(), job = state.job;
    if (!state.available || !state.visible || job?.kind !== 'suite' || !uuid(job.id)
      || job.sceneId !== state.sceneId || job.buildId !== state.buildId || job.backendId !== state.backendId
      || !job.suite || job.suite.sceneObjectId !== state.sceneId) return null;
    const entry = job.suite.entries?.find(item => item.documentId === documentId);
    return entry?.reportAvailable === true && ['passed', 'failed', 'incomplete'].includes(entry.state)
      && ['succeeded', 'failed', 'cancelled', 'timeout'].includes(entry.executionStatus) ? entry : null;
  }
  function ownership(documentId = selected) {
    const state = getState(), entry = member(documentId); if (!entry) return null;
    const job = state.job;
    return { session: state.session, jobId: job.id, context: {
      sceneObjectId: state.sceneId, buildId: state.buildId, snapshotId: job.snapshotId, backendId: state.backendId,
      suiteDocumentId: job.suite.documentId, suiteSourceVersion: job.suite.sourceVersion,
      documentId, sourceVersion: entry.sourceVersion, sessionId: entry.sessionId,
    }, executionStatus: entry.executionStatus, evaluation: {
      status: entry.state, checkCount: entry.checkCount, passedChecks: entry.passedChecks,
      failedChecks: entry.failedChecks, unavailableChecks: entry.unavailableChecks,
    } };
  }
  const owns = () => Boolean(origin && canonicalJson(ownership()) === canonicalJson(origin));
  function clear() { selected = ''; origin = null; report = null; busy = false; errorKey = ''; epoch++; }
  function node(tag, text, className = '') { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; }
  const position = value => value ? `(${value[0]}, ${value[1]})` : t('缺少有效样本');
  const stateLabel = value => value ? t(value === 'idle' ? '静止' : '移动中') : t('未检查');
  function render() {
    if (origin && !owns()) clear();
    translatePage(container); el('Panel').hidden = !selected;
    el('Export').disabled = !report || busy || !owns();
    el('Error').hidden = !errorKey; el('Error').textContent = errorKey ? t(errorKey) : '';
    el('Context').replaceChildren(); el('Checks').replaceChildren();
    if (!selected) { el('Status').textContent = ''; return; }
    if (!report) { el('Status').textContent = busy ? t('正在读取用例报告…') : ''; return; }
    const evaluation = report.evaluation;
    el('Status').textContent = t('执行：{0} · 验收：{1} · 通过 {2} · 未通过 {3} · 无样本 {4}',
      t({ succeeded: '执行完成', failed: '执行失败', cancelled: '执行已取消', timeout: '执行超时' }[report.executionStatus]),
      t({ passed: '验收通过', failed: '验收未通过', incomplete: '验收未完成' }[evaluation.status]),
      evaluation.passedChecks, evaluation.failedChecks, evaluation.unavailableChecks);
    el('Context').append(node('p', t('冻结场景原文：{0}', report.context.sceneSourcePath)),
      node('p', t('用例标识：{0}', report.context.documentId)), node('p', t('用例原文版本：{0}', report.context.sourceVersion)),
      node('p', t('运行会话：{0}', report.context.sessionId || t('未创建运行会话'))));
    for (const check of evaluation.checks) {
      const item = node('li', '', 'build-case-check');
      item.append(node('p', t('实例 {0} · 第 {1} 步 · {2}', check.instanceId, check.stepIndex + 1,
        t({ passed: '检查通过', failed: '检查未通过', unavailable: '缺少有效样本' }[check.status]))));
      if (check.expected.position) {
        item.append(node('p', t('预期位置：{0} · 每轴容差：{1}', position(check.expected.position.value), check.expected.position.tolerance)),
          node('p', t('实际位置：{0}', position(check.actual?.position))));
      }
      if (check.expected.state) item.append(node('p', t('预期状态：{0} · 实际状态：{1}', stateLabel(check.expected.state), check.actual ? stateLabel(check.actual.state) : t('缺少有效样本'))));
      el('Checks').append(item);
    }
  }
  async function open(documentId) {
    const owner = ownership(documentId); if (!owner) return;
    const requestEpoch = ++epoch; selected = documentId; origin = owner; report = null; busy = true; errorKey = ''; render(); onChange();
    try {
      const result = await request({ action: 'suite-report', jobId: owner.jobId, documentId });
      if (epoch !== requestEpoch || !owns()) return;
      const checked = validateRuntimeCaseReport(result), { sceneSourcePath, ...context } = checked.context;
      const evaluation = Object.fromEntries(Object.keys(owner.evaluation).map(key => [key, checked.evaluation[key]]));
      if (canonicalJson(context) !== canonicalJson(owner.context) || checked.executionStatus !== owner.executionStatus
        || canonicalJson(evaluation) !== canonicalJson(owner.evaluation)) {
        throw Object.assign(new Error('Report ownership changed.'), { errorCode: 'runtime_report_changed' });
      }
      report = checked;
    } catch (error) {
      if (epoch === requestEpoch && owns()) errorKey = errors[error?.code || error?.errorCode] || '用例报告格式或评价不一致，无法显示或导出。';
    } finally { if (epoch === requestEpoch) { busy = false; render(); onChange(); } }
  }
  function download() {
    if (!report || busy || !owns()) { render(); return; }
    errorKey = ''; render();
    let url, anchor;
    try {
      const blob = new Blob([JSON.stringify(report) + '\n'], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob); anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `runtime-case-report-${report.context.documentId}.json`; document.body.append(anchor); anchor.click();
    } catch { errorKey = '用例报告导出未完成，请重试。'; render(); }
    finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  el('Export').addEventListener('click', download);
  el('Close').addEventListener('click', () => { clear(); render(); onChange(); });
  onLanguageChange(render); render();
  return { open, render, closed() { clear(); render(); } };
}
