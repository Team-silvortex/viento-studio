import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
await import('../../../scripts/adapters/node-studio-core.mjs');
const {createSceneAudioCueProposal,readSceneAudioDocument,prepareSceneAudioApply}=await import('../../../engine/scene-audio-edit.mjs');
const {parseJsonSource,locateJsonSource}=await import('../../../engine/json-source.mjs');
const hash=v=>createHash('sha256').update(v).digest('hex');const id=n=>`12345678-1234-4234-8234-${String(n).padStart(12,'0')}`;
const outside=content=>{const r=locateJsonSource(parseJsonSource(content),'/cues');return[content.slice(0,r.start),content.slice(r.end)]};
let count=0;
for(const format of ['compact','spaces','tabs-crlf','escaped'])for(let size=0;size<=5;size++)for(let mask=0;mask<(1<<size);mask++)for(let add=0;add<=2;add++){
 const doc={format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:[{id:id(2),resourceId:id(3),role:'music',volume:.5,loop:true}],cues:Array.from({length:size},(_,i)=>({id:id(10+i),trackId:id(2),atSeconds:i/10,action:i%2?'stop':'play'}))};
 let content=JSON.stringify(doc,null,format==='compact'?undefined:format==='tabs-crlf'?'\t':2);if(format==='tabs-crlf')content='\ufeff'+content.replaceAll('\n','\r\n')+'\r\n';if(format==='escaped')content=content.replaceAll('"atSeconds"','"at\\u0053econds"').replace('"volume": 0.5','"volume": 5e-1');
 const rows={tracks:doc.tracks.map(({id,role,volume,loop})=>({id,role,volume,loop})),cues:doc.cues.filter((_,i)=>mask&(1<<i)).map(v=>({...v}))};for(let i=0;i<add;i++)rows.cues.push({id:id(20+i),trackId:id(2),atSeconds:.25,action:i?'stop':'play'});
 if(rows.cues.length===size&&mask===(1<<size)-1&&add===0)continue;
 const source={content,sourcePath:'documents/audio/matrix.json',token:'matrix',sourceRevision:'sha256:'+hash(content),baseSourceRevision:'sha256:'+hash(content)};
 const p=await createSceneAudioCueProposal(source,rows);assert.deepEqual(outside(p.afterContent),outside(content));assert.deepEqual((await readSceneAudioDocument(p.afterContent)).cues,rows.cues);assert.deepEqual(p.changedPaths,['/cues']);assert.equal((await prepareSceneAudioApply(source,p,{digest:hash})).afterContent,p.afterContent);count++;
}
const report={ok:true,scenarios:count,formats:['compact','spaces','tabs-crlf','escaped'],properties:['all ordered subsets of 0–5 original cues','0–2 appended cues','array-exterior byte preservation','exact semantic candidate','guarded apply recomputes identical bytes'],scope:'Deterministic independent source-format matrix. Functional regression tests are separately recorded.'};console.log(JSON.stringify(report,null,2));
