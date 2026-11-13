import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const assemblyId = id(1), first = id(2), second = id(3), backendId = 'org.viento.godot4';
const revision = `sha256:${'a'.repeat(64)}`, snapshotId = `sha256:${'b'.repeat(64)}`;
const source = { objectId: id(9), sourcePath: 'documents/behaviors/state.json', sourceRevision: revision, propertyPath: '/bindings/0' };
const origin = () => ({ visitIndex: 1, sceneId: first, bindingId: id(4), instanceId: id(5), objectId: id(6), source });
const shared = () => ({ revision: 1, entries: [{ key: 'note', value: '雨の鍵', revision: 1, origin: origin() }],
  lastChange: { operation: 'set', key: 'note', revision: 1, origin: origin() } });
function state({ legacy = false, task = 'run-1', active = second } = {}) {
  const visits = [{ index: 1, sceneId: first, phase: 'left', elapsedSeconds: 0.5 }, { index: 2, sceneId: second, phase: active === second ? 'ready' : 'left', elapsedSeconds: active === second ? 0 : 0.5 }];
  if (active === first) visits.push({ index: 3, sceneId: first, phase: 'ready', elapsedSeconds: 0 });
  return { supported: true, available: true, platform: 'linux',
    backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.9.0', label: 'Godot', platforms: ['linux'],
      plans: [{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }],
      capabilities: ['scene2d'], execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: assemblyId, kind: 'project', title: 'Project', sourcePath: 'documents/game.json', entrySceneId: first, sceneCount: 2 }],
    latestBuild: { id: 'build-1', backendId, sceneId: assemblyId, targetKind: 'project', targetId: assemblyId, snapshotId, entrySceneId: first, sceneCount: 2,
      scenes: [first, second].map((sceneId, index) => ({ sceneId, title: `Scene ${index}`, sourcePath: `documents/scenes/${index}.json`, sourceRevision: revision, planSchemaVersion: 1, runtimeProtocolVersion: 1 })) },
    job: { id: task, kind: 'run', status: 'running', phase: 'running', backendId, sceneId: assemblyId, targetKind: 'project', targetId: assemblyId,
      buildId: 'build-1', snapshotId, diagnostics: [], events: [], logs: '', runtime: {
        format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: active, protocolVersion: 1, phase: 'ready', sequence: 1, actors: [],
        project: { assemblyId, entrySceneId: first, activeSceneId: active, visits, ...(legacy ? {} : { protocolVersion: 2, sharedState: shared() }) },
      } },
  };
}
async function fixture(initial = state(), options = {}) {
  let payload = initial;
  const calls = [], opened = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/game.json' };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build', queryProjectRuntimeObservation, querySceneRuntimeObservation,
    fetchJsonApiRequest: async (url, request) => { calls.push(request.body ? JSON.parse(request.body) : null); return { payload }; } });
  const module = (await fs.readFile(new URL('../../web/modules/app-project-state-observation.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '');
  vm.runInContext(module, h.runtime);
  const controller = h.runtime.setupProjectBuild({ getContext: () => context,
    openSource: (...args) => { opened.push(args); return options.openSource ? options.openSource(...args) : true; } });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, context, controller, calls, opened, async refresh(next) { payload = next; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    el: suffix => h.element('projectSharedState' + suffix) };
}


const pause = (phase='paused') => ({format:'viento-project-pause-observation',schemaVersion:1,assemblyId,phase:'recording',state:phase,current:{visitIndex:2,sceneId:second},totalTransitions:phase==='paused'?1:phase==='waiting-for-release'?2:3,transitions:['paused','waiting-for-release','running'].slice(0,phase==='paused'?1:phase==='waiting-for-release'?2:3).map((phase,index)=>({protocol:1,event:'state',sequence:index+1,visitIndex:2,sceneId:second,phase,elapsedSeconds:.1,totalSeconds:.6})),retention:{limit:32,total:phase==='paused'?1:phase==='waiting-for-release'?2:3,retained:phase==='paused'?1:phase==='waiting-for-release'?2:3,dropped:0,firstSequence:1,lastSequence:phase==='paused'?1:phase==='waiting-for-release'?2:3}});
test('build UI shows admitted pause, release wait, resume and incomplete states without issuing gameplay writes',async()=>{
 const s=state();s.job.pause=pause();const h=await fixture(s),el=h.element('projectBuildPauseStatus');assert.equal(el.hidden,false);assert.match(el.textContent,/游戏已暂停/);
 for(const [phase,text]of [['waiting-for-release',/等待松开/],['running',/游戏已恢复/]]){const s=state();s.job.pause=pause(phase);await h.refresh(s);assert.equal(el.hidden,false);assert.match(el.textContent,text);}
 const s2=state();s2.job.pause={...pause(),phase:'incomplete'};await h.refresh(s2);assert.match(el.textContent,/未完成/);assert.ok(h.calls.every(c=>c===null));
});
test('build UI hides stale or malformed pause receipts and receipts belonging to another run snapshot or visit',async()=>{
 const s=state();s.job.pause=pause();const h=await fixture(s),el=h.element('projectBuildPauseStatus');
 for(const mutate of [s=>s.job.pause.assemblyId=id(90),s=>s.job.pause.current.visitIndex=1,s=>s.job.pause.current.sceneId=first,s=>s.job.pause.retention.total=99,s=>s.job.snapshotId='sha256:'+ 'f'.repeat(64),s=>s.job.buildId='other-build',s=>s.job.kind='build',s=>delete s.job.pause,s=>s.job.runtime.project.visits.at(-1).phase='left']){const s=state();s.job.pause=pause();mutate(s);await h.refresh(s);assert.equal(el.hidden,true);assert.equal(el.textContent,'');}
});
