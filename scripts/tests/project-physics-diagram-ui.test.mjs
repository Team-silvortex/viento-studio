import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { createProjectPhysics2DSampleDiagram } from '../../engine/project-physics2d-sample-diagram.mjs';
import { physicsObservationSnapshot as snapshot, physicsObservationSample as sample } from './helpers/project-physics2d-observation-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function fixture(t) {
  let dictionary = {};
  const h = await dialogHarness('app-project-physics-diagram', {
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
  });
  const container = h.document.createElement('div'); h.document.body.append(container);
  const renderer = h.runtime.setupProjectPhysicsDiagram({ container }); t.after(() => renderer.dispose());
  return { ...h, container, renderer, role: name => container.querySelector(`[data-role="${name}"]`),
    set: value => renderer.setModel(createProjectPhysics2DSampleDiagram(value, 1)), language: value => { dictionary = value; } };
}
const numeric = (element, ...keys) => keys.map(key => Number(element.getAttribute(key)));

test('the diagram draws separate requested and actual endpoints plus numbered native contacts, never an invented path', async t => {
  const h = await fixture(t), input = snapshot(), before = structuredClone(input); h.set(input);
  const root = h.container.querySelector('svg'); assert.equal(root.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(root.getAttribute('viewBox'), '0 0 320 320'); assert.equal(root.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  assert.equal(root.getAttribute('role'), 'img'); assert.match(root.getAttribute('aria-label'), /位移与碰撞示意.*样本 1/);
  assert.deepEqual([root.dataset.sequence, root.dataset.sceneId, root.dataset.instanceId, root.dataset.bodyId], ['1', input.samples[0].sceneId, input.samples[0].instanceId, input.samples[0].bodyId]);
  assert.deepEqual(numeric(h.role('before'), 'data-x', 'data-y'), [160, 160]);
  assert.deepEqual(numeric(h.role('requested'), 'x1', 'y1', 'x2', 'y2'), [160, 160, 244, 216]);
  assert.deepEqual(numeric(h.role('actual'), 'x1', 'y1', 'x2', 'y2'), [160, 160, 188, 216]);
  assert.deepEqual(numeric(h.role('requested-end'), 'x', 'y', 'width', 'height'), [238, 210, 12, 12]);
  assert.deepEqual(numeric(h.role('actual-end'), 'cx', 'cy'), [188, 216]);
  assert.deepEqual(numeric(h.role('contact'), 'cx', 'cy'), [230, 160]);
  assert.deepEqual(numeric(h.role('normal'), 'x1', 'y1', 'x2', 'y2'), [230, 160, 210, 160]);
  assert.equal(h.role('contact-number').textContent, '1'); assert.equal(h.role('contact').dataset.contactIndex, '1');
  assert.match(h.role('actual').querySelector('title').textContent, /移动前位置 \[10, 20\].*移动后位置 \[12, 24\].*实际位移 \[2, 4\]/);
  assert.match(h.role('contact').querySelector('title').textContent, /接触位置（场景坐标） \[15, 20\].*法线 \[-1, 0\].*扫描已走位移 \[2, 1\].*扫描剩余位移 \[4, 3\]/);
  assert.match(h.container.textContent, /不代表真实路径、墙体或持续接触/); assert.match(h.container.textContent, /20 绘图单位.*不表示场景距离/);
  for (const tag of ['path', 'polygon', 'image', 'img', 'iframe', 'button', 'a']) assert.equal(h.container.querySelector(tag), null, tag);
  assert.equal(h.role('requested').getAttribute('marker-end'), null); assert.equal(h.role('actual').getAttribute('marker-end'), null);
  assert.deepEqual(input, before);
});

test('zero motion keeps distinct endpoint shapes without fabricating a motion arrow or a persistent contact claim', async t => {
  const h = await fixture(t), input = snapshot(), row = input.samples[0]; row.contacts = [];
  row.requestedMotion = [0, 0]; row.positionAfter = [...row.positionBefore]; row.displacement = [0, 0]; h.set(input);
  for (const name of ['requested', 'actual']) {
    assert.deepEqual(numeric(h.role(name), 'x1', 'y1', 'x2', 'y2'), [160, 160, 160, 160]); assert.equal(h.role(name).dataset.zero, 'true');
  }
  assert.deepEqual(numeric(h.role('actual-end'), 'cx', 'cy'), [160, 160]);
  assert.deepEqual(numeric(h.role('requested-end'), 'x', 'y'), [154, 154]);
  assert.ok(h.role('before')); assert.equal(h.container.querySelectorAll('[data-role="normal"]').length, 0);
  assert.equal(h.container.querySelectorAll('[data-role="contact"]').length, 0);
  const zero = h.container.querySelectorAll('p').find(item => item.textContent.includes('请求与实际位移均为零'));
  assert.equal(zero.hidden, false); assert.match(h.container.textContent, /不代表真实路径、墙体或持续接触/);
});

test('all four native contacts retain geometry and raw vectors even when the collider is unmapped', async t => {
  const h = await fixture(t), input = snapshot(), row = input.samples[0];
  row.contacts = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(row.contacts[0]), position: [10 + index, 20 - index], normal: [.6, .8001] }));
  row.contacts[1].collider = null; h.set(input);
  const markers = h.container.querySelectorAll('[data-role="contact"]'), normals = h.container.querySelectorAll('[data-role="normal"]');
  assert.deepEqual(markers.map(item => item.dataset.contactIndex), ['1', '2', '3', '4']); assert.equal(normals.length, 4);
  for (const item of normals) {
    const [x, y, nx, ny] = numeric(item, 'x1', 'y1', 'x2', 'y2'); assert.ok(Math.abs(Math.hypot(nx - x, ny - y) - 20) < 1e-12);
    assert.match(item.querySelector('title').textContent, /法线 \[0.6, 0.8001\]/);
  }
  assert.match(markers[1].querySelector('title').textContent, /未映射碰撞体/);
  assert.doesNotMatch(markers[1].querySelector('title').textContent, new RegExp(row.contacts[0].collider.bodyId));
  assert.equal(h.container.querySelectorAll('[data-role="contact-number"]').map(item => item.textContent).join(','), '1,2,3,4');
});

