// Saved-scene preview playback only. The catalog owns frozen source identity;
// Rust owns transport and sampling. This session owns explicit clocks and never
// changes author documents, project runtime protocol or scene-wide playback.
import { isSceneAnimationPreview } from './scene-animation-preview.mjs';
import { inspectSceneAnimation, advanceSceneAnimationTransport, advanceSceneAnimationClipTransport,
  sampleSceneAnimation, sampleSceneAnimationClip } from './scene-animation-core.mjs';

export const SCENE_ANIMATION_INSTANCE_PLAYBACK_LIMITS = Object.freeze({ instances: 32, timeSeconds: 86400 });
const invalid = () => { throw Object.assign(new TypeError('Invalid saved scene instance animation playback.'),
  { errorCode: 'scene_animation_instance_playback_invalid' }); };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function commandData(value, all = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const fields = Object.getOwnPropertyDescriptors(value), actionField = fields.action;
  if (!actionField?.enumerable || !Object.hasOwn(actionField, 'value')) invalid();
  const action = actionField.value;
  if (!(all ? ['pause', 'stop'] : ['select', 'play', 'pause', 'stop', 'seek']).includes(action)) invalid();
  const keys = ['action', ...(action === 'select' ? ['clipId'] : action === 'seek' ? ['positionSeconds'] : [])];
  if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) invalid();
  const result = Object.fromEntries(keys.map(key => [key, fields[key].value]));
  if (action === 'select' && result.clipId !== null && (typeof result.clipId !== 'string'
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.clipId))) invalid();
  if (action === 'seek' && (!Number.isFinite(result.positionSeconds) || result.positionSeconds < 0 || result.positionSeconds > 60)) invalid();
  return result;
}
function native(operation) {
  try { return operation(); }
  catch (error) {
    if (['scene_animation_invalid', 'studio_core_request_invalid'].includes(error?.errorCode)) invalid();
    throw error;
  }
}
export function createSceneAnimationInstancePlayback(catalog) {
  // Brand before field access: a clone, accessor object, draft or foreign source
  // cannot acquire the saved-preview capability by reproducing its fields.
  if (!isSceneAnimationPreview(catalog) || catalog.status !== 'ready') invalid();
  const document = inspectSceneAnimation(catalog.document).document;
  const instanceIds = [...new Set(document.tracks.map(track => track.instanceId))];
  if (!instanceIds.length || instanceIds.length > SCENE_ANIMATION_INSTANCE_PLAYBACK_LIMITS.instances) invalid();
  const documents = instanceIds.map(instanceId => inspectSceneAnimation({ ...document,
    tracks: document.tracks.filter(track => track.instanceId === instanceId) }).document);
  const clips = document.schemaVersion >= 3;
  const transport = (index, state, timeSeconds, command) => native(() => {
    const request = { document: documents[index], state, timeSeconds, command };
    if (clips) return advanceSceneAnimationClipTransport(request);
    if (command?.action === 'select') {
      // Legacy documents have only the whole animation. Explicit null selection
      // still resets and pauses using Rust's two existing transport operations.
      const stopped = advanceSceneAnimationTransport({ ...request, command: { action: 'stop' } });
      return advanceSceneAnimationTransport({ ...request, state: stopped, command: { action: 'pause' } });
    }
    return advanceSceneAnimationTransport(request);
  });
  let rows = instanceIds.map((_, index) => ({ state: transport(index, null, 0, { action: 'stop' }), active: false }));
  function capture(next, timeSeconds) {
    const instances = next.map(({ state, active }, index) => ({ instanceId: instanceIds[index], clipId: clips ? state.clipId : null,
      phase: state.phase, positionSeconds: state.positionSeconds, active,
      sample: active ? native(() => clips ? sampleSceneAnimationClip(documents[index], state.clipId, state.positionSeconds)
        : sampleSceneAnimation(documents[index], state.positionSeconds)) : null }));
    return freeze({ snapshotId: catalog.snapshotId, scene: catalog.scene, manifest: catalog.manifest, timeSeconds, instances });
  }
  let snapshot = capture(rows, 0);
  function update(timeSeconds, selectedIndex = null, command = null, all = false) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < snapshot.timeSeconds
      || timeSeconds < 0 || timeSeconds > SCENE_ANIMATION_INSTANCE_PLAYBACK_LIMITS.timeSeconds) invalid();
    timeSeconds = timeSeconds === 0 ? 0 : timeSeconds;
    if (command?.action === 'select' && command.clipId !== null && (!clips || !document.clips.some(clip => clip.id === command.clipId))) invalid();
    const next = rows.map((row, index) => {
      const applies = all ? row.active : index === selectedIndex;
      const operation = applies ? command : null;
      return { state: transport(index, row.state, timeSeconds, operation),
        active: operation ? operation.action !== 'stop' : row.active };
    });
    // Neither states nor clock commit until every transport and sample succeeds.
    const result = capture(next, timeSeconds);
    rows = next; snapshot = result; return result;
  }
  return Object.freeze({
    snapshot: () => snapshot,
    advance: timeSeconds => update(timeSeconds),
    command(instanceId, command, timeSeconds) {
      const index = typeof instanceId === 'string' ? instanceIds.indexOf(instanceId) : -1;
      if (index === -1) invalid();
      return update(timeSeconds, index, commandData(command));
    },
    commandAll: (command, timeSeconds) => update(timeSeconds, null, commandData(command, true), true),
  });
}
