import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectAnimationStateTable } from '../../engine/animation-state-table-core.mjs';
import { inspectAnimationStateDeclaration, inspectAnimationStateCondition, evaluateAnimationStateCondition } from '../../engine/animation-state-conditions-core.mjs';
import { dispatchStudioCoreAnimationStateConditions, supportsStudioCoreAnimationStateConditions, getStudioCoreMetadata } from '../../engine/studio-core.mjs';

const condition = (type = 'number', operator = 'gte', value = 0.5) => ({ type, operator, value });
const table = () => ({ initialState: 'action', states: [{ key: 'idle' }, { key: 'action' }, { key: 'isolated' }], transitions: [
  { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'go', condition: condition() } },
  { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
  { from: 'action', to: 'action', trigger: { kind: 'event', name: 'go', condition: condition('boolean', 'eq', true) } },
] });
const inspectRequest = value => ({ protocolVersion: 1, operation: 'animationStateCondition.inspect', condition: value });
const evaluateRequest = (check, value) => ({ protocolVersion: 1, operation: 'animationStateCondition.evaluate', condition: check, value });
const tableRequest = (value = table()) => ({ protocolVersion: 1, operation: 'animationStateTable.inspectConditional', table: value });
const expectedTable = value => ({ table: structuredClone(value), states: value.states.map(({ key }, index) => ({ key, index })),
  initialIndex: value.states.findIndex(({ key }) => key === value.initialState), transitions: value.transitions.map(edge => ({
    fromIndex: value.states.findIndex(({ key }) => key === edge.from), toIndex: value.states.findIndex(({ key }) => key === edge.to), trigger: structuredClone(edge.trigger),
  })), eventNames: [...new Set(value.transitions.filter(edge => edge.trigger.kind === 'event').map(edge => edge.trigger.name))] });
function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
const { instance: { exports: core } } = await WebAssembly.instantiate(await fs.readFile(new URL('../../engine/studio-core.wasm', import.meta.url)), {});
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function wasm(input) {
  const bytes = encoder.encode(typeof input === 'string' ? input : JSON.stringify(input)), at = core.viento_core_input(bytes.length) >>> 0;
  new Uint8Array(core.memory.buffer, at, bytes.length).set(bytes); const output = core.viento_core_run() >>> 0;
  return JSON.parse(decoder.decode(new Uint8Array(core.memory.buffer, output, core.viento_core_output_len())));
}
let bridgeIndex = 0;
async function bridge(transform, { marker = 1 } = {}) {
  const module = await import(`../../engine/studio-core.mjs?condition-forgery=${++bridgeIndex}`), memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let length = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      viento_core_animation_state_table_version: () => 1,
      ...(marker === null ? {} : { viento_core_animation_state_conditions_version: () => marker }),
      viento_core_input: size => { length = size; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => { calls++; const input = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, 8, length)));
        const result = transform ? transform(wasm(input), input) : wasm(input), output = encoder.encode(typeof result === 'string' ? result : JSON.stringify(result));
        outputLength = output.length; new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576; },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}
function neighbor(value, direction) {
  const bytes = new ArrayBuffer(8), view = new DataView(bytes); view.setFloat64(0, value, true);
  view.setBigUint64(0, view.getBigUint64(0, true) + BigInt(direction), true); return view.getFloat64(0, true);
}
const fraction = 0.12345678901234567;
function comparisonVectors() {
  const vectors = [];
  for (const [operator, expected] of [['eq', [false, true, false]], ['ne', [true, false, true]], ['lt', [true, false, false]],
    ['lte', [true, true, false]], ['gt', [false, false, true]], ['gte', [false, true, true]]]) {
    for (const [index, value] of [neighbor(fraction, -1), fraction, neighbor(fraction, 1)].entries()) vectors.push([condition('number', operator, fraction), value, expected[index]]);
  }
  for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, 1e-7, -1e-7, 1e9, -1e9, 0, -0, 0.0000010000000000000002, -0.0000010000000000000002]) vectors.push([condition('number', 'eq', value), value, true]);
  for (const [type, value, other] of [['boolean', true, false], ['string', '', 'x'], ['string', '🔑\0\n"\\é', '🔑\0\n"\\é'], ['number', 1, 2]]) {
    for (const operator of ['eq', 'ne']) {
      vectors.push([condition(type, operator, value), value, operator === 'eq'], [condition(type, operator, value), other, operator === 'ne']);
      for (const mismatch of [true, 1, '1']) if (typeof mismatch !== type) vectors.push([condition(type, operator, value), mismatch, false]);
    }
  }
  return vectors;
}

