import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectExecutionBudget, PROJECT_EXECUTION_BUDGET_POLICY } from '../../engine/project-execution-budget.mjs';

const policy = { eventRegistrations: 1024, eventPublishes: 128, eventDeliveries: 1024, eventBytes: 524288,
  stateMutations: 1024, audioRequests: 256, animationRequests: 256 };
const empty = () => Object.fromEntries(Object.keys(policy).map(key => [key, 0]));
const rejected = (budget, costs) => {
  const before = budget.snapshot();
  assert.equal(budget.reserve(costs), false);
  assert.deepEqual(budget.snapshot(), before);
};

test('finite admission policy is frozen and owns no protocol identity or reset operation', () => {
  assert.deepEqual(PROJECT_EXECUTION_BUDGET_POLICY, policy);
  assert.ok(Object.isFrozen(PROJECT_EXECUTION_BUDGET_POLICY));
  assert.throws(() => { PROJECT_EXECUTION_BUDGET_POLICY.eventPublishes = 1000; }, TypeError);
  const budget = createProjectExecutionBudget();
  assert.ok(Object.isFrozen(budget));
  assert.deepEqual(Object.keys(budget), ['reserve', 'snapshot']);
  assert.deepEqual(budget.snapshot(), empty());
});

test('one vector commits all seven independent dimensions and accepts their exact finite boundary', () => {
  const budget = createProjectExecutionBudget();
  assert.equal(budget.reserve(policy), true);
  assert.deepEqual(budget.snapshot(), policy);
  for (const dimension of Object.keys(policy)) rejected(budget, { [dimension]: 1 });
  assert.equal(budget.reserve({}), true);
  assert.equal(budget.reserve(empty()), true);
  assert.deepEqual(budget.snapshot(), policy);
});

test('every exhausted dimension rejects a mixed vector without consuming any earlier or later cost', () => {
  for (const [dimension, maximum] of Object.entries(policy)) {
    const budget = createProjectExecutionBudget();
    assert.equal(budget.reserve({ [dimension]: maximum }), true);
    const candidates = Object.fromEntries(Object.keys(policy).map(key => [key, 1]));
    rejected(budget, candidates);
    rejected(budget, Object.fromEntries(Object.entries(candidates).reverse()));
    delete candidates[dimension];
    assert.equal(budget.reserve(candidates), true);
    assert.deepEqual(budget.snapshot(), { ...empty(), ...candidates, [dimension]: maximum });
  }
});

test('unknown dimensions and invalid scalar costs reject atomically', () => {
  const budget = createProjectExecutionBudget();
  for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', true, null, undefined, {}, [], 1n]) {
    rejected(budget, { eventPublishes: 1, audioRequests: value, stateMutations: 1 });
  }
  for (const costs of [{ unknown: 1 }, { eventPublishes: 1, unknown: 0 }, { sequence: 1 }, { constructor: 1 },
    { eventBytes: Number.MAX_SAFE_INTEGER }, { [Symbol('eventPublishes')]: 1 }, null, undefined, false, 1, '1', [],
    new Date(), () => {}, Object.create({ eventPublishes: 1 })]) rejected(budget, costs);
  assert.equal(budget.reserve({ eventPublishes: 1, audioRequests: 1, stateMutations: 1 }), true);
  assert.deepEqual(budget.snapshot(), { ...empty(), eventPublishes: 1, audioRequests: 1, stateMutations: 1 });
});

test('descriptors are validated without invoking accessors or serialization hooks', () => {
  const budget = createProjectExecutionBudget();
  let calls = 0;
  rejected(budget, { eventPublishes: 1, get audioRequests() { calls++; return 1; } });
  rejected(budget, { eventPublishes: 1, toJSON() { calls++; return {}; } });
  rejected(budget, Object.defineProperty({ eventPublishes: 1 }, 'audioRequests', { value: 1 }));
  rejected(budget, Object.defineProperty({ eventPublishes: 1 }, '__proto__', { value: 1, enumerable: true }));
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); rejected(budget, proxy);
  assert.equal(calls, 0);
  const plain = Object.assign(Object.create(null), { eventPublishes: 1, eventBytes: 7 });
  assert.equal(budget.reserve(Object.freeze(plain)), true);
  assert.deepEqual(budget.snapshot(), { ...empty(), eventPublishes: 1, eventBytes: 7 });
});

test('input vectors and frozen snapshot copies cannot alias accumulated admission', () => {
  const budget = createProjectExecutionBudget(), input = { stateMutations: 1 };
  const first = budget.snapshot();
  assert.equal(budget.reserve(input), true);
  input.stateMutations = 99;
  const second = budget.snapshot();
  assert.ok(Object.isFrozen(second));
  assert.throws(() => { second.stateMutations = 0; }, TypeError);
  assert.equal(budget.reserve({ audioRequests: 2 }), true);
  assert.deepEqual(first, empty());
  assert.deepEqual(second, { ...empty(), stateMutations: 1 });
  assert.deepEqual(budget.snapshot(), { ...empty(), stateMutations: 1, audioRequests: 2 });
  assert.notEqual(budget.snapshot(), budget.snapshot());
  assert.deepEqual(createProjectExecutionBudget().snapshot(), empty());
});

test('unrelated operations and snapshots never replenish a consumed finite budget', () => {
  const budget = createProjectExecutionBudget();
  for (let index = 0; index < policy.eventPublishes; index++) {
    assert.equal(budget.reserve({ eventPublishes: 1 }), true);
    assert.equal(budget.reserve({ stateMutations: 1, audioRequests: 1, animationRequests: 1 }), true);
    assert.equal(budget.snapshot().eventPublishes, index + 1);
  }
  rejected(budget, { eventPublishes: 1, eventBytes: 1 });
  assert.equal(budget.reserve({ eventBytes: policy.eventBytes }), true);
  assert.equal(budget.snapshot().eventPublishes, 128);
  assert.equal(budget.snapshot().eventBytes, policy.eventBytes);
});
