// Native 3D source semantics are separate from rendering, projects and backends.
import { dispatchStudioCoreScene3D, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
export const MAX_SCENE3D_BYTES = 128 * 1024;
const invalid = () => { throw Object.assign(new TypeError('A 3D scene requires valid Unicode JSON source.'), { errorCode: 'scene3d_invalid' }); };
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
/** Parse the complete strict box scene with native source locations. */
export function parseScene3DSource(content) {
  if (typeof content !== 'string') invalid();
  if (content.length > MAX_SCENE3D_BYTES || new TextEncoder().encode(content).length > MAX_SCENE3D_BYTES) throw Object.assign(new RangeError('3D scene source exceeds 128 KiB.'), { errorCode: 'scene3d_limit' });
  for (const character of content) { const point = character.codePointAt(0); if (point >= 0xd800 && point <= 0xdfff) invalid(); }
  return freeze(dispatchStudioCoreScene3D({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'scene3d.parse', content }));
}
/** Scene values remain authored: Y-up, right-handed, -Z forward; degree triples
 * use XYZ Euler rotation. Renderers/backends convert with T*Rx*Ry*Rz*S. */
export function createScene3DPlan(content) {
  const { model } = parseScene3DSource(content);
  const { format, schemaVersion, ...scene } = model;
  return freeze({ format: 'viento-build-plan', schemaVersion: 1, kind: 'scene3d', scene });
}
