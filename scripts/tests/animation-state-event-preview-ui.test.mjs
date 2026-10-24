import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { animationStateEventPreviewKeys } from '../../engine/animation-state-event-preview.mjs';
import { createAnimationStateTrialSequence, previewAnimationStateTrialStep } from '../../engine/animation-state-trial-sequence.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const scalar = (type='number',operator='gte',value=2,key) => ({type,operator,value,...(key?{selector:{kind:'projectState',key}}:{})});
const base = () => ({eventSelection:'firstMatch',initialState:'idle',states:[{key:'idle'},{key:'attack'},{key:'rest'}],transitions:[
 {from:'idle',to:'attack',trigger:{kind:'event',name:'act',condition:{combine:'all',conditions:[scalar(),scalar('boolean','eq',true,'ready'),scalar('string','ne','stop','mode')]}}},
 {from:'idle',to:'rest',trigger:{kind:'event',name:'act',condition:{combine:'any',conditions:[scalar('string','eq','go','mode'),scalar('number','lt',0)]}}},
 {from:'idle',to:'idle',trigger:{kind:'event',name:'act'}},
 {from:'attack',to:'rest',trigger:{kind:'event',name:'act',condition:scalar('number','eq',3,'power')}},
 {from:'attack',to:'idle',trigger:{kind:'completed'}},
]});
async function fixture(t,{table=base(),failCreate=false,failRun=false}={}) {
 let reads=0,inspections=0,evaluations=0,language='zh',compare=true,source=copy(table),generation=1;
 const context={active:true,available:true,disabled:false,generation};const locations=[],guards=[],inputs=[];
 const h=await dialogHarness('app-animation-state-event-preview',{
  createAnimationStateTrialSequence(value,stateKey){inspections++;if(failCreate)throw Object.assign(Error('no core'),{errorCode:'studio_core_unavailable'});return createAnimationStateTrialSequence(copy(value),stateKey);},
  animationStateEventPreviewKeys,
  previewAnimationStateTrialStep(sequence,input){evaluations++;inputs.push(copy(input));if(failRun)throw Error('run');return previewAnimationStateTrialStep(sequence,copy(input));},
  supportsStudioCoreAnimationStateConditions:()=>compare,
 });
 const container=h.document.createElement('div');h.document.body.append(container);
 const translate=(key,...args)=>({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=h.runtime.setupAnimationStateEventPreview({container,idPrefix:'trial',getContext:()=>context,getTable:()=>{reads++;return source;},translate,
 onLocate(value,guard){guards.push(guard);if(!guard.isCurrent())return false;locations.push(copy(value));return true;}});
 t.after(()=>controller.dispose());const el=suffix=>h.element('trial'+suffix);
 const field=(suffix,value,event='input')=>{const control=el(suffix);control.value=value;if(event)control.dispatch(event);};
 const shared=key=>el('SharedStates').children.find(row=>row.dataset.key===key);
 const sharedField=(key,suffix,value,event)=>{const control=suffix==='Boolean'?shared(key).querySelectorAll('select').find(node=>node.id.endsWith('Boolean')):shared(key).querySelector(suffix==='Type'?'select':suffix==='String'?'textarea':suffix==='Number'?'input':'select');control.value=value;control.dispatch(event||(['Type','Boolean'].includes(suffix)?'change':'input'));};
 return {...h,controller,container,context,el,locations,guards,inputs,field,shared,sharedField,open(){el('Toggle').click();},run(){el('Run').click();},
  set(value){source=copy(value);controller.refresh();},replace(value){source=copy(value);},value:()=>copy(source),reads:()=>reads,inspections:()=>inspections,evaluations:()=>evaluations,
  language(value){language=value;controller.refresh();},comparison(value){compare=value;controller.refresh();}};
}

test('trial stays opt-in; collapsed refresh does not inspect tables or evaluate samples',async t=>{
 const h=await fixture(t),before=h.value();for(let i=0;i<25;i++)h.controller.refresh();assert.equal(h.reads(),0);assert.equal(h.inspections(),0);assert.equal(h.evaluations(),0);
 assert.equal(h.el('Body').hidden,true);h.open();assert.equal(h.inspections(),1);assert.equal(h.evaluations(),0);assert.equal(h.el('Result').hidden,true);
 h.field('PayloadType','number','change');h.field('PayloadNumber','2');h.sharedField('ready','Type','boolean');h.sharedField('ready','Boolean','true');h.run();
 assert.equal(h.evaluations(),1);assert.deepEqual(h.value(),before);assert.deepEqual(Object.keys(h.controller).sort(),['dispose','refresh','reset']);
});

test('ordered branches and all/any short circuit show evaluated operands without claiming runtime execution',async t=>{
 const h=await fixture(t);h.open();h.field('PayloadType','number','change');h.field('PayloadNumber','2');h.sharedField('ready','Type','boolean');h.sharedField('ready','Boolean','true');h.sharedField('mode','Type','string');h.sharedField('mode','String','walk');h.run();
 assert.match(h.el('Summary').textContent,/转换 1.*idle → attack/);assert.equal(h.el('Candidates').children.length,3);assert.equal(h.el('Transition1').dataset.status,'selected');assert.equal(h.el('Transition2').dataset.status,'not-evaluated');
 assert.match(h.el('Transition1').textContent,/实际样本.*2/s);assert.match(h.el('Transition2').textContent,/未读取样本值/);assert.match(h.el('Note').textContent,/手动.*不代表历史运行/s);
 h.field('PayloadNumber','0');h.sharedField('mode','String','go');h.run();assert.equal(h.el('Transition1').dataset.status,'rejected');assert.match(h.el('Transition1').textContent,/组合已短路/);assert.equal(h.el('Transition2').dataset.status,'selected');assert.match(h.el('Transition2').textContent,/组合已短路/);
});

test('missing keys and mismatched types remain distinct, including not-equal conditions',async t=>{
 const table=base();table.transitions[0].trigger.condition=scalar('string','ne','stop','mode');const h=await fixture(t,{table});h.open();h.run();assert.match(h.el('Transition1').textContent,/共享键缺失.*包括不等于/);
 h.sharedField('mode','Type','number');h.sharedField('mode','Number','3');h.run();assert.match(h.el('Transition1').textContent,/样本类型不同.*包括不等于/);assert.match(h.el('Transition1').textContent,/数字（number）.*3/s);
 h.sharedField('mode','Type','string');h.sharedField('mode','String','');h.run();assert.equal(h.el('Transition1').dataset.status,'selected');
});

test('shared selectors are candidate-scoped and deduplicated; switching samples restores local per-key buffers',async t=>{
 const h=await fixture(t);h.open();assert.deepEqual(h.el('SharedStates').children.map(row=>row.dataset.key),['ready','mode']);h.sharedField('mode','Type','string');h.sharedField('mode','String','saved');
 h.field('CurrentState','attack','change');assert.deepEqual(h.el('SharedStates').children.map(row=>row.dataset.key),['power']);h.field('CurrentState','idle','change');assert.equal(h.shared('mode').querySelector('textarea').value,'saved');
 h.field('EventName','unconfigured');assert.equal(h.el('SharedStates').children.length,0);h.run();assert.equal(h.el('Candidates').children.length,0);assert.match(h.el('Summary').textContent,/未选择转换.*idle/);assert.equal(h.el('Result').hidden,false);
 h.field('EventName','act');assert.equal(h.shared('mode').querySelector('textarea').value,'saved');
});

test('a selector removed from the table cannot recover an old sample when re-added',async t=>{
 const table=base(),h=await fixture(t,{table});h.open();h.sharedField('mode','Type','string');h.sharedField('mode','String','discard');
 const changed=copy(table);changed.transitions[0].trigger.condition.conditions=changed.transitions[0].trigger.condition.conditions.filter(leaf=>leaf.selector?.key!=='mode');changed.transitions[1].trigger.condition.conditions=[scalar('number','lt',0)];h.set(changed);assert.equal(h.shared('mode'),undefined);
 h.set(table);assert.equal(h.shared('mode').querySelector('select').value,'missing');assert.equal(h.shared('mode').querySelector('textarea').value,'');
});

test('samples retain distinct empty string, false and zero and reject incomplete numeric input',async t=>{
 const h=await fixture(t);h.open();h.run();assert.equal(h.inputs.at(-1).event.value,'');h.field('PayloadType','boolean','change');h.run();assert.equal(h.inputs.at(-1).event.value,false);
 h.field('PayloadType','number','change');for(const invalid of['',' ','1e','1e-','+1','01','0x10','NaN','Infinity','1e10','1\n']){h.field('PayloadNumber',invalid);assert.equal(h.el('Run').disabled,true,invalid);assert.equal(h.el('PayloadNumber').getAttribute('aria-invalid'),'true');}
 h.field('PayloadNumber','-0');h.run();assert.equal(h.inputs.at(-1).event.value,0);h.field('PayloadNumber','1e-2');h.run();assert.equal(h.inputs.at(-1).event.value,0.01);
 h.field('PayloadType','string','change');assert.equal(h.el('PayloadString').value,'');h.field('PayloadType','number','change');assert.equal(h.el('PayloadNumber').value,'1e-2');
});

test('manual string samples enforce UTF-8 and Unicode while keeping literal markup and NUL',async t=>{
 const h=await fixture(t);h.open();for(const value of['🙂'.repeat(1025),'\ud800']){h.field('PayloadString',value);assert.equal(h.el('Run').disabled,true);assert.equal(h.el('PayloadString').getAttribute('aria-invalid'),'true');}
 h.field('PayloadString','<img onerror=alert(1)>\0');h.run();assert.equal(h.inputs.at(-1).event.value,'<img onerror=alert(1)>\0');assert.equal(h.el('Result').querySelectorAll('img').length,0);assert.match(h.el('Transition1').textContent,/<img onerror=alert\(1\)>/);
});

test('table and manual input changes clear results and revoke retained field-location callbacks',async t=>{
 const h=await fixture(t);h.open();h.run();let old=h.el('Transition1Locate');old.click();assert.deepEqual(h.locations,[{kind:'transition',index:0}]);const guard=h.guards[0];h.field('PayloadString','changed');assert.equal(h.el('Result').hidden,true);assert.equal(guard.isCurrent(),false);old.disabled=false;old.click();assert.equal(h.locations.length,1);
 h.run();old=h.el('Transition1Locate');const next=h.value();next.transitions[0].to='rest';h.set(next);assert.equal(h.el('Result').hidden,true);old.disabled=false;old.click();assert.equal(h.locations.length,1);assert.equal(h.el('PayloadString').value,'changed');
});

test('unobserved table or sample edits cannot use previous result locations',async t=>{
 const h=await fixture(t);h.open();h.run();let old=h.el('Transition1Locate');h.field('PayloadString','without event',null);old.click();assert.equal(h.locations.length,0);h.controller.refresh();assert.equal(h.el('Result').hidden,true);
 h.run();old=h.el('Transition1Locate');const next=h.value();next.states.push({key:'extra'});h.replace(next);old.click();assert.equal(h.locations.length,0);h.controller.refresh();assert.equal(h.el('Result').hidden,true);
});

test('table invalidation and removed current states clear results without silently choosing another state',async t=>{
 const h=await fixture(t);h.open();h.run();const bad=h.value();bad.states[0].key='';h.set(bad);assert.equal(h.el('Result').hidden,true);assert.match(h.el('Status').textContent,/状态表尚未有效/);assert.equal(h.el('Run').disabled,true);
 h.set(base());h.field('CurrentState','rest','change');const next=base();next.states=next.states.filter(s=>s.key!=='rest');next.transitions=next.transitions.filter(edge=>edge.to!=='rest'&&edge.from!=='rest');h.set(next);assert.equal(h.el('CurrentState').value,'rest');assert.equal(h.el('Run').disabled,true);assert.match(h.el('Status').textContent,/请选择当前表中的状态/);h.language('en');assert.match(h.el('CurrentState').children.at(-1).textContent,/Removed state/);
});

test('close, availability loss, disabled context and reset never restore an old result',async t=>{
 for(const patch of[{disabled:true},{available:false},{active:false}]){const h=await fixture(t);h.open();h.field('PayloadString','kept');h.run();const old=h.el('Transition1Locate');Object.assign(h.context,patch);h.controller.refresh();assert.equal(h.el('Result').hidden,true);old.disabled=false;old.click();assert.equal(h.locations.length,0);Object.assign(h.context,{active:true,available:true,disabled:false});h.controller.refresh();if(h.el('Body').hidden)h.open();assert.equal(h.el('Result').hidden,true);assert.equal(h.el('PayloadString').value,'kept');}
 const h=await fixture(t);h.open();h.run();h.open();assert.equal(h.el('Result').hidden,true);h.open();assert.equal(h.el('Result').hidden,true);h.field('PayloadString','reset');h.run();const old=h.el('Transition1Locate');h.controller.reset();h.open();assert.equal(h.el('PayloadString').value,'');assert.equal(h.el('Result').hidden,true);old.disabled=false;old.click();assert.equal(h.locations.length,0);
});

test('capability withdrawal affects trial results while existing samples remain editable',async t=>{
 const h=await fixture(t);h.open();h.run();const old=h.el('Transition1Locate');h.comparison(false);assert.equal(h.el('Result').hidden,true);assert.equal(h.el('Run').disabled,true);assert.match(h.el('Status').textContent,/无法比较/);assert.equal(h.el('PayloadString').disabled,false);old.disabled=false;old.click();assert.equal(h.locations.length,0);h.comparison(true);assert.equal(h.el('Result').hidden,true);h.run();assert.equal(h.el('Result').hidden,false);
 const plain=base();plain.transitions=plain.transitions.filter(edge=>!edge.trigger.condition);const unconditional=await fixture(t,{table:plain});unconditional.open();unconditional.comparison(false);assert.equal(unconditional.el('Run').disabled,false);unconditional.run();assert.equal(unconditional.el('Result').hidden,false);
});

test('language refresh preserves sample nodes, focus, selection and current result without rerunning comparisons',async t=>{
 const h=await fixture(t);h.open();h.field('PayloadString','abc');h.run();const input=h.el('PayloadString'),location=h.el('Transition1Locate'),shared=h.shared('mode');input.focus();input.selectionStart=1;input.selectionEnd=2;const inspections=h.inspections(),evaluations=h.evaluations();
 for(const language of['en','ja','zh']){h.language(language);assert.equal(h.el('PayloadString'),input);assert.equal(h.shared('mode'),shared);assert.equal(h.document.activeElement,input);assert.deepEqual([input.selectionStart,input.selectionEnd],[1,2]);assert.equal(h.el('Transition1Locate'),location);assert.equal(h.el('Result').hidden,false);}
 assert.equal(h.inspections(),inspections);assert.equal(h.evaluations(),evaluations);location.focus();h.language('en');assert.equal(h.document.activeElement,location);assert.match(h.el('ResultTitle').textContent,/Manual/);
});

test('construction avoids parent TDZ, generation changes revoke results, and disposal clears retained callbacks',async t=>{
 const h=await fixture(t);h.open();h.run();let old=h.el('Transition1Locate');h.context.generation++;h.controller.refresh();assert.equal(h.el('Result').hidden,true);old.disabled=false;old.click();assert.equal(h.locations.length,0);h.run();old=h.el('Transition1Locate');h.controller.dispose();old.disabled=false;old.click();assert.equal(h.locations.length,0);assert.equal(h.container.children.length,0);
 const harness=await dialogHarness('app-animation-state-event-preview'),container=harness.document.createElement('div');let calls=0;const control=harness.runtime.setupAnimationStateEventPreview({container,getContext(){calls++;throw Error('TDZ');},getTable(){calls++;throw Error('TDZ');}});assert.equal(calls,0);control.dispose();
});

test('admission and evaluation failures leave no result and all labels have English and Japanese translations',async t=>{
 const unavailable=await fixture(t,{failCreate:true});unavailable.open();assert.equal(unavailable.el('Run').disabled,true);assert.match(unavailable.el('Status').textContent,/当前核心无法/);
 const failed=await fixture(t,{failRun:true});failed.open();failed.run();assert.equal(failed.el('Result').hidden,true);assert.match(failed.el('Status').textContent,/无法试算/);
 const source=await fs.readFile(new URL('../../web/modules/app-animation-state-event-preview.js',import.meta.url),'utf8');const keys=new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(m=>m[1]));for(const key of keys){assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);}
 const css=await fs.readFile(new URL('../../web/animation-state-event-preview.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/overflow-wrap:anywhere/);
});


test('temporarily invalid table fields preserve shared samples but discard the old result',async t=>{
 const h=await fixture(t);h.open();h.sharedField('mode','Type','string');h.sharedField('mode','String','keep through typing');h.run();const invalid=h.value();invalid.states[0].key='';h.set(invalid);assert.equal(h.el('Result').hidden,true);assert.equal(h.el('SharedStates').children.length,0);h.set(base());assert.equal(h.shared('mode').querySelector('textarea').value,'keep through typing');assert.equal(h.shared('mode').querySelector('select').value,'string');assert.equal(h.el('Result').hidden,true);
});

test('all sixty-four candidates remain available with unique DOM IDs and bounded reads on language refresh',async t=>{
 const table=base();table.transitions=Array.from({length:64},(_,index)=>({from:'idle',to:'attack',trigger:{kind:'event',name:'act',...(index<63?{condition:scalar('number','gt',index)}:{})}}));
 const h=await fixture(t,{table});h.open();h.run();assert.equal(h.el('Candidates').children.length,64);assert.equal(h.el('Transition64').dataset.status,'selected');h.el('Transition64Locate').click();assert.deepEqual(h.locations,[{kind:'transition',index:63}]);
 const before=h.reads();h.language('en');assert.ok(h.reads()-before<=4);const ids=h.container.querySelectorAll('[id]').map(node=>node.id);assert.equal(new Set(ids).size,ids.length);assert.equal(h.evaluations(),1);
});
