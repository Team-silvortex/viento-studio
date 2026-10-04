import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createSceneLayoutDraft } from '../../engine/scene-layout.mjs';
import { WORLD_API_PATH } from '../../engine/world-query.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = '11111111-1111-4111-8111-111111111111', actorId = '22222222-2222-4222-8222-222222222222', revision = `sha256:${'a'.repeat(64)}`;
const content = JSON.stringify({ format: 'viento-scene2d', schemaVersion: 1, title: 'Original', viewport: [800,480], background: '#000000', actors: [{objectId:actorId, position:[100,150], useProjectionDefaults:true,imageResourceId:null}] });
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const model = () => ({ scene: {objectId:id,sourcePath:'documents/a.json',sourceRevision:revision,viewport:[800,480],background:'#000000'},
  actors:[{objectId:actorId,name:'Player <script>',position:[100,150],size:[80,80],color:'#ffffff',speed:100,controls:'arrows'}],
  sceneEditing: {worldId:'world',baseRevision:revision,objectRevision:revision,sourceRevision:revision,content} });
async function harness(t, initialModel=model(), options={}) {
  const calls=[],applied=[],views=[],current={editable:true}; let callbacks,source=content,reads=0,reloads=0,worldReads=0,worldChange=value=>value,worldError=null;
  const h = await dialogHarness('app-scene-layout', {
    createSceneLayoutDraft, API_PATHS:{DOC:'/api/doc'}, WORLD_API_PATH, crypto: webcrypto,
    createScenePreviewCanvas: options => { callbacks=options; return Object.fromEntries(['setScene','setVisible','setImages','select','selectMany','setMultiSelect','setEditing','setSnap','setGrid','fit','zoom'].map(name=>[name,(...args)=>views.push({name,args})])); },
    requestWorldCommand: request => { const wait=deferred(); calls.push({request,...wait}); return wait.promise; },
    readDocSource: async () => { reads++; return {content:source}; },
    fetchJsonApiRequest: async (url, options) => {
      assert.equal(url,WORLD_API_PATH); assert.equal(options.cache,'no-store'); worldReads++;
      if(worldError)throw worldError;
      const object={id,worldId:'world',revision:digest(`object:${source}`),documentRefs:[{sourcePath:'documents/a.json',sourceRevision:digest(source)}]};
      return {payload:worldChange({world:{id:'world',revision:digest(`world:${source}`)},objects:[object]},worldReads)};
    },
  });
  const controller=h.runtime.setupSceneLayout({getContext:()=>current,setBusy:value=>{current.busy=value;},applied:async result=>{applied.push(result);await options.applied?.(result);},reload:()=>{reloads++;}});
  t.after(async () => { h.runtime.window.confirm = () => true; h.element('sceneLayoutDialog').close(); await flushDialogs(); });
  controller.setAvailable(true); assert.equal(controller.open({model:initialModel}),true);
  const move=(x,y)=>callbacks.onMove(actorId,[x,y],{commit:true});
  const result=(status=calls.at(-1).request.mode==='apply'?'applied':'preview')=>{
    const request=calls.at(-1).request,afterSourceRevision=digest(request.content);
    return {status,worldId:request.worldId,baseRevision:request.baseRevision,revision:digest(`world:${request.content}`),
      object:{id,worldId:request.worldId,revision:digest(`object:${request.content}`),documentRefs:[{sourcePath:'documents/a.json',sourceRevision:afterSourceRevision}]},
      changes:[{kind:'scene.update',objectId:id,sourcePath:'documents/a.json',beforeSourceRevision:request.sourceRevision,afterSourceRevision,afterText:request.content}]};
  };
  const check=async()=>{h.element('sceneLayoutCheck').click();calls.at(-1).resolve(result());await settle(h);};
  return {...h,controller,current,calls,applied,views,move,check,result,callbacks,source:value=>{source=value;},world:fn=>{worldChange=fn;},failWorld:error=>{worldError=error;},
    get reads(){return reads;},get reloads(){return reloads;},get worldReads(){return worldReads;}};
}
async function settle(h) {
  for(let attempts=0;attempts<200;attempts++) {
    await flushDialogs(); if(h.element('sceneLayoutDialog').getAttribute('aria-busy')!=='true')return;
    await new Promise(resolve=>setTimeout(resolve,1));
  }
  assert.fail('Layout dialog stayed busy');
}

test('layout moves remain a draft; review and save submit fixed source versions without expanding inheritance',async t=>{
  const h=await harness(t);h.move(200,230);assert.equal(h.calls.length,0);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');
  assert.equal(h.element('sceneLayoutX').value,'200');assert.equal(h.element('sceneLayoutSave').disabled,true);
  await h.check();assert.equal(h.element('sceneLayoutSave').disabled,false);
  const reviewed=h.calls[0].request;assert.equal(reviewed.command,'scene.update');assert.equal(reviewed.sourceRevision,revision);
  const declaration=JSON.parse(reviewed.content);assert.deepEqual(declaration.actors[0],{objectId:actorId,position:[200,230],useProjectionDefaults:true,imageResourceId:null});
  h.element('sceneLayoutSave').click();assert.deepEqual(copy(h.calls[1].request),{...reviewed,mode:'apply'});
  assert.equal(h.element('sceneLayoutClose').disabled,true);h.move(1,2);assert.equal(h.element('sceneLayoutX').value,'200');
  h.calls[1].resolve(h.result());await settle(h);
  assert.equal(h.applied.length,1);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');assert.equal(h.element('sceneLayoutSave').disabled,true);
});

