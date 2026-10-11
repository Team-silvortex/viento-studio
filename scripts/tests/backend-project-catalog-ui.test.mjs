import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { parse } from 'acorn';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { validateBackendProjectManifest } from '../../engine/backend-project.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = value => `aaaaaaaa-aaaa-4aaa-8aaa-${value.toString(16).padStart(12, '0')}`;
const hash = value => value.toString(16).padStart(64, '0');
const revision = value => `sha256:${hash(value)}`;
const sceneId = id(1), buildId = id(2), oldBuildId = id(3), assetId = id(4), scriptId = id(5);
const backendId = 'org.viento.godot4';
const descriptor = () => ({id: backendId, version: '0.5.0', execution: {headlessLogic: true}});
const clone = value => JSON.parse(JSON.stringify(value));
function manifest({ backend = backendId, build = buildId, adapter = true, images = true } = {}) {
  const bevy = backend === 'org.viento.bevy';
  const file = (path, role = 'generated', resourceId = null, sourceObjectId = null) => ({ path, role, resourceId, sourceObjectId, size: 32, sha256: hash(10) });
  const files = bevy ? [file('project/scene-data.json')] : [file(`project/behaviors/${scriptId}.gd`, 'author-source-copy', null, scriptId),
    ...(images ? [file(`project/images/${assetId}.png`, 'resource-copy', assetId)] : []), file('project/main.tscn'), file('project/project.godot'), file('project/runtime.gd')];
  return validateBackendProjectManifest({ format: 'viento-backend-project', schemaVersion: 1, buildId: build, snapshotId: revision(1),
    source: { workspaceId: 'frozen-author-workspace', sceneId, sourcePath: 'documents/scenes/frozen-scene.json', sourceRevision: revision(2), planKind: 'scene2d', planSchemaVersion: 2 },
    backend: { id: backend, version: bevy ? '0.3.0' : '0.5.0', protocolVersion: 2, sha256: hash(3) },
    executionAdapter: adapter ? { id: backend, contractVersion: 1, sha256: hash(4) } : null,
    tool: { version: bevy ? 'viento-bevy-runtime 0.3.0 bevy 0.19.1' : '4.7.2.stable', sha256: hash(5), platform: 'linux', arch: 'x64' },
    project: { kind: bevy ? 'bevy-scene' : 'godot-project', root: 'project', entry: bevy ? 'project/scene-data.json' : 'project/project.godot', requiresTool: true },
    files, resources: !bevy && images ? [{ resourceId: assetId, sourcePath: 'pictures/original.png', generatedPath: `project/images/${assetId}.png`, size: 32, sha256: hash(10) }] : [],
    dependencies: [
      { objectId: scriptId, sourcePath: 'documents/behaviors/mover.txt', sourceRevision: revision(3), role: 'behavior-source' },
      { objectId: null, sourcePath: 'documents/notes/未登记:备注.txt', sourceRevision: null, role: 'author-document' },
      { objectId: sceneId, sourcePath: 'documents/scenes/frozen-scene.json', sourceRevision: revision(2), role: 'scene' },
    ],
    evidence: ['build.json', 'snapshot.json', 'source-map.json'].map(path => ({ path, size: 64, sha256: hash(6) })),
    lifecycle: { authority: 'author-workspace', generatedProject: 'derived-read-only', resources: 'copies', rebuild: 'saved-author-inputs', runtimeCopies: 'temporary', persistence: 'until-owner-cleanup' },
  });
}
function summary(project = manifest(), extra = {}) {
  return { id: project.buildId, sceneId: project.source.sceneId, backendId: project.backend.id, snapshotId: project.snapshotId,
    title: '<img onerror=window.bad> 作者名', status: 'succeeded', createdAt: '2026-10-11T00:00:00.000Z', retention: 'automatic', retentionReason: null, ...extra };
}
function receipt(project = manifest(), inspection = {}) {
  return { project, buildDirectory: '/cache/viento/editor/author-hash/org.viento.godot4/build-one',
    inspection: { recorded: true, complete: true, manifestSha256: hash(7), extraPaths: [], ...inspection } };
}
async function view({ project = manifest(), rows, current = {}, result } = {}) {
  const calls = [], languages = [];
  const accepted = [];
  let state = { backend: descriptor(), available: true, visible: true, session: 1, sceneId, backendId: project.backend.id, backendIdentity: canonicalJson(descriptor()),
    projects: rows || [summary(project, {origin:'current-session',availability:'verified'})], projectManagement: { format: 'viento-backend-project-management', schemaVersion: 1,
      scope: 'host-catalog', retentionLimit: 3, preservedCount: 0, previousSessions: 'explicit-verify', catalogDiagnostic:null }, ...current };
  let dictionary = {}, respond = () => result || receipt(project);
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-backend-project', {
    validateBackendProjectManifest: value => validateBackendProjectManifest(clone(value)),
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { languages.push(listener); return () => { const index = languages.indexOf(listener); if (index >= 0) languages.splice(index, 1); }; },
  });
  const realm = vm.runInContext('value => JSON.parse(JSON.stringify(value))', h.runtime);
  const container = h.document.createElement('div'); h.document.body.append(container);
  const controller = h.runtime.setupBackendProject({ container, getState: () => state,
    onSelect: (value, owner) => { accepted.push({value:clone(value),owner:clone(owner)}); state={...state,...clone(value)}; return true; },
    request: async body => { calls.push(clone(body)); return realm(await respond(body)); } });
  return { ...h, controller, calls, accepted, container, get state() { return state; },
    setState(value) { state = value; controller.render(); }, respond(value) { respond = typeof value === 'function' ? value : () => value; },
    language(value) { dictionary = value; languages.forEach(listener => listener()); },
    select(value) { h.element('backendProjectSelect').value = value; h.element('backendProjectSelect').dispatch('change'); },
    async activate(value) { const accepted = await controller.activate(value); await flushDialogs(); return accepted; },
    async open(value) { const accepted = await controller.open(value); await flushDialogs(); return accepted; },
  };
}


