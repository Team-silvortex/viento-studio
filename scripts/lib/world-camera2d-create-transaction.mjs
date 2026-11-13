import fs from 'node:fs/promises';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { readRegistry } from './workspace.mjs';
import { workspacePaths, projectDefinition } from './project-layout.mjs';
import { getCreatePathError, portablePath } from '../../engine/document-contract.mjs';
import { appendSceneCamera2DRelation, camera2DCreateRegistration, camera2DCreationRegistryGuard,
  validateCamera2DCreateRecovery, CAMERA2D_CREATE_RECOVERY_LIMITS } from '../../engine/world-camera2d-create.mjs';
import { validateDocumentModels } from '../../engine/document-model.mjs';
import { inspectSceneCamera2DDocument } from '../../engine/scene-camera2d.mjs';
import { readTransactionStatus, readTransactionFile, transactionPath, transactionHash, transactionError } from './world-transaction-state.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^sha256:[a-f0-9]{64}$/;
const conflict = () => transactionError('world_recovery_conflict', 'Transaction sources changed externally; preserve the journal and resolve the conflict');
const invalid = () => transactionError('world_journal_invalid', 'Camera2D creation journal is invalid; no recovery files were published');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const utf8Text = value => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
const sourceTemporaryName = (intent, index) => `.viento-${intent.id}-${index}.tmp`;
const receiptFor = (intent, committed) => ({ format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: intent.id,
  worldId: intent.worldId, proposalId: intent.proposalId, baseRevision: intent.baseRevision,
  revision: committed ? intent.revision : intent.baseRevision, state: committed ? 'committed' : 'rolled-back' });