test('one move is one undo step and changing a reviewed draft disables its old approval',async t=>{
  const h=await harness(t);h.move(200,230);await h.check();h.move(300,330);assert.equal(h.element('sceneLayoutSave').disabled,true);
  h.element('sceneLayoutUndo').click();assert.equal(h.element('sceneLayoutX').value,'200');
  h.element('sceneLayoutUndo').click();assert.equal(h.element('sceneLayoutX').value,'100');assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
  h.element('sceneLayoutRedo').click();assert.equal(h.element('sceneLayoutX').value,'200');
  const x=h.element('sceneLayoutX');x.value='220.5';x.dispatch('input');x.dispatch('change');assert.equal(h.element('sceneLayoutRedo').disabled,true);
  h.element('sceneLayoutUndo').click();assert.equal(x.value,'200');
});

test('invalid numeric input stays unsaved and cannot silently submit the previous coordinates',async t=>{
  const h=await harness(t);h.move(200,230);await h.check();
  const x=h.element('sceneLayoutX');x.value='';x.dispatch('input');x.dispatch('change');
  assert.equal(h.element('sceneLayoutCheck').disabled,true);assert.equal(h.element('sceneLayoutSave').disabled,true);
  h.callbacks.onSelect(null);assert.equal(x.value,'');assert.match(h.element('sceneLayoutMessage').textContent,/100000/);
  assert.equal(h.views.filter(view=>view.name==='selectMany').at(-1).args[0].join(','),actorId,'the canvas restores its selection when an invalid input blocks switching');
  h.element('sceneLayoutObjects').querySelector('button').click();assert.equal(x.value,'');
  for(const keys of [{key:'z',ctrlKey:true,shiftKey:true},{key:'y',ctrlKey:true},{key:'z',metaKey:true,shiftKey:true}]) {
    h.element('sceneLayoutDialog').dispatch('keydown',keys);assert.equal(x.value,'');assert.equal(h.element('sceneLayoutSave').disabled,true);
  }
  h.element('sceneLayoutUndo').click();assert.equal(x.value,'200');assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');
});

test('close, escape, and reload honor unsaved layout confirmation and busy protection',async t=>{
  const h=await harness(t);h.move(200,230);h.runtime.window.confirm=()=>false;
  for(const action of [()=>h.element('sceneLayoutClose').click(),()=>h.element('sceneLayoutDialog').dispatch('cancel'),()=>h.element('sceneLayoutReload').click()]){
    action();assert.equal(h.element('sceneLayoutDialog').open,true);assert.equal(h.element('sceneLayoutX').value,'200');
  }
  assert.equal(h.reloads,0);h.runtime.window.confirm=()=>true;h.element('sceneLayoutReload').click();await settle(h);
  assert.equal(h.element('sceneLayoutDialog').open,false);assert.equal(h.reloads,1);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
});

test('source conflicts retain coordinates and do not silently rebase or overwrite',async t=>{
  const h=await harness(t);h.move(200,230);h.element('sceneLayoutCheck').click();
  h.calls[0].reject(Object.assign(new Error('changed'),{payload:{errorCode:'world_revision_conflict'}}));await settle(h);
  assert.equal(h.element('sceneLayoutX').value,'200');assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');
  assert.equal(h.element('sceneLayoutSave').disabled,true);assert.equal(h.element('sceneLayoutCheck').disabled,true);
  assert.match(h.element('sceneLayoutMessage').textContent,/草稿保留/);assert.equal(h.applied.length,0);
});

test('unknown apply is verified through read-only source comparison, never submitted twice',async t=>{
  const h=await harness(t);h.move(200,230);await h.check();h.element('sceneLayoutSave').click();
  const attempted=h.calls[1].request;h.calls[1].reject(new Error('connection lost'));await settle(h);
  assert.equal(h.element('sceneLayoutVerify').hidden,false);assert.equal(h.element('sceneLayoutSave').disabled,true);
  h.source(attempted.content);h.element('sceneLayoutVerify').click();await settle(h);
  assert.equal(h.reads,1);assert.equal(h.worldReads,2);assert.equal(h.calls.length,2);assert.equal(h.applied.length,1);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
});

test('unknown apply with different saved content preserves the draft and requires explicit reload',async t=>{
  const h=await harness(t);h.move(200,230);await h.check();h.element('sceneLayoutSave').click();h.calls[1].reject(new Error('offline'));await settle(h);
  h.element('sceneLayoutVerify').click();await settle(h);
  assert.equal(h.applied.length,0);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');assert.equal(h.element('sceneLayoutX').value,'200');
  assert.equal(h.element('sceneLayoutCheck').disabled,true);assert.equal(h.calls.length,2);
});

