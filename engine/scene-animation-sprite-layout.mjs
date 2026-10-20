// Image decode requirements are separate from animation sampling and Canvas.
// Uniform cells use normalized coordinates; no native atlas pixel dimensions,
// new resource paths, image decoding or author writes enter this boundary.
import { captureSceneAnimationPreview } from './scene-animation-preview.mjs';
const layouts = new WeakSet();
export function captureSceneAnimationSpriteLayout(preview) {
  const catalog = captureSceneAnimationPreview(preview);
  const layout = Object.freeze((catalog.document?.tracks || []).filter(track => track.property === 'spriteFrame2d').map(track =>
    Object.freeze({ instanceId: track.instanceId, columns: track.grid.columns, rows: track.grid.rows })));
  layouts.add(layout); return layout;
}
export function scenePreviewImageDimensions(actors, resourceId, layout = null) {
  if (layout !== null && !layouts.has(layout)) throw new TypeError('Unverified sprite layout.');
  let width = 1, height = 1;
  for (const actor of actors) {
    if (actor.imageResourceId !== resourceId) continue;
    const grid = layout?.find(row => row.instanceId === actor.instanceId);
    const w = Math.ceil(actor.size[0]) * (grid?.columns || 1), h = Math.ceil(actor.size[1]) * (grid?.rows || 1);
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw new TypeError('Invalid image decode size.');
    width = Math.max(width, w); height = Math.max(height, h);
  }
  return Object.freeze({ width, height });
}
