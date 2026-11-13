import test from 'node:test';
import assert from 'node:assert/strict';
import { setupSceneCamera2DComposer } from '../../web/modules/app-scene-camera2d-composer.js';

const id = n => `91919191-9191-4919-8919-${String(n).padStart(12, '0')}`;
const revision = 'sha256:' + 'a'.repeat(64);
const worldId = 'world:' + 'b'.repeat(64);
const source = (objectId, sourcePath) => ({ objectId, objectRevision: revision, sourcePath, sourceRevision: revision });
const scene = source(id(1), 'documents/scenes/current.json');
const entry = source(id(2), 'documents/scenes/entry.json');
const assembly = source(id(3), 'documents/projects/project.json');
const actors = [
  { instanceId: id(4), objectId: id(6), name: 'Shared', position: [-40, 20], size: [20, 20], color: '#d02040' },
  { instanceId: id(5), objectId: id(6), name: 'Shared', position: [900, 500], size: [40, 40], color: '#20d080' },
];
const catalog = () => {
  const targets = actors.map(({ instanceId, objectId, name }) => ({ instanceId, objectId, name }));
  return { worldId, baseRevision: revision, scene: { ...scene, viewport: [640, 480] }, targets,
    framing: { format: 'viento-camera2d-framing-context', schemaVersion: 1, worldId, baseRevision: revision,
      scene, actors, viewports: [{ id: `scene:${scene.objectId}`, kind: 'scene', title: 'Current', viewport: [640, 480], source: scene },
        { id: `assembly:${assembly.objectId}`, kind: 'assembly-entry', title: 'Project', viewport: [800, 480], source: assembly, entryScene: entry }], diagnostics: [] } };
};
const camera = { mode: 'follow', targetInstanceId: id(5), offset: [-24, 16], zoom: 2 };

function harness() {
  const oldDocument = globalThis.document, oldObserver = globalThis.ResizeObserver, oldFrame = globalThis.requestAnimationFrame;
  globalThis.document = { createElement() { return { value: '', textContent: '' }; } };
  delete globalThis.ResizeObserver; delete globalThis.requestAnimationFrame;
  const elements = new Map(), candidates = [];
  const context = new Proxy({}, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
  for (const name of ['Viewport', 'Source', 'Fit', 'All', 'CancelDrag', 'Canvas', 'Help', 'Status']) {
    const listeners = new Map();
    const element = { value: '', textContent: '', disabled: false, dataset: {}, children: [], width: 0, height: 0,
      setAttribute() {}, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 480 }),
      addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
      dispatch(type) { listeners.get(type)?.({ target: element, preventDefault() {}, stopPropagation() {} }); },
      replaceChildren() { this.children = []; this.value = ''; }, append(child) { this.children.push(child); if (this.children.length === 1) this.value = child.value; },
      focus() {}, setPointerCapture() {}, releasePointerCapture() {} };
    elements.set(name, element);
  }
  const container = { innerHTML: '', querySelector(selector) { return elements.get(selector.replace('#sceneCamera2DComposer', '')); }, querySelectorAll() { return []; } };
  const controller = setupSceneCamera2DComposer({ container, onCandidate: value => candidates.push(value) });
  return { controller, candidates, el: name => elements.get(name), frame: () => { const value = elements.get('Canvas').dataset.frame; return value ? JSON.parse(value) : null; },
    close() { controller.dispose(); if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
      if (oldObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = oldObserver;
      if (oldFrame === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = oldFrame; } };
}

test('a transient missing framing context clears stale options and recovers identical evidence under the same owner', t => {
  const h = harness(); t.after(h.close); const a = catalog(); h.controller.setData(a, camera, true);
  assert.equal(h.frame().targetInstanceId, id(5)); assert.equal(h.el('Viewport').children.length, 2);
  h.controller.setData({ ...a, framing: null }, camera, true);
  assert.equal(h.frame(), null); assert.equal(h.el('Viewport').children.length, 0); assert.equal(h.el('Source').textContent, '');
  h.controller.setData(a, camera, true);
  assert.equal(h.el('Viewport').children.length, 2); assert.deepEqual(h.frame().center, [876, 516]); assert.deepEqual(h.candidates, []);
});

test('a disabled owner clears its diagram and a renewed owner restores it without a candidate', t => {
  const h = harness(); t.after(h.close); const a = catalog(); h.controller.setData(a, camera, true);
  h.controller.setData(a, camera, false); assert.equal(h.frame(), null);
  h.controller.setData(a, camera, true); assert.equal(h.frame().targetInstanceId, id(5)); assert.deepEqual(h.candidates, []);
});

test('same-owner framing replacement updates geometry, and viewport selection changes only the view', t => {
  const h = harness(); t.after(h.close); const a = catalog(); const before = JSON.stringify(a); h.controller.setData(a, camera, true);
  h.el('Viewport').value = `assembly:${assembly.objectId}`; h.el('Viewport').dispatch('change');
  assert.deepEqual(h.frame().size, [400, 240]); assert.equal(h.el('Source').textContent, 'documents/projects/project.json → documents/scenes/entry.json');
  assert.deepEqual(h.candidates, []); assert.equal(JSON.stringify(a), before);
  const replacement = structuredClone(a); replacement.framing.actors[1].position = [910, 520]; replacement.framing.viewports[1].viewport = [1024, 480];
  h.controller.setData(replacement, camera, true); assert.deepEqual(h.frame().center, [886, 536]); assert.deepEqual(h.frame().size, [512, 240]);
  assert.equal(h.el('Viewport').value, `assembly:${assembly.objectId}`); assert.deepEqual(h.candidates, []); assert.equal(JSON.stringify(a), before);
});
