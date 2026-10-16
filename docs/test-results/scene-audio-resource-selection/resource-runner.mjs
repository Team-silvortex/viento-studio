import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url))),out=path.dirname(fileURLToPath(import.meta.url));
const hash=v=>createHash('sha256').update(v).digest('hex'),rev=v=>'sha256:'+hash(v),id=n=>`12345678-1234-4234-8234-${String(n).padStart(12,'0')}`,load=p=>import(pathToFileURL(path.join(root,p)).href);
const model=n=>({format:'viento-scene-audio',schemaVersion:1,sceneObjectId:id(1),tracks:Array.from({length:n},(_,i)=>({id:id(10+i),resourceId:id(2),role:i?'effect':'music',volume:.5,loop:!i})),cues:[{id:id(40),trackId:id(10),atSeconds:0,action:'play'},{id:id(41),trackId:id(10),atSeconds:.25,action:'stop'}]});
const source=content=>({sourcePath:'documents/audio/test.json',token:'resources:verification',baseSourceRevision:rev(content),sourceRevision:rev(content),content});
const context=(s,n)=>({format:'viento-audio-creation-context',schemaVersion:1,status:'ready',worldId:'world:'+hash('world'),baseRevision:rev('world'),documentRoot:'documents',documentTypes:[{id:'audio',label:'Audio'}],scene:{objectId:id(1),objectRevision:rev('scene'),sourcePath:'documents/scenes/test.json',sourceRevision:rev('scene-source')},manifest:{objectId:id(50),objectRevision:rev('manifest'),sourcePath:s.sourcePath,sourceRevision:s.baseSourceRevision,documentType:'audio',parserProfile:'structured',content:s.content,relations:[{kind:'reference',targetId:id(1),slot:'scene'}],assetBindings:[2,3,4].map(n=>({assetId:id(n),role:'audio'})),trackCount:n},resources:[2,3,4].map(n=>({resourceId:id(n),resourceRevision:rev('resource'+n),name:'Sound '+n,sourcePath:'tone-'+n+'.wav',sha256:hash('bytes'+n),size:512,availability:'unverified'}))});
async function initialize(base){const core=await load(path.join(base,'engine/studio-core.mjs'));await core.initializeStudioCore(()=>fs.readFile(path.join(root,base,'engine/studio-core.wasm')));return{edit:await load(path.join(base,'engine/scene-audio-edit.mjs')),resources:await load(path.join(base,'engine/scene-audio-resources.mjs'))};}
const forms=[m=>JSON.stringify(m),m=>JSON.stringify(m,null,2)+'\n',m=>'\ufeff'+JSON.stringify(m,null,'\t').replaceAll('\n','\r\n')+'\r\n',m=>JSON.stringify(m,null,2).replaceAll('"resourceId"','"resource\\u0049d"').replaceAll('0.5','5e-1')+'\n'];
if(process.argv.includes('--prepared')){
 const files=['engine/scene-audio-edit.mjs','engine/scene-audio-resources.mjs','engine/scene-audio-core.mjs','engine/studio-core.mjs','engine/studio-core.wasm','web/modules/app-scene-audio.js','web/modules/app-scene-audio-source.js','web/modules/app-runtime.js','web/scene-audio.css','web/i18n/en.js','web/i18n/ja.js'];
 const report={ok:false,comparisons:[],calls:[],scope:'Real WASM in source and prepared modules; not installed or device acceptance.'};
 for(const base of ['desktop/resources','mobile/dist'])for(const file of files){const a=await fs.readFile(path.join(root,file)),b=await fs.readFile(path.join(root,base,file));assert.deepEqual(a,b);report.comparisons.push({base,file,sha256:hash(a)});}
 let expected;
 for(const base of ['','desktop/resources','mobile/dist']){
  const {edit,resources}=await initialize(base),m=model(2),s=source(forms[2](m)),raw=context(s,2),catalog=resources.captureSceneAudioResources(s,raw);
  const input={tracks:m.tracks.map((row,i)=>({...row,resourceId:id(3),volume:i?.25:.5})),cues:m.cues.map(row=>({...row}))};
  const p=await edit.createSceneAudioResourceProposal(s,input,catalog),fresh=resources.captureSceneAudioResources(s,raw);assert.equal((await edit.prepareSceneAudioApply(s,p,{digest:hash,resources:fresh})).afterContent,p.afterContent);
  await assert.rejects(edit.createSceneAudioTrackProposal(s,input),{errorCode:'scene_audio_authoring_invalid'});assert.deepEqual((await edit.readSceneAudioDocument(p.afterContent)).cues,m.cues);
  if(expected)assert.equal(p.afterContent,expected);else expected=p.afterContent;report.calls.push({base:base||'source',resourceSelection:true,stableIdentity:true,freshCatalog:true,oldTrackApiRejects:true,actualWasm:true});
 }
 report.ok=true;await fs.writeFile(path.join(out,'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,comparisons:report.comparisons.length,calls:report.calls.length}));
}else{
 const {edit,resources}=await initialize('');const {parseJsonSource,locateJsonSource}=await load('engine/json-source.mjs');let cases=0;
 for(const form of forms)for(let n=1;n<=4;n++){
  const m=model(n),s=source(form(m)),raw=context(s,n);
  for(let combination=1;combination<3**n;combination++){
   let number=combination;const tracks=m.tracks.map(row=>{const result={...row,resourceId:id(2+number%3)};number=Math.floor(number/3);return result;});
   const p=await edit.createSceneAudioResourceProposal(s,{tracks,cues:m.cues},resources.captureSceneAudioResources(s,raw));
   let expected=s.content;const parsed=parseJsonSource(s.content),patches=tracks.flatMap((row,i)=>row.resourceId===id(2)?[]:[{...locateJsonSource(parsed,`/tracks/${i}/resourceId`),text:JSON.stringify(row.resourceId)}]);
   for(const patch of patches.reverse())expected=expected.slice(0,patch.start)+patch.text+expected.slice(patch.end);
   assert.equal(p.afterContent,expected);assert.equal((await edit.prepareSceneAudioApply(s,p,{digest:hash,resources:resources.captureSceneAudioResources(s,raw)})).afterContent,expected);assert.deepEqual((await edit.readSceneAudioDocument(expected)).tracks,tracks);cases++;
  }
 }
 const report={ok:true,cases,formats:4,tracks:[1,2,3,4],boundResources:3,verified:['Only intended resourceId value bytes changed','Original track and cue identities and array order retained','Fresh catalog and saved/source hash revalidation','Actual Rust WASM semantics']};await fs.writeFile(path.join(out,'format-matrix.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
