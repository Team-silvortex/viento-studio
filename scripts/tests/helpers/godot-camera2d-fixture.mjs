import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeProject, runtimeId } from './project-runtime-fixture.mjs';
export function cameraProject() {
  const plan = runtimeProject(); plan.resources = [];
  for (const scene of plan.scenes) {
    scene.resources = []; scene.requiredCapabilities = scene.requiredCapabilities.filter(cap => cap !== 'image');
    for (const actor of scene.actors) delete actor.imageResourceId;
  }
  plan.requiredCapabilities = plan.requiredCapabilities.filter(cap => cap !== 'image'); return plan;
}
export function cameraOn(plan, sceneIndex, camera) {
  const scene = plan.scenes[sceneIndex]; scene.camera2d = { format: 'viento-camera2d-plan', schemaVersion: 1,
    manifest: { objectId: runtimeId(100 + sceneIndex), sourcePath: `documents/cameras/${sceneIndex}.json`, sourceRevision: scene.scene.sourceRevision },
    document: { format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: scene.scene.objectId, camera } };
  scene.requiredCapabilities = [...new Set([...scene.requiredCapabilities, 'scene.camera2d'])].sort();
  plan.requiredCapabilities = [...new Set([...plan.requiredCapabilities, 'scene.camera2d'])].sort(); return plan;
}
export async function cameraStage(t, generated) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-camera2d-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [name, bytes] of generated.files) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes); }
  return directory;
}
