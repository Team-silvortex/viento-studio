import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { fitSceneView, canvasToScene, sceneToCanvas, zoomSceneView, hitTestScene, tintPixels, createScenePreviewCanvas } from '../../web/modules/app-scene-preview-canvas.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const sceneOne = '11111111-1111-4111-8111-111111111111', sceneTwo = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333', previewOne = '44444444-4444-4444-8444-444444444444', previewTwo = '55555555-5555-4555-8555-555555555555';
const imageId = '66666666-6666-4666-8666-666666666666';
function preview(sceneId = sceneOne, previewId = previewOne) {
  const sourcePath = `documents/scenes/${sceneId}.json`;
  return { ok: true, format: 'viento-scene-preview', schemaVersion: 1, previewId, snapshotId: 'sha256:frozen',
    scene: { objectId: sceneId, sourcePath, title: 'Saved scene', viewport: [800, 480], background: '#123456' },
    actors: [{ objectId: actorId, name: 'Traveler <script>', position: [160, 220], size: [80, 64], color: '#ffffff', speed: 320, controls: 'arrows',
      sourcePath: 'documents/projections/player.json', declaration: { objectId: sceneId, sourcePath, propertyPath: '/actors/0' },
      fieldSources: { speed: { objectId: actorId, sourcePath: 'documents/projections/player.json', propertyPath: '/configuration/speed' } },
      origin: { objectId: 'core-id', sourcePath: 'documents/characters/traveler.md' } }], resources: [], diagnostics: [] };
}
async function harness() {
  const calls = [], assets = [], opened = [], edited = [], viewCalls = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, canEditScene: true };
  let sourceAction = () => true;
  const h = await dialogHarness('app-scene-preview', {
    SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    location: { href: 'http://127.0.0.1/web/', origin: 'http://127.0.0.1' },
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, (...args) => viewCalls.push({ name, args })])),
    fetchJsonApiRequest: (url, request) => {
      const wait = deferred(), call = { url, request, ...wait }; calls.push(call);
      if (request.method === 'DELETE') wait.resolve({ payload: { ok: true } });
      return wait.promise;
    },
    fetchWithTimeout: (url, request) => { const wait = deferred(); assets.push({ url, request, ...wait }); return wait.promise; },
  });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context,
    openSource: (...args) => { opened.push(args); return sourceAction(...args); }, editScene: id => edited.push(id) });
  controller.setAvailable(true); controller.setScene(sceneOne); controller.setVisible(true);
  const post = () => calls.filter(call => call.request.method === 'POST').at(-1);
  const resolve = async value => { post().resolve({ payload: value }); await flushDialogs(); };
  return { ...h, container, context, controller, calls, assets, opened, edited, viewCalls, post, resolve, setSourceAction: value => { sourceAction = value; } };
}

test('saved scene preview does not require a build or runtime and never submits a write', async () => {
  const h = await harness();
  assert.equal(h.container.dataset.scenePreviewState, 'loading');
  assert.deepEqual(JSON.parse(h.post().request.body), { sceneId: sceneOne });
  assert.equal(h.post().url, '/api/scene-preview');
  await h.resolve(preview());
  assert.equal(h.container.dataset.scenePreviewState, 'ready');
  assert.equal(h.element('scenePreviewCanvas').hidden, false);
  assert.match(h.element('scenePreviewSummary').textContent, /800.*480.*1.*sha256:frozen/);
  assert.equal(h.element('scenePreviewRefresh').disabled, false);
  h.element('scenePreviewObjects').querySelector('button').click();
  assert.match(h.element('scenePreviewInspector').textContent, /Traveler <script>.*320/s);
  assert.equal(h.element('scenePreviewInspector').querySelectorAll('script').length, 0);
  h.element('scenePreviewEdit').click(); assert.deepEqual(h.edited, [sceneOne]);
  assert.equal(h.calls.length, 1);
});

