import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneAnimationCreationDraft } from '../../engine/scene-animation-create-plan.mjs';
import { inspectSceneAnimation, sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
const id = n => `${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const input = () => ({ sceneObjectId:id(1),trackId:id(2),instanceId:id(3),property:'offset2d',durationSeconds:2,loop:false,endValue:[20,-30] });
for (const [property,identity,endValue] of [['offset2d',[0,0],[20,-30]],['rotation2d',0,180],['scale2d',[1,1],[2,.5]],['opacity',1,.25]]) {
  test(`${property} starter uses Rust semantics and fixed identity with two linear keyframes`, () => {
    const raw={...input(),property,endValue},before=structuredClone(raw),result=createSceneAnimationCreationDraft(raw);
    assert.equal(result.ok,true);assert.deepEqual(raw,before);assert.ok(Object.isFrozen(result.diagnostics));
    const document=inspectSceneAnimation(JSON.parse(result.content)).document;
    assert.deepEqual(document.tracks[0],{id:id(2),instanceId:id(3),property,interpolation:'linear',keyframes:[{atSeconds:0,value:identity},{atSeconds:2,value:endValue}]});
    assert.deepEqual(sampleSceneAnimation(document,0).values[0].value,identity);
    assert.deepEqual(sampleSceneAnimation(document,2).values[0].value,endValue);
    if(Array.isArray(raw.endValue)) raw.endValue[0]=999;
    assert.deepEqual(JSON.parse(result.content),document);
  });
}
test('looping starter and tiny positive durations retain exact Rust boundary semantics',()=>{
  for(const durationSeconds of [Number.MIN_VALUE,60]){const result=createSceneAnimationCreationDraft({...input(),durationSeconds,loop:true});assert.equal(result.ok,true);const sample=sampleSceneAnimation(JSON.parse(result.content),durationSeconds);assert.equal(sample.localTimeSeconds,0);assert.equal(sample.finished,false);}
});
test('invalid and unbounded creation fields produce a frozen failure without partial author source',()=>{
  for(const patch of [{extra:true},{sceneObjectId:'bad'},{trackId:'bad'},{instanceId:'bad'},{property:'position'},{property:'__proto__'},
    {durationSeconds:0},{durationSeconds:61},{durationSeconds:NaN},{loop:0},{endValue:[0]},{endValue:[0,0,0]},{endValue:[NaN,0]},
    {endValue:[10001,0]},{property:'opacity',endValue:2},{property:'scale2d',endValue:[0,1]},{property:'rotation2d',endValue:36001},{endValue:'20,30'}]){
    const result=createSceneAnimationCreationDraft({...input(),...patch});assert.equal(result.ok,false,JSON.stringify(patch));assert.equal(result.content,null);assert.ok(Object.isFrozen(result));assert.equal(result.diagnostics[0].code,'build_animation_invalid');
  }
});
test('draft capture never invokes getters serializers prototypes or decorated array values',()=>{
  let calls=0;const getter=()=>{calls++;return 1;};
  const cases=[];const root=input();Object.defineProperty(root,'durationSeconds',{get:getter,enumerable:true});cases.push(root);
  const vector=[20,30];Object.defineProperty(vector,'0',{get:getter,enumerable:true});cases.push({...input(),endValue:vector});
  const serializer={toJSON(){calls++;return 1;}};cases.push({...input(),property:'opacity',endValue:serializer});
  cases.push({...input(),endValue:Object.assign([1,2],{x:0})});cases.push({...input(),endValue:[,2]});cases.push(Object.assign(Object.create({}),input()));
  for(const raw of cases)assert.equal(createSceneAnimationCreationDraft(raw).ok,false);assert.equal(calls,0);
  Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){calls++;return {};}});
  try{assert.equal(createSceneAnimationCreationDraft(input()).ok,false);assert.equal(calls,0);}finally{delete Object.prototype.toJSON;}
});
