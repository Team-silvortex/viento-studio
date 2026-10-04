import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { getProjectionTemplates, lockProjectionTemplate, deriveProjectionTemplate, projectionRegistration } from '../../engine/object-projection.mjs';
import { queryWorldProjection, WORLD_API_PATH } from '../../engine/world-query.mjs';
import { canSetObjectProperty, canRelateObject, MAX_CHANGESET_COMMANDS } from '../../engine/world-command-contract.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
const assetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(version = 3) {
  const root = version === 3 ? 'documents' : 'design-data', templates = getProjectionTemplates();
  const documents = [{ sourcePath: `${root}/notes/core.md`, record: { id: ids[0], documentType: 'notes' }, content: '# Traveller\nBackground: Original life story\n', sourceRevision: `sha256:${'a'.repeat(64)}` }];
  for (const [index, snapshot] of [templates[0], templates[1], templates[3]].entries()) {
    const configuration = Object.fromEntries(snapshot.fields.map(field => [field.id, field.default]));
    if (index < 2) { configuration.speed = index ? 0 : 250; configuration.image = assetId; }
    const content = { format: 'viento-object-projection', schemaVersion: 1, title: ['Playable', 'Shopkeeper', 'Literary'][index], sourceObjectId: ids[0], template: await lockProjectionTemplate(snapshot, { digest }), configuration };
    const record = projectionRegistration({ id: ids[index + 1], documentType: 'notes' }, content);
    documents.push({ record, sourcePath: `${root}/projections/${index}.json`, content: JSON.stringify(content), sourceRevision: `sha256:${digest(JSON.stringify(content))}` });
  }
  return createWorldProjection({ workspace: { id: 'projection-ui', version, name: 'Projection UI' },
    definition: { documentTypes: [{ id: 'notes', label: 'Notes', directory: 'notes', parserProfile: 'structured' }] }, documents,
    assets: [{ availability: 'present-unverified', record: { id: assetId, kind: 'image', name: 'Portrait', location: { store: 'main', path: 'portrait.png' }, content: { sha256: 'c'.repeat(64), size: 50 } } }],
  }, { digest });
}
async function harness(options = {}) {
  let world = options.world || await fixture(options.version), readError = null, locale = 'zh-CN';
  const calls = [], current = { editable: true, dirty: false, creating: false, busy: false }, languages = [];
  const h = await dialogHarness(options.worldBrowser ? 'app-world-browser' : options.scene ? 'app-scene-create' : 'app-object-projection', {
    crypto: webcrypto, WORLD_API_PATH, queryWorldProjection, canSetObjectProperty, canRelateObject, MAX_CHANGESET_COMMANDS,
    t: (key, ...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_, i) => String(args[i])),
    onLanguageChange: callback => languages.push(callback),
    fetchJsonApiRequest: async () => { if (readError) { const error = readError; readError = null; throw error; } return { payload: world }; },
    requestWorldCommand: request => { const waiting = deferred(); calls.push({ request, ...waiting }); return waiting.promise; },
  });
  const settings = { getContext: () => current, setBusy: value => { current.busy = value; }, applied: options.applied, openSource: options.openSource };
  const controller = options.worldBrowser ? h.runtime.setupWorldBrowser(settings) : options.scene ? h.runtime.setupSceneCreate(settings) : h.runtime.setupObjectProjection(settings);
  if (options.worldBrowser) { controller.setAvailable(true, options.commands || ['property.set', 'projection.create', 'projection.update']); h.element('worldBrowserBtn').click(); }
  else { controller.setAvailable(true, options.commands || (options.scene ? ['scene.create'] : ['projection.create', 'projection.update'])); controller.open(options.edit ? options.objectId || ids[1] : options.sourceId || ids[0], { mode: options.edit ? 'edit' : 'create' }); }
  await flushDialogs();
  const set = (id, value, event = 'input') => { const element = h.element(id); if (element.type === 'checkbox') element.checked = value; else element.value = value; element.dispatch(event); };
  const preview = async () => {
    const count = calls.length; h.element(options.scene ? 'sceneCreateCheck' : 'objectProjectionCheck').click();
    for (let n = 0; n < 100 && calls.length === count; n++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(calls.length, count + 1, 'preview request submitted');
    calls.at(-1).resolve({ status: 'preview' }); await flushDialogs();
  };
  return { ...h, controller, current, calls, set, preview, world, setWorld: value => { world = value; }, failRead: error => { readError = error; }, setLanguage: value => { locale = value; languages.forEach(callback => callback()); } };
}

