import { scenePhysics2DCharacterMotionAuthor } from './scene-physics2d-character-motion-author-fixture.mjs';

const id = number => `74747474-7474-4474-8474-${String(number).padStart(12, '0')}`;

// Disposable authored scene. Two controlled physical instances intentionally
// share one OC definition; none/static/sensor/nonphysical targets stay distinct.
export async function scenePhysics2DInputInstancesAuthor(t) {
  const f = await scenePhysics2DCharacterMotionAuthor(t, { animation: false });
  const secondInstanceId = id(1), nonphysicalInstanceId = id(2), noneInstanceId = id(3);
  const secondBodyId = id(11), noneBodyId = id(12);
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => {
    value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]);
  });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => {
    value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind));
  });
  await f.edit('documents/scenes/demo.json', scene => {
    const original = scene.actors[0];
    scene.actors.push({ ...structuredClone(original), instanceId: secondInstanceId, position: [240, 178] },
      { ...structuredClone(original), instanceId: nonphysicalInstanceId, position: [400, 100] },
      { ...structuredClone(original), instanceId: noneInstanceId, controls: 'none', position: [500, 100] });
  });
  await f.edit(f.physicsPath, document => {
    const original = document.bodies[0];
    document.bodies.push({ ...structuredClone(original), id: secondBodyId, instanceId: secondInstanceId },
      { ...structuredClone(original), id: noneBodyId, instanceId: noneInstanceId });
  });
  return { ...f, secondInstanceId, secondBodyId, nonphysicalInstanceId, noneInstanceId, noneBodyId };
}

export const physicsInputReleased = () => ({ left: false, right: false, up: false, down: false, jump: false });
export const physicsInstanceReplay = (first, second) => ({ format: 'viento-physics2d-input-replay', schemaVersion: 2, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, index) => ({ inputs: index < 18
    ? [{ instanceId: first, ...physicsInputReleased(), right: true, jump: index === 6 },
      ...(second ? [{ instanceId: second, ...physicsInputReleased(), left: true, jump: index === 8 }] : [])] : [] })) });
export const physicsInstanceCase = (first, second) => ({ format: 'viento-physics2d-replay-case', schemaVersion: 1,
  program: physicsInstanceReplay(first, second), checks: [first, second].filter(Boolean).map(instanceId => ({ instanceId, stepIndex: 30,
    positionAfter: { value: [0, 0], tolerance: [1000000, 1000000] } })) });
