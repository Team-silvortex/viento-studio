import { runtimeId } from './project-runtime-fixture.mjs';
export const hudLabel = (id = 170, extra = {}) => ({ id: runtimeId(id), kind: 'label', anchor: 'top-left', offset: [16, 16], size: [240, 32], fontSize: 20, color: '#ffffffff', content: { kind: 'state', key: 'score', prefix: 'Score: ', suffix: '', missing: '?' }, ...extra });
export const hudBar = (id = 171, extra = {}) => ({ id: runtimeId(id), kind: 'bar', anchor: 'bottom-right', offset: [-16, -16], size: [200, 24], key: 'health', min: 0, max: 100, fallback: 25, fillColor: '#20d080', backgroundColor: '#202040', ...extra });
export function hudOn(plan, index, elements = [hudLabel(), hudBar()]) {
  const scene = plan.scenes[index]; scene.hud2d = { format: 'viento-hud2d-plan', schemaVersion: 1,
    manifest: { objectId: runtimeId(180 + index), sourcePath: `documents/hud/${index}.json`, sourceRevision: scene.scene.sourceRevision },
    document: { format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: scene.scene.objectId, elements } };
  for (const owner of [plan, scene]) owner.requiredCapabilities = [...new Set([...owner.requiredCapabilities, 'scene.hud2d'])].sort(); return plan;
}
