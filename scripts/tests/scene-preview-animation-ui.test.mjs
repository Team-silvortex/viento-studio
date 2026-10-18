import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {dialogHarness} from './dialog-harness.mjs';
import {captureSceneAnimationPreview} from '../../engine/scene-animation-preview.mjs';
import {createSceneAnimationPlayer} from '../../web/modules/scene-animation-player.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,rev='sha256:'+'a'.repeat(64),copy=v=>JSON.parse(JSON.stringify(v));
function preview(loop=false){const scene={objectId:id(1),sourcePath:'documents/scenes/demo.json',sourceRevision:rev},manifest={objectId:id(4),sourcePath:'documents/animation/demo.json',sourceRevision:rev};return{ok:true,format:'viento-scene-preview',schemaVersion:2,snapshotId:rev,scene,actors:[{objectId:id(2),instanceId:id(3)},{objectId:id(2),instanceId:id(6)}],animationPreview:{format:'viento-scene-animation-preview',schemaVersion:1,status:'ready',snapshotId:rev,scene,manifest,diagnostics:[],document:{format:'viento-scene-animation',schemaVersion:1,sceneObjectId:id(1),durationSeconds:2,loop,tracks:[{id:id(5),instanceId:id(3),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[0,0]},{atSeconds:2,value:[100,50]}]}]}}};}
async function harness(options={}){
 let clock=0,serial=0,locale='zh-CN';const frames=new Map(),cancelled=[],samples=[],active=[],languages=[],events=new Map();
 const h=await dialogHarness('app-scene-preview-animation',{captureSceneAnimationPreview:v=>captureSceneAnimationPreview(copy(v)),createSceneAnimationPlayer:ports=>createSceneAnimationPlayer({...ports,now:()=>clock,schedule:cb=>{frames.set(++serial,cb);return serial;},cancel:handle=>cancelled.push(handle)}),
 t:key=>locale==='en'?en[key]||key:locale==='ja'?ja[key]||key:key,onLanguageChange:fn=>{languages.push(fn);return()=>languages.splice(languages.indexOf(fn),1);}});
 h.document.addEventListener=(type,fn)=>events.set(type,fn);h.document.removeEventListener=(type,fn)=>{if(events.get(type)===fn)events.delete(type);};
 const container=h.document.createElement('section');h.document.body.append(container);const controller=h.runtime.setupScenePreviewAnimation({container,setSample:value=>{samples.push(value&&copy(value));options.setSample?.(value);},onActiveChange:value=>active.push(value)});
 controller.setAvailable(true);controller.setVisible(true);const el=s=>h.element('scenePreviewAnimation'+s);
 return{...h,el,controller,container,samples,active,frames,cancelled,events,load:(value=preview())=>controller.setPreview(value),click:s=>el(s).click(),seek:value=>{el('Position').value=String(value);el('Position').dispatch('input');},tick:ms=>{clock=ms;frames.get(serial)?.();},language:value=>{locale=value;languages.forEach(fn=>fn());}};
}
test('saved animation stays static until an explicit play or seek; Rust samples target instances without author IO',async()=>{
 const h=await harness(),source=preview(),original=copy(source);h.load(source);assert.equal(h.container.hidden,false);assert.ok(h.samples.every(x=>x===null));assert.equal(h.controller.isActive(),false);
 h.seek(1);assert.deepEqual(h.samples.at(-1).values[0].value,[50,25]);assert.equal(h.samples.at(-1).values[0].instanceId,id(3));assert.equal(h.controller.isActive(),true);assert.deepEqual(source,original);
 h.click('Play');h.tick(500);assert.deepEqual(h.samples.at(-1).values[0].value,[75,37.5]);h.click('Pause');const count=h.samples.length;h.tick(1000);assert.equal(h.samples.length,count);
 h.click('Stop');assert.equal(h.samples.at(-1),null);assert.equal(h.controller.isActive(),false);assert.equal(h.el('Time').textContent,'0.00 / 2.00 s');assert.equal(h.el('Stop').disabled,true);
});
test('none, invalid, absent and malformed animation envelopes never fabricate playable animation',async()=>{
 const h=await harness();h.load({});assert.equal(h.container.hidden,true);
 const none=preview();Object.assign(none.animationPreview,{status:'none',manifest:null,document:null});h.load(none);assert.equal(h.container.hidden,false);assert.equal(h.el('Controls').hidden,true);assert.match(h.el('Status').textContent,/未关联/);
 const invalid=preview();Object.assign(invalid.animationPreview,{status:'invalid',document:null,diagnostics:[{severity:'error',code:'build_animation_invalid',message:'<img src=x>',...invalid.animationPreview.manifest,propertyPath:'/tracks'}]});h.load(invalid);assert.match(h.el('Status').textContent,/无效/);assert.match(h.el('Diagnostic').textContent,/\/tracks/);assert.equal(h.container.querySelector('img'),null);
 for(const change of [p=>p.animationPreview.snapshotId='sha256:'+'b'.repeat(64),p=>p.animationPreview.document.tracks[0].instanceId=id(99),p=>p.animationPreview.document.durationSeconds=0]){const value=preview();change(value);h.load(value);h.click('Play');assert.equal(h.controller.isActive(),false);assert.equal(h.el('Controls').hidden,true);assert.match(h.el('Diagnostic').textContent,/scene_animation_preview_invalid/);}
 for(const key of ['draft','composition']){const value=preview();value[key]={};h.load(value);assert.equal(h.container.hidden,true);}
});
test('replacement, reset, hide, capability revocation and disposal cancel old frame generations',async()=>{
 for(const transition of [h=>h.load(preview()),h=>h.controller.reset(),h=>h.controller.setVisible(false),h=>h.controller.setAvailable(false),h=>h.controller.destroy()]){
  const h=await harness();h.load(preview(true));h.click('Play');h.tick(500);const stale=[...h.frames.values()].at(-1);transition(h);const count=h.samples.length,frames=h.frames.size;stale();assert.equal(h.samples.length,count);assert.equal(h.frames.size,frames);assert.equal(h.samples.at(-1),null);assert.equal(h.controller.isActive(),false);
 }
});
test('background and page exit pause playback while a visible paused view retains its exact sample',async()=>{
 const h=await harness();h.load(preview(true));h.click('Play');h.tick(500);h.document.hidden=true;h.events.get('visibilitychange')();const count=h.samples.length;h.tick(1000);assert.equal(h.samples.length,count);assert.equal(h.controller.isActive(),true);assert.equal(h.el('Play').disabled,false);assert.equal(h.el('Position').value,'0.5');
 h.document.hidden=false;h.click('Play');h.tick(1250);h.runtime.window.dispatch('pagehide');const next=h.samples.length;h.tick(2000);assert.equal(h.samples.length,next);
});
test('language changes retain the focused time control, sample, playback clock and state',async()=>{
 const h=await harness();h.load(preview(true));h.seek(.5);const input=h.el('Position');input.focus();h.click('Play');h.tick(500);
 for(const locale of ['en','ja','zh-CN']){const before=h.samples.length;h.language(locale);assert.equal(h.el('Position'),input);assert.equal(h.document.activeElement,input);assert.equal(input.value,'1');assert.equal(h.samples.length,before);assert.equal(h.el('Pause').disabled,false);}
 h.tick(750);assert.equal(input.value,'1.25');
});
test('a failed visual sample restores static content and cancels playback',async()=>{
 const h=await harness({setSample:value=>{if(value?.timeSeconds>0)throw Error('canvas rejected');}});h.load();h.click('Play');h.tick(500);assert.equal(h.samples.at(-1),null);assert.equal(h.controller.isActive(),false);assert.match(h.el('Status').textContent,/失败/);const count=h.samples.length;h.tick(1000);assert.equal(h.samples.length,count);
});
test('animation control copy covers English and Japanese and has a narrow-screen time layout',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-scene-preview-animation.js',import.meta.url),'utf8');const labels=[...source.matchAll(/data-i18n="([^"]+)"/g)].map(m=>m[1]);for(const key of labels){assert.equal(typeof en[key],'string',key);assert.equal(typeof ja[key],'string',key);}
 const css=await fs.readFile(new URL('../../web/scene-preview.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/scene-preview-animation-time/);
});

test('a saved HTTP reply delivered after capability loss cannot install or play animation',async()=>{
 const h=await harness();h.load();h.click('Play');h.controller.setAvailable(false);const before=h.samples.length;h.load(preview());h.click('Play');assert.equal(h.container.hidden,true);assert.equal(h.controller.isActive(),false);assert.equal(h.samples.at(-1),null);assert.ok(h.samples.slice(before).every(value=>value===null));
 h.controller.setAvailable(true);assert.equal(h.container.hidden,true);assert.equal(h.el('Play').disabled,true);h.load(preview());assert.equal(h.el('Play').disabled,false);assert.equal(h.controller.isActive(),false);
});
