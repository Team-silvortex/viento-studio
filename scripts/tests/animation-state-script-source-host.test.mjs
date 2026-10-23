import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_ANIMATION_STATE_TABLE, generateGodotAnimationStateScript } from '../../engine/godot-animation-state-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal } from '../../engine/animation-state-script-edit.mjs';
import { createAnimationStateScriptSourceHost } from '../../web/modules/app-animation-state-script-source.js';

const table=()=>structuredClone(DEFAULT_ANIMATION_STATE_TABLE),hash=value=>createHash('sha256').update(value).digest('hex');
const content=value=>'\ufeff'+generateEditableGodotAnimationStateScript(value??table()).content.replaceAll('\n','\r\n');
const conflict={errorCode:'animation_state_script_authoring_conflict'};
function fixture() {
  const original=content(),state={document:{},token:'host:1',sourcePath:'documents/scripts/状态.txt',content:original,baseline:original,version:'sha256:'+hash(original),
    editable:true,creating:false,busy:false,available:true,sourceTXT:true};
  let calls=0,at=0,release,focuses=0,hashResult=null;
  const writes=[];
  const host=createAnimationStateScriptSourceHost({getState:()=>({...state}),digest:async value=>{
    if(++calls===at) await new Promise(resolve=>{release=resolve;});
    return hashResult===null?hash(value):hashResult;
  },writeDraft:value=>{writes.push(value);state.content=value;state.token+=':draft';},focus:()=>focuses++});
  return {host,state,writes,original,focuses:()=>focuses,block(offset){at=calls+offset;release=undefined;},
    async blocked(){for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(release);},
    release:()=>release(),badDigest(value){hashResult=value;}};
}
const next=()=>({...table(),initialState:'action'});
const proposalFor=async h=>createAnimationStateScriptProposal(await h.host.getSource(),next());

test('the independent source host exposes only context snapshots and ordinary draft application',async()=>{
  const h=fixture();assert.deepEqual(Object.keys(h.host).sort(),['applyDraft','getContext','getSource']);
  const context=h.host.getContext();assert.deepEqual(Object.keys(context).sort(),['available','busy','creating','editable','sourcePath','sourceTXT','sourceToken','stateTableSource']);
  assert.equal(context.stateTableSource,true);const snapshot=await h.host.getSource();
  assert.deepEqual(Object.keys(snapshot).sort(),['baseSourceRevision','content','sourcePath','sourceRevision','token']);assert.ok(Object.isFrozen(snapshot));
  const proposal=await proposalFor(h),result=await h.host.applyDraft(proposal);
  assert.deepEqual(h.writes,[proposal.afterContent]);assert.equal(h.state.baseline,h.original);assert.equal(h.state.version,'sha256:'+hash(h.original));
  assert.equal(result.applied,true);assert.equal(result.content,proposal.afterContent);assert.equal(result.sourceToken,h.host.getContext().sourceToken);
  assert.deepEqual(readAnimationStateScriptSource(result.content).table,next());result.focus();assert.equal(h.focuses(),1);
  h.state.content+=' ';result.focus();assert.equal(h.focuses(),1);await assert.rejects(h.host.applyDraft(proposal),conflict);
});

test('marked hand-edited invalid and unsupported sources remain recognizable so read can report refusal without replacement',async()=>{
  const h=fixture();
  for(const [text,code] of [[h.original.replace('return true','return false'),'modified'],[h.original+'\r\n# author note\r\n','modified'],
    ['# Viento animation state script\n#@viento-animation-state-script malformed\n','invalid'],[h.original.replace('godot-gdscript-v1','godot-gdscript-v99'),'unsupported']]) {
    h.state.content=text;assert.equal(h.host.getContext().stateTableSource,true);const source=await h.host.getSource();assert.equal(source.content,text);
    await assert.rejects(createAnimationStateScriptProposal(source,next()),{errorCode:'animation_state_script_source_'+code});assert.deepEqual(h.writes,[]);
  }
});

test('legacy and other sources never acquire the marked-script entry and unavailable contexts remain read-only',async()=>{
  const h=fixture();
  for(const value of [generateGodotAnimationStateScript(table()).content,'extends Node\n','',null]) {
    h.state.content=value;assert.equal(h.host.getContext().stateTableSource,false);assert.equal(await h.host.getSource(),null);
  }
  h.state.content=h.original;
  for(const [field,value] of [['editable',false],['available',false],['busy',true],['creating',true],['sourceTXT',false],['document',null]]) {
    const original=h.state[field];h.state[field]=value;assert.equal(await h.host.getSource(),null);h.state[field]=original;
  }
  assert.ok(await h.host.getSource());assert.deepEqual(h.writes,[]);
});

