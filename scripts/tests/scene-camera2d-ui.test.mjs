import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { inspectSceneCamera2DDocument } from '../../engine/scene-camera2d.mjs';
import { validateWorldCommand } from '../../engine/world-command-contract.mjs';
import { makeRequestError } from '../../web/modules/app-services.js';
import { editSceneCamera2DSource } from '../../engine/scene-camera2d-edit.mjs';
const id = n => `99999999-9999-4999-8999-${String(n).padStart(12,'0')}`;
const hash = 'sha256:'+'a'.repeat(64), hash2='sha256:'+'b'.repeat(64);
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject}; };
const settle = async()=>{for(let i=0;i<8;i++)await flushDialogs();};
async function harness({ existing=false,context:overrides={},inspect:customInspect }={}) {
 const context={editable:true,busy:false,dirty:false,creating:false,visible:true,session:'1',sceneId:id(1),sourceToken:'saved',...overrides};
 const value={format:'viento-scene-camera2d',schemaVersion:1,sceneObjectId:id(1),camera:{mode:'fixed',center:[320,240],zoom:1}};
 let catalog={format:'viento-camera2d-author-context',schemaVersion:1,worldId:id(8),baseRevision:hash,documentRoot:'documents',documentTypes:[{id:'character',label:'Actor'},{id:'document',label:'Document'}],
 scene:{objectId:id(1),objectRevision:hash,sourcePath:'documents/scene.json',sourceRevision:hash,viewport:[640,480]},targets:[{instanceId:id(2),objectId:id(3),name:'Shared OC'},{instanceId:id(4),objectId:id(3),name:'Shared OC'}],
 manifest:existing?{objectId:id(6),sourcePath:'documents/camera.json',sourceRevision:hash,content:'\ufeff'+JSON.stringify(value,null,'\t').replaceAll('\n','\r\n')+'\r\n'}:null};
 const calls=[],writes=[],notifications=[],busy=[],failure={save:false};let saves=0;
 const h=await dialogHarness('app-scene-camera2d',{inspectSceneCamera2DDocument,editSceneCamera2DSource,crypto:{randomUUID:()=>id(6)}});
 const editor=h.runtime.setupSceneCamera2D({getContext:()=>context,inspect:async()=>customInspect?customInspect():structuredClone(catalog),
 command:async payload=>{validateWorldCommand(JSON.parse(JSON.stringify(payload)));calls.push(structuredClone(payload));if(payload.mode==='preview')return{status:'preview',worldId:catalog.worldId,baseRevision:catalog.baseRevision};return save(payload);},
 request:async payload=>{writes.push(structuredClone(payload));return save(payload);},setBusy:value=>busy.push(value),applied:async result=>{notifications.push(result);context.sourceToken='own-save';}});
 async function save(payload) {saves++;if(failure.save)throw failure.save===true?Error('Lost response'):failure.save;catalog={...catalog,baseRevision:hash2,manifest:{objectId:id(6),sourcePath:payload.sourcePath||catalog.manifest.sourcePath,sourceRevision:hash2,content:payload.content}};return{status:'applied'};}
 editor.setAvailable(true,['camera2d.create']);const el=name=>h.element('sceneCamera2D'+name);
 return{...h,editor,context,calls,writes,notifications,busy,failure,el,set:(name,value)=>{el(name).value=value;el(name).dispatch('input');},click:name=>el(name).click(),open:async()=>{const result=editor.open(id(1));await settle();return result;},catalog:()=>catalog,setCatalog:next=>{catalog=next;},saves:()=>saves};
}
test('camera form requires a clean visible owner and its explicit capability',async()=>{
 for(const context of [{dirty:true},{editable:false},{busy:true},{visible:false},{creating:true}]){const h=await harness({context});assert.equal(await h.open(),false);}
 const h=await harness();h.editor.setAvailable(true,[]);assert.equal(await h.open(),false);h.editor.setAvailable(true,['camera2d.create']);assert.equal(await h.open(),true);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Cancel').disabled,false);
});
test('new fixed camera reviews exact source and applies once through the world transaction port',async()=>{
 const h=await harness();await h.open();h.click('Check');await settle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].mode,'preview');assert.equal(h.calls[0].documentType,'document');assert.equal(h.el('Save').disabled,false);
 assert.deepEqual(JSON.parse(h.calls[0].content).camera,{mode:'fixed',center:[320,240],zoom:1});
 h.click('Save');h.click('Save');await settle();assert.equal(h.calls.length,2);assert.equal(h.calls[1].mode,'apply');assert.equal(h.calls[1].content,h.calls[0].content);assert.equal(h.notifications.length,1);assert.equal(h.el('Dialog').dataset.dirty,'false');assert.equal(h.writes.length,0);
});
test('existing follow camera targets stable instance identities and preserves surrounding source bytes',async()=>{
 const h=await harness({existing:true});await h.open();const before=h.catalog().manifest.content;
 h.set('Mode','follow');h.set('Target',id(4));h.set('X','-20');h.set('Y','15');h.set('Zoom','2');h.click('Check');await settle();assert.equal(h.calls.length,0);h.click('Save');await settle();
 assert.equal(h.writes.length,1);const request=h.writes[0];assert.equal(request.documentId,id(6));assert.equal(request.expectedVersion,hash);assert.ok(request.content.startsWith('\ufeff'));assert.ok(request.content.endsWith('\r\n'));assert.equal(request.content.slice(0,request.content.indexOf('"camera"')),before.slice(0,before.indexOf('"camera"')));
 assert.deepEqual(JSON.parse(request.content.slice(1)).camera,{mode:'follow',targetInstanceId:id(4),offset:[-20,15],zoom:2});
});
test('camera review is revoked by silent edits, invalid numbers and stale source ownership',async()=>{
 for(const invalid of ['', 'NaN', 'Infinity','0','9']){const h=await harness();await h.open();h.set('Zoom',invalid);h.click('Check');await settle();assert.equal(h.calls.length,0);assert.equal(h.el('Save').disabled,true);}
 const h=await harness({existing:true});await h.open();h.set('X','90');h.click('Check');await settle();h.el('Zoom').value='2';h.click('Save');await settle();assert.equal(h.writes.length,0);
 h.click('Check');await settle();h.context.sourceToken='elsewhere';h.click('Save');await settle();assert.equal(h.writes.length,0);
});
test('camera cancel writes nothing and an uncertain save never resubmits automatically',async()=>{
 const h=await harness();await h.open();h.set('X','90');h.click('Cancel');await settle();assert.equal(h.el('Dialog').open,false);assert.equal(h.calls.length,0);
 const other=await harness({existing:true});await other.open();other.failure.save=true;other.set('X','90');other.click('Check');await settle();other.click('Save');await settle();other.click('Save');other.click('Refresh');await settle();assert.equal(other.writes.length,1);assert.equal(other.notifications.length,0);assert.equal(other.el('Save').disabled,true);assert.equal(other.el('Dialog').dataset.dirty,'true');
});
test('late camera catalogs cannot populate another scene or a closed view',async()=>{
 const wait=deferred(),h=await harness({inspect:()=>wait.promise});const opening=h.editor.open(id(1));h.context.sceneId=id(7);wait.resolve(h.catalog());await opening;assert.equal(h.el('Save').disabled,true);assert.equal(h.calls.length,0);
});