function boundaryDeclarations() {
  const budget = table => new TextEncoder().encode(JSON.stringify(table)).length + table.transitions.reduce((total, edge) =>
    total + (typeof edge.trigger.condition.value === 'number' ? 32 - JSON.stringify(edge.trigger.condition.value).length : 0), 0);
  const result = [];
  for (const number of [1e-6, fraction, Number.MIN_VALUE, -Number.MIN_VALUE, 1e9, -1e9, -0, -0.0000010000000000000002]) for (const unicode of [false, true]) {
    const value = { initialState: 'idle', states: [{ key: 'idle' }], transitions: Array.from({ length: 8 }, (_, index) => ({
      from: 'idle', to: 'idle', trigger: { kind: 'event', name: `e${index}`, condition: condition('string', 'eq', index < 7 ? 'x'.repeat(4096) : '') },
    })) };
    value.transitions.push({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'number', condition: condition('number', 'eq', number) } });
    const remaining = 32768 - budget(value); assert.ok(remaining > 0 && remaining <= 4096);
    value.transitions[7].trigger.condition.value = unicode ? '🔑'.repeat(Math.floor(remaining / 4)) + 'x'.repeat(remaining % 4) : 'x'.repeat(remaining);
    assert.equal(budget(value), 32768); result.push(value);
  }
  return result;
}

test('conditional byte budgets agree at ASCII and Unicode boundaries despite number serialization differences', () => {
  assert.equal(JSON.stringify(-0.0000010000000000000002).length, 25);
  assert.equal(boundaryDeclarations().length, 16);
  for (const value of boundaryDeclarations()) {
    assert.equal(wasm(tableRequest(value)).ok, true);
    assert.equal(inspectAnimationStateDeclaration(value).transitions.length, 9);
    const over = structuredClone(value); over.transitions[7].trigger.condition.value += 'x';
    assert.equal(wasm(tableRequest(over)).errorCode, 'animation_state_table_invalid');
    assert.throws(() => inspectAnimationStateDeclaration(over), { errorCode: 'animation_state_table_invalid' });
    const under = structuredClone(value); under.transitions[7].trigger.condition.value = [...under.transitions[7].trigger.condition.value].slice(0, -1).join('');
    assert.equal(wasm(tableRequest(under)).ok, true);
  }
});

test('conditional declarations add an independent marker and retain the exact legacy operation and indices', () => {
  assert.equal(core.viento_core_protocol_version(), 1); assert.equal(core.viento_core_animation_state_table_version(), 1);
  assert.equal(core.viento_core_animation_state_conditions_version(), 1); assert.equal(supportsStudioCoreAnimationStateConditions(), true);
  const value = table(), before = structuredClone(value), result = inspectAnimationStateDeclaration(value);
  assert.deepEqual(result, expectedTable(value)); assert.deepEqual(value, before); frozen(result);
  assert.throws(() => inspectAnimationStateTable(value), { errorCode: 'animation_state_table_invalid' });
  for (const edge of value.transitions) delete edge.trigger.condition;
  assert.deepEqual(inspectAnimationStateDeclaration(value), inspectAnimationStateTable(value));
  assert.deepEqual(dispatchStudioCoreAnimationStateConditions(tableRequest(value)), inspectAnimationStateTable(value));
  value.states[0].key = 'changed'; assert.equal(result.states[0].key, 'idle');
});

