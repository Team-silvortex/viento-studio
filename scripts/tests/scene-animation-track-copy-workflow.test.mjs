import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serve, request } from './helpers.mjs';
import { projectAnimationClipsAuthor } from './helpers/project-animation-clips-author-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { createSceneAnimationSourceHost } from '../../web/modules/app-scene-animation-source.js';
import { copySceneAnimationTrackDraft, createSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { sampleSceneAnimation, sampleSceneAnimationClip } from '../../engine/scene-animation-core.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url));
const hash=v=>createHash('sha256').update(v).digest('hex');
const parse=v=>JSON.parse(v.replace(/^\ufeff/,''));
const fields=d=>({durationSeconds:d.durationSeconds,loop:d.loop,tracks:d.tracks,clips:d.clips});
const id=n=>`72727272-7272-4272-8272-${String(n).padStart(12,'0')}`;

async function copyAndSave(t,documents='documents',probe=false) {
  const f=await projectAnimationClipsAuthor(t),scene=await f.read('documents/scenes/demo.json');
  const targetId=scene.actors[1].instanceId,assetId=id(10),sourceAssetId=scene.actors[0].imageResourceId;
  // Target instance owns a distinct registered image before any animation edit.
  const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ef5050"/></svg>\n');
  await fs.writeFile(path.join(f.author,'assets/copy-target.svg'),bytes);
  const asset=await f.read(`metadata/assets/${sourceAssetId}.json`);
  await f.write(`metadata/assets/${assetId}.json`,{...asset,id:assetId,name:'Copy target image',location:{store:'main',path:'copy-target.svg'},content:{size:bytes.length,sha256:hash(bytes)},legacyPaths:['assets/copy-target.svg']});
  await f.edit(`metadata/documents/${scene.actors[1].objectId}.json`,record=>record.assetBindings.push({assetId,role:'alternate-sprite'}));
  await f.edit('documents/scenes/demo.json',value=>value.actors[1].imageResourceId=assetId);
  await f.script('checkpoint',probe?`extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tp.select_animation_clip("${f.clipIds[0][1]}")
\tp.seek_animation(0.25)
\tcall_deferred("_probe")
func _probe() -> void:
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tprint("COPY_VISUAL:" + JSON.stringify([scene.animation_time, scene.animation_visuals["${f.instanceId}"].position.x, scene.animation_visuals["${targetId}"].position.x, scene.animation_sprites["${f.instanceId}"].frame, scene.animation_sprites["${targetId}"].frame, scene.animation_sprites["${f.instanceId}"].texture.resource_path != scene.animation_sprites["${targetId}"].texture.resource_path]))
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`:'extends Node\n');
  if(documents!=='documents') {
    await f.edit('workspace.json',v=>{v.version=2;v.paths.documents=documents;v.paths.templates='data-template';});
    await fs.rename(path.join(f.author,'templates'),path.join(f.author,'data-template'));
    await fs.rename(path.join(f.author,'documents'),path.join(f.author,documents));
    for(const name of await fs.readdir(path.join(f.author,'metadata/documents'))) await f.edit(`metadata/documents/${name}`,v=>v.sourcePath=v.sourcePath.replace(/^documents\//,documents+'/'));
  }
  const sourcePath=`${documents}/animations/scene-0.json`,file=path.join(f.author,sourcePath);
  const original='\ufeff'+(await fs.readFile(file,'utf8')).replaceAll('\n','\r\n');await fs.writeFile(file,original);
  const before=await fingerprint(f.author,{authorOnly:true});
  const base=await serve(t,appRoot,{VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:f.author});
  const call=async(route,payload)=>{const res=await request(base,route,payload);assert.equal(res.status,200,JSON.stringify(res));return res.data;};
  const read=await call('/api/doc?path='+encodeURIComponent(sourcePath));
  const state={document:{},sourcePath,token:'track-copy-workflow',content:original,baseline:original,version:read.version,editable:true,creating:false,busy:false,available:true,sourceJSON:true,targetsAvailable:true};
  const writes=[];
  const host=createSceneAnimationSourceHost({getState:()=>({...state}),digest:async value=>hash(value),inspectTargets:value=>call('/api/scene-animation-targets',value),writeDraft:value=>{state.content=value;writes.push(value);}});
  const source=await host.getSource(),targets=await host.getTargets(source),current=parse(original);
  current.tracks[0].keyframes.at(-1).value[0]=200;current.clips[0].name='未保存 / renamed';
  let result=await copySceneAnimationTrackDraft(original,fields(current),current.tracks[0].id,targetId,id(1));
  result=await copySceneAnimationTrackDraft(original,fields(result),current.tracks[1].id,targetId,id(2));
  assert.deepEqual(result,{...current,tracks:[...current.tracks,{...current.tracks[0],id:id(1),instanceId:targetId},{...current.tracks[1],id:id(2),instanceId:targetId}]});
  await assert.rejects(copySceneAnimationTrackDraft(original,fields(result),current.tracks[0].id,targetId,id(3)));
  assert.equal(writes.length,0);assert.equal(state.content,original);assert.deepEqual(await fingerprint(f.author,{authorOnly:true}),before);
  const proposal=await createSceneAnimationProposal(source,fields(result));assert.ok(proposal.changedPaths.includes('/tracks'));
  await host.applyDraft(proposal,{targets});assert.equal(writes.length,1);assert.deepEqual(await fingerprint(f.author,{authorOnly:true}),before);
  assert.ok(state.content.startsWith('\ufeff'));assert.equal(state.content.replaceAll('\r\n','').includes('\n'),false);
  const saved=await call('/api/doc',{path:sourcePath,content:state.content,expectedVersion:read.version});
  assert.equal(saved.version,'sha256:'+hash(state.content));assert.equal(await fs.readFile(file,'utf8'),state.content);
  const after=await fingerprint(f.author,{authorOnly:true});assert.deepEqual(Object.keys(after).filter(name=>after[name]!==before[name]),[sourcePath]);
  const captured=await captureBuildSnapshot(f.author,f.sceneIds[0]);assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));assert.deepEqual(captured.plan.animation.document,result);
  const savedScene=await f.read(`${documents}/scenes/demo.json`);assert.equal(savedScene.actors[0].imageResourceId,sourceAssetId);assert.equal(savedScene.actors[1].imageResourceId,assetId);
  for(const time of [0,.125,.25,.5,.75,1,2]) for(const sample of [sampleSceneAnimation(result,time),sampleSceneAnimationClip(result,f.clipIds[0][1],time)]) {
    const values=instance=>sample.values.filter(v=>v.instanceId===instance).map(({instanceId,trackId,...rest})=>rest);
    assert.deepEqual(values(targetId),values(f.instanceId));assert.equal(values(targetId).length,2);
  }
  assert.deepEqual(await fingerprint(f.author,{authorOnly:true}),after);
  return {...f,result,after,targetId};
}
for(const documents of ['documents','design-data']) test(`current track copies → reviewed source → ordinary Save → frozen independent target samples (${documents})`,async t=>{await copyAndSave(t,documents);});
test('actual Godot executes saved copied numeric and sprite tracks with each instance retaining its own texture',{
  skip:!process.env.VIENTO_GODOT_BIN&&'Set VIENTO_GODOT_BIN for actual copied-track integration',
},async t=>{
  const f=await copyAndSave(t,'documents',true),tool=process.env.VIENTO_GODOT_BIN,output=path.join(f.temporary,'track-copy-build');
  const built=await buildProject({root:f.author,targetId:f.assemblyId,tool,output});assert.equal(built.ok,true,JSON.stringify(built.diagnostics||built.record?.diagnostics));
  const ran=await runProjectBuild({buildDirectory:output,tool,headless:true,smoke:false});assert.equal(ran.ok,true,JSON.stringify(ran.record?.diagnostics||ran));assert.equal(ran.record.events[0].protocol,7);
  const observed=ran.record.phases.at(-1).stdout.split('\n').filter(line=>line.startsWith('COPY_VISUAL:')).map(line=>JSON.parse(line.slice('COPY_VISUAL:'.length)));
  assert.deepEqual(observed,[[.75,150,150,3,3,true]]);
  assert.deepEqual(await fingerprint(f.author,{authorOnly:true}),f.after);
});
