import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { validateBackendProjectManifest } from '../../engine/backend-project.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

const id = value => `bbbbbbbb-bbbb-4bbb-8bbb-${value.toString(16).padStart(12, '0')}`;
const revision = value => `sha256:${value.toString(16).padStart(64, '0')}`;
const sceneId = id(1), secondScene = id(2), buildId = id(3), previousBuild = id(4), backendId = 'org.viento.bevy';
const clone = value => JSON.parse(JSON.stringify(value));
const backend = () => ({ format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Bevy', version: '0.3.0', platforms: ['linux'],
  plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }], capabilities: ['scene2d'],
  execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
const summary = (id, scene = sceneId, status = 'succeeded') => ({ id, sceneId: scene, backendId, snapshotId: revision(1), title: 'Saved scene', status,
  createdAt: '2026-10-11T00:00:00.000Z', retention: 'automatic', retentionReason: null });
function project(id = previousBuild) {
  const hash = 'a'.repeat(64);
  return validateBackendProjectManifest({ format: 'viento-backend-project', schemaVersion: 1, buildId: id, snapshotId: revision(1),
    source: { workspaceId: 'readonly-workspace', sceneId, sourcePath: 'documents/scenes/first.json', sourceRevision: revision(2), planKind: 'scene2d', planSchemaVersion: 2 },
    backend: { id: backendId, version: '0.3.0', protocolVersion: 2, sha256: hash }, executionAdapter: { id: backendId, contractVersion: 1, sha256: hash },
    tool: { version: 'viento-bevy-runtime 0.3.0 bevy 0.19.1', sha256: hash, platform: 'linux', arch: 'x64' },
    project: { kind: 'bevy-scene', root: 'project', entry: 'project/scene-data.json', requiresTool: true },
    files: [{ path: 'project/scene-data.json', size: 16, sha256: hash, role: 'generated', resourceId: null, sourceObjectId: null }], resources: [],
    dependencies: [{ objectId: sceneId, sourcePath: 'documents/scenes/first.json', sourceRevision: revision(2), role: 'scene' }],
    evidence: ['build.json', 'snapshot.json', 'source-map.json'].map(path => ({ path, size: 32, sha256: hash })),
    lifecycle: { authority: 'author-workspace', generatedProject: 'derived-read-only', resources: 'copies', rebuild: 'saved-author-inputs', runtimeCopies: 'temporary', persistence: 'until-owner-cleanup' },
  });
}
const receipt = (id = previousBuild) => ({ project: project(id), inspection: { recorded: true, complete: true, manifestSha256: 'b'.repeat(64), extraPaths: [] }, buildDirectory: `/cache/builds/editor/author/${backendId}/${id}` });
const initial = () => ({ supported: true, available: true, platform: 'linux', backend: backend(), scenes: [
  { id: sceneId, title: 'First scene', sourcePath: 'documents/scenes/first.json' },
  { id: secondScene, title: 'Second scene', sourcePath: 'documents/scenes/second.json' }],
  latestBuild: { id: buildId, sceneId, backendId, snapshotId: revision(1), title: 'First scene', planSchemaVersion: 2, actorCount: 1 },
  projects: [summary(buildId), summary(previousBuild)],
  projectManagement: { format: 'viento-backend-project-management', schemaVersion: 1, scope: 'service-session', retentionLimit: 3, preservedCount: 0, previousSessions: 'cli-inspect' }, job: null });
