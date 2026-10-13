import '../adapters/node-studio-core.mjs';
import { prepareScene3DParticleField } from '../../engine/scene3d-particles.mjs';
import { captureScene3DParticleField, captureScene3DParticleOffset, createScene3DParticlesRenderer } from '../../web/modules/scene3d-particles-renderer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const distance = camera => Math.hypot(...camera.position.map((value, axis) => value - camera.target[axis]));
const heading = camera => camera.position.map((value, axis) => (value - camera.target[axis]) / distance(camera));
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon, `${actual} != ${expected}`));
const model = () => ({ background: '#142538', camera: { position: [0, 0, 8], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 },
  light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '11111111-1111-4111-8111-111111111111', position: [0, 0, 0], rotationDegrees: [23, -41, 67], size: [2, 2, 2], color: '#85d7bb' }] });
function fixture(options = {}) {
  const calls = [], events = new Map(), documentEvents = new Map(), captures = new Set(), picks = [], errors = [], views = []; let observer;
  const eventTarget = entries => ({ addEventListener: (name, callback, capture) => entries.set(name, { callback, capture }), removeEventListener: name => entries.delete(name) });
  const gl = Object.fromEntries(['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'].map((key, index) => [key, index + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => ({});
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'drawArrays', 'drawArraysInstanced', 'vertexAttribDivisor', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => { if (options.throwDraw && name === 'drawArraysInstanced') throw new Error('particle draw failed'); calls.push([name, ...args]); };
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getUniformLocation = (_, name) => name;
  gl.isContextLost = () => Boolean(options.lost); gl.getExtension = () => null;
  const canvas = { ...eventTarget(events), ownerDocument: eventTarget(documentEvents), width: 0, height: 0, getContext: () => gl,
    getBoundingClientRect: () => options.bounds || { left: 10, top: 20, width: 300, height: 200 },
    setPointerCapture: id => { if (options.captureFailure === id) throw Error('capture failure'); captures.add(id); }, hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); if (options.releaseFailure === id) throw Error('release failure'); events.get('lostpointercapture')?.callback({ pointerId: id }); } };
  const renderer = createScene3DRenderer(canvas, { pixelRatio: () => options.dpr || 1,
    scheduleTouch: options.scheduleTouch, cancelTouch: options.cancelTouch,
    onViewChange: receipt => { views.push(receipt); options.onViewChange?.(receipt); },
    onError: error => { errors.push(error.message); if (options.throwConsumer) throw Error('consumer failed'); }, onPick: (...args) => picks.push(args),
    observe: callback => { observer = callback; return { observe() {}, disconnect() {} }; } });
  const send = (name, extra = {}) => events.get(name)?.callback({ button: 0, isPrimary: true, pointerId: 7, clientX: 160, clientY: 120, timeStamp: 100, preventDefault() {}, ...extra });
  return { gl, canvas, renderer, calls, events, documentEvents, captures, picks, errors, views, send, resize: () => observer() };
}

const uniform = (f, name) => f.calls.findLast(call => call[1] === name && call[0].startsWith('uniform'))?.[2];
const field = () => ({ center:[0,2,0], extent:[10,5,8], velocity:[-3,2.5,.001], size:[.1,.2,.1], color:'#aBcDeF', count:2, seed:0 });
const load = (f, value = model(), particleField = field()) => { value.particleField=particleField; assert.equal(f.renderer.setModel(value,{particleField:prepareScene3DParticleField(particleField)}),true);return value; };
const touch = (f, type, index, xy) => f.send(type,{pointerType:'touch',pointerId:41+index,isPrimary:index===0,buttons:type==='pointerup'?0:1,clientX:xy[0],clientY:xy[1]});

test('particle GPU packet capture freezes detached exact arrays without generating phases', () => {
 const original=field(),prepared=structuredClone(prepareScene3DParticleField(original)),packet=captureScene3DParticleField(original,prepared);
 assert.deepEqual(packet,prepared);assert.ok(Object.isFrozen(packet)&&Object.isFrozen(packet.field.center)&&Object.isFrozen(packet.phases[0]));
 prepared.field.center[0]=12;prepared.phases[0][0]=0;assert.equal(packet.field.center[0],0);assert.notEqual(packet.phases[0][0],0);
 assert.deepEqual(captureScene3DParticleOffset([.1,.2,0]),[.1,.2,0]);
});
test('packet validation rejects mismatches bad phase shapes budgets non-Float32 values and accessors without execution', () => {
 const original=field(),prepared=prepareScene3DParticleField(original);
 for(const mutate of [p=>{p.field.seed=1;},p=>{p.phases.pop();},p=>{p.phases[0][0]=.1;},p=>{p.phases[0][0]=1;},p=>{p.phases[0][0]=-1;},p=>{p.phases[0]=[0,0];},p=>{delete p.phases[0][0];},p=>{p.phases.push([0,0,0]);},p=>{p.extra=1;},p=>{p.phases[0].extra=1;}]){const next=structuredClone(prepared);mutate(next);assert.throws(()=>captureScene3DParticleField(original,next),TypeError);}
 let reads=0;const next=structuredClone(prepared);Object.defineProperty(next.phases[0],'0',{enumerable:true,get(){reads++;return 0;}});assert.throws(()=>captureScene3DParticleField(original,next),TypeError);assert.equal(reads,0);
});
test('native-prepared 4096 phases upload one static instance buffer and one bounded instanced draw', () => {
 const f=fixture(),value=load(f,model(),{...field(),count:4096});const buffers=f.calls.filter(call=>call[0]==='bufferData');assert.equal(buffers.length,3);
 assert.equal(buffers[2][2].length,4096*3);assert.ok(buffers[2][2] instanceof Float32Array);assert.deepEqual(f.calls.findLast(call=>call[0]==='drawArraysInstanced').slice(1),[f.gl.TRIANGLES,0,36,4096]);
 assert.deepEqual(f.calls.findLast(call=>call[0]==='vertexAttribDivisor').slice(1),[2,1]);
 assert.ok(f.calls.find(call=>call[0]==='enable'&&call[1]===f.gl.DEPTH_TEST));assert.ok(f.calls.find(call=>call[0]==='depthFunc'&&call[1]===f.gl.LEQUAL));
 const original=JSON.stringify(value),before=f.renderer.snapshot().draws,count=f.calls.filter(call=>call[0]==='bufferData').length;
 assert.equal(f.renderer.setParticleFieldOffset([.2,.3,.4]),true);assert.deepEqual(uniform(f,'particleOffset'),[.2,.3,.4]);assert.equal(f.renderer.snapshot().draws,before+1);assert.equal(f.calls.filter(call=>call[0]==='bufferData').length,count);assert.equal(JSON.stringify(value),original);f.renderer.dispose();
});
test('count zero and absent scenes do not allocate instance resources or draw particles and replacing models releases them', () => {
 const f=fixture(),before=f.calls.filter(call=>call[0]==='bufferData').length;load(f,model(),{...field(),count:0});assert.equal(f.calls.filter(call=>call[0]==='bufferData').length,before);assert.equal(f.calls.some(call=>call[0]==='drawArraysInstanced'),false);
 load(f);const buffers=f.calls.filter(call=>call[0]==='deleteBuffer').length;f.renderer.setModel(model());assert.equal(f.calls.filter(call=>call[0]==='deleteBuffer').length,buffers+2);const draws=f.calls.filter(call=>call[0]==='drawArraysInstanced').length;assert.equal(f.renderer.setParticleFieldOffset([0,0,0]),false);f.renderer.render();assert.equal(f.calls.filter(call=>call[0]==='drawArraysInstanced').length,draws);f.renderer.dispose();
});
test('mismatched or missing prepared packet fails closed before allocating particle resources', () => {
 for(const supplied of [undefined,prepareScene3DParticleField({...field(),seed:1})]){const f=fixture(),value={...model(),particleField:field()},allocations=f.calls.length;assert.equal(f.renderer.setModel(value,{particleField:supplied}),false);assert.equal(f.renderer.snapshot().camera,null);assert.equal(f.renderer.hitTest(160,120),null);assert.equal(f.errors.length,1);assert.equal(f.calls.slice(allocations).some(call=>call[0]==='bufferData'),false);f.renderer.dispose();}
});
test('particle uploads share floating origin camera depth fog lighting and both projection matrices', () => {
 for(const mode of ['perspective','orthographic']){const f=fixture(),value=model();for(const vector of [value.camera.position,value.camera.target,value.objects[0].position])for(let i=0;i<3;i++)vector[i]+=90000;value.fog={color:'#aaccee',density:.125};const particleField={...field(),center:[90000,90002,90000]};load(f,value,particleField);f.renderer.setProjectionMode(mode);
 near(uniform(f,'particleCenterRelative'),[0,2,0]);near(uniform(f,'particleCameraRelative'),[0,0,8]);near(uniform(f,'particleFogColor'),[170/255,204/255,238/255]);assert.equal(uniform(f,'particleFogDensity'),.125);assert.equal(uniform(f,'particleLightEnergy'),value.light.energy);
 const view=f.calls.findLast(call=>call[0]==='uniformMatrix4fv'&&call[1]==='viewProjection')[3],particleView=f.calls.findLast(call=>call[0]==='uniformMatrix4fv'&&call[1]==='particleViewProjection')[3];assert.deepEqual(particleView,view);assert.equal(f.renderer.hitTest(160,120),value.objects[0].instanceId);
 const clear=model();load(f,clear);assert.equal(uniform(f,'particleFogDensity'),0);near(uniform(f,'particleCenterRelative'),[0,2,0]);f.renderer.dispose();}
});
test('offset updates reject sparse accessors extras typed arrays and out-of-range values without redraw or state mutation', () => {
 const f=fixture();load(f);f.renderer.setParticleFieldOffset([.2,.3,.4]);const before=f.renderer.snapshot(),calls=f.calls.length;let reads=0;const getter=[0,0,0];Object.defineProperty(getter,'0',{enumerable:true,get(){reads++;return 0;}});const extra=[0,0,0];extra.extra=1;
 for(const bad of [[,0,0],getter,extra,new Float32Array(3),[1,0,0],[-.1,0,0],[NaN,0,0],[Infinity,0,0],[0,0],null])assert.equal(f.renderer.setParticleFieldOffset(bad),false);
 assert.equal(reads,0);assert.equal(f.calls.length,calls);assert.deepEqual(f.renderer.snapshot(),before);assert.deepEqual(uniform(f,'particleOffset'),[.2,.3,.4]);f.renderer.dispose();
});
test('offset animation preserves qualified single taps and active mouse and two-finger gestures', () => {
 const f=fixture(),value=load(f);f.send('pointerdown');f.renderer.setParticleFieldOffset([.1,.2,.3]);f.send('pointerup');assert.equal(f.picks.length,1);assert.equal(f.picks[0][0],value.objects[0].instanceId);
 f.send('pointerdown');const camera=f.renderer.snapshot().camera;f.renderer.setParticleFieldOffset([.2,.3,.4]);f.send('pointermove',{clientX:185,clientY:135});assert.notDeepEqual(f.renderer.snapshot().camera,camera);f.send('pointerup');
 touch(f,'pointerdown',0,[100,100]);touch(f,'pointerdown',1,[200,100]);const previous=f.renderer.snapshot().camera;f.renderer.setParticleFieldOffset([.3,.4,.5]);assert.deepEqual([...f.captures].sort(),[41,42]);touch(f,'pointermove',1,[240,110]);assert.notDeepEqual(f.renderer.snapshot().camera,previous);touch(f,'pointerup',1,[240,110]);touch(f,'pointerup',0,[100,100]);assert.equal(f.picks.length,1);f.renderer.dispose();
});
test('particle draw failure invalidates picking and view receipts without leaking the failed offset', () => {
 const options={},f=fixture(options);load(f);f.renderer.setParticleFieldOffset([.1,.2,.3]);options.throwDraw=true;assert.equal(f.renderer.setParticleFieldOffset([.4,.5,.6]),false);assert.equal(f.renderer.hitTest(160,120),null);assert.equal(f.views.at(-1),null);assert.equal(f.errors.at(-1),'particle draw failed');options.throwDraw=false;f.renderer.render();assert.deepEqual(uniform(f,'particleOffset'),[.1,.2,.3]);f.renderer.dispose();
});
test('allocation compilation and link failure clean up every particle allocation exactly once', () => {
 for(const mode of ['buffer','compile','link']){const f=fixture();let allocated=0,deleted=0;const original=f.gl.createBuffer;f.gl.createBuffer=()=>{if(mode==='buffer'&&allocated===1)return null;allocated++;return original();};const remove=f.gl.deleteBuffer;f.gl.deleteBuffer=(...args)=>{deleted++;remove(...args);};if(mode==='compile')f.gl.getShaderParameter=()=>false;if(mode==='link')f.gl.getProgramParameter=()=>false;
 assert.throws(()=>createScene3DParticlesRenderer(f.gl,prepareScene3DParticleField(field())));assert.equal(deleted,allocated);const programs=f.calls.filter(call=>call[0]==='deleteProgram').length;assert.equal(programs,1);f.renderer.dispose();}
});
test('dispose and context loss revoke offsets and particle resources without late GPU work', () => {
 const options={},f=fixture(options);load(f);options.lost=true;const calls=f.calls.length;assert.equal(f.renderer.setParticleFieldOffset([.1,.2,.3]),false);assert.equal(f.calls.length,calls);assert.equal(f.renderer.hitTest(160,120),null);options.lost=false;f.renderer.dispose();const released=f.calls.length;f.renderer.dispose();assert.equal(f.renderer.setParticleFieldOffset([0,0,0]),false);assert.equal(f.calls.length,released);assert.equal(f.calls.filter(call=>call[0]==='deleteBuffer').length,3);assert.equal(f.calls.filter(call=>call[0]==='deleteProgram').length,2);
});
