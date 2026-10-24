import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ANIMATION_STATE_TRIAL_LIMITS as LIMITS, createAnimationStateTrialSequence as create, previewAnimationStateTrialStep as preview,
  appendAnimationStateTrialStep as append, truncateAnimationStateTrialSequence as truncate } from '../../engine/animation-state-trial-sequence.mjs';
import { animationStateEventPreviewKeys } from '../../engine/animation-state-event-preview.mjs';
const invalid = { errorCode: 'animation_state_trial_sequence_invalid' }, limit = { errorCode: 'animation_state_trial_sequence_limit' };
const leaf = (value = true, key, operator = 'eq') => ({ type: typeof value, operator, value, ...(key === undefined ? {} : { selector: { kind: 'projectState', key } }) });
const group = (combine, conditions) => ({ combine, conditions });
const edge = (condition, to = 'attack', name = 'go', from = 'idle') => ({ from, to, trigger: { kind: 'event', name, ...(condition === undefined ? {} : { condition }) } });
const completed = (from = 'attack', to = 'idle') => ({ from, to, trigger: { kind: 'completed' } });
const table = (transitions = [edge(), completed()], ordered = false) => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'other' }], transitions, ...(ordered ? { eventSelection: 'firstMatch' } : {}) });
const event = (value = true, projectState = [], name = 'go') => ({ kind: 'event', event: { name, value }, projectState });
const completion = () => ({ kind: 'completed' });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const advance = (sequence, input) => append(sequence, preview(sequence, input));
function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }

test('creation exposes the admitted existing model and defaults only after full table admission', () => {
  const author = table([edge(leaf(true, 'ready')), completed()]), source = structuredClone(author), sequence = create(author);
  assert.deepEqual({ ...sequence, model: undefined }, { model: undefined, initialStateKey: 'idle', stateKey: 'idle', steps: [], sampleBytes: 0 });
  assert.deepEqual(sequence.model.table, source); assert.deepEqual(animationStateEventPreviewKeys(sequence.model, 'idle', 'go'), ['ready']);
  author.transitions[0].to = 'other'; assert.equal(sequence.model.table.transitions[0].to, 'attack'); frozen(sequence);
  assert.equal(create(source, 'attack').stateKey, 'attack');
  for (const key of [null, 0, '', 'missing']) assert.throws(() => create(source, key), invalid);
});

test('preview does not advance or record; explicit append adopts a proposed target', () => {
  const sequence = create(table()), input = event(), pending = preview(sequence, input);
  assert.equal(sequence.stateKey, 'idle'); assert.equal(sequence.steps.length, 0); assert.equal(sequence.sampleBytes, 0);
  assert.deepEqual(Object.keys(pending), ['stateKey', 'input', 'result']); assert.equal(pending.result.selected.stateKey, 'attack'); frozen(pending);
  const next = append(sequence, pending);
  assert.deepEqual(next.steps[0], { index: 0, stateKey: 'idle', input: event(), result: pending.result, nextStateKey: 'attack' });
  assert.equal(next.stateKey, 'attack'); assert.equal(next.sampleBytes, bytes(event())); assert.equal(next.model, sequence.model);
  assert.equal(sequence.stateKey, 'idle'); assert.equal(sequence.steps.length, 0); frozen(next);
});

test('idle event adopted attack and assumed completion adopted idle make an explicit two-step path', () => {
  const start = create(table()), attack = advance(start, event()), pending = preview(attack, completion());
  assert.equal(attack.stateKey, 'attack'); assert.equal(attack.steps.length, 1);
  assert.deepEqual(pending, { stateKey: 'attack', input: completion(), result: { stateKey: 'attack',
    candidates: [{ transitionIndex: 1, from: 'attack', to: 'idle', kind: 'completed', status: 'selected', leaves: [] }],
    selected: { transitionIndex: 1, stateKey: 'idle' }, assumption: 'current-playback-completed' } });
  const idle = append(attack, pending);
  assert.equal(idle.stateKey, 'idle'); assert.deepEqual(idle.steps.map(row => [row.index, row.stateKey, row.nextStateKey]), [[0, 'idle', 'attack'], [1, 'attack', 'idle']]);
  assert.equal(idle.sampleBytes, bytes(event()) + bytes(completion()));
  assert.equal(Object.hasOwn(idle.steps[1].result, 'played'), false); assert.equal(Object.hasOwn(idle.steps[1].result, 'clipId'), false);
});

