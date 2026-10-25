import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { physics2dPureFixture, id, revision } from './helpers/world-physics2d-create-pure-fixture.mjs';
import { createScenePhysics2DCreationDraft } from '../../engine/scene-physics2d-create-plan.mjs';
import { captureScenePhysics2DCreationContext, createScenePhysics2DCreationRequest, validateScenePhysics2DCreationResult, confirmScenePhysics2DCreation } from '../../engine/scene-physics2d-creation-contract.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const bridge = fn => (...args) => fn(...args.map(value => value === undefined ? undefined : copy(value)));
async function settle() { for (let i = 0; i < 4; i++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } }
async function harness(options = {}) {
  const fixture = await physics2dPureFixture(); let capability = options.capability !== false; let catalog = copy(options.catalog || fixture.context), locale = 'zh-CN', uuidCount = 0;
  const context = { editable:true, dirty:false, creating:false, busy:false, visible:true, sceneId:fixture.context.scene.objectId, session:'one', sourceToken:'source-one', ...options.context };
  const requests = [], reads = [], applied = [], opened = [], busy = [], languages = [];
  const h = await dialogHarness('app-scene-physics2d-create', { crypto: { subtle:options.subtle || webcrypto.subtle, randomUUID:() => { uuidCount++; return id(100 + uuidCount); } },
    supportsStudioCoreScenePhysics2DResponse:() => capability,
    createScenePhysics2DCreationDraft:bridge(createScenePhysics2DCreationDraft), captureScenePhysics2DCreationContext:bridge(captureScenePhysics2DCreationContext),
    createScenePhysics2DCreationRequest:bridge(createScenePhysics2DCreationRequest), validateScenePhysics2DCreationResult:bridge(validateScenePhysics2DCreationResult), confirmScenePhysics2DCreation:bridge(confirmScenePhysics2DCreation),
    t:(key,...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_,i) => String(args[i])), onLanguageChange:fn => languages.push(fn) });
  const controller = h.runtime.setupScenePhysics2DCreate({ getContext:() => context, setBusy:value => busy.push(value),
    inspect:payload => { reads.push(copy(payload)); return options.inspect ? options.inspect(payload) : Promise.resolve(copy(catalog)); },
    command:request => { const pending = deferred(); requests.push({request:copy(request), ...pending}); return pending.promise; },
    applied:async (...args) => { applied.push(args); await options.applied?.(...args); },
    openSource:async (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(options.enabled !== false, options.commands || ['physics2d.create']);
  const el = suffix => h.element('scenePhysics2DCreate' + suffix), click = suffix => el(suffix).click();
  const set = (suffix,value,event='input') => { el(suffix).value = value; el(suffix).dispatch(event); };
  const receipt = async request => {
    const result = copy((await fixture.run({...request,mode:'preview'})).result);
    if (request.mode === 'apply') { result.status = 'applied'; result.receipt = {format:'viento-transaction-receipt',schemaVersion:1,transactionId:id(999),worldId:request.worldId,
      proposalId:result.proposal.id,baseRevision:request.baseRevision,revision:result.revision,state:'committed'}; }
    return result;
  };
  const markCreated = async request => {
    const result = await receipt(request), record = result.changes[0].record;
    catalog = {...copy(fixture.context),status:'ready',baseRevision:result.revision,
      scene:{...fixture.context.scene,objectRevision:result.scene.revision},manifest:{objectId:request.objectId,objectRevision:result.object.revision,sourcePath:request.sourcePath,sourceRevision:revision(request.content),
      documentType:request.documentType,parserProfile:record.parserProfile,content:request.content,relations:record.relations,assetBindings:record.assetBindings,bodyCount:JSON.parse(request.content.replace(/^\uFEFF/,'')).bodies.length}};
    return result;
  };
  const review = async () => { click('Check'); await settle(); const pending = requests.at(-1); assert.ok(pending,'review command issued'); pending.resolve(await receipt(pending.request)); await settle(); };
  return {...h,el,click,set,controller,context,fixture,requests,reads,applied,opened,busy,receipt,markCreated,review,
    open:async()=>{const opened=controller.open(context.sceneId);await settle();return opened;},getCatalog:()=>copy(catalog),setCatalog:value=>{catalog=copy(value);},uuidCount:()=>uuidCount,
    language:value=>{locale=value;languages.forEach(fn=>fn());}, capability:value=>{capability=value;languages.forEach(fn=>fn());}};
}



test('default stop creation retains the legacy schema and exact seven body fields', async t => {
  const h = await harness(); t.after(() => h.controller.dispose()); await h.open(); assert.equal(h.el('Response').value, 'stop'); await h.review();
  const document = JSON.parse(h.requests[0].request.content); assert.equal(document.schemaVersion, 1); assert.equal(Object.hasOwn(document.bodies[0], 'collisionResponse'), false); assert.equal(Object.keys(document.bodies[0]).length, 7);
});
test('slide creation reviews schema2 and persists the same body and document identities', async t => {
  const h = await harness(); t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'slide', 'change'); await h.review();
  const request = h.requests[0].request, value = JSON.parse(request.content); assert.equal(value.schemaVersion, 2); assert.equal(value.bodies[0].collisionResponse, 'slide'); assert.equal(h.applied.length, 0);
  h.click('Save'); await settle(); const write = h.requests[1]; assert.equal(write.request.content, request.content); assert.equal(write.request.objectId, request.objectId); write.resolve(await h.markCreated(write.request)); await settle(); assert.equal(h.applied.length, 1);
});
test('static and sensor creation omit a temporarily hidden slide choice and restore it for characters', async t => {
  for (const kind of ['static', 'sensor']) {
    const h = await harness(); t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'slide', 'change'); h.set('Kind', kind, 'change'); assert.equal(h.el('ResponseField').hidden, true); assert.equal(h.el('Response').disabled, true);
    await h.review(); assert.equal(JSON.parse(h.requests[0].request.content).schemaVersion, 1); assert.equal(Object.hasOwn(JSON.parse(h.requests[0].request.content).bodies[0], 'collisionResponse'), false);
    h.set('Kind', 'character', 'change'); assert.equal(h.el('Response').value, 'slide'); await h.review(); assert.equal(JSON.parse(h.requests[1].request.content).bodies[0].collisionResponse, 'slide');
  }
});
test('unsupported response capability preserves stop creation and refuses forged slide input', async t => {
  const h = await harness({ capability: false }); t.after(() => h.controller.dispose()); await h.open(); assert.equal(h.el('Response').disabled, true); assert.equal(h.el('Width').disabled, false);
  h.set('Response', 'slide', 'change'); h.click('Check'); await settle(); assert.equal(h.requests.length, 0); h.set('Response', 'stop', 'change'); await h.review(); assert.equal(JSON.parse(h.requests[0].request.content).schemaVersion, 1);
});
test('response changes revoke reviewed creation and invalid tokens never issue commands', async t => {
  const h = await harness(); t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'bounce', 'change'); h.click('Check'); await settle(); assert.equal(h.requests.length, 0);
  h.set('Response', 'slide', 'change'); await h.review(); h.el('Response').value = 'stop'; h.click('Save'); await settle(); assert.equal(h.requests.length, 1); assert.equal(h.applied.length, 0);
});
test('three languages keep the selected response review identities and focused node intact', async t => {
  const h = await harness(); t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'slide', 'change'); await h.review(); const select = h.el('Response'), source = h.el('SourceText').textContent; select.focus();
  for (const language of ['en', 'ja', 'zh-CN']) { h.language(language); assert.equal(h.el('Response'), select); assert.equal(select.value, 'slide'); assert.equal(h.document.activeElement, select); assert.equal(h.el('SourceText').textContent, source); assert.equal(h.el('Save').disabled, false); }
  assert.equal(h.uuidCount(), 2);
});

