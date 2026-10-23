import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectAnimationStateTable } from '../../engine/animation-state-table-core.mjs';
import { supportsStudioCoreAnimationStateTable, dispatchStudioCoreAnimationStateTable, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const table = () => ({initialState:'idle',states:[{key:'idle'},{key:'attack'},{key:'unused'}],transitions:[
  {from:'idle',to:'attack',trigger:{kind:'event',name:'combat.attack'}},
  {from:'attack',to:'attack',trigger:{kind:'event',name:'combat.attack'}},
  {from:'attack',to:'idle',trigger:{kind:'completed'}}]});
const request = (value=table()) => ({protocolVersion:1,operation:'animationStateTable.inspect',table:value});
const expected = (value=table()) => ({table:structuredClone(value),states:value.states.map(({key},index)=>({key,index})),
  initialIndex:value.states.findIndex(({key})=>key===value.initialState),
  transitions:value.transitions.map(({from,to,trigger})=>({fromIndex:value.states.findIndex(({key})=>key===from),toIndex:value.states.findIndex(({key})=>key===to),trigger:structuredClone(trigger)})),
  eventNames:[...new Set(value.transitions.filter(({trigger})=>trigger.kind==='event').map(({trigger})=>trigger.name))]});
const {instance:{exports:core}}=await WebAssembly.instantiate(await fs.readFile(new URL('../../engine/studio-core.wasm',import.meta.url)),{});
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
function wasm(input) {
  const bytes=encoder.encode(typeof input==='string'?input:JSON.stringify(input)),at=core.viento_core_input(bytes.length)>>>0;
  new Uint8Array(core.memory.buffer,at,bytes.length).set(bytes);
  const out=core.viento_core_run()>>>0;
  return JSON.parse(decoder.decode(new Uint8Array(core.memory.buffer,out,core.viento_core_output_len())));
}
let bridgeIndex=0;
async function bridge(transform,{marker=1}={}) {
  const module=await import(`../../engine/studio-core.mjs?state-table-forgery=${++bridgeIndex}`),memory=new WebAssembly.Memory({initial:40}),original=WebAssembly.instantiate;
  let inputLength=0,outputLength=0,calls=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      ...(marker===null?{}:{viento_core_animation_state_table_version:()=>marker}),
      viento_core_input:length=>{inputLength=length;return 8;},viento_core_output_len:()=>outputLength,
      viento_core_run:()=>{calls++;const incoming=JSON.parse(decoder.decode(new Uint8Array(memory.buffer,8,inputLength)));
        const output=encoder.encode(JSON.stringify(transform?transform(wasm(incoming),incoming):wasm(incoming)));
        outputLength=output.length;new Uint8Array(memory.buffer,1048576,outputLength).set(output);return 1048576;},
    }}});
    await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally {WebAssembly.instantiate=original;}
  return {module,calls:()=>calls};
}
function boundary() {
  return {initialState:'s15',states:Array.from({length:16},(_,index)=>({key:`s${index}`})),
    transitions:Array.from({length:64},(_,index)=>({from:`s${Math.floor(index/32)}`,to:'s15',trigger:{kind:'event',name:`Event${index%32}`}}))};
}
function invalidTables() {
  const result=[];
  for(const mutate of [v=>v.initialState='missing',v=>v.states=[],v=>v.states[1].key='idle',v=>v.transitions[0].from='missing',v=>v.transitions[0].to='missing',
    v=>v.transitions.push(structuredClone(v.transitions[0])),v=>v.transitions.push({from:'attack',to:'unused',trigger:{kind:'completed'}}),
    v=>v.extra=true,v=>v.states[0].extra=true,v=>v.transitions[0].extra=true,v=>v.transitions[0].trigger.extra=true,
    v=>v.transitions[0].trigger={kind:'completed',name:'forbidden'},v=>v.transitions[0].trigger={kind:'event'},v=>v.transitions[0].trigger={kind:'unknown'},
    v=>v.transitions[0].trigger=null,v=>v.states[0]=[],v=>v.transitions[0]=[],v=>v.states=null,v=>v.transitions={},v=>v.initialState=null]) {
    const value=table();mutate(value);result.push(value);
  }
  return result;
}

