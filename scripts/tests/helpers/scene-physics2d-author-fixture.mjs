import '../../adapters/node-studio-core.mjs';
import { projectAnimationClipsAuthor } from './project-animation-clips-author-fixture.mjs';
import { generateEditableGodotAnimationStateScript } from '../../../engine/animation-state-script-source.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE } from '../../../engine/godot-animation-state-script.mjs';
import { GODOT_PHYSICS_SENSOR_SCRIPT } from '../../../engine/godot-physics-sensor-script.mjs';
const id = n => `70707070-7070-4070-8070-${String(n).padStart(12, '0')}`;

// Disposable complete author project: genuine native sensor -> ordinary author
// event publisher -> existing animation controller -> completion back to idle.
export async function scenePhysics2DAuthor(t, { circle = false, animation = true } = {}) {
  const f = await projectAnimationClipsAuthor(t, { sprites: false });
  const physicsId = id(1), physicsPath = 'documents/physics/scene-0.json';
  const sensorInstanceId = id(2), wallInstanceId = id(3), sensorScriptId = id(4), sensorBindingId = id(5);
  await f.edit('documents/scenes/demo.json', scene => {
    const character = { ...scene.actors[0], position: [100, 180], size: [20, 20], speed: 240, controls: 'arrows' };
    scene.actors = [character, { ...structuredClone(character), instanceId: sensorInstanceId, position: [115, 180], size: [8, 50], color: '#81d9bc80', speed: 0, controls: 'none' },
      { ...structuredClone(character), instanceId: wallInstanceId, position: [150, 180], size: [10, 100], color: '#e9ae76', speed: 0, controls: 'none' }];
  });
  const physics = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: f.sceneIds[0], bodies: [
    { id: id(10), instanceId: f.instanceId, kind: 'character', shape: circle ? { kind: 'circle', radius: 10 } : { kind: 'box', size: [20, 20] }, offset: [0, 0], layer: 1, mask: 1 },
    { id: id(11), instanceId: sensorInstanceId, kind: 'sensor', shape: { kind: 'box', size: [8, 50] }, offset: [0, 0], layer: 2, mask: 1 },
    { id: id(12), instanceId: wallInstanceId, kind: 'static', shape: { kind: 'box', size: [10, 100] }, offset: [0, 0], layer: 1, mask: 1 },
  ] };
  await f.edit('workspace.json', workspace => workspace.documentTypes.push({ id: 'physics', label: '2D Physics / 二维物理', directory: 'physics', parserProfile: 'structured', template: 'physics.json' }));
  await f.write(physicsPath, physics); await f.write('templates/physics.json', physics);
  await f.write(`metadata/documents/${physicsId}.json`, { format: 'viento-document', version: 1, id: physicsId, sourcePath: physicsPath,
    documentType: 'physics', parserProfile: 'structured', relations: [{ kind: 'references', targetId: f.sceneIds[0], slot: '' }], assetBindings: [] });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, record => record.relations.push({ kind: 'references', targetId: physicsId, slot: 'physics2d' }));
  const scriptRecord = await f.read(`metadata/documents/${f.scriptId}.json`);
  await f.write(`metadata/documents/${sensorScriptId}.json`, { ...scriptRecord, id: sensorScriptId, sourcePath: 'documents/scripts/sensor.txt' });
  await f.script('sensor', GODOT_PHYSICS_SENSOR_SCRIPT);
  await f.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', record => record.relations.push({ kind: 'references', targetId: sensorScriptId, slot: 'implementation' }));
  if (animation) {
    const table = structuredClone(DEFAULT_ANIMATION_STATE_TABLE); table.transitions[0].trigger.name = 'physics.entered';
    await f.script('checkpoint', generateEditableGodotAnimationStateScript(table).content);
    await f.edit('documents/animations/scene-0.json', document => { document.clips[1].endSeconds = .65; });
  } else {
    await f.script('checkpoint', 'extends Node\n');
    for (const sceneId of f.sceneIds) await f.edit(`metadata/documents/${sceneId}.json`, record => {
      record.relations = record.relations.filter(relation => relation.kind !== 'animation');
    });
  }
  await f.edit('documents/behaviors/demo.json', document => {
    const controller = document.bindings[0];
    controller.parameters = animation ? { clip_idle: f.clipIds[0][0], clip_action: f.clipIds[0][1] } : {};
    document.bindings.push({ ...structuredClone(controller), bindingId: sensorBindingId, instanceId: sensorInstanceId,
      parameters: {}, implementation: { ...controller.implementation, sourceObjectId: sensorScriptId } });
  });
  return { ...f, physicsId, physicsPath, physics, sensorInstanceId, wallInstanceId, sensorScriptId, sensorBindingId };
}
