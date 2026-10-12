import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_MODULES, STUDIO_MODULE_SCHEMA_VERSION, STUDIO_PROFILE_SCHEMA_VERSION,
  validateStudioProfile, validateStudioModuleDescriptor, createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import { createProjectModel } from '../../engine/project.mjs';

const clone = value => structuredClone(value);
const request = (capability, apiVersion = 1) => ({ capability, apiVersion });
const profile = (required = [], optional = []) => ({ format: 'viento-studio-profile', schemaVersion: 1, required, optional });
const module = (id, capability, dependencies = [], domain = 'authoring') => ({ format: 'viento-studio-module', schemaVersion: 1,
  id, apiVersion: 1, dependencies: dependencies.map(id => ({ id, apiVersion: 1 })),
  contributions: [{ capability, apiVersion: 1, domain }] });
const invalid = error => error instanceof TypeError && error.errorCode === 'studio_module_invalid';
const active = (plan, id) => plan.modules.find(item => item.id === id);
const cap = (plan, id) => plan.capabilities.find(item => item.capability === id);

test('builtin composition declares twelve stable modules and keeps contribution domains separate', () => {
  assert.equal(STUDIO_MODULE_SCHEMA_VERSION, 1); assert.equal(STUDIO_PROFILE_SCHEMA_VERSION, 1);
  assert.deepEqual(STUDIO_MODULES.map(item => item.id), ['org.viento.document', 'org.viento.settings', 'org.viento.project',
    'org.viento.world', 'org.viento.export', 'org.viento.media', 'org.viento.build', 'org.viento.scene3d', 'org.viento.scene3d-transforms', 'org.viento.scene3d-objects', 'org.viento.scene3d-environment', 'org.viento.scene3d-properties']);
  const registry = createStudioModuleRegistry(), plan = registry.plan();
  assert.deepEqual(plan.modules.map(item => item.id), STUDIO_MODULES.map(item => item.id));
  assert.ok(plan.modules.every(item => item.active && item.reason === null));
  assert.equal(cap(plan, 'language.json').domain, 'language');
  assert.equal(cap(plan, 'project.templates').domain, 'project');
  assert.equal(cap(plan, 'authoring.object').domain, 'authoring');
  assert.equal(cap(plan, 'scene.representation.scene2d').domain, 'scene');
  assert.equal(cap(plan, 'backend.execution').domain, 'backend');
  assert.equal(cap(plan, 'behavior.rust'), undefined);
  assert.equal(cap(plan, 'scene.representation.scene3d').moduleId, 'org.viento.scene3d');
  assert.equal(cap(plan, 'scene.preview.scene3d').domain, 'scene');
  assert.equal(cap(plan, 'scene.authoring.transforms3d').domain, 'authoring');
  assert.equal(plan.satisfied, true); assert.deepEqual(plan.requests, []); assert.deepEqual(plan.diagnostics, []);
});

test('module registration and plan results own detached immutable snapshots', () => {
  const input = clone(STUDIO_MODULES), registry = createStudioModuleRegistry(input);
  input[0].id = 'example.changed'; input[0].contributions[0].capability = 'changed'; input.length = 0;
  assert.equal(registry.descriptors()[0].id, 'org.viento.document');
  assert.equal(registry.descriptors()[0].contributions[0].capability, 'document.read');
  assert.throws(() => registry.descriptors().push(module('example.test', 'test')), TypeError);
  assert.throws(() => registry.descriptors()[0].contributions[0].apiVersion = 2, TypeError);
  const p = profile([request('document.edit')]), plan = registry.plan(p);
  p.required[0].capability = 'backend.execution';
  assert.equal(plan.requests[0].capability, 'document.edit');
  assert.throws(() => plan.requests[0].status = 'missing', TypeError);
  assert.throws(() => plan.modules[0].active = false, TypeError);
  assert.ok(Object.isFrozen(registry) && Object.isFrozen(STUDIO_MODULES[0].contributions));
});

test('absent, null and empty additive profiles preserve legacy module composition', () => {
  const registry = createStudioModuleRegistry(), legacy = registry.plan();
  for (const value of [undefined, null, profile()]) assert.deepEqual(registry.plan(value), legacy);
  const requested = registry.plan(profile([request('language.text')]));
  assert.deepEqual(requested.modules, legacy.modules); assert.deepEqual(requested.capabilities, legacy.capabilities);
  assert.deepEqual(requested.requests, [{ capability: 'language.text', apiVersion: 1, required: true, status: 'supported', moduleId: 'org.viento.document' }]);
});