test('unmatched events and absent completion both record a step while holding state', () => {
  let sequence = create(table());
  for (const input of [event(true, [], 'unknown'), completion()]) {
    const pending = preview(sequence, input); assert.deepEqual(pending.result.candidates, []); assert.equal(pending.result.selected, null);
    sequence = append(sequence, pending); assert.equal(sequence.stateKey, 'idle');
  }
  assert.equal(sequence.steps.length, 2); assert.deepEqual(sequence.steps.map(row => row.nextStateKey), ['idle', 'idle']);
});

test('event self-edges and completion self-edges keep independent author-order steps', () => {
  let sequence = create(table([edge(undefined, 'idle'), completed('idle', 'idle')]));
  for (const input of [event(), completion(), event(), completion()]) sequence = advance(sequence, input);
  assert.equal(sequence.stateKey, 'idle'); assert.deepEqual(sequence.steps.map(row => row.result.selected.transitionIndex), [0, 1, 0, 1]);
  assert.deepEqual(sequence.steps.map(row => row.index), [0, 1, 2, 3]);
});

test('conditions firstMatch fallback and short-circuit details remain the existing event result', () => {
  const guard = group('all', [leaf(true, 'ready'), leaf(3, undefined, 'gte')]);
  let sequence = create(table([edge(guard), edge(group('any', [leaf(false), leaf(true, 'other')]), 'other'), edge(undefined, 'idle'), completed()], true));
  const pending = preview(sequence, event(3));
  assert.deepEqual(pending.result.candidates.map(row => row.status), ['rejected', 'rejected', 'selected']);
  assert.equal(pending.result.candidates[0].leaves[0].reason, 'missing');
  assert.deepEqual(pending.result.candidates[0].leaves[1], { index: 1, condition: leaf(3, undefined, 'gte'), status: 'not-evaluated' });
  sequence = append(sequence, pending);
  sequence = advance(sequence, event(3, [{ key: 'ready', value: true }])); assert.equal(sequence.stateKey, 'attack');
  sequence = advance(sequence, completion()); assert.equal(sequence.stateKey, 'idle');
});

test('each event owns a fixed complete sample and never inherits earlier shared keys', () => {
  const declaration = table([edge(leaf(true, 'ready')), completed()]);
  let sequence = advance(create(declaration), event(true, [{ key: 'ready', value: true }]));
  sequence = advance(sequence, completion());
  const missing = preview(sequence, event()); assert.equal(missing.result.selected, null); assert.equal(missing.result.candidates[0].leaves[0].reason, 'missing');
  const input = event(false, [{ key: 'ready', value: true }]), pending = preview(sequence, input);
  input.projectState[0].value = false; input.event.value = 'mutated';
  const final = append(sequence, pending); assert.equal(final.stateKey, 'attack'); assert.equal(final.steps.at(-1).input.event.value, false);
  assert.equal(final.steps.at(-1).input.projectState[0].value, true);
});

test('pending belongs to the exact branded sequence and cannot be forged or copied', () => {
  const first = create(table()), second = create(table()), pending = preview(first, event()), next = append(first, pending);
  for (const target of [second, next, truncate(first, 0)]) assert.throws(() => append(target, pending), invalid);
  for (const fake of [null, {}, { ...pending }, structuredClone(pending)]) assert.throws(() => append(first, fake), invalid);
  for (const fake of [null, {}, { ...first }, structuredClone(first)]) {
    assert.throws(() => preview(fake, completion()), invalid); assert.throws(() => append(fake, pending), invalid); assert.throws(() => truncate(fake, 0), invalid);
  }
});

