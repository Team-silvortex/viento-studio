import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2] || '.'), hash=b=>createHash('sha256').update(b).digest('hex');
const files=['web/modules/scene3d-math.js','web/modules/scene3d-renderer.js','web/modules/app-scene3d-preview.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js','engine/studio-core.mjs','engine/studio-core.wasm'];
const report={ok:false,copies:[],cases:[],limitations:['Resource preparation and source identity only; no native installer/device or new Rust build.']};
for(const target of ['desktop/resources','mobile/dist']){
 for(const file of files){const source=hash(await fs.readFile(path.join(root,file))),copy=hash(await fs.readFile(path.join(root,target,file)));assert.equal(copy,source);report.copies.push({target,file,sha256:source});}
 const {panCamera,standardViewCamera,lookAt4,cameraProjection4,multiply4,frameSceneCamera}=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-math.js')));
 const renderer=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-renderer.js')));assert.equal(typeof renderer.createScene3DRenderer,'function');
 const camera={position:[4,5,8],target:[0,0,0],fovDegrees:50,near:.1,far:200};
 const objects=[{position:[-17,0,0],size:[3,7,4],rotationDegrees:[12,31,42]},{position:[21,4,-3],size:[9,2,6],rotationDegrees:[3,-25,0]}];
 const multiply=(m,p)=>[0,1,2,3].map(row=>p.reduce((sum,n,col)=>sum+n*m[col*4+row],0));
 const project=(c,point)=>{const m=multiply4(cameraProjection4(c,1.6,'orthographic'),lookAt4(c.position,c.target,c.up)),p=multiply(m,[...point,1]);return[(p[0]/p[3]+1)*400,(1-p[1]/p[3])*250];};
 for(const direction of ['front','back','left','right','top','bottom']){
  const before=frameSceneCamera(standardViewCamera(camera,direction),objects,1.6,'orthographic'),after=panCamera(before,25,-15,{width:800,height:500,aspect:1.6});assert.ok(after);
  const witnesses=[];for(const object of objects){const a=project(before,object.position),b=project(after,object.position);assert.ok(Math.abs(b[0]-a[0]-25)<1e-8);assert.ok(Math.abs(b[1]-a[1]+15)<1e-8);witnesses.push([b[0]-a[0],b[1]-a[1]]);}
  const matrix=cameraProjection4(before,1.6,'orthographic');assert.equal(matrix[15],1);assert.equal(matrix[11],0);assert.equal(after.near,before.near);assert.equal(after.far,before.far);report.cases.push({target,direction,witnesses});
 }
}
assert.equal(report.copies.length,16);assert.equal(report.cases.length,12);report.ok=true;
await fs.writeFile(path.resolve(process.argv[3] || 'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,copies:report.copies.length,cases:report.cases.length}));
