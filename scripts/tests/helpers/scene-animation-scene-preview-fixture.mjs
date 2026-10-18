import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildHash } from '../../adapters/node-build-snapshot.mjs';

export const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const manifestId = '88888888-8888-4888-8888-888888888887';
export const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const scenePath = 'documents/scenes/demo.json', animationPath = 'documents/animations/demo.json';
export const recordPath = `metadata/documents/${sceneId}.json`;
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const revision = value => `sha256:${buildHash(value)}`;

export async function animationPreviewFixture(t, { version = 2 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-scene-preview-')), root = path.join(directory, 'workspace');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(new URL('../../../examples/scene-animation/', import.meta.url), root, { recursive: true });
  for (const relative of ['assets/traveler.svg', `metadata/assets/${imageId}.json`]) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.copyFile(new URL('../../../examples/scene2d/' + relative, import.meta.url), path.join(root, relative));
  }
  const read = relative => fs.readFile(path.join(root, relative), 'utf8');
  async function write(relative, content) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  }
  async function edit(relative, change) {
    const value = JSON.parse((await read(relative)).replace(/^\uFEFF/, '')); change(value); await write(relative, json(value));
  }
  await edit(recordPath, record => { record.assetBindings.push({ assetId: imageId, role: 'sprite' }); });
  await edit(scenePath, scene => {
    scene.actors[0].imageResourceId = imageId;
    if (version === 3) {
      scene.schemaVersion = 3;
      scene.groups = [{ groupId: '33333333-3333-4333-8333-333333333333', name: 'Animated group / 动画组' }];
      scene.actors[0].groupId = scene.groups[0].groupId;
    }
  });
  return { directory, root, read, write, edit };
}

export async function fingerprint(root, { authorOnly = false } = {}) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const absolute = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    if (authorOnly && relative.startsWith('.viento/')) continue;
    result[relative] = buildHash(await fs.readFile(absolute));
  }
  return result;
}
