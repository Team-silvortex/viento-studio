import test from 'node:test';
import assert from 'node:assert/strict';
import {dialogHarness,flushDialogs} from './dialog-harness.mjs';
import {deferred} from './editor-harness.mjs';
import {PROJECT_BUILD_API_PATH} from '../../engine/build-plan.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,rev='sha256:'+'a'.repeat(64);
const model=()=>({ok:true,format:'viento-scene-preview',schemaVersion:1,previewId:id(4),snapshotId:rev,scene:{objectId:id(1),sourcePath:'documents/scenes/a.json',sourceRevision:rev,title:'Scene',viewport:[800,480],background:'#123456'},actors:[{objectId:id(2),name:'Actor',position:[100,100],size:[50,50],color:'#ffffff',sourcePath:'documents/projections/a.json',declaration:{objectId:id(1),sourcePath:'documents/scenes/a.json',propertyPath:'/actors/0'}}],resources:[],diagnostics:[],sceneEditing:{worldId:id(8),baseRevision:rev,objectRevision:rev,sourceRevision:rev,content:'{}'}});
async function harness(options={}){
 const calls=[],events=[],views=[],edits=[],layouts=[];let ports,active=false;const context={editable:true,dirty:false,creating:false,busy:false,canEditScene:true,canPreviewDraft:true,sceneDraftToken:'token',...options.context};
 const h=await dialogHarness('app-scene-preview',{location:{href:'http://127.0.0.1/web/',origin:'http://127.0.0.1'},setupScenePreviewAnimation:input=>{ports=input;return Object.fromEntries(['setAvailable','setVisible','setPreview','reset','stop','destroy'].map(name=>[name,(...args)=>{events.push({name,args});if(['reset','stop'].includes(name)){active=false;input.onActiveChange(false);}}]).concat([['isActive',()=>active]]));},
 createScenePreviewCanvas:()=>Object.fromEntries(['setScene','setImages','setVisible','select','fit','zoom','setGrid','setVisualSample','destroy'].map(name=>[name,(...args)=>views.push({name,args})])),
 fetchJsonApiRequest:(url,request)=>{const gate=deferred();calls.push({url,request,...gate});if(request.method==='DELETE')gate.resolve({payload:{ok:true}});return gate.promise;}});
 const container=h.document.createElement('section');h.document.body.append(container);const controller=h.runtime.setupScenePreview({container,getContext:()=>context,getDraft:async()=>({sourcePath:'documents/scenes/a.json',baseSourceRevision:rev,content:'{}'}),editScene:id=>edits.push(id),editLayout:value=>layouts.push(value),openSource:()=>true});
 controller.setAnimationAvailable(options.enabled!==false);controller.setAvailable(true);controller.setScene(id(1));controller.setVisible(true);
 const posts=()=>calls.filter(x=>x.request.method==='POST');return{...h,controller,context,container,calls,events,views,edits,layouts,ports,posts,active:value=>{active=value;ports.onActiveChange(value);},resolve:async(value=model())=>{posts().at(-1).resolve({payload:value});await flushDialogs();}};
}
test('only opted-in saved ordinary scenes request animation; drafts and compositions remain static',async()=>{
 const h=await harness();assert.deepEqual(JSON.parse(h.posts()[0].request.body),{sceneId:id(1),includeAnimation:true});await h.resolve();assert.equal(h.events.filter(e=>e.name==='setPreview').length,1);
 h.controller.refreshDraft();await flushDialogs();assert.deepEqual(JSON.parse(h.posts().at(-1).request.body),{sceneId:id(1),draft:{sourcePath:'documents/scenes/a.json',baseSourceRevision:rev,content:'{}'}});
 for(const options of [{enabled:false},{context:{previewKind:'composition'}}]){const n=await harness(options);assert.deepEqual(JSON.parse(n.posts()[0].request.body),{sceneId:id(1)});}
});
test('visual samples use their dedicated canvas port and block only layout; author navigation first restores static',async()=>{
 const h=await harness();await h.resolve();const sample={values:[]};h.ports.setSample(sample);assert.equal(h.views.at(-1).name,'setVisualSample');assert.equal(h.views.at(-1).args[0],sample);
 h.active(true);assert.equal(h.element('scenePreviewLayoutEdit').disabled,true);h.element('scenePreviewLayoutEdit').dispatch('click');assert.equal(h.layouts.length,0);
 h.element('scenePreviewZoomIn').click();assert.ok(h.views.some(e=>e.name==='zoom'));h.element('scenePreviewEdit').click();assert.deepEqual(h.edits,[id(1)]);assert.equal(h.events.at(-1).name,'stop');
 h.active(true);h.element('scenePreviewSource').click();await flushDialogs();assert.equal(h.events.at(-1).name,'stop');
 h.active(false);h.element('scenePreviewLayoutEdit').click();assert.equal(h.layouts.length,1);
});
test('revoking animation does not create another HTTP request; scene replacement and reload reset samples before reading',async()=>{
 const h=await harness();await h.resolve();const count=h.posts().length;h.controller.setAnimationAvailable(false);assert.equal(h.posts().length,count);assert.deepEqual(h.events.at(-1),{name:'setAvailable',args:[false]});
 h.controller.setAnimationAvailable(true);assert.equal(h.posts().length,count+1);assert.ok(h.events.slice(-3).some(e=>e.name==='reset'));await h.resolve();h.controller.setVisible(false);assert.ok(h.events.some(e=>e.name==='setVisible'&&e.args[0]===false));h.controller.destroy();assert.equal(h.events.at(-1).name,'destroy');
});
test('build forwards the explicitly granted animation preview bit independently of engine readiness',async()=>{
 const animation=[],available=[];const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH,fetchJsonApiRequest:async()=>({payload:{}}),setupScenePreview:()=>({setAvailable:v=>available.push(v),setAnimationAvailable:v=>animation.push(v),setScene(){},setVisible(){},invalidate(){},destroy(){}})});
 const controller=h.runtime.setupProjectBuild({});controller.setAvailable(true,[],{scenePreview:true,sceneAnimationPreview:true});assert.equal(animation.at(-1),true);assert.equal(available.at(-1),true);
 controller.setAvailable(true,[],{scenePreview:true});assert.equal(animation.at(-1),false);controller.setAvailable(false,[],{scenePreview:true,sceneAnimationPreview:true});assert.equal(animation.at(-1),false);
});

