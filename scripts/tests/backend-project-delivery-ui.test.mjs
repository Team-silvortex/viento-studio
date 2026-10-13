import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { validateBackendProjectManifest } from '../../engine/backend-project.mjs';
import { createBackendProjectDeliveryReview, validateBackendProjectDeliveryReview } from '../../engine/backend-project-delivery.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12,'0')}`, hash = 'a'.repeat(64), revision='sha256:'+hash;
const buildId=id(1),sceneId=id(2),jobId=id(3),backendId='org.viento.bevy';
const clone=value=>JSON.parse(JSON.stringify(value));
const project=()=>validateBackendProjectManifest({format:'viento-backend-project',schemaVersion:1,buildId,snapshotId:revision,
 source:{workspaceId:'world-one',sceneId,sourcePath:'documents/scenes/scene.json',sourceRevision:revision,planKind:'scene2d',planSchemaVersion:2},
 backend:{id:backendId,version:'0.3.0',protocolVersion:2,sha256:hash},executionAdapter:{id:backendId,contractVersion:1,sha256:hash},
 tool:{version:'bevy 0.19.1',sha256:hash,platform:'linux',arch:'x64'},project:{kind:'bevy-scene',root:'project',entry:'project/scene-data.json',requiresTool:true},
 files:[{path:'project/scene-data.json',size:16,sha256:hash,role:'generated',resourceId:null,sourceObjectId:null}],resources:[],
 dependencies:[{objectId:sceneId,sourcePath:'documents/scenes/scene.json',sourceRevision:revision,role:'scene'}],
 evidence:['build.json','snapshot.json','source-map.json'].map(path=>({path,size:32,sha256:hash})),
 lifecycle:{authority:'author-workspace',generatedProject:'derived-read-only',resources:'copies',rebuild:'saved-author-inputs',runtimeCopies:'temporary',persistence:'until-owner-cleanup'}});
const receipt=()=>({project:project(),inspection:{recorded:true,complete:true,manifestSha256:hash,extraPaths:[]},buildDirectory:'/cache/should-not-be-disclosed'});
const owner=()=>({session:1,sceneId,backendId,backendIdentity:'backend-v1',buildId,snapshotId:revision});
const result=()=>({id:jobId,fileName:`viento-${buildId}.viento-build.zip`,bytes:256,documentCount:0,assetCount:0,delivery:createBackendProjectDeliveryReview(project(),hash)});
async function view(options={}) {
 const releases=[],prepares=[],checks=[],downloads=[],requests=[],languages=[];let dictionary={},response=()=>result(),checking=async()=>{},changes=0;
 const state={...owner(),available:true,visible:true,busy:false,...options.context};
 const translate=(key,...args)=>(dictionary[key]||key).replace(/\{(\d+)\}/g,(_,i)=>args[i]??'');
 const h=await dialogHarness('app-backend-project-delivery',{
  createBackendProjectDeliveryReview:(p,h)=>createBackendProjectDeliveryReview(clone(p),h),validateBackendProjectDeliveryReview:r=>validateBackendProjectDeliveryReview(clone(r)),
  API_PATHS:{EXPORT:'/api/export'},crypto:{randomUUID},location:{href:'http://127.0.0.1/web/'+(options.native?'?desktop=1':'')},
  fetch:async(url,request)=>{requests.push({url,...clone(request),body:JSON.parse(request.body)});return options.fetchResponse||{ok:true};},
  t:translate,translatePage:root=>{for(const item of root.querySelectorAll('[data-i18n]'))item.textContent=translate(item.dataset.i18n);},onLanguageChange:fn=>{languages.push(fn);return()=>languages.splice(languages.indexOf(fn),1);}
 });
 const realm=vm.runInContext('x=>JSON.parse(JSON.stringify(x))',h.runtime),baseCreate=h.document.createElement;
 h.document.createElement=tag=>{const node=baseCreate(tag);if(tag==='a')node.click=()=>downloads.push({href:node.href,download:node.download});return node;};
 const controller=h.runtime.setupBackendProjectDelivery({getContext:()=>state,prepare:async(payload,signal)=>{prepares.push({payload:clone(payload),signal});return realm(await response(payload,signal));},checkDownload:async(id,signal)=>{checks.push({id,signal});await checking(id,signal);},release:async id=>releases.push(id),onChange:()=>changes++});
 const el=name=>h.element('backendDelivery'+name),settle=async()=>{await flushDialogs();await flushDialogs();};
 return{...h,state,controller,releases,prepares,checks,downloads,requests,el,settle,get changes(){return changes;},get listeners(){return languages.length;},
  open:(r=receipt(),o=owner())=>controller.open(realm(r),realm(o)),respond:fn=>{response=typeof fn==='function'?fn:()=>fn;},check:fn=>{checking=fn;},
  language:value=>{dictionary=value;languages.forEach(fn=>fn());},async prepare(){el('Prepare').click();await settle();},async download(){el('Download').click();await settle();},async save(){el('Save').click();await settle();},
  nativeReply(detail={}){const request=requests.at(-1);h.runtime.window.dispatch('viento-export-result',{detail:{...request.body,ok:true,...detail}});},
 };
}

