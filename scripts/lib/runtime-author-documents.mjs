import path from 'node:path';
import { createError } from '../../engine/service-error.mjs';
import { createDocumentStore } from '../../engine/document-store.mjs';
import { getCreatePathError, API_ERRORS } from '../../engine/document-contract.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createNodeDocumentStorage } from '../adapters/node-document-storage.mjs';
import { resolveContainedPath } from './contained-path.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const version = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (code, message, status = 400) => createError(status, message, {}, code);
const checkedScene = (source, id, prefix) => {
  const scene = source.documents.find(item => item.record?.id === id);
  let value; try { value = JSON.parse(scene?.content?.replace(/^\uFEFF/, '')); } catch { /* Diagnosed below. */ }
  if (!scene?.sourceRevision || !scene.sourcePath.toLowerCase().endsWith('.json') || value?.format !== 'viento-scene2d'
    || ![2, 3].includes(value.schemaVersion)) throw fail(`${prefix}_scene_missing`, 'Select an available registered Scene2D with stable instance identities.', 422);
  return scene;
};

function inspectDocument(source, document, descriptor) {
  const checked = descriptor.inspect(document.content);
  const diagnostics = checked.ok ? descriptor.dependencies(checked.value, document.record, source) : checked.diagnostics;
  return { checked, diagnostics, valid: checked.recognized && checked.ok && diagnostics.length === 0 };
}

function documentView(source, document, descriptor, { content = false } = {}) {
  const { checked, diagnostics, valid } = inspectDocument(source, document, descriptor);
  const sceneId = checked.value?.sceneObjectId || (() => {
    try { return JSON.parse(document.content?.replace(/^\uFEFF/, '')).sceneObjectId; } catch { return null; }
  })();
  const scene = source.documents.find(item => item.record?.id === sceneId);
  return { id: document.record.id, path: document.sourcePath, title: path.basename(document.sourcePath),
    version: document.sourceRevision, sceneId: uuid(sceneId) ? sceneId : null, valid, diagnostics,
    ...(content ? { content: document.content, definition: checked.ok ? descriptor.definition(checked.value) : null, sceneVersion: scene?.sourceRevision || null } : {}) };
}