test('extreme projected loss has an explicit warning and never labels a nonzero raw request as zero', async t => {
  const h = await fixture(t), input = snapshot(), row = input.samples[0];
  row.positionBefore = [Number.MAX_VALUE, 0]; row.positionAfter = [...row.positionBefore]; row.displacement = [0, 0];
  row.requestedMotion = [Number.MIN_VALUE, 1]; row.contacts[0].position = [-Number.MAX_VALUE, 0]; h.set(input);
  assert.equal(h.role('requested').dataset.zero, 'false'); assert.match(h.role('requested').querySelector('title').textContent, /5e-324/);
  const notes = h.container.querySelectorAll('p');
  assert.equal(notes.find(item => item.textContent.includes('极端数值范围')).hidden, false);
  assert.equal(notes.find(item => item.textContent.includes('请求与实际位移均为零')).hidden, true);
  for (const element of h.container.querySelectorAll('line,circle,rect,polyline')) for (const key of ['x1','y1','x2','y2','cx','cy','x','y','points']) {
    assert.doesNotMatch(element.getAttribute(key) || '', /Infinity|NaN/);
  }
});

test('unchanged sample geometry and three languages preserve the SVG, shapes and external focus while updating accessible text', async t => {
  const h = await fixture(t), input = snapshot(); h.set(input);
  const root = h.container.querySelector('svg'), request = h.role('requested'), contact = h.role('contact');
  const control = h.document.createElement('select'); h.document.body.append(control); control.focus();
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); h.set(structuredClone(input));
    assert.equal(h.container.querySelector('svg'), root); assert.equal(h.role('requested'), request); assert.equal(h.role('contact'), contact);
    assert.equal(h.document.activeElement, control); assert.equal(root.getAttribute('aria-label').startsWith(dictionary['位移与碰撞示意'] || '位移与碰撞示意'), true);
    assert.match(request.querySelector('title').textContent, /\[6, 4\]/);
  }
  const changed = snapshot(); changed.samples[0].contacts[0].travel[0] = 3; h.set(changed);
  assert.notEqual(h.container.querySelector('svg'), root); assert.match(h.role('contact').querySelector('title').textContent, /\[3, 1\]/);
  h.renderer.setModel(null); assert.equal(h.container.children.length, 0); assert.equal(h.container.hidden, true);
  h.set(input); h.renderer.dispose(); h.set(input); assert.equal(h.container.children.length, 0);
});

test('the renderer is a translated responsive SVG DTO consumer with no parsing of untrusted markup or host operations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-physics-diagram.js', import.meta.url), 'utf8');
  assert.match(source, /createElementNS/); assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|fetch\(|fetchJsonApiRequest|requestWorldCommand|requestAnimationFrame|setInterval|setTimeout|onOpen|addEventListener/);
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) {
    assert.ok(en[match[1]], 'English: ' + match[1]); assert.ok(ja[match[1]], 'Japanese: ' + match[1]);
  }
  const css = await fs.readFile(new URL('../../web/project-physics-observation.css', import.meta.url), 'utf8');
  assert.match(css, /\.project-physics-diagram-svg[^}]*width: 100%[^}]*height: auto/);
  assert.match(css, /stroke-dasharray: 6 4/); assert.match(css, /data-role="requested-end"/); assert.match(css, /data-role="actual-end"/);
});
