import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { reviewSceneBehaviorCreateParameters, proposeSceneBehaviorCreateParameters, applySceneBehaviorCreateParameterSources } from '../../engine/scene-behavior-create-parameters.mjs';

const id = digit => digit.repeat(8) + '-' + digit.repeat(4) + '-4' + digit.repeat(3) + '-8' + digit.repeat(3) + '-' + digit.repeat(12);
const contract = (parameters = [{ name: 'action_name', type: 'string', defaultValue: 'ui_accept', referenceKind: '' }, { name: 'speed', type: 'number', defaultValue: -0, referenceKind: '' }, { name: 'enabled', type: 'boolean', defaultValue: false, referenceKind: '' }], extra = {}) => ({ format: 'viento-script-parameters', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters, ...extra });
const input = (content = '{}', extra = {}) => ({ content, contract: contract(), backendId: 'org.viento.godot4', language: 'gdscript', ...extra });
const invalid = callback => assert.throws(callback, error => error instanceof TypeError);
const plan = (count = 1) => createSceneBehaviorCreationDraft({ sceneObjectId: id('a'), backendId: 'org.viento.godot4', language: 'gdscript', bindings: Array.from({ length: count }, (_, i) => ({ bindingId: id(String(i + 1)), instanceId: id('b'), sourceObjectId: id('c') })) });

