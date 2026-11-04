import { scenePhysics2DPlatformMotionAuthor } from './scene-physics2d-platform-motion-author-fixture.mjs';

// Author source uses a separate opt-in motion variant; horizontal legacy data
// and fixture helpers keep their original schema and meaning.
export async function scenePhysics2DPlatformVerticalAuthor(t, options = {}) {
  const offsetY = options.offsetY ?? 48;
  const f = await scenePhysics2DPlatformMotionAuthor(t, { ...options, offsetX: offsetY });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = 6;
    const platform = document.bodies.find(body => body.id === f.platformBodyId);
    if (options.enabled !== false) platform.platformMotion = { kind: 'vertical', offsetY, speed: options.speed ?? 240 };
  });
  return { ...f, offsetY };
}
