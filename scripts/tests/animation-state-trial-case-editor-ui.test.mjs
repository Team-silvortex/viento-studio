import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import { parseAnimationStateTrialCase, serializeAnimationStateTrialCase, ANIMATION_STATE_TRIAL_CASE_LIMITS } from '../../engine/animation-state-trial-case.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const definition=()=>({format:'viento.animation-state-trial-case',version:1,initialStateKey:'idle',steps:[{input:{kind:'event',event:{name:'go',value:3},projectState:[]},expected:{stateKey:'attack',transition:true}}]});
const source=()=>JSON.stringify(definition(),null,2)+'\n';
async function fixture(t,{apply=()=>true}={}) {
 let language='zh',parses=0;const context={active:true,visible:true,disabled:false,available:true,generation:1},applied=[],changes=[];
 const h=await dialogHarness('app-animation-state-trial-case-editor',{parseAnimationStateTrialCase(raw){parses++;return parseAnimationStateTrialCase(raw);},ANIMATION_STATE_TRIAL_CASE_LIMITS});
 const container=h.document.createElement('div');h.document.body.append(container);const translate=(key,...args)=>({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''));
 const controller=h.runtime.setupAnimationStateTrialCaseEditor({container,idPrefix:'editor',getContext:()=>context,translate,onApply(value,ticket){applied.push({value,ticket});return apply(value,ticket);},onStateChange:value=>changes.push(value)});
 const el=suffix=>h.element('editor'+suffix),owner={};t.after(()=>controller.dispose());
 return {...h,container,context,controller,el,owner,applied,changes,parses:()=>parses,open(raw=source()){return controller.open({text:raw,owner});},write(raw,event=true){el('Text').value=raw;if(event)el('Text').dispatch('input');},check(){el('Check').click();},apply(){el('Apply').click();},language(value){language=value;controller.refresh();}};
}

test('construction does not access context and an open draft cannot be replaced by another open request',async t=>{
 const h=await fixture(t);const second=h.document.createElement('div');h.document.body.append(second);const isolated=h.runtime.setupAnimationStateTrialCaseEditor({container:second,getContext(){throw Error('parent not ready');}});isolated.dispose();
 assert.equal(h.open(),true);const raw=h.el('Text').value;assert.equal(h.controller.open({text:'replacement',owner:{}}),false);assert.equal(h.el('Text').value,raw);assert.equal(h.parses(),0);assert.equal(h.document.activeElement,h.el('Text'));assert.equal(h.controller.isDirty(),false);
});

test('check admits a branded case but only explicit apply submits exact raw text and owner',async t=>{
 const h=await fixture(t),raw=source();h.open(raw);assert.equal(h.el('Apply').disabled,true);h.check();assert.equal(h.parses(),1);assert.equal(h.applied.length,0);assert.equal(h.el('Apply').disabled,false);assert.match(h.el('Status').textContent,/起始状态 idle.*1 步.*尚未应用/);h.apply();assert.equal(h.applied.length,1);assert.equal(h.applied[0].ticket.text,raw);assert.equal(h.applied[0].ticket.owner,h.owner);assert.doesNotThrow(()=>serializeAnimationStateTrialCase(h.applied[0].value));assert.equal(h.controller.isOpen(),false);assert.equal(h.el('Panel').hidden,true);assert.equal(h.applied[0].ticket.isCurrent(),false);
});

