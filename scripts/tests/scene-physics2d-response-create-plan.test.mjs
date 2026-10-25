import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePhysics2DCreationDraft } from '../../engine/scene-physics2d-create-plan.mjs';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const input = () => ({ sceneObjectId: id(1), bodyId: id(2), instanceId: id(3), kind: 'character', shape: { kind: 'circle', radius: 16 }, offset: [0, 0], layer: 1, mask: 2 });
test('creation keeps legacy stop bytes and upgrades only an explicit slide character', () => {
  const original = input(), old = createScenePhysics2DCreationDraft(original);
  assert.deepEqual(createScenePhysics2DCreationDraft({ ...original, collisionResponse: 'stop' }), old);
  const value = { ...original, collisionResponse: 'slide' }, result = createScenePhysics2DCreationDraft(value);
  assert.equal(result.ok, true); assert.equal(JSON.parse(result.content).schemaVersion, 2);
  assert.equal(JSON.parse(result.content).bodies[0].collisionResponse, 'slide'); assert.deepEqual(value, { ...original, collisionResponse: 'slide' });
});
test('creation rejects noncharacter responses bad enums and accessor data without partial text', () => {
  for (const patch of [{ kind: 'static', collisionResponse: 'stop' }, { kind: 'sensor', collisionResponse: 'slide' },
    ...[null, true, 1, '', 'Slide', [], {}].map(collisionResponse => ({ collisionResponse }))]) {
    const result = createScenePhysics2DCreationDraft({ ...input(), ...patch });
    assert.equal(result.ok, false); assert.equal(result.content, null);
  }
  let calls = 0; const value = input(); Object.defineProperty(value, 'collisionResponse', { enumerable: true, get() { calls++; return 'slide'; } });
  assert.equal(createScenePhysics2DCreationDraft(value).ok, false); assert.equal(calls, 0);
});
