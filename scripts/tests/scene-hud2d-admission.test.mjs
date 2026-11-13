import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { assertBackendOperation, validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';
import { sceneHUD2DFixture, hudDigest, hudId } from './helpers/scene-hud2d-fixture.mjs';
const capability = 'scene.hud2d', invalid = { errorCode: 'build_backend_invalid' };
const descriptor = (hud = true) => ({ format: 'viento-execution-backend', schemaVersion: 1,
  id: 'org.viento.hud-test', label: 'HUD neutral fixture', version: '1.0.0', platforms: ['linux'],
  plans: [1, 2, 3].map(schemaVersion => ({ kind: 'scene2d', schemaVersion, runtimeProtocolVersion: schemaVersion })).concat([{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 4 }]),
  capabilities: ['scene2d', 'input.arrows', 'state.movement', 'project.scenes', ...(hud ? [capability] : [])],
  execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
function generated(plan, hud = true) {
  return { files: new Map([['project.godot', Buffer.from('config_version=5\n')]]), resourceFiles: new Map(), sourceMap: {},
    backend: { id: descriptor().id, version: '1.0.0', protocolVersion: plan.kind === 'project' ? 4 : plan.schemaVersion,
      sha256: hudDigest('neutral-hud-fixture'), capabilities: hud ? [capability] : [] },
    artifact: { kind: 'godot-project', entry: 'project.godot', requiresTool: true } };
}
async function plans(schemaVersion = 2, enabled = true) {
  const f = await sceneHUD2DFixture({ schemaVersion, enabled }), scene = createScene2DPlan(f, f.sceneId), project = createProjectAssemblyPlan(f, f.assemblyId);
  assert.equal(scene.ok, true, JSON.stringify(scene.diagnostics)); assert.equal(project.ok, true, JSON.stringify(project.diagnostics)); return [scene.plan, project.plan];
}
for (const schemaVersion of [1, 2, 3]) test(`neutral HUD support admits Scene2D author ${schemaVersion} standalone and assembled plans without actor targets`, async () => {
  for (const plan of await plans(schemaVersion)) {
    const scene = plan.kind === 'project' ? plan.scenes[0] : plan;
    assert.equal(Object.hasOwn(scene.hud2d.document, 'actors'), false); assert.equal(Object.hasOwn(scene.hud2d.document, 'targetInstanceId'), false);
    assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', platform: 'linux', plan }), []);
    assert.doesNotThrow(() => assertBackendOperation({ descriptor: descriptor() }, 'headlessLogic', plan));
    assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)));
  }
});
test('a scene plan 3 HUD has no independent stable-target requirement', async () => {
  const [plan] = await plans(); plan.schemaVersion = 3;
  assert.deepEqual(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), []);
  assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)));
});
test('provider and actual producer must each declare HUD capability', async () => {
  for (const plan of await plans()) {
    assert.ok(checkExecutionBackendSupport(descriptor(false), { operation: 'build', plan }).some(error => error.code === 'build_capability_missing' && error.capability === capability));
    assert.throws(() => assertBackendOperation({ descriptor: descriptor(false) }, 'headlessLogic', plan), { errorCode: 'build_capability_missing' });
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(false) }, plan, generated(plan)), invalid);
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan, false)), invalid);
    const absent = generated(plan); delete absent.backend.capabilities;
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, absent), invalid);
  }
});
test('omitted standalone, member and union flags cannot downgrade an explicit HUD declaration', async () => {
  const [scene, project] = await plans();
  for (const mode of ['standalone', 'member', 'union', 'both']) for (const supported of [false, true]) {
    const plan = structuredClone(mode === 'standalone' ? scene : project);
    if (mode !== 'member') plan.requiredCapabilities = plan.requiredCapabilities.filter(value => value !== capability);
    if (mode === 'member' || mode === 'both') plan.scenes[0].requiredCapabilities = plan.scenes[0].requiredCapabilities.filter(value => value !== capability);
    const errors = checkExecutionBackendSupport(descriptor(supported), { operation: 'build', plan });
    assert.ok(errors.some(error => error.code === (mode === 'union' ? 'build_assembly_invalid' : 'build_hud2d_invalid') && error.capability === capability), mode);
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor(supported) }, plan, generated(plan)), invalid, mode);
  }
});
test('capability labels cannot admit wrong scene ownership, invalid label/bar geometry or content', async () => {
  for (const original of await plans()) for (const change of [hud => { hud.document.sceneObjectId = hudId(777); },
    hud => { hud.document.elements[0].fontSize = 0; }, hud => { hud.document.elements[1].min = hud.document.elements[1].max; },
    hud => { hud.document.elements[0].anchor = 'world'; }, hud => { hud.document.elements[0].content.key = '__proto__'; },
    hud => { hud.document.elements.push(hud.document.elements[0]); }]) {
    const plan = structuredClone(original); change((plan.kind === 'project' ? plan.scenes[0] : plan).hud2d);
    assert.ok(checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }).some(error => error.code === 'build_hud2d_invalid'));
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)), invalid);
  }
});
test('malformed/misplaced HUD envelopes and executable accessors fail without invocation', async () => {
  const [scene, project] = await plans(); let calls = 0;
  for (const mutate of [value => { value.hud2d = null; }, value => { value.hud2d.format = 'other'; }, value => { value.hud2d.schemaVersion = 2; },
    value => Object.defineProperty(value, 'hud2d', { enumerable: true, get() { calls++; return scene.hud2d; } })]) {
    const plan = structuredClone(scene); mutate(plan);
    assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), invalid);
    assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, plan, generated(plan)), invalid);
  }
  const field = structuredClone(scene); Object.defineProperty(field.hud2d.document.elements[0], 'content', { enumerable: true, get() { calls++; return scene.hud2d.document.elements[0].content; } });
  assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: field }), invalid);
  assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, field, generated(field)), invalid);
  const misplaced = { ...project, hud2d: scene.hud2d };
  assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan: misplaced }), invalid);
  assert.throws(() => validateGeneratedExecutionProject({ descriptor: descriptor() }, misplaced, generated(misplaced)), invalid); assert.equal(calls, 0);
});
test('non-finite HUD fields fail at request capture and noHUD retains legacy receipts', async () => {
  for (const original of await plans()) {
    const plan = structuredClone(original); (plan.kind === 'project' ? plan.scenes[0] : plan).hud2d.document.elements[1].fallback = Infinity;
    assert.throws(() => checkExecutionBackendSupport(descriptor(), { operation: 'build', plan }), invalid);
  }
  for (const version of [1, 2, 3]) for (const plan of await plans(version, false)) {
    const output = generated(plan, false); delete output.backend.capabilities;
    assert.deepEqual(checkExecutionBackendSupport(descriptor(false), { operation: 'build', plan }), []);
    assert.doesNotThrow(() => validateGeneratedExecutionProject({ descriptor: descriptor(false) }, plan, output));
  }
});
