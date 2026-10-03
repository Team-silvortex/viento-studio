import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/build-plan.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const gifId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(version = 3) {
  const root = version === 3 ? 'documents' : 'design-data';
  return createWorldProjection({ workspace: { id: 'scene-ui', version, name: 'Scene UI' },
    definition: { documentTypes: [{ id: 'notes', label: 'Custom notes', directory: 'notes', parserProfile: 'structured' }] },
    documents: ids.map((id, index) => ({ sourcePath: `${root}/notes/${index}.md`, record: { id, documentType: 'notes' },
      descriptor: { documentType: 'notes', parserProfile: 'structured' }, content: `# Actor ${index}\n`, sourceRevision: `sha256:${'a'.repeat(64)}` })),
    assets: [imageId, gifId].map((id, index) => ({ availability: 'present-unverified', record: { id, kind: 'image', name: index ? 'GIF excluded' : 'Texture',
      location: { store: 'main', path: index ? 'image.gif' : 'image.png' }, content: { sha256: 'b'.repeat(64), size: 20 } } })),
  }, { digest: value => createHash('sha256').update(value).digest('hex') });
}
async function harness(options = {}) {
  let projection = options.projection || await fixture(options.version), locale = 'zh-CN', nextReadError = null;
  const current = { editable: true, dirty: false, creating: false, busy: false }, calls = [], languageChanges = [];
  const buildState = { supported: true, available: false, reason: 'tool_missing', backend: { id: 'godot4', label: 'Godot 4', version: '1' }, scenes: [], job: null, latestBuild: null };
  const h = await dialogHarness(options.builder ? 'app-project-build' : 'app-scene-create', {
    WORLD_API_PATH, PROJECT_BUILD_API_PATH, getCreatePathError, crypto: webcrypto,
    t: (key, ...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_, index) => String(args[index])),
    onLanguageChange: callback => languageChanges.push(callback),
    fetchJsonApiRequest: async url => {
      if (nextReadError) { const error = nextReadError; nextReadError = null; throw error; }
      return { payload: url.startsWith(PROJECT_BUILD_API_PATH) ? buildState : projection };
    },
    requestWorldCommand: request => { const waiting = deferred(); calls.push({ request, ...waiting }); return waiting.promise; },
  });
  const applied = async result => {
    buildState.scenes = [{ id: result.object.id, sourcePath: result.changes[0].sourcePath, title: 'Created' }];
    await options.applied?.(result);
  };
  const controller = options.builder ? h.runtime.setupProjectBuild({ getContext: () => current, setBusy: value => { current.busy = value; }, applied })
    : h.runtime.setupSceneCreate({ getContext: () => current, setBusy: value => { current.busy = value; }, applied });
  if (options.builder) {
    controller.setAvailable(true, ['scene.create']); h.element('projectBuildBtn').click(); await flushDialogs();
    h.element('projectBuildCreateScene').click();
  } else { controller.setAvailable(true); controller.open(); }
  await flushDialogs();
  const set = (id, value, event = 'input') => { h.element(id).value = value; h.element(id).dispatch(event); };
  const result = () => ({ status: 'preview', object: { id: calls.at(-1).request.objectId }, changes: [{ kind: 'scene.create', sourcePath: calls.at(-1).request.sourcePath, afterText: calls.at(-1).request.content }] });
  const preview = async () => { h.element('sceneCreateCheck').click(); calls.at(-1).resolve(result()); await flushDialogs(); };
  return { ...h, controller, current, calls, set, preview, result, setProjection: value => { projection = value; }, failNextRead: error => { nextReadError = error; },
    setLanguage: value => { locale = value; languageChanges.forEach(callback => callback()); } };
}

test('scene creator uses existing custom types and v2 roots, filtering unsupported images and submitting one complete command', async () => {
  const h = await harness({ version: 2 });
  assert.equal(h.element('sceneCreateType').value, 'notes');
  assert.equal(h.element('sceneCreatePath').value, 'design-data/scenes/new-scene.json');
  assert.equal(h.element('sceneActor0Image').children.length, 2);
  assert.equal(h.element('sceneActor0Image').children.some(option => option.value === gifId), false);
  h.set('sceneActor0Image', imageId, 'change'); h.element('sceneCreateAdd').click();
  h.set('sceneActor1Controls', 'none', 'change'); await h.preview();
  const first = h.calls[0].request, content = JSON.parse(first.content);
  assert.equal(first.command, 'scene.create'); assert.equal(content.actors.length, 2);
  assert.equal(content.actors[0].imageResourceId, imageId); assert.equal(content.actors[1].controls, 'none');
  assert.equal(content.actors[1].imageResourceId, undefined);
  h.element('sceneCreateForm').requestSubmit();
  assert.equal(h.calls[1].request.objectId, first.objectId);
  assert.equal(h.calls[1].request.content, first.content); assert.equal(h.calls[1].request.mode, 'apply');
  h.calls[1].resolve({ ...h.result(), status: 'applied' }); await flushDialogs();
  assert.equal(h.element('sceneCreateSave').disabled, true); assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'false');
});

