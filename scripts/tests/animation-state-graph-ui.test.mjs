import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const base = () => ({ initialState:'idle',states:[{key:'idle'},{key:'attack'},{key:'isolated'}],transitions:[
 {from:'idle',to:'attack',trigger:{kind:'event',name:'attack.start'}},
 {from:'idle',to:'attack',trigger:{kind:'event',name:'attack.again'}},
 {from:'attack',to:'idle',trigger:{kind:'completed'}},
 {from:'idle',to:'idle',trigger:{kind:'event',name:'rest'}},
] });
async function fixture(t,options={}) {
 const h=await dialogHarness(options.parent?'app-animation-state-script':'app-animation-state-graph',options.overrides),container=h.document.createElement('div');h.document.body.append(container);
 const context={active:true,available:true,disabled:false,generation:1};let table=base(),language='zh',changes=0;const locations=[];
 const translate=(key,...args)=>({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=options.parent?h.runtime.setupAnimationStateScript({container,getContext:()=>context,onChange:()=>changes++,translate})
 :h.runtime.setupAnimationStateGraph({container,getContext:()=>context,getTable:()=>table,translate,onLocate:(value,guard)=>{if(!guard.isCurrent())return false;locations.push(copy(value));return true;}});
 if(options.parent)controller.setValue(copy(table));t.after(()=>controller.dispose());
 const el=suffix=>h.element('animationStateScriptGraph'+suffix),form=suffix=>h.element('animationStateScript'+suffix);
 return{...h,controller,container,context,el,form,locations,changes:()=>changes,value:()=>options.parent?copy(controller.getValue()):copy(table),
 set(value){if(options.parent)controller.setValue(copy(value));else{table=value;controller.refresh();}},language(value){language=value;controller.refresh();},
 field(suffix,value,event='input'){const node=form(suffix);node.value=value;if(event)node.dispatch(event);},toggle(){el('Toggle').click();}};
}

test('state graph is opt-in and rendering, selection and folding never change a table',async t=>{
 const h=await fixture(t,{parent:true}),before=h.value();assert.equal(h.el('Body').hidden,true);assert.equal(h.el('Canvas').children.length,0);h.toggle();
 assert.equal(h.el('Body').hidden,false);assert.equal(h.el('Toggle').getAttribute('aria-expanded'),'true');assert.equal(h.el('Canvas').children.length,1);
 h.el('Node1').click();h.el('Transition2Select').click();h.toggle();assert.equal(h.el('Canvas').children.length,0);assert.deepEqual(h.value(),before);assert.equal(h.changes(),0);
 assert.deepEqual(Object.keys(h.controller).sort(),['dispose','getValue','refresh','reset','setDisabled','setValue']);
});

test('SVG and HTML retain isolated states, self edges, reverse directions and grouped event triggers',async t=>{
 const h=await fixture(t);h.toggle();assert.equal(h.el('States').children.length,3);assert.equal(h.el('Transitions').children.length,4);
 assert.equal(h.el('Canvas').querySelectorAll('.animation-state-graph-route').length,3);assert.match(h.el('State1Select').textContent,/初始状态.*idle/);
 assert.match(h.el('Route1').getAttribute('aria-label'),/attack.start.*attack.again/);assert.match(h.el('Route2').getAttribute('aria-label'),/动画自然完成/);
 assert.equal(h.el('Route2').querySelector('path').getAttribute('stroke-dasharray'),'8 5');assert.match(h.el('Route3').getAttribute('aria-label'),/idle → idle/);
 h.el('Route1').click();assert.equal(h.el('Transition1Select').getAttribute('aria-pressed'),'true');assert.equal(h.el('Transition2Select').getAttribute('aria-pressed'),'true');
 h.el('Transition1Select').click();assert.equal(h.el('Transition2Select').getAttribute('aria-pressed'),'false');assert.equal(h.el('Route1').dataset.selected,'true');
});

test('state and transition locations focus existing fields without input or change events',async t=>{
 const h=await fixture(t,{parent:true});h.toggle();const state=h.form('State2Key'),from=h.form('Transition2From');let events=0;
 for(const control of[state,from])for(const type of['input','change'])control.addEventListener(type,()=>events++);
 h.el('State2Locate').click();assert.equal(h.document.activeElement,state);h.el('Transition2Locate').click();assert.equal(h.document.activeElement,from);assert.equal(events,0);assert.equal(h.changes(),0);
});

test('keyboard SVG selection and the HTML fallback expose identical read-only choices',async t=>{
 const h=await fixture(t);h.toggle();const key=h.el('Node2').dispatch('keydown',{key:'Enter'});assert.equal(key.defaultPrevented,true);assert.equal(h.el('State2Select').getAttribute('aria-pressed'),'true');
 h.el('Route2').dispatch('keydown',{key:' '});assert.equal(h.el('Transition3Select').getAttribute('aria-pressed'),'true');h.el('State3Locate').click();assert.deepEqual(h.locations,[{kind:'state',index:2}]);
 h.el('Node1').dispatch('keydown',{key:'Enter',isComposing:true});assert.equal(h.el('State1Select').getAttribute('aria-pressed'),'false');
});

test('invalid and incomplete forms clear old graph and prevent stale location controls',async t=>{
 const h=await fixture(t,{parent:true});h.toggle();const old=h.el('State2Locate');h.field('State2Key','');assert.equal(h.el('Canvas').children.length,0);assert.equal(h.el('Lists').hidden,true);assert.match(h.el('Status').textContent,/尚未有效/);
 h.form('State1Key').focus();old.disabled=false;old.click();assert.equal(h.document.activeElement,h.form('State1Key'));
 h.field('State2Key','attack');assert.equal(h.el('Canvas').children.length,1);h.field('Transition2Event','attack.start');assert.equal(h.el('Canvas').children.length,0);
});

test('reset with identical values and remove-recreate of a row revoke old graph callbacks',async t=>{
 const h=await fixture(t,{parent:true});h.toggle();let old=h.el('State2Locate');const current=h.value();h.controller.reset(copy(current));h.form('State1Key').focus();old.disabled=false;old.click();assert.equal(h.document.activeElement,h.form('State1Key'));
 old=h.el('State3Locate');h.form('State3Remove').click();h.form('AddState').click();h.field('State4Key','isolated');h.form('State1Key').focus();old.disabled=false;old.click();assert.equal(h.document.activeElement,h.form('State1Key'));
 h.el('State3Locate').click();assert.equal(h.document.activeElement,h.form('State4Key'));
});

test('a field changed without an event cannot be located through an outdated graph',async t=>{
 const h=await fixture(t,{parent:true});h.toggle();const old=h.el('State2Locate');h.field('State2Key','changed',null);h.form('State1Key').focus();old.click();assert.equal(h.document.activeElement,h.form('State1Key'));
 h.controller.refresh();h.el('State2Locate').click();assert.equal(h.document.activeElement,h.form('State2Key'));
});

test('hidden, disabled and unavailable contexts clear graphs and old callbacks stay revoked after restoration',async t=>{
 for(const patch of[{active:false},{disabled:true},{available:false}]){const h=await fixture(t);h.toggle();const old=h.el('State1Locate');Object.assign(h.context,patch);h.controller.refresh();assert.equal(h.el('Canvas').children.length,0);old.disabled=false;old.click();assert.equal(h.locations.length,0);
 Object.assign(h.context,{active:true,disabled:false,available:true});h.controller.refresh();if(h.el('Body').hidden)h.toggle();old.disabled=false;old.click();assert.equal(h.locations.length,0);h.el('State1Locate').click();assert.equal(h.locations.length,1);}
});

test('three languages keep graph and form nodes, focus, selection and table values unchanged',async t=>{
 const h=await fixture(t,{parent:true});h.toggle();h.el('Transition2Select').click();const graphButton=h.el('Transition2Locate'),input=h.form('State2Key'),before=h.value();input.focus();input.selectionStart=1;input.selectionEnd=4;
 for(const language of['en','ja','zh']){h.language(language);assert.equal(h.el('Transition2Locate'),graphButton);assert.equal(h.document.activeElement,input);assert.deepEqual([input.selectionStart,input.selectionEnd],[1,4]);assert.deepEqual(h.value(),before);assert.equal(h.el('Transition2Select').getAttribute('aria-pressed'),'true');}
 graphButton.focus();for(const language of['en','ja']){h.language(language);assert.equal(h.document.activeElement,graphButton);}assert.equal(h.changes(),0);
});

test('full keys and maximum event names remain literal readable text without SVG markup interpolation',async t=>{
 const h=await fixture(t),key='abcdefghijklmnopqrstuvwxyz012345',event='e'+'.'.repeat(63);h.set({initialState:key,states:[{key}],transitions:[{from:key,to:key,trigger:{kind:'event',name:event}}]});h.toggle();
 assert.ok(h.el('State1Select').textContent.includes(key));assert.equal(h.el('Node1').querySelectorAll('tspan').map(n=>n.textContent).join(''),key);assert.ok(h.el('Transitions').textContent.includes(event));assert.equal(h.el('Canvas').querySelectorAll('script').length,0);
});

test('all sixteen states and sixty-four transitions have individual HTML choices and locations',async t=>{
 const h=await fixture(t),states=Array.from({length:16},(_,i)=>({key:'state_'+i}));h.set({initialState:states[0].key,states,transitions:states.flatMap((state,i)=>Array.from({length:4},(_,j)=>({from:state.key,to:states[(i+j)%16].key,trigger:{kind:'event',name:'event'+j}})))});h.toggle();
 assert.equal(h.el('States').children.length,16);assert.equal(h.el('Transitions').children.length,64);h.el('Transition64Locate').click();assert.deepEqual(h.locations,[{kind:'transition',index:63}]);
});

test('a valid table without transitions still shows its initial and isolated states',async t=>{
 const h=await fixture(t),value=base();value.transitions=[];h.set(value);h.toggle();assert.equal(h.el('States').children.length,3);assert.equal(h.el('Transitions').children.length,0);assert.equal(h.el('Empty').hidden,false);
});

test('core failure and disposal leave no stale SVG or field-location action',async t=>{
 const h=await fixture(t,{overrides:{createAnimationStateGraph(){throw Object.assign(Error('optional'),{errorCode:'studio_core_unavailable'});}}});h.toggle();assert.equal(h.el('Canvas').children.length,0);assert.match(h.el('Status').textContent,/核心无法/);
 const active=await fixture(t);active.toggle();const old=active.el('State1Locate');active.controller.dispose();old.disabled=false;old.click();assert.equal(active.locations.length,0);assert.equal(active.container.children.length,0);
});

test('all graph messages have English and Japanese translations',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-animation-state-graph.js',import.meta.url),'utf8');const keys=new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(m=>m[1]));
 for(const key of keys){assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);}
});


