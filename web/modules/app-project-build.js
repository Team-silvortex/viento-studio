import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';
import { setupSceneCreate } from './app-scene-create.js';
import { setupScenePreview } from './app-scene-preview.js';
const errorLabels = {
  build_projection_invalid: '场景引用的投影无效，请检查投影原文。',
  build_projection_source: '投影的来源对象不可读取或不是普通对象，请检查来源。',
  build_projection_unlinked: '投影缺少来源关系，请检查对象登记。',
  build_projection_runtime: '此投影不支持当前二维场景，请选择兼容的游戏投影。',
  build_scene_required: '请选择已登记且可读取的场景文档。',
  build_scene_format: '场景必须使用 viento-scene2d 第 1 版 JSON 格式。',
  build_scene_json: '场景 JSON 格式有误，请打开原文检查。',
  build_scene_value: '场景字段的值不符合要求，请检查标出的位置。',
  build_actor_value: '角色字段的值不符合要求，请检查标出的位置。',
  build_actor_missing: '场景引用的角色不存在或原文不可用。',
  build_actor_duplicate: '同一个角色不能在场景中重复声明。',
  build_actor_unlinked: '请先在世界与对象中登记场景到角色的关系。',
  build_image_unsupported: '请选择已登记的 PNG、JPEG、WebP 或 SVG 图片。',
  build_image_unbound: '请先在世界与对象中将图片绑定到角色或场景。',
  build_image_unverified: '图片缺少有效的内容校验信息，请重新导入。',
  build_resource_changed: '图片内容与登记信息不符，请重新导入后检查计划。',
  build_resource_unavailable: '构建所需素材不可读取，请检查素材位置。',
  build_input_changed: '工程内容已变化，请重新检查计划再构建。',
  build_snapshot_conflict: '工程内容已变化，请重新检查计划再构建。',
  build_snapshot_changed: '工程内容已变化，请重新检查计划再构建。',
  build_input_limit: '构建输入超出限制，请减少场景或素材大小。',
  build_feature_unsupported: '场景使用了当前后端尚未支持的功能。',
  build_capability_missing: '当前后端缺少此场景所需的能力。',
  build_platform_unsupported: '此实验构建后端目前仅支持 Linux。',
  build_tool_required: '宿主尚未配置 Godot 4，可先检查计划。',
  build_tool_unavailable: '宿主配置的 Godot 无法运行，请检查工具配置。',
  build_tool_version: '宿主配置的工具不是受支持的 Godot 4。',
  build_busy: '当前工程已有任务运行，请等待完成或取消。',
  build_job_busy: '当前工程已有任务运行，请等待完成或取消。',
  build_job_missing: '任务记录已变化，请刷新状态。',
  build_not_found: '构建产物不可用，请重新构建。',
  build_artifact_missing: '构建产物不可用，请重新构建。',
  build_local_only: '构建与运行仅允许在本机编辑器中使用。',
  build_service_closed: '服务端可能在重启或部署窗口，稍后请再尝试',
  build_request_invalid: '构建请求格式无效，请刷新页面后重试。',
  build_failed: '构建或运行失败，请查看原始日志。',
  runtime_build_invalid: '构建产物不可用，请重新构建。',
  runtime_artifact_changed: '构建产物已变化，请重新构建。',
  runtime_adapter_changed: '构建后端已更新，请重新构建。',
  runtime_tool_changed: 'Godot 工具已变化，请重新构建。',
  runtime_protocol_invalid: '运行返回了无效事件，请查看原始日志。',
  runtime_protocol_incomplete: '运行未完成预期的启动或测试流程，请查看原始日志。',
  godot_error: 'Godot 报告了错误，请检查原文位置和日志。',
  build_cancelled: '任务已取消。', runtime_cancelled: '任务已取消。', build_process_cancelled: '任务已取消。',
  build_process_timeout: '任务超时，进程已停止。', build_tool_timeout: '查询 Godot 版本超时，请检查工具配置。',
  build_process_failed: '构建或运行失败，请查看原始日志。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
};
const phaseLabels = { snapshot: '正在冻结工程快照…', tool: '正在检查构建工具…', generate: '正在生成产物…',
  import: '正在导入资源…', 'script-check': '正在检查生成的脚本…', starting: '正在启动任务…',
  running: '任务正在运行…', cancelling: '正在取消任务…', completed: '任务已结束。' };