test('truncate restores prefix state bytes and fresh identity even at the same length', () => {
  let current = advance(advance(create(table(), 'attack'), completion()), event());
  const pending = preview(current, completion()), same = truncate(current, 2);
  assert.notEqual(same, current); assert.deepEqual(same, current); assert.throws(() => append(same, pending), invalid);
  const earlier = truncate(current, 1); assert.equal(earlier.stateKey, 'idle'); assert.equal(earlier.sampleBytes, bytes(completion()));
  const empty = truncate(current, 0); assert.equal(empty.stateKey, 'attack'); assert.equal(empty.initialStateKey, 'attack'); assert.equal(empty.sampleBytes, 0);
  current = advance(earlier, event(false, [], 'unknown')); assert.equal(current.stateKey, 'idle'); assert.equal(current.steps.at(-1).index, 1);
  for (const length of [-1, 3, 1.5, null, '1', Infinity, NaN]) assert.throws(() => truncate(current, length), invalid);
});

test('32 history steps is exact; a full sequence can still preview without accepting another record', () => {
  assert.deepEqual(LIMITS, { steps: 32, sampleBytes: 65536 }); assert.ok(Object.isFrozen(LIMITS));
  let sequence = create(table([completed('idle', 'idle')]));
  for (let index = 0; index < 32; index++) sequence = advance(sequence, completion());
  const before = JSON.stringify(sequence), pending = preview(sequence, completion());
  assert.equal(pending.result.selected.stateKey, 'idle'); assert.throws(() => append(sequence, pending), limit);
  assert.equal(JSON.stringify(sequence), before); assert.equal(advance(truncate(sequence, 31), completion()).steps.length, 32);
});

test('65536 normalized JSON UTF8 sample bytes is exact and append failure is atomic', () => {
  let sequence = create(table([edge(undefined, 'idle')]));
  const overhead = bytes(event(''));
  for (let index = 0; index < 15; index++) sequence = advance(sequence, event('x'.repeat(4096)));
  const remaining = LIMITS.sampleBytes - sequence.sampleBytes - overhead;
  assert.ok(remaining > 0 && remaining <= 4096);
  const tooMuch = preview(sequence, event('x'.repeat(remaining + 1))), before = JSON.stringify(sequence);
  assert.throws(() => append(sequence, tooMuch), limit); assert.equal(JSON.stringify(sequence), before);
  sequence = advance(sequence, event('x'.repeat(remaining))); assert.equal(sequence.sampleBytes, LIMITS.sampleBytes);
  assert.ok(preview(sequence, event()).result.selected); assert.throws(() => advance(sequence, event()), limit);
  assert.equal(truncate(sequence, 15).sampleBytes, 15 * (overhead + 4096));
});

test('budget counts normalized negative zero, UTF8 and JSON escapes instead of raw text length', () => {
  let sequence = create(table([edge(undefined, 'idle')]));
  for (const input of [event(-0, [{ key: 'zero', value: -0 }]), event('前\0後🎮\n'), completion()]) sequence = advance(sequence, input);
  assert.equal(Object.is(sequence.steps[0].input.event.value, -0), false);
  assert.equal(sequence.steps[1].input.event.value, '前\0後🎮\n');
  assert.equal(sequence.sampleBytes, sequence.steps.reduce((sum, step) => sum + bytes(step.input), 0));
  assert.ok(bytes(sequence.steps[1].input) > bytes(event('')) + 8);
});

test('a valid single sample may exceed remaining history bytes but remains previewable', () => {
  const sequence = create(table());
  const input = event('\0'.repeat(4096), ['a', 'b', 'c'].map(key => ({ key, value: '\0'.repeat(4096) })));
  const pending = preview(sequence, input); assert.ok(bytes(pending.input) > LIMITS.sampleBytes); assert.ok(pending.result.selected);
  assert.throws(() => append(sequence, pending), limit); assert.equal(sequence.steps.length, 0);
});

