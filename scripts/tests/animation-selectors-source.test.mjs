import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DEFAULT_ANIMATION_STATE_TABLE, generateGodotAnimationStateScript } from '../../engine/godot-animation-state-script.mjs';
import { generateGodotAnimationStateConditionsScript } from '../../engine/godot-animation-state-conditions-script.mjs';
import { generateGodotAnimationBranchesScript } from '../../engine/godot-animation-branches-script.mjs';
import { generateGodotAnimationSelectorsScript } from '../../engine/godot-animation-selectors-script.mjs';
import { generateEditableGodotAnimationStateScript, readAnimationStateScriptSource } from '../../engine/animation-state-script-source.mjs';
import { createAnimationStateScriptProposal, prepareAnimationStateScriptApply } from '../../engine/animation-state-script-edit.mjs';
import { discoverScriptParameterContract } from '../../engine/script-parameter-discovery.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const selected = (condition = { type:'boolean', operator:'eq', value:true }) => {
  const table=structuredClone(DEFAULT_ANIMATION_STATE_TABLE);
  table.transitions[0].trigger.condition={...condition,selector:{kind:'projectState',key:'combat.enabled'}};
  return table;
};
const prefix='# Viento animation state script\n#@viento-animation-state-script ';
const rewrite=(content,update)=>{const end=content.indexOf('\n',prefix.length),envelope=JSON.parse(content.slice(prefix.length,end));update(envelope);return prefix+JSON.stringify(envelope)+content.slice(end);};
const rejects=(content,kind)=>assert.throws(()=>readAnimationStateScriptSource(content),{errorCode:'animation_state_script_source_'+kind});
const source=content=>({sourcePath:'documents/scripts/controller.txt',token:'selector:1',content,baseSourceRevision:'sha256:'+hash(content),sourceRevision:'sha256:'+hash(content)});

test('v4 supports unique and ordered tables with exact BOM/newline roundtrips and unchanged parameters',()=>{
  for(const condition of [{type:'boolean',operator:'ne',value:false},{type:'number',operator:'gte',value:2**-53},{type:'string',operator:'eq',value:'"\\\n\u0000日本語🎮'}])for(const branches of [false,true]){
    const table=selected(condition);if(branches)table.eventSelection='firstMatch';
    const generated=generateEditableGodotAnimationStateScript(table);assert.match(generated.content,/"generator":"godot-gdscript-v4"/);
    assert.deepEqual(generated.parameters,generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).parameters);
    for(const bom of ['','\uFEFF'])for(const newline of ['\n','\r\n']){
      const content=bom+generated.content.replaceAll('\n',newline),read=readAnimationStateScriptSource(content);
      assert.deepEqual(read.table,table);assert.equal(read.bom,bom);assert.equal(read.newline,newline);
      assert.equal(bom+generateEditableGodotAnimationStateScript(read.table).content.replaceAll('\n',newline),content);
    }
    assert.ok(Object.isFrozen(generated)&&Object.isFrozen(generated.parameters[0]));
  }
});

test('v1-v3 files and outputs remain stable and their direct emitters reject selected conditions',async()=>{
  for(const [file,digest] of [['godot-animation-state-script.mjs','a9fb4687b3b9e9573770a3f2dacc4d78e5540acfcc37cce05db2f6a8bc88f2d5'],['godot-animation-state-conditions-script.mjs','46edb613955d96188f5546a78fa97da7b14a06f3516a7e477ccf5fa34bd539a2'],['godot-animation-branches-script.mjs','7db5a850a461d0c29e87db383b4cfa59cfc2f5a5ad54f50e2056a763ba3bde1f']])assert.equal(hash(await fs.readFile(new URL('../../engine/'+file,import.meta.url))),digest);
  const v2=selected();delete v2.transitions[0].trigger.condition.selector;const v3={...structuredClone(v2),eventSelection:'firstMatch'};
  assert.equal(hash(generateEditableGodotAnimationStateScript(v2).content),'3d1dede89686f5e7e9f998a09f06a0245e440d48737c52ae618f2b32353960dd');
  for(const [table,emit,version] of [[DEFAULT_ANIMATION_STATE_TABLE,generateGodotAnimationStateScript,1],[v2,generateGodotAnimationStateConditionsScript,2],[v3,generateGodotAnimationBranchesScript,3]]){
    const content=generateEditableGodotAnimationStateScript(table).content;
    assert.match(content,new RegExp('"generator":"godot-gdscript-v'+version+'"'));
    assert.equal(content.slice(content.indexOf('\n',prefix.length)+1),emit(table).content);assert.deepEqual(readAnimationStateScriptSource(content).table,table);
  }
  for(const emit of [generateGodotAnimationStateScript,generateGodotAnimationStateConditionsScript,generateGodotAnimationBranchesScript])for(const table of [selected(),{...selected(),eventSelection:'firstMatch'}])assert.throws(()=>emit(table),{errorCode:'animation_state_table_invalid'});
  for(const table of [DEFAULT_ANIMATION_STATE_TABLE,v2,v3])assert.throws(()=>generateGodotAnimationSelectorsScript(table),{errorCode:'animation_state_table_invalid'});
});