test('delivery review lists exact project files and identities without exposing cache paths snapshots logs or source authority',async()=>{
 const h=await view();assert.equal(h.open(),true);assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Files').children.length,1);assert.match(h.el('Facts').textContent,/bevy 0.19.1/);assert.match(h.el('Files').textContent,/project\/scene-data.json/);assert.ok(!h.el('Dialog').textContent.includes('/cache/'));assert.ok(!h.el('Files').textContent.includes('snapshot.json'));assert.equal(h.prepares.length,0);h.controller.dispose();
});
test('unrecorded mismatched unavailable busy and forged review inputs cannot start delivery',async()=>{
 for(const option of [{context:{busy:true}},{context:{available:false}},{context:{visible:false}},{context:{backendIdentity:'new'}}]){const h=await view(option);assert.equal(h.open(),false);assert.equal(h.prepares.length,0);h.controller.dispose();}
 const h=await view();for(const mutate of [r=>{r.inspection.recorded=false;},r=>{r.inspection.manifestSha256=null;},r=>{r.project.source.sceneId=id(9);},r=>{r.project.files[0].path='../escape';}]){const r=clone(receipt());mutate(r);assert.equal(h.open(r),false);}h.controller.dispose();
});
test('prepare sends only approved build identities and explicit download can retry the same frozen package',async()=>{
 const h=await view();h.open();await h.prepare();assert.deepEqual(h.prepares[0].payload,{kind:'backend-project',buildId,expectedSnapshotId:revision,expectedManifestSha256:hash});assert.equal(h.el('Prepare').disabled,true);assert.equal(h.el('Download').hidden,false);assert.equal(h.downloads.length,0);
 await h.download();await h.download();assert.equal(h.downloads.length,2);assert.deepEqual(h.downloads[0],{href:'/api/export?id='+jobId,download:result().fileName});assert.equal(h.releases.length,0);assert.equal(h.controller.close(),true);await h.settle();assert.deepEqual(h.releases,[]);h.controller.dispose();
});
test('scene service backend identity and visibility changes revoke pending preparation and release every late package',async()=>{
 for(const changed of [{sceneId:id(9)},{session:2},{backendId:'org.viento.godot4'},{backendIdentity:'new'},{visible:false},{available:false}]){const gate=deferred(),h=await view();h.respond(()=>gate.promise);h.open();h.el('Prepare').click();Object.assign(h.state,changed);h.controller.refresh();assert.equal(h.prepares[0].signal.aborted,true);gate.resolve(result());await h.settle();assert.deepEqual(h.releases,[jobId]);assert.equal(h.el('Download').hidden,true);assert.equal(h.controller.isBusy(),false);h.controller.dispose();}
});
test('close dispose and cancellation abort requests and never publish a late prepared receipt',async()=>{
 for(const action of ['close','dispose','cancel']){const gate=deferred(),h=await view();h.respond(()=>gate.promise);h.open();h.el('Prepare').click();if(action==='cancel')h.el('Cancel').click();else h.controller[action]();assert.equal(h.prepares[0].signal.aborted,true);gate.resolve(result());await h.settle();assert.deepEqual(h.releases,[jobId]);assert.equal(h.downloads.length,0);if(action!=='dispose')h.controller.dispose();}
});
test('forged job filename IDs counts nested review or extra fields fail closed and keep preparation retryable',async()=>{
 for(const mutate of [r=>{r.fileName='../escape.zip';},r=>{r.id='../../etc';},r=>{r.documentCount=1;},r=>{r.assetCount=1;},r=>{r.bytes=0;},r=>{r.delivery.manifestSha256='b'.repeat(64);},r=>{r.delivery.project.tool.sha256='b'.repeat(64);},r=>{r.delivery.fileName='wrong.zip';},r=>{r.extra=true;}]){const h=await view(),r=clone(result());mutate(r);h.respond(r);h.open();await h.prepare();assert.equal(h.el('Download').hidden,true);assert.equal(h.el('Prepare').disabled,false);assert.equal(h.el('Error').hidden,false);assert.equal(h.downloads.length,0);h.controller.dispose();}
});
test('cancelled stale closed or expired download checks cannot dispatch a browser download',async()=>{
 for(const action of ['cancel','stale','close','expired']){const gate=deferred(),h=await view();h.open();await h.prepare();h.check(()=>gate.promise);h.el('Download').click();if(action==='cancel')h.el('Cancel').click();if(action==='stale'){h.state.sceneId=id(9);h.controller.refresh();}if(action==='close')h.controller.close();if(action==='expired')gate.reject(Object.assign(Error('expired'),{status:410}));else gate.resolve();await h.settle();assert.equal(h.downloads.length,0);if(action==='cancel'){assert.equal(h.el('Download').disabled,false);assert.equal(h.releases.length,0);}else assert.deepEqual(h.releases,[jobId]);h.controller.dispose();}
});
test('native save binds requestId keeps cancelled jobs retryable and blocks close until the picker settles',async()=>{
 const h=await view({native:true});h.open();await h.prepare();assert.equal(h.el('Save').hidden,false);assert.equal(h.requests.length,0);await h.save();assert.equal(h.controller.isBusy(),true);assert.equal(h.controller.close(),false);assert.equal(h.releases.length,0);const first=h.requests[0];assert.deepEqual(Object.keys(first.body).sort(),['id','requestId']);assert.equal(first.url,'/__desktop/export');
 h.runtime.window.dispatch('viento-export-result',{detail:{id:jobId,requestId:'wrong',ok:true}});assert.equal(h.controller.isBusy(),true);h.nativeReply({cancelled:true});await h.settle();assert.equal(h.controller.isBusy(),false);assert.equal(h.el('Save').disabled,false);assert.equal(h.releases.length,0);
 await h.save();assert.notEqual(h.requests[1].body.requestId,first.body.requestId);h.runtime.window.dispatch('viento-export-result',{detail:{...first.body,ok:true}});assert.equal(h.controller.isBusy(),true);h.nativeReply();await h.settle();assert.match(h.el('Status').textContent,/已保存/);assert.equal(h.releases.length,0);h.controller.close();await h.settle();assert.deepEqual(h.releases,[jobId]);h.controller.dispose();
});
test('dispose during a native picker keeps its pending job until matching completion then removes listeners and UI',async()=>{
 const h=await view({native:true});h.open();await h.prepare();await h.save();h.controller.dispose();assert.equal(h.controller.isBusy(),true);assert.equal(h.releases.length,0);assert.ok(h.el('Dialog'));h.nativeReply({cancelled:true});await h.settle();assert.deepEqual(h.releases,[jobId]);assert.equal(h.el('Dialog'),null);assert.equal(h.listeners,0);assert.equal(h.runtime.window.listeners.get('viento-export-result').length,0);
});
test('native request failures preserve retryability and stale context releases only after the picker completes',async()=>{
 const failed=await view({native:true,fetchResponse:{ok:false,status:500}});failed.open();await failed.prepare();await failed.save();assert.equal(failed.controller.isBusy(),false);assert.equal(failed.el('Save').disabled,false);assert.equal(failed.releases.length,0);failed.controller.dispose();
 const h=await view({native:true});h.open();await h.prepare();await h.save();h.state.session=9;h.controller.refresh();assert.equal(h.releases.length,0);h.nativeReply({cancelled:true});await h.settle();assert.deepEqual(h.releases,[jobId]);assert.equal(h.el('Save').hidden,true);h.controller.dispose();
});
test('busy and language changes preserve ready packages source independence and translated review state',async()=>{
 const h=await view();h.open();await h.prepare();h.state.busy=true;h.controller.refresh();assert.equal(h.el('Download').disabled,true);assert.equal(h.releases.length,0);h.state.busy=false;h.state.dirty=true;h.state.offline=true;h.controller.refresh();assert.equal(h.el('Download').disabled,false);
 h.language(en);assert.equal(h.el('Title').textContent,'Deliver project');assert.match(h.el('Status').textContent,/Package ready/);h.language(ja);assert.equal(h.el('Title').textContent,'プロジェクトを引き渡す');assert.match(h.el('Status').textContent,/準備ができました/);assert.equal(h.prepares.length,1);h.controller.dispose();
});
test('delivery messages have English and Japanese translations and narrow layout rules are present',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-backend-project-delivery.js',import.meta.url),'utf8');const keys=new Set([...source.matchAll(/(?:data-i18n="|(?:status|t)\(')([^'"\n]*[\u3400-\u9fff][^'"\n]*)/g)].map(m=>m[1]));for(const key of keys)for(const dictionary of [en,ja])assert.ok(dictionary[key],key);
 const css=await fs.readFile(new URL('../../web/project-build.css',import.meta.url),'utf8');assert.match(css,/\.backend-delivery[\s\S]*overflow-wrap: anywhere/);assert.match(css,/@media \(max-width: 600px\).*\.backend-delivery/);
});

