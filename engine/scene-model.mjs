// Portable Scene2D semantics and source provenance. Original text stays in
// the observation; the model contains no filesystem, renderer or backend state.
import { inspectObjectProjection, renderProjectionRuntime, validateProjectionDependencies } from './object-projection.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { sceneActorIdentity } from './scene-identity.mjs';
import { validateSceneGroups } from './scene-groups.mjs';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && value.every(item => number(item, min, max));
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);


export function resolveScene2DModel({ source, projection }, sceneRef, { mode = 'runtime' } = {}) {
  if (!['runtime', 'registration'].includes(mode)) throw new TypeError('Unknown Scene2D model resolution mode.');
  const registrationOnly = mode === 'registration';
  const diagnostics = [];
  const document = source.documents.find(item => item.record?.id === sceneRef || item.sourcePath === sceneRef);
  const sceneObjectId = document?.record?.id || null;
  const sourcePath = document?.sourcePath || '';
  const parsedSources = new Map();
  const parseSource = target => {
    if (registrationOnly && target !== document) return null;
    if (!target || typeof target.content !== 'string' || !target.sourcePath?.toLowerCase().endsWith('.json')) return null;
    if (!parsedSources.has(target)) {
      let parsed = parseJsonSource(target.content, { allowDuplicateKeys: registrationOnly });
      // Only v1 has historical journals created before strict source indexing.
      // Newer scene formats never admit ambiguous JSON, even during recovery.
      if (registrationOnly && parsed.ok && parsed.value?.schemaVersion >= 2 && parsed.ambiguous) parsed = parseJsonSource(target.content);
      if (registrationOnly && !parsed.ok) {
        // Recovery predates source indexing. A discarded duplicate value may
        // exceed index budgets without changing the frozen declaration's JSON
        // semantics. Retain that legacy syntax gate, with no fabricated ranges.
        try {
          const value = JSON.parse(target.content.replace(/^\uFEFF/, ''));
          if (value?.schemaVersion === 1) parsed = { ok: true, value, ambiguous: false, diagnostics: [] };
        } catch { /* Preserve the failed parse; invalid JSON never recovers. */ }
      }
      parsedSources.set(target, parsed);
    }
    return parsedSources.get(target);
  };
  const location = (document, propertyPath = '', { composite = false } = {}) => {
    const parsed = parseSource(document), range = parsed && locateJsonSource(parsed, propertyPath, { nearest: true });
    return { objectId: document?.record?.id || null, sourcePath: document?.sourcePath || '', propertyPath,
      sourceRevision: document?.sourceRevision ?? null,
      ...(range ? { sourceRange: { ...range, exact: range.exact && !composite } } : {}) };
  };
  const issue = (code, message, propertyPath = '', details = {}) => {
    const target = source.documents.find(item => (details.objectId ? item.record?.id === details.objectId : item === document)
      && (!details.sourcePath || item.sourcePath === details.sourcePath));
    diagnostics.push({ severity: 'error', code, message, objectId: sceneObjectId, sourcePath, propertyPath,
      ...details, code, message, ...location(target || document, propertyPath) });
  };
  const result = model => ({ ok: diagnostics.length === 0, model, diagnostics });
  if (!uuid(sceneObjectId) || typeof document?.content !== 'string') {
    issue('build_scene_required', 'Select an available, registered scene document.'); return result(null);
  }
  if (!sourcePath.toLowerCase().endsWith('.json')) {
    issue('build_scene_format', 'Scene declarations currently use JSON.'); return result(null);
  }
  const parsed = parseSource(document);
  if (!parsed?.ok) {
    const errors = parsed?.diagnostics?.length ? parsed.diagnostics : [{ message: 'The scene is not valid JSON.', propertyPath: '' }];
    for (const error of errors) issue('build_scene_json', error.message, error.propertyPath || '');
    return result(null);
  }
  const scene = parsed.value;
  if (!plain(scene) || scene.format !== 'viento-scene2d' || ![1, 2, 3].includes(scene.schemaVersion)) {
    issue('build_scene_format', 'Expected viento-scene2d schemaVersion 1, 2 or 3.'); return result(null);
  }
  const keys = (value, allowed, pointer) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issue('build_feature_unsupported',
      `Unsupported scene field: ${key}`, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
  };
  keys(scene, ['format', 'schemaVersion', 'title', 'viewport', 'background', 'actors', ...(scene.schemaVersion === 3 ? ['groups'] : [])], '');
  if (scene.schemaVersion === 3) for (const diagnostic of validateSceneGroups(scene).diagnostics) issue(diagnostic.code, diagnostic.message, diagnostic.propertyPath);
  if (typeof scene.title !== 'string' || !scene.title.trim() || scene.title.length > 160 || /[\x00-\x1f]/.test(scene.title)) issue('build_scene_value', 'Provide a scene title of 1–160 characters.', '/title');
  if (!pair(scene.viewport, 64, 4096) || !scene.viewport.every(Number.isInteger)) issue('build_scene_value', 'Viewport dimensions must be integers from 64 to 4096.', '/viewport');
  if (!color(scene.background)) issue('build_scene_value', 'Use a hex background color.', '/background');
  if (!Array.isArray(scene.actors) || scene.actors.length < 1 || scene.actors.length > 128) {
    issue('build_scene_value', 'A scene requires 1–128 actors.', '/actors'); return result(null);
  }
  const actors = [], actorSources = [], resources = new Map(), identities = new Set(), definitionIds = new Set(), coreIds = new Set();
  for (const [index, declaration] of scene.actors.entries()) {
    const pointer = `/actors/${index}`;
    if (!plain(declaration)) { issue('build_actor_value', 'Expected an actor declaration.', pointer); continue; }
    keys(declaration, ['objectId', 'position', 'size', 'color', 'speed', 'controls', 'imageResourceId', 'useProjectionDefaults',
      ...(scene.schemaVersion >= 2 ? ['instanceId'] : []), ...(scene.schemaVersion === 3 ? ['groupId'] : [])], pointer);
    const identity = scene.schemaVersion >= 2 ? declaration.instanceId : declaration.objectId;
    if (scene.schemaVersion >= 2 && !uuid(identity)) issue('build_instance_missing', 'Every scene instance requires a lowercase UUID.', `${pointer}/instanceId`);
    const object = projection.objects.find(item => item.id === declaration.objectId);
    const actorDocument = source.documents.find(item => item.record?.id === declaration.objectId);
    if (!uuid(declaration.objectId) || !object || !actorDocument || actorDocument.content === null || declaration.objectId === sceneObjectId) {
      issue('build_actor_missing', 'Actor must reference another available, registered document.', `${pointer}/objectId`, { relatedObjectId: declaration.objectId ?? null }); continue;
    }
    if (identities.has(identity)) issue(scene.schemaVersion >= 2 ? 'build_instance_duplicate' : 'build_actor_duplicate',
      scene.schemaVersion >= 2 ? 'Scene instance identities must be unique.' : 'An actor object may appear only once in this scene version.',
      `${pointer}/${scene.schemaVersion >= 2 ? 'instanceId' : 'objectId'}`);
    identities.add(identity); definitionIds.add(object.id);
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
    const fields = Object.fromEntries(Object.entries(fieldSources).map(([field, fieldLocation]) => {
      const owner = fieldLocation.objectId === sceneObjectId ? document : actorDocument;
      const composite = field === 'size' && owner === actorDocument && inherit && !Object.hasOwn(declaration, 'size');
      return [field, location(owner, composite ? '/configuration' : fieldLocation.propertyPath, { composite })];
    }));
    actorSources.push({ objectId: object.id, ...(scene.schemaVersion >= 2 ? { instanceId: sceneActorIdentity(declaration) } : {}),
      definition: location(actorDocument), declaration: location(document, pointer), fields });
  }
  const participating = new Set([sceneObjectId, ...definitionIds, ...coreIds]);
  for (const diagnostic of projection.diagnostics) if (diagnostic.severity === 'error' && participating.has(diagnostic.objectId)) {
    issue(diagnostic.code, 'A participating source document is invalid.', diagnostic.propertyPath || '', diagnostic);
  }
  if (diagnostics.length) return result(null);
  return result({ format: 'viento-scene-model', schemaVersion: scene.schemaVersion,
    projectId: source.workspace.id, worldId: projection.world.id, worldRevision: projection.world.revision,
    scene: { objectId: sceneObjectId, sourcePath, sourceRevision: document.sourceRevision,
      title: scene.title, viewport: [...scene.viewport], background: scene.background },
    actors, resources: [...resources.values()],
    ...(scene.schemaVersion === 3 ? { groups: scene.groups.map(group => ({ ...group })) } : {}),
    sourceLocations: { scene: location(document), actors: actorSources, ...(scene.schemaVersion === 3 ? { groups: scene.groups.map((group, index) => ({
      groupId: group.groupId, declaration: location(document, `/groups/${index}`),
      fields: { name: location(document, `/groups/${index}/name`), parentGroupId: location(document, `/groups/${index}/parentGroupId`) },
    })) } : {}) } });
}
