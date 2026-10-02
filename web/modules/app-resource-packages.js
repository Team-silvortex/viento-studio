import { t, translateMessage } from '../i18n/index.js';
import { selectPackageEntries, PACKAGE_LIMITS } from '../../engine/resource-package.mjs';
import { loadResourcePackageCatalog, inspectResourcePackage, resourcePackageCommand } from './app-doc-service.js';

export function setupResourcePackages({ getContext, changed, activity, exportAsset, applied = async () => {} }) {
  const el = id => document.getElementById(id), panel = el('docResourcePackageOptions');
  let catalog = null, roots = new Set(), controller = null, visible = false, locked = false, generation = 0, limit = 200;
  let importJob = null, importStale = false, currentPath = '', selection = null;
  let recoveryNeeded = false;
  const message = el('docPackageMessage');
  const config = () => ({ includeDependencies: el('docPackageDependencies').checked, includeChildren: el('docPackageChildren').checked });
  function discardImport() {
    if (importJob) void resourcePackageCommand({ action: 'release', id: importJob.id }).catch(() => {});
    importJob = null; importStale = false;
  }
  function filtered() {
    const search = el('docPackageSearch').value.trim().normalize('NFC').toLowerCase(), kind = el('docPackageKind').value;
    const selected = new Set(selection?.selected.map(item => item.id) || []);
    return (catalog?.entries || []).filter(item => (!search || `${item.name}\n${item.path}`.normalize('NFC').toLowerCase().includes(search))
      && (!kind || item.kind === kind) && (!el('docPackageSelectedOnly').checked || selected.has(item.id)));
  }
  function render() {
    el('docPackageChooseFile').hidden = !getContext().editable;
    el('docPackageRecover').hidden = !getContext().editable || !recoveryNeeded;
    el('docPackageSelection').hidden = !!importJob;
    el('docPackageImportPreview').hidden = !importJob;
    selection = null; let selectionError = '';
    try { if (catalog && roots.size) selection = selectPackageEntries(catalog.entries, [...roots], config()); }
    catch (error) { selectionError = t(error.message); }
    const list = el('docPackageEntries'); list.replaceChildren();
    const selected = new Set(selection?.selected.map(item => item.id) || []), matches = filtered();
    for (const item of matches.slice(0, limit)) {
      const row = document.createElement('div'); row.className = 'doc-package-entry';
      const choice = document.createElement('label'); choice.className = 'doc-package-choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id;
      checkbox.checked = selected.has(item.id); checkbox.disabled = checkbox.checked && !roots.has(item.id);
      checkbox.addEventListener('change', event => {
        event.stopPropagation();
        if (checkbox.checked) roots.add(item.id); else roots.delete(item.id);
        changedSelection();
      });
      const detail = document.createElement('span'), title = document.createElement('strong'), location = document.createElement('small');
      title.textContent = item.name; location.textContent = item.path; detail.append(title, location);
      const badge = document.createElement('small'); badge.className = 'doc-package-badge';
      badge.textContent = item.status !== 'available' || item.problems?.length ? t('不可用或引用不完整')
        : checkbox.checked && !roots.has(item.id) ? t('自动依赖') : `${(item.size / 1024 ** 2).toFixed(2)} MB`;
      choice.append(checkbox, detail, badge); row.append(choice);
      if (item.category === 'asset' && exportAsset) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'doc-btn doc-btn-ghost doc-asset-export';
        button.textContent = t('导出原文件'); button.dataset.assetId = item.id;
        button.setAttribute('aria-label', t('导出原文件：{0}', item.name));
        button.disabled = item.status !== 'available';
        button.addEventListener('click', () => exportAsset(item)); row.append(button);
      }
      list.append(row);
    }
    if (!matches.length) { const empty = document.createElement('p'); empty.textContent = catalog ? t('没有符合条件的已登记资源') : t('请读取资源清单'); list.append(empty); }
    el('docPackageMore').hidden = matches.length <= limit;
    el('docPackageSummary').textContent = selection ? t('手动选择 {0} 项，自动包含 {1} 项，共 {2} MB；外部依赖 {3} 项。',
      roots.size, selection.automaticIds.length, (selection.selected.reduce((sum, item) => sum + item.size, 0) / 1024 ** 2).toFixed(2), selection.requirements.length)
      : selectionError || t('勾选对象或素材后，可导出包含 UUID、原始文件与元数据的资源包。');
    if (importJob) {
      el('docPackageImportSummary').textContent = t('将导入 {0} 个对象、{1} 个素材；新增 {2} 个文件，复用 {3} 个相同文件。', importJob.documentCount, importJob.assetCount, importJob.newFiles, importJob.reusedFiles);
      const output = el('docPackageImportItems'); output.replaceChildren();
      const reasons = { type: t('类型或解析规则冲突'), identity: t('身份或路径已被其他资源占用'), path: t('文件路径冲突'), content: t('已有文件内容不同'), dependency: t('缺少匹配的依赖') };
      for (const item of (importJob.conflicts.length ? importJob.conflicts : importJob.items).slice(0, 200)) {
        const row = document.createElement('li'); row.textContent = item.reason ? `${item.path} — ${reasons[item.reason]}` : item.path; output.append(row);
      }
      if ((importJob.conflicts.length || importJob.items.length) > 200) {
        const row = document.createElement('li'); row.textContent = t('仅显示前 200 项，导入将处理完整清单。'); output.append(row);
      }
    }
    el('docPackageImportApply').disabled = !importJob || importStale || !!importJob.conflicts.length || !getContext().editable || !!controller || locked;
    message.textContent = translateMessage(message.textContent);
  }
  function changedSelection() { render(); changed(); }
  async function run(operation, committing = false) {
    if ((controller && !controller.signal.aborted) || locked) return;
    const token = ++generation, request = new AbortController(); controller = request; locked = committing; activity();
    try { await operation(request.signal, () => token === generation && visible); }
    catch (error) {
      if (token === generation && visible && (committing || error.code === 'resource_package_recovery_required')) recoveryNeeded = true;
      if (token === generation && visible) message.textContent = request.signal.aborted ? t('已取消资源包操作。') : translateMessage(error.message);
    } finally {
      if (controller === request) { controller = null; locked = false; render(); activity(); }
    }
  }
  function load(preserve = true) {
    return run(async (signal, current) => {
      message.textContent = t('正在读取资源与依赖…');
      const next = await loadResourcePackageCatalog(signal);
      if (!current() || signal.aborted) return;
      catalog = next;
      recoveryNeeded = false;
      const available = new Set(next.entries.map(item => item.id));
      roots = preserve ? new Set([...roots].filter(id => available.has(id))) : new Set();
      if (!preserve && currentPath) { const item = next.entries.find(item => item.category === 'document' && item.path === currentPath); if (item) roots.add(item.id); }
      message.textContent = ''; changedSelection();
    });
  }
  async function commit(recovery = false) {
    const context = getContext();
    if (!context.editable || context.dirty || context.creating || context.busy || (!recovery && (!importJob || importStale || importJob.conflicts.length))) return;
    await run(async () => {
      message.textContent = t('正在导入资源，请等待完成…'); importStale = true;
      const result = await resourcePackageCommand(recovery ? { action: 'recover' } : { action: 'import', id: importJob.id, revision: importJob.revision });
      recoveryNeeded = false;
      if (result.status === 'idle') { message.textContent = t('没有需要恢复的资源包导入。'); return; }
      discardImport(); catalog = null; roots.clear();
      message.textContent = t('资源包已导入，原有内容保留。');
      try { await applied(); }
      catch { message.textContent = t('资源包已导入，但预览更新失败，请重新构建。'); }
      changed();
    }, true);
  }
  el('docPackageRefresh').addEventListener('click', () => { discardImport(); changed(); void load(); });
  for (const id of ['docPackageSearch', 'docPackageKind', 'docPackageSelectedOnly']) el(id).addEventListener(id === 'docPackageSearch' ? 'input' : 'change', event => { event.stopPropagation(); limit = 200; render(); });
  for (const id of ['docPackageDependencies', 'docPackageChildren']) el(id).addEventListener('change', event => { event.stopPropagation(); changedSelection(); });
  el('docPackageSelectVisible').addEventListener('click', () => { for (const item of filtered()) roots.add(item.id); changedSelection(); });
  el('docPackageClear').addEventListener('click', () => { roots.clear(); changedSelection(); });
  el('docPackageMore').addEventListener('click', () => { limit += 200; render(); });
  el('docPackageChooseFile').addEventListener('click', () => {
    const context = getContext();
    if (!context.editable || context.dirty || context.creating || context.busy) return;
    el('docPackageFile').value = ''; el('docPackageFile').click();
  });
  el('docPackageFile').addEventListener('change', event => {
    event.stopPropagation();
    const file = el('docPackageFile').files?.[0], context = getContext();
    if (!file || !context.editable || context.dirty || context.creating || context.busy) return;
    if (file.size > PACKAGE_LIMITS.fileBytes) { message.textContent = t('资源包压缩文件超过 8 GiB 限制'); return; }
    discardImport(); changed();
    void run(async (signal, current) => {
      message.textContent = t('正在校验资源包并检查目标项目…');
      const next = await inspectResourcePackage(file, signal);
      if (!current() || signal.aborted) { void resourcePackageCommand({ action: 'release', id: next.id }).catch(() => {}); return; }
      importJob = next; importStale = false;
      message.textContent = next.conflicts.length ? t('导入存在冲突，请先处理冲突后重新预览') : t('已有相同文件会复用；内容不同的文件不会被覆盖。'); changed();
    });
  });
  el('docPackageImportBack').addEventListener('click', () => { discardImport(); render(); changed(); });
  el('docPackageImportRefresh').addEventListener('click', () => {
    if (!importJob) return;
    void run(async (signal, current) => {
      importStale = true;
      const next = await resourcePackageCommand({ action: 'preview', id: importJob.id }, signal);
      if (current() && !signal.aborted) { importJob = next; importStale = false; message.textContent = next.conflicts.length ? t('导入存在冲突，请先处理冲突后重新预览') : ''; }
    });
  });
  el('docPackageImportApply').addEventListener('click', () => { void commit(); });
  el('docPackageRecover').addEventListener('click', () => { void commit(true); });
  return {
    get busy() { return !!controller; }, get locked() { return locked; },
    get ready() { return !!catalog && !!selection?.selected.length && !importJob && selection.selected.every(item => item.status === 'available' && !item.problems?.length); },
    payload: () => ({ ids: [...roots], revision: catalog?.revision, ...config() }),
    render,
    show(value, sourcePath = currentPath) {
      panel.hidden = !value;
      if (value === visible) return;
      visible = value; currentPath = sourcePath;
      if (value) { render(); void load(false); }
      else { generation += 1; controller?.abort(); discardImport(); catalog = null; roots.clear(); }
    },
    cancel() { if (!locked) controller?.abort(); },
  };
}
