import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DOrientationIndicator } from '../../web/modules/scene3d-orientation.js';
import { standardViewCamera, orbitCamera } from '../../web/modules/scene3d-math.js';

const namespace = 'http://www.w3.org/2000/svg';
const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
// Namespace-aware, owner-document-only DOM. Geometry/layout remains a browser
// concern; these tests verify the widget's own attributes, labels and lifetime.
class Element {
  constructor(name, document, ns = null) { this.localName = name; this.ownerDocument = document; this.namespaceURI = ns; this.attributes = new Map(); this.children = []; this.parentNode = null; this.style = {}; this.hidden = false; this.textContent = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
  remove() { if (this.parentNode) { const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; } }
}
function fixture() {
  const created = [], document = { createElementNS(ns, name) { const element = new Element(name, document, ns); created.push(element); return element; } };
  return { container: new Element('div', document), created };
}
function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
const groups = container => descendants(container).filter(node => node.getAttribute('data-axis'));
const labels = container => descendants(container).filter(node => node.getAttribute('data-axis-label'));
const svg = container => container.children.find(node => node.localName === 'svg');
const sortedAxes = container => groups(container).map(node => node.getAttribute('data-axis'));
const signature = container => JSON.stringify(descendants(container).map(node => [node.localName, [...node.attributes], node.textContent]));

test('widget uses its container ownerDocument and namespaced SVG, hidden until a valid orientation arrives', () => {
  const { container, created } = fixture(), indicator = createScene3DOrientationIndicator(container);
  assert.ok(Object.isFrozen(indicator)); assert.deepEqual(Object.keys(indicator), ['update', 'refresh', 'dispose']);
  assert.equal(container.hidden, true); assert.equal(container.getAttribute('role'), 'img');
  assert.equal(svg(container).getAttribute('viewBox'), '0 0 96 96');
  assert.equal(indicator.update(null), false); assert.equal(container.hidden, true);
  assert.equal(indicator.update(camera), true); assert.equal(container.hidden, false);
  assert.equal(groups(container).length, 3); assert.deepEqual(labels(container).map(label => label.textContent).sort(), ['+X', '+Y', '+Z']);
  assert.ok(created.every(node => node.namespaceURI === namespace && node.ownerDocument === container.ownerDocument));
});

test('all six standard views retain readable pole labels and correctly depth-sort near/far axis markers', () => {
  const { container } = fixture(), indicator = createScene3DOrientationIndicator(container);
  for (const direction of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
    indicator.update(standardViewCamera(camera, direction));
    const depths = groups(container).map(group => Number(group.getAttribute('data-depth')));
    assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
    for (const group of groups(container)) {
      const axis = group.getAttribute('data-axis'), depth = Number(group.getAttribute('data-depth'));
      const marker = group.children.find(node => node.localName === 'circle'), label = labels(container).find(node => node.getAttribute('data-axis-label') === axis);
      assert.equal(label.textContent, `+${axis}`);
      if (Math.abs(depth) === 1) {
        assert.equal(Number(marker.getAttribute('cx')), 48); assert.equal(Number(marker.getAttribute('cy')), 48);
        assert.ok(Math.hypot(Number(label.getAttribute('x')) - 48, Number(label.getAttribute('y')) - 48) >= 10);
        assert.equal(marker.getAttribute('data-facing'), depth > 0 ? 'toward' : 'away');
        assert.equal(marker.getAttribute('fill') === 'none', depth < 0);
      }
    }
  }
  indicator.update(standardViewCamera(camera, 'front')); assert.equal(sortedAxes(container).at(-1), 'Z');
  indicator.update(standardViewCamera(camera, 'back')); assert.equal(sortedAxes(container)[0], 'Z');
});

test('collinear projections and free rotated views keep all fixed labels separated and inside the widget', () => {
  const { container } = fixture(), indicator = createScene3DOrientationIndicator(container);
  let view = { ...camera, position: [1, -1, 0], target: [0, 0, 0], up: [0, 0, 1] };
  for (let step = 0; step < 256; step++) {
    indicator.update(view); const positions = labels(container).map(label => [Number(label.getAttribute('x')), Number(label.getAttribute('y'))]);
    assert.equal(positions.length, 3);
    for (const [x, y] of positions) assert.ok(x >= 12 && x <= 84 && y >= 8 && y <= 88);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++)
      assert.ok(Math.abs(positions[i][0] - positions[j][0]) >= 23 || Math.abs(positions[i][1] - positions[j][1]) >= 12);
    view = orbitCamera(view, .31 * Math.sin(step + 1), .23 * Math.cos(step));
  }
});

