import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateBackendProjectManifest, summarizeBackendProject } from '../../engine/backend-project.mjs';
import { projectAssemblyBuildFixture } from './helpers/project-assembly-backend-fixture.mjs';
import { createBackendProjectDeliveryReview } from '../../engine/backend-project-delivery.mjs';
import { backendProjectFixture } from './helpers/backend-project-fixture.mjs';
const invalid = { errorCode: 'backend_project_invalid' };

test('portable manifest describes the shared provenance contract for both backends and Godot author scripts', async t => {
  for (const options of [{ backend: 'godot', version: 1 }, { backend: 'godot', version: 2 }, { backend: 'bevy', version: 1 }, { backend: 'bevy', version: 2 }, { behaviors: true }]) {
    const f = await backendProjectFixture(t, options), project = validateBackendProjectManifest(f.project);
    assert.deepEqual(project, f.project); assert.equal(project.source.sceneId, f.captured.plan.scene.objectId);
    assert.equal(project.backend.id, f.adapter.descriptor.id); assert.equal(project.source.planSchemaVersion, f.captured.plan.schemaVersion);
    assert.deepEqual(project.files.map(file => file.path), [...project.files.map(file => file.path)].sort());
    assert.equal(project.dependencies.length, f.snapshot.source.documents.length);
    assert.equal(project.files.filter(file => file.role === 'resource-copy').length, project.resources.length);
    assert.equal(project.files.some(file => file.role === 'author-source-copy'), Boolean(options.behaviors));
    assert.equal(project.dependencies.some(file => file.role === 'behavior-source'), Boolean(options.behaviors));
    assert.equal(Object.isFrozen(project), true); assert.equal(Object.isFrozen(project.files[0]), true);
  }
});

test('summary reports only manifest identity inventory counts and output bytes without tool paths or author bodies', async t => {
  const f = await backendProjectFixture(t), summary = summarizeBackendProject(f.project);
  assert.deepEqual(summary, { buildId:f.build.buildId,snapshotId:f.build.snapshotId,backendId:f.build.backend.id,sceneId:f.captured.plan.scene.objectId,
    sourcePath:f.captured.plan.scene.sourcePath,kind:f.build.artifact.kind,entry:f.build.artifact.entry,fileCount:f.build.artifact.files.length,
    resourceCount:f.captured.plan.resources.length,dependencyCount:f.snapshot.source.documents.length,totalBytes:f.build.artifact.files.reduce((sum,file)=>sum+file.size,0) });
  assert.equal(JSON.stringify(f.project).includes(f.author),false); assert.equal(JSON.stringify(f.project).includes('extends Node'),false);
});

test('manifest validation snapshots without reading accessors executing serializers or accepting sparse/prototyped data', async t => {
  const f=await backendProjectFixture(t), source=structuredClone(f.project), accepted=validateBackendProjectManifest(source);
  source.files[0].path='project/changed';assert.notEqual(accepted.files[0].path,source.files[0].path);
  let reads=0;const getter=structuredClone(f.project);Object.defineProperty(getter.source,'sceneId',{enumerable:true,get(){reads++;return f.project.source.sceneId;}});
  assert.throws(()=>validateBackendProjectManifest(getter),invalid);assert.equal(reads,0);
  const serializer=structuredClone(f.project);serializer.toJSON=()=>{reads++;return f.project;};assert.throws(()=>validateBackendProjectManifest(serializer),invalid);assert.equal(reads,0);
  const sparse=structuredClone(f.project);delete sparse.files[0];assert.throws(()=>validateBackendProjectManifest(sparse),invalid);
  const inherited=Object.create(f.project);assert.throws(()=>validateBackendProjectManifest(inherited),invalid);
});

