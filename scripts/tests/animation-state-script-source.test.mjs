import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSourceContent } from '../../engine/parse.mjs';
import { generateGodotAnimationStateScript, DEFAULT_ANIMATION_STATE_TABLE, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from '../../engine/godot-animation-state-script.mjs';
import { DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT, generateEditableGodotAnimationStateScript, readAnimationStateScriptSource, hasAnimationStateScriptMarker } from '../../engine/animation-state-script-source.mjs';
const execFileAsync = promisify(execFile);
const prefix = '# Viento animation state script\n#@viento-animation-state-script ';
const generated = () => generateEditableGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE);
const rewriteHeader = (content, change) => {const at=content.indexOf('\n',prefix.length), data=JSON.parse(content.slice(prefix.length,at));change(data);return prefix+JSON.stringify(data)+content.slice(at);};
const rejects = (content, kind) => assert.throws(()=>readAnimationStateScriptSource(content),error=>error.code==='animation_state_script_source_'+kind&&error.errorCode===error.code);

test('editable defaults exactly wrap the fixed v1 body and import without the optional core', async()=>{
  const result=generated();assert.equal(result.content,DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT);
  assert.equal(result.content.slice(result.content.indexOf('\n',prefix.length)+1),DEFAULT_GODOT_ANIMATION_STATE_SCRIPT);
  assert.deepEqual(result.parameters,generateGodotAnimationStateScript(DEFAULT_ANIMATION_STATE_TABLE).parameters);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.parameters[0]));
  const code=`import assert from 'node:assert/strict';import {getStudioCoreMetadata} from ${JSON.stringify(new URL('../../engine/studio-core.mjs',import.meta.url).href)};import {DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT,hasAnimationStateScriptMarker,readAnimationStateScriptSource} from ${JSON.stringify(new URL('../../engine/animation-state-script-source.mjs',import.meta.url).href)};assert.equal(getStudioCoreMetadata().ready,false);assert.equal(hasAnimationStateScriptMarker(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT),true);assert.throws(()=>readAnimationStateScriptSource(DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT),e=>e.errorCode==='studio_core_unavailable');`;
  await execFileAsync(process.execPath,['--input-type=module','-e',code]);
});

test('read roundtrips both newline forms and optional BOM without losing representation or order',()=>{
  const source=generated();
  for(const bom of ['', '\uFEFF']) for(const newline of ['\n','\r\n']) {
    const content=bom+source.content.replaceAll('\n',newline),result=readAnimationStateScriptSource(content);
    assert.deepEqual(result,{table:DEFAULT_ANIMATION_STATE_TABLE,parameters:source.parameters,bom,newline});
    assert.equal(bom+generateEditableGodotAnimationStateScript(result.table).content.replaceAll('\n',newline),content);
    assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.table.transitions[0].trigger)&&Object.isFrozen(result.parameters[0]));
  }
});

test('input object insertion order canonicalizes through Rust before declaration serialization',()=>{
  const input={transitions:[{trigger:{name:'action',kind:'event'},to:'action',from:'idle'},{trigger:{kind:'completed'},to:'idle',from:'action'}],states:[{key:'idle'},{key:'action'}],initialState:'idle'};
  assert.equal(generateEditableGodotAnimationStateScript(input).content,generated().content);
  const reordered={initialState:'action',states:[{key:'action'},{key:'idle'}],transitions:[{from:'action',to:'idle',trigger:{kind:'completed'}},{from:'idle',to:'action',trigger:{kind:'event',name:'action'}}]};
  assert.deepEqual(readAnimationStateScriptSource(generateEditableGodotAnimationStateScript(reordered).content).table,reordered);
});

test('marker recognition is only a leading-pair candidate and never reverse-engineers plain scripts',()=>{
  assert.equal(hasAnimationStateScriptMarker(DEFAULT_GODOT_ANIMATION_STATE_SCRIPT),false);
  assert.equal(hasAnimationStateScriptMarker('\n'+generated().content),false);
  assert.equal(hasAnimationStateScriptMarker('extends Node\n'+prefix+'{}\n'),false);
  assert.equal(hasAnimationStateScriptMarker('\uFEFF'+generated().content),true);
  assert.equal(hasAnimationStateScriptMarker(prefix+'broken'),true);
  assert.equal(hasAnimationStateScriptMarker(prefix.trimEnd()),true);
  for(const value of [null,42,{},new String(generated().content)])assert.equal(hasAnimationStateScriptMarker(value),false);
  rejects(DEFAULT_GODOT_ANIMATION_STATE_SCRIPT,'invalid');
});

