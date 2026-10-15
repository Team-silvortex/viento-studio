import path from 'node:path';
import { createHash } from 'node:crypto';
import { createError } from '../../engine/service-error.mjs';
import { createDocumentStore } from '../../engine/document-store.mjs';
import { getCreatePathError, API_ERRORS } from '../../engine/document-contract.mjs';
import { canonicalJson, createWorldProjection } from '../../engine/world-projection.mjs';
import { inspectProjectAssembly, validateProjectAssemblyDependencies } from '../../engine/project-assembly.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createNodeDocumentStorage } from '../adapters/node-document-storage.mjs';
import { resolveContainedPath } from './contained-path.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (code, message, status = 400, diagnostics = []) => createError(status, message, { diagnostics }, code);
const conflict = () => fail('project_assembly_document_conflict', 'The saved project changed; refresh and review the assembly again.', 409);
const digest = value => createHash('sha256').update(value).digest('hex');
const identity = observed => ({ worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision });
const sceneValue = document => {
  const parsed = parseJsonSource(document.content);
  return document.record && document.sourceRevision && document.sourcePath.toLowerCase().endsWith('.json') && parsed.ok
    && parsed.value?.format === 'viento-scene2d' && [1, 2, 3].includes(parsed.value.schemaVersion) ? parsed.value : null;
};
function documentView(observed, document, content = false) {
  const checked = inspectProjectAssembly(document.content);
  const diagnostics = checked.ok && checked.recognized ? validateProjectAssemblyDependencies(checked.value, document.record, observed.source) : checked.diagnostics;
  return { ...identity(observed), id: document.record.id, path: document.sourcePath, documentType: document.record.documentType,
    title: checked.value?.title || path.basename(document.sourcePath), version: document.sourceRevision,
    valid: Boolean(checked.recognized && checked.ok && !diagnostics.length), diagnostics,
    ...(content ? { content: document.content, definition: checked.ok ? checked.value : null } : {}) };
}
function captureSave(raw) {
  const bad = () => { throw fail('project_assembly_document_request', 'Invalid assembly save request.'); };
  if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) bad();
  const properties = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(properties), output = {};
  const updating = Object.hasOwn(properties, 'documentId');
  const allowed = ['worldId', 'baseRevision', 'content', ...(updating ? ['documentId', 'expectedVersion'] : ['sourcePath', 'documentType']), ...(Object.hasOwn(properties, 'action') ? ['action'] : [])];
  if (keys.length !== allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key) || !properties[key].enumerable || !Object.hasOwn(properties[key], 'value') || typeof properties[key].value !== 'string')) bad();
  for (const key of keys) output[key] = properties[key].value;
  if (output.action !== undefined && output.action !== 'assembly-save' || !/^world:[a-f0-9]{64}$/.test(output.worldId) || !revision(output.baseRevision)
    || (updating ? !uuid(output.documentId) || !revision(output.expectedVersion) : !output.sourcePath || !output.documentType)) bad();
  return { input: output, updating };
}

