import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { validateRuntimeCaseSuitePlan, summarizeRuntimeCaseSuite } from '../../engine/runtime-case-suite.mjs';
import { evaluateRuntimeCase } from '../../engine/runtime-verification-case.mjs';
import { validateRuntimeCaseDocument } from '../../engine/runtime-case-document.mjs';
import { createRuntimeCaseReport } from '../../engine/runtime-case-report.mjs';
import { writeRuntimeCaseReport } from '../lib/runtime-case-reports.mjs';
import { buildHash, buildError } from './node-build-snapshot.mjs';
import { runProjectBuild, projectBuildCacheRoot } from './node-project-build.mjs';
import { resolveAssetRoot } from '../lib/workspace.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const within = (root,target) => { const relative=path.relative(root,target); return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
async function destination(input) {
  const parts=[]; let current=path.resolve(input);
  for (;;) {
    try { return path.join(await fs.realpath(current),...parts); }
    catch(error) {
      if(error.code!=='ENOENT') throw error;
      try { await fs.lstat(current); throw buildError('build_output_invalid','A cache parent is a dangling link.'); }
      catch(statError) { if(statError.code!=='ENOENT') throw statError; }
      parts.unshift(path.basename(current)); current=path.dirname(current);
    }
  }
}

// The scheduler sequences existing headless sessions. It owns no engine code,
// input simulator or new runtime protocol; every member still admits its own
// frozen files, adapter and trusted tool through the ordinary executor.
export async function executeRuntimeCaseSuite({ capture, plan, authorRoot, buildDirectory, buildId, snapshotId, tool, backendId, backendRegistry,
  signal, cacheRoot=projectBuildCacheRoot(), timeoutMs=120000, caseTimeoutMs=30000, onProgress=()=>{} }) {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000
    ||!Number.isSafeInteger(caseTimeoutMs)||caseTimeoutMs<1||caseTimeoutMs>30000) throw buildError('runtime_suite_limit','Invalid batch execution budget.');
  const definition=validateRuntimeCaseSuitePlan(plan,capture.definition,capture.cases.map(({documentId,document})=>({documentId,document})));
  plan={format:plan.format,kind:plan.kind,schemaVersion:plan.schemaVersion,scene:{objectId:plan.scene.objectId,sourcePath:plan.scene.sourcePath},
    actors:plan.actors.map(actor=>({objectId:actor.objectId,instanceId:actor.instanceId}))};
  const cases=capture.cases.map(item=>({documentId:item.documentId,title:item.title,sourceVersion:item.sourceVersion,definition:validateRuntimeCaseDocument(item.document).case}));
  const suite={documentId:capture.documentId,sourceVersion:capture.sourceVersion,sceneObjectId:definition.sceneObjectId,
    entries:cases.map(item=>({documentId:item.documentId,title:item.title,sourceVersion:item.sourceVersion,state:'queued',executionStatus:null,
      sessionId:null,reportAvailable:false,checkCount:item.definition.checks.length,passedChecks:0,failedChecks:0,unavailableChecks:0}))};
  const publish = event => onProgress(clone(event));
  const summarize=()=>{suite.summary=summarizeRuntimeCaseSuite(suite.entries.map(item=>item.state));return clone(suite);};
  const controller=new AbortController(); let expired=false, stoppedStatus, receiptDirectory, lastRecord, reportFailure=false;
  const abort=()=>controller.abort();
  if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{expired=true;abort();},timeoutMs);timer.unref();
  const record={format:'viento-runtime-case-suite-run',schemaVersion:1,buildId,snapshotId,backendId,createdAt:new Date().toISOString(),status:'running',suite:summarize(),diagnostics:[]};
  try {
    const target=await destination(path.join(cacheRoot,'suites',randomUUID()));
    if(within(await destination(authorRoot),target)||within(await destination(resolveAssetRoot(authorRoot)),target)) {
      throw buildError('build_output_in_source','Suite receipts must remain outside author files and assets.');
    }
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(target,{mode:0o700});receiptDirectory=target;
    publish({suite:summarize()});
    for(let index=0;index<cases.length;index++) {
      if(controller.signal.aborted){stoppedStatus=expired?'timeout':'cancelled';break;}
      const item=cases[index],row=suite.entries[index];row.state='running';
      publish({caseStarted:true,suite:summarize(),control:{program:item.definition.program,sha256:`sha256:${buildHash(canonicalJson(item.definition.program))}`,samples:[]},
        verification:{definition:item.definition,sha256:`sha256:${buildHash(canonicalJson(item.definition))}`,
          evaluation:evaluateRuntimeCase(plan,item.definition,[],{complete:false})},runtime:null,phase:'tool'});
      const result=await runProjectBuild({buildDirectory,tool,backendId,backendRegistry,signal:controller.signal,timeoutMs:caseTimeoutMs,
        expectedBuildId:buildId,expectedSnapshotId:snapshotId,
        headless:true,smoke:true,runtimeCase:item.definition,runtimeCaseSceneId:definition.sceneObjectId,onProgress:publish});
      lastRecord=result.record;
      row.executionStatus=result.record?.status||result.status||'failed';row.sessionId=result.record?.sessionId||null;
      const evaluation=result.record?.verification?.evaluation;
      if(row.executionStatus==='succeeded'&&evaluation?.complete&&['passed','failed'].includes(evaluation.status))row.state=evaluation.status;
      else row.state='incomplete';
      row.passedChecks=evaluation?.passedChecks||0;row.failedChecks=evaluation?.failedChecks||0;
      row.unavailableChecks=evaluation?.unavailableChecks ?? row.checkCount;
      if(row.state==='incomplete') {
        stoppedStatus=expired?'timeout':controller.signal.aborted?'cancelled':row.executionStatus==='timeout'?'timeout':row.executionStatus==='cancelled'?'cancelled':'failed';
        record.diagnostics=(result.record?.diagnostics||result.diagnostics||[]).slice(0,256);
      }
      // Reports describe committed leaf results. A late cancel cannot discard
      // their real samples or rewrite their assertion outcome while saving.
      try {
        const report=createRuntimeCaseReport({context:{sceneSourcePath:plan.scene.sourcePath,sceneObjectId:suite.sceneObjectId,
          buildId,snapshotId,backendId,suiteDocumentId:suite.documentId,suiteSourceVersion:suite.sourceVersion,
          documentId:item.documentId,sourceVersion:item.sourceVersion,sessionId:row.sessionId},
          executionStatus:row.executionStatus,targets:plan.actors,definition:item.definition,samples:result.record?.control?.samples||[]});
        const pin=await writeRuntimeCaseReport(receiptDirectory,report);
        row.reportAvailable=true;
        // This field is a trusted scheduler-to-service message. The service
        // keeps its file pin private and exposes only reportAvailable publicly.
        publish({suite:summarize(),caseReport:{documentId:item.documentId,pin,receiptDirectory}});
      } catch {
        reportFailure=true;stoppedStatus='failed';
        record.diagnostics=[{severity:'error',code:'runtime_report_write',message:'The member report could not be saved.',
          objectId:suite.sceneObjectId,sourcePath:'',propertyPath:''}];
      }
      publish({suite:summarize()});
      if(stoppedStatus)break;
    }
    for(const row of suite.entries)if(row.state==='queued')row.state='not-run';
    record.suite=summarize();record.status=stoppedStatus||'succeeded';
    // A cancellation after the final committed member cannot rewrite completed
    // assertions; a stop before the next member leaves that member not-run.
    if(record.suite.summary.complete&&!reportFailure)record.status='succeeded';
    record.finishedAt=new Date().toISOString();
    const temporary=path.join(receiptDirectory,'.suite-'+randomUUID()+'.tmp');
    try { await fs.writeFile(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,path.join(receiptDirectory,'suite.json')); }
    finally { await fs.rm(temporary,{force:true}); }
    publish({suite:record.suite});
    return {ok:record.status==='succeeded'&&record.suite.summary.status==='passed',status:record.status,record:clone(record),receiptDirectory,
      ...(lastRecord?{lastRecord:clone(lastRecord)}:{})};
  } catch(error) {
    for(const row of suite.entries)if(row.state==='queued')row.state='not-run';else if(row.state==='running')row.state='incomplete';
    record.suite=summarize();record.status=expired?'timeout':controller.signal.aborted?'cancelled':'failed';record.finishedAt=new Date().toISOString();
    record.diagnostics=[{severity:'error',code:error.errorCode||'runtime_suite_failed',message:'The batch could not complete.',objectId:definition.sceneObjectId,sourcePath:'',propertyPath:''}];
    return {ok:false,status:record.status,record:clone(record),...(receiptDirectory?{receiptDirectory}:{}),...(lastRecord?{lastRecord:clone(lastRecord)}:{})};
  } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
}
