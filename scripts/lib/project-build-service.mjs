import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createError } from '../../engine/service-error.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, buildHash, readBuildFile } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild, readFrozenProjectBuild, projectBuildCacheRoot } from '../adapters/node-project-build.mjs';
import { executeRuntimeCaseSuite } from '../adapters/node-runtime-case-suite.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { DEFAULT_EXECUTION_BACKEND, createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { readExecutionToolCandidate, probeExecutionTool } from '../adapters/node-execution-tool-probe.mjs';
import { createExecutionToolStatus } from '../../engine/execution-tool-status.mjs';
import { inspectSceneComposition } from '../../engine/scene-composition-document.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { validateRuntimeCase, validateRuntimeCasePlan, evaluateRuntimeCase } from '../../engine/runtime-verification-case.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { createRuntimeCaseDocumentService } from './runtime-case-documents.mjs';
import { createRuntimeCaseSuiteDocumentService, captureRuntimeCaseSuite } from './runtime-case-suites.mjs';
import { summarizeRuntimeCaseSuite } from '../../engine/runtime-case-suite.mjs';
import { readRuntimeCaseReport } from './runtime-case-reports.mjs';

const services = new Set();
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (code, message, status = 400) => createError(status, message, {}, code);
const clone = value => JSON.parse(JSON.stringify(value));
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timeout']);

export async function stopProjectBuildServices() {
  await Promise.all([...services].map(service => service.close()));
}

