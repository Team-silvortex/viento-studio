import { parseDocument, isMap, isSeq } from 'yaml';
import { validateWorldCommand } from './world-command-contract.mjs';
import { createScene2DPlan } from './build-plan.mjs';
import { validateSceneCreateRegistration } from './world-scene-create.mjs';
import { appendRelationRecord } from './world-relations.mjs';
import { appendResourceBinding } from './world-resources.mjs';
import { registrationGuard } from './world-record-edit.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { createError } from './service-error.mjs';

const fail = (status, code, message, payload = {}) => { throw createError(status, message, payload, code); };
const invalid = (message, propertyPath = '', diagnostics) => fail(422, 'world_scene_invalid', message, {
  diagnostics: diagnostics?.length ? diagnostics : [{ severity: 'error', code: 'build_scene_value', message, propertyPath }],
});
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');

// Rebuild only changed JSON containers. Existing keys, scalar spellings and
// whitespace survive; actors are matched by identity when their order changes.
// Recovery replays this exact transformation, never trusting arbitrary after bytes.
export function updateSceneContent(beforeContent, candidateContent) {
  const parse = content => {
    let value;
    try { value = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { invalid('The scene is not valid JSON', '', [{ severity: 'error', code: 'build_scene_json', message: 'The scene is not valid JSON', propertyPath: '' }]); }
    const offset = content.startsWith('\uFEFF') ? 1 : 0;
    const parsed = parseDocument(content.slice(offset), { keepSourceTokens: true, intAsBigInt: true, uniqueKeys: true });
    if (parsed.errors.length || !isMap(parsed.contents)) invalid('The scene cannot be edited losslessly');
    if (!plain(value) || value.format !== 'viento-scene2d' || value.schemaVersion !== 1) invalid('Expected viento-scene2d schemaVersion 1', '', [{ severity: 'error', code: 'build_scene_format', message: 'Expected viento-scene2d schemaVersion 1', propertyPath: '' }]);
    return { value, root: parsed.contents, offset };
  };
  const original = parse(beforeContent), candidate = parse(candidateContent), source = beforeContent.slice(original.offset);
  const changedPaths = [], raw = node => source.slice(node.range[0], node.range[1]);
  const render = (node, before, after, location) => {
    if (same(before, after)) return raw(node);
    if (isMap(node) && plain(before) && plain(after)) {
      const entries = node.items, existing = new Map(entries.map(pair => [pair.key.value, pair]));
      const keys = [...entries.map(pair => pair.key.value).filter(key => Object.hasOwn(after, key)), ...Object.keys(after).filter(key => !existing.has(key))];
      const pieces = keys.map(key => {
        const pair = existing.get(key), next = `${location}/${pointer(key)}`;
        if (!pair) { changedPaths.push(next); return `${JSON.stringify(key)}: ${JSON.stringify(after[key])}`; }
        return source.slice(pair.key.range[0], pair.value.range[0]) + render(pair.value, before[key], after[key], next);
      });
      for (const key of existing.keys()) if (!Object.hasOwn(after, key)) changedPaths.push(`${location}/${pointer(key)}`);
      const start = entries[0]?.key.range[0] ?? node.range[0] + 1, end = entries.at(-1)?.value.range[1] ?? start;
      const separator = entries.length > 1 ? source.slice(entries[0].value.range[1], entries[1].key.range[0]) : ', ';
      const joined = pieces.map((piece, index) => {
        if (!index) return piece;
        const previous = entries.indexOf(existing.get(keys[index - 1])), current = entries.indexOf(existing.get(keys[index]));
        return (previous >= 0 && current === previous + 1 ? source.slice(entries[previous].value.range[1], entries[current].key.range[0]) : separator) + piece;
      }).join('');
      return source.slice(node.range[0], start) + joined + source.slice(end, node.range[1]);
    }
    if (isSeq(node) && Array.isArray(before) && Array.isArray(after)) {
      const actors = location === '/actors';
      const identities = actors ? new Map(before.map((actor, index) => [actor?.objectId, index])) : null;
      if (actors && !same(before.map(actor => actor?.objectId), after.map(actor => actor?.objectId))) changedPaths.push(location);
      const previousIndices = after.map((value, index) => actors ? identities.get(value?.objectId) : index);
      const pieces = after.map((value, index) => {
        const previous = previousIndices[index];
        if (previous === undefined || previous >= node.items.length) { if (!actors) changedPaths.push(`${location}/${index}`); return JSON.stringify(value); }
        return render(node.items[previous], before[previous], value, `${location}/${index}`);
      });
      if (!actors && before.length !== after.length) changedPaths.push(location);
      const start = node.items[0]?.range[0] ?? node.range[0] + 1, end = node.items.at(-1)?.range[1] ?? start;
      const separator = node.items.length > 1 ? source.slice(node.items[0].range[1], node.items[1].range[0]) : ', ';
      const joined = pieces.map((piece, index) => {
        if (!index) return piece;
        const previous = previousIndices[index - 1], current = previousIndices[index];
        return (previous !== undefined && current === previous + 1 && current < node.items.length
          ? source.slice(node.items[previous].range[1], node.items[current].range[0]) : separator) + piece;
      }).join('');
      return source.slice(node.range[0], start) + joined + source.slice(end, node.range[1]);
    }
    changedPaths.push(location); return JSON.stringify(after);
  };
  const root = original.root;
  const afterContent = beforeContent.slice(0, original.offset + root.range[0]) + render(root, original.value, candidate.value, '')
    + beforeContent.slice(original.offset + root.range[1]);
  let after;
  try { after = JSON.parse(afterContent.replace(/^\uFEFF/, '')); } catch { invalid('The scene cannot be edited without changing other data'); }
  if (!same(after, candidate.value)) invalid('The scene cannot be edited without changing other data');
  return { before: original.value, after, afterContent, changedPaths: [...new Set(changedPaths)] };
}

// Keep old relationships/bindings for other consumers and append only newly
// required dependencies. Removed actors no longer participate in the scene.
export function appendSceneDependencies(recordContent, declaration) {
  let before;
  try { before = JSON.parse(recordContent); } catch { invalid('Scene registration is not valid JSON'); }
  if (!Array.isArray(before.relations) || !Array.isArray(before.assetBindings)) invalid('Scene dependencies must be registered');
  let after = before, afterContent = recordContent;
  const addedRelations = [], addedBindings = [];
  for (const actor of Array.isArray(declaration.actors) ? declaration.actors : []) {
    if (typeof actor?.objectId === 'string' && !after.relations.some(item => item.targetId === actor.objectId)) {
      const relation = { kind: 'references', targetId: actor.objectId, slot: '' }, edit = appendRelationRecord(afterContent, relation);
      after = edit.after; afterContent = edit.afterContent; addedRelations.push(relation);
    }
    if (typeof actor?.imageResourceId === 'string' && !after.assetBindings.some(item => item.assetId === actor.imageResourceId)) {
      const binding = { assetId: actor.imageResourceId, role: 'image' }, edit = appendResourceBinding(afterContent, binding);
      after = edit.after; afterContent = edit.afterContent; addedBindings.push(binding);
    }
  }
  return { before, after, afterContent, addedRelations, addedBindings };
}

export async function prepareSceneUpdate(source, projection, recordContent, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'scene.update') fail(400, 'world_command_invalid', 'Expected scene.update');
  const conflict = () => fail(409, 'world_revision_conflict', 'World, object or source changed; refresh and preview again');
  if (projection.world.id !== request.worldId || projection.world.revision !== request.baseRevision) conflict();
  const object = projection.objects.find(item => item.id === request.objectId);
  if (!object) fail(404, 'world_object_not_found', 'Object not found');
  if (object.revision !== request.objectRevision || object.documentRefs[0]?.sourceRevision !== request.sourceRevision) conflict();
  const document = source.documents.find(item => item.record?.id === object.id), sourcePath = document?.sourcePath || '';
  try {
    if (![2, 3].includes(source.workspace.version) || !document || !sourcePath.toLowerCase().endsWith('.json')
      || !source.definition.documentTypes.some(item => item.id === document.record.documentType)) invalid('An available registered Scene2D document is required');
    if (typeof document.content !== 'string' || `sha256:${await digest(document.content)}` !== request.sourceRevision) conflict();
    const registry = { documents: source.documents.filter(item => item.record).map(item => item.record), assets: (source.assets || []).map(item => item.record) };
    const beforeChecked = validateSceneCreateRegistration(document.record, document.content, registry);
    if (!beforeChecked.ok) invalid('The existing scene registration is invalid', '', beforeChecked.diagnostics);
    const edit = updateSceneContent(document.content, request.content);
    let metadata;
    // An unchanged valid scene does not acquire redundant scene-owned image
    // bindings when its existing actors already provide those registrations.
    try { metadata = appendSceneDependencies(recordContent, edit.changedPaths.length ? edit.after : { actors: [] }); }
    catch (error) { if (error.errorCode !== 'world_record_invalid') throw error; invalid('The scene dependencies are invalid'); }
    if (!same(metadata.before, document.record)) conflict();
    const afterSourceRevision = `sha256:${await digest(edit.afterContent)}`;
    const nextSource = { ...source, documents: source.documents.map(item => item === document ? {
      ...item, content: edit.afterContent, sourceRevision: afterSourceRevision, record: metadata.after,
      descriptor: { ...item.descriptor, relations: metadata.after.relations, assetBindings: metadata.after.assetBindings },
    } : item) };
    const next = await createWorldProjection(nextSource, { digest }), checked = createScene2DPlan({ source: nextSource, projection: next }, object.id);
    if (!checked.ok) invalid('The scene declaration is invalid', '', checked.diagnostics);
    const { mode, ...input } = request;
    const proposal = { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${await digest(canonicalJson(input))}`,
      worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
      commands: [{ id: request.command, input }], preconditions: [{ objectId: object.id, revision: object.revision }], affectedObjects: [object.id], state: 'proposed' };
    const recordPath = `metadata/documents/${object.id}.json`;
    const change = { kind: 'scene.update', objectId: object.id, sourcePath, recordPath, changedPaths: edit.changedPaths,
      addedRelations: metadata.addedRelations, addedBindings: metadata.addedBindings,
      beforeSourceRevision: request.sourceRevision, afterSourceRevision,
      beforeRecordRevision: `sha256:${await digest(recordContent)}`, afterRecordRevision: `sha256:${await digest(metadata.afterContent)}` };
    return { kind: 'scene.update', nextSource, registryHash: `sha256:${await digest(registrationGuard(registry, object.id))}`,
      plans: [{ sourcePath, beforeContent: document.content, afterContent: edit.afterContent, change },
        { sourcePath: recordPath, beforeContent: recordContent, afterContent: metadata.afterContent,
          change: { objectId: object.id, beforeSourceRevision: change.beforeRecordRevision, afterSourceRevision: change.afterRecordRevision } }],
      result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: next.world.revision,
        proposal, changes: [{ ...change, afterText: edit.afterContent }], object: next.objects.find(item => item.id === object.id) } };
  } catch (error) {
    if (error.errorCode === 'world_scene_invalid') error.payload.diagnostics = error.payload.diagnostics.map(item => ({ objectId: object.id, sourcePath, ...item }));
    throw error;
  }
}
