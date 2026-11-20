import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSceneBehaviorCreateReferences, isSceneBehaviorCreateReferences, sceneBehaviorCreateReferencesMatchOrigin, listSceneBehaviorCreateStringParameters, proposeSceneBehaviorCreateReference } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behavior-create-references.mjs';
import { captureSceneBehaviorReferenceDirectory, captureSceneBehaviorReferences, isSceneBehaviorReferences, sceneBehaviorReferenceValue } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behavior-reference-directory.mjs';
import { createSceneBehaviorCreationDraft } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behavior-create-plan.mjs';
const id=n=>String(n).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rev='sha256:'+'a'.repeat(64);
const scene=()=>({objectId:id(1),sourcePath:'documents/scenes/main.json',sourceRevision:rev});
const origin=()=>({worldId:'world:'+'a'.repeat(64),baseRevision:rev,scene:{...scene(),objectRevision:rev}});
const definition=()=>({objectId:id(2),sourcePath:'documents/actor.md',sourceRevision:rev,name:'Actor'});
const assembly=()=>({objectId:id(3),sourcePath:'documents/project.json',sourceRevision:rev,name:'Project'});
const raw=()=>({format:'viento-scene-behavior-reference-directory',schemaVersion:1,worldId:origin().worldId,revision:rev,scene:scene(),instances:[{instanceId:id(4),...definition()}],assemblies:[assembly()],selectedAssembly:{...assembly(),members:[{...scene(),name:'Main'}],inputMap:{objectId:id(5),sourcePath:'documents/input.json',sourceRevision:rev},actions:[{name:'start',keys:['Enter']}]}});
const captured=()=>captureSceneBehaviorCreateReferences(origin(),raw());
const proposal=(content,extra={})=>proposeSceneBehaviorCreateReference({content,catalog:captured(),origin:origin(),parameter:'target',kind:'instance',value:id(4),...extra});
const planned=()=>createSceneBehaviorCreationDraft({sceneObjectId:id(1),backendId:'org.viento.godot4',language:'gdscript',bindings:[{bindingId:id(6),instanceId:id(4),sourceObjectId:id(7)}]}).content;
test('unpaired-surrogate and unnormalized origin paths cannot be branded via matching corrupt directory data',()=>{
 for(const path of ['documents/bad\ud800.json','../escape.json','/absolute.json','documents/./scene.json','C:/scene.json']){
  const o=origin(),r=raw();o.scene.sourcePath=path;r.scene.sourcePath=path;r.selectedAssembly.members[0].sourcePath=path;
  assert.throws(()=>captureSceneBehaviorCreateReferences(o,r));
 }
});
test('nested directory accessors and decorated arrays are rejected without reading values',()=>{
 let calls=0;const a=raw();Object.defineProperty(a.instances,'0',{enumerable:true,get(){calls++;return {instanceId:id(4),...definition()}}});assert.throws(()=>captureSceneBehaviorCreateReferences(origin(),a));
 const b=raw();Object.defineProperty(b.selectedAssembly.actions[0].keys,'0',{enumerable:true,get(){calls++;return 'Enter'}});assert.throws(()=>captureSceneBehaviorCreateReferences(origin(),b));
 for(const mutate of [r=>{r.instances.extra=0},r=>{r.selectedAssembly.members[Symbol('extra')]=1},r=>{r.selectedAssembly.actions[0].keys=[]},r=>{r.selectedAssembly.actions[0].name='start\n'}]){
  const r=raw();mutate(r);assert.throws(()=>captureSceneBehaviorCreateReferences(origin(),r));
 }
 assert.equal(calls,0);
});
test('boxed strings and hidden proposal getters cannot coerce or supply an insertion',()=>{
 let calls=0;const bad={toString(){calls++;return '{"target":""}'}};
 assert.throws(()=>proposal(bad));assert.throws(()=>proposal('{"target":""}',{parameter:bad}));assert.throws(()=>proposal('{"target":""}',{value:bad}));
 const arg={content:'{"target":""}',catalog:captured(),origin:origin(),parameter:'target',kind:'action',value:'start'};Object.defineProperty(arg,'kind',{enumerable:true,get(){calls++;return 'action'}});assert.throws(()=>proposeSceneBehaviorCreateReference(arg));assert.equal(calls,0);
});
test('same-value no-op still validates unrelated scalar fields and source budgets',()=>{
 assert.throws(()=>proposal(JSON.stringify({target:id(4),bad:[]})));
 assert.throws(()=>proposal(JSON.stringify({target:id(4),bad:'x'.repeat(4097)})));
 const content='{"target":"sta\\u0072t","note":"𐐀","n":-0} \r\n';
 assert.deepEqual(proposal(content,{kind:'action',value:'start'}),{content,changed:false});
});
test('valid input at manifest budget cannot return an oversized token replacement',()=>{
 const body='{"target":"x"}', overhead=planned().length-2;
 const content=body+' '.repeat(32768-overhead-body.length);
 assert.equal(listSceneBehaviorCreateStringParameters(content)[0].value,'x');
 assert.throws(()=>proposal(content));
 assert.equal(content.startsWith(body),true);
});
test('old saved-source and first-creation brands remain disjoint in both directions',()=>{
 const c=captured(),old=captureSceneBehaviorReferences({sourcePath:'documents/behavior.json',token:'saved',baseSourceRevision:rev,sourceRevision:rev,content:planned()},raw(),scene());
 assert.equal(isSceneBehaviorCreateReferences(c),true);assert.equal(isSceneBehaviorReferences(c),false);
 assert.equal(isSceneBehaviorCreateReferences(old),false);assert.equal(isSceneBehaviorReferences(old),true);
 assert.throws(()=>sceneBehaviorReferenceValue(c,{kind:'instance',value:id(4)}));
 assert.throws(()=>proposal('{"target":""}',{catalog:old}));
 assert.equal(sceneBehaviorCreateReferencesMatchOrigin(JSON.parse(JSON.stringify(c)),origin()),false);
});
