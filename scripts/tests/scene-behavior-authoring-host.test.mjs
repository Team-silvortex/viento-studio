import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
const original = await fs.readFile(new URL('../../examples/scene-behaviors/documents/behaviors/demo.json',import.meta.url),'utf8');
const hash = value => createHash('sha256').update(value).digest('hex'), revision = value => `sha256:${hash(value)}`;
const dependencyRevision = 'sha256:'+'e'.repeat(64), conflict = { errorCode:'scene_behavior_authoring_conflict' };
function fixture() {
  const doc={saved:original};
  const state={document:doc,token:'1',sourcePath:'documents/behaviors/demo.json',content:original,baseline:original,version:revision(original),editable:true,creating:false,busy:false,available:true,sourceJSON:true};
  const writes=[];let focuses=0,digests=0,blockAt=0,release,reviewHook=()=>{},reviews=0,dependency=dependencyRevision;
  const host=createSceneBehaviorSourceHost({getState:()=>({...state}),digest:async value=>{if(++digests===blockAt)await new Promise(r=>{release=r;});return hash(value);},
    inspect:async payload=>{reviews++;await reviewHook(payload);return{format:'viento-behavior-authoring-context',schemaVersion:1,sourcePath:payload.sourcePath,dependencyRevision:dependency};},
    writeDraft:content=>{writes.push(content);state.content=content;state.token+='a';},focus:()=>focuses++});
  return {host,state,writes,doc,get focuses(){return focuses;},get reviews(){return reviews;},review:fn=>{reviewHook=fn;},changeDependency:()=>{dependency='sha256:'+'f'.repeat(64);},block(offset=1){blockAt=digests+offset;release=null;},async blocked(){for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,1));assert.ok(release);},release:()=>release()};
}
async function proposal(h){const source=await h.host.getSource();const value=JSON.parse(source.content);value.bindings[0].parameters.amount=65;return createSceneBehaviorProposal(source,{bindings:value.bindings});}

test('behavior host applies only an owned reviewed draft and preserves saved authority',async()=>{
 const h=fixture(),p=await proposal(h),result=await h.host.applyDraft(p,{dependencyRevision});
 assert.equal(result.applied,true);assert.equal(h.writes.length,1);assert.equal(h.state.content,p.afterContent);assert.equal(h.state.baseline,original);assert.equal(h.doc.saved,original);assert.equal(h.state.version,revision(original));
 assert.equal(h.reviews,1);result.focus();assert.equal(h.focuses,1);h.state.content+=' ';result.focus();assert.equal(h.focuses,1);
 await assert.rejects(h.host.applyDraft(p,{dependencyRevision}),conflict);
});
test('behavior host rejects cloned proposals without requesting dependency review',async()=>{
 const h=fixture(),p=await proposal(h);for(const value of [{...p},structuredClone(p)])await assert.rejects(h.host.applyDraft(value,{dependencyRevision}),conflict);
 assert.deepEqual(h.writes,[]);assert.equal(h.reviews,0);
});
test('behavior host revokes approval at every digest boundary on context or source changes',async()=>{
 for(const offset of [1,2,3])for(const key of ['content','baseline','version','document','token','sourcePath','busy','editable','available','creating']){
  const h=fixture(),p=await proposal(h);h.block(offset);const pending=h.host.applyDraft(p,{dependencyRevision});await h.blocked();
  if(['content','baseline','version','token','sourcePath'].includes(key))h.state[key]+=' ';
  else if(key==='document')h.state.document={...h.doc};else h.state[key]=!h.state[key];
  h.release();await assert.rejects(pending,conflict);assert.deepEqual(h.writes,[],`${offset}:${key}`);
 }
});
test('late dependency review and caller cancellation cannot write another owner',async()=>{
 for(const change of ['source','capability','caller','dependency']){
  const h=fixture(),p=await proposal(h);let current=true;
  h.review(()=>{if(change==='source')h.state.content+=' ';if(change==='capability')h.state.available=false;if(change==='caller')current=false;if(change==='dependency')h.changeDependency();});
  await assert.rejects(h.host.applyDraft(p,{dependencyRevision,isCurrent:()=>current}),conflict);assert.deepEqual(h.writes,[]);
 }
});
test('reader and entry recognition require current editable behavior JSON with matching save revision',async()=>{
 const h=fixture();assert.equal(h.host.getContext().behaviorSource,true);
 for(const change of [s=>s.available=false,s=>s.creating=true,s=>s.busy=true,s=>s.editable=false,s=>s.content='{}',s=>s.content='{',s=>s.version=revision('another')]){
  const f=fixture();change(f.state);assert.equal(await f.host.getSource(),null);
 }
 h.block(2);const pending=h.host.getSource();await h.blocked();h.state.document={};h.release();assert.equal(await pending,null);
});

test('behavior recognition recovers when a host changes its JSON capability for the same source',async()=>{
 const h=fixture();h.state.sourceJSON=false;assert.equal(h.host.getContext().behaviorSource,false);assert.equal(await h.host.getSource(),null);
 h.state.sourceJSON=true;assert.equal(h.host.getContext().behaviorSource,true);assert.ok(await h.host.getSource());
 h.state.sourceJSON=false;assert.equal(h.host.getContext().behaviorSource,false);assert.equal(await h.host.getSource(),null);
});
