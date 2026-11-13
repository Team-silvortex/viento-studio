import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { GODOT_ACTION_SCENE_RESTART_SCRIPT } from '../../../engine/godot-scene-restart-script.mjs';

export const restartId = number => `c011ec70-2026-4113-8113-${String(number).padStart(12, '0')}`;
export const restartSample = fileURLToPath(new URL('../../../examples/topdown-collect/', import.meta.url));
export const restartDefaults = Object.freeze({ score: 0, health: 3, door_open: false });
export async function sceneRestartInventory(directory) {
  const entries = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile());
  return Object.fromEntries(await Promise.all(entries.map(async row => {
    const file = path.join(row.parentPath || row.path, row.name);
    return [path.relative(directory, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')];
  })));
}

// The official sample is copied unchanged first. All restart pilot choices below
// are ordinary saved author documents in a disposable workspace; no generated
// runtime, engine command or example source is patched for test completion.
export async function godotSceneRestartAuthor(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-restart-native-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const author = path.join(temporary, 'author');
  const authorSource = process.env.VIENTO_SCENE_RESTART_AUTHOR;
  if (authorSource && !path.isAbsolute(authorSource)) throw new TypeError('The saved browser author workspace must have an absolute path.');
  await fs.cp(authorSource || restartSample, author, { recursive: true });
  const read = async name => JSON.parse(await fs.readFile(path.join(author, name), 'utf8'));
  const write = async (name, value) => {
    const file = path.join(author, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  if (authorSource) {
    const sources = new Set();
    for (const name of await fs.readdir(path.join(author, 'metadata/documents'))) {
      if (!name.endsWith('.json')) continue;
      const record = await read(`metadata/documents/${name}`);
      if (record.documentType === 'script' && await fs.readFile(path.join(author, record.sourcePath), 'utf8') === GODOT_ACTION_SCENE_RESTART_SCRIPT) sources.add(record.id);
    }
    const level = await read('documents/behaviors/level.json');
    const bindings = level.bindings.filter(row => sources.has(row.implementation.sourceObjectId));
    if (bindings.length !== 1) throw new TypeError('Expected one saved exact restart source binding in the browser-authored level.');
    const binding = bindings[0];
    return { temporary, author, read, write, assemblyId: restartId(100), menuId: restartId(30), gameId: restartId(31),
      winId: restartId(32), failureId: restartId(33), scriptId: binding.implementation.sourceObjectId, bindingId: binding.bindingId,
      playerId: restartId(301), menuBindingId: restartId(400), initialPosition: [140, 380], defaults: restartDefaults,
      collectTrackId: restartId(500), browserAuthorSource: authorSource };
  }
  const scriptId = restartId(117), bindingId = restartId(421), playerId = restartId(301);
  const sourcePath = 'documents/scripts/restart.txt';
  await write(sourcePath, GODOT_ACTION_SCENE_RESTART_SCRIPT);
  await write(`metadata/documents/${scriptId}.json`, { ...await read(`metadata/documents/${restartId(110)}.json`), id: scriptId, sourcePath });
  const behavior = await read('documents/behaviors/level.json');
  behavior.bindings.push({ bindingId, instanceId: playerId,
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: scriptId },
    parameters: { action_name: 'restart_game', state_values_json: JSON.stringify(restartDefaults) }, events: [] });
  await write('documents/behaviors/level.json', behavior);
  const recordPath = `metadata/documents/${restartId(41)}.json`, record = await read(recordPath);
  record.relations.push({ kind: 'references', targetId: scriptId, slot: 'implementation' }); await write(recordPath, record);
  const input = await read('documents/inputs/keyboard.json');
  input.actions.push({ name: 'restart_game', keys: ['KeyR', 'Space'] }); await write('documents/inputs/keyboard.json', input);
  const menu = await read('documents/behaviors/start.json');
  menu.bindings[0].parameters.state_values_json = JSON.stringify({ ...restartDefaults, progress: 'checkpoint-7' });
  await write('documents/behaviors/start.json', menu);
  // An actual collected crystal starts a looping existing PCM track, so the
  // window pilot observes old live playback being stopped by visit teardown.
  const audio = await read('documents/audio/level.json'); audio.tracks[0].loop = true; await write('documents/audio/level.json', audio);
  return { temporary, author, read, write, assemblyId: restartId(100), menuId: restartId(30), gameId: restartId(31),
    winId: restartId(32), failureId: restartId(33), scriptId, bindingId, playerId, menuBindingId: restartId(400),
    initialPosition: [140, 380], defaults: restartDefaults, collectTrackId: restartId(500) };
}
