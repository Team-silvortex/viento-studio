import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../../../', import.meta.url);
const evidence = new URL('./', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['crates/viento-studio-core/src/scene3d.rs','crates/viento-studio-core/src/lib.rs','engine/studio-core.mjs','engine/scene3d.mjs','engine/studio-core.wasm'];
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(new URL(file, root)))])));
const wasmBytes = await fs.readFile(new URL('engine/studio-core.wasm', root));
const { instance } = await WebAssembly.instantiate(wasmBytes, {}), exports = instance.exports;
const run = request => {
  const bytes = new TextEncoder().encode(JSON.stringify(request)), input = exports.viento_core_input(bytes.length);
  new Uint8Array(exports.memory.buffer, input, bytes.length).set(bytes);
  const output = exports.viento_core_run(), size = exports.viento_core_output_len();
  return JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, output, size)));
};
const sample = JSON.parse(await fs.readFile(new URL('examples/scene3d/scene.json',root)));
const request = value => ({ protocolVersion:1, operation:'scene3d.parse', content:JSON.stringify(value) });
const checks = [], malformed = [null,[],{...request(sample),protocolVersion:2},{...request(sample),extra:true},{...request(sample),content:null},{protocolVersion:1,operation:'scene3d.parse'},{...request(sample),operation:'scene3d.patch'}];
for (const value of malformed) assert.equal(run(value).ok,false);
checks.push({id:'fresh-native-WASM-strict-envelope-and-read-only-operation-admission',ok:true,requests:malformed.length});
const variants = [];
for(const x of [0.009999999999999998,0.01,0.010000000000000002]) {
  const value=structuredClone(sample);value.camera.position=[x,0,0];value.camera.target=[0,0,0];variants.push(request(value));
}
for(const x of [0.00009999999999999,0.0001,0.00010000000000001]) {
  const value=structuredClone(sample);value.camera.position=[x,1,0];value.camera.target=[0,0,0];variants.push(request(value));
}
for(const x of [5e-324,1e-300,1e-200]) {
  const value=structuredClone(sample);value.light.direction=[x,0,x];variants.push(request(value));
}
for(const far of [0.0019999999999999996,0.002,0.0020000000000000005,100000]) {
  const value=structuredClone(sample);value.camera.near=0.001;value.camera.far=far;variants.push(request(value));
}
const native = fileURLToPath(new URL('desktop/.cache/scene3d-core-target/debug/viento-core',root));
const sequence = [...malformed,...variants];
const actual = execFileSync(native,[],{input:sequence.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}).trim().split('\n').map(JSON.parse);
assert.deepEqual(actual,sequence.map(run));
checks.push({id:'actual-native-WASM-double-boundary-subnormal-frustum-and-malformed-parity',ok:true,requests:sequence.length});
let count=0;
async function bridge({feature=1,legacy=true,transform=x=>x}={}) {
  const module=await import(new URL(`../../../engine/studio-core.mjs?independent-scene3d=${++count}`,import.meta.url));
  const memory=new WebAssembly.Memory({initial:40}), instantiate=WebAssembly.instantiate;let inputLength=0,outputLength=0;
  try {
    WebAssembly.instantiate=async()=>({instance:{exports:{memory,viento_core_protocol_version:()=>1,
      ...(feature===null?{}:{viento_core_scene3d_version:()=>feature}),
      ...(legacy?{viento_core_scene_composition_version:()=>1,viento_core_scene_composition_patch_version:()=>1}:{}),
      viento_core_input:length=>{inputLength=length;return 16;},viento_core_run:()=>{const input=JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer,16,inputLength)));const output=new TextEncoder().encode(JSON.stringify(transform(run(input))));new Uint8Array(memory.buffer,1048576,output.length).set(output);outputLength=output.length;return 1048576;},viento_core_output_len:()=>outputLength
    }}});await module.initializeStudioCore(()=>new Uint8Array([1]));
  } finally {WebAssembly.instantiate=instantiate;}
  return module;
}
const standalone=await bridge({legacy:false});assert.equal(standalone.supportsStudioCoreCompositionPatch(),false);assert.equal(standalone.supportsStudioCoreScene3D(),true);assert.deepEqual(standalone.dispatchStudioCoreScene3D(request(sample)),run(request(sample)).scene3d);
for(const feature of [null,0,2]) {const module=await bridge({feature});assert.equal(module.supportsStudioCoreCompositionPatch(),true);assert.equal(module.supportsStudioCoreScene3D(),false);assert.throws(()=>module.dispatchStudioCoreScene3D(request(sample)),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,true);}
checks.push({id:'3D-only-module-does-not-require-legacy-probes-and-missing-3D-does-not-poison-old-runtime',ok:true,configurations:4});
const boundaryBridge=await bridge();for(const input of variants) {const expected=run(input);if(expected.ok)assert.deepEqual(boundaryBridge.dispatchStudioCoreScene3D(input),expected.scene3d);else assert.throws(()=>boundaryBridge.dispatchStudioCoreScene3D(input),{errorCode:expected.errorCode});assert.equal(boundaryBridge.getStudioCoreMetadata().ready,true);}
checks.push({id:'bridge-validates-native-double-boundaries-without-invalidating-author-errors',ok:true,requests:variants.length});
for(const change of [value=>{value.scene3d.model.objects[0].position[0]+=1;},value=>{value.scene3d.sourceLocations.objects[0].sourceRange.exact=false;},value=>{value.scene3d.sourceLocations.objects[0].sourceRange.start+=1;}]) {const module=await bridge({transform:value=>{if(value.ok)change(value);return value;}});assert.throws(()=>module.dispatchStudioCoreScene3D(request(sample)),{errorCode:'studio_core_unavailable'});assert.equal(module.getStudioCoreMetadata().ready,false);}
checks.push({id:'forged-model-and-whole-object-range-successes-poison-untrusted-module-before-read-use',ok:true,forgeries:3});
for(const [file,hash]of Object.entries(hashes))assert.equal(sha(await fs.readFile(new URL(file,root))),hash);
const report={format:'viento-scene3d-core-readonly-audit',schemaVersion:1,createdAt:new Date().toISOString(),runtime:process.version,sourceHashes:hashes,nativeSha256:sha(await fs.readFile(native)),checks,passed:checks.length,failed:0,findings:[],limitations:['The bridge verifies a trusted native parser receipt; it deliberately does not introduce another source parser.','Standard same-process JavaScript data validation is not a security sandbox for hostile Proxies or external same-user file races.','Read-only model parsing provides no asset, World, behavior, hierarchy, source mutation or 2D fallback.']};
await fs.writeFile(new URL('core-independent-audit.json',evidence),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,failed:0,nativeWasmRequests:sequence.length}));
