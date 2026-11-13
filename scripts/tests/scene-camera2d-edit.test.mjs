import test from 'node:test';
import assert from 'node:assert/strict';
import { editSceneCamera2DSource } from '../../engine/scene-camera2d-edit.mjs';
const id = '77777777-7777-4777-8777-777777777777';
const source = '\ufeff{\r\n\t"format":"viento-scene-camera2d", "schemaVersion":1e0, "sceneObjectId":"'+id+'",\r\n\t"camera":{"mode":"fixed","center":[4e2,2.4e2],"zoom":1.00}\r\n}\r\n';
test('camera form edits preserve every byte outside the camera JSON value', () => {
  const next = editSceneCamera2DSource(source, { mode: 'follow', targetInstanceId:id, offset:[-10,20], zoom:2 });
  assert.equal(next.slice(0,next.indexOf('"camera":')),source.slice(0,source.indexOf('"camera":')));
  assert.ok(next.endsWith('\r\n}\r\n')); assert.ok(next.includes('"schemaVersion":1e0'));
  assert.deepEqual(JSON.parse(next.slice(1)).camera,{ mode:'follow',targetInstanceId:id,offset:[-10,20],zoom:2 });
});
test('camera form rejects broken, duplicate, unknown and out-of-range settings', () => {
  for(const content of ['',source.replace('1e0','2'),source.replace('"zoom":1.00','"zoom":1,"zoom":2')]) assert.throws(()=>editSceneCamera2DSource(content,{mode:'fixed',center:[0,0],zoom:1}));
  for(const camera of [{mode:'fixed',center:[0,0],zoom:0},{mode:'fixed',center:[0,0],zoom:9},{mode:'fixed',center:[0,0],zoom:1,unknown:true}]) assert.throws(()=>editSceneCamera2DSource(source,camera));
});

test('an unchanged camera preserves its complete original source bytes',()=>{
 assert.equal(editSceneCamera2DSource(source,{mode:'fixed',center:[400,240],zoom:1}),source);
});
