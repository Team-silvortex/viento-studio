import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {
  EXECUTION_BACKEND_DESCRIPTOR_SCHEMA_VERSION, validateExecutionBackendDescriptor,
  checkExecutionBackendSupport, canExecuteBackend,
} from '../../engine/backend-capabilities.mjs';

const operations = ['build', 'headlessLogic', 'windowPreview', 'windowCapture', 'offscreenRender', 'embeddedViewport', 'gpuCompute'];
const descriptor = () => ({
  format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.godot4', label: 'Godot 4', version: '0.2.0',
  platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }],
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image'],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false },
  extensions: [],
});
const plan = () => ({ format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d',
  scene: { objectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourcePath: 'documents/scenes/demo.json', viewport: [640, 480] },
  requiredCapabilities: ['scene2d', 'input.arrows', 'image'], actors: [], resources: [] });
const isInvalid = error => error instanceof TypeError && error.errorCode === 'build_backend_invalid';
const reject = value => assert.throws(() => validateExecutionBackendDescriptor(value), isInvalid);

test('backend descriptors detach and recursively freeze every admitted field', () => {
  const original = descriptor();
  original.extensions = [{ id: 'org.viento.godot4.native.nuislang', version: '0.0.1' }];
  const value = validateExecutionBackendDescriptor(original);
  assert.deepEqual(value, original);
  assert.notEqual(value, original);
  assert.equal(EXECUTION_BACKEND_DESCRIPTOR_SCHEMA_VERSION, 1);
  for (const field of ['platforms', 'plans', 'capabilities', 'execution', 'extensions']) {
    assert.notEqual(value[field], original[field]); assert.equal(Object.isFrozen(value[field]), true);
  }
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.plans[0]), true);
  assert.equal(Object.isFrozen(value.extensions[0]), true);
  original.label = 'Changed'; original.execution.build = false; original.plans[0].runtimeProtocolVersion = 2;
  original.platforms.push('android'); original.extensions[0].id = 'elsewhere.native';
  assert.equal(value.label, 'Godot 4'); assert.equal(value.execution.build, true);
  assert.equal(value.plans[0].runtimeProtocolVersion, 1); assert.deepEqual(value.platforms, ['linux']);
  assert.equal(value.extensions[0].id, 'org.viento.godot4.native.nuislang');
  assert.throws(() => { value.execution.build = false; }, TypeError);
});

test('descriptor schema rejects unknown, missing and host implementation fields', () => {
  for (const key of Object.keys(descriptor())) {
    const value = descriptor(); delete value[key]; reject(value);
  }
  for (const key of ['protocolVersion', 'runtimeProtocolVersion', 'artifactKind', 'executable', 'generate', 'path']) {
    reject({ ...descriptor(), [key]: key === 'generate' ? () => {} : 'outside' });
  }
  reject({ ...descriptor(), format: 'viento-backend' });
  reject({ ...descriptor(), schemaVersion: 2 });
  reject({ ...descriptor(), schemaVersion: '1' });
});

test('identities, versions and lists remain bounded unique descriptor data', () => {
  for (const id of ['godot4', 'org..godot4', '/org/viento', 'org.viento.Godot4', 'org.viento.godot4\0', 'x'.repeat(200)]) reject({ ...descriptor(), id });
  for (const version of ['0.2', 'v0.2.0', '00.2.0', '0.2.0-beta', '0.2.0+local', '9'.repeat(40) + '.0.0']) reject({ ...descriptor(), version });
  for (const platforms of [['linux', 'linux'], ['Linux'], [null], ['../linux'], Array(33).fill('linux')]) reject({ ...descriptor(), platforms });
  for (const capabilities of [['scene2d', 'scene2d'], ['scene2d/image'], [false], Array(129).fill('scene2d')]) reject({ ...descriptor(), capabilities });
  for (const label of ['', ' ', 'name\ncommand', 'x'.repeat(257)]) reject({ ...descriptor(), label });
  assert.equal(validateExecutionBackendDescriptor({ ...descriptor(), label: '原生后端 / Native backend', version: '12.0.105', platforms: ['linux', 'android'] }).version, '12.0.105');
});

