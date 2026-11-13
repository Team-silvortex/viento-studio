import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProjectMenuTargets as inspect, editProjectMenuItemTarget as edit,
  appendProjectMenuNavigationItem as append, PROJECT_MENU_ITEM_EDIT_LIMITS as limits } from '../../engine/project-menu-item-edit.mjs';
import { parseProjectMenuItems, PROJECT_MENU_DEFAULT_ITEMS as defaults } from '../../engine/project-menu.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const a = 'aaaaaaaa-1111-4111-8111-111111111111', b = 'bbbbbbbb-2222-4222-8222-222222222222', c = 'cccccccc-3333-4333-8333-333333333333';
const context = () => ({ sceneIds: [a, b, c], currentSceneId: a });
const move = (more = {}) => ({ id: 'start', label: '开始 · 開始 😀', command: 'scene', targetSceneId: b, ...more });
const create = (more = {}) => ({ ...context(), ...move(), ...more });
const change = (more = {}) => ({ ...context(), itemId: 'start', targetSceneId: c, ...more });
const rejects = (run, reason, detail) => assert.throws(run, error => error instanceof TypeError
  && error.errorCode === 'project_menu_item_edit_invalid' && (!reason || error.reason === reason) && (!detail || error.detail === detail));
const navigation = items => JSON.stringify(items || [move()]);

const raw = ' \r\n[\r\n  {"id":"start","label":"\\u5f00始 😀","command":"scene","\\u0074argetSceneId":"\\u0062bbbbbbb-2222-4222-8222-222222222222"},\r\n'
  + '  { "id" : "retry", "label" : "Retry", "command" : "retry", "targetSceneId" : "' + b + '", "values" : {"n":1.0,"tiny":1e-10,"zero":-0,"text":"\\u754c"} },\r\n'
  + '  {"id":"restart","label":"Restart","command":"restart","values":{"score":1e0}},\r\n'
  + '  {"id":"finish","label":"Exit","command":"finish"}\r\n] \t';

test('inspection returns detached frozen targets in source order and grants no write authority', () => {
  const owner = context(), before = structuredClone(owner), result = inspect(raw, owner);
  assert.deepEqual(result.targets, [
    { id: 'start', label: '开始 😀', command: 'scene', targetSceneId: b, index: 0 },
    { id: 'retry', label: 'Retry', command: 'retry', targetSceneId: b, index: 1 },
  ]);
  assert.equal(result.items.length, 4); assert.equal(result.canAppend, true);
  assert.deepEqual(result.items[1].values, { n: 1, tiny: 1e-10, zero: -0, text: '界' });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.items)); assert.ok(Object.isFrozen(result.items[1].values));
  assert.ok(Object.isFrozen(result.targets)); assert.ok(result.targets.every(Object.isFrozen));
  assert.deepEqual(owner, before); assert.equal(Object.isFrozen(owner), false); assert.equal(Object.isFrozen(owner.sceneIds), false);
  owner.sceneIds[1] = a; assert.equal(result.targets[0].targetSceneId, b);
  assert.deepEqual(inspect(defaults, context()).targets, []);
});

test('editing one decoded target key replaces only its JSON String token', () => {
  const parsed = parseJsonSource(raw), range = locateJsonSource(parsed, '/0/targetSceneId');
  assert.ok(raw.slice(range.start, range.end).includes('\\u0062'));
  const output = edit(raw, change());
  assert.equal(output, raw.slice(0, range.start) + JSON.stringify(c) + raw.slice(range.end));
  assert.equal(parseProjectMenuItems(output, context())[0].targetSceneId, c);
  assert.ok(output.includes('"\\u0074argetSceneId"')); assert.ok(output.includes('"n":1.0,"tiny":1e-10,"zero":-0,"text":"\\u754c"'));
  assert.equal(edit(raw, change({ targetSceneId: b })), raw, 'same semantic target preserves the original escape spelling');
});

