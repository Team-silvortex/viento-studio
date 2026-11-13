import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeSceneBehaviorBindingCopy } from '../../engine/scene-behavior-binding-copy.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const clone = value => structuredClone(value);
const rejected = error => error instanceof TypeError && error.errorCode === 'scene_behavior_binding_copy_invalid';
function input() {
  return { bindings: [
    { bindingId: id(1), instanceId: id(11), sourceObjectId: id(21),
      parameters: [{ key: 'target_instance_id', type: 'string', value: id(11) }, { key: 'enabled', type: 'boolean', value: 'false' },
        { key: 'amount', type: 'number', value: '-0' }, { key: 'note', type: 'string', value: '  第一行\r\n第二行\rthird\n  ' }],
      events: [{ signal: 'entered', event: 'collected' }, { signal: 'left', event: 'released' }] },
    { bindingId: id(2), instanceId: id(12), sourceObjectId: id(22), parameters: [], events: [] },
  ], sourceBindingId: id(1), targetInstanceId: id(12), bindingId: id(3),
  instances: [{ instanceId: id(11), objectId: id(31), name: 'Same actor definition' },
    { instanceId: id(12), objectId: id(31), name: 'Same actor definition' }], sourceObjectIds: [id(21), id(22)] };
}

test('copy selects the explicit repeated instance and retains authored parameters, references and signal order', () => {
  const request = input(), before = clone(request), result = proposeSceneBehaviorBindingCopy(request);
  assert.deepEqual(result, { ...before.bindings[0], bindingId: id(3), instanceId: id(12) });
  assert.equal(result.parameters[0].value, id(11), 'UUID-shaped parameter values remain authored text');
  assert.equal(result.sourceObjectId, id(21)); assert.deepEqual(request, before);
  assert.equal(Object.hasOwn(result, 'objectId'), false, 'the shared actor definition cannot become the copy target');
});

test('copy snapshots the latest supplied local draft, including unfinished or semantically invalid fields', () => {
  const request = input(); request.bindings[0].parameters = [
    { key: '', type: 'string', value: '' }, { key: 'bad name / unfinished', type: 'number', value: '1e-' },
    { key: 'enabled', type: 'boolean', value: '' }, { key: 'enabled', type: 'boolean', value: 'false' },
    { key: 'zero', type: 'number', value: '0' }, { key: 'negative_zero', type: 'number', value: '-0' },
    { key: 'constructor', type: 'string', value: 'ordinary text pending review' },
  ]; request.bindings[0].events = [{ signal: '', event: 'not finished / yet' }];
  const result = proposeSceneBehaviorBindingCopy(request);
  assert.deepEqual(result.parameters, request.bindings[0].parameters); assert.deepEqual(result.events, request.bindings[0].events);
});

test('long authored text remains a local draft without being truncated to semantic scalar limits', () => {
  const request = input(); request.bindings[0].parameters[0].value = 'long authored draft '.repeat(350);
  assert.ok(request.bindings[0].parameters[0].value.length > 4096);
  assert.equal(proposeSceneBehaviorBindingCopy(request).parameters[0].value, request.bindings[0].parameters[0].value);
  request.bindings[0].parameters[0].value = 'a'.repeat(32768);
  assert.equal(proposeSceneBehaviorBindingCopy(request).parameters[0].value.length, 32768);
});

test('every returned draft is detached from caller data and from another copy', () => {
  const request = input(), before = clone(request), first = proposeSceneBehaviorBindingCopy(request), second = proposeSceneBehaviorBindingCopy({ ...request, bindingId: id(4) });
  first.parameters[0].key = 'first_only'; first.parameters[1].value = 'true'; first.events[0].event = 'first_only'; first.parameters.push({ key: 'extra', type: 'string', value: '' });
  assert.deepEqual(request, before); assert.deepEqual(second.parameters, before.bindings[0].parameters); assert.deepEqual(second.events, before.bindings[0].events);
  request.bindings[0].parameters[0].value = 'later'; request.bindings[0].events[1].event = 'later';
  assert.equal(second.parameters[0].value, id(11)); assert.equal(second.events[1].event, 'released');
});

test('the owner may explicitly choose the same instance or a different script-bearing binding', () => {
  const same = input(); same.targetInstanceId = id(11); assert.equal(proposeSceneBehaviorBindingCopy(same).instanceId, id(11));
  const other = input(); other.sourceBindingId = id(2); other.targetInstanceId = id(11);
  assert.deepEqual(proposeSceneBehaviorBindingCopy(other), { ...other.bindings[1], bindingId: id(3), instanceId: id(11) });
});

test('missing or colliding identities and unavailable instance or script sources fail without mutation', () => {
  const changes = [value => { value.bindingId = id(1); }, value => { value.sourceBindingId = id(99); },
    value => { value.targetInstanceId = id(31); }, value => { value.targetInstanceId = id(99); },
    value => { value.sourceObjectIds = [id(22)]; }, value => { value.instances.shift(); },
    value => { value.bindings[1].bindingId = id(1); }, value => { value.instances.push(clone(value.instances[0])); },
    value => { value.sourceObjectIds.push(id(21)); }, value => { value.sourceObjectIds = []; }, value => { value.instances = []; }];
  for (const change of changes) { const request = input(); change(request); const before = clone(request); assert.throws(() => proposeSceneBehaviorBindingCopy(request), rejected); assert.deepEqual(request, before); }
  for (const field of ['bindingId', 'sourceBindingId', 'targetInstanceId']) {
    for (const value of ['', id(1).toUpperCase().replace('00000000', 'ABCDEF00'), 'not-uuid', null]) {
      assert.throws(() => proposeSceneBehaviorBindingCopy({ ...input(), [field]: value }), rejected);
    }
  }
});