test('first-creation defaults are explicit proposals, scalar typed and retain negative zero', () => {
  const original = input(), before = structuredClone(original), review = reviewSceneBehaviorCreateParameters(original);
  assert.deepEqual(review.missing.map(row => row.name), ['action_name', 'speed', 'enabled']); assert.equal(review.canAddMissing, true);
  assert.deepEqual(original, before);
  const proposal = proposeSceneBehaviorCreateParameters(original), result = JSON.parse(proposal.content);
  assert.deepEqual(proposal.added, ['action_name', 'speed', 'enabled']); assert.equal(result.action_name, 'ui_accept'); assert.ok(Object.is(result.speed, -0)); assert.equal(result.enabled, false);
  assert.equal(original.content, '{}'); assert.ok(Object.isFrozen(proposal.added));
});
for (const [label, content] of [['single line', '{ "manual" : 1e3, "text":"a\\r\\nb", "enabled":true  } '], ['CRLF tabs and BOM', '\uFEFF{\r\n\t"manual": 1.2500,\r\n\t"speed": -0,\r\n\t"text":"\\u0061"\r\n}\r\n']]) {
  test('defaults append without rewriting any existing parameter bytes: ' + label, () => {
    const proposal = proposeSceneBehaviorCreateParameters(input(content));
    assert.ok(proposal.content.startsWith(content.slice(0, content.lastIndexOf('}') === 0 ? 1 : content.indexOf('"manual"'))));
    for (const literal of ['1e3', '1.2500', '-0', '\\u0061', 'a\\r\\nb']) if (content.includes(literal)) assert.ok(proposal.content.includes(literal));
    const existing = JSON.parse(content.replace(/^\uFEFF/, '')), next = JSON.parse(proposal.content.replace(/^\uFEFF/, ''));
    for (const key of Object.keys(existing)) assert.ok(Object.is(next[key], existing[key]), key);
    if (content.includes('\r\n')) assert.equal(proposal.content.replaceAll('\r\n', '').includes('\n'), false);
    assert.ok(proposal.content.endsWith(content.slice(content.lastIndexOf('}'))));
  });
}
test('complete defaults are an exact no-op and wrong existing types remain for author review', () => {
  const content = '{"enabled": "manual", "speed":1e2,"action_name":"my_action"}\n';
  const review = reviewSceneBehaviorCreateParameters(input(content)); assert.equal(review.typeMismatches.length, 1); assert.equal(review.canAddMissing, false);
  assert.deepEqual(proposeSceneBehaviorCreateParameters(input(content)), { content, added: [] });
});
test('unsupported or mismatched interface never enables additions; arbitrary manual parameters still embed', () => {
  for (const extra of [{ backendId: 'org.viento.bevy-rust', language: 'rust' }, { contract: contract([], { status: 'modified' }) }, { contract: contract([], { status: 'unavailable' }) }, { contract: contract([], { status: 'unsupported' }) }]) {
    assert.equal(reviewSceneBehaviorCreateParameters(input('{}', extra)).canAddMissing, false); invalid(() => proposeSceneBehaviorCreateParameters(input('{}', extra)));
  }
  const planned = plan(); const result = applySceneBehaviorCreateParameterSources({ content: planned.content, parameters: ['{"custom":false}'] });
  assert.deepEqual(inspectSceneBehaviors(result.content).value.bindings[0].parameters, { custom: false });
});
test('incomplete, duplicate, reserved, structured and out-of-budget inputs cannot produce a proposal', () => {
  for (const content of ['', '{"speed":1e-}', '{"x":0,"x":1}', '{"__proto__":false}', '{"prototype":0}', '{"constructor":true}', '[]', 'null', '{"x":{}}', '{"x":[]}', '{"x":9007199254740992}', '{"x":1e400}', '{"x":"\\ud800"}', '{"x":"' + 'a'.repeat(4097) + '"}', '{"x":0'.repeat(10000)]) {
    invalid(() => proposeSceneBehaviorCreateParameters(input(content)));
  }
  const content = JSON.stringify(Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['x' + i, i])));
  assert.equal(reviewSceneBehaviorCreateParameters(input(content)).canAddMissing, false); invalid(() => proposeSceneBehaviorCreateParameters(input(content)));
});
test('source-range embedding preserves per-binding raw JSON and the strict legacy planner', () => {
  const planned = plan(2), fragments = ['\uFEFF{\r\n "speed":-0,"x":1e2,"text":"\\u0061"\r\n}\r\n', '{"enabled":false}'];
  assert.equal(planned.ok, true);
  const result = applySceneBehaviorCreateParameterSources({ content: planned.content, parameters: fragments });
  const parsed = inspectSceneBehaviors(result.content); assert.equal(parsed.ok, true); assert.ok(Object.is(parsed.value.bindings[0].parameters.speed, -0)); assert.equal(parsed.value.bindings[0].parameters.x, 100);
  assert.ok(result.content.includes(fragments[0].slice(1))); assert.ok(result.content.includes(fragments[1]));
  assert.deepEqual(parsed.value.bindings.map(row => row.bindingId), [id('1'), id('2')]);
  assert.equal(planned.content.includes('1e2'), false); assert.equal(createSceneBehaviorCreationDraft({ sceneObjectId: id('a'), backendId: 'org.viento.godot4', language: 'gdscript', bindings: [{ bindingId: id('1'), instanceId: id('b'), sourceObjectId: id('c'), parametersContent: '{}' }] }).ok, false);
  assert.equal(applySceneBehaviorCreateParameterSources({ content: planned.content, parameters: ['{}', '{}'] }).content, planned.content);
});
test('embedding rejects missing, sparse or accessor fragments and never overwrites existing parameters', () => {
  const p = plan();
  for (const parameters of [[], ['{}', '{}'], [null], ['{"x":1e-}'], Object.assign(['{}'], { extra: true }), new Array(1)]) invalid(() => applySceneBehaviorCreateParameterSources({ content: p.content, parameters }));
  let reads = 0; const accessor = []; Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return '{}'; } });
  invalid(() => applySceneBehaviorCreateParameterSources({ content: p.content, parameters: accessor })); assert.equal(reads, 0);
  const populated = applySceneBehaviorCreateParameterSources({ content: p.content, parameters: ['{"x":1}'] }); invalid(() => applySceneBehaviorCreateParameterSources({ content: populated.content, parameters: ['{}'] }));
});
test('public parameter boundary rejects accessor and extra input keys without calling them', () => {
  let reads = 0; const value = input(); Object.defineProperty(value, 'content', { enumerable: true, get() { reads++; return '{}'; } });
  invalid(() => proposeSceneBehaviorCreateParameters(value)); assert.equal(reads, 0);
  invalid(() => proposeSceneBehaviorCreateParameters({ ...input(), execute() { assert.fail(); } }));
  const malformed = contract(); Object.defineProperty(malformed, 'status', { enumerable: true, get() { reads++; return 'ready'; } });
  invalid(() => reviewSceneBehaviorCreateParameters(input('{}', { contract: malformed }))); assert.equal(reads, 0);
});
test('the whole created manifest retains the existing 32KiB budget across multiple bindings', () => {
  const p = plan(8), fragment = JSON.stringify({ a: 'a'.repeat(4096) });
  invalid(() => applySceneBehaviorCreateParameterSources({ content: p.content, parameters: Array(8).fill(fragment) }));
});

test('oversized initial manifests are rejected before any source indexing parses them', () => {
  const original = JSON.parse, oversized = plan().content + ' '.repeat(32769); let largeParses = 0;
  JSON.parse = function (value, ...args) { if (value === oversized) largeParses++; return original(value, ...args); };
  try { invalid(() => applySceneBehaviorCreateParameterSources({ content: oversized, parameters: ['{}'] })); }
  finally { JSON.parse = original; }
  assert.equal(largeParses, 0);
});