test('required and optional requests preserve declaration order and have independent severity', () => {
  const plan = createStudioModuleRegistry().plan(profile([request('document.edit'), request('scene.representation.scene4d')],
    [request('behavior.rust'), request('project.templates')]));
  assert.equal(plan.satisfied, false);
  assert.deepEqual(plan.requests.map(item => [item.capability, item.required, item.status]), [
    ['document.edit', true, 'supported'], ['scene.representation.scene4d', true, 'missing'],
    ['behavior.rust', false, 'missing'], ['project.templates', false, 'supported'],
  ]);
  assert.deepEqual(plan.diagnostics.map(item => [item.code, item.severity, item.propertyPath]), [
    ['studio_capability_missing', 'error', '/studioProfile/required/1'],
    ['studio_capability_missing', 'warning', '/studioProfile/optional/0'],
  ]);
  assert.equal(createStudioModuleRegistry().plan(profile([], [request('scene.representation.scene4d')])).satisfied, true);
});

test('unknown representations and behavior requirements never fall back to Scene2D or authorize a backend', () => {
  const plan = createStudioModuleRegistry().plan(profile([request('scene.representation.scene4d'), request('behavior.rust')]));
  assert.ok(plan.requests.every(item => item.status === 'missing' && item.moduleId === null));
  assert.ok(active(plan, 'org.viento.document').active);
  assert.ok(cap(plan, 'scene.representation.scene2d').active);
  assert.equal(Object.hasOwn(plan, 'backendId'), false); assert.equal(Object.hasOwn(plan, 'execute'), false);
  assert.equal(Object.hasOwn(plan, 'writable'), false); assert.equal(Object.hasOwn(plan, 'sourcePath'), false);
});

test('capability API mismatch is explicit and does not reactivate a disabled module', () => {
  const plan = createStudioModuleRegistry().plan(profile([request('scene.representation.scene2d', 2)], [request('project.templates')]),
    { enabledModules: { 'org.viento.build': false, 'org.viento.project': false } });
  assert.deepEqual(plan.requests.map(item => item.status), ['version_unsupported', 'inactive']);
  assert.deepEqual(plan.diagnostics.map(item => item.code), ['studio_capability_version_unsupported', 'studio_capability_inactive']);
  assert.equal(plan.requests[0].moduleId, 'org.viento.build');
  assert.equal(active(plan, 'org.viento.build').reason, 'disabled');
  assert.equal(cap(plan, 'document.edit').active, true);
});

test('module feature projection propagates required dependencies but keeps optional media/export ports independent', () => {
  const registry = createStudioModuleRegistry();
  const plan = registry.plan(null, { enabledModules: { 'org.viento.world': false, 'org.viento.export': false } });
  assert.equal(active(plan, 'org.viento.world').reason, 'disabled');
  assert.equal(active(plan, 'org.viento.build').reason, 'dependency_inactive');
  assert.equal(active(plan, 'org.viento.media').active, true);
  assert.equal(active(plan, 'org.viento.project').active, true);
  assert.equal(cap(plan, 'resource.reference').active, true);
  assert.equal(cap(plan, 'resource.package').active, false);
  const all = registry.plan(null, { enabledModules: { 'org.viento.document': false } });
  assert.equal(active(all, 'org.viento.settings').active, true);
  assert.ok(all.modules.filter(item => !['org.viento.settings', 'org.viento.document'].includes(item.id)).every(item => item.reason === 'dependency_inactive'));
});

test('dependency order is deterministic even when declarations arrive in reverse order', () => {
  const descriptors = [module('example.child', 'child', ['example.base']), module('example.independent', 'independent'), module('example.base', 'base')];
  const registry = createStudioModuleRegistry(descriptors);
  assert.deepEqual(registry.descriptors().map(item => item.id), ['example.base', 'example.child', 'example.independent']);
  assert.deepEqual(registry.plan().modules.map(item => item.id), ['example.base', 'example.child', 'example.independent']);
  assert.equal(registry.plan(null, { enabledModules: { 'example.base': false } }).modules[1].reason, 'dependency_inactive');
});