// A normal registered JSON author document; no engine/tool access and no extra
// metadata references. Semantic member dependencies belong to its source.
export function createProjectAssemblyDocumentService(root, { onWrite = () => {}, beforePublish = () => {} } = {}) {
  async function list() {
    const observed = await readWorldSnapshot(root), source = observed.source;
    return { ...identity(observed), scenes: source.documents.flatMap(document => {
      const value = sceneValue(document); return value ? [{ id: document.record.id, path: document.sourcePath, title: value.title || path.basename(document.sourcePath), version: document.sourceRevision }] : [];
    }), documents: source.documents.filter(document => document.record && inspectProjectAssembly(document.content).recognized).map(document => documentView(observed, document)),
    defaults: { documentsPath: source.definition.paths.documents, documentType: source.definition.documentTypes[0]?.id || '',
      documentTypes: source.definition.documentTypes.map(type => ({ id: type.id, label: type.label || type.id })) } };
  }
  async function load(documentId) {
    if (!uuid(documentId)) throw fail('project_assembly_document_request', 'Invalid assembly identity.');
    const observed = await readWorldSnapshot(root), document = observed.source.documents.find(item => item.record?.id === documentId);
    if (!document || !inspectProjectAssembly(document.content).recognized) throw fail('project_assembly_document_missing', 'The registered assembly source is unavailable.', 404);
    return documentView(observed, document, true);
  }
  async function save(raw) {
    const { input, updating } = captureSave(raw), checked = inspectProjectAssembly(input.content);
    if (!checked.recognized || !checked.ok) throw fail('project_assembly_document_invalid', 'Provide a complete project assembly JSON document.', 422, checked.diagnostics);
    const observed = await readWorldSnapshot(root), source = observed.source;
    if (observed.projection.world.id !== input.worldId || observed.projection.world.revision !== input.baseRevision) throw conflict();
    const existing = updating && source.documents.find(item => item.record?.id === input.documentId);
    if (updating && (!existing || !inspectProjectAssembly(existing.content).recognized)) throw fail('project_assembly_document_missing', 'The registered assembly source is unavailable.', 404);
    if (updating && existing.sourceRevision !== input.expectedVersion) throw conflict();
    const sourcePath = updating ? existing.sourcePath : input.sourcePath;
    if (getCreatePathError(sourcePath) || !sourcePath.startsWith(source.definition.paths.documents + '/') || !sourcePath.toLowerCase().endsWith('.json')) {
      throw fail('project_assembly_document_path', 'Choose a portable JSON location inside the project document directory.');
    }
    if (!updating && !source.definition.documentTypes.some(type => type.id === input.documentType)) throw fail('project_assembly_document_type', 'Select a current project document type.');
    const errors = validateProjectAssemblyDependencies(checked.value, existing?.record || {}, source);
    if (errors.length) throw fail('project_assembly_document_invalid', 'The assembly members are unavailable or invalid.', 422, errors);
    let createdId = null;
    const store = createDocumentStore({ editablePrefixes: [source.definition.paths.documents + '/'], onWrite,
      storage: createNodeDocumentStorage({ root,
        async resolvePath(relativePath, { allowCreate }) {
          return { relativePath, absolutePath: await resolveContainedPath(root, path.join(root, relativePath), { allowMissing: allowCreate }), exists: !allowCreate };
        },
        async prepareWrite() { return async () => {
          await beforePublish();
          const fresh = await readWorldSnapshot(root);
          if (fresh.projection.world.id !== input.worldId) throw conflict();
          let projected = fresh.projection;
          if (!updating) {
            // Registration reserves this operation's identity before source publication.
            const created = fresh.source.documents.find(document => document.sourcePath === sourcePath);
            if (!created?.record || created.content != null || created.sourceRevision != null || created.record.documentType !== input.documentType
              || created.record.relations.length || created.record.assetBindings.length || source.documents.some(item => item.record?.id === created.record.id)) throw conflict();
            createdId = created.record.id;
            projected = await createWorldProjection({ ...fresh.source, documents: fresh.source.documents.filter(document => document !== created) }, { digest });
          }
          if (projected.world.revision !== input.baseRevision) throw conflict();
          const current = fresh.source.documents.find(document => document.record?.id === input.documentId);
          if (updating && (!current || current.sourceRevision !== input.expectedVersion || canonicalJson(current.record) !== canonicalJson(existing.record))) throw conflict();
          const diagnostics = validateProjectAssemblyDependencies(checked.value, existing?.record || { id: createdId }, fresh.source);
          if (diagnostics.length) throw fail('project_assembly_document_invalid', 'The assembly members changed before publication.', 422, diagnostics);
        }; },
      }) });
    try { await store.writeDoc({ path: sourcePath, content: input.content, ...(updating ? { expectedVersion: input.expectedVersion } : { create: true, documentType: input.documentType }) }); }
    catch (error) {
      if (error.errorCode === API_ERRORS.conflict) throw conflict();
      if (error.errorCode === API_ERRORS.alreadyExists) throw fail('project_assembly_document_exists', 'The assembly location is already reserved.', 409);
      throw error;
    }
    const next = await readWorldSnapshot(root), saved = next.source.documents.find(item => item.record?.id === (updating ? input.documentId : createdId));
    if (!saved || saved.content !== input.content) throw fail('project_assembly_document_result_unknown', 'The saved assembly could not be confirmed; read the project before retrying.', 409);
    return documentView(next, saved, true);
  }
  return Object.freeze({ list, load, save });
}
