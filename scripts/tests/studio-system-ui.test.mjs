import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';

const source = await fs.readFile(new URL('../../web/modules/app-studio-system.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const id = name => `org.viento.${name}`;
const profile = (required = [], optional = []) => ({ format: 'viento-studio-profile', schemaVersion: 1,
  required: required.map(capability => typeof capability === 'string' ? { capability, apiVersion: 1 } : capability),
  optional: optional.map(capability => typeof capability === 'string' ? { capability, apiVersion: 1 } : capability) });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Assembly tests execute the actual composition root with explicit view-port
// doubles. The real registry receives JSON DTOs at the VM boundary; no product
// validator is weakened and these tests do not claim browser rendering.
function fixture(options = {}) {
  const events = [], calls = new Map(), worldAvailability = [], buildAvailability = [], exports = [], mediaRefreshes = [];
  const controllers = {
    world: { setAvailable(...args) { worldAvailability.push(copy(args)); options.worldAvailable?.(...args); } },
    build: { setAvailable(...args) { buildAvailability.push(copy(args)); options.buildAvailable?.(...args); } },
    project: undefined,
    export: { exportAsset(...args) { assert.equal(this, controllers.export); exports.push(args); return options.exportResult ?? 'exported'; } },
    media: { refresh() { mediaRefreshes.push('refresh'); } },
  };
  const factories = {};
  for (const [name, binding] of Object.entries({ world: 'setupWorldBrowser', build: 'setupProjectBuild', project: 'setupProjectSettings',
    export: 'setupExport', media: 'setupMediaEditor' })) factories[binding] = injected => {
    events.push(name); calls.set(name, [...(calls.get(name) || []), injected]);
    return Object.hasOwn(options.controllers || {}, name) ? options.controllers[name] : controllers[name];
  };
  const registry = createStudioModuleRegistry();
  const context = vm.createContext({
    createStudioModuleRegistry: () => ({ plan: (requested, planned) => registry.plan(copy(requested), copy(planned)) }),
    async setupSettings(injected) { events.push('settings-start'); calls.set('settings', [injected]);
      if (options.settingsReady) await options.settingsReady; events.push('settings-complete'); },
    ...factories,
  });
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace('export async function', 'async function'), context);
  return { events, calls, controllers, worldAvailability, buildAvailability, exports, mediaRefreshes,
    setup: input => context.setupStudioSystem(input), snapshot: system => copy(system.snapshot()) };
}

test('settings finish before localized areas mount, with the document authority already host-owned', async () => {
  const gate = deferred(), h = fixture({ settingsReady: gate.promise }), settings = { storageKey: 'studio-language' };
  const pending = h.setup({ settings });
  assert.deepEqual(h.events, ['settings-start']); assert.equal(h.calls.get('settings')[0], settings);
  gate.resolve(); const system = await pending;
  assert.deepEqual(h.events, ['settings-start', 'settings-complete', 'world', 'build', 'project', 'export', 'media']);
  assert.deepEqual(h.snapshot(system).initializedModules, ['document', 'settings', 'world', 'build', 'project', 'export', 'media'].map(id));
});

test('a failed language initialization does not partly mount domain views', async () => {
  const gate = deferred(), h = fixture({ settingsReady: gate.promise }), pending = h.setup();
  gate.reject(new Error('Language store unavailable'));
  await assert.rejects(pending, /Language store unavailable/);
  assert.deepEqual(h.events, ['settings-start']);
});

test('each area receives only its own frozen options and unchanged author callbacks', async () => {
  const h = fixture(), ports = {};
  for (const name of ['world', 'build', 'project', 'export', 'media']) ports[name] = { marker: name, getContext: () => ({ sourceOwner: name }) };
  await h.setup({ ports });
  for (const name of Object.keys(ports)) {
    const received = h.calls.get(name)[0];
    assert.equal(received.marker, name); assert.equal(received.getContext, ports[name].getContext); assert.equal(Object.isFrozen(received), true);
    assert.equal(Object.hasOwn(received, 'controllers'), false); assert.equal(Object.hasOwn(received, 'world'), false);
  }
});

test('port configuration is captured before awaiting settings and caller mutation cannot replace source authority', async () => {
  const gate = deferred(), h = fixture({ settingsReady: gate.promise }), original = () => 'original-authority';
  const ports = { build: { applyCompositionDraft: original }, media: { getContext: original } }, pending = h.setup({ ports });
  ports.build.applyCompositionDraft = () => 'replacement'; ports.media = { getContext: () => 'replacement' };
  gate.resolve(); await pending;
  assert.equal(h.calls.get('build')[0].applyCompositionDraft, original); assert.equal(h.calls.get('media')[0].getContext, original);
});

test('the public system surface and snapshots never expose controllers, functions or source text', async () => {
  const h = fixture(), privateSource = 'secret unsaved author content';
  const system = await h.setup({ ports: { build: { getCompositionSource: () => privateSource } } });
  assert.deepEqual(Object.keys(system).sort(), ['refreshMedia', 'snapshot', 'updateCapabilities', 'updateProject']);
  assert.equal(Object.isFrozen(system), true); assert.equal(system.destroy, undefined); assert.equal(system.dispose, undefined);
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.lifecycle, 'boot-only'); assert.equal(snapshot.hotReload, false);
  assert.equal(JSON.stringify(snapshot).includes(privateSource), false); assert.equal(Object.hasOwn(snapshot, 'controllers'), false);
});

