import fs from 'node:fs/promises';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { readRegistry } from './workspace.mjs';
import { workspacePaths, projectDefinition } from './project-layout.mjs';
import { getCreatePathError, portablePath } from '../../engine/document-contract.mjs';
import { appendScenePhysics2DRelation, physics2DCreateRegistration, physics2DCreationRegistryGuard,
  validatePhysics2DCreateRecovery, PHYSICS2D_CREATE_RECOVERY_LIMITS } from '../../engine/world-physics2d-create.mjs';
import { validateDocumentModels } from '../../engine/document-model.mjs';
import { inspectScenePhysics2D } from '../../engine/scene-physics2d-core.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { readTransactionStatus, readTransactionFile, transactionPath, transactionHash, transactionError } from './world-transaction-state.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^sha256:[a-f0-9]{64}$/;
const conflict = () => transactionError('world_recovery_conflict', 'Transaction sources changed externally; preserve the journal and resolve the conflict');
const invalid = () => transactionError('world_journal_invalid', 'Physics2D creation journal is invalid; no recovery files were published');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const utf8Text = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const sourceTemporaryName = (intent, index) => `.viento-${intent.id}-${index}.tmp`;
const receiptFor = (intent, committed) => ({ format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: intent.id,
  worldId: intent.worldId, proposalId: intent.proposalId, baseRevision: intent.baseRevision,
  revision: committed ? intent.revision : intent.baseRevision, state: committed ? 'committed' : 'rolled-back' });

