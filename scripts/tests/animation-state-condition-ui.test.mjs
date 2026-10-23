import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const base=()=>({initialState:'idle',states:[{key:'idle'},{key:'attack'}],transitions:[{from:'idle',to:'attack',trigger:{kind:'event',name:'hit'}},{from:'attack',to:'idle',trigger:{kind:'completed'}}]});
async function fixture(t,{parent=false,value,available=true,selectorsAvailable=true,branchesAvailable=true}={}){
 let changes=0,language='zh',capability=available,selectors=selectorsAvailable;const context={active:true,available,selectorsAvailable,disabled:false};
 const h=await dialogHarness(parent?'app-animation-state-script':'app-animation-state-condition',{supportsStudioCoreAnimationStateConditions:()=>capability,supportsStudioCoreAnimationStateSelectors:()=>selectors,supportsStudioCoreAnimationStateBranches:()=>branchesAvailable});
 const container=h.document.createElement('div');h.document.body.append(container);
 const translate=(key,...args)=>({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=parent?h.runtime.setupAnimationStateScript({container,getContext:()=>context,onChange:()=>changes++,translate})
 :h.runtime.setupAnimationStateCondition({container,getContext:()=>context,onChange:()=>changes++,translate,value});
 if(parent)controller.setValue(value||base());else controller.refresh();t.after(()=>controller.dispose());
 const el=suffix=>h.element((parent?'animationStateScriptTransition1Condition':'animationStateCondition')+suffix);
 return{...h,container,context,controller,el,parent,changes:()=>changes,value:()=>copy(controller.getValue()),
 set(suffix,value,event='change'){const element=el(suffix);element.value=value;if(event)element.dispatch(event);},
 language(value){language=value;controller.refresh();},capability(value){capability=value;if(!parent)context.available=value;controller.refresh();},
 selectorCapability(value){selectors=value;context.selectorsAvailable=value;controller.refresh();},
 form(suffix,value,event='change'){const element=h.element('animationStateScript'+suffix);element.value=value;if(event)element.dispatch(event);}};
}

test('unconditional declarations omit condition entirely and tentative hidden values do not report a table change',async t=>{
 const h=await fixture(t);assert.equal(h.value(),undefined);h.set('Type','number');h.set('Number','1e-','input');assert.equal(h.value(),undefined);assert.equal(h.changes(),0);
 h.set('Mode','compare');assert.deepEqual(h.value(),{type:'number',operator:'eq',value:'1e-'});assert.equal(h.changes(),1);
});

test('typed empty string, false and numeric zero remain distinct values',async t=>{
 const h=await fixture(t);h.set('Mode','compare');assert.deepEqual(h.value(),{type:'string',operator:'eq',value:''});
 h.set('Type','boolean');assert.deepEqual(h.value(),{type:'boolean',operator:'eq',value:false});h.set('Boolean','true');assert.equal(h.value().value,true);
 h.set('Type','number');h.set('Number','0','input');assert.equal(h.value().value,0);assert.equal(typeof h.value().value,'number');
});

test('unfinished, empty, nonfinite and out-of-range numbers stay raw and cannot become zero or string conditions',async t=>{
 const h=await fixture(t);h.set('Mode','compare');h.set('Type','number');
 for(const raw of['',' ','1e','1e-','-','+1','01','Infinity','NaN','1e10','-1000000001','1\n','0x10']){h.set('Number',raw,'input');assert.deepEqual(h.value(),{type:'number',operator:'eq',value:raw});assert.equal(h.el('Number').getAttribute('aria-invalid'),'true');}
 for(const raw of['0','-0','-1.5','1e-2','1e9','-1e9']){h.set('Number',raw,'input');assert.equal(typeof h.value().value,'number');assert.equal(h.el('Number').getAttribute('aria-invalid'),'false');}
});

test('switching types retains separate raw inputs and never silently changes an incompatible operator',async t=>{
 const h=await fixture(t);h.set('Mode','compare');h.set('String','text🙂','input');h.set('Type','number');h.set('Number','1e-','input');h.set('Operator','lt');
 h.set('Type','boolean');h.set('Boolean','true');assert.equal(h.value().operator,'lt');assert.match(h.el('Status').textContent,/仅支持/);
 h.set('Type','string');assert.equal(h.el('String').value,'text🙂');h.set('Type','number');assert.equal(h.el('Number').value,'1e-');h.set('Type','boolean');assert.equal(h.value().value,true);
});

test('none and comparison round trips preserve typed local values without exporting null',async t=>{
 const h=await fixture(t,{value:{type:'number',operator:'gte',value:2}});h.set('Number','2e-','input');h.set('Mode','none');assert.equal(h.value(),undefined);h.set('Mode','compare');assert.deepEqual(h.value(),{type:'number',operator:'gte',value:'2e-'});
});

test('loaded multiline strings retain exact CRLF until edited and UTF-8 limits are visible',async t=>{
 const h=await fixture(t,{value:{type:'string',operator:'ne',value:'a\r\n🙂\r\nb'}});assert.equal(h.el('String').value,'a\n🙂\nb');assert.equal(h.value().value,'a\r\n🙂\r\nb');
 h.set('String','edited\n🙂','input');assert.equal(h.value().value,'edited\n🙂');h.set('String','🙂'.repeat(1025),'input');assert.match(h.el('Status').textContent,/4096/);assert.equal(h.el('String').getAttribute('aria-invalid'),'true');
});

test('three-language refresh preserves raw inputs, active nodes and selections without reporting changes',async t=>{
 const h=await fixture(t);h.set('Mode','compare');h.set('Type','number');h.set('Number','1e-','input');const input=h.el('Number'),count=h.changes();input.focus();input.selectionStart=1;input.selectionEnd=3;
 for(const locale of['en','ja','zh']){h.language(locale);assert.equal(h.document.activeElement,input);assert.equal(h.el('Number'),input);assert.equal(input.value,'1e-');assert.deepEqual([input.selectionStart,input.selectionEnd],[1,3]);assert.equal(h.changes(),count);}
});

test('condition capability absence disables only assistance and preserves an existing condition',async t=>{
 const condition={type:'boolean',operator:'eq',value:false},h=await fixture(t,{available:false,selectorsAvailable:false,value:condition});assert.deepEqual(h.value(),condition);assert.equal(h.el('Mode').disabled,false);assert.equal(h.el('Type').disabled,true);assert.match(h.el('Status').textContent,/已有条件会保留/);
 h.el('Mode').dispatch('change');assert.equal(h.changes(),0);h.capability(true);assert.equal(h.el('Mode').disabled,false);assert.deepEqual(h.value(),condition);
});

test('disabled, hidden and disposed controls cannot report changes through retained callbacks',async t=>{
 const h=await fixture(t),old=h.el('Mode');for(const patch of[{disabled:true},{active:false}]){Object.assign(h.context,{active:true,disabled:false},patch);h.controller.refresh();old.value='compare';old.dispatch('change');assert.equal(h.changes(),0);}
 h.controller.dispose();old.dispatch('change');assert.equal(h.changes(),0);
});

test('shared legacy tables keep the exact old DTO and a missing new marker does not disable old fields',async t=>{
 const h=await fixture(t,{parent:true,available:false,selectorsAvailable:false});h.context.available=true;h.controller.refresh();assert.deepEqual(h.value(),base());assert.equal(h.el('Mode').disabled,false);assert.equal(h.el('Mode').children.find(item=>item.value==='compare').disabled,true);
 h.form('State2Key','changed','input');assert.equal(h.value().states[1].key,'changed');assert.equal(h.value().transitions[0].to,'changed');assert.equal(h.value().transitions[0].trigger.condition,undefined);
});

test('completed transitions omit conditions but restore the raw event condition when switched back',async t=>{
 const h=await fixture(t,{parent:true});h.set('Mode','compare');h.set('Type','number');h.set('Number','1e-','input');const raw=h.value().transitions[0].trigger.condition;
 h.form('Transition1Kind','completed');assert.deepEqual(h.value().transitions[0].trigger,{kind:'completed'});assert.equal(h.el('Mode').parentElement.parentElement.hidden,true);
 h.form('Transition1Kind','event');assert.deepEqual(h.value().transitions[0].trigger.condition,raw);assert.equal(h.el('Number').value,'1e-');
});

test('shared reset and row removal invalidate old condition controls without changing a replacement row',async t=>{
 const h=await fixture(t,{parent:true}),old=h.el('Mode');h.controller.reset(base());const count=h.changes();old.value='compare';old.dispatch('change');assert.equal(h.changes(),count);assert.equal(h.value().transitions[0].trigger.condition,undefined);
 const removed=h.el('Mode');h.element('animationStateScriptTransition1Remove').click();removed.dispatch('change');assert.equal(h.value().transitions.length,1);assert.deepEqual(h.value().transitions[0].trigger,{kind:'completed'});
});

test('condition construction never calls a parent context before initialization',async t=>{
 const h=await dialogHarness('app-animation-state-condition'),container=h.document.createElement('div');let calls=0;
 const controller=h.runtime.setupAnimationStateCondition({container,getContext(){calls++;throw Error('parent TDZ');}});t.after(()=>controller.dispose());assert.equal(calls,0);assert.equal(controller.getValue(),undefined);
});

test('all condition labels, hints and validation messages have English and Japanese translations',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-animation-state-condition.js',import.meta.url),'utf8');const keys=new Set([...source.matchAll(/data-condition-i18n="([^"]+)"/g)].map(m=>m[1]));for(const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g))keys.add(match[1]);
 for(const key of keys){assert.ok(en[key],`English: ${key}`);assert.ok(ja[key],`Japanese: ${key}`);}
});


test('conditional graphs clear when the optional condition marker is withdrawn, while ordinary graphs remain available',async t=>{
 const h=await fixture(t,{parent:true});h.set('Mode','compare');h.element('animationStateScriptGraphToggle').click();assert.equal(h.element('animationStateScriptGraphCanvas').children.length,1);h.capability(false);assert.equal(h.element('animationStateScriptGraphCanvas').children.length,0);assert.deepEqual(h.value().transitions[0].trigger.condition,{type:'string',operator:'eq',value:''});
 const old=await fixture(t,{parent:true});old.element('animationStateScriptGraphToggle').click();old.capability(false);assert.equal(old.element('animationStateScriptGraphCanvas').children.length,1);assert.deepEqual(old.value(),base());
});


test('shared and payload conditions keep independent typed buffers including unfinished numbers and CRLF',async t=>{
 const payload={type:'string',operator:'ne',value:'a\r\n🙂'},h=await fixture(t,{value:payload});
 h.set('Type','number');h.set('Number','1e-','input');h.set('Operator','lt');h.set('Mode','shared');h.set('Key','combat.enabled','input');h.set('Type','boolean');h.set('Boolean','true');
 const shared={type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.enabled'}};assert.deepEqual(h.value(),shared);
 h.set('Mode','compare');assert.deepEqual(h.value(),{type:'number',operator:'lt',value:'1e-'});h.set('Type','string');assert.equal(h.value().value,payload.value);
 h.set('Mode','none');assert.equal(h.value(),undefined);h.set('Mode','shared');assert.deepEqual(h.value(),shared);assert.equal(h.el('Key').value,'combat.enabled');
 h.set('Type','number');h.set('Number','0','input');assert.equal(h.value().value,0);h.set('Type','string');h.set('String','','input');assert.equal(h.value().value,'');h.set('Type','boolean');assert.equal(h.value().value,true);
});

test('shared keys retain invalid spelling and whitespace while valid keys are literal and case sensitive',async t=>{
 const h=await fixture(t);h.set('Mode','shared');
 for(const key of['',' combat.enabled','combat.enabled ','1flag','constructor','prototype','__proto__','状态','a'.repeat(65)]){h.set('Key',key,'input');assert.equal(h.value().selector.key,key);assert.equal(h.el('Key').getAttribute('aria-invalid'),'true');assert.match(h.el('Status').textContent,/状态键/);}
 for(const key of['Combat.Enabled','a-b_c.1','a'.repeat(64)]){h.set('Key',key,'input');assert.equal(h.value().selector.key,key);assert.equal(h.el('Key').getAttribute('aria-invalid'),'false');}
 assert.match(h.el('Note').textContent,/状态改变本身不触发/);
});

test('withdrawing shared assistance retains its values and permits explicit fallback to payload or none',async t=>{
 const h=await fixture(t);h.set('Mode','compare');h.set('Type','boolean');h.set('Boolean','true');h.set('Mode','shared');h.set('Key','combat.enabled','input');const shared=h.value();
 h.selectorCapability(false);assert.deepEqual(h.value(),shared);assert.equal(h.el('Mode').disabled,false);assert.equal(h.el('Key').disabled,true);assert.match(h.el('Status').textContent,/项目共享状态条件/);
 h.set('Mode','compare');assert.deepEqual(h.value(),{type:'boolean',operator:'eq',value:true});h.set('Mode','shared');assert.equal(h.el('Mode').value,'compare');
 h.selectorCapability(true);h.set('Mode','shared');assert.deepEqual(h.value(),shared);h.selectorCapability(false);h.set('Mode','none');assert.equal(h.value(),undefined);
});

test('shared input survives event-kind round trips and language refresh without replacing focused nodes',async t=>{
 const h=await fixture(t,{parent:true});h.set('Mode','shared');h.set('Key','combat.enabled','input');h.set('Type','number');h.set('Number','1e-','input');const condition=h.value().transitions[0].trigger.condition;
 h.form('Transition1Kind','completed');assert.deepEqual(h.value().transitions[0].trigger,{kind:'completed'});h.form('Transition1Kind','event');assert.deepEqual(h.value().transitions[0].trigger.condition,condition);
 const key=h.el('Key'),count=h.changes();key.focus();key.selectionStart=2;key.selectionEnd=8;
 for(const locale of['en','ja','zh']){h.language(locale);assert.equal(h.el('Key'),key);assert.equal(h.document.activeElement,key);assert.deepEqual([key.selectionStart,key.selectionEnd],[2,8]);assert.equal(h.el('Number').value,'1e-');assert.equal(h.changes(),count);}
});

test('selector-only capability supports mixed ordered conditions and preserves row buffers through reordering',async t=>{
 const table=base();table.eventSelection='firstMatch';table.transitions[0].trigger.condition={type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.enabled'}};
 table.transitions.push({from:'idle',to:'idle',trigger:{kind:'event',name:'hit',condition:{type:'number',operator:'gte',value:10}}});
 const h=await fixture(t,{parent:true,value:table,available:false,branchesAvailable:false});h.context.available=true;h.controller.refresh();
 assert.equal(h.el('Key').disabled,false);assert.equal(h.element('animationStateScriptTransition3ConditionNumber').disabled,false);h.element('animationStateScriptGraphToggle').click();assert.equal(h.element('animationStateScriptGraphCanvas').children.length,1);
 const key=h.el('Key');key.focus();key.selectionStart=1;key.selectionEnd=5;h.element('animationStateScriptTransition1MoveDown').click();assert.equal(h.value().transitions[1].trigger.condition.selector.key,'combat.enabled');assert.equal(h.el('Key'),key);assert.equal(h.document.activeElement,key);assert.deepEqual([key.selectionStart,key.selectionEnd],[1,5]);
 h.selectorCapability(false);assert.equal(h.element('animationStateScriptGraphCanvas').children.length,0);assert.equal(h.el('Key').value,'combat.enabled');h.selectorCapability(true);assert.equal(h.element('animationStateScriptGraphCanvas').children.length,1);
});


test('a shared parent row can visibly choose payload when selectors are unavailable but legacy conditions remain supported',async t=>{
 const table=base();table.transitions[0].trigger.condition={type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.enabled'}};
 const h=await fixture(t,{parent:true,value:table});h.selectorCapability(false);
 const compare=h.el('Mode').children.find(option=>option.value==='compare');assert.equal(compare.disabled,false);assert.equal(h.el('Key').disabled,true);
 h.set('Mode','compare');assert.equal(h.el('Mode').value,'compare');assert.equal(h.el('Type').disabled,false);assert.equal(Object.hasOwn(h.value().transitions[0].trigger.condition,'selector'),false);
 h.element('animationStateScriptGraphToggle').click();assert.equal(h.element('animationStateScriptGraphCanvas').children.length,1);
});
