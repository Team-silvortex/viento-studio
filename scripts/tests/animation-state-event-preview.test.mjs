import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAnimationStateEventPreview as create, evaluateAnimationStateEventPreview as evaluate, animationStateEventPreviewKeys as keys } from '../../engine/animation-state-event-preview.mjs';
const invalid = { errorCode: 'animation_state_event_preview_invalid' };
const leaf = (value = true, key, operator = 'eq') => ({ type: typeof value, operator, value, ...(key === undefined ? {} : { selector: { kind: 'projectState', key } }) });
const group = (combine, conditions) => ({ combine, conditions });
const edge = (condition, to = 'action', name = 'go', from = 'idle') => ({ from, to, trigger: { kind: 'event', name, ...(condition === undefined ? {} : { condition }) } });
const table = (transitions = [edge()], ordered = false) => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }, { key: 'other' }], transitions, ...(ordered ? { eventSelection: 'firstMatch' } : {}) });
const sample = (value = true, projectState = [], stateKey = 'idle', name = 'go') => ({ stateKey, event: { name, value }, projectState });
const run = (condition, value = true, projectState = []) => evaluate(create(table([edge(condition)])), sample(value, projectState));
function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
const sharedReads = result => result.candidates.flatMap(row => row.leaves.filter(row => row.status === 'evaluated' && row.condition.selector).map(row => row.condition.selector.key));

test('model admits a detached complete table and exposes original state/event order', () => {
  const source = table([edge(leaf(true, 'flag'), 'other', 'second'), edge(undefined, 'action', 'first'), { from: 'other', to: 'idle', trigger: { kind: 'completed' } }]);
  const before = structuredClone(source), model = create(source);
  assert.deepEqual(model, { table: before, states: [{ key: 'idle', index: 0 }, { key: 'action', index: 1 }, { key: 'other', index: 2 }], eventNames: ['second', 'first'] });
  source.transitions[0].trigger.condition.selector.key = 'changed'; assert.equal(model.table.transitions[0].trigger.condition.selector.key, 'flag'); frozen(model);
});

test('unconditional selection is a target proposal, including self-transition and no candidate', () => {
  const model = create(table([edge(undefined, 'idle')]));
  const result = evaluate(model, sample());
  assert.deepEqual(result.selected, { transitionIndex: 0, stateKey: 'idle' });
  assert.deepEqual(result.candidates, [{ transitionIndex: 0, from: 'idle', to: 'idle', kind: 'fallback', status: 'selected', leaves: [] }]);
  assert.deepEqual(evaluate(model, sample(true, [], 'idle', 'unknown')).candidates, []);
  assert.equal(evaluate(model, sample(true, [], 'action')).selected, null);
  assert.equal(Object.hasOwn(result, 'entered'), false); assert.equal(Object.hasOwn(result, 'played'), false); frozen(result);
});

test('firstMatch retains original transition indices and never evaluates a later selected branch', () => {
  const model = create(table([edge(leaf(5, undefined, 'gte')), { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
    edge(leaf(true, 'flag'), 'other'), edge(undefined, 'idle')], true));
  const result = evaluate(model, sample(2, [{ key: 'flag', value: true }]));
  assert.deepEqual(result.selected, { transitionIndex: 2, stateKey: 'other' });
  assert.deepEqual(result.candidates.map(row => [row.transitionIndex, row.status]), [[0, 'rejected'], [2, 'selected'], [3, 'not-evaluated']]);
  const first = evaluate(model, sample(5)); assert.deepEqual(first.candidates[1].leaves[0], { index: 0, condition: leaf(true, 'flag'), status: 'not-evaluated' });
  const fallback = evaluate(model, sample(false)); assert.equal(fallback.selected.transitionIndex, 3);
});

for (const combine of ['all', 'any']) test(`${combine} short-circuits only at the reached leaf and retains skipped leaf declarations`, () => {
  const guard = group(combine, [leaf(true, 'a'), leaf(true, 'b'), leaf(true, 'c')]);
  const first = combine === 'all' ? false : true;
  const result = run(guard, false, [{ key: 'a', value: first }, { key: 'b', value: !first }, { key: 'c', value: !first }]);
  assert.deepEqual(sharedReads(result), ['a']); assert.equal(result.selected !== null, first);
  assert.deepEqual(result.candidates[0].leaves.slice(1), [1, 2].map(index => ({ index, condition: guard.conditions[index], status: 'not-evaluated' })));
  const middle = run(guard, false, [{ key: 'a', value: !first }, { key: 'b', value: first }, { key: 'c', value: !first }]);
  assert.deepEqual(sharedReads(middle), ['a', 'b']);
  const last = run(guard, false, ['a', 'b', 'c'].map(key => ({ key, value: !first })));
  assert.deepEqual(sharedReads(last), ['a', 'b', 'c']); assert.equal(last.selected !== null, !first);
});

test('singleton groups preserve kind and repeated shared leaves remain separate reads', () => {
  assert.equal(run(group('any', [leaf()])).candidates[0].kind, 'any');
  const result = run(group('all', [leaf(true, 'same'), leaf(true, 'same')]), 0, [{ key: 'same', value: true }]);
  assert.deepEqual(sharedReads(result), ['same', 'same']); assert.deepEqual(result.candidates[0].leaves.map(row => row.index), [0, 1]);
});

test('missing shared state and type mismatch are nonmatches even for ne', () => {
  for (const constant of [true, 1, 'x']) {
    const missing = run(leaf(constant, 'missing', 'ne'), constant).candidates[0].leaves[0];
    assert.deepEqual(missing.actual, { status: 'missing' }); assert.equal(missing.matches, false); assert.equal(missing.reason, 'missing');
    for (const actual of [true, 1, 'x'].filter(value => typeof value !== typeof constant)) {
      const result = run(leaf(constant, 'key', 'ne'), constant, [{ key: 'key', value: actual }]).candidates[0].leaves[0];
      assert.equal(result.matches, false); assert.equal(result.reason, 'type-mismatch'); assert.deepEqual(result.actual, { status: 'present', value: actual });
    }
  }
});

test('false zero empty text and normalized negative zero are present values', () => {
  for (const value of [false, 0, '', -0]) {
    const result = run(leaf(value, 'key'), value, [{ key: 'key', value }]);
    assert.ok(result.selected); assert.equal(result.candidates[0].leaves[0].actual.status, 'present');
    assert.equal(Object.is(result.event.value, -0), false); assert.equal(Object.is(result.projectState[0].value, -0), false);
  }
});

test('exact Rust number comparison handles neighboring doubles and subnormal values', () => {
  for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, 1e-9, .1 + .2, 2 ** -53, 1e9, -1e9]) {
    assert.ok(run(leaf(value), value).selected); assert.equal(run(leaf(value, undefined, 'ne'), value).selected, null);
  }
  assert.equal(run(leaf(.3), .1 + .2).selected, null);
  assert.ok(run(leaf(.3, undefined, 'gt'), .1 + .2).selected);
});

