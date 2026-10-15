import fs from 'node:fs/promises';
const golden = JSON.parse(await fs.readFile(new URL('../fixtures/scene-model/legacy-plan-v2.json', import.meta.url), 'utf8')).plan;
export const runtimeId = number => `${number.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
export function runtimeProject({ behavior = false, legacy = false } = {}) {
  const first = structuredClone(golden), second = structuredClone(golden);
  second.scene.objectId = runtimeId(2); second.scene.sourcePath = 'documents/scenes/second.json';
  for (const actor of second.actors) {
    actor.position[0] += 100; actor.name = 'Second ' + actor.name;
    for (const source of [actor.declaration, ...Object.values(actor.fieldSources || {})]) {
      if (source?.objectId === first.scene.objectId) { source.objectId = second.scene.objectId; source.sourcePath = second.scene.sourcePath; }
    }
  }
  if (legacy) {
    first.schemaVersion = 1;
    first.actors = [first.actors[0]]; delete first.actors[0].instanceId;
  }
  if (behavior) {
    const manifest = { objectId: runtimeId(6), sourcePath: 'documents/behaviors.json', sourceRevision: first.scene.sourceRevision };
    const source = { objectId: runtimeId(7), sourcePath: 'documents/script.txt', sourceRevision: first.scene.sourceRevision, language: 'gdscript', content: 'extends Node\n' };
    first.schemaVersion = 3;
    first.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', manifest,
      sources: [source], bindings: [{ bindingId: runtimeId(8), instanceId: first.actors[0].instanceId, objectId: first.actors[0].objectId,
        implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: source.objectId }, parameters: {},
        events: [{ signal: 'arrived', event: 'checkpoint' }], declaration: { ...manifest, propertyPath: '/bindings/0' } }] };
  }
  return { format: 'viento-build-plan', schemaVersion: 1, kind: 'project', projectId: first.projectId, worldId: first.worldId, worldRevision: first.worldRevision,
    assembly: { objectId: runtimeId(1), sourcePath: 'documents/project.json', sourceRevision: first.scene.sourceRevision, title: 'Runtime project' },
    entrySceneId: first.scene.objectId, scenes: [first, second], resources: first.resources,
    requiredCapabilities: [...new Set(['project.scenes', ...first.requiredCapabilities, ...second.requiredCapabilities])].sort() };
}
export const actorStates = scene => scene.actors.map(actor => ({ objectId: actor.objectId,
  ...(scene.schemaVersion > 1 ? { instanceId: actor.instanceId } : {}), position: [...actor.position], state: 'idle' }));
export const projectReady = plan => ({ protocol: 1, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId });
export const enterScene = (scene, visitIndex) => ({ protocol: 1, event: 'scene-enter', visitIndex, sceneId: scene.scene.objectId });
export const sceneFrame = (scene, visitIndex, frame, stream = 'runtime') => ({ protocol: 1, event: 'scene-event', visitIndex, sceneId: scene.scene.objectId, stream, frame });
export const readyScene = (scene, visitIndex) => sceneFrame(scene, visitIndex, { protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors: actorStates(scene) });
export const exitScene = (scene, visitIndex, elapsedSeconds, next = null) => ({ protocol: 1, event: 'scene-exit', visitIndex, sceneId: scene.scene.objectId,
  reason: next ? 'switch' : 'finished', elapsedSeconds, actors: actorStates(scene), ...(next ? { nextSceneId: next.scene.objectId } : {}) });
export const finishProject = (plan, visitCount, totalSeconds) => ({ protocol: 1, event: 'finished', assemblyId: plan.assembly.objectId, visitCount, totalSeconds });
export const projectLine = frame => 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n';
export function returnTrip(plan) {
  const [a, b] = plan.scenes;
  return [projectReady(plan), enterScene(a, 1), readyScene(a, 1), exitScene(a, 1, 0.25, b),
    enterScene(b, 2), readyScene(b, 2), exitScene(b, 2, 0.25, a), enterScene(a, 3), readyScene(a, 3), exitScene(a, 3, 0), finishProject(plan, 3, 0.5)];
}
