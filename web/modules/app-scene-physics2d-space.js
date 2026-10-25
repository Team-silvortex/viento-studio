import { isScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DOffsetProposal } from '../../engine/scene-physics2d-space-edit.mjs';
import { createScenePhysics2DResizeProposal } from '../../engine/scene-physics2d-space-resize.mjs';
import { t } from '../i18n/index.js';

// The renderer owns only navigation and a temporary collision-shape ghost. The caller
// accepts a proposal into its fields and owns checking, review and source writes.
export function setupScenePhysics2DSpace({ root, onSelect = () => {}, onOffsetProposal = () => false, onResizeProposal = () => false } = {}) {
  const document = root.ownerDocument, svgNamespace = 'http://www.w3.org/2000/svg';
  const node = (tag, className = '') => { const value = document.createElement(tag); value.className = className; return value; };
  const svgNode = (tag, attributes = {}) => { const value = document.createElementNS(svgNamespace, tag); for (const [key, content] of Object.entries(attributes)) value.setAttribute(key, String(content)); return value; };
  const toolbar = node('div', 'scene-physics2d-space-tools'), nudge = node('div', 'scene-physics2d-space-nudge'), resizeTools = node('div', 'scene-physics2d-space-nudge scene-physics2d-space-resize-tools');
  const stage = node('div', 'scene-physics2d-space-stage'), legend = node('div', 'scene-physics2d-space-legend'), choices = node('div', 'scene-physics2d-space-choices');
  const interaction = node('p', 'scene-physics2d-note scene-physics2d-space-interaction'); interaction.setAttribute('role', 'status'); interaction.setAttribute('aria-live', 'polite');
  const missing = node('p', 'scene-physics2d-note scene-physics2d-space-missing'); missing.setAttribute('role', 'status');
  stage.dataset.spaceStage = 'true'; stage.tabIndex = 0; choices.setAttribute('role', 'group'); toolbar.setAttribute('role', 'group'); nudge.setAttribute('role', 'group'); resizeTools.setAttribute('role', 'group');
  root.append(toolbar, stage, nudge, resizeTools, interaction, legend, missing, choices);
  const kinds = { character: '角色碰撞体', static: '静态碰撞体', sensor: '触发区域' };
  const legendNodes = Object.entries(kinds).map(([kind, key]) => { const value = node('span'); value.dataset.kind = kind; legend.append(value); return [value, key]; });
  const buttons = new Map(), shapes = new Map(), handles = new Map(), tools = [];
  let currentView = null, selected = '', enabled = false, mode = 'view', svg = null, fittedBox = null, camera = null, drag = null, ghost = null, suppressClick = null, resizeObserver = null;
  function tool(parent, action, label, callback) {
    const button = node('button', 'doc-btn doc-btn-ghost'); button.type = 'button'; button.dataset.spaceAction = action;
    button.addEventListener('click', event => { if (enabled && currentView) callback(event); }); parent.append(button); tools.push({ button, label }); return button;
  }
  tool(toolbar, 'zoom-in', '放大空间图', () => zoom(1 / 1.25)); tool(toolbar, 'zoom-out', '缩小空间图', () => zoom(1.25));
  tool(toolbar, 'fit', '显示全部', () => { cancelDrag(); setCamera(fittedBox); });
  const focusButton = tool(toolbar, 'focus', '聚焦选中碰撞体', () => {
    const body = selectedBody(); if (!body) return; cancelDrag();
    const [w, h] = bodySize(body), width = Math.max(w * 4, 64), height = Math.max(h * 4, 64);
    setCamera({ left: body.center[0] - width / 2, top: body.center[1] - height / 2, width, height });
  });
  const directions = [['left', '向左调整偏移', [-1, 0]], ['up', '向上调整偏移', [0, -1]], ['down', '向下调整偏移', [0, 1]], ['right', '向右调整偏移', [1, 0]]];
  const nudgeButtons = directions.map(([action, label, delta]) => tool(nudge, 'move-' + action, label, event => nudgeOffset(delta, event.shiftKey ? 10 : 1)));
  const dimensions = [['width', '减小宽度', '增大宽度'], ['height', '减小高度', '增大高度'], ['radius', '减小半径', '增大半径']];
  const resizeButtons = dimensions.flatMap(([dimension, less, more]) => [-1, 1].map(direction => ({ dimension, button: tool(resizeTools, dimension + (direction < 0 ? '-less' : '-more'), direction < 0 ? less : more, event => nudgeResize(dimension, direction * (event.shiftKey ? 10 : 1))) })));
  const selectedBody = () => currentView?.bodies.find(body => body.id === selected);
  const canAdjust = (operation = mode) => enabled && ['offset', 'resize'].includes(operation) && mode === operation && Boolean(selectedBody());
  const bodySize = body => body.shape.kind === 'box' ? body.shape.size : [body.shape.radius * 2, body.shape.radius * 2];
  function setCamera(next) { if (!svg || !next) return; camera = { ...next }; svg.setAttribute('viewBox', `${camera.left} ${camera.top} ${camera.width} ${camera.height}`); updateHandleRadii(); }
  function zoom(factor) {
    if (!camera || !fittedBox) return; cancelDrag();
    const width = Math.max(fittedBox.width / 64, Math.min(fittedBox.width * 16, camera.width * factor)), height = camera.height * width / camera.width;
    setCamera({ left: camera.left + (camera.width - width) / 2, top: camera.top + (camera.height - height) / 2, width, height });
  }
  function choose(id, owner, target) {
    if (target && suppressClick === target) { suppressClick = null; return; }
    if (!enabled || owner !== currentView || !isScenePhysics2DSpaceView(currentView)
      || target && shapes.get(id) !== target || !buttons.has(id)) return;
    cancelDrag(); onSelect(id);
  }
  function hint() {
    interaction.textContent = mode === 'offset' ? t('拖动已选中碰撞体调整偏移；方向按钮每次 1 单位，按住 Shift 为 10 单位。调整后请检查并审阅。')
      : mode === 'resize' ? t('拖动手柄围绕中心调整尺寸；矩形左右键调整宽度、上下键调整高度，圆形方向键调整半径。每次 1 单位，Shift 为 10 单位。调整后请检查并审阅。') : '';
    interaction.hidden = mode === 'view';
  }
  function removeGhost() { ghost?.remove(); ghost = null; stage.dataset.dragging = 'false'; }
  function visibilityChanged() { if (document.hidden) cancelDrag(); }
  function cancelDrag() {
    document.defaultView?.removeEventListener?.('blur', cancelDrag); document.removeEventListener?.('visibilitychange', visibilityChanged);
    const previous = drag; drag = null; removeGhost();
    if (previous) { if (previous.moved) suppressClick = previous.shape; try { stage.releasePointerCapture?.(previous.pointerId); } catch { /* Capture can already be lost. */ } }
    hint();
  }
  function clear() {
    resizeObserver?.disconnect(); resizeObserver = null;
    cancelDrag(); currentView = null; selected = ''; enabled = false; mode = 'view'; svg = null; camera = null; fittedBox = null;
    buttons.clear(); shapes.clear(); handles.clear(); stage.replaceChildren(); choices.replaceChildren(); missing.textContent = ''; interaction.textContent = ''; root.hidden = true;
  }
  function matrix() {
    try {
      const value = svg?.getScreenCTM?.(); if (!value) return null;
      const original = ['a', 'b', 'c', 'd', 'e', 'f'].map(key => value[key]), inverse = value.inverse();
      const mapped = ['a', 'b', 'c', 'd', 'e', 'f'].map(key => inverse[key]);
      if (![...original, ...mapped].every(Number.isFinite)) return null;
      return { original, inverse: mapped };
    } catch { return null; }
  }
  function point(event, transform) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const [a, b, c, d, e, f] = transform.inverse, x = a * event.clientX + c * event.clientY + e, y = b * event.clientX + d * event.clientY + f;
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  function proposal(delta, operation = mode) {
    try { return operation === 'resize' ? createScenePhysics2DResizeProposal(currentView, selected, delta) : createScenePhysics2DOffsetProposal(currentView, selected, delta); }
    catch { interaction.hidden = false; interaction.textContent = operation === 'resize' ? t('无法调整尺寸，请检查数值范围和物理内核后重试。') : t('无法调整偏移，请检查数值范围和物理内核后重试。'); return null; }
  }
  function deliver(value, operation = mode) {
    if (!value || !canAdjust(operation) || !value.delta.some(number => number !== 0)) return;
    const accept = operation === 'resize' ? onResizeProposal : onOffsetProposal;
    if (accept(value) !== true && currentView) { interaction.hidden = false; interaction.textContent = t('场景或字段已变化，请重新检查后调整。'); }
  }
  function nudgeOffset(delta, amount) { if (!canAdjust('offset')) return; cancelDrag(); deliver(proposal(delta.map(value => value * amount), 'offset'), 'offset'); }
  function nudgeResize(dimension, amount) {
    if (!canAdjust('resize')) return;
    const body = selectedBody();
    if (body.shape.kind === 'circle' ? dimension !== 'radius' : !['width', 'height'].includes(dimension)) return;
    cancelDrag(); const delta = dimension === 'radius' ? [amount] : [dimension === 'width' ? amount : 0, dimension === 'height' ? amount : 0];
    deliver(proposal(delta, 'resize'), 'resize');
  }
  function updateHandleRadii() {
    const transform = matrix(); if (!transform) return;
    const [a, b, c, d] = transform.original, trace = a * a + b * b + c * c + d * d, determinant = a * d - b * c;
    const maximum = Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2);
    const scale = Math.abs(determinant) / maximum;
    if (!Number.isFinite(scale) || scale <= 0) return;
    // Use real filled circles. A tiny circle plus a non-scaling stroke can
    // disappear from Chrome's hit testing even when its stroke is wide.
    for (const handle of handles.values()) {
      handle.children[0].setAttribute('r', String(14 / scale)); handle.children[1].setAttribute('r', String(6 / scale));
    }
  }
  function observeStage() {
    if (resizeObserver || !currentView || typeof document.defaultView?.ResizeObserver !== 'function') return;
    const observer = new document.defaultView.ResizeObserver(() => {
      if (resizeObserver !== observer || !currentView) return;
      const transform = matrix();
      if (drag && (!transform || drag.transform.original.some((number, index) => number !== transform.original[index]))) cancelDrag();
      updateHandleRadii();
    });
    resizeObserver = observer; observer.observe(stage);
  }
  function renderHandles() {
    const body = selectedBody(), wanted = mode === 'resize' && body ? (body.shape.kind === 'circle' ? ['e'] : ['e', 's', 'se']) : [];
    for (const [key, handle] of handles) if (!wanted.includes(key) || handle.dataset.bodyId !== selected) { handle.remove(); handles.delete(key); }
    for (const key of wanted) {
      let handle = handles.get(key);
      if (!handle) {
        handle = svgNode('g', { 'data-space-resize-handle': key, 'data-body-id': body.id, class: 'scene-physics2d-space-resize-handle' });
        const owner = currentView, target = handle;
        handle.addEventListener('pointerdown', event => startDrag(event, body, owner, target, 'resize', key));
        handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (suppressClick === target) suppressClick = null; });
        for (const kind of ['hit', 'knob']) handle.append(svgNode('circle', { r: kind === 'hit' ? 14 : 6, 'vector-effect': 'non-scaling-stroke', class: 'scene-physics2d-space-resize-' + kind }));
        handles.set(key, handle);
      }
      const [w, h] = bodySize(body), x = body.center[0] + (key.includes('e') ? w / 2 : 0), y = body.center[1] + (key.includes('s') ? h / 2 : 0);
      for (const circle of handle.children) { circle.setAttribute('cx', x); circle.setAttribute('cy', y); }
      handle.dataset.enabled = String(enabled); if (handle.parentElement) handle.remove(); svg.append(handle);
    }
    updateHandleRadii(); observeStage();
  }
  function startDrag(event, body, owner, shape, operation = 'offset', handle = null) {
    suppressClick = null;
    if (drag) { if (drag.pointerId !== event.pointerId) cancelDrag(); return; }
    if (owner !== currentView || (operation === 'resize' ? handles.get(handle) !== shape : shapes.get(body.id) !== shape) || !canAdjust(operation) || selected !== body.id
      || event.button !== 0 || event.isPrimary === false || event.ctrlKey || event.metaKey || event.altKey) return;
    const transform = matrix(), start = transform && point(event, transform);
    if (!start) { interaction.hidden = false; interaction.textContent = t('无法读取空间图坐标，请重新显示后重试。'); return; }
    event.preventDefault(); event.stopPropagation(); stage.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, view: owner, body, shape, operation, handle, start, client: [event.clientX, event.clientY], transform, moved: false, candidate: null };
    try {
      if (typeof stage.setPointerCapture !== 'function') { cancelDrag(); return; } stage.setPointerCapture(event.pointerId);
      if (typeof stage.hasPointerCapture === 'function' && !stage.hasPointerCapture(event.pointerId)) { cancelDrag(); return; }
      document.defaultView?.addEventListener?.('blur', cancelDrag); document.addEventListener?.('visibilitychange', visibilityChanged);
    } catch { cancelDrag(); }
  }
  function updateDrag(event) {
    const active = drag; if (!active || active.pointerId !== event.pointerId) return false;
    if (event.type === 'pointermove' && event.buttons === 0) { cancelDrag(); return false; }
    const transform = matrix();
    if (!canAdjust(active.operation) || active.view !== currentView || active.body.id !== selected || !transform
      || active.transform.original.some((number, index) => number !== transform.original[index])) { cancelDrag(); return false; }
    const current = point(event, transform); if (!current) { cancelDrag(); return false; }
    active.moved ||= Math.hypot(event.clientX - active.client[0], event.clientY - active.client[1]) > 3;
    if (!active.moved) return true;
    event.preventDefault(); let delta = current.map((value, axis) => value - active.start[axis]);
    if (active.operation === 'resize') delta = active.body.shape.kind === 'circle' ? [delta[0]] : [active.handle.includes('e') ? delta[0] * 2 : 0, active.handle.includes('s') ? delta[1] * 2 : 0];
    active.candidate = proposal(delta, active.operation); removeGhost();
    if (!active.candidate) return true;
    const [x, y] = active.candidate.center, shape = active.operation === 'resize' ? active.candidate.shape : active.body.shape, common = { 'data-space-ghost': active.body.id, 'data-operation': active.operation, 'data-kind': active.body.kind, 'vector-effect': 'non-scaling-stroke', class: 'scene-physics2d-space-ghost' };
    ghost = shape.kind === 'box' ? svgNode('rect', { ...common, x: x - shape.size[0] / 2, y: y - shape.size[1] / 2, width: shape.size[0], height: shape.size[1] })
      : svgNode('circle', { ...common, cx: x, cy: y, r: shape.radius });
    svg.append(ghost); stage.dataset.dragging = 'true'; interaction.hidden = false;
    const display = value => Number(value.toFixed(3));
    interaction.textContent = active.operation === 'offset' ? t('待确认偏移：X {0}，Y {1}', ...active.candidate.offset.map(display))
      : shape.kind === 'box' ? t('待确认尺寸：宽 {0}，高 {1}', ...shape.size.map(display)) : t('待确认半径：{0}', display(shape.radius)); return true;
  }
  stage.addEventListener('pointerdown', event => { if (drag && drag.pointerId !== event.pointerId) cancelDrag(); });
  stage.addEventListener('pointermove', updateDrag);
  stage.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId || !updateDrag(event)) return;
    const completed = drag, rejected = completed.moved && !completed.candidate ? interaction.textContent : '';
    cancelDrag();
    if (rejected) { interaction.hidden = false; interaction.textContent = rejected; }
    else if (completed.moved) deliver(completed.candidate, completed.operation);
  });
  for (const name of ['pointercancel', 'lostpointercapture']) stage.addEventListener(name, event => { if (drag && drag.pointerId === event.pointerId) cancelDrag(); });
  stage.addEventListener('blur', cancelDrag);
  stage.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); cancelDrag(); return; }
    if (event.target !== stage || !canAdjust() || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (delta) {
      event.preventDefault(); event.stopPropagation(); const amount = event.shiftKey ? 10 : 1;
      if (mode === 'offset') nudgeOffset(delta, amount);
      else nudgeResize(selectedBody().shape.kind === 'circle' ? 'radius' : delta[0] ? 'width' : 'height', (delta[0] || delta[1]) * amount);
    }
  });
  function render(view, options = {}) {
    if (!isScenePhysics2DSpaceView(view)) { clear(); return; }
    const nextSelected = typeof options.selected === 'string' ? options.selected : '', nextEnabled = options.enabled === true, nextMode = ['offset', 'resize'].includes(options.mode) ? options.mode : 'view';
    if (currentView !== view || selected !== nextSelected || !nextEnabled || mode !== nextMode) cancelDrag();
    selected = nextSelected; enabled = nextEnabled; mode = nextMode;
    const bodies = [...view.bodies, ...view.missingBodies], missingIds = new Set(view.missingBodies.map(body => body.id));
    const actors = new Map(view.actors.map(actor => [actor.instanceId, actor]));
    if (currentView !== view) {
      currentView = view; stage.replaceChildren(); shapes.clear(); handles.clear();
      const { left, top, width, height } = view.bounds, padding = Math.max(width, height) * .04;
      svg = svgNode('svg', { preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
      fittedBox = { left: left - padding, top: top - padding, width: width + padding * 2, height: height + padding * 2 }; setCamera(fittedBox);
      const viewport = svgNode('rect', { x: 0, y: 0, width: view.scene.viewport[0], height: view.scene.viewport[1], fill: view.scene.background, 'data-space-viewport': 'true', 'vector-effect': 'non-scaling-stroke' });
      viewport.setAttribute('class', 'scene-physics2d-space-viewport'); svg.append(viewport);
      const markerSize = Math.max(width, height) / 180;
      for (const actor of view.actors) {
        const [x, y] = actor.position, [w, h] = actor.size;
        const group = svgNode('g', { 'data-space-actor': actor.instanceId, class: 'scene-physics2d-space-actor' });
        group.append(svgNode('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, fill: actor.color, 'vector-effect': 'non-scaling-stroke' }),
          svgNode('path', { d: `M ${x - markerSize} ${y} H ${x + markerSize} M ${x} ${y - markerSize} V ${y + markerSize}`, 'vector-effect': 'non-scaling-stroke' }));
        svg.append(group);
      }
      for (const body of view.bodies) {
        const [x, y] = body.center, common = { 'data-space-body': body.id, 'data-kind': body.kind, 'vector-effect': 'non-scaling-stroke', class: 'scene-physics2d-space-shape' };
        const shape = body.shape.kind === 'box' ? svgNode('rect', { ...common, x: x - body.shape.size[0] / 2, y: y - body.shape.size[1] / 2, width: body.shape.size[0], height: body.shape.size[1] })
          : svgNode('circle', { ...common, cx: x, cy: y, r: body.shape.radius });
        shape.addEventListener('click', () => choose(body.id, view, shape)); shape.addEventListener('pointerdown', event => startDrag(event, body, view, shape)); shapes.set(body.id, shape); svg.append(shape);
      }
      stage.append(svg);
      const ids = new Set(bodies.map(body => body.id));
      for (const [id, button] of buttons) if (!ids.has(id)) { button.remove(); buttons.delete(id); }
      for (const body of bodies) if (!buttons.has(body.id)) {
        const button = node('button', 'doc-btn doc-btn-ghost'); button.type = 'button'; button.dataset.spaceChoice = body.id;
        button.addEventListener('click', () => { if (buttons.get(body.id) === button) choose(body.id, currentView); }); buttons.set(body.id, button);
      }
      choices.replaceChildren(...bodies.map(body => buttons.get(body.id)));
    }
    root.hidden = false; stage.dataset.mode = mode; stage.setAttribute('role', mode === 'view' ? 'img' : 'group'); stage.setAttribute('aria-label', t('场景碰撞形状：{0}', view.scene.title));
    toolbar.setAttribute('aria-label', t('空间图视图控制')); nudge.setAttribute('aria-label', t('调整选中碰撞体偏移')); nudge.hidden = mode !== 'offset'; resizeTools.setAttribute('aria-label', t('调整选中碰撞体尺寸')); resizeTools.hidden = mode !== 'resize';
    for (const { button, label } of tools) { button.textContent = t(label); button.disabled = !enabled; }
    focusButton.disabled = !enabled || !selectedBody(); for (const button of nudgeButtons) button.disabled = !canAdjust('offset');
    for (const { dimension, button } of resizeButtons) { button.disabled = !canAdjust('resize'); button.hidden = selectedBody()?.shape.kind === 'circle' ? dimension !== 'radius' : dimension === 'radius'; }
    if (!drag) hint(); choices.setAttribute('aria-label', t('选择场景中的碰撞体'));
    for (const [value, key] of legendNodes) value.textContent = t(key);
    missing.hidden = !view.missingBodies.length; missing.textContent = view.missingBodies.length ? t('{0} 个碰撞体的目标已不在场景中；保留声明，可选择后修正实例编号。', view.missingBodies.length) : '';
    for (const body of bodies) {
      const button = buttons.get(body.id), absent = missingIds.has(body.id), actor = actors.get(body.instanceId);
      button.disabled = !enabled; button.dataset.kind = body.kind; button.dataset.missing = String(absent); button.setAttribute('aria-pressed', String(body.id === selected));
      button.textContent = absent ? t('目标缺失 · {0} · 实例 {1} · 碰撞体 {2}', t(kinds[body.kind]), body.instanceId, body.id)
        : t('{0} · {1} · 实例 {2} · 碰撞体 {3}', actor.name, t(kinds[body.kind]), body.instanceId, body.id);
      const shape = shapes.get(body.id); if (shape) { shape.dataset.selected = String(body.id === selected); shape.dataset.enabled = String(enabled); }
    }
    // Bring the selected shape above overlapping bodies without replacing its
    // node; the list keeps every overlapping body keyboard-selectable.
    const activeShape = shapes.get(selected);
    if (mode !== 'view' && activeShape) { activeShape.remove(); svg.append(activeShape); }
    renderHandles(); if (ghost) { ghost.remove(); svg.append(ghost); }
  }
  clear(); return Object.freeze({ render, clear });
}
