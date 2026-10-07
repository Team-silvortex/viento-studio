import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection-template.mjs';
import { projectionRegistration } from '../../engine/object-projection.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';
import { API_PATHS } from '../lib/doc-api-contract.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
const sceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', imageId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const sourcePath = 'documents/custom/my-scene.json';
const digest = value => createHash('sha256').update(value).digest('hex');
const declaration = () => ({ format: 'viento-scene2d', schemaVersion: 1, title: 'Partial overrides', viewport: [800, 480], background: '#101827', actors: [
  { objectId: ids[1], position: [30, 80], useProjectionDefaults: true, speed: 320, imageResourceId: null },
  { objectId: ids[2], position: [220, 100], useProjectionDefaults: false, size: [40, 50], color: '#abcdef', speed: 0, controls: 'none' },
  { objectId: ids[3], position: [320, 100], size: [60, 70], color: '#fedcba', speed: 10, controls: 'arrows' },
] });
async function fixture(scene = declaration(), custom = {}) {
  const snapshot = getProjectionTemplates().find(item => item.id === 'org.viento.projection.rpg-player');
  const template = await lockProjectionTemplate(snapshot, { digest });
  const authored = { format: 'viento-object-projection', schemaVersion: 1, title: 'Player', sourceObjectId: ids[0], template,
    configuration: Object.fromEntries(snapshot.fields.map(field => [field.id, field.default])) };
  authored.configuration[snapshot.runtime.image] = imageId;
  const content = custom.content || `\uFEFF${JSON.stringify(scene, null, 2).replaceAll('\n', '\r\n')}\r\n`;
  const documents = [0, 2, 3].map(index => ({ sourcePath: `documents/notes/${index}.md`, record: { id: ids[index], documentType: 'notes' }, content: `# Actor ${index}\n` }));
  documents.push({ sourcePath: 'documents/projections/player.json', record: projectionRegistration({ id: ids[1], documentType: 'notes' }, authored), content: JSON.stringify(authored) });
  documents.push({ sourcePath, record: { id: sceneId, documentType: 'notes', ...custom.record }, content });
  for (const doc of documents) { doc.sourceRevision = `sha256:${digest(doc.content)}`; doc.descriptor = { documentType: doc.record.documentType, parserProfile: 'structured' }; }
  const world = await createWorldProjection({ workspace: { id: 'scene-edit-ui', version: 3, name: 'Scene editing' },
    definition: { documentTypes: [{ id: 'notes', label: 'Custom notes', directory: 'notes', parserProfile: 'structured' }] }, documents,
    assets: [{ availability: 'present-unverified', record: { id: imageId, kind: 'image', name: 'Portrait', location: { store: 'main', path: 'portrait.png' }, content: { sha256: 'b'.repeat(64), size: 20 } } }],
  }, { digest });
  return { world, content, scene };
}
async function settle(h) {
  for (let i = 0; i < 200; i++) {
    await flushDialogs();
    if (h.element('sceneCreateDialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Scene dialog remained busy');
}
async function harness(options = {}) {
  let state = await fixture(options.scene, options.fixture), nextReadError = null, sourceMismatch = false, locale = 'zh-CN';
  const current = { editable: true, dirty: false, creating: false, busy: false }, calls = [], reads = [], languages = [], buildCalls = [];
  const buildState = { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.godot4', label: 'Godot 4', version: '0.2.0',
    platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
    capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image'],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
  }, scenes: [{ id: sceneId, sourcePath, title: state.scene.title }], job: options.job || null, latestBuild: null };
  const h = await dialogHarness(options.builder ? 'app-project-build' : 'app-scene-create', {
    WORLD_API_PATH, PROJECT_BUILD_API_PATH, API_PATHS, crypto: webcrypto,
    t: (key, ...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_, i) => String(args[i])),
    onLanguageChange: callback => languages.push(callback),
    fetchJsonApiRequest: async (url, request = {}) => {
      if (nextReadError) { const error = nextReadError; nextReadError = null; throw error; }
      if (url.startsWith(PROJECT_BUILD_API_PATH)) { if (request.method === 'POST') { const call = deferred(); buildCalls.push({ request: JSON.parse(request.body), ...call }); return call.promise; } return { payload: buildState }; }
      return { payload: state.world };
    },
    readDocSource: async request => { reads.push(request); return { content: sourceMismatch ? state.content + '\n' : state.content, version: { size: 1 } }; },
    requestWorldCommand: request => { const waiting = deferred(); calls.push({ request, ...waiting }); return waiting.promise; },
  });
  const settings = { getContext: () => current, setBusy: value => { current.busy = value; }, applied: options.applied };
  const controller = options.builder ? h.runtime.setupProjectBuild(settings) : h.runtime.setupSceneCreate(settings);
  controller.setAvailable(true, options.commands || ['scene.create', 'scene.update']);
  if (options.builder) { h.element('projectBuildBtn').click(); await flushDialogs(); if (options.open !== false) h.element('projectBuildEditScene').click(); }
  else if (options.open !== false) controller.open(sceneId, { mode: 'edit' });
  await settle(h);
  const set = (id, value, event = 'input') => { const input = h.element(id); if (input.type === 'checkbox') input.checked = value; else input.value = value; input.dispatch(event); };
  const result = () => ({ status: 'preview', object: { id: sceneId }, changes: [{ kind: 'scene.update', objectId: sceneId, sourcePath, afterText: calls.at(-1).request.content }] });
  const preview = async response => { const count = calls.length; h.element('sceneCreateCheck').click(); assert.equal(calls.length, count + 1); calls.at(-1).resolve(response || result()); await settle(h); };
  return { ...h, controller, current, calls, reads, set, preview, result, buildState, buildCalls, state: () => state,
    async persist(scene, custom = {}) { state = await fixture(scene, custom); }, failRead(error) { nextReadError = error; }, mismatch(value) { sourceMismatch = value; },
    setLanguage(value) { locale = value; languages.forEach(callback => callback()); } };
}

