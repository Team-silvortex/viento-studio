import { t, getLanguage, onLanguageChange, translateMessage, asUiMessage } from '../i18n/index.js';
import { API_PATHS } from '../../scripts/lib/doc-api-contract.mjs';
import { requestExport, checkExport, releaseExport } from './app-doc-service.js';
import { setupResourcePackages } from './app-resource-packages.js';

export function exportAvailability(context, kind) {
  if (context.busy) return t('正在保存或更新内容，请完成后再导出。');
  if (kind !== 'asset' && (context.dirty || context.creating)) return t('当前有未保存的草稿，请先保存，再导出。');
  if (kind === 'document' && !context.path) return t('请先选择一份正文文档，或改为导出完整项目包。');
  return '';
}

export function setupExport({ getContext, setBusy, applied }) {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('docExportDialog');
  if (!dialog) return;
  const options = byId('docExportOptions'), format = byId('docExportFormat');
  const start = byId('docExportStartBtn'), close = byId('docExportCloseBtn');
  const cancel = byId('docExportCancelBtn'), message = byId('docExportMessage');
  const download = byId('docExportDownload'), save = byId('docExportSaveBtn');
  const back = byId('docExportBackBtn');
  const native = new URL(location.href).searchParams.get('desktop') === '1';
  let controller, job, context, nativePending = false, downloadStarted = false;
  let session = 0;
  let asset = null, returnToSelection = false;
  const kind = () => asset ? 'asset' : options.querySelector('input[name="exportKind"]:checked').value;
  const discard = () => {
    if (job && !downloadStarted) void releaseExport(job.id).catch(() => {});
    job = null; download.hidden = true; save.hidden = true; downloadStarted = false;
  };
  const resources = setupResourcePackages({ getContext, applied, exportAsset: openAsset,
    changed: () => { discard(); message.textContent = ''; refresh(); },
    activity: () => { setBusy(!!controller || nativePending || resources.busy); refresh(); },
  });
  function refresh() {
    if (!context) return;
    options.hidden = !!asset;
    back.hidden = !asset || !returnToSelection;
    back.disabled = nativePending || resources.locked;
    byId('docExportTitle').dataset.i18n = asset ? '导出原文件' : '导出作品';
    byId('docExportTitle').textContent = t(asset ? '导出原文件' : '导出作品');
    byId('docExportContext').textContent = asset ? t('素材：{0}', asset.name)
      : context.title ? t`当前文档：${context.title}` : t('导出当前作品');
    byId('docExportDocumentOptions').hidden = kind() !== 'document';
    const reason = exportAvailability(context, kind());
    byId('docExportHint').textContent = reason || (asset ? t('按原格式保存单个素材，不压缩、不转码。项目中的素材和编辑草稿保持不变。') : kind() === 'workspace'
      ? t('包含全部已保存内容与素材，自动排除缓存、临时文件和本机路径配置。')
      : kind() === 'resources' ? t('资源包保留原始文件、UUID、关系与解析规则，可在其他项目的资源包窗口中导入。')
        : t('原始正文与引用素材一并打包。解压后即可阅读；音视频保留原始格式。'));
    start.disabled = !!controller || nativePending || resources.busy || !!reason || !!job || (kind() === 'resources' && !resources.ready);
    options.disabled = !!controller || nativePending || resources.busy;
    download.disabled = !!controller || nativePending || resources.busy || !job;
    cancel.hidden = (!controller && !resources.busy) || nativePending || resources.locked;
    close.disabled = nativePending || resources.locked;
  }
  function closeDialog() {
    if (nativePending || resources.locked) return;
    session += 1;
    controller?.abort();
    discard();
    resources.show(false);
    dialog.close();
  }
  onLanguageChange(() => {
    if (!context) return;
    refresh();
    resources.render();
    message.textContent = translateMessage(message.textContent);
  });
  function nativeSave() {
    const id = job.id;
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const receive = (event) => {
        // The same prepared ZIP can be saved again after a transport failure.
        // A late result belongs to that earlier attempt, not the current picker.
        if (event.detail?.id !== id || event.detail?.requestId !== requestId) return;
        cleanup();
        event.detail.ok ? resolve(event.detail) : reject(new Error(event.detail.error || t('无法保存导出文件')));
      };
      const cleanup = () => window.removeEventListener('viento-export-result', receive);
      window.addEventListener('viento-export-result', receive);
      fetch('/__desktop/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, requestId }) })
        .then(async (response) => {
          if (!response.ok) {
            const error = new Error((await response.json()).error || t('无法打开保存窗口'));
            error.status = response.status;
            throw error;
          }
        }).catch((error) => { cleanup(); reject(error); });
    });
  }
  async function saveNative() {
    if (!job || nativePending) return;
    nativePending = true; setBusy(true); save.disabled = true; refresh();
    message.textContent = t('请选择导出文件的保存位置…');
    try {
      const result = await nativeSave();
      if (result.cancelled) message.textContent = t('已取消保存，可以重新选择位置。');
      else { message.textContent = t`已保存到 ${result.path}`; discard(); }
    } catch (error) {
      if (error.status === 410) {
        discard();
        message.textContent = t('导出文件已过期，请重新导出');
      } else message.textContent = error.message;
    }
    finally { nativePending = false; setBusy(false); save.disabled = false; refresh(); }
  }
  async function saveBrowser() {
    if (!job || controller || nativePending) return;
    const prepared = job, requestSession = session;
    const requestController = new AbortController(); controller = requestController;
    setBusy(true); refresh(); message.textContent = t('正在检查导出文件…');
    try {
      await checkExport(prepared.id, requestController.signal);
      if (requestSession !== session || job !== prepared || !dialog.open) return;
      requestController.signal.throwIfAborted();
      const link = document.createElement('a');
      link.href = `${API_PATHS.EXPORT}?id=${encodeURIComponent(prepared.id)}`;
      link.download = prepared.fileName; link.hidden = true; dialog.append(link);
      try { link.click(); } finally { link.remove(); }
      downloadStarted = true;
      message.textContent = asset ? t('下载已交给浏览器。文件保留原始格式，可以直接使用。')
        : kind() === 'resources' ? t('下载已交给浏览器。资源包可在其他项目中导入。') : t('下载已交给浏览器。请先解压整个文件，再打开正文。');
    } catch (error) {
      if (requestSession !== session || job !== prepared || !dialog.open) return;
      if (requestController.signal.aborted) message.textContent = t('已取消下载，可以重试。');
      else if (error.status === 410) {
        discard(); message.textContent = t('导出文件已过期，请重新导出');
      } else message.textContent = t`下载失败：${asUiMessage(error.message)}`;
    } finally { controller = null; setBusy(false); refresh(); }
  }
  byId('docExportBtn')?.addEventListener('click', () => {
    if (nativePending) return;
    const current = getContext();
    if (current.busy && !controller && !resources.busy) { window.alert(exportAvailability(current, kind())); return; }
    // An aborted request may still be settling when this window is reopened.
    // Track its busy state through controller, never through the new snapshot.
    context = { ...current, busy: false };
    asset = null; returnToSelection = false;
    session += 1;
    discard();
    if (!context.path) options.querySelector('input[value="workspace"]').checked = true;
    byId('docExportContext').textContent = context.title ? t`当前文档：${context.title}` : t('导出当前作品');
    message.textContent = '';
    refresh(); dialog.showModal();
    resources.show(kind() === 'resources', context.path);
  });
  options.addEventListener('change', event => {
    if (byId('docResourcePackageOptions').contains(event.target)) return;
    discard(); message.textContent = ''; resources.show(kind() === 'resources', context.path); refresh();
  });
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  cancel.addEventListener('click', () => { controller?.abort(); resources.cancel(); });
  download.addEventListener('click', () => { void saveBrowser(); });
  save.addEventListener('click', () => { void saveNative(); });
  async function prepare() {
    if (controller || nativePending || resources.busy || job || exportAvailability(getContext(), kind()) || (kind() === 'resources' && !resources.ready)) return;
    const requestSession = session;
    const requestController = new AbortController(); controller = requestController;
    setBusy(true); refresh(); message.textContent = asset ? t('正在校验并准备原文件…') : t('正在整理正文与素材并校验文件…');
    try {
      const payload = asset ? { kind: 'asset', assetId: asset.id, language: getLanguage() }
        : { kind: kind(), format: format.value, path: context.path, language: getLanguage(),
          ...(kind() === 'resources' ? resources.payload() : { includeChildren: byId('docExportChildren').checked }) };
      const prepared = await requestExport(payload, requestController.signal);
      if (requestController.signal.aborted || requestSession !== session || !dialog.open) {
        void releaseExport(prepared.id).catch(() => {}); return;
      }
      job = prepared;
      message.textContent = t`已准备好 ${job.fileName}（${(job.bytes / 1024 ** 2).toFixed(1)} MB，${job.assetCount} 个素材）。`;
      if (native) save.hidden = false;
      else download.hidden = false;
    } catch (error) {
      if (requestSession === session && dialog.open) message.textContent = requestController.signal.aborted ? t('已取消导出，原始内容保留。') : t`导出失败：${asUiMessage(error.message)}`;
    } finally { controller = null; setBusy(false); refresh(); }
    if (native && job && requestSession === session && dialog.open) await saveNative();
  }
  function openAsset(selected) {
    if (!selected?.id || selected.status !== 'available' || controller || nativePending || resources.busy || getContext().busy) return;
    returnToSelection = dialog.open;
    asset = { id: selected.id, name: selected.name };
    context = { ...getContext(), busy: false };
    session += 1; discard(); message.textContent = '';
    refresh(); if (!dialog.open) dialog.showModal();
    void prepare();
  }
  back.addEventListener('click', () => {
    if (nativePending || resources.locked) return;
    session += 1; controller?.abort(); discard(); asset = null; returnToSelection = false;
    context = { ...getContext(), busy: false };
    message.textContent = ''; refresh();
  });
  start.addEventListener('click', () => { void prepare(); });
  return { exportAsset: openAsset };
}
