import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_REPLAY_DOCUMENT_FORMAT, validatePhysicsReplayDocument, inspectPhysicsReplayDocument,
  physicsReplayDocumentIds, validatePhysicsReplayDocumentDependencies } from '../../engine/physics-replay-document.mjs';

const id = number => `aaaaaaaa-aaaa-4aaa-8aaa-${number.toString(16).padStart(12, '0')}`;
const sceneId = id(1), instanceId = id(2), objectId = id(3);
const replay = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, () => ({ left: false, right: false, up: false, down: false, jump: false })) });
const envelope = () => ({ format: PHYSICS_REPLAY_DOCUMENT_FORMAT, schemaVersion: 1, sceneObjectId: sceneId, replay: replay() });
const record = (number, sourcePath, relations = []) => ({ format: 'viento-document', id: id(number), sourcePath, relations });
const scene = () => ({ format: 'viento-scene2d', schemaVersion: 2, title: 'Demo', viewport: [800, 480], background: '#ffffff',
  actors: [{ instanceId, objectId, position: [0, 0], controls: 'arrows', speed: 160 }] });
const fixture = () => ({ registration: record(4, 'documents/replay.json'), source: { documents: [
  { record: record(1, 'documents/scene.json', [{ kind: 'references', targetId: objectId }]), sourcePath: 'documents/scene.json', content: JSON.stringify(scene()) },
  { record: record(3, 'documents/actor.md'), sourcePath: 'documents/actor.md', content: '# Actor' },
] } });

test('physics replay document detaches, freezes and retains source identity without run results', () => {
  const input = envelope(), result = validatePhysicsReplayDocument(input);
  assert.deepEqual(result, input); assert.notEqual(result.replay, input.replay);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.replay.steps[0]));
  input.replay.steps[0].right = true; assert.equal(result.replay.steps[0].right, false);
  assert.deepEqual(physicsReplayDocumentIds(result), [sceneId]);
});

test('physics replay document rejects extra state, invalid input, accessors and polluted identity', () => {
  let called = 0; const getter = envelope(); Object.defineProperty(getter, 'replay', { enumerable: true, get() { called++; return replay(); } });
  const invalidStep = envelope(); invalidStep.replay.steps[29].right = true;
  for (const value of [getter, { ...envelope(), result: 'passed' }, { ...envelope(), sceneObjectId: sceneId.toUpperCase() }, invalidStep]) {
    assert.throws(() => validatePhysicsReplayDocument(value));
  }
  assert.equal(called, 0);
});

test('source inspection detects partial, escaped and duplicate keys without accepting examples', () => {
  const raw = '\ufeff' + JSON.stringify(envelope(), null, '\t').replaceAll('\n', '\r\n');
  assert.deepEqual(inspectPhysicsReplayDocument(raw).value, envelope());
  assert.equal(inspectPhysicsReplayDocument(JSON.stringify({ example: envelope() })).recognized, false);
  assert.equal(inspectPhysicsReplayDocument('{"for\\u006dat":"viento-physics2d-replay-document",').ok, false);
  assert.equal(inspectPhysicsReplayDocument(JSON.stringify(envelope()).replace('"sceneObjectId":', '"scene\\u004fbjectId":"' + sceneId + '","sceneObjectId":')).ok, false);
});

test('scene and definition dependencies must exist and be registered without mutating author data', () => {
  const f = fixture(), before = JSON.stringify(f);
  assert.deepEqual(validatePhysicsReplayDocumentDependencies(envelope(), f.registration, f.source), []);
  assert.equal(JSON.stringify(f), before);
  f.source.documents[0].record.relations = [];
  assert.equal(validatePhysicsReplayDocumentDependencies(envelope(), f.registration, f.source)[0].code, 'runtime_physics_replay_document_unlinked');
  f.source.documents[0].record.relations = [{ kind: 'behavior', targetId: objectId }];
  assert.equal(validatePhysicsReplayDocumentDependencies(envelope(), f.registration, f.source)[0].code, 'runtime_physics_replay_unsupported');
});

test('resource inspectors preserve distinct case and physics replay format recognition', async () => {
  const { inspectPackageRuntimeCase, inspectPackageRuntimeAuthorDocument } = await import('../lib/resource-package-catalog.mjs');
  const bytes = Buffer.from(JSON.stringify(envelope()));
  assert.equal(inspectPackageRuntimeCase(bytes, 'documents/replay.json').recognized, false);
  assert.equal(inspectPackageRuntimeAuthorDocument(bytes, 'documents/replay.json').ok, true);
  assert.equal(inspectPackageRuntimeAuthorDocument(bytes, 'documents/replay.txt').diagnostics[0].code, 'runtime_physics_replay_document_invalid');
});
