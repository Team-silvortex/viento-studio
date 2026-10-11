import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { canExecuteBackend } from '../../engine/backend-capabilities.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { deferred } from './editor-harness.mjs';
import { validateBackendProjectManifest } from '../../engine/backend-project.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

const id = value => `bbbbbbbb-bbbb-4bbb-8bbb-${value.toString(16).padStart(12, '0')}`;
const revision = value => `sha256:${value.toString(16).padStart(64, '0')}`;
const sceneId = id(1), secondScene = id(2), buildId = id(3), previousBuild = id(4), backendId = 'org.viento.bevy';
const clone = value => JSON.parse(JSON.stringify(value));
const backend = () => ({ format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Bevy', version: '0.3.0', platforms: ['linux'],
  plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }], capabilities: ['scene2d','runtime.control-replay','runtime.control-replay.instances','runtime.case'],
  execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
const summary = (id, scene = sceneId, status = 'succeeded') => ({ id, sceneId: scene, backendId, snapshotId: revision(1), title: 'Saved scene', status,
  createdAt: '2026-10-11T00:00:00.000Z', retention: id===previousBuild?'preserved':'automatic', retentionReason: id===previousBuild?'backend_project_previous_session':null, origin:id===previousBuild?'previous-session':'current-session',availability:id===previousBuild?'unchecked':'verified' });
function project(id = previousBuild) {
  const hash = 'a'.repeat(64);
  return validateBackendProjectManifest({ format: 'viento-backend-project', schemaVersion: 1, buildId: id, snapshotId: revision(1),
    source: { workspaceId: 'readonly-workspace', sceneId, sourcePath: 'documents/scenes/first.json', sourceRevision: revision(2), planKind: 'scene2d', planSchemaVersion: 2 },
    backend: { id: backendId, version: '0.3.0', protocolVersion: 2, sha256: hash }, executionAdapter: { id: backendId, contractVersion: 1, sha256: hash },
    tool: { version: 'viento-bevy-runtime 0.3.0 bevy 0.19.1', sha256: hash, platform: 'linux', arch: 'x64' },
    project: { kind: 'bevy-scene', root: 'project', entry: 'project/scene-data.json', requiresTool: true },
    files: [{ path: 'project/scene-data.json', size: 16, sha256: hash, role: 'generated', resourceId: null, sourceObjectId: null }], resources: [],
    dependencies: [{ objectId: sceneId, sourcePath: 'documents/scenes/first.json', sourceRevision: revision(2), role: 'scene' }],
    evidence: ['build.json', 'snapshot.json', 'source-map.json'].map(path => ({ path, size: 32, sha256: hash })),
    lifecycle: { authority: 'author-workspace', generatedProject: 'derived-read-only', resources: 'copies', rebuild: 'saved-author-inputs', runtimeCopies: 'temporary', persistence: 'until-owner-cleanup' },
  });
}
const receipt = (id = previousBuild) => ({ project: project(id), inspection: { recorded: true, complete: true, manifestSha256: 'b'.repeat(64), extraPaths: [] }, buildDirectory: `/cache/builds/editor/author/${backendId}/${id}` });
const initial = () => ({ supported: true, available: true, platform: 'linux', backend: backend(), scenes: [
  { id: sceneId, title: 'First scene', sourcePath: 'documents/scenes/first.json' },
  { id: secondScene, title: 'Second scene', sourcePath: 'documents/scenes/second.json' }],
  latestBuild: { id: buildId, sceneId, backendId, snapshotId: revision(1), title: 'First scene', planSchemaVersion: 2, actorCount: 1 },
  projects: [summary(buildId), summary(previousBuild)],
  projectManagement: { format: 'viento-backend-project-management', schemaVersion: 1, scope: 'host-catalog', retentionLimit: 3, preservedCount: 0, previousSessions: 'explicit-verify',catalogDiagnostic:null }, job: null });
