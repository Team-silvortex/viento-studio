// Experimental, declarative scene subset. This module knows neither Godot nor
// filesystem/process APIs; document bytes remain the authoring authority.
import { inspectObjectProjection, renderProjectionRuntime, validateProjectionDependencies } from './object-projection.mjs';
export const SCENE2D_CAPABILITIES = ['scene2d', 'input.arrows', 'state.movement', 'image'];
export { PROJECT_BUILD_API_PATH } from './project-build-contract.mjs';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && value.every(item => number(item, min, max));
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export function createScene2DPlan(observed, sceneRef) {
  return scenePlan(observed, sceneRef, false);
}

// Recovery owns the frozen scene and its registration, not the current source
// of referenced objects. Check only declaration syntax and guarded references;
// inherited values are resolved again by Build after recovery completes.
export function validateScene2DRegistration(observed, sceneRef) {
  return scenePlan(observed, sceneRef, true);
}

export function buildActorFieldLocation(actor, field) {
  return actor?.fieldSources?.[field] || (actor?.declaration ? {
    ...actor.declaration, propertyPath: `${actor.declaration.propertyPath}/${field}`,
  } : null);
}

function scenePlan({ source, projection }, sceneRef, registrationOnly) {
  const diagnostics = [];
  const document = source.documents.find(item => item.record?.id === sceneRef || item.sourcePath === sceneRef);
  const sceneObjectId = document?.record?.id || null;
  const sourcePath = document?.sourcePath || '';
  const issue = (code, message, propertyPath = '', details = {}) => diagnostics.push({
    severity: 'error', code, message, objectId: sceneObjectId, sourcePath, propertyPath, ...details,
  });
  const result = plan => ({ ok: diagnostics.length === 0, plan, diagnostics });
  if (!uuid(sceneObjectId) || document.content === null) {
    issue('build_scene_required', 'Select an available, registered scene document.'); return result(null);
  }
  if (!sourcePath.toLowerCase().endsWith('.json')) {
    issue('build_scene_format', 'Scene declarations currently use JSON.'); return result(null);
  }
  let scene;
  try { scene = JSON.parse(document.content.replace(/^\uFEFF/, '')); }
  catch { issue('build_scene_json', 'The scene is not valid JSON.'); return result(null); }
  if (!plain(scene) || scene.format !== 'viento-scene2d' || scene.schemaVersion !== 1) {
    issue('build_scene_format', 'Expected viento-scene2d schemaVersion 1.'); return result(null);
  }
  const keys = (value, allowed, pointer) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issue('build_feature_unsupported',
      `Unsupported scene field: ${key}`, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
  };
  keys(scene, ['format', 'schemaVersion', 'title', 'viewport', 'background', 'actors'], '');
  if (typeof scene.title !== 'string' || !scene.title.trim() || scene.title.length > 160 || /[\x00-\x1f]/.test(scene.title)) issue('build_scene_value', 'Provide a scene title of 1–160 characters.', '/title');
  if (!pair(scene.viewport, 64, 4096) || !scene.viewport.every(Number.isInteger)) issue('build_scene_value', 'Viewport dimensions must be integers from 64 to 4096.', '/viewport');
  if (!color(scene.background)) issue('build_scene_value', 'Use a hex background color.', '/background');
  if (!Array.isArray(scene.actors) || scene.actors.length < 1 || scene.actors.length > 128) {
    issue('build_scene_value', 'A scene requires 1–128 actors.', '/actors'); return result(null);
  }
  const actors = [], resources = new Map(), identities = new Set(), coreIds = new Set();
  for (const [index, declaration] of scene.actors.entries()) {
    const pointer = `/actors/${index}`;
    if (!plain(declaration)) { issue('build_actor_value', 'Expected an actor declaration.', pointer); continue; }
    keys(declaration, ['objectId', 'position', 'size', 'color', 'speed', 'controls', 'imageResourceId', 'useProjectionDefaults'], pointer);
    const object = projection.objects.find(item => item.id === declaration.objectId);
    const actorDocument = source.documents.find(item => item.record?.id === declaration.objectId);
    if (!uuid(declaration.objectId) || !object || !actorDocument || actorDocument.content === null || declaration.objectId === sceneObjectId) {
      issue('build_actor_missing', 'Actor must reference another available, registered document.', `${pointer}/objectId`, { relatedObjectId: declaration.objectId ?? null }); continue;
    }
    if (identities.has(object.id)) issue('build_actor_duplicate', 'An actor object may appear only once in this scene version.', `${pointer}/objectId`);
    identities.add(object.id);
    if (!projection.relations.some(relation => relation.sourceObjectId === sceneObjectId && relation.targetObjectId === object.id)) {
      issue('build_actor_unlinked', 'Register the scene-to-actor relation so resource packages retain the dependency.', `${pointer}/objectId`, { relatedObjectId: object.id });
    }
    const inherit = declaration.useProjectionDefaults === true;
    if (declaration.useProjectionDefaults !== undefined && typeof declaration.useProjectionDefaults !== 'boolean') issue('build_actor_value', 'Projection inheritance must be a boolean.', `${pointer}/useProjectionDefaults`);
    let projected = null, runtime = null, origin = null;
    if (!registrationOnly) {
      const inspected = inspectObjectProjection(actorDocument.content, actorDocument.record);
      if (inspected.recognized) {
        if (!inspected.ok) {
          issue('build_projection_invalid', 'The object projection is invalid.', inspected.diagnostics[0]?.propertyPath || '',
            { objectId: object.id, sourcePath: actorDocument.sourcePath }); continue;
        }
        projected = inspected.value;
        const dependencyErrors = validateProjectionDependencies(projected, actorDocument.record, source);
        if (dependencyErrors.length) {
          for (const diagnostic of dependencyErrors) issue('build_projection_invalid', diagnostic.message, diagnostic.propertyPath,
            { objectId: object.id, sourcePath: actorDocument.sourcePath,
              ...(diagnostic.resourceId ? { resourceId: diagnostic.resourceId } : {}),
              ...(diagnostic.relatedObjectId ? { relatedObjectId: diagnostic.relatedObjectId } : {}) });
          continue;
        }
        const core = source.documents.find(item => item.record?.id === projected.sourceObjectId);
        if (core.record.id === sceneObjectId) {
          issue('build_projection_source', 'A projection must reference an available original object.', '/sourceObjectId',
            { objectId: object.id, sourcePath: actorDocument.sourcePath, relatedObjectId: projected.sourceObjectId }); continue;
        }
        coreIds.add(core.record.id);
        origin = { objectId: core.record.id, sourcePath: core.sourcePath, sourceRevision: core.sourceRevision };
        runtime = renderProjectionRuntime(projected);
      }
      if ((inherit || projected) && !runtime) {
        issue('build_projection_runtime', 'Select a projection with Scene2D runtime fields.', projected ? '/template/snapshot/runtime' : `${pointer}/useProjectionDefaults`,
          projected ? { objectId: object.id, sourcePath: actorDocument.sourcePath } : { relatedObjectId: object.id }); continue;
      }
    }
    const actor = { ...(inherit ? runtime : {}), ...declaration };
    if (inherit && actor.imageResourceId === null) delete actor.imageResourceId;
    const fieldSources = {};
    for (const field of ['position', 'size', 'size/0', 'size/1', 'color', 'speed', 'controls', 'imageResourceId']) {
      const main = field.split('/')[0], inherited = inherit && projected && !Object.hasOwn(declaration, main);
      const mapped = projected?.template.snapshot.runtime;
      const fieldId = main === 'size' ? mapped?.[field.endsWith('/1') ? 'height' : 'width']
        : mapped?.[main === 'imageResourceId' ? 'image' : main];
      fieldSources[field] = inherited && fieldId ? { objectId: object.id, sourcePath: actorDocument.sourcePath,
        propertyPath: `/configuration/${fieldId.replaceAll('~', '~0').replaceAll('/', '~1')}` }
        : { objectId: sceneObjectId, sourcePath, propertyPath: `${pointer}/${field}` };
    }
    const atField = (code, message, field, details = {}) => {
      const location = fieldSources[field]; issue(code, message, location.propertyPath, { ...details, ...location });
    };
    const present = field => !(registrationOnly && inherit && !Object.hasOwn(declaration, field));
    if (!pair(actor.position, -100000, 100000)) atField('build_actor_value', 'Position requires two finite coordinates.', 'position');
    if (present('size') && !pair(actor.size, 1, 2048)) atField('build_actor_value', 'Actor size must be from 1 to 2048.',
      inherit && !Object.hasOwn(declaration, 'size') && Array.isArray(actor.size) ? `size/${number(actor.size[0], 1, 2048) ? 1 : 0}` : 'size');
    if (present('color') && !color(actor.color)) atField('build_actor_value', 'Use a hex actor color.', 'color');
    if (present('speed') && !number(actor.speed, 0, 2000)) atField('build_actor_value', 'Speed must be from 0 to 2000.', 'speed');
    if (present('controls') && !['arrows', 'none'].includes(actor.controls)) atField('build_feature_unsupported', 'Controls must be arrows or none.', 'controls');
    if (actor.imageResourceId !== undefined) {
      const resource = projection.resources.find(item => item.id === actor.imageResourceId);
      const details = { resourceId: actor.imageResourceId, relatedObjectId: object.id };
      if (!uuid(actor.imageResourceId) || !resource || resource.descriptor.kind !== 'image' || !/\.(png|jpe?g|webp|svg)$/i.test(resource.descriptor.location.path)) {
        atField('build_image_unsupported', 'Select a registered PNG, JPEG, WebP or SVG image.', 'imageResourceId', details);
      } else if (!projection.resourceBindings.some(binding => [sceneObjectId, object.id].includes(binding.objectId) && binding.resourceId === resource.id)) {
        atField('build_image_unbound', 'Bind this image to the actor or scene so resource packages retain the dependency.', 'imageResourceId', details);
      } else if (!resource.descriptor.content || !/^[a-f0-9]{64}$/.test(resource.descriptor.content.sha256)
        || !Number.isSafeInteger(resource.descriptor.content.size) || resource.descriptor.content.size < 1 || resource.descriptor.content.size > 32 * 1024 * 1024) {
        atField('build_image_unverified', 'The image needs a registered content hash.', 'imageResourceId', details);
      } else resources.set(resource.id, { id: resource.id, ...resource.descriptor.content,
        extension: resource.descriptor.location.path.split('.').at(-1).toLowerCase() });
    }
    actors.push({ ...actor, name: object.name, sourcePath: actorDocument.sourcePath, sourceRevision: actorDocument.sourceRevision,
      ...(projected ? { origin, fieldSources } : {}),
      declaration: { objectId: sceneObjectId, sourcePath, propertyPath: pointer } });
  }
  const participating = new Set([sceneObjectId, ...identities, ...coreIds]);
  for (const diagnostic of projection.diagnostics) if (diagnostic.severity === 'error' && participating.has(diagnostic.objectId)) {
    diagnostics.push({ ...diagnostic, message: 'A participating source document is invalid.', propertyPath: diagnostic.propertyPath || '' });
  }
  if (diagnostics.length) return result(null);
  return result({ format: 'viento-build-plan', schemaVersion: 1, kind: 'scene2d',
    projectId: source.workspace.id, worldId: projection.world.id, worldRevision: projection.world.revision,
    scene: { objectId: sceneObjectId, sourcePath, sourceRevision: document.sourceRevision,
      title: scene.title, viewport: [...scene.viewport], background: scene.background },
    requiredCapabilities: SCENE2D_CAPABILITIES.filter(capability => capability !== 'image' || resources.size),
    actors, resources: [...resources.values()].sort((a, b) => a.id.localeCompare(b.id)) });
}

export function checkBuildCapabilities(plan, backend) {
  return plan.requiredCapabilities.filter(capability => !backend.capabilities.includes(capability)).map(capability => ({
    severity: 'error', code: 'build_capability_missing', message: `Backend lacks capability: ${capability}`,
    objectId: plan.scene.objectId, sourcePath: plan.scene.sourcePath, propertyPath: '', capability,
  }));
}
