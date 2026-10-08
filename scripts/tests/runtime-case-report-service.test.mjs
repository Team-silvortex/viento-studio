import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { savedSuite,fixture,inventory,service,builtService,settled,registry,gate,phaseResult,sceneId,backendId,fakeTool,unknown,build } from './runtime-case-suite-fixture.mjs';
import { captureRuntimeCaseSuite } from '../lib/runtime-case-suites.mjs';
import { readFrozenProjectBuild } from '../adapters/node-project-build.mjs';
import { executeRuntimeCaseSuite } from '../adapters/node-runtime-case-suite.mjs';
import { validateRuntimeCaseReport } from '../../engine/runtime-case-report.mjs';
const run=(built,group)=>({action:'suite-run',buildId:built.latestBuild.id,suiteDocumentId:group.id,expectedVersion:group.version});
const read=(job,documentId)=>({action:'suite-report',jobId:job.id,documentId});
const reportFiles=async root=>Object.keys(await inventory(root)).filter(file=>/\/member-[a-f0-9-]+\.json$/.test(file));

test('member details retain the first failed assertions independently of the last passing session and expose no host pins',async t=>{
  const h=await fixture(t),saved=await savedSuite(h,{firstFails:true}),value=service(t,h),built=await builtService(value),before=await inventory(h.root);
  await value.command(run(built,saved.group));const state=await settled(value),job=state.job;
  assert.deepEqual(job.suite.entries.map(row=>row.reportAvailable),[true,true]);
  const first=await value.command(read(job,saved.members[0].id)),last=await value.command(read(job,saved.members[1].id));
  assert.equal(first.evaluation.status,'failed');assert.equal(first.evaluation.checks[0].positionPassed,false);
  assert.deepEqual(first.evaluation.checks[0].actual.position,[220,220]);assert.deepEqual(first.evaluation.checks[0].expected.position.value,[221,220]);
  assert.equal(last.evaluation.status,'passed');assert.notEqual(first.context.sessionId,last.context.sessionId);
  assert.equal(first.context.buildId,built.latestBuild.id);assert.equal(first.context.snapshotId,built.latestBuild.snapshotId);
  assert.equal(first.context.suiteSourceVersion,saved.group.version);assert.equal(first.context.sourceVersion,saved.members[0].version);
  assert.equal(first.context.backendId,backendId);assert.equal(first.context.sceneSourcePath,'documents/scenes/demo.json');
  assert.deepEqual(validateRuntimeCaseReport(first),first);assert.equal(Object.isFrozen(first.evaluation.checks[0].actual.position),true);
  assert.equal((await reportFiles(h.cacheRoot)).length,2);assert.ok(!JSON.stringify(first).includes(h.base));
  assert.ok(!JSON.stringify(job).includes('definitionSha256'));assert.ok(!JSON.stringify(job).includes('receiptDirectory'));
  assert.deepEqual((await value.status()).job,job);assert.deepEqual(await inventory(h.root),before);
  job.suite.entries[0].reportAvailable=false;assert.equal((await value.status()).job.suite.entries[0].reportAvailable,true);
});

test('a completed member is readable while the next member owns the running slot; queued or running reports remain unavailable',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),started=gate(),release=gate();let runs=0;
  const value=service(t,h,{backendRegistry:registry({async execute(c){if(++runs===2){started.resolve();await release.promise;}
    c.ready();c.controlProgram.steps.forEach((_,i)=>c.sample(i));c.finished();c.flush();return phaseResult('run');}})}),built=await builtService(value);
  await value.command(run(built,saved.group));await started.promise;
  const state=await value.status(),job=state.job;assert.equal(job.status,'running');assert.deepEqual(job.suite.entries.map(row=>row.reportAvailable),[true,false]);
  assert.equal((await value.command(read(job,saved.members[0].id))).evaluation.status,'passed');
  await assert.rejects(value.command(read(job,saved.members[1].id)),e=>e.errorCode==='runtime_report_not_ready'&&e.statusCode===409);
  await assert.rejects(value.command({action:'plan',sceneId}),e=>e.errorCode==='build_busy');
  assert.deepEqual((await value.status()).job,job);release.resolve();assert.equal((await settled(value)).job.suite.summary.passed,2);
});

