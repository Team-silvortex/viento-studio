import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {dialogHarness} from './dialog-harness.mjs';
import {captureSceneAnimationPreview} from '../../engine/scene-animation-preview.mjs';
import {createSceneAnimationInstancePlayback} from '../../engine/scene-animation-instance-playback.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,rev='sha256:'+'a'.repeat(64),copy=value=>JSON.parse(JSON.stringify(value));
function preview({clips=true,loop=false}={}) {
 const scene={objectId:id(1),sourcePath:'documents/scenes/demo.json',sourceRevision:rev},manifest={objectId:id(4),sourcePath:'documents/animation/demo.json',sourceRevision:rev};
 const document={format:'viento-scene-animation',schemaVersion:clips?3:1,sceneObjectId:id(1),durationSeconds:2,loop,tracks:[
  {id:id(5),instanceId:id(3),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[0,0]},{atSeconds:2,value:[100,50]}]},
  {id:id(7),instanceId:id(6),property:'offset2d',interpolation:'linear',keyframes:[{atSeconds:0,value:[200,0]},{atSeconds:2,value:[400,50]}]},
 ]};
 if(clips)document.clips=[{id:id(8),name:'Attack <b>',startSeconds:0,endSeconds:1,loop:false},{id:id(9),name:'Idle',startSeconds:1,endSeconds:2,loop:true}];
 return {ok:true,format:'viento-scene-preview',schemaVersion:2,snapshotId:rev,scene,actors:[{objectId:id(2),instanceId:id(3),name:'Same <img src=x>'},{objectId:id(2),instanceId:id(6),name:'Same <img src=x>'},{objectId:id(2),instanceId:id(10),name:'Static actor'}],animationPreview:{format:'viento-scene-animation-preview',schemaVersion:1,status:'ready',snapshotId:rev,scene,manifest,diagnostics:[],document}};
}
async function harness(options={}) {
 let clock=0,serial=0,locale='zh-CN'; const scheduled=new Map(),cancelled=[],samples=[],active=[],languages=[],events=new Map(),calls={create:0,advance:0,command:0,all:0};
 const context={current:true,generation:1};
 const translate=(key,...args)=>(locale==='en'?en[key]||key:locale==='ja'?ja[key]||key:key).replace(/\{(\d+)\}/g,(_,n)=>String(args[n]??''));
 const h=await dialogHarness('app-scene-preview-instance-animation',{
  createSceneAnimationInstancePlayback:catalog=>{
   calls.create++;const core=createSceneAnimationInstancePlayback(catalog);
   return {snapshot:core.snapshot,advance:seconds=>{calls.advance++;return core.advance(seconds);},command:(instance,command,seconds)=>{calls.command++;return core.command(instance,copy(command),seconds);},commandAll:(command,seconds)=>{calls.all++;return core.commandAll(copy(command),seconds);}};
  }, t:translate, translatePage:root=>root.querySelectorAll('[data-i18n]').forEach(node=>node.textContent=translate(node.dataset.i18n)),onLanguageChange:fn=>{languages.push(fn);return()=>languages.splice(languages.indexOf(fn),1);},
 });
 h.document.addEventListener=(name,fn)=>events.set(name,fn);h.document.removeEventListener=(name,fn)=>{if(events.get(name)===fn)events.delete(name);};
 const container=h.document.createElement('section');h.document.body.append(container);
 const controller=h.runtime.setupScenePreviewInstanceAnimation({container,getContext:()=>context,now:()=>clock,schedule:cb=>{scheduled.set(++serial,cb);return serial;},cancel:handle=>cancelled.push(handle),setFrames:value=>{samples.push(value===null?null:copy(value));options.setFrames?.(value);},onActiveChange:value=>active.push(value)});
 controller.setVisible(true);
 const el=suffix=>h.element('scenePreviewInstanceAnimation'+suffix),change=(suffix,value)=>{el(suffix).value=value;el(suffix).dispatch('change');};
 return {...h,el,container,controller,context,scheduled,cancelled,samples,active,events,calls,
  load:(source=preview())=>{const catalog=captureSceneAnimationPreview(source);controller.setPreview(catalog,source.actors);return catalog;},
  click:suffix=>el(suffix).click(),select:instance=>change('Instance',instance),clip:clip=>change('Clip',clip||''),
  seek:value=>{el('Position').value=String(value);el('Position').dispatch('input');},clock:value=>{clock=value;},tick:value=>{clock=value;scheduled.get(serial)?.();},
  row:instance=>el('Overview').children.find(node=>node.dataset.instanceId===instance),last:instance=>samples.at(-1)?.find(row=>row.instanceId===instance),
  language:value=>{locale=value;languages.forEach(fn=>fn());},
 };
}
test('initial saved catalog remains static and labels identical definitions by distinct instance identities',async()=>{
 const h=await harness(),source=preview(),original=copy(source);h.load(source);
 assert.equal(h.container.hidden,false);assert.equal(h.controller.isActive(),false);assert.ok(h.samples.every(value=>value===null));
 assert.deepEqual(h.el('Instance').children.map(option=>option.value),[id(3),id(6)]);assert.match(h.el('Instance').children[0].textContent,/Same <img src=x>/);assert.match(h.el('Instance').children[1].textContent,new RegExp(id(6)));
 assert.equal(h.container.querySelector('img'),null);assert.equal(h.el('Stop').disabled,true);assert.equal(h.el('StopAll').disabled,true);assert.deepEqual(source,original);
});
test('per-instance clips and clocks stay independent while selection itself does not advance or sample',async()=>{
 const h=await harness(),source=preview(),original=copy(source);h.load(source);h.clip(id(8));h.seek(.25);
 assert.deepEqual(h.last(id(3)).sample.values.map(value=>value.instanceId),[id(3)]);assert.deepEqual(h.last(id(3)).sample.values[0].value,[12.5,6.25]);
 const count=h.samples.length,calls=copy(h.calls);h.select(id(6));assert.equal(h.samples.length,count);assert.deepEqual(h.calls,calls);assert.equal(h.el('Position').value,'0');assert.equal(h.el('Clip').value,'');
 h.clip(id(9));h.seek(.5);assert.equal(h.last(id(3)).sample.localTimeSeconds,.25);assert.equal(h.last(id(6)).sample.localTimeSeconds,.5);assert.deepEqual(h.last(id(6)).sample.values[0].value,[350,37.5]);
 h.select(id(3));assert.equal(h.el('Clip').value,id(8));assert.equal(h.el('Position').value,'0.25');assert.equal(h.el('Position').max,'1');
 h.click('Play');h.tick(250);assert.equal(h.last(id(3)).sample.localTimeSeconds,.5);assert.equal(h.last(id(6)).sample.localTimeSeconds,.5);
 h.select(id(6));h.click('Play');h.tick(500);assert.equal(h.last(id(3)).sample.localTimeSeconds,.75);assert.equal(h.last(id(6)).sample.localTimeSeconds,.75);assert.deepEqual(source,original);
});
test('stopping one instance restores only its static pose and StopAll preserves each clip choice',async()=>{
 const h=await harness();h.load();h.clip(id(8));h.click('Play');h.select(id(6));h.clip(id(9));h.click('Play');h.tick(250);
 h.select(id(3));h.click('Stop');assert.equal(h.last(id(3)),undefined);assert.equal(h.last(id(6)).sample.localTimeSeconds,.25);assert.equal(h.row(id(6)).dataset.phase,'playing');assert.equal(h.controller.isActive(),true);
 h.tick(500);assert.equal(h.last(id(6)).sample.localTimeSeconds,.5);h.click('StopAll');assert.equal(h.samples.at(-1),null);assert.equal(h.controller.isActive(),false);assert.equal(h.el('Clip').value,id(8));
 h.select(id(6));assert.equal(h.el('Clip').value,id(9));assert.equal(h.el('Position').value,'0');assert.equal(h.el('StopAll').disabled,true);h.click('Play');h.tick(750);assert.equal(h.last(id(6)).sample.localTimeSeconds,.25);assert.equal(h.last(id(3)),undefined);
});
test('a non-loop clip finishes while a looping sibling keeps its own elapsed clock',async()=>{
 const h=await harness();h.load();h.clip(id(8));h.click('Play');h.select(id(6));h.clip(id(9));h.click('Play');h.tick(1500);
 assert.equal(h.row(id(3)).dataset.phase,'finished');assert.equal(h.last(id(3)).sample.finished,true);assert.equal(h.last(id(3)).sample.localTimeSeconds,1);assert.equal(h.row(id(6)).dataset.phase,'playing');assert.equal(h.last(id(6)).sample.localTimeSeconds,.5);
 h.select(id(3));assert.equal(h.el('Status').dataset.phase,'finished');assert.equal(h.el('Time').textContent,'1.00 / 1.00 s');assert.equal(h.el('Play').disabled,false);assert.equal(h.el('Pause').disabled,true);assert.match(h.el('Summary').textContent,/共 2 个动画实例 · 1 个播放中 · 2 个保留预览画面/);
 h.click('Play');h.tick(1750);assert.equal(h.last(id(3)).sample.localTimeSeconds,.25);assert.equal(h.last(id(6)).sample.localTimeSeconds,.75);
});
test('legacy full animation keeps per-instance clocks and finished pose without named clips',async()=>{
 const h=await harness();h.load(preview({clips:false}));h.seek(.5);h.select(id(6));h.click('Play');h.tick(1000);
 assert.equal(h.last(id(3)).sample.timeSeconds,.5);assert.equal(h.last(id(6)).sample.timeSeconds,1);assert.equal(h.el('Clip').children.length,1);
 h.tick(2500);assert.equal(h.row(id(6)).dataset.phase,'finished');assert.equal(h.controller.isActive(),true);assert.equal(h.last(id(6)).sample.timeSeconds,2);
});
test('background pause uses the exact last painted frame for all active instances without activating static siblings',async()=>{
 const h=await harness();h.load();h.clip(id(9));h.click('Play');h.tick(250);const before=copy(h.samples.at(-1));
 h.clock(900);h.document.hidden=true;h.events.get('visibilitychange')();assert.deepEqual(h.samples.at(-1),before);assert.equal(h.row(id(3)).dataset.phase,'paused');assert.equal(h.row(id(6)).dataset.active,'false');
 const count=h.samples.length;h.tick(5000);assert.equal(h.samples.length,count);h.document.hidden=false;h.click('Play');h.tick(5250);assert.equal(h.last(id(3)).sample.localTimeSeconds,.5);
 h.runtime.window.dispatch('pagehide');assert.equal(h.row(id(3)).dataset.phase,'paused');const after=h.samples.length;h.tick(6000);assert.equal(h.samples.length,after);assert.equal(h.controller.isActive(),true);
});
test('paused sibling poses and playing clocks survive language changes with stable focus and DOM',async()=>{
 const h=await harness();h.load();h.clip(id(8));h.seek(.25);h.select(id(6));h.clip(id(9));h.click('Play');h.tick(500);
 const selector=h.el('Clip'),range=h.el('Position'),overview=h.row(id(3));selector.focus();const originalCalls=copy(h.calls);
 for(const language of ['en','ja','zh-CN']){const count=h.samples.length;h.language(language);assert.equal(h.el('Clip'),selector);assert.equal(h.el('Position'),range);assert.equal(h.document.activeElement,selector);assert.equal(h.row(id(3)),overview);assert.equal(selector.value,id(9));assert.equal(range.value,'0.5');assert.equal(h.samples.length,count);assert.deepEqual(h.calls,originalCalls);assert.equal(selector.querySelector('b'),null);}
 h.tick(750);assert.equal(h.last(id(6)).sample.localTimeSeconds,.75);assert.equal(h.last(id(3)).sample.localTimeSeconds,.25);
});
test('replacement, reset, hide, availability loss and disposal permanently cancel old frame generations',async()=>{
 for(const action of [h=>h.load(),h=>h.controller.reset(),h=>h.controller.setVisible(false),h=>h.controller.setAvailable(false),h=>h.controller.destroy()]){
  const h=await harness();h.load();h.click('Play');h.tick(250);const stale=[...h.scheduled.values()].at(-1);action(h);const count=h.samples.length,scheduled=h.scheduled.size;stale();assert.equal(h.samples.length,count);assert.equal(h.scheduled.size,scheduled);assert.equal(h.samples.at(-1),null);assert.equal(h.controller.isActive(),false);assert.ok(h.cancelled.length>0);
 }
});
test('observed current or generation invalidation cannot revive old playback when context returns',async()=>{
 for(const invalidate of [context=>context.current=false,context=>context.generation=2]){
  const h=await harness();const catalog=h.load();h.click('Play');h.tick(250);const stale=[...h.scheduled.values()].at(-1);invalidate(h.context);h.controller.refresh();assert.equal(h.controller.isActive(),false);assert.equal(h.samples.at(-1),null);assert.match(h.el('Status').textContent,/已失效/);
  h.context.current=true;h.context.generation=1;const count=h.samples.length;stale();h.click('Play');assert.equal(h.samples.length,count);assert.equal(h.controller.isActive(),false);
  h.controller.setPreview(catalog,preview().actors);h.click('Play');assert.equal(h.controller.isActive(),true);assert.equal(h.el('Position').value,'0');
 }
});
test('mode hiding requires explicit catalog reload and the same current brand does not rebuild sessions',async()=>{
 const h=await harness(),source=preview(),catalog=h.load(source);h.clip(id(8));h.seek(.5);const count=h.samples.length,calls=copy(h.calls);h.controller.setPreview(catalog,source.actors);assert.equal(h.samples.length,count);assert.deepEqual(h.calls,calls);
 h.controller.setVisible(false);h.controller.setPreview(catalog,source.actors);h.controller.setVisible(true);assert.equal(h.container.hidden,true);assert.equal(h.el('Play').disabled,true);h.controller.setPreview(catalog,source.actors);assert.equal(h.el('Clip').value,'');assert.equal(h.el('Position').value,'0');assert.equal(h.controller.isActive(),false);
});
test('unbranded and unavailable catalogs, duplicate actor identities and accessor labels never enable controls',async()=>{
 const h=await harness(),source=preview(),catalog=captureSceneAnimationPreview(source);
 const none=preview();Object.assign(none.animationPreview,{status:'none',manifest:null,document:null});
 for(const value of [null,copy(catalog),captureSceneAnimationPreview(none)]){h.controller.setPreview(value,source.actors);assert.equal(h.el('Controls').hidden,true);assert.equal(h.controller.isActive(),false);}
 h.controller.setPreview(catalog,[source.actors[0],source.actors[0]]);assert.equal(h.el('Controls').hidden,true);
 let reads=0;const actor={get instanceId(){reads++;return id(3);}};h.controller.setPreview(catalog,[actor]);assert.equal(reads,0);assert.equal(h.el('Controls').hidden,true);
 h.controller.setAvailable(false);h.controller.setPreview(catalog,source.actors);assert.equal(h.container.hidden,true);h.controller.setAvailable(true);assert.equal(h.container.hidden,true);
});
test('invalid seek and foreign selector values do not mutate clocks or discard valid poses',async()=>{
 const h=await harness();h.load();h.seek(.5);const before=copy(h.samples.at(-1)),calls=copy(h.calls);
 for(const value of ['NaN',-1,2.01,'Infinity']){h.seek(value);assert.deepEqual(h.samples.at(-1),before);assert.deepEqual(h.calls,calls);assert.equal(h.el('Position').value,'0.5');}
 h.select(id(99));assert.equal(h.el('Instance').value,id(3));h.clip(id(99));assert.equal(h.el('Clip').value,'');assert.deepEqual(h.calls,calls);
});
test('a canvas rejection clears all poses, cancels scheduling and cannot resume through an old RAF',async()=>{
 const h=await harness({setFrames:value=>{if(value?.some(row=>row.sample.timeSeconds>0))throw Error('visual rejected');}});h.load();h.click('Play');const stale=[...h.scheduled.values()].at(-1);h.tick(250);
 assert.equal(h.samples.at(-1),null);assert.equal(h.controller.isActive(),false);assert.match(h.el('Status').textContent,/失败/);const count=h.samples.length;stale();h.click('Play');assert.equal(h.samples.length,count);
});
test('public stop atomically restores all static poses while preserving selections for an explicit restart',async()=>{
 const h=await harness();h.load();h.clip(id(8));h.seek(.25);h.select(id(6));h.clip(id(9));h.click('Play');h.tick(250);h.controller.stop();assert.equal(h.samples.at(-1),null);assert.equal(h.el('Instance').value,id(6));assert.equal(h.el('Clip').value,id(9));assert.equal(h.el('Position').value,'0');h.select(id(3));assert.equal(h.el('Clip').value,id(8));h.click('Play');assert.equal(h.last(id(6)),undefined);
});
test('new controls and status copy are translated and isolated narrow-screen styles preserve selector width',async()=>{
 const source=await fs.readFile(new URL('../../web/modules/app-scene-preview-instance-animation.js',import.meta.url),'utf8');const labels=[...source.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]);
 labels.push('动画预览范围','整场景','按实例预览','静态','播放中','已暂停','已到末尾','选中实例：{0} · {1}','共 {0} 个动画实例 · {1} 个播放中 · {2} 个保留预览画面','实例 {0} · {1} · {2} · {3} 秒','实例动画采样失败；已全部恢复静态。','实例动画预览已失效，请刷新已保存场景。');
 for(const key of labels){assert.equal(typeof en[key],'string',key);assert.equal(typeof ja[key],'string',key);}
 const css=await fs.readFile(new URL('../../web/scene-preview.css',import.meta.url),'utf8');assert.match(css,/\.scene-preview-instance-animation-selectors[^}]*minmax\(0,1fr\)/);assert.match(css,/\.scene-preview-instance-animation select[^}]*min-width:0/);assert.match(css,/@media\(max-width:700px\)/);
});
