import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';

const bytes = await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, {}), core = instance.exports;
const nativePath = process.env.VIENTO_STUDIO_CORE_BIN;
let nativeAvailable = false;
if (nativePath) try { await fs.access(nativePath, constants.X_OK); nativeAvailable = true; } catch { /* Native parity is opt-in outside a prepared core build. */ }
const scene = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const content = '\ufeff' + JSON.stringify({ ...scene, name: 'Fog / 霧 / 雾 🦊 } "fog"' }, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const withFog = fog => { const at = content.lastIndexOf('}'); return content.slice(0, at) + ',"fog":' + JSON.stringify(fog) + content.slice(at); };
const parse = content => ({ protocolVersion: 1, operation: 'scene3d.parse', content });
const patch = (values, source = content) => ({ protocolVersion: 1, operation: 'scene3d.patchEnvironment', content: source, values });
function wasm(value) {
  const input = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const at = core.viento_core_input(input.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, input.length).set(input);
  const output = core.viento_core_run() >>> 0, length = core.viento_core_output_len();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(core.memory.buffer, output, length)));
}
function native(values) {
  return new Promise((resolve, reject) => {
    const process = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let output = '', errors = '';
    process.on('error', reject); process.stdin.on('error', reject);
    process.stdout.on('data', value => { output += value; }); process.stderr.on('data', value => { errors += value; });
    process.on('close', code => {
      try { assert.equal(code, 0, errors); resolve(output.trim().split('\n').map(line => JSON.parse(line))); } catch (error) { reject(error); }
    });
    process.stdin.end(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  });
}

const field = () => ({center:[0,2,0],extent:[10,5,8],velocity:[-3,2.5,.001],size:[.1,.2,.1],color:'#aBcDeF',count:2,seed:0});
const prepare = field => ({protocolVersion:1,operation:'scene3d.prepareParticleField',field});
const sample = (field,timeSeconds) => ({...prepare(field),operation:'scene3d.sampleParticleField',timeSeconds});
const present = value => {const at=content.lastIndexOf('}');return content.slice(0,at)+',"particleField":'+JSON.stringify(value)+content.slice(at);};
test('fresh native CLI and actual WASM agree on particle preparation sampling source patch strictness and old authoring', {skip:!nativeAvailable}, async () => {
 const value=field(), declared=present(value),lexical=declared.replace('"particleField":','"particleF\\u0069eld":').replace('"count":2','"co\\u0075nt":2e0');
 const wire=JSON.stringify(prepare(value)), patchWire=JSON.stringify(patch({particleField:value}));
 const inputs=[
  prepare(value),prepare({...value,count:0}),prepare({...value,count:4096,seed:4294967295}),prepare({...value,seed:2654435769}),
  sample(value,0),sample(value,.5),sample(value,3600),sample({...value,velocity:[-1e-20,1e-40,5e-324]},1),
  sample({...value,extent:[.01,.01,.01],size:[.001,.001,.001],velocity:[1000,-1000,1000]},3600),sample(value,.123456789),
  sample(value,-.01),sample(value,3600.001),sample(value,null),
  prepare({...value,count:4097}),prepare({...value,seed:4294967296}),prepare({...value,size:[11,.1,.1]}),prepare({...value,extra:1}),
  parse(content),parse(declared),parse(present({...value,count:0})),parse(lexical),parse(present(null)),parse(present({...value,color:'#gg0000'})),
  patch({particleField:value}),patch({particleField:{...value,count:0}}),patch({particleField:value,fog:{color:'#123456',density:.125}}),
  patch({particleField:value,background:'#123456',camera:{fovDegrees:55},light:{energy:2}}),patch({particleField:value},lexical),
  patch({particleField:{...value,count:0,seed:1}},lexical),patch({background:'#123456'},lexical),patch({particleField:{count:0}}),
  wire.replace('"seed":','"seed":null,"s\\u0065ed":'),wire.replace('"field":','"field":null,"field":'),
  patchWire.replace('"particleField":','"particleField":null,"particleField":'),patchWire.replace('"seed":','"seed":null,"seed":'),
  {...prepare(value),timeSeconds:0},{...sample(value,1),extra:true},
  parse(declared.replace('"seed":0','"seed":0,"s\\u0065ed":1')),
  patch({particleField:value},content+' '.repeat(131072-Buffer.byteLength(content))),
  {protocolVersion:1,operation:'scene3d.patchObjectTransform',content:lexical,instanceId:scene.objects[0].instanceId,values:{position:[2,3,4]}},
  {protocolVersion:1,operation:'scene3d.patchObjects',content:lexical,action:'copy',instanceId:scene.objects[0].instanceId,newInstanceId:'60000000-1111-4111-8111-111111111111',name:'Copied through particles'},
 ];
 assert.equal(inputs.length,41);
 const wasmResults=inputs.map(wasm),nativeResults=await native(inputs);assert.deepEqual(nativeResults,wasmResults);
 for(const index of [0,1,2,3,4,5,6,7,8,9,17,18,19,20,23,24,25,26,27,28,29,39,40])assert.equal(wasmResults[index].ok,true,`valid case ${index}`);
 for(const index of [10,11,12,13,14,15,16,21,22,30,31,32,33,34,35,36,37,38])assert.equal(wasmResults[index].ok,false,`invalid case ${index}`);
 assert.equal(wasmResults[38].errorCode,'scene3d_limit');
});