test('media receives the declared export provider rather than a caller-supplied sibling override', async () => {
  const h = fixture({ exportResult: { saved: true } }); let forgedCalls = 0;
  await h.setup({ ports: { media: { exportAsset() { forgedCalls++; } } } });
  const media = h.calls.get('media')[0], result = media.exportAsset('asset-id', { format: 'original' });
  assert.deepEqual(result, { saved: true }); assert.deepEqual(h.exports, [['asset-id', { format: 'original' }]]); assert.equal(forgedCalls, 0);
  assert.notEqual(media.exportAsset, h.controllers.export.exportAsset);
});

test('disabling export leaves reference editing active and gives media no phantom export provider', async () => {
  const h = fixture(), inserted = [], insertText = value => inserted.push(value);
  const system = await h.setup({ features: { export: false }, ports: { media: { insertText, exportAsset() { assert.fail('Undeclared provider'); } } } });
  assert.equal(h.calls.has('export'), false); assert.equal(h.calls.has('media'), true);
  const media = h.calls.get('media')[0]; assert.equal(Object.hasOwn(media, 'exportAsset'), false); media.insertText('![portrait](resource:uuid)');
  assert.deepEqual(inserted, ['![portrait](resource:uuid)']);
  const snapshot = h.snapshot(system); assert.equal(snapshot.plan.modules.find(module => module.id === id('export')).active, false);
  assert.equal(snapshot.plan.capabilities.find(item => item.capability === 'resource.reference').active, true);
});

test('an exporter without an asset provider does not disable or invent the optional media service', async () => {
  const h = fixture({ controllers: { export: {} } }); await h.setup();
  assert.equal(h.calls.has('media'), true); assert.equal(Object.hasOwn(h.calls.get('media')[0], 'exportAsset'), false);
});

test('disabling project settings does not disable the document, world or build modules', async () => {
  const h = fixture(), system = await h.setup({ features: { project: false } }), snapshot = h.snapshot(system);
  assert.equal(h.calls.has('project'), false); assert.equal(h.calls.has('world'), true); assert.equal(h.calls.has('build'), true);
  assert.equal(snapshot.plan.modules.find(module => module.id === id('document')).active, true);
  assert.equal(snapshot.plan.modules.find(module => module.id === id('project')).reason, 'disabled');
});

test('disabling media leaves package exporting available and refresh performs no hidden media setup', async () => {
  const h = fixture(), system = await h.setup({ features: { media: false } });
  system.refreshMedia(); assert.equal(h.calls.has('media'), false); assert.equal(h.calls.has('export'), true); assert.deepEqual(h.mediaRefreshes, []);
  assert.equal(h.snapshot(system).plan.capabilities.find(item => item.capability === 'resource.package').active, true);
});

test('all legacy optional features may be disabled while base source and execution views stay assembled', async () => {
  const h = fixture(), system = await h.setup({ features: { project: false, export: false, media: false } });
  assert.deepEqual(h.snapshot(system).initializedModules, ['document', 'settings', 'world', 'build'].map(id));
  assert.equal(h.snapshot(system).plan.modules.filter(module => module.active).length, 4);
});

