import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhysicsReplayCaseDocument as validate, inspectPhysicsReplayCaseDocument as inspect,
  physicsReplayCaseDocumentIds as ids, validatePhysicsReplayCaseDocumentDependencies as dependencies } from '../../engine/physics-replay-case-document.mjs';
import { inspectPhysicsReplayDocument } from '../../engine/physics-replay-document.mjs';
import { inspectPackageRuntimeAuthorDocument } from '../lib/resource-package-catalog.mjs';
const id = number => `aaaaaaaa-aaaa-4aaa-8aaa-${number.toString(16).padStart(12, '0')}`;
const sceneId = id(1), instanceId = id(2), objectId = id(3);
const program = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, () => ({ left: false, right: false, up: false, down: false, jump: false })) });
const replayCase = () => ({ format: 'viento-physics2d-replay-case', schemaVersion: 1, program: program(),
  checks: [{ instanceId, stepIndex: 30, positionAfter: { value: [3, 4], tolerance: [1, 2] } }] });
const envelope = () => ({ format: 'viento-physics2d-replay-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: replayCase() });
const record = (number, sourcePath, relations = []) => ({ format: 'viento-document', id: id(number), sourcePath, relations });
const scene = () => ({ format: 'viento-scene2d', schemaVersion: 2, title: 'Demo', viewport: [800, 480], background: '#ffffff',
  actors: [{ instanceId, objectId, position: [0, 0], controls: 'arrows', speed: 160 }] });
const fixture = () => ({ registration: record(4, 'documents/case.json'), source: { documents: [
  { record: record(1, 'documents/scene.json', [{ kind: 'references', targetId: objectId }]), sourcePath: 'documents/scene.json', content: JSON.stringify(scene()) },
  { record: record(3, 'documents/actor.md'), sourcePath: 'documents/actor.md', content: '# Actor' },
] } });
test('acceptance document clones and freezes complete input and checks', () => {
  const input = envelope(), result = validate(input);
  assert.deepEqual(result, input); assert.notEqual(result.case, input.case); assert.ok(Object.isFrozen(result.case.checks[0].positionAfter.value));
  input.case.checks[0].positionAfter.value[0] = 9; assert.equal(result.case.checks[0].positionAfter.value[0], 3);
  assert.deepEqual(ids(result), [sceneId]);
});
test('strict inspection rejects invalid, duplicate, oversized and accessor data without executing it', () => {
  let called = 0; const getter = envelope(); Object.defineProperty(getter, 'case', { enumerable: true, get() { called++; return replayCase(); } });
  const bad = envelope(); bad.case.checks[0].stepIndex = 31;
  for (const value of [getter, bad, { ...envelope(), result: 'passed' }, { ...envelope(), sceneObjectId: sceneId.toUpperCase() }]) assert.throws(() => validate(value));
  assert.equal(called, 0);
  const source = JSON.stringify(envelope());
  assert.deepEqual(inspect('\ufeff' + source).value, envelope());
  assert.equal(inspect(JSON.stringify({ example: envelope() })).recognized, false);
  assert.equal(inspect('{"for\\u006dat":"viento-physics2d-replay-case-document",').ok, false);
  assert.equal(inspect(source.replace('"sceneObjectId":', '"scene\\u004fbjectId":"' + sceneId + '","sceneObjectId":')).ok, false);
  assert.equal(inspect(source + ' '.repeat(256 * 1024)).ok, false);
});
test('requires a valid registered scene dependency without mutating source', () => {
  const f = fixture(), before = JSON.stringify(f); assert.deepEqual(dependencies(envelope(), f.registration, f.source), []); assert.equal(JSON.stringify(f), before);
  const stale = envelope(); stale.case.checks[0].instanceId = id(999);
  assert.equal(dependencies(stale, f.registration, f.source)[0].code, 'runtime_physics_case_instance_missing');
  f.source.documents[0].record.relations = []; assert.equal(dependencies(envelope(), f.registration, f.source)[0].code, 'runtime_physics_case_document_unlinked');
  f.source.documents[0].record.relations = [{ kind: 'behavior', targetId: objectId }]; assert.equal(dependencies(envelope(), f.registration, f.source)[0].code, 'runtime_physics_case_unsupported');
});
test('package classification keeps acceptance, legacy replay and runtime case independent', () => {
  const newSource = Buffer.from(JSON.stringify(envelope()));
  assert.equal(inspectPackageRuntimeAuthorDocument(newSource, 'documents/case.json').value.format, envelope().format);
  assert.equal(inspectPackageRuntimeAuthorDocument(newSource, 'documents/case.txt').diagnostics[0].code, 'runtime_physics_case_document_invalid');
  assert.equal(inspectPhysicsReplayDocument(newSource.toString()).recognized, false);
  const old = Buffer.from(JSON.stringify({ format: 'viento-physics2d-replay-document', schemaVersion: 1, sceneObjectId: sceneId, replay: program() }));
  assert.equal(inspect(old.toString()).recognized, false);
  assert.equal(inspectPackageRuntimeAuthorDocument(old, 'documents/replay.json').value.format, 'viento-physics2d-replay-document');
});
