import { setupAnimationStateTrialCaseEditor } from './app-animation-state-trial-case-editor.js';
import { createAnimationStateTrialCase, parseAnimationStateTrialCase, serializeAnimationStateTrialCase, replayAnimationStateTrialCase, ANIMATION_STATE_TRIAL_CASE_LIMITS } from '../../engine/animation-state-trial-case.mjs';

// File cases and replay reports are local authoring samples. They never replace
// the live manual path, alter source, publish events or execute a runtime.
export function setupAnimationStateTrialCase({ container, idPrefix = 'animationStateTrialCase', getTable, getContext = () => ({}), getSequence = () => null, translate = value => value } = {}) {
  const document = container.ownerDocument;
  if (!document.getElementById('animationStateTrialCaseStyle')) {
    const link = document.createElement('link'); link.id = 'animationStateTrialCaseStyle'; link.rel = 'stylesheet'; link.href = '/web/animation-state-trial-case.css'; (document.head || document.body).append(link);
  }
  container.innerHTML = `<section class="animation-state-trial-case" aria-labelledby="${idPrefix}Title">
    <h4 id="${idPrefix}Title"></h4><p id="${idPrefix}Note" class="script-create-note"></p>
    <div class="animation-state-trial-case-actions"><button id="${idPrefix}Export" type="button" class="doc-btn doc-btn-ghost"></button><button id="${idPrefix}Create" type="button" class="doc-btn doc-btn-ghost"></button><button id="${idPrefix}Import" type="button" class="doc-btn doc-btn-ghost"></button><input id="${idPrefix}File" type="file" accept=".json,application/json" hidden></div>
    <p id="${idPrefix}Status" role="status" aria-live="polite"></p><p id="${idPrefix}Error" role="alert" hidden></p>
    <div id="${idPrefix}Loaded" hidden><p id="${idPrefix}LoadedSummary"></p><div class="animation-state-trial-case-actions"><button id="${idPrefix}Edit" type="button" class="doc-btn doc-btn-ghost"></button><button id="${idPrefix}ExportLoaded" type="button" class="doc-btn doc-btn-ghost"></button><button id="${idPrefix}Run" type="button" class="doc-btn"></button><button id="${idPrefix}Clear" type="button" class="doc-btn doc-btn-ghost"></button></div></div>
    <div id="${idPrefix}EditorHost"></div>
    <section id="${idPrefix}Result" hidden aria-labelledby="${idPrefix}ResultTitle"><h4 id="${idPrefix}ResultTitle"></h4><p id="${idPrefix}ResultSummary"></p><ol id="${idPrefix}Steps"></ol></section>
    </section>`;
  const el = suffix => container.querySelector('#' + idPrefix + suffix), text = (key, ...args) => translate(key, ...args);
  let disposed = false, readEpoch = 0, chooser = null, busy = false, loaded = null, fileName = '', report = null, owner = null, views = [], error = '', notice = '';
  let editor = null, editorOwner = null;
  const context = () => getContext(), session = value => value.active === true, visible = value => value.visible !== false;
  const localEnabled = value => !disposed && session(value) && visible(value) && value.disabled !== true;
  const enabled = value => localEnabled(value) && value.available !== false;
  function node(tag, className = '') { const item = document.createElement(tag); item.className = className; return item; }
  function revokeRead() { readEpoch++; chooser = null; busy = false; }
  function clearReport(changed = false) { report = null; owner = null; views = []; el('Steps').replaceChildren(); el('Result').hidden = true; if (changed && loaded) notice = '状态表已变化，旧回放结果已清除；载入用例仍保留，请明确重跑。'; }
  function clear() { editorOwner = null; editor?.reset(); revokeRead(); loaded = null; fileName = ''; clearReport(); error = ''; notice = ''; el('File').value = ''; }
  function readCurrent(ticket) {
    if (!ticket || ticket.revoked) return false;
    const value = context();
    if (editor?.isOpen() || !enabled(value) || ticket.epoch !== readEpoch || ticket.generation !== value.generation) { ticket.revoked = true; return false; }
    return true;
  }
  function reportCurrent() {
    if (!report || !owner || owner.case !== loaded) return false;
    const value = context();
    if (!enabled(value) || value.generation !== owner.generation) return false;
    try { return JSON.stringify(getTable()) === owner.signature; } catch { return false; }
  }
  function sequence() { try { return enabled(context()) ? getSequence() : null; } catch { return null; } }
  function scalar(value) { return text('{0}：{1}', text(typeof value === 'number' ? '数字（number）' : typeof value === 'boolean' ? '布尔值（boolean）' : '字符串（string）'), JSON.stringify(value)); }
  function trigger(input) { return input.kind === 'event' ? text('事件样本：{0} · {1}', input.event.name, scalar(input.event.value)) : text('假设当前动画完成通知已送达。'); }
  function buildViews() {
    views = report.steps.map(step => {
      const item = node('li', 'animation-state-trial-case-step'); item.dataset.stepIndex = String(step.index); item.dataset.status = step.status;
      const title = node('h5'), status = node('p'), sample = node('p'), expected = node('p'), actual = node('p'), details = node('details'), summary = node('summary'), body = node('div');
      details.append(summary, body); item.append(title, status, sample, expected, actual, details); el('Steps').append(item);
      const view = { step, item, title, status, sample, expected, actual, details, summary, body, expanded: false, language: null, detailRows: [] };
      details.addEventListener('toggle', () => {
        if (!details.open || !views.includes(view) || !visible(context())) return;
        // An observed table/session mismatch permanently drops this report.
        // Detached old details cannot revoke a newer report; folding alone
        // retains it until the parent checks ownership on reopening.
        if (!reportCurrent()) { clearReport(true); refresh(); return; }
        if (!view.expanded) { view.expanded = true; view.language = null; buildDetails(view); }
        renderViews();
      });
      return view;
    });
  }
  function buildDetails(view) {
    const shared = node('p'); view.body.append(shared); view.shared = shared;
    for (const candidate of view.step.result?.candidates || []) {
      const item = node('div', 'animation-state-trial-case-candidate'), title = node('p'), status = node('p'), list = node('ol'); item.dataset.status = candidate.status;
      const leaves = candidate.leaves.map(leaf => { const row = node('li'), rule = node('p'), actual = node('p'), outcome = node('p'); row.dataset.status = leaf.status; row.append(rule, actual, outcome); list.append(row); return { leaf, rule, actual, outcome }; });
      item.append(title, status, list); view.body.append(item); view.detailRows.push({ candidate, title, status, leaves });
    }
  }
  function renderViews() {
    const language = text('试算用例');
    for (const view of views) {
      if (view.language === language) continue; view.language = language;
      const step = view.step;
      view.title.textContent = text('用例步骤 {0}', step.index + 1);
      view.status.textContent = text(step.status === 'passed' ? '符合手动预期' : step.status === 'failed' ? '不符合手动预期' : '前一步不符，此步未运行。');
      view.sample.textContent = trigger(step.input);
      view.expected.textContent = text('预期：状态 {0} · {1}', step.expected.stateKey, text(step.expected.transition ? '发生转换' : '未发生转换'));
      view.actual.hidden = !step.actual;
      view.actual.textContent = step.actual ? text('试算：{0} → {1} · {2}', step.result.stateKey, step.actual.stateKey, text(step.actual.transition ? '发生转换' : '未发生转换')) : '';
      view.summary.textContent = text('查看用例步骤详情');
      if (!view.expanded) continue;
      view.shared.textContent = step.input.kind === 'event' ? text('已提供的共享样本：{0}', step.input.projectState.length ? step.input.projectState.map(entry => text('{0}：{1}', entry.key, scalar(entry.value))).join(' · ') : text('无（其余键缺失）')) : text('此步未读取事件载荷或共享样本。');
      for (const row of view.detailRows) {
        const candidate = row.candidate; row.title.textContent = text('转换 {0}：{1} → {2}', candidate.transitionIndex + 1, candidate.from, candidate.to);
        row.status.textContent = text(candidate.status === 'selected' ? '此样本选中此分支。' : candidate.status === 'rejected' ? '此样本不满足此分支。' : '前面的分支已选中，此分支未求值。');
        for (const item of row.leaves) {
          const leaf = item.leaf, condition = leaf.condition, source = condition.selector ? text('项目共享状态 {0}', condition.selector.key) : text('事件载荷'), operator = ({ eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' })[condition.operator];
          item.rule.textContent = text('条件 {0}：{1} {2} {3}', leaf.index + 1, source, operator, scalar(condition.value));
          item.actual.textContent = leaf.status === 'not-evaluated' ? text('未读取样本值。') : leaf.actual.status === 'missing' ? text('样本中未提供此共享键。') : text('实际样本：{0}', scalar(leaf.actual.value));
          item.outcome.textContent = leaf.status === 'not-evaluated' ? text(candidate.status === 'not-evaluated' ? '前面的分支已选中，此条件未求值。' : '组合已短路，此条件未求值。') : leaf.reason === 'missing' ? text('共享键缺失，条件不匹配（包括不等于比较）。') : leaf.reason === 'type-mismatch' ? text('样本类型不同，条件不匹配（包括不等于比较）。') : text(leaf.matches ? '比较匹配。' : '比较不匹配。');
        }
      }
    }
  }
  function render() {
    editor?.refresh();
    const value = context(), on = enabled(value), localOn = localEnabled(value), editing = editor?.isOpen() === true;
    const canExportPath = on && !editing && Boolean(sequence()?.steps.length);
    el('Title').textContent = text('试算用例');
    el('Note').textContent = text('将已记录路径导出为手动预期；导入后明确在当前表上重跑。只比较每步目标状态和是否发生转换，不区分通往同一目标的分支，也不证明动画实际运行成功。');
    el('Create').textContent = text('从当前路径建立用例'); el('Edit').textContent = text('编辑用例 JSON'); el('ExportLoaded').textContent = text('导出载入用例 JSON');
    el('Export').textContent = text('导出当前路径 JSON'); el('Import').textContent = text('导入用例 JSON'); el('Run').textContent = text('在当前表上重跑'); el('Clear').textContent = text('清除载入用例');
    el('Export').disabled = el('Create').disabled = !canExportPath; el('Import').disabled = el('File').disabled = !on || editing; el('Run').disabled = !on || !loaded || busy || editing; el('Clear').disabled = !on || !loaded && !busy || editing;
    el('Edit').disabled = el('ExportLoaded').disabled = !localOn || !loaded || editing;
    el('Loaded').hidden = !loaded; el('LoadedSummary').textContent = loaded ? text('已载入：{0} · 起始状态 {1} · {2} 步', fileName, loaded.initialStateKey, loaded.steps.length) : '';
    el('Status').textContent = text(editing ? '正在编辑用例 JSON；请先应用或取消。已载入用例和回放结果尚未改变。' : busy ? '正在读取用例 JSON…' : notice || (loaded ? '用例已载入，尚未重跑；当前手动路径保持不变。' : '尚未载入用例。导入不会替换当前手动路径或修改源码草稿。'));
    if (report && !busy && !notice && !editing) el('Status').textContent = '';
    el('Error').hidden = !error; el('Error').textContent = error ? text(error) : '';
    el('Result').hidden = !report; el('Result').dataset.status = report?.status || ''; el('ResultTitle').textContent = text('用例回放结果（手动预期对照）');
    el('ResultSummary').textContent = report ? report.status === 'passed' ? text('全部 {0} 步符合手动预期；这不是实际运行验收。', report.steps.length) : text('第 {0} 步与手动预期不符，已停止；后续步骤未运行。', report.steps.findIndex(step => step.status === 'failed') + 1) : '';
    renderViews();
  }
  function refresh() {
    if (disposed) return;
    const value = context();
    if (!session(value)) clear();
    else if (!visible(value)) revokeRead();
    else {
      if (!enabled(value)) { revokeRead(); clearReport(Boolean(report)); }
      if (chooser && !readCurrent(chooser)) revokeRead();
      if (report && !reportCurrent()) clearReport(true);
    }
    render();
  }
  function errorFor(cause, fallback) {
    if (cause?.errorCode === 'animation_state_trial_case_limit') return '用例超过 128 KiB 文件、32 步或 64 KiB 样本限制。';
    if (cause?.errorCode === 'animation_state_trial_case_state_missing') return '当前表缺少用例起始状态，无法重跑；请核对用例或恢复该状态。';
    return fallback;
  }
  editor = setupAnimationStateTrialCaseEditor({ container: el('EditorHost'), idPrefix: idPrefix + 'Editor', translate,
    getContext: () => ({ ...context(), active: !disposed && session(context()) }),
    onApply(value, ticket) {
      if (!localEnabled(context()) || ticket.owner !== editorOwner || editorOwner?.base !== loaded || !ticket.isCurrent()) return false;
      // The child passes only its admitted brand. Validate before committing so
      // parent state is unchanged if a future editor port violates this contract.
      serializeAnimationStateTrialCase(value);
      if (!ticket.isCurrent()) return false;
      loaded = value; fileName = editorOwner.name; clearReport(); revokeRead(); error = ''; notice = '用例已应用，尚未重跑；当前手动路径保持不变。'; return true;
    },
    onStateChange(change) {
      const focus = !change.open ? editorOwner?.focus : null;
      if (!change.open) editorOwner = null;
      render();
      if (focus && ['applied', 'cancelled'].includes(change.reason) && localEnabled(context())) focus.focus({ preventScroll: true });
    },
  });
  function editorText(value) {
    const compact = serializeAnimationStateTrialCase(value), pretty = JSON.stringify(value, null, 2) + '\n';
    return pretty.length <= ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes && new TextEncoder().encode(pretty).length <= ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes ? pretty : compact;
  }
  function openEditor(value, focus, name) {
    if (!localEnabled(context()) || editor.isOpen()) return;
    try {
      const raw = editorText(value); revokeRead(); error = '';
      editorOwner = { base: loaded, focus, name };
      if (!editor.open({ text: raw, owner: editorOwner })) editorOwner = null;
    } catch (cause) { error = errorFor(cause, '无法建立用例草稿；当前载入用例保持不变。'); }
    render();
  }
  el('Edit').addEventListener('click', () => { if (!localEnabled(context()) || editor.isOpen() || !loaded) return; refresh(); openEditor(loaded, el('Edit'), fileName); });
  el('Create').addEventListener('click', () => {
    if (!enabled(context()) || editor.isOpen()) return;
    refresh(); const path = sequence(); if (!path?.steps.length) return;
    try { const value = createAnimationStateTrialCase(path); if (sequence() === path) openEditor(value, el('Create'), 'animation-state-trial-case.json'); }
    catch (cause) { error = errorFor(cause, '无法建立用例草稿；当前载入用例保持不变。'); render(); }
  });
  el('ExportLoaded').addEventListener('click', () => {
    if (!localEnabled(context()) || editor.isOpen() || !loaded) return;
    let url, anchor;
    try {
      const value = loaded, data = serializeAnimationStateTrialCase(value);
      if (!localEnabled(context()) || editor.isOpen() || loaded !== value) return;
      url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' })); anchor = node('a'); anchor.href = url; anchor.download = 'animation-state-trial-case.json'; document.body.append(anchor); anchor.click(); error = '';
    } catch (cause) { error = errorFor(cause, '用例导出未完成，请重试。'); }
    finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 0); }
    render();
  });
  el('Export').addEventListener('click', () => {
    if (!enabled(context()) || editor.isOpen()) return;
    refresh(); const path = sequence(); if (!path?.steps.length) { error = '请先记录至少一个手动步骤，再导出用例。'; render(); return; }
    let url, anchor;
    try {
      const data = serializeAnimationStateTrialCase(createAnimationStateTrialCase(path));
      if (!enabled(context()) || sequence() !== path) return;
      const blob = new Blob([data], { type: 'application/json;charset=utf-8' }); url = URL.createObjectURL(blob); anchor = node('a'); anchor.href = url; anchor.download = 'animation-state-trial-case.json'; document.body.append(anchor); anchor.click(); error = '';
    } catch (cause) { error = errorFor(cause, '用例导出未完成，请重试。'); }
    finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 0); }
    render();
  });
  el('Import').addEventListener('click', () => {
    if (!enabled(context()) || editor.isOpen()) return;
    refresh(); revokeRead(); error = ''; chooser = { epoch: readEpoch, generation: context().generation }; el('File').value = ''; render(); el('File').click();
  });
  el('File').addEventListener('cancel', () => { if (readCurrent(chooser)) { revokeRead(); render(); } });
  el('File').addEventListener('change', async () => {
    if (!readCurrent(chooser)) return;
    const ticket = { epoch: ++readEpoch, generation: context().generation }; chooser = ticket;
    const file = el('File').files?.[0]; if (!file) { revokeRead(); render(); return; }
    busy = true; error = ''; render();
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > ANIMATION_STATE_TRIAL_CASE_LIMITS.textBytes) throw Object.assign(new Error('size'), { errorCode: 'animation_state_trial_case_limit' });
      const raw = await file.text(); if (!readCurrent(ticket)) return;
      const next = parseAnimationStateTrialCase(raw); if (!readCurrent(ticket)) return;
      loaded = next; fileName = String(file.name || 'animation-state-trial-case.json'); clearReport(); notice = ''; error = '';
    } catch (cause) {
      if (readCurrent(ticket)) error = errorFor(cause, cause?.errorCode === 'animation_state_trial_case_invalid' ? '用例 JSON 无效或版本不受支持；此前载入用例和结果保持不变。' : '无法读取用例文件；此前载入用例和结果保持不变。');
    } finally {
      // A stale read must release only its own busy state. The replacement
      // request, loaded case and report remain owned by their newer ticket.
      if (chooser === ticket && ticket.epoch === readEpoch) { revokeRead(); refresh(); }
    }
  });
  el('Run').addEventListener('click', () => {
    if (!enabled(context()) || editor.isOpen()) return;
    refresh(); if (!loaded || busy || el('Run').disabled) return;
    clearReport(); error = ''; notice = '';
    try {
      const table = getTable(), ticket = { case: loaded, generation: context().generation, signature: JSON.stringify(table) };
      const next = replayAnimationStateTrialCase(table, loaded); report = next; owner = ticket;
      if (!reportCurrent()) { clearReport(true); render(); return; }
      buildViews();
    } catch (cause) { error = errorFor(cause, '当前表或核心无法完成用例试算；载入用例保持不变。'); }
    render();
  });
  el('Clear').addEventListener('click', () => { if (!enabled(context()) || editor.isOpen()) return; clear(); notice = '载入用例已清除；当前手动路径保持不变。'; render(); el('Import').focus({ preventScroll: true }); });
  // The parent form may not have initialized its context during construction.
  el('Title').textContent = text('试算用例');
  return Object.freeze({ refresh, reset() { if (disposed) return; clear(); el('Loaded').hidden = true; el('Status').textContent = ''; el('Error').hidden = true; }, dispose() { if (disposed) return; clear(); editor.dispose(); disposed = true; container.replaceChildren(); } });
}
