// Read-only snapshots of fixed generated controllers. State means that the
// script accepted its select/play requests; it is not an executed-playback receipt.
import { canonicalJson } from './canonical-json.mjs';
import { validateProjectAssemblyPlan } from './project-assembly-plan-contract.mjs';
import { hasAnimationStateScriptMarker, readAnimationStateScriptSource } from './animation-state-script-source.mjs';
import { copyProjectStateOrigin as originCopy } from './project-shared-state.mjs';
import { projectRuntimeExact as exact, projectRuntimeUuid as uuid, projectRuntimeTime as time,
  copyProjectRuntimeData as copy, copyProjectAnimationStatesSnapshotData as detach,
  freezeProjectRuntimeData as freeze, invalidProjectRuntime as invalid } from './project-runtime-contracts.mjs';

export const PROJECT_ANIMATION_STATE_LIMITS = Object.freeze({ snapshots: 64, controllersPerSnapshot: 32, controllers: 2048 });
const stateKey = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value);
const integer = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const rejectedSource = error => /^animation_state_script_source_(?:invalid|modified|unsupported|limit)$/.test(error?.errorCode || '');

export function createProjectAnimationStateCatalog(input) {
  const plan = validateProjectAssemblyPlan(input), scenes = [];
  for (const scene of plan.scenes) {
    if (!scene.animation || !scene.behaviors || scene.behaviors.backendId !== 'org.viento.godot4' || scene.behaviors.language !== 'gdscript') continue;
    const recognized = new Map();
    for (const source of scene.behaviors.sources) {
      if (!hasAnimationStateScriptMarker(source.content)) continue;
      try { recognized.set(source.objectId, { source, declaration: readAnimationStateScriptSource(source.content) }); }
      catch (error) { if (!rejectedSource(error)) throw error; }
    }
    const controllers = [];
    for (const binding of scene.behaviors.bindings) {
      const matched = recognized.get(binding.implementation.sourceObjectId);
      if (!matched) continue;
      const { source, declaration } = matched;
      const clips = declaration.parameters.map(parameter => {
        const value = Object.hasOwn(binding.parameters, parameter.name) ? binding.parameters[parameter.name] : parameter.defaultValue;
        if (typeof value !== 'string' || value !== '' && !uuid(value)) {
          const details = { ...binding.declaration, propertyPath: `${binding.declaration.propertyPath}/parameters/${parameter.name}`,
            bindingId: binding.bindingId, instanceId: binding.instanceId, parameter: parameter.name };
          const errorCode = 'build_animation_state_parameters_invalid';
          throw Object.assign(new TypeError('Animation state clip parameters require a lowercase UUID or empty text.'), {
            errorCode, ...details, diagnostics: [{ severity: 'error', code: errorCode,
              message: 'Animation state clip parameters require a lowercase UUID or empty text.', ...details }],
          });
        }
        return value === '' ? null : value;
      });
      controllers.push({ bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId,
        scriptObjectId: source.objectId, states: declaration.table.states.map(state => state.key), clips,
        source: binding.declaration, scriptSource: { objectId: source.objectId, sourcePath: source.sourcePath,
          sourceRevision: source.sourceRevision, propertyPath: '' } });
    }
    if (controllers.length) scenes.push({ sceneId: scene.scene.objectId, controllers });
  }
  return freeze({ scenes });
}

function entryData(input, previous, identities) {
  if (!exact(input, ['sequence', 'visitIndex', 'sceneId', 'timeSeconds', 'commandSequence', 'reason', 'controllers'])
    || !integer(input.sequence, 1, 64) || input.sequence !== (previous?.sequence || 0) + 1
    || !integer(input.visitIndex, 1, 64) || !uuid(input.sceneId) || !time(input.timeSeconds)
    || !integer(input.commandSequence, 0, 256) || !['switch', 'finished', 'aborted'].includes(input.reason)
    || !Array.isArray(input.controllers) || !integer(input.controllers.length, 1, 32)
    || previous && (input.visitIndex <= previous.visitIndex || input.commandSequence < previous.commandSequence
      || previous.reason !== 'switch')) throw invalid();
  const seen = new Set(), controllers = input.controllers.map(controller => {
    if (!exact(controller, ['origin', 'scriptSource', 'status', 'stateKey', 'clipId'])
      || !['active', 'inactive', 'unavailable'].includes(controller.status)
      || (controller.status === 'active' ? !stateKey(controller.stateKey) || controller.clipId !== null && !uuid(controller.clipId)
        : controller.stateKey !== null || controller.clipId !== null)) throw invalid();
    const origin = originCopy(controller.origin), scriptSource = originCopy({ ...origin, source: controller.scriptSource }).source;
    if (origin.visitIndex !== input.visitIndex || origin.sceneId !== input.sceneId || scriptSource.propertyPath !== ''
      || Object.hasOwn(scriptSource, 'sourceRange') || seen.has(origin.bindingId)) throw invalid();
    seen.add(origin.bindingId);
    const key = `${origin.sceneId}/${origin.bindingId}`, identity = canonicalJson({ ...origin, visitIndex: 0, scriptSource });
    if (identities.has(key) && identities.get(key) !== identity) throw invalid();
    identities.set(key, identity);
    return { origin, scriptSource, status: controller.status, stateKey: controller.stateKey, clipId: controller.clipId };
  });
  return { ...input, controllers };
}

