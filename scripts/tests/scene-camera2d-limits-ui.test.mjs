import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneCamera2DDocument } from '../../engine/scene-camera2d.mjs';
import { editSceneCamera2DSource } from '../../engine/scene-camera2d-edit.mjs';

const id = n => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const hash = 'sha256:' + 'a'.repeat(64);
const limits = { left: -100, top: -50, right: 1000, bottom: 800 };
const fixed = { mode: 'fixed', center: [320, 240], zoom: 1 };
const settle = async () => { for (let i = 0; i < 8; i++) await flushDialogs(); };
async function setup({ initialLimits = false, reject = false, create = false } = {}) {
  const ctx = { editable: true, busy: false, dirty: false, creating: false, visible: true, session: 'owner', sceneId: id(1), sourceToken: 'saved' };
  const original = JSON.stringify({ format: 'viento-scene-camera2d', schemaVersion: initialLimits ? 2 : 1, sceneObjectId: id(1), camera: initialLimits ? { ...fixed, limits } : fixed });
  const data = { format: 'viento-camera2d-author-context', schemaVersion: 1, worldId: id(8), baseRevision: hash, documentRoot: 'documents',
    documentTypes: [{ id: 'document', label: 'Document' }], scene: { objectId: id(1), objectRevision: hash, sourcePath: 'documents/scene.json', sourceRevision: hash, viewport: [640, 480] },
    targets: [{ instanceId: id(2), objectId: id(3), name: 'Shared' }, { instanceId: id(4), objectId: id(3), name: 'Shared' }],
    manifest: create ? null : { objectId: id(6), sourcePath: 'documents/camera.json', sourceRevision: hash, content: original } };
  const writes = [], commands = []; let port, current;
  // VM test harness crosses realms; the actual browser imports editor and validator in one realm.
  const editFromVm = (text, camera) => editSceneCamera2DSource(text, structuredClone(camera));
  const h = await dialogHarness('app-scene-camera2d', { inspectSceneCamera2DDocument, editSceneCamera2DSource: editFromVm, crypto: { randomUUID: () => id(6) },
    setupSceneCamera2DComposer(options) { port = options; return { setData(catalog, camera, active) { current = { catalog, camera, active }; }, cancel() {}, dispose() {} }; } });
  const editor = h.runtime.setupSceneCamera2D({ getContext: () => ctx, inspect: async () => structuredClone(data),
    request: async payload => { writes.push(structuredClone(payload)); if (reject) throw Object.assign(new Error('conflict'), { code: 'scene_camera2d_document_conflict' });
      data.manifest.content = payload.content; return { status: 'applied' }; },
    command: async payload => { commands.push(structuredClone(payload)); return { status: 'preview', worldId: data.worldId, baseRevision: hash }; } });
  editor.setAvailable(true, ['camera2d.create']); await editor.open(id(1));
  const el = name => h.element('sceneCamera2D' + name);
  return { el, editor, port, data, writes, commands, current: () => current,
    toggle(value) { el('Limits').checked = value; el('Limits').dispatch('change'); },
    set(name, value) { el(name).value = value; el(name).dispatch('input'); },
    candidate(value, initial = structuredClone(current.camera)) { port.onCandidate(value, { initialCamera: initial }); },
    async click(name) { el(name).click(); await settle(); } };
}

test('enabling limits is a draft, review requests schema 2, toggling invalidates the ticket, and saving is explicit', async () => {
  const h = await setup(); assert.equal(h.el('Limits').checked, false); assert.equal(h.el('LimitsFields').hidden, true);
  h.toggle(true); assert.equal(h.el('LimitsFields').hidden, false); assert.deepEqual(['LimitLeft','LimitTop','LimitRight','LimitBottom'].map(x => h.el(x).value), ['0','0','640','480']);
  for (const [name, value] of [['LimitLeft','-100'],['LimitTop','-50'],['LimitRight','1000'],['LimitBottom','800']]) h.set(name, value);
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().camera.limits)), limits); assert.equal(h.writes.length, 0);
  await h.click('Check'); assert.equal(h.el('Save').disabled, false); assert.equal(JSON.parse(h.el('Text').textContent).schemaVersion, 2);
  h.toggle(false); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Dialog').dataset.dirty, 'false'); await h.click('Save'); assert.equal(h.writes.length, 0);
  h.toggle(true); await h.click('Check'); await h.click('Save'); assert.equal(h.writes.length, 1);
  const saved = JSON.parse(h.writes[0].content); assert.equal(saved.schemaVersion, 2); assert.deepEqual(saved.camera.limits, limits);
});

test('bounded follow and gestures preserve limits and instance, with stale or altered limits rejected', async () => {
  const h = await setup({ initialLimits: true }); assert.equal(h.el('Limits').checked, true);
  h.set('Mode', 'follow'); h.set('Target', id(4)); h.set('X', '-24'); h.set('Y', '16'); h.set('Zoom', '2');
  const expected = { mode: 'follow', targetInstanceId: id(4), offset: [-30, 20], zoom: 2, limits };
  const initial = structuredClone(h.current().camera); h.candidate({ ...expected, limits: { ...limits, right: 999 } }, initial); assert.equal(h.el('X').value, '-24');
  h.candidate(expected, initial); assert.equal(h.el('X').value, '-30'); assert.equal(h.el('Y').value, '20'); assert.equal(h.el('Target').value, id(4));
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().camera.limits)), limits); assert.equal(h.writes.length, 0);
  await h.click('Check'); const document = JSON.parse(h.el('Text').textContent); assert.deepEqual(document.camera, expected); assert.equal(document.schemaVersion, 2);
  h.set('LimitRight', '900'); assert.equal(h.el('Save').disabled, true); h.candidate(expected, initial); assert.equal(h.el('LimitRight').value, '900');
});

test('explicitly disabling a saved limit reviews a v1 document; invalid or empty limits cannot create a save ticket', async () => {
  const h = await setup({ initialLimits: true }); h.toggle(false); await h.click('Check');
  const unbounded = JSON.parse(h.el('Text').textContent); assert.equal(unbounded.schemaVersion, 1); assert.equal(Object.hasOwn(unbounded.camera, 'limits'), false);
  h.toggle(true); h.set('LimitLeft', '1000'); h.set('LimitRight', '100'); await h.click('Check'); assert.equal(h.el('Save').disabled, true); assert.equal(h.writes.length, 0);
  h.set('LimitLeft', ''); await h.click('Check'); assert.equal(h.el('Save').disabled, true); assert.equal(h.writes.length, 0);
});

test('conflict reconciliation retains checkbox and all boundary values while requiring review again', async () => {
  const h = await setup({ reject: true }); h.toggle(true); h.set('LimitLeft', '-42'); h.set('LimitBottom', '920');
  await h.click('Check'); await h.click('Save'); assert.equal(h.writes.length, 1); assert.equal(h.el('Limits').checked, true);
  assert.equal(h.el('LimitLeft').value, '-42'); assert.equal(h.el('LimitBottom').value, '920'); assert.equal(h.el('Save').disabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().camera.limits)), { left: -42, top: 0, right: 640, bottom: 920 });
});

test('new bounded camera preview is schema 2 and does not apply during review', async () => {
  const h = await setup({ create: true }); h.toggle(true); await h.click('Check'); assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0].mode, 'preview'); assert.equal(JSON.parse(h.commands[0].content).schemaVersion, 2); assert.equal(h.writes.length, 0);
});
