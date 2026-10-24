import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSceneAnimationInstanceVisualFrame} from '../../engine/scene-animation-instance-visual-frame.mjs';
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const actors=[{instanceId:id(1),objectId:id(3)},{instanceId:id(2),objectId:id(3)}];
const frame=(n,time=n)=>({instanceId:id(n),sample:{timeSeconds:time,localTimeSeconds:time,finished:n===2,values:[{trackId:id(n+10),instanceId:id(n),property:'offset2d',value:[10*n,time]}]}});
test('independent sample clocks form a detached frozen per-instance visual layer',()=>{
 const input=[frame(1,.25),frame(2,1.5)],result=captureSceneAnimationInstanceVisualFrame(actors,input);
 assert.deepEqual(result.map(row=>[row.instanceId,row.offset2d]),[[id(1),[10,.25]],[id(2),[20,1.5]]]);
 assert.ok(Object.isFrozen(result));assert.ok(result.every(Object.isFrozen));assert.ok(result.every(row=>Object.isFrozen(row.offset2d)));
 input[0].sample.values[0].value[0]=800;assert.equal(result[0].offset2d[0],10);assert.equal(result[1].opacity,1);
});
test('foreign or mixed targets and duplicate global track identities reject the complete visual layer',()=>{
 const cases=[[frame(1),frame(1)],[{...frame(1),instanceId:id(2)}],[frame(3)],[]];
 const mixed=frame(1);mixed.sample.values.push(frame(2).sample.values[0]);cases.push([mixed]);
 const duplicate=[frame(1),frame(2)];duplicate[1].sample.values[0].trackId=duplicate[0].sample.values[0].trackId;cases.push(duplicate);
 for(const input of cases)assert.throws(()=>captureSceneAnimationInstanceVisualFrame(actors,input),TypeError);
});
test('renderer boundary rejects sparse/accessor/custom fields without invoking caller accessors',()=>{
 let calls=0;const get=()=>{calls++;return frame(1);};const sparse=Array(2);sparse[0]=frame(1);
 const indexed=[];Object.defineProperty(indexed,0,{get,enumerable:true});
 const inputs=[null,{},sparse,indexed,Object.assign([frame(1)],{extra:1}),[{get instanceId(){return get();},sample:frame(1).sample}],
  [{instanceId:id(1),get sample(){return get();}}],[{...frame(1),extra:1}],[Object.create(frame(1))]];
 for(const input of inputs)assert.throws(()=>captureSceneAnimationInstanceVisualFrame(actors,input),TypeError);
 assert.equal(calls,0);
});
test('32 tracks across targets is accepted and a 33rd track rejects even when each sample is individually valid',()=>{
 const members=Array.from({length:32},(_,i)=>({instanceId:id(i+1)})),input=members.map((_,i)=>frame(i+1,0));
 assert.equal(captureSceneAnimationInstanceVisualFrame(members,input).length,32);
 input[0].sample.values.push({trackId:id(99),instanceId:id(1),property:'opacity',value:.5});
 assert.throws(()=>captureSceneAnimationInstanceVisualFrame(members,input),TypeError);
});
test('independent sprite crops preserve per-instance grids and channels',()=>{
 const input=[frame(1),frame(2)];input[0].sample.values.push({trackId:id(30),instanceId:id(1),property:'spriteFrame2d',value:2,grid:{columns:2,rows:2}});
 input[1].sample.values.push({trackId:id(31),instanceId:id(2),property:'spriteFrame2d',value:5,grid:{columns:3,rows:2}});
 const output=captureSceneAnimationInstanceVisualFrame(actors,input);assert.deepEqual(output.map(row=>row.spriteFrame2d),[{columns:2,rows:2,index:2},{columns:3,rows:2,index:5}]);
 assert.ok(output.every(row=>Object.isFrozen(row.spriteFrame2d)));
});