test('retry retargeting preserves every authored overlay byte and sibling identity', () => {
  const range = locateJsonSource(parseJsonSource(raw), '/1/targetSceneId');
  const output = edit(raw, change({ itemId: 'retry' }));
  assert.equal(output.slice(0, range.start), raw.slice(0, range.start));
  assert.equal(output.slice(range.start + JSON.stringify(c).length), raw.slice(range.end));
  assert.deepEqual(parseProjectMenuItems(output, context())[1].values, parseProjectMenuItems(raw, context())[1].values);
  assert.deepEqual(inspect(output, context()).targets.map(row => row.targetSceneId), [b, c]);
});

test('appending inserts one new item after the last token without reprinting existing JSON', () => {
  const range = locateJsonSource(parseJsonSource(raw), '/3');
  for (const command of ['scene', 'retry']) {
    const input = create({ id: 'next', command, targetSceneId: c }), item = move({ id: 'next', command, targetSceneId: c, ...(command === 'retry' ? { values: {} } : {}) });
    const output = append(raw, input), addition = ',' + JSON.stringify(item);
    assert.equal(output, raw.slice(0, range.end) + addition + raw.slice(range.end));
    assert.equal(output.slice(0, range.end), raw.slice(0, range.end));
    const items = parseProjectMenuItems(output, context()); assert.deepEqual(items.slice(0, 4), parseProjectMenuItems(raw, context()));
    assert.deepEqual(items.at(-1), item); assert.equal(Object.hasOwn(items.at(-1), 'values'), command === 'retry');
    assert.deepEqual(input, create({ id: 'next', command, targetSceneId: c }));
  }
});

test('target selection requires an explicit other member and never interprets paths or uppercased UUIDs', () => {
  for (const targetSceneId of [a, b.toUpperCase(), c + '\n', '', null, {}, [], '../scene', 'res://scene.tscn', 'dddddddd-4444-4444-8444-444444444444']) {
    rejects(() => edit(navigation(), change({ targetSceneId })), 'target');
    rejects(() => append(defaults, create({ targetSceneId })), 'target');
  }
});

test('an existing item must be the selected scene/retry item rather than restart, finish or an unknown ID', () => {
  for (const itemId of ['restart', 'finish', 'unknown', '', 'start\n', null, {}, new String('start')]) rejects(() => edit(raw, change({ itemId })), 'item');
  assert.equal(inspect(navigation([move({ command: 'retry' })]), context()).targets[0].command, 'retry');
});

test('only explicit scene/retry additions with new bounded IDs and labels are accepted', () => {
  for (const command of ['restart', 'finish', 'resume', 'script', 'scene\n', '', null, {}, ['scene']]) rejects(() => append(defaults, create({ command })), 'item');
  for (const id of ['finish', '', 'Start', '_start', 'a-b', '1a', 'a'.repeat(49), 'start\n', null, {}, new String('start')]) rejects(() => append(defaults, create({ id })), 'item');
  for (const label of ['', '界'.repeat(161), '😀'.repeat(161), 'bad\n', '\u007f', '\ud800', '\udc00', null, {}, new String('Start')]) rejects(() => append(defaults, create({ label })), 'item');
  const label = '😀'.repeat(160), id = 'a'.repeat(48), output = append(defaults, create({ label, id }));
  assert.equal(inspect(output, context()).targets[0].label, label); assert.equal(inspect(output, context()).targets[0].id, id);
});

test('eight items are allowed and a ninth addition fails without changing source', () => {
  const seven = navigation(Array.from({ length: 7 }, (_, index) => ({ id: 'item_' + index, label: 'Exit', command: 'finish' })));
  const eight = append(seven, create()); assert.equal(inspect(eight, context()).items.length, 8); assert.equal(inspect(eight, context()).canAppend, false);
  rejects(() => append(eight, create({ id: 'ninth' })), 'limit', 'items');
  assert.equal(inspect(seven, context()).items.length, 7);
});

