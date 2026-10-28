// Adapt the pinned data-only Bevy scene protocol to project protocol 1. The
// bridge does not ask Bevy to switch scenes or claim that it has done so.
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';
import { validateSceneControlPlan } from '../../engine/scene-control-program.mjs';

export function createBevyProjectRuntimeEventReader(input, { smoke = true, protocolVersion = 1, onEvent, retainedEvents, controlProgram, canFinishReplay } = {}) {
  const plan = validateProjectAssemblyPlan(input);
  if (plan.schemaVersion !== 1 || protocolVersion !== 1 || typeof smoke !== 'boolean') {
    throw Object.assign(new TypeError('Bevy project runtime supports project plan and runtime protocol 1 only.'), { errorCode: 'runtime_project_invalid' });
  }
  const scene = plan.scenes.find(value => value.scene.objectId === plan.entrySceneId);
  if (!scene || ![1, 2].includes(scene.schemaVersion) || scene.audio || scene.behaviors || scene.animation || scene.physics) {
    throw Object.assign(new TypeError('Bevy project runtime requires a data-only entry scene.'), { errorCode: 'runtime_project_invalid' });
  }
  const replay = controlProgram === undefined ? null : validateSceneControlPlan(scene, controlProgram);
  if (replay && (!smoke || typeof canFinishReplay !== 'function')) {
    throw Object.assign(new TypeError('Project replay requires a validated finite control trace.'), { errorCode: 'runtime_project_invalid' });
  }
  const duration = replay ? replay.fixedDelta * replay.steps.length : 0.5;
  const project = createProjectRuntimeEventReader(plan, { protocolVersion: 1, onEvent, ...(retainedEvents === undefined ? {} : { retainedEvents }),
    ...(smoke ? { expectedTotalSeconds: duration } : {}) });
  let started = false, ended = false, admitted = null;
  const local = [];
  const fail = message => {
    if (local.length < 128) local.push({ severity: 'error', code: 'runtime_protocol_invalid', message,
      objectId: scene.scene.objectId, sourcePath: scene.scene.sourcePath, propertyPath: '' });
  };
  const emit = frame => {
    const accepted = project.push('VIENTO_PROJECT:' + JSON.stringify({ protocol: 1, ...frame }) + '\n');
    if (admitted) admitted.push(...accepted);
  };
  const start = () => {
    if (started) return;
    started = true;
    emit({ event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId });
    emit({ event: 'scene-enter', visitIndex: 1, sceneId: scene.scene.objectId });
  };
  const child = createSceneRuntimeEventReader(scene, { onEvent: frame => {
    // A startup/resource diagnostic can precede scene readiness. It is real
    // evidence of failure, but cannot start a project visit.
    if (frame.event === 'ready') start();
    if (!started) return;
    if (frame.event === 'finished') {
      // Plain smoke is two fixed steps; replay completion requires its admitted trace.
      if (!smoke || frame.fixedDelta !== (replay ? replay.fixedDelta : 0.25) || replay && !canFinishReplay()) { fail('Unexpected Bevy project completion frame.'); return; }
      if (child.diagnostics.length || project.diagnostics.length || local.length) return;
      emit({ event: 'scene-exit', visitIndex: 1, sceneId: scene.scene.objectId, reason: 'finished', elapsedSeconds: duration, actors: frame.actors });
      if (project.diagnostics.length) return;
      emit({ event: 'finished', assemblyId: plan.assembly.objectId, visitCount: 1, totalSeconds: duration });
    } else {
      emit({ event: 'scene-event', visitIndex: 1, sceneId: scene.scene.objectId, stream: 'runtime', frame });
    }
  } });
  // The project reader also admits valid child diagnostics after ready. Keep
  // pre-ready errors from the child and collapse identical copies thereafter.
  const diagnostics = () => {
    const seen = new Set();
    return [...child.diagnostics, ...local, ...project.diagnostics].filter(value => {
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 128);
  };
  return Object.freeze({
    get events() { return project.events; },
    get diagnostics() { return diagnostics(); },
    get retention() { return project.retention; },
    get lifecycle() { return project.lifecycle; },
    push(text) {
      if (ended || typeof text !== 'string') return [];
      admitted = [];
      try { child.push(text); return admitted; } finally { admitted = null; }
    },
    finish() {
      if (!ended) { ended = true; child.finish(); project.finish(); }
      return { events: project.events, diagnostics: diagnostics() };
    },
  });
}
