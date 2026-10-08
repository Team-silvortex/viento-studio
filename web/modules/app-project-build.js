import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { fetchJsonApiRequest } from './app-services.js';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';
import { setupSceneCreate } from './app-scene-create.js';
import { setupScenePreview } from './app-scene-preview.js';
import { setupSceneLayout } from './app-scene-layout.js';
import { setupSceneCompositionOverrides } from './app-scene-composition-overrides.js';
import { SCENE_PREVIEW_API_PATH } from '../../engine/scene-preview-contract.mjs';
import { supportsStudioCoreCompositionPatch } from '../../engine/studio-core.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { canExecuteBackend } from '../../engine/backend-capabilities.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { validateExecutionToolStatus } from '../../engine/execution-tool-status.mjs';
import { validateRuntimeCase, validateRuntimeCasePlan, evaluateRuntimeCase } from '../../engine/runtime-verification-case.mjs';
import { setupRuntimeCaseDocuments } from './app-runtime-case-documents.js';
import { requestProjectBuildDocument } from './app-doc-service.js';
import { setupRuntimeCaseSuites } from './app-runtime-case-suites.js';
import { setupRuntimeCaseReport } from './app-runtime-case-report.js';
const errorLabels = {
  build_projection_invalid: '场景引用的投影无效，请检查投影原文。',
  build_projection_source: '投影的来源对象不可读取或不是普通对象，请检查来源。',
  build_projection_unlinked: '投影缺少来源关系，请检查对象登记。',
  build_projection_runtime: '此投影不支持当前二维场景，请选择兼容的游戏投影。',
  build_scene_required: '请选择已登记且可读取的场景文档。',
  build_scene_format: '场景必须使用 viento-scene2d 第 1、2 或 3 版 JSON 格式。',
  build_scene_json: '场景 JSON 格式有误，请打开原文检查。',
  build_scene_value: '场景字段的值不符合要求，请检查标出的位置。',
  build_actor_value: '角色字段的值不符合要求，请检查标出的位置。',
  build_actor_missing: '场景引用的角色不存在或原文不可用。',
  build_actor_duplicate: '同一个角色不能在场景中重复声明。',
  build_group_value: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_missing: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_duplicate: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_parent: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_cycle: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_group_depth: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_actor_group: '场景分组无效，请检查分组身份、名称和父级关系。',
  build_instance_missing: '每个场景实例都需要有效的 UUID 身份。',
  build_instance_duplicate: '场景实例身份不能重复，请为复制的实例使用新身份。',
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
  build_platform_unsupported: '当前构建后端不支持此平台。',
  build_tool_required: '宿主尚未配置构建工具，可先检查计划。',
  build_tool_unavailable: '宿主配置的构建工具无法运行，请检查工具配置。',
  build_tool_version: '宿主配置的构建工具版本不受支持。',
  build_backend_invalid: '构建后端的能力声明无效，请检查宿主配置。',
  build_backend_plan_unsupported: '当前构建后端不支持此计划格式。',
  build_execution_unsupported: '当前构建后端未提供此执行能力。',
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
  runtime_tool_changed: '构建工具已变化，请重新构建。',
  runtime_protocol_invalid: '运行返回了无效事件，请查看原始日志。',
  runtime_protocol_incomplete: '运行未完成预期的启动或测试流程，请查看原始日志。',
  runtime_control_invalid: '控制回放格式有误，请检查步长、步骤和方向键值。',
  runtime_control_limit: '控制回放超出对象样本预算，请减少步骤或场景对象。',
  runtime_control_mode: '控制回放仅支持有限的无头测试。',
  runtime_control_unsupported: '当前后端或场景不支持控制回放。',
  runtime_control_target_missing: '控制程序引用的实例不属于这份构建，请核对实例标识。',
  runtime_control_trace_invalid: '控制回放返回了无效样本，请查看原始日志。',
  runtime_control_trace_incomplete: '控制回放未返回完整步骤，请查看原始日志。',
  runtime_case_invalid: '运行验收格式有误，请检查控制程序和预期检查。',
  runtime_case_limit: '运行验收超出限制，请减少检查或控制步骤。',
  runtime_case_unsupported: '运行验收仅支持无行为的第 2 版场景与有限无头控制回放。',
  runtime_case_target_missing: '验收引用的实例不属于当前构建，请核对实例标识。',
  runtime_case_sample_invalid: '运行验收收到无效样本，请查看原始日志。',
  runtime_suite_document_conflict: '验收组原文已变化。请重新载入，或另存为新组；当前成员选择已保留。',
  runtime_suite_scene_conflict: '场景原文已变化。请刷新列表并重新载入验收组；当前成员选择已保留。',
  runtime_suite_scene_mismatch: '此验收组属于另一个场景。请选择对应场景，或明确作为新组。',
  runtime_suite_invalid: '验收组格式有误，请核对成员和保存位置。',
  runtime_suite_limit: '验收组超出 16 份用例、4096 份实例步骤或 1024 条检查的限制。',
  runtime_suite_member_missing: '验收组成员缺失或无效，请刷新并核对已保存用例。',
  runtime_suite_dependency_unavailable: '工程来源不可读取，不能载入、保存或启动批量验收。已启动批次继续使用捕获内容。',
  godot_error: 'Godot 报告了错误，请检查原文位置和日志。',
  build_cancelled: '任务已取消。', runtime_cancelled: '任务已取消。', build_process_cancelled: '任务已取消。',
  build_process_timeout: '任务超时，进程已停止。', build_tool_timeout: '查询构建工具版本超时，请检查工具配置。',
  build_process_failed: '构建或运行失败，请查看原始日志。',
  world_recovery_required: '工程存在未完成的提交，请先在世界与对象中恢复。',
};
const phaseLabels = { snapshot: '正在冻结工程快照…', tool: '正在检查构建工具…', generate: '正在生成产物…',
  import: '正在导入资源…', 'script-check': '正在检查生成的脚本…', starting: '正在启动任务…',
  running: '任务正在运行…', cancelling: '正在取消任务…', completed: '任务已结束。' };
