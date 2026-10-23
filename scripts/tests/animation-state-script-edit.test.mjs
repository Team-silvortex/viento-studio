import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_ANIMATION_STATE_TABLE, generateGodotAnimationStateScript } from '../../engine/godot-animation-state-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal, isAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';

const table = () => structuredClone(DEFAULT_ANIMATION_STATE_TABLE);
const hash = value => createHash('sha256').update(value).digest('hex');
const content = (value=table(),bom='',newline='\n') => bom+generateEditableGodotAnimationStateScript(value).content.replaceAll('\n',newline);
const source = (text=content(),baseline=text) => ({sourcePath:'design-data/scripts/状态.TXT',token:'source:1',content:text,
  baseSourceRevision:'sha256:'+hash(baseline),sourceRevision:'sha256:'+hash(text)});
const edit = () => ({...table(),initialState:'action'});
const renamed = () => ({initialState:'idle',states:[{key:'idle'},{key:'attack'},{key:'walk'}],transitions:[
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action'}},{from:'attack',to:'idle',trigger:{kind:'completed'}},
  {from:'idle',to:'walk',trigger:{kind:'event',name:'move'}}]});
const conflict = {errorCode:'animation_state_script_authoring_conflict'};

test('existing marked TXT produces a detached frozen ordinary proposal and retains BOM and newline style',async()=>{
  for(const bom of ['','\ufeff']) for(const newline of ['\n','\r\n']) {
    const text=content(table(),bom,newline),input=source(text),next=renamed(),before=structuredClone({input,next});
    const proposal=await createAnimationStateScriptProposal(input,next);
    assert.deepEqual({input,next},before);assert.equal(isAnimationStateScriptProposal(proposal),true);
    assert.equal(proposal.kind,'animation-state-script');assert.equal(proposal.beforeContent,text);
    assert.equal(proposal.afterContent,content(next,bom,newline));
    assert.deepEqual(readAnimationStateScriptSource(proposal.afterContent).table,next);
    assert.ok(Object.isFrozen(proposal)&&Object.isFrozen(proposal.table.states[0])&&Object.isFrozen(proposal.beforeParameters[0])&&Object.isFrozen(proposal.afterParameters[0]));
    assert.deepEqual(await prepareAnimationStateScriptApply(input,proposal,{digest:hash}),{sourcePath:input.sourcePath,afterContent:proposal.afterContent,
      beforeParameters:proposal.beforeParameters,afterParameters:proposal.afterParameters});
    if(newline==='\r\n') assert.equal(proposal.afterContent.replaceAll('\r\n','').includes('\n'),false);
  }
});

test('renamed and removed states expose parameter interface differences without creating behavior migration authority',async()=>{
  const proposal=await createAnimationStateScriptProposal(source(),renamed());
  assert.deepEqual(proposal.beforeParameters,[{stateKey:'idle',name:'clip_idle',defaultValue:''},{stateKey:'action',name:'clip_action',defaultValue:''}]);
  assert.deepEqual(proposal.afterParameters,[{stateKey:'idle',name:'clip_idle',defaultValue:''},{stateKey:'attack',name:'clip_attack',defaultValue:''},{stateKey:'walk',name:'clip_walk',defaultValue:''}]);
  const removed=await createAnimationStateScriptProposal(source(),{initialState:'idle',states:[{key:'idle'}],transitions:[]});
  assert.deepEqual(removed.afterParameters,[{stateKey:'idle',name:'clip_idle',defaultValue:''}]);
  for(const key of ['worldId','bindingId','relations','parameters','save','command']) assert.equal(Object.hasOwn(proposal,key),false);
  assert.doesNotMatch(proposal.afterContent,/@export var clip_action/);
});

test('unchanged declarations never issue an empty write proposal in any supported source representation',async()=>{
  for(const bom of ['','\ufeff']) for(const newline of ['\n','\r\n'])
    await assert.rejects(createAnimationStateScriptProposal(source(content(table(),bom,newline)),table()),{errorCode:'animation_state_script_authoring_unchanged'});
});

test('handwritten edits additional source and stale declaration/body combinations remain ordinary source and cannot be overwritten',async()=>{
  const original=content();
  for(const text of [original.replace('return true','return false'),original+'\n# author notes\n',original.replace('"initialState":"idle"','"initialState":"action"'),original.trimEnd()]) {
    const input=source(text);await assert.rejects(createAnimationStateScriptProposal(input,edit()),{errorCode:'animation_state_script_source_modified'});assert.equal(input.content,text);
  }
  await assert.rejects(createAnimationStateScriptProposal(source(generateGodotAnimationStateScript(table()).content),edit()),{errorCode:'animation_state_script_source_invalid'});
  await assert.rejects(createAnimationStateScriptProposal(source(original.replace('godot-gdscript-v1','godot-gdscript-v99')),edit()),{errorCode:'animation_state_script_source_unsupported'});
});