const earlier = (overrides={}) => summary(manifest({build:oldBuildId}), {origin:'previous-session',availability:'unchecked',retention:'preserved',retentionReason:'backend_project_previous_session',...overrides});
const selectedStatus = (state,id=oldBuildId) => ({...clone(state),scenes:[{id:sceneId,title:'Saved scene',sourcePath:'documents/scenes/frozen-scene.json'}],
 latestBuild:{id,sceneId,backendId,snapshotId:revision(1)}, projects:state.projects.map(row=>row.id===id?{...row,availability:'verified'}:row)});

test('catalog restores unchecked histories without automatically selecting an execution target', async()=>{
 const h=await view({rows:[earlier()]});
 assert.equal(h.element('backendProjectActivate').hidden,false); assert.equal(h.element('backendProjectActivate').disabled,false);
 assert.match(h.element('backendProjectRuntime').textContent,/尚未设置/);assert.match(h.element('backendProjectOrigin').textContent,/以前的服务/);
 assert.match(h.element('backendProjectAvailability').textContent,/尚未/);assert.match(h.element('backendProjectSelection').textContent,/以前服务/);
 assert.equal(h.calls.length,0);assert.equal(h.accepted.length,0);
});
test('inspect history is readonly; only explicit select command changes the runtime identity',async()=>{
 const h=await view({rows:[earlier()],current:{latestBuild:{id:buildId,sceneId,backendId,snapshotId:revision(1)}}});
 h.respond(receipt(manifest({build:oldBuildId})));assert.equal(await h.open(),true);assert.equal(h.state.latestBuild.id,buildId);
 h.respond(selectedStatus(h.state));assert.equal(await h.activate(),true);
 assert.deepEqual(h.calls,[{action:'inspect-project',buildId:oldBuildId},{action:'select-project',buildId:oldBuildId}]);
 assert.equal(h.accepted.length,1);assert.equal(h.state.latestBuild.id,oldBuildId);assert.match(h.element('backendProjectRuntime').textContent,new RegExp(oldBuildId));
 assert.equal(h.element('backendProjectActivate').disabled,true);assert.equal(await h.activate(),false);
});
test('unavailable historical entries permit explicit retry while failed builds do not',async()=>{
 const h=await view({rows:[earlier({availability:'unavailable'})]});assert.equal(h.element('backendProjectActivate').disabled,false);
 assert.match(h.element('backendProjectAvailability').textContent,/上次核对/);h.respond(selectedStatus(h.state));assert.equal(await h.activate(),true);
 const failed=await view({rows:[earlier({status:'failed'})]});assert.equal(failed.element('backendProjectActivate').disabled,true);
 assert.equal(await failed.activate(),false);assert.equal(await failed.open(),false);assert.equal(failed.calls.length,0);
});
test('catalog diagnostics are visible even without rows and never disclose raw errors or paths',async()=>{
 const h=await view({rows:[],current:{projectManagement:{scope:'host-catalog',previousSessions:'explicit-verify',catalogDiagnostic:{code:'backend_project_catalog_invalid'}}}});
 assert.equal(h.element('backendProjectPanel').hidden,false);assert.equal(h.element('backendProjectDiagnostic').hidden,false);
 assert.match(h.element('backendProjectDiagnostic').textContent,/无效/);assert.equal(h.element('backendProjectActivate').disabled,true);
 h.setState({...h.state,projectManagement:{...h.state.projectManagement,catalogDiagnostic:{code:'private-local-secret'}}});
 assert.ok(!h.element('backendProjectDiagnostic').textContent.includes('private-local-secret'));
});
test('activation locks picker/inspect/selection and failure preserves previously selected execution target',async()=>{
 const h=await view({rows:[earlier()],current:{latestBuild:{id:buildId,sceneId,backendId,snapshotId:revision(1)}}}),p=deferred();h.respond(()=>p.promise);
 const work=h.activate();assert.equal(h.controller.isBusy(),true);
 for(const id of ['Select','Inspect','Activate'])assert.equal(h.element('backendProject'+id).disabled,true);
 assert.equal(await h.activate(),false);p.reject(Object.assign(new Error('/private/path'),{errorCode:'backend_project_workspace_changed'}));assert.equal(await work,false);
 assert.equal(h.state.latestBuild.id,buildId);assert.equal(h.accepted.length,0);assert.equal(h.controller.isBusy(),false);
 assert.match(h.element('backendProjectError').textContent,/不同的作者世界/);assert.ok(!h.element('backendProjectError').textContent.includes('/private/path'));
});
test('late selection success after close or dispose cannot authorize a detached view',async()=>{
 for(const close of ['close','dispose']){const h=await view({rows:[earlier()]}),p=deferred();h.respond(()=>p.promise);const work=h.activate();
 if(close==='close')h.element('backendProjectClose').click();else h.controller.dispose();p.resolve(selectedStatus(h.state));assert.equal(await work,false);assert.equal(h.accepted.length,0);}
});
test('scene/session/backend/hidden owner changes suppress late activation and late errors',async()=>{
 for(const change of [{sceneId:id(99)},{session:2},{backendIdentity:'changed'},{visible:false}]){
 const h=await view({rows:[earlier()]}),p=deferred();h.respond(()=>p.promise);const work=h.activate(),status=selectedStatus(h.state);
 h.setState({...h.state,...change});p.resolve(status);assert.equal(await work,false);assert.equal(h.accepted.length,0);assert.equal(h.element('backendProjectDetails').hidden,true);
 }
});
test('catalog row origin/snapshot changes invalidate selection but availability verification alone does not',async()=>{
 for(const change of [{origin:'current-session'},{snapshotId:revision(99)}]){const h=await view({rows:[earlier()]}),p=deferred();h.respond(()=>p.promise);const work=h.activate(),status=selectedStatus(h.state);
 h.setState({...h.state,projects:[{...h.state.projects[0],...change}]});p.resolve(status);assert.equal(await work,false);assert.equal(h.accepted.length,0);}
 const h=await view({rows:[earlier()]}),p=deferred();h.respond(()=>p.promise);const work=h.activate();h.setState({...h.state,projects:[{...earlier(),availability:'verified'}]});p.resolve(selectedStatus(h.state));assert.equal(await work,true);
});
test('forged select status cannot change runtime target or be accepted by parent',async()=>{
 for(const mutate of [s=>s.latestBuild.id=buildId,s=>s.latestBuild.snapshotId=revision(99),s=>s.latestBuild.sceneId=id(99),s=>s.latestBuild.backendId='org.viento.bevy',s=>s.backend.version='forged',s=>s.projects[0].availability='unchecked',s=>delete s.scenes]){
 const h=await view({rows:[earlier()]});const status=selectedStatus(h.state);mutate(status);h.respond(status);assert.equal(await h.activate(),false);assert.equal(h.accepted.length,0);assert.equal(h.state.latestBuild,undefined);
 }
});
test('old host retains readonly workflow and does not expose unsupported selection command',async()=>{
 const h=await view({rows:[summary()],current:{projectManagement:{scope:'service-session',previousSessions:'cli-inspect'}}});
 assert.equal(h.element('backendProjectActivate').hidden,true);assert.equal(await h.activate(),false);assert.equal(await h.open(),true);assert.equal(h.calls.length,1);
});
test('pending external jobs disable selection without making readonly inspection unavailable',async()=>{
 const h=await view({rows:[earlier()],current:{canSelect:false}});assert.equal(h.element('backendProjectActivate').disabled,true);assert.equal(await h.activate(),false);
 h.respond(receipt(manifest({build:oldBuildId})));assert.equal(await h.open(),true);
});
test('offline author input and missing installed tool do not hide verification or rewrite author data',async()=>{
 const h=await view({rows:[earlier()],current:{editable:false,dirty:true,toolAvailable:false,catalogDiagnostic:{code:'build_catalog_unavailable'}}});
 assert.equal(h.element('backendProjectActivate').disabled,false);h.respond(selectedStatus(h.state));assert.equal(await h.activate(),true);assert.equal(h.state.dirty,true);assert.equal(h.state.editable,false);
});
test('new catalog wording translates at each language switch, including unchanged picker and runtime identity',async()=>{
 const h=await view({rows:[earlier()],current:{latestBuild:{id:oldBuildId,sceneId,backendId,snapshotId:revision(1)}}});
 for(const dictionary of [en,ja,{}]){h.language(dictionary);assert.equal(h.element('backendProjectActivate').textContent,dictionary['设为运行工程']||'设为运行工程');
 assert.ok(h.element('backendProjectSelect').children[0].textContent.includes(dictionary['历史工程']||'历史工程'));
 assert.ok(h.element('backendProjectRuntime').textContent.includes(oldBuildId));}
});
test('catalog malformed identity and availability cannot expose commands',async()=>{
 const h=await view({rows:[earlier({origin:'foreign'}),earlier({availability:'pretend'}),earlier({backendId:'org.viento.bevy'})]});
 assert.equal(h.element('backendProjectPanel').hidden,true);assert.equal(h.calls.length,0);assert.equal(await h.activate(),false);
});
test('catalog selection errors have explicit localized concurrency/owner diagnostics',async()=>{
 for(const [code,expect] of [['backend_project_selection_changed',/选择期间/],['backend_project_owner_changed',/位置或身份/],['backend_project_catalog_changed',/目录记录已变化/]]){
 const h=await view({rows:[earlier()]});h.respond(()=>Promise.reject(Object.assign(new Error('private secret'),{errorCode:code})));assert.equal(await h.activate(),false);assert.match(h.element('backendProjectError').textContent,expect);
 }
});