test('source links resolve inherited fields, scene fields, actor and original OC', async () => {
  const h = await harness(); await h.resolve(preview()); h.element('scenePreviewObjects').querySelector('button').click();
  // The DOM fixture does not implement descendant selectors, use the property list instead.
  const fields = h.element('scenePreviewProperties').querySelectorAll('dd').map(cell => cell.querySelector('button'));
  fields[0].click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].propertyPath, '/actors/0/position');
  fields[3].click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].propertyPath, '/configuration/speed');
  assert.equal(h.opened.at(-1)[0], 'documents/projections/player.json');
  h.element('scenePreviewActorSource').click(); h.element('scenePreviewOriginSource').click(); h.element('scenePreviewSource').click();
  assert.deepEqual(h.opened.slice(-3).map(args => args[0]), ['documents/projections/player.json', 'documents/characters/traveler.md', preview().scene.sourcePath]);
});

test('unsaved drafts remain visible as saved-state previews and edit guards are checked at click time', async () => {
  const h = await harness(); h.context.dirty = true; await h.resolve(preview());
  assert.equal(h.container.dataset.scenePreviewState, 'ready');
  assert.equal(h.element('scenePreviewDraft').hidden, false); assert.equal(h.element('scenePreviewEdit').disabled, true);
  h.context.dirty = false; h.controller.setScene(sceneOne); assert.equal(h.element('scenePreviewEdit').disabled, false);
  for (const key of ['dirty', 'creating', 'busy']) { h.context[key] = true; h.element('scenePreviewEdit').click(); h.context[key] = false; }
  h.context.canEditScene = false; h.element('scenePreviewEdit').click();
  assert.equal(h.edited.length, 0); assert.equal(h.calls.length, 1);
});

test('late replies from replaced scenes are released without overwriting the latest scene', async () => {
  const h = await harness(), first = h.post(); h.controller.setScene(sceneTwo);
  assert.equal(first.request.signal.aborted, true);
  await h.resolve(preview(sceneTwo, previewTwo));
  first.resolve({ payload: preview() }); await flushDialogs();
  assert.equal(h.container.dataset.scenePreviewState, 'ready');
  assert.equal(h.viewCalls.filter(call => call.name === 'setScene' && call.args[0]).at(-1).args[0].scene.objectId, sceneTwo);
  assert.ok(h.calls.some(call => call.request.method === 'DELETE' && call.url.includes(previewOne)));
});

test('hide and destruction cancel pending work, release previews, and re-opening reads fresh saved state', async () => {
  const h = await harness(); await h.resolve(preview());
  h.controller.setVisible(false); assert.equal(h.element('scenePreviewCanvas').hidden, true);
  assert.ok(h.calls.some(call => call.request.method === 'DELETE' && call.url.includes(previewOne)));
  h.controller.setVisible(true); const pending = h.post(); h.controller.destroy();
  assert.equal(pending.request.signal.aborted, true);
  pending.resolve({ payload: preview(sceneOne, previewTwo) }); await flushDialogs();
  assert.equal(h.element('scenePreviewCanvas').hidden, true);
  assert.ok(h.calls.some(call => call.request.method === 'DELETE' && call.url.includes(previewTwo)));
  assert.ok(h.viewCalls.some(call => call.name === 'destroy'));
});

test('invalid saved scenes show source diagnostics and remove stale canvas content', async () => {
  const h = await harness(); await h.resolve(preview()); h.element('scenePreviewRefresh').click();
  h.post().reject(Object.assign(new Error('invalid'), { payload: { ok: false, diagnostics: [{ code: 'build_scene_value', sourcePath: preview().scene.sourcePath, propertyPath: '/viewport', message: '<script>bad()</script>' }] } }));
  await flushDialogs(); assert.equal(h.container.dataset.scenePreviewState, 'invalid');
  assert.equal(h.element('scenePreviewCanvas').hidden, true);
  assert.match(h.element('scenePreviewDiagnostics').textContent, /\/viewport/);
  h.element('scenePreviewDiagnostics').querySelector('button').click(); assert.equal(h.opened.at(-1)[1].propertyPath, '/viewport');
  assert.equal(h.element('scenePreviewDiagnostics').querySelectorAll('script').length, 0);
});

