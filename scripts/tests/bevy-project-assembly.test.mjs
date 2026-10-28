import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { generateBevyAssemblyProject } from '../backends/bevy-project-assembly.mjs';
import { generateBevyProject } from '../backends/bevy-project.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url), 'utf8')).plan;
function plan() {
  const first = structuredClone(fixture);
  first.resources = [];
  first.requiredCapabilities = first.requiredCapabilities.filter(x => x !== 'image');
  for (const actor of first.actors) delete actor.imageResourceId;
  const second = structuredClone(first);
  second.scene.objectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  second.scene.sourcePath = 'documents/scenes/second.json';
  second.scene.title = 'Second scene';
  second.actors[0].position = [42, 50];
  return { format: 'viento-build-plan', kind: 'project', schemaVersion: 1,
    projectId: first.projectId, worldId: first.worldId, worldRevision: first.worldRevision,
    assembly: { objectId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', sourcePath: 'documents/projects/game.json',
      sourceRevision: 'sha256:' + '1'.repeat(64), title: 'Game' },
    entrySceneId: second.scene.objectId, scenes: [first, second], resources: [],
    requiredCapabilities: [...new Set(['project.scenes', ...first.requiredCapabilities])].sort() };
}

test('Bevy assembly retains all scenes and explicitly selects the entry without leaking author paths into runtime data', async () => {
  const input = plan(), original = structuredClone(input), output = await generateBevyAssemblyProject(input);
  assert.deepEqual(input, original);
  const manifest = JSON.parse(output.files.get('assembly.json'));
  assert.equal(manifest.entrySceneId, input.scenes[1].scene.objectId);
  assert.deepEqual(manifest.scenes.map(x => x.sceneId), input.scenes.map(x => x.scene.objectId));
  for (const [index, scene] of manifest.scenes.entries()) {
    assert.equal(scene.entry, `scenes/${scene.sceneId}/scene-data.json`);
    const generated = JSON.parse(output.files.get(scene.entry));
    assert.equal(generated.scene.objectId, scene.sceneId);
    assert.deepEqual(generated.actors[0].position, input.scenes[index].actors[0].position);
    assert.equal(output.sourceMap.scenes[index].sourceMap.objects[0].sourcePath, input.scenes[index].actors[0].sourcePath);
  }
  assert.deepEqual(output.files.get('scene-data.json'), output.files.get(manifest.scenes[1].entry));
  assert.doesNotMatch(output.files.get('assembly.json').toString(), /sourcePath|sourceRevision/);
  assert.equal(output.sourceMap.assembly.sourcePath, input.assembly.sourcePath);
  assert.equal(output.backend.protocolVersion, 1);
  assert.ok(output.backend.capabilities.includes('runtime.control-replay'));
  assert.ok(output.backend.capabilities.includes('project.control-replay'));
  assert.ok(output.backend.capabilities.includes('runtime.control-replay.instances'));
  const standalone = await generateBevyProject(input.scenes[0]);
  assert.ok(standalone.backend.capabilities.includes('runtime.control-replay'));
  assert.ok(standalone.backend.capabilities.includes('runtime.control-replay.instances'));
  assert.deepEqual(output.artifact, { kind: 'bevy-scene', entry: 'scene-data.json', requiresTool: true });
  assert.equal(output.resourceFiles.size, 0);
});

test('unsupported scene content is rejected even when capability declarations are stripped', async () => {
  for (const [field, value, capability] of [
    ['behaviors', {}, 'behavior.bindings'], ['audio', {}, 'audio.nonspatial'],
    ['animation', {}, 'animation.visual2d'], ['physics', {}, 'physics.bodies2d'],
  ]) {
    const input = plan(); input.scenes[1][field] = value;
    await assert.rejects(generateBevyAssemblyProject(input), error =>
      error.errorCode === 'build_capability_missing' && error.capability === capability
      || error.errorCode === 'build_assembly_invalid' || error.errorCode === 'build_animation_invalid' || error.errorCode === 'build_physics_invalid');
  }
  const image = plan(); image.scenes[1].actors[0].imageResourceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await assert.rejects(generateBevyAssemblyProject(image), { errorCode: 'build_capability_missing' });
  const unknown = plan(); unknown.scenes[1].futureFeature = { enabled: true };
  await assert.rejects(generateBevyAssemblyProject(unknown), { errorCode: 'build_backend_plan_invalid' });
  const actorUnknown = plan(); actorUnknown.scenes[1].actors[0].futureFeature = true;
  await assert.rejects(generateBevyAssemblyProject(actorUnknown), { errorCode: 'build_backend_plan_invalid' });
  const sceneUnknown = plan(); sceneUnknown.scenes[1].scene.futureFeature = true;
  await assert.rejects(generateBevyAssemblyProject(sceneUnknown), { errorCode: 'build_backend_plan_invalid' });
  const bad = plan(); bad.scenes[1].actors[0].speed = -1;
  await assert.rejects(generateBevyAssemblyProject(bad), { errorCode: 'build_backend_plan_invalid' });
  const capability = plan(); capability.scenes[1].requiredCapabilities.push('gpu.compute');
  capability.requiredCapabilities.push('gpu.compute'); capability.requiredCapabilities.sort();
  await assert.rejects(generateBevyAssemblyProject(capability), { errorCode: 'build_capability_missing', capability: 'gpu.compute' });
});

test('project schema 2 input mappings are refused even for otherwise supported scenes', async () => {
  const input = plan(); input.schemaVersion = 2;
  input.inputMap = { objectId: '33333333-3333-4333-8333-333333333333', sourcePath: 'documents/projects/input.json',
    sourceRevision: 'sha256:' + '2'.repeat(64), document: { format: 'viento-input-map', schemaVersion: 1,
      actions: [{ name: 'move_left', keys: ['KeyA'] }] } };
  input.requiredCapabilities.push('project.input-map'); input.requiredCapabilities.sort();
  await assert.rejects(generateBevyAssemblyProject(input), { errorCode: 'build_capability_missing', capability: 'project.input-map' });
});

test('invalid entry, duplicate scene ids, and conflicting input plan are rejected before generation', async () => {
  for (const mutate of [
    input => { input.entrySceneId = input.assembly.objectId; },
    input => { input.scenes[1].scene.objectId = input.scenes[0].scene.objectId; },
    input => { input.requiredCapabilities = ['project.scenes']; },
  ]) { const input = plan(); mutate(input); await assert.rejects(generateBevyAssemblyProject(input)); }
});


test('a project may preserve both supported scene schema versions', async () => {
  const input = plan(), legacy = input.scenes[0];
  legacy.schemaVersion = 1;
  for (const [index, actor] of legacy.actors.entries()) {
    delete actor.instanceId;
    if (index) actor.objectId = 'abababab-abab-4bab-8bab-abababababab';
  }
  const output = await generateBevyAssemblyProject(input);
  assert.equal(JSON.parse(output.files.get(`scenes/${legacy.scene.objectId}/scene-data.json`)).schemaVersion, 1);
  assert.equal(JSON.parse(output.files.get('scene-data.json')).schemaVersion, 2);
  assert.ok(!output.backend.capabilities.includes('project.scene-switching'));
});
