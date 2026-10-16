import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createSceneAudioSourceHost} from '../../web/modules/app-scene-audio-source.js';
import {isSceneAudioAudition,sceneAudioAuditionBytes} from '../../engine/scene-audio-audition.mjs';
import {createSceneAudioCreationService} from '../lib/scene-audio-creation-service.mjs';
import {createSceneAudioTrackProposal} from '../../engine/scene-audio-edit.mjs';
import {buildHash} from '../adapters/node-build-snapshot.mjs';
const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',resourceId='99999999-9999-4999-8999-999999999999',sourcePath='documents/audio/demo.json';
const rejected=e=>/^(scene_audio_|build_audio_)/.test(e.errorCode||'');
function gate(){let ready,release;const entered=new Promise(r=>ready=r),promise=new Promise(r=>release=r);return{entered,release,wait:async()=>{ready();await promise;}};}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'viento-audition-host-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(new URL('../../examples/scene-audio/',import.meta.url),root,{recursive:true});
 const content=await fs.readFile(path.join(root,sourcePath),'utf8'),bytes=await fs.readFile(path.join(root,'assets/tone.wav'));
 const state={document:{},token:'audition-host',sourcePath,content,baseline:content,version:'sha256:'+buildHash(content),editable:true,creating:false,busy:false,available:true,resourcesAvailable:true,sourceJSON:true};
 const raw=await createSceneAudioCreationService(root).inspect({sceneObjectId:sceneId}),h={root,state,raw,bytes,writes:[],reads:[],inspections:0,digests:0};
 h.host=createSceneAudioSourceHost({getState:()=>({...state}),digest:async value=>{h.digests++;await h.beforeDigest?.(h.digests);return buildHash(value);},inspect:async()=>{h.inspections++;await h.beforeInspect?.();return structuredClone(h.raw);},writeDraft:content=>{h.writes.push(content);state.content=content;},readAudioBytes:async(resource,options)=>{h.reads.push({resource,signal:options.signal});await h.beforeBytes?.();return h.bytes;},digestBytes:async bytes=>{await h.beforeByteHash?.();return buildHash(bytes);}});
 h.source=await h.host.getSource();h.catalog=await h.host.getResources(h.source);h.load=options=>h.host.loadAudition(h.source,h.catalog,resourceId,options);return h;
}
test('audition host grants only a verified immutable read, without changing source draft or disk',async t=>{
 const h=await fixture(t),before=h.state.content,reads=h.inspections;assert.equal(h.host.getContext().auditionAvailable,true);const value=await h.load();assert.equal(isSceneAudioAudition(value),true);assert.equal(value.resourceId,resourceId);assert.deepEqual(new Uint8Array(sceneAudioAuditionBytes(value)),new Uint8Array(h.bytes));assert.equal(h.inspections,reads+1);assert.equal(h.reads.length,1);assert.equal(h.reads[0].resource.resourceId,resourceId);assert.deepEqual(h.writes,[]);assert.equal(h.state.content,before);assert.equal(await fs.readFile(path.join(h.root,sourcePath),'utf8'),before);
});
test('audition ownership is revoked at source hashes, catalog read/hash, resource read and byte hash',async t=>{
 for(const phase of ['base','source','inspect','catalogHash','bytes','byteHash'])for(const mutation of ['token','content','busy','resources']){
  const h=await fixture(t),g=gate();if(['base','source','catalogHash'].includes(phase)){const offset={base:1,source:2,catalogHash:3}[phase],target=h.digests+offset;h.beforeDigest=async n=>{if(n===target)await g.wait();};}else h[{inspect:'beforeInspect',bytes:'beforeBytes',byteHash:'beforeByteHash'}[phase]]=g.wait;
  const pending=h.load();await g.entered;if(mutation==='token')h.state.token+='next';if(mutation==='content')h.state.content+=' ';if(mutation==='busy')h.state.busy=true;if(mutation==='resources')h.state.resourcesAvailable=false;g.release();await assert.rejects(pending,rejected);assert.deepEqual(h.writes,[]);
 }
});
test('stop signal and UI ticket revoke reads while fetch or digest is pending',async t=>{
 for(const phase of ['beforeBytes','beforeByteHash'])for(const mode of ['abort','ticket']){
  const h=await fixture(t),g=gate(),aborter=new AbortController();let current=true;h[phase]=g.wait;
  const pending=h.load({signal:aborter.signal,isCurrent:()=>current});await g.entered;if(mode==='abort')aborter.abort();else current=false;g.release();await assert.rejects(pending);assert.deepEqual(h.writes,[]);
 }
});
test('mismatched source, catalog and resource are refused before byte reads',async t=>{
 const h=await fixture(t);await assert.rejects(h.host.loadAudition({...h.source,token:'wrong'},h.catalog,resourceId),rejected);await assert.rejects(h.host.loadAudition(h.source,{...h.catalog},resourceId),rejected);await assert.rejects(h.host.loadAudition(h.source,h.catalog,'12345678-1111-4111-8111-000000000001'),rejected);
 h.raw=structuredClone(h.raw);h.raw.baseRevision='sha256:'+'a'.repeat(64);await assert.rejects(h.load(),rejected);assert.deepEqual(h.reads,[]);assert.deepEqual(h.writes,[]);
});
test('tampered bytes fail before playback and leave the saved catalog as unverified',async t=>{
 const h=await fixture(t);h.bytes=Buffer.from(h.bytes);h.bytes[50]^=1;await assert.rejects(h.load(),rejected);assert.equal(h.catalog.resources[0].availability,'unverified');assert.deepEqual(h.writes,[]);
});
test('missing audition ports do not disable existing source and catalog editing',async t=>{
 const h=await fixture(t);for(const ports of [{},{readAudioBytes:()=>h.bytes},{digestBytes:buildHash}]){
  const host=createSceneAudioSourceHost({getState:()=>h.state,digest:buildHash,inspect:()=>h.raw,writeDraft:()=>assert.fail('unexpected write'),...ports});assert.equal(host.getContext().auditionAvailable,false);assert.equal(host.getContext().resourcesAvailable,true);assert.ok(await host.getSource());await assert.rejects(host.loadAudition(h.source,h.catalog,resourceId),rejected);
 }
});

test('explicit draft application invalidates old audition while the new unsaved draft remains eligible',async t=>{
 const h=await fixture(t),edit=JSON.parse(h.source.content);edit.tracks[0].volume=.25;
 const proposal=await createSceneAudioTrackProposal(h.source,{tracks:edit.tracks,cues:edit.cues}),g=gate();h.beforeBytes=g.wait;
 const pending=h.load();await g.entered;await h.host.applyDraft(proposal);g.release();await assert.rejects(pending,rejected);h.beforeBytes=null;
 assert.equal(h.writes.length,1);assert.equal(await fs.readFile(path.join(h.root,sourcePath),'utf8'),h.state.baseline);
 const source=await h.host.getSource(),catalog=await h.host.getResources(source);assert.equal(source.content,proposal.afterContent);assert.notEqual(source.sourceRevision,source.baseSourceRevision);
 const sound=await h.host.loadAudition(source,catalog,resourceId);assert.equal(isSceneAudioAudition(sound),true);assert.equal(h.writes.length,1);
});