test('projection creator supports custom document types, v2 paths, typed configuration and stable preview/apply identities', async () => {
  const h = await harness({ version: 2 });
  assert.equal(h.element('objectProjectionPath').value, 'design-data/projections/new-projection.json');
  assert.equal(h.element('objectProjectionType').value, 'notes');
  assert.deepEqual(h.element('objectProjectionField-controls').children.map(option => option.textContent), ['方向键', '不接受输入']);
  h.set('objectProjectionTemplate', 'builtin:org.viento.projection.rpg-npc', 'change');
  h.set('objectProjectionField-interactable', false, 'change'); h.set('objectProjectionField-health', '0');
  h.set('objectProjectionField-image', assetId, 'change'); await h.preview();
  const request = h.calls[0].request, content = JSON.parse(request.content);
  assert.equal(request.command, 'projection.create'); assert.equal(content.sourceObjectId, ids[0]);
  assert.equal(content.configuration.interactable, false); assert.equal(content.configuration.health, 0); assert.equal(content.configuration.image, assetId);
  assert.equal(content.template.digest, `sha256:${digest((await import('../../engine/world-projection.mjs')).canonicalJson(content.template.snapshot))}`);
  h.element('objectProjectionForm').requestSubmit(); assert.equal(h.calls[1].request.objectId, request.objectId); assert.equal(h.calls[1].request.content, request.content);
  h.calls[1].resolve({ status: 'applied' }); await flushDialogs();
  assert.equal(h.element('objectProjectionSave').disabled, true); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false');
});

test('switching subtemplates invalidates preview and existing projections become independent defaults with the chosen core source', async () => {
  const h = await harness(); await h.preview();
  h.set('objectProjectionTemplate', `object:${ids[1]}`, 'change'); assert.equal(h.element('objectProjectionSave').disabled, true);
  assert.equal(h.element('objectProjectionField-speed').value, '250'); assert.equal(h.element('objectProjectionField-image').value, '');
  h.set('objectProjectionField-speed', '500'); await h.preview();
  const content = JSON.parse(h.calls.at(-1).request.content);
  assert.equal(content.sourceObjectId, ids[0]); assert.equal(content.template.snapshot.fields.find(field => field.id === 'speed').default, 250);
  assert.equal(content.configuration.speed, 500); assert.equal(h.world.objects.find(object => object.id === ids[1]).provenance.authoredProjection.configuration.speed, 250);
  assert.ok(content.template.snapshot.lineage.some(item => item.id === 'org.viento.projection.rpg-player'));
});

test('projection template, type, fields and safe-path checks invalidate preview and preserve blank numeric drafts', async () => {
  const h = await harness(); await h.preview(); h.set('objectProjectionField-speed', '');
  h.element('objectProjectionCheck').click(); assert.equal(h.calls.length, 1); assert.equal(h.element('objectProjectionSave').disabled, true);
  h.element('objectProjectionDiagnostics').querySelector('button').click(); assert.equal(h.document.activeElement, h.element('objectProjectionField-speed'));
  h.set('objectProjectionField-speed', '0'); h.set('objectProjectionPath', 'documents/../escape.json'); h.element('objectProjectionCheck').click(); assert.equal(h.calls.length, 1);
  h.set('objectProjectionPath', 'documents/projections/safe.json'); await h.preview(); h.set('objectProjectionType', 'notes', 'change'); assert.equal(h.element('objectProjectionSave').disabled, true);
});