test('scene editing locks identity and preserves partial inheritance, explicit false and null without materializing absent fields', async () => {
  const h = await harness();
  for (const id of ['sceneCreateIdentity', 'sceneCreateType', 'sceneCreatePath']) assert.equal(h.element(id).readOnly, true, id);
  assert.equal(h.element('sceneCreateIdentity').value, sceneId);
  assert.equal(h.element('sceneActor0Speed').value, '320'); assert.equal(h.element('sceneActor0OverrideSpeed').checked, true);
  assert.equal(h.element('sceneActor0OverrideImage').checked, true); assert.equal(h.element('sceneActor0Image').value, '');
  assert.equal(h.element('sceneActor0size0').disabled, true); assert.equal(h.element('sceneActor0Controls').disabled, true);
  assert.ok(!h.element('sceneActor0Object').children.some(option => option.value === sceneId), 'scene cannot reference itself');
  const afterText = h.state().content; await h.preview({ status: 'preview', changes: [{ afterText }] });
  const request = h.calls[0].request;
  assert.equal(request.command, 'scene.update'); assert.equal(request.objectId, sceneId); assert.equal(Object.hasOwn(request, 'sourcePath'), false);
  assert.equal(request.sourceRevision, `sha256:${digest(afterText)}`); assert.equal(request.objectRevision, h.state().world.objects.find(object => object.id === sceneId).revision);
  assert.deepEqual(JSON.parse(request.content), declaration()); assert.equal(h.element('sceneCreateSource').textContent, afterText);
  assert.equal(h.reads[0].docApiUrl, API_PATHS.DOC); assert.equal(h.reads[0].pathValue, sourcePath);
  h.set('sceneCreatePath', 'documents/evil.json'); h.set('sceneCreateName', 'New title'); await h.preview();
  assert.equal(h.element('sceneCreateSummary').textContent.includes(sourcePath), true);
  assert.deepEqual(JSON.parse(h.calls.at(-1).request.content), { ...declaration(), title: 'New title' });
});

