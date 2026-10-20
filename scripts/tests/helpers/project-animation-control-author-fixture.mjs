import fs from 'node:fs/promises';
import path from 'node:path';
import { projectSceneSwitchingAuthor } from './project-scene-switching-fixture.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
const id = n => `58585858-5858-4585-8585-${String(n).padStart(12, '0')}`;

// Disposable author fixture; the checked-in animation and behavior examples
// remain byte-for-byte unchanged. Both scenes share image bytes, not transport.
export async function projectAnimationControlAuthor(t, { loop = false, sprites = true, secondAnimation = true } = {}) {
  const f = await projectSceneSwitchingAuthor(t, { mode: 'no-switch' });
  const read = async file => JSON.parse(await fs.readFile(path.join(f.author, file)));
  const write = async (file, value) => { await fs.mkdir(path.dirname(path.join(f.author, file)), { recursive: true }); await fs.writeFile(path.join(f.author, file), typeof value === 'string' ? value : json(value)); };
  const edit = async (file, fn) => { const value = await read(file); fn(value); await write(file, value); };
  await edit('workspace.json', workspace => workspace.documentTypes.push({ id: 'animation', label: 'Animation', directory: 'animations', parserProfile: 'structured', template: 'animation.json' }));
  await edit('documents/behaviors/demo.json', manifest => { manifest.bindings = [manifest.bindings[0]]; });
  const record = await read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  const actor = (await read('documents/scenes/demo.json')).actors[0];
  const animationIds = [];
  for (const [index, sceneObjectId] of f.sceneIds.entries()) {
    if (index === 1 && !secondAnimation) continue;
    const animationId = id(100 + index); animationIds.push(animationId);
    const document = { format: 'viento-scene-animation', schemaVersion: sprites ? 2 : 1, sceneObjectId, durationSeconds: 1, loop,
      tracks: [{ id: id(1), instanceId: actor.instanceId, property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 1, value: [100, 0] }] },
        ...(sprites ? [{ id: id(2), instanceId: actor.instanceId, property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 2, rows: 2 }, keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: .25, value: 1 }, { atSeconds: .5, value: 3 }] }] : [])] };
    const sourcePath = `documents/animations/scene-${index}.json`;
    await write(sourcePath, document);
    await write(`metadata/documents/${animationId}.json`, { ...record, id: animationId, sourcePath, documentType: 'animation', relations: [{ kind: 'reference', targetId: sceneObjectId, slot: 'scene' }] });
    await edit(`metadata/documents/${sceneObjectId}.json`, scene => scene.relations.push({ kind: 'animation', targetId: animationId, slot: 'scene animation' }));
    if (index === 0) await write('templates/animation.json', document);
  }
  const bindingId = (await read('documents/behaviors/demo.json')).bindings[0].bindingId;
  const script = (name, content) => write(`documents/scripts/${name}.txt`, content);
  return { ...f, read, write, edit, script, animationIds, instanceId: actor.instanceId, bindingId };
}
