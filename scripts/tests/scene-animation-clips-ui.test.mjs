import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clip=n=>({id:id(n),name:`Clip ${n}`,startSeconds:0,endSeconds:2,loop:false});
async function fixture(t, options={}) {
  let serial=40,changes=0,language='zh';
  const h=await dialogHarness('app-scene-animation-clips',{crypto:{randomUUID:options.uuid||(()=>id(++serial))}});
  const container=h.document.createElement('section');h.document.body.append(container);
  const context={available:true,durationSeconds:2,loop:false};
  const translate=(key,...args)=>(({en,ja}[language]?.[key]||key).replace(/\{(\d+)\}/g,(_,n)=>String(args[n]??'')));
  const controller=h.runtime.setupSceneAnimationClips({container,getContext:()=>context,translate,onChange:()=>changes++});controller.setDisabled(false);t.after(()=>controller.dispose());
  return {...h,controller,container,context,el:part=>container.querySelector('#sceneAnimation'+part),changes:()=>changes,read:()=>JSON.parse(JSON.stringify(controller.getValue())),language(value){language=value;controller.refresh();}};
}
test('independent clip rows preserve raw text and UUID while translation keeps focused inputs',async t=>{
  const h=await fixture(t);h.controller.setValue([clip(1)]);const name=h.el('Clip0Name'),start=h.el('Clip0Start');name.value='Idle <script>';name.dispatch('input');start.value='1e';start.dispatch('input');start.focus();start.selectionStart=1;start.selectionEnd=2;
  for(const language of ['en','ja','zh']){h.language(language);assert.equal(h.el('Clip0Start'),start);assert.equal(h.document.activeElement,start);assert.equal(start.value,'1e');assert.equal(start.selectionStart,1);assert.equal(h.read()[0].name,'Idle <script>');assert.equal(h.read()[0].id,id(1));}
  const copy=h.read();copy[0].name='external';assert.equal(h.read()[0].name,'Idle <script>');assert.equal(h.changes(),2);
});
test('clip row callbacks cannot mutate a replaced form and disposed component cannot allocate IDs',async t=>{
  const h=await fixture(t);h.controller.setValue([clip(1)]);const old=h.el('Clip0Remove'),oldInput=h.el('Clip0Name');h.controller.setValue([clip(2)]);old.click();oldInput.value='stale';oldInput.dispatch('input');assert.equal(h.changes(),0);assert.equal(h.read()[0].id,id(2));
  const add=h.el('AddClip');h.controller.dispose();add.click();assert.equal(h.changes(),0);assert.equal(h.read().length,0);
});
test('clip creation has a bounded count and duplicate UUID attempts cannot remove authored data',async t=>{
  const h=await fixture(t,{uuid:()=>id(1)});h.controller.setValue([clip(1)]);h.el('AddClip').click();assert.equal(h.changes(),0);assert.equal(h.read().length,1);assert.match(h.el('ClipsStatus').textContent,/无法生成/);
  h.controller.setValue(Array.from({length:32},(_,n)=>clip(n+1)));assert.equal(h.el('AddClip').disabled,true);h.el('AddClip').click();assert.equal(h.read().length,32);
  h.el('Clip31Remove').click();assert.equal(h.read().length,31);assert.equal(h.changes(),1);assert.equal(h.el('AddClip').disabled,false);
});
test('capability and parent locks disable every mutation without changing incomplete input',async t=>{
  const h=await fixture(t);h.el('AddClip').click();assert.equal(h.changes(),1);assert.equal(h.read()[0].id,id(41));assert.equal(h.document.activeElement,h.el('Clip0Name'));
  h.el('Clip0Start').value='-';h.el('Clip0Start').dispatch('input');const count=h.changes();
  for(const lock of ['parent','capability']){if(lock==='parent')h.controller.setDisabled(true);else{h.controller.setDisabled(false);h.context.available=false;h.controller.refresh();}
    h.el('AddClip').click();h.el('Clip0Remove').click();h.el('Clip0Start').dispatch('input');assert.equal(h.changes(),count);assert.equal(h.read()[0].startSeconds,'-');assert.equal(h.el('Clip0Start').disabled,true);
  }
  h.controller.setValue([]);assert.equal(h.container.hidden,true);
});