test('scene form changes invalidate previews; blank numbers and duplicate actors never submit', async () => {
  const h = await harness(); await h.preview();
  h.set('sceneActor0Speed', ''); assert.equal(h.element('sceneCreateSave').disabled, true);
  h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 1);
  assert.match(h.element('sceneCreateDiagnostics').textContent, /\/actors\/0\/speed/);
  h.set('sceneActor0Speed', '0'); h.element('sceneCreateAdd').click();
  h.set('sceneActor1Object', ids[0], 'change'); h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 1);
  assert.match(h.element('sceneCreateDiagnostics').textContent, /重复/);
  h.set('sceneActor1Object', ids[1], 'change'); await h.preview();
  assert.equal(JSON.parse(h.calls.at(-1).request.content).actors[0].speed, 0);
  h.set('sceneCreateType', 'notes', 'change'); assert.equal(h.element('sceneCreateSave').disabled, true);
  await h.preview(); h.set('sceneActor0Image', imageId, 'change'); assert.equal(h.element('sceneCreateSave').disabled, true);
});

test('scene creator rejects unsafe paths and numeric bounds before submitting', async () => {
  const h = await harness();
  for (const path of ['documents/.hidden/x.json', 'documents/../other.json', 'documents/file.yaml', `documents/${'a'.repeat(1025)}.json`]) {
    h.set('sceneCreatePath', path); h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 0, path);
  }
  h.set('sceneCreatePath', 'documents/scenes/test.json'); h.set('sceneCreateViewport0', '800.5');
  h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 0);
  h.set('sceneCreateViewport0', '800'); h.set('sceneActor0size0', '2049'); h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 0);
});

test('cancel and Escape protect a dirty scene, then clear the closed-dialog guard after discarding', async () => {
  const h = await harness(); h.set('sceneCreateName', 'Keep draft');
  h.runtime.window.confirm = () => false;
  h.element('sceneCreateCancel').click(); h.element('sceneCreateDialog').dispatch('cancel');
  assert.equal(h.element('sceneCreateDialog').open, true); assert.equal(h.element('sceneCreateName').value, 'Keep draft');
  assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'true');
  h.runtime.window.confirm = () => true; h.element('sceneCreateClose').click();
  assert.equal(h.element('sceneCreateDialog').open, false); assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'false');
  const key = h.element('sceneCreateDialog').dispatch('keydown', { key: 's', ctrlKey: true });
  assert.equal(key.defaultPrevented, true); assert.equal(key.stopped, true);
});

test('the scene creator blocks duplicate writes and retains scene identity through a revision conflict', async () => {
  const h = await harness(); h.set('sceneCreateName', 'My saved scene'); await h.preview();
  const id = h.calls[0].request.objectId;
  h.element('sceneCreateForm').requestSubmit(); h.element('sceneCreateForm').requestSubmit(); h.element('sceneCreateClose').click();
  assert.equal(h.calls.length, 2); assert.equal(h.element('sceneCreateDialog').open, true);
  h.calls[1].reject(Object.assign(new Error('conflict'), { payload: { errorCode: 'world_revision_conflict' } })); await flushDialogs();
  assert.equal(h.element('sceneCreateName').value, 'My saved scene'); assert.equal(h.element('sceneCreateCheck').disabled, true);
  const changed = await fixture(); changed.world.revision = `sha256:${'c'.repeat(64)}`; h.setProjection(changed);
  h.element('sceneCreateRefresh').click(); await flushDialogs(); await h.preview();
  assert.equal(h.calls.at(-1).request.objectId, id);
  assert.equal(h.calls.at(-1).request.baseRevision, changed.world.revision);
});

test('an uncertain save keeps the draft locked until rereading confirms whether its identity exists', async () => {
  const h = await harness(); h.set('sceneCreateName', 'Unknown outcome'); await h.preview();
  h.element('sceneCreateForm').requestSubmit();
  h.calls.at(-1).reject(new Error('connection lost')); await flushDialogs();
  assert.equal(h.element('sceneCreateCheck').disabled, true); assert.equal(h.element('sceneCreateSave').disabled, true);
  h.element('sceneCreateForm').requestSubmit(); assert.equal(h.calls.length, 2);
  const current = await fixture(); current.objects.push({ ...current.objects[0], id: h.calls[0].request.objectId }); h.setProjection(current);
  h.element('sceneCreateRefresh').click(); await flushDialogs();
  assert.match(h.element('sceneCreateMessage').textContent, /身份已经登记/);
  assert.equal(h.element('sceneCreateSave').disabled, true); assert.equal(h.element('sceneCreateName').value, 'Unknown outcome');
});