test('a known source conflict preserves the form and requires a fresh explicit review',async()=>{
 const h=await harness({existing:true});await h.open();h.set('X','90');h.click('Check');await settle();
 h.failure.save=makeRequestError({status:409,statusText:'Conflict',headers:{get:()=>null}}, {errorCode:'scene_camera2d_document_conflict'}, 'Save camera');h.click('Save');await settle();
 assert.equal(h.writes.length,1);assert.equal(h.el('X').value,'90');assert.equal(h.el('Check').disabled,false);assert.equal(h.el('Save').disabled,true);
 h.failure.save=false;h.click('Check');await settle();assert.equal(h.el('Save').disabled,false);h.click('Save');await settle();assert.equal(h.writes.length,2);assert.equal(h.notifications.length,1);
});
test('unchanged camera settings produce no source write or save ticket',async()=>{
 const h=await harness({existing:true});await h.open();h.click('Check');await settle();h.click('Save');await settle();assert.equal(h.writes.length,0);assert.equal(h.el('Save').disabled,true);assert.equal(h.el('Dialog').dataset.dirty,'false');
});

test('a known creation path conflict preserves inputs for an explicit new-location review',async()=>{
 const h=await harness();await h.open();h.set('X','90');h.click('Check');await settle();
 h.failure.save=makeRequestError({status:409,statusText:'Conflict',headers:{get:()=>null}},{errorCode:'world_create_path_conflict'},'Create camera');
 h.click('Save');await settle();assert.equal(h.calls.length,2);assert.equal(h.el('X').value,'90');assert.equal(h.el('Check').disabled,false);
 h.failure.save=false;h.set('Path','documents/cameras/another.json');h.click('Check');await settle();h.click('Save');await settle();assert.equal(h.calls.length,4);assert.equal(h.notifications.length,1);
});