test('Unicode NUL newlines and exact UTF8 boundaries survive the manual sample', () => {
  for (const value of ['前\0後🎮\n', '\0', 'x'.repeat(4096), '🎮'.repeat(1024)]) {
    const result = run(leaf(value), value); assert.ok(result.selected); assert.equal(result.event.value, value);
  }
  assert.equal(run(leaf('prefix\0suffix'), 'prefix').selected, null);
});

test('selector catalog is candidate-scoped deduplicated and does not select or evaluate', () => {
  const source = table([edge(group('any', [leaf(true, 'b'), leaf(true, 'a'), leaf(true, 'b')])), edge(leaf(1, 'z'), 'idle', 'other'), edge(leaf(true, 'c'), 'idle', 'go', 'action')]);
  const model = create(source);
  assert.deepEqual(keys(model, 'idle', 'go'), ['b', 'a']); assert.deepEqual(keys(model, 'action', 'go'), ['c']);
  assert.deepEqual(keys(model, 'idle', 'unknown'), []); frozen(keys(model, 'idle', 'go'));
});

test('samples detach from the caller and do not mutate a model or another trial', () => {
  const model = create(table([edge(leaf(true, 'flag'))])), input = sample(false, [{ key: 'flag', value: true }]);
  const before = JSON.stringify(model), result = evaluate(model, input); input.projectState[0].value = false; input.event.value = 1;
  assert.equal(result.projectState[0].value, true); assert.equal(result.event.value, false); assert.equal(JSON.stringify(model), before);
  assert.equal(evaluate(model, input).selected, null); assert.ok(result.selected); frozen(result);
});

test('every complete declaration is admitted before a hidden bad condition can be skipped', () => {
  for (const bad of [null, { combine: 'any', conditions: [] }, { combine: 'all', conditions: [leaf(), { ...leaf(), selector: { kind: 'other', key: 'x' } }] }, { ...leaf(), value: null }]) {
    assert.throws(() => create(table([edge(leaf()), edge(bad, 'other')], true)), invalid);
  }
  assert.throws(() => create(table([edge(), edge(leaf(), 'other')], true)), invalid);
  assert.throws(() => create(table([edge(leaf()), edge(leaf(), 'other')])), invalid);
  assert.throws(() => create(table([{ from: 'idle', to: 'action', trigger: { kind: 'completed', condition: leaf() } }])), invalid);
});

test('fake models unknown states and invalid or reserved event names reject', () => {
  const model = create(table());
  for (const value of [null, {}, { ...model }, structuredClone(model)]) {
    assert.throws(() => evaluate(value, sample()), invalid); assert.throws(() => keys(value, 'idle', 'go'), invalid);
  }
  for (const state of ['', 'Idle', 'unknown', null, 0]) assert.throws(() => evaluate(model, sample(true, [], state)), invalid);
  for (const name of ['', 'constructor', 'prototype', '__proto__', '1go', 'go\n', 'a'.repeat(65), null]) assert.throws(() => evaluate(model, sample(true, [], 'idle', name)), invalid);
});