test('plan schemas and runtime protocol schemas are explicit separate declarations', () => {
  const value = descriptor(); value.plans = [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 2 }];
  assert.equal(validateExecutionBackendDescriptor(value).plans[0].runtimeProtocolVersion, 2);
  assert.deepEqual(checkExecutionBackendSupport(value, { operation: 'build', plan: { ...plan(), schemaVersion: 1 } }), []);
  for (const invalidPlan of [
    { kind: 'scene2d', schemaVersion: 1 },
    { kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 4 },
    { kind: 'scene3d', schemaVersion: 1, runtimeProtocolVersion: 1 },
    { kind: 'scene2d', schemaVersion: 4, runtimeProtocolVersion: 1 },
    { kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1, extension: 'extra' },
  ]) reject({ ...descriptor(), plans: [invalidPlan] });
  reject({ ...descriptor(), plans: [value.plans[0], { ...value.plans[0], runtimeProtocolVersion: 1 }] });
});

test('execution operations require seven explicit booleans without support inference', () => {
  for (const operation of operations) {
    const missing = descriptor(); delete missing.execution[operation]; reject(missing);
    for (const value of [undefined, null, 0, 1, 'true']) reject({ ...descriptor(), execution: { ...descriptor().execution, [operation]: value } });
  }
  reject({ ...descriptor(), execution: { ...descriptor().execution, stream: true } });
  reject({ ...descriptor(), execution: { ...descriptor().execution, windowPreview: false } });
  const value = descriptor();
  value.execution = Object.fromEntries(operations.map(operation => [operation, operation === 'headlessLogic']));
  for (const operation of operations) {
    const diagnostics = checkExecutionBackendSupport(value, { operation });
    assert.equal(diagnostics.length, operation === 'headlessLogic' ? 0 : 1, operation);
    if (diagnostics.length) assert.equal(diagnostics[0].code, 'build_execution_unsupported');
  }
});

test('namespaced native extension metadata never implies runtime or GPU support', () => {
  const value = descriptor();
  value.extensions = [{ id: 'org.viento.godot4.native.nuislang', version: '0.0.1' }];
  const admitted = validateExecutionBackendDescriptor(value);
  assert.deepEqual(admitted.extensions, value.extensions);
  for (const operation of ['offscreenRender', 'embeddedViewport', 'gpuCompute']) assert.equal(canExecuteBackend(admitted, operation), false);
  for (const extension of [
    { id: 'org.viento.bevy.native', version: '0.0.1' },
    { id: 'org.viento.godot4', version: '0.0.1' },
    { id: 'org.viento.godot40.native', version: '0.0.1' },
    { id: 'org.viento.godot4.native', version: '0.0.1', path: '/bin/engine' },
    { id: 'org.viento.godot4.native', version: '0.0.1', execute() {} },
    { id: 'org.viento.godot4.native', version: 'development' },
  ]) reject({ ...descriptor(), extensions: [extension] });
  reject({ ...value, extensions: [value.extensions[0], { ...value.extensions[0] }] });
});

test('descriptor admission refuses accessors and inherited authority before getters run', () => {
  let calls = 0;
  const accessor = descriptor(); Object.defineProperty(accessor, 'label', { enumerable: true, get() { calls++; return 'label'; } }); reject(accessor);
  const nested = descriptor(); Object.defineProperty(nested.execution, 'gpuCompute', { enumerable: true, get() { calls++; return true; } }); reject(nested);
  const inherited = Object.assign(Object.create({ get hostile() { calls++; return true; } }), descriptor()); reject(inherited);
  const propertyPrototype = descriptor(); Object.defineProperty(propertyPrototype, '__proto__', { enumerable: true, value: {} }); reject(propertyPrototype);
  const symbol = descriptor(); symbol[Symbol('secret')] = true; reject(symbol);
  const hidden = descriptor(); Object.defineProperty(hidden, 'hidden', { value: true }); reject(hidden);
  const hiddenLength = descriptor(); Object.defineProperty(hiddenLength.execution, 'length', { value: 0 }); reject(hiddenLength);
  assert.equal(calls, 0);
});

