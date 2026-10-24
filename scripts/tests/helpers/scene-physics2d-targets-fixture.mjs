import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

export const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', manifestId = '70707070-7070-4070-8070-000000000001';
export const definitionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const instance1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', instance2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
export const scenePath = 'documents/scenes/demo.json', manifestPath = 'documents/physics/demo.json', definitionPath = 'documents/characters/traveler.md';
export const recordPath = id => `metadata/documents/${id}.json`;
export const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
export async function scenePhysics2DTargetsFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics-targets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../../examples/scene-animation/', import.meta.url), root, { recursive: true });
  const read = name => fs.readFile(path.join(root, name), 'utf8');
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value)); };
  const edit = async (name, change) => { const value = JSON.parse(await read(name)); change(value); await write(name, value); };
  // The directory fixture has no animation registration or source at all.
  await fs.rm(path.join(root, 'documents/animations'), { recursive: true });
  await fs.rm(path.join(root, 'metadata/documents/88888888-8888-4888-8888-888888888887.json'));
  await fs.rm(path.join(root, 'templates/animation.json'));
  await edit('workspace.json', workspace => { workspace.documentTypes = workspace.documentTypes.filter(type => type.id !== 'animation');
    workspace.documentTypes.push({ id: 'physics', label: 'Physics / 物理 / 物理', directory: 'physics', parserProfile: 'structured', template: 'physics.json' }); });
  await edit(recordPath(sceneId), record => { record.relations = record.relations.filter(relation => relation.kind !== 'animation');
    record.relations.push({ kind: 'references', targetId: manifestId, slot: 'physics2d' }); });
  const physics = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: sceneId, bodies: [
    { id: id(1), instanceId: instance1, kind: 'character', shape: { kind: 'box', size: [80, 80] }, offset: [0, 0], layer: 1, mask: 1 },
    { id: id(2), instanceId: instance2, kind: 'static', shape: { kind: 'circle', radius: 40 }, offset: [0, 0], layer: 1, mask: 1 },
  ] };
  await write(manifestPath, physics); await write('templates/physics.json', physics);
  await write(recordPath(manifestId), { format: 'viento-document', version: 1, id: manifestId, sourcePath: manifestPath,
    documentType: 'physics', parserProfile: 'structured', relations: [{ kind: 'references', targetId: sceneId }], assetBindings: [] });
  return { root, read, write, edit };
}
export async function tree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = revision(await fs.readFile(file));
  }
  return result;
}
