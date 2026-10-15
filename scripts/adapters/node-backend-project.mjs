// Read-only project inspection and inventory creation. No tool process, author
// workspace access, output repair, adoption or cleanup occurs in this module.
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePlans } from '../../engine/build-target.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { validateBackendProjectManifest, BACKEND_PROJECT_MANIFEST_MAX_BYTES } from '../../engine/backend-project.mjs';
import { buildHash, buildError, readBuildFile } from './node-build-snapshot.mjs';
import { createExecutionBackendRegistry, validateGeneratedExecutionProject, executionAdapterFingerprint } from './node-execution-backends.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';

export const BACKEND_PROJECT_MANIFEST_FILE = 'backend-project.json';
const metadataNames = ['build.json', 'snapshot.json', 'source-map.json'];
const limits = { 'build.json': 4 * 1024 * 1024, 'snapshot.json': 80 * 1024 * 1024, 'source-map.json': 4 * 1024 * 1024 };
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code = 'backend_project_invalid') => { throw buildError(code, 'The backend project does not match its frozen source and file inventory.'); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

/** Create portable provenance from the already-frozen host inputs/inventory. */
export function createBackendProjectManifest({ build, snapshot, sourceMap, generated, evidenceBytes } = {}) {
  try {
    if (build?.format !== 'viento-build-record' || build.schemaVersion !== 1 || snapshot?.format !== 'viento-build-snapshot' || snapshot.schemaVersion !== 1
      || build.snapshotId !== `sha256:${buildHash(canonicalJson(snapshot))}` || !Array.isArray(build.artifact?.files)
      || !(generated?.files instanceof Map) || !(generated.resourceFiles instanceof Map)
      || build.backend?.id !== generated.backend?.id || build.backend.protocolVersion !== generated.backend.protocolVersion
      || build.backend.sha256 !== generated.backend.sha256 || build.artifact.kind !== generated.artifact.kind
      || build.artifact.entry !== `project/${generated.artifact.entry}` || build.artifact.requiresTool !== generated.artifact.requiresTool) fail();
    const plan = snapshot.plan, resourcesByPath = new Map(), sourcesByPath = new Map();
    for (const resource of plan.resources) {
      const name = generated.resourceFiles.get(resource.id);
      if (!name || resourcesByPath.has(name)) fail(); resourcesByPath.set(name, resource);
    }
    for (const binding of sourceMap.behaviors || []) {
      if (!binding.generatedPath || !uuid(binding.sourceObjectId) || sourcesByPath.has(binding.generatedPath) && sourcesByPath.get(binding.generatedPath) !== binding.sourceObjectId) fail();
      sourcesByPath.set(binding.generatedPath, binding.sourceObjectId);
    }
    const allowed = new Set([...generated.files.keys(), ...generated.resourceFiles.values()]);
    if (build.artifact.files.length !== allowed.size) fail();
    const files = build.artifact.files.map(file => {
      if (!allowed.delete(file.path)) fail();
      const resource = resourcesByPath.get(file.path), sourceObjectId = sourcesByPath.get(file.path) || null;
      if (resource && (resource.size !== file.size || resource.sha256 !== file.sha256)) fail();
      const expected = generated.files.get(file.path);
      if (!resource && (!expected || expected.byteLength !== file.size || buildHash(expected) !== file.sha256)) fail();
      return { path: `project/${file.path}`, size: file.size, sha256: file.sha256,
        role: resource ? 'resource-copy' : sourceObjectId ? 'author-source-copy' : 'generated', resourceId: resource?.id || null, sourceObjectId };
    }).sort((a, b) => compare(a.path, b.path));
    const resources = plan.resources.map(resource => {
      const asset = snapshot.source.assets.find(item => item.record?.id === resource.id)?.record;
      if (!asset || asset.content?.sha256 !== resource.sha256 || asset.content?.size !== resource.size) fail();
      return { resourceId: resource.id, sourcePath: asset.location.path, generatedPath: `project/${generated.resourceFiles.get(resource.id)}`,
        size: resource.size, sha256: resource.sha256 };
    }).sort((a, b) => compare(a.generatedPath, b.generatedPath));
    const children = scenePlans(plan), assembly = plan.kind === 'project';
    const sceneIds = new Set(children.map(child => child.scene.objectId));
    const behaviorSources = new Set(children.flatMap(child => child.behaviors?.sources.map(source => source.objectId) || []));
    const dependencies = snapshot.source.documents.map(document => ({ objectId: document.record?.id || null,
      sourcePath: document.sourcePath, sourceRevision: document.sourceRevision,
      role: assembly && document.record?.id === plan.assembly.objectId ? 'assembly' : sceneIds.has(document.record?.id) ? 'scene' : behaviorSources.has(document.record?.id) ? 'behavior-source' : 'author-document',
    })).sort((a, b) => compare(a.sourcePath, b.sourcePath));
    const data = { 'build.json': build, 'snapshot.json': snapshot, 'source-map.json': sourceMap };
    const evidence = metadataNames.map(name => {
      const bytes = evidenceBytes?.get(name) || json(data[name]);
      if (!(bytes instanceof Uint8Array)) fail();
      return { path: name, size: bytes.byteLength, sha256: buildHash(bytes) };
    });
    return validateBackendProjectManifest({ format: 'viento-backend-project', schemaVersion: assembly ? 2 : 1, buildId: build.buildId, snapshotId: build.snapshotId,
      source: assembly ? { workspaceId: snapshot.source.workspace.id, assemblyId: plan.assembly.objectId, sourcePath: plan.assembly.sourcePath,
        sourceRevision: plan.assembly.sourceRevision, planKind: plan.kind, planSchemaVersion: plan.schemaVersion, entrySceneId: plan.entrySceneId,
        scenes: children.map(child => ({ sceneId: child.scene.objectId, sourcePath: child.scene.sourcePath, sourceRevision: child.scene.sourceRevision })) } : { workspaceId: snapshot.source.workspace.id, sceneId: plan.scene.objectId, sourcePath: plan.scene.sourcePath,
        sourceRevision: plan.scene.sourceRevision, planKind: plan.kind, planSchemaVersion: plan.schemaVersion },
      backend: { id: build.backend.id, version: build.backend.version, protocolVersion: build.backend.protocolVersion, sha256: build.backend.sha256 },
      executionAdapter: build.executionAdapter || null,
      tool: { version: build.tool.version, sha256: build.tool.sha256, platform: build.tool.platform, arch: build.tool.arch },
      project: { kind: build.artifact.kind, root: 'project', entry: build.artifact.entry, requiresTool: build.artifact.requiresTool },
      files, resources, dependencies, evidence,
      lifecycle: { authority: 'author-workspace', generatedProject: 'derived-read-only', resources: 'copies', rebuild: 'saved-author-inputs',
        runtimeCopies: 'temporary', persistence: 'until-owner-cleanup' },
    });
  } catch (error) { if (error.errorCode === 'backend_project_invalid') throw error; fail(); }
}

async function ownedDirectory(directory) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')) fail();
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('backend_project_changed');
  return fs.realpath(directory);
}
async function readEvidence(directory, signal) {
  const bytes = new Map(), parsed = {};
  for (const name of metadataNames) {
    const content = await readBuildFile(await resolveContainedPath(directory, path.join(directory, name)), limits[name], signal);
    bytes.set(name, content); parsed[name] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
  }
  return { bytes, build: parsed['build.json'], snapshot: parsed['snapshot.json'], sourceMap: parsed['source-map.json'] };
}
async function readManifest(directory, signal) {
  const target = path.join(directory, BACKEND_PROJECT_MANIFEST_FILE);
  try {
    const bytes = await readBuildFile(await resolveContainedPath(directory, target), BACKEND_PROJECT_MANIFEST_MAX_BYTES, signal);
    const project = validateBackendProjectManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return { project, bytes, sha256: buildHash(bytes) };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function checkPins(build, recorded, pins, { cleanup = false } = {}) {
  if (pins.expectedBuildId !== undefined && (!uuid(pins.expectedBuildId) || pins.expectedBuildId !== build.buildId)
    || pins.expectedSnapshotId !== undefined && (!revision(pins.expectedSnapshotId) || pins.expectedSnapshotId !== build.snapshotId)
    || pins.expectedManifestSha256 !== undefined && (!hash(pins.expectedManifestSha256) || pins.expectedManifestSha256 !== recorded?.sha256)
    || cleanup && (!uuid(pins.expectedBuildId) || !hash(pins.expectedManifestSha256) || !recorded)) fail('backend_project_changed');
}
function checkEvidence(project, evidence) {
  if (project.buildId !== evidence.build.buildId || project.snapshotId !== evidence.build.snapshotId
    || evidence.build.format !== 'viento-build-record' || evidence.build.schemaVersion !== 1
    || evidence.snapshot.format !== 'viento-build-snapshot' || evidence.snapshot.schemaVersion !== 1
    || project.snapshotId !== `sha256:${buildHash(canonicalJson(evidence.snapshot))}`) fail('backend_project_changed');
  for (const file of project.evidence) {
    const bytes = evidence.bytes.get(file.path);
    if (bytes.byteLength !== file.size || buildHash(bytes) !== file.sha256) fail('backend_project_changed');
  }
}
async function verifyProjectFiles(directory, project, signal) {
  for (const file of project.files) {
    const bytes = await readBuildFile(await resolveContainedPath(directory, path.join(directory, file.path)), 32 * 1024 * 1024, signal);
    if (bytes.byteLength !== file.size || buildHash(bytes) !== file.sha256) fail('backend_project_changed');
  }
}
async function inventory(directory, project, recorded, signal) {
  const files = new Set([...project.files.map(file => file.path), ...metadataNames, ...(recorded ? [BACKEND_PROJECT_MANIFEST_FILE] : [])]);
  const directories = new Set(['project']);
  for (const file of files) { const parts = file.split('/'); parts.pop(); while (parts.length) { directories.add(parts.join('/')); parts.pop(); } }
  const observedFiles = new Set(), extraPaths = []; let entries = 0;
  const walk = async (relative, depth) => {
    signal?.throwIfAborted();
    if (depth > 64) fail('backend_project_changed');
    const folder = await resolveContainedPath(directory, path.join(directory, relative));
    const names = (await fs.readdir(folder)).sort(compare);
    for (const name of names) {
      if (++entries > 16384) fail('backend_project_changed');
      const child = relative ? `${relative}/${name}` : name, stat = await fs.lstat(path.join(directory, child));
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
      if (files.has(child)) { if (kind !== 'file') fail('backend_project_changed'); observedFiles.add(child); }
      else if (directories.has(child)) { if (kind !== 'directory') fail('backend_project_changed'); }
      else extraPaths.push({ path: child, kind });
      // One unknown directory already makes the inventory incomplete. Do not
      // enumerate its contents or follow a replacement link into unrelated data.
      if (kind === 'directory' && directories.has(child)) await walk(child, depth + 1);
    }
  };
  await walk('', 0);
  if (observedFiles.size !== files.size) fail('backend_project_changed');
  return extraPaths.sort((a, b) => compare(a.path, b.path));
}
async function finishInspection(directory, project, recorded, evidence, signal) {
  checkEvidence(project, evidence);
  await verifyProjectFiles(directory, project, signal);
  const extraPaths = await inventory(directory, project, Boolean(recorded), signal);
  // Recheck metadata, manifest presence/bytes and project files after the async
  // generator work; inspection never binds a mixed read as one intact project.
  const afterEvidence = await readEvidence(directory, signal), afterRecorded = await readManifest(directory, signal);
  if (Boolean(recorded) !== Boolean(afterRecorded) || recorded?.sha256 !== afterRecorded?.sha256) fail('backend_project_changed');
  checkEvidence(project, afterEvidence); await verifyProjectFiles(directory, project, signal);
  if (!same(extraPaths, await inventory(directory, project, Boolean(recorded), signal))) fail('backend_project_changed');
  return { project, inspection: { recorded: Boolean(recorded), complete: extraPaths.length === 0,
    manifestSha256: recorded?.sha256 || null, extraPaths }, buildDirectory: directory };
}
function inspectionError(error, signal) {
  signal?.throwIfAborted();
  if (error.errorCode?.startsWith('backend_project_')) throw error;
  fail(error.code === 'ENOENT' ? 'backend_project_unavailable' : 'backend_project_changed');
}

/** Verify a successful build without querying or executing the current tool. */
export async function inspectBackendProject({ buildDirectory, backendId, backendRegistry = createExecutionBackendRegistry(), signal,
  expectedBuildId, expectedSnapshotId, expectedManifestSha256 } = {}) {
  try {
    const directory = await ownedDirectory(buildDirectory), evidence = await readEvidence(directory, signal), recorded = await readManifest(directory, signal);
    checkPins(evidence.build, recorded, { expectedBuildId, expectedSnapshotId, expectedManifestSha256 });
    // Dynamic import permits the build writer to use this manifest factory.
    const { readFrozenProjectBuild } = await import('./node-project-build.mjs');
    const frozen = await readFrozenProjectBuild(directory, { backendId, backendRegistry, signal });
    if (!same(evidence.build, frozen.build) || !same(evidence.snapshot, frozen.snapshot)) fail('backend_project_changed');
    const { adapter, plan } = frozen;
    const generated = validateGeneratedExecutionProject(adapter, plan, await adapter.generate(plan));
    const fingerprint = await executionAdapterFingerprint(adapter);
    if (generated.backend.protocolVersion !== evidence.build.backend.protocolVersion || generated.backend.sha256 !== evidence.build.backend.sha256
      || generated.backend.version !== evidence.build.backend.version
      || (evidence.build.executionAdapter !== undefined ? !same(evidence.build.executionAdapter, fingerprint) : !adapter.acceptsLegacyBuildRecords)) fail('backend_project_changed');
    if (!same(generated.sourceMap, evidence.sourceMap)) fail('backend_project_changed');
    const project = createBackendProjectManifest({ ...evidence, generated, evidenceBytes: evidence.bytes });
    if (recorded && !same(project, recorded.project)) fail('backend_project_changed');
    return await finishInspection(directory, project, recorded, evidence, signal);
  } catch (error) { inspectionError(error, signal); }
}

/** Verify an owned receipt independently of the currently installed adapters.
 * This still does not authorize deletion: the caller must prove ownership and
 * preserve any extra paths (including runtime session evidence).
 */
export async function inspectBackendProjectForCleanup({ buildDirectory, expectedBuildId, expectedSnapshotId, expectedManifestSha256, signal } = {}) {
  try {
    const directory = await ownedDirectory(buildDirectory), evidence = await readEvidence(directory, signal), recorded = await readManifest(directory, signal);
    checkPins(evidence.build, recorded, { expectedBuildId, expectedSnapshotId, expectedManifestSha256 }, { cleanup: true });
    return await finishInspection(directory, recorded.project, recorded, evidence, signal);
  } catch (error) { inspectionError(error, signal); }
}
