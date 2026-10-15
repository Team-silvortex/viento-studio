import { eventProject, eventOrigin, eventReady, eventFinished } from './project-event-bus-fixture.mjs';
import { runtimeId, enterScene, readyScene, exitScene, sceneFrame } from './project-runtime-fixture.mjs';
export const audioFrame = frame => ({ ...frame, protocol: 4 });
export function audioProject({ empty = false } = {}) {
  const plan = eventProject();
  for (const [index, scene] of plan.scenes.entries()) {
    const resource = { id: runtimeId(80), kind: 'audio', extension: 'wav', size: 48, sha256: 'a'.repeat(64) };
    const manifest = { objectId: runtimeId(81 + index), sourcePath: `documents/audio-${index}.json`, sourceRevision: scene.scene.sourceRevision };
    const track = { id: runtimeId(90), resourceId: resource.id, role: 'effect', volume: 1, loop: false };
    const cues = empty ? [] : [{ id: runtimeId(91), trackId: track.id, atSeconds: 0, action: 'stop' }];
    scene.audio = { format: 'viento-audio-plan', schemaVersion: 1, manifest,
      document: { format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: scene.scene.objectId, tracks: [track], cues },
      locations: { tracks: [{ id: track.id, declaration: { ...manifest, propertyPath: '/tracks/0', sourceRange: { start: 20, end: 80, encoding: 'utf-16', propertyPath: '/tracks/0', exact: true } } }],
        cues: cues.map((cue, index) => ({ id: cue.id, declaration: { ...manifest, propertyPath: `/cues/${index}` } })) } };
    scene.resources.push(resource); scene.resources.sort((a, b) => a.id.localeCompare(b.id));
    scene.requiredCapabilities = [...scene.requiredCapabilities, 'audio.nonspatial', 'audio.timeline'];
  }
  plan.resources = [...new Map(plan.scenes.flatMap(scene => scene.resources).map(resource => [resource.id, resource])).values()].sort((a, b) => a.id.localeCompare(b.id));
  plan.requiredCapabilities = [...new Set(['project.scenes', ...plan.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  return plan;
}
export const audioProjectReady = plan => ({ ...audioFrame(eventReady(plan)), audioCommandSequence: 0 });
export const audioProjectFinished = (plan, visits, seconds, sequence, state = 0, events = 0) => ({ ...audioFrame(eventFinished(plan, visits, seconds, state, events)), audioCommandSequence: sequence });
export const audioReady = (scene, visit) => audioFrame(sceneFrame(scene, visit, { protocol: 1, event: 'ready', sceneObjectId: scene.scene.objectId, trackIds: scene.audio.document.tracks.map(track => track.id) }, 'audio'));
export const audioCues = (scene, visit, seconds) => scene.audio.document.cues.filter(cue => cue.atSeconds <= seconds).map(cue => audioFrame(sceneFrame(scene, visit,
  { protocol: 1, event: 'command', cueId: cue.id, trackId: cue.trackId, resourceId: scene.audio.document.tracks.find(track => track.id === cue.trackId).resourceId, action: cue.action, atSeconds: cue.atSeconds }, 'audio')));
export const audioFinished = (scene, visit, seconds) => audioFrame(sceneFrame(scene, visit, { protocol: 1, event: 'finished', timeSeconds: seconds }, 'audio'));
export function audioCommand(scene, visitIndex, commandSequence, action = 'play', timeSeconds = 0) {
  const { bindingId, instanceId, objectId } = scene.behaviors.bindings[0], track = scene.audio.document.tracks[0];
  return { protocol: 4, event: 'audio-command', commandSequence, visitIndex, sceneId: scene.scene.objectId, bindingId, instanceId, objectId,
    trackId: track.id, resourceId: track.resourceId, action, timeSeconds };
}
export function audioReceipt(scene, visitIndex = 1, sequence = 1, action = 'play', timeSeconds = 0) {
  const track = scene.audio.document.tracks[0];
  return { sequence, action, timeSeconds, origin: eventOrigin(scene, visitIndex), track: { trackId: track.id, resourceId: track.resourceId, source: structuredClone(scene.audio.locations.tracks[0].declaration) } };
}
export function audioReturnTrip(plan) {
  const [a, b] = plan.scenes, frames = [audioProjectReady(plan)];
  for (const [index, scene] of [a, b, a].entries()) {
    const visit = index + 1, elapsed = index === 2 ? 0 : 0.25, next = index === 0 ? b : index === 1 ? a : null;
    frames.push(audioFrame(enterScene(scene, visit)), audioFrame(readyScene(scene, visit)), audioReady(scene, visit), ...audioCues(scene, visit, elapsed),
      audioCommand(scene, visit, index * 2 + 1), audioCommand(scene, visit, index * 2 + 2, 'stop', elapsed), audioFinished(scene, visit, elapsed), audioFrame(exitScene(scene, visit, elapsed, next)));
  }
  frames.push(audioProjectFinished(plan, 3, 0.5, 6)); return frames;
}
