import test from 'node:test';
import assert from 'node:assert/strict';
import '../adapters/node-studio-core.mjs';
import {resolveSceneAnimation,validateSceneAnimationPlan,stripSceneAnimationPlan,sceneAnimationCapabilities} from '../../engine/scene-animation.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,revision='sha256:'+'a'.repeat(64);
const doc=(scope='instance')=>({format:'viento-scene-animation',schemaVersion:4,playbackScope:scope,sceneObjectId:id(1),durationSeconds:2,loop:false,tracks:[{id:id(2),instanceId:id(3),property:'opacity',interpolation:'linear',keyframes:[{atSeconds:0,value:1}]}],clips:[{id:id(4),name:'Attack',startSeconds:.5,endSeconds:2,loop:false}]});
function plan(document=doc()){
 const base={format:'viento-build-plan',schemaVersion:2,kind:'scene2d',scene:{objectId:id(1)},actors:[{instanceId:id(3)}],resources:[],requiredCapabilities:sceneAnimationCapabilities(document)};
 const observed={source:{documents:[{record:{id:id(1),relations:[{kind:'animation',targetId:id(5)}]},sourcePath:'documents/scene.json',sourceRevision:revision},{record:{id:id(5),format:'viento-document',sourcePath:'documents/animation.json',relations:[{kind:'reference',targetId:id(1)}]},sourcePath:'documents/animation.json',sourceRevision:revision,content:JSON.stringify(document,null,2)}]}};
 const result=resolveSceneAnimation(observed,base);assert.deepEqual(result.diagnostics,[]);return {...base,animation:result.animation};
}
test('v4 scopes use animation subplan3 without changing parent scene schema or source mapping',()=>{
 for(const scope of ['scene','instance']){const p=plan(doc(scope));assert.equal(p.schemaVersion,2);assert.equal(p.animation.schemaVersion,3);assert.equal(p.animation.document.playbackScope,scope);assert.deepEqual(validateSceneAnimationPlan(p),p.animation);assert.deepEqual(Object.keys(p.animation.locations),['tracks','clips']);assert.equal(p.animation.locations.clips[0].declaration.propertyPath,'/clips/0');assert.equal(p.requiredCapabilities.includes('animation.instances2d'),scope==='instance');assert.deepEqual(stripSceneAnimationPlan(p).requiredCapabilities,[]);assert.deepEqual(stripSceneAnimationPlan(p).resources,[]);}
});
test('missing scope capability, downgraded subplan, foreign mapping or wrong scope is rejected',()=>{
 for(const change of [p=>p.requiredCapabilities=p.requiredCapabilities.filter(c=>c!=='animation.instances2d'),p=>p.animation.schemaVersion=2,p=>p.animation.schemaVersion=1,p=>delete p.animation.document.playbackScope,p=>p.animation.document.playbackScope='all',p=>p.animation.locations.clips[0].id=id(9),p=>p.animation.locations.tracks[0].declaration.objectId=id(9)]){const p=structuredClone(plan());change(p);assert.throws(()=>validateSceneAnimationPlan(p),{errorCode:'build_animation_invalid'});}
});
test('legacy plans retain old subplan schemas and capabilities; empty v4 clips remain explicit',()=>{
 for(const version of [1,2,3]){const d=doc();d.schemaVersion=version;delete d.playbackScope;if(version<3)delete d.clips;const p=plan(d);assert.equal(p.animation.schemaVersion,version===3?2:1);assert.equal(p.requiredCapabilities.includes('animation.instances2d'),false);assert.deepEqual(validateSceneAnimationPlan(p),p.animation);}
 const p=plan({...doc(),clips:[]});assert.equal(p.animation.schemaVersion,3);assert.deepEqual(p.animation.locations.clips,[]);assert.deepEqual(validateSceneAnimationPlan(p),p.animation);
});