test('duplicate modules, ambiguous providers, missing/versioned dependencies and cycles fail registration', () => {
  const a = module('example.alpha', 'alpha'), b = module('example.beta', 'beta');
  for (const descriptors of [
    [a, clone(a)], [a, module('example.beta', 'alpha')], [module('example.child', 'child', ['example.missing'])],
    [{ ...b, dependencies: [{ id: a.id, apiVersion: 2 }] }, a],
    [module('example.alpha', 'alpha', ['example.beta']), module('example.beta', 'beta', ['example.alpha'])],
  ]) assert.throws(() => createStudioModuleRegistry(descriptors), invalid);
});

test('explicit host registration can provide a future representation without claiming an executable provider', () => {
  const registry = createStudioModuleRegistry([...STUDIO_MODULES, module('example.scene3d', 'scene.representation.scene4d', ['org.viento.document'], 'scene')]);
  const plan = registry.plan(profile([request('scene.representation.scene4d')], [request('backend.scene3d')]));
  assert.equal(plan.satisfied, true); assert.equal(plan.requests[0].moduleId, 'example.scene3d');
  assert.equal(plan.requests[0].status, 'supported'); assert.equal(plan.requests[1].status, 'missing');
  assert.equal(cap(plan, 'scene.representation.scene4d').domain, 'scene');
});

test('strict profile validates detached declarative requests but rejects paths, scripts and unknown keys', () => {
  const p = profile([request('document.edit')], [request('example.future', 65535)]), checked = validateStudioProfile(p);
  assert.notEqual(checked, p); assert.notEqual(checked.required[0], p.required[0]);
  assert.ok(Object.isFrozen(checked));
  for (const bad of [null, [], {}, { ...p, path: '/tmp/plugin.mjs' }, { ...p, script: 'run()' },
    { ...p, schemaVersion: 2 }, { ...p, format: 'other' }, { ...p, required: null },
    profile([{ ...request('document.edit'), module: 'example.plugin' }]),
    profile([request('../scene3d')]), profile([request('SCENE3D')]), profile([request('scene.*')]),
    profile([request('x'.repeat(193))]), profile([request('document.edit', 0)]),
    profile([request('document.edit', 65536)]), profile([request('document.edit', 1.5)]),
    profile([request('document.edit'), request('document.edit', 2)]),
    profile([request('document.edit')], [request('document.edit')]),
  ]) assert.throws(() => validateStudioProfile(bad), invalid);
});

test('malformed or future profiles produce local diagnostics and preserve ordinary document availability', () => {
  const registry = createStudioModuleRegistry(), modules = registry.plan().modules;
  for (const p of [{}, { ...profile(), schemaVersion: 99 }, profile([{ capability: 'scene.representation.scene4d' }]),
    profile([request('document.edit')], [request('document.edit')])]) {
    const result = registry.plan(p);
    assert.equal(result.satisfied, false); assert.deepEqual(result.modules, modules); assert.deepEqual(result.requests, []);
    assert.deepEqual(result.diagnostics.map(item => [item.code, item.propertyPath]), [['studio_profile_invalid', '/studioProfile']]);
    assert.equal(cap(result, 'document.edit').active, true);
  }
});

test('module descriptors reject dynamic implementations, unversioned capabilities and malformed domains', () => {
  const good = module('example.module', 'example.capability');
  for (const bad of [{ ...good, entry: './plugin.mjs' }, { ...good, setup() {} }, { ...good, apiVersion: 2 },
    { ...good, schemaVersion: 2 }, { ...good, id: 'module' }, { ...good, contributions: [] },
    { ...good, contributions: [{ ...good.contributions[0], apiVersion: 2 }] },
    { ...good, contributions: [{ ...good.contributions[0], domain: 'process' }] },
    { ...good, dependencies: [{ id: good.id, apiVersion: 1 }] },
    { ...good, dependencies: [{ id: 'example.dep', apiVersion: 1 }, { id: 'example.dep', apiVersion: 1 }] },
    { ...good, contributions: [good.contributions[0], good.contributions[0]] },
  ]) assert.throws(() => validateStudioModuleDescriptor(bad), invalid);
});

test('feature options are strict metadata and reject unknown modules or forged enable flags', () => {
  const registry = createStudioModuleRegistry();
  for (const options of [null, [], { allowAll: true }, { enabledModules: null }, { enabledModules: [] },
    { enabledModules: { 'example.unknown': true } }, { enabledModules: { 'org.viento.build': 1 } },
    { enabledModules: { 'org.viento.build': 'false' } }, { enabledModules: { 'org.viento.build': null } },
  ]) assert.throws(() => registry.plan(null, options), invalid);
});

