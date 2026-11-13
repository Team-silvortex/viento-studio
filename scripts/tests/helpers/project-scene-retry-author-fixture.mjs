import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectAssemblyAuthor } from './project-assembly-backend-fixture.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../../engine/godot-scene-retry-script.mjs';
import { DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES } from '../../../engine/project-scene-retry-diagnostics.mjs';

export const retryFixtureJson = value => JSON.stringify(value, null, 2) + '\n';
export async function projectSceneRetryAuthor(t, { edited = false } = {}) {
  const inputMap = { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'retry_game', keys: ['Enter', 'Space'] }] };
  const f = await projectAssemblyAuthor(t, { inputMap });
  const read = async name => JSON.parse(await fs.readFile(path.join(f.author, name), 'utf8'));
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(f.author, name)), { recursive: true }); await fs.writeFile(path.join(f.author, name), typeof value === 'string' ? value : retryFixtureJson(value)); };
  const behavior = await read('documents/behaviors/demo.json'); behavior.bindings = behavior.bindings.slice(0, 1);
  behavior.bindings[0].parameters = { action_name: 'retry_game', target_scene_id: f.sceneIds[1], state_values_json: DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES };
  behavior.bindings[0].events = [];
  await write('documents/behaviors/demo.json', behavior);
  const content = GODOT_ACTION_SCENE_RETRY_SCRIPT + (edited ? '\n# ordinary author edit\n' : '');
  await write('documents/scripts/checkpoint.txt', content);
  return { ...f, read, write, behavior, content, inputMap };
}
export async function sceneRetryInventory(root, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await sceneRetryInventory(root, name));
    else result[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
  }
  return result;
}