async function projectView({capability=true,port=true,inspection={}}={}) {
 const deliveries=[],state={available:true,visible:true,...owner(),projects:[{id:buildId,sceneId,backendId,snapshotId:revision,title:'Frozen scene',status:'succeeded',retention:'automatic'}],projectManagement:{scope:'service-session',delivery:capability?'viento-build-delivery-v1':undefined}};
 const h=await dialogHarness('app-backend-project',{validateBackendProjectManifest:value=>validateBackendProjectManifest(clone(value))}),realm=vm.runInContext('x=>JSON.parse(JSON.stringify(x))',h.runtime),container=h.document.createElement('section');h.document.body.append(container);
 const controller=h.runtime.setupBackendProject({container,getState:()=>state,request:async()=>realm({...receipt(),inspection:{...receipt().inspection,...inspection}}),...(port?{onDeliver:(receipt,owner)=>deliveries.push({receipt,owner})}:{})});
 return{...h,state,deliveries,controller,async open(){await controller.open();await flushDialogs();}};
}
test('delivery launcher requires recorded verification manifest hash capability and a port without altering ordinary inspection',async()=>{
 for(const options of [{capability:false},{port:false},{inspection:{recorded:false,manifestSha256:null}}]){const h=await projectView(options);await h.open();assert.equal(h.element('backendProjectDetails').hidden,false);const button=h.element('backendProjectDeliver');assert.ok(button.hidden||button.disabled);button.click();assert.equal(h.deliveries.length,0);assert.match(h.element('backendProjectContent').textContent,/scene-data/);h.controller.dispose();}
 const h=await projectView({inspection:{complete:false,extraPaths:[{path:'sessions/run.json',kind:'file'}]}});await h.open();assert.equal(h.element('backendProjectDeliver').disabled,false);h.element('backendProjectDeliver').click();assert.equal(h.deliveries.length,1);assert.equal(h.deliveries[0].receipt.inspection.extraPaths.length,1);assert.ok(Object.isFrozen(h.deliveries[0].owner));assert.equal(h.deliveries[0].owner.buildId,buildId);assert.equal(h.deliveries[0].owner.backendIdentity,'backend-v1');h.controller.dispose();
});
test('delivery launcher rechecks capability busy and ownership when clicked even without repaint',async()=>{
 for(const change of [s=>{s.busy=true;},s=>{s.session=2;},s=>{s.sceneId=id(99);},s=>{s.backendIdentity='changed';},s=>{s.projectManagement.delivery='future-version';}]){const h=await projectView();await h.open();change(h.state);h.element('backendProjectDeliver').click();assert.equal(h.deliveries.length,0);h.controller.dispose();}
});