test('snapshot and every apply digest revoke obsolete sources and preserve the complete draft on conflict',async()=>{
  for(const offset of [1,2,3]) for(const key of ['content','baseline','version','document','token','sourcePath','busy','editable','available','creating','sourceTXT']) {
    const h=fixture(),proposal=await proposalFor(h);h.block(offset);const pending=h.host.applyDraft(proposal);await h.blocked();
    if(key==='document')h.state[key]={};else if(typeof h.state[key]==='boolean')h.state[key]=!h.state[key];else h.state[key]+=' ';
    const before=h.state.content;h.release();await assert.rejects(pending,conflict);assert.deepEqual(h.writes,[],`${offset}:${key}`);assert.equal(h.state.content,before);
  }
});

test('source reading also rejects ownership changes at each digest and invalid hashes or baseline versions',async()=>{
  for(const offset of [1,2]) {
    const h=fixture();h.block(offset);const pending=h.host.getSource();await h.blocked();h.state.token+=':new';h.release();assert.equal(await pending,null);
  }
  for(const invalid of ['',false,0,'f'.repeat(63),'f'.repeat(64)+'\n','F'.repeat(64)]) {
    const h=fixture();h.badDigest(invalid);assert.equal(await h.host.getSource(),null);
  }
  const h=fixture();h.state.version='sha256:'+'f'.repeat(64);assert.equal(await h.host.getSource(),null);
  h.state.version='opaque-saved-version';assert.ok(await h.host.getSource());
});

test('observed capability withdrawal cancels old ownership even when support returns before a digest settles',async()=>{
  const h=fixture(),proposal=await proposalFor(h);h.block(3);const pending=h.host.applyDraft(proposal);await h.blocked();
  h.state.available=false;h.host.getContext();h.state.available=true;h.host.getContext();h.release();
  await assert.rejects(pending,conflict);assert.deepEqual(h.writes,[]);
});

test('caller cancellation at all digest boundaries and foreign copied proposals cannot apply',async()=>{
  for(const offset of [1,2,3]) {
    const h=fixture(),proposal=await proposalFor(h);let allowed=true;h.block(offset);const pending=h.host.applyDraft(proposal,{isCurrent:()=>allowed});
    await h.blocked();allowed=false;h.release();await assert.rejects(pending,conflict);assert.deepEqual(h.writes,[]);
  }
  const h=fixture(),proposal=await proposalFor(h);
  for(const value of [null,{},structuredClone(proposal),{...proposal}])await assert.rejects(h.host.applyDraft(value),conflict);
  await assert.rejects(h.host.applyDraft(proposal,{isCurrent:()=>false}),conflict);assert.deepEqual(h.writes,[]);
});

test('valid unsaved marked source is the edit target while the saved baseline and version stay unchanged',async()=>{
  const h=fixture();const draft={initialState:'rest',states:[{key:'rest'},{key:'attack'}],transitions:[{from:'rest',to:'attack',trigger:{kind:'event',name:'attack'}}]};
  h.state.content=content(draft);const source=await h.host.getSource();assert.notEqual(source.baseSourceRevision,source.sourceRevision);
  const proposal=await createAnimationStateScriptProposal(source,{...draft,initialState:'attack'});await h.host.applyDraft(proposal);
  assert.deepEqual(readAnimationStateScriptSource(h.state.content).table,{...draft,initialState:'attack'});
  assert.equal(h.state.baseline,h.original);assert.equal(h.state.version,'sha256:'+hash(h.original));assert.equal(h.writes.length,1);
});

test('a draft write failure does not issue a success or focus receipt and a fresh unchanged owner may retry',async()=>{
  const h=fixture();let attempts=0;const host=createAnimationStateScriptSourceHost({getState:()=>({...h.state}),digest:hash,writeDraft:value=>{
    if(++attempts===1)throw Error('write denied');h.state.content=value;
  }});
  const proposal=await createAnimationStateScriptProposal(await host.getSource(),next());
  await assert.rejects(host.applyDraft(proposal),/write denied/);assert.equal(h.state.content,h.original);
  const result=await host.applyDraft(proposal);assert.equal(result.applied,true);assert.equal(attempts,2);
});


test('a caller guard that synchronously changes the editor cannot authorize a stale write',async()=>{
  for(const checkpoint of [1,2,3,4]) for(const key of ['document','token','sourcePath','content','baseline','version','editable','creating','busy','available','sourceTXT']) {
    const h=fixture(),proposal=await proposalFor(h);let calls=0;
    const pending=h.host.applyDraft(proposal,{isCurrent:()=>{
      if(++calls===checkpoint) {
        if(key==='document')h.state[key]={};else if(typeof h.state[key]==='boolean')h.state[key]=!h.state[key];else h.state[key]+=' ';
      }
      return true;
    }});
    await assert.rejects(pending,conflict);assert.equal(calls,checkpoint);assert.deepEqual(h.writes,[],`${checkpoint}:${key}`);
  }
});
