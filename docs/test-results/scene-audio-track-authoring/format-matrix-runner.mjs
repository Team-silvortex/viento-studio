import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
await import('../../../scripts/adapters/node-studio-core.mjs');
const {createSceneAudioTrackProposal,readSceneAudioDocument,prepareSceneAudioApply}=await import('../../../engine/scene-audio-edit.mjs');
const {sampleSceneAudio}=await import('../../../engine/scene-audio-core.mjs');
const {parseJsonSource,locateJsonSource}=await import('../../../engine/json-source.mjs');
const hash=v=>createHash('sha256').update(v).digest('hex');const id=n=>`12345678-1234-4234-8234-${String(n).padStart(12,'0')}`;
const token=(content,key,index)=>{const r=locateJsonSource(parseJsonSource(content),`/${key}/${index}`);return content.slice(r.start,r.end);};
const shell=content=>{const parsed=parseJsonSource(content),ranges=['tracks','cues'].map(key=>locateJsonSource(parsed,'/'+key)).sort((a,b)=>a.start-b.start);return[content.slice(0,ranges[0].start),content.slice(ranges[0].end,ranges[1].start),content.slice(ranges[1].end)];};
let scenarios=0;
for(const format of ['compact','spaces','tabs-crlf','escaped'])for(let size=1;size<=4;size++)for(let mask=0;mask<(1<<size);mask++)for(let added=0;added<=2;added++)for(let resource=0;resource<Math.min(size,2);resource++)for(const timeMode of ['equal','distinct']){
 const doc={format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:Array.from({length:size},(_,i)=>({id:id(10+i),resourceId:id(30+i%2),role:i%2?'effect':'music',volume:.25,loop:i%2===0})),cues:Array.from({length:size},(_,i)=>({id:id(50+i),trackId:id(10+i),atSeconds:timeMode==='equal'?.25:i/10,action:i%2?'stop':'play'}))};
 const tracks=doc.tracks.filter((_,i)=>mask&(1<<i));for(let i=0;i<added;i++)tracks.push({...doc.tracks[resource],id:id(70+i)});if(!tracks.length)continue;
 const retained=new Set(tracks.map(t=>t.id));const cues=doc.cues.map(c=>retained.has(c.trackId)?c:{...c,trackId:tracks[0].id}).reverse();
 if(JSON.stringify({tracks,cues})===JSON.stringify({tracks:doc.tracks,cues:doc.cues}))continue;
 let content=JSON.stringify(doc,null,format==='compact'?undefined:format==='tabs-crlf'?'\t':2)+'\n';
 if(format==='tabs-crlf')content='\ufeff'+content.replaceAll('\n','\r\n');
 if(format==='escaped')content=content.replaceAll('"resourceId"','"resour\\u0063eId"').replaceAll('0.25','2.5e-1');
 const source={sourcePath:'documents/audio/format.json',token:'matrix:tracks',baseSourceRevision:'sha256:'+hash(content),sourceRevision:'sha256:'+hash(content),content};
 const proposal=await createSceneAudioTrackProposal(source,{tracks,cues}),after=await readSceneAudioDocument(proposal.afterContent);assert.deepEqual(after,{...doc,tracks,cues});assert.deepEqual(shell(proposal.afterContent),shell(content));
 for(const [newIndex,track]of tracks.entries()){const oldIndex=doc.tracks.findIndex(t=>t.id===track.id);if(oldIndex>=0)assert.equal(token(proposal.afterContent,'tracks',newIndex),token(content,'tracks',oldIndex));}
 for(const[newIndex,cue]of cues.entries()){const oldIndex=doc.cues.findIndex(c=>c.id===cue.id);if(JSON.stringify(cue)===JSON.stringify(doc.cues[oldIndex]))assert.equal(token(proposal.afterContent,'cues',newIndex),token(content,'cues',oldIndex));}
 const sample=sampleSceneAudio(after,1);assert.deepEqual(sample.commands.map(c=>[c.cueId,c.trackId,c.resourceId]),[...cues].sort((a,b)=>a.atSeconds-b.atSeconds).map(c=>[c.id,c.trackId,tracks.find(t=>t.id===c.trackId).resourceId]));
 assert.equal((await prepareSceneAudioApply(source,proposal,{digest:hash})).afterContent,proposal.afterContent);scenarios++;
}
console.log(JSON.stringify({ok:true,scenarios,formats:['compact','spaces','tabs-crlf','escaped'],properties:['1–4 source tracks, all retained subsets, 0–2 appended tracks with existing resources','same-time order and distinct-time sorting after cue rebinding','both array exteriors and untouched row fragments preserve bytes','guarded apply recomputes the candidate'],scope:'Independent deterministic matrix; overlapping suite coverage is not summed.'},null,2));
