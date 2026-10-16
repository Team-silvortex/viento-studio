import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
await import('../../../scripts/adapters/node-studio-core.mjs');
const {createSceneAudioTimelineProposal,readSceneAudioDocument,prepareSceneAudioApply}=await import('../../../engine/scene-audio-edit.mjs');
const {sampleSceneAudio}=await import('../../../engine/scene-audio-core.mjs');
const {parseJsonSource,locateJsonSource}=await import('../../../engine/json-source.mjs');
const hash=v=>createHash('sha256').update(v).digest('hex');const id=n=>`12345678-1234-4234-8234-${String(n).padStart(12,'0')}`;
const outside=content=>{const r=locateJsonSource(parseJsonSource(content),'/cues');return[content.slice(0,r.start),content.slice(r.end)]};
const token=(content,index)=>{const r=locateJsonSource(parseJsonSource(content),`/cues/${index}`);return content.slice(r.start,r.end);};
function permutations(items){if(items.length<2)return[items];return items.flatMap((item,index)=>permutations(items.filter((_,i)=>i!==index)).map(rest=>[item,...rest]));}
let scenarios=0;
for(const format of ['compact','spaces','tabs-crlf','escaped'])for(const timeMode of ['equal','distinct'])for(let size=1;size<=4;size++)for(const order of permutations(Array.from({length:size},(_,i)=>i)))for(let binding=0;binding<(1<<size);binding++){
 const doc={format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:[{id:id(2),resourceId:id(3),role:'music',volume:.5,loop:true},{id:id(4),resourceId:id(3),role:'effect',volume:.2,loop:false}],cues:Array.from({length:size},(_,i)=>({id:id(10+i),trackId:id(2),atSeconds:timeMode==='equal'?.25:i/10,action:i%2?'stop':'play'}))};
 let content=JSON.stringify(doc,null,format==='compact'?undefined:format==='tabs-crlf'?'\t':2);if(format==='tabs-crlf')content='\ufeff'+content.replaceAll('\n','\r\n')+'\r\n';if(format==='escaped')content=content.replaceAll('"trackId"','"track\\u0049d"').replace('"volume": 0.5','"volume": 5e-1');
 const cues=order.map(i=>({...doc.cues[i],trackId:id(binding&(1<<i)?4:2)}));if(order.every((v,i)=>v===i)&&binding===0)continue;
 const rows={tracks:doc.tracks.map(({id,role,volume,loop})=>({id,role,volume,loop})),cues};
 const source={content,sourcePath:'documents/audio/matrix.json',token:'matrix',sourceRevision:'sha256:'+hash(content),baseSourceRevision:'sha256:'+hash(content)};
 const p=await createSceneAudioTimelineProposal(source,rows);assert.deepEqual(outside(p.afterContent),outside(content));const after=await readSceneAudioDocument(p.afterContent);assert.deepEqual(after.cues,cues);
 for(let i=0;i<size;i++){const original=doc.cues.findIndex(c=>c.id===cues[i].id);if(cues[i].trackId===doc.cues[original].trackId)assert.equal(token(p.afterContent,i),token(content,original));}
 const expected=[...cues].sort((a,b)=>a.atSeconds-b.atSeconds);assert.deepEqual(sampleSceneAudio(after,1).commands.map(c=>[c.cueId,c.trackId,c.atSeconds,c.action]),expected.map(c=>[c.id,c.trackId,c.atSeconds,c.action]));
 assert.equal((await prepareSceneAudioApply(source,p,{digest:hash})).afterContent,p.afterContent);scenarios++;
}
console.log(JSON.stringify({ok:true,scenarios,formats:['compact','spaces','tabs-crlf','escaped'],properties:['all permutations of 1–4 cues','all two-track target assignments','equal-time stable ordering and distinct-time sorting','array-exterior and unchanged cue fragment byte preservation','guarded apply reproduces the candidate'],scope:'Independent deterministic matrix; not additional unique tests to sum with other suites.'},null,2));