test('successful creation followed by a refresh failure cannot resubmit the scene', async () => {
  const h = await harness({ applied: async () => { throw new Error('index refresh failed'); } });
  await h.preview(); h.element('sceneCreateForm').requestSubmit(); h.calls.at(-1).resolve({ ...h.result(), status: 'applied' }); await flushDialogs();
  assert.match(h.element('sceneCreateMessage').textContent, /场景已创建.*刷新失败/);
  assert.equal(h.element('sceneCreateCheck').disabled, true); assert.equal(h.element('sceneCreateSave').disabled, true);
  h.element('sceneCreateForm').requestSubmit(); assert.equal(h.calls.length, 2);
});

test('server scene diagnostics localize and retain exact JSON pointers with raw details', async () => {
  const h = await harness(); h.element('sceneCreateCheck').click();
  h.calls[0].reject(Object.assign(new Error('scene invalid'), { payload: { errorCode: 'world_scene_invalid', diagnostics: [{ code: 'build_actor_value', propertyPath: '/actors/0/speed', message: 'bad speed <tag>' }] } })); await flushDialogs();
  h.element('sceneCreateDiagnostics').querySelector('button').click(); assert.equal(h.document.activeElement, h.element('sceneActor0Speed'));
  assert.match(h.element('sceneCreateDetails').textContent, /bad speed <tag>/); assert.equal(h.element('sceneCreateDetails').children.length, 0);
});

test('language changes preserve scene inputs, selected assets, focus and text selection', async () => {
  const h = await harness(); h.set('sceneCreateName', '作者名：Scene'); h.set('sceneActor0Image', imageId, 'change');
  const input = h.element('sceneCreateName'); input.focus(); input.selectionStart = 2; input.selectionEnd = 5;
  h.setLanguage('ja');
  assert.equal(h.element('sceneCreateName').value, '作者名：Scene'); assert.equal(h.element('sceneActor0Image').value, imageId);
  assert.equal(h.document.activeElement, h.element('sceneCreateName'));
  assert.equal(h.element('sceneCreateName').selectionStart, 2); assert.equal(h.element('sceneCreateName').selectionEnd, 5);
  h.setLanguage('en'); assert.equal(h.element('sceneCreateName').value, '作者名：Scene');
});

test('empty projects and document drafts cannot silently create placeholder actors or overwrite editing', async () => {
  const projection = await fixture(); projection.objects = []; const h = await harness({ projection });
  assert.equal(h.element('sceneCreateEmpty').hidden, false); assert.equal(h.element('sceneCreateCheck').disabled, true);
  h.element('sceneCreateClose').click(); h.current.dirty = true;
  assert.equal(h.controller.open(), false); assert.equal(h.current.dirty, true); assert.equal(h.calls.length, 0);
  h.current.dirty = false; h.controller.setAvailable(false); assert.equal(h.controller.open(), false);
});

test('creation inside the build workbench selects the new scene and releases plan actions immediately', async () => {
  const h = await harness({ builder: true }); await h.preview();
  h.element('sceneCreateForm').requestSubmit(); h.calls.at(-1).resolve({ ...h.result(), status: 'applied' }); await flushDialogs();
  assert.equal(h.current.busy, false);
  assert.equal(h.element('projectBuildScene').value, h.calls[0].request.objectId);
  h.element('sceneCreateClose').click(); await flushDialogs();
  assert.equal(h.element('projectBuildPlan').disabled, false);
  assert.equal(h.calls.length, 2, 'creation never starts a build or run');
});

test('all scene creation messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-create.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n="([^"]+)")/g)].map(match => match[1] || match[2]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});


test('a failed project reload invalidates the previous preview while retaining the scene draft', async () => {
  const h = await harness(); h.set('sceneCreateName', 'Keep this scene'); await h.preview();
  assert.equal(h.element('sceneCreateSave').disabled, false);
  h.failNextRead(new Error('network failure')); h.element('sceneCreateRefresh').click(); await flushDialogs();
  assert.equal(h.element('sceneCreateName').value, 'Keep this scene');
  assert.equal(h.element('sceneCreateSave').disabled, true);
  assert.equal(h.element('sceneCreatePreview').hidden, true);
  assert.match(h.element('sceneCreateMessage').textContent, /无法读取工程/);
  h.element('sceneCreateForm').requestSubmit(); assert.equal(h.calls.length, 1);
});
