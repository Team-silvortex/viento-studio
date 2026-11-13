import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectMenuItems as parse, validateProjectMenuConfiguration as validate, PROJECT_MENU_DEFAULT_ITEMS as defaults } from '../../engine/project-menu.mjs';
const a = '00000001-1111-4111-8111-111111111111', b = '00000002-1111-4111-8111-111111111111';
const base = command => ({ id: 'choice', label: '继续 · 再開 😀', command });
const config = items => ({ title: '菜单 · メニュー', items_json: typeof items === 'string' ? items : JSON.stringify(items), display_mode: 'scene' });
const rejects = (run, reason) => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'build_project_menu_configuration_invalid' && (!reason || error.reason === reason));
test('portable menu captures bounded commands and exact author data without runtime authority', () => {
  const items = [{ ...base('scene'), targetSceneId: b }, { ...base('retry'), id: 'retry', targetSceneId: b, values: { score: 0, health: 3, door_open: false, text: '保留' } },
    { ...base('restart'), id: 'restart' }, { ...base('finish'), id: 'finish' }];
  const source = config(items), before = structuredClone(source), checked = validate(source, { sceneIds: [a, b], currentSceneId: a });
  assert.deepEqual(source, before); assert.deepEqual(checked, { title: source.title, displayMode: 'scene', items });
  assert.ok(Object.isFrozen(checked)); assert.ok(Object.isFrozen(checked.items)); assert.ok(checked.items.every(Object.isFrozen)); assert.ok(Object.isFrozen(checked.items[1].values));
  assert.equal(Object.hasOwn(checked.items[2], 'values'), false, 'default empty overlay needs no author rewrite');
  assert.deepEqual(parse(defaults), [{ id: 'finish', label: 'Exit', command: 'finish' }]);
});
test('scene and paused commands remain distinct and may not encode arbitrary execution', () => {
  for (const command of ['resume', 'script', 'call', 'load', 'finish_project', '', null, {}, ['finish']]) rejects(() => parse(JSON.stringify([base(command)])), 'command');
  for (const command of ['scene', 'retry', 'restart']) rejects(() => parse(JSON.stringify([{ ...base(command), targetSceneId: b }]), { displayMode: 'paused' }), 'command');
  const items = [base('resume'), { ...base('finish'), id: 'finish' }];
  assert.deepEqual(validate({ ...config(items), display_mode: 'paused' }).items, items);
  for (const field of ['path', 'script', 'callback', 'method', 'values', 'targetSceneId']) rejects(() => parse(JSON.stringify([{ ...base('finish'), [field]: 'anything' }])), 'fields');
  for (const command of ['scene', 'retry']) rejects(() => parse(JSON.stringify([base(command)])), 'fields');
});
test('menu targets use only exact lowercase UUIDs and frozen other members', () => {
  for (const targetSceneId of ['', b.toUpperCase(), b + '\n', null, {}, 'res://scene.tscn', a, '00000003-1111-4111-8111-111111111111']) {
    // UUIDs made only of decimal digits have identical upper/lower forms.
    if (targetSceneId === b) continue;
    rejects(() => parse(JSON.stringify([{ ...base('scene'), targetSceneId }]), { sceneIds: [a, b], currentSceneId: a }), 'target');
  }
  const target = 'abcdef12-abcd-4abc-8abc-abcdef123456';
  rejects(() => parse(JSON.stringify([{ ...base('scene'), targetSceneId: target.toUpperCase() }])), 'target');
  assert.equal(parse(JSON.stringify([{ ...base('scene'), targetSceneId: b }]))[0].targetSceneId, b, 'advisory parsing does not require assembly context');
  for (const options of [{ sceneIds: [a, a] }, { sceneIds: [null] }, { sceneIds: Array(1) }, { sceneIds: Array(33).fill(a) }, { currentSceneId: '' }]) rejects(() => parse(defaults, options), 'context');
});
test('menu identifiers are unique bounded names and retain JSON source order', () => {
  for (const id of ['', 'Choice', 'a-b', '_a', '1a', 'a'.repeat(49), 'a\n', '\ud800', null]) rejects(() => parse(JSON.stringify([{ ...base('finish'), id }])), 'id');
  rejects(() => parse(JSON.stringify([base('finish'), base('finish')])), 'id');
  const items = Array.from({ length: 8 }, (_, i) => ({ ...base('finish'), id: 'item_' + i }));
  assert.deepEqual(parse(JSON.stringify(items)), items);
  rejects(() => parse('[]'), 'items'); rejects(() => parse(JSON.stringify([...items, { ...base('finish'), id: 'ninth' }])), 'items');
});
test('strict JSON rejects duplicate decoded keys at any depth, BOM and malformed syntax', () => {
  for (const source of ['\ufeff' + defaults, '[{"id":"x","id":"y","label":"Exit","command":"finish"}]',
    '[{"id":"x","label":"Exit","command":"finish","\\u0063ommand":"finish"}]',
    '[{"id":"x","label":"Restart","command":"restart","values":{"score":0,"\\u0073core":2}}]',
    '[{"id":"x","label":"Exit","command":"finish",}]', '{}', 'null', '[null]', '[[1]]', '[true]', '["text"]', false, null, new String(defaults)]) rejects(() => parse(source));
});
test('titles and labels count Unicode scalars and preserve multilingual whitespace without coercion', () => {
  for (const text of ['暂停中', '一時停止中', '😀'.repeat(160), 'e\u0301'.repeat(80), ' ']) {
    const checked = validate({ ...config([{ ...base('finish'), label: text }]), title: text });
    assert.equal(checked.title, text); assert.equal(checked.items[0].label, text);
  }
  for (const text of ['', '界'.repeat(161), '😀'.repeat(161), '\ud800', '\udc00', 'a\n', 'b\t', '\u007f', '\u0085', null, false]) {
    rejects(() => validate({ ...config([base('finish')]), title: text }), 'title');
    rejects(() => parse(JSON.stringify([{ ...base('finish'), label: text }])), 'label');
  }
  for (const display_mode of ['', 'SCENE', 'scene\n', 'pause', null]) rejects(() => validate({ ...config([base('finish')]), display_mode }), 'display_mode');
});
test('menu byte admission uses UTF8 and exactly eight KiB including original whitespace', () => {
  const padded = defaults + ' '.repeat(8192 - Buffer.byteLength(defaults)); assert.equal(Buffer.byteLength(padded), 8192); assert.equal(parse(padded).length, 1);
  rejects(() => parse(padded + ' '), 'items_json');
  const json = JSON.stringify([{ ...base('restart'), values: { text: '界'.repeat(2800) } }]);
  assert.ok(json.length < 8192 && Buffer.byteLength(json) > 8192); rejects(() => parse(json), 'items_json');
});
test('retry and restart overlays reuse bounded scalar state parsing without rewriting source values', () => {
  for (const command of ['retry', 'restart']) {
    const item = { ...base(command), ...(command === 'retry' ? { targetSceneId: b } : {}) };
    assert.deepEqual(parse(JSON.stringify([item]))[0], item);
    const values = { health: 3, score: 0, gate: false, title: '保留' };
    assert.deepEqual(parse(JSON.stringify([{ ...item, values }]))[0].values, values);
    for (const values of [null, [], { score: null }, { score: {} }, { score: [] }, { score: 1000000001 }, { text: '\ud800' }, { constructor: 0 }, { 'a\n': 0 }, { 'a\r': 0 },
      Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['a' + i, 0])), { text: '界'.repeat(1365) }]) rejects(() => parse(JSON.stringify([{ ...item, values }])), 'values');
  }
});
test('configuration and context reject accessors without invoking them or freezing caller state', () => {
  let calls = 0;
  for (const key of ['title', 'items_json', 'display_mode']) {
    const input = config([base('finish')]); Object.defineProperty(input, key, { enumerable: true, get() { calls++; return 'fake'; } });
    rejects(() => validate(input)); assert.equal(Object.isFrozen(input), false);
  }
  for (const key of ['sceneIds', 'currentSceneId', 'displayMode']) {
    const options = {}; Object.defineProperty(options, key, { enumerable: true, get() { calls++; return []; } }); rejects(() => parse(defaults, options));
  }
  const ids = [a]; Object.defineProperty(ids, '0', { enumerable: true, get() { calls++; return a; } }); rejects(() => parse(defaults, { sceneIds: ids }));
  assert.equal(calls, 0);
});