test('refresh translates fixed accessible axis meanings without changing geometry or consulting renderer state', () => {
  const { container } = fixture(), calls = []; let language = 'one';
  const indicator = createScene3DOrientationIndicator(container, { t(key) { calls.push(key); return `${language}:${key}`; } });
  const source = standardViewCamera(camera, 'back'), before = JSON.stringify(source); indicator.update(source);
  const geometry = signature(container), createdLabels = labels(container);
  assert.match(container.getAttribute('aria-label'), /one:坐标方向/); assert.match(container.getAttribute('aria-label'), /one:Z轴 \+Z：one:背向观察者/);
  language = 'two'; assert.equal(indicator.refresh(), true); assert.match(container.getAttribute('aria-label'), /two:坐标方向/);
  assert.equal(signature(container), geometry); assert.deepEqual(labels(container), createdLabels); assert.equal(JSON.stringify(source), before);
  const allowed = new Set(['坐标方向', 'X轴', 'Y轴', 'Z轴', '朝向观察者', '背向观察者', '位于画面平面']);
  assert.ok(calls.every(key => allowed.has(key)));
});

test('passive SVG has no keyboard targets or live region and cannot intercept canvas pointers', () => {
  const { container } = fixture(), indicator = createScene3DOrientationIndicator(container); indicator.update(camera);
  assert.equal(container.style.pointerEvents, 'none'); assert.equal(svg(container).getAttribute('pointer-events'), 'none');
  assert.equal(svg(container).getAttribute('focusable'), 'false'); assert.equal(svg(container).getAttribute('aria-hidden'), 'true');
  for (const element of [container, ...descendants(container)]) {
    assert.equal(element.getAttribute('tabindex'), null); assert.equal(element.getAttribute('aria-live'), null);
    assert.ok(!['button', 'a', 'input', 'select'].includes(element.localName));
  }
});

test('invalid update clears and hides old axes, refresh does not revive them, and subsequent valid state is independent', () => {
  const { container } = fixture(), indicator = createScene3DOrientationIndicator(container); indicator.update(camera);
  for (const invalid of [null, {}, { position: [0, 0, 0], target: [0, 0, 0] }]) {
    assert.equal(indicator.update(invalid), false); assert.equal(container.hidden, true); assert.equal(groups(container).length, 0);
    assert.equal(indicator.refresh(), false); assert.equal(container.hidden, true); assert.equal(container.getAttribute('aria-label'), '坐标方向');
  }
  assert.equal(indicator.update(standardViewCamera(camera, 'top')), true); assert.equal(container.hidden, false); assert.equal(groups(container).length, 3);
});

test('dispose removes only owned SVG, restores prior attributes and rejects future updates and refresh', () => {
  const { container } = fixture(), unrelated = new Element('span', container.ownerDocument); container.append(unrelated);
  container.setAttribute('role', 'group'); container.setAttribute('aria-label', 'existing label'); container.style.pointerEvents = 'auto';
  const indicator = createScene3DOrientationIndicator(container); indicator.update(camera); assert.equal(indicator.dispose(), true);
  assert.deepEqual(container.children, [unrelated]); assert.equal(container.hidden, true); assert.equal(container.getAttribute('role'), 'group');
  assert.equal(container.getAttribute('aria-label'), 'existing label'); assert.equal(container.style.pointerEvents, 'auto');
  assert.equal(indicator.update(camera), false); assert.equal(indicator.refresh(), false); assert.equal(indicator.dispose(), false);
  assert.deepEqual(container.children, [unrelated]);
});
