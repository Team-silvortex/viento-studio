import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_ANIMATION_STATE_TABLE, generateGodotAnimationStateScript } from '../../engine/godot-animation-state-script.mjs';
import { generateGodotAnimationStateConditionsScript } from '../../engine/godot-animation-state-conditions-script.mjs';
import { generateGodotAnimationBranchesScript } from '../../engine/godot-animation-branches-script.mjs';
import { generateGodotAnimationSelectorsScript } from '../../engine/godot-animation-selectors-script.mjs';
import { generateGodotAnimationCombinationsScript } from '../../engine/godot-animation-combinations-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const scalar=(value=true,selector)=>({type:typeof value==='number'?'number':typeof value==='string'?'string':'boolean',operator:'eq',value,...(selector?{selector:{kind:'projectState',key:selector}}:{})});
const table=(condition={combine:'all',conditions:[scalar(true),scalar(true,'combat.enabled')]})=>{
  const value=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);value.transitions[0].trigger.condition=condition;return value;
};
const prefix='# Viento animation state script\n#@viento-animation-state-script ';
const rewrite=(content,update)=>{const end=content.indexOf('\n',prefix.length),envelope=JSON.parse(content.slice(prefix.length,end));update(envelope);return prefix+JSON.stringify(envelope)+content.slice(end);};
const rejects=(content,kind)=>assert.throws(()=>readAnimationStateScriptSource(content),{errorCode:'animation_state_script_source_'+kind});
const source=content=>({sourcePath:'documents/scripts/controller.txt',token:'combination:1',content,baseSourceRevision:'sha256:'+hash(content),sourceRevision:'sha256:'+hash(content)});

test('v5 roundtrips unique and ordered one-to-eight leaf groups without collapsing one-term declarations',()=>{
  for(const combine of ['all','any'])for(const count of [1,8])for(const branches of [false,true]){
    const value=table({combine,conditions:Array.from({length:count},(_,index)=>scalar(index%2?true:2**-53,index%3?'combat.enabled':undefined))});
    if(branches)value.eventSelection='firstMatch';
    const generated=generateEditableGodotAnimationStateScript(value);assert.match(generated.content,/"generator":"godot-gdscript-v5"/);
    assert.deepEqual(generated.parameters,generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).parameters);
    for(const bom of ['','\uFEFF'])for(const newline of ['\n','\r\n']){
      const content=bom+generated.content.replaceAll('\n',newline),read=readAnimationStateScriptSource(content);
      assert.deepEqual(read.table,value);assert.equal(read.bom,bom);assert.equal(read.newline,newline);
      assert.equal(bom+generateEditableGodotAnimationStateScript(read.table).content.replaceAll('\n',newline),content);
    }
    assert.ok(Object.isFrozen(generated)&&Object.isFrozen(generated.parameters[0]));
  }
});

test('all four historical emitters retain exact bytes and reject grouped declarations through their direct APIs',async()=>{
  const emitters=[generateGodotAnimationStateScript,generateGodotAnimationStateConditionsScript,generateGodotAnimationBranchesScript,generateGodotAnimationSelectorsScript];
  const files=[['godot-animation-state-script.mjs','a9fb4687b3b9e9573770a3f2dacc4d78e5540acfcc37cce05db2f6a8bc88f2d5'],['godot-animation-state-conditions-script.mjs','46edb613955d96188f5546a78fa97da7b14a06f3516a7e477ccf5fa34bd539a2'],['godot-animation-branches-script.mjs','7db5a850a461d0c29e87db383b4cfa59cfc2f5a5ad54f50e2056a763ba3bde1f'],['godot-animation-selectors-script.mjs','96f471ddf39d8cacaf2f9c1ddefceca6f879a203cdd6d9833507eb5ef691d321']];
  for(const [file,digest] of files)assert.equal(hash(await fs.readFile(new URL('../../engine/'+file,import.meta.url))),digest);
  const legacy=[DEFAULT_ANIMATION_STATE_TABLE,table(scalar()),{...table(scalar()),eventSelection:'firstMatch'},table(scalar(true,'combat.enabled'))];
  for(const [index,value] of legacy.entries()){
    const generated=generateEditableGodotAnimationStateScript(value);assert.match(generated.content,new RegExp('"generator":"godot-gdscript-v'+(index+1)+'"'));
    assert.equal(generated.content.slice(generated.content.indexOf('\n',prefix.length)+1),emitters[index](value).content);assert.deepEqual(readAnimationStateScriptSource(generated.content).table,value);
    assert.throws(()=>generateGodotAnimationCombinationsScript(value),{errorCode:'animation_state_table_invalid'});
  }
  for(const emit of emitters)for(const branches of [false,true]){
    const value=table();if(branches)value.eventSelection='firstMatch';
    assert.throws(()=>emit(value),{errorCode:'animation_state_table_invalid'});
    value.transitions.push({from:'action',to:'action',trigger:{kind:'event',name:'other',condition:scalar(true,'combat.enabled')}});
    assert.throws(()=>emit(value),{errorCode:'animation_state_table_invalid'});
  }
});

