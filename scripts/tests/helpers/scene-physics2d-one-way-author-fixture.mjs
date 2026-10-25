import { scenePhysics2DCharacterEventsAuthor } from './scene-physics2d-character-events-author-fixture.mjs';
const id = n => `74747474-7474-4474-8474-${String(n).padStart(12, '0')}`;

// A short ascent through a platform and descent onto its top. Existing author
// event publishers and media consumers remain ordinary behavior scripts.
export async function scenePhysics2DOneWayAuthor(t, { enabled = true, margin = 1, consumers = false, jump = true, live = false, offset = [0, 0], circle = false } = {}) {
  const f = await scenePhysics2DCharacterEventsAuthor(t, { consumers, jump, live });
  const platformInstanceId = id(1), platformBodyId = id(2);
  await f.edit('documents/scenes/demo.json', scene => {
    scene.actors[0].position = [100, 180];
    scene.actors.push({ ...structuredClone(scene.actors[2]), instanceId: platformInstanceId, position: [100, 160], size: [180, 10], color: '#b7d7f0' });
  });
  await f.edit(f.physicsPath, document => {
    document.schemaVersion = enabled ? 4 : 3;
    document.bodies[0].characterMotion = { kind: 'platformer', gravity: 2000, jumpSpeed: 400, maxFallSpeed: 1200 };
    if (circle) document.bodies[0].shape = { kind: 'circle', radius: 10 };
    document.bodies.push({ ...structuredClone(document.bodies[2]), id: platformBodyId, instanceId: platformInstanceId,
      shape: { kind: 'box', size: [180, 10] }, offset, ...(enabled ? { oneWay: { margin } } : {}) });
  });
  return { ...f, platformInstanceId, platformBodyId, platformTop: 155 + offset[1], expectedLandingY: 145 + offset[1] };
}