test('cancelled member report preserves admitted sample prefixes and never fabricates reports for not-run members',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),started=gate();let runs=0;
  const value=service(t,h,{backendRegistry:registry({async execute(c){runs++;c.ready();c.sample(0);c.flush();started.resolve();
    await new Promise(resolve=>{if(c.signal.aborted)resolve();else c.signal.addEventListener('abort',resolve,{once:true});});return phaseResult('run','cancelled');}})}),built=await builtService(value);
  await value.command(run(built,saved.group));await started.promise;const running=await value.status();
  await value.command({action:'cancel',jobId:running.job.id});const state=await settled(value),report=await value.command(read(state.job,saved.members[0].id));
  assert.equal(runs,1);assert.equal(report.executionStatus,'cancelled');assert.equal(report.evaluation.status,'incomplete');assert.equal(report.samples.length,1);
  assert.equal(report.evaluation.passedChecks,1);assert.equal(report.evaluation.unavailableChecks,2);
  assert.deepEqual(state.job.suite.entries.map(row=>row.reportAvailable),[true,false]);
  await assert.rejects(value.command(read(state.job,saved.members[1].id)),e=>e.errorCode==='runtime_report_not_ready');
  assert.equal((await reportFiles(h.cacheRoot)).length,1);
});

test('native execution failure remains incomplete even when exporting its available member result',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h,{backendRegistry:registry({async execute(){return phaseResult('run','failed');}})}),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),report=await value.command(read(state.job,saved.members[0].id));
  assert.equal(state.job.status,'failed');assert.equal(report.executionStatus,'failed');assert.equal(report.samples.length,0);
  assert.equal(report.evaluation.status,'incomplete');assert.equal(report.evaluation.unavailableChecks,3);assert.notEqual(report.context.sessionId,null);
});

test('failure before allocating a later native session has a null-session report bound to the admitted member',async t=>{
  const h=await fixture(t),saved=await savedSuite(h);let runs=0;
  const reg=await build(h,registry({async execute(c){runs++;c.ready();c.controlProgram.steps.forEach((_,i)=>c.sample(i));c.finished();c.flush();
    if(runs===1)await fs.rm(path.join(h.output,'build.json'));return phaseResult('run');}}));
  const frozen=await readFrozenProjectBuild(h.output,{backendId,backendRegistry:reg}),capture=await captureRuntimeCaseSuite(h.root,{documentId:saved.group.id,plan:frozen.plan});
  const result=await executeRuntimeCaseSuite({capture,plan:frozen.plan,authorRoot:h.root,buildDirectory:h.output,buildId:frozen.build.buildId,
    snapshotId:frozen.build.snapshotId,tool:fakeTool.executable,backendId,backendRegistry:reg,cacheRoot:h.cacheRoot});
  assert.equal(runs,1);assert.equal(result.status,'failed');assert.deepEqual(result.record.suite.entries.map(row=>row.reportAvailable),[true,true]);
  const report=validateRuntimeCaseReport(JSON.parse(await fs.readFile(path.join(result.receiptDirectory,`member-${saved.members[1].id}.json`))));
  assert.equal(report.context.sessionId,null);assert.equal(report.context.documentId,saved.members[1].id);assert.equal(report.executionStatus,'failed');
  assert.equal(report.evaluation.status,'incomplete');assert.equal(report.samples.length,0);
});

for(const count of[1,2])test(`report publication failure preserves the committed leaf and stops remaining work (${count} members)`,async t=>{
  const h=await fixture(t),saved=await savedSuite(h,{count}),value=service(t,h),built=await builtService(value),link=fs.link;
  fs.link=async function(source,target,...options){if(String(target).endsWith(`member-${saved.members[0].id}.json`))throw Object.assign(new Error('controlled IO failure'),{code:'EIO'});return link.call(this,source,target,...options);};
  try {
    await value.command(run(built,saved.group));const state=await settled(value),row=state.job.suite.entries[0];
    assert.equal(state.job.status,'failed');assert.equal(state.job.diagnostics[0].code,'runtime_report_write');
    assert.equal(row.state,'passed');assert.equal(row.executionStatus,'succeeded');assert.equal(row.passedChecks,3);assert.equal(row.reportAvailable,false);
    assert.equal(state.job.control.samples.length,4);assert.equal(state.job.verification.evaluation.status,'passed');
    if(count===1){assert.equal(state.job.suite.summary.complete,true);assert.equal(state.job.suite.summary.status,'passed');}
    else {assert.equal(state.job.suite.entries[1].state,'not-run');assert.equal(state.job.suite.entries[1].sessionId,null);}
    await assert.rejects(value.command(read(state.job,row.documentId)),e=>e.errorCode==='runtime_report_not_ready');
    assert.equal((await reportFiles(h.cacheRoot)).length,0);
  } finally {fs.link=link;}
});