test('failed reads and revision conflicts retain projection values and never reuse stale previews', async () => {
  const h = await harness(); h.set('objectProjectionName', 'Custom projection'); await h.preview();
  const id = h.calls[0].request.objectId; h.failRead(new Error('offline')); h.element('objectProjectionRefresh').click(); await flushDialogs();
  assert.equal(h.element('objectProjectionSave').disabled, true); assert.equal(h.element('objectProjectionContent').textContent, ''); assert.equal(h.element('objectProjectionName').value, 'Custom projection');
  h.element('objectProjectionRefresh').click(); await flushDialogs(); await h.preview(); h.element('objectProjectionForm').requestSubmit();
  h.calls.at(-1).reject(Object.assign(new Error('conflict'), { payload: { errorCode: 'world_revision_conflict' } })); await flushDialogs();
  assert.equal(h.element('objectProjectionSave').disabled, true); h.element('objectProjectionRefresh').click(); await flushDialogs(); await h.preview();
  assert.equal(h.calls.at(-1).request.objectId, id); assert.equal(h.element('objectProjectionName').value, 'Custom projection');
});

test('uncertain saves require reconciliation and successful writes stay successful when refreshing the index fails', async () => {
  const h = await harness({ applied: async () => { throw new Error('index failed'); } }); await h.preview();
  h.element('objectProjectionForm').requestSubmit(); h.calls.at(-1).reject(new Error('response lost')); await flushDialogs();
  assert.equal(h.element('objectProjectionFields').disabled, true); assert.equal(h.element('objectProjectionCheck').disabled, true);
  h.element('objectProjectionRefresh').click(); await flushDialogs(); await h.preview(); h.element('objectProjectionForm').requestSubmit();
  h.calls.at(-1).resolve({ status: 'applied' }); await flushDialogs(); assert.match(h.element('objectProjectionMessage').textContent, /已创建.*勿重复创建/);
  h.element('objectProjectionForm').requestSubmit(); assert.equal(h.calls.length, 4); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false');
});

test('projection dialog guards draft dismissal and preserves translated fields, focus and selection', async () => {
  const h = await harness(); h.set('objectProjectionName', '名前 / Name'); const input = h.element('objectProjectionName'); input.focus(); input.selectionStart = 2; input.selectionEnd = 4;
  h.setLanguage('ja'); assert.equal(h.element('objectProjectionName').value, '名前 / Name'); assert.equal(h.document.activeElement, h.element('objectProjectionName')); assert.equal(h.document.activeElement.selectionStart, 2);
  h.runtime.window.confirm = () => false; h.element('objectProjectionDialog').dispatch('cancel'); assert.equal(h.element('objectProjectionDialog').open, true);
  h.runtime.window.confirm = () => true; h.element('objectProjectionCancel').click(); assert.equal(h.element('objectProjectionDialog').open, false); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false');
});

test('creation is capability and draft gated, and existing or broken projections cannot become source cores', async () => {
  const h = await harness({ sourceId: ids[1] }); assert.equal(h.element('objectProjectionCheck').disabled, true); assert.equal(h.calls.length, 0);
  h.element('objectProjectionClose').click(); h.current.dirty = true; assert.equal(h.controller.open(ids[0]), false);
  h.current.dirty = false; h.controller.setAvailable(false); assert.equal(h.controller.open(ids[0]), false);
  const world = await fixture(); world.objects[0].provenance.authoredProjection = null;
  const broken = await harness({ world }); assert.equal(broken.element('objectProjectionCheck').disabled, true);
});

test('World exposes multiple projections of the same core, returns to it and guards opening projection source', async () => {
  let allowOpen = false; const opened = []; const h = await harness({ worldBrowser: true, openSource: path => { opened.push(path); return allowOpen; } });
  assert.equal(h.element('worldProjectionList').querySelectorAll('button').length, 3);
  assert.equal(h.element('worldProjectionCreate').disabled, false);
  h.element('worldProjectionList').querySelectorAll('button')[0].click(); assert.equal(h.element('worldProjectionCreate'), null);
  h.element('worldProjectionEditSource').click(); assert.equal(h.element('worldBrowserDialog').open, true);
  h.element('worldProjectionSource').click(); assert.equal(h.element('worldProjectionList').querySelectorAll('button').length, 3);
  h.element('worldProjectionCreate').click(); await flushDialogs(); assert.equal(h.element('objectProjectionDialog').open, true);
  h.element('objectProjectionClose').click(); await flushDialogs(); h.element('worldProjectionList').querySelectorAll('button')[0].click();
  allowOpen = true; h.element('worldProjectionEditSource').click(); assert.equal(h.element('worldBrowserDialog').open, false); assert.equal(opened.length, 2);
});

