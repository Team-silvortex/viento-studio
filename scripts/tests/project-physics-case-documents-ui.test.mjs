import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const assemblyId = '11111111-1111-4111-8111-111111111111', sceneId = '22222222-2222-4222-8222-222222222222';
const otherScene = '33333333-3333-4333-8333-333333333333', documentId = '44444444-4444-4444-8444-444444444444';
const hash = n => `sha256:${String(n).repeat(64)}`, clone = x => JSON.parse(JSON.stringify(x));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const replay = () => ({format:'viento-physics2d-input-replay',schemaVersion:1,fixedDelta:1/60,
  steps:Array.from({length:30},(_,i)=>({left:false,right:i < 4,up:false,down:false,jump:i===3}))});
const definition = () => ({format:'viento-physics2d-replay-case',schemaVersion:1,program:replay(),checks:[{instanceId:'55555555-5555-4555-8555-555555555555',stepIndex:1,positionAfter:{value:[1,2],tolerance:[0.01,0.01]}}]});
const envelope = () => ({format:'viento-physics2d-replay-case-document',schemaVersion:1,sceneObjectId:sceneId,case:definition()});
const content = () => '\uFEFF'+JSON.stringify(envelope(),null,3).replaceAll('\n','\r\n')+'\r\n';
const saved = (changes={}) => ({id:documentId, path:'documents/physics-cases/saved.json', title:'Saved', version:hash(1),sceneId,sceneVersion:hash(2),valid:true,diagnostics:[],content:content(),definition:definition(),...changes});
const catalog = (documents=[saved()]) => ({sceneId,sceneVersion:hash(2),documents,defaults:{documentsPath:'documents',documentType:'document',documentTypes:[{id:'document',label:'说明'}]}});
function initial() { return {supported:true,available:true,platform:'linux',backend:{format:'viento-execution-backend',schemaVersion:1,id:'org.viento.godot4',version:'0.37.0',label:'Godot',platforms:['linux'],plans:[{kind:'project',schemaVersion:1,runtimeProtocolVersion:11}],capabilities:['scene2d','physics.observe2d'],execution:{build:true,headlessLogic:true,windowPreview:true,windowCapture:false,offscreenRender:false,embeddedViewport:false,gpuCompute:false},extensions:[]},
  scenes:[{id:assemblyId,kind:'project',title:'Project',sourcePath:'documents/project.json'}],latestBuild:{id:'build-one',backendId:'org.viento.godot4',sceneId:assemblyId,targetId:assemblyId,targetKind:'project',sceneCount:1,entrySceneId:sceneId,physicsReplayAvailable:true,snapshotId:hash(3)},job:null}; }