test('output authority rejects unsafe paths missing entries duplicates prefix collisions and extra schema fields', async t => {
  const f=await backendProjectFixture(t);
  for(const change of [p=>{p.extra=true;},p=>{p.schemaVersion=2;},p=>{p.project.root='../author';},p=>{p.project.entry='project/missing';},
    p=>{p.files[0].path='../author';},p=>{p.files[0].path='project/../author';},p=>{p.files[0].path='project/colon:name';},p=>{p.files[0].path='project/line\nbreak';},
    p=>{p.files.push(structuredClone(p.files[0]));},p=>{p.files.reverse();},p=>{p.files[0].size=-1;},p=>{p.files[0].sha256='bad';},p=>{p.files[0].extra=1;}]) {
    const p=structuredClone(f.project);change(p);assert.throws(()=>validateBackendProjectManifest(p),invalid);
  }
  const p=structuredClone(f.project);p.files.push({...p.files[0],path:p.files[0].path+'/nested'});p.files.sort((a,b)=>a.path<b.path?-1:1);assert.throws(()=>validateBackendProjectManifest(p),invalid);
});

test('resource-copy and author-source-copy inventories require exact ownership and hash/size agreement', async t => {
  const f=await backendProjectFixture(t), b=await backendProjectFixture(t,{behaviors:true});
  for(const change of [p=>{p.resources[0].resourceId=p.source.sceneId;},p=>{p.resources[0].size++;},p=>{p.resources[0].generatedPath='project/missing';},
    p=>{p.files.find(x=>x.role==='resource-copy').role='generated';},p=>{p.files.find(x=>x.role==='resource-copy').resourceId=null;},p=>{p.resources=[];}]) {
    const p=structuredClone(f.project);change(p);assert.throws(()=>validateBackendProjectManifest(p),invalid);
  }
  const p=structuredClone(b.project);p.files.find(x=>x.role==='author-source-copy').sourceObjectId=p.source.sceneId;assert.throws(()=>validateBackendProjectManifest(p),invalid);
});

test('source inventory keeps existing Linux source names distinct from generated-file path rules', async t => {
  const f=await backendProjectFixture(t), p=structuredClone(f.project), scene=p.dependencies.find(d=>d.role==='scene');
  p.source.sourcePath=scene.sourcePath='documents/ legacy:scene\nname.json ';p.resources[0].sourcePath='images/.old:cover\n.svg';
  p.dependencies.sort((a,b)=>a.sourcePath<b.sourcePath?-1:1);assert.deepEqual(validateBackendProjectManifest(p).source.sourcePath,p.source.sourcePath);
  p.files[0].path='project/ legacy:scene\nname.json ';assert.throws(()=>validateBackendProjectManifest(p),invalid);
});

test('frozen source identities evidence paths and lifecycle claims cannot be forged within the pure DTO', async t => {
  const f=await backendProjectFixture(t);
  for(const change of [p=>{p.source.sceneId=p.buildId;},p=>{p.dependencies.find(d=>d.role==='scene').sourceRevision=null;},p=>{p.dependencies.push(structuredClone(p.dependencies[0]));},
    p=>{p.evidence.reverse();},p=>{p.evidence[0].path='../build.json';},p=>{p.evidence[1].size=80*1024*1024+1;},p=>{p.lifecycle.generatedProject='author-editable';},
    p=>{p.tool.executable='/usr/bin/fake';},p=>{p.executionAdapter.id='org.viento.other';},p=>{p.source.sourcePath='../scene.json';}]) {
    const p=structuredClone(f.project);change(p);assert.throws(()=>validateBackendProjectManifest(p),invalid);
  }
});

test('legacy adapter-null provenance is data while oversized arrays and invalid Unicode cannot evade budgets', async t => {
  const f=await backendProjectFixture(t,{legacy:true});assert.equal(validateBackendProjectManifest(f.project).executionAdapter,null);
  for(const change of [p=>{p.dependencies=new Array(8193).fill(p.dependencies[0]);},p=>{p.source.workspaceId='\ud800';},p=>{p.backend.sha256='f'.repeat(65);},
    p=>{p.tool.version='x'.repeat(257);},p=>{p.files[0].size=32*1024*1024+1;}]) {const p=structuredClone(f.project);change(p);assert.throws(()=>validateBackendProjectManifest(p),invalid);}
});

test('portable validation executes without Node filesystem process or backend implementations', async t => {
  const f=await backendProjectFixture(t), source=await fs.readFile(new URL('../../engine/backend-project.mjs',import.meta.url),'utf8');
  const context=vm.createContext({TextEncoder});vm.runInContext(source.replaceAll('export ',''),context);context.payload=JSON.stringify(f.project);
  const summary=vm.runInContext('summarizeBackendProject(JSON.parse(payload))',context);assert.equal(summary.buildId,f.build.buildId);
});

