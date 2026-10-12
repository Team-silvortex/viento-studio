// Independent real-controller VM guard probe. Injected semantic/source ports
// make this an ownership/UI proof, not native numeric patch or browser proof.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
const root = new URL('../../../', import.meta.url);
const copy = value => JSON.parse(JSON.stringify(value));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const content = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const original = JSON.parse(content), model = { ...original, format: 'viento-scene3d-model' };
const uiSource = await fs.readFile(new URL('web/modules/app-scene3d-transforms.js', root), 'utf8');
const checks = [];
const assert = (condition, detail) => { if (!condition) throw Error(detail); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const settle = async () => { await flushDialogs(); await flushDialogs(); };
async function fixture(options = {}) {
  const context = {editable:true,creating:false,busy:false,sourceJSON:true,sourcePath:'documents/scenes/boxes.json',sourceToken:'owner:1'};
  const submitted = []; let focuses=0, supported=true, factoryCalls=0;
  const source = () => ({content,sourcePath:context.sourcePath,token:context.sourceToken,baseSourceRevision:`sha256:${hash(content)}`,sourceRevision:`sha256:${hash(content)}`});
  const h = await dialogHarness('app-scene3d-transforms', {
    supportsStudioCoreScene3DPatch: () => supported,
    parseScene3DSource: () => ({model:copy(model),sourceLocations:{objects:[]}}),
    createScene3DTransformProposal(snapshot, edit) {
      factoryCalls++;
      const before = copy(original), after = copy(original), index = after.objects.findIndex(x=>x.instanceId===edit.instanceId);
      Object.assign(after.objects[index],copy(edit.values));
      return {kind:'scene3d-transform',sourcePath:snapshot.sourcePath,sourceToken:snapshot.token,instanceId:edit.instanceId,beforeContent:content,afterContent:JSON.stringify(after),changedPaths:[`/objects/${index}/position/0`],beforeObject:before.objects[index],afterObject:after.objects[index]};
    }, t: x=>x,translatePage(){},onLanguageChange(){return ()=>{}}, queueMicrotask,
  });
  const controller = h.runtime.setupScene3DTransforms({getContext:()=>context,getSource:()=>options.source?.(source()) ?? source(),applyDraft:async (proposal,guard)=>{
    submitted.push({proposal,guard});
    if (options.apply) return options.apply(proposal,guard,context);
    context.sourceToken='owner:2';
    return {applied:true,sourcePath:context.sourcePath,sourceToken:context.sourceToken,content:proposal.afterContent,focus(){focuses++}};
  }});
  const el = suffix=>h.element('scene3dTransforms'+suffix);
  return {...h,context,controller,el,submitted,setSupported(v){supported=v},focuses:()=>focuses,factoryCalls:()=>factoryCalls,async prepare(){assert(await controller.open(),'open rejected');el('PositionSelected').checked=true;el('PositionSelected').dispatch('change');el('PositionX').value='5';el('PositionX').dispatch('input');}};
}
async function check(id,run) {try {await run();checks.push({id,ok:true});} catch(e) {checks.push({id,ok:false,message:e.message});}}
await check('silent-valid-selection-before-review-never-approves-other-displayed-object',async()=>{
 const h=await fixture();try {await h.prepare();h.el('Object').value=model.objects[1].instanceId;h.el('Check').click();
  const approved=!h.el('Apply').disabled; if(approved){h.el('Apply').click();await settle();assert(h.submitted[0]?.proposal.instanceId===model.objects[1].instanceId,'approved previous UUID while dropdown displays another valid UUID');}
 }finally{h.controller.dispose();}});
await check('silent-raw-value-after-review-revokes-approval-before-port-call',async()=>{
 const h=await fixture();try{await h.prepare();h.el('Check').click();assert(!h.el('Apply').disabled,'review not approved');h.el('PositionX').value='7';h.el('Apply').click();await settle();assert(h.submitted.length===0,'changed raw input reached apply port');}finally{h.controller.dispose();}});
await check('late-source-response-after-close-does-not-parse-or-reopen',async()=>{
 const d=deferred(),h=await fixture({source:()=>d.promise});try{const opening=h.controller.open();h.controller.close(true);d.resolve({content,sourcePath:h.context.sourcePath,token:h.context.sourceToken});assert(await opening===false,'late source succeeded');assert(!h.el('Dialog').open&&h.factoryCalls()===0,'late dialog reopened');}finally{h.controller.dispose();}});
await check('late-apply-after-close-loses-guard-and-cannot-focus',async()=>{
 const d=deferred(),h=await fixture({apply:()=>d.promise});try{await h.prepare();h.el('Check').click();h.el('Apply').click();assert(h.submitted.length===1,'apply did not start');h.controller.close(true);assert(h.submitted[0].guard.isCurrent()===false,'closed dialog kept mutation guard');d.resolve({applied:true,sourcePath:h.context.sourcePath,sourceToken:'owner:2',content:h.submitted[0].proposal.afterContent,focus(){throw Error('late focus');}});await settle();assert(!h.el('Dialog').open,'late apply reopened');}finally{h.controller.dispose();}});
for(const variant of ['path','content','token']) await check(`forged-${variant}-receipt-keeps-dialog-open`,async()=>{
 const h=await fixture({apply(proposal,guard,context){context.sourceToken='owner:2';return {applied:true,sourcePath:variant==='path'?'documents/scenes/other.json':context.sourcePath,content:variant==='content'?'forged':proposal.afterContent,sourceToken:variant==='token'?'owner:1':context.sourceToken};}});try{await h.prepare();h.el('Check').click();h.el('Apply').click();await settle();assert(h.el('Dialog').open,'forged receipt confirmed/closed dialog');assert(h.focuses()===0,'forged receipt focused');}finally{h.controller.dispose();}});
await check('successful-exact-new-token-receipt-confirms-and-focuses-once',async()=>{
 const h=await fixture();try{await h.prepare();h.el('Check').click();h.el('Apply').click();await settle();assert(!h.el('Dialog').open&&h.focuses()===1,'exact successful receipt not confirmed');}finally{h.controller.dispose();}});
await check('unsupported-new-capability-disables-only-independent-transform-entry',async()=>{
 const h=await fixture();try{h.setSupported(false);h.controller.refresh();assert(h.el('Btn').disabled,'unsupported button enabled');assert(await h.controller.open()===false,'unsupported dialog opened');assert(h.element('projectBuildBtn'),'base editor/build entry removed');}finally{h.controller.dispose();}});
const result={format:'viento-scene3d-transform-independent-ui-boundary',schemaVersion:1,runtime:process.version,sourceSha256:hash(uiSource),scope:'Real controller in DOM VM; injected semantic/source/apply ports. No browser/render/native patch or installed-device claim.',checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length};
const destination=process.argv[2];if(!destination)throw Error('New evidence destination is required');await fs.writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));if(result.failed)process.exitCode=1;