test('scene picks compatible projections and submits inherited defaults separately from complete explicit overrides', async () => {
  const h = await harness({ scene: true }); const picker = h.element('sceneActor0Object');
  assert.equal(picker.children.some(option => option.value === ids[3]), false); assert.equal(picker.children.some(option => option.value === ids[1]), true);
  const instanceId = h.element('sceneActor0Instance').value;
  assert.match(instanceId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  h.set('sceneActor0Object', ids[1], 'change'); assert.equal(h.element('sceneActor0UseProjection').checked, true);
  assert.equal(h.element('sceneActor0Speed').value, '250'); assert.equal(h.element('sceneActor0Speed').disabled, true); assert.equal(h.element('sceneActor0position0').disabled, false);
  h.set('sceneActor0position0', '32'); await h.preview();
  const inherited = JSON.parse(h.calls.at(-1).request.content).actors[0]; assert.deepEqual(inherited, { instanceId, objectId: ids[1], position: [32, 220], useProjectionDefaults: true });
  assert.equal(JSON.parse(h.calls.at(-1).request.content).schemaVersion, 2);
  h.set('sceneActor0UseProjection', false, 'change'); assert.equal(h.element('sceneCreateSave').disabled, true); assert.equal(h.element('sceneActor0Speed').disabled, false);
  h.set('sceneActor0Speed', '0'); await h.preview(); const explicit = JSON.parse(h.calls.at(-1).request.content).actors[0];
  assert.equal(explicit.instanceId, instanceId); assert.equal(explicit.objectId, ids[1]);
  assert.equal(explicit.useProjectionDefaults, undefined); assert.equal(explicit.speed, 0); assert.deepEqual(explicit.size, [80, 80]); assert.equal(explicit.imageResourceId, assetId);
  h.set('sceneActor0UseProjection', true, 'change'); assert.equal(h.element('sceneActor0Speed').value, '250');
});

test('all projection dialog and built-in template messages are translated into English and Japanese', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-object-projection.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:'([^'\n]*[\p{Script=Han}][^'\n]*)'|data-i18n="([^"\n]+)")/gu)].map(match => match[1] || match[2]);
  for (const template of getProjectionTemplates()) keys.push(template.label, ...template.fields.map(field => field.label));
  for (const key of keys) { assert.equal(typeof en[key], 'string', `English: ${key}`); assert.equal(typeof ja[key], 'string', `Japanese: ${key}`); }
});

test('World edits scalar projection configuration without exposing locked identity, snapshot or image targets', async () => {
  const h = await harness({ worldBrowser: true }); h.element('worldProjectionList').querySelectorAll('button')[0].click();
  const inspector = h.element('worldInspector');
  assert.equal(inspector.querySelector('[aria-label="修改属性：sourceObjectId"]'), null);
  assert.equal(inspector.querySelector('[aria-label="修改属性：template"]'), null);
  assert.equal(inspector.querySelector('[aria-label="修改属性：图片"]'), null);
  const edit = inspector.querySelector('[aria-label="修改属性：生命值"]'); assert.ok(edit); edit.click();
  h.set('worldPropertyValue', '-1'); h.element('worldPropertyPreview').click();
  assert.equal(h.calls.at(-1).request.command, 'property.set');
  h.calls.at(-1).reject(Object.assign(new Error('Invalid health'), { payload: { errorCode: 'world_projection_invalid', diagnostics: [{ propertyPath: '/configuration/health' }] } })); await flushDialogs();
  assert.match(h.element('worldPropertyMessage').textContent, /投影配置无效/); assert.equal(h.element('worldPropertyValue').value, '-1');
  assert.equal(h.element('worldPropertyApply').disabled, true);
});