test('capability and document draft changes lock layout writes while preserving its draft',async t=>{
  const h=await harness(t);h.move(200,230);h.current.dirty=true;h.element('sceneLayoutCheck').click();assert.equal(h.calls.length,0);
  h.current.dirty=false;h.controller.setAvailable(false);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');
  assert.equal(h.element('sceneLayoutX').disabled,true);h.element('sceneLayoutCheck').click();assert.equal(h.calls.length,0);
});

test('malformed or mismatched successful preview responses never approve a different layout or enable saving',async t=>{
  for(const mutate of [()=>({}),()=>[],value=>({...value,status:'applied'}),value=>({...value,worldId:'foreign'}),
    value=>({...value,baseRevision:digest('foreign')}),value=>({...value,revision:'unverified'}),
    value=>{value.object.id=actorId;return value;},value=>{value.changes[0].sourcePath='documents/other.json';return value;},
    value=>{value.changes[0].afterText=content;return value;},value=>{value.changes[0].afterSourceRevision=digest('wrong');return value;}]) {
    const h=await harness(t);h.move(200,230);h.element('sceneLayoutCheck').click();h.calls[0].resolve(mutate(h.result()));await settle(h);
    assert.equal(h.element('sceneLayoutSave').disabled,true);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');
    assert.equal(h.element('sceneLayoutX').value,'200');assert.equal(h.applied.length,0);assert.equal(h.element('sceneLayoutReview').hidden,true);
  }
});

test('malformed or foreign apply success remains uncertain and requires verification without another mutation',async t=>{
  for(const mutate of [()=>({}),value=>({...value,status:'preview'}),value=>({...value,worldId:'foreign'}),
    value=>({...value,revision:digest('different proposal')}),value=>{value.object.id=actorId;return value;},
    value=>{value.object.documentRefs[0].sourceRevision=digest('foreign');return value;},value=>{value.changes[0].afterText=content;return value;}]) {
    const h=await harness(t);h.move(200,230);await h.check();h.element('sceneLayoutSave').click();
    h.calls[1].resolve(mutate(h.result()));await settle(h);
    assert.equal(h.element('sceneLayoutVerify').hidden,false);assert.equal(h.element('sceneLayoutSave').disabled,true);
    assert.equal(h.element('sceneLayoutCheck').disabled,true);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');assert.equal(h.applied.length,0);
    h.source(h.calls[1].request.content);h.element('sceneLayoutVerify').click();await settle(h);
    assert.equal(h.applied.length,1);assert.equal(h.calls.length,2);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
  }
});

test('unknown apply cannot be acknowledged by matching bytes at a removed or relocated scene path',async t=>{
  for(const change of [value=>{value.objects=[];return value;},value=>{value.world.id='foreign';return value;},
    value=>{value.objects[0].documentRefs[0].sourcePath='documents/moved.json';return value;},
    value=>{value.objects[0].documentRefs[0].sourceRevision=digest('different source');return value;}]) {
    const h=await harness(t);h.move(200,230);await h.check();h.element('sceneLayoutSave').click();h.calls[1].reject(new Error('offline'));await settle(h);
    h.source(h.calls[1].request.content);h.world(change);h.element('sceneLayoutVerify').click();await settle(h);
    assert.equal(h.applied.length,0);assert.equal(h.calls.length,2);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');
    assert.equal(h.element('sceneLayoutX').value,'200');assert.equal(h.element('sceneLayoutCheck').disabled,true);
    assert.match(h.element('sceneLayoutMessage').textContent,/工程已变化/);
  }
});

test('unknown apply rechecks identity after reading source and preserves the draft when registration changes mid-read',async t=>{
  for(const change of [object=>{object.documentRefs[0].sourcePath='documents/moved.json';},
    object=>{object.documentRefs[0].sourceRevision=digest('new source');},object=>{object.revision=digest('new metadata');}]) {
    const h=await harness(t);h.move(200,230);await h.check();h.element('sceneLayoutSave').click();h.calls[1].reject(new Error('offline'));await settle(h);
    h.source(h.calls[1].request.content);h.world((value,count)=>{if(count===2)change(value.objects[0]);return value;});
    h.element('sceneLayoutVerify').click();await settle(h);
    assert.equal(h.reads,1);assert.equal(h.worldReads,2);assert.equal(h.applied.length,0);assert.equal(h.calls.length,2);
    assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');assert.equal(h.element('sceneLayoutCheck').disabled,true);
  }
});

