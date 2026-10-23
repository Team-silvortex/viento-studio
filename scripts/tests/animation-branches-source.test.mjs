import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_ANIMATION_STATE_TABLE, generateGodotAnimationStateScript } from '../../engine/godot-animation-state-script.mjs';
import { generateGodotAnimationStateConditionsScript } from '../../engine/godot-animation-state-conditions-script.mjs';
import { generateGodotAnimationBranchesScript } from '../../engine/godot-animation-branches-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const prefix = '# Viento animation state script\n#@viento-animation-state-script ';
const conditional = () => { const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);table.transitions[0].trigger.condition={type:'boolean',operator:'eq',value:true};return table; };
const branching = () => ({ ...conditional(), eventSelection:'firstMatch' });
const rewrite = (content, update) => { const end=content.indexOf('\n',prefix.length), envelope=JSON.parse(content.slice(prefix.length,end));update(envelope);return prefix+JSON.stringify(envelope)+content.slice(end); };
const rejects = (content, kind) => assert.throws(()=>readAnimationStateScriptSource(content),{errorCode:'animation_state_script_source_'+kind});
const source = content => ({sourcePath:'documents/scripts/controller.txt',token:'branch:1',content,baseSourceRevision:'sha256:'+hash(content),sourceRevision:'sha256:'+hash(content)});

test('v1/v2 emitter bytes and a published conditional source retain the previous contracts',async()=>{
  for(const [file,digest] of [['godot-animation-state-script.mjs','a9fb4687b3b9e9573770a3f2dacc4d78e5540acfcc37cce05db2f6a8bc88f2d5'],['godot-animation-state-conditions-script.mjs','46edb613955d96188f5546a78fa97da7b14a06f3516a7e477ccf5fa34bd539a2']])assert.equal(hash(await fs.readFile(new URL('../../engine/'+file,import.meta.url))),digest);
  assert.equal(hash(generateEditableGodotAnimationStateScript(conditional()).content),'3d1dede89686f5e7e9f998a09f06a0245e440d48737c52ae618f2b32353960dd');
  for(const [table,version] of [[DEFAULT_ANIMATION_STATE_TABLE,1],[conditional(),2]]){
    const generated=generateEditableGodotAnimationStateScript(table);assert.match(generated.content,new RegExp('godot-gdscript-v'+version));assert.deepEqual(readAnimationStateScriptSource(generated.content).table,table);
  }
  assert.throws(()=>generateGodotAnimationStateScript(branching()),{errorCode:'animation_state_table_invalid'});
  assert.throws(()=>generateGodotAnimationStateConditionsScript(branching()),{errorCode:'animation_state_table_invalid'});
  assert.throws(()=>generateGodotAnimationBranchesScript(conditional()),{errorCode:'animation_state_table_invalid'});
});

test('v3 requires explicit selection even without conditions, duplicates or transitions',()=>{
  for(const table of [{...DEFAULT_ANIMATION_STATE_TABLE,eventSelection:'firstMatch'},{initialState:'idle',states:[{key:'idle'}],transitions:[],eventSelection:'firstMatch'},branching()]){
    const generated=generateEditableGodotAnimationStateScript(table);assert.match(generated.content,/"generator":"godot-gdscript-v3"/);
    for(const bom of ['','\uFEFF'])for(const newline of ['\n','\r\n']){
      const content=bom+generated.content.replaceAll('\n',newline),read=readAnimationStateScriptSource(content);
      assert.deepEqual(read.table,table);assert.equal(read.bom,bom);assert.equal(read.newline,newline);assert.equal(bom+generateEditableGodotAnimationStateScript(read.table).content.replaceAll('\n',newline),content);
    }
    assert.ok(Object.isFrozen(generated)&&Object.isFrozen(generated.parameters));
  }
});

test('v3 preserves declared edge order, all repeated groups and unique subscriptions',()=>{
  const table=branching();table.states.push({key:'fallback'});
  table.transitions.splice(1,0,{from:'idle',to:'idle',trigger:{kind:'event',name:'action',condition:{type:'number',operator:'gte',value:2**-53}}},{from:'idle',to:'fallback',trigger:{kind:'event',name:'action'}});
  const generated=generateEditableGodotAnimationStateScript(table),edges=JSON.parse(generated.content.match(/^const _TRANSITIONS: Array = (.*)$/m)[1]);
  assert.deepEqual(edges.map(edge=>[edge.fromIndex,edge.toIndex]),[[0,1],[0,0],[0,2],[1,0]]);
  assert.deepEqual(JSON.parse(generated.content.match(/^const _EVENT_NAMES: Array = (.*)$/m)[1]),['action']);
  const bytes=new Uint8Array(edges[1].trigger.condition.valueBytes);assert.equal(new DataView(bytes.buffer).getFloat64(0,true),2**-53);
  assert.deepEqual(readAnimationStateScriptSource(generated.content).table,table);
  assert.deepEqual(generated.parameters.map(row=>row.name),['clip_idle','clip_action','clip_fallback']);
});

