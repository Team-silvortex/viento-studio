import { animationPreviewFixture, sceneId, animationPath, imageId, scenePath } from './scene-animation-scene-preview-fixture.mjs';
import { buildHash } from '../../adapters/node-build-snapshot.mjs';
export { sceneId, animationPath, imageId, scenePath };
export const spriteSheet = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><path fill="#ff0000" d="M0 0h64v32H0z"/><path fill="#00ff00" d="M64 0h64v32H64z"/><path fill="#0000ff" d="M0 32h64v32H0z"/><path fill="#ffff00" d="M64 32h64v32H64z"/></svg>\n';
export async function spriteAnimationFixture(t) {
  const f = await animationPreviewFixture(t);
  await f.write('assets/traveler.svg', spriteSheet);
  await f.edit(`metadata/assets/${imageId}.json`, record => { record.content = { size: Buffer.byteLength(spriteSheet), sha256: buildHash(spriteSheet) }; });
  await f.edit(scenePath, scene => { scene.actors.forEach(actor => { actor.imageResourceId = imageId; actor.color = '#ffffff'; }); });
  await f.edit(animationPath, document => {
    document.schemaVersion = 2;
    document.tracks.push(...['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'].map((instanceId, index) => ({
      id: `77777777-7777-4777-8777-00000000000${index + 1}`, instanceId, property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 2, rows: 2 },
      keyframes: [{ atSeconds: 0, value: index }, { atSeconds: .5, value: 1 + index }, { atSeconds: 1, value: 2 + index }, { atSeconds: 1.5, value: index }],
    })));
  });
  return f;
}
