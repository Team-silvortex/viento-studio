import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='/tmp/viento-fog-kf56nn4y/candidate';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-core.build.json','engine/scene3d.mjs','engine/scene3d-environment.mjs','web/modules/app-scene3d-environment.js','web/modules/scene3d-renderer.js','web/scene3d-environment.css','web/i18n/en.js','web/i18n/ja.js'];
const source=await fs.readFile(path.join(root,'examples/scene3d/scene.json'),'utf8'),copies=[],cases=[];
for(const target of ['desktop/resources','mobile/dist']){
 for(const file of files){const expected=hash(await fs.readFile(path.join(root,file))),actual=hash(await fs.readFile(path.join(root,target,file)));assert.equal(actual,expected);copies.push({target,file,sha256:actual});}
 const url=p=>pathToFileURL(path.join(root,target,p));
 const core=await import(url('engine/studio-core.mjs'));await core.initializeStudioCore(()=>fs.readFile(url('engine/studio-core.wasm')));assert.equal(core.supportsStudioCoreScene3DFog(),true);
 const scene=await import(url('engine/scene3d.mjs')),env=await import(url('engine/scene3d-environment.mjs'));
 const snapshot={sourcePath:'documents/demo.json',token:'current',content:source,baseSourceRevision:'sha256:'+hash(source),sourceRevision:'sha256:'+hash(source)};
 const proposal=env.createScene3DEnvironmentProposal(snapshot,{values:{fog:{color:'#abcDEF',density:.075}}});
 const {afterContent:after}=await env.prepareScene3DEnvironmentApply(snapshot,proposal,{digest:async text=>hash(text)});
 assert.equal(after,proposal.afterContent);assert.deepEqual(scene.parseScene3DSource(after).model.fog,{color:'#abcDEF',density:.075});
 assert.equal(Object.hasOwn(scene.parseScene3DSource(source).model,'fog'),false);cases.push({target,optionalCapability:true,proposalApplyParse:true,oldModelUnchanged:true});
}
await fs.writeFile(path.join(root,'docs/test-results/scene3d-fog/prepared.json'),JSON.stringify({ok:true,copies,cases,scope:'Generated desktop/mobile resource bytes and actual prepared WASM/proposal apply in Node; no installer, Android device or Tauri runtime test.'},null,2)+'\n');
console.log(JSON.stringify({ok:true,copies:copies.length,cases:cases.length}));
