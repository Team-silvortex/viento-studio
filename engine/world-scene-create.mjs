import { validateWorldCommand } from './world-command-contract.mjs';
import { prepareObjectCreate } from './world-object-create.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { createScene2DPlan, validateScene2DRegistration } from './build-plan.mjs';
import { registrationGuard } from './world-record-edit.mjs';
import { createError } from './service-error.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalidScene = diagnostics => { throw createError(422, 'The scene declaration is invalid', { diagnostics }, 'world_scene_invalid'); };

// Derive only the allowed dependency edges. Invalid declarations still reach
// the build planner, which owns Scene2D validation and diagnostic locations.
export function sceneCreateRegistration(record, content) {
  let scene;
  try { scene = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { /* diagnosed by createScene2DPlan */ }
  const actors = Array.isArray(scene?.actors) ? scene.actors.slice(0, 128) : [];
  return { ...record,
    relations: [...new Set(actors.map(actor => actor?.objectId).filter(uuid))]
      .map(targetId => ({ kind: 'references', targetId, slot: '' })),
    assetBindings: [...new Set(actors.map(actor => actor?.imageResourceId).filter(uuid))]
      .map(assetId => ({ assetId, role: 'image' })),
  };
}

// Recovery checks the declaration against guarded registrations. Actor source
// bytes are not transaction inputs: they were checked by the complete World
// revision at apply time and are never restored by this two-file transaction.
export function validateSceneCreateRegistration(record, content, registry) {
  const records = [...registry.documents.filter(item => item.id !== record.id), record];
  return validateScene2DRegistration({ source: { workspace: {}, documents: records.map(item => ({ record: item,
    sourcePath: item.sourcePath, content: item.id === record.id ? content : '', sourceRevision: null })) },
  projection: { world: {}, diagnostics: [], objects: records.map(item => ({ id: item.id, name: item.id })),
    resources: registry.assets.map(item => ({ id: item.id, descriptor: item })),
    relations: records.flatMap(item => (item.relations || []).map(relation => ({ sourceObjectId: item.id, targetObjectId: relation.targetId }))),
    resourceBindings: records.flatMap(item => (item.assetBindings || []).map(binding => ({ objectId: item.id, resourceId: binding.assetId }))),
  } }, record.id);
}

export async function prepareSceneCreate(source, projection, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'scene.create') throw createError(400, 'Expected scene.create', {}, 'world_command_invalid');
  let base;
  try { base = await prepareObjectCreate(source, projection, { ...request, command: 'object.create' }, { digest }); }
  catch (error) {
    if (error.errorCode !== 'world_create_source_invalid') throw error;
    const checked = createScene2DPlan({ source: { ...source, documents: [...source.documents, {
      record: { id: request.objectId }, sourcePath: request.sourcePath, content: request.content,
    }] }, projection }, request.objectId);
    invalidScene(checked.diagnostics);
  }
  const change = { ...base.result.changes[0], kind: 'scene.create',
    record: sceneCreateRegistration(base.result.changes[0].record, request.content) };
  const nextSource = { ...base.nextSource, documents: base.nextSource.documents.map(item => item.record?.id === request.objectId
    ? { ...item, record: change.record, descriptor: { ...item.descriptor, ...change.record } } : item) };
  const next = await createWorldProjection(nextSource, { digest });
  const checked = createScene2DPlan({ source: nextSource, projection: next }, request.objectId);
  if (!checked.ok) invalidScene(checked.diagnostics);
  const { mode, ...input } = request;
  const proposal = { ...base.result.proposal, id: `proposal:${await digest(canonicalJson(input))}`,
    commands: [{ id: request.command, input }],
    preconditions: change.record.relations.map(({ targetId }) => ({ objectId: targetId,
      revision: projection.objects.find(item => item.id === targetId).revision })) };
  const registry = { documents: source.documents.filter(item => item.record).map(item => item.record),
    assets: (source.assets || []).map(item => item.record) };
  const recordContent = `${JSON.stringify(change.record, null, 2)}\n`;
  return { kind: 'scene.create', nextSource, registryHash: `sha256:${await digest(registrationGuard(registry, request.objectId))}`,
    plans: [{ ...base.plans[0], change }, { ...base.plans[1], afterContent: recordContent,
      change: { ...base.plans[1].change, afterSourceRevision: `sha256:${await digest(recordContent)}` } }],
    result: { ...base.result, revision: next.world.revision, proposal, changes: [change],
      object: next.objects.find(item => item.id === request.objectId) } };
}