test('scene fields can override one inherited value and return it to projection inheritance without affecting other overrides', async () => {
  const h = await harness(); h.set('sceneActor0OverrideSpeed', false, 'change');
  assert.equal(h.element('sceneActor0Speed').disabled, true);
  h.set('sceneActor0OverrideSize', true, 'change'); h.set('sceneActor0size0', '90'); h.set('sceneActor0size1', '100');
  h.set('sceneActor0Image', imageId, 'change'); await h.preview();
  assert.deepEqual(JSON.parse(h.calls.at(-1).request.content).actors[0], { objectId: ids[1], position: [30, 80], useProjectionDefaults: true, size: [90, 100], imageResourceId: imageId });
  h.set('sceneActor0OverrideImage', false, 'change'); await h.preview();
  assert.equal(Object.hasOwn(JSON.parse(h.calls.at(-1).request.content).actors[0], 'imageResourceId'), false);
  assert.equal(h.element('sceneActor0Image').value, imageId);
  h.set('sceneActor0OverrideControls', true, 'change'); h.set('sceneActor0Controls', 'none', 'change'); await h.preview();
  assert.equal(JSON.parse(h.calls.at(-1).request.content).actors[0].controls, 'none');
});

test('scene edit conflicts and failed reads preserve draft values and refresh source revisions only after a consistent source read', async () => {
  const h = await harness(); h.set('sceneCreateName', 'Keep my draft'); await h.preview(); h.element('sceneCreateForm').requestSubmit();
  h.calls.at(-1).reject(Object.assign(new Error('stale'), { payload: { errorCode: 'world_revision_conflict' } })); await settle(h);
  assert.equal(h.element('sceneCreateName').value, 'Keep my draft'); assert.equal(h.element('sceneCreateCheck').disabled, true);
  h.failRead(new Error('offline')); h.element('sceneCreateRefresh').click(); await settle(h);
  assert.equal(h.element('sceneCreateName').value, 'Keep my draft'); assert.equal(h.element('sceneCreateSave').disabled, true);
  h.mismatch(true); h.element('sceneCreateRefresh').click(); await settle(h);
  assert.equal(h.element('sceneCreateCheck').disabled, true); assert.match(h.element('sceneCreateMessage').textContent, /工程已变化/);
  h.mismatch(false); const changed = declaration(); changed.title = 'External change'; await h.persist(changed);
  h.element('sceneCreateRefresh').click(); await settle(h); await h.preview();
  assert.equal(JSON.parse(h.calls.at(-1).request.content).title, 'Keep my draft'); assert.equal(h.calls.at(-1).request.sourceRevision, `sha256:${digest(h.state().content)}`);
});

test('an uncertain scene update reconciles the complete content and never mistakes an existing identity for success', async () => {
  const h = await harness(); h.set('sceneCreateName', 'Uncertain draft'); await h.preview(); h.element('sceneCreateForm').requestSubmit();
  h.calls.at(-1).reject(new Error('response lost')); await settle(h); assert.equal(h.element('sceneCreateFields').disabled, true);
  h.element('sceneCreateRefresh').click(); await settle(h);
  assert.match(h.element('sceneCreateMessage').textContent, /当前保存内容.*不同/); assert.equal(h.element('sceneCreateCheck').disabled, false);
  assert.equal(h.element('sceneCreateName').value, 'Uncertain draft'); await h.preview(); h.element('sceneCreateForm').requestSubmit();
  const candidate = JSON.parse(h.calls.at(-1).request.content); h.calls.at(-1).reject(new Error('response lost again')); await settle(h);
  await h.persist(candidate); h.element('sceneCreateRefresh').click(); await settle(h);
  assert.match(h.element('sceneCreateMessage').textContent, /已核对/); assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'false');
  assert.equal(h.element('sceneCreateSave').disabled, true); assert.equal(h.calls.length, 4);
});

test('scene edit keeps dirty inputs, overrides and selection across languages, protects dismissal, and maps diagnostics to fields', async () => {
  const h = await harness(); h.set('sceneCreateName', '作者の Scene'); const name = h.element('sceneCreateName'); name.focus(); name.selectionStart = 1; name.selectionEnd = 4;
  h.setLanguage('en'); assert.equal(h.element('sceneCreateName').value, '作者の Scene'); assert.equal(h.element('sceneCreateName').selectionStart, 1);
  h.setLanguage('ja'); assert.equal(h.element('sceneActor0Speed').value, '320'); assert.equal(h.element('sceneActor0OverrideImage').checked, true);
  h.runtime.window.confirm = () => false; h.element('sceneCreateCancel').click(); h.element('sceneCreateDialog').dispatch('cancel'); assert.equal(h.element('sceneCreateDialog').open, true);
  h.element('sceneCreateCheck').click(); h.calls.at(-1).reject(Object.assign(new Error('bad speed'), { payload: { errorCode: 'world_scene_invalid', diagnostics: [{ code: 'build_actor_value', propertyPath: '/actors/0/speed' }] } })); await settle(h);
  h.element('sceneCreateDiagnostics').querySelector('button').click(); assert.equal(h.document.activeElement, h.element('sceneActor0Speed'));
  h.runtime.window.confirm = () => true; h.element('sceneCreateClose').click(); assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'false');
});