const kindLabels = { plan: '检查计划', build: '构建场景', run: '运行场景', suite: '批量运行验收' };
const statusLabels = { running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时' };
const capabilityLabels = { build: '构建场景', headlessLogic: '无头逻辑测试', windowPreview: '独立窗口预览', windowCapture: '窗口截图',
  offscreenRender: '离屏渲染', embeddedViewport: '嵌入式视口', gpuCompute: 'GPU 计算' };
const toolReasonLabels = { platform_unsupported: errorLabels.build_platform_unsupported, tool_missing: errorLabels.build_tool_required,
  tool_version: errorLabels.build_tool_version, tool_timeout: errorLabels.build_tool_timeout,
  tool_failed: '构建工具身份检查失败，请检查宿主工具配置。', tool_output_limit: '工具返回内容超出限制，检查已停止。',
  tool_cancelled: '工具检查已取消。', tool_changed: '构建工具已变化，请重新检查。' };

export function setupProjectBuild({ getContext = () => ({}), getSceneDraft = async () => null, applySceneDraft = async () => ({ applied: false }), getCompositionSource = async () => null, applyCompositionDraft = async () => ({ applied: false }), openSource = () => false, setBusy = () => {}, applied = async () => {} } = {}) {
  const button = document.getElementById('projectBuildBtn');
  if (!button) return { setAvailable() {} };
  const dialog = document.createElement('dialog');
  dialog.id = 'projectBuildDialog'; dialog.className = 'project-build';
  dialog.setAttribute('aria-labelledby', 'projectBuildTitle');
  dialog.innerHTML = `<header class="build-heading"><div><h2 id="projectBuildTitle" data-i18n="构建与运行"></h2><p id="projectBuildBackend"></p></div>
    <button id="projectBuildClose" type="button" class="doc-btn" data-i18n="返回编辑器"></button></header>
    <p id="projectBuildNote" class="build-note" data-i18n="从已保存的场景生成独立产物。关闭面板后任务继续，可随时返回查看。"></p>
    <p id="projectBuildCapabilities" class="build-note"></p><p id="projectBuildAvailability" role="status" aria-live="polite"></p>
    <button id="projectBuildToolCheck" type="button" class="doc-btn doc-btn-ghost" data-i18n="检查工具身份" hidden></button>
    <p id="projectBuildCatalogDiagnostic" class="build-note" role="status" hidden data-i18n="工程来源暂时不可读取。可以查看或运行已有构建；恢复来源并刷新后才能检查计划或构建。"></p>
    <p id="projectBuildDraft" class="build-note" hidden data-i18n="请先保存或结束编辑草稿，再检查、构建或运行。当前草稿会保留。"></p>
    <div class="build-scene-picker"><label id="projectBuildSceneLabel" for="projectBuildScene"></label><select id="projectBuildScene"></select>
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
    <button id="projectBuildControl" type="button" class="doc-btn doc-btn-ghost" data-i18n="控制回放" hidden></button>
    <button id="projectBuildCaseRun" type="button" class="doc-btn doc-btn-ghost" data-i18n="运行验收" hidden></button>
    <button id="projectBuildWindow" type="button" class="doc-btn doc-btn-ghost" data-i18n="窗口预览"></button>
    <button id="projectBuildCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消任务" hidden></button></div>
    <details id="projectBuildControlEditor" class="build-control-editor" hidden><summary data-i18n="编辑控制回放"></summary>
    <p class="build-hint" data-i18n="方向键按固定步长逐步回放；仅用于本次无头测试，不写入作品文件。"></p>
    <div class="build-control-target"><label for="projectBuildControlTarget" data-i18n="输入示例的目标"></label><select id="projectBuildControlTarget"></select>
    <button id="projectBuildControlExample" type="button" class="doc-btn doc-btn-ghost" data-i18n="生成输入示例"></button></div>
    <p id="projectBuildControlTargetHint" class="build-hint" hidden data-i18n="实例输入按步骤独立生效；某一步未列出的实例会释放方向键，不延续上一步输入。"></p>
    <label for="projectBuildControlProgram" data-i18n="控制步骤（JSON）"></label><textarea id="projectBuildControlProgram" spellcheck="false" maxlength="262144" rows="9" aria-describedby="projectBuildControlBudget projectBuildControlError"></textarea>
    <p id="projectBuildControlBudget" class="build-hint"></p><p id="projectBuildControlError" role="alert" hidden></p></details>
    <details id="projectBuildCaseEditor" class="build-control-editor" hidden><summary data-i18n="编辑运行验收"></summary>
    <p class="build-hint" data-i18n="按实例和步骤检查位置或状态；运行使用冻结构建，保存用例需明确操作。执行完成与验收通过分别显示。"></p>
    <div id="projectBuildCaseDocuments"></div>
    <button id="projectBuildCaseGenerate" type="button" class="doc-btn doc-btn-ghost" data-i18n="从完整控制采样生成验收"></button>
    <p id="projectBuildCaseHint" class="build-hint" data-i18n="可以粘贴验收 JSON，或先完成一次控制回放，再明确生成最后一步的预期检查。生成会替换当前验收文本。"></p>
    <label for="projectBuildCaseProgram" data-i18n="验收定义（JSON）"></label><textarea id="projectBuildCaseProgram" spellcheck="false" maxlength="262144" rows="9" aria-describedby="projectBuildCaseHint projectBuildCaseError"></textarea>
    <p id="projectBuildCaseError" role="alert" hidden></p></details>
    <div id="projectBuildSuites"></div>
    <div id="projectBuildCaseReport"></div>
    <section id="projectBuildCaseResult" class="build-case-result" hidden aria-labelledby="projectBuildCaseTitle"><h3 id="projectBuildCaseTitle" data-i18n="运行验收结果"></h3>
    <p id="projectBuildCaseSummary" role="status" aria-live="polite"></p><ul id="projectBuildCaseChecks"></ul></section>
    <p id="projectBuildStatus" role="status" aria-live="polite"></p><p id="projectBuildError" role="alert" hidden></p>
    <section id="projectBuildPlanSummary" class="build-summary" hidden aria-labelledby="projectBuildPlanTitle"><h3 id="projectBuildPlanTitle" data-i18n="构建计划"></h3><p id="projectBuildPlanCounts"></p><p id="projectBuildBehaviorCounts" hidden></p><p id="projectBuildSnapshot" class="build-monospace"></p></section>
    <p class="build-hint" data-i18n="先检查计划，再构建。测试与预览使用最近成功构建的快照；编辑后需重新构建。无头测试不验证画面。"></p>
    <section aria-labelledby="projectBuildDiagnosticsTitle"><h3 id="projectBuildDiagnosticsTitle" data-i18n="构建诊断"></h3><ul id="projectBuildDiagnostics"></ul></section>
    <p id="projectBuildEvents" hidden></p>
    <section id="projectBuildRuntimeObjects" class="build-runtime-objects" hidden aria-labelledby="projectBuildRuntimeObjectsTitle"><h3 id="projectBuildRuntimeObjectsTitle" data-i18n="运行对象"></h3>
    <p class="build-hint" data-i18n="只读查看本次运行收到的对象状态与位置样本；控制回放按步骤采样，不代表实时坐标。"></p>
    <p id="projectBuildRuntimePhase" role="status" aria-live="polite"></p>
    <label for="projectBuildRuntimeSearch" data-i18n="查找运行对象"></label><input id="projectBuildRuntimeSearch" type="search" maxlength="512" autocomplete="off" data-i18n-placeholder="按名称、实例或对象标识查找">
    <p id="projectBuildRuntimeCount"></p><p id="projectBuildRuntimeEmpty" hidden></p><ul id="projectBuildRuntimeObjectList"></ul></section>
    <section id="projectBuildBehaviorEvents" hidden aria-labelledby="projectBuildBehaviorEventsTitle"><h3 id="projectBuildBehaviorEventsTitle" data-i18n="行为事件"></h3><ul id="projectBuildBehaviorEventList"></ul></section>
    <details class="build-raw"><summary data-i18n="原始细节与日志"></summary><pre id="projectBuildLogs" tabindex="0"></pre></details></section>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#${id}`);
  const released = () => ({ left: false, right: false, up: false, down: false });
  const defaultControlProgram = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25,
    steps: [{ ...released(), right: true }, released(), { ...released(), left: true }, released()] });
  el('projectBuildControlProgram').value = JSON.stringify(defaultControlProgram(), null, 2);
  let controlError = '', controlTarget = '', controlTargetOwner = '';
  const hasControlCapability = () => Boolean(data?.backend?.capabilities?.includes('runtime.control-replay')
    && supportsExecution('headlessLogic'));
  const hasInstanceControlCapability = () => hasControlCapability()
    && Boolean(data?.backend?.capabilities?.includes('runtime.control-replay.instances'));
  function instanceControlTargets(requireInstanceCapability = true) {
    const build = matchedBuild();
    if (!(requireInstanceCapability ? hasInstanceControlCapability() : hasControlCapability()) || build?.planSchemaVersion !== 2 || !Array.isArray(build.controlTargets)
      || build.controlTargets.length < 1 || build.controlTargets.length > 128
      || Number.isSafeInteger(build.actorCount) && build.controlTargets.length !== build.actorCount) return [];
    const seen = new Set(), targets = [];
    const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
    for (const target of build.controlTargets) {
      if (!target || typeof target !== 'object' || Array.isArray(target) || !uuid(target.instanceId) || !uuid(target.objectId)
        || typeof target.name !== 'string' || seen.has(target.instanceId)) return [];
      seen.add(target.instanceId); targets.push(target);
    }
    return targets;
  }
  const controlSceneSupported = () => {
    const version = matchedBuild()?.planSchemaVersion;
    return version === undefined ? !(planScene === selected && Number.isSafeInteger(plan?.behaviorBindingCount)) : [1, 2].includes(version);
  };
  function readControlProgram() {
    let input;
    try { input = JSON.parse(el('projectBuildControlProgram').value); }
    catch { throw Object.assign(new Error('Invalid control JSON.'), { errorCode: 'runtime_control_json' }); }
    const program = validateSceneControlProgram(input);
    if (program.schemaVersion === 2) {
      const targets = instanceControlTargets();
      if (!targets.length) throw Object.assign(new Error('Instance replay is not supported by this frozen build.'), { errorCode: 'runtime_control_unsupported' });
      validateSceneControlPlan({ format: 'viento-build-plan', kind: 'scene2d', schemaVersion: 2,
        scene: { objectId: selected, sourcePath: selectedScene()?.sourcePath },
        actors: targets.map(target => ({ instanceId: target.instanceId, objectId: target.objectId })) }, program);
    }
    const actorCount = matchedBuild()?.actorCount ?? (planScene === selected ? plan?.actorCount : undefined);
    if (Number.isSafeInteger(actorCount) && actorCount * program.steps.length > 1024) {
      throw Object.assign(new Error('Control sample budget exceeded.'), { errorCode: 'runtime_control_limit' });
    }
    return program;
  }
  function renderControlProgram() {
    const supported = hasControlCapability();
    el('projectBuildControl').hidden = !supported;
    el('projectBuildControl').disabled = !mayStart('run', 'headless') || !supported || !controlSceneSupported();
    el('projectBuildControlEditor').hidden = !supported;
    const build = matchedBuild(), targets = instanceControlTargets(), targetPicker = el('projectBuildControlTarget');
    const owner = build ? JSON.stringify([acceptedBackend, build.id, build.snapshotId, selected]) : '';
    if (controlTargetOwner !== owner) { controlTargetOwner = owner; controlTarget = ''; }
    if (controlTarget && !targets.some(target => target.instanceId === controlTarget)) controlTarget = '';
    const signature = JSON.stringify([owner, targets, t('全部方向键实例（全局）')]);
    if (targetPicker.dataset.targets !== signature) {
      targetPicker.replaceChildren();
      const global = node('option', t('全部方向键实例（全局）')); global.value = ''; targetPicker.append(global);
      for (const target of targets) {
        const name = target.name.slice(0, 160);
        const option = node('option', `${target.instanceId.slice(-8)} · ${name}`);
        option.value = target.instanceId; option.title = `${name} · ${target.instanceId}`; targetPicker.append(option);
      }
      targetPicker.dataset.targets = signature;
    }
    targetPicker.value = controlTarget;
    targetPicker.disabled = !mayStart('run', 'headless') || !controlSceneSupported();
    el('projectBuildControlExample').disabled = !mayStart('run', 'headless') || !controlSceneSupported()
      || Boolean(controlTarget && !targets.some(target => target.instanceId === controlTarget));
    let instanceProgram = Boolean(controlTarget);
    try { instanceProgram ||= JSON.parse(el('projectBuildControlProgram').value)?.schemaVersion === 2; } catch { /* Local partial JSON is retained. */ }
    el('projectBuildControlTargetHint').hidden = !instanceProgram;
    let budget = t('步长大于 0 且不超过 0.25 秒；1–64 步，总时长不超过 8 秒，最后一步释放全部方向键。每次最多 1024 个对象样本。');
    try {
      const program = readControlProgram();
      budget = t('{0} 步 · 每步 {1} 秒 · 共 {2} 秒', program.steps.length, program.fixedDelta,
        Number((program.steps.length * program.fixedDelta).toFixed(6)));
    } catch { /* Keep local input and its selection intact while polling. */ }
    el('projectBuildControlBudget').textContent = budget;
    el('projectBuildControlError').hidden = !controlError;
    el('projectBuildControlError').textContent = controlError ? t(controlError) : '';
  }
  let caseError = '', caseDocuments = null, caseSuites = null, caseReport = null;
  function runtimeCasePlan() {
    const targets = instanceControlTargets(false);
    return targets.length ? { format: 'viento-build-plan', kind: 'scene2d', schemaVersion: 2,
      scene: { objectId: selected, sourcePath: selectedScene()?.sourcePath },
      actors: targets.map(({ instanceId, objectId }) => ({ instanceId, objectId })) } : null;
  }
  function readRuntimeCase() {
    const text = el('projectBuildCaseProgram').value;
    if (new TextEncoder().encode(text).length > 262144) throw Object.assign(new Error('Runtime case input is too large.'), { errorCode: 'runtime_case_limit' });
    let value;
    try { value = JSON.parse(text); }
    catch { throw Object.assign(new Error('Invalid verification JSON.'), { errorCode: 'runtime_case_json' }); }
    const definition = validateRuntimeCase(value), frozenPlan = runtimeCasePlan();
    if (!frozenPlan || definition.program.schemaVersion === 2 && !hasInstanceControlCapability()) {
      throw Object.assign(new Error('Runtime verification is not supported by this build.'), { errorCode: 'runtime_case_unsupported' });
    }
    return validateRuntimeCasePlan(frozenPlan, definition);
  }
  function sampledRuntimeCase() {
    const job = data?.job, build = matchedBuild(), frozenPlan = runtimeCasePlan();
    if (!frozenPlan || job?.kind !== 'run' || job.status !== 'succeeded' || job.buildId !== build?.id
      || job.backendId !== data?.backend?.id || job.snapshotId !== build.snapshotId || job.runtime?.phase !== 'finished'
      || !Array.isArray(job.control?.samples)) return null;
    try {
      const program = validateSceneControlProgram(job.control.program), samples = job.control.samples;
      if (samples.length !== program.steps.length) return null;
      const last = samples.at(-1);
      const definition = validateRuntimeCasePlan(frozenPlan, { format: 'viento-runtime-case', schemaVersion: 1, program,
        checks: last.actors.map(actor => ({ instanceId: actor.instanceId, stepIndex: last.stepIndex,
          position: { value: actor.position, tolerance: 0.0001 }, state: actor.state })) });
      return evaluateRuntimeCase(frozenPlan, definition, samples, { complete: true }).status === 'passed' ? definition : null;
    } catch { return null; }
  }
  function renderRuntimeCase() {
    const supported = Boolean(runtimeCasePlan()), permitted = mayStart('run', 'headless') && supported;
    el('projectBuildCaseRun').hidden = !hasControlCapability();
    el('projectBuildCaseRun').disabled = !permitted || Boolean(caseDocuments && !caseDocuments.runAllowed());
    el('projectBuildCaseEditor').hidden = !selectedScene();
    el('projectBuildCaseGenerate').disabled = !permitted || !sampledRuntimeCase();
    el('projectBuildCaseError').hidden = !caseError;
    el('projectBuildCaseError').textContent = caseError ? t(caseError) : '';
    const job = data?.job, verification = job?.verification, list = el('projectBuildCaseChecks');
    list.replaceChildren();
    el('projectBuildCaseResult').hidden = job?.kind !== 'run' || !verification || job.buildId !== matchedBuild()?.id || job.backendId !== data?.backend?.id;
    if (el('projectBuildCaseResult').hidden) return;
    try {
      const definition = validateRuntimeCasePlan(runtimeCasePlan(), verification.definition);
      const evaluation = evaluateRuntimeCase(runtimeCasePlan(), definition, job.control?.samples || [],
        { complete: job.status === 'succeeded' && verification.evaluation?.complete === true });
      if (canonicalJson(evaluation) !== canonicalJson(verification.evaluation)) throw new Error('Invalid verification result.');
      const statuses = { passed: '验收通过', failed: '验收未通过', incomplete: '验收未完成' };
      el('projectBuildCaseSummary').textContent = t('{0} · 通过 {1} · 未通过 {2} · 无样本 {3}',
        t(statuses[evaluation.status]), evaluation.passedChecks, evaluation.failedChecks, evaluation.unavailableChecks);
      for (const check of evaluation.checks) {
        const item = node('li', '', 'build-case-check');
        item.append(node('p', t('实例 {0} · 第 {1} 步 · {2}', check.instanceId, check.stepIndex + 1,
          t({ passed: '检查通过', failed: '检查未通过', unavailable: '缺少有效样本' }[check.status]))));
        item.append(node('p', t('预期：{0}', JSON.stringify(check.expected)), 'build-monospace'));
        item.append(node('p', check.actual ? t('实际：{0}', JSON.stringify(check.actual)) : t('缺少有效样本'), 'build-monospace'));
        list.append(item);
      }
    } catch { el('projectBuildCaseSummary').textContent = t('验收结果不可读取，请刷新状态。'); }
  }
  let available = false, creationSupported = false, updateSupported = false, data = null, selected = '', requestBusy = false, timer = null, requestEpoch = 0;
  let toolCheckBusy = false;
  let previewSupported = false, activeTab = 'build';
  const selections = { build: '', preview: '' };
  const previewDocuments = () => data?.previewDocuments || (data?.scenes || []).map(scene => ({ ...scene, kind: 'scene' }));
  const documentsForTab = () => activeTab === 'preview' ? previewDocuments() : data?.scenes || [];
  const selectedScene = () => data?.scenes?.find(scene => scene.id === selected);
  const selectedDocument = () => previewDocuments().find(item => item.id === selected);
  function selectDocument() {
    const documents = documentsForTab();
    selected = documents.find(item => item.id === selections[activeTab])?.id
      || documents.find(item => item.sourcePath === getContext().path)?.id || documents[0]?.id || '';
    selections[activeTab] = selected;
  }
  let dialogSession = 0, handledCloseSession = -1, sourceNavigationEpoch = 0, pendingSourceFocus = null;
  let errorMessage = '', errorDetails = '', plan = null, planScene = '', planJob = '', cancelling = false, invalidatedPlanJob = '', invalidatedSnapshot = '';
  let acceptedBackend = null, planBackend = '';
  const invalidatedBackendJobs = new Set(), invalidatedBuilds = new Set();
  const invalidatedRuntimeJobs = new Set();
  let runtimeOwner = '', runtimeSearch = '', runtimeCardSignature = '';
  const backendSignature = backend => {
    try { return canonicalJson(backend ?? null); } catch { return ''; }
  };
  const backendUnchanged = () => acceptedBackend === backendSignature(data?.backend);
  const supportsExecution = operation => canExecuteBackend(data?.backend, operation, data?.platform);
  const sceneApplied = async result => {
    let refreshError;
    try { await applied(result); } catch (error) { refreshError = error; }
    const createdId = result.object?.id || result.changes?.[0]?.objectId;
    selected = createdId || selected; selections[activeTab] = selected; invalidatedPlanJob = planJob || (data?.job?.kind === 'plan' ? data.job.id : '');
    invalidatedSnapshot = plan?.snapshotId || data?.job?.plan?.snapshotId || ''; plan = null; planScene = '';
    scenePreview.invalidate();
    await refresh(true);
    if (refreshError) throw refreshError;
    if (errorMessage || !data?.scenes.some(scene => scene.id === createdId)) throw new Error(t('场景已创建，但目录或构建列表刷新失败。请刷新核对，勿重复创建。'));
  };
  const sceneCreator = setupSceneCreate({ getContext, setBusy: value => { setBusy(value); render(); }, applied: sceneApplied });
  const running = () => data?.job?.status === 'running';
  const catalogUnavailable = () => data?.catalogDiagnostic?.code === 'build_catalog_unavailable';
  const checkingTool = () => toolCheckBusy || data?.toolStatus?.status === 'checking';
  const mayCheckTool = () => activeTab === 'build' && available && data?.supported && Boolean(data?.toolStatus)
    && !requestBusy && !running() && !checkingTool() && !caseDocuments?.isBusy() && !caseSuites?.isBusy();
  const ready = () => {
    const context = getContext();
    return available && data?.supported && context.editable && !context.dirty && !context.creating && !context.busy;
  };
  const editScene = () => {
    if (updateSupported && selectedScene() && !requestBusy && !running() && ready()) sceneCreator.open(selected, { mode: 'edit' });
  };
  async function navigateSource(...args) {
    return navigateOwnedSource(args);
  }
  async function navigateOwnedSource(args, isCurrent = () => true) {
    const session = dialogSession, epoch = ++sourceNavigationEpoch;
    const owns = () => dialog.open && dialogSession === session && sourceNavigationEpoch === epoch && isCurrent();
    try {
      if (!owns()) return false;
      const opened = await openSource(...args);
      if (!owns()) return false;
      if (opened !== false) {
        pendingSourceFocus = typeof opened?.focus === 'function' ? { session, epoch, focus: opened.focus } : null;
        dialog.close();
      }
      return opened;
    } catch (error) {
      if (!owns()) return false;
      throw error;
    }
  }
  const canEditDraftLayout = () => {
    const context = getContext(), scene = data?.scenes?.find(item => item.id === selected);
    return Boolean(previewSupported && scene && context.sceneDraftPath === scene.sourcePath && context.sceneDraftWritable
      && context.editable && context.dirty && !context.creating && !context.busy && !requestBusy && !running());
  };
  const canEditCompositionOverride = () => {
    const context = getContext(), recipe = selectedDocument();
    return Boolean(previewSupported && supportsStudioCoreCompositionPatch() && activeTab === 'preview' && recipe?.kind === 'composition'
      && context.sceneDraftPath === recipe.sourcePath && context.compositionSourceWritable === true
      && context.editable && !context.creating && !context.busy && !requestBusy && !running());
  };
  let pendingCompositionApply = null;
  const scenePreview = setupScenePreview({
    container: el('projectBuildPreviewPanel'),
    getContext: () => {
      const context = getContext(), scene = selectedDocument();
      return { ...context, previewKind: scene?.kind, canEditScene: Boolean(updateSupported && selectedScene() && !requestBusy && !running() && ready()),
        canEditDraftLayout: canEditDraftLayout(),
        canEditCompositionOverride: canEditCompositionOverride(),
        canPreviewDraft: Boolean(previewSupported && scene && context.sceneDraftPath === scene.sourcePath
          && context.editable && context.dirty && !context.creating && !context.busy) };
    },
    getDraft: async id => {
      const scene = previewDocuments().find(item => item.id === id);
      return scene && selected === id ? getSceneDraft(scene.sourcePath) : null;
    },
    editScene,
    editLayout: input => selectedScene() && !input.model?.composition && input.model?.scene?.objectId === selected ? sceneLayout.open(input) : false,
    editDraftLayout: async input => {
      const session = dialogSession, sceneId = selected, path = input.model?.scene?.sourcePath;
      const owns = () => dialog.open && session === dialogSession && selected === sceneId && canEditDraftLayout()
        && data?.scenes?.some(scene => scene.id === sceneId && scene.sourcePath === path) && input.isCurrent();
      if (input.model?.composition || input.model?.scene?.objectId !== sceneId || !owns()) return false;
      const source = await getSceneDraft(path);
      if (!source || !owns()) return false;
      return sceneLayout.openSource({ ...input, source, isCurrent: owns });
    },
    editCompositionOverride: async input => {
      const session = dialogSession, recipeId = selected, path = input.model?.scene?.sourcePath;
      const owns = () => dialog.open && session === dialogSession && selected === recipeId && canEditCompositionOverride()
        && selectedDocument()?.sourcePath === path && input.isCurrent();
      if (!input.model?.composition || input.model.scene.objectId !== recipeId || !owns()) return false;
      const source = await getCompositionSource(path);
      if (!source || !owns()) return false;
      const { payload } = await fetchJsonApiRequest(WORLD_API_PATH, { cache: 'no-store' }, 15000, t('读取世界'));
      if (!owns()) return false;
      const images = (payload?.resources || []).filter(resource => resource.descriptor?.kind === 'image'
        && resource.availability === 'present-unverified' && /\.(png|jpe?g|webp|svg)$/i.test(resource.descriptor.location?.path || ''))
        .map(resource => ({ id: resource.id, name: resource.descriptor.name, path: resource.descriptor.location.path }));
      return compositionOverrides.open({ ...input, source, images, isCurrent: owns });
    },
    openSource: navigateSource,
  });
  const sceneLayout = setupSceneLayout({
    getContext: () => ({ ...getContext(), canEditDraftLayout: canEditDraftLayout(), canEditScene: Boolean(updateSupported && selectedScene() && !requestBusy && !running() && ready()) }),
    setBusy: value => { setBusy(value); render(); }, applied: sceneApplied,
    applySourceDraft: async (proposal, { isCurrent = () => true } = {}) => {
      const session = dialogSession, sceneId = selected;
      const owns = () => dialog.open && session === dialogSession && selected === sceneId && canEditDraftLayout()
        && data?.scenes?.some(scene => scene.id === sceneId && scene.id === proposal.sceneId && scene.sourcePath === proposal.sourcePath)
        && isCurrent();
      if (!owns()) throw Object.assign(new Error('The selected scene draft changed.'), { errorCode: 'scene_source_layout_conflict' });
      return applySceneDraft(proposal, { isCurrent: owns });
    },
    sourceApplied: () => scenePreview.refreshDraft(),
    reload: () => scenePreview.invalidate(),
  });
  const compositionOverrides = setupSceneCompositionOverrides({
    getContext: () => ({ ...getContext(), canEditCompositionOverride: canEditCompositionOverride() }),
    validateDraft: async (proposal, { isCurrent = () => true } = {}) => {
      const session = dialogSession, recipeId = selected, sourceToken = getContext().sceneDraftToken;
      const conflict = () => { throw Object.assign(new Error('The composition preview owner changed.'), { errorCode: 'scene_composition_override_conflict' }); };
      const owns = () => dialog.open && session === dialogSession && selected === recipeId && canEditCompositionOverride()
        && getContext().sceneDraftToken === sourceToken && isCurrent()
        && recipeId === proposal.sceneId && selectedDocument()?.sourcePath === proposal.sourcePath;
      if (!owns()) conflict();
      let previewId;
      try {
        const { payload } = await fetchJsonApiRequest(SCENE_PREVIEW_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: recipeId, draft: { sourcePath: proposal.sourcePath, baseSourceRevision: proposal.baseSourceRevision, content: proposal.afterContent } }) }, 15000, t('正在检查配方与素材…'));
        if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(payload?.previewId || '')) previewId = payload.previewId;
        if (!owns()) conflict();
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proposal.afterContent));
        const expected = `sha256:${[...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
        if (!owns()) conflict();
        if (payload?.ok !== true || payload.format !== 'viento-scene-preview' || payload.schemaVersion !== 2 || !previewId
          || Object.hasOwn(payload, 'sceneEditing') || Object.hasOwn(payload, 'snapshot')
          || payload.scene?.objectId !== recipeId || payload.scene.sourcePath !== proposal.sourcePath || payload.scene.sourceRevision !== expected
          || payload.composition?.format !== 'viento-scene-composition-preview' || payload.composition.schemaVersion !== 1
          || payload.composition.recipeObjectId !== recipeId || payload.composition.sourcePath !== proposal.sourcePath || payload.composition.sourceRevision !== expected
          || !Number.isInteger(payload.composition.fragmentCount) || payload.composition.fragmentCount < 1 || payload.composition.fragmentCount > 32
          || !Number.isInteger(payload.composition.placementCount) || payload.composition.placementCount < 1 || payload.composition.placementCount > 128
          || payload.draft?.baseSourceRevision !== proposal.baseSourceRevision || payload.draft.sourceRevision !== expected
          || !Array.isArray(payload.actors) || !payload.actors.some(actor => actor.instanceId === proposal.instanceId)) {
          throw Object.assign(new Error('Composition validation did not match the reviewed source.'), { errorCode: 'scene_composition_override_invalid', payload });
        }
        return { ok: true };
      } finally {
        if (previewId) void fetchJsonApiRequest(`${SCENE_PREVIEW_API_PATH}?previewId=${encodeURIComponent(previewId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }, 5000, t('释放场景预览')).catch(() => {});
      }
    },
    applySourceDraft: async (proposal, { isCurrent = () => true } = {}) => {
      const session = dialogSession, recipeId = selected;
      const owns = () => dialog.open && session === dialogSession && selected === recipeId && canEditCompositionOverride()
        && selectedDocument()?.sourcePath === proposal.sourcePath && recipeId === proposal.sceneId && isCurrent();
      if (!owns()) throw Object.assign(new Error('The selected recipe source changed.'), { errorCode: 'scene_composition_override_conflict' });
      const result = await applyCompositionDraft(proposal, { isCurrent: owns });
      if (result?.applied === true) pendingCompositionApply = { session, recipeId, sourcePath: proposal.sourcePath, result };
      return result;
    },
    sourceApplied: (result, proposal) => {
      const pending = pendingCompositionApply; pendingCompositionApply = null;
      if (!pending || !dialog.open || pending.session !== dialogSession || selected !== pending.recipeId
        || proposal.sceneId !== pending.recipeId || proposal.sourcePath !== pending.sourcePath || result !== pending.result) return;
      const epoch = ++sourceNavigationEpoch;
      pendingSourceFocus = typeof result.focus === 'function' ? { session: dialogSession, epoch, focus: result.focus } : null;
      scenePreview.invalidate(); dialog.close();
    },
  });
  const node = (tag, text, className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
  const matchedBuild = () => backendUnchanged() && data?.latestBuild?.sceneId === selected
    && typeof data.latestBuild.id === 'string' && data.latestBuild.id.length > 0
    && data.latestBuild.backendId === data?.backend?.id && !invalidatedBuilds.has(data.latestBuild.id) ? data.latestBuild : null;
  function runtimeObservation() {
    const job = data?.job, build = matchedBuild();
    if (!available || !data?.supported || activeTab !== 'build' || !['run', 'suite'].includes(job?.kind) || !job.runtime || !build
      || !supportsExecution('headlessLogic') && !supportsExecution('windowPreview')
      || typeof job.id !== 'string' || !job.id || invalidatedRuntimeJobs.has(job.id)
      || job.sceneId !== selected || job.backendId !== data?.backend?.id
      || job.buildId !== build.id || job.snapshotId !== build.snapshotId
      || !/^sha256:[a-f0-9]{64}$/.test(job.snapshotId || '')) return null;
    try {
      const view = querySceneRuntimeObservation(job.runtime);
      if (view.sceneObjectId !== selected || !data.backend.plans.some(item => item.kind === 'scene2d'
        && item.runtimeProtocolVersion === view.protocolVersion)) return null;
      return { view, owner: JSON.stringify([acceptedBackend, job.id, job.buildId, job.snapshotId, selected]) };
    } catch { return null; }
  }
  const mayOpenRuntimeSource = () => {
    const context = getContext();
    return dialog.open && !context.dirty && !context.creating && !context.busy;
  };
  function renderRuntimeObjects() {
    const observation = runtimeObservation(), owner = observation?.owner || '';
    const panel = el('projectBuildRuntimeObjects'), input = el('projectBuildRuntimeSearch'), list = el('projectBuildRuntimeObjectList');
    if (runtimeOwner !== owner) { runtimeOwner = owner; runtimeSearch = ''; input.value = ''; runtimeCardSignature = ''; }
    panel.hidden = !observation;
    el('projectBuildRuntimeEmpty').hidden = true;
    if (!observation) {
      runtimeCardSignature = ''; list.replaceChildren();
      el('projectBuildRuntimePhase').textContent = ''; el('projectBuildRuntimeCount').textContent = '';
      return;
    }
    input.setAttribute('placeholder', t('按名称、实例或对象标识查找'));
    const view = observation.view, search = runtimeSearch.trim().toLowerCase();
    const actors = view.actors.filter(actor => [actor.name, actor.instanceId || '', actor.objectId]
      .some(value => value.toLowerCase().includes(search)));
    const phases = { waiting: '等待启动位置样本。', ready: '已收到启动样本；状态变化不会更新位置。', finished: '已收到结束位置样本。' };
    el('projectBuildRuntimePhase').textContent = view.control
      ? t('控制回放：已收到 {0} / {1} 步 · 每步 {2} 秒', view.control.completedSteps, view.control.stepCount, view.control.fixedDelta)
        + ` · ${t(view.phase === 'finished' ? phases.finished : view.phase === 'waiting' ? phases.waiting : '位置显示最近收到的控制步骤样本。')}`
      : t(phases[view.phase]);
    el('projectBuildRuntimeCount').textContent = t('显示 {0} / {1} 个运行对象', actors.length, view.actors.length);
    el('projectBuildRuntimeEmpty').hidden = actors.length > 0;
    el('projectBuildRuntimeEmpty').textContent = t(view.actors.length ? '没有匹配的运行对象。' : '本次运行没有对象。');
    const signature = JSON.stringify([owner, view, search, mayOpenRuntimeSource(), t('运行对象')]);
    // A status poll should not detach a focused source button. Rebuild cards
    // only when observations, search, language or navigation guards change.
    if (runtimeCardSignature === signature) return;
    runtimeCardSignature = signature;
    const focusedRow = list.children && [...list.children].find(item => item.querySelector('.build-runtime-source') === document.activeElement);
    const focusedIdentity = focusedRow?.dataset.instanceId || focusedRow?.dataset.objectId;
    list.replaceChildren();
    for (const actor of actors) {
      const item = node('li', '', 'build-runtime-object');
      item.dataset.objectId = actor.objectId;
      if (actor.instanceId) item.dataset.instanceId = actor.instanceId;
      item.append(node('h4', actor.name));
      if (actor.instanceId) item.append(node('p', t('实例标识：{0}', actor.instanceId), 'build-monospace'));
      item.append(node('p', t('对象标识：{0}', actor.objectId), 'build-monospace'));
      item.append(node('p', t('状态：{0}', t(actor.state === 'idle' ? '静止' : actor.state === 'moving' ? '移动中' : '等待状态样本')), 'build-runtime-state'));
      item.append(node('p', actor.position === null ? t('尚未收到位置样本。') : t('位置样本：({0}, {1})', ...actor.position), 'build-runtime-position'));
      const sample = actor.positionSample === null ? '等待启动样本' : actor.positionSample === 'finished' ? '结束样本'
        : actor.positionCurrent ? '启动样本' : '启动样本 · 状态已变化，位置未更新';
      const sampleLabel = actor.positionSample === 'control' ? t(actor.positionCurrent
        ? '控制步骤 {0} 的位置样本' : '控制步骤 {0} 的样本 · 状态已变化，位置未更新', actor.positionStep + 1)
        : actor.positionSample === 'finished' && Number.isSafeInteger(actor.positionStep)
          ? t('结束样本 · 控制步骤 {0}', actor.positionStep + 1) : t(sample);
      item.append(node('p', sampleLabel, 'build-runtime-sample'));
      const source = node('button', t(actor.instanceId ? '打开实例声明' : '打开对象声明'), 'doc-btn doc-btn-ghost build-runtime-source');
      source.type = 'button'; source.disabled = !mayOpenRuntimeSource();
      source.addEventListener('click', async () => {
        const isCurrent = () => runtimeObservation()?.owner === owner && mayOpenRuntimeSource();
        if (!isCurrent()) { renderRuntimeObjects(); return; }
        try { await navigateOwnedSource([actor.source.sourcePath, actor.source], isCurrent); }
        catch { if (isCurrent()) { errorMessage = t('无法打开原文，请返回编辑器查找该文档。'); render(); } }
      });
      item.append(source); list.append(item);
    }
    if (focusedIdentity) {
      const row = [...list.children].find(item => (item.dataset.instanceId || item.dataset.objectId) === focusedIdentity);
      const source = row?.querySelector('.build-runtime-source');
      if (source && !source.disabled) source.focus();
    }
  }
  const mayStart = (action, mode) => activeTab === 'build' && !errorMessage && !requestBusy && !running() && !checkingTool() && !caseDocuments?.isBusy() && !caseSuites?.isBusy() && ready() && Boolean(selectedScene())
    && (action === 'run' || !catalogUnavailable())
    && (action === 'plan' || data.available && backendUnchanged() && (action === 'build'
      ? supportsExecution('build') && planBackend === acceptedBackend && planScene === selected && Boolean(plan)
      : action === 'run' && supportsExecution(mode === 'headless' ? 'headlessLogic' : mode === 'window' ? 'windowPreview' : '') && Boolean(matchedBuild())));
  const friendly = code => t(errorLabels[code] || (typeof code === 'string' && /^(?:build_|runtime_)?behavior_/.test(code)
    ? '行为绑定或脚本有误，请检查标出的位置和原始日志。' : '构建请求未完成，请刷新状态核对结果。'));
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
    el('projectBuildCapabilities').hidden = activeTab === 'preview';
    el('projectBuildAvailability').hidden = activeTab === 'preview';
    el('projectBuildToolCheck').hidden = activeTab === 'preview' || !data?.toolStatus;
    el('projectBuildCatalogDiagnostic').hidden = activeTab === 'preview' || !catalogUnavailable();
    el('projectBuildPreviewPanel').hidden = activeTab !== 'preview';
    el('projectBuildTaskPanel').hidden = activeTab !== 'build';
    scenePreview.setScene(selected);
    scenePreview.setVisible(Boolean(dialog.open && previewSupported && activeTab === 'preview'));
    compositionOverrides.refresh?.();
    button.textContent = active ? t('构建与运行 · 进行中') : t('构建与运行');
    button.setAttribute('aria-label', button.textContent);
    button.dataset.running = String(active);
    dialog.setAttribute('aria-busy', String(requestBusy || active || checkingTool()));
    el('projectBuildBackend').textContent = data?.backend ? `${data.backend.label || data.backend.id} · ${data.backend.version || ''}` : t('实验构建后端');
    const abilities = Object.entries(capabilityLabels).filter(([operation]) => supportsExecution(operation)).map(([, label]) => t(label));
    el('projectBuildCapabilities').textContent = abilities.length ? t('已声明能力：{0}', abilities.join(' · ')) : t('尚未声明可用的执行能力。');
    const checkedTool = data?.toolStatus;
    el('projectBuildAvailability').textContent = checkingTool() ? t('正在检查工具身份…')
      : checkedTool?.status === 'ready' ? t('工具身份已确认：{0}。执行时仍会重新核对。', checkedTool.identity.version)
        : toolReasonLabels[checkedTool?.reason || data?.reason] ? t(toolReasonLabels[checkedTool?.reason || data?.reason])
          : checkedTool?.status === 'unchecked' ? t('工具身份尚未检查。') : '';
    el('projectBuildToolCheck').disabled = !mayCheckTool();
    el('projectBuildDraft').hidden = activeTab === 'preview' || !context.dirty && !context.creating;
    const scenes = documentsForTab(), picker = el('projectBuildScene');
    el('projectBuildSceneLabel').textContent = t(activeTab === 'preview' ? '预览文档' : '构建场景文档');
    // Keep the focused option stable during polling; re-populating a select can close its popup.
    const signature = JSON.stringify(scenes);
    if (picker.dataset.scenes !== signature) {
      picker.replaceChildren();
      for (const scene of scenes) { const option = node('option', `${scene.title} · ${scene.sourcePath}`); option.value = scene.id; picker.append(option); }
      picker.dataset.scenes = signature;
    }
    picker.value = selected; picker.disabled = requestBusy || active || !scenes.length;
    el('projectBuildEmpty').hidden = !data || scenes.length > 0;
    el('projectBuildEmpty').textContent = t(activeTab === 'preview' ? '暂无可预览场景或配方。请添加已登记的场景或场景配方 JSON 文档。' : creationSupported ? '暂无可构建场景。点击创建场景，选择已有对象开始。' : '暂无可构建场景。请添加已登记的 viento-scene2d JSON 场景文档。');
    el('projectBuildRefresh').disabled = requestBusy;
    el('projectBuildEditScene').hidden = activeTab === 'preview' || !updateSupported;
    el('projectBuildEditScene').disabled = requestBusy || running() || !ready() || !selectedScene();
    el('projectBuildCreateScene').hidden = activeTab === 'preview' || !creationSupported;
    el('projectBuildCreateScene').disabled = requestBusy || running() || !ready();
    el('projectBuildPlan').disabled = !mayStart('plan');
    el('projectBuildGenerate').disabled = !mayStart('build');
    el('projectBuildHeadless').disabled = !mayStart('run', 'headless'); el('projectBuildWindow').disabled = !mayStart('run', 'window');
    renderControlProgram();
    renderRuntimeCase();
    caseDocuments?.render();
    caseSuites?.render();
    caseReport?.render();
    el('projectBuildCancel').hidden = !active;
    el('projectBuildCancel').disabled = requestBusy || cancelling;
    el('projectBuildStatus').textContent = requestBusy ? t('正在读取构建状态…') : job
      ? `${t(kindLabels[job.kind] || '构建任务')} · ${t(statusLabels[job.status] || '进行中')}${active ? ` · ${t(phaseLabels[job.phase] || '任务正在运行…')}` : ''}` : t('请选择场景并检查计划。');
    el('projectBuildError').hidden = !errorMessage; el('projectBuildError').textContent = errorMessage;
    const summary = planScene === selected ? plan : null;
    el('projectBuildPlanSummary').hidden = !summary;
    el('projectBuildPlanCounts').textContent = summary ? t('{0} · {1} 个角色 · {2} 个资源', summary.title, summary.actorCount, summary.resourceCount) : '';
    const hasBehaviorCounts = Number.isSafeInteger(summary?.behaviorBindingCount) && summary.behaviorBindingCount >= 0
      && Number.isSafeInteger(summary?.behaviorSourceCount) && summary.behaviorSourceCount >= 0;
    el('projectBuildBehaviorCounts').hidden = !hasBehaviorCounts;
    el('projectBuildBehaviorCounts').textContent = hasBehaviorCounts ? t('{0} 个行为绑定 · {1} 份行为源码', summary.behaviorBindingCount, summary.behaviorSourceCount) : '';
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
            await navigateSource(diagnostic.sourcePath, diagnostic);
          } catch { errorMessage = t('无法打开原文，请返回编辑器查找该文档。'); render(); }
        });
        item.append(link);
      }
      diagnostics.append(item);
    }
    if (!diagnostics.children.length) diagnostics.append(node('li', t('暂无构建诊断。')));
    el('projectBuildEvents').hidden = !job?.events?.length;
    el('projectBuildEvents').textContent = t('已收到 {0} 条运行事件；完整内容见原始细节。', job?.events?.length || 0);
    renderRuntimeObjects();
    const behaviorEvents = el('projectBuildBehaviorEventList'); behaviorEvents.replaceChildren();
    for (const event of job?.events || []) {
      // Display only the admitted scalar event DTO. Script text and parameters
      // are data here; compilation and execution belong to the host backend.
      if (event?.event !== 'behavior' || !['instanceId', 'bindingId', 'name'].every(key => typeof event[key] === 'string')
        || !Array.isArray(event.arguments) || !event.arguments.every(value => value === null || typeof value === 'string'
          || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))) continue;
      behaviorEvents.append(node('li', t('实例 {0} · 行为 {1} · 事件 {2} · 参数 {3}', event.instanceId, event.bindingId, event.name,
        JSON.stringify(event.arguments)), 'build-monospace'));
    }
    el('projectBuildBehaviorEvents').hidden = !behaviorEvents.children.length;
    el('projectBuildLogs').textContent = [errorDetails, ...(job?.diagnostics || []).map(item => JSON.stringify(item, null, 2)),
      ...(job?.events || []).map(item => JSON.stringify(item)), job?.logs || ''].filter(Boolean).join('\n\n') || t('暂无日志。');
  }
  function schedule() {
    clearTimeout(timer); timer = null;
    if (available && (running() || checkingTool())) timer = setTimeout(() => { timer = null; void refresh(); }, errorMessage ? 3000 : 1000);
  }
  function accept(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.scenes)) throw new Error('Invalid build state');
    if (payload.previewDocuments !== undefined && !Array.isArray(payload.previewDocuments)) throw new Error('Invalid preview documents');
    if (payload.catalogDiagnostic !== undefined && payload.catalogDiagnostic !== null
      && (typeof payload.catalogDiagnostic !== 'object' || Array.isArray(payload.catalogDiagnostic)
        || Object.keys(payload.catalogDiagnostic).length !== 1 || payload.catalogDiagnostic.code !== 'build_catalog_unavailable')) throw new Error('Invalid catalog diagnostic');
    if (payload.toolStatus !== undefined) {
      const checkedTool = validateExecutionToolStatus(payload.toolStatus);
      if (checkedTool.backendId !== payload.backend?.id) throw new Error('Invalid tool backend identity');
      payload = { ...payload, toolStatus: checkedTool };
    }
    const nextBackend = backendSignature(payload.backend);
    if (acceptedBackend !== null && nextBackend !== acceptedBackend) {
      if (['run', 'suite'].includes(data?.job?.kind) && data.job.id) invalidatedRuntimeJobs.add(data.job.id);
      for (const id of [planJob, data?.job?.kind === 'plan' && data.job.id, payload.job?.kind === 'plan' && payload.job.id]) if (id) invalidatedBackendJobs.add(id);
      for (const id of [data?.latestBuild?.id, payload.latestBuild?.id]) if (id) invalidatedBuilds.add(id);
      plan = null; planScene = ''; planJob = ''; planBackend = '';
    }
    acceptedBackend = nextBackend;
    const previous = selected; data = payload; selectDocument();
    if (activeTab === 'build' && previous !== selected) { plan = null; planScene = ''; }
    if (payload.job?.kind === 'plan') {
      if (payload.job.status === 'succeeded' && payload.job.plan && typeof payload.job.id === 'string' && payload.job.id.length > 0
        && payload.job.backendId === payload.backend?.id
        && !invalidatedBackendJobs.has(payload.job.id)
        && (invalidatedPlanJob ? payload.job.id !== invalidatedPlanJob : !invalidatedSnapshot || payload.job.plan.snapshotId !== invalidatedSnapshot)) {
        plan = payload.job.plan; planScene = payload.job.sceneId; planJob = payload.job.id || ''; planBackend = acceptedBackend;
      }
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
  async function submit(action, mode, replay = false, verify = false) {
    if (action === 'cancel' ? !running() || requestBusy || cancelling : !mayStart(action, mode)) { render(); return; }
    let controlProgram, runtimeCase;
    if (verify) {
      if (caseDocuments && !caseDocuments.runAllowed()) { render(); return; }
      try { runtimeCase = readRuntimeCase(); caseError = ''; }
      catch (error) {
        caseError = error.errorCode === 'runtime_case_json' ? '验收定义不是有效的 JSON，请检查后重试。'
          : errorLabels[error.errorCode] || errorLabels.runtime_case_invalid;
        el('projectBuildCaseEditor').open = true; renderRuntimeCase(); el('projectBuildCaseProgram').focus(); return;
      }
    }
    if (replay) {
      if (!hasControlCapability() || !controlSceneSupported()) { render(); return; }
      try { controlProgram = readControlProgram(); controlError = ''; }
      catch (error) {
        controlError = error.errorCode === 'runtime_control_json' ? '控制步骤不是有效的 JSON，请检查后重试。'
          : errorLabels[error.errorCode] || errorLabels.runtime_control_invalid;
        el('projectBuildControlEditor').open = true; renderControlProgram(); el('projectBuildControlProgram').focus(); return;
      }
    }
    clearTimeout(timer); timer = null;
    const body = action === 'cancel' ? { action, jobId: data.job.id }
      : action === 'run' ? { action, buildId: matchedBuild().id, mode, ...(controlProgram ? { controlProgram } : {}),
        ...(runtimeCase ? { runtimeCase, ...(caseDocuments?.boundSceneId() ? { runtimeCaseSceneId: caseDocuments.boundSceneId() } : {}) } : {}) }
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
  async function checkTool() {
    // A tool identity query never saves or discards author drafts and never
    // consumes the current plan, build or control-program selection.
    if (!mayCheckTool()) { render(); return; }
    clearTimeout(timer); timer = null;
    const epoch = ++requestEpoch; requestBusy = true; toolCheckBusy = true;
    errorMessage = ''; errorDetails = ''; render();
    try {
      const { payload } = await fetchJsonApiRequest(PROJECT_BUILD_API_PATH,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tool-check' }) },
        15000, t('检查工具身份'));
      if (epoch === requestEpoch) accept(payload);
    } catch (error) { if (epoch === requestEpoch) fail(error); }
    finally {
      if (epoch === requestEpoch) {
        requestBusy = false; toolCheckBusy = false; render(); schedule();
        // Reconcile a lost response with a read, never a duplicate probe.
        if (errorMessage && !running() && !checkingTool() && available) timer = setTimeout(() => { timer = null; void refresh(); }, 1000);
      }
    }
  }
  caseDocuments = setupRuntimeCaseDocuments({
    container: el('projectBuildCaseDocuments'),
    getState: () => ({ ...getContext(), sceneId: selectedScene()?.id || '', available,
      visible: dialog.open, session: dialogSession, active: requestBusy || running() || checkingTool() || caseSuites?.isBusy(), offline: catalogUnavailable() }),
    getText: () => el('projectBuildCaseProgram').value,
    setText: text => { el('projectBuildCaseProgram').value = text; caseError = ''; },
    request: typeof requestProjectBuildDocument === 'function' ? requestProjectBuildDocument
      : async body => (await fetchJsonApiRequest(PROJECT_BUILD_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 45000, t('管理运行验收文档'))).payload,
    onChange: render,
  });
  async function runSuite({ suiteDocumentId, expectedVersion }) {
    if (!mayStart('run', 'headless') || !runtimeCasePlan() || catalogUnavailable()) { render(); return; }
    const body = { action: 'suite-run', buildId: matchedBuild().id, suiteDocumentId, expectedVersion };
    clearTimeout(timer); timer = null;
    const epoch = ++requestEpoch; requestBusy = true; errorMessage = ''; errorDetails = ''; render();
    try {
      const payload = typeof requestProjectBuildDocument === 'function' ? await requestProjectBuildDocument(body)
        : (await fetchJsonApiRequest(PROJECT_BUILD_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 15000, t('提交构建任务'))).payload;
      if (epoch === requestEpoch) accept(payload);
    } catch (error) { if (epoch === requestEpoch) fail(error); }
    finally {
      if (epoch === requestEpoch) { requestBusy = false; render(); schedule();
        if (errorMessage && !running() && available) timer = setTimeout(() => { timer = null; void refresh(); }, 1000); }
    }
  }
  caseReport = setupRuntimeCaseReport({ container: el('projectBuildCaseReport'),
    getState: () => ({ available, visible: dialog.open, session: dialogSession, sceneId: selectedScene()?.id || '',
      buildId: matchedBuild()?.id || '', backendId: data?.backend?.id || '', job: data?.job }),
    request: typeof requestProjectBuildDocument === 'function' ? requestProjectBuildDocument
      : async body => (await fetchJsonApiRequest(PROJECT_BUILD_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 45000, t('读取用例报告'))).payload,
  });
  caseSuites = setupRuntimeCaseSuites({ container: el('projectBuildSuites'),
    getState: () => ({ ...getContext(), sceneId: selectedScene()?.id || '', available, visible: dialog.open, session: dialogSession,
      active: requestBusy || running() || checkingTool() || caseDocuments?.isBusy(), offline: catalogUnavailable(),
      buildId: matchedBuild()?.id || '', backendId: data?.backend?.id || '', canRun: mayStart('run', 'headless') && Boolean(runtimeCasePlan()), job: data?.job }),
    request: typeof requestProjectBuildDocument === 'function' ? requestProjectBuildDocument
      : async body => (await fetchJsonApiRequest(PROJECT_BUILD_API_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 45000, t('管理运行验收文档'))).payload,
    onRun: runSuite, onInspect: documentId => void caseReport.open(documentId), onChange: render,
  });
  button.addEventListener('click', () => { if (available && !dialog.open) {
    dialogSession++; sourceNavigationEpoch++; pendingSourceFocus = null;
    render(); dialog.showModal(); void refresh();
  } });
  el('projectBuildEditScene').addEventListener('click', editScene);
  el('projectBuildCreateScene').addEventListener('click', () => { if (creationSupported && !requestBusy && !running() && ready()) sceneCreator.open(); });
  el('projectBuildClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => {
    if (dialog.open || handledCloseSession === dialogSession) return;
    handledCloseSession = dialogSession;
    caseDocuments.closed();
    caseSuites.closed();
    caseReport.closed();
    pendingCompositionApply = null;
    const pending = pendingSourceFocus; pendingSourceFocus = null;
    const current = pending?.session === dialogSession && pending.epoch === sourceNavigationEpoch;
    sourceNavigationEpoch++;
    scenePreview.setVisible(false);
    if (current) pending.focus();
    else button.focus();
  });
  const tabs = ['projectBuildTabPreview', 'projectBuildTabBuild'];
  function selectTab(index, focus = false) {
    if (!previewSupported) return;
    selections[activeTab] = selected; activeTab = index === 0 ? 'preview' : 'build'; selectDocument(); render();
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
  el('projectBuildToolCheck').addEventListener('click', () => void checkTool());
  el('projectBuildScene').addEventListener('change', () => { selected = el('projectBuildScene').value; selections[activeTab] = selected; if (activeTab === 'build') { plan = null; planScene = ''; } if (!documentsForTab().some(item => item.id === selected)) selectDocument(); render(); });
  el('projectBuildPlan').addEventListener('click', () => void submit('plan'));
  el('projectBuildGenerate').addEventListener('click', () => void submit('build'));
  el('projectBuildHeadless').addEventListener('click', () => void submit('run', 'headless'));
  el('projectBuildControl').addEventListener('click', () => void submit('run', 'headless', true));
  el('projectBuildCaseRun').addEventListener('click', () => void submit('run', 'headless', false, true));
  el('projectBuildCaseGenerate').addEventListener('click', () => {
    if (!mayStart('run', 'headless')) { render(); return; }
    const definition = sampledRuntimeCase();
    if (!definition) { renderRuntimeCase(); return; }
    const input = el('projectBuildCaseProgram'); input.value = JSON.stringify(definition, null, 2);
    caseDocuments.generated();
    caseError = ''; el('projectBuildCaseEditor').open = true; renderRuntimeCase(); input.focus(); input.selectionStart = input.selectionEnd = 0;
  });
  el('projectBuildCaseProgram').addEventListener('input', () => { caseError = ''; caseDocuments.changed(); renderRuntimeCase(); });
  el('projectBuildControlTarget').addEventListener('change', () => {
    controlTarget = el('projectBuildControlTarget').value; renderControlProgram();
  });
  el('projectBuildControlExample').addEventListener('click', () => {
    if (!mayStart('run', 'headless') || !hasControlCapability() || !controlSceneSupported()) { render(); return; }
    const target = controlTarget && instanceControlTargets().find(item => item.instanceId === controlTarget);
    if (controlTarget && !target) { renderControlProgram(); return; }
    const example = defaultControlProgram();
    if (target) {
      example.schemaVersion = 2;
      example.steps = example.steps.map(step => ({ inputs: [{ instanceId: target.instanceId, ...step }] }));
    }
    const input = el('projectBuildControlProgram'); input.value = JSON.stringify(validateSceneControlProgram(example), null, 2);
    controlError = ''; renderControlProgram(); input.focus(); input.selectionStart = input.selectionEnd = 0;
  });
  el('projectBuildControlProgram').addEventListener('input', () => { controlError = ''; renderControlProgram(); });
  el('projectBuildWindow').addEventListener('click', () => void submit('run', 'window'));
  el('projectBuildCancel').addEventListener('click', () => void submit('cancel'));
  el('projectBuildRuntimeSearch').addEventListener('input', () => { runtimeSearch = el('projectBuildRuntimeSearch').value; renderRuntimeObjects(); });
  onLanguageChange(render);
  return { setAvailable(value, commands = [], capabilities = {}) {
    creationSupported = commands.includes('scene.create'); updateSupported = commands.includes('scene.update'); sceneCreator.setAvailable(value === true && (creationSupported || updateSupported), commands);
    available = value === true; button.hidden = !available;
    previewSupported = available && capabilities.scenePreview === true;
    if (!previewSupported && activeTab !== 'build') { selections[activeTab] = selected; activeTab = 'build'; selectDocument(); }
    scenePreview.setAvailable(previewSupported);
    sceneLayout.setAvailable(previewSupported && updateSupported);
    sceneLayout.setSourceAvailable?.(previewSupported);
    if (!available) { requestEpoch++; requestBusy = false; toolCheckBusy = false; clearTimeout(timer); timer = null; if (dialog.open) dialog.close(); }
    render();
  } };
}
