import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectRuntimeEventReader} from '../../engine/project-runtime-events.mjs';
import {createProjectRuntimeObservation,queryProjectRuntimeObservation} from '../../engine/project-runtime-query.mjs';
import {createProjectCausalAnchors} from '../../engine/project-causal-anchors.mjs';
import {runtimeProject,projectReady,enterScene,readyScene,exitScene,finishProject,projectLine} from './helpers/project-runtime-fixture.mjs';

const send=(reader,frames)=>frames.flatMap(frame=>reader.push(projectLine(frame)));
test('same-scene visits require explicit reader admission and retain a new child lifecycle',()=>{
 const p=runtimeProject(),a=p.scenes[0],initial=[projectReady(p),enterScene(a,1),readyScene(a,1)],restart=exitScene(a,1,.25,a);
 for(const options of [{},{allowSceneRestart:false}]){
  const r=createProjectRuntimeEventReader(p,options);send(r,initial);assert.deepEqual(send(r,[restart]),[]);assert.equal(r.diagnostics.length,1);assert.equal(r.events.at(-1).event,'scene-event');
 }
 const r=createProjectRuntimeEventReader(p,{allowSceneRestart:true});send(r,initial);assert.equal(send(r,[restart,enterScene(a,2),readyScene(a,2),exitScene(a,2,.25),finishProject(p,2,.5)]).length,5);
 assert.deepEqual(r.finish().diagnostics,[]);assert.equal(r.events.filter(e=>e.event==='scene-enter').length,2);
 for(const value of [null,'true',1,{},[]])assert.throws(()=>createProjectRuntimeEventReader(p,{allowSceneRestart:value}),{errorCode:'runtime_project_invalid'});
});
test('same-scene observation revokes old samples at exit and survives query and causal-review consumers',()=>{
 const p=runtimeProject(),a=p.scenes[0],o=createProjectRuntimeObservation(p,{allowSceneRestart:true});
 const push=f=>assert.equal(o.push(f),true,JSON.stringify(f));
 [projectReady(p),enterScene(a,1),readyScene(a,1)].forEach(push);
 const first=o.snapshot();assert.equal(first.project.sceneRestart,true);assert.deepEqual(queryProjectRuntimeObservation(first),first);
 push(exitScene(a,1,.25,a));const between=o.snapshot();assert.equal(between.phase,'waiting');assert.ok(between.actors.every(x=>x.position===null));assert.equal(between.project.activeSceneId,a.scene.objectId);assert.deepEqual(queryProjectRuntimeObservation(between),between);assert.doesNotThrow(()=>createProjectCausalAnchors(between));
 push(enterScene(a,2));assert.ok(o.snapshot().actors.every(x=>x.position===null));push(readyScene(a,2));const second=o.snapshot();assert.deepEqual(second.actors.map(x=>x.position),first.actors.map(x=>x.position));assert.deepEqual(second.project.visits.map(x=>[x.index,x.sceneId]),[[1,a.scene.objectId],[2,a.scene.objectId]]);assert.deepEqual(queryProjectRuntimeObservation(second),second);
 const before=structuredClone(second);assert.equal(o.push(readyScene(a,1)),false);assert.deepEqual(o.snapshot(),before);
 const old=structuredClone(second);delete old.project.sceneRestart;assert.throws(()=>queryProjectRuntimeObservation(old));
 for(const flag of [false,null,1,'true']){const v=structuredClone(second);v.project.sceneRestart=flag;assert.throws(()=>queryProjectRuntimeObservation(v));}
 push(exitScene(a,2,.25));push(finishProject(p,2,.5));assert.equal(queryProjectRuntimeObservation(o.snapshot()).phase,'finished');
});
test('restart-aware reader still enforces visit count, monotonically increasing identity and unchanged default snapshots',()=>{
 const p=runtimeProject(),a=p.scenes[0],r=createProjectRuntimeEventReader(p,{allowSceneRestart:true});send(r,[projectReady(p)]);
 for(let index=1;index<=64;index++){
  assert.equal(send(r,[enterScene(a,index),readyScene(a,index)]).length,2);
  if(index<64)assert.equal(send(r,[exitScene(a,index,0,a)]).length,1);
 }
 assert.deepEqual(send(r,[exitScene(a,64,0,a)]),[]);assert.equal(r.diagnostics.length,1);assert.equal(send(r,[exitScene(a,64,0),finishProject(p,64,0)]).length,2);
 assert.equal(Object.hasOwn(createProjectRuntimeObservation(p).snapshot().project,'sceneRestart'),false);
 const o=createProjectRuntimeObservation(p,{allowSceneRestart:true});[projectReady(p),enterScene(a,1),readyScene(a,1),exitScene(a,1,0,a)].forEach(f=>assert.equal(o.push(f),true));const before=o.snapshot();assert.equal(o.push(enterScene(a,1)),false);assert.deepEqual(o.snapshot(),before);
});
