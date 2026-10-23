import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { listScriptStarters, prepareScriptDraft, prepareAnimationStateScriptDraft, prepareScriptDraftApply,
  isScriptDraftProposal, DEFAULT_ANIMATION_STATE_TABLE, supportsAnimationStateScript } from '../../engine/script-authoring.mjs';
import { generateEditableGodotAnimationStateScript as generateGodotAnimationStateScript, DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT as DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/animation-state-script-source.mjs';

const context = () => ({sourceToken:'editor:state-table:1',documentRoot:'documents',documentTypes:[{id:'character',label:'角色 / 役'}]});
const request = () => ({starterId:'godot-project-animation-state-table',documentType:'character',sourcePath:'documents/scripts/状态.txt'});
const custom = () => ({initialState:'rest',states:[{key:'rest'},{key:'walk'},{key:'strike'}],transitions:[
  {from:'rest',to:'walk',trigger:{kind:'event',name:'move'}},
  {from:'walk',to:'rest',trigger:{kind:'event',name:'stop'}},
  {from:'rest',to:'strike',trigger:{kind:'event',name:'attack'}},
  {from:'walk',to:'strike',trigger:{kind:'event',name:'attack'}},
  {from:'strike',to:'rest',trigger:{kind:'completed'}},
]});

test('state-table starter metadata is stable and its trusted default equals Rust-checked generated source', () => {
  assert.equal(supportsAnimationStateScript(),true);
  const starter=listScriptStarters().find(row=>row.id===request().starterId);
  assert.equal(starter.content,DEFAULT_GODOT_ANIMATION_STATE_SCRIPT);
  assert.equal(generateGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content,starter.content);
  assert.equal(prepareScriptDraft(context(),request()).content,starter.content);
  assert.equal(prepareAnimationStateScriptDraft(context(),request(),DEFAULT_ANIMATION_STATE_TABLE).content,starter.content);
});

test('custom table emits exact reviewed ordinary TXT and retains the existing private proposal brand', () => {
  const table=custom(), source=context(), selected=request(), before=structuredClone({table,source,selected});
  const generated=generateGodotAnimationStateScript(table), proposal=prepareAnimationStateScriptDraft(source,selected,table);
  assert.equal(isScriptDraftProposal(proposal),true); assert.equal(proposal.content,generated.content);
  assert.notEqual(proposal.content,DEFAULT_GODOT_ANIMATION_STATE_SCRIPT);
  assert.deepEqual(generated.parameters.map(row=>row.name),['clip_rest','clip_walk','clip_strike']);
  assert.deepEqual({table,source,selected},before);
  assert.deepEqual(prepareScriptDraftApply(source,proposal),{...selected,languageId:'gdscript',backendId:'org.viento.godot4',content:generated.content});
  for(const key of ['relations','worldId','instanceId','bindingId','save','parameters','animationStateTable']) assert.equal(Object.hasOwn(proposal,key),false);
});

test('reviewed source is immutable even when caller table is later renamed or reordered', () => {
  const table=custom(), proposal=prepareAnimationStateScriptDraft(context(),request(),table), content=proposal.content;
  table.states.reverse();table.transitions[0].trigger.name='other';table.initialState='walk';
  assert.equal(proposal.content,content); assert.ok(Object.isFrozen(proposal));
  assert.throws(()=>{proposal.content='extends Node\n';},TypeError);
  assert.equal(prepareScriptDraftApply(context(),proposal).content,content);
});

test('generated scripts use any existing document type under custom Unicode document roots', () => {
  const source={...context(),documentRoot:'设计/正文'},selected={...request(),sourcePath:'设计/正文/scripts/控制器.TXT'};
  const proposal=prepareAnimationStateScriptDraft(source,selected,custom());
  assert.equal(prepareScriptDraftApply(source,proposal).sourcePath,selected.sourcePath);
});

test('generated drafts retain stale session and catalog protection and cannot be forged', () => {
  const proposal=prepareAnimationStateScriptDraft(context(),request(),custom());
  for(const value of [structuredClone(proposal),JSON.parse(JSON.stringify(proposal)),Object.create(proposal),{...proposal,content:'evil'}])
    assert.throws(()=>prepareScriptDraftApply(context(),value),{errorCode:'script_authoring_conflict'});
  for(const source of [{...context(),sourceToken:'new'},{...context(),documentRoot:'other'},
    {...context(),documentTypes:[{id:'character',label:'renamed'}]}])
    assert.throws(()=>prepareScriptDraftApply(source,proposal),{errorCode:'script_authoring_conflict'});
});

test('custom generation cannot masquerade as a static starter or smuggle content and persistence fields', () => {
  for(const change of [{starterId:'godot-node'},{content:'evil'},{sourcePath:'../bad.txt'},{sourcePath:'other/new.txt'},
    {documentType:'unknown'},{table:custom()},{parameters:{clip_rest:''}}])
    assert.throws(()=>prepareAnimationStateScriptDraft(context(),{...request(),...change},custom()),{errorCode:'script_authoring_invalid'});
});

test('invalid tables never issue a usable proposal and do not poison subsequent valid generation', () => {
  for(const table of [{...custom(),initialState:'absent'}, {...custom(),states:[{key:'unsafe-name'}]},
    {...custom(),transitions:[...custom().transitions,custom().transitions[0]]}]) assert.throws(()=>prepareAnimationStateScriptDraft(context(),request(),table));
  assert.ok(isScriptDraftProposal(prepareAnimationStateScriptDraft(context(),request(),custom())));
});

test('table accessors and caller serialization hooks cannot execute during source generation', () => {
  let invoked=0;const table=custom();Object.defineProperty(table,'states',{enumerable:true,get(){invoked++;throw Error('getter');}});
  assert.throws(()=>prepareAnimationStateScriptDraft(context(),request(),table));
  const other=custom();other.toJSON=()=>{invoked++;return custom();};
  assert.throws(()=>prepareAnimationStateScriptDraft(context(),request(),other));assert.equal(invoked,0);
});