test('condition inspection is exact deeply frozen and normalizes negative zero without changing caller data', () => {
  for (const value of [condition('boolean', 'eq', false), condition('string', 'ne', ''), condition('number', 'gte', -0)]) {
    const before = structuredClone(value), result = inspectAnimationStateCondition(value);
    assert.deepEqual(Object.keys(result).sort(), ['operator', 'type', 'value']); frozen(result); assert.deepEqual(value, before);
    assert.equal(result.value, value.value === 0 ? 0 : value.value); assert.equal(Object.is(result.value, -0), false);
  }
  const value = table(); value.transitions[0].trigger.condition.value = -0;
  const result = inspectAnimationStateDeclaration(value);
  assert.equal(Object.is(result.table.transitions[0].trigger.condition.value, -0), false);
  assert.equal(Object.is(result.transitions[0].trigger.condition.value, -0), false); assert.ok(Object.is(value.transitions[0].trigger.condition.value, -0));
});

test('Rust and WASM comparisons agree on typed mismatch exact double values neighboring ULPs subnormals and zero', () => {
  for (const [check, value, matches] of comparisonVectors()) {
    assert.equal(evaluateAnimationStateCondition(check, value), matches, JSON.stringify([check, value]));
    assert.equal(wasm(evaluateRequest(check, value)).animationStateCondition.matches, matches);
  }
});

test('bounded scalar strings preserve Unicode and reject invalid values and operators rather than coercing', () => {
  for (const value of ['', 'x'.repeat(4096), '🔑'.repeat(1024), '\0\n\r\t\b\f"\\']) {
    assert.equal(evaluateAnimationStateCondition(condition('string', 'eq', value), value), true);
  }
  for (const check of [null, [], {}, { ...condition(), extra: true }, { ...condition(), type: 'Number' }, { ...condition(), operator: 'gte\n' },
    condition('boolean', 'gt', true), condition('string', 'lte', ''), condition('number', 'eq', '1'), condition('string', 'eq', 'x'.repeat(4097)),
    condition('string', 'eq', '🔑'.repeat(1025)), condition('number', 'eq', 1e9 + 1)]) {
    assert.throws(() => inspectAnimationStateCondition(check), { errorCode: 'animation_state_condition_invalid' });
  }
  for (const value of [null, [], {}, 1e9 + 1, 'x'.repeat(4097)]) assert.throws(() => evaluateAnimationStateCondition(condition(), value), { errorCode: 'animation_state_condition_invalid' });
  for (const value of [NaN, Infinity, undefined]) assert.throws(() => evaluateAnimationStateCondition(condition(), value), { errorCode: 'studio_core_request_invalid' });
  assert.throws(() => inspectAnimationStateCondition(condition('string', 'eq', '\uD800')), { errorCode: 'studio_core_request_invalid' });
});

test('conditional tables reject completed predicates ambiguous events unknown fields and original over-budget content atomically', () => {
  for (const mutate of [v => v.transitions[0].trigger.condition = null, v => v.transitions[0].trigger.condition.operator = 'unknown',
    v => v.transitions[1].trigger.condition = condition(), v => v.transitions.push({ ...structuredClone(v.transitions[0]), to: 'isolated' }),
    v => v.transitions[0].trigger.name = 'go\n', v => v.initialState = 'missing', v => v.states[1].key = 'idle',
    v => v.transitions[0].condition = condition(), v => v.transitions[0].trigger.extra = true,
    v => v.transitions = Array.from({ length: 9 }, (_, i) => ({ from: 'idle', to: 'action', trigger: { kind: 'event', name: `e${i}`, condition: condition('string', 'eq', 'x'.repeat(4096)) } }))]) {
    const value = table(); mutate(value); const before = structuredClone(value);
    assert.throws(() => inspectAnimationStateDeclaration(value), { errorCode: 'animation_state_table_invalid' }); assert.deepEqual(value, before);
  }
  for (const value of [null, [], true, 1, 'bad']) assert.equal(wasm(tableRequest(value)).errorCode, 'animation_state_table_invalid');
  assert.deepEqual(inspectAnimationStateDeclaration(table()), expectedTable(table()), 'invalid tables cannot poison recovery');
});

