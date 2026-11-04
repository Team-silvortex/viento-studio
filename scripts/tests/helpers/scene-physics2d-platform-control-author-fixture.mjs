import { scenePhysics2DPlatformMotionAuthor } from './scene-physics2d-platform-motion-author-fixture.mjs';
import { scenePhysics2DPlatformVerticalAuthor } from './scene-physics2d-platform-vertical-author-fixture.mjs';

// Independent platforms sharing one author scene. Runtime control must never
// redirect through mutable behavior metadata or affect the other platform.
export async function scenePhysics2DPlatformControlAuthor(t, { axis = 'vertical', ...options } = {}) {
  const f = await (axis === 'vertical' ? scenePhysics2DPlatformVerticalAuthor : scenePhysics2DPlatformMotionAuthor)(t, { consumers: false, ...options });
  await f.edit(f.physicsPath, document => {
    document.bodies.find(body => body.id === f.stationaryBodyId).platformMotion = { kind: 'horizontal', offsetX: 24, speed: 120 };
  });
  return { ...f, axis };
}
