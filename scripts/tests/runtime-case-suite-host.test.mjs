import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { savedSuite,fixture,inventory,service,builtService,settled,registry,gate,phaseResult,sceneId,backendId,fakeTool,unknown,build } from './runtime-case-suite-fixture.mjs';
import { createRuntimeCaseSuiteDocumentService,captureRuntimeCaseSuite } from '../lib/runtime-case-suites.mjs';
import { readFrozenProjectBuild } from '../adapters/node-project-build.mjs';
import { executeRuntimeCaseSuite } from '../adapters/node-runtime-case-suite.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
const request=(built,group)=>({action:'suite-run',buildId:built.latestBuild.id,suiteDocumentId:group.id,expectedVersion:group.version});

test('suite author writer preserves exact source and ordinary registration identity without metadata member mirrors',async t=>{
  const h=await fixture(t),before=await inventory(h.root),s=await savedSuite(h);
  const loaded=await s.groups.load(s.group.id),catalog=await s.groups.list(sceneId);
  assert.equal(loaded.content,s.content);assert.deepEqual(loaded.definition,s.definition);assert.equal(loaded.valid,true);
  assert.equal(catalog.documents.length,1);assert.equal(catalog.cases.length,2);
  const record=JSON.parse(await fs.readFile(path.join(h.root,`metadata/documents/${s.group.id}.json`)));assert.deepEqual(record.relations,[]);
  const after=await inventory(h.root);for(const[file,sha]of Object.entries(before))assert.equal(after[file],sha,file);
  assert.equal(Object.keys(after).length,Object.keys(before).length+6);
});

test('suite update conflicts preserve both source bytes and source revision; invalid create leaves no registration',async t=>{
  const h=await fixture(t),s=await savedSuite(h),before=await inventory(h.root);
  await fs.writeFile(path.join(h.root,s.group.path),s.content+' ');
  await assert.rejects(s.groups.save({sceneId,sceneVersion:s.group.sceneVersion,documentId:s.group.id,expectedVersion:s.group.version,content:s.content}),e=>e.errorCode==='runtime_suite_document_conflict');
  const catalog=await s.groups.list(sceneId);
  await assert.rejects(s.groups.save({sceneId,sceneVersion:catalog.sceneVersion,sourcePath:'documents/invalid.json',documentType:catalog.defaults.documentType,
    content:JSON.stringify({...s.definition,documentIds:[unknown]})}));
  const after=await inventory(h.root);assert.deepEqual(Object.keys(after),Object.keys(before));assert.equal((await s.groups.load(s.group.id)).content,s.content+' ');
});

test('suite publication rechecks dependencies and rolls back only its own new registration',async t=>{
  const h=await fixture(t),s=await savedSuite(h),before=await inventory(h.root);
  const groups=createRuntimeCaseSuiteDocumentService(h.root,{beforePublish:()=>fs.writeFile(path.join(h.root,s.members[0].path),'{}')});
  const catalog=await groups.list(sceneId);
  await assert.rejects(groups.save({sceneId,sceneVersion:catalog.sceneVersion,sourcePath:'documents/rejected.json',documentType:catalog.defaults.documentType,content:s.content}));
  assert.deepEqual(Object.keys(await inventory(h.root)),Object.keys(before));assert.equal(await fs.readFile(path.join(h.root,s.members[0].path),'utf8'),'{}');
});

test('batch continues after assertion failure, executes declared order and keeps author bytes and the owned build intact',async t=>{
  const h=await fixture(t),s=await savedSuite(h,{firstFails:true}),value=service(t,h),built=await builtService(value),before=await inventory(h.root);
  await value.command(request(built,s.group));const state=await settled(value);
  assert.equal(state.job.kind,'suite');assert.equal(state.job.status,'succeeded');assert.equal(state.job.suite.summary.status,'failed');
  assert.deepEqual(state.job.suite.entries.map(row=>row.state),['failed','passed']);assert.deepEqual(state.job.suite.entries.map(row=>row.documentId),s.definition.documentIds);
  assert.equal(new Set(state.job.suite.entries.map(row=>row.sessionId)).size,2);assert.equal(state.job.suite.summary.complete,true);
  assert.deepEqual(state.latestBuild,built.latestBuild);assert.deepEqual(await inventory(h.root),before);
  const inspected=await value.command({action:'inspect',jobId:state.job.id});assert.equal(inspected.actors.length,2);
  state.job.suite.entries.length=0;assert.equal((await value.status()).job.suite.entries.length,2);
});

