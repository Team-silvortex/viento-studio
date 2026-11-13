import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneCamera2DDocument } from '../../engine/scene-camera2d.mjs';
import { editSceneCamera2DSource } from '../../engine/scene-camera2d-edit.mjs';
const id = n => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const hash = 'sha256:' + 'a'.repeat(64);
const fixed = (x = 320, y = 240) => ({ mode: 'fixed', center: [x, y], zoom: 1 });
const settle = async () => { for (let i = 0; i < 8; i++) await flushDialogs(); };

// The real form controller receives a renderer port. Canvas gesture mechanics
// have separate real-factory tests; this suite tests the authority handoff.
async function setup({ create = false, preview } = {}) {
  const context = { editable: true, busy: false, dirty: false, creating: false, visible: true,
    session: 'owner', sceneId: id(1), sourceToken: 'saved' };
  const original = JSON.stringify({ format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: id(1), camera: fixed() });
  const catalog = { format: 'viento-camera2d-author-context', schemaVersion: 1, worldId: id(8), baseRevision: hash,
    documentRoot: 'documents', documentTypes: [{ id: 'document', label: 'Document' }],
    scene: { objectId: id(1), objectRevision: hash, sourcePath: 'documents/scene.json', sourceRevision: hash, viewport: [640, 480] },
    targets: [{ instanceId: id(2), objectId: id(3), name: 'Same OC' }, { instanceId: id(4), objectId: id(3), name: 'Same OC' }],
    manifest: create ? null : { objectId: id(6), sourcePath: 'documents/camera.json', sourceRevision: hash, content: original } };
  let port, current, cancelled = 0, disposed = 0;
  const writes = [], commands = [];
  const h = await dialogHarness('app-scene-camera2d', {
    inspectSceneCamera2DDocument, editSceneCamera2DSource, crypto: { randomUUID: () => id(6) },
    setupSceneCamera2DComposer(options) {
      port = options;
      return { setData: (catalog, camera, active) => { current = { catalog, camera, active }; },
        cancel: () => { cancelled++; }, dispose: () => { disposed++; } };
    },
  });
  const editor = h.runtime.setupSceneCamera2D({ getContext: () => context, inspect: async () => structuredClone(catalog),
    request: async payload => { writes.push(structuredClone(payload)); return { status: 'applied' }; },
    command: async payload => { commands.push(structuredClone(payload)); return preview ? preview(payload) : { status: 'preview', worldId: catalog.worldId, baseRevision: hash }; } });
  editor.setAvailable(true, ['camera2d.create']); await editor.open(id(1));
  const el = name => h.element('sceneCamera2D' + name);
  return { editor, context, catalog, port, writes, commands, el, click: name => el(name).click(),
    set: (name, value) => { el(name).value = value; el(name).dispatch('input'); },
    candidate: (camera, initialCamera = JSON.parse(JSON.stringify(current.camera))) => port.onCandidate(camera, { initialCamera }),
    current: () => current, cancelled: () => cancelled, disposed: () => disposed };
}

test('composition stages only coordinates, revokes approval and requires review before an exact save', async () => {
  const h = await setup(); h.candidate(fixed(360, 250));
  assert.equal(h.el('X').value, '360'); assert.equal(h.el('Y').value, '250');
  assert.equal(h.el('Save').disabled, true); assert.equal(h.writes.length, 0); assert.equal(h.commands.length, 0);
  h.click('Check'); await settle(); assert.equal(h.el('Save').disabled, false);
  h.candidate(fixed(380, 260)); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Review').hidden, true);
  h.click('Save'); await settle(); assert.equal(h.writes.length, 0);
  h.click('Check'); await settle(); h.click('Save'); await settle();
  assert.equal(h.writes.length, 1); assert.deepEqual(JSON.parse(h.writes[0].content).camera, fixed(380, 260));
});

test('composition follow adjustment retains the second same-OC instance and updates only its offset', async () => {
  const h = await setup(); h.set('Mode', 'follow'); h.set('Target', id(4)); h.set('X', '-10'); h.set('Y', '12'); h.set('Zoom', '2');
  h.candidate({ mode: 'follow', targetInstanceId: id(4), offset: [-30, 25], zoom: 2 });
  assert.equal(h.el('Target').value, id(4)); assert.equal(h.el('Zoom').value, '2'); assert.equal(h.el('X').value, '-30');
  h.click('Check'); await settle(); h.click('Save'); await settle();
  assert.equal(h.writes.length, 1); assert.deepEqual(JSON.parse(h.writes[0].content).camera,
    { mode: 'follow', targetInstanceId: id(4), offset: [-30, 25], zoom: 2 });
});

test('late gesture cannot overwrite a silent numeric edit or another source owner', async () => {
  const h = await setup(); const initial = fixed(); h.el('X').value = '500'; h.candidate(fixed(400, 240), initial);
  assert.equal(h.el('X').value, '500');
  for (const [name, value] of [['sourceToken', 'elsewhere'], ['session', 'new-owner'], ['sceneId', id(9)], ['busy', true], ['dirty', true], ['visible', false]]) {
    const other = await setup(); other.context[name] = value; assert.equal(Boolean(other.port.canEdit()), false);
    other.candidate(fixed(400, 240)); assert.equal(other.el('X').value, '320'); assert.equal(other.writes.length, 0);
  }
});

test('invalid or unrelated composition candidates never alter the form or its review', async () => {
  const h = await setup(); h.set('X', '350'); h.click('Check'); await settle(); assert.equal(h.el('Save').disabled, false);
  for (const candidate of [fixed(100001, 0), fixed(NaN, 0), { ...fixed(), zoom: 2 }, { mode: 'follow', targetInstanceId: id(4), offset: [0, 0], zoom: 1 }, fixed(350, 240)]) {
    h.candidate(candidate); assert.equal(h.el('X').value, '350'); assert.equal(h.el('Save').disabled, false);
  }
  h.port.onCandidate(fixed(400, 240), null); assert.equal(h.el('X').value, '350'); assert.equal(h.writes.length, 0);
});

test('creation review keeps the composer locked until the preview completes', async () => {
  let resolve; const wait = new Promise(done => { resolve = done; });
  const h = await setup({ create: true, preview: () => wait }); h.candidate(fixed(360, 240)); h.click('Check'); await settle();
  assert.equal(h.port.canEdit(), false); h.candidate(fixed(390, 240)); assert.equal(h.el('X').value, '360');
  resolve({ status: 'preview', worldId: h.catalog.worldId, baseRevision: hash }); await settle();
  assert.equal(h.el('Save').disabled, false); assert.equal(h.commands.length, 1); assert.equal(h.writes.length, 0);
  h.candidate(fixed(370, 240)); assert.equal(h.el('Save').disabled, true); assert.equal(h.commands.length, 1);
});

test('closing or disposing a staged composition cancels its renderer without a source write', async () => {
  const h = await setup(); h.candidate(fixed(360, 240)); h.click('Cancel'); await settle();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.current().active, false); assert.equal(h.cancelled(), 1);
  h.candidate(fixed(390, 240), fixed(360, 240)); assert.equal(h.writes.length, 0); assert.equal(h.commands.length, 0);
  const other = await setup(); other.editor.dispose(); assert.equal(other.disposed(), 1); assert.equal(Boolean(other.port.canEdit()), false);
});