test('accessors, serialization hooks, inherited objects, hidden fields, symbols, sparse arrays and cycles never gain authority', () => {
  let calls = 0;
  const getter = profile(); Object.defineProperty(getter, 'required', { get() { calls++; return []; }, enumerable: true });
  const hook = { ...profile(), toJSON() { calls++; return profile(); } };
  const hidden = profile(); Object.defineProperty(hidden, 'script', { value: 'run()', enumerable: false });
  const symbol = profile(); symbol[Symbol('script')] = true;
  const sparse = profile(Array(1));
  const cycle = profile(); cycle.required.push(cycle);
  const custom = Object.create(profile());
  const reserved = JSON.parse('{"format":"viento-studio-profile","schemaVersion":1,"required":[],"optional":[],"__proto__":{}}');
  const registry = createStudioModuleRegistry();
  for (const bad of [getter, hook, hidden, symbol, sparse, cycle, custom, reserved]) {
    assert.throws(() => validateStudioProfile(bad), invalid);
    assert.equal(registry.plan(bad).diagnostics[0].code, 'studio_profile_invalid');
  }
  const descriptor = module('example.module', 'example.capability');
  Object.defineProperty(descriptor, 'contributions', { get() { calls++; return []; }, enumerable: true });
  assert.throws(() => createStudioModuleRegistry([descriptor]), invalid);
  assert.equal(calls, 0);
});

test('profile and registry budgets reject excessive declarations instead of dropping requests', () => {
  const bounded = Array.from({ length: 128 }, (_, i) => request(`example.cap${i}`));
  assert.equal(validateStudioProfile(profile(bounded)).required.length, 128);
  assert.throws(() => validateStudioProfile(profile([...bounded, request('example.extra')])), invalid);
  const modules = Array.from({ length: 32 }, (_, i) => module(`example.module${i}`, `example.cap${i}`));
  assert.equal(createStudioModuleRegistry(modules).descriptors().length, 32);
  assert.throws(() => createStudioModuleRegistry([...modules, module('example.extra', 'example.extra')]), invalid);
  assert.throws(() => createStudioModuleRegistry([]), invalid);
  const descriptor = module('example.module', 'example.capability');
  descriptor.contributions = Array.from({ length: 65 }, (_, i) => ({ capability: `example.cap${i}`, apiVersion: 1, domain: 'authoring' }));
  assert.throws(() => validateStudioModuleDescriptor(descriptor), invalid);
});

test('drama scene and custom document types stay document definitions and never infer representation requirements', () => {
  const defaults = { paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' }, documentTypes: [], templates: {} };
  const model = createProjectModel(defaults);
  const manifest = { version: 3, id: '00000000-0000-0000-0000-000000000001', name: '剧本',
    documentTypes: [{ id: 'scene', label: '场', directory: 'scenes', parserProfile: 'prose', template: 'scene.md' },
      { id: 'custom', label: '自定义', directory: 'custom', parserProfile: 'structured' }] };
  const definition = model.resolveDocumentDefinition(manifest, 'documents/scenes/第一场.md');
  assert.equal(definition.documentType, 'scene'); assert.equal(definition.parserProfile, 'prose');
  assert.equal(model.resolveDocumentDefinition(manifest, 'documents/custom/one.md').documentType, 'custom');
  const plan = createStudioModuleRegistry().plan(manifest.studioProfile);
  assert.deepEqual(plan.requests, []); assert.deepEqual(plan.diagnostics, []);
  assert.equal(plan.satisfied, true); assert.equal(cap(plan, 'document.edit').active, true);
  assert.deepEqual(manifest.documentTypes[0], { id: 'scene', label: '场', directory: 'scenes', parserProfile: 'prose', template: 'scene.md' });
});

test('declared future module profiles cannot mutate original author payload or the registered providers', () => {
  const original = { arbitraryAuthorField: { format: 'viento-scene3d', future: true }, studioProfile: profile([request('scene.representation.scene4d')]) };
  const before = clone(original), registry = createStudioModuleRegistry(), result = registry.plan(original.studioProfile);
  assert.deepEqual(original, before); assert.equal(result.requests[0].status, 'missing');
  original.studioProfile.required[0].capability = 'scene.representation.scene2d';
  assert.equal(result.requests[0].capability, 'scene.representation.scene4d');
  assert.equal(registry.plan().modules.length, 12); assert.equal(cap(registry.plan(), 'scene.representation.scene4d'), undefined);
});