const kindLabels = { plan: '检查计划', build: '构建场景', run: '运行场景' };
const statusLabels = { running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时' };

export function setupProjectBuild({ getContext = () => ({}), openSource = () => false, setBusy = () => {}, applied = async () => {} } = {}) {
  const button = document.getElementById('projectBuildBtn');
  if (!button) return { setAvailable() {} };
  const dialog = document.createElement('dialog');
  dialog.id = 'projectBuildDialog'; dialog.className = 'project-build';
  dialog.setAttribute('aria-labelledby', 'projectBuildTitle');
  dialog.innerHTML = `<header class="build-heading"><div><h2 id="projectBuildTitle" data-i18n="构建与运行"></h2><p id="projectBuildBackend"></p></div>
    <button id="projectBuildClose" type="button" class="doc-btn" data-i18n="返回编辑器"></button></header>
    <p id="projectBuildNote" class="build-note" data-i18n="从已保存的场景生成独立产物。关闭面板后任务继续，可随时返回查看。"></p>
    <p id="projectBuildAvailability"></p><p id="projectBuildDraft" class="build-note" hidden data-i18n="请先保存或结束编辑草稿，再检查、构建或运行。当前草稿会保留。"></p>
    <div class="build-scene-picker"><label for="projectBuildScene" data-i18n="构建场景文档"></label><select id="projectBuildScene"></select>
    <button id="projectBuildRefresh" type="button" class="doc-btn doc-btn-ghost" data-i18n="刷新状态"></button></div>
    <button id="projectBuildEditScene" type="button" class="doc-btn doc-btn-ghost" data-i18n="编辑场景" hidden></button>
    <button id="projectBuildCreateScene" type="button" class="doc-btn doc-btn-ghost" data-i18n="创建场景" hidden></button>
    <p id="projectBuildEmpty" hidden data-i18n="暂无可构建场景。请添加已登记的 viento-scene2d JSON 场景文档。"></p>
    <div id="projectBuildTabs" class="build-tabs" role="tablist" data-i18n-aria-label="场景与构建选项卡" hidden>
      <button id="projectBuildTabPreview" type="button" role="tab" aria-controls="projectBuildPreviewPanel" aria-selected="false" tabindex="-1" data-i18n="场景预览"></button>
      <button id="projectBuildTabBuild" type="button" role="tab" aria-controls="projectBuildTaskPanel" aria-selected="true" tabindex="0" data-i18n="构建任务"></button>
    </div>
    <section id="projectBuildPreviewPanel" role="tabpanel" aria-labelledby="projectBuildTabPreview" hidden></section>
    <section id="projectBuildTaskPanel" role="tabpanel" aria-labelledby="projectBuildTabBuild">
    <div class="build-actions"><button id="projectBuildPlan" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查计划"></button>
    <button id="projectBuildGenerate" type="button" class="doc-btn" data-i18n="构建场景"></button>
    <button id="projectBuildHeadless" type="button" class="doc-btn doc-btn-ghost" data-i18n="无头测试"></button>
    <button id="projectBuildWindow" type="button" class="doc-btn doc-btn-ghost" data-i18n="窗口预览"></button>
    <button id="projectBuildCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消任务" hidden></button></div>
    <p id="projectBuildStatus" role="status" aria-live="polite"></p><p id="projectBuildError" role="alert" hidden></p>
    <section id="projectBuildPlanSummary" class="build-summary" hidden aria-labelledby="projectBuildPlanTitle"><h3 id="projectBuildPlanTitle" data-i18n="构建计划"></h3><p id="projectBuildPlanCounts"></p><p id="projectBuildSnapshot" class="build-monospace"></p></section>
    <p class="build-hint" data-i18n="先检查计划，再构建。测试与预览使用最近成功构建的快照；编辑后需重新构建。无头测试不验证画面。"></p>
    <section aria-labelledby="projectBuildDiagnosticsTitle"><h3 id="projectBuildDiagnosticsTitle" data-i18n="构建诊断"></h3><ul id="projectBuildDiagnostics"></ul></section>
    <p id="projectBuildEvents" hidden></p>
    <details class="build-raw"><summary data-i18n="原始细节与日志"></summary><pre id="projectBuildLogs" tabindex="0"></pre></details></section>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  let available = false, creationSupported = false, updateSupported = false, data = null, selected = '', requestBusy = false, timer = null, requestEpoch = 0;
  let previewSupported = false, activeTab = 'build';
  let errorMessage = '', errorDetails = '', plan = null, planScene = '', planJob = '', cancelling = false, invalidatedPlanJob = '', invalidatedSnapshot = '';
  const sceneCreator = setupSceneCreate({ getContext, setBusy: value => { setBusy(value); render(); }, applied: async result => {
    let refreshError;
    try { await applied(result); } catch (error) { refreshError = error; }
    const createdId = result.object?.id || result.changes?.[0]?.objectId;
    selected = createdId || selected; invalidatedPlanJob = planJob || (data?.job?.kind === 'plan' ? data.job.id : '');
    invalidatedSnapshot = plan?.snapshotId || data?.job?.plan?.snapshotId || ''; plan = null; planScene = '';
    scenePreview.invalidate();
    await refresh(true);
    if (refreshError) throw refreshError;
    if (errorMessage || !data?.scenes.some(scene => scene.id === createdId)) throw new Error(t('场景已创建，但目录或构建列表刷新失败。请刷新核对，勿重复创建。'));
  } });
  const running = () => data?.job?.status === 'running';
  const ready = () => {
    const context = getContext();
    return available && data?.supported && context.editable && !context.dirty && !context.creating && !context.busy;
  };
  const editScene = () => {
    if (updateSupported && selected && !requestBusy && !running() && ready()) sceneCreator.open(selected, { mode: 'edit' });
  };
  const scenePreview = setupScenePreview({
    container: el('projectBuildPreviewPanel'),
    getContext: () => ({ ...getContext(), canEditScene: Boolean(updateSupported && selected && !requestBusy && !running() && ready()) }),
    editScene,
    openSource: async (...args) => { const opened = await openSource(...args); if (opened !== false) dialog.close(); return opened; },
  });
  const node = (tag, text, className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
  const matchedBuild = () => data?.latestBuild?.sceneId === selected ? data.latestBuild : null;
  const mayStart = action => !errorMessage && !requestBusy && !running() && ready() && Boolean(selected)
    && (action === 'plan' || data.available && (action === 'build' ? planScene === selected && Boolean(plan) : Boolean(matchedBuild())));
  const friendly = code => t(errorLabels[code] || '构建请求未完成，请刷新状态核对结果。');
  function render() {
    translatePage(dialog);
    const context = getContext(), job = data?.job;
    const active = running();
    el('projectBuildTabs').hidden = !previewSupported;
    el('projectBuildTabs').setAttribute('aria-label', t('场景与构建选项卡'));
    for (const [name, id] of [['preview', 'projectBuildTabPreview'], ['build', 'projectBuildTabBuild']]) {
      el(id).setAttribute('aria-selected', String(activeTab === name)); el(id).tabIndex = activeTab === name ? 0 : -1;
    }
    el('projectBuildNote').hidden = activeTab === 'preview';
    el('projectBuildBackend').hidden = activeTab === 'preview';
    el('projectBuildAvailability').hidden = activeTab === 'preview';
    el('projectBuildPreviewPanel').hidden = activeTab !== 'preview';
    el('projectBuildTaskPanel').hidden = activeTab !== 'build';
    scenePreview.setScene(selected);
    scenePreview.setVisible(Boolean(dialog.open && previewSupported && activeTab === 'preview'));
    button.textContent = active ? t('构建与运行 · 进行中') : t('构建与运行');
    button.setAttribute('aria-label', button.textContent);
    button.dataset.running = String(active);
    dialog.setAttribute('aria-busy', String(requestBusy || active));
    el('projectBuildBackend').textContent = data?.backend ? `${data.backend.label || data.backend.id} · ${data.backend.version || ''}` : t('实验构建后端');
    el('projectBuildAvailability').textContent = data?.reason === 'tool_missing' ? t('宿主尚未配置 Godot 4，可先检查计划。')
      : data?.reason === 'platform_unsupported' ? t('此实验构建后端目前仅支持 Linux。') : '';
    el('projectBuildDraft').hidden = activeTab === 'preview' || !context.dirty && !context.creating;
    const scenes = data?.scenes || [], picker = el('projectBuildScene');
    // Keep the focused option stable during polling; re-populating a select can close its popup.
    const signature = JSON.stringify(scenes);
    if (picker.dataset.scenes !== signature) {
      picker.replaceChildren();
      for (const scene of scenes) { const option = node('option', `${scene.title} · ${scene.sourcePath}`); option.value = scene.id; picker.append(option); }
      picker.dataset.scenes = signature;
    }
    picker.value = selected; picker.disabled = requestBusy || active || !scenes.length;
    el('projectBuildEmpty').hidden = !data || scenes.length > 0;
    el('projectBuildEmpty').textContent = t(creationSupported ? '暂无可构建场景。点击创建场景，选择已有对象开始。' : '暂无可构建场景。请添加已登记的 viento-scene2d JSON 场景文档。');
    el('projectBuildRefresh').disabled = requestBusy;
    el('projectBuildEditScene').hidden = activeTab === 'preview' || !updateSupported;
    el('projectBuildEditScene').disabled = requestBusy || running() || !ready() || !selected;
    el('projectBuildCreateScene').hidden = activeTab === 'preview' || !creationSupported;
    el('projectBuildCreateScene').disabled = requestBusy || running() || !ready();
    el('projectBuildPlan').disabled = !mayStart('plan');
    el('projectBuildGenerate').disabled = !mayStart('build');
    el('projectBuildHeadless').disabled = !mayStart('run'); el('projectBuildWindow').disabled = !mayStart('run');
    el('projectBuildCancel').hidden = !active;
    el('projectBuildCancel').disabled = requestBusy || cancelling;
    el('projectBuildStatus').textContent = requestBusy ? t('正在读取构建状态…') : job
      ? `${t(kindLabels[job.kind] || '构建任务')} · ${t(statusLabels[job.status] || '进行中')}${active ? ` · ${t(phaseLabels[job.phase] || '任务正在运行…')}` : ''}` : t('请选择场景并检查计划。');
    el('projectBuildError').hidden = !errorMessage; el('projectBuildError').textContent = errorMessage;
    const summary = planScene === selected ? plan : null;
    el('projectBuildPlanSummary').hidden = !summary;
    el('projectBuildPlanCounts').textContent = summary ? t('{0} · {1} 个角色 · {2} 个资源', summary.title, summary.actorCount, summary.resourceCount) : '';
    el('projectBuildSnapshot').textContent = summary ? t('快照：{0}', summary.snapshotId) : '';
    const diagnostics = el('projectBuildDiagnostics'); diagnostics.replaceChildren();
    for (const diagnostic of job?.diagnostics || []) {
      const item = node('li', '', 'build-diagnostic');
      item.append(node('p', friendly(diagnostic.code)));
      if (diagnostic.sourcePath) {
        const link = node('button', `${t('打开原文')} · ${diagnostic.sourcePath}${diagnostic.propertyPath || ''}`, 'doc-btn doc-btn-ghost');
        link.type = 'button';
        link.addEventListener('click', async () => {
          try {
            const opened = await openSource(diagnostic.sourcePath, diagnostic);
            if (opened !== false) dialog.close();
          } catch { errorMessage = t('无法打开原文，请返回编辑器查找该文档。'); render(); }
        });
        item.append(link);
      }
      diagnostics.append(item);
    }
    if (!diagnostics.children.length) diagnostics.append(node('li', t('暂无构建诊断。')));
    el('projectBuildEvents').hidden = !job?.events?.length;
    el('projectBuildEvents').textContent = t('已收到 {0} 条运行事件；完整内容见原始细节。', job?.events?.length || 0);
    el('projectBuildLogs').textContent = [errorDetails, ...(job?.diagnostics || []).map(item => JSON.stringify(item, null, 2)),
      ...(job?.events || []).map(item => JSON.stringify(item)), job?.logs || ''].filter(Boolean).join('\n\n') || t('暂无日志。');
  }
  function schedule() {
    clearTimeout(timer); timer = null;
    if (available && running()) timer = setTimeout(() => { timer = null; void refresh(); }, errorMessage ? 3000 : 1000);
  }
  function accept(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.scenes)) throw new Error('Invalid build state');
    data = payload;
    if (!(payload.scenes || []).some(scene => scene.id === selected)) {
      selected = payload.scenes.find(scene => scene.sourcePath === getContext().path)?.id || payload.scenes[0]?.id || '';
      plan = null; planScene = '';
    }
    if (payload.job?.kind === 'plan') {
      if (payload.job.status === 'succeeded' && payload.job.plan && (invalidatedPlanJob ? payload.job.id !== invalidatedPlanJob : !invalidatedSnapshot || payload.job.plan.snapshotId !== invalidatedSnapshot)) { plan = payload.job.plan; planScene = payload.job.sceneId; planJob = payload.job.id || ''; }
      else if (payload.job.status !== 'running') { plan = null; planScene = ''; }
    }
    if ((payload.job?.diagnostics || []).some(item => ['build_input_changed', 'build_snapshot_conflict', 'build_snapshot_changed'].includes(item.code))) { plan = null; planScene = ''; }
    if (!running()) cancelling = false;
  }
  function fail(error) {
    const code = error.payload?.errorCode || error.payload?.data?.errorCode || error.errorCode;
    errorMessage = friendly(code); errorDetails = `${code || 'request_failed'}\n${error.message || ''}`;
    if (['build_input_changed', 'build_snapshot_conflict', 'build_snapshot_changed'].includes(code)) { plan = null; planScene = ''; }
  }
  async function refresh(force = false) {
    if (!available || requestBusy) return;
    const epoch = ++requestEpoch; requestBusy = true; render();
    try {
      const { payload } = await fetchJsonApiRequest(force ? `${PROJECT_BUILD_API_PATH}?refresh=1` : PROJECT_BUILD_API_PATH, { cache: 'no-store' }, 15000, t('读取构建状态'));
      if (epoch !== requestEpoch) return;
      accept(payload); errorMessage = ''; errorDetails = '';
    } catch (error) { if (epoch === requestEpoch) fail(error); }
    finally { if (epoch === requestEpoch) { requestBusy = false; render(); schedule(); } }
  }
  async function submit(action, mode) {
    if (action === 'cancel' ? !running() || requestBusy || cancelling : !mayStart(action)) { render(); return; }
    clearTimeout(timer); timer = null;
    const body = action === 'cancel' ? { action, jobId: data.job.id }
      : action === 'run' ? { action, buildId: matchedBuild().id, mode }
      : { action, sceneId: selected, ...(action === 'build' ? { expectedSnapshotId: plan.snapshotId } : {}) };
    if (action === 'cancel') cancelling = true;
    if (action === 'plan') { plan = null; planScene = ''; }
    const epoch = ++requestEpoch; requestBusy = true; errorMessage = ''; errorDetails = ''; render();
    try {
      const { payload } = await fetchJsonApiRequest(PROJECT_BUILD_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 15000, t('提交构建任务'));
      if (epoch !== requestEpoch) return;
      accept(payload);
    } catch (error) {
      if (epoch === requestEpoch) { fail(error); cancelling = false; }
      // A lost response can still have started a job. Reconcile with GET only.
    } finally {
      if (epoch === requestEpoch) {
        requestBusy = false; render(); schedule();
        if (errorMessage && !running() && available) timer = setTimeout(() => { timer = null; void refresh(); }, 1000);
      }
    }
  }
  button.addEventListener('click', () => { if (available && !dialog.open) { render(); dialog.showModal(); void refresh(); } });
  el('projectBuildEditScene').addEventListener('click', editScene);
  el('projectBuildCreateScene').addEventListener('click', () => { if (creationSupported && !requestBusy && !running() && ready()) sceneCreator.open(); });
  el('projectBuildClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) { scenePreview.setVisible(false); button.focus(); } });
  const tabs = ['projectBuildTabPreview', 'projectBuildTabBuild'];
  function selectTab(index, focus = false) {
    if (!previewSupported) return;
    activeTab = index === 0 ? 'preview' : 'build'; render();
    if (focus) el(tabs[index]).focus();
  }
  tabs.forEach((id, index) => {
    el(id).addEventListener('click', () => selectTab(index));
    el(id).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
    });
  });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
  });
  el('projectBuildRefresh').addEventListener('click', () => void refresh());
  el('projectBuildScene').addEventListener('change', () => { selected = el('projectBuildScene').value; plan = null; planScene = ''; render(); });
  el('projectBuildPlan').addEventListener('click', () => void submit('plan'));
  el('projectBuildGenerate').addEventListener('click', () => void submit('build'));
  el('projectBuildHeadless').addEventListener('click', () => void submit('run', 'headless'));
  el('projectBuildWindow').addEventListener('click', () => void submit('run', 'window'));
  el('projectBuildCancel').addEventListener('click', () => void submit('cancel'));
  onLanguageChange(render);
  return { setAvailable(value, commands = [], capabilities = {}) {
    creationSupported = commands.includes('scene.create'); updateSupported = commands.includes('scene.update'); sceneCreator.setAvailable(value === true && (creationSupported || updateSupported), commands);
    available = value === true; button.hidden = !available;
    previewSupported = available && capabilities.scenePreview === true;
    if (!previewSupported) activeTab = 'build';
    scenePreview.setAvailable(previewSupported);
    if (!available) { requestEpoch++; requestBusy = false; clearTimeout(timer); timer = null; if (dialog.open) dialog.close(); }
    render();
  } };
}
