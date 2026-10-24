import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const moduleId = 'org.viento.scene-physics2d';
function fixture(settings, missing = false) {
  const registry = createStudioModuleRegistry(), mounts = [], refreshed = [];
  const bindings = { createStudioModuleRegistry: () => ({ plan: (profile, options) => registry.plan(copy(profile), copy(options)) }), setupSettings: async () => settings };
  const factories = { world: 'setupWorldBrowser', build: 'setupProjectBuild', media: 'setupMediaEditor', project: 'setupProjectSettings',
    export: 'setupExport', audio: 'setupSceneAudio', animation: 'setupSceneAnimation', physics: 'setupScenePhysics2D' };
  for (const [name, setup] of Object.entries(factories)) if (!missing || name !== 'physics') bindings[setup] = ports => {
    mounts.push({ name, ports }); return { refresh: () => refreshed.push(name), setAvailable() {} };
  };
  const context = vm.createContext(bindings);
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
  return { mounts, refreshed, setup: options => context.setupStudioSystem(options) };
}

test('physics authoring is a separate module with only document dependency and no implicit simulation capability', () => {
  const registry = createStudioModuleRegistry(), plan = registry.plan(), declaration = registry.descriptors().find(row => row.id === moduleId);
  assert.equal(plan.modules.length, 23); assert.equal(plan.capabilities.length, 44);
  assert.deepEqual(declaration.dependencies, [{ id: 'org.viento.document', apiVersion: 1 }]);
  assert.deepEqual(declaration.contributions, [{ capability: 'scene.authoring.physics2d', apiVersion: 1, domain: 'authoring' }]);
  assert.equal(plan.capabilities.some(row => row.capability === 'physics.character2d'), false);
});

test('physics source ports mount independently of audio animation build grants and remain private', async () => {
  const h = fixture(), getContext = () => ({}), getSource = () => 'private physical draft', applyDraft = () => {};
  const system = await h.setup({ features: { sceneAudio: false, sceneAnimation: false }, ports: { sceneAudio: {}, sceneAnimation: {}, scenePhysics2D: { getContext, getSource, applyDraft } } });
  assert.equal(h.mounts.some(row => ['audio', 'animation'].includes(row.name)), false);
  const actual = h.mounts.find(row => row.name === 'physics').ports;
  assert.ok(Object.isFrozen(actual)); assert.deepEqual(Object.keys(actual).sort(), ['applyDraft', 'getContext', 'getSource']);
  assert.equal(actual.getContext, getContext); assert.equal(actual.getSource, getSource); assert.equal(actual.applyDraft, applyDraft);
  const snapshot = copy(system.snapshot()); assert.ok(snapshot.initializedModules.includes(moduleId));
  assert.equal(snapshot.hostCapabilities.projectBuild, false); assert.equal(snapshot.hostCapabilities.semanticProjection, false);
  assert.equal(JSON.stringify(snapshot).includes('private physical draft'), false);
  assert.deepEqual(Object.keys(system).sort(), ['refreshMedia', 'snapshot', 'updateCapabilities', 'updateProject']);
});

test('missing disabled and legacy absent setup leave old author modules mounted without physics authority', async () => {
  for (const options of [{ ports: { sceneAudio: {}, sceneAnimation: {} } },
    { ports: { sceneAudio: {}, sceneAnimation: {}, scenePhysics2D: {} }, features: { scenePhysics2D: false } }]) {
    const h = fixture(), system = await h.setup(options); assert.equal(h.mounts.some(row => row.name === 'physics'), false);
    for (const name of ['audio', 'animation', 'world', 'build']) assert.ok(h.mounts.some(row => row.name === name));
    system.refreshMedia(); assert.equal(h.refreshed.includes('physics'), false);
  }
  const legacy = fixture(undefined, true), system = await legacy.setup({ ports: { scenePhysics2D: {} } });
  assert.equal(copy(system.snapshot()).initializedModules.includes(moduleId), false);
});

test('physics ports are captured before settings awaits and cannot borrow sibling state or execute services', async () => {
  let release; const h = fixture(new Promise(resolve => { release = resolve; }));
  const source = () => 'original', apply = () => {}, sibling = () => 'audio';
  const ports = { scenePhysics2D: { getSource: source, applyDraft: apply }, sceneAudio: { applyDraft: sibling } };
  const pending = h.setup({ ports }); ports.scenePhysics2D.getSource = sibling; ports.scenePhysics2D.applyDraft = sibling; ports.sceneAudio.applyDraft = apply;
  release(); const system = await pending;
  const actual = h.mounts.find(row => row.name === 'physics').ports;
  assert.equal(actual.getSource, source); assert.equal(actual.applyDraft, apply); assert.equal(h.mounts.find(row => row.name === 'audio').ports.applyDraft, sibling);
  system.refreshMedia(); assert.deepEqual(h.refreshed, ['audio', 'physics', 'media']);
});

test('profile and host refresh cannot hot-mount physics or grant writes or engine availability', async () => {
  for (const available of [false, true]) {
    const h = fixture(), system = await h.setup({ ports: available ? { scenePhysics2D: {} } : {} }), before = h.mounts.length;
    const snapshot = copy(system.updateProject({ studioProfile: { format: 'viento-studio-profile', schemaVersion: 1,
      required: [{ capability: 'scene.authoring.physics2d', apiVersion: 1 }], optional: [] } }));
    assert.equal(snapshot.plan.requests[0].status, available ? 'supported' : 'inactive'); assert.equal(h.mounts.length, before);
    system.updateCapabilities({ semanticProjection: true, projectBuild: true, sceneAnimationTargets: true });
    assert.equal(h.mounts.length, before); assert.equal(snapshot.lifecycle, 'boot-only');
  }
});