test('scene edit capability is independent of creation and saved updates do not revive the previous plan', async () => {
  const old = { id: 'old-plan', backendId: 'org.viento.godot4', kind: 'plan', status: 'succeeded', sceneId, plan: { title: 'Old', actorCount: 3, resourceCount: 1, snapshotId: 'old-snapshot' } };
  const h = await harness({ builder: true, commands: ['scene.update'], job: old });
  assert.equal(h.element('projectBuildCreateScene').hidden, true); assert.equal(h.element('projectBuildEditScene').hidden, false);
  h.set('sceneCreateName', 'Saved scene'); await h.preview(); h.element('sceneCreateForm').requestSubmit();
  h.calls.at(-1).resolve({ ...h.result(), status: 'applied' }); await settle(h); h.element('sceneCreateClose').click(); await flushDialogs();
  assert.equal(h.element('projectBuildScene').value, sceneId); assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.element('projectBuildRefresh').click(); await flushDialogs(); assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.buildState.job = { ...old, id: 'new-plan', plan: { ...old.plan, snapshotId: 'new-snapshot' } };
  h.element('projectBuildRefresh').click(); await flushDialogs(); assert.equal(h.element('projectBuildGenerate').disabled, false);
  const denied = await harness({ commands: ['scene.create'], open: false }); assert.equal(denied.controller.open(sceneId, { mode: 'edit' }), false);
});

test('unrepresentable scene declarations are refused and immutable metadata changes never rebase a saved draft', async () => {
  const extra = declaration(); extra.actors[0].custom = 'preserve'; const invalid = await harness({ scene: extra });
  assert.equal(invalid.element('sceneCreateCheck').disabled, true); assert.equal(invalid.calls.length, 0);
  const h = await harness(); h.set('sceneCreateName', 'Keep this'); await h.persist(declaration(), { record: { documentType: 'different' } });
  h.element('sceneCreateRefresh').click(); await settle(h);
  assert.equal(h.element('sceneCreateName').value, 'Keep this'); assert.equal(h.element('sceneCreateCheck').disabled, true); assert.match(h.element('sceneCreateMessage').textContent, /类型或位置已变化/);
});

test('successful scene update remains saved when refresh fails and blocks duplicate submit', async () => {
  const h = await harness({ applied: async () => { throw new Error('index offline'); } }); await h.preview(); h.element('sceneCreateForm').requestSubmit();
  h.calls.at(-1).resolve({ ...h.result(), status: 'applied' }); await settle(h);
  assert.match(h.element('sceneCreateMessage').textContent, /已保存.*刷新失败/); assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'false');
  h.element('sceneCreateForm').requestSubmit(); assert.equal(h.calls.length, 2);
});


