import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { inspectAnimationStateBranches } from '../../engine/animation-state-branches-core.mjs';
import { inspectAnimationStateTable } from '../../engine/animation-state-table-core.mjs';
import { inspectAnimationStateDeclaration } from '../../engine/animation-state-conditions-core.mjs';
import { dispatchStudioCoreAnimationStateBranches, dispatchStudioCoreAnimationStateConditions,
  supportsStudioCoreAnimationStateBranches, getStudioCoreMetadata } from '../../engine/studio-core.mjs';
const condition = (type = 'number', operator = 'gte', value = .5) => ({ type, operator, value });
const table = () => ({ eventSelection: 'firstMatch', initialState: 'idle', states: [{ key: 'idle' }, { key: 'fast' }, { key: 'slow' }], transitions: [
  { from: 'idle', to: 'fast', trigger: { kind: 'event', name: 'go', condition: condition('number', 'gte', .8) } },
  { from: 'fast', to: 'idle', trigger: { kind: 'completed' } },
  { from: 'idle', to: 'slow', trigger: { kind: 'event', name: 'go', condition: condition('number', 'gte', .2) } },
  { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go' } },
] });
const request = (value = table()) => ({ protocolVersion: 1, operation: 'animationStateTable.inspectBranches', table: value });
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
  const module = await import(`../../engine/studio-core.mjs?branch-forgery=${++bridgeIndex}`), memory = new WebAssembly.Memory({ initial: 40 }), original = WebAssembly.instantiate;
  let length = 0, outputLength = 0, calls = 0;
  try {
    WebAssembly.instantiate = async () => ({ instance: { exports: { memory, viento_core_protocol_version: () => 1,
      ...(legacyMarkers ? { viento_core_animation_state_table_version: () => 1, viento_core_animation_state_conditions_version: () => 1 } : {}),
      ...(marker === null ? {} : { viento_core_animation_state_branches_version: () => marker }),
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
  for (const number of [1e-6, .12345678901234567, Number.MIN_VALUE, -Number.MIN_VALUE, 1e9, -1e9, -0, -0.0000010000000000000002]) for (const unicode of [false, true]) {
    const value = { eventSelection: 'firstMatch', initialState: 'idle', states: [{ key: 'idle' }], transitions: Array.from({ length: 8 }, (_, index) => ({
      from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go', condition: condition('string', 'eq', index < 7 ? 'x'.repeat(4096) : '') },
    })) };
    value.transitions.push({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go', condition: condition('number', 'eq', number) } });
    const remaining = 32768 - budget(value); assert.ok(remaining > 0 && remaining <= 4096);
    value.transitions[7].trigger.condition.value = unicode ? '🔑'.repeat(Math.floor(remaining / 4)) + 'x'.repeat(remaining % 4) : 'x'.repeat(remaining);
    assert.equal(budget(value), 32768); result.push(value);
  }
  return result;
}

test('explicit branch marker preserves mode row order deterministic indices and first-seen event order', () => {
  assert.equal(core.viento_core_protocol_version(), 1); assert.equal(core.viento_core_animation_state_branches_version(), 1);
  assert.equal(supportsStudioCoreAnimationStateBranches(), true);
  const value = table(); value.transitions.push({ from: 'slow', to: 'idle', trigger: { kind: 'event', name: 'finish' } });
  const before = structuredClone(value), result = inspectAnimationStateBranches(value);
  assert.deepEqual(result, expected(value)); assert.deepEqual(inspectAnimationStateDeclaration(value), result); frozen(result); assert.deepEqual(value, before);
  value.states[0].key = 'changed'; assert.equal(result.states[0].key, 'idle'); assert.equal(result.table.eventSelection, 'firstMatch');
});

test('explicit mode remains valid without predicates duplicate groups or any transitions', () => {
  for (const edges of [[], [table().transitions[3]], [table().transitions[0]], [table().transitions[1]]]) {
    const value = table(); value.transitions = edges; assert.deepEqual(inspectAnimationStateBranches(value), expected(value));
    delete value.eventSelection; assert.throws(() => inspectAnimationStateBranches(value), { errorCode: 'animation_state_table_invalid' });
    assert.deepEqual(inspectAnimationStateDeclaration(value).table, value);
  }
  for (const eventSelection of [null, false, 'ordered', { firstMatch: true }]) {
    const value = { ...table(), eventSelection };
    assert.throws(() => inspectAnimationStateDeclaration(value), { errorCode: 'animation_state_table_invalid' });
  }
});

test('old table and conditional operations keep refusing opt-in and ambiguous groups', () => {
  for (const mode of [true, false]) {
    const value = table(); if (!mode) delete value.eventSelection;
    assert.throws(() => inspectAnimationStateTable(value), { errorCode: 'animation_state_table_invalid' });
    assert.throws(() => dispatchStudioCoreAnimationStateConditions({ ...request(value), operation: 'animationStateTable.inspectConditional' }), { errorCode: 'animation_state_table_invalid' });
    for (const edge of value.transitions) delete edge.trigger.condition;
    assert.throws(() => inspectAnimationStateTable(value), { errorCode: 'animation_state_table_invalid' });
  }
});

test('fallback order is group-relative and equal or overlapping predicates retain explicit row priority', () => {
  const value = table(); value.transitions[2].trigger.condition = structuredClone(value.transitions[0].trigger.condition);
  assert.deepEqual(inspectAnimationStateBranches(value), expected(value));
  value.transitions[1].trigger = { kind: 'event', name: 'go' };
  assert.deepEqual(inspectAnimationStateBranches(value), expected(value));
  value.transitions.push({ from: 'slow', to: 'idle', trigger: { kind: 'event', name: 'go', condition: condition('boolean', 'eq', true) } });
  assert.deepEqual(inspectAnimationStateBranches(value), expected(value));
  for (const mutate of [v => v.transitions.unshift(v.transitions.pop()), v => v.transitions.push(structuredClone(v.transitions[3])),
    v => v.transitions.push(structuredClone(v.transitions[1])), v => v.transitions[1].trigger.condition = condition()]) {
    const invalid = table(); mutate(invalid);
    assert.throws(() => inspectAnimationStateBranches(invalid), { errorCode: 'animation_state_table_invalid' });
  }
});

test('branch rules validate every shadowed edge unknown fields references and typed condition', () => {
  for (const mutate of [v => v.transitions[2].to = 'missing', v => v.transitions[2].trigger.extra = true,
    v => v.transitions[2].extra = true, v => v.transitions[2].trigger.name = 'go\n', v => v.transitions[2].trigger.condition = null,
    v => v.transitions[2].trigger.condition = condition('string', 'lt', ''), v => v.transitions[2].trigger.condition = condition('number', 'eq', '1'),
    v => v.states[1].key = 'idle', v => v.states[0].key = 'constructor', v => v.initialState = 'missing', v => v.extra = true]) {
    const value = table(); mutate(value); const before = structuredClone(value);
    assert.throws(() => inspectAnimationStateBranches(value), { errorCode: 'animation_state_table_invalid' }); assert.deepEqual(value, before);
  }
  for (const value of [null, [], true, 1, 'bad']) assert.equal(wasm(request(value)).errorCode, 'animation_state_table_invalid');
  assert.deepEqual(inspectAnimationStateBranches(table()), expected(table()));
});

test('count budgets include all repeated branches and unique event names', () => {
  const value = table(); value.transitions = Array.from({ length: 64 }, () => structuredClone(value.transitions[0]));
  assert.equal(inspectAnimationStateBranches(value).transitions.length, 64);
  value.transitions.push(structuredClone(value.transitions[0])); assert.throws(() => inspectAnimationStateBranches(value), { errorCode: 'animation_state_table_invalid' });
  value.transitions = Array.from({ length: 32 }, (_, index) => ({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: `e${index}` } }));
  assert.equal(inspectAnimationStateBranches(value).eventNames.length, 32);
  value.transitions.push({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'extra' } });
  assert.throws(() => inspectAnimationStateBranches(value), { errorCode: 'animation_state_table_invalid' });
  value.transitions = []; value.states = Array.from({ length: 16 }, (_, index) => ({ key: `s${index}` })); value.initialState = 's0';
  assert.equal(inspectAnimationStateBranches(value).states.length, 16);
  value.states.push({ key: 'extra' }); assert.throws(() => inspectAnimationStateBranches(value), { errorCode: 'animation_state_table_invalid' });
});

test('32 KiB branch declaration budgets include opt-in and reserve numeric literals across UTF-8 boundaries', () => {
  for (const value of boundaryDeclarations()) {
    assert.equal(wasm(request(value)).ok, true); assert.equal(inspectAnimationStateBranches(value).transitions.length, 9);
    const over = structuredClone(value); over.transitions[7].trigger.condition.value += 'x';
    assert.equal(wasm(request(over)).errorCode, 'animation_state_table_invalid');
    assert.throws(() => inspectAnimationStateBranches(over), { errorCode: 'animation_state_table_invalid' });
  }
});

test('branch normalization preserves strings and normalizes numeric negative zero without mutating input', () => {
  const value = table(); value.transitions[0].trigger.condition.value = -0;
  value.transitions[2].trigger.condition = condition('string', 'ne', '\0\n🔑é"\\');
  const result = inspectAnimationStateBranches(value); assert.ok(Object.is(value.transitions[0].trigger.condition.value, -0));
  assert.equal(Object.is(result.table.transitions[0].trigger.condition.value, -0), false);
  assert.equal(Object.is(result.transitions[0].trigger.condition.value, -0), false);
  assert.equal(result.transitions[2].trigger.condition.value, value.transitions[2].trigger.condition.value);
});

test('branch generic selection never invokes own getters serializers inherited opt-in or sparse elements', () => {
  let calls = 0;
  for (const mutate of [v => Object.defineProperty(v, 'eventSelection', { enumerable: true, get() { calls++; return 'firstMatch'; } }),
    v => Object.defineProperty(v, 'transitions', { enumerable: true, get() { calls++; return []; } }),
    v => v.toJSON = () => { calls++; return {}; }, v => delete v.transitions[0],
    v => Object.setPrototypeOf(v, { eventSelection: 'firstMatch' }),
    v => Object.defineProperty(v.transitions[0].trigger.condition, 'value', { enumerable: true, get() { calls++; return 1; } })]) {
    const value = table(); mutate(value); assert.throws(() => inspectAnimationStateDeclaration(value), { errorCode: 'studio_core_request_invalid' });
  }
  assert.equal(calls, 0); const value = table(); Object.setPrototypeOf(value, null);
  assert.deepEqual(inspectAnimationStateDeclaration(value), expected(table()));
});

test('branch request envelopes raw duplicate keys invalid Unicode and recovery are strict', () => {
  for (const value of [{ ...request(), extra: 1 }, { ...request(), protocolVersion: 2 }, { ...request(), operation: 'animationStateTable.inspectConditional' }, null, []]) {
    assert.throws(() => dispatchStudioCoreAnimationStateBranches(value), { errorCode: 'studio_core_request_invalid' });
  }
  const raw = JSON.stringify(request());
  for (const [from, to] of [['"eventSelection":', '"eventSelection":null,"eventSelec\\u0074ion":'],
    ['"condition":', '"condition":null,"condition":'], ['"protocolVersion":', '"protocolVersion":2,"protocolVersion":']]) {
    assert.equal(wasm(raw.replace(from, to)).errorCode, 'studio_core_request_invalid');
  }
  const value = table(); value.transitions[0].trigger.condition = condition('string', 'eq', '\uD800');
  assert.throws(() => inspectAnimationStateBranches(value), { errorCode: 'studio_core_request_invalid' });
  assert.equal(wasm('\uFEFF' + raw).errorCode, 'studio_core_request_invalid'); assert.equal(wasm(request()).ok, true);
});

test('absent or unknown branch markers do not dispatch or borrow old markers and legacy stays usable', async () => {
  for (const marker of [null, 0, 2]) {
    const fake = await bridge(null, { marker }); assert.equal(fake.module.supportsStudioCoreAnimationStateBranches(), false);
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateBranches(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.calls(), 0); assert.equal(fake.module.getStudioCoreMetadata().ready, true);
    const value = table(); delete value.eventSelection; value.transitions = [value.transitions[0]];
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateConditions({ ...request(value), operation: 'animationStateTable.inspectConditional' }), expected(value));
    delete value.transitions[0].trigger.condition;
    assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateTable({ ...request(value), operation: 'animationStateTable.inspect' }), expected(value));
  }
});

test('branch marker owns its predicates independently of legacy optional markers', async () => {
  const fake = await bridge(null, { legacyMarkers: false }); assert.equal(fake.module.supportsStudioCoreAnimationStateBranches(), true);
  assert.equal(fake.module.supportsStudioCoreAnimationStateConditions(), false); assert.equal(fake.module.supportsStudioCoreAnimationStateTable(), false);
  assert.deepEqual(fake.module.dispatchStudioCoreAnimationStateBranches(request()), expected(table()));
});

test('forged branch receipts cannot alter mode order predicates indices fallback or source', async () => {
  for (const mutate of [r => r.extra = true, r => r.animationStateTable.extra = true,
    r => delete r.animationStateTable.table.eventSelection, r => r.animationStateTable.table.eventSelection = 'lastMatch',
    r => r.animationStateTable.transitions.reverse(), r => r.animationStateTable.table.transitions.reverse(),
    r => r.animationStateTable.states.reverse(), r => r.animationStateTable.initialIndex = 1,
    r => r.animationStateTable.transitions[0].toIndex = 2, r => r.animationStateTable.eventNames.push('extra'),
    r => delete r.animationStateTable.transitions[0].trigger.condition, r => r.animationStateTable.transitions[2].trigger.condition.value = .4,
    r => r.animationStateTable.table.transitions[0].trigger.condition.operator = 'lt',
    r => r.animationStateTable.transitions[3].trigger.condition = condition(),
    r => r.animationStateTable.table.transitions[3].trigger.extra = true]) {
    const fake = await bridge(result => { mutate(result); return result; });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateBranches(request()), { errorCode: 'studio_core_unavailable' });
    assert.equal(fake.module.getStudioCoreMetadata().ready, false);
  }
  assert.equal(getStudioCoreMetadata().ready, true);
});

test('forged success for invalid source cannot bypass fallback bounds or completed uniqueness', async () => {
  for (const mutate of [v => v.transitions.unshift(v.transitions.pop()), v => v.transitions.push(structuredClone(v.transitions[1])),
    v => v.eventSelection = 'lastMatch', v => v.extra = true,
    v => v.transitions = Array.from({ length: 65 }, () => structuredClone(v.transitions[0]))]) {
    const value = table(); mutate(value);
    const fake = await bridge(() => ({ protocolVersion: 1, ok: true, animationStateTable: expected(value) }));
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateBranches(request(value)), { errorCode: 'studio_core_unavailable' });
  }
});

test('forged negative-zero branch receipts are rejected before JSON cloning erases sign', async () => {
  const value = table(); value.transitions[0].trigger.condition.value = 0;
  for (const mutate of [r => r.animationStateTable.table.transitions[0].trigger.condition.value = 'negative-zero',
    r => r.animationStateTable.transitions[0].trigger.condition.value = 'negative-zero']) {
    const fake = await bridge(result => { mutate(result); return JSON.stringify(result).replace('"negative-zero"', '-0'); });
    assert.throws(() => fake.module.dispatchStudioCoreAnimationStateBranches(request(value)), { errorCode: 'studio_core_unavailable' });
  }
});

const nativePath = process.env.VIENTO_ANIMATION_STATE_BRANCHES_CORE_NATIVE;
test('native CLI and WASM agree on ordered tables numeric budgets raw failures and recovery', { skip: !nativePath }, async () => {
  const values = [request(), request(null), ...boundaryDeclarations().map(request)];
  for (const mutate of [v => v.transitions.unshift(v.transitions.pop()), v => delete v.eventSelection,
    v => v.transitions[0].trigger.condition = condition('number', 'eq', -Number.MIN_VALUE)]) { const value = table(); mutate(value); values.push(request(value)); }
  const inputs = values.map(JSON.stringify);
  for (const value of boundaryDeclarations()) { value.transitions[7].trigger.condition.value += 'x'; inputs.push(JSON.stringify(request(value))); }
  inputs.push(inputs[0].replace('"eventSelection":', '"eventSelection":null,"eventSelection":'), '\uFEFF' + inputs[0], inputs[0]);
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
