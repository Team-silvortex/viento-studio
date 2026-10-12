import test from 'node:test';
import assert from 'node:assert/strict';
import { frameCamera, sceneBounds, frameSceneCamera } from '../../web/modules/scene3d-math.js';

const unit = v => { const length = Math.hypot(...v); return v.map(n => n / length); };
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const object = { position: [2, 3, 4], rotationDegrees: [23, -41, 67], size: [2, 3, 4] };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
// Independent geometry: rotate each corner sequentially Z, Y, X, then use
// camera basis dot products. Do not call the frame helper's sphere algorithm.
function corners(value) {
  const [x, y, z] = value.rotationDegrees.map(n => n * Math.PI / 180), result = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    let [a, b, c] = [value.size[0] * sx / 2, value.size[1] * sy / 2, value.size[2] * sz / 2];
    [a, b] = [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    result.push([a, b, c].map((n, i) => n + value.position[i]));
  }
  return result;
}
function assertContained(view, box, aspect) {
  const back = unit(view.position.map((n, i) => n - view.target[i]));
  const right = unit(cross([0, 1, 0], back)), up = cross(back, right), tangent = Math.tan(view.fovDegrees * Math.PI / 360);
  for (const corner of corners(box)) {
    const relative = corner.map((n, i) => n - view.position[i]);
    const depth = -dot(relative, back), x = dot(relative, right) / (depth * tangent * aspect), y = dot(relative, up) / (depth * tangent);
    assert.ok(depth > view.near && depth < view.far, `corner depth ${depth} outside ${view.near}..${view.far}`);
    assert.ok(Math.abs(x) <= 1 / 1.2 + 1e-5 && Math.abs(y) <= 1 / 1.2 + 1e-5, `corner clipping x=${x} y=${y} aspect=${aspect}`);
  }
}

const scene = () => [
 {position:[-18,2,-7],rotationDegrees:[23,-41,67],size:[2,3,4]},
 {position:[14,-3,11],rotationDegrees:[89,177,-77],size:[17,1,29]},
 {position:[7,9,-12],rotationDegrees:[173,-35999,67],size:[.001,1000,.001]}];
