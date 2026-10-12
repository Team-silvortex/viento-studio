import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';

const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(settings) {
  const registry = createStudioModuleRegistry(), mounts = [], refreshed = [];
  const bindings = { createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }), setupSettings: async () => settings };
  for (const [name, setup] of Object.entries({ world: 'setupWorldBrowser', build: 'setupProjectBuild', media: 'setupMediaEditor', project: 'setupProjectSettings', export: 'setupExport', scene3d: 'setupScene3DPreview', transforms: 'setupScene3DTransforms', objects: 'setupScene3DObjects' })) {
    bindings[setup] = ports => { mounts.push({ name, ports }); return { refresh: () => refreshed.push(name), setAvailable() {} }; };
  }
  const context = vm.createContext(bindings); vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
  return { mounts, refreshed, setup: options => context.setupStudioSystem(options) };
}
test('object authoring module mounts with preview explicitly disabled and no backend or World capability', async () => {
  const h = fixture(), getContext = () => ({}), getSource = () => 'private source', applyDraft = () => {};
  const system = await h.setup({ features: { scene3d: false, scene3dTransforms: false }, ports: { scene3d: {}, scene3dObjects: { getContext, getSource, applyDraft } } });
  assert.equal(h.mounts.some(item => item.name === 'scene3d'), false);
  const mount = h.mounts.find(item => item.name === 'objects'); assert.equal(Object.isFrozen(mount.ports), true);
  assert.deepEqual(Object.keys(mount.ports).sort(), ['applyDraft', 'getContext', 'getSource']); assert.equal(mount.ports.applyDraft, applyDraft);
  const snapshot = copy(system.snapshot()); assert.ok(snapshot.initializedModules.includes('org.viento.scene3d-objects'));
  assert.equal(snapshot.plan.capabilities.find(item => item.capability === 'scene.authoring.objects3d').active, true);
  assert.equal(snapshot.hostCapabilities.projectBuild, false); assert.equal(JSON.stringify(snapshot).includes('private source'), false);
});
test('missing or disabled authoring port leaves readonly preview and all legacy modules available', async () => {
  for (const options of [{ ports: { scene3d: {} } }, { features: { scene3dObjects: false }, ports: { scene3d: {}, scene3dObjects: {} } }]) {
    const h = fixture(), system = await h.setup(options); assert.equal(h.mounts.some(item => item.name === 'objects'), false);
    assert.equal(h.mounts.some(item => item.name === 'scene3d'), true); assert.equal(copy(system.snapshot()).initializedModules.length, 8);
  }
});
test('separate readonly and authoring callbacks are captured before settings await and controllers never escape', async () => {
  let release; const h = fixture(new Promise(resolve => { release = resolve; }));
  const read = () => 'readonly', edit = () => 'editing', ports = { scene3d: { getSource: read }, scene3dObjects: { applyDraft: edit } };
  const pending = h.setup({ ports }); ports.scene3d.getSource = edit; ports.scene3dObjects.applyDraft = read; release(); const system = await pending;
  assert.deepEqual(Object.keys(h.mounts.find(item => item.name === 'scene3d').ports), ['getSource']);
  assert.equal(h.mounts.find(item => item.name === 'scene3d').ports.getSource, read); assert.equal(h.mounts.find(item => item.name === 'objects').ports.applyDraft, edit);
  assert.deepEqual(Object.keys(system).sort(), ['refreshMedia', 'snapshot', 'updateCapabilities', 'updateProject']);
  system.refreshMedia(); assert.deepEqual(h.refreshed, ['media', 'scene3d', 'objects']);
});
test('authoring capability request reports its optional port availability and does not imply save or execution access', async () => {
  for (const available of [false, true]) {
    const h = fixture(), system = await h.setup({ ports: available ? { scene3dObjects: {} } : {} });
    const snapshot = copy(system.updateProject({ studioProfile: { format: 'viento-studio-profile', schemaVersion: 1,
      required: [{ capability: 'scene.authoring.objects3d', apiVersion: 1 }], optional: [] } }));
    assert.equal(snapshot.plan.requests[0].status, available ? 'supported' : 'inactive');
    assert.equal(snapshot.hostCapabilities.semanticProjection, false); assert.equal(snapshot.hostCapabilities.projectBuild, false);
    assert.equal(snapshot.lifecycle, 'boot-only');
  }
});
