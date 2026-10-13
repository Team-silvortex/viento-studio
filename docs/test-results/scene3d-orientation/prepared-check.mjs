import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2] || '.'),hash=b=>createHash('sha256').update(b).digest('hex');
const files=['web/modules/scene3d-math.js','web/modules/scene3d-renderer.js','web/modules/scene3d-orientation.js','web/modules/app-scene3d-preview.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js','engine/studio-core.mjs','engine/studio-core.wasm'];
const report={ok:false,copies:[],cases:[],limitations:['Prepared source and module checks only; no native installer, device or new Rust build.']};
for(const target of ['desktop/resources','mobile/dist']){
 for(const file of files){const source=hash(await fs.readFile(path.join(root,file))),copy=hash(await fs.readFile(path.join(root,target,file)));assert.equal(copy,source);report.copies.push({target,file,sha256:source});}
 const {orientationAxes,standardViewCamera,lookAt4,orbitCamera}=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-math.js')));
 const renderer=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-renderer.js')));assert.equal(typeof renderer.createScene3DRenderer,'function');
 const indicator=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-orientation.js')));assert.equal(typeof indicator.createScene3DOrientationIndicator,'function');
 const camera={position:[4,5,8],target:[0,0,0],fovDegrees:50,near:.1,far:200};
 for(const direction of ['front','back','left','right','top','bottom','free']){
  const view=direction==='free'?orbitCamera(standardViewCamera(camera,'top'),.3,.6):standardViewCamera(camera,direction),axes=orientationAxes(view),m=lookAt4(view.position,view.target,view.up);
  for(const [i,a]of axes.entries()){assert.ok(Math.abs(a.x-m[i*4])<1e-12);assert.ok(Math.abs(a.y+m[i*4+1])<1e-12);assert.ok(Math.abs(a.depth-m[i*4+2])<1e-12);assert.ok(Object.isFrozen(a));}
  assert.ok(Object.isFrozen(axes));report.cases.push({target,direction,axes});
 }
}
assert.equal(report.copies.length,18);assert.equal(report.cases.length,14);report.ok=true;
await fs.writeFile(path.resolve(process.argv[3]||'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,copies:18,cases:14}));