test('failed verification reads retain the uncertain draft and allow a read-only retry',async t=>{
  const h=await harness(t);h.move(200,230);await h.check();h.element('sceneLayoutSave').click();h.calls[1].reject(new Error('offline'));await settle(h);
  h.source(h.calls[1].request.content);h.failWorld(new Error('read unavailable'));h.element('sceneLayoutVerify').click();await settle(h);
  assert.equal(h.element('sceneLayoutVerify').hidden,false);assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true');assert.equal(h.applied.length,0);
  h.failWorld(null);h.element('sceneLayoutVerify').click();await settle(h);assert.equal(h.applied.length,1);assert.equal(h.calls.length,2);
});

test('layout response validation accepts the real scene.update preview and commit including losslessly preserved source formatting',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'viento-layout-ui-'));
  await fs.cp(new URL('../../examples/scene2d/',import.meta.url),root,{recursive:true});
  const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',realActorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sourcePath=path.join(root,'documents/scenes/demo.json'),original=await fs.readFile(sourcePath,'utf8');
  await fs.writeFile(sourcePath,'\uFEFF'+original.replace('"speed": 160','"speed": 1.6e2').replaceAll('\n','\r\n'));
  const previews=createScenePreviewService(root,{enabled:true}),execute=createWorldCommandService(root);
  t.after(async()=>{await previews.close();await fs.rm(root,{recursive:true,force:true});});
  const h=await harness(t, await previews.create({sceneId}));h.callbacks.onMove(realActorId,[240.5,275]);
  h.element('sceneLayoutCheck').click();const proposal=await execute(h.calls[0].request);h.calls[0].resolve(proposal);await settle(h);
  assert.equal(h.element('sceneLayoutSave').disabled,false);assert.equal(h.element('sceneLayoutSource').textContent,proposal.changes[0].afterText);
  assert.match(proposal.changes[0].afterText,/"speed": 1\.6e2/);assert.ok(proposal.changes[0].afterText.startsWith('\uFEFF{\r\n'));
  h.element('sceneLayoutSave').click();const applied=await execute(h.calls[1].request);h.calls[1].resolve(applied);await settle(h);
  assert.equal(h.applied.length,1);assert.equal(h.applied[0].status,'applied');assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
  assert.equal(await fs.readFile(sourcePath,'utf8'),proposal.changes[0].afterText);
});

test('layout messages have English and Japanese translations',async()=>{
  const source=await fs.readFile(new URL('../../web/modules/app-scene-layout.js',import.meta.url),'utf8');
  for(const match of source.matchAll(/(?:'([^'\n]*[\u3400-\u9fff][^'\n]*)'|data-i18n(?:-aria-label)?="([^"]+)")/g)){
    const key=match[1]||match[2];assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);
  }
});

const secondId = '33333333-3333-4333-8333-333333333333', thirdId = '44444444-4444-4444-8444-444444444444';
function groupModel() {
  const value = model(), declaration = JSON.parse(value.sceneEditing.content);
  declaration.actors.push({objectId:secondId,position:[300,230],size:[120,60]}, {objectId:thirdId,position:[200,350],size:[40,100],imageResourceId:null});
  value.sceneEditing.content = JSON.stringify(declaration);
  value.actors.push({objectId:secondId,name:'NPC',position:[300,230],size:[120,60],color:'#ffffff'}, {objectId:thirdId,name:'Marker',position:[200,350],size:[40,100],color:'#ffffff'});
  return value;
}
const renderedPositions = h => copy(h.views.filter(view => view.name === 'setScene').at(-1).args[0].actors.map(actor => actor.position));
const selectedIds = h => copy(h.views.filter(view => view.name === 'selectMany').at(-1).args[0]);

test('multi-selection remains view state; checkboxes, select all, and clear do not change the draft', async t => {
  const h = await harness(t, groupModel());
  const boxes = h.element('sceneLayoutObjects').querySelectorAll('input');
  assert.equal(boxes.length,3); assert.equal(boxes[0].checked,true);
  boxes[1].checked = true; boxes[1].dispatch('change');
  assert.deepEqual(selectedIds(h),[actorId,secondId]); assert.equal(h.element('sceneLayoutX').disabled,true); assert.equal(h.element('sceneLayoutX').value,'');
  assert.equal(h.element('sceneLayoutCoordinates').hidden,true); assert.match(h.element('sceneLayoutSelection').textContent,/2/); assert.equal(h.element('sceneLayoutAlignLeft').disabled,false);
  h.element('sceneLayoutSelectAll').click(); assert.deepEqual(selectedIds(h),[actorId,secondId,thirdId]);
  h.element('sceneLayoutClearSelection').click(); assert.deepEqual(selectedIds(h),[]); assert.equal(h.element('sceneLayoutAlignLeft').disabled,true);
  h.element('sceneLayoutObjects').querySelectorAll('button')[2].click(); assert.deepEqual(selectedIds(h),[thirdId]); assert.equal(h.element('sceneLayoutX').value,'200'); assert.equal(h.element('sceneLayoutCoordinates').hidden,false);
  assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false'); assert.equal(h.calls.length,0);
});