test('state table has an independent optional marker and returns detached deeply frozen ordered indices',()=>{
  assert.equal(core.viento_core_protocol_version(),1);assert.equal(core.viento_core_animation_state_table_version(),1);
  assert.equal(supportsStudioCoreAnimationStateTable(),true);
  const source=table(),before=structuredClone(source),result=inspectAnimationStateTable(source);
  assert.deepEqual(result,expected(source));assert.deepEqual(source,before);
  assert.deepEqual(Object.keys(result),['table','states','initialIndex','transitions','eventNames']);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.table)&&Object.isFrozen(result.table.states[0])&&Object.isFrozen(result.table.transitions[0].trigger)
    &&Object.isFrozen(result.states[0])&&Object.isFrozen(result.transitions[0].trigger)&&Object.isFrozen(result.eventNames));
  source.states[0].key='changed';source.transitions[0].trigger.name='changed';assert.deepEqual(result,expected(before));
});

test('self edges cycles no outgoing edges and unreachable states remain valid declarations without runtime policy',()=>{
  for(const source of [table(),{initialState:'alone',states:[{key:'alone'}],transitions:[]},
    {initialState:'second',states:[{key:'first'},{key:'second'}],transitions:[{from:'second',to:'first',trigger:{kind:'completed'}},{from:'first',to:'second',trigger:{kind:'completed'}}]}]) {
    assert.deepEqual(inspectAnimationStateTable(source),expected(source));
  }
  const source=table();source.transitions[0].trigger={kind:'event',name:'completed'};
  assert.deepEqual(inspectAnimationStateTable(source),expected(source));
});

test('native indices preserve author order and event names use first appearance rather than sorted state order',()=>{
  const source=table();source.states.reverse();source.initialState='attack';
  source.transitions=[{from:'unused',to:'idle',trigger:{kind:'event',name:'Z'}},...source.transitions,
    {from:'idle',to:'unused',trigger:{kind:'event',name:'a.b-c_2'}},{from:'attack',to:'idle',trigger:{kind:'event',name:'Z'}}];
  const result=inspectAnimationStateTable(source);assert.deepEqual(result,expected(source));
  assert.deepEqual(result.eventNames,['Z','combat.attack','a.b-c_2']);assert.equal(result.initialIndex,1);
});

test('exact bounds admit sixteen states sixty-four edges and thirty-two distinct event subscriptions',()=>{
  const source=boundary();assert.deepEqual(inspectAnimationStateTable(source),expected(source));
  for(const mutate of [v=>v.states.push({key:'s16'}),v=>v.transitions.push({from:'s15',to:'s15',trigger:{kind:'completed'}}),v=>v.transitions[63].trigger.name='Event32']) {
    const changed=boundary();mutate(changed);assert.throws(()=>inspectAnimationStateTable(changed),{errorCode:'animation_state_table_invalid'});
  }
  const maxKey='a'.repeat(32),minimal={initialState:maxKey,states:[{key:maxKey}],transitions:[{from:maxKey,to:maxKey,trigger:{kind:'event',name:'E'.repeat(64)}}]};
  assert.deepEqual(inspectAnimationStateTable(minimal),expected(minimal));
});

test('state and event spelling is strict and shared event names remain legal in different states',()=>{
  for(const value of ['',null,0,false,[],{},' Idle','idle ','Idle','_idle','0idle','idle-x','a.b','待机','a\n','a'.repeat(33)]) {
    const source=table();source.states[0].key=value;assert.throws(()=>inspectAnimationStateTable(source),{errorCode:'animation_state_table_invalid'});
    assert.equal(wasm(request(source)).errorCode,'animation_state_table_invalid');
  }
  for(const value of ['',null,0,false,[],{},' event','event ','_event','0event','constructor','prototype','__proto__','事件','a\n','a"b','a'.repeat(65)]) {
    const source=table();source.transitions[0].trigger.name=value;assert.throws(()=>inspectAnimationStateTable(source),{errorCode:'animation_state_table_invalid'});
  }
  for(const name of ['A','a.b-c_2','A'.repeat(64)]) {
    const source=table();source.transitions[0].trigger.name=name;assert.deepEqual(inspectAnimationStateTable(source),expected(source));
  }
});