test('invalid JSON and over-budget pasted text remain untouched and never become applicable',async t=>{
 const h=await fixture(t);h.open();for(const raw of['{ "bad":',JSON.stringify({...definition(),version:99}),'中'.repeat(131073)]){h.write(raw);h.check();assert.equal(h.el('Text').value,raw);assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Error').hidden,false);assert.equal(h.controller.isDirty(),true);}
 assert.equal(h.el('Text').getAttribute('maxlength'),null);assert.match(h.el('Bytes').textContent,/超过 131072 UTF-8/);assert.match(h.el('Error').textContent,/128 KiB/);assert.equal(h.applied.length,0);
});

test('every input invalidates a check even if the same raw text is restored',async t=>{
 const h=await fixture(t);h.open();h.check();const raw=h.el('Text').value;h.write(raw+' ');assert.equal(h.el('Apply').disabled,true);h.write(raw);h.el('Apply').disabled=false;h.apply();assert.equal(h.applied.length,0);h.check();h.apply();assert.equal(h.applied.length,1);
});

test('silent raw mutation observed by apply revokes approval permanently after restoring old text',async t=>{
 const h=await fixture(t);h.open();h.check();const raw=h.el('Text').value;h.write(raw+' ',false);h.apply();assert.equal(h.applied.length,0);h.write(raw,false);h.el('Apply').disabled=false;h.apply();assert.equal(h.applied.length,0);assert.equal(h.el('Apply').disabled,true);h.check();h.apply();assert.equal(h.applied.length,1);
});

test('author generation and optional runtime capability changes preserve the checked JSON draft',async t=>{
 const h=await fixture(t);h.open();h.check();const raw=h.el('Text').value;h.context.generation++;h.context.available=false;h.controller.refresh();assert.equal(h.el('Text').value,raw);assert.equal(h.el('Apply').disabled,false);assert.equal(h.parses(),1);h.apply();assert.equal(h.applied.length,1);
});

test('folding retains raw text but requires a fresh check on reopening',async t=>{
 const h=await fixture(t);h.open();h.write(source()+' ');h.check();const raw=h.el('Text').value;h.context.visible=false;h.controller.refresh();h.el('Apply').disabled=false;h.apply();assert.equal(h.applied.length,0);h.context.visible=true;h.controller.refresh();assert.equal(h.el('Text').value,raw);assert.equal(h.el('Apply').disabled,true);h.check();h.apply();assert.equal(h.applied.length,1);
});

test('disabled editing preserves text and keeps cancel available without submitting',async t=>{
 const h=await fixture(t);h.open();h.check();h.context.disabled=true;h.controller.refresh();assert.equal(h.el('Text').disabled,true);assert.equal(h.el('Apply').disabled,true);assert.equal(h.el('Cancel').disabled,false);h.el('Cancel').click();assert.equal(h.controller.isOpen(),false);assert.equal(h.applied.length,0);assert.equal(h.changes.at(-1).reason,'cancelled');
});

test('reset inactive session and disposal clear raw drafts and checked permissions',async t=>{
 for(const action of['reset','inactive','dispose']){const h=await fixture(t);h.open();h.check();if(action==='inactive'){h.context.active=false;h.controller.refresh();h.context.active=true;h.controller.refresh();}else h.controller[action]();assert.equal(h.controller.isOpen(),false);if(action==='dispose')assert.equal(h.container.children.length,0);else{assert.equal(h.el('Panel').hidden,true);assert.equal(h.el('Text').value,'');}assert.equal(h.applied.length,0);}
});

test('Escape cancels only the inner editor while IME and repeat Escape do not discard text',async t=>{
 const h=await fixture(t);h.open();const raw=h.el('Text').value;for(const properties of[{isComposing:true},{keyCode:229},{repeat:true}]){h.el('Text').dispatch('keydown',{key:'Escape',bubbles:true,...properties});assert.equal(h.controller.isOpen(),true);assert.equal(h.el('Text').value,raw);}
 const event=h.el('Text').dispatch('keydown',{key:'Escape',bubbles:true});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(h.controller.isOpen(),false);assert.equal(h.applied.length,0);
});

test('author save shortcuts inside JSON are intercepted without applying the case',async t=>{
 const h=await fixture(t);h.open();h.check();for(const properties of[{key:'s',ctrlKey:true},{key:'Enter',metaKey:true}]){const event=h.el('Text').dispatch('keydown',{bubbles:true,...properties});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);}assert.equal(h.applied.length,0);assert.equal(h.controller.isOpen(),true);
});

test('failed synchronous application retains the draft and never treats a promise as success',async t=>{
 for(const apply of[()=>false,()=>{throw Error('rejected');},()=>Promise.resolve(true)]){const h=await fixture(t,{apply});h.open();h.check();const raw=h.el('Text').value;h.apply();assert.equal(h.controller.isOpen(),true);assert.equal(h.el('Text').value,raw);assert.match(h.el('Error').textContent,/未应用/);assert.equal(h.changes.some(change=>change.reason==='applied'),false);}
});

test('language changes preserve textarea identity focus selection scroll and valid check',async t=>{
 const h=await fixture(t);h.open();h.check();const input=h.el('Text'),raw=input.value;input.focus();input.selectionStart=3;input.selectionEnd=11;input.scrollTop=80;for(const language of['en','ja','zh']){h.language(language);assert.equal(h.el('Text'),input);assert.equal(input.value,raw);assert.equal(h.document.activeElement,input);assert.deepEqual([input.selectionStart,input.selectionEnd,input.scrollTop],[3,11,80]);assert.equal(h.el('Apply').disabled,false);}assert.equal(h.parses(),1);
});

test('observed silent loss of visibility revokes a saved application guard even after restoration',async t=>{
 let guard;const h=await fixture(t,{apply(value,ticket){guard=ticket;return false;}});h.open();h.check();h.apply();assert.equal(guard.isCurrent(),true);h.context.visible=false;assert.equal(guard.isCurrent(),false);h.context.visible=true;assert.equal(guard.isCurrent(),false);h.el('Apply').disabled=false;h.apply();assert.equal(h.applied.length,1);h.check();h.apply();assert.equal(h.applied.length,2);
});