test('one group gesture and one alignment each use one undo step and one reviewed scene update', async t => {
  const h = await harness(t, groupModel()), original = renderedPositions(h);
  h.element('sceneLayoutSelectAll').click();
  const moved = [{objectId:actorId,position:[132,182]}, {objectId:secondId,position:[332,262]}, {objectId:thirdId,position:[232,382]}];
  h.callbacks.onMoveMany(moved,{commit:true}); assert.deepEqual(renderedPositions(h),moved.map(item=>item.position));
  h.element('sceneLayoutUndo').click(); assert.deepEqual(renderedPositions(h),original); assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
  h.element('sceneLayoutRedo').click(); h.element('sceneLayoutAlignLeft').click();
  assert.deepEqual(renderedPositions(h),[[132,182],[152,262],[112,382]],'left edges agree despite different resolved widths');
  h.element('sceneLayoutUndo').click(); assert.deepEqual(renderedPositions(h),moved.map(item=>item.position));
  h.element('sceneLayoutRedo').click(); await h.check();
  const candidate=JSON.parse(h.calls[0].request.content); assert.deepEqual(candidate.actors.map(actor=>actor.position),renderedPositions(h));
  assert.equal(candidate.actors[0].useProjectionDefaults,true); assert.equal(candidate.actors[0].imageResourceId,null); assert.equal(Object.hasOwn(candidate.actors[1],'useProjectionDefaults'),false);
  h.element('sceneLayoutClearSelection').click(); assert.equal(h.element('sceneLayoutSave').disabled,false,'selection changes retain the reviewed source');
  h.element('sceneLayoutSave').click(); h.calls[1].resolve(h.result()); await settle(h);
  assert.equal(h.calls.length,2); assert.equal(h.applied.length,1); assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false');
});

test('an invalid batch cannot partially move actors or silently discard an unfinished coordinate', async t => {
  const h = await harness(t, groupModel()), original=renderedPositions(h);
  h.element('sceneLayoutSelectAll').click();
  h.callbacks.onMoveMany([{objectId:actorId,position:[200,250]},{objectId:secondId,position:[100001,20]}],{commit:true});
  assert.deepEqual(renderedPositions(h),original); assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'false'); assert.equal(h.element('sceneLayoutUndo').disabled,true);
  h.callbacks.onSelect(actorId,{ids:[actorId]});
  const x=h.element('sceneLayoutX'); x.value=''; x.dispatch('input');
  h.callbacks.onSelect(secondId,{ids:[actorId,secondId]}); h.element('sceneLayoutSelectAll').click();
  h.callbacks.onMoveMany([{objectId:actorId,position:[200,250]}],{commit:true}); h.element('sceneLayoutAlignTop').click();
  assert.equal(x.value,''); assert.deepEqual(selectedIds(h),[actorId]); assert.deepEqual(renderedPositions(h),original);
  assert.equal(h.element('sceneLayoutCheck').disabled,true); assert.equal(h.calls.length,0);
});

test('conflicts freeze batch commands while keeping all selected positions and history', async t => {
  const h=await harness(t, groupModel()); h.element('sceneLayoutSelectAll').click(); h.element('sceneLayoutAlignBottom').click();
  const before=renderedPositions(h); h.element('sceneLayoutCheck').click();
  h.calls[0].reject(Object.assign(new Error('changed'),{payload:{errorCode:'world_revision_conflict'}})); await settle(h);
  assert.equal(h.element('sceneLayoutAlignTop').disabled,true); assert.equal(h.element('sceneLayoutUndo').disabled,true);
  h.element('sceneLayoutAlignTop').click(); h.callbacks.onMoveMany([{objectId:actorId,position:[0,0]}],{commit:true});
  assert.deepEqual(renderedPositions(h),before); assert.equal(h.element('sceneLayoutDialog').dataset.dirty,'true'); assert.equal(h.calls.length,1);
});

test('missing Rust core blocks layout edits with a translated message while retaining the saved model', async t => {
  const original = model(), before = copy(original), h = await harness(t, original);
  h.element('sceneLayoutCancel').click(); await flushDialogs();
  const messages = [];
  h.runtime.getStudioCoreMetadata = () => ({ ready: false, backend: 'rust-wasm', errorCode: 'studio_core_unavailable' });
  h.runtime.window.alert = message => messages.push(message);
  assert.equal(h.controller.open({ model: original }), false);
  assert.equal(h.element('sceneLayoutDialog').open, false);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(original, before);
  const key = '布局编辑组件未能加载，请刷新或重新安装应用。已保存场景仍可预览。';
  assert.equal(messages.length, 1); assert.ok(en[key]); assert.ok(ja[key]);
});

