// Named ranges share existing tracks and assets. Earlier author schemas retain
// their original generator, visual runtime and source-map bytes.
import fs from 'node:fs/promises';
import { generateGodotAnimationProject as generateSpriteAnimation } from './godot4-sprite-animation.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
export { godotAnimationDiagnostics } from './godot4-sprite-animation.mjs';
export async function generateGodotAnimationProject(input) {
  const plan = structuredClone(input), generated = await generateSpriteAnimation(plan);
  if (plan.animation.document.schemaVersion !== 3) return generated;
  generated.sourceMap.animation.clips = plan.animation.document.clips.map(clip => ({ clipId: clip.id,
    declaration: plan.animation.locations.clips.find(row => row.id === clip.id).declaration }));
  const generator = await fs.readFile(new URL('./godot4-clip-animation.mjs', import.meta.url));
  generated.backend = { ...generated.backend, version: '0.15.0', capabilities: [...generated.backend.capabilities, 'animation.clips2d'],
    sha256: buildHash(Buffer.concat([Buffer.from(generated.backend.sha256), generator])) };
  return generated;
}
