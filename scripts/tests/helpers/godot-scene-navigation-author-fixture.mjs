import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSceneSwitchingAuthor } from './project-scene-switching-fixture.mjs';
import { runtimeId } from './project-runtime-fixture.mjs';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT, GODOT_EVENT_SCENE_SWITCH_SCRIPT } from '../../../engine/godot-scene-navigation-scripts.mjs';
// Three registered author scenes, ordinary TXT behavior files and the existing
// input-map/HUD documents. No generated runtime source is edited by this fixture.
export async function godotSceneNavigationAuthor(t) {
  const f = await projectSceneSwitchingAuthor(t, { mode: 'no-switch' });
  const read = async name => JSON.parse(await fs.readFile(path.join(f.author, name))), write = async (name, value) => { await fs.mkdir(path.dirname(path.join(f.author, name)), { recursive: true }); await fs.writeFile(path.join(f.author, name), JSON.stringify(value, null, 2) + '\n'); };
  const thirdId = runtimeId(901), thirdManifestId = runtimeId(902), thirdScriptId = runtimeId(903), thirdBindingId = runtimeId(904), publisherScriptId = runtimeId(905), publisherBindingId = runtimeId(906), inputMapId = runtimeId(907);
  const sceneIds = [...f.sceneIds, thirdId], firstManifest = await read('documents/behaviors/demo.json'); firstManifest.bindings = firstManifest.bindings.slice(0, 1);
  firstManifest.bindings[0].parameters = { action_name: 'menu_start', target_scene_id: sceneIds[1] }; await write('documents/behaviors/demo.json', firstManifest);
  await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), GODOT_ACTION_SCENE_SWITCH_SCRIPT);
  await fs.writeFile(path.join(f.author, 'documents/scripts/second.txt'), GODOT_EVENT_SCENE_SWITCH_SCRIPT);
  const secondManifest = await read('documents/behaviors/second.json'); secondManifest.bindings[0].parameters = { event_name: 'game.complete', target_scene_id: thirdId, payload_filter: 'win' };
  const publisherSource = `extends Node
var project
func _ready() -> void:
\tproject = get_meta("viento_project")
func _unhandled_input(event: InputEvent) -> void:
\tif event.is_action_pressed("game_complete", false):
\t\t# The filter ignores the first two payloads. Both matching publications
\t\t# are delivered in the same FIFO batch; only the first requests a switch.
\t\tproject.publish_event("game.complete", false)
\t\tproject.publish_event("game.complete", "lose")
\t\tproject.publish_event("game.complete", "win")
\t\tproject.publish_event("game.complete", "win")
`;
  await fs.writeFile(path.join(f.author, 'documents/scripts/navigation-publisher.txt'), publisherSource);
  const scriptRecord = await read(`metadata/documents/${f.scriptId}.json`);
  await write(`metadata/documents/${publisherScriptId}.json`, { ...scriptRecord, id: publisherScriptId, sourcePath: 'documents/scripts/navigation-publisher.txt' });
  secondManifest.bindings.push({ ...structuredClone(secondManifest.bindings[0]), bindingId: publisherBindingId, parameters: {}, implementation: { ...secondManifest.bindings[0].implementation, sourceObjectId: publisherScriptId } }); await write('documents/behaviors/second.json', secondManifest);
  const secondRecord = await read(`metadata/documents/${f.secondManifestId}.json`); secondRecord.relations.push({ kind: 'reference', targetId: publisherScriptId, slot: 'implementation' }); await write(`metadata/documents/${f.secondManifestId}.json`, secondRecord);
  const scene = await read('documents/scenes/demo.json'); scene.title = 'Results'; await write('documents/scenes/results.json', scene);
  const firstRecord = await read(`metadata/documents/${sceneIds[0]}.json`);
  await write(`metadata/documents/${thirdId}.json`, { ...firstRecord, id: thirdId, sourcePath: 'documents/scenes/results.json', relations: firstRecord.relations.filter(row => row.kind !== 'behavior').concat({ kind: 'behavior', targetId: thirdManifestId, slot: 'instance behaviors' }) });
  const manifest = { ...structuredClone(firstManifest), sceneObjectId: thirdId, bindings: [{ ...structuredClone(firstManifest.bindings[0]), bindingId: thirdBindingId, parameters: { action_name: 'menu_start', target_scene_id: sceneIds[0] }, implementation: { ...firstManifest.bindings[0].implementation, sourceObjectId: thirdScriptId } }] };
  await write('documents/behaviors/results.json', manifest);
  const firstManifestRecord = await read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  await write(`metadata/documents/${thirdManifestId}.json`, { ...firstManifestRecord, id: thirdManifestId, sourcePath: 'documents/behaviors/results.json', relations: [{ kind: 'reference', targetId: thirdId, slot: 'scene' }, { kind: 'reference', targetId: thirdScriptId, slot: 'implementation' }] });
  await fs.writeFile(path.join(f.author, 'documents/scripts/navigation-results.txt'), GODOT_ACTION_SCENE_SWITCH_SCRIPT);
  await write(`metadata/documents/${thirdScriptId}.json`, { ...scriptRecord, id: thirdScriptId, sourcePath: 'documents/scripts/navigation-results.txt' });
  const assembly = await read('documents/projects/demo.json'); assembly.schemaVersion = 2; assembly.sceneIds = sceneIds; assembly.inputMapId = inputMapId; await write('documents/projects/demo.json', assembly);
  const assemblyRecord = await read(`metadata/documents/${f.assemblyId}.json`); assemblyRecord.relations.push({ kind: 'reference', targetId: thirdId, slot: 'scene' }, { kind: 'references', targetId: inputMapId, slot: 'inputMap' }); await write(`metadata/documents/${f.assemblyId}.json`, assemblyRecord);
  await write('documents/projects/navigation-input.json', { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'menu_start', keys: ['Enter', 'Space'] }, { name: 'game_complete', keys: ['KeyG'] }] });
  await write(`metadata/documents/${inputMapId}.json`, { ...assemblyRecord, id: inputMapId, sourcePath: 'documents/projects/navigation-input.json', relations: [], assetBindings: [] });
  const hudIds = [];
  for (const [index, id] of sceneIds.entries()) {
    const hudId = runtimeId(920 + index), elementId = runtimeId(930 + index); hudIds.push(hudId);
    await write(`documents/projects/navigation-hud-${index}.json`, { format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: id, elements: [{ id: elementId, kind: 'label', anchor: 'top-left', offset: [16, 16], size: [520, 40], fontSize: 22, color: '#ffffffff', content: { kind: 'literal', text: ['Menu: Enter to begin', 'Game: G to complete', 'Results: Enter to return'][index] } }] });
    await write(`metadata/documents/${hudId}.json`, { ...assemblyRecord, id: hudId, sourcePath: `documents/projects/navigation-hud-${index}.json`, relations: [{ kind: 'references', targetId: id, slot: 'scene' }], assetBindings: [] });
    const record = await read(`metadata/documents/${id}.json`); record.relations.push({ kind: 'references', targetId: hudId, slot: 'hud2d' }); await write(`metadata/documents/${id}.json`, record);
  }
  return { ...f, sceneIds, thirdId, firstBindingId: firstManifest.bindings[0].bindingId, thirdBindingId, publisherBindingId, publisherScriptId, thirdScriptId, thirdManifestId, inputMapId, hudIds, read, write };
}