test('nonserializable, cyclic, sparse, overdeep and oversized DTOs fail closed', () => {
  for (const value of [null, undefined, [], 1, 'descriptor', new Map(), new Date()]) reject(value);
  const cyclic = descriptor(); cyclic.extensions.push(cyclic); reject(cyclic);
  const sparse = descriptor(); sparse.capabilities = Array(1); reject(sparse);
  const arrayProperty = descriptor(); arrayProperty.platforms.extra = true; reject(arrayProperty);
  const arrayPrototype = descriptor(); Object.setPrototypeOf(arrayPrototype.platforms, null); reject(arrayPrototype);
  const nondata = descriptor(); nondata.label = Symbol('label'); reject(nondata);
  const notFinite = descriptor(); notFinite.schemaVersion = NaN; reject(notFinite);
  const overdeep = descriptor(); let nested = overdeep; for (let index = 0; index < 34; index++) nested = nested.extra = {}; reject(overdeep);
  reject({ ...descriptor(), label: 'x'.repeat(65537) });
  const nullPrototype = Object.assign(Object.create(null), descriptor());
  assert.deepEqual(validateExecutionBackendDescriptor(nullPrototype), descriptor());
});

test('support checks admit known plans and platforms with or without optional plan data', () => {
  for (const schemaVersion of [1, 2]) assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', platform: 'linux', plan: { ...plan(), schemaVersion } }), []);
  assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'windowPreview' }), []);
  assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'windowCapture', platform: 'linux' }), []);
  assert.equal(checkExecutionBackendSupport(descriptor(), { operation: 'build', platform: 'android' })[0].code, 'build_platform_unsupported');
  assert.equal(checkExecutionBackendSupport(descriptor(), {})[0].code, 'build_execution_unsupported');
  assert.equal(checkExecutionBackendSupport(descriptor())[0].code, 'build_execution_unsupported');
});

test('unsupported plan format, kind and schema diagnose source without choosing a fallback', () => {
  for (const changed of [{ format: 'another-plan' }, { kind: 'scene3d' }, { schemaVersion: 3 }]) {
    const diagnostics = checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: { ...plan(), ...changed } });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, 'build_backend_plan_unsupported');
    assert.equal(diagnostics[0].objectId, plan().scene.objectId);
    assert.equal(diagnostics[0].sourcePath, plan().scene.sourcePath);
    assert.equal(diagnostics[0].propertyPath, '');
  }
  assert.equal(checkExecutionBackendSupport({ ...descriptor(), plans: [] }, { operation: 'build', plan: plan() })[0].code, 'build_backend_plan_unsupported');
});

test('missing feature diagnostics retain the scene source and original capability order', () => {
  const value = descriptor(); value.capabilities = ['scene2d'];
  const input = plan();
  const diagnostics = checkExecutionBackendSupport(value, { operation: 'build', plan: input });
  assert.deepEqual(diagnostics, ['input.arrows', 'image'].map(capability => ({ severity: 'error', code: 'build_capability_missing',
    message: `Backend lacks capability: ${capability}`, objectId: input.scene.objectId, sourcePath: input.scene.sourcePath, propertyPath: '', capability })));
  assert.deepEqual(input, plan());
  diagnostics[0].sourcePath = 'other';
  assert.equal(input.scene.sourcePath, plan().scene.sourcePath);
});

test('all execution, platform, plan and capability rejections remain independently visible', () => {
  const value = descriptor(); value.capabilities = [];
  const diagnostics = checkExecutionBackendSupport(value, { operation: 'gpuCompute', platform: 'android', plan: { ...plan(), schemaVersion: 3 } });
  assert.deepEqual(diagnostics.map(item => item.code), ['build_execution_unsupported', 'build_platform_unsupported', 'build_backend_plan_unsupported',
    'build_capability_missing', 'build_capability_missing', 'build_capability_missing']);
  assert.equal(diagnostics.every(item => item.objectId === plan().scene.objectId && item.sourcePath === plan().scene.sourcePath && item.propertyPath === ''), true);
});