test('all members are preflighted before allocating a job, even when only the final member is invalid',async t=>{
  const h=await fixture(t),s=await savedSuite(h),value=service(t,h),built=await builtService(value);
  const content=JSON.parse(s.members[1].content.replace(/^\uFEFF/,''));content.case.checks[0].instanceId=unknown;
  await fs.writeFile(path.join(h.root,s.members[1].path),JSON.stringify(content));
  const before=await inventory(h.cacheRoot);
  await assert.rejects(value.command(request(built,s.group)));
  assert.equal((await value.status()).job.id,built.job.id);assert.deepEqual(await inventory(h.cacheRoot),before);
});

test('stale group revision, forbidden HTTP options and another frozen scene are refused without replacing the job',async t=>{
  const h=await fixture(t),s=await savedSuite(h),value=service(t,h),built=await builtService(value);
  for(const patch of[{force:true},{tool:'/tmp/untrusted'},{mode:'window'},{suiteDocumentId:unknown},{expectedVersion:'sha256:'+'a'.repeat(64)}]) {
    await assert.rejects(value.command({...request(built,s.group),...patch}));assert.equal((await value.status()).job.id,built.job.id);
  }
  // Source inspection cannot adopt a foreign build merely because instance IDs match.
  const plan={format:'viento-build-plan',schemaVersion:2,kind:'scene2d',scene:{objectId:unknown,sourcePath:'documents/foreign.json'},actors:[
    {objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'},
    {objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'}]};
  await assert.rejects(captureRuntimeCaseSuite(h.root,{documentId:s.group.id,plan}),e=>e.errorCode==='runtime_suite_scene_mismatch');
  assert.equal((await value.status()).job.id,built.job.id);
});

test('members are frozen once at admission; later author edits and source-offline transition cannot change an active batch',async t=>{
  const h=await fixture(t),s=await savedSuite(h),started=gate(),release=gate();let runs=0;
  const value=service(t,h,{backendRegistry:registry({async execute(c){runs++;if(runs===1){started.resolve();await release.promise;}
    c.ready();c.controlProgram.steps.forEach((_,index)=>c.sample(index));c.finished();c.flush();return phaseResult('run');}})}),built=await builtService(value);
  await value.command(request(built,s.group));await started.promise;
  await fs.writeFile(path.join(h.root,s.members[1].path),'{}');await fs.rename(h.root,h.root+'-offline');release.resolve();
  const state=await settled(value);assert.equal(runs,2);assert.equal(state.job.suite.summary.status,'passed');
  assert.equal(state.job.suite.entries[1].sourceVersion,s.members[1].version);
  await assert.rejects(value.command(request(built,s.group)));assert.equal((await value.status()).job.id,state.job.id);
  await fs.rename(h.root+'-offline',h.root);
});

test('cancel retains sampled incomplete member, does not launch queued members and waits for process reaping',async t=>{
  const h=await fixture(t),s=await savedSuite(h),started=gate(),reaped=gate();let runs=0;
  const value=service(t,h,{backendRegistry:registry({async execute(c){runs++;c.ready();c.sample(0);c.flush();started.resolve();
    await new Promise(resolve=>c.signal.addEventListener('abort',resolve,{once:true}));await reaped.promise;return phaseResult('run','cancelled');}})}),built=await builtService(value);
  await value.command(request(built,s.group));await started.promise;const running=await value.status();
  await value.command({action:'cancel',jobId:running.job.id});await assert.rejects(value.command(request(built,s.group)),e=>e.errorCode==='build_busy');
  assert.equal((await value.status()).job.status,'running');reaped.resolve();const state=await settled(value);
  assert.equal(runs,1);assert.equal(state.job.status,'cancelled');assert.deepEqual(state.job.suite.entries.map(row=>row.state),['incomplete','not-run']);
  assert.equal(state.job.control.samples.length,1);assert.equal(state.job.suite.summary.complete,false);
});

test('execution/protocol failure stops queued members while preserving their explicit not-run state',async t=>{
  const h=await fixture(t),s=await savedSuite(h);let runs=0;
  const value=service(t,h,{backendRegistry:registry({async execute(){runs++;return phaseResult('run','failed');}})}),built=await builtService(value);
  await value.command(request(built,s.group));const state=await settled(value);
  assert.equal(runs,1);assert.equal(state.job.status,'failed');assert.equal(state.job.suite.summary.status,'incomplete');
  assert.deepEqual(state.job.suite.entries.map(row=>row.state),['incomplete','not-run']);
});

test('trusted batch wall budget aborts and reaps the current session, then persists a bounded receipt outside author data',async t=>{
  const h=await fixture(t),s=await savedSuite(h),reg=await build(h,registry({async execute(c){
    c.ready();c.sample(0);c.flush();await new Promise(resolve=>{if(c.signal.aborted)resolve();else c.signal.addEventListener('abort',resolve,{once:true});});return phaseResult('run','cancelled');}}));
  const frozen=await readFrozenProjectBuild(h.output,{backendId,backendRegistry:reg}),capture=await captureRuntimeCaseSuite(h.root,{documentId:s.group.id,plan:frozen.plan});
  const result=await executeRuntimeCaseSuite({capture,plan:frozen.plan,authorRoot:h.root,buildDirectory:h.output,buildId:frozen.build.buildId,snapshotId:frozen.build.snapshotId,
    tool:fakeTool.executable,backendId,backendRegistry:reg,cacheRoot:h.cacheRoot,timeoutMs:100});
  assert.equal(result.status,'timeout');assert.equal(result.ok,false);assert.deepEqual(result.record.suite.entries.map(row=>row.state),['incomplete','not-run']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.receiptDirectory,'suite.json'))),result.record);
});

test('successful batch receipts pin the build/snapshot and reject a replaced frozen build before a later session',async t=>{
  const h=await fixture(t),s=await savedSuite(h);let runs=0;const reg=await build(h,registry({async execute(c){runs++;
    c.ready();c.controlProgram.steps.forEach((_,index)=>c.sample(index));c.finished();c.flush();
    if(runs===1){const file=path.join(h.output,'build.json'),record=JSON.parse(await fs.readFile(file));record.buildId=unknown;await fs.writeFile(file,JSON.stringify(record));}
    return phaseResult('run');}}));
  const frozen=await readFrozenProjectBuild(h.output,{backendId,backendRegistry:reg}),capture=await captureRuntimeCaseSuite(h.root,{documentId:s.group.id,plan:frozen.plan});
  const result=await executeRuntimeCaseSuite({capture,plan:frozen.plan,authorRoot:h.root,buildDirectory:h.output,buildId:frozen.build.buildId,snapshotId:frozen.build.snapshotId,
    tool:fakeTool.executable,backendId,backendRegistry:reg,cacheRoot:h.cacheRoot});
  assert.equal(runs,1);assert.equal(result.status,'failed');assert.deepEqual(result.record.suite.entries.map(row=>row.state),['passed','incomplete']);
  assert.equal(result.record.suite.entries[1].sessionId,null);assert.equal(result.record.buildId,frozen.build.buildId);
});

test('CLI suite mode rejects incompatible flags before opening source or build; normal offline run modes stay separate',async t=>{
  const h=await fixture(t),base=['--command','run','--root',h.root,'--build',path.join(h.base,'absent'),'--runtime-suite',unknown];
  for(const flags of[['--window'],['--interactive'],['--capture'],['--runtime-case','absent.json'],['--control-program','absent.json'],['--timeout-ms','30001']]) {
    await assert.rejects(runProjectBuildCommand([...base,...flags]),e=>['runtime_suite_unsupported','runtime_suite_limit'].includes(e.errorCode));
  }
});

test('simultaneous batches cannot both acquire the execution slot while a member is running',async t=>{
  const h=await fixture(t),s=await savedSuite(h),started=gate(),release=gate();
  const value=service(t,h,{backendRegistry:registry({async execute(c){started.resolve();await release.promise;
    c.ready();c.controlProgram.steps.forEach((_,i)=>c.sample(i));c.finished();c.flush();return phaseResult('run');}})}),built=await builtService(value);
  const attempts=await Promise.allSettled([value.command(request(built,s.group)),value.command(request(built,s.group))]);
  assert.equal(attempts.filter(row=>row.status==='fulfilled').length,1);assert.equal(attempts.find(row=>row.status==='rejected').reason.errorCode,'build_busy');
  await started.promise;release.resolve();assert.equal((await settled(value)).job.suite.summary.status,'passed');
});

test('closing the service aborts a batch and awaits the executing member before admitting no further work',async t=>{
  const h=await fixture(t),s=await savedSuite(h),started=gate(),reaped=gate();let runs=0;
  const value=service(t,h,{backendRegistry:registry({async execute(c){runs++;started.resolve();await new Promise(resolve=>c.signal.addEventListener('abort',resolve,{once:true}));
    await reaped.promise;return phaseResult('run','cancelled');}})}),built=await builtService(value);
  await value.command(request(built,s.group));await started.promise;let closed=false;const pending=value.close().then(()=>{closed=true;});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,false);reaped.resolve();await pending;assert.equal(runs,1);
  await assert.rejects(value.command(request(built,s.group)),e=>e.errorCode==='build_service_closed');
});