test('v5 encodes every leaf exactly, retains duplicate order and requests read_state only when a reached declaration may need it',()=>{
  const values=[Number.MIN_VALUE,2**-53,.1,1e9,'prefix\u0000tail','日本語🎮',true,true];
  const conditions=values.map((value,index)=>scalar(value,index%2?'combat.value':undefined));
  const generated=generateGodotAnimationCombinationsScript(table({combine:'any',conditions})).content;
  const group=JSON.parse(generated.match(/^const _TRANSITIONS: Array = (.*)$/m)[1])[0].trigger.condition;
  assert.equal(group.combine,'any');assert.equal(group.conditions.length,8);
  for(const [index,value] of values.entries()){
    const leaf=group.conditions[index];
    if(typeof value==='number')assert.equal(new DataView(new Uint8Array(leaf.valueBytes).buffer).getFloat64(0,true),value);
    else if(typeof value==='string')assert.equal(Buffer.from(leaf.valueBase64,'base64').toString('utf8'),value);
    else assert.equal(leaf.value,value);
    assert.equal(Object.hasOwn(leaf,'selector'),Boolean(index%2));
  }
  assert.match(generated,/"play_animation", "read_state"/);
  const payloadOnly=generateGodotAnimationCombinationsScript(table({combine:'all',conditions:[scalar()]})).content;
  assert.match(payloadOnly,/for method in \[.*"play_animation"\]:/);assert.doesNotMatch(payloadOnly,/for method in \[.*"read_state"/);
  const mixed=table({combine:'all',conditions:[scalar()]});mixed.transitions.push({from:'action',to:'action',trigger:{kind:'event',name:'other',condition:scalar(true,'combat.enabled')}});
  assert.match(generateGodotAnimationCombinationsScript(mixed).content,/"play_animation", "read_state"/);
});

test('v5 group feature and generator identity are bound before regeneration and malformed or nested groups are rejected',()=>{
  const content=generateEditableGodotAnimationStateScript(table()).content;
  for(const version of [1,2,3,4])rejects(rewrite(content,e=>{e.generator='godot-gdscript-v'+version;}),'invalid');
  rejects(rewrite(content,e=>{e.generator='godot-gdscript-v99';}),'unsupported');
  for(const value of [DEFAULT_ANIMATION_STATE_TABLE,table(scalar()),{...table(scalar()),eventSelection:'firstMatch'},table(scalar(true,'combat.enabled'))])rejects(rewrite(generateEditableGodotAnimationStateScript(value).content,e=>{e.generator='godot-gdscript-v5';}),'invalid');
  for(const condition of [{combine:'all'}, {conditions:[scalar()]}, {combine:'all',conditions:[]}, {combine:'any',conditions:Array(9).fill(scalar())}, {combine:'none',conditions:[scalar()]}, {combine:'all',conditions:[{combine:'any',conditions:[scalar()]}]}, {combine:'all',conditions:[scalar()],selector:{kind:'projectState',key:'x'}}, {combine:'all',conditions:[scalar()],extra:true}]){
    rejects(rewrite(content,e=>{e.table.transitions[0].trigger.condition=condition;}),'invalid');
    assert.throws(()=>generateGodotAnimationCombinationsScript(table(condition)),{errorCode:'animation_state_table_invalid'});
  }
  rejects(rewrite(content,e=>{e.table.transitions[0].trigger.condition.combine='any';}),'modified');
  rejects(rewrite(content,e=>{e.table.transitions[0].trigger.condition.conditions.reverse();}),'modified');
  rejects(content.replace('"combine":"all"','"combine":"all","combine":"any"'),'invalid');
  rejects(content.replace('if all_required and not matched:', 'if all_required:'),'modified');
  rejects(content+'# handwritten\n','modified');
});

test('reviewed v1-v4 to v5 and back preserves original source bytes and parameter contracts',async()=>{
  const legacy=[DEFAULT_ANIMATION_STATE_TABLE,table(scalar()),{...table(scalar()),eventSelection:'firstMatch'},table(scalar(true,'combat.enabled'))];
  for(const beforeTable of legacy){
    const content='\uFEFF'+generateEditableGodotAnimationStateScript(beforeTable).content.replaceAll('\n','\r\n');
    const afterTable=structuredClone(beforeTable),leaf=afterTable.transitions[0].trigger.condition||scalar();
    afterTable.transitions[0].trigger.condition={combine:'all',conditions:[leaf,scalar(true,'combat.enabled')]};
    const proposal=await createAnimationStateScriptProposal(source(content),afterTable),applied=await prepareAnimationStateScriptApply(source(content),proposal,{digest:async value=>hash(value)});
    assert.match(applied.afterContent,/godot-gdscript-v5/);assert.deepEqual(proposal.beforeParameters,proposal.afterParameters);
    assert.equal((await createAnimationStateScriptProposal(source(applied.afterContent),beforeTable)).afterContent,content);
    assert.deepEqual(discoverScriptParameterContract(applied.afterContent).parameters.map(row=>row.name),['clip_idle','clip_action']);
  }
});

test('v5 static scaffold keeps nondefault initial state parameters subscriptions and the unchanged p9 lifecycle',()=>{
  const value={initialState:'last',states:[{key:'first'},{key:'middle'},{key:'last'}],transitions:[
    {from:'last',to:'first',trigger:{kind:'event',name:'combat.go',condition:{combine:'any',conditions:[scalar(),scalar(true,'combat.ready')]}}},
    {from:'first',to:'middle',trigger:{kind:'completed'}},{from:'middle',to:'last',trigger:{kind:'event',name:'combat.return'}},
  ]};
  const plain=structuredClone(value);delete plain.transitions[0].trigger.condition;
  const legacy=generateGodotAnimationStateScript(plain),generated=generateGodotAnimationCombinationsScript(value);
  assert.deepEqual(generated.parameters,legacy.parameters);
  const beforeEvents=content=>content.slice(0,content.indexOf('func _on_event(')).replace(/^const _TRANSITIONS: Array = .*$/m,'TRANSITIONS').replace(', "read_state"]',']');
  assert.equal(beforeEvents(generated.content),beforeEvents(legacy.content));
  assert.equal(generated.content.slice(generated.content.indexOf('func _on_completed(')),legacy.content.slice(legacy.content.indexOf('func _on_completed(')));
});

test('v5 whole-source 64 KiB budget includes group leaves header BOM and CRLF',()=>{
  const sized=count=>table({combine:'any',conditions:Array.from({length:7},()=>scalar('x'.repeat(count),'combat.text'))});
  assert.throws(()=>generateEditableGodotAnimationStateScript(sized(4096)),{errorCode:'animation_state_script_source_limit'});
  let low=0,high=4096;while(low<high){const middle=Math.ceil((low+high)/2);try{generateEditableGodotAnimationStateScript(sized(middle));low=middle;}catch(error){assert.equal(error.errorCode,'animation_state_script_source_limit');high=middle-1;}}
  const content=generateEditableGodotAnimationStateScript(sized(low)).content;assert.ok(Buffer.byteLength(content)<=65536);assert.deepEqual(readAnimationStateScriptSource(content).table,sized(low));
  rejects('\uFEFF'+content.replaceAll('\n','\r\n'),'limit');assert.equal(discoverScriptParameterContract(content+'# edited\n').status,'modified');
});

test('v5 generation codec graph and reviewed editing need only the independent combinations marker',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),engine=new URL('../../engine/',import.meta.url).href;
  const code=`import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import {initializeStudioCore,supportsStudioCoreAnimationStateTable,supportsStudioCoreAnimationStateConditions,supportsStudioCoreAnimationStateBranches,supportsStudioCoreAnimationStateSelectors,supportsStudioCoreAnimationStateCombinations} from ${JSON.stringify(engine+'studio-core.mjs')};
import {generateEditableGodotAnimationStateScript,readAnimationStateScriptSource} from ${JSON.stringify(engine+'animation-state-script-source.mjs')};
import {createAnimationStateGraph} from ${JSON.stringify(engine+'animation-state-graph.mjs')};
import {createAnimationStateScriptProposal,prepareAnimationStateScriptApply} from ${JSON.stringify(engine+'animation-state-script-edit.mjs')};
const original=WebAssembly.instantiate;
WebAssembly.instantiate=async(...args)=>{const built=await original(...args);return {instance:{exports:Object.fromEntries(Object.entries(built.instance.exports).filter(([name])=>!['viento_core_animation_state_table_version','viento_core_animation_state_conditions_version','viento_core_animation_state_branches_version','viento_core_animation_state_selectors_version'].includes(name)))}};};
try{await initializeStudioCore(()=>fs.readFile(new URL(${JSON.stringify(engine+'studio-core.wasm')})));}finally{WebAssembly.instantiate=original;}
assert.equal(supportsStudioCoreAnimationStateCombinations(),true);for(const supports of [supportsStudioCoreAnimationStateTable,supportsStudioCoreAnimationStateConditions,supportsStudioCoreAnimationStateBranches,supportsStudioCoreAnimationStateSelectors])assert.equal(supports(),false);
const table=${JSON.stringify(table())};
for(const branches of [false,true]){if(branches)table.eventSelection='firstMatch';const generated=generateEditableGodotAnimationStateScript(table);assert.deepEqual(readAnimationStateScriptSource(generated.content).table,table);assert.deepEqual(createAnimationStateGraph(table).edges[0].trigger.condition,table.transitions[0].trigger.condition);
const hash=value=>createHash('sha256').update(value).digest('hex'),source={sourcePath:'documents/scripts/controller.txt',token:'only-combinations',content:generated.content,baseSourceRevision:'sha256:'+hash(generated.content),sourceRevision:'sha256:'+hash(generated.content)};
const next=structuredClone(table);next.transitions[0].trigger.condition.combine='any';const proposal=await createAnimationStateScriptProposal(source,next),applied=await prepareAnimationStateScriptApply(source,proposal,{digest:async value=>hash(value)});assert.deepEqual(readAnimationStateScriptSource(applied.afterContent).table,next);}
`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{timeout:30000,maxBuffer:1024*1024});
});