test('current valid unsaved source is edited independently from the saved baseline and preserves its table',async()=>{
  const baseline=content(),draft=content(renamed()),input=source(draft,baseline),next={...renamed(),initialState:'walk'};
  const proposal=await createAnimationStateScriptProposal(input,next);
  assert.equal(proposal.baseSourceRevision,'sha256:'+hash(baseline));assert.equal(proposal.sourceRevision,'sha256:'+hash(draft));
  assert.equal(proposal.beforeContent,draft);assert.equal(proposal.afterContent,content(next));
  assert.equal((await prepareAnimationStateScriptApply(input,proposal,{digest:hash})).afterContent,content(next));
});

test('only the exact private proposal and all five current source fields can authorize a prepared draft',async()=>{
  const input=source(),proposal=await createAnimationStateScriptProposal(input,edit());
  for(const forged of [null,{},structuredClone(proposal),JSON.parse(JSON.stringify(proposal)),{...proposal,afterContent:'evil'},Object.create(proposal)]) {
    assert.equal(isAnimationStateScriptProposal(forged),false);await assert.rejects(prepareAnimationStateScriptApply(input,forged,{digest:hash}),conflict);
  }
  for(const key of ['sourcePath','token','content','baseSourceRevision','sourceRevision'])
    await assert.rejects(prepareAnimationStateScriptApply({...input,[key]:input[key]+'x'},proposal,{digest:hash}),conflict);
  for(const value of ['',null,0,hash(input.content)+'\n',hash(input.content).toUpperCase(),'f'.repeat(64)])
    await assert.rejects(prepareAnimationStateScriptApply(input,proposal,{digest:()=>value}),conflict);
  await assert.rejects(prepareAnimationStateScriptApply(input,proposal),conflict);
});

test('source envelopes are exact bounded own TXT data without getters serializers or inherited authority',async()=>{
  let calls=0;const input=source();
  for(const field of Object.keys(input)) {
    const malformed={...input};Object.defineProperty(malformed,field,{enumerable:true,get(){calls++;return input[field];}});
    await assert.rejects(createAnimationStateScriptProposal(malformed,edit()),{errorCode:'animation_state_script_authoring_invalid'});
  }
  for(const value of [Object.create(input),{...input,toJSON(){calls++;return input;}},{...input,extra:true},[],null,
    {...input,content:'x'.repeat(131073)},{...input,content:'\ud800'},{...input,token:''},{...input,token:'\udfff'},
    {...input,sourceRevision:input.sourceRevision+'\n'}]) await assert.rejects(createAnimationStateScriptProposal(value,edit()),{errorCode:'animation_state_script_authoring_invalid'});
  for(const path of ['/scripts/a.txt','../a.txt','scripts/../a.txt','C:/a.txt','scripts\\a.txt','scripts//a.txt','scripts/a.json','scripts/a.txt\n','scripts/\0a.txt'])
    await assert.rejects(createAnimationStateScriptProposal({...input,sourcePath:path},edit()),{errorCode:'animation_state_script_authoring_invalid'});
  const proposal=await createAnimationStateScriptProposal(input,edit()),bad=Object.defineProperty({},'content',{get(){calls++;return'evil';}});
  await assert.rejects(prepareAnimationStateScriptApply(bad,{...proposal},{digest:hash}),conflict);assert.equal(calls,0);
});

test('candidate tables use strict Rust rules and caller mutations after invocation cannot change review content',async()=>{
  let calls=0;
  for(const value of [{...edit(),extra:true},{...edit(),initialState:'missing'},{...edit(),states:[{key:'Bad'}]},
    {...edit(),transitions:[...edit().transitions,edit().transitions[0]]}]) await assert.rejects(createAnimationStateScriptProposal(source(),value));
  const accessor=edit();Object.defineProperty(accessor,'states',{enumerable:true,get(){calls++;return table().states;}});
  await assert.rejects(createAnimationStateScriptProposal(source(),accessor));
  const serialized=edit();serialized.toJSON=()=>{calls++;return edit();};await assert.rejects(createAnimationStateScriptProposal(source(),serialized));
  assert.equal(calls,0);
  const input=source(),next=renamed(),pending=createAnimationStateScriptProposal(input,next);
  input.content='changed';next.initialState='walk';next.states[0].key='different';
  const proposal=await pending;assert.equal(proposal.beforeContent,content());assert.deepEqual(proposal.table,renamed());
});
