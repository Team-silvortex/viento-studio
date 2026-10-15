import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectProjectAssembly, validateProjectAssembly, projectAssemblyDocumentIds, validateProjectAssemblyDependencies } from '../../engine/project-assembly.mjs';
import { createProjectAssemblyPlan, validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { createBuildTargetPlan, buildTargetIdentity, entryScenePlan, scenePlans } from '../../engine/build-target.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const assemblyId = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222';
const revision = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const declaration = () => ({ format: 'viento-project-assembly', schemaVersion: 1, title: '我的游戏 🦊', entrySceneId: otherId, sceneIds: [golden.ids.scene, otherId] });
const encode = value => '\uFEFF' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n');
function fixture() {
  const observed = structuredClone(golden.observed), first = observed.source.documents.find(item => item.record.id === golden.ids.scene);
  const second = structuredClone(first); second.record.id = otherId; second.record.sourcePath = second.sourcePath = 'documents/scenes/other.json';
  const raw = JSON.parse(second.content.replace(/^\uFEFF/, '')); raw.title = 'Second scene'; second.content = encode(raw); second.sourceRevision = revision(second.content);
  observed.source.documents.push(second);
  const object = observed.projection.objects.find(item => item.id === golden.ids.scene);
  observed.projection.objects.push({ ...structuredClone(object), id: otherId });
  observed.projection.relations.push(...observed.projection.relations.filter(item => item.sourceObjectId === golden.ids.scene).map(item => ({ ...item, sourceObjectId: otherId })));
  const content = encode(declaration()), sourcePath = 'documents/scenes/game.json';
  const document = { record: { format: 'viento-document', id: assemblyId, sourcePath, relations: [], assetBindings: [] }, sourcePath, content, sourceRevision: revision(content) };
  observed.source.documents.push(document);
  return { observed, document, first, second };
}
const plan = () => createProjectAssemblyPlan(fixture().observed, assemblyId).plan;

test('assembly declaration is detached, frozen and keyed only by registered scene identities', () => {
  const input = declaration(), result = validateProjectAssembly(input);
  assert.deepEqual(result, input); assert.notEqual(result.sceneIds, input.sceneIds);
  input.sceneIds.reverse(); assert.equal(result.sceneIds[0], golden.ids.scene);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.sceneIds));
  assert.deepEqual(projectAssemblyDocumentIds(result), result.sceneIds);
});

test('assembly rejects unsupported fields, ambiguous identities and invalid entry membership', () => {
  for (const mutate of [value => { value.schemaVersion = 2; }, value => { value.backendId = 'godot'; }, value => { delete value.title; },
    value => { value.title = ' '; }, value => { value.title = '\ud800'; }, value => { value.sceneIds = []; }, value => { value.sceneIds = Array(33).fill(otherId); },
    value => { value.sceneIds[1] = value.sceneIds[0]; }, value => { value.sceneIds[1] = 'path/to/scene'; }, value => { value.entrySceneId = assemblyId; }]) {
    const value = declaration(); mutate(value); assert.throws(() => validateProjectAssembly(value), { errorCode: 'build_assembly_invalid' });
  }
  let getters = 0; const hostile = declaration(); Object.defineProperty(hostile, 'title', { enumerable: true, get() { getters++; return 'bad'; } });
  assert.throws(() => validateProjectAssembly(hostile)); assert.equal(getters, 0);
  const sparse = declaration(); sparse.sceneIds = Array(2); assert.throws(() => validateProjectAssembly(sparse));
});

test('assembly source inspection recognizes escaped and malformed top-level declarations only', () => {
  for (const text of [null, '', '# viento-project-assembly', '{"example":{"format":"viento-project-assembly"}}', '[{"format":"viento-project-assembly"}]']) assert.equal(inspectProjectAssembly(text).recognized, false);
  for (const text of ['{"for\\u006dat":"viento-project-assembly",', JSON.stringify(declaration()).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'), ' '.repeat(32769) + JSON.stringify(declaration())]) {
    const checked = inspectProjectAssembly(text); assert.equal(checked.recognized, true); assert.equal(checked.ok, false);
  }
  assert.equal(inspectProjectAssembly(JSON.stringify(declaration()).replace('"format"', '"for\\u006dat"')).ok, true);
});

test('members come from declaration bytes without duplicate metadata relations', () => {
  const { observed, document, second } = fixture();
  assert.deepEqual(validateProjectAssemblyDependencies(declaration(), document.record, observed.source), []);
  second.content = '{"format":"viento-scene-composition","schemaVersion":1}';
  assert.equal(validateProjectAssemblyDependencies(declaration(), document.record, observed.source)[0].code, 'build_assembly_scene_invalid');
  second.content = null;
  assert.equal(validateProjectAssemblyDependencies(declaration(), document.record, observed.source)[0].code, 'build_assembly_scene_missing');
  const self = { ...declaration(), sceneIds: [assemblyId], entrySceneId: assemblyId };
  assert.equal(validateProjectAssemblyDependencies(self, document.record, observed.source)[0].code, 'build_assembly_scene_missing');
});

test('project plan keeps exact child plans, scene-local identities and one shared resource', () => {
  const { observed } = fixture(), before = structuredClone(observed), result = createProjectAssemblyPlan(observed, assemblyId);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.plan.kind, 'project'); assert.equal(result.plan.schemaVersion, 1);
  assert.equal(result.plan.scene, undefined); assert.equal(result.plan.actors, undefined);
  assert.deepEqual(result.plan.scenes, declaration().sceneIds.map(id => createScene2DPlan(observed, id).plan));
  assert.equal(result.plan.resources.length, 1);
  assert.ok(result.plan.requiredCapabilities.includes('project.scenes'));
  assert.equal(result.plan.scenes[0].actors[0].objectId, result.plan.scenes[1].actors[0].objectId);
  assert.deepEqual(observed, before);
  assert.deepEqual(validateProjectAssemblyPlan(result.plan), result.plan);
});