// Journal v13 validates frozen author identities and exact three file images.
export async function loadCamera2DCreateIntent(root, intent, intentBytes, workspace, journal = 'active') {
  const keys = ['format', 'version', 'id', 'projectId', 'manifestHash', 'worldId', 'proposalId', 'baseRevision', 'revision',
    'previousHead', 'entries', 'registryHash', 'camera2DRecovery'];
  if (!exactKeys(intent, keys) || !Buffer.from(JSON.stringify(intent)).equals(intentBytes) || ![2, 3].includes(workspace.version)
    || intent.entries.length !== 3 || !hash.test(intent.registryHash) || !exactKeys(intent.camera2DRecovery, ['size', 'sha256'])
    || !Number.isSafeInteger(intent.camera2DRecovery.size) || intent.camera2DRecovery.size < 1
    || intent.camera2DRecovery.size > CAMERA2D_CREATE_RECOVERY_LIMITS.bytes || !hash.test(intent.camera2DRecovery.sha256)) throw invalid();
  const documents = workspacePaths(workspace).documents, seen = new Set(), images = [];
  const cameraId = intent.entries[0]?.objectId, sceneId = intent.entries[2]?.objectId;
  if (!uuid.test(cameraId) || !uuid.test(sceneId) || cameraId === sceneId) throw invalid();
  for (const [index, entry] of intent.entries.entries()) {
    if (!exactKeys(entry, ['objectId', 'sourcePath', 'before', 'after', 'mode']) || !uuid.test(entry.objectId)
      || entry.objectId !== (index < 2 ? cameraId : sceneId) || typeof entry.sourcePath !== 'string'
      || seen.has(entry.sourcePath) || !hash.test(entry.after) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777
      || (index < 2 ? entry.before !== null : !hash.test(entry.before))) throw invalid();
    if (index === 0 ? !entry.sourcePath.startsWith(`${documents}/`) || !entry.sourcePath.endsWith('.json') || getCreatePathError(entry.sourcePath)
      : entry.sourcePath !== `metadata/documents/${entry.objectId}.json`) throw invalid();
    seen.add(entry.sourcePath);
    const limit = index === 0 ? 16384 : 1024 * 1024;
    const before = index < 2 ? null : await readTransactionFile(root, `${journal}/${index}.before`, limit);
    const after = await readTransactionFile(root, `${journal}/${index}.after`, limit);
    if (index === 2 && transactionHash(before) !== entry.before || transactionHash(after) !== entry.after) throw invalid();
    images.push({ before, after });
  }
  const allowed = new Set(['intent.json', '0.after', '1.after', '2.before', '2.after', 'camera2d-dependencies.json', 'commit.json']);
  for (const file of await fs.readdir(await transactionPath(root, journal), { withFileTypes: true })) {
    if (!file.isFile() || !allowed.has(file.name)) throw invalid();
  }
  const recoveryBytes = await readTransactionFile(root, `${journal}/camera2d-dependencies.json`, CAMERA2D_CREATE_RECOVERY_LIMITS.bytes);
  if (recoveryBytes.length !== intent.camera2DRecovery.size || transactionHash(recoveryBytes) !== intent.camera2DRecovery.sha256) throw invalid();
  let recovery, cameraRecord, beforeScene, afterScene;
  try {
    recovery = JSON.parse(utf8Text(recoveryBytes));
    if (!Buffer.from(JSON.stringify(recovery)).equals(recoveryBytes)) throw invalid();
    cameraRecord = JSON.parse(utf8Text(images[1].after)); beforeScene = JSON.parse(utf8Text(images[2].before).replace(/^\uFEFF/, ''));
    const type = projectDefinition(workspace).documentTypes.find(item => item.id === cameraRecord.documentType);
    const checked = inspectSceneCamera2DDocument(utf8Text(images[0].after));
    if (!type || !checked.recognized || !checked.ok || checked.value.sceneObjectId !== sceneId) throw invalid();
    const expected = camera2DCreateRegistration({ format: 'viento-document', version: 1, id: cameraId,
      sourcePath: intent.entries[0].sourcePath, documentType: type.id, parserProfile: type.parserProfile, relations: [], assetBindings: [] }, checked.value);
    if (canonicalJson(cameraRecord) !== canonicalJson(expected) || beforeScene.format !== 'viento-document' || beforeScene.version !== 1
      || beforeScene.id !== sceneId || beforeScene.sourcePath !== recovery.scene?.sourcePath || !beforeScene.sourcePath.startsWith(`${documents}/`)
      || !beforeScene.sourcePath.endsWith('.json') || !portablePath(beforeScene.sourcePath)
      || !projectDefinition(workspace).documentTypes.some(item => item.id === beforeScene.documentType)) throw invalid();
    const edit = appendSceneCamera2DRelation(utf8Text(images[2].before), cameraId); afterScene = edit.after;
    if (!Buffer.from(edit.afterContent).equals(images[2].after)) throw invalid();
  } catch { throw invalid(); }
  const registry = await readRegistry(root, { allowPendingWorldTransaction: true,
    recoveryTemporaryRecords: [1, 2].map(index => `metadata/documents/${sourceTemporaryName(intent, index)}`) });
  if (transactionHash(camera2DCreationRegistryGuard(registry, cameraId, sceneId)) !== intent.registryHash) throw conflict();
  const currentScene = registry.documents.find(record => record.id === sceneId), currentCamera = registry.documents.find(record => record.id === cameraId);
  if (!currentScene || ![beforeScene, afterScene].some(record => canonicalJson(record) === canonicalJson(currentScene))
    || currentCamera && canonicalJson(currentCamera) !== canonicalJson(cameraRecord)) throw conflict();
  const checked = await validateCamera2DCreateRecovery(cameraRecord, utf8Text(images[0].after), afterScene, recovery, registry,
    { digest: value => transactionHash(value).slice(7) });
  if (!checked.ok) throw invalid();
  validateDocumentModels([...registry.documents.filter(record => ![cameraId, sceneId].includes(record.id)), cameraRecord, afterScene]);
  let committed = false;
  try {
    const markerBytes = await readTransactionFile(root, `${journal}/commit.json`, 1024), marker = JSON.parse(utf8Text(markerBytes));
    if (!exactKeys(marker, ['id', 'intentHash']) || !Buffer.from(JSON.stringify(marker)).equals(markerBytes)
      || marker.id !== intent.id || marker.intentHash !== transactionHash(intentBytes)) throw invalid();
    committed = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { token, receipt } = await readTransactionStatus(root);
  if (token !== intent.previousHead && canonicalJson(receipt) !== canonicalJson(receiptFor(intent, committed))) throw invalid();
  return { intent, images, committed };
}