test('image requests cannot use foreign hosts or arbitrary local endpoints', async () => {
  for (const url of ['https://example.invalid/private.svg', '/api/world?previewId=x&resourceId=y']) {
    const h = await harness(), value = preview(); value.resources.push({ id: imageId, size: 8, url }); value.actors[0].imageResourceId = imageId;
    await h.resolve(value); assert.equal(h.container.dataset.scenePreviewState, 'ready');
    assert.equal(h.assets.length, 0); assert.match(h.element('scenePreviewDiagnostics').textContent, new RegExp(imageId));
  }
});

test('changing scenes during asset reads never decodes or paints the abandoned image', async () => {
  const h = await harness(), value = preview(); value.actors[0].imageResourceId = imageId;
  value.resources.push({ id: imageId, size: 8, url: `/api/scene-preview?previewId=${previewOne}&resourceId=${imageId}` });
  await h.resolve(value); assert.equal(h.assets.length, 1); assert.equal(h.container.dataset.scenePreviewState, 'loading');
  h.controller.setScene(sceneTwo); await h.resolve(preview(sceneTwo, previewTwo));
  h.assets[0].resolve(new Blob(['old data'])); await flushDialogs();
  assert.equal(h.container.dataset.scenePreviewState, 'ready');
  assert.equal(h.viewCalls.filter(call => call.name === 'setScene' && call.args[0]).at(-1).args[0].previewId, previewTwo);
  assert.equal(h.viewCalls.filter(call => call.name === 'setImages').at(-1).args[0].size, 0);
});

test('capability loss and an empty scene stop preview requests', async () => {
  const h = await harness(); await h.resolve(preview()); h.controller.setAvailable(false);
  const count = h.calls.length; h.element('scenePreviewRefresh').click(); assert.equal(h.calls.length, count);
  assert.equal(h.element('scenePreviewCanvas').hidden, true);
  h.controller.setScene(''); h.controller.setAvailable(true); assert.equal(h.calls.length, count);
});

test('view controls affect only the canvas and navigation failures keep the saved preview', async () => {
  const h = await harness(); await h.resolve(preview());
  h.element('scenePreviewFit').click(); h.element('scenePreviewZoomIn').click(); h.element('scenePreviewZoomOut').click();
  h.element('scenePreviewGrid').checked = true; h.element('scenePreviewGrid').dispatch('change');
  assert.ok(h.viewCalls.some(call => call.name === 'fit')); assert.ok(h.viewCalls.some(call => call.name === 'zoom' && call.args[0] === 1.25));
  assert.ok(h.viewCalls.some(call => call.name === 'setGrid' && call.args[0] === true)); assert.equal(h.calls.length, 1);
  h.setSourceAction(() => { throw new Error('navigation failed'); }); h.element('scenePreviewSource').click(); await flushDialogs();
  assert.match(h.element('scenePreviewMessage').textContent, /无法打开原文/); assert.equal(h.element('scenePreviewCanvas').hidden, false);
});

