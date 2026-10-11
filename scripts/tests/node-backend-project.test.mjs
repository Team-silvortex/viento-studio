import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { createBackendProjectManifest, inspectBackendProject, inspectBackendProjectForCleanup } from '../adapters/node-backend-project.mjs';
import { backendProjectFixture, json } from './helpers/backend-project-fixture.mjs';
const inspect=f=>inspectBackendProject({buildDirectory:f.directory,...f.pins});
const clean=f=>inspectBackendProjectForCleanup({buildDirectory:f.directory,...f.pins});
const changed=error=>error?.errorCode==='backend_project_changed'||error?.errorCode==='backend_project_invalid'||error?.errorCode==='backend_project_unavailable';

test('recorded Godot v1/v2/v3 and Bevy v1/v2 projects inspect without any executable discovery or execution', async t => {
  for(const options of [{version:1},{version:2},{behaviors:true},{backend:'bevy',version:1},{backend:'bevy',version:2}]) {
    const f=await backendProjectFixture(t,options), registry=createExecutionBackendRegistry([{...f.adapter,
      identify(){throw new Error('Tool identity must not be queried');},availability(){throw new Error('Tool must not be discovered');},executePhase(){throw new Error('Tool must not be executed');}}]);
    const result=await inspectBackendProject({buildDirectory:f.directory,backendRegistry:registry,...f.pins});
    assert.deepEqual(result.project,f.project);assert.deepEqual(result.inspection,{recorded:true,complete:true,manifestSha256:f.manifestSha256,extraPaths:[]});
    assert.deepEqual((await clean(f)).project,f.project);
  }
});

test('inspection uses frozen inputs after author source disappears and survives a directory move', async t => {
  const f=await backendProjectFixture(t);await fs.rm(f.author,{recursive:true});const moved=path.join(f.temporary,'moved project');await fs.rename(f.directory,moved);
  f.directory=moved;const result=await inspect(f);assert.equal(result.buildDirectory,moved);assert.deepEqual(result.project,f.project);
});

test('legacy missing manifest derives provenance without writing and Godot retains its explicit adapter-null compatibility', async t => {
  const f=await backendProjectFixture(t,{recorded:false,legacy:true}), result=await inspectBackendProject({buildDirectory:f.directory});
  assert.equal(result.inspection.recorded,false);assert.equal(result.inspection.complete,true);assert.equal(result.inspection.manifestSha256,null);
  assert.equal(result.project.executionAdapter,null);await assert.rejects(fs.stat(path.join(f.directory,'backend-project.json')),{code:'ENOENT'});
  await assert.rejects(clean(f),changed);
  const b=await backendProjectFixture(t,{backend:'bevy',recorded:false,legacy:true});await assert.rejects(inspectBackendProject({buildDirectory:b.directory}),changed);
});

test('manifest tampering or a forged source-map is rejected even when a valid generation remains on disk', async t => {
  for(const target of ['manifest','source-map']) {
    const f=await backendProjectFixture(t), file=path.join(f.directory,target==='manifest'?'backend-project.json':'source-map.json');
    const value=JSON.parse(await fs.readFile(file));if(target==='manifest')value.tool.sha256='f'.repeat(64);else value.objects[0].sourcePath='documents/forged.json';
    await fs.writeFile(file,json(value));await assert.rejects(inspect(f),changed);await assert.rejects(clean(f),changed);
  }
});

test('exact evidence bytes detect metadata whitespace unknown members or identity changes independently of semantic JSON equality', async t => {
  for(const name of ['build.json','snapshot.json','source-map.json']) {
    const f=await backendProjectFixture(t);await fs.appendFile(path.join(f.directory,name),' ');
    await assert.rejects(inspect(f),changed);await assert.rejects(clean(f),changed);
  }
  const f=await backendProjectFixture(t), record=structuredClone(f.build);record.keepUserData='do not discard';await fs.writeFile(path.join(f.directory,'build.json'),json(record));
  await assert.rejects(clean(f),changed);
});

test('every generated file and copied resource is verified rather than trusting inventory hashes alone', async t => {
  for(const role of ['generated','resource-copy']) {
    const f=await backendProjectFixture(t), file=f.project.files.find(file=>file.role===role), target=path.join(f.directory,file.path);
    await fs.appendFile(target,' ');await assert.rejects(inspect(f),changed);await assert.rejects(clean(f),changed);
  }
  const f=await backendProjectFixture(t);await fs.rm(path.join(f.directory,f.project.project.entry));await assert.rejects(inspect(f),changed);
});

test('foreign backend build snapshot and manifest pins cannot authorize a different managed project', async t => {
  const f=await backendProjectFixture(t);
  for(const pins of [{expectedBuildId:'00000000-1111-4111-8111-111111111111'},{expectedSnapshotId:`sha256:${'f'.repeat(64)}`},{expectedManifestSha256:'f'.repeat(64)}]) {
    await assert.rejects(inspectBackendProject({buildDirectory:f.directory,...f.pins,...pins}),changed);
  }
  await assert.rejects(inspectBackendProject({buildDirectory:f.directory,backendId:'org.viento.bevy'}),changed);
  for(const omitted of ['expectedBuildId','expectedManifestSha256']) {const pins={...f.pins};delete pins[omitted];await assert.rejects(inspectBackendProjectForCleanup({buildDirectory:f.directory,...pins}),changed);}
});