test('old source envelopes cannot adopt firstMatch by changing only declaration or generator',()=>{
  const v1=generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content,v2=generateEditableGodotAnimationStateScript(conditional()).content,v3=generateEditableGodotAnimationStateScript(branching()).content;
  for(const content of [v1,v2]){
    rejects(rewrite(content,envelope=>{envelope.table.eventSelection='firstMatch';}),'invalid');
    rejects(rewrite(content,envelope=>{envelope.generator='godot-gdscript-v3';}),'invalid');
  }
  for(const version of [1,2])rejects(rewrite(v3,envelope=>{envelope.generator='godot-gdscript-v'+version;}),'invalid');
  rejects(rewrite(v3,envelope=>{delete envelope.table.eventSelection;}),'invalid');
  rejects(rewrite(v3,envelope=>{envelope.table.eventSelection='lastMatch';}),'invalid');
  rejects(rewrite(v3,envelope=>{envelope.generator='godot-gdscript-v99';}),'unsupported');
});

test('v3 source editing rejects modified bodies, reordered branches and repeated JSON fields',()=>{
  const table=branching();table.transitions.splice(1,0,{from:'idle',to:'idle',trigger:{kind:'event',name:'action',condition:{type:'boolean',operator:'ne',value:false}}});
  const content=generateEditableGodotAnimationStateScript(table).content;
  rejects(content.replace('\t\t\t\tcontinue','\t\t\t\treturn true'),'modified');
  rejects(rewrite(content,envelope=>{[envelope.table.transitions[0],envelope.table.transitions[1]]=[envelope.table.transitions[1],envelope.table.transitions[0]];}),'modified');
  rejects(content+'# changed\n','modified');
  rejects(content.replace('"eventSelection":"firstMatch"','"eventSelection":"firstMatch","eventSelection":"firstMatch"'),'invalid');
});

test('reviewed v2→v3 and v3→v2 changes retain source identity, parameter names and BOM/CRLF',async()=>{
  const initial='\uFEFF'+generateEditableGodotAnimationStateScript(conditional()).content.replaceAll('\n','\r\n'),captured=source(initial);
  const proposal=await createAnimationStateScriptProposal(captured,branching());assert.match(proposal.afterContent,/godot-gdscript-v3/);
  assert.deepEqual(proposal.beforeParameters,proposal.afterParameters);assert.ok(proposal.afterContent.startsWith('\uFEFF'));assert.equal(proposal.afterContent.replaceAll('\r\n','').includes('\n'),false);
  const applied=await prepareAnimationStateScriptApply(captured,proposal,{digest:async value=>hash(value)});assert.equal(applied.afterContent,proposal.afterContent);
  const reverted=await createAnimationStateScriptProposal(source(applied.afterContent),conditional());assert.equal(reverted.afterContent,initial);
  await assert.rejects(()=>createAnimationStateScriptProposal(source(applied.afterContent),branching()),{errorCode:'animation_state_script_authoring_unchanged'});
});

test('v3 source limits include header, comparison text, BOM and CRLF expansion',()=>{
  const sized=count=>({initialState:'idle',states:[{key:'idle'}],eventSelection:'firstMatch',transitions:Array.from({length:7},()=>({from:'idle',to:'idle',trigger:{kind:'event',name:'action',condition:{type:'string',operator:'eq',value:'x'.repeat(count)}}}))});
  assert.throws(()=>generateEditableGodotAnimationStateScript(sized(4096)),{errorCode:'animation_state_script_source_limit'});
  let low=0,high=4096;while(low<high){const mid=Math.ceil((low+high)/2);try{generateEditableGodotAnimationStateScript(sized(mid));low=mid;}catch(error){assert.equal(error.errorCode,'animation_state_script_source_limit');high=mid-1;}}
  const content=generateEditableGodotAnimationStateScript(sized(low)).content;assert.ok(Buffer.byteLength(content)<=65536);assert.deepEqual(readAnimationStateScriptSource(content).table,sized(low));
  rejects('\uFEFF'+content.replaceAll('\n','\r\n'),'limit');
});

test('parameter discovery recognizes exact v3 and fails closed on modified or oversized source',()=>{
  const content=generateEditableGodotAnimationStateScript(branching()).content,found=discoverScriptParameterContract(content);assert.equal(found.status,'ready');assert.deepEqual(found.parameters.map(row=>row.name),['clip_idle','clip_action']);
  for(const changed of [content+'# changed\n',content+'#'+'x'.repeat(65537-Buffer.byteLength(content))]){const result=discoverScriptParameterContract(changed);assert.equal(result.status,'modified');assert.deepEqual(result.parameters,[]);}
});

test('maximal branch tables preserve all 64 transitions, 32 subscriptions and 16 clip parameters',()=>{
  const states=Array.from({length:16},(_,index)=>({key:'s'+index}));
  const table={initialState:'s0',states,eventSelection:'firstMatch',transitions:Array.from({length:64},(_,index)=>({from:'s'+index%16,to:'s'+(index+1)%16,trigger:{kind:'event',name:'event'+index%32,condition:{type:'number',operator:'gte',value:index}}}))};
  const generated=generateEditableGodotAnimationStateScript(table);assert.equal(generated.parameters.length,16);assert.ok(Buffer.byteLength(generated.content)<65536);
  assert.equal(JSON.parse(generated.content.match(/^const _TRANSITIONS: Array = (.*)$/m)[1]).length,64);
  assert.equal(JSON.parse(generated.content.match(/^const _EVENT_NAMES: Array = (.*)$/m)[1]).length,32);
  assert.deepEqual(readAnimationStateScriptSource(generated.content).table,table);
});
