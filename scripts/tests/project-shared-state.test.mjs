import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSharedState, validateProjectSharedStateSnapshot, PROJECT_SHARED_STATE_LIMITS } from '../../engine/project-shared-state.mjs';
import { sharedStateProject, stateOrigin } from './helpers/project-shared-state-fixture.mjs';
const origin = stateOrigin(sharedStateProject().scenes[0]);
const change = (revision, key, value, operation = 'set') => ({ revision, key, operation, origin: structuredClone(origin), ...(operation === 'set' ? { value } : {}) });
const rejected = (state, input) => {
  const before = state.snapshot(); assert.throws(() => state.apply(input), { errorCode: 'runtime_project_invalid' }); assert.deepEqual(state.snapshot(), before);
};

test('shared state starts empty per session and retains last deletion provenance without persisting values', () => {
  const state = createProjectSharedState(); assert.deepEqual(state.snapshot(), { revision: 0, entries: [], lastChange: null });
  state.apply(change(1, 'coins', 1)); state.apply(change(2, 'coins', undefined, 'delete'));
  assert.deepEqual(state.snapshot(), { revision: 2, entries: [], lastChange: { operation: 'delete', key: 'coins', revision: 2, origin } });
  assert.deepEqual(createProjectSharedState().snapshot(), { revision: 0, entries: [], lastChange: null });
});

test('shared state normalizes negative zero, distinguishes scalar types and sorts ASCII keys', () => {
  const state = createProjectSharedState(); state.apply(change(1, 'z', -0)); state.apply(change(2, 'A', true)); state.apply(change(3, 'a', ''));
  const view = state.snapshot(); assert.deepEqual(view.entries.map(entry => entry.key), ['A', 'a', 'z']); assert.equal(Object.is(view.entries[2].value, -0), false);
  rejected(state, change(4, 'z', 0)); state.apply(change(4, 'z', false)); assert.equal(state.snapshot().entries[2].value, false);
});

test('key grammar, reserved names and scalar-only values reject atomically', () => {
  const state = createProjectSharedState(); state.apply(change(1, 'kept', 'yes'));
  for (const key of ['', '0first', '_private', 'with space', '风', 'a'.repeat(65), '__proto__', 'constructor', 'prototype', null, 7]) rejected(state, change(2, key, true));
  for (const value of [null, [], {}, undefined, NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, 1n, () => true]) rejected(state, change(2, 'value', value));
  state.apply(change(2, 'A' + '.'.repeat(63), -1e9)); state.apply(change(3, 'max', 1e9)); state.apply(change(4, 'fraction', 0.125));
});

test('Unicode validation uses UTF-8 bytes and never repairs lone surrogates', () => {
  const state = createProjectSharedState();
  state.apply(change(1, 'text', '🌬'.repeat(1024))); assert.equal(new TextEncoder().encode(state.snapshot().entries[0].value).length, 4096);
  for (const value of ['🌬'.repeat(1025), 'a'.repeat(4097), '\ud800', '\udfff', 'a\ud800b', '\ud800\ud800\udc00', '\udc00\ud800']) rejected(state, change(2, 'text', value));
  state.apply(change(2, 'text', '风'.repeat(1365))); state.apply(change(3, 'text', '\u0000\n"\\'));
});

test('the complete candidate is bounded to 16384 payload bytes and failed replacement preserves revisions and provenance', () => {
  const state = createProjectSharedState();
  for (let i = 0; i < 4; i++) state.apply(change(i + 1, String.fromCharCode(65 + i), 'a'.repeat(4095)));
  rejected(state, change(5, 'A', 'a'.repeat(4096))); rejected(state, change(5, 'extra', false));
  state.apply(change(5, 'D', undefined, 'delete')); state.apply(change(6, 'A', 'a'.repeat(4096)));
  assert.equal(state.revision, 6); assert.equal(PROJECT_SHARED_STATE_LIMITS.bytes, 16384);
});

test('64 live keys and 1024 successful mutations are independent bounds including deletions', () => {
  const keys = createProjectSharedState();
  for (let i = 1; i <= 64; i++) keys.apply(change(i, 'k' + i, true));
  rejected(keys, change(65, 'overflow', true)); keys.apply(change(65, 'k1', false)); keys.apply(change(66, 'k2', undefined, 'delete')); keys.apply(change(67, 'replacement', true));
  const mutations = createProjectSharedState();
  for (let revision = 1; revision <= 1024; revision++) mutations.apply(change(revision, 'key', true, revision % 2 ? 'set' : 'delete'));
  assert.equal(mutations.snapshot().entries.length, 0); rejected(mutations, change(1025, 'key', true));
});

