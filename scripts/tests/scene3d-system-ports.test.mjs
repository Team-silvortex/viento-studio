import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';

const systemSource = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
const runtimeSource = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function systemFixture({ legacy = false, settings } = {}) {
  const mounts = [], refreshes = [], registry = createStudioModuleRegistry(), bindings = {};
  for (const [name, setup] of Object.entries({ world: 'setupWorldBrowser', build: 'setupProjectBuild', media: 'setupMediaEditor', project: 'setupProjectSettings', export: 'setupExport' })) bindings[setup] = ports => { mounts.push({ name, ports }); return { refresh: () => refreshes.push(name), setAvailable() {} }; };
  const context = vm.createContext({ ...bindings, createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }),
    setupSettings: async () => settings,
    ...(!legacy ? { setupScene3DPreview: ports => { mounts.push({ name: 'scene3d', ports }); return { refresh: () => refreshes.push('scene3d') }; } } : {}) });
  vm.runInContext(systemSource.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
  return { mounts, refreshes, setup: options => context.setupStudioSystem(options) };
}
function sourceFixture() {
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditSource: 'documents/scenes/boxes.json' };
  let content = '\ufeff{"format":"viento-scene3d"}\r\n', busy = false, editable = true;
  const context = vm.createContext({ state, editorLoadToken: 3, scenePreviewDraftEpoch: 7, isEditModeActive: () => editable,
    isEditorBusy: () => busy, canonicalizeSourcePath: value => value || '', getCurrentEditContent: () => content });
  const source = runtimeSource.slice(runtimeSource.indexOf('let scene3DSourceReadEpoch'), runtimeSource.indexOf('\nasync function applySceneCompositionOverrideDraft'));
  vm.runInContext(source, context);
  return { state, context, source: () => context.getScene3DSourceSnapshot(), flags: () => copy(context.scene3DSourceContext()),
    setContent: value => { content = value; context.scenePreviewDraftEpoch++; }, setSilentContent: value => { content = value; }, setBusy: value => { busy = value; }, setEditable: value => { editable = value; } };
}

