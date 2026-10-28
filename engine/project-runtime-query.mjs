import { validateProjectAnimationStateTriggeredEntriesSnapshot, validateProjectAnimationStateEntryTriggersTimeline } from './project-animation-state-entry-triggers.mjs';
import { validateProjectAnimationStateEntriesSnapshot, validateProjectAnimationStateEntriesTimeline } from './project-animation-state-entries.mjs';
import { validateProjectAnimationStatesSnapshot, validateProjectAnimationStatesTimeline } from './project-animation-states.mjs';
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { createSceneRuntimeObservation, querySceneRuntimeObservation } from './scene-runtime-query.mjs';
import { validateSceneControlPlan } from './scene-control-program.mjs';
import { validateProjectAnimationCompletionsSnapshot, validateProjectAnimationCompletionTimeline } from './project-animation-completions.mjs';
import { validateProjectAnimationCommandsSnapshot } from './project-animation-commands.mjs';
import { validateProjectAudioCommandsSnapshot } from './project-audio-commands.mjs';
import { validateProjectEventSnapshot } from './project-event-bus.mjs';
import { validateProjectSharedStateSnapshot } from './project-shared-state.mjs';
import { createProjectRuntimeEventReader } from './project-runtime-events.mjs';
import { PROJECT_RUNTIME_PREFIX, PROJECT_RUNTIME_MAX_VISITS, projectRuntimeUuid as uuid, projectRuntimeExact as exact,
  projectRuntimeTime as time, copyProjectRuntimeData as copy, copyProjectEventObservationData as copyEventObservation, copyProjectAudioObservationData as copyAudioObservation, copyProjectAnimationObservationData as copyAnimationObservation, copyProjectAnimationClipObservationData as copyClipObservation, copyProjectAnimationCompletionObservationData as copyCompletionObservation, copyProjectAnimationStatesObservationData as copyStatesObservation, copyProjectAnimationStateEntriesObservationData as copyEntriesObservation, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

export function createProjectRuntimeObservation(input, { protocolVersion = 1, controlProgram } = {}) {
  const plan = validateProjectAssemblyPlan(input), scenes = new Map(plan.scenes.map(scene => [scene.scene.objectId, scene]));
  const entryScene = scenes.get(plan.entrySceneId);
  const program = controlProgram === undefined ? null : validateSceneControlPlan(entryScene, controlProgram);
  let child = createSceneRuntimeObservation(entryScene, program ? { controlProgram: program } : {});
  const project = { assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId, activeSceneId: plan.entrySceneId, visits: [] };
  // This observer consumes admitted callbacks and semantic ledgers, never a raw history.
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion, retainedEvents: 1, onEvent: frame => {
    if (frame.event === 'scene-enter') {
      project.activeSceneId = frame.sceneId; child = createSceneRuntimeObservation(scenes.get(frame.sceneId),
        program && frame.visitIndex === 1 && frame.sceneId === plan.entrySceneId ? { controlProgram: program } : {});
      project.visits.push({ index: frame.visitIndex, sceneId: frame.sceneId, phase: 'waiting', elapsedSeconds: 0 });
    } else if (frame.event === 'scene-event') {
      if (frame.stream === 'runtime') child.push(frame.frame);
      if (frame.stream === 'runtime' && frame.frame.event === 'ready') project.visits.at(-1).phase = 'ready';
    } else if (frame.event === 'scene-exit') {
      const visit = project.visits.at(-1); visit.elapsedSeconds = frame.elapsedSeconds;
      if (frame.reason === 'switch') {
        visit.phase = 'left'; project.activeSceneId = frame.nextSceneId;
        // Revoke old samples at exit, before a target ready frame can arrive.
        child = createSceneRuntimeObservation(scenes.get(frame.nextSceneId));
      } else {
        visit.phase = 'finished';
        // This is an observation-only final sample admitted by project exit.
        // It never enters the old child wire reader or its audio smoke clock.
        child.push({ protocol: scenes.get(frame.sceneId).schemaVersion, event: 'finished', actors: frame.actors,
          fixedDelta: program && frame.visitIndex === 1 && frame.sceneId === plan.entrySceneId ? program.fixedDelta : 1 });
      }
    }
  } });
  return Object.freeze({
    push(inputEvent) {
      let event; try { event = copy(inputEvent); } catch { return false; }
      // A replay terminal must not mark the project visit finished before all
      // of its admitted samples reached the scene observer.
      if (program && event?.event === 'scene-exit' && event.reason === 'finished'
        && event.visitIndex === 1 && event.sceneId === plan.entrySceneId) {
        const control = child.snapshot().control;
        if (!control || control.completedSteps !== control.stepCount) return false;
      }
      return reader.push(PROJECT_RUNTIME_PREFIX + JSON.stringify(event) + '\n').length === 1;
    },
    pushSample(sample) {
      // Trace frames have no scene or visit identifier. They are meaningful
      // only in the first, ready entry visit to which this program was bound.
      const visit = project.visits[0];
      if (!program || project.visits.length !== 1 || project.activeSceneId !== plan.entrySceneId
        || !visit || visit.index !== 1 || visit.sceneId !== plan.entrySceneId || visit.phase !== 'ready') return false;
      return child.pushSample(sample);
    },
    snapshot() { return { ...child.snapshot(), project: { ...copy(project), ...(protocolVersion >= 2 ? { protocolVersion, sharedState: reader.sharedState, ...(protocolVersion >= 3 ? { events: reader.projectEvents } : {}), ...(protocolVersion >= 4 ? { audioCommands: reader.audioCommands } : {}), ...(protocolVersion >= 5 ? { animationCommands: reader.animationCommands } : {}), ...(protocolVersion >= 7 ? { animationCompletions: reader.animationCompletions } : {}), ...(protocolVersion >= 8 ? { animationStates: reader.animationStates } : {}), ...(protocolVersion >= 9 ? { animationStateEntries: reader.animationStateEntries } : {}) } : {}) } }; },
  });
}

