import { preparePropertySet } from './world-commands.mjs';
import { validateWorldCommand } from './world-command-contract.mjs';
import { createWorldProjection, canonicalJson } from './world-projection.mjs';
import { createError } from './service-error.mjs';

// Portable planning only. No persistence, locks, or recovery policy in Core.
export async function prepareChangeSet(source, projection, rawRequest, { digest }) {
  const request = validateWorldCommand(rawRequest);
  if (request.command !== 'changeset.apply') throw createError(400, 'Expected changeset.apply', {}, 'world_command_invalid');
  const plans = [];
  for (const command of request.commands) {
    const object = projection.objects.find(item => item.id === command.objectId);
    const document = source.documents.find(item => item.sourcePath === object?.documentRefs[0]?.sourcePath);
    plans.push(await preparePropertySet(projection, document?.content, { ...command, mode: request.mode,
      worldId: request.worldId, baseRevision: request.baseRevision, actorRef: request.actorRef }, { digest }));
  }
  const bySource = new Map(plans.map(plan => [plan.sourcePath, plan]));
  if (bySource.size !== plans.length) throw createError(400, 'Duplicate source in ChangeSet', {}, 'world_command_invalid');
  const nextSource = { ...source, documents: source.documents.map(item => {
    const plan = bySource.get(item.sourcePath);
    return plan ? { ...item, content: plan.afterContent, sourceRevision: plan.change.afterSourceRevision } : item;
  }) };
  const next = await createWorldProjection(nextSource, { digest });
  const { mode, ...input } = request;
  const proposal = { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${await digest(canonicalJson(input))}`,
    worldId: request.worldId, actorRef: request.actorRef, baseRevision: request.baseRevision,
    commands: request.commands.map(command => ({ id: command.command, input: command })),
    preconditions: request.commands.map(command => ({ objectId: command.objectId, revision: command.objectRevision })),
    affectedObjects: request.commands.map(command => command.objectId), state: 'proposed' };
  return { plans, nextSource, result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision,
    revision: next.world.revision, proposal, changes: plans.map(plan => plan.change),
    inverseCommand: { ...request, mode: 'preview', baseRevision: next.world.revision,
      commands: plans.map(plan => ({ command: 'property.set', objectId: plan.change.objectId,
        objectRevision: next.objects.find(object => object.id === plan.change.objectId).revision,
        sourceRevision: plan.change.afterSourceRevision, propertyPath: plan.change.propertyPath, value: plan.change.beforeValue })) } } };
}
