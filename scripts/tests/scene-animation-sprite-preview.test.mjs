import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { captureSceneAnimationPreview } from '../../engine/scene-animation-preview.mjs';
import { captureSceneAnimationSpriteLayout, scenePreviewImageDimensions } from '../../engine/scene-animation-sprite-layout.mjs';
import { captureSceneAnimationVisualFrame } from '../../engine/scene-animation-visual-frame.mjs';
import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { animationPreviewFixture, fingerprint, sceneId, imageId, scenePath, animationPath } from './helpers/scene-animation-scene-preview-fixture.mjs';
const instance='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
async function fixture(t) {
  const f=await animationPreviewFixture(t);
  await f.edit(animationPath,doc=>{doc.schemaVersion=2;doc.tracks.push({id:'12121212-1212-4212-8212-121212121212',instanceId:instance,property:'spriteFrame2d',interpolation:'step',grid:{columns:2,rows:2},keyframes:[{atSeconds:0,value:0},{atSeconds:.5,value:1},{atSeconds:1,value:3}]});});
  const service=createScenePreviewService(f.root,{enabled:true});t.after(()=>service.close());
  return {...f,service,preview:()=>service.create({sceneId,includeAnimation:true})};
}
test('sprite preview uses frozen existing image bytes and independent instance grid layout without author writes',async t=>{
  const f=await fixture(t),before=await fingerprint(f.root),p=await f.preview();
  assert.equal(p.animationPreview.status,'ready',JSON.stringify(p.animationPreview));
  const catalog=captureSceneAnimationPreview(p),layout=captureSceneAnimationSpriteLayout(p);
  assert.deepEqual(layout,[{instanceId:instance,columns:2,rows:2}]);assert.ok(Object.isFrozen(layout[0]));
  assert.deepEqual(scenePreviewImageDimensions(p.actors,imageId,layout),{width:p.actors[0].size[0]*2,height:p.actors[0].size[1]*2});
  const bytes=Buffer.from(f.service.resource(p.previewId,imageId).bytes);
  await f.edit(animationPath,doc=>{doc.tracks.at(-1).grid.columns=3;});
  assert.equal(catalog.document.tracks.at(-1).grid.columns,2);assert.deepEqual(f.service.resource(p.previewId,imageId).bytes,bytes);
  // Only the explicit fixture edit changed authored data, never capture/playback.
  const after=await fingerprint(f.root);delete before[animationPath];delete after[animationPath];assert.deepEqual(after,before);
  for(const [time,index] of [[0,0],[.49,0],[.5,1],[1,3],[2,0]]) {
    const sampled=sampleSceneAnimation(catalog.document,time),frame=captureSceneAnimationVisualFrame(p.actors,sampled);
    assert.deepEqual(frame[0].spriteFrame2d,{columns:2,rows:2,index});
  }
});
test('missing image invalidates only optional animation while static scene remains readable',async t=>{
  const f=await fixture(t);await f.edit(scenePath,scene=>{delete scene.actors[0].imageResourceId;});
  const p=await f.preview();assert.equal(p.ok,true);assert.equal(p.animationPreview.status,'invalid');assert.deepEqual(p.diagnostics,[]);
  assert.equal(captureSceneAnimationPreview(p).status,'invalid');assert.deepEqual(captureSceneAnimationSpriteLayout(p),[]);
});
test('ready sprite envelopes reject forged image membership and accessors without evaluating them',async t=>{
  const f=await fixture(t),p=await f.preview();let calls=0;
  for(const mutate of [p=>delete p.actors[0].imageResourceId,p=>p.resources=[],p=>p.resources.push({...p.resources[0]}),
    p=>Object.defineProperty(p.actors[0],'imageResourceId',{enumerable:true,get(){calls++;return imageId;}}),
    p=>Object.defineProperty(p.resources[0],'id',{enumerable:true,get(){calls++;return imageId;}})]) {
    const value=structuredClone(p);mutate(value);assert.throws(()=>captureSceneAnimationPreview(value),{errorCode:'scene_animation_preview_invalid'});
  }assert.equal(calls,0);
});
test('decode requirements combine shared static and animated uses and refuse forged layouts',async t=>{
  const f=await fixture(t),p=await f.preview(),layout=captureSceneAnimationSpriteLayout(p);
  const actors=[{instanceId:instance,imageResourceId:imageId,size:[20.1,10.2]},{instanceId:'other',imageResourceId:imageId,size:[90,15]}];
  assert.deepEqual(scenePreviewImageDimensions(actors,imageId,layout),{width:90,height:22});
  assert.deepEqual(scenePreviewImageDimensions(actors,imageId),{width:90,height:15});
  assert.throws(()=>scenePreviewImageDimensions(actors,imageId,structuredClone(layout)));
  actors[0].size=[Infinity,10];assert.throws(()=>scenePreviewImageDimensions(actors,imageId,layout));
});
test('sprite visual capture rejects invalid grids indices extra fields and getters as an atomic frame',()=>{
  const s=()=>({timeSeconds:0,localTimeSeconds:0,finished:false,values:[{trackId:'12121212-1212-4212-8212-121212121212',instanceId:instance,property:'spriteFrame2d',grid:{columns:2,rows:2},value:1}]});
  for(const mutate of [s=>s.values[0].value=.5,s=>s.values[0].value=-1,s=>s.values[0].value=4,s=>s.values[0].grid.columns=65,s=>s.values[0].grid.rows=0,s=>s.values[0].grid.rows=1.5,s=>s.values[0].grid.extra=true,s=>delete s.values[0].grid]) {
    const value=s();mutate(value);assert.throws(()=>captureSceneAnimationVisualFrame([{instanceId:instance}],value));
  }
  let calls=0;const value=s();Object.defineProperty(value.values[0].grid,'columns',{enumerable:true,get(){calls++;return 2;}});
  assert.throws(()=>captureSceneAnimationVisualFrame([{instanceId:instance}],value));assert.equal(calls,0);
});