test('exact sample records reject absent undefined null non-scalars and extra fields', () => {
  const model = create(table());
  const bad = [null, {}, { ...sample(), extra: 1 }, { ...sample(), stateKey: undefined }, { ...sample(), event: { name: 'go' } }, { ...sample(), event: { ...sample().event, extra: true } }, { ...sample(), projectState: {} }];
  for (const value of [null, [], {}, NaN, Infinity, -Infinity, 1e9 + 1, 'x'.repeat(4097), '\ud800', '\udc00']) {
    bad.push(sample(value), sample(true, [{ key: 'unused', value }]));
  }
  // Explicit undefined must not be replaced by the test helper's default.
  bad.push({ ...sample(), event: { name: 'go', value: undefined } });
  for (const input of bad) assert.throws(() => evaluate(model, input), invalid);
});

test('sample shared keys are exact unique and include unused entries in full admission', () => {
  const model = create(table());
  for (const entries of [[{ key: 'ok', value: true }, { key: 'ok', value: false }], [{ key: 'ok', value: null }], [{ key: 'ok', value: 1, extra: 2 }], [{ key: 'ok' }],
    ...['', 'constructor', 'prototype', '__proto__', 'x'.repeat(65), 'bad key'].map(key => [{ key, value: true }])]) {
    assert.throws(() => evaluate(model, sample(true, entries)), invalid);
  }
});

test('64 shared keys and 16384 payload bytes are exact bounds including key bytes', () => {
  const model = create(table()), entries = Array.from({ length: 64 }, (_, index) => ({ key: 'key' + index, value: false }));
  assert.equal(evaluate(model, sample(true, entries)).projectState.length, 64);
  assert.throws(() => evaluate(model, sample(true, [...entries, { key: 'extra', value: true }])), invalid);
  const boundary = ['a', 'b', 'c', 'd'].map(key => ({ key, value: 'x'.repeat(4095) }));
  assert.ok(evaluate(model, sample(true, boundary)).selected);
  boundary[0].value += 'x'; assert.throws(() => evaluate(model, sample(true, boundary)), invalid);
});

test('getters serializers sparse arrays symbols prototypes and cycles execute no hooks', () => {
  const model = create(table()); let calls = 0;
  const accessor = (object, key) => { Object.defineProperty(object, key, { enumerable: true, get() { calls++; throw Error('must not run'); } }); return object; };
  const samples = [accessor(sample(), 'event'), { ...sample(), event: accessor({ name: 'go' }, 'value') }, sample(true, [accessor({ key: 'key' }, 'value')]),
    { ...sample(), toJSON() { calls++; return sample(); } }, Object.assign(Object.create({ inherited: true }), sample()), sample(true, new Array(1))];
  const symbol = sample(); symbol[Symbol('extra')] = 1; samples.push(symbol);
  const cyclic = sample(); cyclic.projectState.push(cyclic); samples.push(cyclic);
  const hidden = sample(); Object.defineProperty(hidden, 'hidden', { value: true }); samples.push(hidden);
  for (const input of samples) assert.throws(() => evaluate(model, input), invalid);
  const badTable = table(); accessor(badTable.transitions[0].trigger, 'condition'); assert.throws(() => create(badTable), invalid);
  assert.equal(calls, 0);
});

test('the maximum 64 by 8 firstMatch trace stays bounded and visits all rejected leaves', () => {
  const condition = group('any', Array.from({ length: 8 }, () => leaf(true)));
  const model = create(table(Array.from({ length: 64 }, () => edge(condition)), true));
  const result = evaluate(model, sample(false));
  assert.equal(result.selected, null); assert.equal(result.candidates.length, 64);
  assert.equal(result.candidates.flatMap(row => row.leaves).filter(row => row.status === 'evaluated').length, 512);
});

test('missing comparison capability explicitly blocks conditional trial while unguarded and graph admission survive', async () => {
  const script = `import fs from 'node:fs/promises';
const original = WebAssembly.instantiate;
WebAssembly.instantiate = async (...args) => { const result = await original(...args); return { ...result, instance: { exports: { ...result.instance.exports, viento_core_animation_state_conditions_version: undefined } } }; };
await import('./scripts/adapters/node-studio-core.mjs');
const {createAnimationStateEventPreview:create,evaluateAnimationStateEventPreview:evaluate}=await import('./engine/animation-state-event-preview.mjs');
const table=${JSON.stringify(table([edge(group('all', [leaf()]))]))};
const model=create(table); let code=''; try {evaluate(model,${JSON.stringify(sample())});} catch(error) {code=error.errorCode;}
if(code!=='studio_core_unavailable')throw Error(code);
const plain=create(${JSON.stringify(table())}); if(!evaluate(plain,${JSON.stringify(sample())}).selected)throw Error('plain unavailable');
console.log('CAPABILITY_OK');`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('../../', import.meta.url), timeout: 30000 });
  assert.match(result.stdout, /CAPABILITY_OK/);
});