test('a pending static scene reply may complete after animation capability loss without restoring animation authority',async()=>{
 const h=await harness();h.controller.setAnimationAvailable(false);await h.resolve();assert.equal(h.container.dataset.scenePreviewState,'ready');assert.equal(h.element('scenePreviewCanvas').hidden,false);assert.equal(h.events.filter(e=>e.name==='setAvailable').at(-1).args[0],false);assert.equal(h.posts().length,1);
});

test('sampled-frame navigation hints only offer list selection and restore canvas picking help when stopped',async()=>{
 const h=await harness();await h.resolve();assert.match(h.element('scenePreviewHelp').textContent,/点击角色/);assert.match(h.element('scenePreviewSelection').textContent,/从画布或对象列表/);
 h.active(true);assert.match(h.element('scenePreviewHelp').textContent,/从对象列表查看属性/);assert.doesNotMatch(h.element('scenePreviewHelp').textContent,/点击角色/);assert.equal(h.element('scenePreviewHelp').dataset.i18n,h.element('scenePreviewHelp').textContent);assert.match(h.element('scenePreviewSelection').textContent,/请从对象列表选择/);
 h.active(false);assert.match(h.element('scenePreviewHelp').textContent,/点击角色/);assert.match(h.element('scenePreviewSelection').textContent,/从画布或对象列表/);
});