test('scene preview user messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-preview.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n(?:-aria-label)?="([^"]+)")/g)].map(match => match[1] || match[2]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});

test('fit, point conversion and focal zoom preserve scene coordinates', () => {
  const view = fitSceneView([800, 480], 848, 528);
  assert.deepEqual(view, { scale: 1, offsetX: 24, offsetY: 24 });
  assert.deepEqual(sceneToCanvas(view, 160, 220), [184, 244]);
  assert.deepEqual(canvasToScene(view, 184, 244), [160, 220]);
  const next = zoomSceneView(view, 2, 184, 244); assert.equal(next.scale, 2);
  assert.deepEqual(canvasToScene(next, 184, 244), [160, 220]);
  assert.equal(zoomSceneView(view, 100000, 0, 0).scale, 16);
  assert.equal(zoomSceneView(view, 0.000001, 0, 0).scale, 0.02);
});

test('canvas hit testing uses actor centers, reverse draw order, and scene clipping', () => {
  const scene = { viewport: [800, 480] }, first = { objectId: 'first', position: [100, 80], size: [60, 40] }, second = { ...first, objectId: 'second' };
  assert.equal(hitTestScene(scene, [first, second], 100, 80), 'second');
  assert.equal(hitTestScene(scene, [first], 70, 60), 'first');
  assert.equal(hitTestScene(scene, [first], 69.9, 60), null);
  assert.equal(hitTestScene(scene, [{ ...first, position: [-5, 10] }], -1, 10), null);
});

test('texture tint multiplies all RGBA channels and preserves transparent pixels', () => {
  const pixels = new Uint8ClampedArray([100, 200, 50, 128, 255, 100, 50, 0]);
  assert.deepEqual([...tintPixels(pixels, '#80ff4080')], [50, 200, 13, 64, 128, 100, 13, 0]);
  assert.deepEqual([...tintPixels(new Uint8ClampedArray([20, 30, 40, 50]), '#ffffff')], [20, 30, 40, 50]);
});

test('canvas draws center-based layout and gestures change only the view', () => {
  const calls = [], listeners = new Map(), selection = [], views = [];
  const context = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => calls.push([key, ...args])), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width: 848, height: 528 }),
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name), focus() {}, ownerDocument: {} };
  const view = createScenePreviewCanvas({ canvas, onSelect: id => selection.push(id), onViewChange: value => views.push(value) });
  const data = preview(); const before = JSON.stringify(data); view.setScene(data); view.setVisible(true);
  assert.ok(calls.some(([name, ...args]) => name === 'fillRect' && JSON.stringify(args) === JSON.stringify([120, 188, 80, 64])));
  const event = { pointerId: 1, button: 0, clientX: 184, clientY: 244, preventDefault() {}, stopPropagation() {} };
  listeners.get('pointerdown')(event); listeners.get('pointerup')(event); assert.deepEqual(selection, [actorId]);
  listeners.get('pointerdown')(event); listeners.get('pointermove')({ ...event, clientX: 214 }); listeners.get('pointerup')({ ...event, clientX: 214 });
  assert.equal(view.getView().offsetX, 54); assert.equal(selection.length, 1);
  listeners.get('keydown')({ key: '0', preventDefault() {}, stopPropagation() {} }); assert.equal(view.getView().offsetX, 24);
  assert.equal(JSON.stringify(data), before); view.destroy(); assert.equal(listeners.size, 0);
});


test('repeated parent refreshes retain object and inspector keyboard focus', async () => {
  const h = await harness(); await h.resolve(preview());
  const object = h.element('scenePreviewObjects').querySelector('button'); object.click(); object.focus();
  h.controller.setScene(sceneOne); h.controller.setVisible(true); h.controller.setAvailable(true);
  assert.equal(h.element('scenePreviewObjects').querySelector('button'), object);
  assert.equal(h.document.activeElement, object);
  const source = h.element('scenePreviewProperties').querySelector('button'); source.focus();
  h.controller.setScene(sceneOne); h.controller.setVisible(true);
  assert.equal(h.element('scenePreviewProperties').querySelector('button'), source);
  assert.equal(h.document.activeElement, source);
});

test('refreshing a scene preserves manual view zoom while a changed viewport fits again', () => {
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width: 848, height: 528 }), addEventListener() {}, removeEventListener() {} };
  const view = createScenePreviewCanvas({ canvas }); const value = preview();
  view.setScene(value); view.setVisible(true); view.zoom(2); const zoomed = view.getView();
  view.setScene(null); view.setScene(value); assert.deepEqual(view.getView(), zoomed);
  view.setScene({ ...value, scene: { ...value.scene, viewport: [1600, 960] } }); assert.equal(view.getView().scale, 0.5);
  view.destroy();
});