test('v4 preserves exact scalar constants, mixed selector metadata, branch order and the p9 lifecycle',()=>{
  const table={...selected({type:'number',operator:'eq',value:Number.MIN_VALUE}),eventSelection:'firstMatch'};
  table.transitions.splice(1,0,{from:'idle',to:'idle',trigger:{kind:'event',name:'action',condition:{type:'string',operator:'eq',value:'prefix\u0000tail'}}},{from:'idle',to:'idle',trigger:{kind:'event',name:'action'}});
  const emitted=generateGodotAnimationSelectorsScript(table).content,edges=JSON.parse(emitted.match(/^const _TRANSITIONS: Array = (.*)$/m)[1]);
  assert.deepEqual(edges.map(edge=>[edge.fromIndex,edge.toIndex]),[[0,1],[0,0],[0,0],[1,0]]);
  assert.deepEqual(edges[0].trigger.condition.selector,{kind:'projectState',key:'combat.enabled'});
  assert.equal(new DataView(new Uint8Array(edges[0].trigger.condition.valueBytes).buffer).getFloat64(0,true),Number.MIN_VALUE);
  assert.equal(Buffer.from(edges[1].trigger.condition.valueBase64,'base64').toString('utf8'),'prefix\u0000tail');assert.equal(Object.hasOwn(edges[1].trigger.condition,'selector'),false);
  assert.match(emitted,/"play_animation", "read_state"/);assert.match(emitted,/_project\.read_state\(condition\["selector"\]\["key"\]\)/);
  const legacy=generateGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).content;
  assert.equal(emitted.slice(emitted.indexOf('func _enter_state('),emitted.indexOf('func _on_event(')),legacy.slice(legacy.indexOf('func _enter_state('),legacy.indexOf('func _on_event(')));
  assert.equal(emitted.slice(emitted.indexOf('func _on_completed(')),legacy.slice(legacy.indexOf('func _on_completed(')));
});

test('generator identity and selector declarations are exact and modified v4 remains ordinary source',()=>{
  const content=generateEditableGodotAnimationStateScript(selected()).content;
  for(const version of [1,2,3])rejects(rewrite(content,e=>{e.generator='godot-gdscript-v'+version;}),'invalid');
  rejects(rewrite(content,e=>{delete e.table.transitions[0].trigger.condition.selector;}),'invalid');
  rejects(rewrite(content,e=>{e.generator='godot-gdscript-v99';}),'unsupported');
  for(const selector of [null,{}, {kind:'eventPayload'}, {kind:'projectState',key:'__proto__'}, {kind:'projectState',key:'combat.enabled',extra:true}])rejects(rewrite(content,e=>{e.table.transitions[0].trigger.condition.selector=selector;}),'invalid');
  rejects(rewrite(content,e=>{e.table.transitions[0].trigger.condition.selector.key='other.key';}),'modified');
  rejects(content.replace('_project.read_state(condition["selector"]["key"])','value'),'modified');
  rejects(content+'# manual edit\n','modified');
  rejects(content.replace('"key":"combat.enabled"','"key":"combat.enabled","key":"other"'),'invalid');
  for(const table of [DEFAULT_ANIMATION_STATE_TABLE,{...DEFAULT_ANIMATION_STATE_TABLE,eventSelection:'firstMatch'}])rejects(rewrite(generateEditableGodotAnimationStateScript(table).content,e=>{e.generator='godot-gdscript-v4';}),'invalid');
});

test('reviewed legacy to v4 and back preserves exact representation and parameter contract',async()=>{
  for(const version of [1,2,3]){
    const beforeTable=version===1?structuredClone(DEFAULT_ANIMATION_STATE_TABLE):selected();
    if(version!==1)delete beforeTable.transitions[0].trigger.condition.selector;if(version===3)beforeTable.eventSelection='firstMatch';
    const before='\uFEFF'+generateEditableGodotAnimationStateScript(beforeTable).content.replaceAll('\n','\r\n');
    const afterTable=selected();if(version===3)afterTable.eventSelection='firstMatch';
    const proposal=await createAnimationStateScriptProposal(source(before),afterTable),applied=await prepareAnimationStateScriptApply(source(before),proposal,{digest:async value=>hash(value)});
    assert.match(applied.afterContent,/godot-gdscript-v4/);assert.deepEqual(proposal.beforeParameters,proposal.afterParameters);
    const reversed=await createAnimationStateScriptProposal(source(applied.afterContent),beforeTable);assert.equal(reversed.afterContent,before);
    assert.deepEqual(discoverScriptParameterContract(applied.afterContent).parameters.map(row=>row.name),['clip_idle','clip_action']);
  }
});

