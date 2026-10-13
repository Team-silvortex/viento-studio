import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]||'.'),hash=b=>createHash('sha256').update(b).digest('hex');
const files=['web/modules/scene3d-math.js','web/modules/scene3d-renderer.js','web/modules/scene3d-orientation.js','web/modules/app-scene3d-preview.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js','engine/studio-core.mjs','engine/studio-core.wasm'];
const report={ok:false,copies:[],cases:[],limitations:['Temporary resource checks only; no native installation, Android device or Rust rebuild.']};
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0),norm=v=>{const l=Math.hypot(...v);return v.map(n=>n/l);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} vs ${b}`);
for(const target of ['desktop/resources','mobile/dist']){
 for(const file of files){const original=hash(await fs.readFile(path.join(root,file))),copy=hash(await fs.readFile(path.join(root,target,file)));assert.equal(copy,original);report.copies.push({target,file,sha256:original});}
 const math=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-math.js')));
 const renderer=await import(pathToFileURL(path.join(root,target,'web/modules/scene3d-renderer.js')));assert.equal(typeof renderer.createScene3DRenderer,'function');
 const camera={position:[4,5,8],target:[0,0,0],fovDegrees:50,near:.1,far:200},viewport={width:320,height:240,aspect:4/3};
 for(const direction of ['front','back','left','right','top','bottom','free']){
  const view=direction==='free'?camera:math.standardViewCamera(camera,direction),back=norm(view.position.map((n,i)=>n-view.target[i])),right=norm(cross(view.up||[0,1,0],back)),up=cross(back,right),distance=Math.hypot(...view.position.map((n,i)=>n-view.target[i])),span=2*distance*Math.tan(view.fovDegrees*Math.PI/360);
  const anchor=view.target.map((n,i)=>n+right[i]*(-10/320*span*viewport.aspect)+up[i]*(-10/240*span));
  const result=math.touchCamera(view,[[110,130],[190,130]],[[100,142],[220,142]],viewport);assert.ok(result&&Object.isFrozen(result));
  const delta=anchor.map((n,i)=>n-result.target[i]),newDistance=Math.hypot(...result.position.map((n,i)=>n-result.target[i])),newSpan=2*newDistance*Math.tan(view.fovDegrees*Math.PI/360);
  near(newDistance,distance/1.5);near(160+dot(delta,right)/(newSpan*viewport.aspect)*320,160);near(120-dot(delta,up)/newSpan*240,142);
  const newBack=norm(result.position.map((n,i)=>n-result.target[i]));back.forEach((n,i)=>near(n,newBack[i]));
  report.cases.push({target,direction,zoom:distance/newDistance,anchor:[160,142]});
 }
}
assert.equal(report.copies.length,18);assert.equal(report.cases.length,14);report.ok=true;
await fs.writeFile(path.resolve(process.argv[3]||'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,copies:18,cases:14}));
