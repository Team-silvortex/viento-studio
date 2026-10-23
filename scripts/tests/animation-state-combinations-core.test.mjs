import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectAnimationStateCombinedTable } from '../../engine/animation-state-combinations-core.mjs';
import { inspectAnimationStateDeclaration, inspectAnimationStateDeclarationWithSelectors, inspectAnimationStateDeclarationWithCombinations } from '../../engine/animation-state-conditions-core.mjs';
import { dispatchStudioCoreAnimationStateCombinations, supportsStudioCoreAnimationStateCombinations, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
const leaf = (type = 'boolean', operator = 'eq', value = true, key) => ({ type, operator, value,
  ...(key === undefined ? {} : { selector: { kind: 'projectState', key } }) });
const group = (combine = 'all', conditions = [leaf(), leaf('number', 'gte', .5, 'combat.speed')]) => ({ combine, conditions });
const table = (branches = false) => ({ ...(branches ? { eventSelection: 'firstMatch' } : {}), initialState: 'idle',
  states: [{ key: 'idle' }, { key: 'fast' }, { key: 'slow' }], transitions: [
    { from: 'idle', to: 'fast', trigger: { kind: 'event', name: 'go', condition: group() } },
    { from: 'fast', to: 'idle', trigger: { kind: 'completed' } },
    { from: 'idle', to: 'slow', trigger: { kind: 'event', name: branches ? 'go' : 'next', condition: group('any', [leaf('string', 'ne', 'locked', 'combat.mode'), leaf('boolean', 'eq', false)]) } },
    ...(branches ? [{ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go' } }] : []),
  ] });
const request = (value = table()) => ({ protocolVersion: 1, operation: 'animationStateTable.inspectCombined', table: value });
const expected = value => ({ table: structuredClone(value), states: value.states.map(({ key }, index) => ({ key, index })),
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
async function bridge(transform, { marker = 1, legacyMarkers = true } = {}) {
  const module = await import(`../../engine/studio-core.mjs?combination-forgery=${++bridgeIndex}`), memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let length = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      ...(legacyMarkers ? { viento_core_animation_state_table_version: () => 1, viento_core_animation_state_conditions_version: () => 1,
        viento_core_animation_state_branches_version: () => 1, viento_core_animation_state_selectors_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_animation_state_combinations_version: () => marker }),
      viento_core_input: size => { length = size; return 8; }, viento_core_output_len: () => outputLength,
      viento_core_run: () => { calls++; const input = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, 8, length)));
        const result = transform ? transform(wasm(input), input) : wasm(input), output = encoder.encode(typeof result === 'string' ? result : JSON.stringify(result));
        outputLength = output.length; new Uint8Array(memory.buffer, 1048576, outputLength).set(output); return 1048576; },
    } } });
    await module.initializeStudioCore(() => new Uint8Array([1]));
  } finally { WebAssembly.instantiate = original; }
  return { module, calls: () => calls };
}
function boundaryDeclarations() {
  const budget = value => encoder.encode(JSON.stringify(value)).length + value.transitions.reduce((sum, edge) => {
    const condition = edge.trigger.condition, leaves = Object.hasOwn(condition, 'combine') ? condition.conditions : [condition];
    return sum + leaves.reduce((bytes, leaf) => bytes + (typeof leaf.value === 'number' ? 32 - JSON.stringify(leaf.value).length : 0), 0);
  }, 0);
  const result = [];
  for (const branches of [false, true]) for (const number of [1e-6, .12345678901234567, Number.MIN_VALUE, -Number.MIN_VALUE, 1e9, -0.0000010000000000000002]) {
    const value = { ...(branches ? { eventSelection: 'firstMatch' } : {}), initialState: 'idle', states: [{ key: 'idle' }], transitions: [
      { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go', condition: group('all', Array.from({ length: 8 }, (_, index) => leaf('string', 'eq', index < 7 ? 'x'.repeat(4096) : '', index % 2 ? 'state.text' : undefined))) } },
      { from: 'idle', to: 'idle', trigger: { kind: 'event', name: branches ? 'go' : 'number', condition: group('any', Array.from({ length: 8 }, (_, index) => leaf('number', 'eq', number, index % 2 ? 'state.number' : undefined))) } },
      { from: 'idle', to: 'idle', trigger: { kind: 'event', name: branches ? 'go' : 'scalar', condition: leaf('number', 'ne', -number) } },
    ] };
    const remaining = 32768 - budget(value); assert.ok(remaining > 0 && remaining <= 4096);
    value.transitions[0].trigger.condition.conditions[7].value = '🔑'.repeat(Math.floor(remaining / 4)) + 'x'.repeat(remaining % 4);
    assert.equal(budget(value), 32768); result.push(value);
  }
  return result;
}

test('combined admission preserves all any singleton duplicate and ordered mixed leaf declarations', () => {
  assert.equal(core.viento_core_animation_state_combinations_version(), 1); assert.equal(supportsStudioCoreAnimationStateCombinations(), true);
  for (const branches of [false, true]) for (const combine of ['all', 'any']) for (const count of [1, 2, 8]) {
    const value = table(branches); value.transitions[0].trigger.condition = group(combine, Array.from({ length: count }, () => leaf('boolean', 'ne', false, 'combat.enabled')));
    const before = structuredClone(value), result = inspectAnimationStateCombinedTable(value);
    assert.deepEqual(result, expected(value)); assert.deepEqual(inspectAnimationStateDeclarationWithCombinations(value), result);
    assert.deepEqual(value, before); frozen(result);
    value.transitions[0].trigger.condition.conditions[0].selector.key = 'mutated';
    assert.equal(result.transitions[0].trigger.condition.conditions[0].selector.key, 'combat.enabled');
  }
});

test('new facade routes all group candidates first while both old facades keep refusing every group', () => {
  for (const branches of [false, true]) {
    const value = table(branches);
    for (const old of [inspectAnimationStateDeclaration, inspectAnimationStateDeclarationWithSelectors]) assert.throws(() => old(value), { errorCode: 'animation_state_table_invalid' });
    value.transitions[2].trigger.condition = leaf('number', 'eq', 1, 'other.key');
    assert.deepEqual(inspectAnimationStateDeclarationWithCombinations(value), expected(value), 'group and scalar guards may mix');
    value.transitions[0].trigger.condition = leaf();
    assert.deepEqual(inspectAnimationStateDeclarationWithCombinations(value), inspectAnimationStateDeclarationWithSelectors(value));
    assert.deepEqual(inspectAnimationStateCombinedTable(value), expected(value));
    for (const edge of value.transitions) delete edge.trigger.condition;
    if (branches) value.transitions = value.transitions.slice(0, 2);
    assert.deepEqual(inspectAnimationStateCombinedTable(value), expected(value));
  }
});

test('groups reject empty nested non-array oversized unknown and mixed scalar shapes without flattening', () => {
  for (const condition of [group('all', []), group('any', Array.from({ length: 9 }, () => leaf())), group('not'),
    { combine: 'all' }, { conditions: [leaf()] }, { combine: null, conditions: [leaf()] }, group('any', null), group('all', {}),
    { ...group(), selector: { kind: 'projectState', key: 'x' } }, { ...group(), type: 'boolean' }, { ...group(), extra: true },
    group('any', [leaf(), group()]), group('all', [leaf(), null]), group('any', [leaf(), []]), group('all', [leaf(), { ...leaf(), conditions: [] }])]) {
    const value = table(true); value.transitions[0].trigger.condition = condition;
    assert.throws(() => inspectAnimationStateDeclarationWithCombinations(value), { errorCode: 'animation_state_table_invalid' });
  }
});

test('every leaf retains scalar and shared key validation even behind a matching or duplicate leaf', () => {
  for (const bad of [leaf('boolean', 'gt', true), leaf('number', 'eq', '1'), leaf('number', 'gte', 1e9 + 1),
    leaf('string', 'lt', ''), leaf('string', 'eq', 'x'.repeat(4097)), { ...leaf(), extra: true },
    ...['', 'constructor', 'prototype', '__proto__', 'key\n', 'a/b', 'Z'.repeat(65)].map(key => leaf('boolean', 'eq', true, key)),
    { ...leaf(), selector: null }, { ...leaf(), selector: { kind: 'payload' } }, { ...leaf(), selector: { kind: 'projectState', key: 'ok', extra: true } }]) {
    const value = table(); value.transitions[0].trigger.condition.conditions[1] = bad;
    assert.throws(() => inspectAnimationStateCombinedTable(value), { errorCode: 'animation_state_table_invalid' });
  }
  const value = table(); value.transitions[0].trigger.condition.conditions = [leaf('string', 'ne', '\0\n🔑é"\\', 'Z'.repeat(64)), leaf('number', 'eq', -0)];
  const result = inspectAnimationStateCombinedTable(value); assert.ok(Object.is(value.transitions[0].trigger.condition.conditions[1].value, -0));
  assert.equal(Object.is(result.table.transitions[0].trigger.condition.conditions[1].value, -0), false);
  assert.equal(Object.is(result.transitions[0].trigger.condition.conditions[1].value, -0), false);
  assert.equal(result.transitions[0].trigger.condition.conditions[0].value, value.transitions[0].trigger.condition.conditions[0].value);
});

test('conditional groups preserve event uniqueness fallback finality completion bans and every original table field', () => {
  for (const mutate of [v => v.transitions[1].trigger.condition = group(), v => v.transitions.unshift(v.transitions.pop()),
    v => v.transitions.push(structuredClone(v.transitions[1])), v => v.transitions[2].to = 'missing',
    v => v.transitions[0].trigger.extra = true, v => v.transitions[0].extra = true,
    v => v.eventSelection = 'lastMatch', v => v.states[1].key = 'idle', v => v.initialState = 'missing', v => v.extra = true]) {
    const value = table(true); mutate(value); const before = structuredClone(value);
    assert.throws(() => inspectAnimationStateCombinedTable(value), { errorCode: 'animation_state_table_invalid' }); assert.deepEqual(value, before);
  }
  const value = table(); value.transitions[2].trigger.name = 'go';
  assert.throws(() => inspectAnimationStateCombinedTable(value), { errorCode: 'animation_state_table_invalid' });
  value.eventSelection = 'firstMatch'; assert.deepEqual(inspectAnimationStateCombinedTable(value), expected(value));
});

test('combined 32 KiB budget counts every group numeric leaf selectors and standalone scalar constant', () => {
  for (const value of boundaryDeclarations()) {
    assert.equal(wasm(request(value)).ok, true); assert.equal(inspectAnimationStateCombinedTable(value).transitions.length, 3);
    value.transitions[0].trigger.condition.conditions[7].value += 'x';
    assert.equal(wasm(request(value)).errorCode, 'animation_state_table_invalid');
    assert.throws(() => inspectAnimationStateCombinedTable(value), { errorCode: 'animation_state_table_invalid' });
  }
});

test('group cardinality composes with existing maximum 64 transitions and 32 unique events', () => {
  const value = table(true); value.transitions = Array.from({ length: 64 }, () => ({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go', condition: group('all', Array.from({ length: 8 }, () => leaf())) } }));
  assert.equal(inspectAnimationStateCombinedTable(value).transitions.length, 64);
  value.transitions.push(structuredClone(value.transitions[0])); assert.throws(() => inspectAnimationStateCombinedTable(value), { errorCode: 'animation_state_table_invalid' });
  value.transitions = Array.from({ length: 32 }, (_, index) => ({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: `e${index}`, condition: group() } }));
  assert.equal(inspectAnimationStateCombinedTable(value).eventNames.length, 32);
  value.transitions.push({ ...structuredClone(value.transitions[0]), trigger: { kind: 'event', name: 'extra', condition: group() } });
  assert.throws(() => inspectAnimationStateCombinedTable(value), { errorCode: 'animation_state_table_invalid' });
});

test('group probing and every nested leaf refuse accessors inherited serializers sparse arrays without execution', () => {
  let calls = 0;
  for (const mutate of [v => Object.defineProperty(v.transitions[0].trigger.condition, 'combine', { enumerable: true, get() { calls++; return 'all'; } }),
    v => Object.defineProperty(v.transitions[0].trigger.condition, 'conditions', { enumerable: true, get() { calls++; return []; } }),
    v => Object.defineProperty(v.transitions[0].trigger.condition.conditions, '1', { enumerable: true, get() { calls++; return leaf(); } }),
    v => Object.defineProperty(v.transitions[0].trigger.condition.conditions[1].selector, 'key', { enumerable: true, get() { calls++; return 'x'; } }),
    v => v.transitions[0].trigger.condition.conditions[1].toJSON = () => { calls++; return leaf(); },
    v => Object.setPrototypeOf(v.transitions[0].trigger.condition, { combine: 'all' }),
    v => Object.defineProperty(v.transitions[0].trigger.condition, 'conditions', { enumerable: false, value: [] }),
    v => delete v.transitions[0].trigger.condition.conditions[1]]) {
    const value = table(true); mutate(value);
    assert.throws(() => inspectAnimationStateDeclarationWithCombinations(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0); const value = table(); Object.setPrototypeOf(value.transitions[0].trigger.condition.conditions[1], null);
  assert.deepEqual(inspectAnimationStateCombinedTable(value), expected(table()));
});

test('combined envelopes and raw duplicate group leaf selector keys retain strict rejection and recovery', () => {
  for (const value of [{ ...request(), extra: 1 }, { ...request(), protocolVersion: 2 }, { ...request(), operation: 'animationStateTable.inspectSelected' }, null, []]) {
    assert.throws(() => dispatchStudioCoreAnimationStateCombinations(value), { errorCode: 'studio_core_request_invalid' });
  }
  const raw = JSON.stringify(request());
  for (const [from, to] of [['"combine":', '"combine":null,"combi\\u006ee":'], ['"conditions":', '"conditions":[],"conditions":'],
    ['"operator":', '"operator":"ne","operator":'], ['"key":"combat.speed"', '"key":"other","key":"combat.speed"']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
  assert.equal(wasm(raw.replace('combat.speed', '\\uD800')).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm('\uFEFF' + raw).errorCode, 'studio_core_request_invalid'); assert.equal(wasm(request()).ok, true);
});

test('missing or unsupported combinations markers never borrow old markers and legacy selected remains usable', async () => {
  for (const marker of [null, 0, 2]) {
    const fake = await bridge(null, { marker }); assert.equal(fake.module.supportsStudioCoreAnimationStateCombinations(), false);
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateCombinations(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.calls(), 0); assert.equal(fake.module.getStudioCoreMetadata().ready, true);
    const value = table(true); for (const edge of value.transitions) if (edge.trigger.condition) edge.trigger.condition = edge.trigger.condition.conditions[1];
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateSelectors({ ...request(value), operation: 'animationStateTable.inspectSelected' }), expected(value));
  }
});

test('combinations marker independently admits groups mixed leaves and plain declarations without any older markers', async () => {
  const fake = await bridge(null, { legacyMarkers: false }); assert.equal(fake.module.supportsStudioCoreAnimationStateCombinations(), true);
  for (const method of ['supportsStudioCoreAnimationStateTable', 'supportsStudioCoreAnimationStateConditions', 'supportsStudioCoreAnimationStateBranches', 'supportsStudioCoreAnimationStateSelectors']) assert.equal(fake.module[method](), false);
  for (const branches of [false, true]) {
    const value = table(branches); assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateCombinations(request(value)), expected(value));
    value.transitions[2].trigger.condition = leaf('number', 'eq', 1, 'state.value');
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateCombinations(request(value)), expected(value));
    value.transitions[0].trigger.condition = leaf(); assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateCombinations(request(value)), expected(value));
  }
});

test('receipts bind complete group shape ordered leaf values and selectors in table and indexed IR', async () => {
  for (const target of ['table', 'indexed']) for (const mutate of [c => c.combine = 'any', c => c.conditions.reverse(), c => c.conditions.pop(),
    c => c.conditions.push(structuredClone(c.conditions[0])), c => c.conditions[0].operator = 'ne', c => c.conditions[0].value = false,
    c => c.conditions[1].selector.key = 'other', c => delete c.conditions[1].selector,
    c => c.conditions[0].selector = { kind: 'projectState', key: 'added' }, c => c.extra = true,
    c => c.conditions[1] = structuredClone(c.conditions[0])]) {
    const fake = await bridge(result => { mutate((target === 'table' ? result.animationStateTable.table : result.animationStateTable).transitions[0].trigger.condition); return result; });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateCombinations(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.module.getStudioCoreMetadata().ready, false);
  }
  for (const mutate of [r => r.extra = true, r => r.animationStateTable.extra = true,
    r => delete r.animationStateTable.transitions[0].trigger.condition, r => r.animationStateTable.table.transitions[0].trigger.condition = leaf(),
    r => r.animationStateTable.transitions.reverse(), r => r.animationStateTable.states.reverse(),
    r => r.animationStateTable.transitions[0].toIndex = 2, r => r.animationStateTable.eventNames.push('extra')]) {
    const fake = await bridge(result => { mutate(result); return result; });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateCombinations(request()), { errorCode: 'studio_core_unavailable' });
  }
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('forged success cannot bypass group shape leaf validity fallback geometry or whole-declaration budget', async () => {
  const oversized = boundaryDeclarations()[0]; oversized.transitions[0].trigger.condition.conditions[7].value += 'x';
  const values = [oversized];
  for (const mutate of [v => v.transitions[0].trigger.condition.conditions = [],
    v => v.transitions[0].trigger.condition.conditions = Array.from({ length: 9 }, () => leaf()),
    v => v.transitions[0].trigger.condition.conditions[1] = group(),
    v => v.transitions[0].trigger.condition.conditions[1].selector.key = 'constructor',
    v => v.transitions[0].trigger.condition.conditions[1].value = '0.5',
    v => v.transitions[0].trigger.condition.selector = { kind: 'projectState', key: 'x' },
    v => v.transitions.unshift(v.transitions.pop()), v => v.transitions[1].trigger.condition = group(),
    v => v.eventSelection = 'lastMatch', v => v.extra = true]) { const value = table(true); mutate(value); values.push(value); }
  for (const value of values) {
    const fake = await bridge(() => ({ protocolVersion: 1, ok: true, animationStateTable: expected(value) }));
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateCombinations(request(value)), { errorCode: 'studio_core_unavailable' });
  }
});

test('normalized negative zero is checked in every group leaf before placeholder substitution', async () => {
  for (const index of [0, 1, 7]) for (const selected of [false, true]) for (const target of ['table', 'indexed']) {
    const value = table(); value.transitions[0].trigger.condition.conditions = Array.from({ length: 8 }, () => leaf('number', 'eq', 0, selected ? 'numeric.value' : undefined));
    const fake = await bridge(result => {
      (target === 'table' ? result.animationStateTable.table : result.animationStateTable).transitions[0].trigger.condition.conditions[index].value = 'negative-zero';
      return JSON.stringify(result).replace('"negative-zero"', '-0');
    });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateCombinations(request(value)), { errorCode: 'studio_core_unavailable' });
  }
});

const nativePath = process.env.VIENTO_ANIMATION_STATE_COMBINATIONS_CORE_NATIVE;
test('native CLI and WASM agree on full group budgets mixed conditions malformed source and recovery', { skip: !nativePath }, async () => {
  const values = [request(), request(table(true)), request(null), ...boundaryDeclarations().map(request)];
  for (const condition of [group('all', []), group('any', [leaf(), group()]), group('any', Array.from({ length: 9 }, () => leaf())), group('all', [leaf('number', 'eq', -0, 'numeric.value')])]) {
    const value = table(); value.transitions[0].trigger.condition = condition; values.push(request(value));
  }
  for (const value of boundaryDeclarations()) { value.transitions[0].trigger.condition.conditions[7].value += 'x'; values.push(request(value)); }
  const inputs = values.map(JSON.stringify);
  inputs.push(inputs[0].replace('"combine":', '"combine":null,"combine":'), '\uFEFF' + inputs[0], inputs[0]);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim().split('\n').map(JSON.parse)) : reject(new Error(stderr)));
    child.stdin.end(inputs.join('\n') + '\n');
  });
  assert.equal(output.length, inputs.length);
  for (const [index, input] of inputs.entries()) assert.deepEqual(output[index], wasm(input));
});