test('extra files empty directories symlinks and runtime sessions report incomplete inventory and remain untouched', async t => {
  const f=await backendProjectFixture(t), outside=path.join(f.temporary,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.txt'),'keep');
  await fs.writeFile(path.join(f.directory,'project','user-note.txt'),'keep');await fs.mkdir(path.join(f.directory,'empty'));
  await fs.mkdir(path.join(f.directory,'sessions'));await fs.writeFile(path.join(f.directory,'sessions','session.json'),'keep');
  await fs.symlink(outside,path.join(f.directory,'extra-link'),'dir');const result=await inspect(f);
  assert.equal(result.inspection.complete,false);assert.deepEqual(result.inspection.extraPaths,[{path:'empty',kind:'directory'},{path:'extra-link',kind:'symlink'},{path:'project/user-note.txt',kind:'file'},{path:'sessions',kind:'directory'}]);
  assert.deepEqual((await clean(f)).inspection,result.inspection);assert.equal(await fs.readFile(path.join(outside,'private.txt'),'utf8'),'keep');
});

test('links replacing a known root directory file metadata or ancestor cannot redirect project reads', async t => {
  for(const target of ['root','file','metadata','ancestor']) {
    const f=await backendProjectFixture(t), outside=path.join(f.temporary,'outside');await fs.mkdir(outside);
    let linked;
    if(target==='root') {linked=f.directory;await fs.rename(linked,path.join(f.temporary,'original'));await fs.symlink(path.join(f.temporary,'original'),linked,'dir');}
    else if(target==='file'||target==='metadata') {linked=path.join(f.directory,target==='file'?f.project.project.entry:'build.json');await fs.copyFile(linked,path.join(outside,'copy'));await fs.rm(linked);await fs.symlink(path.join(outside,'copy'),linked);}
    else {linked=path.join(f.directory,'project/images');await fs.rename(linked,path.join(outside,'images'));await fs.symlink(path.join(outside,'images'),linked,'dir');}
    await assert.rejects(inspect(f),changed);
  }
});

test('inspection detects source-map or manifest replacement during asynchronous generation', async t => {
  const f=await backendProjectFixture(t);let entered,release;const entry=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  const registry=createExecutionBackendRegistry([{...f.adapter,async generate(plan){entered();await wait;return f.adapter.generate(plan);}}]);
  const pending=inspectBackendProject({buildDirectory:f.directory,backendRegistry:registry,...f.pins});await entry;
  await fs.appendFile(path.join(f.directory,'source-map.json'),' ');release();await assert.rejects(pending,changed);
});

test('unknown directory contents are never enumerated and known ancestors replaced by links are rejected before recursion', async t => {
  const f=await backendProjectFixture(t), unknown=path.join(f.directory,'unowned');await fs.mkdir(unknown);
  const originalRead=fs.readdir;let unknownReads=0;
  fs.readdir=async(file,...args)=>{if(path.resolve(file)===unknown)unknownReads++;return originalRead.call(fs,file,...args);};
  try{assert.equal((await inspect(f)).inspection.complete,false);assert.equal(unknownReads,0);}finally{fs.readdir=originalRead;}
  const g=await backendProjectFixture(t), ancestor=path.join(g.directory,'project/images'), outside=path.join(g.temporary,'outside-images');
  const originalStat=fs.lstat;let replaced=false;
  fs.lstat=async(file,...args)=>{const stat=await originalStat.call(fs,file,...args);if(path.resolve(file)===ancestor&&!replaced){replaced=true;await fs.rename(ancestor,outside);await fs.symlink(outside,ancestor,'dir');}return stat;};
  try{await assert.rejects(inspect(g),changed);assert.equal(replaced,true);}finally{fs.lstat=originalStat;}
});

test('cleanup verification remains valid after adapter changes while ordinary inspection requires rebuilding', async t => {
  const f=await backendProjectFixture(t), registry=createExecutionBackendRegistry([{...f.adapter,async fingerprint(){return{id:f.adapter.descriptor.id,contractVersion:1,sha256:'f'.repeat(64)};}}]);
  await assert.rejects(inspectBackendProject({buildDirectory:f.directory,backendRegistry:registry,...f.pins}),changed);
  const result=await clean(f);assert.equal(result.inspection.complete,true);assert.equal(result.project.executionAdapter.sha256,f.project.executionAdapter.sha256);
});

test('manifest factory refuses invented inventory resource ownership and final metadata size overruns', async t => {
  const f=await backendProjectFixture(t);
  for(const change of [build=>{build.artifact.files[0].path='../author';},build=>{build.artifact.files[0].sha256='f'.repeat(64);},build=>{build.artifact.files.push(build.artifact.files[0]);},build=>{build.artifact.entry='project/not-generated';}]) {
    const build=structuredClone(f.build);change(build);assert.throws(()=>createBackendProjectManifest({...f,build}),{errorCode:'backend_project_invalid'});
  }
  const evidenceBytes=new Map([['build.json',Buffer.alloc(4*1024*1024+1)]]);assert.throws(()=>createBackendProjectManifest({...f,evidenceBytes}),{errorCode:'backend_project_invalid'});
});

test('pre-aborted inspection reads no project files and creates no records directories or sessions', async t => {
  const f=await backendProjectFixture(t), before=await fs.readdir(f.directory), controller=new AbortController();controller.abort();
  await assert.rejects(inspectBackendProject({buildDirectory:f.directory,signal:controller.signal}));assert.deepEqual(await fs.readdir(f.directory),before);
  assert.equal((await inspect(f)).inspection.manifestSha256,buildHash(await fs.readFile(path.join(f.directory,'backend-project.json'))));
});
