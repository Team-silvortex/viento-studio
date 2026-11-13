import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectPauseReader,validateProjectPauseObservation,PROJECT_PAUSE_PREFIX} from '../../engine/project-pause-observation.mjs';
import {createProjectRuntimeEventReader} from '../../engine/project-runtime-events.mjs';
import {runtimeProject,projectReady,enterScene,readyScene,exitScene,finishProject,projectLine} from './helpers/project-runtime-fixture.mjs';
const p=runtimeProject(),a=p.scenes[0],b=p.scenes[1];
const row=(sequence,phase,extra={})=>({protocol:1,event:'state',sequence,visitIndex:1,sceneId:a.scene.objectId,phase,elapsedSeconds:.25,totalSeconds:.25,...extra});
const line=r=>PROJECT_PAUSE_PREFIX+JSON.stringify(r)+'\n';
function fixture(options={}){const base=createProjectRuntimeEventReader(p),snapshots=[];const reader=createProjectPauseReader(p,{runtimeReader:base,onSnapshot:v=>snapshots.push(v),...options});const send=f=>reader.push(projectLine(f));const start=()=>[projectReady(p),enterScene(a,1),readyScene(a,1)].forEach(send);return{reader,base,snapshots,send,start};}
test('pause transport is independent of unchanged business envelopes and ends while paused without a false resume',()=>{
 const f=fixture();assert.equal(f.reader.pause.phase,'waiting');f.start();assert.equal(f.reader.pause.state,'running');
 assert.deepEqual(f.reader.push(line(row(1,'paused'))),[]);assert.equal(f.reader.events.length,3);assert.equal(f.reader.pause.state,'paused');
 f.send(exitScene(a,1,.25));f.send(finishProject(p,1,.25));assert.deepEqual(f.reader.finish().diagnostics,[]);
 assert.equal(f.reader.pause.phase,'finished');assert.equal(f.reader.pause.state,'closed');assert.equal(f.reader.pause.totalTransitions,1);
 assert.deepEqual(validateProjectPauseObservation(f.reader.pause),f.reader.pause);const copy=f.reader.pause;copy.transitions[0].phase='running';assert.equal(f.reader.pause.transitions[0].phase,'paused');
});
test('streaming preserves fragmented prefixes, CRLF, Unicode and noise without swallowing delegated frames',()=>{
 const f=fixture(),text='engine noise\n'+[projectReady(p),enterScene(a,1),readyScene(a,1)].map(projectLine).join('')+line(row(1,'paused')).replace(/\n$/,'\r\n')+line(row(2,'waiting-for-release'))+line(row(3,'running'));
 for(const char of text)f.reader.push(char);assert.equal(f.reader.pause.state,'running');assert.equal(f.reader.pause.totalTransitions,3);assert.equal(f.reader.events.length,3);assert.deepEqual(f.reader.diagnostics,[]);
 f.send(exitScene(a,1,.5));f.send(finishProject(p,1,.5));assert.deepEqual(f.reader.finish().diagnostics,[]);
 const g=fixture();g.start();g.reader.push(line(row(1,'paused')).trimEnd());assert.equal(g.reader.pause.totalTransitions,0);g.reader.finish();assert.equal(g.reader.pause.totalTransitions,1);assert.equal(g.reader.pause.phase,'incomplete');
});
test('fresh pause admissions require a ready current visit, exact identity, sequence, phases, times and bounded rows',()=>{
 for(const mutate of [r=>({...r,sequence:2}),r=>({...r,visitIndex:2}),r=>({...r,sceneId:b.scene.objectId}),r=>({...r,phase:'running'}),r=>({...r,extra:true}),r=>({...r,protocol:2}),r=>({...r,totalSeconds:.1}),r=>({...r,elapsedSeconds:-1}),r=>({...r,event:'pause'}),r=>({...r,phase:'paused\n'}),r=>({...r,sceneId:p.assembly.objectId})]){
  const f=fixture();f.start();const before=f.reader.pause;f.reader.push(line(mutate(row(1,'paused'))));assert.deepEqual(f.reader.pause,before);assert.equal(f.reader.diagnostics.length,1);
 }
 for(const frames of [[],[projectReady(p),enterScene(a,1)]]){const f=fixture();frames.forEach(f.send);f.reader.push(line(row(1,'paused')));assert.equal(f.reader.pause.totalTransitions,0);assert.equal(f.reader.diagnostics.length,1);}
 const f=fixture();f.start();f.reader.push(PROJECT_PAUSE_PREFIX+'界'.repeat(2000)+'\n');assert.equal(f.reader.pause.totalTransitions,0);f.reader.push(line(row(1,'paused')));assert.equal(f.reader.pause.totalTransitions,1);
});
test('resume release barrier and focus cancellation keep clocks fixed; running permits monotonic progress',()=>{
 const f=fixture();f.start();for(const [seq,phase]of [[1,'paused'],[2,'waiting-for-release'],[3,'paused'],[4,'waiting-for-release'],[5,'running']])f.reader.push(line(row(seq,phase)));
 assert.equal(f.reader.pause.state,'running');assert.deepEqual(f.reader.diagnostics,[]);
 f.reader.push(line(row(6,'paused',{elapsedSeconds:.5,totalSeconds:.5})));const before=f.reader.pause;
 for(const extra of [{elapsedSeconds:.6,totalSeconds:.6},{elapsedSeconds:.2,totalSeconds:.2}]){f.reader.push(line(row(7,'waiting-for-release',extra)));assert.deepEqual(f.reader.pause,before);}
 f.reader.push(line(row(7,'waiting-for-release',{elapsedSeconds:.5,totalSeconds:.5})));assert.equal(f.reader.pause.totalTransitions,7);
});
test('bounded retention never resets admission sequence and allows a later scene to reset only its local clock',()=>{
 const f=fixture({retainedTransitions:2});f.start();for(let i=1;i<=150;i++)f.reader.push(line(row(i,['paused','waiting-for-release','running'][(i-1)%3])));
 assert.deepEqual(f.reader.pause.retention,{limit:2,total:150,retained:2,dropped:148,firstSequence:149,lastSequence:150});assert.deepEqual(validateProjectPauseObservation(f.reader.pause),f.reader.pause);
 f.send(exitScene(a,1,.5,b));f.send(enterScene(b,2));f.send(readyScene(b,2));f.reader.push(line(row(151,'paused',{visitIndex:2,sceneId:b.scene.objectId,elapsedSeconds:.1,totalSeconds:.6})));
 assert.equal(f.reader.pause.current.visitIndex,2);assert.equal(f.reader.pause.totalTransitions,151);assert.deepEqual(validateProjectPauseObservation(f.reader.pause),f.reader.pause);assert.deepEqual(f.reader.diagnostics,[]);
});
test('query rejects forged retention, state, current visits and frozen time while returning detached DTOs',()=>{
 const f=fixture();f.start();f.reader.push(line(row(1,'paused'))+line(row(2,'waiting-for-release')));const good=f.reader.pause;
 for(const mutate of [v=>v.retention.total++,v=>v.retention.dropped++,v=>v.totalTransitions++,v=>v.current.visitIndex++,v=>v.current.sceneId=b.scene.objectId,v=>v.transitions[1].elapsedSeconds=.3,v=>v.state='running',v=>v.transitions[0].sequence=9,v=>v.phase='finished',v=>v.extra=true,v=>v.transitions[0].sceneId=p.assembly.objectId]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateProjectPauseObservation(bad),{errorCode:'runtime_project_pause_invalid'});}
 for(const limit of [0,129,NaN,'32'])assert.throws(()=>fixture({retainedTransitions:limit}));
 const hostile={};Object.defineProperty(hostile,'format',{get(){throw Error('getter');},enumerable:true});assert.throws(()=>validateProjectPauseObservation(hostile));
});
test('observer exceptions stop further admission, retain the last accepted row and finalize incomplete exactly once',()=>{
 let count=0;const f=fixture({onSnapshot:s=>{if(s.totalTransitions){count++;throw Error('consumer');}}});f.start();assert.throws(()=>f.reader.push(line(row(1,'paused'))),/consumer/);assert.equal(f.reader.pause.phase,'incomplete');assert.deepEqual(f.reader.push(line(row(2,'waiting-for-release'))),[]);
 assert.throws(()=>f.reader.finish(),/consumer/);assert.equal(f.reader.pause.totalTransitions,1);assert.equal(count,2);assert.doesNotThrow(()=>f.reader.finish());
});
test('delegated finalization exceptions cannot masquerade as a completed pause observation or replay retained input',()=>{
 const base=createProjectRuntimeEventReader(p),reader=createProjectPauseReader(p,{runtimeReader:{get events(){return base.events;},get diagnostics(){return base.diagnostics;},push:t=>base.push(t),finish(){base.finish();throw Error('finish');}}});
 for(const f of [projectReady(p),enterScene(a,1),readyScene(a,1),exitScene(a,1,0),finishProject(p,1,0)])reader.push(projectLine(f));assert.throws(()=>reader.finish(),/finish/);assert.equal(reader.pause.phase,'incomplete');assert.deepEqual(reader.push(line(row(1,'paused'))),[]);assert.doesNotThrow(()=>reader.finish());
});