test('World projection creation refreshes to the saved object and releases busy controls immediately', async () => {
  const h = await harness({ worldBrowser: true }); h.element('worldProjectionCreate').click(); await flushDialogs(); await h.preview();
  const request = h.calls.at(-1).request, content = JSON.parse(request.content), next = structuredClone(h.world);
  next.objects.push({ ...next.objects[1], id: request.objectId, name: content.title, documentRefs: [{ sourcePath: request.sourcePath }],
    provenance: { ...next.objects[1].provenance, authoredProjection: { sourceObjectId: ids[0], template: content.template, configuration: content.configuration } } });
  h.setWorld(next); h.element('objectProjectionForm').requestSubmit(); h.calls.at(-1).resolve({ status: 'applied', object: { id: request.objectId }, changes: [{ sourcePath: request.sourcePath }] }); await flushDialogs();
  h.element('objectProjectionClose').click(); await flushDialogs(); assert.equal(h.current.busy, false);
  assert.equal(h.element('worldProjectionSource').disabled, false); h.element('worldProjectionSource').click(); assert.equal(h.element('worldProjectionList').querySelectorAll('button').length, 4);
  h.element('worldProjectionCreate').click(); await flushDialogs(); assert.equal(h.element('objectProjectionPath').value, 'documents/projections/new-projection-2.json');
});

test('generic projection image fields accept GIF and large images while Scene2D mappings retain runtime limits', async () => {
  const world = await fixture(), gifId = 'ffffffff-ffff-4fff-8fff-ffffffffffff', largeId = '11111111-1111-4111-8111-111111111111';
  world.resources.push({ id: gifId, availability: 'present-unverified', descriptor: { kind: 'image', name: 'Animated portrait', location: { path: 'portrait.gif' }, content: { sha256: 'b'.repeat(64), size: 100 } } },
    { id: largeId, availability: 'present-unverified', descriptor: { kind: 'image', name: 'Large illustration', location: { path: 'large.png' }, content: { sha256: 'b'.repeat(64), size: 40 * 1024 * 1024 } } });
  const h = await harness({ world });
  assert.equal(h.element('objectProjectionField-image').children.some(option => [gifId, largeId].includes(option.value)), false);
  h.set('objectProjectionTemplate', 'builtin:org.viento.projection.visual-novel', 'change');
  assert.equal(h.element('objectProjectionField-image').children.some(option => option.value === gifId), true);
  assert.equal(h.element('objectProjectionField-image').children.some(option => option.value === largeId), true);
  h.set('objectProjectionField-image', gifId, 'change'); await h.preview(); assert.equal(JSON.parse(h.calls.at(-1).request.content).configuration.image, gifId);
  h.set('objectProjectionTemplate', 'builtin:org.viento.projection.rpg-player', 'change'); h.set('objectProjectionField-image', gifId, 'change');
  h.element('objectProjectionCheck').click(); assert.equal(h.calls.length, 1); assert.match(h.element('objectProjectionDiagnostics').textContent, /configuration\/image/);
});

test('projection summaries localize title, control enums and booleans while edits keep raw contract values', async () => {
  const h = await harness({ worldBrowser: true }); h.element('worldProjectionList').querySelectorAll('button')[1].click();
  const rows = () => h.element('worldInspector').querySelector('table').querySelectorAll('tr');
  assert.ok(rows().some(row => row.children[0].textContent === '标题'));
  assert.equal(rows().find(row => row.children[0].textContent === '移动控制').children[1].textContent, '不接受输入');
  assert.equal(rows().find(row => row.children[0].textContent === '可交互').children[1].textContent, '是');
  h.element('worldInspector').querySelector('[aria-label="修改属性：移动控制"]').click(); assert.equal(h.element('worldPropertyValue').value, 'none');
  h.element('worldPropertyCancel').click(); h.setLanguage('en');
  assert.equal(rows().find(row => row.children[0].textContent === en['移动控制']).children[1].textContent, 'No input');
  assert.equal(rows().find(row => row.children[0].textContent === en['可交互']).children[1].textContent, 'Yes');
  h.element('worldInspector').querySelector(`[aria-label="${en['修改属性：{0}'].replace('{0}', en['可交互'])}"]`).click(); assert.equal(h.element('worldPropertyValue').value, 'true');
});