test('missing or changed report files are rejected without altering the current execution and assertion results',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),job=state.job;
  const relative=(await reportFiles(h.cacheRoot)).find(file=>file.endsWith(`member-${saved.members[0].id}.json`)),file=path.join(h.cacheRoot,relative),bytes=await fs.readFile(file);
  await fs.writeFile(file,Buffer.concat([bytes,Buffer.from(' ')]));
  await assert.rejects(value.command(read(job,saved.members[0].id)),e=>e.errorCode==='runtime_report_changed'&&e.statusCode===409);
  assert.deepEqual((await value.status()).job,job);await fs.rm(file);
  await assert.rejects(value.command(read(job,saved.members[0].id)),e=>e.errorCode==='runtime_report_unavailable'&&e.statusCode===404);
  assert.deepEqual((await value.status()).job,job);await fs.writeFile(file,bytes);
  assert.equal((await value.command(read(job,saved.members[0].id))).evaluation.status,'passed');
});

test('current report reads require neither online author source nor retained frozen build files',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),job=state.job,expected=await value.command(read(job,saved.members[0].id));
  const before=await inventory(h.root),buildFile=Object.keys(await inventory(h.cacheRoot)).find(file=>file.endsWith('/build.json'));
  await fs.rename(h.root,h.root+'-offline');await fs.rm(path.dirname(path.join(h.cacheRoot,buildFile)),{recursive:true});
  try {assert.deepEqual(await value.command(read(job,saved.members[0].id)),expected);assert.deepEqual(await inventory(h.root+'-offline'),before);}
  finally {await fs.rename(h.root+'-offline',h.root);}
});

test('the next parent job invalidates report ownership and a new service never adopts old cache receipts',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),before=await reportFiles(h.cacheRoot);
  await value.command({action:'plan',sceneId});await settled(value);
  await assert.rejects(value.command(read(state.job,saved.members[0].id)),e=>e.errorCode==='runtime_report_job_missing'&&e.statusCode===404);
  const reopened=service(t,h);await assert.rejects(reopened.command(read(state.job,saved.members[0].id)),e=>e.errorCode==='runtime_report_job_missing');
  assert.deepEqual(await reportFiles(h.cacheRoot),before);
});

test('a report read paused at IO rechecks ownership after a competing parent job has acquired the slot',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),opened=gate(),release=gate(),open=fs.open;let pending;
  fs.open=async function(file,...options){if(String(file).endsWith(`member-${saved.members[0].id}.json`)){opened.resolve();await release.promise;}return open.call(this,file,...options);};
  try {
    pending=value.command(read(state.job,saved.members[0].id));const rejected=assert.rejects(pending,e=>e.errorCode==='runtime_report_job_missing');await opened.promise;
    await value.command({action:'plan',sceneId});await settled(value);release.resolve();await rejected;
  } finally {fs.open=open;release.resolve();await pending?.catch(()=>{});}
});

test('closing awaits an owned report read and refuses delivering its result after closure',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),opened=gate(),release=gate(),open=fs.open;let pending,closing;
  fs.open=async function(file,...options){if(String(file).endsWith(`member-${saved.members[0].id}.json`)){opened.resolve();await release.promise;}return open.call(this,file,...options);};
  try {
    pending=value.command(read(state.job,saved.members[0].id));const rejected=assert.rejects(pending,e=>e.errorCode==='build_service_closed'&&e.statusCode===503);await opened.promise;
    let closed=false;closing=value.close().then(()=>{closed=true;});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,false);
    release.resolve();await rejected;await closing;assert.equal(closed,true);
  } finally {fs.open=open;release.resolve();await pending?.catch(()=>{});await closing;}
});

test('report admission accepts only current job and member IDs and cannot be redirected by HTTP-like fields',async t=>{
  const h=await fixture(t),saved=await savedSuite(h),value=service(t,h),built=await builtService(value);
  await value.command(run(built,saved.group));const state=await settled(value),request=read(state.job,saved.members[0].id),before=await inventory(h.cacheRoot);
  for(const patch of[{path:'/tmp/untrusted'},{receiptDirectory:h.cacheRoot},{sessionId:unknown},{tool:process.execPath},{sourceVersion:saved.members[0].version},
    {documentId:'../member.json'},{jobId:undefined}])await assert.rejects(value.command({...request,...patch}),e=>e.errorCode==='build_request_invalid');
  await assert.rejects(value.command({...request,documentId:unknown}),e=>e.errorCode==='runtime_report_job_missing');
  assert.deepEqual((await value.status()).job,state.job);assert.deepEqual(await inventory(h.cacheRoot),before);
});
