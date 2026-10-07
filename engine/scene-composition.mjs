// Single-file composition is a pure experimental operation. The generated scene
// is detached; neither this module nor the Rust core opens or saves a project.
import { dispatchStudioCoreComposition, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';

export const MAX_SCENE_COMPOSITION_BYTES = 128 * 1024;

export function expandSceneComposition(content) {
  if (typeof content !== 'string') throw Object.assign(new TypeError('A composition requires Unicode JSON source.'), { errorCode: 'scene_composition_invalid' });
  if (content.length > MAX_SCENE_COMPOSITION_BYTES || new TextEncoder().encode(content).length > MAX_SCENE_COMPOSITION_BYTES) {
    throw Object.assign(new RangeError('Scene composition source exceeds 128 KiB.'), { errorCode: 'scene_composition_limit' });
  }
  for (const character of content) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) throw Object.assign(new TypeError('A composition requires Unicode JSON source.'), { errorCode: 'scene_composition_invalid' });
  }
  return dispatchStudioCoreComposition({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.expand', content });
}