test('suite executor detaches all member definitions and plan targets before awaiting cache or engine work',async t=>{
  const h=await fixture(t),s=await savedSuite(h),reg=await build(h),frozen=await readFrozenProjectBuild(h.output,{backendId,backendRegistry:reg});
  const capture=JSON.parse(JSON.stringify(await captureRuntimeCaseSuite(h.root,{documentId:s.group.id,plan:frozen.plan}))),plan=JSON.parse(JSON.stringify(frozen.plan));
  const pending=executeRuntimeCaseSuite({capture,plan,authorRoot:h.root,buildDirectory:h.output,buildId:frozen.build.buildId,snapshotId:frozen.build.snapshotId,
    tool:fakeTool.executable,backendId,backendRegistry:reg,cacheRoot:h.cacheRoot});
  capture.cases[1].document.case.checks[0].instanceId=unknown;capture.definition.documentIds.length=0;plan.scene.objectId=unknown;plan.actors.length=0;
  const result=await pending;assert.equal(result.ok,true);assert.equal(result.record.suite.summary.passed,2);
});

test('misconfigured suite receipt cache inside author roots is refused before source writes or sessions',async t=>{
  const h=await fixture(t),s=await savedSuite(h),reg=await build(h),frozen=await readFrozenProjectBuild(h.output,{backendId,backendRegistry:reg});
  const capture=await captureRuntimeCaseSuite(h.root,{documentId:s.group.id,plan:frozen.plan}),before=await inventory(h.root);
  const result=await executeRuntimeCaseSuite({capture,plan:frozen.plan,authorRoot:h.root,buildDirectory:h.output,buildId:frozen.build.buildId,snapshotId:frozen.build.snapshotId,
    tool:fakeTool.executable,backendId,backendRegistry:reg,cacheRoot:path.join(h.root,'generated')});
  assert.equal(result.ok,false);assert.equal(result.record.diagnostics[0].code,'build_output_in_source');assert.deepEqual(await inventory(h.root),before);
  assert.ok(result.record.suite.entries.every(row=>row.state==='not-run'&&row.sessionId===null));
});