async function view({ state = initial(), current = {}, forceState } = {}) {
  const calls = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/scenes/first.json', ...current };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH,
    canExecuteBackend:(value,operation,platform)=>canExecuteBackend(value===undefined?undefined:clone(value),operation,platform),
    validateSceneControlProgram: value=>validateSceneControlProgram(clone(value)), validateSceneControlPlan:(plan,input)=>validateSceneControlPlan(clone(plan),clone(input)),
    validateBackendProjectManifest: value => validateBackendProjectManifest(clone(value)),
    fetchJsonApiRequest: async (url, request) => {
      const pending = deferred(), body = request.body ? JSON.parse(request.body) : null;
      calls.push({ url, body, ...pending });
      if (!request.method) pending.resolve({ payload: url.endsWith('?refresh=1') && forceState ? forceState : state });
      return pending.promise;
    },
  });
  const source = (await fs.readFile(new URL('../../web/modules/app-backend-project.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  vm.runInContext(source, h.runtime); const realm = vm.runInContext('value => JSON.parse(JSON.stringify(value))', h.runtime);
  const controller = h.runtime.setupProjectBuild({ getContext: () => context });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, calls, context,
    async resolve(value) { calls.at(-1).resolve({ payload: realm(value) }); await flushDialogs(); },
    async refresh(value) { state = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async activate(id=previousBuild) { h.element('backendProjectSelect').value=id;h.element('backendProjectSelect').dispatch('change');h.element('backendProjectActivate').click();await flushDialogs(); },
    async inspect(id = previousBuild) { h.element('backendProjectSelect').value = id; h.element('backendProjectSelect').dispatch('change'); h.element('backendProjectInspect').click(); await flushDialogs(); },
  };
}


const restored = (value=initial())=>({...clone(value),latestBuild:{...value.latestBuild,id:previousBuild},projects:value.projects.map(row=>row.id===previousBuild?{...row,availability:'verified'}:row)});

test('parent explicit activation changes the one frozen execution target used by existing headless run',async()=>{
 const h=await view();await h.activate();assert.deepEqual(h.calls.at(-1).body,{action:'select-project',buildId:previousBuild});
 assert.equal(h.element('projectBuildHeadless').disabled,true);await h.resolve(restored());assert.equal(h.element('projectBuildHeadless').disabled,false,JSON.stringify({error:h.element('backendProjectError').textContent,runtime:h.element('backendProjectRuntime').textContent,status:h.element('backendProjectStatus').textContent,calls:h.calls.map(c=>c.body)}));
 h.element('projectBuildHeadless').click();assert.deepEqual(h.calls.at(-1).body,{action:'run',buildId:previousBuild,mode:'headless'});
});
test('readonly inspection of restored history cannot choose a new execution target',async()=>{
 const h=await view();await h.inspect();await h.resolve(receipt());h.element('projectBuildHeadless').click();assert.equal(h.calls.at(-1).body.buildId,buildId);
});
test('failed selection reconciles with GET only and does not repeat the mutation or lose prior run build',async()=>{
 const h=await view();await h.activate();h.calls.at(-1).reject(Object.assign(new Error('changed'),{errorCode:'backend_project_changed'}));await flushDialogs();await flushDialogs();
 assert.equal(h.calls.filter(call=>call.body?.action==='select-project').length,1);assert.equal(h.calls.at(-1).body,null);
 assert.match(h.element('backendProjectError').textContent,/已变化/);assert.equal(h.element('projectBuildHeadless').disabled,false);
 h.element('projectBuildHeadless').click();assert.equal(h.calls.at(-1).body.buildId,buildId);
});
test('lost select response reconciles a host-confirmed target by GET without a second select',async()=>{
 const state=initial();const h=await view({state});await h.activate();state.latestBuild.id=previousBuild;state.projects[1].availability='verified';
 h.calls.at(-1).reject(new Error('response lost'));await flushDialogs();await flushDialogs();
 assert.equal(h.calls.filter(call=>call.body?.action==='select-project').length,1);h.element('projectBuildHeadless').click();assert.equal(h.calls.at(-1).body.buildId,previousBuild);
});
test('close/reopen and scene/tab changes discard selection completion from the previous parent owner',async()=>{
 for(const change of ['close','scene','tab']){const h=await view();await h.activate();const pending=h.calls.at(-1);
 if(change==='close'){h.element('projectBuildClose').click();await flushDialogs();h.element('projectBuildBtn').click();await flushDialogs();}
 else if(change==='scene'){h.element('projectBuildScene').value=secondScene;h.element('projectBuildScene').dispatch('change');}
 else h.element('projectBuildTabPreview').click();pending.resolve({payload:restored()});await flushDialogs();
 assert.equal(h.element('backendProjectDetails').hidden,true);
 if(change==='close'){h.element('projectBuildHeadless').click();assert.equal(h.calls.at(-1).body.buildId,buildId);}
 }
});
test('descriptor or request epoch change invalidates pending select even when scene and IDs remain the same',async()=>{
 for(const change of ['descriptor','request']){const h=await view();await h.activate();const pending=h.calls.at(-1);const state=initial();if(change==='descriptor')state.backend.version='0.4.0';await h.refresh(state);
 pending.resolve({payload:restored()});await flushDialogs();assert.equal(h.element('backendProjectDetails').hidden,true);
 if(change==='request'){h.element('projectBuildHeadless').click();assert.equal(h.calls.at(-1).body.buildId,buildId);}
 }
});
test('frozen-only scene permits explicit run selection and run while denying plan/build/edit/create from offline authors',async()=>{
 const state=initial();state.scenes=state.scenes.slice(0,1).map(row=>({...row,frozenOnly:true}));state.previewDocuments=[];state.catalogDiagnostic={code:'build_catalog_unavailable'};state.latestBuild=null;
 const h=await view({state});h.controller.setAvailable(true,[],{scenePreview:true,sceneCreate:true,sceneUpdate:true});
 assert.equal(h.element('projectBuildPlan').disabled,true);assert.equal(h.element('projectBuildGenerate').disabled,true);assert.equal(h.element('projectBuildEditScene').disabled,true);assert.equal(h.element('projectBuildCreateScene').disabled,true);
 assert.match(h.element('projectBuildScene').children[0].textContent,/仅冻结工程/);await h.activate();const next=restored(initial());next.scenes=state.scenes;next.previewDocuments=[];next.catalogDiagnostic=state.catalogDiagnostic;await h.resolve(next);
 assert.equal(h.element('projectBuildHeadless').disabled,false);h.element('projectBuildHeadless').click();assert.equal(h.calls.at(-1).body.buildId,previousBuild);
});
test('frozen-only row blocks author plan even when another live scene keeps the author catalog available',async()=>{
 const state=initial();state.scenes[0].frozenOnly=true;const h=await view({state});assert.equal(h.element('projectBuildPlan').disabled,true);
 h.element('projectBuildPlan').click();assert.equal(h.calls.length,1);
 h.element('projectBuildScene').value=secondScene;h.element('projectBuildScene').dispatch('change');assert.equal(h.element('projectBuildPlan').disabled,false);
});
test('selected history updates existing control replay target and keeps the raw input intact',async()=>{
 const h=await view();h.element('projectBuildControlProgram').value=JSON.stringify({format:'viento-runtime-control',schemaVersion:1,fixedDelta:0.25,steps:[{left:false,right:true,up:false,down:false},{left:false,right:false,up:false,down:false}]});
 const raw=h.element('projectBuildControlProgram').value;await h.activate();await h.resolve(restored());h.element('projectBuildControl').click();
 assert.equal(h.calls.at(-1).body.action,'run',JSON.stringify({error:h.element('projectBuildControlError').textContent,disabled:h.element('projectBuildControl').disabled,hidden:h.element('projectBuildControl').hidden}));assert.equal(h.calls.at(-1).body.buildId,previousBuild);assert.equal(h.calls.at(-1).body.controlProgram.steps[0].right,true);assert.equal(h.element('projectBuildControlProgram').value,raw);
});
test('draft data is preserved during runtime selection and existing unsaved-input execution gate remains active',async()=>{
 const h=await view({current:{dirty:true}}),input=h.element('docSourceEditor');input.value='draft';input.selectionStart=2;input.selectionEnd=4;
 await h.activate();await h.resolve(restored());assert.equal(h.element('projectBuildHeadless').disabled,true);assert.equal(input.value,'draft');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);assert.equal(h.context.dirty,true);
});

test('explicit status refresh bypasses host catalog cache and immediately reconciles offline gates or a removed target',async()=>{
 for(const removed of [false,true]){
  const state=initial(),fresh=initial();fresh.catalogDiagnostic={code:'build_catalog_unavailable'};
  if(removed){fresh.projects=[];fresh.latestBuild=null;}
  const h=await view({state,forceState:fresh});assert.equal(h.element('projectBuildPlan').disabled,false);assert.equal(h.element('projectBuildHeadless').disabled,false);
  h.element('projectBuildRefresh').click();await flushDialogs();
  assert.equal(h.calls.at(-1).url,`${PROJECT_BUILD_API_PATH}?refresh=1`);assert.equal(h.calls.at(-1).body,null);
  assert.equal(h.element('projectBuildPlan').disabled,true);assert.equal(h.element('projectBuildGenerate').disabled,true);
  assert.equal(h.element('projectBuildHeadless').disabled,removed);
  if(removed){assert.match(h.element('backendProjectRuntime').textContent,/尚未设置/);assert.equal(h.element('backendProjectActivate').disabled,true);}
 }
});
