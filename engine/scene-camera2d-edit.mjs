// A camera form replaces the camera value and, only when explicitly enabling
// or disabling world limits, its schema version. All surrounding bytes survive.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { inspectSceneCamera2DDocument, validateSceneCamera2DDocument } from './scene-camera2d.mjs';
export function editSceneCamera2DSource(content, camera) {
  const before = inspectSceneCamera2DDocument(content);
  if (!before.recognized || !before.ok || !before.value) throw new TypeError('Invalid camera source.');
  // Capture descriptors through the author validator before JSON serialization;
  // an accessor, hidden property or toJSON hook is never invoked by this edit.
  const schemaVersion = camera && typeof camera === 'object' && Object.hasOwn(camera, 'limits') ? 2 : 1;
  const candidate = validateSceneCamera2DDocument({ ...before.value, schemaVersion, camera });
  if (before.value.schemaVersion === candidate.schemaVersion
    && JSON.stringify(before.value.camera) === JSON.stringify(candidate.camera)) return content;
  const parsed = parseJsonSource(content), patches = [];
  for (const [pointer, value, changed] of [['/camera', candidate.camera, true],
    ['/schemaVersion', schemaVersion, before.value.schemaVersion !== schemaVersion]]) {
    if (!changed) continue;
    const token = locateJsonSource(parsed, pointer);
    if (!token?.exact) throw new TypeError('Camera source location unavailable.');
    patches.push({ start: token.start, end: token.end, text: JSON.stringify(value) });
  }
  let next = content;
  for (const patch of patches.sort((a, b) => b.start - a.start)) next = next.slice(0, patch.start) + patch.text + next.slice(patch.end);
  const checked = inspectSceneCamera2DDocument(next);
  if (!checked.recognized || !checked.ok) throw new TypeError('Invalid camera settings.');
  return next;
}
