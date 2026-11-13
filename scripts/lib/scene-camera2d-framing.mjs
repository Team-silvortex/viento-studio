// Build an optional illustration catalog solely from an already-read snapshot.
// Scene model resolution owns projection inheritance; no tool/media reads and
// no executable project planning are involved in viewport references.
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { inspectProjectAssembly, validateProjectAssemblyDependencies } from '../../engine/project-assembly.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { captureSceneCamera2DFramingContext, SCENE_CAMERA2D_FRAMING_ASSEMBLY_LIMIT, SCENE_CAMERA2D_FRAMING_DIAGNOSTIC_LIMIT } from '../../engine/scene-camera2d-framing-context.mjs';
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const viewport = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 64 && n <= 4096);
const failure = () => { throw Object.assign(new TypeError('Camera composition evidence unavailable.'), { errorCode: 'scene_camera2d_framing_unavailable' }); };
export function createSceneCamera2DFramingContext(observed, sceneId, catalog) {
  const { source, projection } = observed, diagnostics = [], objects = new Map(projection.objects.map(object => [object.id, object]));
  const byId = new Map(source.documents.filter(document => document.record).map(document => [document.record.id, document]));
  function ref(document) {
    const object = objects.get(document?.record?.id);
    if (!object || document.record.sourcePath !== document.sourcePath || !revision(document.sourceRevision) || !revision(object.revision)
      || object.documentRefs?.length !== 1 || object.documentRefs[0].sourcePath !== document.sourcePath || object.documentRefs[0].sourceRevision !== document.sourceRevision) failure();
    return { objectId: document.record.id, objectRevision: object.revision, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision };
  }
  function diagnostic(code, message, document, propertyPath = '') {
    const item = { code, message, objectId: document?.record?.id || null, sourcePath: document?.sourcePath || '', sourceRevision: document?.sourceRevision || null, propertyPath };
    if (diagnostics.length >= SCENE_CAMERA2D_FRAMING_DIAGNOSTIC_LIMIT) {
      // Reference truncation must stay visible even if earlier broken catalog
      // entries already filled the independent local diagnostic budget.
      if (code === 'scene_camera2d_framing_references_limited') diagnostics[diagnostics.length - 1] = item;
      return;
    }
    diagnostics.push(item);
  }
  const scene = byId.get(sceneId), sceneRef = ref(scene), parsed = parseJsonSource(scene.content);
  if (!parsed.ok || !viewport(parsed.value?.viewport)) failure();
  const viewports = [{ id: `scene:${sceneId}`, kind: 'scene', title: parsed.value.title, viewport: [...parsed.value.viewport], source: sceneRef }];
  let actors = null;
  try {
    const resolved = resolveScene2DModel(observed, sceneId);
    if (!resolved.ok || ![2, 3].includes(resolved.model?.schemaVersion)) failure();
    actors = resolved.model.actors.map(({ instanceId, objectId, name, position, size, color }) => ({ instanceId, objectId, name, position: [...position], size: [...size], color }));
  } catch {
    diagnostic('scene_camera2d_framing_geometry_unavailable', 'Resolved scene geometry is unavailable; the numeric camera form remains available.', scene, '/actors');
  }
  for (const document of source.documents) {
    if (!document.record || document.sourceRevision === null || typeof document.content !== 'string' || !document.sourcePath.toLowerCase().endsWith('.json')) continue;
    const checked = inspectProjectAssembly(document.content);
    if (!checked.recognized) continue;
    if (!checked.ok) {
      diagnostic('scene_camera2d_framing_reference_unavailable', 'A saved assembly declaration could not supply a viewport reference.', document); continue;
    }
    if (!checked.value.sceneIds.includes(sceneId)) continue;
    if (viewports.length > SCENE_CAMERA2D_FRAMING_ASSEMBLY_LIMIT) {
      diagnostic('scene_camera2d_framing_references_limited', 'Only the first 32 saved assembly viewport references are shown.', document); break;
    }
    try {
      if (validateProjectAssemblyDependencies(checked.value, document.record, source).length) failure();
      const owner = ref(document), entry = byId.get(checked.value.entrySceneId), entryRef = ref(entry), parsedEntry = parseJsonSource(entry.content);
      if (!parsedEntry.ok || !viewport(parsedEntry.value?.viewport)) failure();
      viewports.push({ id: `assembly:${owner.objectId}`, kind: 'assembly-entry', title: checked.value.title, viewport: [...parsedEntry.value.viewport], source: owner, entryScene: entryRef });
    } catch {
      diagnostic('scene_camera2d_framing_reference_unavailable', 'A saved assembly entry scene could not supply a viewport reference.', document, '/entrySceneId');
    }
  }
  const result = { format: 'viento-camera2d-framing-context', schemaVersion: 1, worldId: projection.world.id,
    baseRevision: projection.world.revision, scene: sceneRef, actors, viewports, diagnostics };
  try { return captureSceneCamera2DFramingContext(result, catalog); }
  catch (error) {
    // An invalid optional geometry/name must not conceal otherwise usable
    // viewport references or change the old numeric editor's admission rules.
    if (actors !== null) {
      result.actors = null;
      diagnostic('scene_camera2d_framing_geometry_unavailable', 'Resolved scene geometry is unavailable; the numeric camera form remains available.', scene, '/actors');
      return captureSceneCamera2DFramingContext(result, catalog);
    }
    throw error;
  }
}
