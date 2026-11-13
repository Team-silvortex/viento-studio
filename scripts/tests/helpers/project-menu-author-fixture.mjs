import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { GODOT_PROJECT_MENU_SCRIPT } from '../../../engine/godot-project-menu-script.mjs';
export const menuId = number => `c011ec70-2026-4113-8113-${String(number).padStart(12, '0')}`;
export const menuCanonical = fileURLToPath(new URL('../../../examples/topdown-collect/', import.meta.url));
export const menuPauseAuthor = fileURLToPath(new URL('../../../docs/test-results/project-pause/browser/author-final/', import.meta.url));
export const menuInitialValues = Object.freeze({ score: 0, health: 3, door_open: false });
export const menuItems = Object.freeze({
  start: [{ id: 'start', label: 'Start · 开始 · 開始', command: 'retry', targetSceneId: menuId(31), values: menuInitialValues }, { id: 'exit', label: 'Exit · 结束 · 終了', command: 'finish' }],
  level: [{ id: 'resume', label: 'Resume · 继续 · 再開', command: 'resume' }, { id: 'exit', label: 'Exit · 结束 · 終了', command: 'finish' }],
  win: [{ id: 'title', label: 'Back to title · 返回标题 · タイトルへ', command: 'scene', targetSceneId: menuId(30) }, { id: 'exit', label: 'Exit · 结束 · 終了', command: 'finish' }],
  fail: [{ id: 'title', label: 'Back to title · 返回标题 · タイトルへ', command: 'scene', targetSceneId: menuId(30) }, { id: 'exit', label: 'Exit · 结束 · 終了', command: 'finish' }]
});
export function menuParameters(name) {
  return { title: name === 'level' ? 'Paused · 暂停 · 一時停止' : name === 'start' ? 'Crystal Courtyard' : name === 'win' ? 'Victory · 胜利 · 勝利' : 'Try again · 再试一次 · 再挑戦', items_json: JSON.stringify(menuItems[name]), display_mode: name === 'level' ? 'paused' : 'scene' };
}
export async function menuInventory(directory) {
  const entries = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile());
  return Object.fromEntries(await Promise.all(entries.map(async row => { const file = path.join(row.parentPath || row.path, row.name); return [path.relative(directory, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')]; })));
}
// Disposable copies only. Never changes the previous pause author/evidence or
// canonical sample; an explicit browser source is consumed without defaults.
export async function godotProjectMenuAuthor(t, { omitMenu = false, sceneRestart = false } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-menu-native-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const author = path.join(temporary, 'author'), authorSource = process.env.VIENTO_PROJECT_MENU_AUTHOR;
  if (authorSource && !path.isAbsolute(authorSource)) throw new TypeError('The browser author workspace must be absolute.');
  await fs.cp(authorSource || menuPauseAuthor, author, { recursive: true });
  const read = async name => JSON.parse(await fs.readFile(path.join(author, name), 'utf8'));
  const write = async (name, value) => { const file = path.join(author, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
  const common = { temporary, author, read, write, assemblyId: menuId(100), menuId: menuId(30), gameId: menuId(31), winId: menuId(32), failureId: menuId(33), playerId: menuId(301), initialPosition: [140, 380], collectTrackId: menuId(500), sourceId: menuId(120) };
  const restartVariant = async sourceId => {
    if (!sceneRestart) return {};
    const behaviorPath = 'documents/behaviors/start.json', behavior = await read(behaviorPath);
    const binding = behavior.bindings.find(row => row.implementation.sourceObjectId === sourceId);
    if (!binding) throw new TypeError('The restart probe needs one explicitly authored title menu.');
    const original = structuredClone(binding.parameters);
    binding.parameters = { title: 'Restart probe · 重开验证 · 再起動確認', items_json: JSON.stringify([{ id: 'restart', label: 'Restart · 重开 · 再起動', command: 'restart', values: menuInitialValues }, { id: 'exit', label: 'Exit · 结束 · 終了', command: 'finish' }]), display_mode: 'scene' };
    await write(behaviorPath, behavior);
    return { sceneRestartVariant: { behaviorPath, bindingId: binding.bindingId, originalParameters: original, parameters: structuredClone(binding.parameters) } };
  };
  if (authorSource) {
    const sources = new Set();
    for (const name of await fs.readdir(path.join(author, 'metadata/documents'))) {
      if (!name.endsWith('.json')) continue;
      const record = await read(`metadata/documents/${name}`);
      if (record.documentType === 'script' && await fs.readFile(path.join(author, record.sourcePath), 'utf8') === GODOT_PROJECT_MENU_SCRIPT) sources.add(record.id);
    }
    if (sources.size !== 1) throw new TypeError('Expected one saved official menu source.');
    const sourceId = [...sources][0], bindings = {};
    for (const name of ['start', 'level', 'win', 'fail']) { const matches = (await read(`documents/behaviors/${name}.json`)).bindings.filter(row => row.implementation.sourceObjectId === sourceId); if (matches.length !== 1) throw new TypeError('Expected one saved menu binding per member.'); bindings[name] = matches[0].bindingId; }
    return { ...common, sourceId, bindingIds: bindings, browserAuthorSource: authorSource, ...await restartVariant(sourceId) };
  }
  const input = await read('documents/inputs/keyboard.json');
  input.actions = input.actions.filter(row => !['pause', 'legacy_start'].includes(row.name));
  input.actions.push({ name: 'pause', keys: ['KeyP'] }, { name: 'legacy_start', keys: ['KeyL'] });
  await write('documents/inputs/keyboard.json', input);
  const bindingIds = {};
  if (!omitMenu) {
    await write('documents/scripts/menu.txt', GODOT_PROJECT_MENU_SCRIPT);
    await write(`metadata/documents/${common.sourceId}.json`, { ...await read(`metadata/documents/${menuId(110)}.json`), id: common.sourceId, sourcePath: 'documents/scripts/menu.txt' });
  }
  for (const [index, name] of ['start', 'level', 'win', 'fail'].entries()) {
    const behavior = await read(`documents/behaviors/${name}.json`);
    for (const binding of behavior.bindings) if (binding.parameters.action_name === 'start_retry') binding.parameters.action_name = 'legacy_start';
    bindingIds[name] = menuId(430 + index);
    if (!omitMenu) {
      behavior.bindings.push({ bindingId: bindingIds[name], instanceId: name === 'level' ? common.playerId : menuId(name === 'start' ? 320 : name === 'win' ? 322 : 323), implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: common.sourceId }, parameters: menuParameters(name), events: [] });
      const recordPath = `metadata/documents/${menuId(name === 'start' ? 40 : name === 'level' ? 41 : name === 'win' ? 42 : 43)}.json`, record = await read(recordPath);
      record.relations.push({ kind: 'references', targetId: common.sourceId, slot: 'implementation' }); await write(recordPath, record);
    }
    await write(`documents/behaviors/${name}.json`, behavior);
  }
  return { ...common, bindingIds, ...await restartVariant(common.sourceId) };
}