test('malformed support requests and plan DTOs cannot bypass validation', () => {
  for (const request of [null, [], { operation: 'run' }, { operation: undefined }, { operation: 'build', platform: '../linux' },
    { operation: 'build', plan: null }, { operation: 'build', unknown: true }, { operation: 'build', platform: '' }]) {
    assert.throws(() => checkExecutionBackendSupport(descriptor(), request), isInvalid);
  }
  for (const changed of [{ format: '' }, { schemaVersion: 0 }, { schemaVersion: '1' }, { kind: undefined }, { requiredCapabilities: undefined },
    { requiredCapabilities: ['image', 'image'] }, { requiredCapabilities: ['image/command'] }, { scene: { objectId: '', sourcePath: 'document' } },
    { scene: { objectId: 'scene', sourcePath: '' } }, { actors: [() => true] }]) {
    assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: { ...plan(), ...changed } }), isInvalid);
  }
  let calls = 0;
  const request = { operation: 'build' }; Object.defineProperty(request, 'plan', { enumerable: true, get() { calls++; return plan(); } });
  assert.throws(() => checkExecutionBackendSupport(descriptor(), request), isInvalid);
  const value = plan(); Object.defineProperty(value.scene, 'sourcePath', { enumerable: true, get() { calls++; return 'elsewhere'; } });
  assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: value }), isInvalid);
  assert.equal(calls, 0);
});

test('UI support convenience is explicit, operation-specific and fail closed', () => {
  for (const operation of operations) assert.equal(canExecuteBackend(descriptor(), operation), descriptor().execution[operation], operation);
  assert.equal(canExecuteBackend(descriptor(), 'build', 'linux'), true);
  assert.equal(canExecuteBackend(descriptor(), 'build', 'android'), false);
  assert.equal(canExecuteBackend(null, 'build'), false);
  assert.equal(canExecuteBackend(undefined, 'build'), false);
  assert.equal(canExecuteBackend({ execution: { build: true } }, 'build'), false);
  assert.equal(canExecuteBackend(descriptor(), 'run'), false);
  assert.equal(canExecuteBackend(descriptor()), false);
  assert.equal(canExecuteBackend(descriptor(), 'build', {}), false);
  assert.equal(canExecuteBackend({ ...descriptor(), schemaVersion: 10 }, 'build'), false);
});

test('portable middleware executes in an isolated JavaScript realm without host globals', async () => {
  const source = await fs.readFile(new URL('../../engine/backend-capabilities.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gmu, ''), /(?:from\s+['"]node:|\b(?:process|Buffer|document|window)\b)/u);
  const context = vm.createContext({});
  vm.runInContext(`${source.replaceAll('export ', '')}\nglobalThis.backendApi = {validateExecutionBackendDescriptor, checkExecutionBackendSupport, canExecuteBackend};`, context);
  assert.equal(vm.runInContext('typeof process + ":" + typeof Buffer + ":" + typeof document + ":" + typeof window', context), 'undefined:undefined:undefined:undefined');
  const result = vm.runInContext(`
    const input = ${JSON.stringify(descriptor())};
    const scenePlan = ${JSON.stringify(plan())};
    const frozen = backendApi.validateExecutionBackendDescriptor(input);
    input.execution.windowPreview = false;
    JSON.stringify({frozen: Object.isFrozen(frozen.execution), preserved: frozen.execution.windowPreview,
      supported: backendApi.checkExecutionBackendSupport(frozen, {operation:'build', platform:'linux', plan:scenePlan}),
      offscreen: backendApi.canExecuteBackend(frozen, 'offscreenRender'), unknown: backendApi.canExecuteBackend(null, 'build')});
  `, context);
  assert.deepEqual(JSON.parse(result), { frozen: true, preserved: true, supported: [], offscreen: false, unknown: false });
});