test('invalid references ambiguous triggers and unknown fields fail atomically without mutating author input',()=>{
  for(const source of invalidTables()) {
    const before=structuredClone(source);assert.throws(()=>inspectAnimationStateTable(source),{errorCode:'animation_state_table_invalid'});
    assert.equal(wasm(request(source)).errorCode,'animation_state_table_invalid');assert.deepEqual(source,before);
  }
  for(const value of [null,[],true,0,'']) assert.throws(()=>inspectAnimationStateTable(value),{errorCode:'animation_state_table_invalid'});
  const huge=table();huge.initialState='a'.repeat(32768);assert.throws(()=>inspectAnimationStateTable(huge),{errorCode:'animation_state_table_invalid'});
  assert.equal(getStudioCoreMetadata().ready,true);assert.deepEqual(inspectAnimationStateTable(table()),expected());
});

test('the operation envelope rejects missing unknown protocol and cross-domain fields before admission',()=>{
  for(const key of ['protocolVersion','operation','table']) {
    const input=request();delete input[key];assert.throws(()=>dispatchStudioCoreAnimationStateTable(input),{errorCode:'studio_core_request_invalid'});
    assert.equal(wasm(input).errorCode,'studio_core_request_invalid');
  }
  for(const input of [{...request(),protocolVersion:2},{...request(),extra:true},{...request(),operation:'sceneAnimation.inspect'},null,[]]) {
    assert.throws(()=>dispatchStudioCoreAnimationStateTable(input),{errorCode:'studio_core_request_invalid'});
  }
});

test('raw ABI rejects duplicate escaped keys invalid Unicode and duplicate envelope fields before Value erases them',()=>{
  const raw=JSON.stringify(request());
  for(const [from,to] of [['"key":','"key":null,"key":'],['"name":','"name":null,"na\\u006de":'],
    ['"kind":','"kind":"completed","kind":'],['"initialState":','"initialState":null,"initialState":'],
    ['"operation":','"operation":null,"operation":'],['"table":','"table":null,"table":'],['"protocolVersion":','"protocolVersion":2,"protocolVersion":']]) {
    assert.equal(wasm(raw.replace(from,to)).errorCode,'studio_core_request_invalid');
  }
  for(const rawValue of ['\uFEFF'+raw,raw.replace('idle','\\uD800'),'{']) assert.equal(wasm(rawValue).errorCode,'studio_core_request_invalid');
  assert.deepEqual(wasm(request()).animationStateTable,expected());
});

test('getters serializers inherited records sparse arrays nonfinite values and cyclic inputs cannot execute',()=>{
  let calls=0;
  for(const mutate of [v=>Object.defineProperty(v,'initialState',{enumerable:true,get(){calls++;return'idle';}}),
    v=>Object.defineProperty(v.states[0],'key',{enumerable:true,get(){calls++;return'idle';}}),
    v=>Object.defineProperty(v.transitions[0].trigger,'name',{enumerable:true,get(){calls++;return'combat.attack';}}),
    v=>v.toJSON=()=>{calls++;return{};},v=>v.states[0].toJSON=()=>{calls++;return{};},v=>v.states[0].key=undefined,
    v=>v.states[0].key=Infinity,v=>v.states[0].key=NaN,v=>delete v.states[0],v=>v.states.extra=1,
    v=>v.states[0].self=v,v=>v[Symbol('extra')]=true,v=>Object.defineProperty(v.states[0],'hidden',{value:true}),
    v=>Object.setPrototypeOf(v,Object.create(null,{initialState:{get(){calls++;return'idle';}}})),
    v=>Object.setPrototypeOf(v.states,Object.create(Array.prototype))]) {
    const source=table();mutate(source);assert.throws(()=>inspectAnimationStateTable(source),{errorCode:'studio_core_request_invalid'});
  }
  const incoming=request();Object.defineProperty(incoming,'operation',{enumerable:true,get(){calls++;return'animationStateTable.inspect';}});
  assert.throws(()=>dispatchStudioCoreAnimationStateTable(incoming),{errorCode:'studio_core_request_invalid'});
  assert.equal(calls,0);assert.equal(getStudioCoreMetadata().ready,true);
  const noPrototype=table();Object.setPrototypeOf(noPrototype,null);Object.setPrototypeOf(noPrototype.states[0],null);
  assert.deepEqual(inspectAnimationStateTable(noPrototype),expected(table()));
});