test('binding and row limits permit a final thirty-second binding, never an over-budget copy', () => {
  const request = input(); request.bindings = Array.from({ length: 31 }, (_, index) => ({ ...clone(request.bindings[0]), bindingId: id(100 + index) }));
  request.sourceBindingId = id(100); request.bindings[0].parameters = Array.from({ length: 32 }, (_, index) => ({ key: 'p' + index, type: 'string', value: '' }));
  request.bindings[0].events = Array.from({ length: 8 }, (_, index) => ({ signal: 's' + index, event: 'e' + index }));
  const result = proposeSceneBehaviorBindingCopy(request); assert.equal(result.parameters.length, 32); assert.equal(result.events.length, 8);
  const excessParameters = clone(request); excessParameters.bindings[0].parameters.push({ key: '', type: 'string', value: '' });
  const excessEvents = clone(request); excessEvents.bindings[0].events.push({ signal: '', event: '' });
  const full = clone(request); full.bindings.push({ ...clone(full.bindings[0]), bindingId: id(131) });
  for (const value of [excessParameters, excessEvents, full, { ...input(), bindings: [] }]) assert.throws(() => proposeSceneBehaviorBindingCopy(value), rejected);
});

test('catalog limits support repeated definitions without unbounded or duplicate entries', () => {
  const request = input(); request.instances = Array.from({ length: 128 }, (_, index) => ({ instanceId: id(index + 11), objectId: id(31), name: 'Same definition' }));
  request.sourceObjectIds = Array.from({ length: 256 }, (_, index) => id(index + 21));
  assert.equal(proposeSceneBehaviorBindingCopy(request).instanceId, id(12));
  const largeInstances = clone(request); largeInstances.instances.push({ instanceId: id(999), objectId: id(31), name: 'Too many' });
  const largeSources = clone(request); largeSources.sourceObjectIds.push(id(999));
  for (const value of [largeInstances, largeSources]) assert.throws(() => proposeSceneBehaviorBindingCopy(value), rejected);
});

test('bounded Unicode text is retained literally while invalid Unicode, values and field types are rejected', () => {
  const request = input(); request.bindings[0].parameters[0].value = '😀'.repeat(2048);
  assert.equal(proposeSceneBehaviorBindingCopy(request).parameters[0].value, request.bindings[0].parameters[0].value);
  const changes = [value => { value.bindings[0].parameters[0].value = 'a'.repeat(32769); },
    value => { value.bindings[0].parameters[0].value = '\ud800'; }, value => { value.bindings[0].parameters[0].key = '\udfff'; },
    value => { value.bindings[0].events[0].signal = '\ud800'; }, value => { value.instances[0].name = '\ud800'; },
    value => { value.bindings[0].parameters[0].value = false; }, value => { value.bindings[0].parameters[0].type = 'object'; },
    value => { value.bindings[0].parameters[0].key = 4; }, value => { value.bindings[0].events[0].event = {}; },
    value => { value.bindings[0].sourceObjectId = 'not registered'; }];
  for (const change of changes) { const value = input(); change(value); assert.throws(() => proposeSceneBehaviorBindingCopy(value), rejected); }
});

test('exact data records reject extra fields, inherited data, symbols, sparse arrays and serializers', () => {
  const changes = [value => { value.extra = true; }, value => { value.bindings[0].extra = true; },
    value => { value.bindings[0].parameters[0].identity = 1; }, value => { value.bindings[0].parameters[0][Symbol('row')] = 1; },
    value => { value.bindings[0].events[0].extra = true; }, value => { value.instances[0].extra = true; },
    value => { delete value.bindings[0].parameters[0]; }, value => { value.bindings[0].parameters.extra = true; },
    value => { value.sourceObjectIds[Symbol('extra')] = true; }, value => { value.bindings[0] = Object.create(value.bindings[0]); },
    value => { value.bindings[0].parameters = Object.assign(Object.create({ inherited: true }), value.bindings[0].parameters); },
    value => { value.toJSON = () => { throw Error('must not execute'); }; }];
  for (const change of changes) { const value = input(); change(value); assert.throws(() => proposeSceneBehaviorBindingCopy(value), rejected); }
});

test('accessors at every input boundary are rejected without invoking them', () => {
  let calls = 0;
  const targets = [value => [value, 'bindings'], value => [value.bindings, '0'], value => [value.bindings[0], 'parameters'],
    value => [value.bindings[0].parameters, '0'], value => [value.bindings[0].parameters[0], 'value'],
    value => [value.bindings[0].events[0], 'event'], value => [value.instances, '0'], value => [value.instances[0], 'instanceId'],
    value => [value.sourceObjectIds, '0']];
  for (const target of targets) {
    const value = input(), [record, field] = target(value);
    Object.defineProperty(record, field, { configurable: true, enumerable: true, get() { calls++; throw Error('accessor executed'); } });
    assert.throws(() => proposeSceneBehaviorBindingCopy(value), rejected);
  }
  assert.equal(calls, 0);
});

test('null-prototype data records and dense arrays work without inherited serializers', () => {
  const value = input(); Object.setPrototypeOf(value, null); Object.setPrototypeOf(value.bindings[0], null);
  Object.setPrototypeOf(value.bindings[0].parameters[0], null); Object.setPrototypeOf(value.instances[0], null);
  Object.setPrototypeOf(value.bindings, null); Object.setPrototypeOf(value.sourceObjectIds, null);
  const result = proposeSceneBehaviorBindingCopy(value); assert.equal(result.parameters[0].value, id(11)); assert.equal(result.instanceId, id(12));
});