function editedWorld(world, request) {
  const next = structuredClone(world), content = JSON.parse(request.content), object = next.objects.find(item => item.id === request.objectId);
  object.name = content.title;
  object.provenance.authoredProjection = { sourceObjectId: content.sourceObjectId, template: content.template, configuration: content.configuration };
  object.revision = `sha256:${'1'.repeat(64)}`; object.documentRefs[0].sourceRevision = `sha256:${'2'.repeat(64)}`; next.world.revision = `sha256:${'3'.repeat(64)}`;
  return next;
}

test('projection editing loads current values and submits only title/config changes with locked identity, template and source versions', async () => {
  const h = await harness({ edit: true, objectId: ids[2], version: 2 }), object = h.world.objects.find(item => item.id === ids[2]);
  assert.equal(h.element('objectProjectionName').value, 'Shopkeeper');
  assert.equal(h.element('objectProjectionField-image').value, assetId); assert.equal(h.element('objectProjectionField-speed').value, '0');
  assert.equal(h.element('objectProjectionReuseHint').hidden, true); assert.equal(h.element('objectProjectionRetention').hidden, false);
  for (const id of ['objectProjectionIdentity', 'objectProjectionTemplate', 'objectProjectionType', 'objectProjectionPath']) assert.equal(h.element(id).readOnly, true, id);
  assert.equal(h.element('objectProjectionTemplate').tagName, 'INPUT');
  h.set('objectProjectionPath', 'documents/hijack.json'); h.set('objectProjectionType', 'unknown'); h.set('objectProjectionTemplate', 'fake', 'change');
  h.set('objectProjectionName', 'Revised shopkeeper'); h.set('objectProjectionField-health', '0'); h.set('objectProjectionField-interactable', false, 'change');
  h.set('objectProjectionField-image', '', 'change'); await h.preview();
  const request = h.calls[0].request, content = JSON.parse(request.content);
  assert.deepEqual(Object.keys(request).sort(), ['command', 'mode', 'worldId', 'baseRevision', 'actorRef', 'objectId', 'objectRevision', 'sourceRevision', 'content'].sort());
  assert.equal(request.command, 'projection.update'); assert.equal(request.objectId, ids[2]); assert.equal(request.objectRevision, object.revision); assert.equal(request.sourceRevision, object.documentRefs[0].sourceRevision);
  assert.equal(content.sourceObjectId, ids[0]); assert.deepEqual(content.template, object.provenance.authoredProjection.template);
  assert.equal(content.title, 'Revised shopkeeper'); assert.equal(content.configuration.health, 0); assert.equal(content.configuration.interactable, false); assert.equal(content.configuration.image, '');
  h.element('objectProjectionForm').requestSubmit(); assert.equal(h.calls[1].request.content, request.content); assert.equal(h.calls[1].request.objectRevision, request.objectRevision);
  h.calls[1].resolve({ status: 'applied' }); await flushDialogs(); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false'); assert.match(h.element('objectProjectionMessage').textContent, /配置已保存/);
});

test('projection editing keeps the template lock frozen, invalidates changed previews and shows the server-preserved source', async () => {
  const h = await harness({ edit: true }); h.set('objectProjectionField-speed', '500'); await h.preview();
  h.set('objectProjectionField-image', '', 'change'); assert.equal(h.element('objectProjectionSave').disabled, true);
  h.set('objectProjectionField-speed', ''); h.element('objectProjectionCheck').click(); assert.equal(h.calls.length, 1);
  h.set('objectProjectionField-speed', '0'); h.element('objectProjectionCheck').click(); await flushDialogs();
  h.calls.at(-1).resolve({ status: 'preview', changes: [{ afterText: '{ "preserved source layout": true }\r\n' }] }); await flushDialogs();
  assert.equal(h.element('objectProjectionContent').textContent, '{ "preserved source layout": true }\r\n');
  assert.deepEqual(JSON.parse(h.calls.at(-1).request.content).template, JSON.parse(h.calls[0].request.content).template);
  h.element('objectProjectionForm').requestSubmit(); h.calls.at(-1).resolve({ status: 'unchanged' }); await flushDialogs();
  assert.equal(h.element('objectProjectionSave').disabled, true); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false');
});