test('configuration accepts exactly its three data fields and rejects extra hidden or symbolic authority', () => {
  for (const key of ['unknown', 'execute', Symbol('hidden')]) { const input = config([base('finish')]); Object.defineProperty(input, key, { enumerable: false, value: true }); rejects(() => validate(input), 'fields'); }
  for (const key of ['title', 'items_json', 'display_mode']) { const input = config([base('finish')]); delete input[key]; rejects(() => validate(input), 'fields'); }
});

test('menu overlay payload admits exactly 4096 bytes and rejects 4097 independently of JSON syntax overhead', () => {
  const input = values => JSON.stringify([{ id: 'retry', label: 'Retry', command: 'restart', values }]);
  assert.equal(parse(input({ a: 'x'.repeat(4095) }))[0].values.a.length, 4095);
  rejects(() => parse(input({ a: 'x'.repeat(4096) })), 'values');
  // A scalar itself remains below its limit; the ASCII key contributes bytes.
  assert.equal(parse(input({ long_name: 'x'.repeat(4087) }))[0].values.long_name.length, 4087);
  rejects(() => parse(input({ long_name: 'x'.repeat(4088) })), 'values');
  assert.equal(parse(input({ a: true, b: 'x'.repeat(4093) }))[0].values.a, true);
  rejects(() => parse(input({ a: true, b: 'x'.repeat(4094) })), 'values');
});
test('numeric overlay payload has a fixed eight-byte size for integer, decimal and tiny float spellings', () => {
  const source = (number, stringLength) => '[{"id":"retry","label":"Retry","command":"restart","values":{"n":' + number + ',"s":"' + 'x'.repeat(stringLength) + '"}}]';
  for (const token of ['1', '1.0', '1e0', '0.0000000000000000001', '1e-300', '5e-324', '-0', '1000000000.0']) {
    const accepted = parse(source(token, 4086))[0].values;
    assert.equal(accepted.n, JSON.parse(token), token); assert.equal(accepted.s.length, 4086);
    rejects(() => parse(source(token, 4087)), 'values');
  }
  for (const token of ['1e309', '-1e309', '1000000001.0']) rejects(() => parse(source(token, 0)), 'values');
});
test('overlay strings count decoded UTF8 payload rather than JSON escape length', () => {
  const source = stringToken => '[{"id":"retry","label":"Retry","command":"restart","values":{"a":' + stringToken + '}}]';
  const raw = JSON.stringify('a'.repeat(4095));
  const escaped = '"\\u0061' + 'a'.repeat(4094) + '"';
  assert.ok(Buffer.byteLength(escaped) > Buffer.byteLength(raw));
  assert.deepEqual(parse(source(raw)), parse(source(escaped)));
  rejects(() => parse(source('"\\u0061' + 'a'.repeat(4095) + '"')), 'values');
  const unicodeRaw = JSON.stringify('界'.repeat(1000)), unicodeEscaped = '"' + '\\u754c'.repeat(1000) + '"';
  assert.deepEqual(parse(source(unicodeRaw)), parse(source(unicodeEscaped)));
  const controlsRaw = JSON.stringify('\n'.repeat(1000)), controlsEscaped = '"' + '\\u000a'.repeat(1000) + '"';
  rejects(() => parse(source(controlsRaw)), 'values'); rejects(() => parse(source(controlsEscaped)), 'values');
});

test('menu value strings reject raw and escaped transport controls while JSON formatting whitespace stays valid', () => {
  const source = token => '[{"id":"retry","label":"Retry","command":"restart","values":{"a":' + token + '}}]';
  for (const code of [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127)]) {
    const character = String.fromCharCode(code), escape = '"\\u' + code.toString(16).padStart(4, '0') + '"';
    rejects(() => parse(source(JSON.stringify(character))), 'values');
    rejects(() => parse(source(escape)), 'values');
    rejects(() => parse(source('"' + character + '"')));
  }
  const whitespace = '[\n\t{ "id": "retry", "label": "Retry", "command": "restart", "values": { "text": "可搬 · 移行" } }\r\n]';
  assert.equal(parse(whitespace)[0].values.text, '可搬 · 移行');
  assert.equal(parse(source(JSON.stringify('text'.repeat(1000))))[0].values.a.length, 4000, 'value text is limited by payload bytes, not the display-text character limit');
});
