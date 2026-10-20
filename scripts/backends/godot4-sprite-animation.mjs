// Grid frames are a new visual capability. Preserve the original animation
// generator and runtime bytes for plans that only use the four v1 channels.
import fs from 'node:fs/promises';
import { generateGodotAnimationProject as generateVisualAnimation } from './godot4-animation.mjs';
import { sceneAnimationCapabilities } from '../../engine/scene-animation.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
export { godotAnimationDiagnostics } from './godot4-animation.mjs';

export async function generateGodotAnimationProject(input) {
  const plan = structuredClone(input);
  const generated = await generateVisualAnimation(plan);
  if (!sceneAnimationCapabilities(plan.animation.document).includes('animation.sprite2d')) return generated;
  const sourceRuntime = await fs.readFile(new URL('./godot4/animation-sprite-runtime.gd', import.meta.url));
  const baseName = plan.audio ? 'audio-runtime' : plan.schemaVersion === 3 ? 'behavior-runtime' : 'runtime';
  generated.files.set('animation-runtime.gd', Buffer.from(sourceRuntime.toString().replace('extends "res://runtime.gd"', `extends "res://${baseName}.gd"`)));
  const generator = await fs.readFile(new URL('./godot4-sprite-animation.mjs', import.meta.url));
  generated.backend = { ...generated.backend, version: '0.13.0',
    capabilities: [...generated.backend.capabilities, 'animation.sprite2d'],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator, sourceRuntime])) };
  return generated;
}