export function queryProjectRuntimeObservation(input, request = {}) {
  // Select the new DTO budget without evaluating caller-owned accessors. The
  // chosen copier still validates every descriptor, including this header.
  const header = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'project')?.value : undefined;
  const version = header && typeof header === 'object' ? Object.getOwnPropertyDescriptor(header, 'protocolVersion')?.value : undefined;
  const view = [9, 10, 11].includes(version) ? copyEntriesObservation(input) : version === 8 ? copyStatesObservation(input) : version === 7 ? copyCompletionObservation(input) : version === 6 ? copyClipObservation(input) : version === 5 ? copyAnimationObservation(input) : version === 4 ? copyAudioObservation(input) : version === 3 ? copyEventObservation(input) : copy(input), project = view.project;
  const shared = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(project?.protocolVersion), messaging = [3, 4, 5, 6, 7, 8, 9, 10, 11].includes(project?.protocolVersion), audio = [4, 5, 6, 7, 8, 9, 10, 11].includes(project?.protocolVersion), animation = [5, 6, 7, 8, 9, 10, 11].includes(project?.protocolVersion), completion = [7, 8, 9, 10, 11].includes(project?.protocolVersion), states = [8, 9, 10, 11].includes(project?.protocolVersion), entries = [9, 10, 11].includes(project?.protocolVersion);
  if (!exact(project, ['assemblyId', 'entrySceneId', 'activeSceneId', 'visits', ...(shared ? ['protocolVersion', 'sharedState'] : []), ...(messaging ? ['events'] : []), ...(audio ? ['audioCommands'] : []), ...(animation ? ['animationCommands'] : []), ...(completion ? ['animationCompletions'] : []), ...(states ? ['animationStates'] : []), ...(entries ? ['animationStateEntries'] : [])]) || !uuid(project.assemblyId)
    || !uuid(project.entrySceneId) || !uuid(project.activeSceneId) || project.activeSceneId === project.assemblyId
    || project.entrySceneId === project.assemblyId || !Array.isArray(project.visits) || project.visits.length > PROJECT_RUNTIME_MAX_VISITS) throw invalid();
  delete view.project;
  const result = querySceneRuntimeObservation(view, request);
  if (result.sceneObjectId !== project.activeSceneId) throw invalid();
  for (const [index, visit] of project.visits.entries()) {
    if (!exact(visit, ['index', 'sceneId', 'phase', 'elapsedSeconds']) || visit.index !== index + 1 || !uuid(visit.sceneId)
      || visit.sceneId === project.assemblyId || !['waiting', 'ready', 'left', 'finished'].includes(visit.phase) || !time(visit.elapsedSeconds)
      || ['waiting', 'ready'].includes(visit.phase) && visit.elapsedSeconds !== 0
      || index === 0 && visit.sceneId !== project.entrySceneId
      || index > 0 && visit.sceneId === project.visits[index - 1].sceneId
      || index < project.visits.length - 1 && visit.phase !== 'left') throw invalid();
  }
  const last = project.visits.at(-1);
  if (!last ? result.phase !== 'waiting' || project.activeSceneId !== project.entrySceneId
    : last.phase === 'left' ? result.phase !== 'waiting' || project.activeSceneId === last.sceneId
      : result.phase !== last.phase || project.activeSceneId !== last.sceneId) throw invalid();
  if (shared) {
    project.sharedState = validateProjectSharedStateSnapshot(project.sharedState);
    const origins = [...project.sharedState.entries.map(entry => entry.origin), ...(project.sharedState.lastChange ? [project.sharedState.lastChange.origin] : [])];
    for (const origin of origins) {
      const visit = project.visits[origin.visitIndex - 1];
      if (!visit || visit.sceneId !== origin.sceneId || visit.phase === 'waiting') throw invalid();
    }
  }
  if (messaging) {
    project.events = validateProjectEventSnapshot(project.events);
    for (const entry of project.events.entries) {
      for (const origin of [entry.origin, ...entry.deliveries.map(delivery => delivery.origin)]) {
        const visit = project.visits[origin.visitIndex - 1];
        if (!visit || visit.sceneId !== origin.sceneId || visit.phase === 'waiting') throw invalid();
      }
      if (entry.deliveries.some(delivery => delivery.status === 'pending')
        && (entry.origin.visitIndex !== last?.index || last.phase !== 'ready')) throw invalid();
    }
  }
  if (audio) {
    project.audioCommands = validateProjectAudioCommandsSnapshot(project.audioCommands);
    for (const command of project.audioCommands.entries) {
      const visit = project.visits[command.origin.visitIndex - 1];
      if (!visit || visit.sceneId !== command.origin.sceneId || visit.phase === 'waiting'
        || ['left', 'finished'].includes(visit.phase) && command.timeSeconds > visit.elapsedSeconds) throw invalid();
    }
  }
  if (animation) {
    project.animationCommands = validateProjectAnimationCommandsSnapshot(project.animationCommands, { protocolVersion: project.protocolVersion });
    for (const command of project.animationCommands.entries) {
      const visit = project.visits[command.origin.visitIndex - 1];
      if (!visit || visit.sceneId !== command.origin.sceneId || visit.phase === 'waiting'
        || ['left', 'finished'].includes(visit.phase) && command.state.timeSeconds > visit.elapsedSeconds) throw invalid();
    }
  }
  if (completion) {
    project.animationCompletions = validateProjectAnimationCompletionsSnapshot(project.animationCompletions, { protocolVersion: project.protocolVersion });
    validateProjectAnimationCompletionTimeline(project.animationCompletions, project.animationCommands, { protocolVersion: project.protocolVersion });
    for (const entry of project.animationCompletions.entries) {
      const visit = project.visits[entry.visitIndex - 1];
      if (!visit || visit.sceneId !== entry.sceneId || visit.phase === 'waiting'
        || ['left', 'finished'].includes(visit.phase) && entry.state.timeSeconds > visit.elapsedSeconds
        || entry.deliveries.some(delivery => delivery.status === 'pending') && (entry.visitIndex !== last?.index || last.phase !== 'ready')) throw invalid();
    }
  }
  if (states) {
    project.animationStates = validateProjectAnimationStatesSnapshot(project.animationStates);
    validateProjectAnimationStatesTimeline(project.animationStates, project.animationCommands, project.visits);
  }
  if (entries) {
    project.animationStateEntries = (version >= 10 ? validateProjectAnimationStateTriggeredEntriesSnapshot : validateProjectAnimationStateEntriesSnapshot)(project.animationStateEntries);
    if (version >= 10) validateProjectAnimationStateEntryTriggersTimeline(project.animationStateEntries, project.events, project.animationCompletions, project.animationCommands);
    validateProjectAnimationStateEntriesTimeline(project.animationStateEntries, project.animationCommands, project.visits, project.animationStates);
  }
  return { ...result, project };
}
