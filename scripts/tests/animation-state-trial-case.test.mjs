import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ANIMATION_STATE_TRIAL_CASE_LIMITS as LIMITS, createAnimationStateTrialCase as capture, parseAnimationStateTrialCase as parse,
  serializeAnimationStateTrialCase as serialize, replayAnimationStateTrialCase as replay } from '../../engine/animation-state-trial-case.mjs';
import { createAnimationStateTrialSequence as create, previewAnimationStateTrialStep as preview, appendAnimationStateTrialStep as append } from '../../engine/animation-state-trial-sequence.mjs';

const invalid = { errorCode: 'animation_state_trial_case_invalid' }, limit = { errorCode: 'animation_state_trial_case_limit' }, missing = { errorCode: 'animation_state_trial_case_state_missing' };
const leaf = (value = true, key, operator = 'eq') => ({ type: typeof value, operator, value, ...(key === undefined ? {} : { selector: { kind: 'projectState', key } }) });
const edge = (condition, to = 'attack', name = 'go', from = 'idle') => ({ from, to, trigger: { kind: 'event', name, ...(condition === undefined ? {} : { condition }) } });
const completed = (from = 'attack', to = 'idle') => ({ from, to, trigger: { kind: 'completed' } });
const table = (transitions = [edge(), completed()], ordered = false) => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'other' }], transitions, ...(ordered ? { eventSelection: 'firstMatch' } : {}) });
const event = (value = true, projectState = [], name = 'go') => ({ kind: 'event', event: { name, value }, projectState });
const completion = () => ({ kind: 'completed' });
const step = (input = event(), stateKey = 'attack', transition = true) => ({ input, expected: { stateKey, transition } });
const definition = (steps = [step()], initialStateKey = 'idle') => ({ format: 'viento.animation-state-trial-case', version: 1, initialStateKey, steps });
const admit = (steps, initialStateKey) => parse(JSON.stringify(definition(steps, initialStateKey)));
const advance = (sequence, input) => append(sequence, preview(sequence, input));
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }

test('capture stores only normalized manual inputs and target/transition expectations', () => {
  let sequence = advance(advance(create(table()), event()), completion());
  sequence = advance(sequence, event(false, [], 'unmatched'));
  const value = capture(sequence);
  assert.deepEqual(value, definition([step(), step(completion(), 'idle'), step(event(false, [], 'unmatched'), 'idle', false)]));
  assert.equal(Object.hasOwn(value, 'table'), false); assert.equal(Object.hasOwn(value, 'projectId'), false);
  assert.equal(Object.hasOwn(value.steps[0], 'result'), false); assert.equal(Object.hasOwn(value.steps[0].expected, 'transitionIndex'), false);
  assert.notEqual(value.steps[0].input, sequence.steps[0].input); frozen(value);
  const before = JSON.stringify(sequence); capture(sequence); assert.equal(JSON.stringify(sequence), before);
});

test('compact serialization round trips the exact detached case and produces a fresh brand', () => {
  const value = capture(advance(create(table()), event('前\0後🎮\n', [{ key: 'zero', value: -0 }])));
  const text = serialize(value), restored = parse(text);
  assert.equal(text, JSON.stringify(value) + '\n'); assert.notEqual(restored, value); assert.deepEqual(restored, value);
  assert.equal(restored.steps[0].input.event.value, '前\0後🎮\n'); assert.equal(Object.is(restored.steps[0].input.projectState[0].value, -0), false);
  assert.ok(text.includes('\\u0000')); frozen(restored);
  assert.throws(() => { restored.steps[0].expected.stateKey = 'other'; }, TypeError);
  assert.equal(replay(table(), restored).status, 'passed');
});