test('absent or unsupported marker leaves legacy core usable without inventing state table support',async()=>{
  for(const marker of [null,0,2]) {
    const fake=await bridge(null,{marker});assert.equal(fake.module.supportsStudioCoreAnimationStateTable(),false);
    assert.throws(()=>fake.module.dispatchStudioCoreAnimationStateTable(request()),{errorCode:'studio_core_unavailable'});assert.equal(fake.calls(),0);
    assert.equal(fake.module.getStudioCoreMetadata().ready,true);
    assert.deepEqual(fake.module.dispatchStudioCore({protocolVersion:1,operation:'move',actors:[{objectId:'a',position:[0,0],size:[1,1]}],ids:['a'],delta:[1,2]}),[{objectId:'a',position:[1,2]}]);
    assert.equal(fake.module.getStudioCoreMetadata().ready,true);
  }
  const fake=await bridge();assert.equal(fake.module.supportsStudioCoreAnimationStateTable(),true);
  assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateTable(request()),expected());
});

test('forged success receipts cannot reorder relabel change edges drop fields or corrupt deterministic indices',async()=>{
  for(const mutate of [r=>r.extra=true,r=>r.animationStateTable.extra=true,r=>delete r.animationStateTable.initialIndex,
    r=>r.animationStateTable.table.states.reverse(),r=>r.animationStateTable.table.initialState='attack',r=>r.animationStateTable.table.transitions[0].to='idle',
    r=>r.animationStateTable.states.reverse(),r=>r.animationStateTable.states[0].index=1,r=>r.animationStateTable.states[0].key='another',r=>r.animationStateTable.states[0].extra=true,
    r=>r.animationStateTable.initialIndex=1,r=>r.animationStateTable.transitions.pop(),r=>r.animationStateTable.transitions[0].fromIndex=1,
    r=>r.animationStateTable.transitions[0].toIndex=0,r=>r.animationStateTable.transitions[0].trigger.name='another',r=>r.animationStateTable.transitions[2].trigger.name='extra',
    r=>r.animationStateTable.eventNames=[],r=>r.animationStateTable.eventNames.push('extra'),r=>r.animationStateTable.table.extra=true]) {
    const fake=await bridge(r=>{mutate(r);return r;});assert.throws(()=>fake.module.dispatchStudioCoreAnimationStateTable(request()),{errorCode:'studio_core_unavailable'});
    assert.equal(fake.module.getStudioCoreMetadata().ready,false);
  }
});

test('a forged native success cannot turn malformed state input into an admitted declaration',async()=>{
  const newlineEvent=table();newlineEvent.transitions[0].trigger.name='event\n';
  for(const source of [...invalidTables(),{...table(),states:Array.from({length:17},(_,index)=>({key:`s${index}`}))},
    {initialState:'idle\n',states:[{key:'idle\n'}],transitions:[]},newlineEvent]) {
    let receipt;try {receipt=expected(source);} catch {receipt=expected();}
    const fake=await bridge(()=>({protocolVersion:1,ok:true,animationStateTable:receipt}));
    assert.throws(()=>fake.module.dispatchStudioCoreAnimationStateTable(request(source)),{errorCode:'studio_core_unavailable'});
  }
  assert.equal(getStudioCoreMetadata().ready,true);
});

const nativePath=process.env.VIENTO_ANIMATION_STATE_TABLE_CORE_NATIVE;
test('native CLI and WASM return identical state tables and errors across bounds raw duplicates and recovery',{skip:!nativePath},async()=>{
  const inputs=[table(),boundary(),...invalidTables(),{initialState:'only',states:[{key:'only'}],transitions:[]}].map(value=>JSON.stringify(request(value)));
  inputs.push(inputs[0].replace('"key":','"key":null,"key":'),inputs[0].replace('idle','\\uD800'),'\uFEFF'+inputs[0],inputs[0]);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(nativePath,[],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr});});child.stdin.end(inputs.join('\n')+'\n');
  });
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse),inputs.map(wasm));
});