async function view({ state = initial(), current = {} } = {}) {
  const calls = [], context = { editable: true, dirty: false, creating: false, busy: false, path: 'documents/scenes/first.json', ...current };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH,
    validateBackendProjectManifest: value => validateBackendProjectManifest(clone(value)),
    fetchJsonApiRequest: async (url, request) => {
      const pending = deferred(), body = request.body ? JSON.parse(request.body) : null;
      calls.push({ url, body, ...pending });
      if (!request.method) pending.resolve({ payload: state });
      return pending.promise;
    },
  });
  const source = (await fs.readFile(new URL('../../web/modules/app-backend-project.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  vm.runInContext(source, h.runtime); const realm = vm.runInContext('value => JSON.parse(JSON.stringify(value))', h.runtime);
  const controller = h.runtime.setupProjectBuild({ getContext: () => context });
  controller.setAvailable(true, [], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, calls, context,
    async resolve(value) { calls.at(-1).resolve({ payload: realm(value) }); await flushDialogs(); },
    async refresh(value) { state = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async inspect(id = previousBuild) { h.element('backendProjectSelect').value = id; h.element('backendProjectSelect').dispatch('change'); h.element('backendProjectInspect').click(); await flushDialogs(); },
  };
}

test('history detail reads remain independent from the approved latest build used by Run', async () => {
  const h = await view(); assert.equal(h.element('backendProjectPanel').hidden, false);
  await h.inspect(); assert.deepEqual(h.calls.at(-1).body, { action: 'inspect-project', buildId: previousBuild });
  await h.resolve(receipt()); assert.match(h.element('backendProjectContent').textContent, new RegExp(previousBuild));
  h.element('projectBuildHeadless').click(); assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId, mode: 'headless' });
});

test('old host state has no new list but keeps the existing latest-build Run available', async () => {
  const state = initial(); delete state.projects; delete state.projectManagement;
  const h = await view({ state }); assert.equal(h.element('backendProjectPanel').hidden, true);
  assert.equal(h.element('projectBuildHeadless').disabled, false); assert.equal(h.calls.length, 1);
});

test('parent close and reopen discard a delayed inspection without losing latest Run ownership', async () => {
  const h = await view(); await h.inspect(); const pending = h.calls.at(-1);
  h.element('projectBuildClose').click(); await flushDialogs(); h.element('projectBuildBtn').click(); await flushDialogs();
  pending.resolve({ payload: receipt() }); await flushDialogs();
  assert.equal(h.element('backendProjectDetails').hidden, true); assert.equal(h.element('backendProjectContent').textContent, '');
  assert.equal(h.element('projectBuildHeadless').disabled, false);
});

test('scene and preview-tab changes hide details and invalidate delayed reads', async () => {
  for (const change of ['scene', 'tab']) {
    const h = await view(); await h.inspect(); const pending = h.calls.at(-1);
    if (change === 'scene') { h.element('projectBuildScene').value = secondScene; h.element('projectBuildScene').dispatch('change'); }
    else h.element('projectBuildTabPreview').click();
    pending.resolve({ payload: receipt() }); await flushDialogs();
    assert.equal(h.element('backendProjectDetails').hidden, true); assert.equal(h.element('backendProjectContent').textContent, '');
  }
});

test('descriptor changes invalidate an existing detail even when backend ID and list rows remain the same', async () => {
  const h = await view(); await h.inspect(); await h.resolve(receipt());
  const state = initial(); state.backend.version = '0.4.0'; await h.refresh(state);
  assert.equal(h.element('backendProjectDetails').hidden, true); assert.equal(h.element('backendProjectContent').textContent, '');
});

test('read failure stays inside details and cannot consume a previous successful build', async () => {
  const h = await view(); await h.inspect(); h.calls.at(-1).reject(Object.assign(new Error('changed'), { errorCode: 'backend_project_changed' })); await flushDialogs();
  assert.equal(h.element('projectBuildError').hidden, true); assert.match(h.element('backendProjectError').textContent, /工程文件或清单已变化/);
  assert.equal(h.element('projectBuildHeadless').disabled, false);
});

test('unsaved author input blocks execution while readonly details preserve text and caret', async () => {
  const h = await view({ current: { dirty: true } }), input = h.element('docSourceEditor');
  input.value = 'unfinished author input'; input.selectionStart = 4; input.selectionEnd = 9;
  assert.equal(h.element('projectBuildHeadless').disabled, true); assert.equal(h.element('backendProjectInspect').disabled, false);
  await h.inspect(); await h.resolve(receipt());
  assert.equal(input.value, 'unfinished author input'); assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 9); assert.equal(h.context.dirty, true);
});