// Author documents use the existing exclusive registration and atomic source
// writer. Their source revision is separate from a run's canonical case SHA.
export function createRuntimeAuthorDocumentService(root, descriptor, { onWrite = () => {}, beforePublish = () => {} } = {}) {
  const { prefix } = descriptor;
  async function list(sceneId) {
    if (!uuid(sceneId)) throw fail(`${prefix}_document_request`, 'Invalid scene identity.');
    const { source } = await readWorldSnapshot(root), scene = checkedScene(source, sceneId, prefix);
    const documents = source.documents.filter(item => item.record && descriptor.inspect(item.content).recognized)
      .map(item => documentView(source, item, descriptor)).filter(item => item.sceneId === sceneId);
    return { sceneId, sceneVersion: scene.sourceRevision, documents,
      defaults: { documentsPath: source.definition.paths.documents, documentType: source.definition.documentTypes[0]?.id || '',
        documentTypes: source.definition.documentTypes.map(item => ({ id: item.id, label: item.label || item.id })) } };
  }

  async function load(documentId) {
    if (!uuid(documentId)) throw fail(`${prefix}_document_request`, 'Invalid document identity.');
    const { source } = await readWorldSnapshot(root);
    const document = source.documents.find(item => item.record?.id === documentId);
    if (!document || !descriptor.inspect(document.content).recognized) throw fail(`${prefix}_document_missing`, 'This registered runtime author document is unavailable.', 404);
    return documentView(source, document, descriptor, { content: true });
  }

  async function save(raw) {
    // Capture all scalars before the first await. No caller-owned input enters
    // the writer, nor can HTTP select a force overwrite or an unregistered file.
    const input = { ...raw };
    if (!uuid(input.sceneId) || !version(input.sceneVersion) || typeof input.content !== 'string') throw fail(`${prefix}_document_request`, 'Invalid runtime author save request.');
    const parsed = descriptor.inspect(input.content);
    if (!parsed.recognized || !parsed.ok) throw fail(parsed.diagnostics?.[0]?.code || `${prefix}_document_invalid`, 'Invalid runtime author document.', 422);
    if (parsed.value.sceneObjectId !== input.sceneId) throw fail(`${prefix}_scene_mismatch`, 'The case belongs to a different scene.', 422);
    const updating = input.documentId !== undefined;
    if (updating ? !uuid(input.documentId) || !version(input.expectedVersion) || input.sourcePath !== undefined || input.documentType !== undefined
      : typeof input.sourcePath !== 'string' || typeof input.documentType !== 'string' || !input.documentType || input.expectedVersion !== undefined) {
      throw fail(`${prefix}_document_request`, 'Choose either an existing document with its source revision or a new document location and type.');
    }
    const observed = await readWorldSnapshot(root), source = observed.source, scene = checkedScene(source, input.sceneId, prefix);
    if (scene.sourceRevision !== input.sceneVersion) throw fail(`${prefix}_scene_conflict`, 'The author scene changed; refresh before saving.', 409);
    const existing = updating && source.documents.find(item => item.record?.id === input.documentId);
    if (updating && (!existing || !descriptor.inspect(existing.content).recognized)) throw fail(`${prefix}_document_missing`, 'This registered runtime author document is unavailable.', 404);
    if (updating && documentView(source, existing, descriptor).sceneId !== input.sceneId) throw fail(`${prefix}_scene_mismatch`, 'The existing case belongs to a different scene.', 422);
    const sourcePath = updating ? existing.sourcePath : input.sourcePath;
    if (getCreatePathError(sourcePath) || !sourcePath.startsWith(`${source.definition.paths.documents}/`) || !sourcePath.toLowerCase().endsWith('.json')) {
      throw fail(`${prefix}_document_path`, 'Choose a portable .json location inside the project document directory.');
    }
    const record = updating ? existing.record : { format: 'viento-document', id: null, sourcePath };
    const diagnostics = descriptor.dependencies(parsed.value, record, source);
    if (diagnostics.length) throw fail(diagnostics[0].code, diagnostics[0].message, 422);
    const store = createDocumentStore({ editablePrefixes: [`${source.definition.paths.documents}/`], onWrite,
      storage: createNodeDocumentStorage({ root,
        async resolvePath(relativePath, { allowCreate }) {
          const absolutePath = await resolveContainedPath(root, path.join(root, relativePath), { allowMissing: allowCreate });
          return { relativePath, absolutePath, exists: !allowCreate };
        },
        async prepareWrite() {
          return async () => {
            await beforePublish();
            // Registry commands share the storage lock. Re-observe source bytes
            // as well: an external editor need not honour that process lock.
            const fresh = (await readWorldSnapshot(root)).source, currentScene = checkedScene(fresh, input.sceneId, prefix);
            if (currentScene.sourceRevision !== input.sceneVersion || canonicalJson(currentScene.record) !== canonicalJson(scene.record)) {
              throw fail(`${prefix}_scene_conflict`, 'The author scene changed before publication.', 409);
            }
            const current = fresh.documents.find(item => item.record?.id === input.documentId);
            if (updating && (!current || current.sourceRevision !== input.expectedVersion || canonicalJson(current.record) !== canonicalJson(existing.record))) {
              throw fail(`${prefix}_document_conflict`, 'The case changed before publication; reload or save a new copy.', 409);
            }
            const errors = descriptor.dependencies(parsed.value, record, fresh);
            if (errors.length) throw fail(errors[0].code, errors[0].message, 422);
          };
        },
      }),
    });
    try {
      await store.writeDoc({ path: sourcePath, content: input.content, ...(updating ? { expectedVersion: input.expectedVersion }
        : { create: true, documentType: input.documentType }) });
    } catch (caught) {
      if (caught.errorCode === API_ERRORS.conflict) throw fail(`${prefix}_document_conflict`, 'The case changed; reload or save a new copy.', 409);
      if (caught.errorCode === API_ERRORS.alreadyExists) throw fail(`${prefix}_document_exists`, 'The new document location is already reserved.', 409);
      throw caught;
    }
    const next = (await readWorldSnapshot(root)).source;
    const saved = next.documents.find(item => item.sourcePath === sourcePath && item.record);
    if (!saved) throw fail(`${prefix}_document_missing`, 'The saved document is not registered.', 409);
    return documentView(next, saved, descriptor, { content: true });
  }
  return { list, load, save };
}