for (const mode of ['preview', 'apply']) test(`${mode} rechecks slide capability after hashing before publishing any command`, async t => {
  let block = false; const gate = deferred();
  const h = await harness({ subtle: { async digest(...args) { if (block) await gate.promise; return webcrypto.subtle.digest(...args); } } });
  t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'slide', 'change');
  if (mode === 'apply') await h.review();
  const count = h.requests.length; block = true; h.click(mode === 'apply' ? 'Save' : 'Check'); await settle(); assert.equal(h.requests.length, count);
  h.capability(false); gate.resolve(); await settle();
  assert.equal(h.requests.length, count); assert.equal(h.applied.length, 0); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Response').value, 'slide');
  assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'false'); assert.match(h.el('Status').textContent, /不支持角色滑动/);
  block = false; h.capability(true); await h.review(); assert.equal(h.requests.length, count + 1); assert.equal(h.el('Save').disabled, false);
});
test('legacy stop preview and apply remain available when optional response capability disappears during hashing', async t => {
  for (const mode of ['preview', 'apply']) {
    let block = false; const gate = deferred();
    const h = await harness({ subtle: { async digest(...args) { if (block) await gate.promise; return webcrypto.subtle.digest(...args); } } });
    t.after(() => h.controller.dispose()); await h.open(); if (mode === 'apply') await h.review();
    const count = h.requests.length; block = true; h.click(mode === 'apply' ? 'Save' : 'Check'); await settle(); h.capability(false); gate.resolve(); await settle();
    assert.equal(h.requests.length, count + 1); const pending = h.requests.at(-1); assert.equal(JSON.parse(pending.request.content).schemaVersion, 1);
    pending.resolve(mode === 'apply' ? await h.markCreated(pending.request) : await h.receipt(pending.request)); await settle();
    assert.equal(mode === 'apply' ? h.el('Open').disabled : h.el('Save').disabled, false);
  }
});
test('a published slide write is still confirmed after optional capability loss without resending it', async t => {
  const h = await harness(); t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'slide', 'change'); await h.review();
  h.click('Save'); await settle(); assert.equal(h.requests.length, 2); const pending = h.requests[1]; h.capability(false);
  pending.resolve(await h.markCreated(pending.request)); await settle(); assert.equal(h.applied.length, 1); assert.equal(h.requests.length, 2);
  assert.equal(h.el('Open').disabled, false); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});
