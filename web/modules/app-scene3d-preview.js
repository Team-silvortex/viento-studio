import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { supportsStudioCoreScene3D } from '../../engine/studio-core.mjs';
import { createScene3DRenderer } from './scene3d-renderer.js';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// This independent view receives read-only document snapshots. Camera gestures
// never produce a source proposal, World command or editor save operation.
export function setupScene3DPreview({ getContext = () => ({}), getSource = async () => null } = {}) {
  if (!document.getElementById('scene3dStyle')) {
    const style = document.createElement('link'); style.id = 'scene3dStyle'; style.rel = 'stylesheet';
    style.href = '/web/scene3d.css'; (document.head || document.body).append(style);
  }
  const button = document.createElement('button'); button.id = 'scene3dPreviewBtn'; button.type = 'button'; button.className = 'doc-btn doc-btn-ghost'; button.dataset.i18n = '3D预览';
  (document.getElementById('modeSwitch') || document.body).append(button);
  const unavailable = document.createElement('span'); unavailable.id = 'scene3dUnavailable'; unavailable.className = 'scene3d-note';
  (document.getElementById('modeSwitch') || document.body).append(unavailable);
  const dialog = document.createElement('dialog'); dialog.id = 'scene3dDialog'; dialog.className = 'scene3d-dialog'; dialog.setAttribute('aria-labelledby', 'scene3dTitle');
  dialog.innerHTML = `<header class="scene3d-header"><h2 id="scene3dTitle" data-i18n="3D场景预览"></h2>
    <button id="scene3dClose" type="button" class="doc-btn doc-btn-ghost" data-i18n="返回编辑器"></button></header>
    <p class="scene3d-note" data-i18n="只读预览当前JSON原文草稿。旋转和缩放只改变视角；修改仍在编辑器中普通保存。"></p>
    <p id="scene3dSource" class="scene3d-source"></p><p id="scene3dStatus" role="status" aria-live="polite"></p>
    <ul id="scene3dDiagnostics" class="scene3d-diagnostics"></ul>
    <div class="scene3d-layout"><section class="scene3d-viewport" aria-label="3D"><div id="scene3dSurface"></div>
      <p id="scene3dFallback" hidden data-i18n="此设备无法使用WebGL2，未绘制3D画面。对象声明仍可查看。"></p>
      <p class="scene3d-note" data-i18n="拖动旋转视角，滚轮缩放。Y轴向上，右手坐标系，欧拉旋转XYZ。"></p></section>
      <aside class="scene3d-sidebar"><h3 data-i18n="场景对象"></h3><ul id="scene3dObjects" class="scene3d-objects"></ul>
        <h3 data-i18n="对象声明"></h3><dl id="scene3dInspector" class="scene3d-inspector"></dl></aside></div>
    <footer class="scene3d-footer"><button id="scene3dRefresh" type="button" class="doc-btn" data-i18n="刷新当前草稿"></button>
      <button id="scene3dReset" type="button" class="doc-btn doc-btn-ghost" data-i18n="重置视角"></button></footer>`;
  document.body.append(dialog);
  const el = suffix => dialog.querySelector(`#scene3d${suffix}`);
  const node = (tag, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
  let epoch = 0, disposed = false, pending = false, session = null, renderer = null, canvas = null, opener = null;
  let selected = '', message = '', diagnostic = '', rendererFailed = false, viewPath = '';
  const supported = () => typeof supportsStudioCoreScene3D === 'function' && supportsStudioCoreScene3D();
  const eligible = context => Boolean(context.editable && !context.creating && context.sourceJSON === true && typeof context.sourcePath === 'string' && context.sourcePath && typeof context.sourceToken === 'string');
  const owns = (request, owner) => { const context = getContext(); return !disposed && dialog.open && request === epoch && eligible(context)
    && context.sourcePath === owner.sourcePath && context.sourceToken === owner.sourceToken; };
  function inspect() {
    const object = session?.parsed.model.objects.find(item => item.instanceId === selected);
    el('Inspector').replaceChildren(); if (!object) return;
    const location = session.parsed.sourceLocations.objects.find(item => item.instanceId === object.instanceId);
    const rows = [['名称', object.name], ['实例身份', object.instanceId], ['图元', 'box'], ['位置 XYZ', object.position.join(', ')],
      ['旋转 XYZ（度）', object.rotationDegrees.join(', ')], ['尺寸 XYZ', object.size.join(', ')], ['颜色', object.color], ['原文位置', location?.propertyPath || '']];
    for (const [label, value] of rows) el('Inspector').append(node('dt', t(label)), node('dd', value));
    if (location) el('Inspector').append(node('dt', t('原文字符范围')), node('dd', `${location.sourceRange.start}–${location.sourceRange.end} (UTF-16)`));
  }
  function renderObjects() {
    el('Objects').replaceChildren();
    for (const object of session?.parsed.model.objects || []) {
      const item = node('li'), select = node('button', object.name); select.type = 'button'; select.dataset.instanceId = object.instanceId;
      select.setAttribute('aria-pressed', String(selected === object.instanceId));
      select.addEventListener('click', () => { if (!pending && session) { selected = object.instanceId; renderObjects(); inspect(); } });
      item.append(select, node('code', object.instanceId)); el('Objects').append(item);
    }
    inspect();
  }
  function release() { renderer?.dispose(); renderer = null; canvas?.remove(); canvas = null; rendererFailed = false; }
  function repaint() {
    if (disposed) return;
    const context = getContext(); button.hidden = !eligible(context); button.disabled = context.busy === true || !supported();
    button.title = supported() ? t('3D预览') : t('当前核心不支持3D场景预览，原文编辑和2D功能仍可使用。');
    unavailable.hidden = !eligible(context) || supported(); unavailable.textContent = t('当前核心不支持3D预览');
    translatePage(dialog); button.textContent = t('3D预览');
    el('Status').textContent = t(message); el('Diagnostics').replaceChildren();
    if (diagnostic) el('Diagnostics').append(node('li', diagnostic));
    el('Source').textContent = session ? session.sourcePath : '';
    el('Refresh').disabled = pending || !eligible(context) || context.busy === true || !supported();
    el('Reset').disabled = pending || !renderer || rendererFailed;
    el('Fallback').hidden = !session || Boolean(renderer) && !rendererFailed;
    for (const select of el('Objects').querySelectorAll('button')) select.disabled = pending;
    inspect();
  }
  async function load() {
    const context = { ...getContext() }; if (pending || !dialog.open || !eligible(context) || context.busy || !supported()) return false;
    const request = ++epoch; pending = true; diagnostic = ''; message = '正在检查3D原文草稿…'; repaint();
    try {
      const snapshot = await getSource();
      if (!owns(request, context)) return false;
      if (!snapshot || typeof snapshot.content !== 'string' || snapshot.sourcePath !== context.sourcePath || snapshot.token !== context.sourceToken) throw new Error(t('当前草稿已变化，请重新刷新预览。'));
      const parsed = parseScene3DSource(snapshot.content);
      if (!owns(request, context)) return false;
      session = { parsed, sourcePath: snapshot.sourcePath, token: snapshot.token };
      el('Surface').style.aspectRatio = `${parsed.model.viewport[0]} / ${parsed.model.viewport[1]}`;
      if (!parsed.model.objects.some(item => item.instanceId === selected)) selected = parsed.model.objects[0].instanceId;
      if (!renderer && !rendererFailed) {
        canvas = node('canvas'); canvas.id = 'scene3dCanvas'; canvas.setAttribute('aria-label', t('3D场景画面')); canvas.tabIndex = 0; el('Surface').append(canvas);
        try { renderer = createScene3DRenderer(canvas, { onError: error => { if (disposed || !dialog.open) return; rendererFailed = true; diagnostic = error.message; message = '3D绘制中断；请关闭后重新打开预览。'; repaint(); } }); }
        catch (error) { diagnostic = error.message; rendererFailed = true; }
      }
      if (renderer && !rendererFailed) renderer.setModel(parsed.model);
      message = renderer && !rendererFailed ? '3D预览已刷新；未修改原文。' : '3D声明已检查；此设备未绘制3D画面。';
      renderObjects(); return true;
    } catch (error) {
      if (!owns(request, context)) return false;
      diagnostic = typeof error.message === 'string' ? error.message : String(error);
      message = session ? '草稿无效；保留上一次有效预览，请修正后刷新。' : '草稿不是有效的3D场景；请检查原文。'; return false;
    } finally { if (request === epoch) { pending = false;
      if (dialog.open && getContext().sourceToken !== context.sourceToken) message = session ? '原文草稿已变化；当前画面来自上一次有效预览。' : '原文草稿已变化，请刷新当前草稿。';
      repaint(); } }
  }
  async function open() {
    if (disposed || dialog.open) return false;
    const context = getContext(); if (!eligible(context) || context.busy || !supported()) return false;
    opener = document.activeElement; viewPath = context.sourcePath; message = ''; diagnostic = ''; selected = ''; session = null; dialog.showModal(); repaint();
    return load();
  }
  function close() {
    epoch++; pending = false; session = null; selected = ''; diagnostic = ''; message = ''; viewPath = ''; release();
    if (dialog.open) dialog.close();
    if (opener?.isConnected !== false && !disposed) opener?.focus?.(); opener = null; repaint(); return true;
  }
  function refresh() {
    if (disposed) return;
    const context = getContext();
    if (dialog.open && (!eligible(context) || viewPath !== context.sourcePath)) { close(); return; }
    if (dialog.open && session && session.token !== context.sourceToken && !pending) { message = '原文草稿已变化；当前画面来自上一次有效预览。'; diagnostic = ''; }
    repaint();
  }
  button.addEventListener('click', open); el('Refresh').addEventListener('click', load);
  el('Reset').addEventListener('click', () => { if (!pending && renderer && !rendererFailed) renderer.resetView(); });
  el('Close').addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && (session || renderer || pending)) close(); });
  const unsubscribe = onLanguageChange(() => { if (disposed) return; repaint(); renderObjects(); if (canvas) canvas.setAttribute('aria-label', t('3D场景画面')); });
  repaint();
  function dispose() { if (disposed) return; close(); disposed = true; unsubscribe?.(); button.remove(); unavailable.remove(); dialog.remove(); }
  return Object.freeze({ open, close, refresh, dispose, destroy: dispose });
}