test('strict single-step input and sample limits still apply when no result will be appended', () => {
  const sequence = create(table());
  const inputs = [null, {}, { kind: 'unknown' }, { kind: 'completed', clipId: null }, { kind: 'completed', projectState: [] },
    { kind: 'event', event: { name: 'go', value: true } }, { ...event(), stateKey: 'idle' }, { ...event(), extra: false }, event(null), event(NaN), event(Infinity), event(1e9 + 1), event('x'.repeat(4097)), event('\ud800'),
    event(true, [{ key: 'constructor', value: true }]), event(true, [{ key: 'a', value: true }, { key: 'a', value: false }]),
    event(true, Array.from({ length: 65 }, (_, index) => ({ key: 'key' + index, value: true })))];
  for (const input of inputs) assert.throws(() => preview(sequence, input), invalid);
  assert.equal(sequence.steps.length, 0);
});

test('the entire author declaration is validated even when testing only completion', () => {
  for (const declaration of [table([completed(), completed('attack', 'other')]), table([{ ...completed(), trigger: { kind: 'completed', condition: leaf() } }]),
    table([edge(group('all', [])), completed()]), table([edge({ ...leaf(), selector: { kind: 'foreign', key: 'x' } }), completed()])]) assert.throws(() => create(declaration, 'attack'), invalid);
});

test('getters serializers sparse arrays symbols and inherited input execute no callbacks', () => {
  let calls = 0;
  const getter = (object, key) => { Object.defineProperty(object, key, { enumerable: true, get() { calls++; throw Error('must not execute'); } }); return object; };
  const source = table(); getter(source, 'initialState'); assert.throws(() => create(source), invalid);
  const sequence = create(table()), inputs = [getter({}, 'kind'), getter({ kind: 'event', projectState: [] }, 'event'),
    { kind: 'event', event: getter({ name: 'go' }, 'value'), projectState: [] }, event(true, [getter({ key: 'key' }, 'value')]),
    { kind: 'completed', toJSON() { calls++; } }, Object.assign(Object.create({ extra: true }), completion()), event(true, new Array(1))];
  const symbol = completion(); symbol[Symbol('extra')] = true; inputs.push(symbol);
  const hidden = completion(); Object.defineProperty(hidden, 'other', { value: true }); inputs.push(hidden);
  for (const input of inputs) assert.throws(() => preview(sequence, input), invalid);
  const fake = getter({}, 'stateKey'); assert.throws(() => preview(fake, completion()), invalid); assert.throws(() => append(sequence, fake), invalid);
  assert.equal(calls, 0);
});

test('completion trial uses admitted table geometry without the optional scalar comparison marker', async () => {
  const script = `const original = WebAssembly.instantiate;
WebAssembly.instantiate=async(...args)=>{const value=await original(...args);return {...value,instance:{exports:{...value.instance.exports,viento_core_animation_state_conditions_version:undefined}}};};
await import('./scripts/adapters/node-studio-core.mjs');
const {createAnimationStateTrialSequence:create,previewAnimationStateTrialStep:preview,appendAnimationStateTrialStep:append}=await import('./engine/animation-state-trial-sequence.mjs');
const current=create(${JSON.stringify(table([edge(group('all', [leaf()])), completed()]))},'attack');
const next=append(current,preview(current,{kind:'completed'}));if(next.stateKey!=='idle')throw Error('completion blocked');
let code='';try{preview(next,${JSON.stringify(event())});}catch(error){code=error.errorCode;}if(code!=='studio_core_unavailable')throw Error(code);
console.log('COMPLETION_INDEPENDENT_OK');`;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('../../', import.meta.url), timeout: 30000 });
  assert.match(result.stdout, /COMPLETION_INDEPENDENT_OK/);
});
