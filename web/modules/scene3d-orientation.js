import { orientationAxes } from './scene3d-math.js';

// This passive indicator owns only its DOM and a detached orientation snapshot.
// It never reads the scene, renderer, author source or engine/host interfaces.
export function createScene3DOrientationIndicator(container, { t = key => key } = {}) {
  const document = container.ownerDocument, namespace = 'http://www.w3.org/2000/svg';
  const root = container, previousRole = root.getAttribute('role'), previousLabel = root.getAttribute('aria-label');
  const previousPointerEvents = root.style.pointerEvents; root.hidden = true;
  root.setAttribute('role', 'img'); root.style.pointerEvents = 'none';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('class', 'scene3d-orientation-svg'); svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('width', '96'); svg.setAttribute('height', '96');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('pointer-events', 'none');
  root.append(svg);
  const colors = { X: '#ff9898', Y: '#85d7bb', Z: '#91baff' };
  let axes = null, disposed = false;
  const node = (name, attributes = {}) => {
    const element = document.createElementNS(namespace, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const facing = axis => axis.depth > 1e-10 ? '朝向观察者' : axis.depth < -1e-10 ? '背向观察者' : '位于画面平面';
  function refresh() {
    if (disposed) return false;
    const description = axes ? axes.map(axis => `${t(`${axis.axis}轴`)} +${axis.axis}：${t(facing(axis))}`).join('；') : '';
    root.setAttribute('aria-label', description ? `${t('坐标方向')}。${description}` : t('坐标方向'));
    return Boolean(axes);
  }
  function draw() {
    svg.replaceChildren();
    const lines = node('g', { 'data-layer': 'axes' }), labels = node('g', { 'data-layer': 'labels' });
    const sorted = [...axes].sort((a, b) => a.depth - b.depth), occupied = [];
    for (const axis of sorted) {
      const x = 48 + axis.x * 28, y = 48 + axis.y * 28, color = colors[axis.axis];
      const group = node('g', { 'data-axis': axis.axis, 'data-depth': axis.depth });
      group.append(node('line', { x1: 48, y1: 48, x2: x, y2: y, stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }));
      group.append(node('circle', { cx: x, cy: y, r: 3.2, stroke: color, 'stroke-width': 1.6,
        fill: axis.depth < -1e-10 ? 'none' : color, 'data-facing': axis.depth > 1e-10 ? 'toward' : axis.depth < -1e-10 ? 'away' : 'plane' }));
      lines.append(group);
      const length = Math.hypot(axis.x, axis.y);
      const preferred = length < 1e-8 ? [48, 62] : [x + axis.x / length * 9, y + axis.y / length * 9];
      // Collinear projected axes are valid. Separate their fixed labels rather
      // than hiding one behind another; exact poles retain a readable +label.
      const candidates = [[0, 0], [0, 13], [0, -13], [14, 0], [-14, 0], [14, 13], [-14, -13]]
        .map(([dx, dy]) => [Math.max(12, Math.min(84, preferred[0] + dx)), Math.max(8, Math.min(88, preferred[1] + dy))]);
      for (const cy of [8, 24, 40, 56, 72, 88]) for (const cx of [12, 36, 60, 84]) candidates.push([cx, cy]);
      const position = candidates.find(([cx, cy]) => occupied.every(([ox, oy]) => Math.abs(cx - ox) >= 23 || Math.abs(cy - oy) >= 12));
      occupied.push(position);
      const label = node('text', { x: position[0], y: position[1], fill: color, 'font-family': 'sans-serif', 'font-size': 10,
        'font-weight': 600, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'data-axis-label': axis.axis });
      label.textContent = `+${axis.axis}`; labels.append(label);
    }
    svg.append(lines, labels);
  }
  function update(camera) {
    if (disposed) return false;
    axes = orientationAxes(camera); root.hidden = !axes;
    if (axes) draw(); else svg.replaceChildren();
    refresh(); return Boolean(axes);
  }
  function dispose() {
    if (disposed) return false;
    disposed = true; axes = null; svg.remove(); root.hidden = true;
    for (const [name, value] of [['role', previousRole], ['aria-label', previousLabel]]) {
      if (value === null) root.removeAttribute(name); else root.setAttribute(name, value);
    }
    root.style.pointerEvents = previousPointerEvents; return true;
  }
  refresh();
  return Object.freeze({ update, refresh, dispose });
}
