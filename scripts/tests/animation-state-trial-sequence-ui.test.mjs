import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import { animationStateEventPreviewKeys } from '../../engine/animation-state-event-preview.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const table = () => ({initialState:'idle',states:[{key:'idle'},{key:'action'}],transitions:[
 {from:'idle',to:'action',trigger:{kind:'event',name:'go',condition:{combine:'all',conditions:[{type:'number',operator:'gte',value:3},{type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'ready'}}]}}},
 {from:'action',to:'idle',trigger:{kind:'completed'}},
 {from:'action',to:'action',trigger:{kind:'event',name:'go'}},
]});
async function fixture(t) {
 let language='zh',compare=true,source=table(),evaluations=0;const context={active:true,available:true,disabled:false,generation:1};
 const h=await dialogHarness('app-animation-state-event-preview',{animationStateEventPreviewKeys,supportsStudioCoreAnimationStateConditions:()=>compare});
 const container=h.document.createElement('div');h.document.body.append(container);const locations=[],guards=[];
 const translate=(key,...args)=>({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=h.runtime.setupAnimationStateEventPreview({container,idPrefix:'sequence',getTable:()=>source,getContext:()=>context,translate,onLocate(value,guard){guards.push(guard);if(guard.isCurrent())locations.push(copy(value));}});
 const el=suffix=>h.element('sequence'+suffix),field=(suffix,value,event='input')=>{const node=el(suffix);node.value=value;if(event)node.dispatch(event);};
 t.after(()=>controller.dispose());controller.refresh();el('Toggle').click();
 return {...h,container,context,controller,el,field,locations,guards,run(){evaluations++;el('Run').click();},adopt(){el('Adopt').click();},undo(){el('Undo').click();},
  rows:()=>el('HistoryList').children,mode(kind){field('TriggerKind',kind,'change');},state(key,event='change'){field('CurrentState',key,event);},
  valid(){field('PayloadType','number','change');field('PayloadNumber','3');field('Shared1Type','boolean','change');field('Shared1Boolean','true','change');},
  language(next){language=next;controller.refresh();},comparison(next){compare=next;controller.refresh();},set(next){source=copy(next);controller.refresh();},source:()=>copy(source),replace(next){source=copy(next);},silentComparison(next){compare=next;},
  details(index){const detail=el('HistoryList').children[index].querySelector('details');detail.open=true;detail.dispatch('toggle');return detail;}};
}

test('run is provisional; event then completion advance only on explicit adoption and undo restores raw inputs',async t=>{
 const h=await fixture(t),before=h.source();h.valid();h.run();assert.equal(h.el('CurrentState').value,'idle');assert.equal(h.rows().length,0);h.adopt();assert.equal(h.el('CurrentState').value,'action');assert.equal(h.rows().length,1);assert.equal(h.el('Result').hidden,true);
 h.mode('completed');h.run();assert.equal(h.el('CurrentState').value,'action');assert.equal(h.el('Transition2').dataset.status,'selected');assert.match(h.el('CompletionNote').textContent,/控制器有效.*所选片段/s);h.adopt();assert.equal(h.el('CurrentState').value,'idle');assert.equal(h.rows().length,2);
 h.undo();assert.equal(h.el('CurrentState').value,'action');assert.equal(h.el('TriggerKind').value,'completed');assert.equal(h.rows().length,1);assert.equal(h.el('Result').hidden,true);h.undo();assert.equal(h.el('CurrentState').value,'idle');assert.equal(h.el('TriggerKind').value,'event');assert.equal(h.el('PayloadNumber').value,'3');assert.equal(h.rows().length,0);assert.deepEqual(h.source(),before);
 const ready=h.el('SharedStates').querySelectorAll('select').find(node=>node.id.endsWith('Boolean'));assert.equal(ready.value,'true');
});

test('no match and self loops are recorded as distinct steps without pretending a state change',async t=>{
 const h=await fixture(t);h.field('EventName','unknown');h.run();h.adopt();assert.equal(h.el('CurrentState').value,'idle');assert.equal(h.rows().length,1);assert.match(h.details(0).textContent,/没有候选转换/);
 h.state('action');assert.equal(h.rows().length,0);h.field('EventName','go');h.run();h.adopt();h.run();h.adopt();assert.equal(h.rows().length,2);assert.equal(h.el('CurrentState').value,'action');assert.match(h.rows()[1].textContent,/步骤 2.*action → action/);
});

test('completion ignores hidden invalid event inputs and the legacy comparator capability',async t=>{
 const h=await fixture(t);h.state('action');h.field('PayloadType','number','change');h.field('PayloadNumber','1e-');h.field('EventName','invalid name');h.comparison(false);assert.equal(h.el('Run').disabled,true);
 h.mode('completed');assert.equal(h.el('Run').disabled,false);assert.equal(h.el('EventFields').hidden,true);assert.equal(h.el('SharedSection').hidden,true);h.run();assert.match(h.el('Summary').textContent,/action → idle/);h.adopt();h.undo();assert.equal(h.el('TriggerKind').value,'completed');h.mode('event');assert.equal(h.el('PayloadNumber').value,'1e-');assert.equal(h.el('EventName').value,'invalid name');assert.equal(h.el('Run').disabled,true);
});

test('switching trigger modes keeps shared raw type buffers and incomplete values independently',async t=>{
 const h=await fixture(t);h.field('Shared1Type','number','change');h.field('Shared1Number','2e-');h.mode('completed');h.run();assert.equal(h.el('Adopt').disabled,false);h.adopt();h.undo();h.mode('event');const number=h.el('SharedStates').querySelector('input');assert.equal(number.value,'2e-');assert.equal(h.el('Run').disabled,true);
});

test('editing the next sample keeps adopted history while a manual state jump starts a new sequence',async t=>{
 const h=await fixture(t);h.valid();h.run();h.adopt();const row=h.rows()[0];h.field('PayloadNumber','4');assert.equal(h.rows()[0],row);h.mode('completed');assert.equal(h.rows()[0],row);h.state('idle');assert.equal(h.rows().length,0);assert.match(h.el('Status').textContent,/起始状态.*步骤已清除/);
 h.valid=()=>{};h.field('EventName','unknown');h.run();h.adopt();h.state('action',null);h.controller.refresh();assert.equal(h.rows().length,0);h.run();assert.equal(h.el('Summary').textContent.includes('action'),true);
});

test('folding preserves steps and raw samples but revokes pending results and hidden operations',async t=>{
 const h=await fixture(t);h.valid();h.run();h.adopt();h.mode('completed');h.run();const old=h.el('Transition2Locate'),row=h.rows()[0];h.el('Toggle').click();h.el('Adopt').disabled=false;h.adopt();h.el('Undo').disabled=false;h.undo();assert.equal(h.rows().length,1);
 h.el('Toggle').click();assert.equal(h.rows()[0],row);assert.equal(h.el('Result').hidden,true);old.disabled=false;old.click();assert.equal(h.locations.length,0);h.run();h.adopt();assert.equal(h.rows().length,2);
});

test('a changed author table while folded clears the sequence before reopening can adopt',async t=>{
 const h=await fixture(t);h.valid();h.run();h.adopt();const detail=h.rows()[0].querySelector('details');h.el('Toggle').click();const changed=h.source();changed.transitions[1].to='action';h.set(changed);h.el('Toggle').click();assert.equal(h.rows().length,0);detail.open=true;detail.dispatch('toggle');assert.equal(detail.querySelectorAll('.animation-state-event-preview-candidate').length,0);
});

test('history details are read-only and constructed once; appending preserves prior nodes and focus',async t=>{
 const h=await fixture(t);h.valid();h.run();h.adopt();const row=h.rows()[0];assert.equal(row.querySelectorAll('.animation-state-event-preview-candidate').length,0);const detail=h.details(0),candidate=detail.querySelector('.animation-state-event-preview-candidate'),summary=detail.querySelector('summary');assert.ok(candidate);assert.equal(detail.querySelectorAll('button').length,0);const state=h.el('CurrentState').value;summary.focus();detail.open=false;detail.dispatch('toggle');detail.open=true;detail.dispatch('toggle');assert.equal(detail.querySelector('.animation-state-event-preview-candidate'),candidate);assert.equal(h.el('CurrentState').value,state);assert.equal(h.el('Result').hidden,true);
 h.mode('completed');h.run();h.adopt();assert.equal(h.rows()[0],row);assert.equal(detail.querySelector('.animation-state-event-preview-candidate'),candidate);assert.equal(h.rows().length,2);
});

test('double adoption cannot append twice and revoked location callbacks never revive after undo and reappend',async t=>{
 const h=await fixture(t);h.valid();h.run();const old=h.el('Transition1Locate');h.adopt();h.el('Adopt').disabled=false;h.adopt();assert.equal(h.rows().length,1);h.undo();old.disabled=false;old.click();assert.equal(h.locations.length,0);h.run();h.adopt();assert.equal(h.rows().length,1);old.click();assert.equal(h.locations.length,0);
});

test('clear history retains the current state and sample but revokes the pending trial',async t=>{
 const h=await fixture(t);h.valid();h.run();h.adopt();h.field('PayloadNumber','5');h.run();h.el('ClearHistory').click();assert.equal(h.rows().length,0);assert.equal(h.el('CurrentState').value,'action');assert.equal(h.el('PayloadNumber').value,'5');assert.equal(h.el('Result').hidden,true);assert.equal(h.el('Undo').disabled,true);h.run();h.adopt();assert.equal(h.rows().length,1);assert.match(h.rows()[0].textContent,/步骤 1.*action → action/);
});

test('the 32-step limit disables adoption but keeps independent trial and undo available',async t=>{
 const h=await fixture(t);h.mode('completed');for(let i=0;i<32;i++){h.run();assert.equal(h.el('Adopt').disabled,false);h.adopt();}assert.equal(h.rows().length,32);h.run();assert.equal(h.el('Run').disabled,false);assert.equal(h.el('Result').hidden,false);assert.equal(h.el('Adopt').disabled,true);assert.match(h.el('Status').textContent,/预算已满/);h.undo();assert.equal(h.rows().length,31);h.run();assert.equal(h.el('Adopt').disabled,false);h.adopt();assert.equal(h.rows().length,32);
});

test('normalized 64KiB sample history budget prevents append and is released by undo',async t=>{
 const h=await fixture(t);h.field('EventName','unknown');h.field('PayloadString','x'.repeat(4096));for(let i=0;i<15;i++){h.run();assert.equal(h.el('Adopt').disabled,false);h.adopt();}h.run();assert.equal(h.el('Run').disabled,false);assert.equal(h.el('Adopt').disabled,true);assert.match(h.el('Status').textContent,/预算已满/);h.undo();h.run();assert.equal(h.el('Adopt').disabled,false);
});

test('completion trials stay usable when hidden raw undo buffers exceed the separate bound',async t=>{
 const h=await fixture(t);h.field('PayloadType','number','change');h.field('PayloadNumber','x'.repeat(262145));h.mode('completed');assert.equal(h.el('Run').disabled,false);h.run();assert.equal(h.el('Result').hidden,false);assert.equal(h.el('Adopt').disabled,true);assert.match(h.el('Status').textContent,/256 KiB/);h.el('Adopt').disabled=false;h.adopt();assert.equal(h.rows().length,0);assert.equal(h.el('Result').hidden,false);h.field('PayloadNumber','retained',null);h.controller.refresh();h.run();assert.equal(h.el('Adopt').disabled,false);
});

test('language changes preserve current inputs and expanded history DOM, focus and read-only details',async t=>{
 const h=await fixture(t);h.valid();h.run();h.adopt();const detail=h.details(0),candidate=detail.querySelector('.animation-state-event-preview-candidate'),summary=detail.querySelector('summary');summary.focus();for(const language of['en','ja','zh']){h.language(language);assert.equal(h.document.activeElement,summary);assert.equal(detail.open,true);assert.equal(detail.querySelector('.animation-state-event-preview-candidate'),candidate);assert.equal(h.rows().length,1);}h.field('PayloadNumber','1e-');const input=h.el('PayloadNumber');input.focus();input.selectionStart=1;input.selectionEnd=3;h.language('ja');assert.equal(h.document.activeElement,input);assert.deepEqual([input.selectionStart,input.selectionEnd],[1,3]);assert.equal(input.value,'1e-');
});

test('author invalidation, session reset and inactive contexts clear steps without resurrecting old details',async t=>{
 for(const kind of['table','generation','reset','inactive','unavailable']){const h=await fixture(t);h.valid();h.run();h.adopt();const detail=h.rows()[0].querySelector('details');if(kind==='table'){const bad=h.source();bad.states[0].key='';h.set(bad);}else if(kind==='generation'){h.context.generation++;h.controller.refresh();}else if(kind==='reset')h.controller.reset();else{h.context[kind==='inactive'?'active':'available']=false;h.controller.refresh();}assert.equal(h.rows().length,0,kind);detail.open=true;detail.dispatch('toggle');assert.equal(detail.querySelectorAll('.animation-state-event-preview-candidate').length,0);}
});

test('raw undo budget counts UTF-8 across steps and releases it on undo or clear',async t=>{
 const h=await fixture(t);h.field('PayloadString','🙂'.repeat(8192));h.mode('completed');for(let i=0;i<7;i++){h.run();assert.equal(h.el('Adopt').disabled,false);h.adopt();}h.run();assert.equal(h.rows().length,7);assert.equal(h.el('Adopt').disabled,true);assert.match(h.el('Status').textContent,/256 KiB/);assert.equal(h.el('Run').disabled,false);
 h.undo();assert.equal(h.rows().length,6);h.run();assert.equal(h.el('Adopt').disabled,false);h.adopt();assert.equal(h.rows().length,7);h.el('ClearHistory').click();h.run();assert.equal(h.el('Adopt').disabled,false);assert.equal(h.el('PayloadString').value,'🙂'.repeat(8192));
});


test('an observed loss of ownership permanently revokes pending adoption even if silent values are restored',async t=>{
 for(const kind of['active','disabled','available','generation','sample','table','comparison']){
  const h=await fixture(t);h.valid();h.run();h.el('Transition1Locate').click();const guard=h.guards[0],before=h.source();
  if(kind==='active')h.context.active=false;else if(kind==='disabled')h.context.disabled=true;else if(kind==='available')h.context.available=false;else if(kind==='generation')h.context.generation++;else if(kind==='sample')h.field('PayloadNumber','4',null);else if(kind==='comparison')h.silentComparison(false);else{const changed=h.source();changed.transitions[0].to='idle';h.replace(changed);}
  assert.equal(guard.isCurrent(),false,kind);
  if(kind==='generation')h.context.generation--;else if(kind==='sample')h.field('PayloadNumber','3',null);else if(kind==='comparison')h.silentComparison(true);else if(kind==='table')h.replace(before);else Object.assign(h.context,{active:true,disabled:false,available:true});
  assert.equal(guard.isCurrent(),false,kind);h.adopt();assert.equal(h.rows().length,0,kind);h.run();h.adopt();assert.equal(h.rows().length,1,kind);
 }
});

test('completion ownership ignores hidden event buffers and the legacy comparison marker',async t=>{
 const h=await fixture(t);h.state('action');h.mode('completed');h.run();h.el('Transition2Locate').click();const guard=h.guards[0];h.field('PayloadNumber','not a number',null);h.field('EventName','invalid name',null);h.silentComparison(false);assert.equal(guard.isCurrent(),true);h.adopt();assert.equal(h.rows().length,1);assert.equal(h.el('CurrentState').value,'idle');
});
