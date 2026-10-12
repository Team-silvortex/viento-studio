import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import * as core from '../../../engine/studio-core.mjs';
import { createScene3DTranslationProposal, isScene3DTranslationProposal, prepareScene3DTranslationApply } from '../../../engine/scene3d-translation.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal, prepareScene3DPropertiesApply } from '../../../engine/scene3d-properties.mjs';
import { isScene3DTransformProposal, prepareScene3DTransformApply } from '../../../engine/scene3d-transform.mjs';
import { isScene3DObjectsProposal, prepareScene3DObjectsApply } from '../../../engine/scene3d-objects.mjs';
import { isScene3DEnvironmentProposal, prepareScene3DEnvironmentApply } from '../../../engine/scene3d-environment.mjs';
const root=new URL('../../../',import.meta.url),out=new URL('./',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex'),revision=value=>'sha256:'+sha(value);
await core.initializeStudioCore(()=>fs.readFile(new URL('engine/studio-core.wasm',root)));
const runtime=await fs.readFile(new URL('web/modules/app-runtime.js',root),'utf8');
const original='\ufeff'+(await fs.readFile(new URL('examples/scene3d/scene.json',root),'utf8')).replaceAll('\n','\r\n');
const sourceModel=JSON.parse(original.slice(1)),ids=sourceModel.objects.map(o=>o.instanceId).reverse();
const readonly=runtime.slice(runtime.indexOf('let scene3DSourceReadEpoch'),runtime.indexOf('\nasync function applySceneCompositionOverrideDraft'));
const host=runtime.slice(runtime.indexOf('let scene3DTransformReadEpoch'),runtime.indexOf('\nasync function applySceneSourceLayoutDraft'));
assert.ok(host.includes('applyScene3DTranslationDraft')&&host.includes('applyScene3DAuthoringDraft'));
const beforeHash=sha(runtime),cases=[],counts={overlappingApplications:0,replacedOwners:0};
async function run(name,fn){try{await fn();cases.push({name,ok:true});}catch(e){cases.push({name,ok:false,error:e.stack||String(e)});}}
function fixture(){
 let content=original,doc={path:'scene',_sourceCachedText:original},busy=false,editable=true,digests=0,blockAt=0,release;
 const writes=[],statuses=[],state={isEditing:true,isCreating:false,editInputMode:'source',activeEditPath:'scene',activeEditSource:'documents/scene.json',editHasUnsavedChanges:false};
 const editor={value:original,selectionStart:19,selectionEnd:33,scrollTop:97,focusCount:0,setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},focus(){this.focusCount++;}};
 const ctx=vm.createContext({state,editorLoadToken:5,scenePreviewDraftEpoch:11,TextEncoder,editSessionBaselineContent:original,editSessionVersion:revision(original),editEditorEl:editor,
  isScene3DTranslationProposal,prepareScene3DTranslationApply,isScene3DPropertiesProposal,prepareScene3DPropertiesApply,isScene3DTransformProposal,prepareScene3DTransformApply,
  isScene3DObjectsProposal,prepareScene3DObjectsApply,isScene3DEnvironmentProposal,prepareScene3DEnvironmentApply,
  getActiveDoc:()=>doc,isEditModeActive:()=>editable,isEditorBusy:()=>busy,canonicalizeSourcePath:v=>v||'',getCurrentEditContent:()=>content,
  setSourceEditorContent(v){writes.push(v);content=v;editor.value=v;},refreshEditSessionDirtyState(){state.editHasUnsavedChanges=content!==ctx.editSessionBaselineContent;ctx.scenePreviewDraftEpoch++;},
  refreshEditButtons(){},t:v=>v,setEditorStatus:v=>statuses.push(v),crypto:{subtle:{async digest(algorithm,bytes){if(++digests===blockAt)await new Promise(r=>release=r);return webcrypto.subtle.digest(algorithm,bytes);}}}});
 vm.runInContext(readonly+'\n'+host,ctx);
 return {ctx,state,editor,writes,statuses,source:()=>ctx.getScene3DTransformSourceSnapshot(),content:()=>content,doc:()=>doc,
  setDoc:v=>{doc=v;},setContent:v=>{content=v;editor.value=v;},setBusy:v=>{busy=v;},setEditable:v=>{editable=v;},
  blockNext(n){blockAt=digests+n;release=undefined;},async blocked(){for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,2));assert.equal(typeof release,'function');},release:()=>release()};
}
const translation=async h=>createScene3DTranslationProposal(await h.source(),{instanceIds:ids,offset:[4,-2,8]});
const conflict=e=>e?.errorCode==='scene3d_translation_conflict';
const savedUntouched=h=>{assert.equal(h.ctx.editSessionBaselineContent,original);assert.equal(h.ctx.editSessionVersion,revision(original));assert.equal(h.doc()._sourceCachedText,original);};
await run('actual host reads five author source fields while preview remains three and applies one complete multi-object content write',async()=>{
 const h=fixture(),s=await h.source(),read=await h.ctx.getScene3DSourceSnapshot();
 assert.deepEqual(Object.keys(s).sort(),['baseSourceRevision','content','sourcePath','sourceRevision','token']);assert.deepEqual(Object.keys(read).sort(),['content','sourcePath','token']);
 const p=createScene3DTranslationProposal(s,{instanceIds:ids,offset:[4,-2,8]}),receipt=await h.ctx.applyScene3DTranslationDraft(p);
 assert.deepEqual(h.writes,[p.afterContent]);assert.equal(h.content(),p.afterContent);assert.equal(receipt.content,p.afterContent);assert.notEqual(receipt.sourceToken,s.token);
 assert.equal(h.state.editHasUnsavedChanges,true);savedUntouched(h);assert.equal(h.editor.selectionStart,19);assert.equal(h.editor.selectionEnd,33);assert.equal(h.editor.scrollTop,97);
});
await run('overlapping equal branded translations commit at most one complete content and reject the superseded application',async()=>{
 for(const boundary of [1,2,3]){
  const h=fixture(),p=await translation(h);h.blockNext(boundary);const first=h.ctx.applyScene3DTranslationDraft(p);await h.blocked();
  const winner=await h.ctx.applyScene3DTranslationDraft(p);assert.equal(winner.applied,true);h.release();await assert.rejects(first,conflict);
  assert.deepEqual(h.writes,[p.afterContent]);assert.equal(h.content(),p.afterContent);savedUntouched(h);counts.overlappingApplications++;
 }
});
await run('an older property author winning during translation await revokes all pending translated targets without partial writes',async()=>{
 for(const boundary of [1,2,3]){
  const h=fixture(),source=await h.source(),p=createScene3DTranslationProposal(source,{instanceIds:ids,offset:[4,-2,8]}),other=createScene3DPropertiesProposal(source,{instanceId:ids[0],values:{color:'#AbCdEf'}});
  h.blockNext(boundary);const pending=h.ctx.applyScene3DTranslationDraft(p);await h.blocked();await h.ctx.applyScene3DPropertiesDraft(other);h.release();await assert.rejects(pending,conflict);
  assert.deepEqual(h.writes,[other.afterContent]);assert.equal(h.content(),other.afterContent);assert.equal(h.statuses.length,1);savedUntouched(h);counts.overlappingApplications++;
 }
});
await run('cancel or same-path document reload at each digest keeps draft and saved cache unchanged',async()=>{
 for(const boundary of [1,2,3])for(const mode of ['cancel','doc','load','bytes']){
  const h=fixture(),p=await translation(h);let current=true;h.blockNext(boundary);const pending=h.ctx.applyScene3DTranslationDraft(p,{isCurrent:()=>current});await h.blocked();
  if(mode==='cancel')current=false;if(mode==='doc')h.setDoc({...h.doc()});if(mode==='load')h.ctx.editorLoadToken++;if(mode==='bytes')h.setContent(original+'\t');
  const content=h.content();h.release();await assert.rejects(pending,conflict);assert.equal(h.content(),content);assert.deepEqual(h.writes,[]);assert.equal(h.statuses.length,0);savedUntouched(h);counts.replacedOwners++;
 }
});
await run('a successful completion focus cannot target a new same-path document, load or later source buffer',async()=>{
 for(const mode of ['doc','load','bytes']){
  const h=fixture(),p=await translation(h),r=await h.ctx.applyScene3DTranslationDraft(p);r.focus();assert.equal(h.editor.focusCount,1);
  if(mode==='doc')h.setDoc({...h.doc()});if(mode==='load')h.ctx.editorLoadToken++;if(mode==='bytes')h.setContent(p.afterContent+' ');
  r.focus();assert.equal(h.editor.focusCount,1);assert.equal(h.writes.length,1);savedUntouched(h);counts.replacedOwners++;
 }
});
const afterRuntime=await fs.readFile(new URL('web/modules/app-runtime.js',root)),output=process.argv[2];assert.ok(output&&/^[a-z0-9-]+\.json$/.test(output));
const r={format:'viento-scene3d-translation-independent-host-quality',schemaVersion:1,observedAt:new Date().toISOString(),node:process.version,
 ok:cases.every(c=>c.ok)&&beforeHash===sha(afterRuntime),passed:cases.filter(c=>c.ok).length,failed:cases.filter(c=>!c.ok).length,cases,counts,
 source:{path:'web/modules/app-runtime.js',beforeSha256:beforeHash,afterSha256:sha(afterRuntime),stable:beforeHash===sha(afterRuntime)},
 scope:'Actual source reader/wrapper/shared draft application code with real native-backed proposals and deterministic editor/digest fixtures. Tests count complete source writes and race ownership; no actual DOM/HTTP Save, file writes, builds, GPU/backend/device or installed acceptance claim.'};
await fs.writeFile(new URL(output,out),JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:r.ok,passed:r.passed,failed:r.failed,counts}));for(const c of cases.filter(c=>!c.ok))console.error(c.name+'\n'+c.error);process.exitCode=r.ok?0:1;