test('closing a prepared package before any download cleans it while closing after browser handoff leaves TTL ownership',async()=>{
 const ready=await view();ready.open();await ready.prepare();ready.controller.close();await ready.settle();assert.deepEqual(ready.releases,[jobId]);ready.controller.dispose();
 const dispatched=await view();dispatched.open();await dispatched.prepare();await dispatched.download();dispatched.state.session=7;dispatched.controller.refresh();await dispatched.settle();assert.deepEqual(dispatched.releases,[]);dispatched.controller.dispose();await dispatched.settle();assert.deepEqual(dispatched.releases,[]);
});

test('a rejected receipt diagnostic changes language without preparing again',async()=>{
 const h=await view();h.respond({...result(),fileName:'../invalid.zip'});h.open();await h.prepare();h.language(en);assert.match(h.el('Error').textContent,/receipt does not match/);h.language(ja);assert.match(h.el('Error').textContent,/一致しません/);assert.equal(h.prepares.length,1);h.controller.dispose();
});

test('delivery host diagnostics translate after failure without retrying the operation',async()=>{
 for(const [code,english,japanese] of [['backend_project_delivery_changed',/has changed/,/変更/],['backend_project_workspace_changed',/has changed/,/変更/],['build_busy',/Another task/,/別の処理/],['backend_project_delivery_unavailable',/unavailable/,/引き渡せません/]]) {
  const h=await view();h.respond(()=>{throw Object.assign(Error('host diagnostic'),{code});});h.open();await h.prepare();
  h.language(en);assert.match(h.el('Error').textContent,english);h.language(ja);assert.match(h.el('Error').textContent,japanese);assert.equal(h.prepares.length,1);h.controller.dispose();
 }
});
