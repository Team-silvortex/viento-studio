import { resolveSceneCamera2DFrame, fitSceneCamera2DFrame, moveSceneCamera2DFrame } from '../../engine/scene-camera2d-frame.mjs';
import { captureSceneCamera2DFramingContext } from '../../engine/scene-camera2d-framing-context.mjs';
import { t, translatePage, onLanguageChange } from '../i18n/index.js';

// A geometry view owns a temporary camera gesture, never a scene mutation or a
// save ticket. Its only author-facing output is one explicit camera candidate.
export function createSceneCamera2DComposerCanvas({ canvas, canEdit = () => true, onCandidate = () => {} }) {
  const context = canvas.getContext?.('2d'), listeners = [];
  let model = null, frame = null, view = { scale: 1, offsetX: 0, offsetY: 0 }, width = 0, height = 0;
  let drag = null, disposed = false, fitMode = 'all', key = '';
  const geometry = () => model.actors.map(actor => ({ instanceId: actor.instanceId,
    position: [actor.position[0], actor.position[1]], size: [actor.size[0], actor.size[1]] }));
  const resolve = camera => resolveSceneCamera2DFrame({ camera, actors: geometry(), viewport: [...model.viewport] });
  const point = event => { const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
  const screen = (x, y) => [view.offsetX + x * view.scale, view.offsetY + y * view.scale];
  const candidateFrame = () => drag?.kind === 'frame' ? resolve(drag.camera) : frame;
  const available = () => !disposed && model && frame && canEdit();
  function release() { if (drag) { const id = drag.id; drag = null; try { canvas.releasePointerCapture?.(id); } catch { /* Already released. */ } } }
  function cancel() {
    if (drag?.kind === 'pan') { view = { ...drag.view }; fitMode = drag.fitMode; }
    release(); draw();
  }
  function draw() {
    if (disposed || !context) return;
    const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1), 4096 / Math.max(1, width, height));
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b1523'; context.fillRect(0, 0, width, height);
    canvas.dataset.view = JSON.stringify(view); canvas.dataset.dragging = drag?.kind || '';
    const shown = model && frame ? candidateFrame() : null;
    canvas.dataset.frame = shown ? JSON.stringify(shown) : '';
    if (!model || !shown || !width || !height) return;
    context.save(); context.translate(view.offsetX, view.offsetY); context.scale(view.scale, view.scale);
    const pixel = 1 / view.scale;
    // The grey rectangle is the scene's design viewport, not the selected
    // assembly's output or a live camera. It never clips world geometry.
    context.strokeStyle = '#67809a'; context.lineWidth = pixel; context.setLineDash([3 * pixel, 5 * pixel]);
    context.strokeRect(0, 0, ...model.designViewport); context.setLineDash([]);
    if (shown.limits) {
      const { left, top, right, bottom } = shown.limits;
      context.strokeStyle = '#64d9e9'; context.lineWidth = 2 * pixel;
      context.strokeRect(left, top, right - left, bottom - top);
    }
    for (const actor of model.actors) {
      const [x, y] = actor.position, [w, h] = actor.size;
      context.fillStyle = actor.color; context.fillRect(x - w / 2, y - h / 2, w, h);
      context.strokeStyle = actor.instanceId === shown.targetInstanceId ? '#82dbff' : '#b3c6d6';
      context.lineWidth = pixel; context.strokeRect(x - w / 2, y - h / 2, w, h);
      const at = screen(x, y + h / 2);
      context.save(); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.font = '12px sans-serif';
      context.textAlign = 'center'; context.fillStyle = '#c9dce8'; context.fillText(actor.name.slice(0, 36), at[0], at[1] + 15); context.restore();
    }
    const { left, top, right, bottom } = shown.bounds, [cx, cy] = shown.center;
    context.strokeStyle = '#ffcc66'; context.lineWidth = 2 * pixel; context.setLineDash([8 * pixel, 5 * pixel]);
    context.strokeRect(left, top, right - left, bottom - top); context.setLineDash([]);
    context.beginPath(); context.moveTo(cx - 7 * pixel, cy); context.lineTo(cx + 7 * pixel, cy);
    context.moveTo(cx, cy - 7 * pixel); context.lineTo(cx, cy + 7 * pixel); context.stroke();
    if (shown.desiredCenter) {
      const [dx, dy] = shown.desiredCenter;
      context.strokeStyle = '#f5b7ec'; context.lineWidth = pixel; context.setLineDash([3 * pixel, 4 * pixel]);
      context.beginPath(); context.moveTo(dx, dy); context.lineTo(cx, cy); context.stroke(); context.setLineDash([]);
      context.beginPath(); context.arc(dx, dy, 5 * pixel, 0, Math.PI * 2); context.stroke();
    }
    if (shown.targetPosition) {
      context.strokeStyle = '#82dbff'; context.lineWidth = pixel; context.setLineDash([3 * pixel, 4 * pixel]);
      context.beginPath(); context.moveTo(...shown.targetPosition); context.lineTo(cx, cy); context.stroke(); context.setLineDash([]);
    }
    context.restore();
  }
  function fit(scope = 'camera') {
    if (disposed) return false;
    cancel(); if (!model || !frame || width < 1 || height < 1) return false;
    view = { ...fitSceneCamera2DFrame(frame, geometry(), width, height, { scope }) }; fitMode = scope; draw(); return true;
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect(); if (![rect.width, rect.height].every(Number.isFinite)) return;
    const nextWidth = Math.min(65536, Math.max(0, rect.width)), nextHeight = Math.min(65536, Math.max(0, rect.height));
    if (width === nextWidth && height === nextHeight) { draw(); return; }
    cancel(); width = nextWidth; height = nextHeight;
    if (fitMode && width >= 1 && height >= 1 && model && frame) fit(fitMode); else draw();
  }
  function zoom(factor, x = width / 2, y = height / 2) {
    if (!available()) return;
    cancel(); const old = view.scale, scale = Math.max(1e-6, Math.min(16, old * factor));
    const wx = (x - view.offsetX) / old, wy = (y - view.offsetY) / old;
    view = { scale, offsetX: x - wx * scale, offsetY: y - wy * scale }; fitMode = null; draw();
  }
  const listen = (type, fn, options) => { canvas.addEventListener(type, fn, options); listeners.push([type, fn, options]); };
  listen('pointerdown', event => {
    if (!available() || ![0, 1].includes(event.button) || drag) return;
    const p = point(event); if (!p.every(Number.isFinite)) return;
    const [x, y] = [(p[0] - view.offsetX) / view.scale, (p[1] - view.offsetY) / view.scale], b = frame.bounds;
    const movingFrame = event.button === 0 && !event.altKey && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    drag = { kind: movingFrame ? 'frame' : 'pan', id: event.pointerId, start: p, view: { ...view }, fitMode,
      initial: model.camera, camera: model.camera, key };
    canvas.focus(); canvas.setPointerCapture?.(event.pointerId); event.preventDefault(); draw();
  });
  listen('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!available() || drag.key !== key) { cancel(); return; }
    const p = point(event); if (!p.every(Number.isFinite)) { cancel(); return; }
    const delta = [p[0] - drag.start[0], p[1] - drag.start[1]];
    if (drag.kind === 'frame') drag.camera = moveSceneCamera2DFrame(drag.initial, delta.map(value => value / drag.view.scale));
    else { view = { ...drag.view, offsetX: drag.view.offsetX + delta[0], offsetY: drag.view.offsetY + delta[1] }; fitMode = null; }
    event.preventDefault(); draw();
  });
  listen('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!available() || drag.key !== key) { cancel(); return; }
    const p = point(event); if (!p.every(Number.isFinite)) { cancel(); return; }
    const delta = [p[0] - drag.start[0], p[1] - drag.start[1]];
    if (drag.kind === 'frame') drag.camera = moveSceneCamera2DFrame(drag.initial, delta.map(value => value / drag.view.scale));
    else { view = { ...drag.view, offsetX: drag.view.offsetX + delta[0], offsetY: drag.view.offsetY + delta[1] }; fitMode = null; }
    const completed = drag; release(); draw();
    if (completed.kind === 'frame' && JSON.stringify(completed.camera) !== JSON.stringify(completed.initial)) onCandidate(completed.camera, { initialCamera: completed.initial });
  });
  const cancelPointer = event => { if (drag && event.pointerId === drag.id) cancel(); };
  listen('pointercancel', cancelPointer); listen('lostpointercapture', cancelPointer);
  listen('wheel', event => { if (!available()) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, ...point(event)); }, { passive: false });
  listen('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (!available() || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.key === 'Home' || event.key === '0') { event.preventDefault(); fit(event.key === 'Home' ? 'camera' : 'all'); return; }
    if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? 1 / 1.1 : 1.1); return; }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) { event.preventDefault(); cancel(); onCandidate(moveSceneCamera2DFrame(model.camera, directions[event.key].map(value => value * (event.shiftKey ? 10 : 1))), { initialCamera: model.camera }); }
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(canvas);
  return {
    setModel(value) {
      if (disposed) return;
      const nextKey = value ? JSON.stringify(value) : '';
      if (key !== nextKey) { cancel(); key = nextKey; model = value; frame = null; if (model) { try { frame = resolve(model.camera); } catch { /* Invalid input clears the frame. */ } } }
      resize(); draw();
    }, fit, cancel, resize,
    getFrame: () => frame, getView: () => ({ ...view }),
    reset() { if (disposed) return; cancel(); key = ''; model = null; frame = null; fitMode = 'all'; view = { scale: 1, offsetX: 0, offsetY: 0 }; draw(); },
    destroy() { if (disposed) return; release(); key = ''; model = null; frame = null; draw(); disposed = true; observer?.disconnect(); for (const row of listeners) canvas.removeEventListener(...row); },
  };
}