test('edit conflicts and failed reloads preserve draft values and require a new preview with refreshed revisions', async () => {
  const h = await harness({ edit: true }); h.set('objectProjectionName', 'Keep this draft'); await h.preview();
  h.element('objectProjectionForm').requestSubmit(); h.calls.at(-1).reject(Object.assign(new Error('conflict'), { payload: { errorCode: 'world_revision_conflict' } })); await flushDialogs();
  assert.equal(h.element('objectProjectionCheck').disabled, true); assert.equal(h.element('objectProjectionName').value, 'Keep this draft');
  h.failRead(new Error('offline')); h.element('objectProjectionRefresh').click(); await flushDialogs(); assert.equal(h.element('objectProjectionSave').disabled, true);
  const next = structuredClone(h.world), object = next.objects.find(item => item.id === ids[1]);
  object.revision = `sha256:${'4'.repeat(64)}`; object.documentRefs[0].sourceRevision = `sha256:${'5'.repeat(64)}`; object.name = 'Changed externally'; next.world.revision = `sha256:${'6'.repeat(64)}`;
  h.setWorld(next); h.element('objectProjectionRefresh').click(); await flushDialogs(); await h.preview();
  assert.equal(h.calls.at(-1).request.objectRevision, object.revision); assert.equal(h.calls.at(-1).request.sourceRevision, object.documentRefs[0].sourceRevision);
  assert.equal(JSON.parse(h.calls.at(-1).request.content).title, 'Keep this draft'); assert.equal(h.calls.length, 3);
});

test('an uncertain edit cannot be mistaken for success just because its existing object is found', async () => {
  const h = await harness({ edit: true }); h.set('objectProjectionField-speed', '500'); await h.preview();
  h.element('objectProjectionForm').requestSubmit(); h.calls.at(-1).reject(new Error('lost reply')); await flushDialogs();
  assert.equal(h.element('objectProjectionFields').disabled, true); assert.equal(h.element('objectProjectionSave').disabled, true);
  h.failRead(new Error('still offline')); h.element('objectProjectionRefresh').click(); await flushDialogs(); assert.equal(h.element('objectProjectionFields').disabled, true);
  h.element('objectProjectionRefresh').click(); await flushDialogs(); assert.equal(h.calls.length, 2);
  assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'true'); assert.equal(h.element('objectProjectionField-speed').value, '500');
  assert.equal(h.element('objectProjectionCheck').disabled, false); assert.equal(h.element('objectProjectionSave').disabled, true);
  assert.match(h.element('objectProjectionMessage').textContent, /与上次提交不同/);
  await h.preview(); assert.equal(h.calls.at(-1).request.objectId, ids[1]); assert.equal(JSON.parse(h.calls.at(-1).request.content).configuration.speed, 500);
});

test('an uncertain edit reconciles matching persisted content as success and refreshes without resubmitting', async () => {
  const receipts = [], h = await harness({ edit: true, applied: async result => receipts.push(result) });
  h.set('objectProjectionField-image', '', 'change'); h.set('objectProjectionName', 'Verified save'); await h.preview(); h.element('objectProjectionForm').requestSubmit();
  const request = h.calls.at(-1).request; h.calls.at(-1).reject(new Error('reply lost after commit')); await flushDialogs();
  h.setWorld(editedWorld(h.world, request)); h.element('objectProjectionRefresh').click(); await flushDialogs();
  assert.equal(h.calls.length, 2); assert.equal(receipts.length, 1); assert.equal(receipts[0].object.id, ids[1]); assert.equal(receipts[0].changes[0].kind, 'projection.update');
  assert.match(h.element('objectProjectionMessage').textContent, /已核对/); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false');
  h.element('objectProjectionForm').requestSubmit(); assert.equal(h.calls.length, 2); assert.equal(h.element('objectProjectionSave').disabled, true);
});

