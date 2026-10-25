import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/tests/dialog-harness.mjs';
import { deferred } from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/tests/editor-harness.mjs';
import { physics2dPureFixture, id, revision } from 'file:///home/chiharukiryu/cdev/viento-studio/scripts/tests/helpers/world-physics2d-create-pure-fixture.mjs';
import { createScenePhysics2DCreationDraft } from 'file:///home/chiharukiryu/cdev/viento-studio/engine/scene-physics2d-create-plan.mjs';
import { captureScenePhysics2DCreationContext, createScenePhysics2DCreationRequest, validateScenePhysics2DCreationResult, confirmScenePhysics2DCreation } from 'file:///home/chiharukiryu/cdev/viento-studio/engine/scene-physics2d-creation-contract.mjs';
import en from 'file:///home/chiharukiryu/cdev/viento-studio/web/i18n/en.js';
import ja from 'file:///home/chiharukiryu/cdev/viento-studio/web/i18n/ja.js';
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




test('review reproduction: no slide creation command after optional core capability disappears during digest', async t => {
  let block = false; const gate = deferred();
  const h = await harness({subtle:{ async digest(...args) { if (block) await gate.promise; return webcrypto.subtle.digest(...args); } }});
  t.after(() => h.controller.dispose()); await h.open(); h.set('Response', 'slide', 'change'); await h.review();
  block = true; h.click('Save'); await settle(); assert.equal(h.requests.length, 1);
  h.capability(false); gate.resolve(); await settle();
  assert.equal(h.requests.length, 1, 'capability loss must revoke apply before publishing command');
});