test('3D assembly is optional and absent read-only ports leave all seven legacy areas unchanged', async () => {
  const h = systemFixture(), system = await h.setup(); assert.equal(h.mounts.some(item => item.name === 'scene3d'), false);
  const snapshot = copy(system.snapshot()); assert.equal(snapshot.initializedModules.length, 7); assert.equal(snapshot.plan.modules.find(item => item.id === 'org.viento.scene3d').active, false);
});
test('injected 3D ports mount an independent eighth module with only their read-only callbacks', async () => {
  const h = systemFixture(), getContext = () => 'context', getSource = async () => 'source';
  const system = await h.setup({ ports: { scene3d: { getContext, getSource } } }), mount = h.mounts.find(item => item.name === 'scene3d');
  assert.equal(mount.ports.getContext, getContext); assert.equal(mount.ports.getSource, getSource); assert.deepEqual(Object.keys(mount.ports).sort(), ['getContext', 'getSource']); assert.equal(Object.isFrozen(mount.ports), true);
  assert.equal(copy(system.snapshot()).initializedModules.at(-1), 'org.viento.scene3d');
});
test('optional readonly source navigation mounts without authoring ports and is captured before settings await', async () => {
  let release;
  const h = systemFixture({ settings: new Promise(resolve => { release = resolve; }) });
  const locateSource = () => 'selection only', getSource = () => 'readonly';
  const ports = { scene3d: { getSource, locateSource } }, pending = h.setup({ ports });
  ports.scene3d.locateSource = () => 'replacement'; release(); const system = await pending;
  const mount = h.mounts.find(item => item.name === 'scene3d');
  assert.equal(mount.ports.locateSource, locateSource); assert.equal(mount.ports.getSource, getSource);
  assert.equal(Object.isFrozen(mount.ports), true); assert.deepEqual(Object.keys(mount.ports).sort(), ['getSource', 'locateSource']);
  assert.equal(Object.hasOwn(mount.ports, 'applyDraft'), false);
  assert.equal(copy(system.snapshot()).initializedModules.length, 8);
  assert.equal(JSON.stringify(copy(system.snapshot())).includes('selection only'), false);
});
test('scene3d feature false disables only the optional new view and no renderer is mounted', async () => {
  const h = systemFixture(), system = await h.setup({ features: { scene3d: false }, ports: { scene3d: { getContext() {} } } });
  assert.equal(h.mounts.some(item => item.name === 'scene3d'), false); assert.equal(copy(system.snapshot()).initializedModules.length, 7);
});
test('legacy assembly adapter without the new setup binding still starts base editing', async () => {
  const h = systemFixture({ legacy: true }), system = await h.setup({ ports: { scene3d: {} } }); assert.equal(copy(system.snapshot()).initializedModules.length, 7);
});
test('source refresh reaches independent optional view through the root without exposing its controller', async () => {
  const h = systemFixture(), system = await h.setup({ ports: { scene3d: {} } }); system.refreshMedia(); assert.deepEqual(h.refreshes, ['media', 'scene3d']);
  assert.deepEqual(Object.keys(system).sort(), ['refreshMedia', 'snapshot', 'updateCapabilities', 'updateProject']);
});
test('3D port authority is captured before language initialization awaits', async () => {
  let release; const ready = new Promise(resolve => { release = resolve; }), h = systemFixture({ settings: ready });
  const original = () => 'original', ports = { scene3d: { getSource: original } }, pending = h.setup({ ports }); ports.scene3d.getSource = () => 'replacement'; release(); await pending;
  assert.equal(h.mounts.find(item => item.name === 'scene3d').ports.getSource, original);
});
test('registered 3D capability does not grant write or backend host authority and snapshots contain no source', async () => {
  const h = systemFixture(), system = await h.setup({ ports: { scene3d: { getSource: () => 'private raw source' } } });
  system.updateCapabilities({ semanticProjection: false, projectBuild: false, scenePreview: false });
  const value = copy(system.snapshot()); assert.equal(value.hostCapabilities.projectBuild, false); assert.equal(value.plan.capabilities.find(item => item.capability === 'scene.preview.scene3d').active, true); assert.equal(JSON.stringify(value).includes('private raw source'), false);
});
test('runtime read-only source snapshot retains saved bytes including BOM and CRLF', async () => {
  const h = sourceFixture(), source = copy(await h.source()); assert.deepEqual(source, { content: '\ufeff{"format":"viento-scene3d"}\r\n', sourcePath: 'documents/scenes/boxes.json', token: '3:7:1' });
  assert.deepEqual(Object.keys(h.flags()).sort(), ['busy', 'creating', 'editable', 'sourceJSON', 'sourcePath', 'sourceToken']);
});
test('unsaved raw editing advances the preview token without applying or saving source', async () => {
  const h = sourceFixture(); h.setContent('not yet valid JSON'); assert.equal((await h.source()).content, 'not yet valid JSON'); assert.equal((await h.source()).token, '3:8:1');
  assert.equal(h.state.isEditing, true); assert.equal(h.state.activeEditSource, 'documents/scenes/boxes.json');
});
test('silent source byte mutation invalidates a captured readonly snapshot without advancing the ordinary draft epoch', async () => {
  const h = sourceFixture(), pending = h.source(); h.setSilentContent('{"name":"changed without input"}'); const captured = await pending, context = h.flags();
  assert.notEqual(captured.token, context.sourceToken); assert.equal(h.context.scenePreviewDraftEpoch, 7); assert.equal((await h.source()).content, '{"name":"changed without input"}');
});
test('source ownership cache is cleared on leaving the source session and replaced on path navigation', async () => {
  const h = sourceFixture(), first = await h.source(); h.state.editInputMode = 'fields'; h.flags(); h.state.editInputMode = 'source'; const reopened = await h.source(); assert.notEqual(first.token, reopened.token);
  h.state.activeEditSource = 'documents/scenes/other.json'; assert.notEqual((await h.source()).token, reopened.token); assert.equal(h.context.scenePreviewDraftEpoch, 7);
});
test('creation, block editing, nonJSON, busy or disabled author mode cannot supply a preview snapshot', async () => {
  for (const change of [h => { h.state.isCreating = true; }, h => { h.state.isEditing = false; }, h => { h.state.editInputMode = 'fields'; }, h => { h.state.activeEditSource = 'documents/scene.md'; }, h => h.setBusy(true), h => h.setEditable(false)]) {
    const h = sourceFixture(); change(h); assert.equal(await h.source(), null);
  }
});
test('the runtime read-only 3D source functions have no composition, World, HTTP or Save calls', () => {
  const source = runtimeSource.slice(runtimeSource.indexOf('function scene3DSourceContext()'), runtimeSource.indexOf('\nasync function applySceneCompositionOverrideDraft'));
  assert.doesNotMatch(source, /fetch\s*\(|\.request\s*\(|applyScene|prepareScene|saveEdit|setBusy\s*\(/);
  assert.match(runtimeSource, /scene3d:\s*\{ getContext: scene3DSourceContext, getSource: getScene3DSourceSnapshot, locateSource: locateScene3DSource \}/);
});