test('changed executable code exports comments whitespace and trailing content are protected from replacement',()=>{
  const {content}=generated();
  for(const modified of [content.replace('_state = next_state','_state = -1'),content.replace('@export var clip_idle: String = ""','@export var clip_idle: String = "saved"'),
    content.replace('# One controller','# Edited controller'),content.replace('\treturn true','    return true'),content+'\n',content+'func custom():\n\tpass\n',content.slice(0,-1),
    content.replace('extends Node','@tool\nextends Node'),content.replace(prefix,prefix+' '),content+prefix+'{}\n'])rejects(modified,'modified');
});

test('a different valid declaration cannot claim the old body and alternate JSON bytes are not silently normalized',()=>{
  const {content}=generated();
  rejects(rewriteHeader(content,header=>{header.table.initialState='action';}),'modified');
  rejects(content.replace('"idle"','"id\\u006ce"'),'modified');
  rejects(content.replace('"schemaVersion":1','"schemaVersion":1.0'),'modified');
  const at=content.indexOf('\n',prefix.length),header=JSON.parse(content.slice(prefix.length,at));
  rejects(prefix+JSON.stringify({table:header.table,generator:header.generator,schemaVersion:1,format:header.format})+content.slice(at),'modified');
});

test('duplicate decoded header or nested table keys are invalid rather than last-value-wins declarations',()=>{
  const {content}=generated();
  for(const modified of [content.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),content.replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'),
    content.replace('"initialState":"idle"','"initialState":"idle","initialState":"action"'),content.replace('"key":"idle"','"key":"idle","key":"idle"')])rejects(modified,'invalid');
});

test('unsupported versions stay distinct from malformed envelopes and invalid tables',()=>{
  const {content}=generated();
  for(const change of [header=>{header.schemaVersion=2;},header=>{header.generator='godot-gdscript-v99';}])rejects(rewriteHeader(content,change),'unsupported');
  for(const change of [header=>{header.extra=true;},header=>{delete header.table;},header=>{header.format='other';},header=>{header.table.states=[];},header=>{header.table.transitions[0].trigger.name='bad\nname';}])rejects(rewriteHeader(content,change),'invalid');
  for(const body of ['{','null','[]','true'])rejects(prefix+body+'\nextends Node\n','invalid');
});

test('mixed newlines lone CR invalid Unicode and UTF8 byte overflow are rejected before source reconstruction',()=>{
  const {content}=generated();
  for(const modified of [content.replace('\n','\r\n'),content.replace('\n','\r'),content.replaceAll('\n','\r\n').replace('\r\n','\n'),
    '\uFEFF\uFEFF'+content,content+'\ud800',content+'\udc00','x'.repeat(128*1024+1),prefix+'"'+'界'.repeat(45000)+'"\n'])rejects(modified,'invalid');
  for(const value of [null,{},42,()=>content,new String(content)])rejects(value,'invalid');
});

test('maximum supported tables remain below the saved-source limit and regenerate independently of caller mutation',()=>{
  const states=Array.from({length:16},(_,i)=>({key:`s${String(i).padStart(2,'0')}${'x'.repeat(29)}`}));
  const table={initialState:states[0].key,states,transitions:Array.from({length:64},(_,i)=>({from:states[Math.floor(i/32)].key,to:states[15].key,trigger:{kind:'event',name:`Event${String(i%32).padStart(2,'0')}${'x'.repeat(57)}`}}))};
  const result=generateEditableGodotAnimationStateScript(table),read=readAnimationStateScriptSource(result.content);
  assert.ok(Buffer.byteLength(result.content)<65536);assert.equal(read.table.states.length,16);assert.equal(read.table.transitions.length,64);assert.equal(read.parameters.length,16);
  table.states[0].key='changed';assert.notEqual(read.table.states[0].key,'changed');assert.equal(generateEditableGodotAnimationStateScript(read.table).content,result.content);
});


test('the readable first line gives default structured and prose documents a short stable title',()=>{
  const content=generated().content;
  for(const descriptor of [{},{parserProfile:'structured'},{parserProfile:'prose'}]) {
    for(const source of [content,'\uFEFF'+content.replaceAll('\n','\r\n')]) {
      const parsed=parseSourceContent(source,'documents/scripts/controller.txt',descriptor);
      assert.equal(parsed.title,'Viento animation state script');
      assert.equal(parsed.fields._header,'Viento animation state script');
      assert.equal(parsed.blocks[0].title,'Viento animation state script');
      assert.equal(parsed.blocks.some(block=>block.type==='heading'&&block.title.includes('@viento-animation-state-script')),false);
    }
  }
  // The declaration is still source content, not a hidden metadata sidecar.
  const former='# @viento-animation-state-script '+JSON.stringify({format:'viento-animation-state-script',schemaVersion:1,generator:'godot-gdscript-v1',table:DEFAULT_ANIMATION_STATE_TABLE})+'\n'+DEFAULT_GODOT_ANIMATION_STATE_SCRIPT;
  assert.equal(hasAnimationStateScriptMarker(former),false);rejects(former,'invalid');
});