async function harness() {
 let status=initial(), responder=body=>body.action==='physics-case-list'?catalog():body.action==='physics-case-load'?saved():saved({content:body.content,definition:JSON.parse(body.content.replace(/^\uFEFF/,'')).case,version:hash(4)}), dict={};
 const calls=[], jobs=[], langs=[], ctx={editable:true,dirty:false,busy:false,creating:false,path:'documents/project.json'};
 const t=(key,...values)=>(dict[key]||key).replace(/\{(\d+)\}/g,(_,i)=>values[i]??'');
 const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH:'/api/project-build',t,onLanguageChange:cb=>langs.push(cb),
 translatePage:root=>{for(const node of root.querySelectorAll('[data-i18n]')) node.textContent=t(node.dataset.i18n);},
 requestProjectBuildDocument:async body=>{calls.push(clone(body));return await responder(body);},
 fetchJsonApiRequest:async (url,request)=>{if(request.body) jobs.push(JSON.parse(request.body));return {payload:status};}});
 const controller=h.runtime.setupProjectBuild({getContext:()=>ctx}); controller.setAvailable(true);h.element('projectBuildBtn').click();await flushDialogs(); h.element('projectBuildPhysicsReplayProgram').value=JSON.stringify(replay());
 return {...h,calls,jobs,ctx, respond(fn){responder=fn;}, async click(name){h.element('projectBuildPhysicsCaseDocument'+name).click();await flushDialogs();},
 select(){const x=h.element('projectBuildPhysicsCaseDocumentSelect');x.value=documentId;x.dispatch('change');},
 input(text){const x=h.element('projectBuildPhysicsCaseProgram');x.value=text;x.dispatch('input');return x;},
 async refresh(value){status=value;h.element('projectBuildRefresh').click();await flushDialogs();}, language(d){dict=d;langs.forEach(x=>x());}};
}
test('explicit save creates a scene-bound replay document and clean save preserves exact bytes',async()=>{
 const h=await harness();await h.click('Refresh');assert.equal(h.calls[0].sceneId,sceneId);assert.equal(h.element('projectBuildPhysicsCaseDocumentPath').value,'documents/physics-cases/22222222-case.json');
 const bodyText=JSON.stringify(definition());h.input(bodyText);await h.click('Save');let body=h.calls.at(-1);assert.equal(body.action,'physics-case-save');assert.equal(body.sceneId,sceneId);assert.equal(body.sceneVersion,hash(2));assert.equal(body.documentType,'document');assert.deepEqual(JSON.parse(body.content),envelope());
 h.respond(x=>x.action==='physics-case-list'?catalog():x.action==='physics-case-load'?saved():saved({content:x.content,definition:definition()}));await h.click('Refresh');h.select();await h.click('Load');await h.click('Save');body=h.calls.at(-1);assert.equal(body.documentId,documentId);assert.equal(body.expectedVersion,hash(1));assert.equal(body.content,content());
 h.element('projectBuildPhysicsCaseRun').click();await flushDialogs();assert.equal(h.jobs.at(-1).physicsReplaySceneId,sceneId);assert.deepEqual(h.jobs.at(-1).physicsReplayCase,definition());
});
test('explicit load and example preserve a rejected unsaved draft and caret',async()=>{
 const h=await harness();await h.click('Refresh');h.select();const input=h.input('{unfinished');input.focus();input.selectionStart=2;input.selectionEnd=5;h.runtime.window.confirm=()=>false;
 const before=h.calls.length;await h.click('Load');assert.equal(h.calls.length,before);assert.equal(input.value,'{unfinished');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);
 h.element('projectBuildPhysicsCaseSample').click();assert.equal(input.value,'{unfinished');h.runtime.window.confirm=()=>true;await h.click('Load');assert.deepEqual(JSON.parse(input.value),definition());
});
test('late reads cannot overwrite edits, a different build, or a reopened dialog',async()=>{
 for(const mutation of ['edit','build','close']){
  const h=await harness();await h.click('Refresh');h.select();const d=deferred();h.respond(()=>d.promise);h.element('projectBuildPhysicsCaseDocumentLoad').click();await flushDialogs();
  if(mutation==='edit')h.input('{newer');
  if(mutation==='build'){const next=initial();next.latestBuild={...next.latestBuild,id:'new-build',entrySceneId:otherScene,snapshotId:hash(5)};await h.refresh(next);}
  if(mutation==='close'){h.element('projectBuildClose').click();await flushDialogs();h.element('projectBuildBtn').click();await flushDialogs();}
  const before=h.element('projectBuildPhysicsCaseProgram').value;d.resolve(saved());await flushDialogs();assert.equal(h.element('projectBuildPhysicsCaseProgram').value,before,mutation);
 }
});
test('conflicts and pending save edits retain current text; foreign scene blocks replay until explicit detachment',async()=>{
 const h=await harness();await h.click('Refresh');h.select();await h.click('Load');const changed=definition();changed.program.steps[0].right=false;const raw=JSON.stringify(changed);h.input(raw);
 h.respond(async()=>{throw Object.assign(new Error('Conflict'),{code:'runtime_physics_case_document_conflict',status:409});});await h.click('Save');assert.equal(h.element('projectBuildPhysicsCaseProgram').value,raw);assert.match(h.element('projectBuildPhysicsCaseDocumentError').textContent,/原文已变化/);
 const next=initial();next.latestBuild={...next.latestBuild,id:'another',entrySceneId:otherScene,snapshotId:hash(6)};await h.refresh(next);assert.equal(h.element('projectBuildPhysicsCaseRun').disabled,true);const jobs=h.jobs.length;h.element('projectBuildPhysicsCaseRun').click();await flushDialogs();assert.equal(h.jobs.length,jobs);
 await h.click('New');assert.equal(h.element('projectBuildPhysicsCaseProgram').value,raw);assert.equal(h.element('projectBuildPhysicsCaseRun').disabled,false);
});
test('document controls and guidance translate in English and Japanese',async()=>{
 const h=await harness();for(const dictionary of [en,ja]){h.language(dictionary);for(const key of ['工程物理输入验收','验收文档保存输入与预期检查；运行结果不保存在文档中。','已保存验收','刷新验收','载入验收','验收保存位置','验收文档类型','保存验收','验收另存为','作为新验收','载入会替换当前未保存的验收草稿。继续吗？','替换会覆盖当前未保存的验收草稿。继续吗？'])assert.ok(dictionary[key],key);assert.equal(h.element('projectBuildPhysicsCaseDocumentSave').textContent,dictionary['保存验收']);}
});