test('event then assumed completion replay along actual predicted states without mutating author data', () => {
  const author = table(), original = JSON.stringify(author), value = admit([step(), step(completion(), 'idle')]);
  const report = replay(author, value);
  assert.deepEqual(Object.keys(report), ['case', 'status', 'initialStateKey', 'stateKey', 'mismatchIndex', 'steps']);
  assert.equal(report.case, value); assert.equal(report.status, 'passed'); assert.equal(report.initialStateKey, 'idle'); assert.equal(report.stateKey, 'idle'); assert.equal(report.mismatchIndex, null);
  assert.deepEqual(report.steps.map(row => [row.index, row.status, row.actual]), [[0, 'passed', { stateKey: 'attack', transition: true }], [1, 'passed', { stateKey: 'idle', transition: true }]]);
  assert.deepEqual(report.steps.map(row => row.result.stateKey), ['idle', 'attack']);
  assert.equal(report.steps[1].result.assumption, 'current-playback-completed'); frozen(report);
  assert.equal(JSON.stringify(author), original); assert.equal(Object.hasOwn(report, 'sequence'), false);
});

test('first mismatch stops all later execution and never steers state using the expectation', () => {
  const value = admit([step(event(), 'other'), step(completion(), 'idle'), step(event(), 'attack')]);
  const report = replay(table(), value);
  assert.equal(report.status, 'failed'); assert.equal(report.mismatchIndex, 0); assert.equal(report.stateKey, 'attack');
  assert.deepEqual(report.steps.map(row => row.status), ['failed', 'not-run', 'not-run']);
  assert.deepEqual(report.steps[0].actual, { stateKey: 'attack', transition: true });
  for (const row of report.steps.slice(1)) { assert.equal(row.actual, null); assert.equal(row.result, null); }
  assert.deepEqual(value, definition([step(event(), 'other'), step(completion(), 'idle'), step(event(), 'attack')]));
});

test('mismatch after a matched prefix preserves all diagnostics and stops at that actual state', () => {
  const value = admit([step(), step(completion(), 'other'), step(event(), 'other', false)]);
  const report = replay(table(), value);
  assert.equal(report.mismatchIndex, 1); assert.equal(report.stateKey, 'idle');
  assert.deepEqual(report.steps.map(row => row.status), ['passed', 'failed', 'not-run']);
  assert.equal(report.steps[1].result.selected.transitionIndex, 1); assert.equal(report.steps[2].result, null);
});

test('a self-loop differs from no matching transition even when both keep the same state', () => {
  const self = table([edge(undefined, 'idle'), completed('idle', 'idle')]);
  const yes = admit([step(event(), 'idle', true)]), no = admit([step(event(), 'idle', false)]);
  assert.equal(replay(self, yes).status, 'passed'); assert.equal(replay(self, no).status, 'failed');
  assert.equal(replay(table([]), no).status, 'passed'); assert.equal(replay(table([]), yes).status, 'failed');
  assert.equal(replay(self, admit([step(completion(), 'idle', true)])).status, 'passed');
  assert.equal(replay(table([]), admit([step(completion(), 'idle', false)])).status, 'passed');
});

test('expectations deliberately do not claim the same branch when another branch selects the same target', () => {
  const oldTable = table([edge(leaf(true)), edge(undefined, 'attack')], true);
  const value = capture(advance(create(oldTable), event(true)));
  const changed = table([edge(leaf(false)), edge(undefined, 'attack')], true), report = replay(changed, value);
  assert.equal(report.status, 'passed'); assert.equal(report.steps[0].result.selected.transitionIndex, 1);
});

test('group short circuit firstMatch fallback and per-step missing shared values reuse the existing evaluator', () => {
  const declaration = table([edge({ combine: 'all', conditions: [leaf(true, 'ready'), leaf(3, undefined, 'gte')] }), edge(undefined, 'idle'), completed()], true);
  const value = admit([step(event(4), 'idle'), step(event(4, [{ key: 'ready', value: true }])), step(completion(), 'idle'), step(event(4), 'idle')]);
  const report = replay(declaration, value);
  assert.equal(report.status, 'passed');
  for (const index of [0, 3]) {
    assert.equal(report.steps[index].result.candidates[0].leaves[0].reason, 'missing');
    assert.deepEqual(report.steps[index].result.candidates[0].leaves[1], { index: 1, condition: leaf(3, undefined, 'gte'), status: 'not-evaluated' });
  }
  assert.deepEqual(report.steps[1].result.candidates.map(row => row.status), ['selected', 'not-evaluated']);
});

