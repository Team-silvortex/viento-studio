import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePreviewCanvas } from '../../web/modules/app-scene-preview-canvas.js';
const id = n => `45454545-4545-4545-8545-${String(n).padStart(12, '0')}`;
const freeze = value => {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
const scene = image => freeze({scene:{objectId:id(99),viewport:[400,240],background:'#001122'},actors:[
  {objectId:id(3),instanceId:id(1),name:'First',position:[100,80],size:[20,10],color:image?'#ff808080':'#11223380',...(image?{imageResourceId:id(20)}:{})},
  {objectId:id(3),instanceId:id(2),name:'Second',position:[240,80],size:[20,10],color:image?'#ff808080':'#11223380',...(image?{imageResourceId:id(20)}:{})}]});
const sample = () => ({timeSeconds:1,localTimeSeconds:1,finished:false,values:[
  {trackId:id(10),instanceId:id(1),property:'offset2d',value:[20,-10]},
  {trackId:id(11),instanceId:id(1),property:'rotation2d',value:90},
  {trackId:id(12),instanceId:id(1),property:'scale2d',value:[2,.5]},
  {trackId:id(13),instanceId:id(1),property:'opacity',value:.25}]});
function harness(image=false) {
  const listeners=new Map(),calls=[],moves=[],selected=[],stack=[],tintedPixels=[],tintDraws=[],allocated=[];let matrix=[1,0,0,1,0,0],tiles=0;
  const multiply=([a,b,c,d,e,f])=>{const [g,h,i,j,k,l]=matrix;matrix=[g*a+i*b,h*a+j*b,g*c+i*d,h*c+j*d,g*e+i*f+k,h*e+j*f+l]};
  const ctx={globalAlpha:1,fillStyle:'',strokeStyle:'',setTransform(...v){matrix=v},translate(x,y){multiply([1,0,0,1,x,y])},scale(x,y){multiply([x,0,0,y,0,0])},rotate(a){multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0])},
    save(){stack.push({matrix:[...matrix],alpha:this.globalAlpha,fill:this.fillStyle})},restore(){const s=stack.pop();matrix=s.matrix;this.globalAlpha=s.alpha;this.fillStyle=s.fill},
    clearRect(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},stroke(){}};
  for(const name of ['fillRect','strokeRect','fillText','drawImage'])ctx[name]=(...args)=>calls.push({name,args,matrix:[...matrix],alpha:ctx.globalAlpha,fill:ctx.fillStyle});
  const canvas={width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:448,height:288}),focus(){},setPointerCapture(){},releasePointerCapture(){},
    addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n),
    ownerDocument:{createElement(){
      tiles++;
      const data = new Uint8ClampedArray(20*10*4);
      for(let index=0;index<data.length;index+=4)data.set([200,100,50,128],index);
      const tile={width:0,height:0,getContext:()=>({drawImage(...args){tintDraws.push(args)},getImageData:()=>({data}),putImageData(value){tintedPixels.push([...value.data.slice(0,4)])}})};allocated.push(tile);return tile;
    }}};
  const model=scene(image),controller=createScenePreviewCanvas({canvas,onMove:(...v)=>moves.push(v),onSelect:id=>selected.push(id)});
  controller.setScene(model);controller.setImages(image?new Map([[id(20),{width:20,height:10}]]):new Map());controller.setVisible(true);calls.length=0;
  const dispatch=(name,extra={})=>listeners.get(name)?.({button:0,pointerId:1,clientX:124,clientY:104,preventDefault(){},...extra});
  return {model,controller,calls,moves,selected,dispatch,tiles:()=>tiles,listeners,tintedPixels,tintDraws,allocated};
}
const close = (actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-10,`${actual} != ${expected}`))};
test('visual transform matches root+offset/rotation/scale and opacity while duplicate-definition actor and labels stay logical',()=>{
  const h=harness(),before=JSON.stringify(h.model),view=h.controller.getView();h.controller.setVisualSample(sample());
  const first=h.calls.find(c=>c.name==='fillRect'&&c.args[0]===-10),second=h.calls.find(c=>c.name==='fillRect'&&c.args[0]===230);
  close(first.matrix,[0,2,-.5,0,144,94]);assert.deepEqual(first.args,[-10,-5,20,10]);assert.equal(first.alpha,.25);assert.equal(first.fill,'#11223380');
  close(second.matrix,[1,0,0,1,24,24]);assert.equal(second.alpha,1);
  const label=h.calls.find(c=>c.name==='fillText'&&c.args[0]==='First');assert.deepEqual(label.args,['First',90,89]);close(label.matrix,[1,0,0,1,24,24]);assert.equal(label.alpha,1);
  assert.equal(JSON.stringify(h.model),before);assert.deepEqual(h.controller.getView(),view);assert.equal(h.moves.length,0);
});
test('animated images reuse existing tint cache across frames and preserve color alpha independently of animation',()=>{
  const h=harness(true),count=h.tiles();assert.equal(count,1);
  for(let i=0;i<3;i++){const s=sample();s.values[0].value=[20+i,-10];h.controller.setVisualSample(s);}
  assert.equal(h.tiles(),count);assert.deepEqual(h.tintedPixels,[[200,50,25,64]]);const images=h.calls.filter(c=>c.name==='drawImage');assert.ok(images.some(c=>c.alpha===.25));assert.equal(h.tintedPixels[0][3]*images.find(c=>c.alpha===.25).alpha,16);assert.ok(images.some(c=>c.alpha===1));
  h.controller.setVisualSample(null);assert.equal(h.tiles(),count);
});
test('visual sample is detached and rejects a whole invalid frame without changing the last displayed frame',()=>{
  const h=harness(),value=sample();h.controller.setVisualSample(value);value.values[0].value[0]=500;
  h.calls.length=0;h.controller.fit();close(h.calls.find(c=>c.name==='fillRect'&&c.args[0]===-10).matrix,[0,2,-.5,0,144,94]);
  const invalid=sample();invalid.values.push({...invalid.values[3],trackId:id(30)});const before=h.calls.length;assert.throws(()=>h.controller.setVisualSample(invalid));assert.equal(h.calls.length,before);
});
test('animation keeps pan and zoom, suppresses logical hit rectangles and cannot commit layout changes',()=>{
  const h=harness();h.controller.select(id(1));h.calls.length=0;h.controller.setVisualSample(sample());
  assert.equal(h.calls.some(c=>c.name==='strokeRect'&&c.args[2]===20),false);
  h.dispatch('pointerdown');h.dispatch('pointerup');assert.equal(h.selected.length,0);
  h.dispatch('pointerdown');h.dispatch('pointermove',{clientX:144,clientY:114});h.dispatch('pointerup');assert.equal(h.moves.length,0);
  const view=h.controller.getView();assert.equal(view.offsetX,44);assert.equal(view.offsetY,34);h.controller.zoom(2);assert.equal(h.controller.getView().scale,2);
  h.controller.setVisualSample(null);assert.equal(h.controller.getView().scale,2);
  h.dispatch('pointerdown');h.dispatch('pointerup');assert.equal(h.selected.length,1);
});
test('stop, model replacement, hidden canvas and layout editing independently clear visual overlays',()=>{
  for(const clear of [h=>h.controller.setVisualSample(null),h=>h.controller.setScene({...h.model}),h=>{h.controller.setVisible(false);h.controller.setVisible(true)},h=>h.controller.setEditing(true)]){
    const h=harness();h.controller.setVisualSample(sample());h.calls.length=0;clear(h);
    assert.ok(h.calls.some(c=>c.name==='fillRect'&&JSON.stringify(c.args)==='[90,75,20,10]'));
  }
  const h=harness();h.controller.setEditing(true);assert.equal(h.controller.setVisualSample(sample()),false);h.controller.setEditing(false);h.controller.setVisible(false);assert.equal(h.controller.setVisualSample(sample()),false);
  h.controller.destroy();assert.equal(h.controller.setVisualSample(sample()),false);assert.equal(h.listeners.size,0);
});
test('zero opacity affects only the visual, not labels, and a new frame does not inherit prior channels',()=>{
  const h=harness(),s=sample();h.controller.setVisualSample(s);s.values=[{...s.values[3],value:0}];h.calls.length=0;h.controller.setVisualSample(s);
  const first=h.calls.find(c=>c.name==='fillRect'&&c.args[0]===-10);close(first.matrix,[1,0,0,1,124,104]);assert.equal(first.alpha,0);
  assert.equal(h.calls.find(c=>c.name==='fillText'&&c.args[0]==='First').alpha,1);
});


