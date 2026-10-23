import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectAnimationStateSelectedTable } from '../../engine/animation-state-selectors-core.mjs';
import { inspectAnimationStateDeclaration, inspectAnimationStateDeclarationWithSelectors } from '../../engine/animation-state-conditions-core.mjs';
import { dispatchStudioCoreAnimationStateSelectors, supportsStudioCoreAnimationStateSelectors,
  dispatchStudioCoreAnimationStateBranches, dispatchStudioCoreAnimationStateConditions, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
const condition = (key = 'combat.enabled', type = 'boolean', operator = 'eq', value = true) => ({ type, operator, value, selector: { kind: 'projectState', key } });
const table = (branches = false) => ({ ...(branches ? { eventSelection: 'firstMatch' } : {}), initialState: 'idle',
  states: [{ key: 'idle' }, { key: 'fast' }, { key: 'slow' }], transitions: [
    { from: 'idle', to: 'fast', trigger: { kind: 'event', name: 'go', condition: condition() } },
    { from: 'fast', to: 'idle', trigger: { kind: 'completed' } },
    { from: 'idle', to: 'slow', trigger: { kind: 'event', name: branches ? 'go' : 'next', condition: condition('combat.speed', 'number', 'gte', .2) } },
    ...(branches ? [{ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go' } }] : []),
  ] });
const request = (value = table()) => ({ protocolVersion: 1, operation: 'animationStateTable.inspectSelected', table: value });
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
  const module = await import(`../../engine/studio-core.mjs?selector-forgery=${++bridgeIndex}`), memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let length = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      ...(legacyMarkers ? { viento_core_animation_state_table_version: () => 1, viento_core_animation_state_conditions_version: () => 1,
        viento_core_animation_state_branches_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_animation_state_selectors_version: () => marker }),
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
  const budget = value => encoder.encode(JSON.stringify(value)).length + value.transitions.reduce((sum, edge) =>
    sum + (typeof edge.trigger.condition.value === 'number' ? 32 - JSON.stringify(edge.trigger.condition.value).length : 0), 0);
  const result = [];
  for (const branches of [false, true]) for (const number of [1e-6, .12345678901234567, Number.MIN_VALUE, -Number.MIN_VALUE, 1e9, -0.0000010000000000000002]) {
    const value = { ...(branches ? { eventSelection: 'firstMatch' } : {}), initialState: 'idle', states: [{ key: 'idle' }],
      transitions: Array.from({ length: 8 }, (_, index) => ({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: branches ? 'go' : `e${index}`,
        condition: condition(`state.${index}`, 'string', 'eq', index < 7 ? 'x'.repeat(4096) : '') } })) };
    value.transitions.push({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: branches ? 'go' : 'number', condition: condition('state.number', 'number', 'eq', number) } });
    const remaining = 32768 - budget(value); assert.ok(remaining > 0 && remaining <= 4096);
    value.transitions[7].trigger.condition.value = '🔑'.repeat(Math.floor(remaining / 4)) + 'x'.repeat(remaining % 4);
    assert.equal(budget(value), 32768); result.push(value);
  }
  return result;
}

test('selected unique and ordered tables preserve every selector index source value and immutable IR', () => {
  assert.equal(core.viento_core_animation_state_selectors_version(), 1); assert.equal(supportsStudioCoreAnimationStateSelectors(), true);
  for (const branches of [false, true]) {
    const value = table(branches), before = structuredClone(value), result = inspectAnimationStateSelectedTable(value);
    assert.deepEqual(result, expected(value)); assert.deepEqual(inspectAnimationStateDeclarationWithSelectors(value), result);
    assert.deepEqual(value, before); frozen(result); value.transitions[0].trigger.condition.selector.key = 'mutated';
    assert.equal(result.table.transitions[0].trigger.condition.selector.key, 'combat.enabled');
  }
});

test('new authoring route selects independent capability before branches while old admission refuses selectors', () => {
  for (const branches of [false, true]) {
    const value = table(branches);
    assert.throws(() => inspectAnimationStateDeclaration(value), { errorCode: 'animation_state_table_invalid' });
    assert.throws(() => dispatchStudioCoreAnimationStateConditions({ ...request(value), operation: 'animationStateTable.inspectConditional' }), { errorCode: 'animation_state_table_invalid' });
    if (branches) assert.throws(() => dispatchStudioCoreAnimationStateBranches({ ...request(value), operation: 'animationStateTable.inspectBranches' }), { errorCode: 'animation_state_table_invalid' });
    delete value.transitions[2].trigger.condition.selector;
    assert.deepEqual(inspectAnimationStateDeclarationWithSelectors(value), expected(value), 'shared and payload may mix');
    delete value.transitions[0].trigger.condition.selector;
    assert.deepEqual(inspectAnimationStateDeclarationWithSelectors(value), inspectAnimationStateDeclaration(value));
    assert.deepEqual(inspectAnimationStateSelectedTable(value), expected(value), 'explicit new capability also admits payload-only drafts');
  }
});

test('project selectors accept exactly the existing bounded shared-state key namespace', () => {
  for (const key of ['a', 'A', 'combat.enabled', 'a_B-9.z', 'constructor.child', 'Constructor', 'Z'.repeat(64)]) {
    const value = table(); value.transitions[0].trigger.condition.selector.key = key;
    assert.equal(inspectAnimationStateSelectedTable(value).transitions[0].trigger.condition.selector.key, key);
  }
  for (const key of ['', '_a', '9a', 'constructor', 'prototype', '__proto__', 'a/b', 'a b', 'a\n', 'a\0', 'é', 'Z'.repeat(65), null, 1]) {
    const value = table(); value.transitions[0].trigger.condition.selector.key = key;
    assert.throws(() => inspectAnimationStateDeclarationWithSelectors(value), { errorCode: 'animation_state_table_invalid' });
  }
  for (const selector of [null, [], true, {}, { kind: 'payload' }, { kind: 'projectState' }, { key: 'ok' }, { kind: 'projectState', key: 'ok', extra: 1 }]) {
    const value = table(true); value.transitions[0].trigger.condition.selector = selector;
    assert.throws(() => inspectAnimationStateDeclarationWithSelectors(value), { errorCode: 'animation_state_table_invalid' });
  }
});

test('typed scalar bounds fallback order completed uniqueness and original table rules remain strict', () => {
  for (const mutate of [v => v.transitions[0].trigger.condition.value = 1, v => v.transitions[0].trigger.condition.operator = 'gt',
    v => v.transitions[0].trigger.condition.extra = true, v => v.transitions[1].trigger.condition = condition(),
    v => v.transitions[2].trigger.condition = condition('ok', 'number', 'eq', 1e9 + 1),
    v => v.transitions[2].trigger.condition = condition('ok', 'string', 'ne', 'x'.repeat(4097)),
    v => v.transitions[2].to = 'missing', v => v.transitions[0].trigger.extra = true,
    v => v.transitions.unshift(v.transitions.pop()), v => v.transitions.push(structuredClone(v.transitions[1])),
    v => v.eventSelection = 'lastMatch', v => v.extra = true]) {
    const value = table(true); mutate(value); const before = structuredClone(value);
    assert.throws(() => inspectAnimationStateSelectedTable(value), { errorCode: 'animation_state_table_invalid' }); assert.deepEqual(value, before);
  }
  const unique = table(); unique.transitions[2].trigger.name = 'go';
  assert.throws(() => inspectAnimationStateSelectedTable(unique), { errorCode: 'animation_state_table_invalid' });
  const value = table(); value.transitions[2].trigger.condition.value = -0;
  const result = inspectAnimationStateSelectedTable(value); assert.ok(Object.is(value.transitions[2].trigger.condition.value, -0));
  assert.equal(Object.is(result.table.transitions[2].trigger.condition.value, -0), false);
  assert.equal(Object.is(result.transitions[2].trigger.condition.value, -0), false);
  value.transitions[2].trigger.condition = condition('ok', 'string', 'eq', '\0\n🔑é"\\');
  assert.deepEqual(inspectAnimationStateSelectedTable(value), expected(value));
});

test('selected declaration 32 KiB includes complete selectors and conservative numeric UTF-8 budgets', () => {
  for (const value of boundaryDeclarations()) {
    assert.equal(wasm(request(value)).ok, true); assert.equal(inspectAnimationStateSelectedTable(value).transitions.length, 9);
    value.transitions[7].trigger.condition.value += 'x';
    assert.equal(wasm(request(value)).errorCode, 'animation_state_table_invalid');
    assert.throws(() => inspectAnimationStateSelectedTable(value), { errorCode: 'animation_state_table_invalid' });
    for (const edge of value.transitions) delete edge.trigger.condition.selector;
    assert.deepEqual(inspectAnimationStateDeclaration(value), expected(value), 'removing selectors shows they consumed the rejected budget');
  }
});

test('selector probing never executes getters serializers inherited fields or sparse array slots', () => {
  let calls = 0;
  for (const mutate of [v => Object.defineProperty(v.transitions[0].trigger.condition, 'selector', { enumerable: true, get() { calls++; return { kind: 'projectState', key: 'ok' }; } }),
    v => Object.defineProperty(v.transitions[0].trigger.condition.selector, 'key', { enumerable: true, get() { calls++; return 'ok'; } }),
    v => Object.defineProperty(v.transitions[0].trigger, 'condition', { enumerable: true, get() { calls++; return condition(); } }),
    v => Object.defineProperty(v, 'transitions', { enumerable: true, get() { calls++; return []; } }),
    v => v.transitions[0].trigger.condition.selector.toJSON = () => { calls++; return {}; },
    v => Object.setPrototypeOf(v.transitions[0].trigger.condition, { selector: { kind: 'projectState', key: 'other' } }),
    v => Object.defineProperty(v.transitions[0].trigger.condition, 'selector', { enumerable: false, value: null }),
    v => delete v.transitions[0]]) {
    const value = table(true); mutate(value);
    assert.throws(() => inspectAnimationStateDeclarationWithSelectors(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0);
  const value = table(); Object.setPrototypeOf(value.transitions[0].trigger.condition.selector, null);
  assert.deepEqual(inspectAnimationStateDeclarationWithSelectors(value), expected(table()));
});

test('selected request envelopes duplicate selector keys invalid Unicode and recovery stay strict', () => {
  for (const value of [{ ...request(), extra: 1 }, { ...request(), protocolVersion: 2 }, { ...request(), operation: 'animationStateTable.inspectBranches' }, null, []]) {
    assert.throws(() => dispatchStudioCoreAnimationStateSelectors(value), { errorCode: 'studio_core_request_invalid' });
  }
  const raw = JSON.stringify(request());
  for (const [from, to] of [['"selector":', '"selector":null,"sel\\u0065ctor":'], ['"key":"combat.enabled"', '"key":"other","key":"combat.enabled"']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
  assert.equal(wasm(raw.replace('combat.enabled', '\\uD800')).errorCode, 'studio_core_request_invalid');
  assert.equal(wasm('\uFEFF' + raw).errorCode, 'studio_core_request_invalid'); assert.equal(wasm(request()).ok, true);
});

test('unknown or missing selector marker never borrows old capabilities and leaves legacy usable', async () => {
  for (const marker of [null, 0, 2]) {
    const fake = await bridge(null, { marker }); assert.equal(fake.module.supportsStudioCoreAnimationStateSelectors(), false);
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateSelectors(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.calls(), 0); assert.equal(fake.module.getStudioCoreMetadata().ready, true);
    const value = table(true); for (const edge of value.transitions) if (edge.trigger.condition) delete edge.trigger.condition.selector;
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateBranches({ ...request(value), operation: 'animationStateTable.inspectBranches' }), expected(value));
  }
});

test('selector marker independently admits unique branches mixed and plain drafts without older markers', async () => {
  const fake = await bridge(null, { legacyMarkers: false }); assert.equal(fake.module.supportsStudioCoreAnimationStateSelectors(), true);
  for (const method of ['supportsStudioCoreAnimationStateTable', 'supportsStudioCoreAnimationStateConditions', 'supportsStudioCoreAnimationStateBranches']) assert.equal(fake.module[method](), false);
  for (const branches of [false, true]) {
    const value = table(branches);
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateSelectors(request(value)), expected(value));
    delete value.transitions[2].trigger.condition.selector;
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateSelectors(request(value)), expected(value));
    delete value.transitions[0].trigger.condition.selector;
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateSelectors(request(value)), expected(value));
  }
});

test('selected receipts bind selectors in both table and indexed IR and reject loss change injection or movement', async () => {
  for (const mutate of [r => r.extra = true, r => r.animationStateTable.extra = true,
    r => delete r.animationStateTable.table.transitions[0].trigger.condition.selector,
    r => delete r.animationStateTable.transitions[0].trigger.condition.selector,
    r => r.animationStateTable.table.transitions[0].trigger.condition.selector.key = 'other',
    r => r.animationStateTable.transitions[0].trigger.condition.selector.kind = 'payload',
    r => r.animationStateTable.transitions[0].trigger.condition.selector.extra = true,
    r => [r.animationStateTable.transitions[0].trigger.condition.selector, r.animationStateTable.transitions[2].trigger.condition.selector]
      = [r.animationStateTable.transitions[2].trigger.condition.selector, r.animationStateTable.transitions[0].trigger.condition.selector],
    r => r.animationStateTable.table.transitions[0].trigger.condition.value = false,
    r => r.animationStateTable.transitions[0].toIndex = 2,
    r => r.animationStateTable.transitions.reverse(), r => r.animationStateTable.eventNames.push('forged'),
    r => delete r.animationStateTable.table.eventSelection]) {
    const fake = await bridge(result => { mutate(result); return result; });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateSelectors(request(table(true))), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.module.getStudioCoreMetadata().ready, false);
  }
  const value = table(); delete value.transitions[2].trigger.condition.selector;
  for (const target of ['table', 'indexed']) {
    const fake = await bridge(result => {
      (target === 'table' ? result.animationStateTable.table : result.animationStateTable).transitions[2].trigger.condition.selector = { kind: 'projectState', key: 'added' }; return result;
    });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateSelectors(request(value)), { errorCode: 'studio_core_unavailable' });
  }
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('forged selected success cannot bypass selector shape full byte budget scalar fallback or table admission', async () => {
  const oversized = boundaryDeclarations()[0]; oversized.transitions[7].trigger.condition.value += 'x';
  const invalid = [oversized];
  for (const mutate of [v => v.transitions[0].trigger.condition.selector = null,
    v => v.transitions[0].trigger.condition.selector.key = 'constructor', v => v.transitions[0].trigger.condition.selector.extra = true,
    v => v.transitions[0].trigger.condition.extra = true, v => v.transitions[0].trigger.condition.value = 1,
    v => v.transitions.unshift(v.transitions.pop()), v => v.transitions[1].trigger.condition = condition(),
    v => v.extra = true, v => v.eventSelection = 'lastMatch']) { const value = table(true); mutate(value); invalid.push(value); }
  for (const value of invalid) {
    const fake = await bridge(() => ({ protocolVersion: 1, ok: true, animationStateTable: expected(value) }));
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateSelectors(request(value)), { errorCode: 'studio_core_unavailable' });
  }
});