test('close, cancel and reload release Rust drafts while declined discard retains the same history', async t => {
  const h = await harness(t); h.element('sceneLayoutCancel').click(); await flushDialogs();
  const retained = [];
  h.runtime.createSceneLayoutDraft = source => { const value = createSceneLayoutDraft(source); retained.push(value); return value; };
  for (let cycle = 0; cycle < 40; cycle++) {
    assert.equal(h.controller.open({ model: model() }), true);
    h.move(200, 230); h.runtime.window.confirm = () => false;
    h.element('sceneLayoutCancel').click(); assert.equal(h.element('sceneLayoutDialog').open, true);
    assert.equal(retained.at(-1).state().canUndo, true);
    h.element('sceneLayoutUndo').click(); assert.equal(h.element('sceneLayoutX').value, '100');
    h.runtime.window.confirm = () => true;
    const action = ['sceneLayoutClose', 'sceneLayoutCancel', 'sceneLayoutReload'][cycle % 3];
    h.element(action).click(); await flushDialogs();
    assert.equal(h.element('sceneLayoutDialog').open, false);
    assert.throws(() => retained.at(-1).state(), { errorCode: 'scene_layout_draft_invalid' });
  }
  assert.equal(h.calls.length, 0);
});

test('a failed dialog open disposes its Rust session and a legacy core error becomes a translated failure', async t => {
  const original = model(), before = copy(original), h = await harness(t, original);
  h.element('sceneLayoutCancel').click(); await flushDialogs();
  const dialog = h.element('sceneLayoutDialog'), showModal = dialog.showModal, alerts = [], drafts = [];
  h.runtime.window.alert = value => alerts.push(value);
  h.runtime.createSceneLayoutDraft = source => { const value = createSceneLayoutDraft(source); drafts.push(value); return value; };
  dialog.showModal = () => { throw new Error('Native dialog rejected opening'); };
  for (let cycle = 0; cycle < 40; cycle++) {
    assert.equal(h.controller.open({ model: original }), false);
    assert.throws(() => drafts.at(-1).state(), { errorCode: 'scene_layout_draft_invalid' });
  }
  h.runtime.createSceneLayoutDraft = () => { throw Object.assign(new Error('Unknown operation layoutDraft.create'), { errorCode: 'studio_core_request_invalid' }); };
  assert.equal(h.controller.open({ model: original }), false); assert.equal(alerts.length, 41);
  assert.equal(dialog.open, false); assert.deepEqual(original, before); assert.equal(h.calls.length, 0);
  h.runtime.createSceneLayoutDraft = createSceneLayoutDraft; dialog.showModal = showModal;
  assert.equal(h.controller.open({ model: original }), true);
});

test('history and coordinate core failures preserve the last Rust snapshot and unsaved close protection', async t => {
  const h = await harness(t); h.element('sceneLayoutCancel').click(); await flushDialogs();
  h.runtime.createSceneLayoutDraft = source => {
    const value = createSceneLayoutDraft(source);
    return { ...value, undo() { throw Object.assign(new Error('Rust runtime failed'), { errorCode: 'studio_core_unavailable' }); },
      setPosition() { throw Object.assign(new Error('Rust runtime failed'), { errorCode: 'studio_core_unavailable' }); } };
  };
  assert.equal(h.controller.open({ model: model() }), true); h.move(200, 230);
  h.element('sceneLayoutUndo').click(); assert.equal(h.element('sceneLayoutX').value, '200');
  assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true');
  const x = h.element('sceneLayoutX'); x.value = '250'; x.dispatch('input'); x.dispatch('change');
  assert.equal(x.value, '250', 'failed commit retains the unfinished typed value');
  assert.equal(h.element('sceneLayoutCheck').disabled, true); assert.equal(h.calls.length, 0);
  h.runtime.window.confirm = () => false; h.element('sceneLayoutCancel').click();
  assert.equal(h.element('sceneLayoutDialog').open, true); assert.equal(x.value, '250');
});

test('nested verification error codes enter Rust conflict state and cannot be retried as uncertain saves', async t => {
  for (const code of ['world_revision_conflict', 'world_read_conflict', 'world_object_not_found']) {
    const h = await harness(t); h.move(200, 230); await h.check(); h.element('sceneLayoutSave').click();
    h.calls[1].reject(new Error('apply result unknown')); await settle(h);
    h.failWorld(Object.assign(new Error('nested identity conflict'), { payload: { data: { errorCode: code } } }));
    h.element('sceneLayoutVerify').click(); await settle(h);
    assert.equal(h.element('sceneLayoutVerify').hidden, true); assert.equal(h.element('sceneLayoutCheck').disabled, true);
    assert.equal(h.element('sceneLayoutX').value, '200'); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true');
    assert.match(h.element('sceneLayoutMessage').textContent, /工程已变化/); assert.equal(h.calls.length, 2);
  }
});

test('refresh failure after an accepted apply stays saved, warns, and cannot submit the write again', async t => {
  const refresh = deferred(), h = await harness(t, model(), { applied: () => refresh.promise });
  h.move(200, 230); await h.check(); h.element('sceneLayoutSave').click();
  h.calls[1].resolve(h.result());
  for (let attempt = 0; attempt < 200 && !h.applied.length; attempt++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.equal(h.applied.length, 1); assert.equal(h.current.busy, true);
  assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'false'); assert.equal(h.element('sceneLayoutClose').disabled, true);
  h.element('sceneLayoutSave').click(); h.element('sceneLayoutDialog').dispatch('keydown', { key: 's', ctrlKey: true });
  assert.equal(h.calls.length, 2);
  refresh.reject(new Error('Preview could not refresh')); await settle(h);
  assert.equal(h.element('sceneLayoutClose').disabled, false); assert.equal(h.current.busy, false);
  assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'false'); assert.match(h.element('sceneLayoutMessage').textContent, /勿重复保存/);
  h.element('sceneLayoutSave').click(); h.element('sceneLayoutDialog').dispatch('keydown', { key: 's', ctrlKey: true });
  assert.equal(h.calls.length, 2); assert.equal(h.element('sceneLayoutVerify').hidden, true);
});

