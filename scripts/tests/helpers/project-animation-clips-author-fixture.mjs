import { projectAnimationControlAuthor } from './project-animation-control-author-fixture.mjs';
const id = n => `59595959-5959-4595-8595-${String(n).padStart(12, '0')}`;
export async function projectAnimationClipsAuthor(t, { sprites = true, mixed = false } = {}) {
  const f = await projectAnimationControlAuthor(t, { sprites, loop: true });
  const clipIds = f.sceneIds.map((_, index) => [id(index * 10 + 1), id(index * 10 + 2)]);
  for (const [index] of f.sceneIds.entries()) {
    if (mixed && index === 1) continue;
    await f.edit(`documents/animations/scene-${index}.json`, document => {
      document.schemaVersion = 3;
      document.clips = [
        { id: clipIds[index][0], name: '歩く / Idle', startSeconds: .25, endSeconds: .75, loop: true },
        { id: clipIds[index][1], name: '攻撃 / Strike', startSeconds: .5, endSeconds: 1, loop: false },
      ];
    });
  }
  return { ...f, clipIds };
}