test('new scene forms also support partial projection overrides and an explicit no-image override', async () => {
  const h = await harness(); h.element('sceneCreateClose').click(); await flushDialogs();
  assert.equal(h.controller.open(), true); await settle(h); h.set('sceneActor0Object', ids[1], 'change');
  h.set('sceneActor0OverrideSpeed', true, 'change'); h.set('sceneActor0Speed', '450');
  h.set('sceneActor0OverrideImage', true, 'change'); h.set('sceneActor0Image', '', 'change'); await h.preview();
  assert.equal(h.calls.at(-1).request.command, 'scene.create');
  const { instanceId, ...actor } = JSON.parse(h.calls.at(-1).request.content).actors[0];
  assert.match(instanceId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(actor, { objectId: ids[1], position: [200, 220], useProjectionDefaults: true, speed: 450, imageResourceId: null });
});

test('scene creation cannot recover the old scene plan after refreshing the build workbench', async () => {
  const old = { id: 'old-plan', backendId: 'org.viento.godot4', kind: 'plan', status: 'succeeded', sceneId, plan: { title: 'Old', actorCount: 3, resourceCount: 1, snapshotId: 'old-snapshot' } };
  const h = await harness({ builder: true, job: old, open: false }); h.element('projectBuildCreateScene').click(); await settle(h);
  await h.preview(); const createdId = h.calls.at(-1).request.objectId;
  h.buildState.scenes.push({ id: createdId, sourcePath: 'documents/scenes/new-scene.json', title: 'New' });
  h.element('sceneCreateForm').requestSubmit(); h.calls.at(-1).resolve({ ...h.result(), object: { id: createdId }, status: 'applied' }); await settle(h);
  h.element('sceneCreateClose').click(); await flushDialogs(); h.set('projectBuildScene', sceneId, 'change');
  h.element('projectBuildRefresh').click(); await flushDialogs(); assert.equal(h.element('projectBuildGenerate').disabled, true);
  h.buildState.job = { ...old, id: 'explicit-new-plan' }; h.element('projectBuildRefresh').click(); await flushDialogs();
  assert.equal(h.element('projectBuildGenerate').disabled, false, 'an explicitly checked new plan can reuse unchanged snapshot bytes');
});


test('legacy scene upgrade is explicit, remains a draft, and seeds stable IDs before clone and reorder', async () => {
  const h = await harness(); assert.equal(h.element('sceneCreateEnableInstances').hidden, false);
  await h.preview(); assert.deepEqual(JSON.parse(h.calls.at(-1).request.content), declaration());
  h.element('sceneCreateEnableInstances').click(); assert.equal(h.element('sceneCreateDialog').dataset.dirty, 'true');
  assert.equal(h.element('sceneCreateSave').disabled, true); assert.equal(h.calls.length, 1);
  for (let i = 0; i < 3; i++) assert.equal(h.element(`sceneActor${i}Instance`).value, ids[i + 1]);
  h.element('sceneActor0Duplicate').click(); const duplicate = h.element('sceneActor1Instance').value;
  assert.notEqual(duplicate, ids[1]); h.element('sceneActor1Down').click();
  await h.preview(); const value = JSON.parse(h.calls.at(-1).request.content);
  assert.equal(value.schemaVersion, 2); assert.deepEqual(value.actors.map(actor => actor.instanceId), [ids[1], ids[2], duplicate, ids[3]]);
  assert.deepEqual(value.actors[2], { ...declaration().actors[0], instanceId: duplicate });
  assert.deepEqual(h.state().scene, declaration(), 'preview has not rewritten saved v1 source');
});

test('v2 instance identities survive definition changes, inheritance toggles, languages, and partial overrides', async () => {
  const scene = declaration(); scene.schemaVersion = 2; scene.actors = scene.actors.slice(0, 1).map(actor => ({ ...actor, instanceId: ids[0] }));
  scene.actors.push({ ...scene.actors[0], instanceId: ids[2], position: [240, 280], speed: 77 });
  const h = await harness({ scene }); assert.equal(h.element('sceneCreateEnableInstances').hidden, true);
  h.set('sceneActor1Object', ids[3], 'change'); assert.equal(h.element('sceneActor1Instance').value, ids[2]);
  h.set('sceneActor1Object', ids[1], 'change'); h.set('sceneActor1UseProjection', false, 'change');
  h.set('sceneActor1UseProjection', true, 'change'); h.setLanguage('en');
  assert.equal(h.element('sceneActor1Instance').value, ids[2]); h.set('sceneActor1OverrideSpeed', true, 'change'); h.set('sceneActor1Speed', '333');
  await h.preview(); const value = JSON.parse(h.calls.at(-1).request.content);
  assert.deepEqual(value.actors[0], scene.actors[0]);
  assert.deepEqual(value.actors[1], { instanceId: ids[2], objectId: ids[1], position: [240, 280], useProjectionDefaults: true, speed: 333 });
});

test('legacy scenes still reject repeated definitions until explicitly upgraded', async () => {
  const h = await harness(); h.set('sceneActor1Object', ids[1], 'change'); h.element('sceneCreateCheck').click();
  assert.equal(h.calls.length, 0); assert.match(h.element('sceneCreateDiagnostics').textContent, /重复/);
});

test('scene groups require explicit upgrade, retain instance identities and serialize only explicit memberships', async () => {
  const h = await harness(); assert.equal(h.element('sceneCreateEnableGroups').hidden, true);
  h.element('sceneCreateEnableInstances').click();
  assert.equal(h.element('sceneCreateEnableGroups').hidden, false);
  h.element('sceneCreateEnableGroups').click(); h.element('sceneCreateAddGroup').click();
  const parentId = h.element('sceneGroup0Identity').value;
  h.set('sceneGroup0Name', 'Party'); h.element('sceneCreateAddGroup').click();
  const childId = h.element('sceneGroup1Identity').value;
  h.set('sceneGroup1Name', 'Front line'); h.set('sceneGroup1Parent', parentId, 'change');
  h.set('sceneActor0Group', childId, 'change');
  assert.equal(h.element('sceneGroup0Remove').disabled, true); assert.equal(h.element('sceneGroup1Remove').disabled, true);
  assert.ok(!h.element('sceneGroup0Parent').children.some(option => option.value === childId), 'descendant cannot become parent');
  h.set('sceneActor0Object', ids[2], 'change');
  assert.equal(h.element('sceneActor0Group').value, childId); assert.equal(h.element('sceneActor0Instance').value, ids[1]);
  h.element('sceneActor0Duplicate').click(); const copyId = h.element('sceneActor1Instance').value;
  assert.notEqual(copyId, ids[1]); assert.equal(h.element('sceneActor1Group').value, childId);
  h.element('sceneActor1Down').click(); assert.equal(h.element('sceneActor2Instance').value, copyId);
  h.setLanguage('en'); assert.equal(h.element('sceneActor2Group').value, childId);
  h.setLanguage('ja'); assert.equal(h.element('sceneGroup1Name').value, 'Front line');
  await h.preview(); const value = JSON.parse(h.calls.at(-1).request.content);
  assert.equal(value.schemaVersion, 3); assert.deepEqual(value.groups, [{ groupId: parentId, name: 'Party' }, { groupId: childId, name: 'Front line', parentGroupId: parentId }]);
  assert.equal(value.actors[0].groupId, childId); assert.equal(value.actors[2].groupId, childId);
  assert.equal(Object.hasOwn(value.actors[1], 'groupId'), false); assert.equal(Object.hasOwn(value.groups[0], 'parentGroupId'), false);
});

test('saved group memberships survive inheritance switching and empty groups can be removed without reassigning actors', async () => {
  const scene = declaration(); scene.schemaVersion = 3; scene.groups = [{ groupId: '12345678-1234-4234-8234-123456789abc', name: 'Party' }];
  scene.actors.forEach(actor => { actor.instanceId = actor.objectId; }); scene.actors[0].groupId = scene.groups[0].groupId;
  const h = await harness({ scene }); assert.equal(h.element('sceneCreateEnableGroups').hidden, true);
  h.set('sceneActor0UseProjection', false, 'change'); h.set('sceneActor0UseProjection', true, 'change');
  assert.equal(h.element('sceneActor0Group').value, scene.groups[0].groupId);
  h.element('sceneGroup0Remove').click(); await h.preview(); assert.equal(JSON.parse(h.calls.at(-1).request.content).groups.length, 1);
  h.set('sceneActor0Group', '', 'change'); assert.equal(h.element('sceneGroup0Remove').disabled, false);
  h.element('sceneGroup0Remove').click(); await h.preview(); const value = JSON.parse(h.calls.at(-1).request.content);
  assert.deepEqual(value.groups, []); assert.equal(Object.hasOwn(value.actors[0], 'groupId'), false);
  assert.equal(value.actors[0].instanceId, scene.actors[0].instanceId);
});

test('invalid scene group names and parent depths block preview without sending a command', async () => {
  const h = await harness(); h.element('sceneCreateEnableInstances').click(); h.element('sceneCreateEnableGroups').click(); h.element('sceneCreateAddGroup').click();
  h.set('sceneGroup0Name', '  '); h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 0);
  assert.match(h.element('sceneCreateDiagnostics').textContent, /分组/);
  h.set('sceneGroup0Name', 'Root'); let parent = h.element('sceneGroup0Identity').value;
  for (let index = 1; index < 17; index++) { h.element('sceneCreateAddGroup').click(); h.set(`sceneGroup${index}Parent`, parent, 'change'); parent = h.element(`sceneGroup${index}Identity`).value; }
  h.element('sceneCreateCheck').click(); assert.equal(h.calls.length, 0); assert.match(h.element('sceneCreateDiagnostics').textContent, /parentGroupId/);
});