test('EOF completion and current visit follow newly admitted delegated tail frames without replay',()=>{
 const f=fixture();f.start();f.reader.push(line(row(1,'paused')));f.send(exitScene(a,1,.25));f.reader.push(projectLine(finishProject(p,1,.25)).trimEnd());assert.equal(f.reader.pause.phase,'recording');assert.deepEqual(f.reader.finish().diagnostics,[]);assert.equal(f.reader.pause.phase,'finished');assert.equal(f.reader.events.filter(e=>e.event==='finished').length,1);f.reader.finish();assert.equal(f.reader.events.length,5);
 const g=fixture();g.send(projectReady(p));g.reader.push(projectLine(enterScene(a,1)).trimEnd());g.reader.finish();assert.deepEqual(g.reader.pause.current,{visitIndex:1,sceneId:a.scene.objectId});assert.equal(g.reader.pause.state,'running');assert.equal(g.reader.pause.phase,'incomplete');
});

test('query cannot invent a first resume; final business clocks cannot move during pause or run backwards',()=>{
 const f=fixture();f.start();f.reader.push(line(row(1,'paused')));const forged=f.reader.pause;forged.state='running';forged.transitions[0].phase='running';assert.throws(()=>validateProjectPauseObservation(forged),{errorCode:'runtime_project_pause_invalid'});
 for(const elapsed of [0,.5]){const g=fixture();g.start();g.reader.push(line(row(1,'paused')));g.send(exitScene(a,1,elapsed));g.send(finishProject(p,1,elapsed));g.reader.finish();assert.equal(g.reader.pause.phase,'incomplete');assert.ok(g.reader.diagnostics.some(d=>d.code==='runtime_project_pause_invalid'));}
});