test('a build pruned during suite source admission cannot acquire a job or allocate a receipt or session',async t=>{
  const h=await fixture(t),s=await savedSuite(h),value=service(t,h),built=await builtService(value);
  const originalCache=await inventory(h.cacheRoot),oldBuildFile=Object.keys(originalCache).find(file=>file.endsWith('/build.json'));
  assert.ok(oldBuildFile);
  const oldDirectory=path.dirname(path.join(h.cacheRoot,oldBuildFile)),sourceFile=path.join(h.root,s.group.path);
  const entered=gate(),release=gate(),readFile=fs.readFile;
  let armed=true,pending;
  fs.readFile=async function(file,...options){
    if(armed&&String(file)===sourceFile){armed=false;entered.resolve();await release.promise;}
    return readFile.call(this,file,...options);
  };
  try {
    pending=value.command(request(built,s.group));
    // Attach immediately so a rejected admission cannot become unhandled while
    // the test deliberately performs independent rebuilds through the same slot.
    const rejected=assert.rejects(pending,error=>error.errorCode==='build_artifact_missing'&&error.statusCode===404);
    await entered.promise;
    const replacements=[];
    for(let index=0;index<3;index++)replacements.push(await builtService(value));
    assert.equal(new Set([built,...replacements].map(state=>state.latestBuild.id)).size,4);
    await assert.rejects(fs.stat(oldDirectory),{code:'ENOENT'});
    const latest=replacements.at(-1),before=await inventory(h.cacheRoot);
    release.resolve();await rejected;
    const after=await value.status();
    assert.equal(after.job.id,latest.job.id);assert.equal(after.job.kind,'build');
    assert.deepEqual(after.latestBuild,latest.latestBuild);
    assert.deepEqual(await inventory(h.cacheRoot),before);
    await assert.rejects(fs.stat(path.join(h.cacheRoot,'suites')),{code:'ENOENT'});
    assert.ok(!Object.keys(before).some(file=>file.includes('/sessions/')));
  } finally {
    fs.readFile=readFile;release.resolve();
    if(pending)await pending.catch(()=>{});
  }
});