test('grid frames crop row-major cells without resizing logical actors or affecting shared-image instances', () => {
  const h = harness(true), tiles = h.tiles(), base = sample();
  for (const [index, x, y] of [[0,0,0], [1,10,0], [2,0,5], [3,10,5]]) {
    const s = structuredClone(base); s.values.push({trackId:id(40),instanceId:id(1),property:'spriteFrame2d',grid:{columns:2,rows:2},value:index});
    h.calls.length=0; h.controller.setVisualSample(s);
    const draws=h.calls.filter(call=>call.name==='drawImage');
    assert.deepEqual(draws[0].args.slice(1),[0,0,10,5,-10,-5,20,10]);
    assert.deepEqual(h.tintDraws.at(-1).slice(1),[x,y,10,5,0,0,10,5]);
    close(draws[0].matrix,[0,2,-.5,0,144,94]); assert.equal(draws[0].alpha,.25);
    assert.deepEqual(draws[1].args.slice(1),[230,75,20,10]);
    assert.equal(h.tiles(),tiles+index+1);
  }
  h.calls.length=0; h.controller.setVisualSample(null);
  assert.deepEqual(h.calls.filter(c=>c.name==='drawImage')[0].args.slice(1),[90,75,20,10]);
  assert.equal(h.tiles(),tiles+4);
});


test('large shared atlases tint only cells and bound whole-sheet fallback before allocation', () => {
  const h=harness(true);h.controller.setImages(new Map([[id(20),{width:4096,height:4096}]]));
  assert.ok(h.allocated.every(tile=>tile.width*tile.height*4<=32*1024*1024));
  const s={timeSeconds:0,localTimeSeconds:0,finished:false,values:[1,2].map((n,i)=>({trackId:id(50+i),instanceId:id(n),property:'spriteFrame2d',grid:{columns:64,rows:64},value:i}))};
  h.controller.setVisualSample(s);const count=h.tiles();
  assert.deepEqual(h.tintDraws.slice(-2).map(args=>args.slice(1)),[[0,0,64,64,0,0,64,64],[64,0,64,64,0,0,64,64]]);
  for(let i=0;i<3;i++)h.controller.setVisualSample(s);
  assert.equal(h.tiles(),count);assert.ok(h.allocated.reduce((sum,tile)=>sum+tile.width*tile.height*4,0)<=32*1024*1024);
});
