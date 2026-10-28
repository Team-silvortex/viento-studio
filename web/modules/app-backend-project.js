import { t, translatePage, onLanguageChange } from '../i18n/index.js';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { validateBackendProjectManifest, backendProjectSourceIdentity } from '../../engine/backend-project.mjs';

// Viewing is independent of execution; only an explicit verified selection changes its target.
export function setupBackendProject({ container, request, getState, onChange = () => {}, onSelect = () => false, onSelectSettled = () => {}, onDeliver }) {
  container.innerHTML = `<section id="backendProjectPanel" class="backend-project" hidden aria-labelledby="backendProjectTitle">
    <h3 id="backendProjectTitle" data-i18n="后端工程"></h3>
    <p id="backendProjectIntroduction" class="build-hint"></p>
    <p id="backendProjectDiagnostic" class="build-hint" role="status" hidden></p>
    <p id="backendProjectRuntime" class="backend-project-runtime" role="status"></p>
    <div class="backend-project-picker"><label for="backendProjectSelect" data-i18n="选择后端工程"></label><select id="backendProjectSelect"></select>
    <button id="backendProjectInspect" type="button" class="doc-btn doc-btn-ghost" data-i18n="查看工程详情"></button></div>
    <button id="backendProjectActivate" type="button" class="doc-btn" hidden data-i18n="设为运行工程"></button>
    <p id="backendProjectOrigin" class="build-hint"></p><p id="backendProjectAvailability" class="build-hint"></p>
    <p id="backendProjectRetention" class="build-hint"></p><p id="backendProjectSelection" class="build-hint"></p>
    <section id="backendProjectDetails" hidden aria-labelledby="backendProjectDetailsTitle">
      <div class="build-actions"><h3 id="backendProjectDetailsTitle" data-i18n="后端工程详情"></h3><button id="backendProjectClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="关闭工程详情"></button></div>
      <button id="backendProjectDeliver" type="button" class="doc-btn" data-i18n="交付工程" hidden></button><p id="backendProjectDeliveryHint" class="build-hint" hidden></p>
      <p id="backendProjectStatus" role="status" aria-live="polite"></p><p id="backendProjectError" role="alert" hidden></p>
      <div id="backendProjectContent"></div>
    </section></section>`;
  const el = suffix => container.querySelector(`#backendProject${suffix}`);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const statuses = { succeeded: '构建完成', failed: '构建失败', cancelled: '构建已取消', timeout: '构建超时' };
  const retentionReasons = {
    backend_project_changed: '生成文件或清单已变化，工程已保留，请检查后重新构建。',
    backend_project_extra_paths: '工程目录出现清单外内容，已保留供你检查。',
    backend_project_link: '工程目录出现链接或特殊文件，已保留供你检查。',
    backend_project_sessions_retained: '此工程包含运行记录，已保留供你查看。',
    backend_project_owner_changed: '工程目录的位置或身份已变化，已保留供你检查。',
    backend_project_cleanup_failed: '自动回收未完成，工程已保留。',
    backend_project_previous_session: '这是以前服务留下的工程，已保留；查看或设为运行工程时重新核对。',
  };
  const errors = {
    build_artifact_missing: '此工程已不属于当前服务，请刷新列表或重新构建。',
    backend_project_missing: '此工程已不属于当前服务，请刷新列表或重新构建。',
    backend_project_changed: '工程文件或清单已变化，无法显示为完整工程。请检查保留原因并重新构建。',
    backend_project_invalid: '工程清单无效，无法显示详情。请重新构建。',
    backend_project_unavailable: '无法读取工程详情，请刷新列表后重试。',
    backend_project_limit: '工程详情超出读取限制，无法显示。',
    backend_project_workspace_changed: '此工程属于不同的作者世界，不能设为当前运行工程。',
    backend_project_selection_changed: '选择期间任务或运行目标已变化，请刷新状态后重新选择。',
    build_busy: '任务正在进行，请结束后再选择运行工程。',
    backend_project_catalog_invalid: '工程目录记录无效，请检查保留的工程或重新构建。',
    backend_project_catalog_changed: '工程目录记录已变化，请刷新后重试。',
    backend_project_catalog_unavailable: '工程目录记录暂不可用，请刷新后重试。',
    backend_project_catalog_corrupt: '历史工程目录记录损坏，已有工程不会被覆盖。请检查记录后刷新。',
    backend_project_catalog_busy: '历史工程目录记录正在被其他操作使用，请稍后刷新重试。',
    backend_project_catalog_limit: '历史工程目录记录达到容量限制；请整理保留工程后重试。',
    backend_project_owner_changed: '工程目录的位置或身份已变化，无法确认原工程。请刷新列表后检查。',
    runtime_artifact_changed: '工程文件或清单已变化，无法显示为完整工程。请检查保留原因并重新构建。',
    runtime_build_invalid: '工程清单无效，无法显示详情。请重新构建。',
  };
  let selected = '', detailId = '', origin = null, response = null, busy = false, busyAction = '', epoch = 0, errorKey = '', disposed = false;
  const catalogEnabled = () => getState().projectManagement?.scope === 'host-catalog'
    && getState().projectManagement?.previousSessions === 'explicit-verify';
  const node = (tag, text, className = '') => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
  function projects() {
    const state = getState();
    if (!state.available || !state.visible || !Array.isArray(state.projects)) return [];
    const seen = new Set();
    return state.projects.filter(item => {
      if (!item || !uuid(item.id) || seen.has(item.id) || item.sceneId !== state.sceneId || item.backendId !== state.backendId
        || !revision(item.snapshotId) || !Object.hasOwn(statuses, item.status) || typeof item.title !== 'string'
        || item.title.length > 160 || !['automatic', 'preserved'].includes(item.retention)
        || catalogEnabled() && (!['current-session', 'previous-session'].includes(item.origin) || !['unchecked', 'verified', 'unavailable'].includes(item.availability))) return false;
      seen.add(item.id); return true;
    });
  }
  const currentProject = (id = selected) => projects().find(item => item.id === id);
  function ownership(id = detailId) {
    const state = getState(), project = currentProject(id);
    if (!project || project.status !== 'succeeded') return null;
    return { session: state.session, sceneId: state.sceneId, backendId: state.backendId, backendIdentity: state.backendIdentity || '',
      buildId: project.id, snapshotId: project.snapshotId, status: project.status, retention: project.retention,
      retentionReason: project.retentionReason ?? null, origin: project.origin ?? null };
  }
  const owns = () => Boolean(origin && canonicalJson(ownership()) === canonicalJson(origin));
  function clear() { detailId = ''; origin = null; response = null; busy = false; busyAction = ''; errorKey = ''; epoch++; }
  function field(list, label, value, monospace = false) {
    list.append(node('dt', t(label)), node('dd', String(value ?? t('未记录')), monospace ? 'build-monospace' : ''));
  }
  function section(title, hint = '') {
    const panel = node('section', '', 'backend-project-section'); panel.append(node('h4', t(title)));
    if (hint) panel.append(node('p', t(hint), 'build-hint'));
    el('Content').append(panel); return panel;
  }
  function renderProject() {
    // The portable manifest is validated before authored strings reach the DOM.
    const project = response.project;
    const summary = section('工程与生成入口');
    const facts = node('dl', '', 'backend-project-facts'); summary.append(facts);
    field(facts, '构建标识', project.buildId, true);
    field(facts, '来源快照', project.snapshotId, true);
    field(facts, '后端标识', project.backend.id, true);
    field(facts, '生成工程目录', response.buildDirectory, true);
    renderManifest(project, { section, field, node, facts });
  }
  function renderManifest(project, view) {
    const kinds = { 'godot-project': 'Godot 生成工程', 'bevy-scene': 'Bevy 场景数据工程', 'bevy-rust-project': 'Bevy Rust 源工程' };
    view.field(view.facts, '工程类型', kinds[project.project.kind] ? t(kinds[project.project.kind]) : project.project.kind);
    view.field(view.facts, '生成入口', project.project.entry, true);
    view.field(view.facts, '运行依赖宿主工具', t(project.project.requiresTool ? '是' : '否'));
    const explanation = project.project.kind === 'bevy-scene'
      ? 'Bevy 工程只有场景数据，由已安装的可信运行程序读取；它不是 Cargo 工程，不编译作者 Rust，也不是独立发行程序。'
      : project.project.kind === 'bevy-rust-project'
        ? '这是包含作者 Rust 行为的 Cargo 源工程。需要匹配的 Rust 工具链与锁定依赖；编译缓存和可执行文件不随工程交付。'
        : '这是从已保存作者输入生成的派生工程。请在作者工程修改设计，再重新检查和构建；生成文件不是作者原文。';
    view.facts.parentElement.append(view.node('p', t(explanation), 'build-hint'));
    if (project.source.planKind === 'project' && project.backend.id === 'org.viento.bevy' && project.project.kind === 'bevy-scene') {
      view.facts.parentElement.append(view.node('p', t('组装工程仅运行入口场景，不支持场景切换；需要另行准备可信的 Bevy 运行程序。'), 'build-hint'));
    }
    const source = view.section('来源与锁定输入', '详情按构建时捕获的来源与文件清单展示；当前作者编辑和工具检查不会改写此工程。');
    const sourceFacts = view.node('dl', '', 'backend-project-facts'); source.append(sourceFacts);
    const sourceIdentity = backendProjectSourceIdentity(project);
    for (const [label, value] of [['作者世界标识', project.source.workspaceId], [sourceIdentity.planKind === 'project' ? '来源组装标识' : '来源场景标识', sourceIdentity.objectId],
      [sourceIdentity.planKind === 'project' ? '来源组装文件' : '来源场景文件', project.source.sourcePath], [sourceIdentity.planKind === 'project' ? '来源组装修订' : '来源场景修订', project.source.sourceRevision],
      ['计划种类', project.source.planKind], ['计划版本', project.source.planSchemaVersion]]) view.field(sourceFacts, label, value, true);
    if (sourceIdentity.planKind === 'project') {
      view.field(sourceFacts, '启动场景标识', sourceIdentity.entrySceneId, true); view.field(sourceFacts, '组装场景数量', sourceIdentity.sceneCount);
      const members = view.node('ul', '', 'backend-project-files');
      for (const scene of project.source.scenes) members.append(view.node('li', `${scene.sceneId} · ${scene.sourcePath} · ${scene.sourceRevision}`, 'build-monospace'));
      source.append(members);
    }
    const sources = view.node('details', '', 'backend-project-inventory'); sources.id = 'backendProjectSources';
    sources.append(view.node('summary', t('冻结的作者文件（{0}）', project.dependencies.length)));
    sources.append(view.node('p', t('这是冻结快照包含的作者文件，不是当前文件状态，也不代表每份文件都生成了引擎代码。'), 'build-hint'));
    const sourceList = view.node('ul', '', 'backend-project-files');
    const sourceRoles = { assembly: '组装原文', scene: '场景原文', 'behavior-source': '行为原文', 'author-document': '作者文档' };
    for (const file of project.dependencies) {
      const item = view.node('li'); item.dataset.sourcePath = file.sourcePath;
      item.append(view.node('p', file.sourcePath, 'build-monospace'));
      const facts = view.node('dl', '', 'backend-project-facts');
      view.field(facts, '来源角色', t(sourceRoles[file.role])); view.field(facts, '对象标识', file.objectId, true);
      view.field(facts, '原文修订', file.sourceRevision, true); item.append(facts); sourceList.append(item);
    }
    sources.append(sourceList); source.append(sources);
    const tools = view.section('锁定的后端与工具', '这里显示构建时的工具身份。查看详情不会运行工具；当前工具是否仍可用，须另行检查，运行时还会重新核对。');
    const toolFacts = view.node('dl', '', 'backend-project-facts'); tools.append(toolFacts);
    for (const [label, value] of [['生成器版本', project.backend.version], ['运行协议版本', project.backend.protocolVersion],
      ['生成器指纹', project.backend.sha256], ['执行适配器标识', project.executionAdapter?.id],
      ['适配器契约版本', project.executionAdapter?.contractVersion], ['执行适配器指纹', project.executionAdapter?.sha256],
      ['构建时工具版本', project.tool.version], ['构建时工具指纹', project.tool.sha256],
      ['工具平台', project.tool.platform], ['工具架构', project.tool.arch]]) view.field(toolFacts, label, value, true);
    const generated = view.section('生成文件清单', '文件均相对于生成工程目录。素材与作者脚本是副本，修改不会回写作者工程；更改生成文件后需要重新构建。');
    const fileList = view.node('ul', '', 'backend-project-files'); fileList.id = 'backendProjectFiles';
    const fileRoles = { generated: '适配器生成', 'resource-copy': '素材副本', 'author-source-copy': '作者源码副本' };
    for (const file of project.files) {
      const item = view.node('li'); item.dataset.generatedPath = file.path;
      item.append(view.node('p', file.path, 'build-monospace'));
      const facts = view.node('dl', '', 'backend-project-facts');
      view.field(facts, '文件角色', t(fileRoles[file.role])); view.field(facts, '文件大小', t('{0} 字节', file.size));
      view.field(facts, '内容指纹', file.sha256, true);
      if (file.resourceId) view.field(facts, '素材标识', file.resourceId, true);
      if (file.sourceObjectId) view.field(facts, '来源对象标识', file.sourceObjectId, true);
      item.append(facts); fileList.append(item);
    }
    generated.append(fileList);
    const resources = view.section('复制的素材');
    if (!project.resources.length) resources.append(view.node('p', t('此工程没有复制素材。'), 'build-hint'));
    const resourceList = view.node('ul', '', 'backend-project-files'); resourceList.id = 'backendProjectResources';
    for (const file of project.resources) {
      const item = view.node('li'); item.dataset.resourceId = file.resourceId;
      const facts = view.node('dl', '', 'backend-project-facts');
      for (const [label, value] of [['素材标识', file.resourceId], ['登记素材路径', file.sourcePath], ['生成副本路径', file.generatedPath],
        ['文件大小', t('{0} 字节', file.size)], ['内容指纹', file.sha256]]) view.field(facts, label, value, true);
      item.append(facts); resourceList.append(item);
    }
    resources.append(resourceList);
    const evidence = view.section('构建证据与来源映射', '记录文件描述冻结输入、引擎文件与原文的对应关系，以及真实构建阶段。它们不包含作者素材的本机绑定路径。');
    const evidenceList = view.node('ul', '', 'backend-project-files'); evidenceList.id = 'backendProjectEvidence';
    const evidenceLabels = { 'build.json': '构建记录', 'snapshot.json': '冻结输入快照', 'source-map.json': '生成对象与原文映射' };
    for (const file of project.evidence) {
      const item = view.node('li'); item.dataset.evidencePath = file.path;
      item.append(view.node('p', t('{0} · {1}', t(evidenceLabels[file.path]), file.path), 'build-monospace'));
      item.append(view.node('p', t('{0} 字节', file.size)), view.node('p', file.sha256, 'build-monospace')); evidenceList.append(item);
    }
    evidence.append(evidenceList);
    const lifecycle = view.section('保留、清理与重建');
    const catalog = catalogEnabled();
    for (const text of [
      '作者工程负责原文、身份和素材；后端工程是可重新生成的只读派生物。',
      '每个后端使用独立的生成目录。目录仅供查看，不会自动打开本机路径。',
      '运行前重新核对快照、生成文件、适配器和工具；来源离线时可运行完整的冻结工程，新的计划或构建仍需要已保存作者输入。',
      '运行使用临时工程副本，结束后回收副本与引擎缓存，保留构建和运行记录。',
      catalog ? '自动回收只管理当前服务创建且清单未改变的工程。历史工程保留，不因查看或设为运行工程而纳入自动回收。' : '只有当前服务创建且清单未改变的工程参与自动回收。修改过的工程保留；以前的服务和命令行工程不自动接管。',
      catalog ? '服务重启后从宿主目录记录恢复历史名单；文件与运行资格需显式核对。查看详情不会选择运行工程，也不会启动工具。' : '关闭详情或构建面板不会取消任务。服务重启后不自动恢复工程列表；磁盘工程可用命令行显式检查。',
    ]) lifecycle.append(view.node('p', t(text), 'build-hint'));
    const inspection = response.inspection;
    if (!inspection.recorded) lifecycle.append(view.node('p', t('此旧工程没有独立工程清单；详情由已有冻结记录重建，不会写回旧目录。'), 'build-hint'));
    if (inspection.manifestSha256) {
      const facts = view.node('dl', '', 'backend-project-facts'); view.field(facts, '工程清单指纹', inspection.manifestSha256, true); lifecycle.append(facts);
    }
    if (inspection.extraPaths.length) {
      const list = view.node('ul', '', 'backend-project-files'); list.id = 'backendProjectExtraPaths';
      for (const extra of inspection.extraPaths) list.append(view.node('li', extra.path.replace(/[\u0001-\u001f\u007f]/g,
        character => ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' }[character] || `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)), 'build-monospace'));
      lifecycle.append(view.node('p', t('目录存在清单外内容，未判定为完整工程；请检查后再处理。'), 'build-hint'), list);
    }
  }
  function render() {
    if (disposed) return;
    if (origin && !owns()) clear();
    const rows = projects();
    if (!rows.some(item => item.id === selected)) selected = rows[0]?.id || '';
    translatePage(container);
    const state = getState(), management = state.projectManagement, catalog = catalogEnabled(), diagnostic = management?.catalogDiagnostic;
    el('Panel').hidden = !rows.length && !diagnostic;
    el('Introduction').textContent = t(catalog ? '这里列出当前及以前服务为此场景记录的后端工程。查看详情不会切换运行工程；请明确设为运行工程。' : '这里列出当前服务为此场景生成的工程。查看其他工程不会切换运行所用的最近成功构建。');
    el('Diagnostic').hidden = !diagnostic;
    el('Diagnostic').textContent = diagnostic ? t(errors[diagnostic.code] || '工程目录记录暂不可用，请刷新后重试。') : '';
    const runtime = state.latestBuild;
    el('Runtime').hidden = !catalog;
    el('Runtime').textContent = runtime && runtime.sceneId === state.sceneId && runtime.backendId === state.backendId && uuid(runtime.id) && revision(runtime.snapshotId)
      ? t('当前运行工程：{0}；来源快照：{1}', runtime.id, runtime.snapshotId) : t('当前场景尚未设置运行工程。');
    const picker = el('Select'), signature = canonicalJson(rows.map(item => [item.id, item.title, t(statuses[item.status]), item.retention, item.origin ?? null, item.availability ?? null, catalog ? t(item.origin === 'previous-session' ? '历史工程' : '本次服务工程') : '']));
    if (picker.dataset.projects !== signature) {
      picker.replaceChildren();
      for (const item of rows) { const option = node('option', t('{0} · {1} · {2}', item.title, catalog ? `${t(item.origin === 'previous-session' ? '历史工程' : '本次服务工程')} · ${t(statuses[item.status])}` : t(statuses[item.status]), item.id.slice(-8))); option.value = item.id; picker.append(option); }
      picker.dataset.projects = signature;
    }
    picker.value = selected; picker.disabled = busy;
    el('Inspect').disabled = busy || currentProject()?.status !== 'succeeded';
    el('Retention').textContent = t(catalog ? '本次服务最多自动保留 {0} 份未改变的工程；修改过的工程与历史工程会保留。' : '自动回收只处理当前服务创建且清单未改变的工程，最多保留 {0} 份；已修改的工程会保留。以前的服务与命令行工程不自动接管。', management?.retentionLimit === 3 ? management.retentionLimit : 3);
    const row = currentProject();
    el('Activate').hidden = !catalog;
    el('Activate').disabled = busy || state.canSelect === false || row?.status !== 'succeeded' || row?.id === runtime?.id;
    el('Origin').hidden = !catalog; el('Availability').hidden = !catalog;
    el('Origin').textContent = row ? t(row.origin === 'previous-session' ? '来源：以前的服务；历史记录仍需显式核对。' : '来源：本次服务生成。') : '';
    el('Availability').textContent = row ? t({ unchecked: '此工程尚未在本次服务核对；可以查看详情或尝试设为运行工程。', verified: '工程文件已核对；这不代表当前工具可用，运行时仍会重新核对。', unavailable: '上次核对未通过；修复后可再次查看或尝试设为运行工程。' }[row.availability] || '未记录') : '';
    el('Selection').textContent = row?.retention === 'preserved'
      ? t(retentionReasons[row.retentionReason] || '此工程已保留，不参与自动回收。')
      : row && row.status !== 'succeeded' ? t('此构建未成功，保留记录可用于排查，不能查看完整工程或运行。') : '';
    el('Details').hidden = !detailId;
    el('Error').hidden = !errorKey; el('Error').textContent = errorKey ? t(errorKey) : '';
    el('Status').textContent = !detailId ? '' : busy ? t(busyAction === 'select' ? '正在核对并选择运行工程…' : '正在读取后端工程详情…')
      : response ? t(response.inspection.complete ? '冻结工程清单与生成文件已核对；未启动引擎或检查当前工具。' : '工程记录已读取，但文件核对未完整通过。') : '';
    const canDeliver = Boolean(response && owns() && response.inspection.recorded && response.inspection.manifestSha256);
    const deliverySupported = state.projectManagement?.delivery === 'viento-build-delivery-v1' && typeof onDeliver === 'function';
    el('Deliver').hidden = !canDeliver; el('Deliver').disabled = busy || state.busy === true || !deliverySupported;
    el('DeliveryHint').hidden = !canDeliver; el('DeliveryHint').textContent = t(deliverySupported ? '交付已核对的生成工程；接收方仍需相应运行工具。' : '当前宿主不支持工程交付；仍可查看工程详情。');
    el('Content').replaceChildren();
    if (response && owns()) renderProject();
  }
  async function open(id = selected) {
    if (disposed || busy || currentProject(id)?.status !== 'succeeded') return false;
    clear(); selected = id; detailId = id; origin = ownership(id);
    if (!origin) { clear(); render(); return false; }
    const token = ++epoch; busy = true; busyAction = 'inspect'; render(); onChange();
    try {
      const result = await request({ action: 'inspect-project', buildId: id });
      if (disposed || token !== epoch || !owns()) return false;
      const project = validateBackendProjectManifest(result?.project);
      if (project.buildId !== origin.buildId || project.snapshotId !== origin.snapshotId || project.backend.id !== origin.backendId || backendProjectSourceIdentity(project).objectId !== origin.sceneId
        || typeof result.buildDirectory !== 'string' || !result.buildDirectory || result.buildDirectory.length > 4096
        || /[\u0000-\u001f\u007f]/.test(result.buildDirectory)) throw Object.assign(new Error('Mismatched backend project.'), { errorCode: 'backend_project_invalid' });
      const inspection = readInspection(result.inspection);
      response = { project, inspection, buildDirectory: result.buildDirectory };
      return true;
    } catch (error) {
      if (!disposed && token === epoch && owns()) errorKey = errors[error.errorCode] || '无法读取工程详情，请刷新列表后重试。';
      return false;
    } finally {
      if (!disposed && token === epoch) { busy = false; busyAction = ''; render(); onChange(); }
    }
  }
  async function activate(id = selected) {
    if (disposed || busy || !catalogEnabled() || getState().canSelect === false || currentProject(id)?.status !== 'succeeded' || getState().latestBuild?.id === id) return false;
    clear(); selected = id; detailId = id; origin = ownership(id);
    if (!origin) { clear(); render(); return false; }
    const selectionOwner = { ...origin, requestEpoch: getState().requestEpoch ?? null }; let accepted = false;
    const token = ++epoch; busy = true; busyAction = 'select'; render(); onChange();
    try {
      const status = await request({ action: 'select-project', buildId: id });
      if (disposed || token !== epoch || !owns()) return false;
      if ((getState().requestEpoch ?? null) !== selectionOwner.requestEpoch) { clear(); render(); onChange(); return false; }
      const build = status?.latestBuild;
      if (!Array.isArray(status?.scenes) || !Array.isArray(status?.projects) || !build
        || build.id !== origin.buildId || build.snapshotId !== origin.snapshotId || build.sceneId !== origin.sceneId
        || build.backendId !== origin.backendId || status.backend?.id !== origin.backendId
        || canonicalJson(status.backend) !== origin.backendIdentity
        || !status.projects.some(row => row.id === id && row.sceneId === origin.sceneId && row.backendId === origin.backendId
          && row.snapshotId === origin.snapshotId && row.status === 'succeeded' && row.availability === 'verified')) {
        throw Object.assign(new Error('Mismatched selected backend project.'), { errorCode: 'backend_project_invalid' });
      }
      accepted = onSelect(status, selectionOwner) !== false; return accepted;
    } catch (error) {
      if (!disposed && token === epoch && owns()) errorKey = errors[error.errorCode] || '无法选择运行工程，请刷新状态核对结果后重试。';
      return false;
    } finally {
      if (!disposed && token === epoch) { busy = false; busyAction = ''; render(); onChange(); onSelectSettled({ owner: selectionOwner, accepted }); }
    }
  }
  function readInspection(input) {
    const invalid = () => { throw Object.assign(new Error('Invalid backend project inspection.'), { errorCode: 'backend_project_invalid' }); };
    const plain = value => value && typeof value === 'object' && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    if (!plain(input)) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 4 || keys.some(key => !['recorded', 'complete', 'manifestSha256', 'extraPaths'].includes(key)
      || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) invalid();
    const { recorded, complete, manifestSha256, extraPaths } = input;
    if (typeof recorded !== 'boolean' || typeof complete !== 'boolean'
      || manifestSha256 !== null && (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifestSha256))
      || !Array.isArray(extraPaths) || complete && extraPaths.length) invalid();
    if (extraPaths.length > 16384) throw Object.assign(new Error('Backend project inspection exceeds its budget.'), { errorCode: 'backend_project_limit' });
    const rows = [];
    for (let index = 0; index < extraPaths.length; index++) {
      const value = Object.getOwnPropertyDescriptor(extraPaths, String(index));
      if (!value || !Object.hasOwn(value, 'value') || !plain(value.value)) invalid();
      const row = value.value, fields = Object.getOwnPropertyDescriptors(row);
      if (Reflect.ownKeys(fields).length !== 2 || !['path', 'kind'].every(key => fields[key]?.enumerable && Object.hasOwn(fields[key], 'value'))
        || typeof row.path !== 'string' || !row.path || row.path.length > 4096 || row.path.includes('\0') || row.path.startsWith('/')
        || row.path.split('/').some(segment => !segment || segment === '.' || segment === '..')
        || !['file', 'directory', 'symlink', 'other'].includes(row.kind)) invalid();
      rows.push({ path: row.path, kind: row.kind });
    }
    return { recorded, complete, manifestSha256, extraPaths: rows };
  }
  el('Select').addEventListener('change', () => { if (busy) return; clear(); selected = el('Select').value; render(); });
  el('Inspect').addEventListener('click', () => void open());
  el('Activate').addEventListener('click', () => void activate());
  el('Deliver').addEventListener('click', () => {
    if (disposed || busy || getState().busy === true || !response || !owns() || !response.inspection.recorded || !response.inspection.manifestSha256
      || getState().projectManagement?.delivery !== 'viento-build-delivery-v1' || typeof onDeliver !== 'function') return;
    onDeliver(response, Object.freeze({ ...origin }));
  });
  el('Close').addEventListener('click', () => { clear(); render(); el('Inspect').focus(); onChange(); });
  const unsubscribe = onLanguageChange(render); render();
  return { open, activate, render, isBusy: () => busy, closed() { clear(); render(); }, dispose() { if (disposed) return; clear(); disposed = true; unsubscribe?.(); container.replaceChildren(); }, destroy() { this.dispose(); } };
}