test('editing during save retains the newer draft and uses the confirmed revision; save-as is explicit',async()=>{
 const h=await harness();await h.click('Refresh');h.select();await h.click('Load');const first=definition();first.program.steps[0].left=true;h.input(JSON.stringify(first));
 const d=deferred();let body;h.respond(x=>{body=x;return d.promise;});h.element('projectBuildPhysicsCaseDocumentSave').click();await flushDialogs();
 const second=definition();second.program.steps[1].left=true;const newer=JSON.stringify(second);h.input(newer);
 d.resolve(saved({content:body.content,definition:first,version:hash(4)}));await flushDialogs();assert.equal(h.element('projectBuildPhysicsCaseProgram').value,newer);assert.match(h.element('projectBuildPhysicsCaseDocumentStatus').textContent,/有未保存修改/);
 h.respond(x=>saved({id:'55555555-5555-4555-8555-555555555555',content:x.content,definition:second,version:hash(5)}));h.element('projectBuildPhysicsCaseDocumentPath').value='documents/physics-cases/other.json';h.element('projectBuildPhysicsCaseDocumentPath').dispatch('input');await h.click('SaveAs');
 const request=h.calls.at(-1);assert.equal(request.documentId,undefined);assert.equal(request.expectedVersion,undefined);assert.equal(request.sourcePath,'documents/physics-cases/other.json');assert.deepEqual(JSON.parse(request.content).case,second);
});

test('closing an unconfirmed save prevents duplicate writes until the document is explicitly reloaded',async()=>{
 const h=await harness();await h.click('Refresh');h.select();await h.click('Load');const edited=definition();edited.program.steps[0].left=true;h.input(JSON.stringify(edited));const d=deferred();h.respond(()=>d.promise);h.element('projectBuildPhysicsCaseDocumentSave').click();await flushDialogs();
 h.element('projectBuildClose').click();await flushDialogs();h.element('projectBuildBtn').click();await flushDialogs();assert.equal(h.element('projectBuildPhysicsCaseDocumentSave').disabled,true);assert.match(h.element('projectBuildPhysicsCaseDocumentStatus').textContent,/尚未确认/);
 d.resolve(saved({version:hash(4)}));await flushDialogs();assert.equal(h.element('projectBuildPhysicsCaseDocumentSave').disabled,true);assert.deepEqual(JSON.parse(h.element('projectBuildPhysicsCaseProgram').value),edited);
 h.respond(x=>x.action==='physics-case-list'?catalog():saved());await h.click('Refresh');h.select();await h.click('Load');assert.equal(h.element('projectBuildPhysicsCaseDocumentSave').disabled,false);
});

test('cached options stay visible during refresh but cannot start loading until refresh completes',async()=>{
 const h=await harness();await h.click('Refresh');h.select();const d=deferred();h.respond(()=>d.promise);h.element('projectBuildPhysicsCaseDocumentRefresh').click();await flushDialogs();
 assert.equal(h.element('projectBuildPhysicsCaseDocumentSelect').children.length,2);assert.equal(h.element('projectBuildPhysicsCaseDocumentLoad').disabled,true);const count=h.calls.length;h.element('projectBuildPhysicsCaseDocumentLoad').click();await flushDialogs();assert.equal(h.calls.length,count);
 d.resolve(catalog());await flushDialogs();h.respond(()=>saved());assert.equal(h.element('projectBuildPhysicsCaseDocumentLoad').disabled,false);await h.click('Load');assert.deepEqual(JSON.parse(h.element('projectBuildPhysicsCaseProgram').value),definition());
});

test('a build identity change and return revokes an older load even if its identifiers match again',async()=>{
 const h=await harness();await h.click('Refresh');h.select();const d=deferred();h.respond(()=>d.promise);h.element('projectBuildPhysicsCaseDocumentLoad').click();await flushDialogs();
 const changed=initial();changed.latestBuild={...changed.latestBuild,id:'intermediate',snapshotId:hash(5)};await h.refresh(changed);await h.refresh(initial());const before=h.element('projectBuildPhysicsCaseProgram').value;d.resolve(saved());await flushDialogs();assert.equal(h.element('projectBuildPhysicsCaseProgram').value,before);
});
