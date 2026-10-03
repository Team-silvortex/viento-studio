import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { preparePropertySet, validateWorldCommand } from '../../engine/world-commands.mjs';
import { prepareChangeSet } from '../../engine/world-changeset.mjs';
import { prepareObjectCreate } from '../../engine/world-object-create.mjs';
import { prepareSceneUpdate } from '../../engine/world-scene-update.mjs';
import { prepareSceneCreate } from '../../engine/world-scene-create.mjs';
import { prepareProjectionCreate } from '../../engine/world-object-projection.mjs';
import { prepareProjectionUpdate } from '../../engine/world-projection-update.mjs';
import { prepareRelationAdd } from '../../engine/world-relations.mjs';
import { prepareResourceBind } from '../../engine/world-resources.mjs';
import { createError } from '../../engine/service-error.mjs';
import { readWorldSnapshot } from './node-world-projection.mjs';
import { withRegistryLock } from '../lib/workspace.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { withDocumentTransaction, readDocumentSnapshot, writeDocumentAtomically } from '../lib/doc-file-store.mjs';
import { commitWorldTransaction, recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { checkFilesystemLocation } from '../lib/project-documents.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const conflict = () => createError(409, 'World changed; refresh and preview again', {}, 'world_revision_conflict');

async function readRecordContent(root, id) {
  const file = await resolveContainedPath(root, path.join(root, 'metadata/documents', `${id}.json`));
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw createError(413, 'Registration exceeds the command limit', {}, 'world_record_limit');
    const bytes = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== stat.size) throw conflict();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
  } finally { await handle.close(); }
}

async function prepare(snapshot, request, root) {
  if (['relation.add', 'resource.bind', 'projection.update', 'scene.update'].includes(request.command)) {
    if (!snapshot.source.documents.some(item => item.record?.id === request.objectId)) {
      throw createError(404, 'Registered object not found', {}, ['projection.update', 'scene.update'].includes(request.command) ? 'world_object_not_found' : request.command === 'relation.add' ? 'world_relation_object_missing' : 'world_resource_target_missing');
    }
    const planner = request.command === 'scene.update' ? prepareSceneUpdate : request.command === 'projection.update' ? prepareProjectionUpdate : request.command === 'relation.add' ? prepareRelationAdd : prepareResourceBind;
    const plan = await planner(snapshot.source, snapshot.projection, await readRecordContent(root, request.objectId), request, { digest });
    if (Buffer.byteLength(plan.plans.at(-1).afterContent) > 1024 * 1024) throw createError(413, 'Registration exceeds the command limit', {}, 'world_record_limit');
    if (['projection.update', 'scene.update'].includes(request.command) && (plan.plans.some(item => Buffer.byteLength(item.afterContent) > 8 * 1024 * 1024)
      || plan.plans.reduce((size, item) => size + Buffer.byteLength(item.beforeContent) + Buffer.byteLength(item.afterContent), 0) > 32 * 1024 * 1024
      || plan.nextSource.documents.reduce((size, item) => size + Buffer.byteLength(item.content || ''), 0) > 64 * 1024 * 1024)) {
      throw createError(413, 'ChangeSet exceeds the transaction source limit', {}, 'world_source_limit');
    }
    return plan;
  }
  if (['changeset.apply', 'object.create', 'scene.create', 'projection.create'].includes(request.command)) {
    const planner = request.command === 'projection.create' ? prepareProjectionCreate : request.command === 'scene.create' ? prepareSceneCreate : request.command === 'object.create' ? prepareObjectCreate : prepareChangeSet;
    const plan = await planner(snapshot.source, snapshot.projection, request, { digest });
    if (['object.create', 'scene.create', 'projection.create'].includes(request.command)) {
      for (const item of plan.plans) {
        await resolveContainedPath(root, path.join(root, item.sourcePath), { allowMissing: true });
        await checkFilesystemLocation(root, item.sourcePath);
      }
    }
    if (plan.plans.some(item => Buffer.byteLength(item.afterContent) > 8 * 1024 * 1024)
      || plan.plans.reduce((size, item) => size + Buffer.byteLength(item.beforeContent || '') + Buffer.byteLength(item.afterContent), 0) > 32 * 1024 * 1024
      || plan.nextSource.documents.reduce((size, item) => size + Buffer.byteLength(item.content || ''), 0) > 64 * 1024 * 1024) {
      throw createError(413, 'ChangeSet exceeds the transaction source limit', {}, 'world_source_limit');
    }
    return plan;
  }
  const object = snapshot.projection.objects.find(item => item.id === request.objectId);
  const document = snapshot.source.documents.find(item => item.sourcePath === object?.documentRefs[0].sourcePath);
  const plan = await preparePropertySet(snapshot.projection, document?.content, request, { digest });
  if (Buffer.byteLength(plan.afterContent) > 8 * 1024 * 1024
    || snapshot.source.documents.reduce((size, item) => size + Buffer.byteLength(item === document ? plan.afterContent : item.content || ''), 0) > 64 * 1024 * 1024) {
    throw createError(413, 'Edited source exceeds the projection read limit', {}, 'world_source_limit');
  }
  const next = await createWorldProjection({ ...snapshot.source,
    documents: snapshot.source.documents.map(item => item === document
      ? { ...item, content: plan.afterContent, sourceRevision: plan.change.afterSourceRevision } : item),
  }, { digest });
  const nextObject = next.objects.find(item => item.id === request.objectId);
  return { ...plan, result: { status: 'preview', worldId: request.worldId, baseRevision: request.baseRevision,
    revision: next.world.revision, proposal: plan.proposal, change: plan.change,
    inverseCommand: { ...request, mode: 'preview', baseRevision: next.world.revision, objectRevision: nextObject.revision,
      sourceRevision: plan.change.afterSourceRevision, value: plan.change.beforeValue } } };
}

