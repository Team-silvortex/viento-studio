import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const input = (count = 1) => ({ sceneObjectId: id(1), backendId: 'org.viento.godot4', language: 'gdscript',
  bindings: Array.from({ length: count }, (_, index) => ({ bindingId: id(100 + index), instanceId: id(10 + index), sourceObjectId: id(2) })) });
const rejected = value => {
  let result;
  assert.doesNotThrow(() => { result = createSceneBehaviorCreationDraft(value); });
  assert.equal(result.ok, false); assert.equal(result.content, null); assert.deepEqual(result.sourceObjectIds, []);
  assert.ok(result.diagnostics.length > 0); assert.ok(result.diagnostics.every(item => item.severity === 'error' && item.code === 'build_behavior_invalid' && typeof item.message === 'string'));
  return result;
};

test('single binding matches the existing first-creation format byte for byte', () => {
  const value = input(), result = createSceneBehaviorCreationDraft(value);
  const expected = { format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(100), instanceId: id(10),
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(2) }, parameters: {}, events: [] }] };
  assert.deepEqual(result, { ok: true, content: JSON.stringify(expected, null, 2) + '\n', sourceObjectIds: [id(2)], diagnostics: [] });
  assert.equal(inspectSceneBehaviors(result.content).ok, true);
});
test('multiple bindings retain author order while script dependencies are sorted and deduplicated', () => {
  const value = input(4); value.bindings[0].sourceObjectId = id(8); value.bindings[1].sourceObjectId = id(4); value.bindings[3].sourceObjectId = id(8);
  const result = createSceneBehaviorCreationDraft(value), body = JSON.parse(result.content);
  assert.equal(result.ok, true); assert.deepEqual(result.sourceObjectIds, [id(2), id(4), id(8)]);
  assert.deepEqual(body.bindings.map(binding => binding.bindingId), value.bindings.map(binding => binding.bindingId));
  assert.deepEqual(body.bindings.map(binding => binding.implementation.sourceObjectId), value.bindings.map(binding => binding.sourceObjectId));
  assert.deepEqual(createSceneBehaviorCreationDraft(value), result);
});
test('one scene instance may own several distinct bindings that reuse or mix sources', () => {
  const value = input(3); value.bindings.forEach(binding => { binding.instanceId = id(10); }); value.bindings[2].sourceObjectId = id(3);
  const result = createSceneBehaviorCreationDraft(value); assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.content).bindings.map(binding => binding.instanceId), [id(10), id(10), id(10)]);
  assert.deepEqual(result.sourceObjectIds, [id(2), id(3)]);
});
test('binding and source limits reuse the existing behavior format authority', () => {
  assert.equal(SCENE_BEHAVIOR_LIMITS.bindings, 32); assert.equal(SCENE_BEHAVIOR_LIMITS.sources, 8);
  const maximum = input(32); maximum.bindings.forEach((binding, index) => { binding.sourceObjectId = id(200 + index % 8); });
  const result = createSceneBehaviorCreationDraft(maximum);
  assert.equal(result.ok, true); assert.equal(JSON.parse(result.content).bindings.length, 32); assert.equal(result.sourceObjectIds.length, 8);
  rejected(input(0)); rejected(input(33));
  const excessive = input(9); excessive.bindings.forEach((binding, index) => { binding.sourceObjectId = id(200 + index); });
  assert.equal(rejected(excessive).diagnostics[0].propertyPath, '/bindings');
});
test('shared implementation remains backend-neutral without inferring execution support', () => {
  const value = { ...input(2), backendId: 'org.example.native', language: 'experimental_lang' }, result = createSceneBehaviorCreationDraft(value);
  assert.equal(result.ok, true);
  for (const binding of JSON.parse(result.content).bindings) {
    assert.equal(binding.implementation.backendId, value.backendId); assert.equal(binding.implementation.language, value.language);
    assert.deepEqual(binding.parameters, {}); assert.deepEqual(binding.events, []);
  }
});
test('invalid allocated identities and duplicate binding identities fail through normal diagnostics', () => {
  const duplicate = input(2); duplicate.bindings[1].bindingId = duplicate.bindings[0].bindingId;
  assert.equal(rejected(duplicate).diagnostics[0].propertyPath, '/bindings/1/bindingId');
  for (const sceneObjectId of ['', 'scene', id(0xab).toUpperCase(), {}, undefined, '\ud800']) rejected({ ...input(), sceneObjectId });
  for (const field of ['bindingId', 'instanceId', 'sourceObjectId']) for (const invalid of ['', 'missing', id(0xab).toUpperCase(), null, 123]) {
    const value = input(2); value.bindings[1][field] = invalid; rejected(value);
  }
});
test('malformed implementation identifiers are rejected instead of choosing a fallback backend', () => {
  for (const backendId of ['', 'godot', 'org.Godot', 'org.example.' , 'x'.repeat(193), {}, undefined]) rejected({ ...input(), backendId });
  for (const language of ['', 'GDScript', 'gd script', 'rust/', 'x'.repeat(65), [], false]) rejected({ ...input(), language });
});
test('top-level and binding records require exact complete fields with no injected author data', () => {
  for (const field of ['sceneObjectId', 'backendId', 'language', 'bindings']) { const value = input(); delete value[field]; rejected(value); }
  for (const field of ['format', 'schemaVersion', 'content', 'parameters']) rejected({ ...input(), [field]: 'extra' });
  for (const field of ['bindingId', 'instanceId', 'sourceObjectId']) { const value = input(); delete value.bindings[0][field]; rejected(value); }
  for (const field of ['implementation', 'parameters', 'events', 'extra']) { const value = input(); value.bindings[0][field] = {}; rejected(value); }
  for (const value of [null, [], true, 7, 'data', undefined]) rejected(value);
  for (const bindings of [null, {}, 'data', false]) rejected({ ...input(), bindings });
});
test('draft results are detached and deeply frozen without modifying caller data', () => {
  const value = input(2), before = structuredClone(value), result = createSceneBehaviorCreationDraft(value), snapshot = structuredClone(result);
  assert.deepEqual(value, before);
  value.bindings[0].instanceId = id(99); value.bindings[1].sourceObjectId = id(98); value.backendId = 'org.other.engine';
  assert.deepEqual(result, snapshot);
  for (const object of [result, result.sourceObjectIds, result.diagnostics]) assert.ok(Object.isFrozen(object));
  assert.throws(() => { result.sourceObjectIds.push(id(8)); }, TypeError);
  const failure = rejected(input(0));
  for (const object of [failure, failure.sourceObjectIds, failure.diagnostics, ...failure.diagnostics]) assert.ok(Object.isFrozen(object));
});
test('accessors and inherited serializers never run during record or array capture', () => {
  let calls = 0;
  const getter = input(); Object.defineProperty(getter, 'backendId', { enumerable: true, get() { calls++; return 'org.evil.engine'; } });
  const bindingGetter = input(); Object.defineProperty(bindingGetter.bindings[0], 'sourceObjectId', { enumerable: true, get() { calls++; return id(2); } });
  const arrayGetter = input(); Object.defineProperty(arrayGetter.bindings, '0', { enumerable: true, get() { calls++; return input().bindings[0]; } });
  const inherited = Object.assign(Object.create({ toJSON() { calls++; return input(); } }), input());
  const inheritedBinding = input(); inheritedBinding.bindings[0] = Object.assign(Object.create({ toJSON() { calls++; return {}; } }), inheritedBinding.bindings[0]);
  for (const value of [getter, bindingGetter, arrayGetter, inherited, inheritedBinding]) rejected(value);
  assert.equal(calls, 0);
});
test('sparse arrays, hidden fields, symbols, polluted records and revoked proxies fail closed', () => {
  const sparse = input(2); delete sparse.bindings[0];
  const extraArrayField = input(); extraArrayField.bindings.extra = 1;
  const hidden = input(); Object.defineProperty(hidden.bindings[0], 'instanceId', { enumerable: false, value: id(10) });
  const symbol = input(); symbol[Symbol('extra')] = 1;
  const polluted = input(); Object.defineProperty(polluted.bindings[0], '__proto__', { enumerable: true, value: {} });
  const cyclic = input(); cyclic.bindings[0].sourceObjectId = cyclic;
  for (const value of [sparse, extraArrayField, hidden, symbol, polluted, cyclic]) rejected(value);
  const revoked = Proxy.revocable(input(), {}); revoked.revoke(); rejected(revoked.proxy);
  let enumerations = 0; const huge = []; huge.length = 100000000;
  rejected({ ...input(), bindings: new Proxy(huge, { ownKeys() { enumerations++; throw new Error('Must reject length first'); } }) });
  assert.equal(enumerations, 0);
});
test('the helper only plans source; unresolved scene and script relationships stay outside its authority', () => {
  const value = input(); value.bindings[0].sourceObjectId = value.sceneObjectId;
  const result = createSceneBehaviorCreationDraft(value);
  assert.equal(result.ok, true, 'Source existence and dependency admissibility are checked by the existing catalog and World transaction');
  assert.equal(inspectSceneBehaviors(result.content).ok, true);
});