test('changed immutable template or source location never silently rebases an existing projection draft', async () => {
  for (const change of [object => { object.provenance.authoredProjection.template.version = '9.0.0'; }, object => { object.documentRefs[0].sourcePath = 'documents/moved.json'; }, object => { object.provenance.authoredProjection.sourceObjectId = ids[2]; }]) {
    const h = await harness({ edit: true }); h.set('objectProjectionName', 'Keep draft'); await h.preview();
    const next = structuredClone(h.world); change(next.objects.find(item => item.id === ids[1])); h.setWorld(next);
    h.element('objectProjectionRefresh').click(); await flushDialogs(); assert.equal(h.element('objectProjectionName').value, 'Keep draft');
    assert.equal(h.element('objectProjectionCheck').disabled, true); assert.equal(h.element('objectProjectionSave').disabled, true);
    assert.match(h.element('objectProjectionMessage').textContent, /来源、模板或位置已变化/);
  }
});

test('edit drafts preserve language, caret and cancellation guards, while successful refresh errors cannot repeat the update', async () => {
  const h = await harness({ edit: true, applied: async () => { throw new Error('index unavailable'); } });
  h.set('objectProjectionName', '編集した名前'); const name = h.element('objectProjectionName'); name.focus(); name.selectionStart = 1; name.selectionEnd = 4; h.setLanguage('ja');
  assert.equal(h.element('objectProjectionName').value, '編集した名前'); assert.equal(h.document.activeElement.selectionStart, 1); assert.equal(h.element('objectProjectionPath').readOnly, true);
  h.runtime.window.confirm = () => false; h.element('objectProjectionDialog').dispatch('cancel'); assert.equal(h.element('objectProjectionDialog').open, true);
  await h.preview(); h.element('objectProjectionForm').requestSubmit(); h.element('objectProjectionClose').click(); assert.equal(h.element('objectProjectionDialog').open, true);
  h.calls.at(-1).resolve({ status: 'applied' }); await flushDialogs(); assert.equal(h.element('objectProjectionDialog').dataset.dirty, 'false');
  assert.equal(h.element('objectProjectionMessage').textContent, ja['投影配置已保存，但目录刷新失败。请刷新核对，勿重复提交。']);
  h.element('objectProjectionForm').requestSubmit(); assert.equal(h.calls.length, 2); h.element('objectProjectionClose').click(); assert.equal(h.element('objectProjectionDialog').open, false);
});

test('World edit entry requires projection.update and selects the same identity after saving', async () => {
  const h = await harness({ worldBrowser: true }); h.element('worldProjectionList').querySelectorAll('button')[0].click();
  assert.ok(h.element('worldProjectionEdit')); h.element('worldProjectionEdit').click(); await flushDialogs();
  assert.equal(h.element('objectProjectionIdentity').value, ids[1]); h.set('objectProjectionName', 'World updated title'); await h.preview();
  const next = editedWorld(h.world, h.calls.at(-1).request); h.setWorld(next); h.element('objectProjectionForm').requestSubmit();
  h.calls.at(-1).resolve({ status: 'applied', object: next.objects.find(object => object.id === ids[1]), changes: [{ kind: 'projection.update', sourcePath: 'documents/projections/0.json' }] }); await flushDialogs();
  h.element('objectProjectionClose').click(); await flushDialogs(); assert.equal(h.element('worldObjectName').textContent, 'World updated title'); assert.equal(h.element('worldProjectionEdit').disabled, false);
  assert.equal(h.document.activeElement, h.element('worldProjectionEdit')); assert.equal(h.current.busy, false);
  h.controller.setAvailable(true, ['property.set', 'projection.create']); h.element('worldRefresh').click(); await flushDialogs(); assert.equal(h.element('worldProjectionEdit'), null);
  const without = await harness({ edit: true, commands: ['projection.create'] }); assert.equal(without.element('objectProjectionDialog').open, false);
});