test('target dispatch preserves legacy plan bytes and separates assembly identity from runtime entry', () => {
  const { observed } = fixture(), project = createBuildTargetPlan(observed, assemblyId).plan;
  assert.deepEqual(createBuildTargetPlan(observed, golden.ids.scene), createScene2DPlan(observed, golden.ids.scene));
  assert.equal(buildTargetIdentity(project).objectId, assemblyId);
  assert.equal(entryScenePlan(project).scene.objectId, otherId);
  assert.equal(scenePlans(project).length, 2);
  const legacy = createBuildTargetPlan(observed, golden.ids.scene).plan;
  assert.equal(buildTargetIdentity(legacy), legacy.scene); assert.equal(entryScenePlan(legacy), legacy); assert.deepEqual(scenePlans(legacy), [legacy]);
});

test('member errors retain their own source and assembly errors retain exact source ranges', () => {
  const { observed, document, second } = fixture();
  const value = JSON.parse(second.content.replace(/^\uFEFF/, '')); value.actors[0].position = ['bad', 0]; second.content = encode(value); second.sourceRevision = revision(second.content);
  let result = createProjectAssemblyPlan(observed, assemblyId);
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.objectId === otherId && item.propertyPath === '/actors/0/position'));
  document.content = encode({ ...declaration(), entrySceneId: assemblyId });
  result = createProjectAssemblyPlan(observed, assemblyId);
  assert.equal(result.diagnostics[0].objectId, assemblyId); assert.equal(result.diagnostics[0].propertyPath, '/entrySceneId');
  assert.equal(document.content.slice(result.diagnostics[0].sourceRange.start, result.diagnostics[0].sourceRange.end), JSON.stringify(assemblyId));
});

test('project plan admission rejects hidden resources, member drift, invented fields and accessors', () => {
  for (const mutate of [value => { value.scene = value.scenes[0].scene; }, value => { value.entrySceneId = assemblyId; },
    value => { value.resources = []; }, value => { value.requiredCapabilities = ['project.scenes']; }, value => { value.scenes[1].worldRevision = 'sha256:' + '0'.repeat(64); },
    value => { value.scenes[1].scene.objectId = value.scenes[0].scene.objectId; }, value => { value.scenes[1].resources[0].sha256 = '0'.repeat(64); }]) {
    const input = plan(); mutate(input); assert.throws(() => validateProjectAssemblyPlan(input), { errorCode: 'build_assembly_invalid' });
  }
  let getters = 0; const input = plan(); Object.defineProperty(input.assembly, 'title', { enumerable: true, get() { getters++; return 'bad'; } });
  assert.throws(() => validateProjectAssemblyPlan(input)); assert.equal(getters, 0);
});

const descriptor = value => ({ format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.example', label: 'Example', version: '1.0.0', platforms: ['linux'],
  plans: [{ kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }],
  capabilities: value.requiredCapabilities, execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });

test('backend project admission checks explicit support and every member implementation', () => {
  const value = plan(), backend = descriptor(value);
  assert.deepEqual(checkExecutionBackendSupport(backend, { operation: 'build', plan: value }), []);
  backend.plans = backend.plans.filter(item => item.kind !== 'project');
  assert.ok(checkExecutionBackendSupport(backend, { operation: 'build', plan: value }).some(item => item.code === 'build_backend_plan_unsupported' && item.objectId === assemblyId));
  backend.plans = descriptor(value).plans;
  value.scenes[1].behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: 'org.other.backend', language: 'rust' };
  assert.ok(checkExecutionBackendSupport(backend, { operation: 'build', plan: value }).some(item => item.code === 'build_behavior_backend_unsupported' && item.objectId === otherId));
  delete value.scenes[1].behaviors; value.requiredCapabilities = value.requiredCapabilities.filter(item => item !== 'image');
  assert.ok(checkExecutionBackendSupport(backend, { operation: 'build', plan: value }).some(item => item.code === 'build_assembly_invalid' && item.capability === 'image'));
});