test('late preview responses and old close events cannot approve, unlock or replace another session', async t => {
  const h = await harness(t); h.move(200, 230); h.element('sceneLayoutCheck').click();
  const responseA = h.result(), dialog = h.element('sceneLayoutDialog');
  dialog.close();
  assert.equal(h.controller.open({ model: model() }), true, 'reopen releases old ownership even before its queued close event');
  h.move(300, 330); h.element('sceneLayoutCheck').click(); const responseB = h.result();
  await flushDialogs(); assert.equal(h.current.busy, true);
  h.calls[0].resolve(responseA); await flushDialogs(); await flushDialogs();
  assert.equal(dialog.open, true); assert.equal(dialog.getAttribute('aria-busy'), 'true'); assert.equal(h.current.busy, true);
  assert.equal(h.element('sceneLayoutX').value, '300'); assert.equal(h.element('sceneLayoutSave').disabled, true);
  assert.equal(h.element('sceneLayoutReview').hidden, true); assert.equal(h.applied.length, 0);
  h.calls[1].resolve(responseB); await settle(h);
  assert.equal(h.element('sceneLayoutSave').disabled, false); assert.equal(h.current.busy, false);
  assert.deepEqual(JSON.parse(h.element('sceneLayoutSource').textContent).actors[0].position, [300, 330]);
});

test('late apply success after a programmatic close cannot acknowledge another session or trigger its refresh', async t => {
  const h = await harness(t); h.move(200, 230); await h.check(); h.element('sceneLayoutSave').click();
  const responseA = h.result(); h.element('sceneLayoutDialog').close(); await flushDialogs();
  assert.equal(h.current.busy, false); assert.equal(h.controller.open({ model: model() }), true);
  h.move(300, 330); h.element('sceneLayoutCheck').click(); const responseB = h.result();
  h.calls[1].resolve(responseA); await flushDialogs(); await flushDialogs();
  assert.equal(h.applied.length, 0); assert.equal(h.current.busy, true); assert.equal(h.element('sceneLayoutX').value, '300');
  assert.equal(h.element('sceneLayoutSave').disabled, true); assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true');
  h.calls[2].resolve(responseB); await settle(h); assert.equal(h.element('sceneLayoutSave').disabled, false);
});

test('late verification reads stop before further reads or refresh when their session was closed', async t => {
  const h = await harness(t); h.move(200, 230); await h.check(); h.element('sceneLayoutSave').click();
  const savedSource = h.calls[1].request.content; h.calls[1].reject(new Error('unknown')); await settle(h);
  h.source(savedSource); const read = deferred(); h.runtime.readDocSource = () => read.promise;
  h.element('sceneLayoutVerify').click(); await flushDialogs();
  assert.equal(h.worldReads, 1);
  h.element('sceneLayoutDialog').close(); await flushDialogs(); assert.equal(h.controller.open({ model: model() }), true);
  h.move(300, 330); h.element('sceneLayoutCheck').click(); const responseB = h.result();
  read.resolve({ content: savedSource }); await flushDialogs(); await flushDialogs();
  assert.equal(h.worldReads, 1, 'closed verification never issues its second world read');
  assert.equal(h.applied.length, 0); assert.equal(h.current.busy, true); assert.equal(h.element('sceneLayoutX').value, '300');
  h.calls[2].resolve(responseB); await settle(h);
});

test('a core failure after begin retains the last Rust phase but releases host busy state and allows confirmed close', async t => {
  const h = await harness(t); h.element('sceneLayoutCancel').click(); await flushDialogs();
  let captured;
  h.runtime.createSceneLayoutDraft = source => {
    captured = createSceneLayoutDraft(source);
    return { ...captured, resolveSave() { throw Object.assign(new Error('Rust core unavailable during resolve'), { errorCode: 'studio_core_unavailable' }); } };
  };
  assert.equal(h.controller.open({ model: model() }), true); h.move(200, 230);
  h.element('sceneLayoutCheck').click(); h.calls[0].resolve(h.result()); await settle(h);
  assert.equal(captured.saveState().phase, 'checking', 'no local completion fabricates a Rust state transition');
  assert.equal(h.current.busy, false); assert.equal(h.element('sceneLayoutClose').disabled, false);
  assert.equal(h.element('sceneLayoutSave').disabled, true); assert.equal(h.element('sceneLayoutCheck').disabled, true);
  assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'true'); assert.equal(h.element('sceneLayoutX').value, '200');
  h.runtime.window.confirm = () => false; h.element('sceneLayoutCancel').click(); assert.equal(h.element('sceneLayoutDialog').open, true);
  h.runtime.window.confirm = () => true; h.element('sceneLayoutCancel').click(); await flushDialogs();
  assert.equal(h.element('sceneLayoutDialog').open, false); assert.throws(() => captured.state(), { errorCode: 'scene_layout_draft_invalid' });
});

