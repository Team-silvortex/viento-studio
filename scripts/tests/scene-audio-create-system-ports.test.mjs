import test from 'node:test';
import assert from 'node:assert/strict';
import {dialogHarness,flushDialogs} from './dialog-harness.mjs';
import {deferred} from './editor-harness.mjs';
import {PROJECT_BUILD_API_PATH} from '../../engine/build-plan.mjs';
const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',path='documents/audio/new-audio.json';
async function harness(options={}){
 const context={editable:true,dirty:false,creating:false,busy:false,nonWorldBusy:false,sceneDraftToken:'source-owner'};let ports;const calls=[],opened=[],availability=[];
 const state={supported:true,available:false,reason:'tool_missing',backend:{id:'org.viento.godot4',label:'Godot 4'},scenes:[{id:sceneId,title:'Saved scene',sourcePath:'documents/scenes/demo.json'}],job:null,latestBuild:null};
 const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH,fetchJsonApiRequest:async()=>({payload:state}),
  setupSceneAudioCreate:input=>{ports=input;return{open:id=>opened.push(id),setAvailable:(...args)=>availability.push(args)};},
  inspectSceneAudioCreation:async input=>{calls.push(['inspect',input]);return{catalog:true};},requestWorldCommand:async input=>{calls.push(['command',input]);return{receipt:true};}});
 const controller=h.runtime.setupProjectBuild({getContext:()=>context,setBusy:value=>{context.busy=value;},applied:options.applied|| (async()=>{}),openAuthorSource:options.openAuthorSource|| (async()=>false)});
 controller.setAvailable(true,['audio.create'],{});h.element('projectBuildBtn').click();await flushDialogs();return{...h,controller,context,ports,calls,opened,availability,state};
}
test('build parent exposes existing audio creation without an installed engine and passes saved scene plus isolated command/catalog ports',async()=>{
 const h=await harness();assert.equal(h.element('projectBuildSceneAudio').hidden,false);assert.equal(h.element('projectBuildSceneAudio').disabled,false);h.element('projectBuildSceneAudio').click();assert.deepEqual(h.opened,[sceneId]);
 assert.equal(h.ports.getContext().sceneId,sceneId);assert.equal(h.ports.getContext().visible,true);assert.equal(h.ports.getContext().sourceToken,'source-owner');
 const inspect={sceneObjectId:sceneId},command={command:'audio.create',mode:'preview'};assert.deepEqual(await h.ports.inspect(inspect),{catalog:true});assert.deepEqual(await h.ports.command(command),{receipt:true});assert.deepEqual(h.calls,[['inspect',inspect],['command',command]]);
 h.ports.setBusy(true);assert.equal(h.context.busy,true);assert.equal(h.ports.getContext().busy,false);h.context.nonWorldBusy=true;assert.equal(h.ports.getContext().busy,true);h.context.nonWorldBusy=false;h.ports.setBusy(false);
 h.controller.setAvailable(true,[],{});assert.equal(h.element('projectBuildSceneAudio').hidden,true);assert.equal(h.availability.at(-1)[0],false);
});
test('audio save refresh preserves selected scene instead of selecting new manifest as a scene',async()=>{
 let receipt;const h=await harness({applied:async value=>{receipt=value;}}),result={object:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},changes:[{}, {objectId:sceneId}]};
 await h.ports.applied(result);assert.equal(receipt,result);assert.equal(h.ports.getContext().sceneId,sceneId);
});
test('failed author navigation keeps build parent open and successful receipt closes before focus',async()=>{
 let allow=false,guard,focus=0;const h=await harness({openAuthorSource:async(p,o)=>{assert.equal(p,path);guard=o.isCurrent;assert.equal(guard(),true);return allow?{focus:()=>focus++}:false;}});
 assert.equal(await h.ports.openSource(path,{sourceRevision:'sha256:'+'a'.repeat(64)}),false);assert.equal(h.element('projectBuildDialog').open,true);
 allow=true;const result=await h.ports.openSource(path,{sourceRevision:'sha256:'+'a'.repeat(64)});assert.equal(typeof result.focus,'function');assert.equal(h.element('projectBuildDialog').open,false);assert.equal(guard(),false);assert.ok(focus<=1);
});
test('a late source response cannot close a newer parent session and receives its real ownership guard',async()=>{
 const wait=deferred();let guard;const h=await harness({openAuthorSource:(_p,o)=>{guard=o.isCurrent;return wait.promise;}});
 let childCurrent=true;const pending=h.ports.openSource(path,{sourceRevision:'sha256:'+'a'.repeat(64),isCurrent:()=>childCurrent});assert.equal(guard(),true);childCurrent=false;assert.equal(guard(),false);childCurrent=true;assert.equal(guard(),true);h.element('projectBuildDialog').close();h.element('projectBuildBtn').click();await flushDialogs();assert.equal(guard(),false);wait.resolve({focus:()=>assert.fail('late focus')});assert.equal(await pending,false);assert.equal(h.element('projectBuildDialog').open,true);
});

test('a saved transaction stays saved but missing refreshed scene is reported to the child for retry',async()=>{
 const h=await harness(),result={object:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},changes:[{}, {objectId:sceneId}]};
 h.state.scenes=[];await assert.rejects(h.ports.applied(result),/声音已保存，但目录刷新失败/);assert.equal(h.calls.filter(x=>x[0]==='command').length,0);
});

test('read-only audio-creation reconciliation refreshes indexes without fabricating a committed receipt',async()=>{
 let received;const h=await harness({applied:async result=>{received=result;}});
 await h.ports.applied(null,{reconciled:true});assert.deepEqual(JSON.parse(JSON.stringify(received)),{status:'observed',changes:[]});
 assert.equal(h.calls.filter(call=>call[0]==='command').length,0);
});
test('dirty drafts and preview tabs prevent opening audio creation',async()=>{
 const h=await harness();h.context.dirty=true;h.element('projectBuildSceneAudio').click();assert.deepEqual(h.opened,[]);
 h.context.dirty=false;h.context.creating=true;h.element('projectBuildSceneAudio').click();assert.deepEqual(h.opened,[]);
 h.context.creating=false;h.context.busy=true;h.element('projectBuildSceneAudio').click();assert.deepEqual(h.opened,[]);
});