test('forged selected negative zero remains detectable in selected and payload conditions before cloning', async () => {
  for (const selected of [true, false]) for (const target of ['table', 'indexed']) {
    const value = table(); value.transitions[2].trigger.condition.value = 0; if (!selected) delete value.transitions[2].trigger.condition.selector;
    const fake = await bridge(result => {
      (target === 'table' ? result.animationStateTable.table : result.animationStateTable).transitions[2].trigger.condition.value = 'negative-zero';
      return JSON.stringify(result).replace('"negative-zero"', '-0');
    });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateSelectors(request(value)), { errorCode: 'studio_core_unavailable' });
  }
});

const nativePath = process.env.VIENTO_ANIMATION_STATE_SELECTORS_CORE_NATIVE;
test('native CLI and WASM agree on selectors complete budgets mixed tables and raw failures', { skip: !nativePath }, async () => {
  const values = [request(), request(table(true)), request(null), ...boundaryDeclarations().map(request)];
  for (const key of ['', 'constructor', 'Z'.repeat(65), 'Combat.ready']) { const value = table(); value.transitions[0].trigger.condition.selector.key = key; values.push(request(value)); }
  for (const value of boundaryDeclarations()) { value.transitions[7].trigger.condition.value += 'x'; values.push(request(value)); }
  const inputs = values.map(JSON.stringify);
  inputs.push(inputs[0].replace('"selector":', '"selector":null,"selector":'), '\uFEFF' + inputs[0], inputs[0]);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim().split('\n').map(JSON.parse)) : reject(new Error(stderr)));
    child.stdin.end(inputs.join('\n') + '\n');
  });
  assert.equal(output.length, inputs.length);
  for (const [index, input] of inputs.entries()) assert.deepEqual(output[index], wasm(input));
});
