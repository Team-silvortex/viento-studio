import { createProjectAnimationStateTriggeredEntries } from './project-animation-state-entry-triggers.mjs';
import { createProjectAnimationStateEntries } from './project-animation-state-entries.mjs';
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { createSceneRuntimeEventReader } from './scene-runtime-events.mjs';
import { createSceneBehaviorEventReader } from './scene-behavior-events.mjs';
import { createSceneAudioEventReader } from './scene-audio-events.mjs';
import { advanceProjectAnimationTransport, projectAnimationClipDeclaration } from './project-animation-transport.mjs';
import { createProjectAnimationStates } from './project-animation-states.mjs';
import { createProjectAnimationCompletions } from './project-animation-completions.mjs';
import { createProjectAnimationCommands } from './project-animation-commands.mjs';
import { createProjectAudioCommands } from './project-audio-commands.mjs';
import { createProjectEventBus } from './project-event-bus.mjs';
import { createProjectSharedState } from './project-shared-state.mjs';
import { PROJECT_RUNTIME_PROTOCOL, PROJECT_RUNTIME_PREFIX, PROJECT_RUNTIME_MAX_VISITS, PROJECT_RUNTIME_MAX_EVENTS,
  PROJECT_RUNTIME_MAX_LINE, projectRuntimeExact as exact, projectRuntimeTime as time, projectRuntimeSameTime as sameTime,
  copyProjectRuntimeData as copy, freezeProjectRuntimeData as freeze } from './project-runtime-contracts.mjs';

const defaultSceneReader = (plan, options) => {
  const createBaseReader = plan.schemaVersion === 3 ? createSceneBehaviorEventReader : createSceneRuntimeEventReader;
  return plan.audio ? createSceneAudioEventReader(plan, { ...options, createBaseReader }) : createBaseReader(plan, options);
};

