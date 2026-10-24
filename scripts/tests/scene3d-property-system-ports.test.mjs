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
  for (const [name, setup] of Object.entries({ world: 'setupWorldBrowser', build: 'setupProjectBuild', media: 'setupMediaEditor',
    project: 'setupProjectSettings', export: 'setupExport', scene3d: 'setupScene3DPreview', transforms: 'setupScene3DTransforms',
    objects: 'setupScene3DObjects', environment: 'setupScene3DEnvironment', properties: 'setupScene3DProperties' })) {
    bindings[setup] = ports => { mounts.push({ name, ports }); return { refresh: () => refreshed.push(name), setAvailable() {} }; };
  }
  const context = vm.createContext(bindings);
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
  return { mounts, refreshed, setup: options => context.setupStudioSystem(options) };
}

test('properties mount independently without preview, other authoring domains, World or backend capabilities', async () => {
  const h = fixture(), getContext = () => ({}), getSource = () => 'private properties source', applyDraft = () => {};
  const system = await h.setup({ features: { scene3d: false, scene3dTransforms: false, scene3dObjects: false, scene3dEnvironment: false },
    ports: { scene3d: {}, scene3dTransforms: {}, scene3dObjects: {}, scene3dEnvironment: {}, scene3dProperties: { getContext, getSource, applyDraft } } });
  for (const name of ['scene3d', 'transforms', 'objects', 'environment']) assert.equal(h.mounts.some(item => item.name === name), false);
  const mount = h.mounts.find(item => item.name === 'properties'); assert.equal(Object.isFrozen(mount.ports), true);
  assert.deepEqual(Object.keys(mount.ports).sort(), ['applyDraft', 'getContext', 'getSource']); assert.equal(mount.ports.applyDraft, applyDraft);
  const snapshot = copy(system.snapshot()); assert.ok(snapshot.initializedModules.includes('org.viento.scene3d-properties'));
  assert.equal(snapshot.plan.capabilities.find(item => item.capability === 'scene.authoring.properties3d').active, true);
  assert.equal(snapshot.hostCapabilities.projectBuild, false); assert.equal(snapshot.hostCapabilities.semanticProjection, false);
  assert.equal(JSON.stringify(snapshot).includes('private properties source'), false);
});

test('missing or disabled properties keep readonly preview and all three existing authoring domains mounted', async () => {
  for (const options of [{ ports: { scene3d: {}, scene3dTransforms: {}, scene3dObjects: {}, scene3dEnvironment: {} } },
    { features: { scene3dProperties: false }, ports: { scene3d: {}, scene3dTransforms: {}, scene3dObjects: {}, scene3dEnvironment: {}, scene3dProperties: {} } }]) {
    const h = fixture(), system = await h.setup(options); assert.equal(h.mounts.some(item => item.name === 'properties'), false);
    for (const name of ['scene3d', 'transforms', 'objects', 'environment']) assert.equal(h.mounts.some(item => item.name === name), true);
    assert.equal(copy(system.snapshot()).initializedModules.length, 11);
  }
  const h = fixture(), system = await h.setup({ ports: { scene3d: {}, scene3dTransforms: {}, scene3dObjects: {}, scene3dEnvironment: {}, scene3dProperties: {} } });
  const snapshot = copy(system.snapshot()); assert.equal(snapshot.initializedModules.length, 12);
  assert.equal(snapshot.plan.modules.length, 23); assert.equal(snapshot.plan.capabilities.length, 44);
});

test('all five source ports detach before the settings await and controller references remain private', async () => {
  let release; const h = fixture(new Promise(resolve => { release = resolve; }));
  const read = () => 'readonly', transform = () => 'transform', objects = () => 'objects', environment = () => 'environment', properties = () => 'properties';
  const ports = { scene3d: { getSource: read }, scene3dTransforms: { applyDraft: transform }, scene3dObjects: { applyDraft: objects },
    scene3dEnvironment: { applyDraft: environment }, scene3dProperties: { applyDraft: properties } };
  const pending = h.setup({ ports });
  ports.scene3d.getSource = properties; ports.scene3dTransforms.applyDraft = objects;
  ports.scene3dObjects.applyDraft = read; ports.scene3dEnvironment.applyDraft = transform; ports.scene3dProperties.applyDraft = environment; release();
  const system = await pending;
  assert.deepEqual(Object.keys(h.mounts.find(item => item.name === 'scene3d').ports), ['getSource']);
  assert.equal(h.mounts.find(item => item.name === 'scene3d').ports.getSource, read);
  for (const [name, callback] of [['transforms', transform], ['objects', objects], ['environment', environment], ['properties', properties]]) {
    assert.equal(h.mounts.find(item => item.name === name).ports.applyDraft, callback);
    assert.deepEqual(Object.keys(h.mounts.find(item => item.name === name).ports), ['applyDraft']);
  }
  assert.deepEqual(Object.keys(system).sort(), ['refreshMedia', 'snapshot', 'updateCapabilities', 'updateProject']);
  system.refreshMedia(); assert.deepEqual(h.refreshed, ['media', 'scene3d', 'transforms', 'objects', 'environment', 'properties']);
});

test('property and future profile requests stay declarative and cannot create or hot-mount source authority', async () => {
  for (const available of [false, true]) {
    const h = fixture(), system = await h.setup({ ports: available ? { scene3dProperties: {} } : {} });
    const snapshot = copy(system.updateProject({ studioProfile: { format: 'viento-studio-profile', schemaVersion: 1,
      required: [{ capability: 'scene.authoring.properties3d', apiVersion: 1 }], optional: [{ capability: 'future.material3d', apiVersion: 1 }] } }));
    assert.equal(snapshot.plan.requests[0].status, available ? 'supported' : 'inactive');
    assert.equal(snapshot.plan.requests[1].status, 'missing');
    assert.equal(snapshot.hostCapabilities.semanticProjection, false); assert.equal(snapshot.hostCapabilities.projectBuild, false);
    assert.equal(snapshot.lifecycle, 'boot-only'); assert.equal(snapshot.hotReload, false);
    system.updateCapabilities({ projectBuild: true, semanticProjection: true });
    assert.equal(h.mounts.some(item => item.name === 'properties'), available);
    assert.equal(typeof system.applyDraft, 'undefined');
  }
});