test('the whole old menu must be valid: duplicate decoded keys and unrelated invalid siblings are not silently repaired', () => {
  const invalidSources = ['', '[]', '{}', 'null', '\ufeff' + defaults, defaults + ',', '[{"id":"finish","label":"Exit","command":"finish",}]',
    '[{"id":"x","label":"Exit","command":"finish","\\u0063ommand":"finish"}]',
    '[{"id":"x","label":"Restart","command":"restart","values":{"score":0,"\\u0073core":1}}]',
    navigation([move(), move({ id: 'start' })]), navigation([move(), { id: 'unknown', label: 'Exit', command: 'finish', callback: 'run' }]),
    navigation([move(), { id: 'pause', label: 'Resume', command: 'resume' }]), navigation([move({ targetSceneId: a })]),
    navigation([move(), { id: 'bad', label: 'Again', command: 'restart', values: { broken: null } }])];
  for (const source of invalidSources) {
    rejects(() => inspect(source, context()), 'menu'); rejects(() => edit(source, change()), 'menu'); rejects(() => append(source, create({ id: 'next' })), 'menu');
  }
  assert.throws(() => inspect('[]', context()), error => error.menuReason === 'items');
});

test('primitive JSON source is required without invoking String coercion or serialization hooks', () => {
  let calls = 0;
  for (const source of [undefined, null, false, 0, [], {}, new String(defaults), { toString() { calls++; return defaults; }, toJSON() { calls++; return defaults; } }]) {
    rejects(() => inspect(source, context()), 'input'); rejects(() => edit(source, change()), 'input'); rejects(() => append(source, create()), 'input');
  }
  for (const key of ['id', 'label', 'command', 'targetSceneId']) {
    const value = { toJSON() { calls++; return 'anything'; }, toString() { calls++; return 'anything'; } };
    rejects(() => append(defaults, create({ [key]: value })));
  }
  assert.equal(calls, 0);
});

test('all options are exact own enumerable data with no hidden, symbolic or inherited extensions', () => {
  for (const [run, base] of [[value => inspect(defaults, value), context()], [value => edit(navigation(), value), change()], [value => append(defaults, value), create()]]) {
    for (const key of ['extra', 'execute', Symbol('hidden')]) { const input = { ...base }; Object.defineProperty(input, key, { value: true, enumerable: false }); rejects(() => run(input), 'fields'); }
    for (const key of Object.keys(base)) {
      const missing = { ...base }; delete missing[key]; rejects(() => run(missing), 'fields');
      const hidden = { ...base }; Object.defineProperty(hidden, key, { value: base[key], enumerable: false }); rejects(() => run(hidden), 'fields');
    }
    for (const input of [undefined, null, [], 1, Object.assign(Object.create({ inherited: true }), base)]) rejects(() => run(input), 'fields');
    const plainNull = Object.assign(Object.create(null), base); assert.doesNotThrow(() => run(plainNull));
  }
});

test('accessor fields and array elements are rejected without invoking getters or freezing caller objects', () => {
  let calls = 0;
  for (const [run, base] of [[value => inspect(defaults, value), context()], [value => edit(navigation(), value), change()], [value => append(defaults, value), create()]]) {
    for (const key of Object.keys(base)) {
      const input = { ...base }; Object.defineProperty(input, key, { enumerable: true, get() { calls++; return base[key]; } });
      rejects(() => run(input), 'fields'); assert.equal(Object.isFrozen(input), false);
    }
    const ids = [a, b]; Object.defineProperty(ids, '1', { enumerable: true, get() { calls++; return b; } });
    rejects(() => run({ ...base, sceneIds: ids }), 'context'); assert.equal(Object.isFrozen(ids), false);
  }
  assert.equal(calls, 0);
});