test('scene bounds include every independently rotated nonuniform box corner and freeze detached diagnostics',()=>{
 const objects=freeze(scene()),before=JSON.stringify(objects),all=objects.flatMap(corners),bounds=sceneBounds(objects);assert.ok(bounds);
 assert.ok(Object.isFrozen(bounds)&&Object.isFrozen(bounds.min)&&Object.isFrozen(bounds.max)&&Object.isFrozen(bounds.center));
 for(let axis=0;axis<3;axis++){assert.ok(Math.abs(bounds.min[axis]-Math.min(...all.map(p=>p[axis])))<1e-10);assert.ok(Math.abs(bounds.max[axis]-Math.max(...all.map(p=>p[axis])))<1e-10);assert.equal(bounds.center[axis],bounds.min[axis]/2+bounds.max[axis]/2);}for(const p of all)assert.ok(Math.hypot(...p.map((v,i)=>v-bounds.center[i]))<=bounds.radius+1e-10);assert.equal(JSON.stringify(objects),before);
});
test('complete scene framing preserves current heading FOV and author camera data while replacing temporary clipping',()=>{
 const objects=freeze(scene()),cam=freeze(structuredClone(camera)),before=JSON.stringify([cam,objects]),view=frameSceneCamera(cam,objects,.3),bounds=sceneBounds(objects);assert.ok(view);assert.deepEqual(view.target,bounds.center);assert.equal(view.fovDegrees,cam.fovDegrees);assert.notEqual(view.near,cam.near);assert.notEqual(view.far,cam.far);assert.ok(Object.isFrozen(view)&&Object.isFrozen(view.position)&&Object.isFrozen(view.target));const a=unit(cam.position.map((v,i)=>v-cam.target[i])),b=unit(view.position.map((v,i)=>v-view.target[i]));a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-12));objects.forEach(box=>assertContained(view,box,.3));assert.equal(JSON.stringify([cam,objects]),before);
});
test('128 objects with extreme coordinates rotations sizes FOV and aspects all fit independent camera-space corners',()=>{
 let cases=0;const objects=Array.from({length:128},(_,i)=>({position:[i%2?100000:-100000,i%3?100000:-100000,i%5?100000:-100000],rotationDegrees:[i*287,-35999+i,179-i],size:i%3?[.001,1000,.001]:[1000,.001,1000]}));
 for(const fovDegrees of [1,60,179])for(const aspect of [1/8192,1/2048,.2,1,8192]){const view=frameSceneCamera({...camera,fovDegrees,near:10000,far:100000},objects,aspect);assert.ok(view);for(const box of objects)assertContained(view,box,aspect);cases++;}assert.equal(cases,15);
});
test('far-coordinate millimetre scene retains its nonzero rotated enclosing body and independent near far',()=>{
 const objects=[{position:[100000,-100000,100000],rotationDegrees:[23,-41,67],size:[.001,.001,.001]}];for(const aspect of [1/8192,1,8192]){const view=frameSceneCamera({...camera,fovDegrees:179,near:10000,far:100000},objects,aspect);assert.ok(view);assertContained(view,objects[0],aspect);assert.ok(sceneBounds(objects).radius>.0008);}const view=frameSceneCamera({...camera,fovDegrees:179},objects,1);assert.ok(view.near<.001&&view.far<.01);
});
test('order permutations and irrelevant identity/name/color fields cannot change whole-scene geometric bounds',()=>{
 const objects=scene(),a=sceneBounds(objects),b=sceneBounds([...objects].reverse().map((box,i)=>({...box,instanceId:String(i),name:'arbitrary',color:'#ffffff'})));assert.deepEqual(a,b);assert.deepEqual(frameSceneCamera(camera,objects,.5),frameSceneCamera(camera,[...objects].reverse(),.5));
});
test('every malformed or nonfinite object rejects the entire scene without skipping or modifying valid objects',()=>{
 for(const bad of [null,{}, {position:[0,0,0],size:[1,1,1]}, {...object,size:[0,1,1]}, {...object,size:[-1,1,1]}, {...object,size:[Infinity,1,1]}, {...object,position:[NaN,1,1]}, {...object,rotationDegrees:[1,2]}, {...object,rotationDegrees:[Infinity,0,0]}, {...object,rotationDegrees:[1e308,1e308,1e308]}]){const objects=[structuredClone(object),bad],before=JSON.stringify(objects);assert.equal(sceneBounds(objects),null);assert.equal(frameSceneCamera(camera,objects,1),null);assert.equal(JSON.stringify(objects),before);}for(const objects of [null,[],{},Array(2),Array.from({length:129},()=>object)])assert.equal(sceneBounds(objects),null);
});
test('invalid pole degenerate aspect and overflowing camera/bounds arithmetic remain explicit failures',()=>{
 for(const cam of [null,{}, {...camera,position:camera.target}, {...camera,position:[0,3,0],target:[0,0,0]}, {...camera,position:[0,-3,0],target:[0,0,0]}, {...camera,fovDegrees:0}, {...camera,fovDegrees:180}, {...camera,position:[Infinity,0,0]}, {...camera,position:[1e308,1e308,1e308],target:[-1e308,-1e308,-1e308]}])assert.equal(frameSceneCamera(cam,scene(),1),null);for(const aspect of [0,-1,NaN,Infinity,Number.MIN_VALUE])assert.equal(frameSceneCamera(camera,scene(),aspect),null);const huge=[{position:[0,0,0],rotationDegrees:[0,0,0],size:[1e308,1e308,1e308]}];assert.equal(frameSceneCamera(camera,huge,1/8192),null);const lost=[{position:[1e300,1e300,1e300],rotationDegrees:[0,0,0],size:[.001,.001,.001]}];assert.equal(sceneBounds(lost),null);
});
