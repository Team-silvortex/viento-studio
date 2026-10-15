import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';

const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(settings) {
  const registry = createStudioModuleRegistry(), mounts = [], refreshed = [];
  const bindings = { createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }),
    setupSettings: async () => settings };
  const factories = { world: 'setupWorldBrowser', build: 'setupProjectBuild', media: 'setupMediaEditor', project: 'setupProjectSettings',
    export: 'setupExport', preview: 'setupScene3DPreview', transforms: 'setupScene3DTransforms', objects: 'setupScene3DObjects',
    environment: 'setupScene3DEnvironment', properties: 'setupScene3DProperties', translation: 'setupScene3DTranslation', alignment: 'setupScene3DAlignment' };
  for (const [name, setup] of Object.entries(factories)) bindings[setup] = ports => {
    mounts.push({ name, ports }); return { refresh: () => refreshed.push(name), setAvailable() {} };
  };
  const context = vm.createContext(bindings);
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
  return { mounts, refreshed, setup: options => context.setupStudioSystem(options) };
}

test('alignment is a separate source authoring module with only document dependency', () => {
  const registry = createStudioModuleRegistry(), plan = registry.plan(), declaration = registry.descriptors().find(m => m.id === 'org.viento.scene3d-alignment');
  assert.equal(plan.modules.length, 21); assert.equal(plan.capabilities.length, 38);
  assert.deepEqual(declaration.dependencies, [{ id: 'org.viento.document', apiVersion: 1 }]);
  assert.equal(plan.capabilities.find(c => c.capability === 'scene.authoring.alignment3d').moduleId, declaration.id);
});

test('alignment mounts with all five other authoring areas and readonly preview explicitly disabled', async () => {
  const h = fixture(), getContext = () => ({}), getSource = () => 'private author text', applyDraft = () => {};
  const system = await h.setup({ features: { scene3d: false, scene3dTransforms: false, scene3dObjects: false,
    scene3dEnvironment: false, scene3dProperties: false, scene3dTranslation: false },
    ports: { scene3d: {}, scene3dTransforms: {}, scene3dObjects: {}, scene3dEnvironment: {}, scene3dProperties: {}, scene3dTranslation: {},
      scene3dAlignment: { getContext, getSource, applyDraft } } });
  for (const name of ['preview', 'transforms', 'objects', 'environment', 'properties', 'translation']) assert.ok(!h.mounts.some(m => m.name === name));
  const mounted = h.mounts.find(m => m.name === 'alignment');
  assert.ok(Object.isFrozen(mounted.ports)); assert.deepEqual(Object.keys(mounted.ports).sort(), ['applyDraft', 'getContext', 'getSource']);
  assert.equal(mounted.ports.getSource, getSource); assert.equal(mounted.ports.applyDraft, applyDraft);
  const snapshot = copy(system.snapshot());
  assert.ok(snapshot.initializedModules.includes('org.viento.scene3d-alignment'));
  assert.equal(snapshot.hostCapabilities.projectBuild, false); assert.equal(snapshot.hostCapabilities.semanticProjection, false);
  assert.equal(JSON.stringify(snapshot).includes('private author text'), false);
  assert.deepEqual(Object.keys(system).sort(), ['refreshMedia', 'snapshot', 'updateCapabilities', 'updateProject']);
});

test('missing and disabled alignment leave all existing views mounted and do not create author authority', async () => {
  const oldPorts = { scene3d: {}, scene3dTransforms: {}, scene3dObjects: {}, scene3dEnvironment: {}, scene3dProperties: {}, scene3dTranslation: {} };
  for (const options of [{ ports: oldPorts }, { features: { scene3dAlignment: false }, ports: { ...oldPorts, scene3dAlignment: {} } }]) {
    const h = fixture(), system = await h.setup(options);
    assert.ok(!h.mounts.some(m => m.name === 'alignment'));
    for (const name of ['preview', 'transforms', 'objects', 'environment', 'properties', 'translation']) assert.ok(h.mounts.some(m => m.name === name));
    assert.equal(copy(system.snapshot()).initializedModules.length, 13);
  }
  const h = fixture(), system = await h.setup({ ports: { ...oldPorts, scene3dAlignment: {} } });
  assert.equal(copy(system.snapshot()).initializedModules.length, 14);
});

test('alignment ports are captured before settings await and cannot borrow a sibling controller or callbacks', async () => {
  let release; const h = fixture(new Promise(resolve => { release = resolve; }));
  const source = () => 'source', apply = () => {}, sibling = () => 'different domain';
  const ports = { scene3dAlignment: { getSource: source, applyDraft: apply }, scene3dProperties: { applyDraft: sibling } };
  const pending = h.setup({ ports });
  ports.scene3dAlignment.getSource = sibling; ports.scene3dAlignment.applyDraft = sibling;
  ports.scene3dProperties.applyDraft = apply; release(); const system = await pending;
  const actual = h.mounts.find(m => m.name === 'alignment').ports;
  assert.equal(actual.getSource, source); assert.equal(actual.applyDraft, apply);
  assert.equal(h.mounts.find(m => m.name === 'properties').ports.applyDraft, sibling);
  system.refreshMedia(); assert.deepEqual(h.refreshed, ['media', 'properties', 'alignment']);
});

test('additive profile requests diagnose only mounted alignment and never hot-mount or imply save/execution', async () => {
  for (const available of [false, true]) {
    const h = fixture(), system = await h.setup({ ports: available ? { scene3dAlignment: {} } : {} });
    const before = h.mounts.length, snapshot = copy(system.updateProject({ studioProfile: {
      format: 'viento-studio-profile', schemaVersion: 1,
      required: [{ capability: 'scene.authoring.alignment3d', apiVersion: 1 }], optional: [] } }));
    assert.equal(snapshot.plan.requests[0].status, available ? 'supported' : 'inactive');
    assert.equal(h.mounts.length, before); assert.equal(snapshot.lifecycle, 'boot-only');
    assert.equal(snapshot.hostCapabilities.projectBuild, false); assert.equal(snapshot.hostCapabilities.semanticProjection, false);
  }
});