test('generic declaration selection inspects only own descriptors without invoking getters serializers or inherited data', () => {
  let calls = 0;
  for (const mutate of [v => Object.defineProperty(v, 'transitions', { enumerable: true, get() { calls++; return []; } }),
    v => Object.defineProperty(v.transitions[0], 'trigger', { enumerable: true, get() { calls++; return {}; } }),
    v => Object.defineProperty(v.transitions[0].trigger, 'condition', { enumerable: true, get() { calls++; return condition(); } }),
    v => Object.defineProperty(v.transitions[0].trigger.condition, 'value', { enumerable: true, get() { calls++; return .5; } }),
    v => v.toJSON = () => { calls++; return {}; }, v => delete v.transitions[0],
    v => Object.setPrototypeOf(v.transitions[0].trigger.condition, { value: 1 })]) {
    const value = table(); mutate(value); assert.throws(() => inspectAnimationStateDeclaration(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0); const value = table(); Object.setPrototypeOf(value, null);
  assert.deepEqual(inspectAnimationStateDeclaration(value), expectedTable(table()));
});

test('new operation envelopes and raw duplicate escaped keys retain strict admission and recovery', () => {
  for (const input of [{ ...inspectRequest(condition()), protocolVersion: 2 }, { ...inspectRequest(condition()), value: 1 },
    { ...evaluateRequest(condition(), 1), extra: 1 }, { protocolVersion: 1, operation: 'animationStateCondition.evaluate', condition: condition() },
    { ...tableRequest(), operation: 'animationStateTable.inspect' }, null, []]) {
    assert.throws(() => dispatchStudioCoreAnimationStateConditions(input), { errorCode: 'studio_core_request_invalid' });
  }
  const raw = JSON.stringify(evaluateRequest(condition(), .5));
  for (const [from, to] of [['"type":', '"type":"number","ty\\u0070e":'], ['"operator":', '"operator":"eq","operator":'],
    ['"condition":', '"condition":null,"condition":'], ['"protocolVersion":', '"protocolVersion":2,"protocolVersion":']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
  assert.equal(wasm('\uFEFF' + raw).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm(JSON.stringify(inspectRequest(condition('string', 'eq', 'safe'))).replace('safe', '\\uD800')).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm(evaluateRequest(condition(), .5)).animationStateCondition.matches, true);
});

test('absent and unknown condition markers leave all legacy operations usable and never invent predicate support', async () => {
  const plain = table(); for (const edge of plain.transitions) delete edge.trigger.condition;
  for (const marker of [null, 0, 2]) {
    const fake = await bridge(null, { marker }); assert.equal(fake.module.supportsStudioCoreAnimationStateConditions(), false);
    for (const request of [inspectRequest(condition()), evaluateRequest(condition(), 1), tableRequest()]) assert.throws(() => fake.module.dispatchStudioCoreAnimationStateConditions(request), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.calls(), 0); assert.equal(fake.module.getStudioCoreMetadata().ready, true);
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateTable({ protocolVersion: 1, operation: 'animationStateTable.inspect', table: plain }), expectedTable(plain));
    assert.equal(fake.module.getStudioCoreMetadata().ready, true);
  }
});

test('forged condition receipts cannot drop change or add operands and result fields', async () => {
  for (const [request, mutators] of [[inspectRequest(condition()), [r => r.extra = true, r => r.animationStateCondition.extra = true,
    r => delete r.animationStateCondition.condition.value, r => r.animationStateCondition.condition.value = 0.25,
    r => r.animationStateCondition.condition.operator = 'lt', r => r.animationStateCondition.condition.type = 'string']],
    [evaluateRequest(condition(), .5), [r => delete r.animationStateCondition.matches, r => r.animationStateCondition.matches = 1,
      r => r.animationStateCondition.value = .75, r => r.animationStateCondition.value = '.5', r => r.animationStateCondition.condition.extra = 1]]]) {
    for (const mutate of mutators) {
      const fake = await bridge(value => { mutate(value); return value; });
      assert.throws(() => fake.module.dispatchStudioCoreAnimationStateConditions(request), { errorCode: 'studio_core_unavailable' });
      assert.equal(fake.module.getStudioCoreMetadata().ready, false);
    }
  }
  for (const check of [condition('boolean', 'lt', true), condition('number', 'eq', '1'), { ...condition(), extra: true }]) {
    const fake = await bridge(() => ({ protocolVersion: 1, ok: true, animationStateCondition: { condition: check } }));
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateConditions(inspectRequest(check)), { errorCode: 'studio_core_unavailable' });
  }
});

test('forged conditional table receipts remain bound to every condition source and deterministic legacy index', async () => {
  for (const mutate of [r => delete r.animationStateTable.table.transitions[0].trigger.condition,
    r => delete r.animationStateTable.transitions[0].trigger.condition, r => r.animationStateTable.transitions[0].trigger.condition.value = .75,
    r => r.animationStateTable.table.transitions[0].trigger.condition.operator = 'lt', r => r.animationStateTable.states.reverse(),
    r => r.animationStateTable.initialIndex = 0, r => r.animationStateTable.transitions.reverse(), r => r.animationStateTable.table.states[0].key = 'other',
    r => r.animationStateTable.transitions[1].trigger.condition = condition(), r => r.animationStateTable.transitions[0].extra = true]) {
    const fake = await bridge(value => { mutate(value); return value; });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateConditions(tableRequest()), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.module.getStudioCoreMetadata().ready, false);
  }
  const fake = await bridge(); assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateConditions(tableRequest()), expectedTable(table()));
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('forged negative-zero receipts cannot disappear through JSON cloning before normalization checks', async () => {
  const value = table(); value.transitions[0].trigger.condition.value = 0;
  for (const mutate of [r => r.animationStateTable.table.transitions[0].trigger.condition.value = 'negative-zero',
    r => r.animationStateTable.transitions[0].trigger.condition.value = 'negative-zero']) {
    const fake = await bridge(result => { mutate(result); return JSON.stringify(result).replace('"negative-zero"', '-0'); });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateConditions(tableRequest(value)), { errorCode: 'studio_core_unavailable' });
  }
  for (const mutate of [r => r.animationStateCondition.condition.value = 'negative-zero', r => r.animationStateCondition.value = 'negative-zero']) {
    const fake = await bridge(result => { mutate(result); return JSON.stringify(result).replace('"negative-zero"', '-0'); });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateConditions(evaluateRequest(condition('number', 'eq', 0), 0)), { errorCode: 'studio_core_unavailable' });
  }
});