test('a nondefault initial state is used and a deleted initial state has its own error', () => {
  const value = admit([step(completion(), 'idle')], 'attack');
  assert.equal(replay(table(), value).steps[0].result.stateKey, 'attack');
  assert.throws(() => replay({ initialState: 'idle', states: [{ key: 'idle' }], transitions: [] }, value), missing);
  assert.throws(() => replay({ initialState: 'idle', states: [{ key: 'idle' }], transitions: [completed()] }, value), invalid);
});

test('an absent expected destination is a valid unmet expectation, never a missing-initial error', () => {
  const value = admit([step(event(), 'deleted'), step(event(), 'deleted', false)]);
  const report = replay(table(), value);
  assert.equal(report.status, 'failed'); assert.equal(report.mismatchIndex, 0); assert.equal(report.steps[0].expected.stateKey, 'deleted');
});

test('no-transition expectations must retain the preceding expected state', () => {
  for (const steps of [[step(event(), 'attack', false)], [step(), step(completion(), 'idle', false)]]) assert.throws(() => admit(steps), invalid);
  assert.equal(admit([step(event(), 'idle', false), step(), step(event(), 'attack', false)]).steps.length, 3);
});

test('state identifiers follow author-state grammar rather than event/project-state keys', () => {
  for (const key of ['a', 'a0_', 'x'.repeat(32), 'constructor', 'prototype']) {
    const value = admit([step(completion(), key, false)], key);
    assert.equal(replay({ initialState: key, states: [{ key }], transitions: [] }, value).status, 'passed');
  }
  for (const key of ['', 'A', 'has.dot', 'has-dash', '_a', '1a', 'a'.repeat(33), '前', '__proto__']) {
    assert.throws(() => admit([step(completion(), key, false)], key), invalid);
    assert.throws(() => admit([step(event(), key)]), invalid);
  }
});

test('empty cases cannot report a vacuous pass and step budget admits exactly 32', () => {
  assert.deepEqual(LIMITS, { steps: 32, sampleBytes: 65536, textBytes: 131072 }); assert.ok(Object.isFrozen(LIMITS));
  assert.throws(() => capture(create(table())), invalid); assert.throws(() => admit([]), invalid);
  const rows = Array.from({ length: 32 }, () => step(completion(), 'idle', false));
  assert.equal(replay(table([]), admit(rows)).steps.length, 32);
  assert.throws(() => admit([...rows, rows[0]]), limit);
});

test('sample-byte budget is exactly the accumulated normalized JSON inputs', () => {
  const overhead = bytes(event('')), rows = Array.from({ length: 15 }, () => step(event('x'.repeat(4096)), 'idle'));
  const remaining = LIMITS.sampleBytes - rows.reduce((sum, row) => sum + bytes(row.input), 0) - overhead;
  assert.ok(remaining > 0 && remaining <= 4096);
  const exactRows = [...rows, step(event('x'.repeat(remaining)), 'idle')], value = admit(exactRows);
  assert.equal(value.steps.reduce((sum, row) => sum + bytes(row.input), 0), LIMITS.sampleBytes);
  assert.equal(replay(table([edge(undefined, 'idle')]), value).status, 'passed');
  assert.throws(() => admit([...rows, step(event('x'.repeat(remaining + 1)), 'idle')]), limit);
  assert.throws(() => admit([...exactRows, step(completion(), 'idle', false)]), limit);
});

test('normalized zero Unicode and escaped NUL count identically to recorded inputs', () => {
  const raw = JSON.stringify(definition([step(event(0, [{ key: 'zero', value: 0 }]))])).replaceAll('"value":0', '"value":-0');
  const zero = parse(raw); assert.equal(Object.is(zero.steps[0].input.event.value, -0), false); assert.equal(Object.is(zero.steps[0].input.projectState[0].value, -0), false);
  let sequence = create(table([edge(undefined, 'idle')]));
  for (const input of [event(-0), event('前🎮\0\n', [{ key: 'some', value: '\0' }])]) sequence = advance(sequence, input);
  const restored = parse(serialize(capture(sequence)));
  assert.equal(restored.steps.reduce((sum, row) => sum + bytes(row.input), 0), sequence.sampleBytes);
  const tooLarge = event('\0'.repeat(4096), ['a', 'b', 'c'].map(key => ({ key, value: '\0'.repeat(4096) })));
  assert.ok(bytes(tooLarge) > LIMITS.sampleBytes); assert.throws(() => admit([step(tooLarge)]), limit);
});

