import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSceneAudioSourceHost } from '../../web/modules/app-scene-audio-source.js';
import { createSceneAudioResourceProposal, createSceneAudioTrackProposal } from '../../engine/scene-audio-edit.mjs';
import { isSceneAudioResources } from '../../engine/scene-audio-resources.mjs';
import { createSceneAudioCreationService } from '../lib/scene-audio-creation-service.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd', audioId='88888888-8888-4888-8888-888888888888', newId='12345678-1111-4111-8111-000000000001';
const sourcePath='documents/audio/demo.json', json=value=>JSON.stringify(value,null,2)+'\n';
const rejected=error=>/^(scene_audio_|world_audio_)/.test(error.errorCode||'');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'viento-audio-resource-host-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.cp(new URL('../../examples/scene-audio/',import.meta.url),root,{recursive:true});
  const content=await fs.readFile(path.join(root,sourcePath),'utf8'), model=JSON.parse(content), oldId=model.tracks[0].resourceId;
  const bytes=await fs.readFile(path.join(root,'assets/tone.wav'));for(let i=44;i<bytes.length;i+=2)bytes.writeInt16LE(-bytes.readInt16LE(i),i);
  await fs.writeFile(path.join(root,'assets/replacement.wav'),bytes);
  const asset=JSON.parse(await fs.readFile(path.join(root,`metadata/assets/${oldId}.json`)));
  await fs.writeFile(path.join(root,`metadata/assets/${newId}.json`),json({...asset,id:newId,name:'Replacement tone',location:{store:'main',path:'replacement.wav'},content:{size:bytes.length,sha256:buildHash(bytes)},legacyPaths:['assets/replacement.wav']}));
  const metaPath=path.join(root,`metadata/documents/${audioId}.json`),meta=JSON.parse(await fs.readFile(metaPath));meta.assetBindings.push({assetId:newId,role:'author voice'});await fs.writeFile(metaPath,json(meta));
  const raw=await createSceneAudioCreationService(root).inspect({sceneObjectId:sceneId});
  const state={document:{},token:'audio-resource-host',sourcePath,content,baseline:content,version:'sha256:'+buildHash(content),editable:true,creating:false,busy:false,available:true,resourcesAvailable:true,sourceJSON:true};
  const h={root,raw,state,model,content,writes:[],inspections:[],digestCalls:0,focusCount:0};
  h.host=createSceneAudioSourceHost({getState:()=>({...state}),digest:async value=>{h.digestCalls++;await h.beforeDigest?.(value,h.digestCalls);return buildHash(value);},inspect:async request=>{h.inspections.push(request);await h.beforeInspect?.(request);return structuredClone(h.raw);},writeDraft:content=>{h.writes.push(content);state.content=content;},focus:()=>h.focusCount++});
  h.proposal=async()=>{const source=await h.host.getSource(),catalog=await h.host.getResources(source),edit=structuredClone(h.model);edit.tracks.forEach(row=>row.resourceId=newId);return createSceneAudioResourceProposal(source,{tracks:edit.tracks,cues:edit.cues},catalog);};
  return h;
}
function gate(){let enter,release;const entered=new Promise(resolve=>enter=resolve),pending=new Promise(resolve=>release=resolve);return {entered,release,wait:async()=>{enter();await pending;}};}
test('resource host reads bound WAV without writes, rechecks at apply, preserves identities and leaves Save external',async t=>{
  const h=await fixture(t),source=await h.host.getSource(),catalog=await h.host.getResources(source);
  assert.equal(h.host.getContext().resourcesAvailable,true);assert.equal(isSceneAudioResources(catalog),true);assert.equal(catalog.resources.length,2);assert.equal(catalog.resources.find(r=>r.resourceId===newId).availability,'unverified');assert.deepEqual(h.writes,[]);
  const proposal=await h.proposal(),before=h.inspections.length,result=await h.host.applyDraft(proposal);
  assert.equal(h.inspections.length,before+1);assert.deepEqual(h.inspections,Array(h.inspections.length).fill({sceneObjectId:sceneId}));
  const changed=JSON.parse(result.content);assert.deepEqual(changed.tracks.map(row=>row.id),h.model.tracks.map(row=>row.id));assert.deepEqual(changed.cues,h.model.cues);assert.ok(changed.tracks.every(row=>row.resourceId===newId));assert.equal(h.writes.length,1);assert.equal(await fs.readFile(path.join(h.root,sourcePath),'utf8'),h.content);result.focus();assert.equal(h.focusCount,1);await assert.rejects(h.host.applyDraft(proposal),rejected);assert.equal(h.writes.length,1);
});
test('resource host denies changed registry, metadata, availability and saved source after review',async t=>{
  for(const mutate of [r=>r.baseRevision='sha256:'+'a'.repeat(64),r=>r.manifest.objectRevision='sha256:'+'b'.repeat(64),r=>r.resources[0].resourceRevision='sha256:'+'c'.repeat(64),r=>r.resources[0].sha256='d'.repeat(64),r=>r.resources=r.resources.filter(row=>row.resourceId!==newId),r=>r.manifest.assetBindings=r.manifest.assetBindings.filter(row=>row.assetId!==newId),r=>r.manifest.content+=' ',r=>r.scene.objectRevision='sha256:'+'e'.repeat(64)]){
    const h=await fixture(t),p=await h.proposal();h.raw=structuredClone(h.raw);mutate(h.raw);await assert.rejects(h.host.applyDraft(p),rejected);assert.deepEqual(h.writes,[]);
  }
});
test('resource reads reject another source or forged saved bytes and do not execute source getters',async t=>{
  const h=await fixture(t),source=await h.host.getSource();
  await assert.rejects(h.host.getResources({...source,token:'other'}),rejected);let calls=0;
  const altered={...source};Object.defineProperty(altered,'content',{enumerable:true,get(){calls++;return source.content;}});await assert.rejects(h.host.getResources(altered),rejected);assert.equal(calls,0);
  h.raw=structuredClone(h.raw);h.raw.manifest.content+=' ';await assert.rejects(h.host.getResources(source),rejected);assert.deepEqual(h.writes,[]);
});
test('resource read and resource apply revoke ownership across readonly inspection and baseline hashing',async t=>{
  for(const operation of ['read','apply'])for(const boundary of ['inspect','hash']){
    const h=await fixture(t),source=await h.host.getSource(),p=operation==='apply'?await h.proposal():null,g=gate();
    if(boundary==='inspect')h.beforeInspect=g.wait;else{const target=h.digestCalls+3;h.beforeDigest=async(_,call)=>{if(call===target)await g.wait();};}
    const pending=operation==='read'?h.host.getResources(source):h.host.applyDraft(p);await g.entered;h.state.content+=' ';g.release();await assert.rejects(pending,rejected);assert.deepEqual(h.writes,[]);
  }
});
test('resource apply respects caller cancellation and backend withdrawal after inspection',async t=>{
  for(const change of ['caller','backend']){
    const h=await fixture(t),p=await h.proposal(),g=gate();let current=true;h.beforeInspect=g.wait;
    const pending=h.host.applyDraft(p,{isCurrent:()=>current});await g.entered;if(change==='caller')current=false;else h.state.resourcesAvailable=false;g.release();await assert.rejects(pending,rejected);assert.deepEqual(h.writes,[]);
  }
});
test('optional resource service is not required for existing ordinary audio editing',async t=>{
  const h=await fixture(t);h.state.resourcesAvailable=false;assert.equal(h.host.getContext().resourcesAvailable,false);
  const source=await h.host.getSource();await assert.rejects(h.host.getResources(source),rejected);assert.equal(h.inspections.length,0);
  const edit={tracks:structuredClone(h.model.tracks),cues:structuredClone(h.model.cues)};edit.tracks[0].volume=.23;
  await h.host.applyDraft(await createSceneAudioTrackProposal(source,edit));assert.equal(h.inspections.length,0);assert.equal(h.writes.length,1);
  const host=createSceneAudioSourceHost({getState:()=>({...h.state,resourcesAvailable:true}),digest:buildHash,writeDraft:()=>assert.fail('unexpected write')});assert.equal(host.getContext().resourcesAvailable,false);await assert.rejects(host.getResources(await host.getSource()),rejected);
});
test('resource selection preserves earlier unsaved source changes and keeps both metadata bindings',async t=>{
  const h=await fixture(t);h.state.content=h.content.replace('"volume": 0.12','"volume": 0.17');assert.notEqual(h.state.content,h.content);
  h.model=JSON.parse(h.state.content);const p=await h.proposal(),result=await h.host.applyDraft(p);assert.equal(JSON.parse(result.content).tracks[0].volume,.17);
  await fs.writeFile(path.join(h.root,sourcePath),result.content);const built=await captureBuildSnapshot(h.root,sceneId);assert.equal(built.ok,true,JSON.stringify(built.diagnostics));assert.equal(built.resources.size,1);assert.deepEqual(built.plan.resources.map(row=>row.id),[newId]);
  const metadata=JSON.parse(await fs.readFile(path.join(h.root,`metadata/documents/${audioId}.json`)));assert.equal(metadata.assetBindings.length,2);assert.ok(await fs.stat(path.join(h.root,'assets/tone.wav')));
});
test('registered catalog does not promise WAV validity; actual build rejects tampered bytes',async t=>{
  const h=await fixture(t),p=await h.proposal(),result=await h.host.applyDraft(p);await fs.writeFile(path.join(h.root,sourcePath),result.content);
  const wave=path.join(h.root,'assets/replacement.wav'),bytes=await fs.readFile(wave);bytes[50]^=1;await fs.writeFile(wave,bytes);
  const raw=await createSceneAudioCreationService(h.root).inspect({sceneObjectId:sceneId});assert.ok(raw.resources.some(row=>row.resourceId===newId&&row.availability==='unverified'));
  const built=await captureBuildSnapshot(h.root,sceneId);assert.equal(built.ok,false);assert.ok(built.diagnostics.length>0);
});
test('failed catalog refresh never writes a reviewed draft',async t=>{
  const h=await fixture(t),p=await h.proposal();h.beforeInspect=()=>{throw Object.assign(new Error('offline'),{errorCode:'scene_audio_resources_unavailable'});};await assert.rejects(h.host.applyDraft(p),rejected);assert.deepEqual(h.writes,[]);
});