const nativePath = process.env.VIENTO_ANIMATION_STATE_CONDITIONS_CORE_NATIVE;
test('native CLI and WASM have identical conditional tables normalization comparisons raw errors and recovery', { skip: !nativePath }, async () => {
  const inputs = [tableRequest(), ...comparisonVectors().map(([check, value]) => evaluateRequest(check, value)),
    inspectRequest(condition('string', 'eq', '🔑'.repeat(1024))), inspectRequest(condition('number', 'eq', -0)),
    inspectRequest(condition('boolean', 'gt', true)), tableRequest(null), evaluateRequest(condition(), null)].map(JSON.stringify);
  for (const table of boundaryDeclarations()) {
    inputs.push(JSON.stringify(tableRequest(table)));
    const over = structuredClone(table); over.transitions[7].trigger.condition.value += 'x'; inputs.push(JSON.stringify(tableRequest(over)));
  }
  inputs.push(inputs[1].replace('"operator":', '"operator":"eq","operator":'),
    JSON.stringify(inspectRequest(condition('string', 'eq', 'safe'))).replace('safe', '\\uD800'), '\uFEFF' + inputs[0], inputs[0]);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000); child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); }); child.stdin.end(inputs.join('\n') + '\n');
  });
  assert.equal(output.status, 0, output.stderr); assert.equal(output.signal, null);
  assert.deepEqual(output.stdout.trim().split('\n').map(JSON.parse), inputs.map(wasm));
});