test('module assembly does not grant host World writes, execution or preview availability', async () => {
  const h = fixture(), system = await h.setup(); system.updateProject({ studioProfile: profile(['world.commands', 'backend.execution']) });
  assert.equal(h.snapshot(system).plan.satisfied, true);
  assert.deepEqual(h.worldAvailability.at(-1), [false, []]); assert.deepEqual(h.buildAvailability.at(-1), [false, [], { scenePreview: false }]);
});

test('World access, execution and scene preview are independent host capabilities', async () => {
  const h = fixture(), system = await h.setup();
  system.updateCapabilities({ semanticProjection: true, semanticCommands: ['scene.create'], projectBuild: false, scenePreview: true });
  assert.deepEqual(h.worldAvailability.at(-1), [true, ['scene.create']]);
  assert.deepEqual(h.buildAvailability.at(-1), [false, ['scene.create'], { scenePreview: true }]);
  system.updateCapabilities({ semanticProjection: false, semanticCommands: [], projectBuild: true, scenePreview: false });
  assert.deepEqual(h.worldAvailability.at(-1), [false, []]); assert.deepEqual(h.buildAvailability.at(-1), [true, [], { scenePreview: false }]);
});

test('host capability refresh fails closed for non-booleans and revokes previous grants', async () => {
  const h = fixture(), system = await h.setup();
  system.updateCapabilities({ semanticProjection: true, semanticCommands: ['scene.update'], projectBuild: true, scenePreview: true });
  system.updateCapabilities({ semanticProjection: 'true', semanticCommands: 'scene.update', projectBuild: 1, scenePreview: 'yes' });
  assert.deepEqual(h.snapshot(system).hostCapabilities, { semanticProjection: false, semanticCommands: [], projectBuild: false, scenePreview: false });
  assert.deepEqual(h.worldAvailability.at(-1), [false, []]); assert.deepEqual(h.buildAvailability.at(-1), [false, [], { scenePreview: false }]);
});

test('command arrays are isolated from the caller and every receiving area', async () => {
  const h = fixture({ worldAvailable(_available, commands) { commands.push('world-only-mutation'); } });
  const system = await h.setup(), commands = ['scene.create', null, 'scene.update', 17];
  system.updateCapabilities({ semanticProjection: true, semanticCommands: commands, projectBuild: true, scenePreview: true });
  assert.deepEqual(h.buildAvailability.at(-1)[1], ['scene.create', 'scene.update']);
  assert.deepEqual(commands, ['scene.create', null, 'scene.update', 17]);
  assert.deepEqual(h.snapshot(system).hostCapabilities.semanticCommands, ['scene.create', 'scene.update']);
});

test('snapshot mutation cannot change future module plans or capability delivery', async () => {
  const h = fixture(), system = await h.setup();
  system.updateCapabilities({ semanticProjection: true, semanticCommands: ['scene.update'] });
  const snapshot = system.snapshot(); snapshot.hostCapabilities.semanticCommands.push('fake'); snapshot.plan.modules[0].active = false;
  snapshot.initializedModules.length = 0;
  system.updateProject({ studioProfile: profile(['document.edit']) });
  assert.deepEqual(h.worldAvailability.at(-1), [true, ['scene.update']]);
  assert.equal(h.snapshot(system).plan.modules[0].active, true); assert.equal(h.snapshot(system).initializedModules.length, 7);
});

test('a future required 3D request reports the missing capability without unmounting current authoring', async () => {
  const h = fixture(), system = await h.setup(); system.updateProject({ studioProfile: profile(['scene.representation.scene4d', 'document.edit']) });
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.plan.satisfied, false); assert.equal(snapshot.plan.requests[0].status, 'missing');
  assert.equal(snapshot.plan.requests[1].status, 'supported'); assert.equal(snapshot.plan.modules.filter(module => module.id !== 'org.viento.scene-composition-create' && module.id !== id('scripts') && module.id !== id('scene3d') && module.id !== 'org.viento.scene3d-transforms' && module.id !== 'org.viento.scene3d-objects' && module.id !== 'org.viento.scene3d-environment' && module.id !== 'org.viento.scene3d-properties' && module.id !== 'org.viento.scene3d-translation' && module.id !== 'org.viento.scene3d-alignment' && module.id !== 'org.viento.scene3d-distribution' && module.id !== 'org.viento.scene3d-copy' && module.id !== 'org.viento.scene3d-removal' && module.id !== 'org.viento.scene-behaviors').every(module => module.active), true);
  assert.equal(snapshot.plan.capabilities.find(item => item.capability === 'scene.authoring.composition2d').active, true);
  assert.equal(h.calls.get('build').length, 1);
});