export function setupSceneCamera2DComposer({ container, canEdit = () => true, onCandidate = () => {} }) {
  container.innerHTML = `<h3 data-i18n="相机构图示意"></h3><p data-i18n="仅显示逻辑几何，不含素材、动画或运行模拟。拖动取景框只修改表单，仍需审阅和保存。"></p>
    <label><span data-i18n="构图视口参照"></span><select id="sceneCamera2DComposerViewport"></select></label>
    <p id="sceneCamera2DComposerSource" class="camera-composer-source"></p>
    <p data-i18n="组装参照只提供入口视口尺寸，不代表已通过构建或运行检查。"></p>
    <div class="camera-composer-toolbar"><button id="sceneCamera2DComposerFit" type="button" class="doc-btn doc-btn-ghost" data-i18n="适配相机取景"></button>
      <button id="sceneCamera2DComposerAll" type="button" class="doc-btn doc-btn-ghost" data-i18n="查看全部构图"></button>
      <button id="sceneCamera2DComposerCancelDrag" type="button" class="doc-btn doc-btn-ghost" data-i18n="取消取景拖动"></button></div>
    <canvas id="sceneCamera2DComposerCanvas" tabindex="0" aria-describedby="sceneCamera2DComposerHelp sceneCamera2DComposerStatus" data-i18n-aria-label="相机逻辑构图画布"></canvas>
    <p id="sceneCamera2DComposerHelp" data-i18n="框内拖动或方向键调整相机；Shift 方向键移动 10 单位。空白或 Alt 拖动平移视图，滚轮只缩放示意。Esc 取消拖动，Home 适配相机，0 查看全部。"></p>
    <p id="sceneCamera2DComposerLimitsLegend" data-i18n="青色框是世界边界，橙色十字是实际中心，圆点是期望中心。拖动改变声明中心或偏移。" hidden></p>
    <p id="sceneCamera2DComposerStatus" role="status" aria-live="polite"></p>`;
  const el = suffix => container.querySelector('#sceneCamera2DComposer' + suffix);
  let framing = null, camera = null, ownerKey = '', inputKey = '', selected = '', error = '', disposed = false;
  const renderer = createSceneCamera2DComposerCanvas({ canvas: el('Canvas'), canEdit: () => !disposed && canEdit(), onCandidate });
  function refresh() {
    translatePage(container); if (!canEdit()) renderer.cancel(); const option = framing?.viewports.find(row => row.id === selected);
    const rows = framing?.actors;
    let model = null;
    if (rows && option && camera) model = { camera, actors: rows, viewport: option.viewport, designViewport: framing.viewports[0].viewport };
    renderer.setModel(model);
    const valid = Boolean(renderer.getFrame()), locked = !canEdit();
    const limitsLegend = el('LimitsLegend'); if (limitsLegend) limitsLegend.hidden = !renderer.getFrame()?.limits;
    el('Viewport').disabled = !framing || locked; el('Fit').disabled = !valid || locked; el('All').disabled = !valid || locked; el('CancelDrag').disabled = locked;
    el('Canvas').setAttribute('aria-disabled', String(locked));
    el('Source').textContent = option ? `${option.source.sourcePath}${option.entryScene ? ' → ' + option.entryScene.sourcePath : ''}` : '';
    const kind = option?.kind === 'assembly-entry' ? '组装入口视口参照' : '当前场景设计视口参照';
    el('Status').textContent = error ? t(error) : !valid ? t('当前参数或场景几何无效，取景框已隐藏；数字表单仍可编辑。')
      : t('{0}：{1} × {2}。橙框是初始构图，灰框是场景设计视口。', t(kind), ...option.viewport);
    if (framing?.diagnostics.length) el('Status').textContent += ' ' + t('{0} 条构图来源提示；部分参照可能无效或超过目录上限。数字设置仍可编辑。', framing.diagnostics.length);
  }
  function viewportOptions() {
    const current = el('Viewport').value; el('Viewport').replaceChildren();
    if (!framing) return;
    for (const option of framing.viewports) {
      const node = document.createElement('option'); node.value = option.id;
      node.textContent = t(option.kind === 'assembly-entry' ? '组装入口：{0}（{1} × {2}）' : '场景设计：{0}（{1} × {2}）', option.title, ...option.viewport);
      el('Viewport').append(node);
    }
    selected = framing.viewports.some(option => option.id === current) ? current : framing.viewports[0].id;
    el('Viewport').value = selected;
  }
  el('Viewport').addEventListener('change', () => { if (!canEdit() || !framing?.viewports.some(row => row.id === el('Viewport').value)) return; renderer.cancel(); selected = el('Viewport').value; refresh(); renderer.fit('camera'); });
  el('Fit').addEventListener('click', () => { if (canEdit()) renderer.fit('camera'); }); el('All').addEventListener('click', () => { if (canEdit()) renderer.fit('all'); });
  el('CancelDrag').addEventListener('click', () => renderer.cancel());
  const unsubscribe = onLanguageChange(() => { viewportOptions(); refresh(); });
  return {
    setData(catalog, nextCamera, active) {
      if (disposed) return;
      const nextOwner = active && catalog ? `${catalog.worldId}:${catalog.baseRevision}:${catalog.scene?.objectId}:${catalog.scene?.sourceRevision}` : '';
      if (nextOwner !== ownerKey) { renderer.reset(); framing = null; selected = ''; el('Viewport').value = ''; ownerKey = nextOwner; inputKey = ''; }
      error = '';
      if (catalog && active) {
        try {
          const next = captureSceneCamera2DFramingContext(catalog.framing, catalog), nextKey = JSON.stringify(next);
          if (nextKey !== inputKey) { framing = next; inputKey = nextKey; viewportOptions(); }
        } catch { framing = null; inputKey = ''; viewportOptions(); error = '构图上下文不可用，数字表单仍可编辑。'; }
      } else { framing = null; inputKey = ''; viewportOptions(); }
      camera = nextCamera; refresh();
      globalThis.requestAnimationFrame?.(() => { if (!disposed) renderer.resize(); });
    },
    cancel: () => renderer.cancel(),
    dispose() { disposed = true; unsubscribe?.(); renderer.destroy(); },
  };
}
