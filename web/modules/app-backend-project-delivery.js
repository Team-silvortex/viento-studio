import { backendProjectSourceIdentity } from '../../engine/backend-project.mjs';
import { createBackendProjectDeliveryReview, validateBackendProjectDeliveryReview } from '../../engine/backend-project-delivery.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { API_PATHS } from '../../scripts/lib/doc-api-contract.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A delivery owns one reviewed build and one temporary export job. It never
// reads author drafts, selects a runtime target, starts tools or chooses paths.
export function setupBackendProjectDelivery({ getContext, prepare, checkDownload, release, onChange = () => {} }) {
  const dialog = document.createElement('dialog'); dialog.id = 'backendDeliveryDialog'; dialog.className = 'project-build backend-delivery';
  dialog.setAttribute('aria-labelledby', 'backendDeliveryTitle');
  dialog.innerHTML = `<header class="build-heading"><h2 id="backendDeliveryTitle" data-i18n="交付工程"></h2>
    <button id="backendDeliveryClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回工程详情"></button></header>
    <section class="backend-delivery-body"><p class="build-note" data-i18n="交付包包含已核对的生成工程、资源和脚本副本，以及交付清单与使用说明。接收方仍需相应运行工具；这不是独立发行程序。"></p>
    <p class="build-hint" data-i18n="完整作者快照、构建日志和清单外文件不进入交付包。作者原文与当前草稿保持不变。"></p>
    <p class="build-hint" data-i18n="尚未下载的临时交付包会在关闭时清理；已交给浏览器的下载由服务稍后清理。"></p>
    <dl id="backendDeliveryFacts" class="backend-project-facts"></dl>
    <details open><summary data-i18n="将交付的文件"></summary><ul id="backendDeliveryFiles" class="backend-project-files"></ul></details></section>
    <p id="backendDeliveryStatus" role="status" aria-live="polite"></p><p id="backendDeliveryError" role="alert" class="scene-diagnostics" hidden></p>
    <footer class="build-actions"><button id="backendDeliveryPrepare" type="button" class="doc-btn" data-i18n="准备交付包"></button>
      <button id="backendDeliveryDownload" type="button" class="doc-btn" data-i18n="下载交付包" hidden></button>
      <button id="backendDeliverySave" type="button" class="doc-btn" data-i18n="保存交付包" hidden></button>
      <button id="backendDeliveryCancel" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消准备" hidden></button></footer>`;
  document.body.append(dialog);
  const el = name => dialog.querySelector('#backendDelivery' + name);
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
  const native = new URL(location.href).searchParams.get('desktop') === '1';
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  let origin = null, review = null, job = null, operation = null, nativePending = false, epoch = 0, disposed = false, disposeRequested = false;
  let message = '', messageArgs = [], error = '', opener = null, browserDispatchedJobId = null;
  const contextIdentity = context => ({ session: context.session, sceneId: context.sceneId, backendId: context.backendId, backendIdentity: context.backendIdentity });
  const owns = () => { const context = getContext(); return !disposed && !disposeRequested && dialog.open && review && origin
    && context.available === true && context.visible === true && canonicalJson(contextIdentity(context)) === canonicalJson(origin); };
  const idle = () => !operation && !nativePending;
  const permitted = () => owns() && getContext().busy !== true;
  const notify = () => { try { onChange(); } catch { /* Parent UI does not own delivery completion. */ } };
  function preparationError(failure) {
    const code = failure?.code || failure?.errorCode;
    if (code === 'build_busy') return '有任务正在处理，请稍后再准备交付包。';
    if (['backend_project_delivery_unavailable', 'build_local_only', 'build_service_closed'].includes(code)) return '当前会话不支持工程交付';
    if (['backend_project_delivery_changed', 'backend_project_changed', 'backend_project_workspace_changed', 'backend_project_owner_changed', 'build_artifact_missing'].includes(code)) return '生成工程或来源已变化，请返回工程详情重新核对。';
    return failure?.message || '无法准备交付包，请重新核对工程后重试。';
  }
  function status(key, ...args) { message = key; messageArgs = args; }
  function releaseId(id) { if (uuid(id)) void Promise.resolve().then(() => release(id)).catch(() => {}); }
  function discard() {
    // link.click only hands off to the browser. Releasing before its GET enters
    // the server would race download admission; dispatched jobs use host TTL.
    if (job && job.id !== browserDispatchedJobId) releaseId(job.id);
    job = null; browserDispatchedJobId = null;
  }
  function facts() {
    el('Facts').replaceChildren(); el('Files').replaceChildren(); if (!review) return;
    const project = review.project, sourceIdentity = backendProjectSourceIdentity(project);
    for (const [label, value] of [['交付文件名', review.fileName], ['构建标识', project.buildId], ['来源快照', project.snapshotId],
      [sourceIdentity.planKind === 'project' ? '来源组装标识' : '来源场景标识', sourceIdentity.objectId], ['后端标识', project.backend.id], ['生成入口', project.project.entry],
      ['运行工具版本', project.tool.version], ['工程清单指纹', review.manifestSha256], ['生成文件数量', project.files.length], ['素材数量', project.resources.length]]) {
      el('Facts').append(node('dt', t(label)), node('dd', String(value)));
    }
    for (const file of project.files) {
      const row = node('li'); row.append(node('p', file.path), node('p', t('{0} 字节', file.size)), node('p', file.sha256)); el('Files').append(row);
    }
  }
  function render() {
    if (disposed) return;
    translatePage(dialog); facts();
    const current = owns(), allowed = current && getContext().busy !== true;
    el('Prepare').disabled = !allowed || !idle() || Boolean(job);
    el('Download').hidden = native || !job; el('Save').hidden = !native || !job;
    el('Download').disabled = el('Save').disabled = !allowed || !idle() || !job;
    el('Close').disabled = nativePending;
    el('Cancel').hidden = !operation || nativePending;
    el('Cancel').textContent = t(operation?.kind === 'download' ? '取消下载' : '取消准备');
    el('Status').textContent = nativePending ? t('系统保存窗口正在打开，请先完成或取消保存。')
      : review && !current ? t('当前场景或服务已变化，请返回工程详情重新核对。') : t(message, ...messageArgs);
    el('Error').hidden = !error; el('Error').textContent = error ? t(error) : '';
    dialog.setAttribute('aria-busy', String(!idle()));
  }
  function close() {
    if (disposed) return true;
    if (nativePending) { status('系统保存窗口正在打开，请先完成或取消保存。'); render(); return false; }
    epoch++; operation?.controller.abort(); discard(); origin = review = null; error = ''; message = ''; messageArgs = [];
    if (dialog.open) dialog.close();
    if (opener?.isConnected !== false) opener?.focus?.(); opener = null; render(); notify(); return true;
  }
  function refresh() {
    if (disposed) return;
    if (review && !owns() && !nativePending) { operation?.controller.abort(); discard(); }
    render();
  }
  function open(receipt, owner) {
    if (disposed || disposeRequested || dialog.open || !idle()) return false;
    try {
      if (!receipt?.inspection || receipt.inspection.recorded !== true || typeof receipt.inspection.manifestSha256 !== 'string') return false;
      const next = createBackendProjectDeliveryReview(receipt.project, receipt.inspection.manifestSha256), context = getContext();
      const identity = contextIdentity(context);
      if (context.available !== true || context.visible !== true || context.busy === true
        || !(typeof identity.session === 'string' || Number.isSafeInteger(identity.session)) || !uuid(identity.sceneId)
        || typeof identity.backendIdentity !== 'string' || !identity.backendIdentity
        || canonicalJson(contextIdentity(owner || {})) !== canonicalJson(identity)
        || next.project.buildId !== owner.buildId || next.project.snapshotId !== owner.snapshotId
        || backendProjectSourceIdentity(next.project).objectId !== identity.sceneId || next.project.backend.id !== identity.backendId) return false;
      origin = Object.freeze(identity); review = next; epoch++; error = ''; status('请核对交付内容，再准备完整工程包。');
      opener = document.activeElement; dialog.showModal(); render(); notify(); return true;
    } catch { return false; }
  }
  function readJob(input) {
    const invalid = () => { throw Error('交付回执与已核对工程不一致，请重新核对。'); };
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const properties = Object.getOwnPropertyDescriptors(input), names = ['id','fileName','bytes','documentCount','assetCount','delivery'];
    if (Reflect.ownKeys(properties).length !== names.length || names.some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value'))) invalid();
    const delivery = validateBackendProjectDeliveryReview(properties.delivery.value);
    if (!uuid(input.id) || input.fileName !== review.fileName || delivery.fileName !== input.fileName
      || !Number.isSafeInteger(input.bytes) || input.bytes <= 0 || input.documentCount !== 0
      || input.assetCount !== review.project.resources.length || canonicalJson(delivery) !== canonicalJson(review)) invalid();
    return Object.freeze({ id: input.id, fileName: input.fileName, bytes: input.bytes, documentCount: 0, assetCount: input.assetCount, delivery });
  }
  async function preparePackage() {
    if (!permitted() || !idle() || job) return false;
    const captured = review, token = epoch, current = { kind: 'prepare', controller: new AbortController() }; operation = current; error = ''; status('正在核对并打包生成工程…'); render(); notify();
    let result;
    try {
      result = await prepare({ kind: 'backend-project', buildId: captured.project.buildId, expectedSnapshotId: captured.project.snapshotId,
        expectedManifestSha256: captured.manifestSha256 }, current.controller.signal);
      if (current.controller.signal.aborted || token !== epoch || !owns() || review !== captured) { releaseId(Object.getOwnPropertyDescriptor(result || {}, 'id')?.value); return false; }
      job = readJob(result); status('交付包已准备好：{0}（{1} 字节）。', job.fileName, job.bytes); return true;
    } catch (failure) {
      releaseId(Object.getOwnPropertyDescriptor(result || {}, 'id')?.value);
      if (!disposed && token === epoch && dialog.open) { if (current.controller.signal.aborted) status('已取消准备，工程和草稿保持不变。'); else error = preparationError(failure); }
      return false;
    } finally { if (operation === current) operation = null; render(); notify(); }
  }
  async function download() {
    if (!job || !permitted() || !idle()) return false;
    const prepared = job, token = epoch, current = { kind: 'download', controller: new AbortController() }; operation = current; error = ''; status('正在检查交付包…'); render(); notify();
    try {
      await checkDownload(prepared.id, current.controller.signal);
      if (current.controller.signal.aborted || token !== epoch || !owns() || job !== prepared) return false;
      const link = node('a'); link.href = `${API_PATHS.EXPORT}?id=${encodeURIComponent(prepared.id)}`; link.download = prepared.fileName; link.hidden = true; dialog.append(link);
      try { link.click(); browserDispatchedJobId = prepared.id; } finally { link.remove(); }
      status('下载已交给浏览器。请解压完整交付包，并按包内说明打开生成工程。'); return true;
    } catch (failure) {
      if (!disposed && token === epoch && dialog.open) {
        if (current.controller.signal.aborted) status('已取消下载，可以重试。');
        else if (failure?.status === 410) { discard(); error = '交付包已过期，请重新准备。'; }
        else error = failure?.message || '无法下载交付包，请重试。';
      }
      return false;
    } finally { if (operation === current) operation = null; render(); notify(); }
  }
  function nativeSave(prepared) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = () => window.removeEventListener('viento-export-result', receive);
      const receive = event => {
        const result = event.detail;
        if (result?.id !== prepared.id || result?.requestId !== requestId) return;
        cleanup(); if (result.ok === true) resolve(result); else reject(Error(typeof result?.error === 'string' ? result.error : '无法保存交付包，请重试。'));
      };
      window.addEventListener('viento-export-result', receive);
      fetch('/__desktop/export', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:prepared.id,requestId}) })
        .then(async response => { if (!response.ok) { const failure = Error('无法打开保存窗口'); failure.status = response.status; throw failure; } })
        .catch(failure => { cleanup(); reject(failure); });
    });
  }
  async function save() {
    if (!native || !job || !permitted() || !idle()) return false;
    const prepared = job; nativePending = true; error = ''; render(); notify();
    try {
      const result = await nativeSave(prepared);
      if (result.cancelled === true) status('已取消保存，可以重新选择位置。');
      else status('交付包已保存。可以再次保存或返回工程详情。');
      return result.cancelled !== true;
    } catch (failure) {
      if (failure?.status === 410) { discard(); error = '交付包已过期，请重新准备。'; }
      else error = failure?.message || '无法保存交付包，请重试。';
      return false;
    } finally {
      nativePending = false;
      if (disposeRequested) finishDispose(); else { refresh(); notify(); }
    }
  }
  function cancel() { if (!operation || nativePending) return false; operation.controller.abort(); status(operation.kind === 'download' ? '已取消下载，可以重试。' : '已取消准备，工程和草稿保持不变。'); render(); return true; }
  function finishDispose() { close(); disposed = true; unsubscribe?.(); dialog.remove(); notify(); }
  function dispose() { if (disposed || disposeRequested) return; disposeRequested = true; if (!nativePending) finishDispose(); }
  el('Prepare').addEventListener('click', () => void preparePackage()); el('Download').addEventListener('click', () => void download()); el('Save').addEventListener('click', () => void save());
  el('Cancel').addEventListener('click', cancel); el('Close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && review && !nativePending) close(); });
  const unsubscribe = onLanguageChange(refresh); render();
  return Object.freeze({ open, close, closed: close, refresh, dispose, isBusy: () => Boolean(operation || nativePending) });
}