test('raw UTF8 text budget counts whitespace and BOM, including the exact boundary', () => {
  const base = JSON.stringify(definition()), padding = LIMITS.textBytes - new TextEncoder().encode(base).length;
  assert.equal(parse(base + ' '.repeat(padding)).steps.length, 1);
  assert.throws(() => parse(base + ' '.repeat(padding + 1)), limit);
  assert.equal(parse('\ufeff' + base + ' '.repeat(padding - 3)).steps.length, 1);
  assert.throws(() => parse('\ufeff' + base + ' '.repeat(padding - 2)), limit);
  const largeUnicode = JSON.stringify(definition([step(event('前'.repeat(1000)))]));
  const rawBytes = new TextEncoder().encode(largeUnicode).length;
  assert.equal(parse(largeUnicode + ' '.repeat(LIMITS.textBytes - rawBytes)).steps.length, 1);
});

test('the complete case is admitted before a mismatching first step can hide invalid later data', () => {
  const mutations = [row => { row.input.event.value = null; }, row => { row.expected.stateKey = 'Bad'; }, row => { row.input.extra = true; }, row => { row.expected.transition = 1; }];
  for (const mutate of mutations) {
    const raw = definition([step(event(), 'other'), step()]); mutate(raw.steps[1]); assert.throws(() => parse(JSON.stringify(raw)), invalid);
  }
});

test('strict envelopes reject persisted results unknown fields duplicate decoded keys and ambiguous JSON', () => {
  for (const raw of [null, [], {}, { ...definition(), format: 'other' }, { ...definition(), version: 2 }, { ...definition(), result: { status: 'passed' } },
    { ...definition(), table: table() }, { ...definition(), projectId: 'project' }, { ...definition(), steps: [null] },
    definition([{ ...step(), index: 0 }]), definition([{ ...step(), expected: { stateKey: 'attack', transition: true, transitionIndex: 0 } }])]) assert.throws(() => parse(JSON.stringify(raw)), invalid);
  const source = JSON.stringify(definition());
  for (const text of [source.replace('"version":1', '"version":2,"version":1'), source.replace('"transition":true', '"transition":false,"trans\\u0069tion":true'),
    source.replace('"value":true', '"value":false,"value":true'), source + ' trailing', '[', '', source.replace('"version":1', '"version":1,"__proto__":{}')]) assert.throws(() => parse(text), invalid);
});

test('all scalar and shared sample limits apply without needing the current table', () => {
  const badInputs = [null, {}, { kind: 'completed', event: { name: 'go', value: true } }, { kind: 'event', event: { name: 'go', value: true } },
    { ...event(), extra: true }, event(null), event(1e9 + 1), event('x'.repeat(4097)), event('\ud800'), event('\udc00'), event(true, [{ key: 'ready', value: null }]),
    event(true, [{ key: 'constructor', value: true }]), event(true, [{ key: 'same', value: true }, { key: 'same', value: false }]),
    event(true, Array.from({ length: 65 }, (_, index) => ({ key: 'key' + index, value: true }))),
    event(true, ['a', 'b', 'c', 'd'].map(key => ({ key, value: 'x'.repeat(4096) }))), event(true, [], 'constructor'), event(true, [], '__proto__'), event(true, [], '1invalid')];
  for (const input of badInputs) assert.throws(() => admit([step(input)]), invalid);
  for (const raw of [JSON.stringify(definition()).replace('"value":true', '"value":1e400'), JSON.stringify(definition()).replace('"value":true', '"value":NaN')]) assert.throws(() => parse(raw), invalid);
  for (const scalar of [false, 0, -1e9, 1e9, '', 'x'.repeat(4096), '🎮'.repeat(1024)]) assert.equal(admit([step(event(scalar))]).steps.length, 1);
  const key64 = Array.from({ length: 64 }, (_, index) => ({ key: 'key' + index, value: false })); assert.equal(admit([step(event(true, key64))]).steps[0].input.projectState.length, 64);
});

