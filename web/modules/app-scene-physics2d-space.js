import { isScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { t } from '../i18n/index.js';

// This renderer accepts checked geometry and emits a body identity. The caller
// owns source sessions, requests and fields; no pixels, simulation or writes.
export function setupScenePhysics2DSpace({ root, onSelect = () => {} } = {}) {
  const document = root.ownerDocument, svgNamespace = 'http://www.w3.org/2000/svg';
  const node = (tag, className = '') => { const value = document.createElement(tag); value.className = className; return value; };
  const svgNode = (tag, attributes = {}) => { const value = document.createElementNS(svgNamespace, tag); for (const [key, content] of Object.entries(attributes)) value.setAttribute(key, String(content)); return value; };
  const stage = node('div', 'scene-physics2d-space-stage'), legend = node('div', 'scene-physics2d-space-legend'), choices = node('div', 'scene-physics2d-space-choices');
  const missing = node('p', 'scene-physics2d-note scene-physics2d-space-missing'); missing.setAttribute('role', 'status');
  stage.dataset.spaceStage = 'true'; choices.setAttribute('role', 'group'); root.append(stage, legend, missing, choices);
  const kinds = { character: '角色碰撞体', static: '静态碰撞体', sensor: '触发区域' };
  const legendNodes = Object.entries(kinds).map(([kind, key]) => { const value = node('span'); value.dataset.kind = kind; legend.append(value); return [value, key]; });
  const buttons = new Map(), shapes = new Map(); let currentView = null, selected = '', enabled = false;
  function choose(id, owner, target) {
    if (!enabled || owner !== currentView || !isScenePhysics2DSpaceView(currentView)
      || target && shapes.get(id) !== target || !buttons.has(id)) return;
    onSelect(id);
  }
  function clear() { currentView = null; selected = ''; enabled = false; buttons.clear(); shapes.clear(); stage.replaceChildren(); choices.replaceChildren(); missing.textContent = ''; root.hidden = true; }
  function render(view, options = {}) {
    if (!isScenePhysics2DSpaceView(view)) { clear(); return; }
    selected = typeof options.selected === 'string' ? options.selected : ''; enabled = options.enabled === true;
    const bodies = [...view.bodies, ...view.missingBodies], missingIds = new Set(view.missingBodies.map(body => body.id));
    const actors = new Map(view.actors.map(actor => [actor.instanceId, actor]));
    if (currentView !== view) {
      currentView = view; stage.replaceChildren(); shapes.clear();
      const { left, top, width, height } = view.bounds, padding = Math.max(width, height) * .04;
      const svg = svgNode('svg', { viewBox: `${left - padding} ${top - padding} ${width + padding * 2} ${height + padding * 2}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
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
        shape.addEventListener('click', () => choose(body.id, view, shape)); shapes.set(body.id, shape); svg.append(shape);
      }
      stage.append(svg);
      const ids = new Set(bodies.map(body => body.id));
      for (const [id, button] of buttons) if (!ids.has(id)) { button.remove(); buttons.delete(id); }
      for (const body of bodies) if (!buttons.has(body.id)) {
        const button = node('button', 'doc-btn doc-btn-ghost'); button.type = 'button'; button.dataset.spaceChoice = body.id;
        button.addEventListener('click', () => { if (buttons.get(body.id) === button) choose(body.id, currentView); }); buttons.set(body.id, button);
      }
      // Keep the declaration's existing controls independent. This list only
      // provides keyboard access to visible shapes and unresolved targets.
      choices.replaceChildren(...bodies.map(body => buttons.get(body.id)));
    }
    root.hidden = false; stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', t('场景碰撞形状：{0}', view.scene.title));
    choices.setAttribute('aria-label', t('选择场景中的碰撞体'));
    for (const [value, key] of legendNodes) value.textContent = t(key);
    missing.hidden = !view.missingBodies.length; missing.textContent = view.missingBodies.length ? t('{0} 个碰撞体的目标已不在场景中；保留声明，可选择后修正实例编号。', view.missingBodies.length) : '';
    for (const body of bodies) {
      const button = buttons.get(body.id), absent = missingIds.has(body.id), actor = actors.get(body.instanceId);
      button.disabled = !enabled; button.dataset.kind = body.kind; button.dataset.missing = String(absent); button.setAttribute('aria-pressed', String(body.id === selected));
      button.textContent = absent ? t('目标缺失 · {0} · 实例 {1} · 碰撞体 {2}', t(kinds[body.kind]), body.instanceId, body.id)
        : t('{0} · {1} · 实例 {2} · 碰撞体 {3}', actor.name, t(kinds[body.kind]), body.instanceId, body.id);
      const shape = shapes.get(body.id); if (shape) { shape.dataset.selected = String(body.id === selected); shape.dataset.enabled = String(enabled); }
    }
  }
  clear(); return Object.freeze({ render, clear });
}