test('saved membership is complete, unique, bounded and includes the current scene', () => {
  const validIds = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111');
  assert.doesNotThrow(() => inspect(defaults, { sceneIds: validIds, currentSceneId: validIds[0] }));
  for (const sceneIds of [[], [b, c], [a, a], [a, b.toUpperCase()], [a, ''], [a, b + '\n'], Array(2), [...validIds, a], new Set([a, b]), { 0: a, length: 1 }]) rejects(() => inspect(defaults, { sceneIds, currentSceneId: a }), 'context');
  for (const currentSceneId of ['', null, a.toUpperCase(), a + '\n', b]) rejects(() => inspect(defaults, { sceneIds: [a], currentSceneId }), 'context');
  for (const key of ['extra', Symbol('extra')]) { const ids = [a, b]; Object.defineProperty(ids, key, { value: true }); rejects(() => inspect(defaults, { sceneIds: ids, currentSceneId: a }), 'context'); }
  const hidden = [a, b]; Object.defineProperty(hidden, '1', { value: b, enumerable: false }); rejects(() => inspect(defaults, { sceneIds: hidden, currentSceneId: a }), 'context');
});

test('ordinary String output admits 4096 UTF16 units and rejects 4097 without broadening the menu contract', () => {
  assert.equal(limits.parameterCharacters, 4096); assert.ok(Object.isFrozen(limits));
  const addition = ',' + JSON.stringify(move());
  const source = defaults.slice(0, -1) + ' '.repeat(4096 - defaults.length - addition.length) + ']';
  assert.equal(append(source, create()).length, 4096);
  rejects(() => append(source + ' ', create()), 'limit', 'parameter_characters');
  const base = navigation(), padded = base + ' '.repeat(4096 - base.length);
  assert.equal(edit(padded, change()).length, 4096); rejects(() => edit(padded + ' ', change()), 'limit', 'parameter_characters');
  assert.equal(edit(padded, change({ targetSceneId: b })), padded);
  rejects(() => edit(padded + ' ', change({ targetSceneId: b })), 'limit', 'parameter_characters');
});

test('UTF8 byte budget remains independent of ordinary String length and Unicode surrogate pairs', () => {
  const item = { id: 'state', label: 'Restart', command: 'restart', values: { text: '界'.repeat(1360) } };
  const before = navigation([item]); assert.ok(before.length < 4096); assert.ok(Buffer.byteLength(before) < 8192);
  assert.doesNotThrow(() => append(before, create()));
  const huge = defaults + ' '.repeat(8192 - defaults.length); assert.equal(inspect(huge, context()).items.length, 1);
  rejects(() => inspect(huge + ' ', context()), 'menu');
  const label = '😀'.repeat(160), denseItems = [1, 2].map(index => ({ id: 'state_' + index, label: 'Restart', command: 'restart', values: { text: '界'.repeat(1200) } }));
  const dense = navigation(denseItems), extra = ',' + JSON.stringify(move({ label }));
  const bytePadding = 8192 - Buffer.byteLength(dense) - Buffer.byteLength(extra); assert.ok(bytePadding > 0);
  const exact = dense + ' '.repeat(bytePadding), output = append(exact, create({ label }));
  assert.ok(output.length < 4096); assert.equal(Buffer.byteLength(output), 8192);
  assert.throws(() => append(exact + ' ', create({ label })), error => error.errorCode === 'project_menu_item_edit_invalid' && error.reason === 'menu' && error.menuReason === 'items_json');
});

test('original overlay payload boundaries and numeric lexemes survive target-only proposals', () => {
  const source = token => '[{"id":"start","label":"Retry","command":"retry","targetSceneId":"' + b + '","values":{"n":' + token + ',"s":"' + 'x'.repeat(3000) + '"}}]';
  for (const token of ['1', '1.0', '1e0', '-0', '5e-324', '1e-300', '1000000000.0']) {
    const input = source(token), range = locateJsonSource(parseJsonSource(input), '/0/targetSceneId'), output = edit(input, change());
    assert.equal(output, input.slice(0, range.start) + JSON.stringify(c) + input.slice(range.end));
    assert.ok(output.includes('"n":' + token + ','));
  }
  const over = navigation([move({ command: 'retry', values: { text: 'x'.repeat(4093) } })]);
  rejects(() => inspect(over, context()), 'menu');
});
