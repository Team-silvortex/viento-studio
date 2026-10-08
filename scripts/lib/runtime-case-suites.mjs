import path from 'node:path';
import { createError } from '../../engine/service-error.mjs';
import { getCreatePathError } from '../../engine/document-contract.mjs';
import { inspectRuntimeCaseSuite, validateRuntimeCaseSuiteDependencies, validateRuntimeCaseSuitePlan } from '../../engine/runtime-case-suite.mjs';
import { inspectRuntimeCaseDocument } from '../../engine/runtime-case-document.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createRuntimeAuthorDocumentService } from './runtime-author-documents.mjs';
import { createRuntimeCaseDocumentService } from './runtime-case-documents.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const version = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (code, message, status = 422) => createError(status, message, {}, code);

export function createRuntimeCaseSuiteDocumentService(root, options) {
  const groups = createRuntimeAuthorDocumentService(root, { prefix:'runtime_suite', inspect:inspectRuntimeCaseSuite,
    dependencies:validateRuntimeCaseSuiteDependencies, definition:value => value }, options);
  const cases = createRuntimeCaseDocumentService(root, options);
  return { ...groups, async list(sceneId) {
    const catalog = await groups.list(sceneId), members = await cases.list(sceneId);
    return { ...catalog, cases:members.documents };
  } };
}

// Read all author inputs once before acquiring an execution slot. Later source
// changes affect the next batch, never the already-admitted member definitions.
export async function captureRuntimeCaseSuite(root, { documentId, documentRef = documentId, expectedVersion, plan, signal } = {}) {
  if (typeof documentRef !== 'string' || !uuid(documentRef) && getCreatePathError(documentRef)
    || expectedVersion !== undefined && !version(expectedVersion)) throw fail('runtime_suite_document_request', 'Select a registered suite and its source revision.',400);
  signal?.throwIfAborted();
  const { source } = await readWorldSnapshot(root);
  signal?.throwIfAborted();
  const group = source.documents.find(item => item.record?.id === documentRef || item.sourcePath === documentRef && item.record);
  if (!group) throw fail('runtime_suite_document_missing', 'The registered suite is unavailable.',404);
  if (expectedVersion !== undefined && group.sourceRevision !== expectedVersion) throw fail('runtime_suite_document_conflict', 'The suite changed; reload before running.',409);
  const checked = inspectRuntimeCaseSuite(group.content);
  if (!checked.recognized || !checked.ok) throw fail(checked.diagnostics[0]?.code || 'runtime_suite_invalid', 'Invalid runtime case suite.');
  const diagnostics = validateRuntimeCaseSuiteDependencies(checked.value,group.record,source);
  if (diagnostics.length) throw fail(diagnostics[0].code,diagnostics[0].message);
  const documents = new Map(source.documents.filter(item => item.record).map(item => [item.record.id,item]));
  const cases = checked.value.documentIds.map(id => {
    const item = documents.get(id), member = inspectRuntimeCaseDocument(item.content);
    if (!member.recognized || !member.ok || !version(item.sourceRevision)) throw fail('runtime_suite_invalid', 'The suite member is unavailable.');
    return Object.freeze({ documentId:id, title:path.basename(item.sourcePath).slice(0,160), sourceVersion:item.sourceRevision, document:member.value });
  });
  validateRuntimeCaseSuitePlan(plan,checked.value,cases.map(({documentId,document}) => ({documentId,document})));
  return Object.freeze({ documentId:group.record.id, sourceVersion:group.sourceRevision, sceneObjectId:checked.value.sceneObjectId,
    definition:checked.value, cases:Object.freeze(cases) });
}
