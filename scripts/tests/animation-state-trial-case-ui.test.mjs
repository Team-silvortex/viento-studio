import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createAnimationStateTrialSequence, previewAnimationStateTrialStep, appendAnimationStateTrialStep } from '../../engine/animation-state-trial-sequence.mjs';
import { createAnimationStateTrialCase, parseAnimationStateTrialCase, serializeAnimationStateTrialCase, replayAnimationStateTrialCase, ANIMATION_STATE_TRIAL_CASE_LIMITS } from '../../engine/animation-state-trial-case.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy=value=>JSON.parse(JSON.stringify(value));
const declaration=()=>({initialState:'idle',states:[{key:'idle'},{key:'action'}],transitions:[
 {from:'idle',to:'action',trigger:{kind:'event',name:'go',condition:{combine:'all',conditions:[{type:'number',operator:'gte',value:3},{type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'ready'}}]}}},
 {from:'action',to:'idle',trigger:{kind:'completed'}},
]});
const event=(value=3,projectState=[{key:'ready',value:true}],name='go')=>({kind:'event',event:{name,value},projectState});
const completed={kind:'completed'};
const advance=(sequence,input)=>appendAnimationStateTrialStep(sequence,previewAnimationStateTrialStep(sequence,input));
const path=()=>advance(advance(createAnimationStateTrialSequence(declaration()),event()),completed);
const json=sequence=>serializeAnimationStateTrialCase(createAnimationStateTrialCase(sequence));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t) {
 let language='zh',table=declaration(),sequence=path(),exportsFail=false,reads=0,replays=0;
 const context={active:true,available:true,disabled:false,visible:true,generation:1},blobs=[],downloads=[],revoked=[];
 const h=await dialogHarness('app-animation-state-trial-case',{
  createAnimationStateTrialCase,parseAnimationStateTrialCase,serializeAnimationStateTrialCase,ANIMATION_STATE_TRIAL_CASE_LIMITS,
  replayAnimationStateTrialCase:(source,value)=>{replays++;return replayAnimationStateTrialCase(copy(source),value);},
  URL:{createObjectURL(blob){if(exportsFail)throw Error('download blocked');blobs.push(blob);return 'blob:test-'+blobs.length;},revokeObjectURL(url){revoked.push(url);}},
 });
 const create=h.document.createElement;
 h.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>downloads.push({name:node.download,url:node.href});return node;};
 const container=create('div');h.document.body.append(container);
 const translate=(key,...args)=>({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=h.runtime.setupAnimationStateTrialCase({container,idPrefix:'case',getTable:()=>table,getSequence:()=>sequence,getContext:()=>context,translate});
 const el=suffix=>h.element('case'+suffix);
 t.after(()=>controller.dispose());controller.refresh();
 return {...h,controller,container,context,el,blobs,downloads,revoked,
  path:()=>sequence,setPath(value){sequence=value;controller.refresh();},source:()=>copy(table),change(value){table=copy(value);controller.refresh();},silent(value){table=copy(value);},
  replay(){el('Run').click();},rows:()=>el('Steps').children,language(value){language=value;controller.refresh();},readCount:()=>reads,replayCount:()=>replays,
  start(raw=json(path()),name='sample.json',options={}){el('Import').click();el('File').files=[{name,size:options.size??new TextEncoder().encode(typeof raw==='string'?raw:'').length,text(){reads++;return options.promise??Promise.resolve(raw);}}];el('File').dispatch('change');},
  async load(raw,name,options){this.start(raw,name,options);await flushDialogs();},
  failExport(){exportsFail=true;},detail(index){const detail=el('Steps').children[index].querySelector('details');detail.open=true;detail.dispatch('toggle');return detail;},
 };
}

test('exports only explicitly recorded inputs and manual expectations as a fixed-name JSON blob',async t=>{
 const h=await fixture(t),before=h.path(),author=h.source();h.el('Export').click();assert.equal(h.blobs.length,1);assert.equal(h.downloads[0].name,'animation-state-trial-case.json');assert.equal(h.blobs[0].type,'application/json;charset=utf-8');
 const content=await h.blobs[0].text(),value=parseAnimationStateTrialCase(content);assert.equal(value.initialStateKey,'idle');assert.equal(value.steps.length,2);assert.deepEqual(value.steps[0].expected,{stateKey:'action',transition:true});assert.deepEqual(value.steps[0].input,event());assert.deepEqual(value.steps[1].input,completed);
 for(const key of ['model','table','result','pending','undoBuffers'])assert.equal(content.includes('"'+key+'"'),false,key);
 assert.equal(h.el('Loaded').hidden,true);assert.equal(h.path(),before);assert.deepEqual(h.source(),author);for(const callback of h.timers.values())callback();assert.deepEqual(h.revoked,['blob:test-1']);assert.equal(h.document.body.querySelectorAll('a').filter(node=>node.download===h.downloads[0].name).length,0);
});

test('empty paths cannot export and download errors leave the existing case and report intact',async t=>{
 const h=await fixture(t);h.setPath(createAnimationStateTrialSequence(declaration()));assert.equal(h.el('Export').disabled,true);h.el('Export').disabled=false;h.el('Export').click();assert.equal(h.blobs.length,0);assert.match(h.el('Error').textContent,/至少一个/);
 h.setPath(path());await h.load();h.replay();const row=h.rows()[0];h.failExport();h.el('Export').click();assert.match(h.el('Error').textContent,/导出未完成/);assert.equal(h.rows()[0],row);assert.equal(h.el('Result').dataset.status,'passed');
});

test('import does not replay or replace the live manual path and explicit replay is read-only',async t=>{
 const h=await fixture(t),before=h.path(),author=h.source();await h.load();assert.equal(h.replayCount(),0);assert.equal(h.el('Result').hidden,true);assert.match(h.el('LoadedSummary').textContent,/sample.json.*idle.*2/);assert.match(h.el('Status').textContent,/尚未重跑/);
 h.replay();assert.equal(h.replayCount(),1);assert.equal(h.el('Result').dataset.status,'passed');assert.deepEqual(h.rows().map(row=>row.dataset.status),['passed','passed']);assert.match(h.el('ResultSummary').textContent,/不是实际运行验收/);assert.equal(h.path(),before);assert.deepEqual(h.source(),author);assert.equal(h.rows()[0].querySelectorAll('button').length,0);
});

test('a changed table clears only replay and stops the next replay at its first mismatch',async t=>{
 const h=await fixture(t);await h.load();h.replay();const before=h.path(),changed=h.source();changed.transitions[0].to='idle';h.change(changed);assert.equal(h.el('Result').hidden,true);assert.equal(h.el('Loaded').hidden,false);assert.match(h.el('Status').textContent,/状态表已变化/);
 h.replay();assert.equal(h.el('Result').dataset.status,'failed');assert.deepEqual(h.rows().map(row=>row.dataset.status),['failed','not-run']);assert.match(h.el('ResultSummary').textContent,/第 1 步.*后续步骤未运行/);assert.match(h.rows()[0].textContent,/idle → idle/);assert.doesNotMatch(h.rows()[1].textContent,/试算：/);assert.equal(h.path(),before);
});

test('the report distinguishes same-state transitions from no transition',async t=>{
 const h=await fixture(t),sequence=advance(createAnimationStateTrialSequence(declaration()),completed);await h.load(json(sequence));const changed=h.source();changed.transitions.push({from:'idle',to:'idle',trigger:completed});h.change(changed);h.replay();assert.equal(h.el('Result').dataset.status,'failed');assert.match(h.rows()[0].textContent,/预期：状态 idle · 未发生转换/);assert.match(h.rows()[0].textContent,/试算：idle → idle · 发生转换/);
});

test('a missing initial state reports a specific error without remapping or discarding the case',async t=>{
 const h=await fixture(t);await h.load();h.change({initialState:'action',states:[{key:'action'}],transitions:[]});h.replay();assert.match(h.el('Error').textContent,/缺少用例起始状态/);assert.equal(h.el('Result').hidden,true);assert.equal(h.el('Loaded').hidden,false);h.change(declaration());h.replay();assert.equal(h.el('Result').dataset.status,'passed');
});

test('invalid, unsupported and oversized imports preserve the prior case and result atomically',async t=>{
 const h=await fixture(t);await h.load();h.replay();const row=h.rows()[0],loaded=h.el('LoadedSummary').textContent;
 for(const raw of['{','{}',JSON.stringify({version:999})]){await h.load(raw,'bad.json');assert.equal(h.rows()[0],row);assert.equal(h.el('LoadedSummary').textContent,loaded);assert.match(h.el('Error').textContent,/无效或版本/);}
 const reads=h.readCount();await h.load('', 'huge.json',{size:131073});assert.equal(h.readCount(),reads);assert.match(h.el('Error').textContent,/128 KiB/);assert.equal(h.rows()[0],row);
 await h.load(' '.repeat(131073),'mismatch-size.json',{size:1});assert.match(h.el('Error').textContent,/128 KiB/);assert.equal(h.rows()[0],row);
});

test('latest file selection wins and a late error cannot replace its loaded case',async t=>{
 const h=await fixture(t),first=defer(),second=defer();h.start('', 'first.json',{promise:first.promise});h.start('', 'second.json',{promise:second.promise});second.resolve(json(path()));await flushDialogs();assert.match(h.el('LoadedSummary').textContent,/second.json/);first.reject(Error('late read failed'));await flushDialogs();assert.match(h.el('LoadedSummary').textContent,/second.json/);assert.equal(h.el('Error').hidden,true);assert.equal(h.el('Run').disabled,false);
});

test('folding permanently cancels in-flight file reads even after reopening',async t=>{
 const h=await fixture(t);await h.load();h.replay();const row=h.rows()[0],pending=defer();h.start('', 'late.json',{promise:pending.promise});h.context.visible=false;h.controller.refresh();h.context.visible=true;h.controller.refresh();pending.resolve(json(path()));await flushDialogs();assert.equal(h.rows()[0],row);assert.match(h.el('LoadedSummary').textContent,/sample.json/);assert.equal(h.el('Run').disabled,false);
});

test('a chooser opened before folding cannot submit a file after reopening',async t=>{
 const h=await fixture(t);h.el('Import').click();h.context.visible=false;h.controller.refresh();h.context.visible=true;h.controller.refresh();let reads=0;h.el('File').files=[{name:'late.json',size:2,text(){reads++;return Promise.resolve('{}');}}];h.el('File').dispatch('change');await flushDialogs();assert.equal(reads,0);assert.equal(h.el('Loaded').hidden,true);
});

test('cancel and empty selections keep the prior case and a read failure keeps its report',async t=>{
 const h=await fixture(t);await h.load();h.replay();const row=h.rows()[0];h.el('Import').click();h.el('File').dispatch('cancel');assert.equal(h.rows()[0],row);h.el('Import').click();h.el('File').files=[];h.el('File').dispatch('change');await flushDialogs();assert.equal(h.rows()[0],row);
 const pending=defer();h.start('','bad.json',{promise:pending.promise});pending.reject(Error('read failed'));await flushDialogs();assert.equal(h.rows()[0],row);assert.match(h.el('Error').textContent,/无法读取/);
});

test('reset, inactive sessions and disposal cancel pending imports and clear independent case state',async t=>{
 for(const action of['reset','inactive','dispose']){const h=await fixture(t);await h.load();h.replay();const pending=defer();h.start('','late.json',{promise:pending.promise});if(action==='inactive'){h.context.active=false;h.controller.refresh();h.context.active=true;h.controller.refresh();}else h.controller[action]();pending.resolve(json(path()));await flushDialogs();if(action==='dispose')assert.equal(h.container.children.length,0);else{assert.equal(h.el('Loaded').hidden,true);assert.equal(h.el('Result').hidden,true);assert.equal(h.rows().length,0);}}
});

test('generation or availability changes invalidate replay but retain an imported case for retry',async t=>{
 const h=await fixture(t);await h.load();h.replay();h.context.generation++;h.controller.refresh();assert.equal(h.el('Result').hidden,true);assert.equal(h.el('Loaded').hidden,false);h.replay();assert.equal(h.el('Result').dataset.status,'passed');h.context.available=false;h.controller.refresh();assert.equal(h.el('Result').hidden,true);assert.equal(h.el('Run').disabled,true);h.context.available=true;h.controller.refresh();h.replay();assert.equal(h.el('Result').dataset.status,'passed');
});

test('clear case preserves the manual sequence and returns focus to import',async t=>{
 const h=await fixture(t),before=h.path();await h.load();h.replay();h.el('Clear').click();assert.equal(h.el('Loaded').hidden,true);assert.equal(h.el('Result').hidden,true);assert.equal(h.path(),before);assert.equal(h.document.activeElement,h.el('Import'));assert.equal(h.el('Export').disabled,false);
});

test('lazy condition details and translated controls retain their DOM, focus and open state',async t=>{
 const h=await fixture(t);await h.load();h.replay();assert.equal(h.rows()[0].querySelectorAll('.animation-state-trial-case-candidate').length,0);const detail=h.detail(0),candidate=detail.querySelector('.animation-state-trial-case-candidate'),summary=detail.querySelector('summary');assert.ok(candidate);assert.match(detail.textContent,/项目共享状态 ready/);summary.focus();
 for(const language of['en','ja','zh']){h.language(language);assert.equal(h.document.activeElement,summary);assert.equal(detail.open,true);assert.equal(detail.querySelector('.animation-state-trial-case-candidate'),candidate);assert.equal(h.el('Title').textContent,({en,ja}[language]||{})['试算用例']||'试算用例');assert.equal(h.el('Result').dataset.status,'passed');}
});

test('Unicode, NUL, booleans, numeric and missing samples survive export and import without coercion',async t=>{
 const h=await fixture(t);let sequence=createAnimationStateTrialSequence(declaration());for(const input of[event('日\u0000🙂',[],'unknown'),event(false,[{key:'extra',value:'中'}],'unknown'),event(0,[],'unknown')])sequence=advance(sequence,input);h.setPath(sequence);h.el('Export').click();const raw=await h.blobs[0].text();await h.load(raw);h.replay();assert.equal(h.el('Result').dataset.status,'passed');const value=parseAnimationStateTrialCase(raw);assert.equal(value.steps[0].input.event.value,'日\u0000🙂');assert.equal(value.steps[1].input.event.value,false);assert.equal(value.steps[2].input.event.value,0);assert.deepEqual(value.steps[0].input.projectState,[]);
});

test('detached old details cannot create traces after table change or case replacement',async t=>{
 const h=await fixture(t);await h.load();h.replay();const old=h.rows()[0].querySelector('details'),changed=h.source();changed.transitions[0].to='idle';h.change(changed);old.open=true;old.dispatch('toggle');assert.equal(old.querySelectorAll('.animation-state-trial-case-candidate').length,0);h.change(declaration());h.replay();const previous=h.rows()[0].querySelector('details');await h.load(json(path()),'next.json');previous.open=true;previous.dispatch('toggle');assert.equal(previous.querySelectorAll('.animation-state-trial-case-candidate').length,0);
});


test('a silently invalidated read releases its own busy state without accepting stale bytes',async t=>{
 const h=await fixture(t);await h.load();h.replay();const pending=defer();h.start('','late.json',{promise:pending.promise});h.context.generation++;pending.resolve(json(path()));await flushDialogs();assert.match(h.el('LoadedSummary').textContent,/sample.json/);assert.equal(h.el('Run').disabled,false);assert.doesNotMatch(h.el('Status').textContent,/正在读取/);assert.equal(h.el('Result').hidden,true);h.replay();assert.equal(h.el('Result').dataset.status,'passed');
});

test('successive change events each own a distinct read even without reopening the chooser',async t=>{
 const h=await fixture(t),first=defer(),second=defer();h.start('','first.json',{promise:first.promise});h.el('File').files=[{name:'second.json',size:1,text:()=>second.promise}];h.el('File').dispatch('change');second.resolve(json(path()));await flushDialogs();first.resolve(json(path()));await flushDialogs();assert.match(h.el('LoadedSummary').textContent,/second.json/);assert.equal(h.el('Error').hidden,true);assert.equal(h.el('Run').disabled,false);
});


test('details observing a silent table mismatch revoke the old report permanently without affecting a newer replay',async t=>{
 const h=await fixture(t);await h.load();h.replay();const before=h.source(),old=h.rows()[0].querySelector('details'),changed=h.source();changed.transitions[0].to='idle';h.silent(changed);old.open=true;old.dispatch('toggle');assert.equal(h.el('Result').hidden,true);assert.equal(h.rows().length,0);assert.match(h.el('Status').textContent,/状态表已变化/);assert.equal(h.el('Loaded').hidden,false);
 h.silent(before);old.open=false;old.dispatch('toggle');old.open=true;old.dispatch('toggle');assert.equal(h.el('Result').hidden,true);assert.equal(old.querySelectorAll('.animation-state-trial-case-candidate').length,0);h.replay();const current=h.rows()[0];assert.equal(h.el('Result').dataset.status,'passed');old.dispatch('toggle');assert.equal(h.rows()[0],current);assert.equal(h.el('Result').hidden,false);
});

test('folded detail toggles alone retain a report until ownership is checked on reopening',async t=>{
 const h=await fixture(t);await h.load();h.replay();const row=h.rows()[0],detail=row.querySelector('details');h.context.visible=false;h.controller.refresh();detail.open=true;detail.dispatch('toggle');assert.equal(h.rows()[0],row);assert.equal(detail.querySelectorAll('.animation-state-trial-case-candidate').length,0);h.context.visible=true;h.controller.refresh();detail.open=false;detail.dispatch('toggle');detail.open=true;detail.dispatch('toggle');assert.equal(h.rows()[0],row);assert.equal(h.el('Result').dataset.status,'passed');assert.ok(detail.querySelector('.animation-state-trial-case-candidate'));
});
