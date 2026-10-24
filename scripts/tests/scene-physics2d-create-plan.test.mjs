import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePhysics2DCreationDraft } from '../../engine/scene-physics2d-create-plan.mjs';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
const id = n => `${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const input = () => ({sceneObjectId:id(1),bodyId:id(2),instanceId:id(3),kind:'character',shape:{kind:'box',size:[32,64]},offset:[0,-8],layer:1,mask:65535});
for(const kind of ['static','character','sensor'])for(const shape of [{kind:'box',size:[1,8192]},{kind:'circle',radius:0.5},{kind:'circle',radius:4096}]){
  test(`${kind}/${JSON.stringify(shape)} starter preserves allocated identities and native shape boundaries`,()=>{
    const raw={...input(),kind,shape},before=structuredClone(raw),result=createScenePhysics2DCreationDraft(raw);
    assert.equal(result.ok,true);assert.deepEqual(raw,before);assert.ok(Object.isFrozen(result));
    const document=inspectScenePhysics2D(JSON.parse(result.content)).document;
    assert.deepEqual(document,{format:'viento-scene-physics2d',schemaVersion:1,sceneObjectId:id(1),bodies:[{id:id(2),instanceId:id(3),kind,shape,offset:[0,-8],layer:1,mask:65535}]});
    raw.offset[0]=99;assert.equal(JSON.parse(result.content).bodies[0].offset[0],0);
  });
}
test('starter rejects incomplete settings invalid native bounds and nonfinite values without partial text',()=>{
  for(const patch of [{extra:true},{sceneObjectId:'bad'},{bodyId:'bad'},{instanceId:'bad'},{kind:'rigid'},{shape:{kind:'box',size:[0,2]}},{shape:{kind:'box',size:[1,8193]}},{shape:{kind:'circle',radius:.4}},{shape:{kind:'circle',radius:4097}},{shape:{kind:'box',size:[1,1],radius:1}},{shape:{kind:'capsule',radius:1}},{offset:[8193,0]},{offset:[NaN,0]},{offset:[0]},{offset:[0,0,0]},{layer:-1},{mask:65536},{layer:1.5},{layer:NaN},{mask:Infinity},{shape:{kind:'circle',radius:'1'}},{offset:'0,0'}]){
    const result=createScenePhysics2DCreationDraft({...input(),...patch});assert.equal(result.ok,false,JSON.stringify(patch));assert.equal(result.content,null);assert.equal(result.diagnostics[0].code,'build_physics_invalid');assert.ok(Object.isFrozen(result.diagnostics[0]));
  }
});
test('starter capture never invokes getters serializers or inherited/decorated arrays',()=>{
  let calls=0;const getter=()=>{calls++;return 1;},cases=[];
  const top=input();Object.defineProperty(top,'layer',{get:getter,enumerable:true});cases.push(top);
  const shape=input();Object.defineProperty(shape.shape,'kind',{get:getter,enumerable:true});cases.push(shape);
  const radius={kind:'circle'};Object.defineProperty(radius,'radius',{get:getter,enumerable:true});cases.push({...input(),shape:radius});
  const vector=[20,30];Object.defineProperty(vector,'0',{get:getter,enumerable:true});cases.push({...input(),offset:vector});
  cases.push({...input(),shape:{kind:'box',size:Object.assign([1,2],{extra:0})}});cases.push({...input(),offset:[,0]});cases.push(Object.assign(Object.create({}),input()));
  cases.push({...input(),shape:{kind:'circle',radius:{toJSON(){calls++;return 1;}}}});
  for(const value of cases)assert.equal(createScenePhysics2DCreationDraft(value).ok,false);assert.equal(calls,0);
  Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value(){calls++;return [];}});
  try{assert.equal(createScenePhysics2DCreationDraft(input()).ok,false);assert.equal(calls,0);}finally{delete Array.prototype.toJSON;}
});
