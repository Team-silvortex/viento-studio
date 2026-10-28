import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { PROJECT_INPUT_MAP_KEYS, validateProjectInputMap, inspectProjectInputMap } from '../../engine/project-input-map.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
async function harness(mode = 'create') {
 const context = { mode, token:'one', path:'documents/input/map.json', content:JSON.stringify({format:'viento-input-map',schemaVersion:1,actions:[{name:'jump',keys:['Space']}]}), documentRoot:'documents', documentTypes:[{id:'document',label:'文档'}] }, writes=[], languages=[];
 const h=await dialogHarness('app-input-map',{PROJECT_INPUT_MAP_KEYS,inspectProjectInputMap,validateProjectInputMap:value=>validateProjectInputMap(copy(value)),onLanguageChange:fn=>languages.push(fn)});
 const controller=h.runtime.setupInputMap({getContext:()=>context,applyDraft:(proposal,{isCurrent})=>{assert.equal(isCurrent(),true);writes.push(copy(proposal));return {applied:true,content:proposal.content};}});
 const el=id=>h.element('inputMap'+id), click=id=>el(id).click(), set=(id,value,event='input')=>{el(id).value=value;el(id).dispatch(event);};
 return {...h,context,controller,el,click,set,writes,languages};
}
test('new input map uses a reviewed draft and requires ordinary document save',async()=>{
 const h=await harness();assert.equal(h.controller.open(),true); assert.equal(h.el('Path').value,'documents/input/input-map.json');
 h.set('Name','move_left');h.set('KeyChoice','ArrowLeft','change');h.click('AddKey');
 h.click('Check');assert.equal(h.el('Apply').disabled,false); const data=JSON.parse(h.el('After').textContent);
 assert.deepEqual(data.actions,[{name:'move_left',keys:['KeyA','ArrowLeft']}]); assert.equal(h.writes.length,0);
 h.click('Apply'); assert.equal(h.writes.length,1);assert.equal(h.writes[0].sourcePath,'documents/input/input-map.json');assert.equal(h.writes[0].documentType,'document');assert.equal(h.el('Dialog').open,false);
});
test('invalid names, duplicate names, forbidden keys and invalid path retain draft and cannot apply',async()=>{
 const h=await harness();h.controller.open(); h.set('Name','ui_down');h.click('Check');assert.equal(h.el('Apply').disabled,true);
 h.set('Name','move_left');h.click('AddAction');h.set('Name','move_left');h.click('Check');assert.equal(h.el('Apply').disabled,true);
 h.set('Name','move_right');h.set('KeyChoice','Escape','change');h.click('AddKey');h.set('Path','documents/../map.json');h.click('Check');assert.equal(h.el('Apply').disabled,true);
 assert.equal(h.writes.length,0);assert.equal(h.el('Name').value,'move_right');
});
test('cancel protects changes; stale session and post-review changes cannot apply',async()=>{
 const h=await harness('edit');h.controller.open();h.set('Name','leap');h.runtime.window.confirm=()=>false;h.click('Cancel');assert.equal(h.el('Dialog').open,true);
 h.click('Check');h.el('Name').value='silent';h.click('Apply');assert.equal(h.writes.length,0);h.click('Check');h.context.token='new';h.click('Apply');assert.equal(h.writes.length,0);
});
test('language refresh preserves action drafts and only supported keys are offered',async()=>{
 const h=await harness();h.controller.open();h.set('Name','move_right');h.set('KeyChoice','Digit1','change');for(const fn of h.languages)fn();
 assert.equal(h.el('Name').value,'move_right');assert.equal(h.el('KeyChoice').value,'Digit1');
 assert.deepEqual(h.el('KeyChoice').children.map(option=>option.value),PROJECT_INPUT_MAP_KEYS);
 const source=await fs.readFile(new URL('../../web/modules/app-input-map.js',import.meta.url),'utf8');for(const match of source.matchAll(/data-i18n="([^"]+)"/g)){assert.equal(typeof en[match[1]],'string',match[1]+' en');assert.equal(typeof ja[match[1]],'string',match[1]+' ja');}
});


test('modal isolates save shortcuts and protects IME composition from Escape',async()=>{
 const h=await harness();h.controller.open();h.set('Path','documents/input/中文.json');
 let parentKeys=0, prompts=0;h.document.body.addEventListener('keydown',()=>parentKeys++);h.runtime.window.confirm=()=>{prompts++;return false;};
 for(const modifier of ['ctrlKey','metaKey']){
  const save=h.el('Path').dispatch('keydown',{bubbles:true,key:'s',[modifier]:true});
  assert.equal(save.defaultPrevented,true);assert.equal(save.stopped,true);assert.equal(h.el('Dialog').open,true);
 }
 const normal=h.el('Path').dispatch('keydown',{bubbles:true,key:'a'});
 assert.equal(normal.defaultPrevented,undefined);assert.equal(normal.stopped,true);assert.equal(parentKeys,0);
 h.el('Path').dispatch('compositionstart',{bubbles:true});
 const composingEscape=h.el('Path').dispatch('keydown',{bubbles:true,key:'Escape'});
 assert.equal(composingEscape.defaultPrevented,true);assert.equal(composingEscape.stopped,true);
 const cancel=h.el('Dialog').dispatch('cancel');assert.equal(cancel.defaultPrevented,true);assert.equal(h.el('Dialog').open,true);assert.equal(prompts,0);
 h.el('Path').dispatch('compositionend',{bubbles:true});
 for(const props of [{isComposing:true},{keyCode:229},{repeat:true}]){
  const event=h.el('Path').dispatch('keydown',{bubbles:true,key:'Escape',...props});assert.equal(event.defaultPrevented,true);assert.equal(h.el('Dialog').open,true);assert.equal(prompts,0);
 }
 h.el('Path').dispatch('keydown',{bubbles:true,key:'Escape'});assert.equal(prompts,1);assert.equal(h.el('Dialog').open,true);assert.equal(h.el('Path').value,'documents/input/中文.json');
 h.runtime.window.confirm=()=>true;h.el('Path').dispatch('keydown',{bubbles:true,key:'Escape'});assert.equal(h.el('Dialog').open,false);assert.equal(h.writes.length,0);
});