test('v4 total source budget includes selectors, declaration, BOM and CRLF expansion',()=>{
  const sized=count=>({initialState:'idle',states:[{key:'idle'}],eventSelection:'firstMatch',transitions:Array.from({length:7},()=>({from:'idle',to:'idle',trigger:{kind:'event',name:'choose',condition:{type:'string',operator:'eq',value:'x'.repeat(count),selector:{kind:'projectState',key:'combat.message'}}}}))});
  assert.throws(()=>generateEditableGodotAnimationStateScript(sized(4096)),{errorCode:'animation_state_script_source_limit'});
  let low=0,high=4096;while(low<high){const middle=Math.ceil((low+high)/2);try{generateEditableGodotAnimationStateScript(sized(middle));low=middle;}catch(error){assert.equal(error.errorCode,'animation_state_script_source_limit');high=middle-1;}}
  const content=generateEditableGodotAnimationStateScript(sized(low)).content;assert.ok(Buffer.byteLength(content)<=65536);assert.deepEqual(readAnimationStateScriptSource(content).table,sized(low));
  rejects('\uFEFF'+content.replaceAll('\n','\r\n'),'limit');
  assert.equal(discoverScriptParameterContract(content+'# edited\n').status,'modified');
});

test('v4 static scaffold preserves nondefault initial index, parameters, subscriptions and the legacy lifecycle',()=>{
  const table={initialState:'last',states:[{key:'first'},{key:'middle'},{key:'last'}],transitions:[
    {from:'last',to:'first',trigger:{kind:'event',name:'combat.go',condition:{type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.ready'}}}},
    {from:'first',to:'middle',trigger:{kind:'completed'}},
    {from:'middle',to:'last',trigger:{kind:'event',name:'combat.return'}},
  ]};
  const plain=structuredClone(table);delete plain.transitions[0].trigger.condition;
  const legacy=generateGodotAnimationStateScript(plain),generated=generateGodotAnimationSelectorsScript(table);
  assert.deepEqual(generated.parameters,legacy.parameters);
  const beforeEvents=content=>content.slice(0,content.indexOf('func _on_event(')).replace(/^const _TRANSITIONS: Array = .*$/m,'TRANSITIONS').replace(', "read_state"]',']');
  assert.equal(beforeEvents(generated.content),beforeEvents(legacy.content));
  assert.equal(generated.content.slice(generated.content.indexOf('func _on_completed(')),legacy.content.slice(legacy.content.indexOf('func _on_completed(')));
});

test('v4 generation codec graph and reviewed editing require only the independent selector capability',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const engine=new URL('../../engine/',import.meta.url).href;
  const code=`import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import {initializeStudioCore,supportsStudioCoreAnimationStateTable,supportsStudioCoreAnimationStateConditions,supportsStudioCoreAnimationStateBranches,supportsStudioCoreAnimationStateSelectors} from ${JSON.stringify(engine+'studio-core.mjs')};
import {generateEditableGodotAnimationStateScript,readAnimationStateScriptSource} from ${JSON.stringify(engine+'animation-state-script-source.mjs')};
import {createAnimationStateGraph} from ${JSON.stringify(engine+'animation-state-graph.mjs')};
import {createAnimationStateScriptProposal,prepareAnimationStateScriptApply} from ${JSON.stringify(engine+'animation-state-script-edit.mjs')};
const original=WebAssembly.instantiate;
WebAssembly.instantiate=async(...args)=>{const built=await original(...args);return {instance:{exports:Object.fromEntries(Object.entries(built.instance.exports).filter(([name])=>!['viento_core_animation_state_table_version','viento_core_animation_state_conditions_version','viento_core_animation_state_branches_version'].includes(name)))}};};
try{await initializeStudioCore(()=>fs.readFile(new URL(${JSON.stringify(engine+'studio-core.wasm')})));}finally{WebAssembly.instantiate=original;}
assert.equal(supportsStudioCoreAnimationStateSelectors(),true);assert.equal(supportsStudioCoreAnimationStateTable(),false);assert.equal(supportsStudioCoreAnimationStateConditions(),false);assert.equal(supportsStudioCoreAnimationStateBranches(),false);
const table=${JSON.stringify(selected())};
for(const branches of [false,true]){if(branches)table.eventSelection='firstMatch';const generated=generateEditableGodotAnimationStateScript(table);assert.deepEqual(readAnimationStateScriptSource(generated.content).table,table);assert.deepEqual(createAnimationStateGraph(table).edges[0].trigger.condition.selector,{kind:'projectState',key:'combat.enabled'});
const hash=value=>createHash('sha256').update(value).digest('hex');const source={sourcePath:'documents/scripts/controller.txt',token:'only-selector',content:generated.content,baseSourceRevision:'sha256:'+hash(generated.content),sourceRevision:'sha256:'+hash(generated.content)};
const next=structuredClone(table);next.transitions[0].trigger.condition.selector.key='combat.changed';const proposal=await createAnimationStateScriptProposal(source,next),applied=await prepareAnimationStateScriptApply(source,proposal,{digest:async value=>hash(value)});assert.deepEqual(readAnimationStateScriptSource(applied.afterContent).table,next);}
`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{timeout:30000,maxBuffer:1024*1024});
});