test('optional missing or unsupported capabilities remain diagnostics and never imply Rust author compilation', async () => {
  const h = fixture(), system = await h.setup(); system.updateProject({ studioProfile: profile(['document.read'], ['behavior.rust', { capability: 'language.json', apiVersion: 2 }]) });
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.plan.satisfied, true); assert.deepEqual(snapshot.plan.requests.map(request => request.status), ['supported', 'missing', 'version_unsupported']);
  assert.deepEqual(snapshot.plan.diagnostics.map(item => item.severity), ['warning', 'warning']);
  assert.equal(snapshot.plan.capabilities.some(item => item.capability === 'behavior.rust'), false);
});

test('a disabled requested module is inactive while its independent sibling still supports author resources', async () => {
  const h = fixture(), system = await h.setup({ features: { export: false } });
  system.updateProject({ studioProfile: profile(['resource.package', 'resource.reference']) });
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.plan.satisfied, false); assert.deepEqual(snapshot.plan.requests.map(request => request.status), ['inactive', 'supported']);
  assert.equal(snapshot.plan.modules.find(module => module.id === id('media')).active, true); assert.equal(h.calls.has('media'), true);
});

test('malformed project profiles report a local diagnostic and preserve the already mounted editor', async () => {
  const h = fixture(), system = await h.setup(); const mounted = [...h.events];
  system.updateProject({ studioProfile: { format: 'unknown-profile', schemaVersion: 7 } });
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.plan.satisfied, false); assert.equal(snapshot.plan.diagnostics[0].code, 'studio_profile_invalid');
  assert.equal(snapshot.plan.modules.find(module => module.id === 'org.viento.scene3d-translation').active, false);
  assert.equal(snapshot.plan.modules.find(module => module.id === 'org.viento.scene3d-alignment').active, false);
  assert.equal(snapshot.plan.modules.filter(module => module.id !== 'org.viento.scene-composition-create' && module.id !== id('scripts') && module.id !== id('scene3d') && module.id !== 'org.viento.scene3d-transforms' && module.id !== 'org.viento.scene3d-objects' && module.id !== 'org.viento.scene3d-environment' && module.id !== 'org.viento.scene3d-properties' && module.id !== 'org.viento.scene3d-translation' && module.id !== 'org.viento.scene3d-alignment' && module.id !== 'org.viento.scene3d-distribution' && module.id !== 'org.viento.scene3d-copy' && module.id !== 'org.viento.scene3d-removal' && module.id !== 'org.viento.scene-behaviors').every(module => module.active), true); assert.deepEqual(h.events, mounted);
});

test('an explicitly null profile is invalid while an absent profile remains legacy, without rewriting author data', async () => {
  const h = fixture(), system = await h.setup(), workspace = { studioProfile: null, title: 'Author project' }, before = copy(workspace);
  system.updateProject(workspace);
  assert.equal(h.snapshot(system).plan.satisfied, false);
  assert.equal(h.snapshot(system).plan.diagnostics[0].code, 'studio_profile_invalid'); assert.deepEqual(workspace, before);
  assert.equal(h.snapshot(system).plan.modules.filter(module => module.id !== 'org.viento.scene-composition-create' && module.id !== id('scripts') && module.id !== id('scene3d') && module.id !== 'org.viento.scene3d-transforms' && module.id !== 'org.viento.scene3d-objects' && module.id !== 'org.viento.scene3d-environment' && module.id !== 'org.viento.scene3d-properties' && module.id !== 'org.viento.scene3d-translation' && module.id !== 'org.viento.scene3d-alignment' && module.id !== 'org.viento.scene3d-distribution' && module.id !== 'org.viento.scene3d-copy' && module.id !== 'org.viento.scene3d-removal' && module.id !== 'org.viento.scene-behaviors').every(module => module.active), true);
  system.updateProject({ title: 'Legacy project' });
  assert.equal(h.snapshot(system).plan.satisfied, true); assert.deepEqual(h.snapshot(system).plan.diagnostics, []);
});