test('mounting the folded graph never reads a parent session before its initialization completes',async t=>{
 const h=await dialogHarness('app-animation-state-graph'),container=h.document.createElement('div');h.document.body.append(container);
 let reads=0;const controller=h.runtime.setupAnimationStateGraph({container,getContext(){reads++;throw Error('parent not ready');},getTable(){throw Error('table not ready');}});
 t.after(()=>controller.dispose());assert.equal(reads,0);assert.equal(h.element('animationStateScriptGraphBody').hidden,true);
});


test('conditional graph explanations preserve explicit type, operator and JSON literal without evaluating payloads',async t=>{
 const h=await fixture(t),table=base();table.transitions[0].trigger.condition={type:'boolean',operator:'ne',value:false};table.transitions[1].trigger.condition={type:'string',operator:'eq',value:'<script>"🙂\n'};h.set(table);h.toggle();assert.equal(h.el('Canvas').children.length,1);assert.match(h.el('Transitions').textContent,/boolean.*!=.*false/);assert.ok(h.el('Transitions').textContent.includes(JSON.stringify(table.transitions[1].trigger.condition.value)));assert.equal(h.el('Canvas').querySelectorAll('script').length,0);
 const before=h.value();for(const locale of['en','ja','zh'])h.language(locale);assert.deepEqual(h.value(),before);assert.equal(h.locations.length,0);
});

test('shared-state graph labels show the literal key and comparison without claiming a live match', async t => {
  const h = await fixture(t), table = base(); table.transitions[0].trigger.condition = { type: 'boolean', operator: 'ne', value: false, selector: { kind: 'projectState', key: 'Combat.Enabled' } };
  table.transitions[1].trigger.condition = { type: 'string', operator: 'eq', value: '<script>"🙂\n' }; h.set(table); h.toggle(); assert.equal(h.el('Canvas').children.length, 1);
  assert.match(h.el('Transitions').textContent, /项目共享状态 "Combat.Enabled".*boolean.*!=.*false/); assert.ok(h.el('Transitions').textContent.includes(JSON.stringify(table.transitions[1].trigger.condition.value)));
  const before = h.value(), button = h.el('Transition1Locate'); button.focus();
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.document.activeElement, button); assert.equal(h.el('Transition1Locate'), button); assert.ok(h.el('Transitions').textContent.includes('"Combat.Enabled"')); }
  assert.deepEqual(h.value(), before); assert.equal(h.locations.length, 0); assert.equal(h.el('Canvas').querySelectorAll('script').length, 0);
});
