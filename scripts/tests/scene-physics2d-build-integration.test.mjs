import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProjectModel } from '../../engine/project.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { createScene2DPlan, scene2DModelToPlan, validateScene2DRegistration } from '../../engine/build-plan.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { createBuildTargetPlan } from '../../engine/build-target.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { SCENE_PHYSICS2D_CAPABILITIES as physicsCapabilities } from '../../engine/scene-physics2d.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { createBackendProjectManifest } from '../adapters/node-backend-project.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

const id = n => `62626262-6262-4262-8262-${String(n).padStart(12, '0')}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const revision = value => `sha256:${digest(value)}`;
const sceneId = id(1), physicsId = id(2), assemblyId = id(3), definitionId = id(4), animationId = id(5);
const instances = [id(11), id(12), id(13)];
const json = value => JSON.stringify(value, null, 2) + '\n';
const invalidBackend = error => error.errorCode === 'build_backend_invalid';
const invalidPhysics = error => error.errorCode === 'build_physics_invalid';
async function fixture({ physics = true, animation = false, schemaVersion = 2 } = {}) {
  const workspace = { format: 'viento-workspace', version: 3, id: id(99), name: 'Physics integration', createdAt: 1,
    documentTypes: [{ id: 'document', label: 'Document', directory: '', parserProfile: 'structured' }] };
  const model = createProjectModel({ paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' }, documentTypes: workspace.documentTypes, templates: {} });
  const definition = model.projectDefinition(workspace);
  const document = (objectId, name, value, relations = []) => {
    const sourcePath = `documents/${name}`, content = typeof value === 'string' ? value : json(value);
    const record = { format: 'viento-document', version: 1, id: objectId, sourcePath, documentType: 'document', parserProfile: 'structured', relations, assetBindings: [] };
    return { record, sourcePath, content, sourceRevision: revision(content), descriptor: model.resolveDocumentDefinition(workspace, sourcePath, record) };
  };
  const declaration = { format: 'viento-scene2d', schemaVersion, title: 'Physics scene', viewport: [640, 480], background: '#182838',
    ...(schemaVersion === 3 ? { groups: [] } : {}), actors: instances.map((instanceId, index) => ({ instanceId, objectId: definitionId,
      position: [40 + index * 90, 100], size: [32, 48], color: '#ffffff', speed: index ? 0 : 80, controls: index ? 'none' : 'arrows' })) };
  const bodyDocument = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: sceneId,
    bodies: instances.map((instanceId, index) => ({ id: id(21 + index), instanceId, kind: ['character', 'static', 'sensor'][index],
      shape: index === 2 ? { kind: 'circle', radius: 25 } : { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 1 })) };
  const scene = document(sceneId, 'scenes/demo.json', declaration, [{ kind: 'references', targetId: definitionId, slot: 'definition' },
    ...(physics ? [{ kind: 'references', targetId: physicsId, slot: 'physics2d' }] : []),
    ...(animation ? [{ kind: 'animation', targetId: animationId, slot: 'animation' }] : [])]);
  const body = document(physicsId, 'physics/demo.json', bodyDocument, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  const assembly = document(assemblyId, 'projects/demo.json', { format: 'viento-project-assembly', schemaVersion: 1, title: 'Physics project', entrySceneId: sceneId, sceneIds: [sceneId] }, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  const animationDocument = document(animationId, 'animations/demo.json', { format: 'viento-scene-animation', schemaVersion: 1,
    sceneObjectId: sceneId, durationSeconds: 2, loop: true, tracks: [{ id: id(31), instanceId: instances[0], property: 'offset2d', interpolation: 'linear',
      keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 2, value: [20, 0] }] }] }, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  const source = { workspace, definition, documents: [document(definitionId, 'actors/traveler.md', '# Traveler\n\nLife: 100\n'), scene, body, assembly, ...(animation ? [animationDocument] : [])], assets: [] };
  const observe = async () => ({ source, projection: await createWorldProjection(source, { digest }) });
  const update = (target, value) => { target.content = typeof value === 'string' ? value : json(value); target.sourceRevision = revision(target.content); };
  const observed = await observe();
  return { ...observed, scene, body, bodyDocument, declaration, animationDocument, observe, update };
}
function descriptor(capabilities = physicsCapabilities) {
  return { format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.synthetic', label: 'Synthetic neutral backend', version: '1.0.0',
    platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 4 }],
    capabilities: ['scene2d', 'input.arrows', 'state.movement', 'project.scenes', ...capabilities],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] };
}
function generated(plan, capabilities = physicsCapabilities) {
  return { files: new Map([['project.godot', Buffer.from('config_version=5\n')], ['physics.json', Buffer.from(json(plan.scenes[0].physics?.document || {}))]]),
    resourceFiles: new Map(), sourceMap: { format: 'viento-project-runtime-map', schemaVersion: 1, behaviors: [] },
    backend: { id: 'org.viento.synthetic', version: '1.0.0', protocolVersion: 4, sha256: digest('synthetic-physics-generator'), capabilities: [...capabilities] },
    artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
}
function project(f) {
  const result = createBuildTargetPlan(f, assemblyId);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.plan;
}

test('unreferenced physics data leaves legacy scene plans and registration byte compatible', async () => {
  const f = await fixture({ physics: false }); f.update(f.body, '{ invalid unrelated physics');
  const observed = await f.observe(), result = createScene2DPlan(observed, sceneId);
  assert.equal(result.ok, true); assert.deepEqual(result.plan, scene2DModelToPlan(resolveScene2DModel(observed, sceneId).model));
  assert.equal(Object.hasOwn(result.plan, 'physics'), false);
  assert.deepEqual(validateScene2DRegistration(observed, sceneId).plan, result.plan);
  assert.equal(Object.hasOwn(project(observed).scenes[0], 'physics'), false);
});

test('saved physics appends after animation and keeps source2/source3 actor identities and visual layout', async () => {
  for (const schemaVersion of [2, 3]) {
    const f = await fixture({ animation: true, schemaVersion }), before = structuredClone(f.source), result = createScene2DPlan(f, sceneId);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.plan.schemaVersion, 2); assert.equal(result.plan.physics.document.sceneObjectId, sceneId);
    assert.equal(result.plan.animation.manifest.objectId, animationId);
    assert.deepEqual(result.plan.physics.document.bodies.map(body => body.instanceId), instances);
    assert.deepEqual(result.plan.actors.map(actor => actor.position), f.declaration.actors.map(actor => actor.position));
    assert.ok(result.plan.requiredCapabilities.indexOf('animation.visual2d') < result.plan.requiredCapabilities.indexOf('physics.bodies2d'));
    assert.deepEqual(f.source, before);
    const registration = validateScene2DRegistration(f, sceneId); assert.equal(registration.ok, true);
    assert.equal(Object.hasOwn(registration.plan, 'physics'), false); assert.equal(Object.hasOwn(registration.plan, 'animation'), false);
  }
});

test('invalid saved physics blocks executable planning with author locations but static registration stays available', async () => {
  const f = await fixture(); f.bodyDocument.bodies[0].instanceId = id(777); f.update(f.body, f.bodyDocument);
  const observed = await f.observe();
  for (const target of [sceneId, assemblyId]) {
    const result = createBuildTargetPlan(observed, target); assert.equal(result.ok, false); assert.equal(result.plan, null);
    assert.ok(result.diagnostics.some(item => item.code === 'build_physics_invalid' && item.objectId === physicsId && item.sourcePath === f.body.sourcePath));
  }
  assert.equal(validateScene2DRegistration(observed, sceneId).ok, true);
});

test('assembly captures detached frozen physics and enforces body membership and declared capability union', async () => {
  const plan = structuredClone(project(await fixture())), frozen = validateProjectAssemblyPlan(plan);
  assert.ok(Object.isFrozen(frozen.scenes[0].physics.document.bodies[0].shape));
  plan.scenes[0].physics.document.bodies[0].shape.size[0] = 64;
  assert.equal(frozen.scenes[0].physics.document.bodies[0].shape.size[0], 32);
  const missingTarget = structuredClone(frozen); missingTarget.scenes[0].physics.document.bodies[0].instanceId = id(999);
  assert.throws(() => validateProjectAssemblyPlan(missingTarget), invalidPhysics);
  const missingCapability = structuredClone(frozen); missingCapability.requiredCapabilities = missingCapability.requiredCapabilities.filter(value => value !== physicsCapabilities[0]);
  assert.throws(() => validateProjectAssemblyPlan(missingCapability), { errorCode: 'build_assembly_invalid' });
  assert.throws(() => validateProjectAssemblyPlan({ ...frozen, physics: frozen.scenes[0].physics }), { errorCode: 'build_assembly_invalid' });
});

test('physical project capability admission recurses into members without forbidding valid assembly children', async () => {
  const plan = project(await fixture());
  assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), []);
  assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: plan.scenes[0] }), []);
  for (const capability of physicsCapabilities) {
    const diagnostics = checkExecutionBackendSupport(descriptor(physicsCapabilities.filter(value => value !== capability)), { operation: 'build', plan });
    assert.ok(diagnostics.some(item => item.code === 'build_capability_missing' && item.capability === capability));
  }
});

test('static-only declarations require only their used capability while selecting a complete physics provider', async () => {
  const f = await fixture(); f.bodyDocument.bodies = [f.bodyDocument.bodies[1]]; f.update(f.body, f.bodyDocument);
  const plan = project(await f.observe());
  assert.deepEqual(plan.requiredCapabilities.filter(value => value.startsWith('physics.')), ['physics.bodies2d']);
  assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), []);
  validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan));
  assert.ok(checkExecutionBackendSupport(descriptor(['physics.bodies2d']), { operation: 'build', plan })
    .some(item => item.code === 'build_capability_missing' && item.capability === 'physics.character2d'));
});

test('physics cannot hide a requirement by omitting it from frozen scene and project capability lists', async () => {
  const original = project(await fixture());
  for (const capability of physicsCapabilities) {
    const plan = structuredClone(original);
    plan.requiredCapabilities = plan.requiredCapabilities.filter(value => value !== capability);
    plan.scenes[0].requiredCapabilities = plan.scenes[0].requiredCapabilities.filter(value => value !== capability);
    const diagnostics = checkExecutionBackendSupport(descriptor(), { operation: 'build', plan });
    assert.ok(diagnostics.some(item => item.code === 'build_physics_invalid' && item.capability === capability));
    const legacy = checkExecutionBackendSupport(descriptor([]), { operation: 'build', plan });
    assert.ok(legacy.some(item => item.code === 'build_capability_missing' && item.capability === capability));
  }
});

test('physics support admission refuses malformed envelopes and accessors without invoking them', async () => {
  const original = project(await fixture()); let calls = 0;
  for (const mutate of [p => p.physics = null, p => p.physics.format = 'physics', p => p.physics.schemaVersion = 2,
    p => p.schemaVersion = 1, p => Object.defineProperty(p, 'physics', { enumerable: true, get() { calls++; return original.scenes[0].physics; } })]) {
    const plan = structuredClone(original.scenes[0]); mutate(plan);
    assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), invalidBackend);
  }
  assert.equal(calls, 0);
  assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: { ...original, physics: original.scenes[0].physics } }), invalidBackend);
});

test('generated physics receipts require capabilities from both registered descriptor and actual producer', async () => {
  const plan = project(await fixture()), output = generated(plan), adapter = { descriptor: descriptor() };
  validateGeneratedExecutionProject(adapter, plan, output);
  for (const capability of physicsCapabilities) {
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(physicsCapabilities.filter(value => value !== capability)) }, plan, output), invalidBackend);
    assert.throws(() => validateGeneratedExecutionProject(adapter, plan, generated(plan, physicsCapabilities.filter(value => value !== capability))), invalidBackend);
  }
  const missing = { ...output, backend: { ...output.backend } }; delete missing.backend.capabilities;
  assert.throws(() => validateGeneratedExecutionProject(adapter, plan, missing), invalidBackend);
  for (const item of [plan, plan.scenes[0]]) {
    const copy = structuredClone(plan), target = item === plan ? copy : copy.scenes[0]; target.requiredCapabilities = target.requiredCapabilities.filter(value => value !== physicsCapabilities[0]);
    assert.throws(() => validateGeneratedExecutionProject(adapter, copy, output), invalidBackend);
  }
});

test('nonphysical generated receipts retain legacy capability-free backend metadata', async () => {
  const plan = project(await fixture({ physics: false })), output = generated(plan); delete output.backend.capabilities;
  assert.equal(validateGeneratedExecutionProject({ descriptor: descriptor([]) }, plan, output).backend.protocolVersion, 4);
  assert.deepEqual(checkExecutionBackendSupport(descriptor([]), { operation: 'build', plan }), []);
});

test('existing portable project manifest retains independent physics author provenance and generated inventory', async () => {
  const f = await fixture(), plan = project(f), output = generated(plan), snapshot = { format: 'viento-build-snapshot', schemaVersion: 1, source: f.source, plan };
  const build = { format: 'viento-build-record', schemaVersion: 1, buildId: id(100), snapshotId: revision(canonicalJson(snapshot)), backend: output.backend,
    tool: { version: '4.7.2', sha256: digest('tool'), platform: 'linux', arch: 'x64' },
    artifact: { ...output.artifact, entry: 'project/project.godot', files: [...output.files].map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes) })) } };
  const manifest = createBackendProjectManifest({ build, snapshot, sourceMap: output.sourceMap, generated: output });
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.source.planSchemaVersion, 1);
  assert.deepEqual(manifest.dependencies.find(item => item.objectId === physicsId), {
    objectId: physicsId, sourcePath: f.body.sourcePath, sourceRevision: f.body.sourceRevision, role: 'author-document' });
  assert.equal(manifest.files.find(item => item.path === 'project/physics.json').role, 'generated');
  assert.equal(manifest.backend.protocolVersion, 4);
});