// This service owns jobs across HTTP requests. Only the host can select a tool
// or cache root; HTTP receives opaque IDs and never supplies executable paths.
export function createProjectBuildService(root, {
  enabled = process.platform === 'linux', godot = process.env.VIENTO_GODOT_BIN,
  tool = godot, backendId = DEFAULT_EXECUTION_BACKEND, backendRegistry = createExecutionBackendRegistry(), cacheRoot = projectBuildCacheRoot(), onAuthorWrite,
} = {}) {
  const adapter = backendRegistry.resolve(backendId);
  const caseDocuments = createRuntimeCaseDocumentService(root, { onWrite: onAuthorWrite });
  const suiteDocuments = createRuntimeCaseSuiteDocumentService(root, { onWrite:onAuthorWrite });
  const caseOperations = new Set();
  const caseOperation = async operation => {
    const pending = operation(); caseOperations.add(pending);
    try { return await pending; } finally { caseOperations.delete(pending); }
  };
  let closed = false, closePromise, job = null, active = null, latestBuild = null;
  let probe = null, candidateKey;
  let toolStatus = createExecutionToolStatus({ backendId, status: 'unchecked' });
  let scenes = [], previewDocuments = [], catalogAt = 0, catalogRead, catalogObserved = false, catalogDiagnostic = null;
  const builds = new Map(), ownedOutputs = [];
  const memberReports = new Map();
  const namespace = path.join(cacheRoot, 'editor', buildHash(path.resolve(root)).slice(0, 24));

  async function toolState() {
    const candidate = await readExecutionToolCandidate(adapter, { toolPath: tool, enabled, platform: process.platform });
    // Discovery only observes the configured host file. A replaced tool must
    // lose its cached identity without starting a process during polling.
    if (!probe && candidate.candidateKey !== candidateKey) {
      candidateKey = candidate.candidateKey;
      toolStatus = createExecutionToolStatus({ backendId, status: 'unchecked' });
    }
    const rejected = toolStatus.status === 'unavailable';
    return { supported: candidate.supported, available: candidate.available && !rejected,
      reason: rejected ? toolStatus.reason : candidate.reason, toolStatus: clone(toolStatus) };
  }

  async function readScenes({ refresh = false } = {}) {
    if (!refresh && Date.now() - catalogAt < 3000) return;
    if (!catalogRead) catalogRead = (async () => {
      const observed = await readWorldSnapshot(root);
      const result = [], previews = [];
      for (const document of observed.source.documents) {
        if (!document.record?.id || !document.sourcePath.toLowerCase().endsWith('.json')) continue;
        let value, parsed = false;
        try { value = JSON.parse(document.content?.replace(/^\uFEFF/, '')); parsed = true; } catch { /* Keep a known broken declaration diagnosable below. */ }
        const composition = inspectSceneComposition(document.content);
        if (composition.recognized || !parsed && previewDocuments.some(item => item.id === document.record.id && item.kind === 'composition')) {
          previews.push({ id: document.record.id, sourcePath: document.sourcePath, kind: 'composition',
            title: typeof value?.scene?.title === 'string' ? value.scene.title.slice(0, 160) : path.basename(document.sourcePath) });
          continue;
        }
        if (value?.format !== 'viento-scene2d' && !scenes.some(scene => scene.id === document.record.id)) continue;
        const scene = { id: document.record.id, sourcePath: document.sourcePath,
          title: typeof value?.title === 'string' ? value.title.slice(0, 160) : path.basename(document.sourcePath) };
        result.push(scene); previews.push({ ...scene, kind: 'scene' });
      }
      scenes = result; previewDocuments = previews; catalogAt = Date.now();
      catalogObserved = true; catalogDiagnostic = null;
    })().finally(() => { catalogRead = null; });
    await catalogRead;
  }

  async function status({ refresh = false } = {}) {
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    const tool = await toolState();
    if (tool.supported) {
      try { await readScenes({ refresh }); }
      catch (error) {
        // Already-owned frozen artifacts and runtime observations remain usable
        // if the author source goes offline. Cached discovery cannot authorize
        // a new author build; command admission below always reads afresh.
        if (!catalogObserved || !latestBuild && !(job?.kind === 'run' && builds.has(job.buildId))) throw error;
        catalogDiagnostic = { code: 'build_catalog_unavailable' };
      }
    }
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    return { ...tool, platform: process.platform, backend: clone(adapter.descriptor),
      scenes: clone(scenes), previewDocuments: clone(previewDocuments), catalogDiagnostic: clone(catalogDiagnostic),
      job: clone(job), latestBuild: clone(latestBuild) };
  }

  async function checkTool() {
    if (active || probe) throw fail('build_busy', 'A build task or tool check is already active.', 409);
    const owner = { controller: new AbortController(), promise: null };
    probe = owner;
    toolStatus = createExecutionToolStatus({ backendId, status: 'checking' });
    owner.promise = probeExecutionTool(adapter, { toolPath: tool, enabled, platform: process.platform,
      signal: owner.controller.signal });
    try {
      const result = await owner.promise;
      if (closed || probe !== owner) throw fail('build_service_closed', 'Build service is closing.', 503);
      candidateKey = result.candidateKey;
      toolStatus = result.toolStatus;
    } finally {
      if (probe === owner) probe = null;
    }
    // The check owns no build task or author state. Execution still identifies
    // the tool afresh against its frozen build record.
    return status();
  }

  function progress(event) {
    if (!job || !active) return;
    if (event.suite) job.suite = clone(event.suite);
    if (event.caseReport && job.kind==='suite') {
      const {documentId,pin,receiptDirectory}=event.caseReport;
      const row=job.suite?.entries.find(item=>item.documentId===documentId),context=pin?.context;
      if(row?.reportAvailable===true&&context?.documentId===documentId&&context.buildId===job.buildId
        &&context.snapshotId===job.snapshotId&&context.backendId===job.backendId&&context.sceneObjectId===job.sceneId
        &&context.suiteDocumentId===job.suite.documentId&&context.suiteSourceVersion===job.suite.sourceVersion
        &&context.sourceVersion===row.sourceVersion&&context.sessionId===row.sessionId) {
        memberReports.set(documentId,{pin,receiptDirectory});
      }
    }
    if (event.caseStarted) {
      job.runtime=null; job.control=clone(event.control); job.verification=clone(event.verification); job.events=[];
    }
    // Keep the admitted object view independently of the bounded raw-event
    // ring, including frames observed while cancellation terminates the tool.
    if (event.runtime) job.runtime = clone(event.runtime);
    if (event.verification && job.verification) job.verification = clone(event.verification);
    if (event.controlSample && job.control && job.control.samples.length < job.control.program.steps.length) {
      job.control.samples.push(clone(event.controlSample));
    }
    if (active.controller.signal.aborted) return;
    if (event.phase) job.phase = event.phase;
    if (event.output) job.logs = (job.logs + event.output.text).slice(-32768);
    if (event.event) {
      job.events.push(event.event); if (job.events.length > 128) job.events.shift();
    }
  }

  async function runJob(payload, controller) {
    try {
      let result;
      const sceneId = job.sceneId;
      if (payload.action === 'suite-run') {
        const entry=builds.get(payload.buildId);
        result=await executeRuntimeCaseSuite({capture:payload.capture,plan:payload.frozenPlan,authorRoot:root,buildDirectory:entry.directory,
          buildId:entry.id,snapshotId:entry.snapshotId,tool,backendId,backendRegistry,cacheRoot,signal:controller.signal,onProgress:progress});
        job.suite=clone(result.record.suite);
        if(result.lastRecord?.runtime)job.runtime=clone(result.lastRecord.runtime);
        if(result.lastRecord?.control)job.control=clone(result.lastRecord.control);
        if(result.lastRecord?.verification)job.verification=clone(result.lastRecord.verification);
      } else if (payload.action === 'plan') {
        const captured = await captureBuildSnapshot(root, sceneId, { signal: controller.signal });
        const diagnostics = captured.ok ? checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', platform: process.platform, plan: captured.plan }) : captured.diagnostics;
        result = { ok: !diagnostics.length, status: diagnostics.length ? 'failed' : 'succeeded', diagnostics };
        if (result.ok) job.plan = { snapshotId: captured.snapshotId, title: captured.plan.scene.title,
          actorCount: captured.plan.actors.length, resourceCount: captured.plan.resources.length,
          ...(captured.plan.behaviors ? { behaviorBindingCount: captured.plan.behaviors.bindings.length,
            behaviorSourceCount: captured.plan.behaviors.sources.length } : {}) };
      } else if (payload.action === 'build') {
        const output = path.join(namespace, job.id);
        result = await buildProject({ root, scene: sceneId, tool, backendId, backendRegistry, output, signal: controller.signal,
          expectedSnapshotId: payload.expectedSnapshotId, onProgress: progress });
        if (result.buildDirectory) ownedOutputs.push(result.buildDirectory);
        if (result.ok) {
          const entry = { id: result.record.buildId, sceneId, backendId, snapshotId: result.record.snapshotId,
            title: scenes.find(scene => scene.id === sceneId)?.title || sceneId };
          const frozenPlan = JSON.parse(await readBuildFile(path.join(result.buildDirectory, 'snapshot.json'), 80 * 1024 * 1024, controller.signal)).plan;
          entry.planSchemaVersion = frozenPlan.schemaVersion; entry.actorCount = frozenPlan.actors.length;
          // Targets and admission facts belong to this successful frozen build,
          // never a later author edit or an HTTP-supplied engine identity.
          const controlPlan = { format: frozenPlan.format, kind: frozenPlan.kind, schemaVersion: frozenPlan.schemaVersion,
            scene: { objectId: frozenPlan.scene.objectId, sourcePath: frozenPlan.scene.sourcePath },
            actors: frozenPlan.actors.map(actor => ({ objectId: actor.objectId, ...(actor.instanceId ? { instanceId: actor.instanceId } : {}) })) };
          if (frozenPlan.schemaVersion === 2 && adapter.descriptor.capabilities.includes('runtime.control-replay.instances')) {
            entry.controlTargets = frozenPlan.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId,
              name: (actor.name || actor.objectId).replace(/\s+/gu, ' ').trim().slice(0, 160) || actor.objectId }));
          }
          builds.set(entry.id, { ...entry, directory: result.buildDirectory, controlPlan }); latestBuild = entry; job.buildId = entry.id;
        }
        // Only prune directories created by this service instance. Builds from
        // earlier sessions or CLI runs remain untouched and are never adopted.
        while (ownedOutputs.length > 3) {
          const old = ownedOutputs.shift();
          for (const [id, entry] of builds) if (entry.directory === old) builds.delete(id);
          if (latestBuild && !builds.has(latestBuild.id)) latestBuild = null;
          await fs.rm(old, { recursive: true, force: true });
        }
      } else {
        const entry = builds.get(payload.buildId);
        result = await runProjectBuild({ buildDirectory: entry.directory, tool, backendId, backendRegistry, signal: controller.signal,
          expectedBuildId:entry.id,expectedSnapshotId:entry.snapshotId,
          headless: payload.mode === 'headless', smoke: payload.mode === 'headless',
          timeoutMs: payload.mode === 'window' ? 300000 : 30000,
          ...(payload.controlProgram !== undefined ? { controlProgram: payload.controlProgram } : {}),
          ...(payload.runtimeCase !== undefined ? { runtimeCase: payload.runtimeCase } : {}),
          ...(payload.runtimeCaseSceneId ? { runtimeCaseSceneId: payload.runtimeCaseSceneId } : {}), onProgress: progress });
        if (result.record?.runtime) job.runtime = clone(result.record.runtime);
        if (result.record?.control) job.control = clone(result.record.control);
        if (result.record?.verification) job.verification = clone(result.record.verification);
      }
      // A verification session commits its execution/evaluation status while
      // saving the final record. A later cancel cannot rewrite that result.
      job.status = (payload.runtimeCase || payload.action==='suite-run') && result.record ? result.record.status
        : controller.signal.aborted ? 'cancelled' : terminal.has(result.status) ? result.status : 'failed';
      if (payload.action!=='suite-run' && job.verification && job.status !== 'succeeded') job.verification.evaluation = clone(evaluateRuntimeCase(
        builds.get(payload.buildId).controlPlan, job.verification.definition, job.control?.samples || [], { complete: false }));
      job.diagnostics = (result.record?.diagnostics || result.diagnostics || []).slice(0, 256);
    } catch (error) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      if (payload.action==='suite-run' && job.suite) {
        for (const row of job.suite.entries) if(row.state==='queued')row.state='not-run';else if(row.state==='running')row.state='incomplete';
        job.suite.summary=summarizeRuntimeCaseSuite(job.suite.entries.map(row=>row.state));
      }
      if (payload.action!=='suite-run' && job.verification) job.verification.evaluation = clone(evaluateRuntimeCase(
        builds.get(payload.buildId).controlPlan, job.verification.definition, [], { complete: false }));
      job.diagnostics = [{ severity: 'error', code: controller.signal.aborted ? 'build_cancelled' : error.errorCode || 'build_failed',
        message: controller.signal.aborted ? 'Build operation cancelled.' : 'Cannot complete this build operation.',
        objectId: job.sceneId, sourcePath: scenes.find(scene => scene.id === job.sceneId)?.sourcePath || '', propertyPath: '' }];
    } finally {
      job.phase = 'completed'; job.finishedAt = new Date().toISOString(); active = null;
    }
  }

  async function startSuite(raw) {
    const request={buildId:raw.buildId,suiteDocumentId:raw.suiteDocumentId,expectedVersion:raw.expectedVersion};
    if(!uuid(request.buildId)||!uuid(request.suiteDocumentId)||typeof request.expectedVersion!=='string'
      ||!/^sha256:[a-f0-9]{64}$/.test(request.expectedVersion))throw fail('runtime_suite_document_request','Select an owned build and a saved suite revision.');
    if(active||probe)throw fail('build_busy','A build task or tool check is already active.',409);
    const state=await toolState();
    if(!state.supported)throw fail('build_platform_unsupported','Project builds are not enabled on this host.',403);
    if(!state.available)throw fail('build_tool_required','Configure the selected backend tool before running.',422);
    const entry=builds.get(request.buildId);
    if(!entry)throw fail('build_artifact_missing','This build is no longer available.',404);
    const frozen=await readFrozenProjectBuild(entry.directory,{backendId,backendRegistry});
    if(frozen.build.buildId!==entry.id||frozen.build.snapshotId!==entry.snapshotId||frozen.plan.scene.objectId!==entry.sceneId) {
      throw fail('runtime_build_invalid','The owned frozen build changed.',422);
    }
    const diagnostics=checkExecutionBackendSupport(adapter.descriptor,{operation:'headlessLogic',platform:process.platform,plan:frozen.plan});
    if(diagnostics.length)throw fail(diagnostics[0].code,diagnostics[0].message,422);
    const capture=await captureRuntimeCaseSuite(root,{documentId:request.suiteDocumentId,expectedVersion:request.expectedVersion,plan:frozen.plan});
    if(!adapter.descriptor.capabilities.includes('runtime.control-replay')
      ||capture.cases.some(item=>item.document.case.program.schemaVersion===2)&&!adapter.descriptor.capabilities.includes('runtime.control-replay.instances')) {
      throw fail('runtime_case_unsupported','This backend does not support the suite programs.',422);
    }
    // All member identities, budgets and definitions are detached before a slot
    // is allocated. Competing requests and a concurrent close recheck here.
    if(closed)throw fail('build_service_closed','Build service is closing.',503);
    if(active||probe)throw fail('build_busy','A build task or tool check is already active.',409);
    if(builds.get(request.buildId)!==entry)throw fail('build_artifact_missing','This build is no longer available; rebuild the scene.',404);
    const controller=new AbortController(),entries=capture.cases.map(item=>({documentId:item.documentId,title:item.title,
      sourceVersion:item.sourceVersion,state:'queued',executionStatus:null,sessionId:null,checkCount:item.document.case.checks.length,
      reportAvailable:false,passedChecks:0,failedChecks:0,unavailableChecks:0}));
    memberReports.clear();
    job={id:randomUUID(),kind:'suite',sceneId:entry.sceneId,backendId,buildId:entry.id,snapshotId:entry.snapshotId,
      status:'running',phase:'tool',createdAt:new Date().toISOString(),diagnostics:[],events:[],logs:'',plan:null,runtime:null,
      suite:{documentId:capture.documentId,sourceVersion:capture.sourceVersion,sceneObjectId:capture.sceneObjectId,
        entries,summary:summarizeRuntimeCaseSuite(entries.map(row=>row.state))}};
    active={controller,promise:null};
    active.promise=Promise.resolve().then(()=>runJob({action:'suite-run',buildId:entry.id,capture,frozenPlan:frozen.plan},controller));
    return status();
  }

  async function command(payload) {
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !['plan', 'build', 'run', 'cancel', 'inspect', 'tool-check', 'case-list', 'case-load', 'case-save', 'suite-list', 'suite-load', 'suite-save', 'suite-run', 'suite-report'].includes(payload.action)) throw fail('build_request_invalid', 'Invalid build action.');
    const allowed = { plan: ['action', 'sceneId'], build: ['action', 'sceneId', 'expectedSnapshotId'], run: ['action', 'buildId', 'mode', 'controlProgram', 'runtimeCase', 'runtimeCaseSceneId'], cancel: ['action', 'jobId'],
      inspect: ['action', 'jobId', 'instanceId', 'objectId'], 'tool-check': ['action'],
      'case-list': ['action', 'sceneId'], 'case-load': ['action', 'documentId'],
      'case-save': ['action', 'sceneId', 'sceneVersion', 'content', 'documentId', 'expectedVersion', 'sourcePath', 'documentType'],
      'suite-list':['action','sceneId'],'suite-load':['action','documentId'],
      'suite-save':['action','sceneId','sceneVersion','content','documentId','expectedVersion','sourcePath','documentType'],
      'suite-run':['action','buildId','suiteDocumentId','expectedVersion'],
      'suite-report':['action','jobId','documentId'] }[payload.action];
    if (Object.keys(payload).some(key => !allowed.includes(key))) throw fail('build_request_invalid', 'Unknown build request field.');
    if (payload.action === 'case-list') return caseOperation(() => caseDocuments.list(payload.sceneId));
    if (payload.action === 'case-load') return caseOperation(() => caseDocuments.load(payload.documentId));
    if (payload.action === 'case-save') return caseOperation(() => caseDocuments.save(payload));
    if (payload.action === 'suite-list') return caseOperation(() => suiteDocuments.list(payload.sceneId));
    if (payload.action === 'suite-load') return caseOperation(() => suiteDocuments.load(payload.documentId));
    if (payload.action === 'suite-save') return caseOperation(() => suiteDocuments.save(payload));
    if (payload.action === 'suite-run') return caseOperation(()=>startSuite(payload));
    if (payload.action === 'suite-report') {
      const request={jobId:payload.jobId,documentId:payload.documentId};
      if(!uuid(request.jobId)||!uuid(request.documentId))throw fail('build_request_invalid','Invalid member report identity.');
      const owner=job;
      if(owner?.id!==request.jobId||owner.kind!=='suite')throw fail('runtime_report_job_missing','This batch is no longer available.',404);
      const row=owner.suite?.entries.find(item=>item.documentId===request.documentId);
      if(!row)throw fail('runtime_report_job_missing','This member does not belong to the current batch.',404);
      const stored=memberReports.get(request.documentId);
      if(row.reportAvailable!==true||!stored)throw fail('runtime_report_not_ready','This member report is not available yet.',409);
      return caseOperation(async()=>{
        const report=await readRuntimeCaseReport(stored.receiptDirectory,stored.pin);
        if(closed)throw fail('build_service_closed','Build service is closing.',503);
        if(job!==owner||memberReports.get(request.documentId)!==stored)throw fail('runtime_report_job_missing','This batch is no longer available.',404);
        if(report.executionStatus!==row.executionStatus)throw fail('runtime_report_changed','The member report changed.',409);
        return report;
      });
    }
    if (Object.hasOwn(payload, 'runtimeCaseSceneId') && (!uuid(payload.runtimeCaseSceneId) || !Object.hasOwn(payload, 'runtimeCase'))) {
      throw fail('runtime_case_scene_mismatch', 'A scene binding requires a runtime case and a valid scene identity.', 422);
    }
    let controlProgram, runtimeCase;
    if (Object.hasOwn(payload, 'runtimeCase')) {
      try { runtimeCase = validateRuntimeCase(payload.runtimeCase); }
      catch (error) { throw fail(error.errorCode || 'runtime_case_invalid', 'Invalid runtime verification case.', error.errorCode === 'runtime_case_limit' ? 422 : 400); }
      if (Object.hasOwn(payload, 'controlProgram')) throw fail('runtime_case_invalid', 'Select either a verification case or a control program.');
      if (payload.mode !== 'headless') throw fail('runtime_case_unsupported', 'Runtime verification requires headless mode.', 422);
    }
    if (Object.hasOwn(payload, 'controlProgram')) {
      try { controlProgram = validateSceneControlProgram(payload.controlProgram); }
      catch (error) {
        throw fail(error.errorCode === 'runtime_control_limit' ? 'runtime_control_limit' : 'runtime_control_invalid',
          'Invalid finite control replay program.', error.errorCode === 'runtime_control_limit' ? 422 : 400);
      }
      if (payload.mode !== 'headless') throw fail('runtime_control_mode', 'Control replay requires headless mode.', 422);
    }
    // Capture request scalars and validated values before awaiting host state.
    // Callers cannot change the job after ownership admission begins.
    payload = { ...payload, ...(controlProgram ? { controlProgram } : {}), ...(runtimeCase ? { runtimeCase } : {}) };
    if (payload.action === 'tool-check') return checkTool();
    if (payload.action === 'inspect') {
      if (!uuid(payload.jobId) || Object.hasOwn(payload, 'instanceId') && !uuid(payload.instanceId)
        || Object.hasOwn(payload, 'objectId') && !uuid(payload.objectId)) throw fail('build_request_invalid', 'Invalid runtime query identity.');
      if (payload.jobId !== job?.id || !['run','suite'].includes(job.kind)) throw fail('runtime_query_job_missing', 'This runtime task is not available.', 404);
      if (!job.runtime) throw fail('runtime_query_unavailable', 'Runtime object observation is not available yet.', 409);
      const selection = { ...(payload.instanceId !== undefined ? { instanceId: payload.instanceId } : {}),
        ...(payload.objectId !== undefined ? { objectId: payload.objectId } : {}) };
      let view;
      try { view = querySceneRuntimeObservation(job.runtime, selection); }
      catch { throw fail('build_request_invalid', 'Invalid runtime query.'); }
      return { ...view, jobId: job.id, buildId: job.buildId, snapshotId: job.snapshotId, backendId: job.backendId, status: job.status };
    }
    if (payload.action === 'cancel') {
      if (!uuid(payload.jobId) || payload.jobId !== job?.id) throw fail('build_job_missing', 'Build task is not available.', 404);
      if (active) { job.phase = 'cancelling'; active.controller.abort(); }
      return status();
    }
    if (active || probe) throw fail('build_busy', 'A build task or tool check is already active.', 409);
    const tool = await toolState();
    if (!tool.supported) throw fail('build_platform_unsupported', 'Project builds are not enabled on this host.', 403);
    if (payload.action !== 'plan' && !tool.available) throw fail('build_tool_required', 'Configure the selected backend tool on the local host before building.', 422);
    if (payload.action === 'run') {
      if (!uuid(payload.buildId) || !builds.has(payload.buildId)) throw fail('build_artifact_missing', 'This build is no longer available; rebuild the scene.', 404);
      if (!['headless', 'window'].includes(payload.mode)) throw fail('build_request_invalid', 'Invalid runtime mode.');
      const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation: payload.mode === 'headless' ? 'headlessLogic' : 'windowPreview', platform: process.platform });
      if (diagnostics.length) throw fail(diagnostics[0].code, diagnostics[0].message, 422);
      if (controlProgram && (!adapter.descriptor.capabilities.includes('runtime.control-replay')
        || controlProgram.schemaVersion === 2 && !adapter.descriptor.capabilities.includes('runtime.control-replay.instances')
        || ![1, 2].includes(builds.get(payload.buildId).planSchemaVersion))) {
        throw fail('runtime_control_unsupported', 'This build does not support finite control replay.', 422);
      }
      if (controlProgram) {
        try { controlProgram = validateSceneControlPlan(builds.get(payload.buildId).controlPlan, controlProgram); }
        catch (error) { throw fail(error.errorCode || 'runtime_control_invalid', 'Control replay does not match this frozen build.', 422); }
      }
      if (runtimeCase) {
        if (payload.runtimeCaseSceneId && payload.runtimeCaseSceneId !== builds.get(payload.buildId).sceneId) {
          throw fail('runtime_case_scene_mismatch', 'The case belongs to a different frozen scene.', 422);
        }
        if (!adapter.descriptor.capabilities.includes('runtime.control-replay')
          || runtimeCase.program.schemaVersion === 2 && !adapter.descriptor.capabilities.includes('runtime.control-replay.instances')) {
          throw fail('runtime_case_unsupported', 'This backend does not support this verification program.', 422);
        }
        try { runtimeCase = validateRuntimeCasePlan(builds.get(payload.buildId).controlPlan, runtimeCase); }
        catch (error) { throw fail(error.errorCode || 'runtime_case_invalid', 'Runtime verification does not match this frozen build.', 422); }
      }
    } else {
      if (!uuid(payload.sceneId) || payload.expectedSnapshotId !== undefined
        && (typeof payload.expectedSnapshotId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(payload.expectedSnapshotId))) throw fail('build_request_invalid', 'Invalid scene or snapshot identity.');
      await readScenes({ refresh: true });
      if (!scenes.some(scene => scene.id === payload.sceneId)) throw fail('build_scene_required', 'Select a registered Scene2D document.', 404);
      if (payload.action === 'build') {
        const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', platform: process.platform });
        if (diagnostics.length) throw fail(diagnostics[0].code, diagnostics[0].message, 422);
      }
    }
    // Recheck after await: simultaneous POSTs cannot both acquire the slot.
    if (closed) throw fail('build_service_closed', 'Build service is closing.', 503);
    if (active || probe) throw fail('build_busy', 'A build task or tool check is already active.', 409);
    const controller = new AbortController();
    memberReports.clear();
    job = { id: randomUUID(), kind: payload.action, sceneId: payload.sceneId || builds.get(payload.buildId).sceneId,
      backendId,
      ...(payload.action === 'run' ? { buildId: builds.get(payload.buildId).id, snapshotId: builds.get(payload.buildId).snapshotId } : {}),
      status: 'running', phase: payload.action === 'run' ? 'tool' : 'snapshot', createdAt: new Date().toISOString(),
      diagnostics: [], events: [], logs: '', plan: null, runtime: null,
      ...(controlProgram || runtimeCase ? { control: { program: clone(controlProgram || runtimeCase.program),
        sha256: `sha256:${buildHash(canonicalJson(controlProgram || runtimeCase.program))}`, samples: [] } } : {}),
      ...(runtimeCase ? { verification: { definition: clone(runtimeCase), sha256: `sha256:${buildHash(canonicalJson(runtimeCase))}`,
        evaluation: clone(evaluateRuntimeCase(builds.get(payload.buildId).controlPlan, runtimeCase, [], { complete: false })) } } : {}) };
    // Start on a microtask after registering the owner; normal HTTP completion
    // does not cancel this task. Reopening the panel resumes observing it.
    active = { controller, promise: null };
    active.promise = Promise.resolve().then(() => runJob(payload, controller));
    return status();
  }

  const service = { status, command, close() {
    if (closePromise) return closePromise;
    closed = true;
    if (active) { job.phase = 'cancelling'; active.controller.abort(); }
    if (probe) probe.controller.abort();
    closePromise = Promise.allSettled([active?.promise, probe?.promise, ...caseOperations]).finally(() => { memberReports.clear();services.delete(service); });
    return closePromise;
  } };
  services.add(service);
  return service;
}