test('untrusted objects getters serializers and forged brands execute no callbacks', () => {
  let calls = 0;
  const fake = {}; Object.defineProperty(fake, 'steps', { enumerable: true, get() { calls++; throw Error('getter ran'); } });
  const stringify = { toString() { calls++; return JSON.stringify(definition()); }, toJSON() { calls++; return definition(); } };
  const value = admit(), sequence = advance(create(table()), event());
  for (const input of [null, {}, fake, stringify, definition(), structuredClone(value), { ...value }]) {
    assert.throws(() => serialize(input), invalid); assert.throws(() => replay(table(), input), invalid);
  }
  for (const input of [fake, stringify, { ...sequence }, structuredClone(sequence)]) assert.throws(() => capture(input), invalid);
  for (const input of [fake, stringify, value, null]) assert.throws(() => parse(input), invalid);
  const author = table(); Object.defineProperty(author, 'initialState', { enumerable: true, get() { calls++; return 'idle'; } });
  assert.throws(() => replay(author, value), invalid); assert.equal(calls, 0);
});

test('all author transitions are admitted before replay even if an earlier sample would stop', () => {
  const value = admit([step(event(), 'other')]);
  for (const declaration of [table([edge(), completed(), completed('attack', 'other')]),
    table([edge(), edge({ combine: 'all', conditions: [] }, 'other', 'hidden')]),
    table([edge(), { from: 'other', to: 'idle', trigger: { kind: 'completed', condition: leaf() } }])]) assert.throws(() => replay(declaration, value), invalid);
});

test('parsing and serializing remain pure without loading any Rust/WASM capability', async () => {
  const script = `const {parseAnimationStateTrialCase:parse,serializeAnimationStateTrialCase:serialize,replayAnimationStateTrialCase:replay}=await import('./engine/animation-state-trial-case.mjs');
const value=parse(${JSON.stringify(JSON.stringify(definition()))});if(!serialize(value).endsWith('\\n'))throw Error('serialization');
let code='';try{replay(${JSON.stringify(table())},value);}catch(error){code=error.errorCode;}if(code!=='studio_core_unavailable')throw Error(code);console.log('PURE_IMPORT_OK');`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('../../', import.meta.url), timeout: 30000 });
  assert.match(result.stdout, /PURE_IMPORT_OK/);
});

test('completed-only replay needs no scalar comparison marker and a failed step never evaluates later events', async () => {
  const declaration = table([edge({ combine: 'all', conditions: [leaf()] }), completed()]);
  const script = `const original=WebAssembly.instantiate;WebAssembly.instantiate=async(...args)=>{const value=await original(...args);return {...value,instance:{exports:{...value.instance.exports,viento_core_animation_state_conditions_version:undefined}}};};
await import('./scripts/adapters/node-studio-core.mjs');const {parseAnimationStateTrialCase:parse,replayAnimationStateTrialCase:replay}=await import('./engine/animation-state-trial-case.mjs');
const table=${JSON.stringify(declaration)};
const complete=parse(${JSON.stringify(JSON.stringify(definition([step(completion(), 'idle')], 'attack')))});
if(replay(table,complete).status!=='passed')throw Error('completion unavailable');
const stopped=parse(${JSON.stringify(JSON.stringify(definition([step(completion(), 'other'), step(event(), 'attack')], 'attack')))});
const result=replay(table,stopped);if(result.mismatchIndex!==0||result.steps[1].status!=='not-run')throw Error('continued after mismatch');
const event=parse(${JSON.stringify(JSON.stringify(definition()))});let code='';try{replay(table,event);}catch(error){code=error.errorCode;}if(code!=='studio_core_unavailable')throw Error(code);console.log('COMPLETION_CASE_OK');`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('../../', import.meta.url), timeout: 30000 });
  assert.match(result.stdout, /COMPLETION_CASE_OK/);
});