test('the readable published manifest must fit its byte budget even when compact JSON would fit', async t => {
  const f=await backendProjectFixture(t), p=structuredClone(f.project), scene=p.dependencies.find(item=>item.role==='scene');
  p.dependencies=[scene,...Array.from({length:6999},(_,index)=>({objectId:null,sourcePath:`documents/${String(index).padStart(7,'0')}-${'x'.repeat(470)}`,
    sourceRevision:null,role:'author-document'}))].sort((a,b)=>a.sourcePath<b.sourcePath?-1:1);
  assert.ok(Buffer.byteLength(JSON.stringify(p))<4*1024*1024);assert.ok(Buffer.byteLength(JSON.stringify(p,null,2)+'\n')>4*1024*1024);
  assert.throws(()=>validateBackendProjectManifest(p),invalid);
});


for (const protocolVersion of [9, 10]) test(`protocol ${protocolVersion} assembly manifests and delivery reviews admit 1024 generated files plus 128 resources`, async t => {
  const f = await projectAssemblyBuildFixture(t), p = structuredClone(f.project);
  p.backend.protocolVersion = protocolVersion; p.backend.version = protocolVersion === 9 ? '0.18.0' : '0.19.0';
  const digest = 'a'.repeat(64);
  p.files = [{ path: p.project.entry, size: 1, sha256: digest, role: 'generated', resourceId: null, sourceObjectId: null },
    ...Array.from({ length: 1023 }, (_, index) => ({ path: `project/wrappers/${index}.gd`, size: 1, sha256: digest,
      role: 'generated', resourceId: null, sourceObjectId: null }))];
  p.resources = Array.from({ length: 128 }, (_, index) => ({ resourceId: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sourcePath: `assets/${index}.png`, generatedPath: `project/assets/${String(index).padStart(3, '0')}.png`, size: 1, sha256: digest }));
  p.files.push(...p.resources.map(resource => ({ path: resource.generatedPath, size: resource.size, sha256: resource.sha256,
    role: 'resource-copy', resourceId: resource.resourceId, sourceObjectId: null })));
  p.files.sort((a, b) => a.path < b.path ? -1 : 1);
  assert.equal(validateBackendProjectManifest(p).files.length, 1152);
  assert.equal(createBackendProjectDeliveryReview(p, digest).project.files.length, 1152);
  for (const mutate of [
    next => { next.files.push({ ...next.files[0], path: 'project/zz-overflow.gd', role: 'generated', resourceId: null }); },
    next => { const file = next.files.find(file => file.role === 'resource-copy');
      next.resources = next.resources.filter(resource => resource.resourceId !== file.resourceId); file.role = 'generated'; file.resourceId = null; },
    next => { next.backend.protocolVersion = 8; },
    next => { next.backend.id = next.executionAdapter.id = 'org.viento.bevy'; },
    next => { next.project.kind = 'other-project'; },
  ]) {
    const next = structuredClone(p); mutate(next);
    assert.throws(() => validateBackendProjectManifest(next), invalid);
    assert.throws(() => createBackendProjectDeliveryReview(next, digest), { errorCode: 'backend_project_delivery_invalid' });
  }
  const standalone = structuredClone((await backendProjectFixture(t)).project);
  standalone.backend.protocolVersion = protocolVersion;
  standalone.files = p.files.filter(file => file.role === 'generated').slice(0, 641);
  standalone.resources = [];
  assert.ok(standalone.files.some(file => file.path === standalone.project.entry));
  assert.throws(() => validateBackendProjectManifest(standalone), invalid);
  const legacy = structuredClone(p); legacy.backend.protocolVersion = 8; legacy.resources = [];
  legacy.files = p.files.filter(file => file.role === 'generated').slice(0, 640);
  assert.equal(validateBackendProjectManifest(legacy).files.length, 640);
  legacy.files.push({ ...legacy.files[0], path: 'project/zz-overflow.gd' });
  assert.throws(() => validateBackendProjectManifest(legacy), invalid);
});
