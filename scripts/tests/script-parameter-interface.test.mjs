import test from 'node:test';
import assert from 'node:assert/strict';
import { captureScriptParameterContract, reviewScriptParameterRows } from '../../engine/script-parameter-interface.mjs';
const id = '01234567-89ab-4cde-8fab-0123456789ab';
const parameter = (name = 'clip_idle') => ({ name, type: 'string', defaultValue: '', referenceKind: 'animation-clip' });
const contract = () => ({ format: 'viento-script-parameters', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters: [parameter(), parameter('clip_action')] });
const row = (name, value = '', type = 'string') => ({ name, type, value });
const form = (parameters = []) => ({ backendId: 'org.viento.godot4', language: 'gdscript', parameters });
const bad = { errorCode: 'script_parameter_interface_invalid' };

test('interface capture detaches and deeply freezes supported scalar declarations', () => {
  const input = contract(); input.parameters.push({ name: 'enabled', type: 'boolean', defaultValue: false, referenceKind: '' }, { name: 'amount', type: 'number', defaultValue: 0, referenceKind: '' });
  const saved = captureScriptParameterContract(input); input.parameters[0].name = 'changed'; input.parameters.pop();
  assert.equal(saved.parameters[0].name, 'clip_idle'); assert.equal(saved.parameters.length, 4);
  assert.equal(saved.parameters[2].defaultValue, false); assert.equal(saved.parameters[3].defaultValue, 0);
  assert.ok(Object.isFrozen(saved)); assert.ok(Object.isFrozen(saved.parameters)); assert.ok(Object.isFrozen(saved.parameters[0]));
  assert.deepEqual(captureScriptParameterContract(Object.assign(Object.create(null), contract())), contract());
});
test('interfaces reject unknown accessors inherited fields sparse arrays unsafe names and unbounded scalar declarations', () => {
  let calls = 0;
  const getter = contract(); Object.defineProperty(getter, 'parameters', { enumerable: true, get() { calls++; return []; } });
  const cases = [getter, { ...contract(), unknown: true }, Object.assign(Object.create({ extra: true }), contract()), { ...contract(), parameters: [, parameter()] },
    { ...contract(), schemaVersion: 2 }, { ...contract(), status: 'missing' }, { ...contract(), parameters: Array.from({ length: 33 }, (_, n) => parameter('x' + n)) }];
  for (const field of ['backendId', 'language']) cases.push({ ...contract(), [field]: contract()[field] + '\n' });
  for (const name of ['constructor', '__proto__', 'prototype', 'bad\n', '1name', 'a'.repeat(65)]) cases.push({ ...contract(), parameters: [parameter(name)] });
  for (const change of [{ defaultValue: 0 }, { referenceKind: 'script' }, { defaultValue: id + '\n' }, { defaultValue: id.toUpperCase() }, { type: 'number', defaultValue: Infinity, referenceKind: '' },
    { type: 'number', defaultValue: Number.MAX_SAFE_INTEGER + 1, referenceKind: '' }, { defaultValue: '\ud800', referenceKind: '' }, { defaultValue: 'x'.repeat(4097), referenceKind: '' }, { extra: true }]) {
    cases.push({ ...contract(), parameters: [{ ...parameter(), ...change }] });
  }
  cases.push({ ...contract(), parameters: [parameter(), parameter()] });
  const array = [parameter()]; array.extra = true; cases.push({ ...contract(), parameters: array });
  for (const input of cases) assert.throws(() => captureScriptParameterContract(input), bad);
  assert.equal(calls, 0);
});
test('non-ready interfaces expose no actionable parameters and incompatible backends produce no inferred edits', () => {
  for (const status of ['modified', 'unsupported', 'unavailable']) {
    assert.throws(() => captureScriptParameterContract({ ...contract(), status }), bad);
    const saved = { ...contract(), status, parameters: [] }, reviewed = reviewScriptParameterRows(saved, form());
    assert.equal(reviewed.status, status); assert.equal(reviewed.canAddMissing, false); assert.deepEqual(reviewed.missing, []);
  }
  for (const change of [{ backendId: 'org.viento.bevy' }, { language: 'rust' }]) {
    const result = reviewScriptParameterRows(contract(), { ...form(), ...change });
    assert.equal(result.status, 'incompatible'); assert.deepEqual(result.missing, []); assert.equal(result.canAddMissing, false);
  }
});
test('review identifies missing unknown type and UUID issues without mutating unfinished form values', () => {
  const input = form([row('clip_idle', '1e-', 'number'), row('old_clip', id)]), copy = structuredClone(input);
  const review = reviewScriptParameterRows(contract(), input);
  assert.deepEqual(review.missing, [parameter('clip_action')]); assert.deepEqual(review.unknown, [{ index: 1, name: 'old_clip' }]);
  assert.deepEqual(review.typeMismatches, [{ index: 0, name: 'clip_idle', expectedType: 'string', actualType: 'number' }]);
  assert.deepEqual(review.invalidValues, []); assert.equal(review.canAddMissing, true); assert.deepEqual(input, copy);
  for (const value of ['not-a-clip', id.toUpperCase(), id + '\n', ' ']) {
    assert.deepEqual(reviewScriptParameterRows(contract(), form([row('clip_idle', value)])).invalidValues,
      [{ index: 0, name: 'clip_idle', referenceKind: 'animation-clip' }]);
  }
  for (const value of ['', id]) assert.deepEqual(reviewScriptParameterRows(contract(), form([row('clip_idle', value)])).invalidValues, []);
  assert.ok(Object.isFrozen(review.missing[0]) && Object.isFrozen(review.typeMismatches[0]));
});
test('duplicate and full forms cannot silently insert parameters or lose row identity', () => {
  const duplicate = reviewScriptParameterRows(contract(), form([row('clip_idle', id), row('clip_idle', 'other')]));
  assert.deepEqual(duplicate.duplicateNames, [{ name: 'clip_idle', indexes: [0, 1] }]); assert.equal(duplicate.canAddMissing, false);
  assert.deepEqual(duplicate.invalidValues, [{ index: 1, name: 'clip_idle', referenceKind: 'animation-clip' }]);
  const full = reviewScriptParameterRows(contract(), form(Array.from({ length: 31 }, (_, n) => row('custom_' + n))));
  assert.equal(full.canAddMissing, false); assert.equal(full.missing.length, 2);
  const complete = reviewScriptParameterRows(contract(), form([row('clip_idle'), row('clip_action')]));
  assert.equal(complete.canAddMissing, false); assert.deepEqual(complete.missing, []);
});
test('review snapshots only exact bounded row data and never invokes accessors', () => {
  let calls = 0; const getter = row('clip_idle'); Object.defineProperty(getter, 'value', { enumerable: true, get() { calls++; return ''; } });
  for (const input of [{ ...form(), extra: true }, form([getter]), form([row('clip_idle', 1)]), form([row('clip_idle', '', 'object')]),
    form([row('x'.repeat(4097))]), form([row('clip_idle', '\ud800')]), form(Array.from({ length: 33 }, () => row('')))]) {
    assert.throws(() => reviewScriptParameterRows(contract(), input), bad);
  }
  assert.equal(calls, 0);
});