test('a future profile schema preserves authored requests and assembled modules with a local invalid diagnostic', async () => {
  const h = fixture(), system = await h.setup(), workspace = { studioProfile: { ...profile(['scene.representation.scene4d']), schemaVersion: 2 } };
  const before = copy(workspace), initialized = h.snapshot(system).initializedModules;
  system.updateProject(workspace);
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.plan.diagnostics[0].code, 'studio_profile_invalid');
  assert.equal(snapshot.plan.modules.find(module => module.id === 'org.viento.scene3d-translation').active, false);
  assert.equal(snapshot.plan.modules.find(module => module.id === 'org.viento.scene3d-alignment').active, false); assert.deepEqual(workspace, before);
  assert.deepEqual(snapshot.initializedModules, initialized); assert.equal(snapshot.plan.modules.filter(module => module.id !== 'org.viento.scene-composition-create' && module.id !== id('scripts') && module.id !== id('scene3d') && module.id !== 'org.viento.scene3d-transforms' && module.id !== 'org.viento.scene3d-objects' && module.id !== 'org.viento.scene3d-environment' && module.id !== 'org.viento.scene3d-properties' && module.id !== 'org.viento.scene3d-translation' && module.id !== 'org.viento.scene3d-alignment' && module.id !== 'org.viento.scene3d-distribution' && module.id !== 'org.viento.scene3d-copy' && module.id !== 'org.viento.scene3d-removal' && module.id !== 'org.viento.scene-behaviors').every(module => module.active), true);
});

test('moving between additive profiles and a legacy project changes only plan diagnostics', async () => {
  const h = fixture(), system = await h.setup(), initial = [...h.events];
  system.updateProject({ studioProfile: profile(['scene.representation.scene4d']) });
  system.updateProject({ studioProfile: profile(['project.templates', 'language.markdown']) });
  system.updateProject({ title: 'Legacy author workspace' });
  const snapshot = h.snapshot(system);
  assert.equal(snapshot.plan.satisfied, true); assert.deepEqual(snapshot.plan.requests, []); assert.deepEqual(snapshot.plan.diagnostics, []);
  assert.deepEqual(h.events, initial); assert.equal(snapshot.lifecycle, 'boot-only');
});

test('refresh affects only the mounted media controller and does not remount any functional area', async () => {
  const h = fixture(), system = await h.setup(), initial = [...h.events];
  system.refreshMedia(); system.refreshMedia(); system.updateCapabilities({}); system.updateProject({});
  assert.deepEqual(h.mediaRefreshes, ['refresh', 'refresh']); assert.deepEqual(h.events, initial);
});

test('assembly and metadata refresh preserve injected source callbacks without invoking ordinary Save', async () => {
  const h = fixture(); let invoked = 0; const sourceCallback = () => { invoked++; };
  const ports = { build: { applyCompositionDraft: sourceCallback, applySceneDraft: sourceCallback },
    world: { applied: sourceCallback }, project: { applied: sourceCallback }, export: { applied: sourceCallback },
    media: { replaceSource: sourceCallback, insertText: sourceCallback, changed: sourceCallback } };
  const system = await h.setup({ ports }); system.updateCapabilities({ semanticProjection: true, projectBuild: true, scenePreview: true });
  system.updateProject({ studioProfile: profile(['document.edit', 'resource.reference']) });
  assert.equal(invoked, 0); assert.equal(h.calls.get('build')[0].applySceneDraft, sourceCallback);
  assert.equal(h.calls.get('media')[0].replaceSource, sourceCallback);
});

test('settings fallback is used once and the explicit runtime settings remain authoritative', async () => {
  const fallback = { preferredLanguage: 'ja' }, h = fixture(); await h.setup({ ports: { settings: fallback } });
  assert.equal(h.calls.get('settings')[0], fallback);
  const explicit = { preferredLanguage: 'en' }, other = fixture(), system = await other.setup({ settings: explicit, ports: { settings: fallback } });
  system.updateProject({}); system.updateCapabilities({}); assert.equal(other.calls.get('settings')[0], explicit);
  assert.equal(other.calls.get('settings').length, 1);
});