test('source-aware preview links carry scene and definition revisions without mixing their files or aggregate dimensions', async () => {
  const h = await harness(), data = preview(), scenePath = data.scene.sourcePath, definitionPath = data.actors[0].sourcePath;
  const locate = (sourcePath, propertyPath, marker, exact = true) => ({ sourcePath, propertyPath, objectId: sourcePath === scenePath ? sceneOne : actorId,
    sourceRevision: `sha256:${marker.repeat(64)}`, sourceRange: { start: 10, end: 20, encoding: 'utf-16', propertyPath, exact } });
  const scene = locate(scenePath, '', 'a'), definition = locate(definitionPath, '', 'b'), declaration = locate(scenePath, '/actors/0', 'a');
  const fields = { position: locate(scenePath, '/actors/0/position', 'a'), speed: locate(definitionPath, '/configuration/speed', 'b'),
    size: locate(definitionPath, '/configuration', 'b', false), 'size/0': locate(definitionPath, '/configuration/width', 'b'),
    'size/1': locate(scenePath, '/actors/0/size/1', 'a') };
  data.sourceLocations = { scene, actors: [{ objectId: actorId, definition, declaration, fields }] };
  await h.resolve(data); h.element('scenePreviewObjects').querySelector('button').click();
  const rows = h.element('scenePreviewProperties').querySelectorAll('dd');
  for (const [row, field] of [[0, 'position'], [3, 'speed']]) {
    rows[row].querySelector('button').click(); await flushDialogs(); assert.deepEqual(h.opened.at(-1), [fields[field].sourcePath, fields[field]]);
  }
  const dimensions = rows[1].querySelectorAll('button'); assert.equal(dimensions.length, 3);
  for (const [index, field] of ['size', 'size/0', 'size/1'].entries()) {
    dimensions[index].click(); await flushDialogs(); assert.deepEqual(h.opened.at(-1), [fields[field].sourcePath, fields[field]]);
  }
  for (const [id, expected] of [['scenePreviewActorSource', definition], ['scenePreviewDeclarationSource', declaration], ['scenePreviewSource', scene]]) {
    h.element(id).click(); await flushDialogs(); assert.deepEqual(h.opened.at(-1), [expected.sourcePath, expected]);
  }
});

test('source sidecars also locate ordinary actors and a refreshed range replaces old inspector link closures', async () => {
  const h = await harness(), data = preview(); delete data.actors[0].fieldSources; delete data.actors[0].origin;
  const original = { ...data.actors[0].declaration, propertyPath: '/actors/0/position', sourceRevision: `sha256:${'a'.repeat(64)}`,
    sourceRange: { start: 10, end: 20, encoding: 'utf-16', propertyPath: '/actors/0/position', exact: true } };
  data.sourceLocations = { actors: [{ objectId: actorId, fields: { position: original } }] };
  await h.resolve(data); h.element('scenePreviewObjects').querySelector('button').click();
  h.element('scenePreviewProperties').querySelectorAll('dd')[0].querySelector('button').click(); await flushDialogs();
  assert.deepEqual(h.opened.at(-1)[1], original);
  h.controller.invalidate(); const updated = structuredClone(data); updated.previewId = previewTwo;
  const next = updated.sourceLocations.actors[0].fields.position; next.sourceRevision = `sha256:${'b'.repeat(64)}`; next.sourceRange.start = 40; next.sourceRange.end = 50;
  await h.resolve(updated); h.element('scenePreviewObjects').querySelector('button').click();
  h.element('scenePreviewProperties').querySelectorAll('dd')[0].querySelector('button').click(); await flushDialogs();
  assert.deepEqual(h.opened.at(-1)[1], next); assert.notDeepEqual(h.opened.at(-1)[1], original);
});

test('v2 repeated definitions select and locate each instance independently after row reorder', async () => {
  const h = await harness(), data = preview(); data.schemaVersion = 2;
  const first = previewOne, second = previewTwo;
  data.actors[0].instanceId = first;
  data.actors.push({ ...structuredClone(data.actors[0]), instanceId: second, position: [400, 120], speed: 99,
    declaration: { ...data.actors[0].declaration, propertyPath: '/actors/1' } });
  data.sourceLocations = { actors: data.actors.map((actor, index) => ({ objectId: actorId, instanceId: actor.instanceId,
    fields: { position: { ...actor.declaration, propertyPath: `/actors/${index}/position`, sourceRevision: `sha256:${'a'.repeat(64)}` } } })) };
  await h.resolve(data); const buttons = h.element('scenePreviewObjects').querySelectorAll('button');
  assert.deepEqual(buttons.map(button => button.dataset.objectId), [actorId, actorId]);
  assert.deepEqual(buttons.map(button => button.dataset.actorId), [first, second]);
  buttons[1].click(); assert.equal(buttons[0].getAttribute('aria-pressed'), 'false'); assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.match(h.element('scenePreviewProperties').textContent, /400, 120/); assert.match(h.element('scenePreviewProperties').textContent, new RegExp(second));
  h.element('scenePreviewProperties').querySelector('dd').querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].propertyPath, '/actors/1/position');
  h.controller.invalidate(); const next = structuredClone(data); next.previewId = imageId; next.actors.reverse(); next.sourceLocations.actors.reverse();
  next.sourceLocations.actors[0].fields.position.propertyPath = '/actors/0/position';
  await h.resolve(next); h.element('scenePreviewObjects').querySelectorAll('button')[0].click();
  assert.match(h.element('scenePreviewProperties').textContent, /400, 120/);
  h.element('scenePreviewProperties').querySelector('dd').querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].propertyPath, '/actors/0/position');
});