export function validateProjectAnimationStatesSnapshot(input) {
  const snapshot = detach(input);
  if (!exact(snapshot, ['sequence', 'entries']) || !integer(snapshot.sequence, 0, 64)
    || !Array.isArray(snapshot.entries) || snapshot.entries.length !== snapshot.sequence) throw invalid();
  const entries = [], identities = new Map(); let count = 0;
  for (const entry of snapshot.entries) {
    const checked = entryData(entry, entries.at(-1), identities);
    if ((count += checked.controllers.length) > 2048) throw invalid();
    entries.push(checked);
  }
  return { sequence: snapshot.sequence, entries };
}

export function createProjectAnimationStates(input) {
  const catalog = createProjectAnimationStateCatalog(input), scenes = new Map(catalog.scenes.map(scene => [scene.sceneId, scene.controllers]));
  const entries = [], identities = new Map();
  return Object.freeze({
    get sequence() { return entries.length; },
    hasScene(sceneId) { return scenes.has(sceneId); },
    append(inputEntry) {
      const input = copy(inputEntry), expected = scenes.get(input.sceneId), candidate = new Map(identities);
      if (!exact(input, ['sequence', 'visitIndex', 'sceneId', 'timeSeconds', 'commandSequence', 'reason', 'controllers'])
        || !expected || !Array.isArray(input.controllers) || input.controllers.length !== expected.length) throw invalid();
      const controllers = input.controllers.map((actual, index) => {
        const declared = expected[index];
        if (!exact(actual, ['bindingId', 'instanceId', 'objectId', 'status', 'stateIndex', 'clipId'])
          || !['bindingId', 'instanceId', 'objectId'].every(key => actual[key] === declared[key])
          || !['active', 'inactive', 'unavailable'].includes(actual.status)) throw invalid();
        if (actual.status === 'active' ? !integer(actual.stateIndex, 0, declared.states.length - 1) || actual.clipId !== declared.clips[actual.stateIndex]
          : actual.status === 'inactive' ? actual.stateIndex !== -1 || actual.clipId !== null
            : actual.stateIndex !== null || actual.clipId !== null) throw invalid();
        return { origin: { visitIndex: input.visitIndex, sceneId: input.sceneId, bindingId: declared.bindingId,
          instanceId: declared.instanceId, objectId: declared.objectId, source: declared.source }, scriptSource: declared.scriptSource,
          status: actual.status, stateKey: actual.status === 'active' ? declared.states[actual.stateIndex] : null, clipId: actual.clipId };
      });
      const entry = entryData({ ...input, controllers }, entries.at(-1), candidate);
      entries.push(entry); for (const [key, value] of candidate) identities.set(key, value);
    },
    snapshot() { return detach({ sequence: entries.length, entries }); },
  });
}

export function validateProjectAnimationStatesTimeline(snapshot, commands, visits) {
  for (const entry of snapshot.entries) {
    const visit = visits[entry.visitIndex - 1], preceding = commands.entries[entry.commandSequence - 1], following = commands.entries[entry.commandSequence];
    if (!visit || visit.sceneId !== entry.sceneId || visit.phase === 'waiting' || entry.commandSequence > commands.sequence
      || preceding && (preceding.origin.visitIndex > entry.visitIndex || preceding.origin.visitIndex === entry.visitIndex && preceding.state.timeSeconds > entry.timeSeconds)
      || following && following.origin.visitIndex <= entry.visitIndex
      || ['left', 'finished'].includes(visit.phase) && (entry.reason !== (visit.phase === 'left' ? 'switch' : 'finished') || entry.timeSeconds !== visit.elapsedSeconds)
      || entry.reason === 'aborted' && (visit.phase !== 'ready' || entry.visitIndex !== visits.at(-1)?.index)) throw invalid();
  }
  return snapshot;
}