// The v12 journal owns only the declaration and its two registrations. Frozen
// dependency evidence proves identity; recovery neither reads nor writes media.
export async function loadPhysics2DCreateIntent(root, intent, intentBytes, workspace, journal = 'active') {
  await import('../adapters/node-studio-core.mjs');
  const keys = ['format', 'version', 'id', 'projectId', 'manifestHash', 'worldId', 'proposalId', 'baseRevision', 'revision',
    'previousHead', 'entries', 'registryHash', 'physics2DRecovery'];
  if (!exactKeys(intent, keys) || !Buffer.from(JSON.stringify(intent)).equals(intentBytes) || ![2, 3].includes(workspace.version)
    || intent.entries.length !== 3 || !hash.test(intent.registryHash)
    || !exactKeys(intent.physics2DRecovery, ['size', 'sha256']) || !Number.isSafeInteger(intent.physics2DRecovery.size)
    || intent.physics2DRecovery.size < 1 || intent.physics2DRecovery.size > PHYSICS2D_CREATE_RECOVERY_LIMITS.bytes
    || !hash.test(intent.physics2DRecovery.sha256)) throw invalid();
  const documents = workspacePaths(workspace).documents, seen = new Set(), images = [];
  const manifestId = intent.entries[0]?.objectId, sceneId = intent.entries[2]?.objectId;
  if (!uuid.test(manifestId) || !uuid.test(sceneId) || manifestId === sceneId) throw invalid();
  for (const [index, entry] of intent.entries.entries()) {
    if (!exactKeys(entry, ['objectId', 'sourcePath', 'before', 'after', 'mode']) || !uuid.test(entry.objectId)
      || entry.objectId !== (index < 2 ? manifestId : sceneId) || typeof entry.sourcePath !== 'string'
      || seen.has(entry.sourcePath) || !hash.test(entry.after) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777
      || (index < 2 ? entry.before !== null : !hash.test(entry.before))) throw invalid();
    if (index === 0 ? !entry.sourcePath.startsWith(`${documents}/`) || !entry.sourcePath.endsWith('.json') || getCreatePathError(entry.sourcePath)
      : entry.sourcePath !== `metadata/documents/${entry.objectId}.json`) throw invalid();
    seen.add(entry.sourcePath);
    const limit = index === 0 ? 65536 : 1024 * 1024;
    const before = index < 2 ? null : await readTransactionFile(root, `${journal}/${index}.before`, limit);
    const after = await readTransactionFile(root, `${journal}/${index}.after`, limit);
    if (index === 2 && transactionHash(before) !== entry.before || transactionHash(after) !== entry.after) throw invalid();
    images.push({ before, after });
  }
  const allowed = new Set(['intent.json', '0.after', '1.after', '2.before', '2.after', 'physics2d-dependencies.json', 'commit.json']);
  for (const file of await fs.readdir(await transactionPath(root, journal), { withFileTypes: true })) {
    if (!file.isFile() || !allowed.has(file.name)) throw invalid();
  }
  const recoveryBytes = await readTransactionFile(root, `${journal}/physics2d-dependencies.json`, PHYSICS2D_CREATE_RECOVERY_LIMITS.bytes);
  if (recoveryBytes.length !== intent.physics2DRecovery.size || transactionHash(recoveryBytes) !== intent.physics2DRecovery.sha256) throw invalid();
  let recovery, manifest, beforeScene, afterScene, edit;
  try {
    recovery = JSON.parse(utf8Text(recoveryBytes));
    // This is host-generated protocol data. Exact re-encoding also refuses
    // duplicate decoded keys, whitespace repair and alternate number tokens.
    if (!Buffer.from(JSON.stringify(recovery)).equals(recoveryBytes)) throw invalid();
    manifest = JSON.parse(utf8Text(images[1].after)); beforeScene = JSON.parse(utf8Text(images[2].before).replace(/^\uFEFF/, ''));
    const type = projectDefinition(workspace).documentTypes.find(item => item.id === manifest.documentType);
    const parsed = parseJsonSource(utf8Text(images[0].after));
    if (!type || !parsed.ok) throw invalid();
    const checked = inspectScenePhysics2D(parsed.value).document;
    if (checked.sceneObjectId !== sceneId) throw invalid();
    const expected = physics2DCreateRegistration({ format: 'viento-document', version: 1, id: manifestId,
      sourcePath: intent.entries[0].sourcePath, documentType: type.id, parserProfile: type.parserProfile, relations: [], assetBindings: [] }, checked);
    if (canonicalJson(manifest) !== canonicalJson(expected) || beforeScene.format !== 'viento-document' || beforeScene.version !== 1
      || beforeScene.id !== sceneId || beforeScene.sourcePath !== recovery.scene?.sourcePath
      || !beforeScene.sourcePath.startsWith(`${documents}/`) || !beforeScene.sourcePath.endsWith('.json')
      || !portablePath(beforeScene.sourcePath) || !projectDefinition(workspace).documentTypes.some(item => item.id === beforeScene.documentType)) throw invalid();
    edit = appendScenePhysics2DRelation(utf8Text(images[2].before), manifestId); afterScene = edit.after;
    if (!Buffer.from(edit.afterContent).equals(images[2].after)) throw invalid();
  } catch { throw invalid(); }
  const registry = await readRegistry(root, { allowPendingWorldTransaction: true,
    recoveryTemporaryRecords: [1, 2].map(index => `metadata/documents/${sourceTemporaryName(intent, index)}`) });
  if (transactionHash(physics2DCreationRegistryGuard(registry, manifestId, sceneId)) !== intent.registryHash) throw conflict();
  const currentScene = registry.documents.find(record => record.id === sceneId), currentManifest = registry.documents.find(record => record.id === manifestId);
  if (!currentScene || ![beforeScene, afterScene].some(record => canonicalJson(record) === canonicalJson(currentScene))
    || currentManifest && canonicalJson(currentManifest) !== canonicalJson(manifest)) throw conflict();
  const checked = await validatePhysics2DCreateRecovery(manifest, utf8Text(images[0].after), afterScene, recovery, registry,
    { digest: value => transactionHash(value).slice(7) });
  if (!checked.ok) throw invalid();
  validateDocumentModels([...registry.documents.filter(record => ![manifestId, sceneId].includes(record.id)), manifest, afterScene]);
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