test('preview rejects unsupported versions and repeated or missing instance identities before rendering', async () => {
  for (const mutate of [data => { data.schemaVersion = 3; },
    data => { data.schemaVersion = 2; },
    data => { data.schemaVersion = 2; data.actors[0].instanceId = previewOne; data.actors.push(structuredClone(data.actors[0])); },
    data => { data.actors[0].instanceId = previewOne; }]) {
    const h = await harness(), data = preview(); mutate(data); await h.resolve(data);
    assert.notEqual(h.container.dataset.scenePreviewState, 'ready'); assert.equal(h.element('scenePreviewObjects').querySelectorAll('button').length, 0);
  }
});

test('grouped saved previews use the editor sidecar and open the exact group name source', async () => {
  const h = await harness(), value = preview(), groupId = '77777777-7777-4777-8777-777777777777';
  value.schemaVersion = 2; value.actors[0].instanceId = actorId;
  value.sceneStructure = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3,
    groups: [{ groupId, name: 'Party <script>' }], memberships: [{ instanceId: actorId, groupId }] };
  const location = { objectId: sceneOne, sourcePath: value.scene.sourcePath, propertyPath: '/groups/0/name', sourceRevision: `sha256:${'a'.repeat(64)}`, sourceRange: { start: 10, end: 24 } };
  value.sourceLocations = { groups: [{ groupId, fields: { name: location } }] };
  await h.resolve(value); assert.equal(h.container.dataset.scenePreviewState, 'ready');
  const root = h.element('scenePreviewObjects'); assert.equal(root.querySelectorAll('script').length, 0);
  root.querySelector(`button[data-group-source="${groupId}"]`).click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[0], value.scene.sourcePath); assert.deepEqual(h.opened.at(-1)[1], location);
  const search = h.element('scenePreviewSearch'); search.value = 'Traveler'; search.dispatch('input');
  assert.equal(root.querySelectorAll('button[data-group-toggle]').length, 1);
  root.querySelector(`button[data-actor-id="${actorId}"]`).click(); assert.match(h.element('scenePreviewInspector').textContent, /Traveler/);
});

test('invalid scene structure sidecars never paint or expose a misleading group tree', async () => {
  for (const alter of [value => { value.sceneStructure.groups[0].parentGroupId = value.sceneStructure.groups[0].groupId; },
    value => { value.sceneStructure.memberships[0].instanceId = sceneTwo; }, value => { value.sceneStructure.memberships.push(value.sceneStructure.memberships[0]); }]) {
    const h = await harness(), value = preview(), groupId = '77777777-7777-4777-8777-777777777777';
    value.schemaVersion = 2; value.actors[0].instanceId = actorId;
    value.sceneStructure = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3, groups: [{ groupId, name: 'Party' }], memberships: [{ instanceId: actorId, groupId }] };
    alter(value); await h.resolve(value);
    assert.equal(h.container.dataset.scenePreviewState, 'error'); assert.equal(h.element('scenePreviewCanvas').hidden, true);
    assert.equal(h.viewCalls.filter(call => call.name === 'setScene' && call.args[0]).length, 0);
    assert.equal(h.element('scenePreviewObjects').querySelectorAll('[data-group-toggle]').length, 0);
    assert.ok(h.calls.some(call => call.request.method === 'DELETE' && call.url.includes(value.previewId)), 'rejected structure releases its captured preview');
  }
});
