import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from '../../../engine/godot-project-pause-script.mjs';
export const pauseId = number => `c011ec70-2026-4113-8113-${String(number).padStart(12, '0')}`;
export const pauseSample = fileURLToPath(new URL('../../../examples/topdown-collect/', import.meta.url));
export const PROJECT_PAUSE_TEST_TICK_SCRIPT = `extends Node\nvar pause_test_idle_ticks := 0\nvar pause_test_physics_ticks := 0\nfunc _process(_delta: float) -> void:\n\tpause_test_idle_ticks += 1\nfunc _physics_process(_delta: float) -> void:\n\tpause_test_physics_ticks += 1\n`;
export async function projectPauseInventory(directory) {
  const entries = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile());
  return Object.fromEntries(await Promise.all(entries.map(async row => {
    const file = path.join(row.parentPath || row.path, row.name);
    return [path.relative(directory, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')];
  })));
}
// Only disposable author workspaces receive these ordinary documents. Supplying
// a browser-authored source selects its saved bytes without filling defaults.
export async function godotProjectPauseAuthor(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-pause-native-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const author = path.join(temporary, 'author'), authorSource = process.env.VIENTO_PROJECT_PAUSE_AUTHOR;
  if (authorSource && !path.isAbsolute(authorSource)) throw new TypeError('The browser author workspace must have an absolute path.');
  await fs.cp(authorSource || pauseSample, author, { recursive: true });
  const read = async name => JSON.parse(await fs.readFile(path.join(author, name), 'utf8'));
  const write = async (name, value) => { const file = path.join(author, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
  const common = { temporary, author, read, write, assemblyId: pauseId(100), menuId: pauseId(30), gameId: pauseId(31), winId: pauseId(32), failureId: pauseId(33), playerId: pauseId(301), menuBindingId: pauseId(400), initialPosition: [140, 380], collectTrackId: pauseId(500) };
  if (authorSource) {
    const sources = new Set();
    for (const name of await fs.readdir(path.join(author, 'metadata/documents'))) {
      if (!name.endsWith('.json')) continue;
      const record = await read(`metadata/documents/${name}`);
      if (record.documentType === 'script' && await fs.readFile(path.join(author, record.sourcePath), 'utf8') === GODOT_ACTION_PROJECT_PAUSE_SCRIPT) sources.add(record.id);
    }
    const bindings = (await read('documents/behaviors/level.json')).bindings.filter(row => sources.has(row.implementation.sourceObjectId));
    if (bindings.length !== 1) throw new TypeError('Expected exactly one saved official pause binding.');
    return { ...common, scriptId: bindings[0].implementation.sourceObjectId, bindingId: bindings[0].bindingId, parameters: bindings[0].parameters, browserAuthorSource: authorSource };
  }
  const scriptId = pauseId(118), bindingId = pauseId(422), tickScriptId = pauseId(119), tickBindingId = pauseId(423), behavior = await read('documents/behaviors/level.json');
  const add = async (id, binding, sourcePath, content, parameters) => {
    await write(sourcePath, content); await write(`metadata/documents/${id}.json`, { ...await read(`metadata/documents/${pauseId(110)}.json`), id, sourcePath });
    behavior.bindings.push({ bindingId: binding, instanceId: common.playerId, implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id }, parameters, events: [] });
  };
  await add(scriptId, bindingId, 'documents/scripts/pause.txt', GODOT_ACTION_PROJECT_PAUSE_SCRIPT, { action_name: 'pause', paused_text: 'Paused', resume_text: 'Release controls to resume' });
  await add(tickScriptId, tickBindingId, 'documents/scripts/pause-test-ticks.txt', PROJECT_PAUSE_TEST_TICK_SCRIPT, {});
  await write('documents/behaviors/level.json', behavior);
  const recordPath = `metadata/documents/${pauseId(41)}.json`, record = await read(recordPath);
  for (const id of [scriptId, tickScriptId]) record.relations.push({ kind: 'references', targetId: id, slot: 'implementation' }); await write(recordPath, record);
  const input = await read('documents/inputs/keyboard.json'); input.actions.push({ name: 'pause', keys: ['KeyP', 'Space'] }); await write('documents/inputs/keyboard.json', input);
  const audio = await read('documents/audio/level.json'); audio.tracks[0].loop = true; await write('documents/audio/level.json', audio);
  return { ...common, scriptId, bindingId, tickScriptId, tickBindingId, parameters: { action_name: 'pause', paused_text: 'Paused', resume_text: 'Release controls to resume' } };
}