// Child wire frames remain unchanged inside a visit envelope. A scene-exit is
// a project boundary, never a forged child finished (which means two smoke
// steps in the legacy audio contract). Re-entering creates a new child reader.
export function createProjectRuntimeEventReader(input, { protocolVersion = PROJECT_RUNTIME_PROTOCOL, onEvent, createSceneReader = defaultSceneReader, expectedTotalSeconds } = {}) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(protocolVersion)) throw Object.assign(new TypeError('Unsupported project runtime protocol.'), { errorCode: 'runtime_project_invalid' });
  const sharedState = protocolVersion >= 2 ? createProjectSharedState() : null;
  const eventBus = protocolVersion >= 3 ? createProjectEventBus() : null;
  const audioCommands = protocolVersion >= 4 ? createProjectAudioCommands() : null;
  const animationCommands = protocolVersion >= 5 ? createProjectAnimationCommands({ protocolVersion }) : null;
  const animationCompletions = protocolVersion >= 7 ? createProjectAnimationCompletions() : null;
  // Hosts may require a bounded deterministic run. Window sessions omit this
  // expectation and may close at any observed time, including before a step.
  if (expectedTotalSeconds !== undefined && (!time(expectedTotalSeconds) || expectedTotalSeconds > 60)) {
    throw Object.assign(new TypeError('Expected project runtime duration must be between 0 and 60 seconds.'), { errorCode: 'runtime_project_invalid' });
  }
  const plan = validateProjectAssemblyPlan(input), scenes = new Map(plan.scenes.map(scene => [scene.scene.objectId, scene]));
  const animationStates = protocolVersion >= 8 ? createProjectAnimationStates(plan) : null;
  const animationStateEntries = protocolVersion === 10 ? createProjectAnimationStateTriggeredEntries(plan) : protocolVersion === 9 ? createProjectAnimationStateEntries(plan) : null;
  if (typeof createSceneReader !== 'function') throw new TypeError('A scene runtime reader is required.');
  const events = [], diagnostics = [];
  let started = false, completed = false, current = null, visitCount = 0, nextSceneId = plan.entrySceneId, finalExit = false, totalSeconds = 0;
  let pending = '', dropping = false, ended = false, limitReported = false;
  const issue = (message = 'Invalid project runtime protocol frame.', code = 'runtime_project_protocol_invalid') => {
    if (diagnostics.length < 128) diagnostics.push(freeze({ severity: 'error', code, message,
      objectId: plan.assembly.objectId, sourcePath: plan.assembly.sourcePath, sourceRevision: plan.assembly.sourceRevision, propertyPath: '' }));
  };
  const importDiagnostics = (reader, from) => {
    for (const diagnostic of reader.diagnostics.slice(from)) if (diagnostics.length < 128) diagnostics.push(freeze(copy(diagnostic)));
  };
  const publish = frame => { const value = freeze(frame); events.push(value); onEvent?.(value); return value; };
  const currentIdentity = frame => current && frame.visitIndex === current.index && frame.sceneId === current.plan.scene.objectId;
  const actorStates = (scene, actors) => {
    const reader = createSceneRuntimeEventReader({ ...scene, schemaVersion: scene.schemaVersion === 3 ? 2 : scene.schemaVersion });
    return reader.push('VIENTO_RUNTIME:' + JSON.stringify({ protocol: scene.schemaVersion === 3 ? 2 : scene.schemaVersion,
      event: 'ready', sceneObjectId: scene.scene.objectId, actors }) + '\n').length === 1 && reader.diagnostics.length === 0;
  };
  const admit = frame => {
    if (!frame || frame.protocol !== protocolVersion || completed) { issue(); return; }
    if (current?.stateSnapshot && frame.event !== 'scene-exit'
      && !(frame.event === 'scene-event' && (frame.frame?.event === 'diagnostic'
        || frame.stream === 'audio' && frame.frame?.event === 'finished'))) { issue('A terminal animation state snapshot already closed this visit.'); return; }
    if (current?.lastStateEntryTime !== null && current?.lastStateEntryTime !== undefined
      && ['animation-command', 'animation-completed'].includes(frame.event) && frame.state?.timeSeconds < current.lastStateEntryTime) {
      issue('An animation receipt cannot precede an already accepted state entry.'); return;
    }
    if (frame.event === 'ready') {
      if (started || !exact(frame, ['protocol', 'event', 'assemblyId', 'entrySceneId', ...(sharedState ? ['stateRevision'] : []), ...(eventBus ? ['eventSequence'] : []), ...(audioCommands ? ['audioCommandSequence'] : []), ...(animationCommands ? ['animationCommandSequence'] : []), ...(animationCompletions ? ['animationCompletionSequence'] : []), ...(animationStates ? ['animationStateSequence'] : []), ...(animationStateEntries ? ['animationStateEntrySequence'] : [])])
        || sharedState && frame.stateRevision !== 0 || eventBus && frame.eventSequence !== 0 || audioCommands && frame.audioCommandSequence !== 0
        || animationCommands && frame.animationCommandSequence !== 0 || animationCompletions && frame.animationCompletionSequence !== 0
        || animationStates && frame.animationStateSequence !== 0
        || animationStateEntries && frame.animationStateEntrySequence !== 0
        || frame.assemblyId !== plan.assembly.objectId || frame.entrySceneId !== plan.entrySceneId) { issue(); return; }
      started = true;
    } else if (frame.event === 'scene-enter') {
      if (!started || current || finalExit || visitCount >= PROJECT_RUNTIME_MAX_VISITS
        || !exact(frame, ['protocol', 'event', 'visitIndex', 'sceneId']) || frame.visitIndex !== visitCount + 1
        || frame.sceneId !== nextSceneId || !scenes.has(frame.sceneId)) { issue(); return; }
      const scene = scenes.get(frame.sceneId);
      current = { index: ++visitCount, plan: scene, ready: false, audioReady: false, audioCueCount: 0, audioFailed: false, audioFinished: false, audioTime: null, lastAudioCommandTime: null, animationState: null, stateSnapshot: null, lastStateEntryTime: null,
        reader: createSceneReader(scene) };
      nextSceneId = null;
    } else if (frame.event === 'scene-event') {
      if (!started || !currentIdentity(frame) || !exact(frame, ['protocol', 'event', 'visitIndex', 'sceneId', 'stream', 'frame'])
        || !['runtime', 'audio'].includes(frame.stream) || frame.stream === 'audio' && !current.plan.audio
        || !frame.frame || typeof frame.frame !== 'object' || frame.stream === 'runtime' && frame.frame.event === 'finished') { issue(); return; }
      const before = current.reader.diagnostics.length;
      const admitted = current.reader.push((frame.stream === 'audio' ? 'VIENTO_AUDIO:' : 'VIENTO_RUNTIME:') + JSON.stringify(frame.frame) + '\n');
      importDiagnostics(current.reader, before);
      if (admitted.length !== 1) { if (current.reader.diagnostics.length === before) issue(); return; }
      if (frame.stream === 'runtime' && frame.frame.event === 'ready') current.ready = true;
      if (frame.frame.event === 'diagnostic') current.audioFailed = true;
      if (frame.stream === 'audio' && frame.frame.event === 'ready') current.audioReady = true;
      if (frame.stream === 'audio' && frame.frame.event === 'command') current.audioCueCount++;
      if (frame.stream === 'audio' && frame.frame.event === 'finished') { current.audioFinished = true; current.audioTime = frame.frame.timeSeconds; }
    } else if (frame.event === 'state') {
      const setting = frame.operation === 'set';
      if (!sharedState || !currentIdentity(frame) || !current.ready
        || !exact(frame, ['protocol', 'event', 'visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId', 'revision', 'operation', 'key', ...(setting ? ['value'] : [])])) { issue(); return; }
      const binding = current.plan.behaviors?.bindings.find(candidate => candidate.bindingId === frame.bindingId
        && candidate.instanceId === frame.instanceId && candidate.objectId === frame.objectId);
      if (!binding) { issue(); return; }
      try {
        sharedState.apply({ operation: frame.operation, key: frame.key, revision: frame.revision, ...(setting ? { value: frame.value } : {}),
          origin: { visitIndex: frame.visitIndex, sceneId: frame.sceneId, bindingId: binding.bindingId, instanceId: binding.instanceId,
            objectId: binding.objectId, source: binding.declaration } });
      } catch { issue(); return; }
    } else if (frame.event === 'event-publish') {
      if (!eventBus || !currentIdentity(frame) || !current.ready
        || !exact(frame, ['protocol', 'event', 'visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId', 'sequence', 'name', 'value', 'recipients'])
        || !Array.isArray(frame.recipients)) { issue(); return; }
      const origin = identity => {
        const binding = current.plan.behaviors?.bindings.find(candidate => candidate.bindingId === identity.bindingId
          && candidate.instanceId === identity.instanceId && candidate.objectId === identity.objectId);
        if (!binding) throw new TypeError('Unknown frozen project event binding.');
        return { visitIndex: frame.visitIndex, sceneId: frame.sceneId, bindingId: binding.bindingId, instanceId: binding.instanceId,
          objectId: binding.objectId, source: binding.declaration };
      };
      try {
        eventBus.publish({ sequence: frame.sequence, name: frame.name, value: frame.value, origin: origin(frame),
          recipients: frame.recipients.map(recipient => {
            if (!exact(recipient, ['subscriptionId', 'bindingId', 'instanceId', 'objectId'])) throw new TypeError('Invalid project event recipient.');
            return { subscriptionId: recipient.subscriptionId, origin: origin(recipient) };
          }) });
      } catch { issue(); return; }
    } else if (frame.event === 'event-delivery') {
      if (!eventBus || !currentIdentity(frame) || !current.ready
        || !exact(frame, ['protocol', 'event', 'visitIndex', 'sceneId', 'sequence', 'subscriptionId', 'status'])) { issue(); return; }
      try {
        animationStateEntries?.validateDelivery?.('event', frame.sequence, frame.subscriptionId, frame.status);
        eventBus.deliver({ sequence: frame.sequence, subscriptionId: frame.subscriptionId, status: frame.status, visitIndex: frame.visitIndex, sceneId: frame.sceneId }); }
      catch { issue(); return; }
    } else if (frame.event === 'audio-command') {
      if (!audioCommands || !currentIdentity(frame) || !current.ready || !current.audioReady || current.audioFailed || current.audioFinished
        || !exact(frame, ['protocol', 'event', 'commandSequence', 'visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId', 'trackId', 'resourceId', 'action', 'timeSeconds'])) { issue(); return; }
      const binding = current.plan.behaviors?.bindings.find(candidate => candidate.bindingId === frame.bindingId
        && candidate.instanceId === frame.instanceId && candidate.objectId === frame.objectId);
      const track = current.plan.audio?.document.tracks.find(candidate => candidate.id === frame.trackId && candidate.resourceId === frame.resourceId);
      const source = current.plan.audio?.locations.tracks.find(candidate => candidate.id === frame.trackId)?.declaration;
      if (!binding || !track || !source
        || current.audioCueCount !== current.plan.audio.document.cues.filter(cue => cue.atSeconds <= frame.timeSeconds).length) { issue(); return; }
      try {
        audioCommands.append({ sequence: frame.commandSequence, action: frame.action, timeSeconds: frame.timeSeconds,
          origin: { visitIndex: frame.visitIndex, sceneId: frame.sceneId, bindingId: binding.bindingId, instanceId: binding.instanceId,
            objectId: binding.objectId, source: binding.declaration }, track: { trackId: track.id, resourceId: track.resourceId, source } });
      } catch { issue(); return; }
      current.lastAudioCommandTime = frame.timeSeconds;
    } else if (frame.event === 'animation-command') {
      if (!animationCommands || !currentIdentity(frame) || !current.ready || current.audioFailed || current.audioFinished || !current.plan.animation
        || !exact(frame, ['protocol', 'event', 'commandSequence', 'visitIndex', 'sceneId', 'bindingId', 'instanceId', 'objectId', 'command', 'state'])) { issue(); return; }
      const binding = current.plan.behaviors?.bindings.find(candidate => candidate.bindingId === frame.bindingId
        && candidate.instanceId === frame.instanceId && candidate.objectId === frame.objectId);
      if (!binding) { issue(); return; }
      try {
        const animation = current.plan.animation;
        if (animationCompletions && (!current.animationState || current.animationState.phase === 'playing')) {
          const natural = advanceProjectAnimationTransport(animation, protocolVersion, { state: current.animationState,
            timeSeconds: frame.state?.timeSeconds, command: null });
          if (natural.phase === 'finished') throw new TypeError('Natural completion must precede a later command.');
        }
        const state = advanceProjectAnimationTransport(animation, protocolVersion, { state: current.animationState,
          timeSeconds: frame.state?.timeSeconds, command: frame.command });
        if (!exact(frame.state, ['sceneObjectId', 'phase', 'positionSeconds', 'timeSeconds', ...(protocolVersion >= 6 ? ['clipId'] : [])])
          || !Number.isFinite(frame.state.positionSeconds) || frame.state.positionSeconds < 0
          || protocolVersion >= 6 && state.clipId !== frame.state.clipId
          || state.sceneObjectId !== frame.state.sceneObjectId || state.phase !== frame.state.phase
          || state.timeSeconds !== frame.state.timeSeconds || !sameTime(state.positionSeconds, frame.state.positionSeconds)) throw new TypeError('Animation transport receipt mismatch.');
        // Keep the Rust state, never accumulate backend rounding in subsequent transitions.
        animationCommands.append({ sequence: frame.commandSequence, command: frame.command, state,
          origin: { visitIndex: frame.visitIndex, sceneId: frame.sceneId, bindingId: binding.bindingId, instanceId: binding.instanceId,
            objectId: binding.objectId, source: binding.declaration },
          animation: { objectId: animation.manifest.objectId, source: { ...animation.manifest, propertyPath: '' },
            durationSeconds: animation.document.durationSeconds, loop: animation.document.loop },
          ...(protocolVersion >= 6 ? { clip: projectAnimationClipDeclaration(animation, state.clipId) } : {}) });
        current.animationState = state;
      } catch { issue(); return; }
    } else if (frame.event === 'animation-completed') {
      if (!animationCompletions || !currentIdentity(frame) || !current.ready || current.audioFailed || current.audioFinished || !current.plan.animation
        || !exact(frame, ['protocol', 'event', 'completionSequence', 'commandSequence', 'visitIndex', 'sceneId', 'state', 'recipients'])
        || frame.commandSequence !== animationCommands.sequence || !Array.isArray(frame.recipients)
        || current.animationState && current.animationState.phase !== 'playing') { issue(); return; }
      try {
        const animation = current.plan.animation;
        const state = advanceProjectAnimationTransport(animation, protocolVersion, { state: current.animationState,
          timeSeconds: frame.state?.timeSeconds, command: null });
        if (state.phase !== 'finished' || !exact(frame.state, ['sceneObjectId', 'phase', 'positionSeconds', 'timeSeconds', 'clipId'])
          || frame.state.phase !== state.phase || frame.state.sceneObjectId !== state.sceneObjectId || frame.state.clipId !== state.clipId
          || frame.state.timeSeconds !== state.timeSeconds || frame.state.positionSeconds !== state.positionSeconds
          || current.lastAudioCommandTime !== null && state.timeSeconds < current.lastAudioCommandTime) throw new TypeError('Animation completion receipt mismatch.');
        animationCompletions.append({ sequence: frame.completionSequence, commandSequence: frame.commandSequence,
          visitIndex: frame.visitIndex, sceneId: frame.sceneId, state,
          animation: { objectId: animation.manifest.objectId, source: { ...animation.manifest, propertyPath: '' },
            durationSeconds: animation.document.durationSeconds, loop: animation.document.loop },
          clip: projectAnimationClipDeclaration(animation, state.clipId),
          recipients: frame.recipients.map(recipient => {
            if (!exact(recipient, ['subscriptionId', 'bindingId', 'instanceId', 'objectId'])) throw new TypeError('Invalid animation completion recipient.');
            const binding = current.plan.behaviors?.bindings.find(candidate => candidate.bindingId === recipient.bindingId
              && candidate.instanceId === recipient.instanceId && candidate.objectId === recipient.objectId);
            if (!binding) throw new TypeError('Unknown frozen animation completion binding.');
            return { subscriptionId: recipient.subscriptionId, origin: { visitIndex: frame.visitIndex, sceneId: frame.sceneId,
              bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId, source: binding.declaration } };
          }) });
        current.animationState = state;
      } catch { issue(); return; }
    } else if (frame.event === 'animation-completion-delivery') {
      if (!animationCompletions || !currentIdentity(frame) || !current.ready || current.audioFailed || current.audioFinished
        || !exact(frame, ['protocol', 'event', 'completionSequence', 'subscriptionId', 'visitIndex', 'sceneId', 'status'])) { issue(); return; }
      try {
        animationStateEntries?.validateDelivery?.('completed', frame.completionSequence, frame.subscriptionId, frame.status);
        animationCompletions.deliver({ sequence: frame.completionSequence, subscriptionId: frame.subscriptionId,
          visitIndex: frame.visitIndex, sceneId: frame.sceneId, status: frame.status }, animationCommands.sequence);
      } catch { issue(); return; }
    } else if (frame.event === 'animation-state-entered') {
      if (!animationStateEntries || !currentIdentity(frame) || !current.ready || current.audioFailed || current.audioFinished
        || !exact(frame, ['protocol', 'event', 'sequence', 'visitIndex', 'sceneId', 'timeSeconds', 'commandSequence', 'bindingId', 'instanceId', 'objectId', 'stateIndex', 'clipId', ...(protocolVersion === 10 ? ['trigger'] : [])])
        || frame.commandSequence !== animationCommands.sequence || !time(frame.timeSeconds)
        || current.lastAudioCommandTime !== null && current.lastAudioCommandTime > frame.timeSeconds
        || current.animationState && current.animationState.timeSeconds > frame.timeSeconds) { issue(); return; }
      try {
        const { protocol, event, ...entry } = frame;
        if (protocolVersion === 10) animationStateEntries.append(entry, eventBus.snapshot(), animationCompletions.snapshot());
        else animationStateEntries.append(entry);
        current.lastStateEntryTime = frame.timeSeconds;
      } catch { issue(); return; }
    } else if (frame.event === 'animation-state-snapshot') {
      if (!animationStates || !currentIdentity(frame) || !current.ready || current.stateSnapshot
        || !exact(frame, ['protocol', 'event', 'sequence', 'visitIndex', 'sceneId', 'timeSeconds', 'commandSequence', 'reason', 'controllers'])
        || frame.commandSequence !== animationCommands.sequence || !time(frame.timeSeconds)
        || current.lastAudioCommandTime !== null && current.lastAudioCommandTime > frame.timeSeconds
        || current.animationState && current.animationState.timeSeconds > frame.timeSeconds
        || (frame.reason === 'aborted' ? !current.audioFailed : current.audioFailed || eventBus.pendingCount || animationCompletions.pendingCount)) { issue(); return; }
      try {
        const { protocol, event, ...snapshot } = frame;
        animationStateEntries?.validateTerminalSnapshot(snapshot);
        animationStates.append(snapshot);
        current.stateSnapshot = { reason: frame.reason, timeSeconds: frame.timeSeconds };
      } catch { issue(); return; }
    } else if (frame.event === 'scene-exit') {
      const switching = frame.reason === 'switch';
      if (!currentIdentity(frame) || !current.ready || eventBus?.pendingCount || animationCompletions?.pendingCount || !exact(frame, ['protocol', 'event', 'visitIndex', 'sceneId', 'reason', 'elapsedSeconds', 'actors', ...(switching ? ['nextSceneId'] : [])])
        || animationStates?.hasScene(frame.sceneId) && (!current.stateSnapshot || current.stateSnapshot.reason !== frame.reason || current.stateSnapshot.timeSeconds !== frame.elapsedSeconds)
        || !['switch', 'finished'].includes(frame.reason) || !time(frame.elapsedSeconds) || !time(totalSeconds + frame.elapsedSeconds)
        || switching && (!scenes.has(frame.nextSceneId) || frame.nextSceneId === frame.sceneId || visitCount >= PROJECT_RUNTIME_MAX_VISITS)
        || current.lastAudioCommandTime !== null && current.lastAudioCommandTime > frame.elapsedSeconds
        || current.animationState && current.animationState.timeSeconds > frame.elapsedSeconds
        || !actorStates(current.plan, frame.actors)
        || current.plan.audio && (!current.audioFinished || !sameTime(current.audioTime, frame.elapsedSeconds))) { issue(); return; }
      if (animationCompletions && current.plan.animation && (!current.animationState || current.animationState.phase === 'playing')) {
        try {
          const natural = advanceProjectAnimationTransport(current.plan.animation, protocolVersion,
            { state: current.animationState, timeSeconds: frame.elapsedSeconds, command: null });
          if (natural.phase === 'finished') { issue('Natural animation completion is missing before scene exit.'); return; }
        } catch { issue(); return; }
      }
      const before = current.reader.diagnostics.length; current.reader.finish(); importDiagnostics(current.reader, before);
      totalSeconds += frame.elapsedSeconds; nextSceneId = switching ? frame.nextSceneId : null; finalExit = !switching; current = null;
    } else if (frame.event === 'finished') {
      if (!started || current || !finalExit || !exact(frame, ['protocol', 'event', 'assemblyId', 'visitCount', 'totalSeconds', ...(sharedState ? ['stateRevision'] : []), ...(eventBus ? ['eventSequence'] : []), ...(audioCommands ? ['audioCommandSequence'] : []), ...(animationCommands ? ['animationCommandSequence'] : []), ...(animationCompletions ? ['animationCompletionSequence'] : []), ...(animationStates ? ['animationStateSequence'] : []), ...(animationStateEntries ? ['animationStateEntrySequence'] : [])])
        || sharedState && frame.stateRevision !== sharedState.revision
        || eventBus && (frame.eventSequence !== eventBus.sequence || eventBus.pendingCount)
        || audioCommands && frame.audioCommandSequence !== audioCommands.sequence
        || animationCommands && frame.animationCommandSequence !== animationCommands.sequence
        || animationCompletions && (frame.animationCompletionSequence !== animationCompletions.sequence || animationCompletions.pendingCount)
        || animationStates && frame.animationStateSequence !== animationStates.sequence
        || animationStateEntries && frame.animationStateEntrySequence !== animationStateEntries.sequence
        || frame.assemblyId !== plan.assembly.objectId || frame.visitCount !== visitCount || !time(frame.totalSeconds)
        || !sameTime(frame.totalSeconds, totalSeconds)) { issue(); return; }
      if (expectedTotalSeconds !== undefined && !sameTime(frame.totalSeconds, expectedTotalSeconds)) {
        issue('Project runtime did not complete the expected duration.', 'runtime_protocol_incomplete'); return;
      }
      completed = true;
    } else { issue(); return; }
    publish(frame);
  };
  const line = text => {
    if (!text.startsWith(PROJECT_RUNTIME_PREFIX)) {
      if (/^VIENTO_(?:RUNTIME|AUDIO):/.test(text)) issue('A child runtime frame escaped its project visit.');
      return;
    }
    if (events.length >= PROJECT_RUNTIME_MAX_EVENTS) { if (!limitReported) { issue('Project runtime event budget exceeded.'); limitReported = true; } return; }
    let frame; try { frame = copy(JSON.parse(text.slice(PROJECT_RUNTIME_PREFIX.length))); } catch { issue(); return; }
    admit(frame);
  };
  const api = {
    get events() { return events.slice(); }, get diagnostics() { return diagnostics.slice(); },
    push(text) {
      if (ended || typeof text !== 'string') return [];
      const start = events.length;
      for (const piece of text.split(/(?<=\n)/)) {
        const complete = piece.endsWith('\n');
        if (!dropping) {
          if (pending.length + piece.length > PROJECT_RUNTIME_MAX_LINE) {
            if (/^VIENTO_(?:PROJECT|RUNTIME|AUDIO):/.test(pending + piece.slice(0, 20))) issue('Project runtime frame budget exceeded.');
            pending = ''; dropping = true;
          } else pending += piece;
        }
        if (complete) { if (!dropping) line(pending.replace(/\r?\n$/, '')); pending = ''; dropping = false; }
      }
      return events.slice(start);
    },
    finish() {
      if (!ended) {
        if (pending && !dropping) line(pending);
        if (current) { const before = current.reader.diagnostics.length; current.reader.finish(); importDiagnostics(current.reader, before); }
        pending = ''; ended = true;
      }
      // Cancellation and process errors may leave a live visit. Only the host
      // decides whether missing project finished is an unsuccessful process.
      return { events: events.slice(), diagnostics: diagnostics.slice() };
    },
  };
  if (sharedState) Object.defineProperty(api, 'sharedState', { enumerable: true, get: () => sharedState.snapshot() });
  if (eventBus) Object.defineProperty(api, 'projectEvents', { enumerable: true, get: () => eventBus.snapshot() });
  if (audioCommands) Object.defineProperty(api, 'audioCommands', { enumerable: true, get: () => audioCommands.snapshot() });
  if (animationCommands) Object.defineProperty(api, 'animationCommands', { enumerable: true, get: () => animationCommands.snapshot() });
  if (animationCompletions) Object.defineProperty(api, 'animationCompletions', { enumerable: true, get: () => animationCompletions.snapshot() });
  if (animationStates) Object.defineProperty(api, 'animationStates', { enumerable: true, get: () => animationStates.snapshot() });
  if (animationStateEntries) Object.defineProperty(api, 'animationStateEntries', { enumerable: true, get: () => animationStateEntries.snapshot() });
  return Object.freeze(api);
}