test('layout repeated-definition instances select, move, undo, align and serialize separately', async t => {
  const value = groupModel(), declaration = JSON.parse(value.sceneEditing.content); declaration.schemaVersion = 2;
  declaration.actors.forEach((actor, index) => { actor.instanceId = [actorId, secondId, thirdId][index]; actor.objectId = actorId; });
  value.actors.forEach((actor, index) => { actor.instanceId = [actorId, secondId, thirdId][index]; actor.objectId = actorId; });
  value.sceneEditing.content = JSON.stringify(declaration);
  const h = await harness(t, value), buttons = h.element('sceneLayoutObjects').querySelectorAll('button');
  assert.deepEqual(buttons.map(button => button.dataset.objectId), [actorId, actorId, actorId]);
  assert.deepEqual(buttons.map(button => button.dataset.actorId), [actorId, secondId, thirdId]);
  buttons[1].click(); assert.deepEqual(selectedIds(h), [secondId]); assert.equal(h.element('sceneLayoutX').value, '300');
  h.callbacks.onMove(secondId, [380, 260]); assert.deepEqual(renderedPositions(h), [[100, 150], [380, 260], [200, 350]]);
  h.element('sceneLayoutUndo').click(); assert.deepEqual(renderedPositions(h), [[100, 150], [300, 230], [200, 350]]);
  h.element('sceneLayoutRedo').click(); h.element('sceneLayoutSelectAll').click(); h.element('sceneLayoutAlignLeft').click();
  await h.check(); const saved = JSON.parse(h.calls.at(-1).request.content);
  assert.equal(saved.schemaVersion, 2); assert.deepEqual(saved.actors.map(actor => actor.instanceId), [actorId, secondId, thirdId]);
  assert.ok(saved.actors.every(actor => actor.objectId === actorId));
  assert.equal(saved.actors[0].imageResourceId, null); assert.equal(saved.actors[0].useProjectionDefaults, true);
  assert.deepEqual(saved.actors.map(actor => actor.position), renderedPositions(h));
});

test('nested group selection includes every descendant and one group alignment is one reversible layout command', async t => {
  const value = groupModel(), declaration = JSON.parse(value.sceneEditing.content);
  const groups = [{ groupId: '66666666-6666-4666-8666-666666666666', name: 'Party' }, { groupId: '77777777-7777-4777-8777-777777777777', name: 'Front', parentGroupId: '66666666-6666-4666-8666-666666666666' }];
  declaration.schemaVersion = 3; declaration.groups = groups;
  declaration.actors.forEach((actor, index) => { actor.instanceId = [actorId, secondId, thirdId][index]; actor.objectId = actorId; if (index < 2) actor.groupId = groups[index].groupId; });
  value.actors.forEach((actor, index) => { actor.instanceId = [actorId, secondId, thirdId][index]; actor.objectId = actorId; });
  value.sceneEditing.content = JSON.stringify(declaration);
  value.sceneStructure = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3, groups, memberships: declaration.actors.filter(actor => actor.groupId).map(actor => ({ instanceId: actor.instanceId, groupId: actor.groupId })) };
  const h = await harness(t, value), list = h.element('sceneLayoutObjects');
  list.querySelector(`button[data-group-id="${groups[0].groupId}"]`).click(); assert.deepEqual(selectedIds(h), [actorId, secondId]);
  assert.equal(h.element('sceneLayoutDialog').dataset.dirty, 'false'); const before = renderedPositions(h);
  h.element('sceneLayoutAlignLeft').click(); const after = renderedPositions(h); assert.notDeepEqual(after, before); assert.deepEqual(after[2], before[2]);
  h.element('sceneLayoutUndo').click(); assert.deepEqual(renderedPositions(h), before);
  h.element('sceneLayoutRedo').click(); await h.check();
  const saved = JSON.parse(h.calls.at(-1).request.content); assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.groups, groups);
  assert.deepEqual(saved.actors.map(actor => actor.groupId), [groups[0].groupId, groups[1].groupId, undefined]);
  assert.deepEqual(saved.actors.map(actor => actor.position), after);
  const search = h.element('sceneLayoutSearch'); search.value = secondId; search.dispatch('input');
  list.querySelector(`button[data-group-id="${groups[0].groupId}"]`).click(); assert.deepEqual(selectedIds(h), [actorId, secondId], 'filtered group still selects all descendants');
  const child = list.querySelector(`input[data-group-id="${groups[1].groupId}"]`); child.dispatch('change'); assert.deepEqual(selectedIds(h), [actorId]);
});