export function createWorldCommandService(root, { checkpoint } = {}) {
  return async rawRequest => {
    const request = validateWorldCommand(rawRequest);
    try {
      const physicalRoot = await fs.realpath(root);
      if (request.command === 'world.recover') return await recoverWorldTransaction(physicalRoot, { checkpoint });
      const initial = await prepare(await readWorldSnapshot(physicalRoot), request, physicalRoot);
      if (request.mode === 'preview') return initial.result;
      if (['changeset.apply', 'object.create', 'scene.create', 'projection.create', 'projection.update', 'scene.update', 'relation.add', 'resource.bind'].includes(request.command)) {
        // Never acquire a document queue while holding the registry lock. Legacy
        // writers already hold their queue when waiting for this same lock.
        return await withRegistryLock(physicalRoot, async () => {
          const plan = await prepare(await readWorldSnapshot(physicalRoot), request, physicalRoot);
          return commitWorldTransaction(physicalRoot, plan, { checkpoint, beforeIntent: async () => {
            if ((await readWorldSnapshot(physicalRoot)).projection.world.revision !== request.baseRevision) throw conflict();
          } });
        });
      }
      // Use the same ordering as the legacy editor: document queue, then the
      // cross-process registry lock. Re-read all authority inside that lock.
      return await withDocumentTransaction(initial.sourcePath, () => withRegistryLock(physicalRoot, async () => {
        const plan = await prepare(await readWorldSnapshot(physicalRoot), request, physicalRoot);
        if (plan.beforeContent === plan.afterContent) return { ...plan.result, status: 'unchanged' };
        const absolute = await resolveContainedPath(physicalRoot, path.join(physicalRoot, plan.sourcePath));
        const previous = await readDocumentSnapshot(absolute);
        if (previous.version !== request.sourceRevision) throw conflict();
        await writeDocumentAtomically(absolute, plan.afterContent, { previousStats: previous.stats,
          beforePublish: async () => {
            // Catch non-cooperating edits observed before publication, including
            // metadata and same-size source replacements with preserved mtimes.
            const latest = await readWorldSnapshot(physicalRoot);
            if (latest.projection.world.revision !== request.baseRevision) throw conflict();
            await resolveContainedPath(physicalRoot, absolute);
            if ((await readDocumentSnapshot(absolute)).version !== request.sourceRevision) throw conflict();
          },
        });
        // The receipt describes exactly what was published. A later read/index
        // failure must never turn a successful source write into a failed save.
        return { ...plan.result, status: 'applied' };
      }));
    } catch (error) {
      if (error.statusCode && error.errorCode?.startsWith('world_')) throw error;
      if (error.errorCode === 'document already exists') throw createError(409, 'This source location is already reserved', {}, 'world_create_path_conflict');
      if (error.errorCode === 'registry_busy') throw createError(409, 'Workspace is busy; retry after the current write', {}, 'world_write_busy');
      throw createError(422, 'Cannot execute this world command', {}, 'world_command_unavailable');
    }
  };
}