test('no-op sets, missing deletes and malformed revisions cannot consume a mutation', () => {
  const state = createProjectSharedState(); state.apply(change(1, 'key', 1));
  for (const input of [change(2, 'key', 1), change(2, 'missing', undefined, 'delete'), change(1, 'next', false), change(3, 'next', false),
    change(1.5, 'next', false), change('2', 'next', false), { ...change(2, 'key', undefined, 'delete'), value: null },
    { ...change(2, 'next', true), sourcePath: 'injected.json' }, change(2, 'key', undefined, 'erase')]) rejected(state, input);
  state.apply(change(2, 'key', undefined, 'delete')); assert.equal(state.revision, 2);
});

test('state input and output are copied without invoking getters or retaining mutable source aliases', () => {
  const state = createProjectSharedState(), input = change(1, 'key', 'value'); state.apply(input);
  input.origin.source.sourcePath = 'changed.json'; const view = state.snapshot(); view.entries[0].origin.source.sourcePath = 'again.json'; view.lastChange.origin.visitIndex = 8;
  assert.deepEqual(state.snapshot().entries[0].origin, origin);
  let called = 0; const accessor = change(2, 'other', true); Object.defineProperty(accessor, 'value', { enumerable: true, get() { called++; return true; } });
  rejected(state, accessor); assert.equal(called, 0);
  const cycle = change(2, 'other', true); cycle.origin.source = cycle; rejected(state, cycle);
  const hidden = change(2, 'other', true); Object.defineProperty(hidden, 'hidden', { value: true }); rejected(state, hidden);
});

test('snapshot validation rejects inconsistent revision, entry order, last change and unknown source fields', () => {
  const state = createProjectSharedState(); state.apply(change(1, 'A', true)); state.apply(change(2, 'B', 2));
  const mutations = [v => v.revision = 0, v => v.revision = 1025, v => v.lastChange = null,
    v => v.entries.reverse(), v => v.entries[0].revision = 2, v => v.entries[0].key = 'B', v => v.entries[0].value = null,
    v => v.lastChange.revision = 1, v => v.lastChange.operation = 'delete', v => v.lastChange.key = 'absent',
    v => v.lastChange.origin.source.sourcePath = 'different.json', v => v.entries[0].origin.source.sourcePath = '../outside',
    v => v.entries[0].origin.source.sourcePath = '/absolute', v => v.entries[0].origin.source.sourcePath = 'C:/absolute',
    v => v.entries[0].origin.source.sourceRevision = null, v => v.entries[0].origin.source.propertyPath = '/bad~escape',
    v => v.entries[0].origin.source.arbitrary = true, v => v.entries[0].origin.visitIndex = 0, v => v.entries[0].origin.extra = true];
  for (const mutate of mutations) { const input = state.snapshot(); mutate(input); assert.throws(() => validateProjectSharedStateSnapshot(input), { errorCode: 'runtime_project_invalid' }); }
  assert.deepEqual(validateProjectSharedStateSnapshot(state.snapshot()), state.snapshot());
});

test('snapshot sources preserve an optional exact source range without inventing one', () => {
  const state = createProjectSharedState(), input = change(1, 'key', true);
  input.origin.source.sourceRange = { start: 1, end: 12, encoding: 'utf-16', propertyPath: '/bindings/0', exact: true };
  state.apply(input); assert.deepEqual(state.snapshot().entries[0].origin.source, input.origin.source);
  for (const range of [null, { start: 12, end: 1, encoding: 'utf-16' }, { start: 1, end: 12, encoding: 'bytes' }, { start: 1, end: 12, encoding: 'utf-16', extra: true }]) {
    const invalid = change(2, 'next', true); invalid.origin.source.sourceRange = range; rejected(state, invalid);
  }
});

test('snapshot mutation chronology cannot move an origin backwards to an older visit', () => {
  const state = createProjectSharedState(), first = change(1, 'A', true); first.origin.visitIndex = 2; state.apply(first);
  rejected(state, change(2, 'B', true));
  const removal = change(2, 'A', undefined, 'delete'); removal.origin.visitIndex = 3; state.apply(removal);
  rejected(state, change(3, 'B', true));
});
