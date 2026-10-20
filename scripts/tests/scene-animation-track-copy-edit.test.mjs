import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copySceneAnimationTrackDraft, createSceneAnimationProposal, prepareSceneAnimationApply, isSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
const id = n => `71717171-7171-4171-8171-${String(n).padStart(12,'0')}`;
const model = (version=3) => ({ format:'viento-scene-animation',schemaVersion:version,sceneObjectId:id(1),durationSeconds:2,loop:true,
  tracks:[{id:id(2),instanceId:id(3),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[0,1]},{atSeconds:1,value:[5,6]},{atSeconds:2,value:[20,30]}]},
    ...(version>=2?[{id:id(4),instanceId:id(3),property:'spriteFrame2d',interpolation:'step',grid:{columns:2,rows:2},keyframes:[{atSeconds:0,value:0},{atSeconds:.5,value:3}]}]:[])],
  ...(version===3?{clips:[{id:id(5),name:'歩く / Walk',startSeconds:.5,endSeconds:2,loop:false}]}:{}) });
const fields=d=>({durationSeconds:d.durationSeconds,loop:d.loop,tracks:structuredClone(d.tracks),...(d.schemaVersion===3?{clips:structuredClone(d.clips)}:{})});
const digest=s=>createHash('sha256').update(s).digest('hex');
const encoded=d=>'\ufeff'+JSON.stringify(d,null,'\t').replaceAll('\n','\r\n')+'\r\n';
const source=content=>({sourcePath:'documents/animations/copy.json',token:'copy:1',content,baseSourceRevision:'sha256:'+digest(content),sourceRevision:'sha256:'+digest(content)});
for(const version of [1,2,3]) test(`copy current v${version} track adds local data then follows the ordinary structural proposal`,async()=>{
  const doc=model(version),content=encoded(doc).replace('"durationSeconds": 2','"durationSeconds": 2e0');
  const input=fields(doc),original=structuredClone(input),result=await copySceneAnimationTrackDraft(content,input,id(2),id(8),id(9));
  assert.equal(isSceneAnimationProposal(result),false);assert.ok(Object.isFrozen(result.tracks.at(-1).keyframes[0].value));
  assert.deepEqual(input,original);assert.deepEqual(result,{...doc,tracks:[...doc.tracks,{...doc.tracks[0],id:id(9),instanceId:id(8)}]});
  const proposal=await createSceneAnimationProposal(source(content),fields(result));assert.deepEqual(proposal.changedPaths,['/tracks']);
  assert.ok(proposal.afterContent.startsWith('\ufeff'));assert.ok(proposal.afterContent.includes('"durationSeconds": 2e0'));
  assert.equal(proposal.afterContent.replaceAll('\r\n','').includes('\n'),false);
  const after=JSON.parse(proposal.afterContent.slice(1));assert.deepEqual(after,result);
  assert.equal((await prepareSceneAnimationApply(source(content),proposal,{digest})).afterContent,proposal.afterContent);
  await assert.rejects(prepareSceneAnimationApply(source(content+' '),proposal,{digest}),{errorCode:'scene_animation_authoring_conflict'});
});

test('copy preserves current unsaved frames, grid and clip changes with the target identity explicit',async()=>{
  const doc=model(),input=fields(doc);input.tracks[1].grid.columns=4;input.tracks[1].keyframes[1]={atSeconds:.75,value:7};
  input.tracks[0].keyframes[1].value=[99,98];input.clips[0].name='未保存の名前';input.loop=false;
  const result=await copySceneAnimationTrackDraft(encoded(doc),input,id(4),id(8),id(9));
  assert.deepEqual(result.tracks.slice(0,2),input.tracks);assert.deepEqual(result.tracks[2],{...input.tracks[1],id:id(9),instanceId:id(8)});
  assert.deepEqual(result.clips,input.clips);assert.equal(result.loop,false);assert.equal(result.sceneObjectId,doc.sceneObjectId);
});

test('copy shares normal schema promotion and keeps omitted existing clips',async()=>{
  const old=model(1);
  for(const version of [2,3]) {
    const result=await copySceneAnimationTrackDraft(encoded(old),fields(model(version)),id(4),id(8),id(9));
    assert.equal(result.schemaVersion,version);assert.deepEqual(result.tracks.at(-1).grid,{columns:2,rows:2});
  }
  const input=fields(model());delete input.clips;
  assert.deepEqual((await copySceneAnimationTrackDraft(encoded(model()),input,id(2),id(8),id(9))).clips,model().clips);
});

test('missing sources duplicate channels or IDs and invalid full forms reject without partial input changes',async()=>{
  const doc=model(),content=encoded(doc),input=fields(doc),before=structuredClone(input);
  for(const args of [[id(99),id(8),id(9)],[id(2),id(3),id(9)],[id(2),id(8),id(4)],[id(2),'bad',id(9)],[null,id(8),id(9)],[id(2),id(8),{}]]) {
    await assert.rejects(copySceneAnimationTrackDraft(content,input,...args));assert.deepEqual(input,before);
  }
  for(const mutate of [v=>v.durationSeconds=.5,v=>v.clips[0].endSeconds=3,v=>v.tracks[1].keyframes[0].value=9,v=>v.tracks[0].keyframes[0].value[0]=NaN]) {
    const changed=fields(doc);mutate(changed);const snapshot=structuredClone(changed);
    await assert.rejects(copySceneAnimationTrackDraft(content,changed,id(2),id(8),id(9)));assert.deepEqual(changed,snapshot);
  }
});

test('copy rejects getters and inherited or extra form properties without invoking hooks',async()=>{
  const doc=model();let calls=0;const input=fields(doc);
  Object.defineProperty(input.tracks[0],'keyframes',{enumerable:true,get(){calls++;return doc.tracks[0].keyframes;}});
  await assert.rejects(copySceneAnimationTrackDraft(encoded(doc),input,id(2),id(8),id(9)));assert.equal(calls,0);
  for(const value of [Object.create(fields(doc)),{...fields(doc),extra:true}]) await assert.rejects(copySceneAnimationTrackDraft(encoded(doc),value,id(2),id(8),id(9)));
});

test('copy captures the current complete form before its first await',async()=>{
  const doc=model(),input=fields(doc),pending=copySceneAnimationTrackDraft(encoded(doc),input,id(2),id(8),id(9));
  input.tracks[0].keyframes[1].value[0]=999;input.tracks.splice(0,1);input.clips[0].name='late mutation';
  const result=await pending;assert.deepEqual(result.tracks.at(-1),{...doc.tracks[0],id:id(9),instanceId:id(8)});assert.deepEqual(result.clips,doc.clips);
});
